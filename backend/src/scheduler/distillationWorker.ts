/**
 * Distillation Worker（V4.3 §4.18，spec SubTask 11.5 / Task 27.5）
 *
 * 用 node 内置 setInterval 每分钟扫描 distillation_jobs 表中 stage='pending'
 * 的任务，调用 runDistillationPipeline 恢复执行。
 *
 * 失败任务重试 3 次后标记为 failed。
 *
 * 注意（spec SubTask 11.5）：
 * - distillationWorker 应在 Task 27（定时任务）中正式接入 scheduler，
 *   但本任务先实现独立 worker 模块，Task 27 接入即可。
 * - 在 backend/src/index.ts 中调用 startDistillationWorker() 启动（与 server.listen 并行）
 *
 * 严格规则：
 * - 不引入额外依赖（仅用 setInterval / clearInterval）
 * - 单实例运行（避免并发跑同一个 job）
 * - 失败任务重试 3 次后 failDistillationJob
 * - 所有 SQL 用 prepared statement
 */
import {
  getPendingDistillationJobs,
  getDistillationJobById,
  failDistillationJob,
  audit,
} from '../db.js';
import { resumeDistillationJob } from '../services/distillation/pipeline.js';

/** worker 扫描间隔：1 分钟（spec SubTask 11.5） */
const SCAN_INTERVAL_MS = 60 * 1000;

/** 最大重试次数（spec SubTask 11.5） */
const MAX_RETRIES = 3;

/** 正在处理的 jobId 集合（避免并发跑同一个 job） */
const inFlightJobs = new Set<string>();

let workerTimer: ReturnType<typeof setInterval> | null = null;
let isScanning = false;

/**
 * 启动 distillation worker：每分钟扫描 pending 任务并执行。
 * 返回 stop 函数，调用后停止 worker。
 */
export function startDistillationWorker(intervalMs: number = SCAN_INTERVAL_MS): () => void {
  if (workerTimer) {
    console.warn('  [distillationWorker] 已在运行，忽略重复启动');
    return stopDistillationWorker;
  }
  console.log(`  [distillationWorker] 已启动，扫描间隔 ${Math.round(intervalMs / 1000)}s`);
  // 立即跑一次，再设置定时器
  setTimeout(() => scanOnce().catch((e) => console.error('  [distillationWorker] 初始扫描失败:', e)), 0);
  workerTimer = setInterval(() => {
    scanOnce().catch((e) => console.error('  [distillationWorker] 扫描失败:', e));
  }, intervalMs);
  return stopDistillationWorker;
}

/** 停止 distillation worker */
export function stopDistillationWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log('  [distillationWorker] 已停止');
  }
}

/**
 * 扫描一次 pending 任务并尝试执行。
 *
 * 流程：
 * 1. 调用 getPendingDistillationJobs(limit=10) 取待处理任务
 * 2. 对每个任务：
 *    - 若 jobId 已在 inFlightJobs 中，跳过
 *    - 加入 inFlightJobs
 *    - 调用 resumeDistillationJob(jobId) 恢复执行
 *    - 失败时检查 retry_count：≥ MAX_RETRIES 则 failDistillationJob
 *    - finally：从 inFlightJobs 中移除
 */
async function scanOnce(): Promise<void> {
  if (isScanning) {
    // 上一次扫描还在进行中，跳过本次（避免重叠）
    return;
  }
  isScanning = true;
  try {
    const pendingJobs = getPendingDistillationJobs(10);
    if (pendingJobs.length === 0) return;
    console.log(`  [distillationWorker] 发现 ${pendingJobs.length} 个待处理 distillation 任务`);

    for (const job of pendingJobs) {
      if (inFlightJobs.has(job.id)) continue;  // 正在处理中
      // 异步执行（不等待），让 worker 并发处理多个 job
      void processJob(job.id).catch((e) => {
        console.error(`  [distillationWorker] 处理 job ${job.id} 失败:`, e?.message ?? e);
      });
    }
  } finally {
    isScanning = false;
  }
}

/**
 * 处理单个 distillation job：
 * - 调用 resumeDistillationJob 执行
 * - 失败时检查 retry_count，达到 MAX_RETRIES 则标记为 failed
 */
async function processJob(jobId: string): Promise<void> {
  inFlightJobs.add(jobId);
  try {
    await resumeDistillationJob(jobId);
    // 成功：resumeDistillationJob 已将 job 标记为 done
  } catch (e: any) {
    const errMsg = e?.message ?? String(e);
    // 检查重试次数
    const job = getDistillationJobById(jobId);
    const retryCount = job?.retry_count ?? 0;
    if (retryCount >= MAX_RETRIES) {
      // 达到最大重试次数：标记为 failed
      failDistillationJob(jobId, `重试 ${retryCount} 次后仍失败：${errMsg}`);
      audit(job?.user_id ?? 'unknown', 'distillation.worker.failed', {
        jobId,
        retryCount,
        error: errMsg,
      });
      console.error(`  [distillationWorker] job ${jobId} 重试 ${retryCount} 次后失败：${errMsg}`);
    } else {
      // 未达上限：等待下次扫描重试
      console.warn(`  [distillationWorker] job ${jobId} 失败（将在下次扫描重试，当前 retry_count=${retryCount}）：${errMsg}`);
    }
  } finally {
    inFlightJobs.delete(jobId);
  }
}
