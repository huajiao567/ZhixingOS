import { expect, test } from '@playwright/test';

test('V4.8 镜像主画布可进入历史与显示解释', async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': '10.89.0.48' });
  await page.goto('/');
  await page.getByText(/填入演示账号|使用演示账号体验/, { exact: false }).click();
  await page.getByRole('button', { name: '登录', exact: false }).click();

  await expect(page.getByLabel('现在的我')).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(
    () => (window as typeof window & { __avatarLoadState?: { phase?: string } }).__avatarLoadState?.phase === 'ready',
    undefined,
    { timeout: 120_000 },
  );
  await page.getByLabel('现在的我').click();

  await expect(page.getByText('为什么这样显示 ›')).toBeVisible({ timeout: 30_000 });
  await page.getByText('为什么这样显示 ›').click();
  await expect(page.getByText('为什么这样显示', { exact: true })).toBeVisible();
  await expect(page.getByText(/不把一次记录变成人格判断/)).toBeVisible();
  await page.getByRole('button', { name: '关闭显示解释' }).click();

  await page.getByText('时间中的自己 ›').click();
  await expect(page.getByText('时间中的自己', { exact: true })).toBeVisible();
  await expect(page.getByText(/不会用今天的形象重写过去/)).toBeVisible();
  await page.getByRole('button', { name: '关闭时间中的自己' }).click();
});
