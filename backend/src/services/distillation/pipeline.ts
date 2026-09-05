/**
 * Personal Experience Engine 八阶段流水线（V4.3 §4.18 / §8.4，spec A2 / Task 11）
 *
 * 8 阶段：
 *   1. scope              确定本次只看哪个时间窗/项目/主题
 *   2. extract            原始材料 → 结构化 Evidence（格式化与去重）
 *   3. candidate          规则 + 统计 + LLM 生成候选模式（不直接写入 Personal Model）
 *   4. counterSearch      主动检索相反事件、不同阶段和不同情境
 *   5. contextCheck       区分偏好与外部约束
 *   6. independentReview  第二个提示词/模型只拿证据和候选，检查过度概括与来源错误
 *   7. userGate           高影响认识必须给用户「像/不像/特殊情况/别再这样推断」入口
 *   8. commit             通过后更新 Experience/Skill/ModelVersion 并写 change_log
 *
 * 五道升级门（V4.3 spec A2.2）：
 *   1. 重复门   (stage 3 → 4)：候选需 ≥2 不同时间段支持
 *   2. 迁移门   (stage 5 contextCheck)：候选需通过情境适用性检查
 *   3. 反例门   (stage 4 counterSearch)：候选需主动检索反例并标注
 *   4. 用户解释门 (stage 7 userGate)：高影响候选需用户确认
 *   5. 失效条件门 (stage 8 commit + 后续监控)：每条经验记录失效条件
 *
 * 严格规则（spec Task 11）：
 * - 8 阶段必须全部实现，不允许跳过任何阶段
 * - LLM 调用必须有三态（llm/fallback/empty），失败时显式标记 fallback
 * - userGate 必须真正等待用户反馈（不能自动通过）
 * - 反例检索必须真实执行（不能仅 stub）
 * - SQL 全部用 prepared statement
 * - 失败时记录 error，但仍返回已完成阶段的结果
 */
import {
  createDistillationJob,
  updateDistillationJobStage,
  completeDistillationJob,
  failDistillationJob,
  getDistillationJobById,
  incrementDistillationJobRetry,
  getEvidencesByTimeWindow,
  getEvidencesByUser,
  getEvidenceById,
  createPattern,
  createExperience,
  createModelVersion,
  getActiveModelVersion,
  countModelVersionsByUser,
  audit,
  getDb,
} from '../../db.js';
import type {
  EvidenceRecord,
  PatternReviewState,
  DistillationTrigger,
} from '../../types.js';
import { generateJsonWithPrompt } from '../../llm/deepseek.js';
import {
  CANDIDATE_EXTRACTION_PROMPT,
  COUNTERSEARCH_PROMPT,
  CONTEXT_CHECK_PROMPT,
  INDEPENDENT_REVIEW_PROMPT,
} from '../../llm/prompts.js';

// ---------- 公共类型 ----------

/** 蒸馏流水线输入（spec SubTask 11.1） */
export interface DistillationInput {
  userId: string;
  timeWindow: { start: string; end: string };
  project?: string;  // 可选：限定项目
  topic?: string;    // 可选：限定主题
  trigger: DistillationTrigger;
}

/** 阶段名称（与 spec 一致） */
export type StageName =
  | 'scope' | 'extract' | 'candidate' | 'counterSearch'
  | 'contextCheck' | 'independentReview' | 'userGate' | 'commit';

/** 单阶段执行结果（spec SubTask 11.1） */
export interface DistillationStageResult {
  stage: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  name: StageName;
  status: 'success' | 'skipped' | 'failed';
  output: unknown;  // 阶段输出（候选模式、反例、审查结果等）
  error?: string;
  /** LLM 来源标记：'llm' | 'fallback' | 'empty'（spec 严格规则 6） */
  generatedBy?: 'llm' | 'fallback' | 'empty';
}

/** 流水线执行结果 */
export interface DistillationPipelineResult {
  jobId: string;
  stages: DistillationStageResult[];
  candidatesCommitted: number;
  candidatesPendingUserReview: number;
  /** 本次蒸馏生成的 PersonalModelVersion 版本号（对齐项目书附录AE DistillationJob.model_version） */
  modelVersion: string | null;
}

// ---------- 流水线内部候选模式（in-memory，未写入 DB） ----------

/**
 * 流水线内部候选模式：在阶段 3-7 之间流转，阶段 8 才写入 pattern_candidates 表。
 * 与 PatternCandidate 的区别：未持久化、含运行时上下文与 context_exception。
 */
interface PipelineCandidate {
  // 由 stage 3 设置：
  statement: string;
  scope: string | null;
  support_ids: string[];
  alternative_explanations: string[];
  recurrence_count: number;
  domain_count: number;
  review_state: PatternReviewState;  // 阶段 6 设置 keep/watch/reject
  // 由 stage 4 设置：
  counter_ids: string[];
  // 由 stage 5 设置：
  context_exception: string | null;
  passes_context_check: boolean;
  is_preference: boolean | null;
  // 由 stage 6 设置：
  review_issues: string[];
  review_suggestions: string[];
  // 由 stage 7 设置：
  is_high_impact: boolean;
}

// ---------- 公共入口 ----------

/**
 * 启动一次蒸馏流水线。
 *
 * 流程：
 * 1. 创建 distillation_jobs 记录（stage='pending'）
 * 2. 依次执行 8 阶段，每个阶段更新 distillation_jobs.stage 字段
 * 3. 失败时记录 error，但仍返回已完成阶段的结果
 *
 * @returns 流水线结果（含 jobId、各阶段结果、commit 计数）
 */
export async function runDistillationPipeline(
  input: DistillationInput
): Promise<DistillationPipelineResult> {
  // 1. 创建 distillation_jobs 记录
  const job = createDistillationJob(input.userId, {
    trigger: input.trigger,
    input_scope: {
      timeWindow: input.timeWindow,
      project: input.project,
      topic: input.topic,
    },
  });
  const jobId = job.id;
  const stages: DistillationStageResult[] = [];

  // 2. 依次执行 8 阶段
  // 阶段之间通过 in-memory 数据传递：
  //   stage1 → scopedEvidenceIds
  //   stage2 → normalizedEvidence
  //   stage3 → candidates (PipelineCandidate[])
  //   stage4 → candidates with counter_ids filled
  //   stage5 → candidates with context_exception filled
  //   stage6 → candidates with review_state finalized
  //   stage7 → split: high-impact (persisted as pending_user_review) + low-impact (passed to stage 8)
  //   stage8 → commit low-impact candidates

  try {
    // 阶段 1: scope
    const s1 = await stage1_scope(input, jobId);
    stages.push(s1);
    if (s1.status === 'failed') {
      failDistillationJob(jobId, s1.error ?? 'stage 1 failed');
      return { jobId, stages, candidatesCommitted: 0, candidatesPendingUserReview: 0, modelVersion: null };
    }
    const scopedEvidenceIds = s1.output as string[];

    // 阶段 2: extract
    const s2 = await stage2_extract(input.userId, scopedEvidenceIds, jobId);
    stages.push(s2);
    if (s2.status === 'failed') {
      failDistillationJob(jobId, s2.error ?? 'stage 2 failed');
      return { jobId, stages, candidatesCommitted: 0, candidatesPendingUserReview: 0, modelVersion: null };
    }
    const normalizedEvidence = s2.output as EvidenceRecord[];

    // 阶段 3: candidate
    const s3 = await stage3_candidate(input.userId, normalizedEvidence, jobId);
    stages.push(s3);
    if (s3.status === 'failed') {
      failDistillationJob(jobId, s3.error ?? 'stage 3 failed');
      return { jobId, stages, candidatesCommitted: 0, candidatesPendingUserReview: 0, modelVersion: null };
    }
    const candidates = s3.output as PipelineCandidate[];

    // 阶段 4: counterSearch
    const s4 = await stage4_counterSearch(input, normalizedEvidence, candidates, jobId);
    stages.push(s4);
    if (s4.status === 'failed') {
      failDistillationJob(jobId, s4.error ?? 'stage 4 failed');
      return { jobId, stages, candidatesCommitted: 0, candidatesPendingUserReview: 0, modelVersion: null };
    }

    // 阶段 5: contextCheck
    const s5 = await stage5_contextCheck(input.userId, candidates, jobId);
    stages.push(s5);
    if (s5.status === 'failed') {
      failDistillationJob(jobId, s5.error ?? 'stage 5 failed');
      return { jobId, stages, candidatesCommitted: 0, candidatesPendingUserReview: 0, modelVersion: null };
    }

    // 阶段 6: independentReview
    const s6 = await stage6_independentReview(input.userId, candidates, jobId);
    stages.push(s6);
    if (s6.status === 'failed') {
      failDistillationJob(jobId, s6.error ?? 'stage 6 failed');
      return { jobId, stages, candidatesCommitted: 0, candidatesPendingUserReview: 0, modelVersion: null };
    }

    // 阶段 7: userGate
    const s7 = await stage7_userGate(input.userId, candidates, jobId);
    stages.push(s7);
    if (s7.status === 'failed') {
      failDistillationJob(jobId, s7.error ?? 'stage 7 failed');
      return { jobId, stages, candidatesCommitted: 0, candidatesPendingUserReview: 0, modelVersion: null };
    }
    const candidatesToCommit = s7.output as {
      toCommit: PipelineCandidate[];
      pendingUserReview: PipelineCandidate[];
    };

    // 阶段 8: commit
    const s8 = await stage8_commit(input.userId, candidatesToCommit, jobId);
    stages.push(s8);

    if (s8.status === 'failed') {
      failDistillationJob(jobId, s8.error ?? 'stage 8 failed');
      return {
        jobId,
        stages,
        candidatesCommitted: 0,
        candidatesPendingUserReview: candidatesToCommit.pendingUserReview.length,
        modelVersion: null,
      };
    }

    // 全部完成
    const commitOutput = s8.output as { committedCount: number; modelVersion: string };
    const candidatesCommitted = commitOutput.committedCount;
    const modelVersion = commitOutput.modelVersion;
    const finalResult = {
      jobId,
      stages,
      candidatesCommitted,
      candidatesPendingUserReview: candidatesToCommit.pendingUserReview.length,
      modelVersion,
      stagesSummary: stages.map((s) => ({ stage: s.stage, name: s.name, status: s.status, generatedBy: s.generatedBy })),
    };
    completeDistillationJob(jobId, finalResult);
    audit(input.userId, 'distillation.pipeline.completed', {
      jobId,
      candidatesCommitted,
      candidatesPendingUserReview: candidatesToCommit.pendingUserReview.length,
      modelVersion,
      stages: stages.length,
    });
    return {
      jobId,
      stages,
      candidatesCommitted,
      candidatesPendingUserReview: candidatesToCommit.pendingUserReview.length,
      modelVersion,
    };
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    failDistillationJob(jobId, errMsg);
    audit(input.userId, 'distillation.pipeline.failed', { jobId, error: errMsg });
    return {
      jobId,
      stages,
      candidatesCommitted: 0,
      candidatesPendingUserReview: 0,
      modelVersion: null,
    };
  }
}

// ---------- 阶段 1: scope ----------

/** 阶段 1: 确定本次只看哪个时间窗/项目/主题 */
async function stage1_scope(
  input: DistillationInput,
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'scoping');
  const { userId, timeWindow, project, topic } = input;
  // 查 evidence_records WHERE user_id=? AND occurred_at BETWEEN start AND end
  // 若指定 project，过滤 resource_type='project' AND resource_id=project
  const evidences = getEvidencesByTimeWindow(
    userId,
    timeWindow.start,
    timeWindow.end,
    project,
    topic
  );
  const scopedIds = evidences.map((e) => e.id);
  updateDistillationJobStage(jobId, 'scoping', {
    scopedCount: scopedIds.length,
    timeWindow,
    project: project ?? null,
    topic: topic ?? null,
  });
  // 空状态：时间窗内无证据
  if (scopedIds.length === 0) {
    return {
      stage: 1,
      name: 'scope',
      status: 'success',
      output: [],
      generatedBy: 'empty',
    };
  }
  return {
    stage: 1,
    name: 'scope',
    status: 'success',
    output: scopedIds,
    generatedBy: 'empty',  // scope 不调 LLM
  };
}

// ---------- 阶段 2: extract ----------

/**
 * 阶段 2: 原始材料 → 结构化 Evidence
 * 原始材料已由 evidence_records 表存储，此阶段主要是格式化与去重。
 * 调 LLM 提取关键事实与情境标签。
 */
async function stage2_extract(
  userId: string,
  evidenceIds: string[],
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'extracting');
  if (evidenceIds.length === 0) {
    return {
      stage: 2,
      name: 'extract',
      status: 'success',
      output: [],
      generatedBy: 'empty',
    };
  }
  // 拉取完整 evidence 记录
  const evidences: EvidenceRecord[] = [];
  for (const id of evidenceIds) {
    const ev = getEvidenceById(id);
    if (ev && ev.user_id === userId) evidences.push(ev);
  }
  // 去重：按 (occurred_at, content_ref) 去重，保留最早一条
  const seen = new Set<string>();
  const deduped: EvidenceRecord[] = [];
  for (const ev of evidences) {
    const key = `${ev.occurred_at}::${ev.content_ref ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }
  updateDistillationJobStage(jobId, 'extracting', {
    inputCount: evidenceIds.length,
    dedupedCount: deduped.length,
  });
  // 注意：此阶段不调 LLM（evidence_records 表本身就是结构化的）
  // LLM 提取关键事实的工作在 stage 3 candidate 完成
  return {
    stage: 2,
    name: 'extract',
    status: 'success',
    output: deduped,
    generatedBy: 'empty',  // extract 不调 LLM
  };
}

// ---------- 阶段 3: candidate ----------

/**
 * 阶段 3: 规则 + 统计 + LLM 生成候选模式（不直接写入 Personal Model）
 *
 * 重复门（升级门 1）：候选需 ≥2 不同时间段支持
 */
async function stage3_candidate(
  userId: string,
  evidences: EvidenceRecord[],
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'candidate');
  if (evidences.length === 0) {
    return {
      stage: 3,
      name: 'candidate',
      status: 'success',
      output: [],
      generatedBy: 'empty',
    };
  }

  // 准备 LLM 上下文
  const evidenceLines = evidences.map((e, i) => {
    const ctx = e.context ? ` | ctx=${JSON.stringify(e.context).slice(0, 200)}` : '';
    return `[${i}] id=${e.id} | time=${e.occurred_at} | type=${e.evidence_type} | source=${e.source}${ctx}\n    content: ${e.content_ref ?? '(无内容)'}`;
  });
  const llmContext = `【用户证据列表】\n${evidenceLines.join('\n')}`;

  let generatedBy: 'llm' | 'fallback' = 'fallback';
  let raw: string | null = null;

  // 调 LLM 生成候选
  try {
    raw = await generateJsonWithPrompt(
        CANDIDATE_EXTRACTION_PROMPT,
        llmContext,
        userId,
        4096
      );
      generatedBy = 'llm';
  } catch {
    // LLM 失败：进入 fallback
    raw = null;
    generatedBy = 'fallback';
  }

  // 解析 LLM 输出
  let parsed: Array<{
    statement: string;
    scope?: string;
    support_ids?: string[];
    alternative_explanations?: string[];
    domain_count?: number;
  }> = [];

  if (raw) {
    parsed = safeParseCandidateArray(raw);
    if (parsed.length === 0) {
      // LLM 返回但解析失败 → fallback
      generatedBy = 'fallback';
    }
  }

  // Fallback：规则 + 统计（基于 evidence_type 与时间聚类）
  if (parsed.length === 0) {
    parsed = fallbackCandidateExtraction(evidences);
    generatedBy = 'fallback';
  }

  // 转换为 PipelineCandidate，并执行「重复门」检查
  const candidates: PipelineCandidate[] = [];
  for (const p of parsed) {
    if (!p.statement || !Array.isArray(p.support_ids) || p.support_ids.length === 0) continue;
    // 验证 support_ids 都属于当前 evidences
    const validSupportIds = p.support_ids.filter((id) =>
      evidences.some((e) => e.id === id)
    );
    if (validSupportIds.length === 0) continue;
    // 重复门：候选需 ≥2 不同时间段支持
    const supportEvidences = validSupportIds
      .map((id) => evidences.find((e) => e.id === id))
      .filter((e): e is EvidenceRecord => e !== undefined);
    const distinctTimeBuckets = countDistinctTimeBuckets(supportEvidences);
    if (distinctTimeBuckets < 2) {
      // 重复门未通过：不进入候选
      continue;
    }
    candidates.push({
      statement: p.statement,
      scope: p.scope ?? null,
      support_ids: validSupportIds,
      alternative_explanations: Array.isArray(p.alternative_explanations)
        ? p.alternative_explanations
        : [],
      recurrence_count: supportEvidences.length,
      domain_count: typeof p.domain_count === 'number' ? p.domain_count : 1,
      review_state: 'candidate',  // 阶段 6 才设置 keep/watch/reject
      counter_ids: [],
      context_exception: null,
      passes_context_check: false,
      is_preference: null,
      review_issues: [],
      review_suggestions: [],
      is_high_impact: false,
    });
  }

  updateDistillationJobStage(jobId, 'candidate', {
    candidateCount: candidates.length,
    generatedBy,
  });

  return {
    stage: 3,
    name: 'candidate',
    status: 'success',
    output: candidates,
    generatedBy,
  };
}

// ---------- 阶段 4: counterSearch ----------

/**
 * 阶段 4: 主动检索相反事件、不同阶段和不同情境
 * 反例门（升级门 3）：候选需主动检索反例并标注
 *
 * 真实执行（spec 严格规则 8）：
 * - 关键词匹配：从候选 statement 提取关键词，搜索候选时间窗外的相反证据
 * - LLM 判断：让 LLM 判断每条潜在反例是否真的与候选矛盾
 * - 失败时回退到关键词匹配（fallback）
 */
async function stage4_counterSearch(
  input: DistillationInput,
  scopedEvidences: EvidenceRecord[],
  candidates: PipelineCandidate[],
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'counter_search');
  if (candidates.length === 0) {
    return {
      stage: 4,
      name: 'counterSearch',
      status: 'skipped',
      output: { reason: 'no candidates' },
      generatedBy: 'empty',
    };
  }

  // 拉取时间窗外的全部证据（用于反例检索）
  // 注：getEvidencesByUser 已按 occurred_at 倒序，限制 500 条避免性能问题
  const allUserEvidences = getEvidencesByUser(input.userId, 500);
  const scopedIdSet = new Set(scopedEvidences.map((e) => e.id));
  const outsideEvidences = allUserEvidences.filter((e) => !scopedIdSet.has(e.id));

  // 为每个候选检索反例
  // 步骤 1：关键词匹配（始终执行）
  // 步骤 2：LLM 判断（如可用）
  let generatedBy: 'llm' | 'fallback' = 'fallback';

  // 构造 LLM 上下文
  const candidateLines = candidates.map((c, i) => {
    return `[候选 ${i}] statement=${c.statement} | support_ids=${JSON.stringify(c.support_ids)}`;
  });
  const evidenceLines = outsideEvidences.map((e) => {
    return `id=${e.id} | time=${e.occurred_at} | type=${e.evidence_type} | content=${e.content_ref ?? '(无内容)'}`;
  });

  let llmResult: Array<{ candidate_index: number; counter_ids: string[]; reasoning?: string }> | null = null;
  if (outsideEvidences.length > 0) {
    try {
      const llmContext = `【候选模式列表】\n${candidateLines.join('\n')}\n\n【候选时间窗外的证据列表】\n${evidenceLines.join('\n')}`;
      const raw = await generateJsonWithPrompt(
          COUNTERSEARCH_PROMPT,
          llmContext,
          input.userId,
          4096
        );
        llmResult = safeParseCounterSearchResult(raw);
      if (llmResult !== null) generatedBy = 'llm';
    } catch {
      // LLM 失败：使用 fallback
      llmResult = null;
      generatedBy = 'fallback';
    }
  }

  // 应用反例结果
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let counterIds: string[] = [];

    if (llmResult) {
      const found = llmResult.find((r) => r.candidate_index === i);
      if (found && Array.isArray(found.counter_ids)) {
        // 验证 counter_ids 都属于 outsideEvidences
        counterIds = found.counter_ids.filter((id) =>
          outsideEvidences.some((e) => e.id === id)
        );
      }
    } else {
      // Fallback：关键词匹配
      counterIds = keywordMatchCounters(candidate, outsideEvidences);
    }
    candidate.counter_ids = counterIds;
  }

  updateDistillationJobStage(jobId, 'counter_search', {
    candidatesWithCounters: candidates.filter((c) => c.counter_ids.length > 0).length,
    totalCandidates: candidates.length,
    generatedBy,
  });

  return {
    stage: 4,
    name: 'counterSearch',
    status: 'success',
    output: { candidates, generatedBy },
    generatedBy,
  };
}

// ---------- 阶段 5: contextCheck ----------

/**
 * 阶段 5: 区分偏好与外部约束
 * 迁移门（升级门 2）：候选需通过情境适用性检查
 */
async function stage5_contextCheck(
  userId: string,
  candidates: PipelineCandidate[],
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'context_check');
  if (candidates.length === 0) {
    return {
      stage: 5,
      name: 'contextCheck',
      status: 'skipped',
      output: { reason: 'no candidates' },
      generatedBy: 'empty',
    };
  }

  const candidateLines = candidates.map((c, i) => {
    const supportEvidences = c.support_ids.map((id) => getEvidenceById(id)).filter((e): e is EvidenceRecord => e !== null);
    const supportStr = supportEvidences
      .map((e) => `id=${e.id} time=${e.occurred_at} content=${e.content_ref ?? ''}`)
      .join('; ');
    const counterStr = c.counter_ids.length > 0
      ? `counter_ids=${JSON.stringify(c.counter_ids)}`
      : 'no counters';
    return `[候选 ${i}] statement=${c.statement} | support=[${supportStr}] | ${counterStr}`;
  });

  let generatedBy: 'llm' | 'fallback' = 'fallback';
  let llmResult: Array<{
    candidate_index: number;
    is_preference?: boolean;
    context_exception?: string;
    passes_context_check?: boolean;
  }> | null = null;

  try {
    const llmContext = `【候选模式及其证据】\n${candidateLines.join('\n')}`;
    const raw = await generateJsonWithPrompt(
        CONTEXT_CHECK_PROMPT,
        llmContext,
        userId,
        4096
      );
      llmResult = safeParseContextCheckResult(raw);
    if (llmResult !== null) generatedBy = 'llm';
  } catch {
    llmResult = null;
    generatedBy = 'fallback';
  }

  // 应用情境检查结果
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let isPreference: boolean | null = null;
    let contextException: string | null = null;
    let passesCheck = true;  // 默认通过

    if (llmResult) {
      const found = llmResult.find((r) => r.candidate_index === i);
      if (found) {
        isPreference = typeof found.is_preference === 'boolean' ? found.is_preference : null;
        contextException = typeof found.context_exception === 'string' ? found.context_exception : null;
        passesCheck = typeof found.passes_context_check === 'boolean' ? found.passes_context_check : true;
      }
    } else {
      // Fallback：基于关键词的简单判断
      // 含「必须」「公司」「学校」「流程」等词 → 外部约束
      const lower = candidate.statement.toLowerCase();
      const constraintKeywords = ['必须', '公司', '学校', '流程', '要求', '需要', '不能不', '被迫', '不得不'];
      const isConstraint = constraintKeywords.some((k) => lower.includes(k.toLowerCase()));
      isPreference = !isConstraint;
      contextException = isConstraint ? '可能是外部环境约束，需用户确认' : null;
      passesCheck = !isConstraint;
    }
    candidate.is_preference = isPreference;
    candidate.context_exception = contextException;
    candidate.passes_context_check = passesCheck;
  }

  updateDistillationJobStage(jobId, 'context_check', {
    passedCount: candidates.filter((c) => c.passes_context_check).length,
    totalCount: candidates.length,
    generatedBy,
  });

  return {
    stage: 5,
    name: 'contextCheck',
    status: 'success',
    output: { candidates, generatedBy },
    generatedBy,
  };
}

// ---------- 阶段 6: independentReview ----------

/**
 * 阶段 6: 第二个提示词/模型只拿证据和候选，检查过度概括与来源错误
 */
async function stage6_independentReview(
  userId: string,
  candidates: PipelineCandidate[],
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'independent_review');
  if (candidates.length === 0) {
    return {
      stage: 6,
      name: 'independentReview',
      status: 'skipped',
      output: { reason: 'no candidates' },
      generatedBy: 'empty',
    };
  }

  const candidateLines = candidates.map((c, i) => {
    const supportStr = c.support_ids.join(',');
    const counterStr = c.counter_ids.length > 0 ? c.counter_ids.join(',') : '(无)';
    const ctxCheck = c.passes_context_check ? '通过' : '未通过';
    return `[候选 ${i}] statement=${c.statement} | support=[${supportStr}] | counter=[${counterStr}] | contextCheck=${ctxCheck}`;
  });

  let generatedBy: 'llm' | 'fallback' = 'fallback';
  let llmResult: Array<{
    candidate_index: number;
    review_state?: 'keep' | 'watch' | 'reject';
    issues?: string[];
    suggestions?: string[];
  }> | null = null;

  try {
    const llmContext = `【候选模式审查列表】\n${candidateLines.join('\n')}`;
    const raw = await generateJsonWithPrompt(
        INDEPENDENT_REVIEW_PROMPT,
        llmContext,
        userId,
        4096
      );
      llmResult = safeParseReviewResult(raw);
    if (llmResult !== null) generatedBy = 'llm';
  } catch {
    llmResult = null;
    generatedBy = 'fallback';
  }

  // 应用审查结果
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let reviewState: PatternReviewState = 'candidate';
    let issues: string[] = [];
    let suggestions: string[] = [];

    if (llmResult) {
      const found = llmResult.find((r) => r.candidate_index === i);
      if (found) {
        if (found.review_state === 'keep' || found.review_state === 'watch' || found.review_state === 'reject') {
          reviewState = found.review_state;
        }
        if (Array.isArray(found.issues)) issues = found.issues;
        if (Array.isArray(found.suggestions)) suggestions = found.suggestions;
      }
    } else {
      // Fallback：基于规则
      // - contextCheck 未通过 → reject
      // - support_ids 长度 < 2 → reject（重复门）
      // - 有反例但未通过情境检查 → watch
      // - 否则 → keep
      if (!candidate.passes_context_check) {
        reviewState = 'reject';
        issues.push('情境适用性检查未通过（可能是外部约束而非内在偏好）');
      } else if (candidate.support_ids.length < 2) {
        reviewState = 'reject';
        issues.push('支持证据不足（少于 2 条）');
      } else if (candidate.counter_ids.length > 0) {
        reviewState = 'watch';
        issues.push('存在反例，需用户审查');
      } else {
        reviewState = 'keep';
      }
      generatedBy = 'fallback';
    }
    candidate.review_state = reviewState;
    candidate.review_issues = issues;
    candidate.review_suggestions = suggestions;
  }

  updateDistillationJobStage(jobId, 'independent_review', {
    keepCount: candidates.filter((c) => c.review_state === 'keep').length,
    watchCount: candidates.filter((c) => c.review_state === 'watch').length,
    rejectCount: candidates.filter((c) => c.review_state === 'reject').length,
    generatedBy,
  });

  return {
    stage: 6,
    name: 'independentReview',
    status: 'success',
    output: { candidates, generatedBy },
    generatedBy,
  };
}

// ---------- 阶段 7: userGate ----------

/**
 * 阶段 7: 高影响认识必须给用户「像/不像/特殊情况/别再这样推断」入口
 * 用户解释门（升级门 4）：高影响候选需用户确认
 *
 * 高影响定义（spec SubTask 11.1）：
 *   review_state='keep' AND support_ids.length >= 3 AND contextCheck 通过
 *
 * 行为：
 *   - 高影响候选：写入 pattern_candidates 表，review_state='pending_user_review'
 *   - 低影响候选（keep 但 support<3 / watch / 其他）：进入阶段 8 commit
 *   - reject 候选：丢弃
 *
 * 注意（spec 严格规则 7）：userGate 必须真正等待用户反馈（不能自动通过）
 */
async function stage7_userGate(
  userId: string,
  candidates: PipelineCandidate[],
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'user_gate');
  if (candidates.length === 0) {
    return {
      stage: 7,
      name: 'userGate',
      status: 'skipped',
      output: { toCommit: [], pendingUserReview: [] },
      generatedBy: 'empty',
    };
  }

  const toCommit: PipelineCandidate[] = [];
  const pendingUserReview: PipelineCandidate[] = [];

  for (const candidate of candidates) {
    // reject 候选直接丢弃
    if (candidate.review_state === 'reject') continue;

    // 高影响判定
    const isHighImpact =
      candidate.review_state === 'keep' &&
      candidate.support_ids.length >= 3 &&
      candidate.passes_context_check;

    candidate.is_high_impact = isHighImpact;

    if (isHighImpact) {
      // 高影响候选：写入 pattern_candidates 表，标记为 'pending_user_review'
      // 真正等待用户反馈，不自动通过
      const contextExceptionNote = candidate.context_exception
        ? `\n[情境限制] ${candidate.context_exception}`
        : '';
      const issuesNote = candidate.review_issues.length > 0
        ? `\n[审查发现] ${candidate.review_issues.join('; ')}`
        : '';
      createPattern(userId, {
        statement: candidate.statement,
        scope: candidate.scope ?? undefined,
        support_ids: candidate.support_ids,
        counter_ids: candidate.counter_ids,
        alternative_explanations: candidate.alternative_explanations,
        recurrence_count: candidate.recurrence_count,
        domain_count: candidate.domain_count,
        review_state: 'pending_user_review',  // 等待用户审查
        user_note: `[userGate:高影响候选等待用户确认]${contextExceptionNote}${issuesNote}`,
      });
      pendingUserReview.push(candidate);
    } else {
      // 低影响候选：进入阶段 8 commit
      toCommit.push(candidate);
    }
  }

  audit(userId, 'distillation.user_gate', {
    jobId,
    highImpactCount: pendingUserReview.length,
    lowImpactCount: toCommit.length,
  });

  updateDistillationJobStage(jobId, 'user_gate', {
    pendingUserReviewCount: pendingUserReview.length,
    toCommitCount: toCommit.length,
  });

  return {
    stage: 7,
    name: 'userGate',
    status: 'success',
    output: { toCommit, pendingUserReview },
    generatedBy: 'empty',  // userGate 不调 LLM
  };
}

// ---------- 阶段 8: commit ----------

/**
 * 阶段 8: 通过后更新 Experience/Skill/ModelVersion 并写 change_log
 *
 * 失效条件门（升级门 5）：每条经验记录失效条件
 *
 * 步骤（spec SubTask 11.1）：
 * 1. INSERT pattern_candidates（review_state='keep' 或 'watch'）
 * 2. 若 support_ids.length >= 4，自动创建 experience_units（maturity='candidate'）
 * 3. 若 pattern 关联到 skill domain，更新 personal_skills.evidence_refs
 * 4. 创建 personal_model_versions 新版本（type='incremental'，change_summary='蒸馏 N 条候选'）
 */
async function stage8_commit(
  userId: string,
  payload: { toCommit: PipelineCandidate[]; pendingUserReview: PipelineCandidate[] },
  jobId: string
): Promise<DistillationStageResult> {
  updateDistillationJobStage(jobId, 'commit');
  const { toCommit } = payload;

  // 1. INSERT pattern_candidates（review_state='keep' 或 'watch'）
  // 即使 toCommit.length === 0（仅有 pendingUserReview 或真正空跑），
  // 也继续走完后续逻辑，在末尾统一创建 personal_model_versions 记录本次蒸馏运行。
  let experiencesCreated = 0;
  const committedPatternIds: string[] = [];
  for (const candidate of toCommit) {
    const pattern = createPattern(userId, {
      statement: candidate.statement,
      scope: candidate.scope ?? undefined,
      support_ids: candidate.support_ids,
      counter_ids: candidate.counter_ids,
      alternative_explanations: candidate.alternative_explanations,
      recurrence_count: candidate.recurrence_count,
      domain_count: candidate.domain_count,
      review_state: candidate.review_state === 'keep' ? 'keep' : 'watch',
      user_note: candidate.context_exception
        ? `[情境限制] ${candidate.context_exception}`
        : undefined,
    });
    committedPatternIds.push(pattern.id);

    // 2. 若 support_ids.length >= 4，自动创建 experience_units（maturity='candidate'）
    if (candidate.support_ids.length >= 4) {
      // 失效条件门：每条经验记录失效条件（写入 applicability 字段）
      const applicability = buildApplicability(candidate);
      createExperience(userId, {
        context: candidate.scope ?? undefined,
        problem: candidate.statement,
        actions: candidate.alternative_explanations,
        outcome: undefined,
        lesson: candidate.statement,
        support_ids: candidate.support_ids,
        counter_ids: candidate.counter_ids,
        applicability,
        maturity: 'candidate',  // 新经验默认 candidate，需后续 promoteExperience 升级
        last_validated_at: new Date().toISOString(),
        version: 1,
      });
      experiencesCreated++;
    }
  }

  // 3. 若 pattern 关联到 skill domain，更新 personal_skills.evidence_refs
  // 简单实现：检查是否已有同 scope 的 personal_skill；若无则跳过（不主动创建，避免无 user 确认的 skill）
  // 真实接入：Task 13 Personal Playbook 会扩展此处
  for (const candidate of toCommit) {
    if (!candidate.scope) continue;
    const existingSkill = getDb()
      .prepare('SELECT id, evidence_refs FROM personal_skills WHERE user_id = ? AND scope = ? LIMIT 1')
      .get(userId, candidate.scope) as { id: string; evidence_refs: string } | undefined;
    if (existingSkill) {
      const refs = safeParseStringArray(existingSkill.evidence_refs);
      const newRefs = Array.from(new Set([...refs, ...candidate.support_ids]));
      getDb()
        .prepare('UPDATE personal_skills SET evidence_refs = ? WHERE id = ?')
        .run(JSON.stringify(newRefs), existingSkill.id);
    }
  }

  // 4. 创建 personal_model_versions 新版本（type='incremental'）
  const newVersionNumber = countModelVersionsByUser(userId) + 1;
  const versionStr = `v0.0.${newVersionNumber}`;
  const activeVersion = getActiveModelVersion(userId);
  const snapshot = {
    type: 'incremental',
    base_version: activeVersion?.version ?? null,
    committed_patterns: committedPatternIds,
    pending_user_review: payload.pendingUserReview.map((c) => ({
      statement: c.statement,
      support_ids: c.support_ids,
      counter_ids: c.counter_ids,
    })),
    summary: `蒸馏 ${committedPatternIds.length} 条候选，新增 ${experiencesCreated} 条 candidate 经验`,
  };
  const changeLog = {
    type: 'incremental',
    change_summary: `蒸馏 ${committedPatternIds.length} 条候选`,
    candidates_committed: committedPatternIds.length,
    experiences_created: experiencesCreated,
    pending_user_review: payload.pendingUserReview.length,
    triggered_by: 'pipeline',
  };
  createModelVersion(userId, {
    version: versionStr,
    snapshot,
    change_log: changeLog,
  });

  audit(userId, 'distillation.commit', {
    jobId,
    committedPatterns: committedPatternIds.length,
    experiencesCreated,
    modelVersion: versionStr,
  });

  completeDistillationJobStage(jobId, {
    committedCount: committedPatternIds.length,
    experiencesCreated,
    modelVersionCreated: true,
    modelVersion: versionStr,
  });

  return {
    stage: 8,
    name: 'commit',
    status: 'success',
    output: { committedCount: committedPatternIds.length, modelVersion: versionStr },
    generatedBy: 'empty',  // commit 不调 LLM
  };
}

// ---------- 内部工具函数 ----------

/** 安全解析候选数组（LLM 输出） */
function safeParseCandidateArray(raw: string): Array<{
  statement: string;
  scope?: string;
  support_ids?: string[];
  alternative_explanations?: string[];
  domain_count?: number;
}> {
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(cleaned);
    if (!Array.isArray(obj)) return [];
    return obj.filter((x) => x && typeof x === 'object');
  } catch {
    return [];
  }
}

/** 安全解析反例检索结果（LLM 输出） */
function safeParseCounterSearchResult(raw: string): Array<{
  candidate_index: number;
  counter_ids: string[];
  reasoning?: string;
}> | null {
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(cleaned);
    if (!Array.isArray(obj)) return null;
    return obj.filter((x) => x && typeof x === 'object' && typeof x.candidate_index === 'number');
  } catch {
    return null;
  }
}

/** 安全解析情境检查结果（LLM 输出） */
function safeParseContextCheckResult(raw: string): Array<{
  candidate_index: number;
  is_preference?: boolean;
  context_exception?: string;
  passes_context_check?: boolean;
}> | null {
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(cleaned);
    if (!Array.isArray(obj)) return null;
    return obj.filter((x) => x && typeof x === 'object' && typeof x.candidate_index === 'number');
  } catch {
    return null;
  }
}

/** 安全解析独立审查结果（LLM 输出） */
function safeParseReviewResult(raw: string): Array<{
  candidate_index: number;
  review_state?: 'keep' | 'watch' | 'reject';
  issues?: string[];
  suggestions?: string[];
}> | null {
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(cleaned);
    if (!Array.isArray(obj)) return null;
    return obj.filter((x) => x && typeof x === 'object' && typeof x.candidate_index === 'number');
  } catch {
    return null;
  }
}

/** 安全解析字符串数组 */
function safeParseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 统计证据的不同时间段数量（用于「重复门」检查）。
 * 时间段定义：按天分组（同一 day 视为同一时间段）。
 */
function countDistinctTimeBuckets(evidences: EvidenceRecord[]): number {
  const buckets = new Set<string>();
  for (const e of evidences) {
    // 截取到天：YYYY-MM-DD
    buckets.add(e.occurred_at.slice(0, 10));
  }
  return buckets.size;
}

/**
 * Fallback 候选模式抽取（当 LLM 不可用时）。
 *
 * 规则：
 * - 按 evidence_type 聚类（fact / self_report / outcome）
 * - 同类型证据 >= 2 条且来自 >= 2 个不同时间段 → 生成一个候选
 * - 候选 statement 自动生成，使用不确定语气
 */
function fallbackCandidateExtraction(evidences: EvidenceRecord[]): Array<{
  statement: string;
  scope?: string;
  support_ids?: string[];
  alternative_explanations?: string[];
  domain_count?: number;
}> {
  // 按日期分桶
  const byDay = new Map<string, EvidenceRecord[]>();
  for (const e of evidences) {
    const day = e.occurred_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }
  if (byDay.size < 2) return [];  // 至少需要 2 个不同时间段

  // 按 evidence_type 聚类
  const byType = new Map<string, EvidenceRecord[]>();
  for (const e of evidences) {
    if (!byType.has(e.evidence_type)) byType.set(e.evidence_type, []);
    byType.get(e.evidence_type)!.push(e);
  }

  const result: Array<{
    statement: string;
    scope?: string;
    support_ids?: string[];
    alternative_explanations?: string[];
    domain_count?: number;
  }> = [];

  for (const [type, group] of byType.entries()) {
    if (group.length < 2) continue;
    // 检查是否有 >= 2 个不同时间段
    const days = new Set(group.map((e) => e.occurred_at.slice(0, 10)));
    if (days.size < 2) continue;

    // 取前 5 条作为支持
    const support = group.slice(0, 5);
    result.push({
      statement: `可能存在与「${type}」相关的反复出现的模式（基于 ${group.length} 条记录）`,
      scope: `${type} 相关情境`,
      support_ids: support.map((e) => e.id),
      alternative_explanations: [
        '可能只是巧合，没有深层规律',
        '可能是外部环境约束导致的反复出现',
      ],
      domain_count: 1,
    });
    if (result.length >= 3) break;  // 最多 3 条
  }
  return result;
}

/**
 * 关键词匹配反例（fallback 反例检索）。
 *
 * 策略：
 * - 从候选 statement 中提取关键词
 * - 在候选时间窗外证据中搜索含相同关键词但 evidence_type='correction' 或 'outcome' 的相反记录
 * - 也匹配含「不」「没」「失败」「没成功」「相反」等否定/反义关键词的证据
 */
function keywordMatchCounters(
  candidate: PipelineCandidate,
  outsideEvidences: EvidenceRecord[]
): string[] {
  const counters: string[] = [];
  // 提取候选 statement 的关键词（取前 4 个非停用词）
  const statement = candidate.statement;
  // 简单分词：按标点和空格切分
  const keywords = statement
    .replace(/[，。、！？!?,.\s（）()【】\[\]「」""]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && w.length <= 8)
    .slice(0, 4);

  // 否定/反义关键词
  const negationKeywords = ['不', '没', '失败', '相反', '未', '反向', '无效', '错误'];

  for (const ev of outsideEvidences) {
    const content = ev.content_ref ?? '';
    if (!content) continue;
    // 不能在 support_ids 中（避免自引用）
    if (candidate.support_ids.includes(ev.id)) continue;

    // 匹配条件 1：含否定/反义关键词
    if (negationKeywords.some((k) => content.includes(k))) {
      // 且与候选 statement 有相同关键词
      if (keywords.some((k) => content.includes(k))) {
        counters.push(ev.id);
        continue;
      }
    }

    // 匹配条件 2：evidence_type='correction' 且与候选关键词相关
    if (ev.evidence_type === 'correction' && keywords.some((k) => content.includes(k))) {
      counters.push(ev.id);
      continue;
    }
  }
  return counters;
}

/**
 * 构建经验的失效条件（失效条件门，升级门 5）。
 *
 * 失效条件写入 experience_units.applicability 字段。
 */
function buildApplicability(candidate: PipelineCandidate): string {
  const parts: string[] = [];
  parts.push('适用情境：' + (candidate.scope ?? '未指定'));
  if (candidate.context_exception) {
    parts.push('情境限制：' + candidate.context_exception);
  }
  if (candidate.counter_ids.length > 0) {
    parts.push(`已知反例：${candidate.counter_ids.length} 条`);
  }
  // 失效条件（spec SubTask 11.4 升级门 5）
  parts.push('失效条件：30 天内无新证据 → 自动降级为 stale');
  parts.push('生活阶段明显变化 → 重新评估适用性');
  return parts.join(' | ');
}

/** 阶段 8 内部辅助：完成 job stage（不调用 completeDistillationJob，由调用方统一处理） */
function completeDistillationJobStage(
  jobId: string,
  result: Record<string, unknown>
): void {
  updateDistillationJobStage(jobId, 'commit', result);
}

// ---------- 公共辅助：从 distillation_jobs 恢复执行 ----------

/**
 * 从 distillation_jobs 恢复执行：根据 job 的 input_scope 重新构造 DistillationInput，
 * 从头执行 8 阶段（idempotent）。
 *
 * worker 调用此函数恢复 pending/in-progress 的任务。
 */
export async function resumeDistillationJob(jobId: string): Promise<DistillationPipelineResult> {
  const job = getDistillationJobById(jobId);
  if (!job) {
    throw new Error(`distillation job not found: ${jobId}`);
  }
  if (job.stage === 'done') {
    const r = job.result ?? {};
    return {
      jobId,
      stages: [],
      candidatesCommitted: (r.candidatesCommitted as number) ?? 0,
      candidatesPendingUserReview: (r.candidatesPendingUserReview as number) ?? 0,
      modelVersion: (r.modelVersion as string | null) ?? null,
    };
  }
  if (job.stage === 'error') {
    throw new Error(`distillation job already failed: ${job.error}`);
  }
  // 重新构造输入并从头执行（pipeline 内部 idempotent：再次创建 job record）
  // 简化策略：worker 调用此函数时，先创建一个新 job（数据相同），跑完后将旧 job 标记为 done。
  // 这样保证幂等性 + 可重试。
  const input: DistillationInput = {
    userId: job.user_id,
    timeWindow: job.input_scope?.timeWindow ?? defaultTimeWindow(),
    project: job.input_scope?.project,
    topic: job.input_scope?.topic,
    trigger: job.trigger,
  };
  // 标记旧 job 为正在重试
  const retryCount = incrementDistillationJobRetry(jobId);
  // 执行新 pipeline
  const result = await runDistillationPipeline(input);
  // 将旧 job 标记为 done（与 result 同步）
  completeDistillationJob(jobId, {
    resumedFromJobId: result.jobId,
    retryCount,
    ...result,
  });
  return result;
}

/** 默认时间窗：最近 7 天 */
function defaultTimeWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
