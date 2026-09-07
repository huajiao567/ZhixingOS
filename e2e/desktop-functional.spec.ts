import { expect, test, type Page } from '@playwright/test';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';

async function waitForApp(page: Page) {
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0 && (root.innerText?.length ?? 0) > 0;
  }, undefined, { timeout: 60_000 });

  const serverSettings = page.getByRole('button', { name: '配置后端服务器地址' });
  if (await serverSettings.count()) {
    await serverSettings.click();
    await page.getByRole('textbox', { name: '后端服务器地址' }).fill('http://127.0.0.1:3001');
    await page.getByRole('button', { name: '检测并保存' }).click();
    await expect(page.getByText(/连接成功/)).toBeVisible({ timeout: 10_000 });
  }
}

async function loginDemo(page: Page) {
  await waitForApp(page);
  await page.getByRole('button', { name: /使用演示账号体验/ }).click();
  await page.getByRole('button', { name: '登录账号' }).click();
  await expect(page.getByText('电脑端工作台', { exact: true })).toBeVisible({ timeout: 90_000 });
}

test.describe('1440px 电脑端工作台', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', '仅在桌面 Chromium 项目执行');
    await page.context().setExtraHTTPHeaders({
      'X-Forwarded-For': `10.89.0.${test.info().workerIndex * 20 + test.info().title.length % 19 + 1}`,
    });
    page.setDefaultTimeout(20_000);
  });

  test('宽屏登录进入桌面工作台并可把输入交给统一执行内核', async ({ page }) => {
    test.setTimeout(240_000);
    await loginDemo(page);

    await expect(page.getByText(/DESKTOP WORKBENCH/)).toBeVisible();
    await expect(page.getByRole('button', { name: '开放工作台' })).toBeVisible();
    await expect(page.getByRole('button', { name: '进程', exact: true })).toBeVisible();
    await expect(page.getByText('跨端连续性 v1', { exact: true })).toBeVisible();

    const input = page.getByRole('textbox', { name: '桌面快速输入' });
    await page.keyboard.press('Control+K');
    await expect(input).toBeFocused();
    await input.fill('记录一下，电脑端继续整理今天的实验记录');
    await page.getByRole('button', { name: '交给工作台' }).click();

    await expect(page.getByText('变化依据')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '返回主页' }).click();
    await expect(page.getByText('电脑端工作台', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '进程', exact: true }).click();
    await expect(page.getByText('进程', { exact: true }).first()).toBeVisible();
  });
});
