import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFE_CONNECTOR_REGISTRY,
  validateLifeSignal,
  type LifeConnectorId,
  type LifeDataCategory,
  type LifeMetric,
  type LifeSignalObservation,
  type LifeSignalUnit,
} from '../src/ai-native/connectors';
import { extractSelfReportedLifeSignals } from '../src/ai-native/connectors/selfReportSignals';
import { deriveAdaptiveAppearance } from '../src/mirror3d/avatar/v2/adaptiveAppearance';
import { deriveRuntimePose } from '../src/mirror3d/avatar/v2/avatarPatchEngine';
import { createDefaultAvatarProfile } from '../src/mirror3d/avatar/v2/avatarTypes';

const NOW = '2026-08-26T12:00:00.000Z';

function observation(input: {
  id: string;
  metric: LifeMetric;
  value: number;
  unit: LifeSignalUnit;
  occurredAt?: string;
  category?: LifeDataCategory;
  connectorId?: LifeConnectorId;
  status?: LifeSignalObservation['status'];
  confidence?: number;
  baseline?: number;
}): LifeSignalObservation {
  const defaultCategory: Record<LifeMetric, LifeDataCategory> = {
    sleep_duration_hours: 'health', late_night_minutes: 'device_usage', steps: 'health',
    active_minutes: 'health', heart_rate_bpm: 'health', resting_heart_rate_bpm: 'health',
    stress_score: 'health', phone_screen_minutes: 'device_usage', desktop_active_minutes: 'desktop_usage',
    meal_load_score: 'nutrition', energy_balance_kcal: 'nutrition', body_weight_kg: 'health',
  };
  return {
    schemaVersion: 1,
    id: input.id,
    connectorId: input.connectorId ?? 'manual_entry',
    category: input.category ?? defaultCategory[input.metric],
    metric: input.metric,
    value: input.value,
    unit: input.unit,
    occurredAt: input.occurredAt ?? NOW,
    capturedAt: input.occurredAt ?? NOW,
    confidence: input.confidence ?? 0.9,
    status: input.status ?? 'confirmed',
    privacy: 'private_aggregate',
    sourceRef: `ref_${input.id}`,
    baseline: input.baseline,
  };
}

test('近期熬夜形成可衰减的眼下疲劳，但不改变长期体型', () => {
  const appearance = deriveAdaptiveAppearance([
    observation({ id: 'sleep', metric: 'sleep_duration_hours', value: 4.8, unit: 'hours', baseline: 7.5 }),
    observation({ id: 'late', metric: 'late_night_minutes', value: 150, unit: 'minutes' }),
  ], { nowIso: NOW });
  assert.ok(appearance.darkCircles > 0.5);
  assert.ok(appearance.recoveryNeed > 0.5);
  assert.equal(appearance.bodyShapeDelta, 0);
  assert.match(appearance.reasons.join(''), /恢复不足/);
});

test('单次饮食只产生餐后状态，未确认候选完全不生效', () => {
  const confirmed = deriveAdaptiveAppearance([
    observation({ id: 'meal', metric: 'meal_load_score', value: 0.9, unit: 'score_0_1' }),
  ], { nowIso: NOW });
  assert.equal(confirmed.bodyShapeDelta, 0);
  assert.ok(confirmed.postMealFullness > 0.8);

  const candidate = deriveAdaptiveAppearance([
    observation({ id: 'candidate', metric: 'meal_load_score', value: 0.95, unit: 'score_0_1', status: 'candidate' }),
  ], { nowIso: NOW });
  assert.equal(candidate.postMealFullness, 0);
  assert.equal(candidate.evidenceRefs.length, 0);
});

test('体型微调至少需要跨 14 天趋势且严格限幅', () => {
  const observations = [
    observation({ id: 'w0', metric: 'body_weight_kg', value: 70, unit: 'kg', occurredAt: '2026-08-05T08:00:00.000Z' }),
    observation({ id: 'w1', metric: 'body_weight_kg', value: 72.5, unit: 'kg', occurredAt: '2026-08-25T08:00:00.000Z' }),
  ];
  const appearance = deriveAdaptiveAppearance(observations, { nowIso: NOW });
  assert.ok(appearance.bodyShapeDelta > 0);
  assert.ok(appearance.bodyShapeDelta <= 0.06);
  assert.match(appearance.reasons.join(''), /跨至少两周/);
});

test('压力只映射为紧绷，不产生医学诊断语言', () => {
  const appearance = deriveAdaptiveAppearance([
    observation({ id: 'stress', metric: 'stress_score', value: 0.88, unit: 'score_0_1' }),
  ], { nowIso: NOW });
  assert.ok(appearance.tension > 0.8);
  assert.doesNotMatch(appearance.reasons.join(''), /焦虑症|抑郁症|诊断为/);

  const profile = createDefaultAvatarProfile(NOW);
  profile.adaptiveAppearance = appearance;
  const pose = deriveRuntimePose(profile);
  assert.ok(pose.effectiveTension > profile.dailyState.tension);
});

test('陈旧、低置信和未来信号不驱动外观；关闭后保持中性', () => {
  const ignored = deriveAdaptiveAppearance([
    observation({ id: 'old', metric: 'stress_score', value: 0.9, unit: 'score_0_1', occurredAt: '2026-06-01T00:00:00.000Z' }),
    observation({ id: 'weak', metric: 'stress_score', value: 0.9, unit: 'score_0_1', confidence: 0.2 }),
    observation({ id: 'future', metric: 'stress_score', value: 0.9, unit: 'score_0_1', occurredAt: '2026-08-27T00:00:00.000Z' }),
  ], { nowIso: NOW });
  assert.equal(ignored.tension, 0);
  assert.equal(deriveAdaptiveAppearance([], { nowIso: NOW, enabled: false }).enabled, false);
});

test('连接器注册表 ID 唯一且拒绝分类错配和原始引用', () => {
  const ids = LIFE_CONNECTOR_REGISTRY.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(LIFE_CONNECTOR_REGISTRY.some((item) => item.id === 'health_connect'));
  assert.ok(LIFE_CONNECTOR_REGISTRY.some((item) => item.id === 'activitywatch'));
  assert.ok(LIFE_CONNECTOR_REGISTRY.some((item) => item.id === 'food_camera'));

  const wrong = observation({ id: 'wrong', metric: 'stress_score', value: 0.8, unit: 'score_0_1', category: 'nutrition' });
  assert.equal(validateLifeSignal(wrong, Date.parse(NOW)).accepted, false);
  const oversizedRef = { ...wrong, category: 'health' as const, sourceRef: 'x'.repeat(241) };
  assert.equal(validateLifeSignal(oversizedRef, Date.parse(NOW)).accepted, false);
});

test('用户自述提取只保存结构化摘要与来源引用', () => {
  const signals = extractSelfReportedLifeSignals('昨晚熬夜，只睡了 4.5 小时，压力很大，还吃撑了。', 'event_1', NOW);
  assert.deepEqual(new Set(signals.map((item) => item.metric)), new Set([
    'sleep_duration_hours', 'late_night_minutes', 'stress_score', 'meal_load_score',
  ]));
  assert.ok(signals.every((item) => item.sourceRef === 'event_1' && item.status === 'confirmed'));
  assert.ok(signals.every((item) => !JSON.stringify(item).includes('昨晚')));
});

