import { getDb, cryptoRandom, audit } from '../db.js';
import { hashPassword } from '../auth.js';

const DEMO_EMAIL = 'demo@zhixingos.com';
const DEMO_PASSWORD = 'demo1234';

// 仅创建演示账号；丰富的领域数据由 App 端首次登录后通过 API 推送（复用 App 的 seed.ts，单一来源）
export function ensureDemoSeed(): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL) as
    | { id: string } | undefined;
  if (existing) {
    console.log('  演示账号已存在，跳过');
    return;
  }
  const userId = cryptoRandom();
  db.prepare('INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, DEMO_EMAIL, hashPassword(DEMO_PASSWORD), '林一舟', new Date().toISOString());
  audit(userId, 'demo.user.created', { email: DEMO_EMAIL });
  console.log(`  演示账号已创建：${DEMO_EMAIL} / ${DEMO_PASSWORD}（领域数据将由 App 首次登录后推送）`);
}
