/**
 * 基础设施冒烟测试：验证 Playwright + Chromium + Web Build + 后端联调可用
 * 不依赖业务逻辑，只确认环境就绪
 */
import { test, expect } from '@playwright/test';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';
const API_BASE = process.env.API_BASE ?? 'http://localhost:3001';

test('Chromium 可启动并访问 Expo Web', async ({ page }) => {
  test.setTimeout(180_000);
  // Expo Web dev server 首次编译较慢（30-60s），用 domcontentloaded 而非默认的 load
  const res = await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded', timeout: 150_000 });
  expect(res?.ok(), `HTTP 应 2xx，实际 ${res?.status()}`).toBe(true);
  // 等待 RN 渲染（HMR 下 load 事件可能延迟，故只用 domcontentloaded + 自定义等待）
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0 && (root.innerText?.length ?? 0) > 0;
  }, undefined, { timeout: 60_000 });
  const text = await page.locator('body').innerText();
  expect(text.length, '页面应有可见文本').toBeGreaterThan(20);
  // AuthScreen 关键字
  expect(text, `应包含「知行镜」，实际前 200 字：${text.slice(0, 200)}`).toContain('知行镜');
});

test('后端 API 健康', async () => {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'no-such@example.com', password: 'X' }),
  });
  expect(res.status, `后端应可访问，实际 status=${res.status}`).toBeLessThan(500);
});

test('AuthScreen 关键元素存在', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded', timeout: 150_000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0 && (root.innerText?.length ?? 0) > 0;
  }, undefined, { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: /切换到登录/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('tab', { name: /切换到注册/ })).toBeVisible();
  await expect(page.getByPlaceholder('邮箱')).toBeVisible();
  await expect(page.getByPlaceholder('密码（至少 6 位）')).toBeVisible();
});
