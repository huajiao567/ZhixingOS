import { expect, test, type Locator, type Page } from '@playwright/test';
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
  identity: {
    eyeSize: number;
    mouthWidth: number;
  };
  identityMorphs: {
    availableTargetNames: string[];
    bindings: Array<{ field: 'eyeSize' | 'mouthWidth'; targetName: string; meshName: string; index: number; weight: number }>;
  };
  motion: {
    elapsed: number;
  };
};

type ConsoleRow = {
  type: string;
  text: string;
};

type AvatarStageEvidence = {
  file: string;
  box: { x: number; y: number; width: number; height: number };
  visibleHeight: number;
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

async function captureVisibleAvatarStage(page: Page, name: string): Promise<AvatarStageEvidence> {
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1, { timeout: 30_000 });
  const stage = canvas.first();
  await expect(stage).toBeVisible({ timeout: 30_000 });
  const box = await stage.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error(`avatar stage geometry unavailable: ${JSON.stringify({ box, viewport })}`);
  const visibleHeight = Math.max(0, Math.min(viewport.height, box.y + box.height) - Math.max(0, box.y));
  expect(box.width, 'avatar stage must have a non-trivial rendered width').toBeGreaterThan(180);
  expect(box.height, 'avatar stage must have a non-trivial rendered height').toBeGreaterThan(180);
  expect(visibleHeight, 'avatar stage must be materially inside the actual viewport').toBeGreaterThan(Math.min(180, box.height * 0.5));

  const dir = resolve('e2e', 'candidate-screenshots', test.info().project.name);
  mkdirSync(dir, { recursive: true });
  const file = `${name}.png`;
  await stage.screenshot({ path: resolve(dir, file) });
  return { file, box, visibleHeight };
}

async function scrollEditorAvatarBackIntoView(page: Page) {
  const heading = page.getByText('我的三维镜像', { exact: true });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(50);
    const canvasBox = await page.locator('canvas').first().boundingBox();
    const viewport = page.viewportSize();
    if (canvasBox && viewport) {
      const visibleHeight = Math.max(0, Math.min(viewport.height, canvasBox.y + canvasBox.height) - Math.max(0, canvasBox.y));
      if (visibleHeight > Math.min(180, canvasBox.height * 0.5)) break;
    }
  }
  await expect(heading).toBeVisible({ timeout: 10_000 });
}

async function clickAdjustableTrackEnd(page: Page, slider: Locator) {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  if (!box || box.width < 8 || box.height < 8) {
    throw new Error(`adjustable slider has no usable bounding box: ${JSON.stringify(box)}`);
  }
  // Genuine pointer input through the rendered control. Do not mutate React state,
  // DOM values, or runtime probes directly from the test.
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
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
    await scrollEditorAvatarBackIntoView(page);
    const beforeMorphAvatarStage = await captureVisibleAvatarStage(page, '02a-editor-avatar-stage-before-morph');
    await capture(page, '02-editor-research-candidate');

    // The product contract still labels these controls as stored-only for the
    // current production AvatarSample_G. In this research-only substituted
    // candidate, exercise the same real UI controls and prove that exact,
    // semantically compatible structural morphs reach rendered mesh weights.
    await page.getByRole('button', { name: '展开当前仅保存参数' }).click();
    const eyeSizeSlider = page.getByLabel(/眼睛大小，当前仅保存/);
    const mouthWidthSlider = page.getByLabel(/嘴宽，当前仅保存/);
    await clickAdjustableTrackEnd(page, eyeSizeSlider);
    await expect(page.getByLabel(/眼睛大小，当前仅保存，当前值 1\.00/)).toBeVisible({ timeout: 10_000 });
    await clickAdjustableTrackEnd(page, mouthWidthSlider);
    await expect(page.getByLabel(/嘴宽，当前仅保存，当前值 1\.00/)).toBeVisible({ timeout: 10_000 });

    await page.waitForFunction(() => {
      const root = window as typeof window & { __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe> };
      return Object.values(root.__avatarRuntimeProbes ?? {}).some((probe) =>
        probe.evidenceTypes.includes('editor_preview')
        && probe.identity.eyeSize >= 0.98
        && probe.identity.mouthWidth >= 0.98
        && probe.identityMorphs.bindings.some((binding) => binding.field === 'eyeSize' && binding.weight >= 0.95)
        && probe.identityMorphs.bindings.some((binding) => binding.field === 'mouthWidth' && binding.weight >= 0.95),
      );
    }, undefined, { timeout: 30_000 });
    const morphedEditorProbe = await waitForAvatarProbe(page, 'editor_preview');
    await capture(page, '03-editor-research-candidate-real-morph-controls');
    await scrollEditorAvatarBackIntoView(page);
    const afterMorphAvatarStage = await captureVisibleAvatarStage(page, '04-editor-avatar-stage-after-real-morph');
    await capture(page, '05-editor-research-candidate-real-morph-avatar-visible');

    const candidateStructuralTargets = morphedEditorProbe.identityMorphs.availableTargetNames;
    const appliedIdentityBindings = morphedEditorProbe.identityMorphs.bindings;
    expect(candidateStructuralTargets).toEqual(expect.arrayContaining(['face_jaw_width', 'eye_size', 'nose_width', 'mouth_width']));
    expect(appliedIdentityBindings.map((binding) => binding.targetName).sort()).toEqual(['eye_size', 'mouth_width']);
    expect(appliedIdentityBindings.every((binding) => binding.weight >= 0.95)).toBe(true);

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
      && appliedIdentityBindings.some((binding) => binding.field === 'eyeSize' && binding.weight >= 0.95)
      && appliedIdentityBindings.some((binding) => binding.field === 'mouthWidth' && binding.weight >= 0.95)
      && beforeMorphAvatarStage.visibleHeight > 0
      && afterMorphAvatarStage.visibleHeight > 0
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
      structuralMorphProof: {
        availableTargetNames: candidateStructuralTargets,
        appliedBindings: appliedIdentityBindings,
        researchUiValues: {
          eyeSize: morphedEditorProbe.identity.eyeSize,
          mouthWidth: morphedEditorProbe.identity.mouthWidth,
        },
        semanticExclusions: ['face_jaw_width != jawRoundness', 'nose_width != noseSize'],
        productionUiCapabilityUnchanged: 'stored-only for current AvatarSample_G',
      },
      visualMorphEvidence: {
        beforeMorphAvatarStage,
        afterMorphAvatarStage,
        userVisibleScrollPath: 'real wheel scrolling returned the live editor avatar stage to the viewport after slider interaction',
        pixelDifferenceGate: false,
        pixelDifferenceReason: 'idle/blink/look/breath motion remains live, so a raw screenshot diff would confound structural morphs with animation',
        authority: 'human-visible screenshot evidence paired with authoritative runtime mesh-weight proof; not a scientific, anthropometric, or personal-resemblance claim',
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