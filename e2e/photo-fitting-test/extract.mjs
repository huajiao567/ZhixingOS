// 本地照片拟合测试：驱动浏览器内 MediaPipe，对私有照片提取 landmark 落盘。
// 必填：PF_PHOTO_DIR=本地照片目录，PF_PHOTO_BASE_URL=该目录对应的 HTTP URL。
// 可选：PF_PAGE_URL、PF_PORT、PF_MAX。输出文件已被 .gitignore 永久排除。
import { chromium } from 'playwright';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PHOTO_DIR = process.env.PF_PHOTO_DIR;
const PHOTO_BASE_URL = process.env.PF_PHOTO_BASE_URL;
const PORT = Number(process.env.PF_PORT ?? 8777);
const PAGE_URL = process.env.PF_PAGE_URL ?? `http://127.0.0.1:${PORT}/e2e/photo-fitting-test/page.html`;
const OUT = path.resolve('e2e/photo-fitting-test/landmarks.json');
const MAX_PHOTOS = Number(process.env.PF_MAX ?? 16);

if (!PHOTO_DIR || !PHOTO_BASE_URL) {
  console.error('Missing PF_PHOTO_DIR or PF_PHOTO_BASE_URL. See the header comment in this script.');
  process.exit(2);
}

const files = (await readdir(PHOTO_DIR)).filter((f) => /\.jpe?g$/i.test(f)).sort();
// 均匀抽样，覆盖相册时间分布
const step = Math.max(1, Math.floor(files.length / MAX_PHOTOS));
const picked = files.filter((_, i) => i % step === 0).slice(0, MAX_PHOTOS);
console.log(`photos total=${files.length}, picked=${picked.length}`);

const photoBaseUrl = new URL(PHOTO_BASE_URL.endsWith('/') ? PHOTO_BASE_URL : `${PHOTO_BASE_URL}/`);
const toUrl = (fileName) => new URL(encodeURIComponent(fileName), photoBaseUrl).toString();

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium', // 用完整版 Chromium（headless_shell 缺少 canvas/WebGL，MediaPipe 无法初始化）
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http' + r.status() + ']', r.url()); });
await page.goto(PAGE_URL);
try {
  await page.waitForFunction(() => window.__modelsReady === true || window.__modelsError, null, { timeout: 240_000 });
} catch (e) {
  const err = await page.evaluate(() => window.__modelsError ?? 'unknown (models never reported)');
  console.error('model init timeout/failure:', err);
  await browser.close();
  process.exit(1);
}
const initErr = await page.evaluate(() => window.__modelsError ?? null);
if (initErr) {
  console.error('model init error:', initErr);
  await browser.close();
  process.exit(1);
}
console.log('mediapipe ready');

const results = [];
for (const f of picked) {
  const r = await page.evaluate((url) => window.__analyze(url), toUrl(f));
  results.push({ file: f, ...r, url: undefined });
  const hasFace = Boolean(r.faceLandmarks);
  const hasPose = Boolean(r.poseLandmarks);
  console.log(`${f}: face=${hasFace} pose=${hasPose}${r.error ? ' err=' + r.error : ''}`);
}

await writeFile(OUT, JSON.stringify(results));
await browser.close();
console.log(`wrote ${OUT} (${results.length} photos)`);
