import type { LifeSignalObservation } from '../../../ai-native/connectors';
import { validateLifeSignal } from '../../../ai-native/connectors';
import type { AvatarAdaptiveAppearance } from './avatarTypes';
import { NEUTRAL_ADAPTIVE_APPEARANCE } from './avatarTypes';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function ageHours(observation: LifeSignalObservation, nowMs: number): number {
  return (nowMs - Date.parse(observation.occurredAt)) / HOUR;
}

function average(observations: LifeSignalObservation[]): number {
  if (observations.length === 0) return 0;
  const weighted = observations.reduce(
    (sum, item) => ({
      value: sum.value + item.value * item.confidence,
      weight: sum.weight + item.confidence,
    }),
    { value: 0, weight: 0 },
  );
  return weighted.weight > 0 ? weighted.value / weighted.weight : 0;
}

function distinctDays(observations: LifeSignalObservation[]): number {
  return new Set(observations.map((item) => item.occurredAt.slice(0, 10))).size;
}

function spanDays(observations: LifeSignalObservation[]): number {
  if (observations.length < 2) return 0;
  const times = observations.map((item) => Date.parse(item.occurredAt)).sort((a, b) => a - b);
  return (times[times.length - 1] - times[0]) / DAY;
}

export interface AdaptiveAppearanceOptions {
  enabled?: boolean;
  allowBodyTrend?: boolean;
  nowIso?: string;
}

/**
 * 只从已确认、置信度足够、时间有效的标准化信号推导渲染状态。
 * 该函数不保存原始内容，也不修改身份、性格或用户确认外观。
 */
export function deriveAdaptiveAppearance(
  observations: LifeSignalObservation[],
  options: AdaptiveAppearanceOptions = {},
): AvatarAdaptiveAppearance {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const enabled = options.enabled ?? true;
  if (!enabled || !Number.isFinite(nowMs)) {
    return { ...NEUTRAL_ADAPTIVE_APPEARANCE, enabled: false, derivedAt: nowIso };
  }

  const valid = observations.filter((item) =>
    item.status === 'confirmed'
    && item.confidence >= 0.5
    && validateLifeSignal(item, nowMs).accepted
    && ageHours(item, nowMs) >= 0
    && ageHours(item, nowMs) <= 35 * 24,
  );

  const sleep = valid.filter((item) => item.metric === 'sleep_duration_hours' && ageHours(item, nowMs) <= 72);
  const lateNight = valid.filter((item) => item.metric === 'late_night_minutes' && ageHours(item, nowMs) <= 72);
  const stress = valid.filter((item) => item.metric === 'stress_score' && ageHours(item, nowMs) <= 72);
  const meals = valid.filter((item) => item.metric === 'meal_load_score' && ageHours(item, nowMs) <= 12);

  const sleepDeficits = sleep.map((item) => ({
    ...item,
    value: Math.max(0, (item.baseline ?? 7.5) - item.value),
  }));
  const sleepDebt = average(sleepDeficits);
  const lateNightAverage = average(lateNight);
  const darkCircles = clamp((sleepDebt / 3) * 0.72 + (lateNightAverage / 180) * 0.28);
  const recoveryNeed = clamp((sleepDebt / 3.5) * 0.75 + (lateNightAverage / 240) * 0.25);
  const tension = clamp(average(stress));
  const postMealFullness = clamp(average(meals));

  let bodyShapeDelta = 0;
  let bodyEvidence: LifeSignalObservation[] = [];
  if (options.allowBodyTrend ?? true) {
    const weights = valid
      .filter((item) => item.metric === 'body_weight_kg')
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    if (weights.length >= 2 && spanDays(weights) >= 14) {
      const changeKg = weights[weights.length - 1].value - weights[0].value;
      bodyShapeDelta += clamp((changeKg / 5) * 0.045, -0.04, 0.06);
      bodyEvidence.push(weights[0], weights[weights.length - 1]);
    }

    const energy = valid.filter((item) => item.metric === 'energy_balance_kcal');
    if (distinctDays(energy) >= 10 && spanDays(energy) >= 13) {
      const balance = average(energy);
      if (balance > 150) bodyShapeDelta += clamp(((balance - 150) / 850) * 0.03, 0, 0.03);
      if (balance < -250) bodyShapeDelta -= clamp(((-balance - 250) / 1_000) * 0.02, 0, 0.02);
      bodyEvidence.push(...energy);
    }
    bodyShapeDelta = clamp(bodyShapeDelta, -0.04, 0.06);
  }

  const reasons: string[] = [];
  if (darkCircles > 0.08) reasons.push('近期睡眠或夜间使用摘要提示恢复不足，眼下疲劳会在数据变旧后衰减。');
  if (tension > 0.55) reasons.push('近期压力自述或设备摘要偏高，只表现为轻微紧绷，不作心理诊断。');
  if (postMealFullness > 0.55) reasons.push('已确认的餐后饱足仅产生短时状态，不会被当作长期体型变化。');
  if (Math.abs(bodyShapeDelta) > 0.005) reasons.push('跨至少两周的体重或能量平衡趋势触发了限幅体型微调，可随时关闭。');

  const used = [...sleep, ...lateNight, ...stress, ...meals, ...bodyEvidence];
  const confidence = used.length > 0
    ? clamp(used.reduce((sum, item) => sum + item.confidence, 0) / used.length)
    : 0;
  const expiresInHours = Math.abs(bodyShapeDelta) > 0.005 ? 14 * 24 : 72;

  return {
    enabled: true,
    darkCircles,
    recoveryNeed,
    tension,
    postMealFullness,
    bodyShapeDelta,
    confidence,
    reasons,
    evidenceRefs: [...new Set(used.map((item) => item.sourceRef))].slice(0, 24),
    derivedAt: nowIso,
    expiresAt: used.length > 0 ? new Date(nowMs + expiresInHours * HOUR).toISOString() : null,
    userOverridden: false,
  };
}

export function expireAdaptiveAppearance(
  appearance: AvatarAdaptiveAppearance,
  nowIso: string,
): AvatarAdaptiveAppearance {
  if (!appearance.expiresAt || Date.parse(appearance.expiresAt) > Date.parse(nowIso)) return appearance;
  return {
    ...NEUTRAL_ADAPTIVE_APPEARANCE,
    enabled: appearance.enabled,
    derivedAt: nowIso,
    userOverridden: appearance.userOverridden,
  };
}

