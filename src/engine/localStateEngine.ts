import type { Commitment, LifeEvent, SixPositions } from '../types/models';
import { POSITION_KEYS, labelOf } from '../domain/positions';

const zero = (): SixPositions => ({ L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 });
const clamp = (x: number) => Math.max(-1, Math.min(1, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

function moodAverage(events: LifeEvent[]): number {
  const moods = events.map((event) => event.mood ?? 0).filter((value) => value !== 0);
  return moods.length ? moods.reduce((sum, value) => sum + value, 0) / moods.length : 0;
}

function domainHit(events: LifeEvent[], domains: string[]): boolean {
  return events.some((event) => Boolean(event.domain && domains.includes(event.domain)));
}

function innerVector(events: LifeEvent[], commitments: Commitment[]): SixPositions {
  const recent = events.slice(0, 30);
  const mood = moodAverage(recent);
  const active = commitments.filter((item) => item.status === 'active').length;
  return {
    L1: clamp(mood + 0.1),
    L2: clamp(mood),
    L3: clamp(domainHit(recent, ['关系', '家庭', '价值', '意义']) ? 0.3 : 0),
    L4: clamp(active > 0 ? 0.3 : 0),
    L5: clamp(domainHit(recent, ['意义', '关系', '家庭']) ? 0.3 : 0),
    L6: 0.1,
  };
}

function outerVector(events: LifeEvent[], commitments: Commitment[]): SixPositions {
  const recent = events.slice(0, 30);
  const active = commitments.filter((item) => item.status === 'active').length;
  return {
    L1: domainHit(recent, ['身体', '健康']) ? 0.2 : 0,
    L2: recent.some((event) => (event.mood ?? 0) < 0) ? 0.3 : 0,
    L3: domainHit(recent, ['关系', '家庭']) ? 0.2 : 0,
    L4: clamp((domainHit(recent, ['工作', '创造', '行动', '任务', '结果']) ? 0.3 : 0) + (active > 0 ? 0.2 : 0)),
    L5: domainHit(recent, ['关系', '家庭', '意义']) ? 0.1 : 0,
    L6: domainHit(recent, ['工作', '创造']) ? 0.2 : 0,
  };
}

export function localDivergence(inner: SixPositions, outer: SixPositions): number {
  const a = POSITION_KEYS.map((key) => inner[key] ?? 0);
  const b = POSITION_KEYS.map((key) => outer[key] ?? 0);
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  if (na < 0.05 || nb < 0.05) return 0.05;
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const cosine = dot / (na * nb);
  return Math.max(0, Math.min(1, (1 - cosine) / 2));
}

export function deriveLocalState(events: LifeEvent[], commitments: Commitment[]) {
  const innerEvents = events.filter((event) => event.axis === 'inner');
  const outerEvents = events.filter((event) => event.axis === 'outer');
  const inner = innerEvents.length ? innerVector(innerEvents, commitments) : zero();
  const outer = outerEvents.length ? outerVector(outerEvents, commitments) : zero();
  const divergence = round2(localDivergence(inner, outer));
  const changePositions: string[] = [];
  for (const key of POSITION_KEYS) {
    if (Math.abs(inner[key] - outer[key]) > 0.3) {
      changePositions.push(`${key}（${labelOf(key)}：内 ${fmt(inner[key])} / 外 ${fmt(outer[key])}）`);
    }
  }
  if (divergence > 0.3 && changePositions.length === 0) changePositions.push('整体内外落差偏高');
  return { inner, outer, divergence, changePositions };
}
