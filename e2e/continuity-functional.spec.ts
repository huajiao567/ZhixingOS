import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';

async function preparePage(browser: Browser, surface: 'desktop' | 'mobile', ip: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: surface === 'desktop' ? { width: 1440, height: 960 } : { width: 390, height: 844 },
    deviceScaleFactor: surface === 'mobile' ? 2 : 1,
    hasTouch: surface === 'mobile',
    isMobile: surface === 'mobile',
    extraHTTPHeaders: { 'X-Forwarded-For': ip },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
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

  await page.getByRole('button', { name: /使用演示账号体验/ }).click();
  await page.getByRole('button', { name: '登录账号' }).click();

  if (surface === 'desktop') {
    await expect(page.getByText('电脑端工作台', { exact: true })).toBeVisible({ timeout: 90_000 });
  } else {
    await expect(page.getByRole('button', { name: '开放工作台' })).toBeVisible({ timeout: 90_000 });
  }
  return { context, page };
}

test.describe('电脑 ↔ 手机显式接力', () => {
  test('同一账号可以双向创建、消费并继续工作台文本', async ({ browser }) => {
    test.setTimeout(300_000);

    const desktop = await preparePage(browser, 'desktop', '10.91.0.11');
    const desktopInput = desktop.page.getByRole('textbox', { name: '桌面快速输入' });
    await desktopInput.fill('记录一下，电脑端正在审阅跨端连续性测试');
    await desktop.page.getByRole('button', { name: '发送到手机继续' }).click();
    await expect(desktop.page.getByText('已发送到手机，24 小时内可继续', { exact: true })).toBeVisible();

    const mobile = await preparePage(browser, 'mobile', '10.91.0.12');
    const mobileContinue = mobile.page.getByRole('button', { name: '继续来自电脑的接力' });
    await expect(mobileContinue).toBeVisible({ timeout: 20_000 });
    await mobileContinue.click();

    await expect(mobile.page.getByText('变化依据')).toBeVisible({ timeout: 25_000 });
    const mobileInput = mobile.page.getByRole('textbox', { name: '工作台输入' });
    await mobileInput.fill('记录一下，手机端补充了现场观察并准备回到电脑深度整理');
    await mobile.page.getByRole('button', { name: '发送到电脑继续' }).click();
    await expect(mobile.page.getByText('已发送到电脑，24 小时内可继续', { exact: true })).toBeVisible();

    const desktopContinue = desktop.page.getByRole('button', { name: '继续来自手机的接力' });
    await expect(desktopContinue).toBeVisible({ timeout: 20_000 });
    await desktopContinue.click();

    await expect(desktop.page.getByText('变化依据')).toBeVisible({ timeout: 25_000 });
    await desktop.page.getByRole('button', { name: '返回主页' }).click();
    await expect(desktop.page.getByText('电脑端工作台', { exact: true })).toBeVisible();
    await desktop.page.getByRole('button', { name: '刷新跨端接力' }).click();
    await expect(desktop.page.getByRole('button', { name: '继续来自手机的接力' })).toHaveCount(0);

    await mobile.context.close();
    await desktop.context.close();
  });
});
