import type { LifeSignalObservation, LifeMetric, LifeSignalUnit } from './types';

function idFor(metric: LifeMetric, nowMs: number, suffix: number): string {
  return `manual_${metric}_${nowMs}_${suffix}`;
}

export function extractSelfReportedLifeSignals(
  text: string,
  sourceRef: string,
  nowIso = new Date().toISOString(),
): LifeSignalObservation[] {
  const normalized = text.trim();
  if (!normalized || !sourceRef) return [];
  const observations: LifeSignalObservation[] = [];
  const nowMs = Date.parse(nowIso);

  const push = (metric: LifeMetric, value: number, unit: LifeSignalUnit, confidence: number, baseline?: number) => {
    observations.push({
      schemaVersion: 1,
      id: idFor(metric, nowMs, observations.length),
      connectorId: 'manual_entry',
      category: metric === 'meal_load_score'
        ? 'nutrition'
        : metric === 'late_night_minutes'
          ? 'device_usage'
          : 'health',
      metric,
      value,
      unit,
      occurredAt: nowIso,
      capturedAt: nowIso,
      confidence,
      status: 'confirmed',
      privacy: 'private_aggregate',
      sourceRef,
      baseline,
    });
  };

  const sleepMatch = normalized.match(/(?:睡(?:了)?|睡眠)\s*(\d+(?:\.\d+)?)\s*(?:个)?小时/);
  if (sleepMatch) push('sleep_duration_hours', Number(sleepMatch[1]), 'hours', 0.9, 7.5);
  if (/熬夜|通宵|睡得很晚|凌晨才睡|没睡好/.test(normalized)) {
    push('late_night_minutes', /通宵/.test(normalized) ? 360 : 120, 'minutes', 0.68);
  }
  if (/压力(?:很|太)?大|很紧张|特别紧张|焦虑|担心|喘不过气/.test(normalized)) {
    push('stress_score', /特别|太|喘不过气/.test(normalized) ? 0.86 : 0.72, 'score_0_1', 0.7);
  }
  if (/吃多了|吃撑了|很撑|暴食|夜宵吃多/.test(normalized)) {
    push('meal_load_score', /暴食|吃撑了/.test(normalized) ? 0.9 : 0.74, 'score_0_1', 0.72);
  }
  const weightMatch = normalized.match(/体重\s*(\d+(?:\.\d+)?)\s*(?:公斤|kg|千克)/i);
  if (weightMatch) push('body_weight_kg', Number(weightMatch[1]), 'kg', 0.95);

  return observations;
}
