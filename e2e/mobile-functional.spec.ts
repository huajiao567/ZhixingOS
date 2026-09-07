import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';
const SHOTS = resolve('e2e', 'mobile-screenshots');

async function waitForApp(page: Page) {
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0 && (root.innerText?.length ?? 0) > 0;
  }, undefined, { timeout: 60_000 });

  // 浏览器功能测试必须显式验证并使用本机隔离后端；不改写供真机
  // 使用的 .env.local 局域网地址，也不绕过产品内置的连接检查。
  const serverSettings = page.getByRole('button', { name: '配置后端服务器地址' });
  if (await serverSettings.count()) {
    await serverSettings.click();
    await page.getByRole('textbox', { name: '后端服务器地址' }).fill('http://127.0.0.1:3001');
    await page.getByRole('button', { name: '检测并保存' }).click();
    await expect(page.getByText(/连接成功/)).toBeVisible({ timeout: 10_000 });
  }
}

async function screenshot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), fullPage: true });
}

async function loginDemo(page: Page) {
  await waitForApp(page);
  await expect(page.getByRole('tab', { name: /切换到登录/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /使用演示账号体验/ }).click();
  await page.getByRole('button', { name: '登录账号' }).click();
  await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible({ timeout: 60_000 });
}

test.describe('390x844 手机界面功能冒烟', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile-chromium', '仅在手机视口项目执行');
    await page.context().setExtraHTTPHeaders({
      'X-Forwarded-For': `10.88.0.${test.info().workerIndex * 20 + test.info().retry * 5 + test.info().title.length % 19 + 1}`,
    });
    page.setDefaultTimeout(20_000);
  });

  test('登录、记录与五条主路径均可操作', async ({ page }) => {
    test.setTimeout(240_000);
    await loginDemo(page);
    await page.waitForFunction(
      () => (window as typeof window & { __avatarLoadState?: { phase?: string } }).__avatarLoadState?.phase === 'ready',
      undefined,
      { timeout: 120_000 },
    );
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    await screenshot(page, '01-mirror-home');

    const recordInput = page.getByPlaceholder('说点什么…');
    await expect(recordInput).toBeVisible();
    await recordInput.fill('昨晚熬夜，只睡了 4.5 小时，今天压力很大');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.getByText(/已收进今天/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/昨晚熬夜，只睡了 4.5 小时/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '展开今天的记录' }).click();
    await expect(page.getByText('文字', { exact: true }).first()).toBeVisible();
    await screenshot(page, '01b-today-records');
    await page.getByRole('button', { name: '收起今天的记录' }).click();

    await page.getByRole('button', { name: '现在的我' }).click();
    await expect(page.getByText('镜像', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/近期恢复信号偏低/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '查看镜像为什么这样显示' }).click();
    await expect(page.getByText(/眼下疲劳会在数据变旧后衰减/)).toBeVisible();
    await expect(page.getByText(/不作心理诊断/)).toBeVisible();
    await page.getByRole('button', { name: '关闭显示解释' }).click();
    await screenshot(page, '02-mirror');

    await page.getByRole('button', { name: '调整形象与状态，打开三维镜像编辑器' }).click();
    await expect(page.getByText('我的三维镜像', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(
      () => (window as typeof window & { __avatarLoadState?: { phase?: string } }).__avatarLoadState?.phase === 'ready',
      undefined,
      { timeout: 120_000 },
    );
    await page.getByRole('tab', { name: /切换到捏脸标签/ }).click();
    await expect(page.getByText(/当前页面直接预览正式 V2 VRM/)).toBeVisible();
    await expect(page.getByText('预览生效', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('当前仅保存', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/肩宽走肩骨\/上臂根节点/)).toBeVisible();
    await page.getByRole('button', { name: /服装色青碧/ }).click();
    await page.getByRole('button', { name: '保存到我的数字孪生' }).click();
    await expect(page.getByText(/已保存到正式数字孪生/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/V2 · 身份 1\.0\.1/)).toBeVisible();
    await screenshot(page, '02b-avatar-editor-saved');
    await page.getByRole('button', { name: '关闭' }).click();

    await page.getByRole('button', { name: '查看时间中的自己' }).click();
    await expect(page.getByText('确认我的三维形象', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/身份 1\.0\.1 · 外观 2/)).toBeVisible();
    await page.getByRole('button', { name: '关闭时间中的自己' }).click();

    await page.getByRole('button', { name: '返回主页' }).click();
    await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible();

    await page.getByRole('button', { name: /规划：/ }).click();
    await expect(page.getByText('进程', { exact: true }).first()).toBeVisible();
    await screenshot(page, '03-progress');
    await page.getByRole('button', { name: '返回主页' }).click();

    await page.getByRole('button', { name: '秘书' }).click();
    await expect(page.getByText('秘书', { exact: true }).first()).toBeVisible();
    await screenshot(page, '04-secretary');
    await page.getByRole('button', { name: '返回主页' }).click();

    await page.getByRole('button', { name: '我的数据' }).click();
    await expect(page.getByText('数据主权', { exact: true }).first()).toBeVisible();
    await screenshot(page, '05-data-sovereignty');
    await page.getByRole('tab', { name: '切换到连接的数据标签' }).click();
    await expect(page.getByText('3D 数字孪生适应', { exact: true })).toBeVisible();
    await expect(page.getByText('小米手环优先由 Mi Fitness 写入 Health Connect；地区或型号不支持时可走用户导出文件。')).toBeVisible();
    await expect(page.locator('input[type="checkbox"][aria-label="允许生活数据微调数字孪生"]')).toBeChecked();
    await screenshot(page, '05-connected-data');
    await page.getByRole('button', { name: '返回主页' }).click();

    await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible();
  });

  test('错误登录有明确反馈，且不会进入主界面', async ({ page }) => {
    await waitForApp(page);
    await page.getByPlaceholder('邮箱').fill(`missing-${Date.now()}@example.com`);
    await page.getByPlaceholder('密码（至少 6 位）').fill('WrongPassword123');
    await page.getByRole('button', { name: '登录账号' }).click();
    await expect(page.getByText(/不存在|错误|失败|不正确/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '现在的我' })).toHaveCount(0);
    await screenshot(page, '06-login-error');
  });

  test('开放工作台能解析、解释、执行并真实撤销记录', async ({ page }) => {
    test.setTimeout(240_000);
    await loginDemo(page);
    await page.getByRole('button', { name: '开放工作台' }).click();
    await expect(page.getByText('开放工作台', { exact: true }).first()).toBeVisible();

    const input = page.getByLabel('工作台输入');
    await input.fill('记录一下，今天散步后轻松了一些');
    await page.getByRole('button', { name: '解析输入' }).click();
    await expect(page.getByText('变化依据')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('确认后将执行')).toBeVisible();
    await page.getByRole('button', { name: /确认执行/ }).click();

    await expect(page.getByText(/行动回执 · 全部完成/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/ID ·/).first()).toBeVisible();
    await page.getByRole('button', { name: '撤销已执行动作' }).click();
    await expect(page.getByText(/行动回执 · 已撤销/)).toBeVisible({ timeout: 20_000 });
    await screenshot(page, '07-workspace-receipt-undone');
  });
});
