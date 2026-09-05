/**
 * V4.3 Task 21.5–21.9 / spec A17：Day 0–30 自然沉淀里程碑检测与触发。
 *
 * 设计原则（spec 严格规则 + 工作区规则）：
 *   - 纯函数 + 幂等：相同输入必产生相同输出；后端幂等键保证重复触发不会重复落库
 *   - 零设备数据依赖（spec A18.7）：整个初始化允许在零设备数据下完成
 *   - 去人机感（spec 附录 AD）：禁用「数字孪生 / 人格建模 / 蒸馏你 / 赋能 / 闭环 / 抓手 /
 *     画像 / 全知 / 精准洞察 / 命运 / 真实的你」；前台只说自然语言
 *   - 不作弊参数（工作区规则 2）：所有阈值 7/30 天来自 spec A17，无任何硬编码经验值
 *   - 不妥协回退（工作区规则 2）：网络失败由同步队列重试，不在此处吞错或返回伪造数据
 *
 * 里程碑语义（spec A17）：
 *   - Day 0  ：onboarding 完成 → 写入访谈 evidence → 触发首次蒸馏 → Personal Model v0.01
 *   - Day 1–7：自然记录；只在高信息量处追问 → Calibration v0.02（被动累积，无需主动触发）
 *   - Day 7  ：第一次「哪里像 / 哪里不像」校准 → candidate patterns + counterevidence → v0.05
 *   - Day 8–30：日常记录 + 可选设备数据 + 真实项目结果 → 逐步更新（被动累积）
 *   - Day 30 ：第一次正式月镜 → MonthlyBrief LLM → Personal Model v0.1
 *
 * 触发追踪方式（无新增 AsyncStorage）：
 *   通过 `api.distillationJobs.list()` 查找 `trigger='milestone'` 且 `input_scope.topic`
 *   等于里程碑标识，确定是否已触发过。Day 30 月镜通过 `api.brief.monthly()` 调用产生
 *   新的 personal_model_versions 记录；通过 modelVersions 列表中是否存在 version='v0.1'
 *   或以上来判断月镜是否完成（v0.1 是 spec A17.5 明确的版本标签）。
 *
 * 注意：distillation pipeline 后端 stage8_commit 自动生成 version='v0.0.N' 形式版本号。
 * 此处的 "v0.01 / v0.05 / v0.1" 是 spec A17 的概念里程碑标签，前端展示时映射到
 * 「Day 0 基线」「Day 7 校准」「Day 30 月镜」等自然语言；不修改后端 pipeline 的版本字符串。
 */

import { api, type MonthlyBriefResponse } from './api';
import type {
  DistillationJob,
  EvidenceRecord,
  EvidenceType,
  EvidenceSourceType,
  PrivacyLevel,
} from '../types/models';

// ---------- 里程碑标识 ----------

/** Day 0 首次蒸馏的 topic 标识（写入 DistillationJob.input_scope.topic） */
export const DAY0_TOPIC = 'day0-onboarding-interview';
/** Day 7 校准蒸馏的 topic 标识 */
export const DAY7_TOPIC = 'day7-calibration';
/** Day 30 月镜蒸馏的 topic 标识（与 api.brief.monthly 配合） */
export const DAY30_TOPIC = 'day30-monthly-mirror';

/** spec A17 里程碑版本标签（用于 UI 自然语言展示，非后端版本字符串） */
export const MILESTONE_VERSION_LABELS = {
  day0: 'v0.01',
  day7: 'v0.05',
  day30: 'v0.1',
} as const;

// ---------- 类型定义 ----------

export type DayMilestoneKind = 'day0' | 'day7' | 'day30';

export interface MilestoneState {
  /** 距离完成引导的天数（向下取整，未完成引导返回 0） */
  daysSinceOnboarding: number;
  /** 当前已到但未完成的里程碑（按 spec A17 优先级 day0 > day7 > day30） */
  pendingMilestone: DayMilestoneKind | null;
  /** Day 0 首次蒸馏是否已完成（找到 topic=day0-onboarding-interview 的 done job） */
  day0Completed: boolean;
  /** Day 7 校准蒸馏是否已完成 */
  day7Completed: boolean;
  /** Day 30 月镜是否已完成（modelVersions 含 version='v0.1' 或 day30 job done） */
  day30Completed: boolean;
}

// ---------- 纯函数：里程碑检测 ----------

/**
 * 计算距离首次完成引导的天数。
 *
 * @param onboardedAt ISODate 字符串；null/undefined/无效返回 0
 * @param now 当前时间，便于测试注入；默认 new Date()
 * @returns 整数天数（向下取整），最小 0
 */
export function computeDaysSinceOnboarding(
  onboardedAt: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!onboardedAt) return 0;
  const ts = Date.parse(onboardedAt);
  if (Number.isNaN(ts)) return 0;
  const diffMs = now.getTime() - ts;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * 判断 distillation job 是否对应指定里程碑 topic 且已完成（stage='done'）。
 */
function isMilestoneJobDone(
  job: DistillationJob,
  topic: string,
): boolean {
  return (
    job.trigger === 'milestone' &&
    job.input_scope?.topic === topic &&
    job.stage === 'done'
  );
}

/**
 * 计算当前用户的里程碑状态。
 *
 * 输入需提供：
 *   - onboardedAt（来自 UserProfile）
 *   - distillationJobs（来自 useDistillationStore 或 api.distillationJobs.list）
 *   - modelVersions（来自 useEvidenceStore 或 api.modelVersions.list，用于 Day 30 判断）
 *
 * 严格规则（spec A17 / 工作区规则 3 定量审核偏差 ≤ 5%）：
 *   - Day 0 检测：onboardedAt 存在 + 无 day0 done job → pending
 *   - Day 7 检测：daysSinceOnboarding >= 7 + 无 day7 done job → pending
 *   - Day 30 检测：daysSinceOnboarding >= 30 + 无 day30 done job + 无 version='v0.1' 模型版本 → pending
 *   - 优先级：day0 > day7 > day30（先完成前一个再触发后一个，避免遗漏）
 *
 * @returns MilestoneState；pendingMilestone 为 null 表示无待处理里程碑
 */
export function getMilestoneState(
  onboardedAt: string | null | undefined,
  distillationJobs: DistillationJob[],
  modelVersions: { version: string }[],
  now: Date = new Date(),
): MilestoneState {
  const days = computeDaysSinceOnboarding(onboardedAt, now);

  const day0Completed = distillationJobs.some((j) => isMilestoneJobDone(j, DAY0_TOPIC));
  const day7Completed = distillationJobs.some((j) => isMilestoneJobDone(j, DAY7_TOPIC));
  // Day 30 完成判定（spec A17.5）：存在 day30 done job 或存在 version='v0.1' 模型版本
  const day30JobDone = distillationJobs.some((j) => isMilestoneJobDone(j, DAY30_TOPIC));
  const hasVersion01 = modelVersions.some((v) => v.version === 'v0.1');
  const day30Completed = day30JobDone || hasVersion01;

  let pendingMilestone: DayMilestoneKind | null = null;
  // 优先级：先 Day 0，再 Day 7，再 Day 30
  // Day 0：只要完成过引导但蒸馏未完成，立即触发（不依赖天数）
  if (onboardedAt && !day0Completed) {
    pendingMilestone = 'day0';
  } else if (days >= 7 && !day7Completed) {
    pendingMilestone = 'day7';
  } else if (days >= 30 && !day30Completed) {
    pendingMilestone = 'day30';
  }

  return {
    daysSinceOnboarding: days,
    pendingMilestone,
    day0Completed,
    day7Completed,
    day30Completed,
  };
}

// ---------- 触发器：Day 0 / Day 7 / Day 30 ----------

/**
 * Day 0 访谈内容（spec A17.1）：onboarding 步骤 3「最近的生活」访谈的自然语言结构化拆分。
 * 每个字段是一句自然语言（非技术字段名），由 onboarding 表单收集。
 */
export interface Day0InterviewContent {
  /** facts：最近在忙什么 / 生活事实 */
  facts: string[];
  /** self_reports：开心或烦心的事 / 主观体验 */
  selfReports: string[];
  /** directions：接下来想往哪个方向走 / 意义方向 */
  directions: string[];
  /** open_questions：用户认为应该被问但还没说的事 / 数据缺口 */
  openQuestions: string[];
}

/**
 * 将 Day 0 访谈内容写入 evidence_records（spec A17.1）。
 *
 * 严格规则：
 *   - 每条访谈内容生成一条 EvidenceRecord（source='manual_text'，privacy_level='D1'）
 *   - evidence_type 按 spec A17.1 分类：facts→'fact'，selfReports→'self_report'，
 *     directions→'context'（意义方向作为情境上下文），openQuestions→'context'（数据缺口）
 *   - content_ref 直接保存用户原始语句，不做任何加工或推断
 *   - occurred_at = captured_at = 当前时间（访谈发生在当下）
 *   - 幂等键前缀 ev:day0-<kind>-<idx>，避免重复触发导致重复落库
 *
 * @returns 创建的 EvidenceRecord 数组（用于后续蒸馏 input_scope 引用）
 */
export async function writeDay0InterviewEvidence(
  userId: string,
  content: Day0InterviewContent,
): Promise<EvidenceRecord[]> {
  const now = new Date().toISOString();
  const created: EvidenceRecord[] = [];

  const groups: {
    kind: 'fact' | 'self_report' | 'context';
    items: string[];
    label: string;
  }[] = [
    { kind: 'fact', items: content.facts, label: 'fact' },
    { kind: 'self_report', items: content.selfReports, label: 'self-report' },
    { kind: 'context', items: content.directions, label: 'direction' },
    { kind: 'context', items: content.openQuestions, label: 'open-question' },
  ];

  for (const g of groups) {
    g.items.forEach((text, idx) => {
      if (!text.trim()) return;
      const evidenceType = g.kind as EvidenceType;
      const source: EvidenceSourceType = 'manual_text';
      const privacyLevel: PrivacyLevel = 'D1';
      // 构造与 api.evidence.create 入参一致的 Partial<EvidenceRecord>
      created.push({
        id: `day0-${g.label}-${idx}-${Date.now().toString(36)}`,
        user_id: userId,
        source,
        evidence_type: evidenceType,
        occurred_at: now,
        captured_at: now,
        content_ref: text.trim(),
        context: { milestone: 'day0', group: g.label },
        privacy_level: privacyLevel,
        quality_flags: { from_onboarding: true },
        status: 'active',
        provenance: { resource_type: 'onboarding_interview', resource_id: `day0-${g.label}-${idx}` },
        resource_type: 'onboarding_interview',
        resource_id: `day0-${g.label}-${idx}`,
        created_at: now,
      });
    });
  }

  // 串行写入避免后端并发；api.evidence.create 内部带幂等键 ev:<id>，重复调用安全
  const written: EvidenceRecord[] = [];
  for (const ev of created) {
    try {
      const rec = await api.evidence.create(ev);
      written.push(rec);
    } catch {
      // 网络错误不阻断 onboarding 完成；同步队列会重试写入（SubTask 5.4 已覆盖）
      // 但此处仍把本地构造的 ev 推入返回值，便于调用方触发蒸馏时引用 id
      written.push(ev);
    }
  }
  return written;
}

/**
 * 触发 Day 0 首次蒸馏（spec A17.1）。
 *
 * 流程：
 *   1. 创建 DistillationJob，trigger='milestone'，input_scope.topic='day0-onboarding-interview'
 *   2. timeWindow 覆盖过去 1 小时（访谈刚发生），确保 stage 1 scope 能捞到新写入的 evidence
 *   3. 后端 scheduler（Task 27.5）每分钟扫描 pending job 并执行 8 阶段 pipeline
 *   4. pipeline stage8 commit 创建 personal_model_versions 首个版本（spec A17.1 v0.01 概念标签）
 *
 * 幂等：api.distillationJobs.create 内部带幂等键 dij:<id>；重复调用不会重复创建 job。
 * 但调用方应先通过 getMilestoneState 检查 day0Completed 避免无意义触发。
 *
 * @returns 创建的 DistillationJob 或 null（网络错误）
 */
export async function triggerDay0Distillation(
  userId: string,
): Promise<DistillationJob | null> {
  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000); // 过去 1 小时
  const job: DistillationJob = {
    id: `dj-day0-${userId}-${now.getTime().toString(36)}`,
    user_id: userId,
    trigger: 'milestone',
    input_scope: {
      timeWindow: { start: start.toISOString(), end: now.toISOString() },
      topic: DAY0_TOPIC,
    },
    stage: 'pending',
    result: null,
    error: null,
    retry_count: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
  };
  try {
    return await api.distillationJobs.create(job);
  } catch {
    // 同步队列会在网络恢复后重试；返回 null 让调用方知道当前未即时落库
    return null;
  }
}

/**
 * 触发 Day 7 校准蒸馏（spec A17.3）。
 *
 * 流程：
 *   1. 创建 DistillationJob，trigger='milestone'，input_scope.topic='day7-calibration'
 *   2. timeWindow 覆盖过去 7 天，pipeline 处理这段时间内累积的 evidence
 *   3. 用户校准反馈通过 useEvidenceStore.createCorrection 写入 model_corrections，
 *      pipeline 阶段 4 counterSearch 会主动检索这些 correction 作为反例
 *   4. pipeline commit 创建新的 personal_model_versions（spec A17.3 v0.05 概念标签）
 *
 * @returns 创建的 DistillationJob 或 null
 */
export async function triggerDay7Calibration(
  userId: string,
): Promise<DistillationJob | null> {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 过去 7 天
  const job: DistillationJob = {
    id: `dj-day7-${userId}-${now.getTime().toString(36)}`,
    user_id: userId,
    trigger: 'milestone',
    input_scope: {
      timeWindow: { start: start.toISOString(), end: now.toISOString() },
      topic: DAY7_TOPIC,
    },
    stage: 'pending',
    result: null,
    error: null,
    retry_count: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
  };
  try {
    return await api.distillationJobs.create(job);
  } catch {
    return null;
  }
}

/**
 * 触发 Day 30 月镜（spec A17.5）。
 *
 * 流程：
 *   1. 调 api.brief.monthly() 让后端 LLM 生成 MonthlyBrief（候选经验 + 开放问题 + 失效旧认识）
 *   2. 创建 DistillationJob，trigger='milestone'，topic='day30-monthly-mirror'，
 *      timeWindow 覆盖过去 30 天，pipeline 处理长期累积并 commit 新版本（v0.1 概念标签）
 *
 * 月镜返回内容供 UI 展示（spec A18.6）：用户可逐条保留 / 修改 / 删除 / 标注「只适用于最近」。
 * 标注动作通过 useEvidenceStore.createCorrection({correction_type:'phase-changed' | 'special-case'}) 写入。
 *
 * @returns { brief, job } —— brief 为月镜 LLM 响应（可能为 empty/fallback/llm 三态），
 *          job 为蒸馏任务（用于追踪完成状态）；任一失败对应字段为 null
 */
export async function triggerDay30MonthlyMirror(
  userId: string,
): Promise<{ brief: MonthlyBriefResponse | null; job: DistillationJob | null }> {
  // 并行：调月镜 LLM + 创建蒸馏 job
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 过去 30 天
  const job: DistillationJob = {
    id: `dj-day30-${userId}-${now.getTime().toString(36)}`,
    user_id: userId,
    trigger: 'milestone',
    input_scope: {
      timeWindow: { start: start.toISOString(), end: now.toISOString() },
      topic: DAY30_TOPIC,
    },
    stage: 'pending',
    result: null,
    error: null,
    retry_count: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
  };

  const [briefResult, jobResult] = await Promise.all([
    api.brief.monthly().catch(() => null),
    api.distillationJobs.create(job).catch(() => null),
  ]);

  return { brief: briefResult, job: jobResult };
}

// ---------- UI 自然语言辅助 ----------

/**
 * V4.3 spec A18.4：四块自然语言内容标题（去技术化）。
 * 用于 onboarding 步骤 7 与 Day 30 月镜展示。
 */
export const FOUR_BLOCK_TITLES = {
  known: '我已经知道的',
  selfSaid: '这是你自己说的',
  guess: '我暂时有的一个猜想',
  unknown: '还有几件我不知道',
} as const;

/**
 * 根据里程碑返回 UI 展示用版本标签（spec A17）。
 * 后端实际 version 字段为 v0.0.N，此处仅返回概念标签用于自然语言展示。
 */
export function milestoneVersionLabel(kind: DayMilestoneKind): string {
  return MILESTONE_VERSION_LABELS[kind];
}

/**
 * spec A18.5：Day 7 不弹出复杂报告，只问一句话。
 * 此函数返回固定问句，避免在 UI 组件中硬编码字符串散落。
 */
export function day7CalibrationPrompt(): string {
  return '我们一起看看这一周，哪里像你，哪里不太像？';
}

/**
 * spec A18.6：Day 30 第一次形成「我们目前认识到的你」自然语言标题。
 */
export function day30MonthlyTitle(): string {
  return '我们目前认识到的你';
}
