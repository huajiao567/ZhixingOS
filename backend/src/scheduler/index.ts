/**
 * 统一定时任务调度器入口（V4.3 §10 路线图 A27，spec Task 27.1）
 *
 * 使用 node 内置 setInterval 统一管理多个定时任务，不引入额外依赖。
 *
 * 接入方式（由后续任务在 backend/src/index.ts 中调用）：
 *   import { startScheduler, stopScheduler } from './scheduler/index.js';
 *   // 在 server.listen 回调中：
 *   startScheduler();
 *   // 在进程退出时（可选）：
 *   stopScheduler();
 *
 * 当前已接入的子任务：
 *   - startDistillationWorker()     —— distillation_jobs 队列消费（Task 27.5 / SubTask 11.5）
 *   - startBackupJob()              —— 每日 SQLite 备份（Task 27.3 / A27.2）
 *   - startIdempotencyCleanupJob()  —— 每日 idempotency 表清理（Task 27.4 / A27.3）
 *   - startHypothesisReviewReminderJob() —— hypothesis 到期复审提醒（Task 27.2 / A27.1）
 *
 * 严格规则：
 * - 不引入额外依赖（仅用 setInterval / clearInterval）
 * - 单实例运行（startScheduler 重复调用会被忽略）
 * - 各子任务的 start 函数均返回 stop 函数，stopScheduler 依次调用
 */
import { startDistillationWorker, stopDistillationWorker } from './distillationWorker.js';
import { startBackupJob, stopBackupJob } from '../services/backup.js';
import {
  startIdempotencyCleanupJob,
  stopIdempotencyCleanupJob,
} from '../services/idempotencyCleanup.js';
import {
  startHypothesisReviewReminderJob,
  stopHypothesisReviewReminderJob,
} from '../services/hypothesisReviewReminder.js';
import { config } from '../config.js';

/** 已注册的 stop 函数列表（startScheduler 时填充，stopScheduler 时清空） */
const stopFns: Array<() => void> = [];

/** 调度器是否已启动（避免重复启动） */
let started = false;

/**
 * 启动所有定时任务。
 * 重复调用会被忽略并打印警告。
 */
export function startScheduler(): void {
  if (started) {
    console.warn('  [scheduler] 已启动，忽略重复调用');
    return;
  }
  started = true;
  console.log('  [scheduler] 启动定时任务...');

  // 1. Distillation Worker（Task 27.5 / SubTask 11.5）
  stopFns.push(startDistillationWorker());

  // 2. 每日 SQLite 备份（Task 27.3 / A27.2）
  if (config.backupEnabled) {
    stopFns.push(startBackupJob());
  } else {
    console.log('  [backupJob] 已通过 BACKUP_ENABLED=false 禁用');
  }

  // 3. 每日 idempotency 表清理（Task 27.4 / A27.3）
  stopFns.push(startIdempotencyCleanupJob());

  // 4. Hypothesis 到期复审提醒（Task 27.2 / A27.1）
  stopFns.push(startHypothesisReviewReminderJob());

  console.log('  [scheduler] 所有定时任务已启动');
}

/**
 * 停止所有定时任务。
 * 依次调用各子任务的 stop 函数，失败不影响其他任务停止。
 */
export function stopScheduler(): void {
  if (!started) return;
  console.log('  [scheduler] 停止定时任务...');
  for (const stop of stopFns) {
    try {
      stop();
    } catch (e: any) {
      console.error('  [scheduler] 停止任务失败:', e?.message ?? e);
    }
  }
  stopFns.length = 0;
  started = false;
  console.log('  [scheduler] 所有定时任务已停止');
}
