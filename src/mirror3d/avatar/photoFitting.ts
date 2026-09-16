/**
 * 照片捏脸 + 体格拟合：从用户照片提取归一化特征，映射到 AvatarIdentity。
 *
 * ─── 隐私承诺（SubTask 16.5）─────────────────────────────────────────
 *   - Web：图片在浏览器内解码后送入 MediaPipe Tasks；只有用户明确同意并开始
 *     照片拟合时才加载相关 JS/WASM/模型。Web 路径不属于 Android 严格本地承诺。
 *   - Android/iOS strict-local：自动照片拟合当前关闭。旧的 Android ML Kit
 *     实现已移除，因为 SDK 诊断/使用遥测与“除显式 LLM API 外不出网”边界冲突。
 *     用户仍可手动调整三维形象；待引入经过独立审计的无遥测离线检测器后再恢复。
 * 所有比例计算与人类学参考区间在 `fittingMath.ts` 中可审计。
 * ────────────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import {
  detectNativeFaceLandmarks,
  detectNativePoseLandmarks,
  hasNativePhotoFitting,
} from '../../../modules/zhixing-vision';
import type { AvatarIdentity } from '../types/avatar';
import {
  aggregateMultiViewMetrics,
  computeBodyMetricsFromPose,
  computeMetricsFromLandmarks,
  type FaceFittingResult,
  type Landmark,
  type NormalizedBodyMetrics,
  type NormalizedFaceMetrics,
  type ViewKind,
} from './fittingMath';

// 纯函数与常量从 fittingMath 再导出，保持既有 import 路径兼容
export {
  aggregateMultiViewMetrics,
  computeBodyMetricsFromPose,
  computeMetricsFromLandmarks,
  fitIdentityFromBodyMetrics,
  fitIdentityFromFaceMetrics,
  type FaceFittingResult,
  type Landmark,
  type NormalizedBodyMetrics,
  type NormalizedFaceMetrics,
  type ViewKind,
} from './fittingMath';

// ─── Web 端：MediaPipe JS 随应用 bundle；WASM/模型固定版本外部加载 ───

const MEDIAPIPE_VERSION = '0.10.17';
const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

interface FaceLandmarkerLike {
  detect(image: HTMLImageElement | HTMLCanvasElement): {
    faceLandmarks: Landmark[][];
  };
  close?(): void;
}

interface PoseLandmarkerLike {
  detect(image: HTMLImageElement | HTMLCanvasElement): {
    landmarks: Landmark[][];
  };
  close?(): void;
}

interface TasksVisionExports {
  FaceLandmarker: {
    createFromOptions(
      wasmFileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string; delegate?: string };
        runningMode?: 'IMAGE' | 'VIDEO';
        numFaces?: number;
      },
    ): Promise<FaceLandmarkerLike>;
  };
  PoseLandmarker: {
    createFromOptions(
      wasmFileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string; delegate?: string };
        runningMode?: 'IMAGE' | 'VIDEO';
        numPoses?: number;
      },
    ): Promise<PoseLandmarkerLike>;
  };
  FilesetResolver: {
    forVisionTasks(basePath: string): Promise<unknown>;
  };
}

let bundledTasksVisionPromise: Promise<TasksVisionExports> | null = null;

async function loadBundledTasksVision(): Promise<TasksVisionExports> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    throw new Error('MediaPipe is only supported on web');
  }
  if (!bundledTasksVisionPromise) {
    bundledTasksVisionPromise = import('@mediapipe/tasks-vision')
      .then((vision) => ({
        FaceLandmarker: vision.FaceLandmarker,
        PoseLandmarker: vision.PoseLandmarker,
        FilesetResolver: vision.FilesetResolver,
      }) as unknown as TasksVisionExports)
      .catch((error) => {
        bundledTasksVisionPromise = null;
        throw error;
      });
  }
  return bundledTasksVisionPromise;
}

/**
 * GPU → CPU 回退创建：无头浏览器、远程桌面或部分驱动环境下
 * GPU delegate 会初始化失败，此时回退 CPU WASM 仍可完整运行。
 */
async function createWithDelegateFallback<T>(
  create: (delegate: 'GPU' | 'CPU') => Promise<T>,
): Promise<T> {
  try {
    return await create('GPU');
  } catch (gpuError) {
    console.warn('[photoFitting] GPU delegate 初始化失败，回退 CPU：', gpuError);
    return create('CPU');
  }
}

let faceLandmarkerPromise: Promise<FaceLandmarkerLike> | null = null;
let poseLandmarkerPromise: Promise<PoseLandmarkerLike> | null = null;

async function getFaceLandmarker(): Promise<FaceLandmarkerLike> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const vision = await loadBundledTasksVision();
      const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`);
      return createWithDelegateFallback((delegate) =>
        vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL, delegate },
          runningMode: 'IMAGE',
          numFaces: 1,
        }),
      );
    })();
  }
  return faceLandmarkerPromise as Promise<FaceLandmarkerLike>;
}

async function getPoseLandmarker(): Promise<PoseLandmarkerLike> {
  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = (async () => {
      const vision = await loadBundledTasksVision();
      const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`);
      return createWithDelegateFallback((delegate) =>
        vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_LANDMARKER_MODEL, delegate },
          runningMode: 'IMAGE',
          numPoses: 1,
        }),
      );
    })();
  }
  return poseLandmarkerPromise as Promise<PoseLandmarkerLike>;
}

/**
 * 将图片 URI 解码为 HTMLImageElement。
 * 支持 data: URL、blob: URL、http(s): URL。
 */
function decodeImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = uri;
  });
}

// ─── 主入口 ─────────────────────────────────────────────────────────

/**
 * 从一张照片提取归一化面部特征。
 * 原生 strict-local 在无遥测离线检测器落地前直接返回 null。
 */
export async function extractFaceMetrics(
  imageUri: string,
): Promise<NormalizedFaceMetrics | null> {
  try {
    if (Platform.OS !== 'web') {
      if (!hasNativePhotoFitting()) return null;
      const result = await detectNativeFaceLandmarks(imageUri);
      if (!result || result.landmarks.length === 0) return null;
      const aspect = result.width > 0 && result.height > 0 ? result.width / result.height : 1;
      return computeMetricsFromLandmarks(result.landmarks, aspect);
    }
    const landmarker = await getFaceLandmarker();
    const img = await decodeImage(imageUri);
    const aspect = img.width > 0 && img.height > 0 ? img.width / img.height : 1;
    const result = landmarker.detect(img);
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
    return computeMetricsFromLandmarks(result.faceLandmarks[0], aspect);
  } catch (err) {
    console.warn('[photoFitting] extractFaceMetrics 失败:', err);
    return null;
  }
}

/**
 * 从一张照片提取归一化体格特征（肩宽/头身比/肩髋比）。
 * 原生 strict-local 在无遥测离线检测器落地前直接返回 null。
 */
export async function extractBodyMetrics(
  imageUri: string,
): Promise<NormalizedBodyMetrics | null> {
  try {
    if (Platform.OS !== 'web') {
      if (!hasNativePhotoFitting()) return null;
      const result = await detectNativePoseLandmarks(imageUri);
      if (!result || result.landmarks.length === 0) return null;
      const aspect = result.width > 0 && result.height > 0 ? result.width / result.height : 1;
      return computeBodyMetricsFromPose(result.landmarks, aspect);
    }
    const landmarker = await getPoseLandmarker();
    const img = await decodeImage(imageUri);
    const aspect = img.width > 0 && img.height > 0 ? img.width / img.height : 1;
    const result = landmarker.detect(img);
    if (!result.landmarks || result.landmarks.length === 0) return null;
    return computeBodyMetricsFromPose(result.landmarks[0], aspect);
  } catch (err) {
    console.warn('[photoFitting] extractBodyMetrics 失败:', err);
    return null;
  }
}

/**
 * 一键「图片转3D」入口：Web 可执行照片分析；strict-local native 当前
 * 返回空拟合结果，由编辑器保留手动调整路径。
 */
export async function extractPhotoFitting(imageUri: string): Promise<FaceFittingResult> {
  if (Platform.OS !== 'web' && !hasNativePhotoFitting()) {
    return { face: null, body: null };
  }
  const [face, body] = await Promise.all([
    extractFaceMetrics(imageUri),
    extractBodyMetrics(imageUri),
  ]);
  return { face, body };
}

// ─── 多视角采集辅助 ────────────────────────────────────────────────

/**
 * 多视角采集流程：依次提示用户拍摄 front / side / angle 三视角照片，
 * 每个视角拍照后立即提取 metrics，最后融合返回。
 */
export async function captureMultiViewMetrics(
  captureFn: (view: ViewKind) => Promise<string | null>,
): Promise<NormalizedFaceMetrics | null> {
  if (Platform.OS !== 'web' && !hasNativePhotoFitting()) return null;
  const views: ViewKind[] = ['front', 'side', 'angle'];
  const samples: { view: ViewKind; metrics: NormalizedFaceMetrics }[] = [];

  for (const view of views) {
    const uri = await captureFn(view);
    if (!uri) continue;
    const metrics = await extractFaceMetrics(uri);
    if (metrics) samples.push({ view, metrics });
  }

  if (samples.length === 0) return null;
  return aggregateMultiViewMetrics(samples);
}
