import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { getDb, cryptoRandom, audit, saveRefreshToken, getRefreshToken, revokeRefreshToken, revokeAllRefreshTokens, isAccessTokenRevoked, revokeAccessToken } from './db.js';

/** 访问令牌：短周期（默认 15 分钟），降低泄露窗口（P0-8） */
export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'access', jti: cryptoRandom() }, config.jwtSecret, { expiresIn: config.accessTokenExpiresIn as any });
}

/** 刷新令牌：不透明随机串，哈希后落库，可撤销、有期限（P0-8） */
export function createRefreshToken(userId: string): { token: string; expiresAt: string } {
  const token = cryptoRandom();
  const expiresAt = new Date(Date.now() + parseDuration(config.refreshExpiresIn)).toISOString();
  saveRefreshToken(userId, sha256(token), expiresAt);
  return { token, expiresAt };
}

export function verifyAccessToken(token: string): { sub: string; jti: string; exp: number } | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string; typ?: string; jti?: string; exp?: number };
    if (payload.typ !== 'access') return null;
    if (!payload.sub || !payload.jti || !payload.exp) return null;
    return { sub: payload.sub, jti: payload.jti, exp: payload.exp };
  } catch {
    return null;
  }
}

/** 校验刷新令牌：返回 userId 或 null（已撤销/过期/不存在） */
export function verifyRefreshToken(token: string): string | null {
  const row = getRefreshToken(sha256(token));
  if (!row) return null;
  if (row.revoked) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id;
}

export function revokeToken(token: string): void {
  revokeRefreshToken(sha256(token));
}

export function revokeAll(userId: string): void {
  revokeAllRefreshTokens(userId);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: '未携带认证令牌' });
    return;
  }
  const decoded = verifyAccessToken(header.slice(7));
  if (!decoded) {
    res.status(401).json({ error: '认证令牌无效或已过期' });
    return;
  }
  // 访问令牌被显式吊销（注销/登出）后立即失效，即使未到过期时间
  if (isAccessTokenRevoked(decoded.jti)) {
    res.status(401).json({ error: '认证令牌已吊销' });
    return;
  }
  (req as any).userId = decoded.sub;
  (req as any).jti = decoded.jti;
  (req as any).tokenExp = decoded.exp;
  next();
}

export function createUser(email: string, password: string, displayName?: string) {
  const db = getDb();
  const id = cryptoRandom();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email.toLowerCase(), hashPassword(password), displayName ?? null, now);
  audit(id, 'user.register', { email, displayName });
  return { id, email, accessToken: signAccessToken(id), refreshToken: createRefreshToken(id).token };
}

export function authenticate(email: string, password: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | { id: string; email: string; password_hash: string; display_name: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw Object.assign(new Error('邮箱或密码不正确'), { status: 401 });
  }
  audit(row.id, 'user.login', {});
  return { id: row.id, email: row.email, accessToken: signAccessToken(row.id), refreshToken: createRefreshToken(row.id).token };
}

// 预哈希，避免明文令牌落入日志
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// "7d" / "15m" / "30d" → 毫秒
function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60000, h: 3600_000, d: 86_400_000 }[m[2]] ?? 86_400_000;
  return n * unit;
}
