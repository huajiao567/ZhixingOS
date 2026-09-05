import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createUser, authenticate, authRequired,
  verifyRefreshToken, revokeToken, revokeAll,
  signAccessToken, createRefreshToken,
  hashPassword,
} from '../auth.js';
import {
  audit, getDb, purgeUser, revokeAccessToken,
  findUserByEmail, createPasswordResetToken, consumePasswordResetToken,
  updateUserPassword, revokeAllRefreshTokens,
  PASSWORD_RESET_TTL_MINUTES,
} from '../db.js';
import { sendEmail, renderPasswordResetEmail } from '../services/email.js';
import { config } from '../config.js';

export const authRouter = Router();

// ---------- 简单内存限速（P0-8）：登录/注册每 IP 15 分钟内最多 10 次 ----------
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_MAX;
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// 强密码策略（P0-8）：≥8 位，含大小写与数字
const passwordSchema = z
  .string()
  .min(8, '密码至少 8 位')
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, '密码需同时包含大写、小写字母和数字');

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  displayName: z.string().min(1).max(40).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/register', (req, res) => {
  if (rateLimited(clientIp(req))) { res.status(429).json({ error: '尝试过于频繁，请稍后再试' }); return; }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  try {
    const user = createUser(parsed.data.email, parsed.data.password, parsed.data.displayName);
    res.json({ ...user, message: '注册成功' });
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) {
      res.status(409).json({ error: '该邮箱已注册' });
      return;
    }
    res.status(500).json({ error: '注册失败' });
  }
});

authRouter.post('/login', (req, res) => {
  if (rateLimited(clientIp(req))) { res.status(429).json({ error: '尝试过于频繁，请稍后再试' }); return; }
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '邮箱或密码格式不正确' });
    return;
  }
  try {
    const user = authenticate(parsed.data.email, parsed.data.password);
    res.json({ ...user, message: '登录成功' });
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message ?? '登录失败' });
  }
});

// 刷新访问令牌（P0-8）
authRouter.post('/refresh', (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: '缺少 refreshToken' }); return; }
  const userId = verifyRefreshToken(parsed.data.refreshToken);
  if (!userId) { res.status(401).json({ error: '刷新令牌无效或已过期' }); return; }
  // 轮换刷新令牌（旧令牌撤销，降低重放风险）
  revokeToken(parsed.data.refreshToken);
  const user = getDb().prepare('SELECT email, display_name FROM users WHERE id = ?').get(userId) as any;
  res.json({
    id: userId,
    email: user?.email,
    displayName: user?.display_name,
    accessToken: signAccessToken(userId),
    refreshToken: createRefreshToken(userId).token,
  });
});

// 登出：撤销当前刷新令牌与访问令牌（立即使当前会话失效）
authRouter.post('/logout', authRequired, (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (parsed.success) revokeToken(parsed.data.refreshToken);
  const jti = (req as any).jti as string | undefined;
  const exp = (req as any).tokenExp as number | undefined;
  if (jti && exp) revokeAccessToken(jti, exp * 1000);
  res.json({ ok: true });
});

// 撤销该用户全部刷新令牌（如"所有设备登出"）
authRouter.post('/revoke-all', authRequired, (req, res) => {
  revokeAll((req as any).userId);
  const jti = (req as any).jti as string | undefined;
  const exp = (req as any).tokenExp as number | undefined;
  if (jti && exp) revokeAccessToken(jti, exp * 1000);
  res.json({ ok: true });
});

// 校验 token 是否仍有效
authRouter.get('/me', authRequired, (req, res) => {
  const userId = (req as any).userId;
  if (!userId) { res.status(401).json({ error: '未认证' }); return; }
  const row = getDb().prepare('SELECT email, display_name FROM users WHERE id = ?').get(userId) as
    | { email: string; display_name: string } | undefined;
  res.json({ userId, email: row?.email, displayName: row?.display_name });
});

// P0-7：彻底注销——真正删除账号及其全部数据（硬删除，非软删除）
authRouter.delete('/me', authRequired, (req, res) => {
  const userId = (req as any).userId;
  const parsed = refreshSchema.safeParse(req.body);
  if (parsed.success) revokeToken(parsed.data.refreshToken);
  // 吊销当前访问令牌，使其立即失效（即使未到 15 分钟过期）
  const jti = (req as any).jti as string | undefined;
  const exp = (req as any).tokenExp as number | undefined;
  if (jti && exp) revokeAccessToken(jti, exp * 1000);
  revokeAll(userId);
  purgeUser(userId);
  audit(userId, 'user.delete', { purged: true });
  res.json({ ok: true, deletedAt: new Date().toISOString() });
});

// ---------- Task 4.7 / 27.6-27.8: 找回/重置密码（V4.3 §10 路线图 A26） ----------

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

/**
 * POST /api/auth/forgot-password
 * 接收 {email}；若用户存在则生成重置令牌（30 分钟过期，一次性使用，sha256 哈希落库）。
 * 即使邮箱不存在也返回 {ok: true}（防枚举攻击）。
 * dev 模式 sendEmail 用 console.log 输出链接，prod 模式调 nodemailer。
 */
authRouter.post('/forgot-password', async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '邮箱格式不正确' });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const user = findUserByEmail(email);
  if (user) {
    const { token, expiresAt } = createPasswordResetToken(user.id);
    const resetUrl = `${config.appBaseUrl}/reset-password?token=${token}`;
    const emailContent = renderPasswordResetEmail({
      userName: user.display_name,
      resetUrl,
      ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
    });

    try {
      await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        body: emailContent.body,
        html: emailContent.html,
      });
    } catch (e: any) {
      // 邮件发送失败不暴露给客户端（防枚举）：仍返回 ok: true
      console.error('[forgot-password] 邮件发送异常:', e?.message);
    }
    // 审计日志：记录发起重置请求（不记录令牌原文）
    audit(user.id, 'user.password_reset_requested', { email: user.email, expiresAt });
  }
  // 无论邮箱是否存在，都返回 ok: true（防枚举）
  res.json({ ok: true });
});

/**
 * POST /api/auth/reset-password
 * 接收 {token, newPassword}；校验令牌有效且未过期未使用。
 *
 * spec Task 27.8 安全硬约束（全部满足）：
 * - 令牌校验：consumePasswordResetToken 内部检查「存在 + 未使用（used_at IS NULL）+ 未过期」
 * - 一次性使用：成功后立即将 used_at 设为当前时间（在 consumePasswordResetToken 内原子完成）
 * - 密码哈希：用 bcrypt（hashPassword，saltRounds=10，与注册逻辑一致）
 * - 撤销该用户所有刷新令牌（强制其他设备重新登录）
 * - 审计日志：不记录密码原文，仅记录重置成功
 */
authRouter.post('/reset-password', (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const { token, newPassword } = parsed.data;
  const consumed = consumePasswordResetToken(token);
  if (!consumed) {
    res.status(400).json({ error: '重置链接无效或已过期，请重新申请' });
    return;
  }
  const userId = consumed.userId;
  // 重置密码
  const passwordHash = hashPassword(newPassword);
  updateUserPassword(userId, passwordHash);
  // 撤销该用户所有刷新令牌（强制其他设备重新登录）
  revokeAllRefreshTokens(userId);
  // 审计日志：不记录密码原文，仅记录重置成功
  audit(userId, 'user.password_reset', { method: 'token' });
  res.json({ ok: true, message: '密码已重置，请使用新密码登录' });
});
