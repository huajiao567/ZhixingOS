import { chromium, defineConfig, devices } from '@playwright/test';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? chromium.executablePath();

/**
 * Playwright 配置 — 知行镜 ZhixingOS Web E2E
 *
 * 前置条件：
 *   1. 后端 dev 服务运行在 http://localhost:3001（npm run dev --prefix backend）
 *   2. 前端 Expo Web dev 服务运行在 http://localhost:8081（npm run web）
 *
 * 选择器策略：React Native for Web 将 accessibilityLabel 映射为 aria-label，
 * 故全部使用 getbyLabel / [aria-label="..."] 选择器，与 App.tsx 中的标签一致。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,           // 多角色并发容易触发后端单 IP 注册限流，串行更稳
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e/test-results.json' }],
    ['html', { outputFolder: 'e2e/html-report', open: 'never' }],
  ],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.WEB_BASE ?? 'http://localhost:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // 关键：为每个 context 注入独立 X-Forwarded-For，避免后端单 IP 注册限流（10次/15分钟）
    // 具体 IP 由测试用例通过 page.context() 设置
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: undefined,
        viewport: { width: 1440, height: 960 },
        launchOptions: {
          executablePath: chromiumExecutablePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: undefined,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        launchOptions: {
          executablePath: chromiumExecutablePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },
  ],
});
