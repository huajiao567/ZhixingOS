import 'dotenv/config';

function jwtSecret(): string {
  const value = process.env.JWT_SECRET ?? 'zhixingos-dev-secret-change-me-in-production-please';
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'production') {
    console.warn('[config] 未设置 JWT_SECRET，正在使用开发兜底值；局域网或共享部署（含 backend:phone）必须显式配置');
  }
  if (process.env.NODE_ENV === 'production' && (value.length < 32 || value.includes('dev-secret'))) {
    throw new Error('生产环境必须设置至少 32 字符且非默认值的 JWT_SECRET');
  }
  return value;
}

function corsOrigin(): string {
  const value = process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === 'production' ? '' : '*');
  if (process.env.NODE_ENV === 'production' && (value === '*' || !value.trim())) {
    throw new Error('生产环境必须将 CORS_ORIGIN 设置为逗号分隔的显式来源列表，不允许通配');
  }
  return value;
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: jwtSecret(),
  // 访问令牌短周期（P0-8）：固定 15 分钟，降低泄露窗口。
  // 必须由独立环境变量控制，绝不可与刷新令牌共用一个 30d 的 JWT_EXPIRES_IN。
  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN ?? '15m',
  // 刷新令牌周期（不透明随机串 + 可撤销，落库哈希）
  refreshExpiresIn: process.env.REFRESH_EXPIRES_IN ?? '7d',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  // DeepSeek API 模型名：deepseek-chat 已被官方下线（400 错误提示仅支持 deepseek-v4-pro / deepseek-v4-flash）
  // 默认 flash（快速、低成本），生产可设 DEEPSEEK_MODEL=deepseek-v4-pro
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
  llmCacheEnabled: process.env.LLM_CACHE_ENABLED !== 'false',
  corsOrigin: corsOrigin(),
  dbPath: process.env.DB_PATH ?? './data/zhixing.db',
  backupEnabled: process.env.BACKUP_ENABLED !== 'false',
  // ───────────────────────────────────────────────
  // 邮件发送（V4.3 §10 路线图 A26，Task 27.6）
  // EMAIL_PROVIDER=dev → console.log 输出（默认非生产环境）
  // EMAIL_PROVIDER=nodemailer → 通过 SMTP 发送（生产环境，nodemailer 动态 import 不污染 dev 依赖）
  // ───────────────────────────────────────────────
  emailProvider: (process.env.EMAIL_PROVIDER
    ?? (process.env.NODE_ENV === 'production' ? 'nodemailer' : 'dev')) as 'dev' | 'nodemailer',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  fromEmail: process.env.FROM_EMAIL ?? 'no-reply@zhixingos.com',
  // App 前端 base URL，用于生成密码重置链接（不能用 corsOrigin，因为 corsOrigin 可能是 '*'）
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:8081',
};

export type AppConfig = typeof config;
