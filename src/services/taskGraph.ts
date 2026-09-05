/**
 * 长期任务执行层（P1-14，最小可用）
 * ------------------------------------------------------------
 * 本模块把「承诺 / 项目」连成有向无环图（DAG），并提供：
 *   - 循环依赖检测（Kahn 拓扑排序）
 *   - 每个节点的可执行状态（就绪 / 受阻 / 已完成 / 需重规划）
 *   - 关键路径（最长依赖链，按节点数计）
 *   - 计划漂移（已过截止日未完成）与同日截止资源冲突告警
 *
 * 设计边界（诚实说明，避免过度主张）：
 *   - 这是「依赖分析器」，不是完整调度器。没有工作量估算 / 资源日历 / 自动重排。
 *   - 关键路径按依赖深度（节点数）计算，不含工期权重。
 *   - 是否行动、是否接受依赖、何时停止，全部由用户决定；系统只呈现事实。
 */

import { Commitment, Project } from '../types/models';

export type NodeState = 'ready' | 'blocked' | 'done' | 'broken';

/** 已稳定终结的状态（完成 / 主动取消 / 停止）都视为「不再阻塞后续」 */
const DONE = new Set(['fulfilled', 'cancelled', 'done', 'stopped']);
/** 被主动放弃的依赖（取消 / 停止）会使后续节点需要重规划 */
const DROPPED = new Set(['cancelled', 'stopped']);

export interface TaskNodeInput {
  id: string;
  kind: 'commitment' | 'project';
  label: string;
  status: string;
  deadline?: string;
  dependsOn: string[];
  acceptance?: string;
  stopCondition?: string;
}

export interface TaskNodeStatus {
  id: string;
  kind: 'commitment' | 'project';
  label: string;
  status: string;
  dependsOn: string[];
  /** 前置中仍未完成（active/paused）的 id —— 这些在阻塞当前节点 */
  blockers: string[];
  acceptance?: string;
  stopCondition?: string;
  state: NodeState;
  /** DAG 中最长链长度（含自身） */
  depth: number;
  deadline?: string;
}

export interface GraphWarning {
  kind: 'cycle' | 'drift' | 'conflict' | 'dangling';
  level: 'warn' | 'danger' | 'info';
  message: string;
  ids: string[];
}

export interface TaskGraphReport {
  nodes: TaskNodeStatus[];
  byId: Record<string, TaskNodeStatus>;
  hasCycle: boolean;
  cycleNodes: string[];
  /** 关键路径（最长链）的 id 序列，从根到叶 */
  criticalPath: string[];
  warnings: GraphWarning[];
  summary: { total: number; ready: number; blocked: number; done: number; broken: number };
}

export function collectNodes(commitments: Commitment[], projects: Project[]): TaskNodeInput[] {
  const nodes: TaskNodeInput[] = commitments.map((c) => ({
    id: c.id,
    kind: 'commitment',
    label: c.statement,
    status: c.status,
    deadline: c.deadline,
    dependsOn: c.dependsOn ?? [],
    acceptance: c.acceptance,
    stopCondition: c.stopCondition,
  }));
  for (const p of projects) {
    nodes.push({
      id: p.id,
      kind: 'project',
      label: p.name,
      status: p.status,
      deadline: undefined,
      dependsOn: p.dependsOn ?? [],
      acceptance: undefined,
      stopCondition: undefined,
    });
  }
  return nodes;
}

export function analyzeTaskGraph(commitments: Commitment[], projects: Project[]): TaskGraphReport {
  const inputs = collectNodes(commitments, projects);
  const map = new Map(inputs.map((n) => [n.id, n]));
  const ids = inputs.map((n) => n.id);
  const present = new Set(ids);

  // 1) 环检测（Kahn 拓扑排序）
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  ids.forEach((id) => {
    indeg.set(id, 0);
    adj.set(id, []);
  });
  for (const n of inputs) {
    for (const d of n.dependsOn) {
      if (!present.has(d)) continue;
      indeg.set(d, (indeg.get(d) ?? 0) + 1);
      adj.get(n.id)!.push(d);
    }
  }
  const topo: string[] = [];
  const q: string[] = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  while (q.length) {
    const id = q.shift()!;
    topo.push(id);
    for (const nxt of adj.get(id)!) {
      indeg.set(nxt, (indeg.get(nxt) ?? 0) - 1);
      if (indeg.get(nxt) === 0) q.push(nxt);
    }
  }
  const hasCycle = topo.length < ids.length;
  const topoSet = new Set(topo);
  const cycleNodes = ids.filter((id) => !topoSet.has(id));

  // 2) 深度（最长依赖链），仅对拓扑可达节点递归；含环节点已排除
  const depth = new Map<string, number>();
  const deepestDep = new Map<string, string | null>();
  const visiting = new Set<string>();
  const computeDepth = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) {
      depth.set(id, 1);
      return 1;
    }
    visiting.add(id);
    let best = 0;
    let bestDep: string | null = null;
    const node = map.get(id)!;
    for (const d of node.dependsOn) {
      if (!present.has(d) || cycleNodes.includes(d)) continue;
      const dd = computeDepth(d);
      if (dd > best) {
        best = dd;
        bestDep = d;
      }
    }
    visiting.delete(id);
    depth.set(id, best + 1);
    deepestDep.set(id, bestDep);
    return best + 1;
  };
  for (const id of topo) computeDepth(id);

  // 3) 节点可执行状态
  const nodes: TaskNodeStatus[] = inputs.map((n) => {
    let state: NodeState;
    const blockers: string[] = [];
    if (DONE.has(n.status)) {
      state = 'done';
    } else {
      let broken = false;
      for (const d of n.dependsOn) {
        const dep = map.get(d);
        if (!dep) continue; // dangling 单独告警
        if (DROPPED.has(dep.status)) {
          broken = true;
          break;
        }
        if (!DONE.has(dep.status)) blockers.push(d);
      }
      state = broken ? 'broken' : blockers.length === 0 ? 'ready' : 'blocked';
    }
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      status: n.status,
      dependsOn: n.dependsOn,
      blockers,
      acceptance: n.acceptance,
      stopCondition: n.stopCondition,
      state,
      depth: depth.get(n.id) ?? 1,
      deadline: n.deadline,
    };
  });
  const byId: Record<string, TaskNodeStatus> = {};
  nodes.forEach((n) => (byId[n.id] = n));

  // 4) 关键路径（最长链回溯）
  let maxId: string | null = null;
  let maxDepth = 0;
  for (const id of topo) {
    const d = depth.get(id) ?? 1;
    if (d > maxDepth) {
      maxDepth = d;
      maxId = id;
    }
  }
  const criticalPath: string[] = [];
  let cur = maxId;
  while (cur) {
    criticalPath.push(cur);
    cur = deepestDep.get(cur) ?? null;
  }
  criticalPath.reverse();

  // 5) 告警
  const warnings: GraphWarning[] = [];
  if (hasCycle) {
    warnings.push({
      kind: 'cycle',
      level: 'danger',
      message: `检测到循环依赖（${cycleNodes.length} 个节点互相前置），依赖分析已跳过这些节点，请修正后再排程`,
      ids: cycleNodes,
    });
  }
  for (const n of inputs) {
    const dangling = n.dependsOn.filter((d) => !present.has(d));
    if (dangling.length) {
      warnings.push({
        kind: 'dangling',
        level: 'warn',
        message: `「${n.label}」引用了不存在的前置：${dangling.join(', ')}`,
        ids: [n.id],
      });
    }
  }
  const nowMs = Date.now();
  for (const n of inputs) {
    if (DONE.has(n.status) || !n.deadline) continue;
    if (new Date(n.deadline).getTime() < nowMs) {
      warnings.push({
        kind: 'drift',
        level: 'warn',
        message: `「${n.label}」已过截止日仍未完成（计划漂移）`,
        ids: [n.id],
      });
    }
  }
  const byDate = new Map<string, string[]>();
  for (const n of inputs) {
    if (DONE.has(n.status) || !n.deadline) continue;
    const key = n.deadline.slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(n.id);
  }
  for (const [date, arr] of byDate) {
    if (arr.length >= 2) {
      warnings.push({
        kind: 'conflict',
        level: 'warn',
        message: `${date} 有 ${arr.length} 项同日截止，可能资源冲突，请确认优先级`,
        ids: arr,
      });
    }
  }

  const summary = {
    total: nodes.length,
    ready: nodes.filter((n) => n.state === 'ready').length,
    blocked: nodes.filter((n) => n.state === 'blocked').length,
    done: nodes.filter((n) => n.state === 'done').length,
    broken: nodes.filter((n) => n.state === 'broken').length,
  };

  return { nodes, byId, hasCycle, cycleNodes, criticalPath, warnings, summary };
}
