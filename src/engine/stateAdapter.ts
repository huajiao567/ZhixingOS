/**
 * 后端「六位状态」原始结构 → App 端 StateSnapshot 适配器。
 *
 * 后端 /api/data/state 返回权威计算的 { inner, outer, divergence, changePositions }，
 * 本适配器在此基础上派生展示字段。
 *
 * P0-4：暂停「置信度百分比 / 原型编号 / 阶段结论」等未经验证的精确展示，
 * 改为每位置三级证据（insufficient / preliminary / consistent），
 * 由支撑该位置的可读事件数量确定性推导，绝不伪装成"理解用户"。
 */
import {
  SixPositions, StateSnapshot, LifeEvent, Commitment, Experiment,
  EvidenceLevel,
} from '../types/models';
import { POSITION_KEYS, POSITION_DEF, type PositionKey, type PositionDef } from '../domain/positions';

interface RawState {
  inner?: SixPositions;
  outer?: SixPositions;
  divergence?: number;
  changePositions?: string[];
  positions?: PositionDef[];
}

export interface StateContext {
  events: LifeEvent[];
  commitments: Commitment[];
  experiments: Experiment[];
}

const zeroPos = (): SixPositions => ({ L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 });

// 该事件触及哪些位置（与后端 position 语义一致）
function positionsTouchedBy(e: LifeEvent): PositionKey[] {
  const tags: string[] = e.domain ? [e.domain] : [];
  const has = (t: string) => tags.includes(t);
  const out: PositionKey[] = [];
  if (has('身体') || has('健康')) out.push('L1');
  if ((e.mood ?? 0) !== 0) out.push('L2');
  if (has('关系') || has('家庭') || has('价值') || has('意义')) out.push('L3');
  if (has('工作') || has('创造') || has('行动') || has('任务') || has('结果')) out.push('L4');
  if (has('关系') || has('家庭') || has('意义')) out.push('L5');
  if (has('工作') || has('创造')) out.push('L6');
  return out;
}

/** 由支撑事件数量推导证据三级：0→不足，1-2→初步，≥3→多源一致 */
function evidenceLevelFor(count: number): EvidenceLevel {
  if (count <= 0) return 'insufficient';
  if (count <= 2) return 'preliminary';
  return 'consistent';
}

export function toStateSnapshot(raw: RawState | null | undefined, ctx: StateContext): StateSnapshot {
  const inner = raw?.inner ?? zeroPos();
  const outer = raw?.outer ?? zeroPos();
  const divergence = typeof raw?.divergence === 'number' ? raw.divergence : 0;
  const changePositions: string[] = Array.isArray(raw?.changePositions) ? raw.changePositions : [];

  // 统计每个位置被多少条可读事件支撑
  const touched: Record<PositionKey, number> = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 };
  for (const e of ctx.events) {
    for (const k of positionsTouchedBy(e)) touched[k] += 1;
  }
  const evidenceLevels = POSITION_KEYS.reduce((acc, k) => {
    acc[k] = evidenceLevelFor(touched[k]);
    return acc;
  }, {} as Record<PositionKey, EvidenceLevel>);

  const note = changePositions.length
    ? `变化位置：${changePositions.join('；')}（提示：这只是摘要，不等同于对你的判断）`
    : '两条证据链暂无显著落差，可形成暂时洞察并设计可验证的行动。';

  return { inner, outer, divergence, changePositions, evidenceLevels, note };
}

export { POSITION_DEF };
