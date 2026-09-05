import type { EventRow, CommitmentRow, HypothesisRow, ExperimentRow, SixPositionState } from '../types.js';
import { generateBriefJson, generateJsonWithPrompt } from '../llm/deepseek.js';
import { WEEKLY_SYSTEM_PROMPT, MONTHLY_SYSTEM_PROMPT } from '../llm/prompts.js';

export interface TodayBrief {
  factChanges: string[];
  todayCommitments: string[];
  suggestedActions: string[];
  highInfoQuestion: string;
  silenceHint?: string;
  generatedBy: 'llm' | 'fallback' | 'empty';
}

// ---------- 周镜（V4.3 §2.2 / §A11，Task 4.6） ----------

export interface WeeklyBrief {
  highlights: string[];
  patterns: string[];
  nextWeekFocus: string[];
  openQuestions: string[];
  generatedBy: 'llm' | 'fallback' | 'empty';
}

export interface WeeklyContextInput {
  events: EventRow[];
  commitments: CommitmentRow[];
  hypotheses: HypothesisRow[];
  experiments: ExperimentRow[];
  similarWeeks?: EventRow[][];  // 过去相似周的事件（可选，无相似度检索时为空）
}

export function buildWeeklyContext(args: WeeklyContextInput): string {
  const { events, commitments, hypotheses, experiments, similarWeeks } = args;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const thisWeek = events.filter((e) => new Date(e.created_at) >= weekAgo);
  const lines: string[] = [];
  lines.push('【本周事件】');
  if (thisWeek.length === 0) lines.push('（本周暂无记录）');
  thisWeek.slice(0, 20).forEach((e) =>
    lines.push(`- ${e.created_at.slice(0, 10)} [${e.layer}/${e.source}] ${e.content}${e.mood != null ? `（情绪 ${e.mood}）` : ''}`)
  );
  lines.push('\n【活跃承诺】');
  const activeC = commitments.filter((c) => c.status === 'active');
  if (activeC.length === 0) lines.push('（无活跃承诺）');
  activeC.forEach((c) => lines.push(`- [${c.domain}] ${c.text}（权重 ${c.weight}）`));
  lines.push('\n【正在测试的假设】');
  if (hypotheses.length === 0) lines.push('（无）');
  hypotheses.slice(0, 5).forEach((h) =>
    lines.push(`- 「${h.statement}」置信度 ${h.confidence}（${h.status}）`)
  );
  lines.push('\n【进行中实验】');
  const runExp = experiments.filter((e) => (e.status === 'running' || e.status === 'planned' || e.status === 'active'));
  if (runExp.length === 0) lines.push('（无）');
  runExp.forEach((e) => lines.push(`- ${e.title}（${e.duration_days}天，${e.status}）`));
  // 过去相似周（若提供）
  if (similarWeeks && similarWeeks.length > 0) {
    lines.push('\n【过去相似周事件（参考）】');
    similarWeeks.slice(0, 3).forEach((week, i) => {
      lines.push(`- 相似周 ${i + 1}:`);
      week.slice(0, 5).forEach((e) => lines.push(`  - ${e.created_at.slice(0, 10)} ${e.content}`));
    });
  }
  return lines.join('\n');
}

export async function generateWeeklyBrief(
  args: WeeklyContextInput & { userId: string },
  contractSystemPrompt?: string
): Promise<WeeklyBrief> {
  const { events } = args;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const thisWeekCount = events.filter((e) => new Date(e.created_at) >= weekAgo).length;
  // 空状态：本周无事件且无活跃承诺
  if (thisWeekCount === 0 && args.commitments.filter((c) => c.status === 'active').length === 0) {
    return {
      highlights: [],
      patterns: [],
      nextWeekFocus: ['本周还没有记录。下周试着每天留下一条真实的事。'],
      openQuestions: ['下周想重点留意什么？'],
      generatedBy: 'empty',
    };
  }
  const ctx = buildWeeklyContext(args);
  try {
    const raw = await generateJsonWithPrompt(WEEKLY_SYSTEM_PROMPT, ctx, args.userId, 1000, contractSystemPrompt);
    const parsed = safeParseWeekly(raw);
    if (parsed) return { ...parsed, generatedBy: 'llm' };
    return { ...fallbackWeekly(args), generatedBy: 'fallback' };
  } catch {
    return { ...fallbackWeekly(args), generatedBy: 'fallback' };
  }
}

function safeParseWeekly(raw: string): Omit<WeeklyBrief, 'generatedBy'> | null {
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      highlights: arr(obj.highlights),
      patterns: arr(obj.patterns),
      nextWeekFocus: arr(obj.nextWeekFocus),
      openQuestions: arr(obj.openQuestions),
    };
  } catch {
    return null;
  }
}

function fallbackWeekly(args: WeeklyContextInput): Omit<WeeklyBrief, 'generatedBy'> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const thisWeek = args.events.filter((e) => new Date(e.created_at) >= weekAgo);
  const highlights = thisWeek.slice(0, 3).map((e) => `${e.content}（${e.created_at.slice(5, 10)}）`);
  return {
    highlights,
    patterns: [],
    nextWeekFocus: args.commitments.filter((c) => c.status === 'active').slice(0, 2).map((c) => `继续推进：[${c.domain}] ${c.text}`),
    openQuestions: ['这周有什么事让你反复在想？'],
  };
}

// ---------- 月镜（V4.3 §2.2 / §A11，Task 4.6） ----------

export interface MonthlyBrief {
  monthlyTheme: string;
  candidateExperiences: string[];
  openQuestions: string[];
  staleInsights: string[];
  nextMonthFocus: string[];
  generatedBy: 'llm' | 'fallback' | 'empty';
}

export interface MonthlyContextInput {
  events: EventRow[];
  commitments: CommitmentRow[];
  hypotheses: HypothesisRow[];
  experiments: ExperimentRow[];
}

export function buildMonthlyContext(args: MonthlyContextInput): string {
  const { events, commitments, hypotheses, experiments } = args;
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const thisMonth = events.filter((e) => new Date(e.created_at) >= monthAgo);
  const lines: string[] = [];
  lines.push('【本月事件】');
  if (thisMonth.length === 0) lines.push('（本月暂无记录）');
  thisMonth.slice(0, 40).forEach((e) =>
    lines.push(`- ${e.created_at.slice(0, 10)} [${e.layer}/${e.source}] ${e.content}${e.mood != null ? `（情绪 ${e.mood}）` : ''}`)
  );
  lines.push('\n【活跃承诺】');
  const activeC = commitments.filter((c) => c.status === 'active');
  if (activeC.length === 0) lines.push('（无活跃承诺）');
  activeC.forEach((c) => lines.push(`- [${c.domain}] ${c.text}（权重 ${c.weight}）`));
  lines.push('\n【假设（含已修订/已否决）】');
  if (hypotheses.length === 0) lines.push('（无）');
  hypotheses.slice(0, 10).forEach((h) =>
    lines.push(`- 「${h.statement}」置信度 ${h.confidence}（${h.status}）`)
  );
  lines.push('\n【实验（含已完成/已停止）】');
  if (experiments.length === 0) lines.push('（无）');
  experiments.slice(0, 10).forEach((e) => lines.push(`- ${e.title}（${e.duration_days}天，${e.status}）`));
  return lines.join('\n');
}

export async function generateMonthlyBrief(
  args: MonthlyContextInput & { userId: string },
  contractSystemPrompt?: string
): Promise<MonthlyBrief> {
  const { events } = args;
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const thisMonthCount = events.filter((e) => new Date(e.created_at) >= monthAgo).length;
  // 空状态：本月无事件且无活跃承诺
  if (thisMonthCount === 0 && args.commitments.filter((c) => c.status === 'active').length === 0) {
    return {
      monthlyTheme: '本月还没有记录',
      candidateExperiences: [],
      openQuestions: ['下个月想重点留意什么？'],
      staleInsights: [],
      nextMonthFocus: ['下个月试着每天留下一条真实的事。'],
      generatedBy: 'empty',
    };
  }
  const ctx = buildMonthlyContext(args);
  try {
    const raw = await generateJsonWithPrompt(MONTHLY_SYSTEM_PROMPT, ctx, args.userId, 1200, contractSystemPrompt);
    const parsed = safeParseMonthly(raw);
    if (parsed) return { ...parsed, generatedBy: 'llm' };
    return { ...fallbackMonthly(args), generatedBy: 'fallback' };
  } catch {
    return { ...fallbackMonthly(args), generatedBy: 'fallback' };
  }
}

function safeParseMonthly(raw: string): Omit<MonthlyBrief, 'generatedBy'> | null {
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      monthlyTheme: typeof obj.monthlyTheme === 'string' ? obj.monthlyTheme : '',
      candidateExperiences: arr(obj.candidateExperiences),
      openQuestions: arr(obj.openQuestions),
      staleInsights: arr(obj.staleInsights),
      nextMonthFocus: arr(obj.nextMonthFocus),
    };
  } catch {
    return null;
  }
}

function fallbackMonthly(args: MonthlyContextInput): Omit<MonthlyBrief, 'generatedBy'> {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const thisMonth = args.events.filter((e) => new Date(e.created_at) >= monthAgo);
  return {
    monthlyTheme: thisMonth.length > 0 ? `本月记录了 ${thisMonth.length} 条事件` : '本月记录较少',
    candidateExperiences: [],
    openQuestions: ['这个月有什么事让你反复在想？'],
    staleInsights: [],
    nextMonthFocus: args.commitments.filter((c) => c.status === 'active').slice(0, 2).map((c) => `继续推进：[${c.domain}] ${c.text}`),
  };
}

export function buildContextSummary(args: {
  events: EventRow[];
  commitments: CommitmentRow[];
  hypotheses: HypothesisRow[];
  experiments: ExperimentRow[];
  state: SixPositionState;
}): string {
  const { events, commitments, hypotheses, experiments, state } = args;
  const recent = events.slice(0, 8);
  const lines: string[] = [];
  lines.push('【近期事件】');
  if (recent.length === 0) lines.push('（暂无记录）');
  recent.forEach((e) =>
    lines.push(`- ${e.created_at.slice(0, 10)} [${e.layer}/${e.source}] ${e.content}${e.mood ? `（情绪 ${e.mood}）` : ''}`)
  );
  lines.push('\n【活跃承诺】');
  const activeC = commitments.filter((c) => c.status === 'active');
  if (activeC.length === 0) lines.push('（无活跃承诺）');
  activeC.forEach((c) => lines.push(`- [${c.domain}] ${c.text}（权重 ${c.weight}）`));
  lines.push('\n【正在测试的假设】');
  if (hypotheses.length === 0) lines.push('（无）');
  hypotheses.slice(0, 5).forEach((h) =>
    lines.push(`- 「${h.statement}」置信度 ${h.confidence}（${h.status}）`)
  );
  lines.push('\n【进行中实验】');
  const runExp = experiments.filter((e) => (e.status === 'running' || e.status === 'planned' || e.status === 'active'));
  if (runExp.length === 0) lines.push('（无）');
  runExp.forEach((e) => lines.push(`- ${e.title}（${e.duration_days}天，${e.status}）`));
  lines.push(`\n【六位状态】分歧度 ${state.divergence}，变化位：${state.changePositions.join(' / ') || '无显著落差'}`);
  return lines.join('\n');
}

// 适配 App 端文档对象的防御性归一化
export function normalizeHypothesisDoc(doc: any): HypothesisRow {
  return {
    id: doc.id, user_id: doc.user_id ?? '',
    statement: doc.statement ?? '(假设)',
    confidence: doc.confidence ?? 0.5,
    status: doc.status ?? 'testing',
    evidence: doc.supporting ?? doc.evidence ?? [],
    counter_evidence: doc.countering ?? doc.counter_evidence ?? [],
    alternatives: doc.alternatives ?? [],
    expires_at: doc.reviewAt ?? doc.expires_at ?? null,
    created_at: doc.createdAt ?? doc.created_at ?? new Date().toISOString(),
  };
}
export function normalizeExperimentDoc(doc: any): ExperimentRow {
  return {
    id: doc.id, user_id: doc.user_id ?? '',
    title: doc.title ?? doc.question ?? '(实验)',
    hypothesis_id: doc.hypothesisId ?? doc.hypothesis_id ?? null,
    duration_days: doc.durationDays ?? doc.duration_days ?? 7,
    started_at: doc.startDate ?? doc.startedAt ?? doc.started_at ?? new Date().toISOString(),
    ended_at: doc.endedAt ?? doc.ended_at ?? null,
    status: doc.status ?? 'planned',
    checkins: doc.checkIns ?? doc.checkins ?? [],
    stop_rule: doc.stopRule ?? doc.stop_rule ?? null,
  };
}

export async function generateTodayBrief(
  args: {
    events: EventRow[];
    commitments: CommitmentRow[];
    hypotheses: HypothesisRow[];
    experiments: ExperimentRow[];
    state: SixPositionState;
    userId: string;
  },
  contractSystemPrompt?: string
): Promise<TodayBrief> {
  if (args.events.length === 0 && args.commitments.length === 0) {
    return {
      factChanges: [],
      todayCommitments: [],
      suggestedActions: ['先在「镜像」里记录一件今天发生的事，作为知行镜的第一块基石。'],
      highInfoQuestion: '最近有什么事让你反复在想？',
      generatedBy: 'empty',
    };
  }
  const ctx = buildContextSummary(args);
  try {
    const raw = await generateBriefJson(ctx, args.userId, contractSystemPrompt);
    const parsed = safeParseBrief(raw);
    if (parsed) return { ...parsed, generatedBy: 'llm' };
    return { ...fallbackBrief(args), generatedBy: 'fallback' };
  } catch {
    return { ...fallbackBrief(args), generatedBy: 'fallback' };
  }
}

function safeParseBrief(raw: string): Omit<TodayBrief, 'generatedBy'> | null {
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      factChanges: arr(obj.factChanges),
      todayCommitments: arr(obj.todayCommitments),
      suggestedActions: arr(obj.suggestedActions),
      highInfoQuestion: typeof obj.highInfoQuestion === 'string' ? obj.highInfoQuestion : '',
      silenceHint: typeof obj.silenceHint === 'string' ? obj.silenceHint : undefined,
    };
  } catch {
    return null;
  }
}

function arr(x: unknown): string[] {
  return Array.isArray(x) ? x.map((v) => String(v)).filter(Boolean) : [];
}

function fallbackBrief(args: {
  events: EventRow[];
  commitments: CommitmentRow[];
  state: SixPositionState;
}): Omit<TodayBrief, 'generatedBy'> {
  const recent = args.events.slice(0, 3).map((e) => `${e.content}（${e.created_at.slice(5, 10)}）`);
  const activeC = args.commitments.filter((c) => c.status === 'active').map((c) => `[${c.domain}] ${c.text}`);
  const high = args.state.divergence > 0.3;
  return {
    factChanges: recent,
    todayCommitments: activeC,
    suggestedActions: high
      ? ['内外落差偏高，今天先不急着推进，记录一条真实感受即可。']
      : ['状态较一致，可推进一个进行中的实验。'],
    highInfoQuestion: high
      ? '你外在表现出的状态，和你内在真实感受之间，差在哪里？'
      : '今天哪件小事最值得被记住？',
  };
}
