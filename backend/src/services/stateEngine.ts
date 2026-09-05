// 六位状态引擎（后端权威版）。修复了 P0：JSD 在近二元分布下天然上限过低（~0.1），
// 与策划书 0.3「高分歧」阈值不匹配的问题。改用余弦距离 (1-cos)/2：
// 范围 [0,1]，种子数据落到 ~0.35（高分歧），与阈值语义一致。
//
// P0-3：内观(inner) 仅由 axis='inner' 的事件（主观体验/价值/解释）计算；
// 外观(outer) 仅由 axis='outer' 的事件（日历/任务/作品/健康/现实反馈）计算。
// 同一条记录不会被计入两侧，避免双重生成。
// 本引擎是「启发式状态摘要器」——它不宣称理解、预测或模拟用户。

import type { SixPositionState, EventRow, CommitmentRow } from '../types.js';
import { POSITION_DEF, POSITION_KEYS, labelOf } from '../domain/positions.js';

const DIMS = POSITION_KEYS;

function toVec(rec: Record<string, number>): number[] {
  return DIMS.map((k) => rec[k] ?? 0);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// (1-cos)/2：完全一致→0，完全相反→1
export function divergence(inner: Record<string, number>, outer: Record<string, number>): number {
  const a = toVec(inner), b = toVec(outer);
  const na = Math.hypot(...a), nb = Math.hypot(...b);
  // 数据稀疏时向量近零，余弦不稳定；此时分歧度无法可靠度量，返回低值
  if (na < 0.05 || nb < 0.05) return 0.05;
  const cos = cosine(a, b);
  const d = (1 - cos) / 2;
  return Math.max(0, Math.min(1, d));
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

// 该位置是否有任意事件命中给定标签 / 判定
function hit(evts: EventRow[], pred: (e: EventRow) => boolean): boolean {
  return evts.some(pred);
}
function tagHit(evts: EventRow[], tags: string[]): boolean {
  return evts.some((e) => (e.tags ?? []).some((t) => tags.includes(t)));
}
function moodAvg(evts: EventRow[]): number {
  const ms = evts.map((e) => e.mood ?? 0).filter((m) => m !== 0);
  return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
}

// 内观向量：仅主观体验
function buildInner(evts: EventRow[], commitments: CommitmentRow[]): Record<string, number> {
  const recent = evts.slice(0, 30);
  const m = moodAvg(recent);
  const activeC = commitments.filter((c) => c.status === 'active').length;
  return {
    L1: clamp(m + 0.1),
    L2: clamp(m),
    L3: clamp(tagHit(recent, ['关系', '家庭', '价值', '意义']) ? 0.3 : 0),
    L4: clamp(activeC > 0 ? 0.3 : 0),
    L5: clamp(tagHit(recent, ['意义', '关系', '家庭']) ? 0.3 : 0),
    L6: clamp(0.1),
  };
}

// 外观向量：仅客观行为/现实反馈
function buildOuter(evts: EventRow[], commitments: CommitmentRow[]): Record<string, number> {
  const recent = evts.slice(0, 30);
  const activeC = commitments.filter((c) => c.status === 'active').length;
  return {
    L1: clamp(tagHit(recent, ['身体', '健康']) ? 0.2 : 0),
    L2: clamp(recent.some((e) => (e.mood ?? 0) < 0) ? 0.3 : 0),
    L3: clamp(tagHit(recent, ['关系', '家庭']) ? 0.2 : 0),
    L4: clamp((tagHit(recent, ['工作', '创造', '行动', '任务', '结果']) ? 0.3 : 0) + (activeC > 0 ? 0.2 : 0)),
    L5: clamp(tagHit(recent, ['关系', '家庭', '意义']) ? 0.1 : 0),
    L6: clamp(tagHit(recent, ['工作', '创造']) ? 0.2 : 0),
  };
}

// 从近期事件 + 承诺推导六位状态
export function deriveState(events: EventRow[], commitments: CommitmentRow[]): SixPositionState {
  const innerEvents = events.filter((e) => e.axis === 'inner');
  const outerEvents = events.filter((e) => e.axis === 'outer');
  const inner = buildInner(innerEvents, commitments);
  const outer = buildOuter(outerEvents, commitments);

  const div = divergence(inner, outer);
  const changePositions = detectChangePositions(inner, outer, div);

  return {
    inner,
    outer,
    divergence: round2(div),
    changePositions,
    // 回传权威语义定义，保证界面与后端只有一套 L1–L6 含义
    positions: POSITION_DEF,
  };
}

export function detectChangePositions(
  inner: Record<string, number>,
  outer: Record<string, number>,
  div: number
): string[] {
  const out: string[] = [];
  for (const k of DIMS) {
    if (Math.abs(inner[k] - outer[k]) > 0.3) {
      out.push(`${k}（${labelOf(k)}：内 ${fmt(inner[k])} / 外 ${fmt(outer[k])}）`);
    }
  }
  if (div > 0.3 && out.length === 0) out.push('整体内外落差偏高');
  return out;
}
