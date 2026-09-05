/**
 * 每日清理 idempotency 表 24h 前旧 key（V4.3 §10 路线图 A27.3，spec SubTask 27.4）
 *
 * idempotency 表用于 P0-5 接口幂等去重，相同 key 在 24h 内重复提交视为重复。
 * 超过 24h 的 key 不再参与去重判断，应定时清理，避免表无界增长（M10.4）。
 *
 * 注意：
 * - 不修改 db.ts，通过 getDb() 获取数据库实例。
 * - 所有 SQL 使用 prepared statement。
 * - 失败时记录 console.error，不抛出。
 *
 * 严格规则：
 * - 不引入额外依赖（仅用 setInterval / clearInterval）
 * - 单实例运行（避免重复启动）
 */
import { getDb } from '../db.js';

/** 清理阈值：24h 前的记录（与 idempotencyCheck 的 cutoff 一致） */
const RETENTION_HOURS = 24;

/** 扫描间隔：24 小时（spec SubTask 27.4） */
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动 idempotency 清理任务：首次启动后立即跑一次，然后每 24 小时一次。
 * 返回 stop 函数，调用后停止任务。
 */
export function startIdempotencyCleanupJob(intervalMs: number = SCAN_INTERVAL_MS): () => void {
  if (cleanupTimer) {
    console.warn('  [idempotencyCleanup] 已在运行，忽略重复启动');
    return stopIdempotencyCleanupJob;
  }
  console.log(`  [idempotencyCleanup] 已启动，扫描间隔 ${Math.round(intervalMs / 3600000)}h`);
  // 立即跑一次，再设置定时器
  setTimeout(() => {
    runCleanup().catch((e) => console.error('  [idempotencyCleanup] 初始清理失败:', e?.message ?? e));
  }, 0);
  cleanupTimer = setInterval(() => {
    runCleanup().catch((e) => console.error('  [idempotencyCleanup] 清理失败:', e?.message ?? e));
  }, intervalMs);
  return stopIdempotencyCleanupJob;
}

/** 停止 idempotency 清理任务 */
export function stopIdempotencyCleanupJob(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('  [idempotencyCleanup] 已停止');
  }
}

/**
 * 执行一次清理：删除 idempotency 表中 created_at 早于 24h 前的记录。
 * 使用 prepared statement，记录清理的行数到 console.log。
 */
async function runCleanup(): Promise<void> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM idempotency WHERE created_at < ?').run(cutoff);
    const deleted = Number(result.changes);
    console.log(`  [idempotencyCleanup] 已清理 ${deleted} 条 24h 前的 idempotency 记录`);
  } catch (e: any) {
    console.error('  [idempotencyCleanup] 清理失败:', e?.message ?? e);
  }
}
