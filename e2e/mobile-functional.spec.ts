import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';
const SHOTS = resolve('e2e', 'mobile-screenshots');

const MEDIAPIPE_PORTRAIT_FIXTURE = {
  url: 'https://storage.googleapis.com/mediapipe-assets/tasks/testdata/vision/portrait.jpg?generation=1782185108020964',
  sha256: 'a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e',
  fileName: 'mediapipe-portrait.jpg',
} as const;

async function materializeMediaPipePortraitFixture(): Promise<string> {
  const filePath = resolve(tmpdir(), `zhixingos-${MEDIAPIPE_PORTRAIT_FIXTURE.fileName}`);

  const verify = (bytes: Buffer) => {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== MEDIAPIPE_PORTRAIT_FIXTURE.sha256) {
      throw new Error(`MediaPipe portrait fixture SHA-256 mismatch: ${digest}`);
    }
  };

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath);
    verify(existing);
    return filePath;
  }

  const response = await fetch(MEDIAPIPE_PORTRAIT_FIXTURE.url);
  if (!response.ok) {
    throw new Error(`MediaPipe portrait fixture download failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  verify(bytes);
  writeFileSync(filePath, bytes);
  return filePath;
}

function clearMediaPipePortraitFixture(filePath: string | null) {
  if (!filePath) return;
  try {
    rmSync(filePath, { force: true });
  } catch {
    // Public CI fixture cleanup is best-effort; never fail the product test
    // after all assertions have already completed.
  }
}

type AvatarRuntimeProbe = {
  instanceId: string;
  evidenceTypes: string[];
  updatedAt: number;
  identity: {
    faceWidth: number;
    faceHeight: number;
    eyeSize: number;
    bodyScale: number;
    shoulderWidth: number;
  };
  geometry: {
    groupScale: { x: number; y: number; z: number };
    headWorldScale?: { x: number; y: number; z: number };
    shoulderWorldDistance?: number;
    shoulderRootNames: string[];
  };
  appearance: { skin?: string; hair?: string; outfit?: string };
};

async function readEditorAvatarRuntimeProbe(page: Page): Promise<AvatarRuntimeProbe> {
  return page.evaluate(() => {
    const root = window as typeof window & {
      __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
    };
    const probe = Object.values(root.__avatarRuntimeProbes ?? {})
      .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
    if (!probe) throw new Error('editor avatar runtime probe is not ready');
    return probe;
  });
}

async function setIdentitySliderToEnd(page: Page, label: string) {
  const slider = page.getByLabel(new RegExp(`^${label}，`)).first();
  await expect(slider).toBeVisible();

  // @react-native-community/slider on Web exposes role=slider but does not
  // implement the browser's native End-key range behavior. Use an actual
  // pointer/touch on the far-right of the rendered track, then verify the
  // product's accessibility value changed before trusting renderer evidence.
  const box = await slider.boundingBox();
  if (!box) throw new Error(`${label} slider has no rendered bounding box`);
  await slider.tap({
    position: {
      x: Math.max(1, box.width - 2),
      y: Math.max(1, box.height / 2),
    },
  });
  await expect(page.getByLabel(new RegExp(`^${label}，.*当前值 1\\.00，`)).first()).toBeVisible({
    timeout: 5_000,
  });
}


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

    // 只对本机隔离后端注入测试 IP，避免把 X-Forwarded-For 泄露给
    // MediaPipe CDN / Google 模型请求并触发 CORS 预检失败。
    const forwardedFor = `10.88.0.${test.info().workerIndex * 20 + test.info().retry * 5 + test.info().title.length % 19 + 1}`;
    await page.context().route('http://127.0.0.1:3001/**', async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'x-forwarded-for': forwardedFor,
        },
      });
    });
    page.setDefaultTimeout(20_000);
  });

  test('登录、低摩擦记录与镜像解释均可操作', async ({ page }) => {
    test.setTimeout(240_000);
    await loginDemo(page);
    await page.waitForFunction(() => {
      const root = window as typeof window & {
        __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
      };
      return Object.values(root.__avatarRuntimeProbes ?? {})
        .some((probe) => Boolean(probe.geometry.headWorldScale));
    }, undefined, { timeout: 120_000 });
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 5_000 });
    await screenshot(page, '01-mirror-home');

    const recordInput = page.getByPlaceholder('说点什么…');
    await expect(recordInput).toBeVisible();
    await recordInput.fill('昨晚熬夜，只睡了 4.5 小时，今天压力很大');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.getByText(/已收进今天/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '展开今天的记录' }).click();
    await expect(
      page.getByLabel(/今天记录，文字，\d{2}:\d{2}，昨晚熬夜，只睡了 4\.5 小时，今天压力很大/),
    ).toBeVisible({ timeout: 10_000 });
    await screenshot(page, '01b-today-records');
    await page.getByRole('button', { name: '收起今天的记录' }).click();

    await page.getByRole('button', { name: '现在的我' }).click();
    await expect(page.getByText('镜像', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/近期恢复信号偏低/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '查看镜像为什么这样显示' }).click();
    await expect(page.getByText(/眼下疲劳会在数据变旧后衰减/)).toBeVisible();
    await expect(page.getByText(/不作心理诊断/)).toBeVisible();
    await page.getByRole('button', { name: '关闭显示解释' }).click();
    await expect(page.getByRole('button', { name: '关闭显示解释' })).toHaveCount(0, { timeout: 5_000 });
    await screenshot(page, '02-mirror');
    await page.getByRole('button', { name: '返回主页' }).click();
    await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible();
  });

  test('真实照片文件经 Web picker + MediaPipe 生成草稿并明确确认进入 Timeline', async ({ page }) => {
    test.setTimeout(240_000);
    let fixturePath: string | null = null;
    const backendRequestBodies: string[] = [];
    const mediaPipeExternalRequests: { url: string; forwardedFor?: string }[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('http://127.0.0.1:3001/')) {
        const body = request.postData();
        if (body) backendRequestBodies.push(body);
        return;
      }
      if (
        url.includes('cdn.jsdelivr.net/npm/@mediapipe/tasks-vision')
        || url.includes('storage.googleapis.com/mediapipe-models/')
      ) {
        mediaPipeExternalRequests.push({
          url,
          forwardedFor: request.headers()['x-forwarded-for'],
        });
      }
    });

    try {
      fixturePath = await materializeMediaPipePortraitFixture();
      await loginDemo(page);
      await page.getByRole('button', { name: '现在的我' }).click();
      await expect(page.getByText('镜像', { exact: true }).first()).toBeVisible();

      await page.getByRole('button', { name: '调整形象与状态，打开三维镜像编辑器' }).click();
      await expect(page.getByText('我的三维镜像', { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('tab', { name: /切换到捏脸标签/ }).click();

      await page.waitForFunction(() => {
        const root = window as typeof window & {
          __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
        };
        const probe = Object.values(root.__avatarRuntimeProbes ?? {})
          .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
        return Boolean(probe?.geometry.headWorldScale && probe?.geometry.shoulderWorldDistance);
      }, undefined, { timeout: 120_000 });

      const baselineProbe = await readEditorAvatarRuntimeProbe(page);
      const photoFitButton = page.getByRole('button', { name: '从照片生成脸与体格参数' });
      await photoFitButton.scrollIntoViewIfNeeded();
      await expect(page.getByText(/照片像素仅在本机\/浏览器会话中分析，不作为输入数据上传/)).toBeVisible();
      await expect(page.getByText(/不保存图片路径或原始像素/)).toBeVisible();

      const privacyDetails = page.getByRole('button', { name: '展开照片拟合技术与缓存说明' });
      await expect(privacyDetails).toBeVisible();
      await privacyDetails.click();
      await expect(page.getByText(/Android APK 使用随包内置的 ML Kit/)).toBeVisible();
      await expect(page.getByText(/MediaPipe 官方说明不会发送输入图像数据/)).toBeVisible();
      await expect(page.getByText(/Tasks API 会向 Google 发送性能与使用指标/)).toBeVisible();
      await page.getByRole('button', { name: '收起照片拟合技术与缓存说明' }).click();
      await screenshot(page, '02a-photo-fit-privacy');

      let fileChooserEvents = 0;
      page.on('filechooser', () => {
        fileChooserEvents += 1;
      });

      // 第一次点击只能展示知情同意，不能偷偷打开相册或开始检测。
      await photoFitButton.click();
      const consentCard = page.getByLabel('MediaPipe 指标处理知情同意');
      await expect(consentCard).toBeVisible();
      await expect(page.getByText(/照片输入只在设备端用于 MediaPipe 检测，不发送给 Google/)).toBeVisible();
      await expect(page.getByText(/MediaPipe Tasks 会向 Google 发送 API 性能与使用指标/)).toBeVisible();
      expect(fileChooserEvents).toBe(0);
      await screenshot(page, '02a-photo-fit-consent');

      // 明确拒绝后仍不触发文件选择器；重新发起后，只有“同意并继续”
      // 才允许进入真实 Web file chooser。
      await page.getByRole('button', { name: '暂不使用照片拟合' }).click();
      await expect(consentCard).toHaveCount(0);
      expect(fileChooserEvents).toBe(0);

      await photoFitButton.click();
      await expect(consentCard).toBeVisible();
      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: '同意 MediaPipe 指标处理并选择照片' }).click();
      const chooser = await chooserPromise;
      await chooser.setFiles(fixturePath);

      await expect(page.getByText(/已根据照片调整脸型/)).toBeVisible({ timeout: 120_000 });
      const draftCard = page.getByLabel(/照片拟合草稿，仅本地分析，待确认，来源凭据 photo:local:/);
      await expect(draftCard).toBeVisible();
      await expect(page.getByText(/已映射并渲染 ≠ 身份匹配、人体测量精度或本人相似度已验证/)).toBeVisible();
      await page.getByRole('button', { name: '展开照片拟合来源与隐私详情' }).click();
      await expect(page.getByText(/正式版本只会保存确认后的参数与该不透明来源凭据/)).toBeVisible();
      await page.getByRole('button', { name: '收起照片拟合来源与隐私详情' }).click();
      await expect(page.getByText(/正式版本只会保存确认后的参数与该不透明来源凭据/)).toHaveCount(0);

      const draftLabel = await draftCard.getAttribute('aria-label');
      const receipt = draftLabel?.match(/(photo:local:[a-z0-9_-]+)/i)?.[1];
      expect(receipt, 'photo fitting should expose an opaque local receipt').toBeTruthy();

      await page.waitForFunction(({ faceWidth, faceHeight }) => {
        const root = window as typeof window & {
          __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
        };
        const probe = Object.values(root.__avatarRuntimeProbes ?? {})
          .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
        return Boolean(
          probe
          && (
            Math.abs(probe.identity.faceWidth - faceWidth) > 0.01
            || Math.abs(probe.identity.faceHeight - faceHeight) > 0.01
          ),
        );
      }, {
        faceWidth: baselineProbe.identity.faceWidth,
        faceHeight: baselineProbe.identity.faceHeight,
      }, { timeout: 30_000 });

      const fittedProbe = await readEditorAvatarRuntimeProbe(page);
      const identityDelta = Math.max(
        Math.abs(fittedProbe.identity.faceWidth - baselineProbe.identity.faceWidth),
        Math.abs(fittedProbe.identity.faceHeight - baselineProbe.identity.faceHeight),
      );
      const headGeometryDelta = Math.max(
        Math.abs(fittedProbe.geometry.headWorldScale!.x - baselineProbe.geometry.headWorldScale!.x),
        Math.abs(fittedProbe.geometry.headWorldScale!.y - baselineProbe.geometry.headWorldScale!.y),
      );
      expect(identityDelta).toBeGreaterThan(0.01);
      expect(headGeometryDelta).toBeGreaterThan(0.002);

      for (const body of backendRequestBodies) {
        expect(body).not.toContain(MEDIAPIPE_PORTRAIT_FIXTURE.fileName);
        expect(body).not.toContain('blob:');
        expect(body).not.toContain('data:image');
        expect(body).not.toContain('file://');
      }
      expect(
        backendRequestBodies.some((body) =>
          body.includes('mediapipe_tasks_web')
          && body.includes('"informed_consent":true')
          && body.includes('"input_data_upload":false')
          && body.includes('"metrics_provider":"google"')
        ),
        'MediaPipe metrics consent should be registered before fitting',
      ).toBeTruthy();

      expect(
        mediaPipeExternalRequests
          .filter((request) => request.url.includes('cdn.jsdelivr.net/npm/@mediapipe/tasks-vision'))
          .every((request) => /\/wasm\//.test(request.url)),
        'MediaPipe JS must stay in the app build; only the pinned WASM runtime may come from jsDelivr',
      ).toBeTruthy();

      expect(
        mediaPipeExternalRequests.some((request) => /\/wasm\//.test(request.url)),
        'real MediaPipe Web fitting should request its pinned WASM runtime',
      ).toBeTruthy();
      expect(
        mediaPipeExternalRequests.some((request) => request.url.includes('/face_landmarker/')),
        'real MediaPipe Web fitting should request the face-landmarker model',
      ).toBeTruthy();
      for (const request of mediaPipeExternalRequests) {
        expect(request.forwardedFor, `synthetic backend IP leaked to external request: ${request.url}`).toBeUndefined();
      }

      console.log('[photo-file-runtime-proof]', JSON.stringify({
        fixtureSha256: MEDIAPIPE_PORTRAIT_FIXTURE.sha256,
        baselineFaceWidth: baselineProbe.identity.faceWidth,
        fittedFaceWidth: fittedProbe.identity.faceWidth,
        baselineFaceHeight: baselineProbe.identity.faceHeight,
        fittedFaceHeight: fittedProbe.identity.faceHeight,
        baselineHeadScale: baselineProbe.geometry.headWorldScale,
        fittedHeadScale: fittedProbe.geometry.headWorldScale,
        receipt,
      }));
      await screenshot(page, '02a-photo-fit-applied');

      await page.getByRole('button', { name: '保存到我的数字孪生' }).click();
      await expect(page.getByText(/已确认并保存/)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/不代表系统已验证身份匹配、人体测量精度或本人相似度/)).toBeVisible();
      await screenshot(page, '02a-photo-fit-confirmed');
      await page.getByRole('button', { name: '关闭' }).click();

      await page.getByRole('button', { name: '查看时间中的自己' }).click();
      await expect(page.getByText('确认我的三维形象', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/来源：照片辅助 \+ 用户明确确认/)).toBeVisible();
      await expect(page.getByText(new RegExp(`凭据 ${receipt}`)).first()).toBeVisible();
      await expect(page.getByText(/不保存图片路径或原始像素/)).toBeVisible();
      await expect(page.getByText(/用户确认表示接受该版本，不等于系统证明照片中的身份匹配、人体测量精度或本人相似度正确/)).toBeVisible();
      await screenshot(page, '02a-photo-fit-timeline');
      await page.getByRole('button', { name: '关闭时间中的自己' }).click();
    } finally {
      clearMediaPipePortraitFixture(fixturePath);
    }
  });

  test('正式 VRM 个性化参数真实改变渲染并经确认进入 Timeline', async ({ page }) => {
    test.setTimeout(240_000);
    await loginDemo(page);
    await page.getByRole('button', { name: '现在的我' }).click();
    await expect(page.getByText('镜像', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: '调整形象与状态，打开三维镜像编辑器' }).click();
    await expect(page.getByText('我的三维镜像', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: /切换到捏脸标签/ }).click();

    // 先证明编辑器自己的正式 VRM renderer 已经进入稳定帧，再截首屏；
    // 这张图用于审计 390×844 下 3D 是否仍然是编辑器的视觉核心。
    await page.waitForFunction(() => {
      const root = window as typeof window & {
        __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
      };
      const probe = Object.values(root.__avatarRuntimeProbes ?? {})
        .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
      return Boolean(probe?.geometry.headWorldScale && probe?.geometry.shoulderWorldDistance);
    }, undefined, { timeout: 120_000 });
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 5_000 });
    await screenshot(page, '02a-editor-top');

    await expect(page.getByText(/当前页面直接预览正式 V2 VRM/)).toBeVisible();
    await expect(page.getByText('预览生效', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/更多精细参数 · 当前仅保存/)).toBeVisible();
    await expect(page.getByText(/肩宽走肩骨\/上臂根节点/)).toBeVisible();

    const baselineProbe = await readEditorAvatarRuntimeProbe(page);

    await setIdentitySliderToEnd(page, '脸宽');
    await page.waitForFunction((baselineHeadX) => {
      const root = window as typeof window & {
        __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
      };
      const probe = Object.values(root.__avatarRuntimeProbes ?? {})
        .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
      return Boolean(
        probe
        && probe.identity.faceWidth > 0.98
        && probe.geometry.headWorldScale
        && probe.geometry.headWorldScale.x > baselineHeadX + 0.02,
      );
    }, baselineProbe.geometry.headWorldScale!.x, { timeout: 15_000 });
    const faceProbe = await readEditorAvatarRuntimeProbe(page);
    const faceWidthRatio = faceProbe.geometry.headWorldScale!.x / baselineProbe.geometry.headWorldScale!.x;
    expect(faceWidthRatio).toBeGreaterThan(1.045);
    expect(faceWidthRatio).toBeLessThan(1.075);
    await screenshot(page, '02a-avatar-face-width-runtime');

    await setIdentitySliderToEnd(page, '身体比例');
    await page.waitForFunction(({ previousGroupX, expectedHeadX }) => {
      const root = window as typeof window & {
        __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
      };
      const probe = Object.values(root.__avatarRuntimeProbes ?? {})
        .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
      return Boolean(
        probe
        && probe.identity.bodyScale > 0.98
        && probe.geometry.groupScale.x > previousGroupX + 0.015
        && probe.geometry.headWorldScale
        && Math.abs(probe.geometry.headWorldScale.x - expectedHeadX) < 0.004,
      );
    }, {
      previousGroupX: faceProbe.geometry.groupScale.x,
      expectedHeadX: faceProbe.geometry.headWorldScale!.x,
    }, { timeout: 15_000 });
    const bodyProbe = await readEditorAvatarRuntimeProbe(page);

    await setIdentitySliderToEnd(page, '肩宽');
    await page.waitForFunction((previousShoulderDistance) => {
      const root = window as typeof window & {
        __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
      };
      const probe = Object.values(root.__avatarRuntimeProbes ?? {})
        .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
      return Boolean(
        probe
        && probe.identity.shoulderWidth > 0.98
        && probe.geometry.shoulderWorldDistance
        && probe.geometry.shoulderWorldDistance > previousShoulderDistance * 1.02,
      );
    }, bodyProbe.geometry.shoulderWorldDistance!, { timeout: 15_000 });
    const shoulderProbe = await readEditorAvatarRuntimeProbe(page);

    // 当前模型的 eyeSize 是 stored-only：默认折叠以降低界面噪声，
    // 用户显式展开后仍可保存，但不能偷偷改变已验证的结构几何通道。
    await page.getByRole('button', { name: '展开当前仅保存参数' }).click();
    await expect(page.getByRole('button', { name: '收起当前仅保存参数' })).toBeVisible();
    await setIdentitySliderToEnd(page, '眼睛大小');
    await page.waitForFunction(() => {
      const root = window as typeof window & {
        __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
      };
      const probe = Object.values(root.__avatarRuntimeProbes ?? {})
        .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
      return Boolean(probe && probe.identity.eyeSize > 0.98);
    }, undefined, { timeout: 10_000 });
    const storedOnlyProbe = await readEditorAvatarRuntimeProbe(page);
    expect(Math.abs(storedOnlyProbe.geometry.headWorldScale!.x - shoulderProbe.geometry.headWorldScale!.x)).toBeLessThan(0.004);
    expect(Math.abs(storedOnlyProbe.geometry.groupScale.x - shoulderProbe.geometry.groupScale.x)).toBeLessThan(0.004);
    expect(Math.abs(storedOnlyProbe.geometry.shoulderWorldDistance! - shoulderProbe.geometry.shoulderWorldDistance!)).toBeLessThan(0.004);

    const outfitBefore = storedOnlyProbe.appearance.outfit;
    await page.getByRole('button', { name: /服装色青碧/ }).click();
    await page.waitForFunction((previousOutfit) => {
      const root = window as typeof window & {
        __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe>;
      };
      const probe = Object.values(root.__avatarRuntimeProbes ?? {})
        .find((candidate) => candidate.evidenceTypes.includes('editor_preview'));
      return Boolean(probe?.appearance.outfit && probe.appearance.outfit !== previousOutfit);
    }, outfitBefore, { timeout: 10_000 });
    const personalizedProbe = await readEditorAvatarRuntimeProbe(page);
    console.log('[avatar-runtime-proof]', JSON.stringify({
      baselineHeadX: baselineProbe.geometry.headWorldScale!.x,
      faceHeadX: faceProbe.geometry.headWorldScale!.x,
      faceWidthRatio,
      bodyGroupX: bodyProbe.geometry.groupScale.x,
      bodyHeadX: bodyProbe.geometry.headWorldScale!.x,
      shoulderBefore: bodyProbe.geometry.shoulderWorldDistance,
      shoulderAfter: shoulderProbe.geometry.shoulderWorldDistance,
      storedOnlyHeadX: storedOnlyProbe.geometry.headWorldScale!.x,
      storedOnlyGroupX: storedOnlyProbe.geometry.groupScale.x,
      storedOnlyShoulderDistance: storedOnlyProbe.geometry.shoulderWorldDistance,
      shoulderRootNames: personalizedProbe.geometry.shoulderRootNames,
      outfitBefore,
      outfitAfter: personalizedProbe.appearance.outfit,
    }));
    await screenshot(page, '02b-avatar-runtime-personalized');

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
  });

  test('进程、秘书、数据主权与连接数据主路径均可操作', async ({ page }) => {
    test.setTimeout(240_000);
    await loginDemo(page);

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
