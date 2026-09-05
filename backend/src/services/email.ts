/**
 * 邮件发送抽象层（V4.3 §10 路线图 A26，Task 27.6）
 *
 * 双模式：
 * - EMAIL_PROVIDER=dev（默认非生产环境）：console.log 输出完整邮件内容（不实际发送）
 * - EMAIL_PROVIDER=nodemailer（生产环境）：动态 import nodemailer 通过 SMTP 发送
 *
 * 不引入 dev 依赖污染：nodemailer 仅在 nodemailer 模式下动态 import，
 * dev 环境无需安装。使用 Function() 构造器绕过 TypeScript 静态模块解析，
 * 避免编译时找不到模块错误。
 *
 * 接口签名严格对齐 spec：`sendEmail({ to, subject, body, html? }): Promise<void>`
 * 失败时抛异常，调用方负责 try/catch（如 forgot-password 端点吞掉异常以防空邮箱枚举）。
 */

import { config } from '../config.js';

export interface SendEmailOptions {
  to: string;
  subject: string;
  /** 纯文本正文（spec 字段名：body） */
  body: string;
  /** 可选 HTML 正文（spec 字段名：html?） */
  html?: string;
}

// ---------- 邮件模板（V4.3 §10 A26，Task 27.6 spec 要求） ----------

export interface PasswordResetEmailContent {
  subject: string;
  body: string;
  html: string;
}

/**
 * 渲染密码重置邮件。
 *
 * spec 要求：含用户名、重置链接、30 分钟有效提示。
 * ttlMinutes 来自 db.ts 的 PASSWORD_RESET_TTL_MINUTES（单一来源，避免经验值漂移）。
 */
export function renderPasswordResetEmail(opts: {
  userName: string | null;
  resetUrl: string;
  ttlMinutes: number;
}): PasswordResetEmailContent {
  const { userName, resetUrl, ttlMinutes } = opts;
  const greeting = userName ? `，${userName}` : '';
  const subject = '【知行镜】密码重置链接';
  const body = `您好${greeting}：

您正在重置知行镜账号的密码。请在 ${ttlMinutes} 分钟内点击以下链接完成重置（链接一次性使用，过期后需重新申请）：

${resetUrl}

如果您没有发起过密码重置请求，请忽略此邮件，您的账号安全不受影响。

—— 知行镜 ZhixingOS`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;">
<p>您好${userName ? `，<strong>${escapeHtml(userName)}</strong>` : ''}：</p>
<p>您正在重置知行镜账号的密码。请在 <strong>${ttlMinutes} 分钟</strong>内点击以下链接完成重置（链接一次性使用，过期后需重新申请）：</p>
<p style="margin:18px 0;">
  <a href="${escapeAttr(resetUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:15px;">重置密码</a>
</p>
<p style="font-size:13px;color:#666;">或复制此链接到浏览器：<br>${escapeHtml(resetUrl)}</p>
<p style="margin-top:18px;">如果您没有发起过密码重置请求，请忽略此邮件，您的账号安全不受影响。</p>
<p style="margin-top:24px;color:#888;font-size:12px;">—— 知行镜 ZhixingOS</p>
</div>`;
  return { subject, body, html };
}

// ---------- 内部工具：HTML 转义防止模板注入 ----------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (HTML_ESCAPE_MAP[c] ?? c));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// ---------- 动态 import（绕过 TS 静态模块解析） ----------

/**
 * 动态 import 任意模块（绕过 TypeScript 静态模块解析）。
 * 用于 nodemailer 模式按需加载，dev 模式无需安装该依赖。
 */
const dynamicImport = new Function('spec', 'return import(spec)') as (spec: string) => Promise<unknown>;

interface NodemailerTransporter {
  sendMail(opts: {
    from?: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
}
interface NodemailerModule {
  createTransport(opts: unknown): NodemailerTransporter;
}

// ---------- 主接口：sendEmail ----------

/**
 * 发送邮件。spec 接口签名：`sendEmail({ to, subject, body, html? }): Promise<void>`。
 *
 * - dev 模式：console.log 输出完整邮件内容（含 HTML），永不抛出（仅本地调试）
 * - nodemailer 模式：动态 import nodemailer，通过 SMTP 发送
 *   - 配置缺失（SMTP_HOST/SMTP_USER/SMTP_PASS）→ 抛错（让调用方决定是否降级）
 *   - nodemailer 未安装 → 抛错（生产环境应安装 nodemailer）
 *
 * 不在 nodemailer 模式下回退到 console.log：避免在生产日志中泄露重置链接。
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (config.emailProvider === 'dev') {
    // 开发环境：console.log 输出完整邮件内容
    console.log(`\n[EMAIL][DEV] ───────────────────────────────────────`);
    console.log(`  To:      ${opts.to}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(`  Body:    ${opts.body}`);
    if (opts.html) console.log(`  HTML:    ${opts.html}`);
    console.log(`─────────────────────────────────────────────────\n`);
    return;
  }

  // nodemailer 模式：先校验配置完整性，再动态 import
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
    throw new Error('SMTP 配置不完整（需 SMTP_HOST / SMTP_USER / SMTP_PASS）');
  }
  const mod = (await dynamicImport('nodemailer')) as NodemailerModule;
  const transporter = mod.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
  await transporter.sendMail({
    from: config.fromEmail,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    html: opts.html,
  });
}
