/**
 * 删除级联重算服务（V4.3 §8.10 / §7.7，spec A5 / Task 6）
 *
 * 当一条 Evidence 被删除时，所有引用该 Evidence 的派生对象（Pattern / Experience /
 * PersonalSkill / MetaPrinciple）必须按 spec A4.4 经验状态机执行降级或失效：
 *
 * 降级规则（spec A4.4 / A2.2，状态只能向降级方向移动，不可跳级）：
 * - Experience maturity: validated → repeated → observed → candidate → stale
 *   - 剩余 support_ids 长度 == 0 → stale（失效）
 *   - 剩余 support_ids 长度 == 1（< 2）→ 降级一级
 *   - 剩余 support_ids 长度 >= 2 → 不变
 * - Pattern review_state: keep → watch → candidate → reject
 *   - 剩余 support_ids 长度 == 0 → reject（失效）
 *   - 剩余 support_ids 长度 == 1（< 2）→ 降级一级
 *   - 剩余 support_ids 长度 >= 2 → 不变
 * - MetaPrinciple status: 同 Pattern
 * - PersonalSkill: 无 status 字段，仅清理 evidence_refs 引用
 *
 * 注意：
 * - evidenceId 可能同时出现在 support_ids 和 counter_ids 中。从 counter_ids 移除
 *   不触发降级（反证减少不削弱模式），仅从 support_ids 移除才触发降级。
 * - 审计日志只保存 ID 与状态变化，不保存原文（spec A5.4）。
 * - LLM 缓存清理采用保守策略：删除该用户过去 7 天的所有 llm_cache 项。
 */
import {
  getDependents,
  getEvidenceById,
  audit,
  clearUserCacheRecent,
  updatePatternReviewStateAndSupportIds,
  updateExperienceMaturityAndSupportIds,
  updatePersonalSkillEvidenceRefs,
  updateMetaPrincipleEvidence,
} from '../db.js';
import type {
  ExperienceMaturity,
  PatternReviewState,
  MetaPrincipleStatus,
} from '../types.js';

/** 级联重算结果（spec Task 6.1） */
export interface RecomputeResult {
  evidenceId: string;
  userId: string;
  recomputedCount: number;
  degraded: Array<{
    type: 'pattern' | 'experience' | 'skill' | 'metaPrinciple';
    id: string;
    from: string;
    to: string;
  }>;
  invalidated: Array<{ type: 'pattern' | 'experience'; id: string }>;
  llmCacheCleared: number;
}

/** 降级阈值：剩余 support_ids 长度 < 2 时触发降级（spec SubTask 6.2） */
const DOWNGRADE_THRESHOLD = 2;

/** LLM 缓存清理窗口（天）—— 保守策略（spec SubTask 6.3） */
const LLM_CACHE_CLEAR_DAYS = 7;

/**
 * Experience maturity 降级映射（降级一级，不可跳级）。
 * candidate / stale / retired 已是最低或终态，不再降级。
 */
function downgradeExperienceMaturity(
  current: ExperienceMaturity
): ExperienceMaturity | null {
  switch (current) {
    case 'validated':
      return 'repeated';
    case 'repeated':
      return 'observed';
    case 'observed':
      return 'candidate';
    // candidate 不再降级（只有 support=0 时才直接到 stale）
    case 'candidate':
    case 'stale':
    case 'retired':
      return null;
  }
}

/**
 * Pattern review_state 降级映射（降级一级，不可跳级）。
 * candidate / stale / reject 已是最低或终态，不再降级。
 */
function downgradePatternReviewState(
  current: PatternReviewState
): PatternReviewState | null {
  switch (current) {
    case 'keep':
      return 'watch';
    case 'watch':
      return 'candidate';
    // candidate 不再降级（只有 support=0 时才直接到 reject）
    case 'candidate':
    case 'stale':
    case 'reject':
      return null;
    // pending_user_review 等待用户裁决，不参与自动降级
    case 'pending_user_review':
      return null;
  }
}

/**
 * MetaPrinciple status 降级映射（同 Pattern）。
 */
function downgradeMetaPrincipleStatus(
  current: MetaPrincipleStatus
): MetaPrincipleStatus | null {
  switch (current) {
    case 'keep':
      return 'watch';
    case 'watch':
      return 'candidate';
    case 'candidate':
    case 'stale':
    case 'reject':
      return null;
  }
}

/**
 * 清理该用户的 LLM 缓存（保守策略：删除过去 7 天）。
 * llm_cache.key 格式为 `${userId}:${sha(key)}`，用 LIKE 精确匹配用户前缀。
 */
function clearLlmCacheForUser(userId: string): number {
  return clearUserCacheRecent(userId, LLM_CACHE_CLEAR_DAYS);
}

/**
 * 从数组中移除指定元素（返回新数组，不修改原数组）。
 * 若元素不存在则返回原数组的副本。
 */
function removeFromArray(arr: string[], id: string): { result: string[]; removed: boolean } {
  const idx = arr.indexOf(id);
  if (idx === -1) return { result: [...arr], removed: false };
  const result = [...arr];
  result.splice(idx, 1);
  return { result, removed: true };
}

/**
 * 删除级联重算（spec A5 / Task 6 完整实现）。
 *
 * 流程：
 * 1. 查 evidence_records 取 user_id（若记录不存在则返回空结果）
 * 2. 查所有引用该 evidence 的派生对象（getDependents）
 * 3. 对每行：从 support_ids / counter_ids / evidence_refs / evidence / counterevidence
 *    中移除 evidenceId，并按 spec A4.4 状态机降级或失效
 * 4. 调 clearLlmCacheForUser(userId) 清理 LLM 缓存
 * 5. 审计日志记录级联操作（不保存原文）
 * 6. 返回 RecomputeResult
 */
export function recomputeDependents(evidenceId: string): RecomputeResult {
  // 1. 查 evidence_records 取 user_id
  const evidence = getEvidenceById(evidenceId);
  if (!evidence) {
    // evidence 记录不存在（可能已被硬删除），返回空结果
    return {
      evidenceId,
      userId: '',
      recomputedCount: 0,
      degraded: [],
      invalidated: [],
      llmCacheCleared: 0,
    };
  }
  const userId = evidence.user_id;

  // 2. 查所有引用该 evidence 的派生对象
  const dependents = getDependents(evidenceId);

  const degraded: RecomputeResult['degraded'] = [];
  const invalidated: RecomputeResult['invalidated'] = [];
  let recomputedCount = 0;

  // 3. 处理 pattern_candidates
  for (const pattern of dependents.patterns) {
    const supportResult = removeFromArray(pattern.support_ids, evidenceId);
    const counterResult = removeFromArray(pattern.counter_ids, evidenceId);
    const newSupportIds = supportResult.result;
    const newCounterIds = counterResult.result;
    const wasInSupport = supportResult.removed;

    // 若 evidenceId 不在 support_ids 也不在 counter_ids（理论上不应发生），跳过
    if (!supportResult.removed && !counterResult.removed) continue;

    recomputedCount++;

    // 仅当 evidenceId 在 support_ids 中时才触发降级
    if (wasInSupport) {
      const oldState = pattern.review_state;
      let newState: PatternReviewState = oldState;

      if (newSupportIds.length === 0) {
        // 失效：support_ids 为空
        newState = 'reject';
        invalidated.push({ type: 'pattern', id: pattern.id });
      } else if (newSupportIds.length < DOWNGRADE_THRESHOLD) {
        // 降级一级
        const downgraded = downgradePatternReviewState(oldState);
        if (downgraded) {
          newState = downgraded;
        }
      }

      // 原子更新 review_state + support_ids + counter_ids
      updatePatternReviewStateAndSupportIds(pattern.id, newState, newSupportIds, newCounterIds);

      if (newState !== oldState) {
        degraded.push({
          type: 'pattern',
          id: pattern.id,
          from: oldState,
          to: newState,
        });
      }
    } else {
      // evidenceId 仅在 counter_ids 中：仅清理引用，不降级
      updatePatternReviewStateAndSupportIds(
        pattern.id,
        pattern.review_state,
        pattern.support_ids,
        newCounterIds
      );
    }
  }

  // 4. 处理 experience_units
  for (const exp of dependents.experiences) {
    const supportResult = removeFromArray(exp.support_ids, evidenceId);
    const counterResult = removeFromArray(exp.counter_ids, evidenceId);
    const newSupportIds = supportResult.result;
    const newCounterIds = counterResult.result;
    const wasInSupport = supportResult.removed;

    if (!supportResult.removed && !counterResult.removed) continue;

    recomputedCount++;

    if (wasInSupport) {
      const oldMaturity = exp.maturity;
      let newMaturity: ExperienceMaturity = oldMaturity;

      if (newSupportIds.length === 0) {
        // 失效：support_ids 为空
        newMaturity = 'stale';
        invalidated.push({ type: 'experience', id: exp.id });
      } else if (newSupportIds.length < DOWNGRADE_THRESHOLD) {
        // 降级一级
        const downgraded = downgradeExperienceMaturity(oldMaturity);
        if (downgraded) {
          newMaturity = downgraded;
        }
      }

      // 原子更新 maturity + support_ids + counter_ids
      updateExperienceMaturityAndSupportIds(exp.id, newMaturity, newSupportIds, newCounterIds);

      if (newMaturity !== oldMaturity) {
        degraded.push({
          type: 'experience',
          id: exp.id,
          from: oldMaturity,
          to: newMaturity,
        });
      }
    } else {
      // evidenceId 仅在 counter_ids 中：仅清理引用，不降级
      updateExperienceMaturityAndSupportIds(
        exp.id,
        exp.maturity,
        exp.support_ids,
        newCounterIds
      );
    }
  }

  // 5. 处理 personal_skills（无 status 字段，仅清理 evidence_refs）
  for (const skill of dependents.skills) {
    const refsResult = removeFromArray(skill.evidence_refs, evidenceId);
    if (!refsResult.removed) continue;

    recomputedCount++;
    const oldCount = skill.evidence_refs.length;
    const newCount = refsResult.result.length;
    updatePersonalSkillEvidenceRefs(skill.id, refsResult.result);

    // personal_skills 无状态字段，用 refs 计数变化记录到 degraded
    degraded.push({
      type: 'skill',
      id: skill.id,
      from: `${oldCount} refs`,
      to: `${newCount} refs`,
    });
  }

  // 6. 处理 meta_principles
  for (const mp of dependents.metaPrinciples) {
    const evidenceResult = removeFromArray(mp.evidence, evidenceId);
    const counterEvidenceResult = removeFromArray(mp.counterevidence, evidenceId);
    const newEvidence = evidenceResult.result;
    const newCounterEvidence = counterEvidenceResult.result;
    const wasInEvidence = evidenceResult.removed;

    if (!evidenceResult.removed && !counterEvidenceResult.removed) continue;

    recomputedCount++;

    if (wasInEvidence) {
      const oldStatus = mp.status;
      let newStatus: MetaPrincipleStatus = oldStatus;

      if (newEvidence.length === 0) {
        // 失效：evidence 为空
        newStatus = 'reject';
      } else if (newEvidence.length < DOWNGRADE_THRESHOLD) {
        // 降级一级
        const downgraded = downgradeMetaPrincipleStatus(oldStatus);
        if (downgraded) {
          newStatus = downgraded;
        }
      }

      updateMetaPrincipleEvidence(mp.id, newEvidence, newCounterEvidence, newStatus);

      if (newStatus !== oldStatus) {
        degraded.push({
          type: 'metaPrinciple',
          id: mp.id,
          from: oldStatus,
          to: newStatus,
        });
      }
    } else {
      // evidenceId 仅在 counterevidence 中：仅清理引用，不降级
      updateMetaPrincipleEvidence(
        mp.id,
        mp.evidence,
        newCounterEvidence,
        mp.status
      );
    }
  }

  // 7. 清理 LLM 缓存（保守策略：该用户过去 7 天）
  const llmCacheCleared = clearLlmCacheForUser(userId);

  // 8. 审计日志（不保存原文，只保存 ID 与状态变化）
  audit(userId, 'evidence.cascade_recompute', {
    evidenceId,
    recomputedCount,
    degraded: degraded.map((d) => ({ type: d.type, id: d.id, from: d.from, to: d.to })),
    invalidated: invalidated.map((i) => ({ type: i.type, id: i.id })),
    llmCacheCleared,
  });

  return {
    evidenceId,
    userId,
    recomputedCount,
    degraded,
    invalidated,
    llmCacheCleared,
  };
}
