import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SERVICE_CONTRACT } from '../types/models';
import type { Commitment, LifeEvent } from '../types/models';
import { deriveLocalState } from '../engine/localStateEngine';
import { nativeLlmChat } from './nativeLlm';

const DB_KEY = 'zx_native_local_runtime_v1';
const USER_ID = 'local-device-user';

interface LocalUser {
  userId: string;
  email: string;
  displayName: string;
}

interface LocalDb {
  version: 1;
  user: LocalUser;
  collections: Record<string, any[]>;
  serviceContract: any | null;
  twinProfile: any | null;
  actionReceipts: any[];
  handoffs: any[];
}

const COLLECTIONS = [
  'events', 'commitments', 'hypotheses', 'experiments', 'projects', 'skills', 'meanings',
  'evidence', 'patterns', 'personal-skills', 'meta-principles', 'model-versions',
  'distillation-jobs', 'corrections', 'audit', 'source-permissions',
] as const;

function emptyCollections(): Record<string, any[]> {
  return Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
}

function initialDb(): LocalDb {
  return {
    version: 1,
    user: { userId: USER_ID, email: 'local@device', displayName: '本机用户' },
    collections: emptyCollections(),
    serviceContract: null,
    twinProfile: null,
    actionReceipts: [],
    handoffs: [],
  };
}

function migrateDb(value: any): LocalDb {
  const base = initialDb();
  if (!value || typeof value !== 'object') return base;
  return {
    ...base,
    ...value,
    version: 1,
    user: { ...base.user, ...(value.user ?? {}) },
    collections: { ...base.collections, ...(value.collections ?? {}) },
    actionReceipts: Array.isArray(value.actionReceipts) ? value.actionReceipts : [],
    handoffs: Array.isArray(value.handoffs) ? value.handoffs : [],
  };
}

async function readDb(): Promise<LocalDb> {
  const raw = await AsyncStorage.getItem(DB_KEY);
  if (!raw) return initialDb();
  try { return migrateDb(JSON.parse(raw)); } catch { return initialDb(); }
}

async function writeDb(db: LocalDb): Promise<void> {
  await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));
}

let mutationTail: Promise<void> = Promise.resolve();
async function mutate<T>(fn: (db: LocalDb) => T | Promise<T>): Promise<T> {
  const previous = mutationTail;
  let release!: () => void;
  mutationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  } finally {
    release();
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function basePath(path: string): string {
  return path.split('?')[0];
}

function query(path: string): URLSearchParams {
  const index = path.indexOf('?');
  return new URLSearchParams(index >= 0 ? path.slice(index + 1) : '');
}

function ensureCollection(db: LocalDb, name: string): any[] {
  if (!Array.isArray(db.collections[name])) db.collections[name] = [];
  return db.collections[name];
}

function ensureContract(db: LocalDb) {
  if (!db.serviceContract) {
    db.serviceContract = {
      ...DEFAULT_SERVICE_CONTRACT,
      user_id: db.user.userId,
      updated_at: new Date().toISOString(),
    };
  }
  return db.serviceContract;
}

function upsert(collection: any[], item: any): any {
  const next = { ...item };
  if (!next.id) next.id = makeId('local');
  if (!next.user_id) next.user_id = USER_ID;
  const index = collection.findIndex((candidate) => candidate?.id === next.id);
  if (index >= 0) collection[index] = { ...collection[index], ...next };
  else collection.unshift(next);
  return next;
}

function localWeeklyBrief(db: LocalDb) {
  const events = ensureCollection(db, 'events').slice(0, 7) as LifeEvent[];
  return {
    generatedBy: events.length ? 'fallback' : 'empty',
    highlights: events.slice(0, 3).map((event) => event.title),
    patterns: [],
    nextWeekFocus: events.length ? ['从最近记录里挑一件最值得继续观察的事'] : [],
    openQuestions: events.length ? ['最近哪一件事最值得你重新解释？'] : [],
  };
}

function localMonthlyBrief(db: LocalDb) {
  const events = ensureCollection(db, 'events').slice(0, 30) as LifeEvent[];
  return {
    generatedBy: events.length ? 'fallback' : 'empty',
    monthlyTheme: events.length ? '本月记录仍以事实为主，等待你确认哪些变化真正重要' : '',
    candidateExperiences: [],
    openQuestions: events.length ? ['哪些重复出现的情况只是偶然，哪些值得形成经验？'] : [],
    staleInsights: [],
    nextMonthFocus: events.length ? ['继续记录可验证的事实，再决定是否形成结论'] : [],
  };
}

async function authRequest(method: string, path: string, body: any): Promise<any> {
  if (path === '/api/auth/login' && method === 'POST') {
    return mutate((db) => {
      const email = typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : db.user.email;
      db.user = { ...db.user, email, displayName: email === 'demo@zhixingos.com' ? '一舟' : db.user.displayName };
      return { id: db.user.userId, accessToken: 'local-device-session', refreshToken: 'local-device-refresh' };
    });
  }
  if (path === '/api/auth/register' && method === 'POST') {
    return mutate((db) => {
      db.user = {
        userId: USER_ID,
        email: body?.email?.trim?.() || 'local@device',
        displayName: body?.displayName?.trim?.() || '本机用户',
      };
      return { id: db.user.userId, accessToken: 'local-device-session', refreshToken: 'local-device-refresh' };
    });
  }
  if (path === '/api/auth/me' && method === 'GET') {
    const db = await readDb();
    return db.user;
  }
  if (path === '/api/auth/refresh' && method === 'POST') {
    return { accessToken: 'local-device-session', refreshToken: 'local-device-refresh' };
  }
  if (path === '/api/auth/logout' && method === 'POST') return { ok: true };
  if (path === '/api/auth/me' && method === 'DELETE') {
    await AsyncStorage.removeItem(DB_KEY);
    return { ok: true };
  }
  if (path === '/api/auth/forgot-password' || path === '/api/auth/reset-password') {
    return { ok: true, localOnly: true };
  }
  throw new Error(`本地认证接口未实现：${method} ${path}`);
}

async function dataRequest(method: string, path: string, body: any): Promise<any> {
  if (path === '/api/data/state' && method === 'GET') {
    const db = await readDb();
    return deriveLocalState(
      ensureCollection(db, 'events') as LifeEvent[],
      ensureCollection(db, 'commitments') as Commitment[],
    );
  }

  if (path === '/api/data/service-contract') {
    if (method === 'GET') {
      return mutate((db) => ensureContract(db));
    }
    if (method === 'PUT') {
      return mutate((db) => {
        const current = ensureContract(db);
        db.serviceContract = { ...current, ...(body ?? {}), user_id: db.user.userId, updated_at: new Date().toISOString() };
        return db.serviceContract;
      });
    }
  }

  const revoke = path.match(/^\/api\/data\/source-permissions\/([^/]+)\/revoke$/);
  if (revoke && method === 'POST') {
    return mutate((db) => {
      const type = decodeURIComponent(revoke[1]);
      const list = ensureCollection(db, 'source-permissions');
      const revokedAt = new Date().toISOString();
      const current = list.find((item) => item.data_type === type && !item.revoked_at);
      if (current) current.revoked_at = revokedAt;
      return { ok: true, data_type: type, revokedAt };
    });
  }

  const deleteBySource = path.match(/^\/api\/data\/evidence-by-source\/([^/]+)$/);
  if (deleteBySource && method === 'DELETE') {
    return mutate((db) => {
      const source = decodeURIComponent(deleteBySource[1]);
      const list = ensureCollection(db, 'evidence');
      const keep = list.filter((item) => item.source !== source && item.source_type !== source);
      const deletedCount = list.length - keep.length;
      db.collections.evidence = keep;
      return { ok: true, source, deletedCount, cascadedRecompute: 0, deletedAt: new Date().toISOString() };
    });
  }

  const match = path.match(/^\/api\/data\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) throw new Error(`本地数据接口未实现：${method} ${path}`);
  const name = match[1];
  const id = match[2] ? decodeURIComponent(match[2]) : null;

  if (name === 'audit' && method === 'GET') {
    const db = await readDb();
    return { items: ensureCollection(db, name), nextCursor: null };
  }
  if ((name === 'model-versions' || name === 'corrections') && method === 'GET' && !id) {
    const db = await readDb();
    return { items: ensureCollection(db, name), nextCursor: null };
  }

  if (method === 'GET' && !id) {
    const db = await readDb();
    return ensureCollection(db, name);
  }
  if (method === 'GET' && id) {
    const db = await readDb();
    return ensureCollection(db, name).find((item) => item?.id === id) ?? null;
  }
  if (method === 'POST' && !id) {
    return mutate((db) => {
      const list = ensureCollection(db, name);
      const created = upsert(list, {
        ...(body ?? {}),
        id: body?.id ?? makeId(name),
        created_at: body?.created_at ?? new Date().toISOString(),
      });
      return created;
    });
  }
  if ((method === 'PATCH' || method === 'PUT') && id) {
    return mutate((db) => {
      const list = ensureCollection(db, name);
      const index = list.findIndex((item) => item?.id === id);
      if (index < 0) {
        const created = { ...(body ?? {}), id, user_id: db.user.userId };
        list.unshift(created);
        return created;
      }
      list[index] = { ...list[index], ...(body ?? {}), id };
      return list[index];
    });
  }
  if (method === 'DELETE' && id) {
    return mutate((db) => {
      const list = ensureCollection(db, name);
      db.collections[name] = list.filter((item) => item?.id !== id);
      return { ok: true };
    });
  }

  throw new Error(`本地数据接口未实现：${method} ${path}`);
}

async function runtimeRequest(method: string, fullPath: string, path: string, body: any): Promise<any> {
  if (path === '/api/runtime/twin-profile' && method === 'PUT') {
    return mutate((db) => {
      db.twinProfile = body?.profile ?? body ?? null;
      return db.twinProfile;
    });
  }

  if (path === '/api/runtime/action-receipts' && method === 'POST') {
    return mutate((db) => {
      const receipt = { ...(body ?? {}), id: body?.id ?? makeId('receipt') };
      upsert(db.actionReceipts, receipt);
      return receipt;
    });
  }
  const undoReceipt = path.match(/^\/api\/runtime\/action-receipts\/([^/]+)\/undo$/);
  if (undoReceipt && method === 'POST') {
    return mutate((db) => {
      const id = decodeURIComponent(undoReceipt[1]);
      const current = db.actionReceipts.find((item) => item.id === id);
      if (current) current.status = 'undone';
      return current ?? { id, status: 'undone' };
    });
  }

  if (path === '/api/runtime/continuity-handoffs' && method === 'GET') {
    const db = await readDb();
    const target = query(fullPath).get('target');
    const items = db.handoffs.filter((item) => !target || item.target_surface === target || item.targetSurface === target);
    return { items, nextCursor: null };
  }
  if (path === '/api/runtime/continuity-handoffs' && method === 'POST') {
    return mutate((db) => {
      const created = {
        id: body?.id ?? makeId('handoff'),
        user_id: db.user.userId,
        source_surface: body?.sourceSurface ?? body?.source_surface,
        target_surface: body?.targetSurface ?? body?.target_surface,
        title: body?.title ?? '',
        payload: body?.payload ?? {},
        status: 'open',
        created_at: body?.createdAt ?? new Date().toISOString(),
        expires_at: body?.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
        consumed_at: null,
        cancelled_at: null,
      };
      upsert(db.handoffs, created);
      return created;
    });
  }
  const handoffAction = path.match(/^\/api\/runtime\/continuity-handoffs\/([^/]+)\/(consume|cancel)$/);
  if (handoffAction && method === 'POST') {
    return mutate((db) => {
      const id = decodeURIComponent(handoffAction[1]);
      const action = handoffAction[2];
      const current = db.handoffs.find((item) => item.id === id);
      if (!current) throw new Error('未找到跨端接力记录');
      current.status = action === 'consume' ? 'consumed' : 'cancelled';
      if (action === 'consume') current.consumed_at = new Date().toISOString();
      else current.cancelled_at = new Date().toISOString();
      return current;
    });
  }

  throw new Error(`本地运行时接口未实现：${method} ${path}`);
}

/**
 * In native builds this function replaces the former server REST round-trip.
 * It is deliberately exhaustive-by-default: unknown routes fail locally rather
 * than falling through to the network.
 */
export async function localApiRequest<T>(method: string, fullPath: string, body?: unknown): Promise<T> {
  const normalizedMethod = method.toUpperCase();
  const path = basePath(fullPath);

  if (path.startsWith('/api/auth/')) return authRequest(normalizedMethod, path, body) as Promise<T>;
  if (path.startsWith('/api/data/')) return dataRequest(normalizedMethod, path, body) as Promise<T>;
  if (path.startsWith('/api/runtime/')) return runtimeRequest(normalizedMethod, fullPath, path, body) as Promise<T>;

  if (path === '/api/secretary/chat' && normalizedMethod === 'POST') {
    const db = await readDb();
    const contract = ensureContract(db);
    const result = await nativeLlmChat({
      message: String((body as any)?.message ?? ''),
      history: Array.isArray((body as any)?.history) ? (body as any).history : [],
      allowRemote: contract.local_only !== true,
    });
    return { reply: result.reply, risk: result.risk, remote: result.remote } as T;
  }

  if (path === '/api/brief/weekly' && normalizedMethod === 'GET') {
    return localWeeklyBrief(await readDb()) as T;
  }
  if (path === '/api/brief/monthly' && normalizedMethod === 'GET') {
    return localMonthlyBrief(await readDb()) as T;
  }

  throw new Error(`原生本地模式已阻止未实现的服务器接口：${normalizedMethod} ${path}`);
}

export async function clearNativeLocalRuntime(): Promise<void> {
  await AsyncStorage.removeItem(DB_KEY);
}

export const __localApiTest = { initialDb, migrateDb, basePath };
