/**
 * Satori Avatar v2 — 每日自然更新引擎
 *
 * 原则：基础模型稳定，每天只生成可回退的小型 AvatarPatch。
 * 指数平滑：s_t = α·ŝ + (1−α)·s_{t−1}
 * 七道门：证据门 / 连续门 / 幅度门 / 过期门 / 回退门 / 冲突门 / 用户优先门
 *
 * 禁止：从单一数据武断推出情绪、人格或心理状态；
 * 禁止每日重新生成整个人物模型。
 */
import type {
  AvatarDailyStateV2,
  AvatarGrowthTraits,
  AvatarPatch,
  AvatarProfileV2,
  AvatarRuntimePose,
} from './avatarTypes';
import { NEUTRAL_DAILY_STATE, NEUTRAL_GROWTH_TRAITS } from './avatarTypes';

/* ───────────── 平滑系数（当日中低 / 长期极低 / 身份不更新） ───────────── */
export const SMOOTHING = {
  /** 每日状态更新（energy/tension/focus变化） */
  daily: 0.18,
  /** 行为气质慢变量（motionTempo/gazeDirectness等） */
  style: 0.05,
  /** 成长痕迹（最慢，一年尺度） */
  growth: 0.02,
} as const;

/** 幅度门：单补丁各通道最大日变化量 */
export const AMPLITUDE_LIMIT = {
  energy: 0.12,
  tension: 0.12,
  focus: 0.12,
  socialOpenness: 0.12,
} as const;

/** 证据门：置信度下限 */
export const CONFIDENCE_FLOOR = 0.35;

/** 连续门：外观候选成为建议所需的独立观察次数（appearance_candidate补丁类型使用） */
export const APPEARANCE_OBSERVATION_FLOOR = 3;

export interface GateDecision {
  accepted: boolean;
  reason: string;
  /** 幅度门是否截断了过大的变化 */
  clamped: boolean;
}

/* ───────────────────── 指数平滑 ───────────────────── */

export function smooth(prev: number, next: number, alpha: number): number {
  return alpha * next + (1 - alpha) * prev;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampDelta(key: keyof typeof AMPLITUDE_LIMIT, delta: number): { value: number; clamped: boolean } {
  const limit = AMPLITUDE_LIMIT[key];
  if (Math.abs(delta) <= limit) return { value: delta, clamped: false };
  return { value: Math.sign(delta) * limit, clamped: true };
}

/* ───────────────────── 七道门 ───────────────────── */

export function evaluatePatch(
  profile: AvatarProfileV2,
  patch: AvatarPatch,
  opts?: { conflictingSources?: boolean; appearanceObservationCount?: number },
): GateDecision {
  // 用户优先门：本日状态被用户纠正过，不再接受自动补丁
  if (patch.patchType === 'daily_state' && profile.dailyState.userOverridden) {
    return { accepted: false, reason: '用户已纠正本日状态，自动更新让位于用户', clamped: false };
  }
  // 冲突门：数据来源互相矛盾时不做明确表现
  if (opts?.conflictingSources) {
    return { accepted: false, reason: '数据冲突，保持中性', clamped: false };
  }
  // 连续门：外观候选需多次独立观察
  if (patch.patchType === 'appearance_candidate') {
    const obs = opts?.appearanceObservationCount ?? 0;
    if (obs < APPEARANCE_OBSERVATION_FLOOR) {
      return { accepted: false, reason: `观察次数不足（${obs}/${APPEARANCE_OBSERVATION_FLOOR}）`, clamped: false };
    }
  }
  // 证据门：置信度不足不更新
  if (patch.confidence < CONFIDENCE_FLOOR) {
    return { accepted: false, reason: `证据不足（confidence ${patch.confidence.toFixed(2)} < ${CONFIDENCE_FLOOR}）`, clamped: false };
  }
  if (patch.evidenceTypes.length === 0) {
    return { accepted: false, reason: '没有证据类型的补丁不被接受', clamped: false };
  }
  return { accepted: true, reason: '通过', clamped: false };
}

/* ──────────────── 应用每日补丁（平滑 + 幅度门） ──────────────── */

export function applyDailyPatch(profile: AvatarProfileV2, patch: AvatarPatch, nowIso: string): AvatarProfileV2 {
  const gate = evaluatePatch(profile, patch);
  if (!gate.accepted) return profile;

  const prev = profile.dailyState;
  const next: AvatarDailyStateV2 = { ...prev };
  const expiresAt = new Date(Date.parse(patch.createdAt) + patch.expiresInHours * 3600_000).toISOString();

  let wasClamped = false;
  (['energy', 'tension', 'focus', 'socialOpenness'] as const).forEach((k) => {
    const delta = patch.changes[k];
    if (typeof delta !== 'number') return;
    const { value, clamped } = clampDelta(k, delta);
    if (clamped) wasClamped = true;
    next[k] = clamp01(smooth(prev[k], prev[k] + value, SMOOTHING.daily));
  });

  next.expiresAt = expiresAt;
  next.evidenceTypes = patch.evidenceTypes;
  // 用户纠正标记在新补丁到来时清除（新证据覆盖）
  next.userOverridden = false;
  return { ...profile, dailyState: next };
}

/* ──────────────── 过期门：到期回归中性（平滑） ──────────────── */

export function applyExpiry(profile: AvatarProfileV2, nowIso: string): AvatarProfileV2 {
  const { dailyState } = profile;
  if (!dailyState.expiresAt || Date.parse(dailyState.expiresAt) > Date.parse(nowIso)) return profile;
  const next: AvatarDailyStateV2 = { ...dailyState };
  (['energy', 'tension', 'focus', 'socialOpenness'] as const).forEach((k) => {
    next[k] = smooth(dailyState[k], NEUTRAL_DAILY_STATE[k], SMOOTHING.daily);
  });
  // 足够接近中性后彻底清除过期标记
  const settled = (['energy', 'tension', 'focus', 'socialOpenness'] as const).every(
    (k) => Math.abs(next[k] - NEUTRAL_DAILY_STATE[k]) < 0.02,
  );
  if (settled) {
    next.expiresAt = null;
    next.evidenceTypes = [];
  }
  return { ...profile, dailyState: next };
}

/* ──────────────── 用户纠正（用户优先门） ──────────────── */

export function applyUserCorrection(profile: AvatarProfileV2, correction: Partial<AvatarDailyStateV2>): AvatarProfileV2 {
  return {
    ...profile,
    dailyState: {
      ...profile.dailyState,
      ...correction,
      userOverridden: true,
    },
  };
}

/** 新的一天开始时重置用户纠正标记 */
export function resetDailyOverride(profile: AvatarProfileV2): AvatarProfileV2 {
  if (!profile.dailyState.userOverridden) return profile;
  return { ...profile, dailyState: { ...profile.dailyState, userOverridden: false } };
}

/* ──────────────── 渲染映射：档案 → 运行时姿态 ──────────────── */

/**
 * 状态到姿态的细腻映射，严格遵循：
 * - 睡眠不足：动作略慢、姿态更安静，不表现失败
 * - 精力好：姿态略舒展，不兴奋跳跃
 * - 紧张：肩部微收、动作减少，不哭脸焦虑
 * - 深度工作：降低动作和注视，不主动打断
 * - 需要休息：偶尔自然伸展，不红色警告
 * - 项目进展：轻微舒展，不奖杯撒花
 * - 所有状态幅度极端克制，避免戏剧化
 */
export function deriveRuntimePose(profile: AvatarProfileV2): AvatarRuntimePose {
  const { dailyState: d, behaviorStyle: b } = profile;
  const adaptive = profile.permissions.lifeDataAdaptation && profile.adaptiveAppearance.enabled
    ? profile.adaptiveAppearance
    : null;
  const effectiveEnergy = clamp01(Math.min(d.energy, 0.56 - (adaptive?.recoveryNeed ?? 0) * 0.28));
  const effectiveTension = clamp01(Math.max(d.tension, 0.4 + (adaptive?.tension ?? 0) * 0.35));

  // ── 动作节奏（基础由行为气质决定，状态微调）──
  // energy 低 → 节奏放慢；focus 高 → 节奏放慢（深度工作）
  let tempo = clamp01(b.motionTempo * 0.6 + effectiveEnergy * 0.4);
  // 高专注（深度工作）：动作节奏压到接近下限
  if (d.focus > 0.75) {
    tempo = Math.max(0.15, tempo - (d.focus - 0.5) * 0.5);
  }
  // 高压力略放慢（不表现焦虑，只是更克制）
  if (effectiveTension > 0.65) {
    tempo = Math.max(0.2, tempo - (effectiveTension - 0.5) * 0.3);
  }
  const timeScale = 0.85 + tempo * 0.3;

  // ── 脊柱姿态（幅度严格控制在 ±0.05 rad ≈ ±3度）──
  // 精力好 → 略微挺直舒展；精力差 → 略微放松但不垂头
  let spineRelax = (effectiveEnergy - 0.5) * 0.06;
  // 高压力/紧张 → 肩部/脊柱轻微收紧（不是缩成一团）
  if (effectiveTension > 0.5) {
    spineRelax -= (effectiveTension - 0.5) * 0.04;
  }
  // 社交开放 → 略微打开姿态
  spineRelax += (d.socialOpenness - 0.5) * 0.02;

  // ── 视线活跃度（极克制，避免"东张西望"）──
  // 基础：社交开放度 × 行为直接度
  let gazeBase = clamp01(d.socialOpenness * 0.5 + b.gazeDirectness * 0.5);
  // 深度工作时视线几乎不动（专注）
  if (d.focus > 0.7) {
    gazeBase *= 0.35;
  }
  // 疲惫时视线活动减少
  if (effectiveEnergy < 0.35) {
    gazeBase *= 0.6;
  }
  const gazeAmplitude = gazeBase * 0.10;

  // ── 环境暖度（与情绪弱相关，保持中性为主）──
  let ambientWarmth = 0.48;
  // 精力好略暖
  ambientWarmth += (effectiveEnergy - 0.5) * 0.12;
  // 高压力略冷（但不冷冰）
  ambientWarmth -= Math.max(0, effectiveTension - 0.5) * 0.08;
  ambientWarmth = clamp01(ambientWarmth);

  return {
    timeScale: Math.min(1.12, Math.max(0.86, timeScale)),
    spineRelax: Math.min(0.05, Math.max(-0.05, spineRelax)),
    gazeAmplitude,
    ambientWarmth,
    idleClip: 'Idle',
    effectiveEnergy,
    effectiveTension,
    darkCircleOpacity: clamp01((adaptive?.darkCircles ?? 0) * 0.32),
    bodyScaleXZ: 1 + Math.min(0.06, Math.max(-0.04, adaptive?.bodyShapeDelta ?? 0)),
  };
}

/* ──────────────── 成长痕迹更新（极慢变量，每天最多+0.003） ──────────────── */

/**
 * 成长痕迹：长期行为模式在面部留下的微弱印记
 * 算法原则：
 * 1. 每天最多调用一次（跨天检测）
 * 2. 单日增量上限0.003（连续300+天达到满值，约一年）
 * 3. 只增不回退（成长不可逆）
 * 4. 基于当日状态相对于中性的正偏离累积
 * 5. 最终映射到BlendShape的幅度≤15%，极端克制避免"变脸"
 */
export function updateGrowthTraits(
  traits: AvatarGrowthTraits,
  dailyState: AvatarDailyStateV2,
  nowIso: string,
): { traits: AvatarGrowthTraits; changed: boolean } {
  const lastUpdate = new Date(traits.updatedAt);
  const now = new Date(nowIso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastDay = new Date(lastUpdate.getFullYear(), lastUpdate.getMonth(), lastUpdate.getDate());

  // 还没过一天，不更新
  if (today.getTime() <= lastDay.getTime()) {
    return { traits, changed: false };
  }

  const next: AvatarGrowthTraits = { ...traits, updatedAt: nowIso };
  const DAILY_INCREMENT_CAP = 0.003;
  const MAX_VALUE = 1.0;

  // 沉稳度(composure)：高专注 → 眼神坚定、眉头微收
  // 当日focus > 0.6 才开始累积，focus越高累积越多
  if (dailyState.focus > 0.6) {
    const gain = Math.min(DAILY_INCREMENT_CAP, (dailyState.focus - 0.5) * 0.006);
    next.composure = Math.min(MAX_VALUE, traits.composure + gain);
  }

  // 活力感(vibrancy)：高精力 + 低压力 → 眉眼舒展
  if (dailyState.energy > 0.55 && dailyState.tension < 0.5) {
    const gain = Math.min(DAILY_INCREMENT_CAP, (dailyState.energy - 0.5) * 0.005 - (dailyState.tension - 0.4) * 0.003);
    if (gain > 0) {
      next.vibrancy = Math.min(MAX_VALUE, traits.vibrancy + gain);
    }
  }

  // 亲和感(warmth)：高社交开放 + 低压力 → 眼神柔和
  if (dailyState.socialOpenness > 0.55) {
    const gain = Math.min(DAILY_INCREMENT_CAP, (dailyState.socialOpenness - 0.5) * 0.005);
    next.warmth = Math.min(MAX_VALUE, traits.warmth + gain);
  }

  // 从容度(ease)：长期低压力 → 眉间舒展
  if (dailyState.tension < 0.45) {
    const gain = Math.min(DAILY_INCREMENT_CAP, (0.5 - dailyState.tension) * 0.006);
    next.ease = Math.min(MAX_VALUE, traits.ease + gain);
  }

  return { traits: next, changed: true };
}

/**
 * 将成长痕迹映射到VRM BlendShape权重（幅度≤15%）
 * 这是成长算法的核心：长期行为如何微弱地改变面部表情基线
 * 使用VRM标准表情名称：happy/angry/sad/relaxed/surprised
 */
export function growthTraitsToBlendShapes(traits: AvatarGrowthTraits): Map<string, number> {
  const result = new Map<string, number>();
  // 最大幅度15%，确保变化极其微弱，需要数周才能察觉
  const MAX_BLEND = 0.15;

  // 沉稳度(composure)：长期高专注 → 中性偏严肃，嘴角略平，relaxed略减
  if (traits.composure > 0.01) {
    const c = traits.composure * MAX_BLEND * 0.5;
    // 专注时轻微的"严肃"感：减少happy，略微增加relaxed的反向
    result.set('happy', Math.max(0, (result.get('happy') ?? 0) - c * 0.3));
  }

  // 活力感(vibrancy)：高精力+低压力 → 眉眼舒展，轻微happy基线
  if (traits.vibrancy > 0.01) {
    const v = traits.vibrancy * MAX_BLEND * 0.6;
    result.set('happy', Math.min(MAX_BLEND, (result.get('happy') ?? 0) + v));
    result.set('relaxed', Math.min(MAX_BLEND, (result.get('relaxed') ?? 0) + v * 0.4));
  }

  // 亲和感(warmth)：高社交开放 → 眼神柔和，happy基线增加
  if (traits.warmth > 0.01) {
    const w = traits.warmth * MAX_BLEND * 0.5;
    result.set('happy', Math.min(MAX_BLEND, (result.get('happy') ?? 0) + w * 0.7));
  }

  // 从容度(ease)：长期低压力 → 眉间舒展，relaxed基线增加
  if (traits.ease > 0.01) {
    const e = traits.ease * MAX_BLEND * 0.6;
    result.set('relaxed', Math.min(MAX_BLEND, (result.get('relaxed') ?? 0) + e));
    // 从容抵消沉稳带来的严肃感
    result.set('happy', Math.min(MAX_BLEND, (result.get('happy') ?? 0) + e * 0.2));
  }

  return result;
}
