/**
 * 照片→3D 拟合的纯数学层（无 react-native / DOM 依赖，可在 Node 与浏览器共享）。
 *
 * 设计原则：
 *   - 所有归一化参考区间显式写入常量，可审计（来源：Farkas L.G.
 *     《Anthropometry of the Head and Face》1994；MediaPipe 公开样本统计；
 *     NASA / ISO 7250 人体测量学成人统计）。
 *   - 纯函数：landmarks → metrics → AvatarIdentity patch。
 *   - 不做任何心理/人格推断，只做几何比例测量。
 */

import type { AvatarIdentity } from '../types/avatar';
import { clamp, inverseLerp, lerp } from './math';

// ─── 类型 ────────────────────────────────────────────────────────────

export interface NormalizedFaceMetrics {
  /** 脸宽：左右颧骨外侧点距离 / 头高。 */
  faceWidth: number;
  /** 脸长：发际线中点至下巴距离 / 图像高度。 */
  faceHeight: number;
  /** 双眼外眼角间距 / 脸宽。 */
  eyeDistance: number;
  /** 眼睛大小：眼裂高度 / 眼裂长度（开眼程度）。 */
  eyeSize: number;
  /** 鼻长：鼻根至鼻尖距离 / 脸长。 */
  noseLength: number;
  /** 嘴宽：左右嘴角距离 / 脸宽。 */
  mouthWidth: number;
  /** 下颌宽：左右下颌角距离 / 脸宽。 */
  jawWidth: number;
  /** 眉弓突出度：眉峰至眼眶上缘垂直距离 / 脸长。 */
  browProminence: number;
  /** 脸型圆度：脸宽 / 脸长（接近 1 = 圆脸，< 0.7 = 长脸）。 */
  faceRoundness: number;
}

/** 从全身/半身照提取的归一化体格特征。 */
export interface NormalizedBodyMetrics {
  /** 肩宽 / 头高（双肩峰距 ÷ 头高）。成人参考约 2.0–2.6。 */
  shoulderToHead: number;
  /** 头身比（身高 ÷ 头高）。成人参考约 6.3–7.9。 */
  headsTall: number;
  /** 肩宽 / 髋宽（肩髋比）。成人参考约 1.2–1.6。 */
  shoulderHipRatio: number;
  /** 各测量项是否来自完整可见的人体部位（false = 该值不可靠，应忽略）。 */
  completeness: {
    shoulders: boolean;
    hips: boolean;
    fullBody: boolean;
  };
}

export interface FaceFittingResult {
  face: NormalizedFaceMetrics | null;
  body: NormalizedBodyMetrics | null;
}

// ─── 参考范围（人类学测量，可审计）──────────────────────────────────

const FACE_METRIC_RANGES = {
  // MediaPipe 点位的可审计几何比例。旧实现把脸长除以整张照片高度，
  // 导致同一张脸因裁剪不同而变化，并在真实样本中把多数值压到 0/1。
  faceWidth: { min: 0.72, max: 0.98 }, // 颧宽 / 脸长
  faceHeight: { min: 1.02, max: 1.45 }, // 脸长 / 颧宽
  eyeDistance: { min: 0.54, max: 0.72 }, // 双眼外距 / 脸宽
  eyeSize: { min: 0.16, max: 0.43 }, // 眼裂高/长
  noseLength: { min: 0.20, max: 0.35 }, // 鼻根至鼻尖 / 脸长
  mouthWidth: { min: 0.32, max: 0.52 }, // 嘴宽 / 脸宽
  jawWidth: { min: 0.70, max: 0.88 }, // 下颌宽 / 脸宽
  browProminence: { min: 0.04, max: 0.18 }, // 眉眼距 / 脸长
  faceRoundness: { min: 0.72, max: 0.98 }, // 脸宽/脸长
} as const;

const BODY_METRIC_RANGES = {
  // Pose 的“耳中心距”不是解剖头宽，以下是针对该检测量的保守区间。
  shoulderToHead: { min: 0.9, max: 2.1 },
  headsTall: { min: 6.2, max: 9.2 },
  shoulderHipRatio: { min: 1.05, max: 1.85 },
} as const;

/** Pose 双耳点是耳中心而非头部外缘；用真实样本校准为头高 ≈ 耳中心距 × 1.7。 */
export const HEAD_HEIGHT_FROM_EAR_SPAN = 1.7;

// ─── 多视角融合权重 ─────────────────────────────────────────────────

const MULTI_VIEW_WEIGHTS = {
  front: 0.56,
  side: 0.22,
  angle: 0.22,
} as const;

export type ViewKind = keyof typeof MULTI_VIEW_WEIGHTS;

// ─── 映射：metrics → AvatarIdentity patch ───────────────────────────

export function fitIdentityFromFaceMetrics(
  metrics: NormalizedFaceMetrics,
): Partial<AvatarIdentity> {
  const jawRoundness = clamp(metrics.faceRoundness, 0, 1);
  const browAngle = clamp(lerp(0.32, 0.78, metrics.browProminence), 0, 1);
  const noseSize = clamp(metrics.noseLength, 0, 1);

  return {
    faceWidth: metrics.faceWidth,
    faceHeight: metrics.faceHeight,
    eyeSize: metrics.eyeSize,
    eyeSpacing: clamp(metrics.eyeDistance, 0, 1),
    noseSize,
    mouthWidth: metrics.mouthWidth,
    jawRoundness,
    browAngle,
  };
}

/**
 * 体格 metrics → AvatarIdentity patch。
 *
 * bodyScale 从头身比保守映射到 0.35–0.65：头身比只反映相对比例，
 * 不是真实身高（照片无绝对尺度），因此映射区间刻意收窄并偏向中性，
 * 避免单张照片的透视误差产生夸张体型。
 * shoulderWidth 从肩/头比归一化；髋部不可见时肩髋比不参与映射。
 */
export function fitIdentityFromBodyMetrics(
  metrics: NormalizedBodyMetrics,
): Partial<AvatarIdentity> {
  const bodyScale = clamp(lerp(0.35, 0.65, metrics.headsTall), 0, 1);
  const shoulderWidth = clamp(metrics.shoulderToHead, 0, 1);
  return { bodyScale, shoulderWidth };
}

// ─── 多视角融合 ─────────────────────────────────────────────────────

export function aggregateMultiViewMetrics(
  samples: { view: ViewKind; metrics: NormalizedFaceMetrics }[],
): NormalizedFaceMetrics | null {
  if (samples.length === 0) return null;

  const totalWeight = samples.reduce((sum, s) => sum + MULTI_VIEW_WEIGHTS[s.view], 0);
  if (totalWeight <= 1e-6) return null;

  const keys: (keyof NormalizedFaceMetrics)[] = [
    'faceWidth', 'faceHeight', 'eyeDistance', 'eyeSize', 'noseLength',
    'mouthWidth', 'jawWidth', 'browProminence', 'faceRoundness',
  ];

  const result = {} as NormalizedFaceMetrics;
  for (const k of keys) {
    let acc = 0;
    for (const s of samples) {
      acc += s.metrics[k] * MULTI_VIEW_WEIGHTS[s.view];
    }
    result[k] = clamp(acc / totalWeight, 0, 1);
  }
  return result;
}

// ─── Face Landmark 索引与 metrics 计算 ───────────────────────────────

export const FACE_LM = {
  foreheadTop: 10,
  chinBottom: 152,
  rightCheek: 234,
  leftCheek: 454,
  rightEyeOuter: 33,
  rightEyeInner: 133,
  rightEyeTop: 159,
  rightEyeBottom: 145,
  leftEyeOuter: 263,
  leftEyeInner: 362,
  leftEyeTop: 386,
  leftEyeBottom: 374,
  noseBridge: 168,
  noseTip: 1,
  mouthLeft: 61,
  mouthRight: 291,
  jawLeft: 172,
  jawRight: 397,
  browLeftTop: 105,
  browRightTop: 334,
} as const;

export type Landmark = { x: number; y: number; z: number; visibility?: number };

/**
 * MediaPipe 返回的坐标按轴各自归一化到 [0,1]：x 以图像宽为单位、y 以
 * 图像高为单位。非正方形图像上直接比较水平与垂直距离会产生系统性误差
 * （4:3 照片 x 方向真实距离是归一化值的 4/3 倍）。
 * 因此所有混合 x/y 的距离都先用 aspect = width / height 把 x 换算成
 * y 单位再比较。aspect 默认 1（正方形）保持旧行为。
 */
export function dist2D(a: Landmark, b: Landmark, aspect = 1): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 面部占图像高度的最小比例；小于该值的照片分辨率不足以稳定测量。 */
export const MIN_FACE_HEIGHT_RATIO = 0.12;
/** 头高（双耳距换算）占图像高度的最小比例。 */
export const MIN_HEAD_HEIGHT_RATIO = 0.05;

export function computeMetricsFromLandmarks(
  landmarks: Landmark[],
  aspect = 1,
): NormalizedFaceMetrics | null {
  const required = Object.values(FACE_LM);
  if (!Number.isFinite(aspect) || aspect <= 0 || required.some((i) => !validLandmark(landmarks[i]))) return null;
  const get = (i: number): Landmark => landmarks[i];

  const faceWidthRaw = dist2D(get(FACE_LM.rightCheek), get(FACE_LM.leftCheek), aspect);
  const faceHeightRaw = dist2D(get(FACE_LM.foreheadTop), get(FACE_LM.chinBottom), aspect);
  // 脸太小：透视与检测噪声被归一化放大，宁可放弃也不输出误导性参数
  if (faceHeightRaw < MIN_FACE_HEIGHT_RATIO) return null;
  const safeFaceWidth = faceWidthRaw || 1e-6;
  const safeFaceHeight = faceHeightRaw || 1e-6;

  const faceWidth = inverseLerp(
    FACE_METRIC_RANGES.faceWidth.min,
    FACE_METRIC_RANGES.faceWidth.max,
    faceWidthRaw / safeFaceHeight,
  );
  const faceHeight = inverseLerp(
    FACE_METRIC_RANGES.faceHeight.min,
    FACE_METRIC_RANGES.faceHeight.max,
    faceHeightRaw / safeFaceWidth,
  );

  const eyeDistanceRaw = dist2D(get(FACE_LM.rightEyeOuter), get(FACE_LM.leftEyeOuter), aspect);
  const eyeDistance = inverseLerp(
    FACE_METRIC_RANGES.eyeDistance.min,
    FACE_METRIC_RANGES.eyeDistance.max,
    eyeDistanceRaw / safeFaceWidth,
  );

  const rightEyeLen = dist2D(get(FACE_LM.rightEyeOuter), get(FACE_LM.rightEyeInner), aspect);
  const rightEyeHt = dist2D(get(FACE_LM.rightEyeTop), get(FACE_LM.rightEyeBottom), aspect);
  const leftEyeLen = dist2D(get(FACE_LM.leftEyeOuter), get(FACE_LM.leftEyeInner), aspect);
  const leftEyeHt = dist2D(get(FACE_LM.leftEyeTop), get(FACE_LM.leftEyeBottom), aspect);
  const eyeAspect = (rightEyeHt / (rightEyeLen || 1e-6) + leftEyeHt / (leftEyeLen || 1e-6)) / 2;
  const eyeSize = inverseLerp(
    FACE_METRIC_RANGES.eyeSize.min,
    FACE_METRIC_RANGES.eyeSize.max,
    eyeAspect,
  );

  const noseLengthRaw = dist2D(get(FACE_LM.noseBridge), get(FACE_LM.noseTip), aspect);
  const noseLength = inverseLerp(
    FACE_METRIC_RANGES.noseLength.min,
    FACE_METRIC_RANGES.noseLength.max,
    noseLengthRaw / safeFaceHeight,
  );

  const mouthWidthRaw = dist2D(get(FACE_LM.mouthLeft), get(FACE_LM.mouthRight), aspect);
  const mouthWidth = inverseLerp(
    FACE_METRIC_RANGES.mouthWidth.min,
    FACE_METRIC_RANGES.mouthWidth.max,
    mouthWidthRaw / safeFaceWidth,
  );

  const jawWidthRaw = dist2D(get(FACE_LM.jawLeft), get(FACE_LM.jawRight), aspect);
  const jawWidth = inverseLerp(
    FACE_METRIC_RANGES.jawWidth.min,
    FACE_METRIC_RANGES.jawWidth.max,
    jawWidthRaw / safeFaceWidth,
  );

  const browProminenceRaw = Math.abs(get(FACE_LM.browLeftTop).y - get(FACE_LM.leftEyeTop).y);
  const browProminence = inverseLerp(
    FACE_METRIC_RANGES.browProminence.min,
    FACE_METRIC_RANGES.browProminence.max,
    browProminenceRaw / safeFaceHeight,
  );

  const faceRoundness = inverseLerp(
    FACE_METRIC_RANGES.faceRoundness.min,
    FACE_METRIC_RANGES.faceRoundness.max,
    faceWidthRaw / safeFaceHeight,
  );

  return {
    faceWidth,
    faceHeight,
    eyeDistance,
    eyeSize,
    noseLength,
    mouthWidth,
    jawWidth,
    browProminence,
    faceRoundness,
  };
}

// ─── Pose Landmark 索引与体格 metrics 计算 ──────────────────────────

/** MediaPipe PoseLandmarker 33 点中的关键索引。 */
export const POSE_LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** 姿态点可见度阈值：低于该值认为部位被遮挡/出画。 */
export const POSE_VISIBILITY_THRESHOLD = 0.5;

function visible(lm: Landmark | undefined): lm is Landmark {
  return validLandmark(lm) && (lm.visibility === undefined || lm.visibility >= POSE_VISIBILITY_THRESHOLD);
}

function validLandmark(lm: Landmark | undefined): lm is Landmark {
  return Boolean(lm && Number.isFinite(lm.x) && Number.isFinite(lm.y) && Number.isFinite(lm.z));
}

/**
 * 从 PoseLandmarker 33 点计算体格 metrics。
 *
 * 头高估计：双耳距（头宽）× 1.3（Farkas 头高/头宽比）。
 * 身高估计：头顶（鼻上方约半个头高）至双踝中点，含踝下小量修正。
 * 所有输入为归一化图像坐标；透视/遮挡由 completeness 门控。
 */
export function computeBodyMetricsFromPose(
  landmarks: Landmark[],
  aspect = 1,
): NormalizedBodyMetrics | null {
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const get = (i: number): Landmark | undefined => landmarks[i];

  const leftEar = get(POSE_LM.leftEar);
  const rightEar = get(POSE_LM.rightEar);
  const leftShoulder = get(POSE_LM.leftShoulder);
  const rightShoulder = get(POSE_LM.rightShoulder);
  const leftHip = get(POSE_LM.leftHip);
  const rightHip = get(POSE_LM.rightHip);
  const leftAnkle = get(POSE_LM.leftAnkle);
  const rightAnkle = get(POSE_LM.rightAnkle);

  // 头部与双肩必须可见，否则无法给出任何体格估计
  if (!visible(leftEar) || !visible(rightEar) || !visible(leftShoulder) || !visible(rightShoulder)) {
    return null;
  }

  const earSpan = dist2D(leftEar, rightEar, aspect);
  const headHeight = earSpan * HEAD_HEIGHT_FROM_EAR_SPAN || 1e-6;
  // 头太小：透视与检测噪声被归一化放大，宁可放弃
  if (headHeight < MIN_HEAD_HEIGHT_RATIO) return null;
  const shoulderRaw = dist2D(leftShoulder, rightShoulder, aspect);

  const shouldersOk = true;
  const hipsOk = visible(leftHip) && visible(rightHip);
  const fullBodyOk = hipsOk && (visible(leftAnkle) || visible(rightAnkle));

  const shoulderToHead = inverseLerp(
    BODY_METRIC_RANGES.shoulderToHead.min,
    BODY_METRIC_RANGES.shoulderToHead.max,
    shoulderRaw / headHeight,
  );

  let shoulderHipRatio = 0.5; // 髋部不可见时保持中性
  if (hipsOk) {
    const hipRaw = dist2D(leftHip as Landmark, rightHip as Landmark, aspect);
    shoulderHipRatio = inverseLerp(
      BODY_METRIC_RANGES.shoulderHipRatio.min,
      BODY_METRIC_RANGES.shoulderHipRatio.max,
      shoulderRaw / (hipRaw || 1e-6),
    );
  }

  let headsTall = 0.5; // 半身照无法测头身比时保持中性
  if (fullBodyOk) {
    const nose = get(POSE_LM.nose);
    const ankleL = (visible(leftAnkle) ? leftAnkle : rightAnkle) as Landmark;
    const ankleR = (visible(rightAnkle) ? rightAnkle : leftAnkle) as Landmark;
    const ankleMidY = (ankleL.y + ankleR.y) / 2;
    if (nose) {
      // 头顶 ≈ 鼻尖上方半个头高；踝以下还有足高（约 0.15 头高，被忽略以保守）
      const headTopY = nose.y - headHeight * 0.5;
      const bodyHeight = Math.max(ankleMidY - headTopY, 1e-6);
      headsTall = inverseLerp(
        BODY_METRIC_RANGES.headsTall.min,
        BODY_METRIC_RANGES.headsTall.max,
        bodyHeight / headHeight,
      );
    }
  }

  return {
    shoulderToHead: clamp(shoulderToHead, 0, 1),
    headsTall: clamp(headsTall, 0, 1),
    shoulderHipRatio: clamp(shoulderHipRatio, 0, 1),
    completeness: { shoulders: shouldersOk, hips: hipsOk, fullBody: fullBodyOk },
  };
}
