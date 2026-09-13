import { expect, test, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';
const CANDIDATE_PATH = process.env.RESEARCH_AVATAR_CANDIDATE
  ?? resolve('artifacts', 'makehuman-rigged-candidate', 'MakeHuman_Core_Rigged_Candidate.vrm');

type AvatarRuntimeProbe = {
  instanceId: string;
  evidenceTypes: string[];
  updatedAt: number;
  geometry: {
    headWorldScale?: { x: number; y: number; z: number };
    shoulderWorldDistance?: number;
  };
  motion: {
    elapsed: number;
  };
};

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
  const loginTab = page.getByRole('tab', { name: /切换到登录/ });
  if (await loginTab.count()) await expect(loginTab).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /使用演示账号体验/ }).click();
  await page.getByRole('button', { name: '登录账号' }).click();
  await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible({ timeout: 60_000 });
}

async function waitForAvatarProbe(page: Page, evidenceType?: string): Promise<AvatarRuntimeProbe> {
  await page.waitForFunction((wantedEvidence) => {
    const root = window as typeof window & {
      __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
    };
    const probes = Object.values(root.__avatarRuntimeProbes ?? {});
    return probes.some((probe) => {
      if (!probe.geometry?.headWorldScale) return false;
      return !wantedEvidence || probe.evidenceTypes.includes(String(wantedEvidence));
    });
  }, evidenceType ?? null, { timeout: 120_000 });

  return page.evaluate((wantedEvidence) => {
    const root = window as typeof window & {
      __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
    };
    const probes = Object.values(root.__avatarRuntimeProbes ?? {})
      .filter((probe) => probe.geometry?.headWorldScale)
      .filter((probe) => !wantedEvidence || probe.evidenceTypes.includes(String(wantedEvidence)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!probes[0]) throw new Error(`avatar runtime probe missing for ${wantedEvidence ?? 'any surface'}`);
    return probes[0];
  }, evidenceType ?? null);
}

async function sampleAnimationFrames(page: Page) {
  return page.evaluate(async () => {
    const samples: number[] = [];
    await new Promise<void>((resolveDone) => {
      let previous = performance.now();
      let remaining = 120;
      const step = (now: number) => {
        if (remaining < 120) samples.push(now - previous);
        previous = now;
        remaining -= 1;
        if (remaining <= 0) resolveDone();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    return {
      frames: samples.length,
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: Math.max(...samples),
      meanMs: samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length),
    };
  });
}

async function capture(page: Page, name: string) {
  const dir = resolve('e2e', 'candidate-screenshots', test.info().project.name);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}

test.describe('research VRM through production renderer', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(300_000);
    const candidateBytes = readFileSync(CANDIDATE_PATH);
    let modelIntercepts = 0;

    await page.route('**/avatar/AvatarSample_G.glb', async (route) => {
      modelIntercepts += 1;
      await route.fulfill({
        status: 200,
        contentType: 'model/gltf-binary',
        body: candidateBytes,
        headers: {
          'cache-control': 'no-store',
          'x-zhixing-research-avatar': 'makehuman-rigged-candidate',
        },
      });
    });

    page.on('close', () => {
      if (modelIntercepts === 0) {
        console.error('[candidate-render-harness] production avatar URL was never intercepted');
      }
    });
  });

  test('candidate renders in MirrorHome and Mirror3DEditor at the real project viewport', async ({ page }) => {
    const candidateBytes = readFileSync(CANDIDATE_PATH);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const startedAt = Date.now();
    await loginDemo(page);
    const homeProbe = await waitForAvatarProbe(page);
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    const homeReadyMs = Date.now() - startedAt;
    const homeFrames = await sampleAnimationFrames(page);
    await capture(page, '01-home-research-candidate');

    await page.getByRole('button', { name: '现在的我' }).click();
    await expect(page.getByText('镜像', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '调整形象与状态，打开三维镜像编辑器' }).click();
    await expect(page.getByText('我的三维镜像', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: /切换到捏脸标签/ }).click();

    const editorStartedAt = Date.now();
    const editorProbe = await waitForAvatarProbe(page, 'editor_preview');
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 10_000 });
    const editorReadyMs = Date.now() - editorStartedAt;
    const editorFrames = await sampleAnimationFrames(page);
    await capture(page, '02-editor-research-candidate');

    expect(candidateBytes.byteLength).toBeGreaterThan(1_000_000);
    expect(candidateBytes.byteLength).toBeLessThan(5_000_000);
    expect(homeProbe.geometry.headWorldScale).toBeTruthy();
    expect(editorProbe.evidenceTypes).toContain('editor_preview');
    expect(homeFrames.frames).toBeGreaterThanOrEqual(100);
    expect(editorFrames.frames).toBeGreaterThanOrEqual(100);
    expect(homeFrames.p95Ms).toBeLessThan(120);
    expect(editorFrames.p95Ms).toBeLessThan(120);
    expect(homeFrames.maxMs).toBeLessThan(500);
    expect(editorFrames.maxMs).toBeLessThan(500);

    const fatalRendererErrors = consoleErrors.filter((message) =>
      /Render error|3D 数字人加载失败|WebGL context lost|THREE\.WebGLRenderer/i.test(message),
    );
    expect(fatalRendererErrors).toEqual([]);

    const evidence = {
      project: test.info().project.name,
      viewport: test.info().project.use.viewport,
      candidateBytes: candidateBytes.byteLength,
      homeReadyMs,
      editorReadyMs,
      homeProbe: {
        instanceId: homeProbe.instanceId,
        evidenceTypes: homeProbe.evidenceTypes,
        headWorldScale: homeProbe.geometry.headWorldScale,
        elapsed: homeProbe.motion.elapsed,
      },
      editorProbe: {
        instanceId: editorProbe.instanceId,
        evidenceTypes: editorProbe.evidenceTypes,
        headWorldScale: editorProbe.geometry.headWorldScale,
        elapsed: editorProbe.motion.elapsed,
      },
      homeFrames,
      editorFrames,
      consoleErrorCount: consoleErrors.length,
      fatalRendererErrors,
      truthBoundary: 'research renderer compatibility only; not a production replacement or personal-correctness claim',
    };
    const outDir = resolve('artifacts', 'avatar-candidate-render', test.info().project.name);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'render-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log('[candidate-render-harness]', JSON.stringify(evidence));
  });
});
