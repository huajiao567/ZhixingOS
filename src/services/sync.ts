/**
 * 本地数据同步层（P0-5）。
 *
 * 原则：写入失败绝不再静默忽略。每个写操作进入本地队列（AsyncStorage 持久化），
 * 携带幂等 ID，按指数退避自动重试；遇到 409（冲突）暂停并暴露给用户；
 * 提供可见的同步状态，供界面展示。网络恢复后由 store 调用 flush()。
 *
 * V4.3 Task 5.3 扩展：新资源（evidence/experience/personal-skill/...）的同步
 * 通过 `enqueueByPrefix(prefix, method, path, body, id?)` 入队，调用方明确指定
 * 幂等键前缀（对齐后端 Task 4.1 的前缀约定，见 SYNC_PREFIXES）。
 * 现有 `enqueue({method, path, body, idempotencyKey})` 签名保持不变，向后兼容。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

export type SyncMethod = 'POST' | 'PATCH' | 'DELETE';
export type SyncStatus = 'pending' | 'conflict' | 'failed';

export interface SyncOp {
  id: string;
  method: SyncMethod;
  path: string;
  body?: unknown;
  idempotencyKey: string;
  attempts: number;
  nextRetryAt: number; // epoch ms
  status: SyncStatus;
  lastError?: string;
}

export interface SyncConflict {
  id: string;       // 幂等键
  path: string;
  error?: string;
}

const QUEUE_KEY = 'zx_sync_queue';
const MAX_ATTEMPTS = 8;

/**
 * V4.3 自我沉淀系统同步幂等键前缀（对齐后端 Task 4.1）。
 * 调用方通过 `enqueueByPrefix` 选择对应前缀，避免硬编码字符串散落各处。
 */
export const SYNC_PREFIXES = {
  ev: 'ev:',    // evidence_records
  pat: 'pat:',  // pattern_candidates
  exp: 'exp:',  // experience_units
  psk: 'psk:',  // personal_skills
  mep: 'mep:',  // meta_principles
  pmv: 'pmv:',  // personal_model_versions
  dj: 'dj:',    // distillation_jobs
  mco: 'mco:',  // model_corrections
  sec: 'sec:',  // service_contracts
} as const;

/** SYNC_PREFIXES 的键集合，供 enqueueByPrefix 的 prefix 参数约束 */
export type SyncPrefixKey = keyof typeof SYNC_PREFIXES;

let queue: SyncOp[] = [];
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  try {
    queue = JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]');
  } catch {
    queue = [];
  }
  loaded = true;
}

async function save(): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function backoff(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** attempts);
}

/** 入队一个写操作（乐观更新已在 store 内完成） */
export async function enqueue(op: {
  method: SyncMethod;
  path: string;
  body?: unknown;
  idempotencyKey: string;
}): Promise<void> {
  await load();
  const entry: SyncOp = {
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    method: op.method,
    path: op.path,
    body: op.body,
    idempotencyKey: op.idempotencyKey,
    attempts: 0,
    nextRetryAt: Date.now(),
    status: 'pending',
  };
  queue.push(entry);
  await save();
}

/**
 * V4.3 Task 5.3：按前缀入队新资源写操作。
 *
 * 调用方明确指定幂等键前缀（来自 SYNC_PREFIXES），id 可选：
 * - 提供 id：幂等键为 `${prefix}${id}`（适合 PATCH/DELETE，同一资源多次更新复用键）
 * - 不提供 id：自动生成 `Date.now()+random`，幂等键为 `${prefix}${autoId}`（适合 POST 首次创建）
 *
 * 与 enqueue() 共享同一队列与重试逻辑，向后兼容。
 */
export async function enqueueByPrefix(
  prefix: SyncPrefixKey,
  method: SyncMethod,
  path: string,
  body?: unknown,
  id?: string,
): Promise<void> {
  const prefixStr = SYNC_PREFIXES[prefix];
  const idPart = id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await enqueue({ method, path, body, idempotencyKey: `${prefixStr}${idPart}` });
}

/** 尝试把队列中所有到期操作刷到服务端；返回当前状态 */
export async function flush(): Promise<{ pending: number; conflicts: SyncConflict[]; lastError: string | null }> {
  await load();
  const now = Date.now();
  for (const op of queue) {
    if (op.status === 'conflict') continue;
    if (op.nextRetryAt > now) continue;
    try {
      await api.send(op.method, op.path, op.body, op.idempotencyKey);
      op.status = 'pending'; // 标记完成，稍后从队列移除
      (op as any)._done = true;
    } catch (e: any) {
      op.attempts += 1;
      op.lastError = e?.message ?? 'sync error';
      if (e?.status === 409) {
        op.status = 'conflict'; // 冲突：暂停，交给用户处理
      } else if (op.attempts >= MAX_ATTEMPTS) {
        op.status = 'failed';
      } else {
        op.nextRetryAt = now + backoff(op.attempts);
      }
    }
  }
  // 移除已完成项
  queue = queue.filter((o) => !(o as any)._done);
  await save();
  const conflicts: SyncConflict[] = queue
    .filter((o) => o.status === 'conflict')
    .map((o) => ({ id: o.idempotencyKey, path: o.path, error: o.lastError }));
  const pending = queue.filter((o) => o.status === 'pending' || o.status === 'failed').length;
  const lastError = queue.find((o) => o.status === 'failed')?.lastError ?? null;
  return { pending, conflicts, lastError };
}

export function currentStatus(): { pending: number; conflicts: SyncConflict[] } {
  return {
    pending: queue.filter((o) => o.status === 'pending' || o.status === 'failed').length,
    conflicts: queue.filter((o) => o.status === 'conflict').map((o) => ({ id: o.idempotencyKey, path: o.path, error: o.lastError })),
  };
}

/** 用户解决冲突后清空冲突项（谨慎：会放弃该次写入，需先与服务端核对） */
export async function clearConflicts(): Promise<void> {
  queue = queue.filter((o) => o.status !== 'conflict');
  await save();
}

/** 清空整个同步队列（账号注销/重置时，P0-7） */
export async function clearQueue(): Promise<void> {
  queue = [];
  await AsyncStorage.removeItem(QUEUE_KEY);
}
