/**
 * 照片捏脸 + 体格拟合：从用户照片提取归一化特征，映射到 AvatarIdentity。
 *
 * ─── 隐私承诺（SubTask 16.5）─────────────────────────────────────────
 * 照片像素只在本设备/浏览器会话中处理，不作为 MediaPipe 输入数据上传。
 *   - Web：图片在浏览器内解码后送入随应用 bundle 发布的 MediaPipe
 *         FaceLandmarker / PoseLandmarker；WASM 与模型按固定版本从外部源下载。
 *         MediaPipe 官方说明不发送输入图像数据，但 Tasks API 可能发送
 *         性能/使用指标。
 *   - Android：通过本项目的本地 Expo Module 调用随 APK 打包的 ML Kit
 *              Face Detection 与 Pose Detection；首次使用无需下载模型，
 *              照片像素不离开设备。
 * 提取出的归一化 metrics 仅保留 0..1 数值，不包含原始像素或可识别身份
 * 的信息。所有比例计算与人类学参考区间在 `fittingMath.ts` 中可审计。
 * ────────────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  detectNativeFaceLandmarks,
  detectNativePoseLandmarks,
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

const MEDIAPIPE_VERSION = '0.10.35';
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

const BUNDLED_TASKS_VISION = {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} as unknown as TasksVisionExports;

function loadBundledTasksVision(): TasksVisionExports {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return BUNDLED_TASKS_VISION;
  }
  throw new Error('MediaPipe is only supported on web');
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
      const vision = loadBundledTasksVision();
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
      const vision = loadBundledTasksVision();
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
 * 失败（返回 null）：图中无人脸、图片不可读或端侧检测器明确报错。
 */
export async function extractFaceMetrics(
  imageUri: string,
): Promise<NormalizedFaceMetrics | null> {
  try {
    if (Platform.OS !== 'web') {
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
 * 半身照返回 shoulders=true 的部分结果；头部或双肩不可见返回 null。
 */
export async function extractBodyMetrics(
  imageUri: string,
): Promise<NormalizedBodyMetrics | null> {
  try {
    if (Platform.OS !== 'web') {
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
 * 一键「图片转3D」入口：同一张照片同时做人脸 + 体格分析。
 * 任一失败不影响另一项（脸照通常测不到脚踝，体格退化为肩宽参考）。
 */
export async function extractPhotoFitting(imageUri: string): Promise<FaceFittingResult> {
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
  const views: ViewKind[] = ['front', 'side', 'angle'];
  const samples: { view: ViewKind; metrics: NormalizedFaceMetrics }[] = [];

  for (const view of views) {
    const uri = await captureFn(view);
    if (!uri) continue; // 用户跳过该视角
    const metrics = await extractFaceMetrics(uri);
    if (metrics) samples.push({ view, metrics });
  }

  if (samples.length === 0) return null;
  return aggregateMultiViewMetrics(samples);
}
