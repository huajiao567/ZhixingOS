/**
 * Hypothesis 到期复审提醒（V4.3 §10 路线图 A27.1，spec SubTask 27.2）
 *
 * 用 node 内置 setInterval 每 24 小时扫描 hypotheses 表中 review_at <= now
 * 且 status 处于开放状态（'open' / 'candidate'）的记录，输出提醒并写审计日志。
 *
 * 设计原则（spec Task 27.2 严格规则）：
 * - 不引入额外依赖（仅用 setInterval / clearInterval）
 * - 单实例运行（避免重复启动）
 * - 不自动修改 hypothesis 状态 —— 用户需主动复审
 *   （系统误改 status 会破坏用户主权，spec V4.3 §4.20 / §6.19）
 * - 失败时记录 console.error，不抛出
 * - 所有 SQL 在 db.ts 的辅助函数中通过 prepared statement 执行
 *
 * 提醒输出：
 * - 当前通过 console.log 输出（后续可接入通知系统，spec Task 27.2 留接口）
 * - 同时调用 audit(userId, 'hypothesis.review_due', ...) 写审计日志
 *
 * 接入方式（由 backend/src/scheduler/index.ts 调用）：
 *   import { startHypothesisReviewReminderJob } from '../services/hypothesisReviewReminder.js';
 *   const stop = startHypothesisReviewReminderJob();
 *   // 进程退出时：stop();
 */
import { getHypothesesDueForReview, audit } from '../db.js';

/** 扫描间隔：24 小时（spec SubTask 27.2：每日凌晨扫描） */
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

let reminderTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动 hypothesis 到期复审提醒任务：首次启动后立即跑一次，然后每 24 小时一次。
 *
 * @param intervalMs 扫描间隔（毫秒），默认 24h，可注入较小值用于测试
 * @returns stop 函数，调用后停止任务
 */
export function startHypothesisReviewReminderJob(intervalMs: number = SCAN_INTERVAL_MS): () => void {
  if (reminderTimer) {
    console.warn('  [hypothesisReviewReminder] 已在运行，忽略重复启动');
    return stopHypothesisReviewReminderJob;
  }
  console.log(
    `  [hypothesisReviewReminder] 已启动，扫描间隔 ${
      intervalMs >= 3600000 ? `${Math.round(intervalMs / 3600000)}h` : `${Math.round(intervalMs / 1000)}s`
    }`
  );
  // 立即跑一次，再设置定时器（与 backup / idempotencyCleanup 一致）
  setTimeout(() => {
    runScan().catch((e) =>
      console.error('  [hypothesisReviewReminder] 初始扫描失败:', e?.message ?? e)
    );
  }, 0);
  reminderTimer = setInterval(() => {
    runScan().catch((e) =>
      console.error('  [hypothesisReviewReminder] 扫描失败:', e?.message ?? e)
    );
  }, intervalMs);
  return stopHypothesisReviewReminderJob;
}

/** 停止 hypothesis 到期复审提醒任务 */
export function stopHypothesisReviewReminderJob(): void {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
    console.log('  [hypothesisReviewReminder] 已停止');
  }
}

/**
 * 执行一次扫描：取出所有到期需复审的 hypothesis，写审计 + 输出提醒。
 *
 * 流程：
 * 1. 调用 getHypothesesDueForReview(now) 取到期项
 * 2. 对每条：
 *    - audit(userId, 'hypothesis.review_due', { hypothesisId, statement, reviewAt, status })
 *    - console.log 输出提醒（后续可接入通知系统）
 * 3. 不修改 hypothesis 状态 —— 用户需主动复审
 *
 * 错误处理：try/catch 捕获所有异常，console.error 记录，不抛出。
 */
async function runScan(now: Date = new Date()): Promise<void> {
  try {
    const due = getHypothesesDueForReview(now);
    if (due.length === 0) {
      console.log('  [hypothesisReviewReminder] 无到期需复审的 hypothesis');
      return;
    }
    console.log(
      `  [hypothesisReviewReminder] 发现 ${due.length} 条到期需复审的 hypothesis`
    );
    for (const row of due) {
      try {
        audit(row.user_id, 'hypothesis.review_due', {
          hypothesisId: row.id,
          statement: row.statement,
          reviewAt: row.review_at,
          status: row.status,
        });
        console.log(
          `  [hypothesisReviewReminder] 提醒: hypothesis ${row.id} 已到期需复审 ` +
            `(review_at=${row.review_at}, status=${row.status}): ${row.statement}`
        );
      } catch (e: any) {
        // 单条记录失败不影响其他记录处理
        console.error(
          `  [hypothesisReviewReminder] 处理 hypothesis ${row.id} 失败:`,
          e?.message ?? e
        );
      }
    }
  } catch (e: any) {
    console.error('  [hypothesisReviewReminder] 扫描失败:', e?.message ?? e);
  }
}
