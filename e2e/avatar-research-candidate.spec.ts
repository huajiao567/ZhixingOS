import { expect, test, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';
const CANDIDATE_PATH = process.env.RESEARCH_AVATAR_CANDIDATE
  ?? resolve('artifacts', 'makehuman-rigged-candidate', 'MakeHuman_Core_Rigged_Candidate.vrm');
const PROVISIONAL_WEB_FRAME_P95_MS = 1000 / 30;

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

type ConsoleRow = {
  type: string;
  text: string;
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

async function loginAndOpenMirrorHome(page: Page, projectName: string) {
  await waitForApp(page);
  const loginTab = page.getByRole('tab', { name: /切换到登录/ });
  if (await loginTab.count()) await expect(loginTab).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /使用演示账号体验/ }).click();
  await page.getByRole('button', { name: '登录账号' }).click();

  if (projectName === 'chromium') {
    // Desktop deliberately lands on DesktopHub rather than the phone-first MirrorHome.
    // Reach the same MirrorHome through the visible desktop sidebar so this remains a
    // genuine 1440x960 user path rather than a navigation-store shortcut.
    await expect(page.getByText('电脑端工作台', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: '镜像主页' }).click();
  }

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
  let modelIntercepts = 0;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(300_000);
    const candidateBytes = readFileSync(CANDIDATE_PATH);
    modelIntercepts = 0;

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
  });

  test('candidate renders in MirrorHome and Mirror3DEditor at the real project viewport', async ({ page }) => {
    const candidateBytes = readFileSync(CANDIDATE_PATH);
    const browserConsole: ConsoleRow[] = [];
    page.on('console', (message) => browserConsole.push({ type: message.type(), text: message.text() }));

    const startedAt = Date.now();
    await loginAndOpenMirrorHome(page, test.info().project.name);
    const homeProbe = await waitForAvatarProbe(page);
    expect(modelIntercepts, 'research test must actually substitute the production AvatarSample_G request').toBeGreaterThan(0);
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

    const consoleErrors = browserConsole.filter((row) => row.type === 'error').map((row) => row.text);
    const fatalRendererErrors = consoleErrors.filter((message) =>
      /Render error|3D 数字人加载失败|WebGL context lost/i.test(message),
    );
    const contextLostLogs = browserConsole
      .filter((row) => /THREE\.WebGLRenderer: Context Lost/i.test(row.text))
      .map((row) => row.text);
    const unsupportedLookAtWarnings = browserConsole
      .filter((row) => /LookAtDegreeMap.*not supported/i.test(row.text))
      .map((row) => row.text);

    const homeFrameBudgetPass = homeFrames.p95Ms <= PROVISIONAL_WEB_FRAME_P95_MS;
    const editorFrameBudgetPass = editorFrames.p95Ms <= PROVISIONAL_WEB_FRAME_P95_MS;
    const ciHostedWebPerformancePass = homeFrameBudgetPass && editorFrameBudgetPass;
    const renderCompatibilityPass = (
      modelIntercepts > 0
      && Boolean(homeProbe.geometry.headWorldScale)
      && editorProbe.evidenceTypes.includes('editor_preview')
      && homeFrames.frames >= 100
      && editorFrames.frames >= 100
      && fatalRendererErrors.length === 0
    );

    const productionBlockers = [
      'visual: one untextured skin material; no production hair/outfit/eye/material parity',
      'skinning: pinned MakeHuman candidate worst retained raw top-4 weight ratio remains 0.5136330140',
      'expressions: no production blink/expression parity',
      'gaze: VRM0 LookAtDegreeMap curves remain unsupported by the installed three-vrm runtime',
      'performance: GitHub-hosted headless/software WebGL evidence is not a mobile-GPU or physical-device acceptance environment',
      'validation: no anthropometric or personal-resemblance correctness evidence',
      'native: no Android/iOS native compile or physical-device evidence for this candidate',
    ];

    const evidence = {
      project: test.info().project.name,
      viewport: test.info().project.use.viewport,
      candidateBytes: candidateBytes.byteLength,
      modelIntercepts,
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
      performancePolicy: {
        provisionalP95FrameBudgetMs: PROVISIONAL_WEB_FRAME_P95_MS,
        correspondingNominalFps: 30,
        homeFrameBudgetPass,
        editorFrameBudgetPass,
        ciHostedWebPerformancePass,
        authority: 'evidence-only: GitHub-hosted headless Chromium/software WebGL is not authoritative production or physical-device performance validation',
      },
      consoleErrorCount: consoleErrors.length,
      fatalRendererErrors,
      contextLostLogCount: contextLostLogs.length,
      contextLostLogs,
      unsupportedLookAtWarningCount: unsupportedLookAtWarnings.length,
      renderCompatibilityPass,
      visualProductionGatePass: false,
      productionReplacementPass: false,
      productionBlockers,
      truthBoundary: 'research renderer compatibility only; rendered/converged does not imply production, scientific, anatomical, anthropometric, or personal correctness',
    };
    const outDir = resolve('artifacts', 'avatar-candidate-render', test.info().project.name);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'render-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log('[candidate-render-harness]', JSON.stringify(evidence));

    // Research compatibility and production acceptance are intentionally distinct gates.
    // CI must stay red for broken loading/renderer paths, but must not relabel noisy hosted
    // software-WebGL timings as physical mobile performance. The observed timings and the
    // unchanged 30-fps provisional budget remain machine-readable above.
    expect(candidateBytes.byteLength).toBeGreaterThan(1_000_000);
    expect(candidateBytes.byteLength).toBeLessThan(5_000_000);
    expect(renderCompatibilityPass).toBe(true);
    expect(evidence.productionReplacementPass).toBe(false);
  });
});
