import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  EvidenceRecord,
  PatternCandidate,
  ExperienceUnit,
  PersonalSkill,
  MetaPrinciple,
  PersonalModelVersion,
  DistillationJob,
  ModelCorrection,
  ServiceContract,
  CorrectionType,
  CorrectionTargetType,
  AuditEntry,
  SourcePermission,
  DataType,
} from '../types/models';

const TOKEN_KEY = 'zx_token';
const REFRESH_KEY = 'zx_refresh';
const API_BASE_KEY = 'zx_api_base';

/**
 * 前端唯一 ID 生成：用于幂等键后缀（crypto.randomUUID 在部分 RN/旧 Web 不可用，故用 Math.random + Date.now 组合）。
 * 不用于安全场景；服务端最终以 Idempotency-Key 去重，碰撞概率忽略不计。
 */
const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36);

let cachedBase: string | null = null;

function normalizeApiBase(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('服务器地址格式无效，请填写 http://主机:端口 或 https://域名');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务器地址仅支持 http:// 或 https://');
  }
  return normalized;
}

/** 保存真机可访问的后端地址；立即清空内存缓存，后续请求无需重启 App。 */
export async function setApiBase(value: string): Promise<string> {
  const normalized = normalizeApiBase(value);
  await AsyncStorage.setItem(API_BASE_KEY, normalized);
  cachedBase = normalized;
  return normalized;
}

/** 清除用户覆盖，恢复构建环境变量/Expo 开发主机推断。 */
export async function clearApiBase(): Promise<void> {
  await AsyncStorage.removeItem(API_BASE_KEY);
  cachedBase = null;
}

/** 在保存前探测健康检查，避免把不可达地址写入持久配置。 */
export async function probeApiBase(value: string, timeoutMs = 5000): Promise<string> {
  const normalized = normalizeApiBase(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalized}/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`健康检查失败 (${response.status})`);
    const body = await response.json() as { ok?: boolean; service?: string };
    if (!body.ok) throw new Error('服务器未返回有效健康状态');
    return body.service ?? 'zhixingos-backend';
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('连接超时，请确认手机与电脑在同一网络且后端已启动');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// 解析 API 基址：优先用户覆盖 → 环境变量 → Expo 开发主机推断 → 本地默认
export async function getApiBase(): Promise<string> {
  if (cachedBase) return cachedBase;

  const override = await AsyncStorage.getItem(API_BASE_KEY);
  if (override) { cachedBase = normalizeApiBase(override); return cachedBase; }

  const envBase = (process?.env?.EXPO_PUBLIC_API_BASE as string | undefined);
  if (envBase) { cachedBase = normalizeApiBase(envBase); return cachedBase; }

  if (Platform.OS !== 'web') {
    try {
      const Constants = (await import('expo-constants')).default;
      const hostUri = (Constants as any)?.expoConfig?.hostUri || (Constants as any)?.manifest?.hostUri;
      if (hostUri) {
        const host = hostUri.split(':')[0];
        if (host) { cachedBase = `http://${host}:3001`; return cachedBase; }
      }
    } catch { /* expo-constants 不可用，降级 */ }
  }

  cachedBase = 'http://localhost:3001';
  return cachedBase;
}

// ---------- Token storage ----------
// Web has no native keystore, so the browser test harness uses AsyncStorage.
// Native builds must use expo-secure-store; never silently downgrade tokens to
// plaintext AsyncStorage when the native secure module is unavailable.
type SecureStore = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  deleteItem: (k: string) => Promise<void>;
};
let secureStore: SecureStore | null = null;
let secureTried = false;
async function getSecure(): Promise<SecureStore | null> {
  if (Platform.OS === 'web') return null;
  if (secureTried) return secureStore;
  secureTried = true;
  try {
    const specifier = 'expo-secure-store';
    const mod: any = await import(specifier);
    secureStore = {
      getItem: (k) => mod.getItemAsync(k),
      setItem: (k, v) => mod.setItemAsync(k, v),
      deleteItem: (k) => mod.deleteItemAsync(k),
    };
  } catch (error) {
    secureStore = null;
    throw new Error(
      `安全存储不可用，已阻止不安全的令牌存储：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return secureStore;
}
async function secureGet(k: string): Promise<string | null> {
  const s = await getSecure();
  return s ? s.getItem(k) : AsyncStorage.getItem(k);
}
async function secureSet(k: string, v: string): Promise<void> {
  const s = await getSecure();
  if (s) await s.setItem(k, v);
  else await AsyncStorage.setItem(k, v);
}
async function secureDel(k: string): Promise<void> {
  const s = await getSecure();
  if (s) await s.deleteItem(k);
  else await AsyncStorage.removeItem(k);
}

export const getToken = () => secureGet(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? secureSet(TOKEN_KEY, t) : secureDel(TOKEN_KEY));
export const getRefreshToken = () => secureGet(REFRESH_KEY);
export const setRefreshToken = (t: string | null) => (t ? secureSet(REFRESH_KEY, t) : secureDel(REFRESH_KEY));

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 单飞刷新，避免并发 401 触发多次刷新
let refreshing: Promise<boolean> | null = null;
async function doRefresh(): Promise<boolean> {
  const rt = await getRefreshToken();
  if (!rt) return false;
  try {
    const base = await getApiBase();
    const res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const d = await res.json();
    await setToken(d.accessToken);
    await setRefreshToken(d.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function attempt(method: string, path: string, body: unknown, idempotencyKey?: string): Promise<{ res: Response; text: string }> {
  const base = await getApiBase();
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { res, text };
}

/**
 * 判定是否为可重试的网络错误（非 HTTP 错误）。
 * - TypeError: 浏览器/RN fetch 在 DNS 失败、连接拒绝、CORS 阻断时抛出
 * - message 含 fetch/network 关键字：兜底兼容
 * HTTP 4xx/5xx 由上层逻辑处理（res.ok = false），不会进入此函数
 */
function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof Error && /fetch|network/i.test(e.message)) return true;
  return false;
}

/**
 * 带网络重试的 attempt 封装（Task 5.4 / spec M11.1）。
 * - 仅对网络错误（非 HTTP 错误）重试
 * - 幂等方法（GET/PUT/DELETE）最多 3 次重试，指数退避 1s/2s/4s + jitter
 * - 非幂等方法（POST/PATCH）仅在携带 Idempotency-Key 时重试（服务端去重保证幂等）
 * - HTTP 4xx/5xx 不重试（由上层 sync 队列或调用方处理）
 * - 401 仍由 request() 中的刷新令牌逻辑处理
 */
async function attemptWithRetry(
  method: string,
  path: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ res: Response; text: string }> {
  const isIdempotentMethod = method === 'GET' || method === 'PUT' || method === 'DELETE';
  const maxRetries = isIdempotentMethod || idempotencyKey ? 3 : 0;
  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await attempt(method, path, body, idempotencyKey);
    } catch (e: unknown) {
      lastErr = e;
      if (isNetworkError(e) && i < maxRetries) {
        const jitter = Math.random() * 500;
        const delay = Math.min(8000, 1000 * 2 ** i) + jitter;
        console.warn(
          `[api] 网络错误，${delay.toFixed(0)}ms 后第 ${i + 1}/${maxRetries} 次重试`,
          { method, path, err: (e as Error)?.message },
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}, idempotencyKey?: string): Promise<T> {
  let { res, text } = await attemptWithRetry(options.method ?? 'GET', path, options.body, idempotencyKey);
  // 访问令牌过期 → 用刷新令牌换发，重试一次
  if (res.status === 401) {
    const ok = await (refreshing ?? (refreshing = doRefresh().finally(() => { refreshing = null; })));
    if (ok) ({ res, text } = await attemptWithRetry(options.method ?? 'GET', path, options.body, idempotencyKey));
  }
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new ApiError(res.status, (data && (data.error || data.message)) || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // 带幂等键的底层发送（供同步队列使用，P0-5）
  send: <T>(method: string, path: string, body?: unknown, idempotencyKey?: string) =>
    request<T>(path, { method, body }, idempotencyKey),

  // === V4.3 自我沉淀系统 API（Task 5.1） ===
  // 幂等键前缀对齐后端 Task 4.1：ev: / pat: / exp: / psk: / mep: / pmv: / dj: / mco: / sec:
  evidence: {
    list: () => api.get<EvidenceRecord[]>('/api/data/evidence'),
    create: (body: Partial<EvidenceRecord>) =>
      api.send<EvidenceRecord>('POST', '/api/data/evidence', body, `ev:${body.id ?? uid()}`),
    delete: (id: string) => api.del<{ ok: boolean }>(`/api/data/evidence/${id}`),
  },
  patterns: {
    list: () => api.get<PatternCandidate[]>('/api/data/patterns'),
    update: (id: string, patch: Partial<PatternCandidate>) =>
      api.send<PatternCandidate>('PATCH', `/api/data/patterns/${id}`, patch, `pat:${id}`),
  },
  experiences: {
    list: () => api.get<ExperienceUnit[]>('/api/data/experiences'),
    create: (body: Partial<ExperienceUnit>) =>
      api.send<ExperienceUnit>('POST', '/api/data/experiences', body, `exp:${body.id ?? uid()}`),
    update: (id: string, patch: Partial<ExperienceUnit>) =>
      api.send<ExperienceUnit>('PATCH', `/api/data/experiences/${id}`, patch, `exp:${id}`),
  },
  personalSkills: {
    list: () => api.get<PersonalSkill[]>('/api/data/personal-skills'),
    create: (body: Partial<PersonalSkill>) =>
      api.send<PersonalSkill>('POST', '/api/data/personal-skills', body, `psk:${body.id ?? uid()}`),
  },
  metaPrinciples: {
    list: () => api.get<MetaPrinciple[]>('/api/data/meta-principles'),
    create: (body: Partial<MetaPrinciple>) =>
      api.send<MetaPrinciple>('POST', '/api/data/meta-principles', body, `mep:${body.id ?? uid()}`),
  },
  modelVersions: {
    list: (params?: { cursor?: string; limit?: number }) =>
      api.get<Paginated<PersonalModelVersion>>(`/api/data/model-versions${buildQuery(params)}`),
    rollback: (id: string) =>
      api.send<PersonalModelVersion>('POST', `/api/data/model-versions/rollback/${id}`, {}, `pmv:${id}`),
  },
  distillationJobs: {
    list: () => api.get<DistillationJob[]>('/api/data/distillation-jobs'),
    /**
     * V4.3 Task 13.6：触发一次自我沉淀作业（spec A7.6 / A6）。
     * 后端 POST /api/data/distillation-jobs 端点由 Task 27 scheduler 接入；
     * 在其落地前调用将通过同步队列重试（最多 8 次），不会静默丢失。
     */
    create: (body: Partial<DistillationJob>) =>
      api.send<DistillationJob>('POST', '/api/data/distillation-jobs', body, `dj:${body.id ?? uid()}`),
  },
  corrections: {
    list: (params?: { cursor?: string; limit?: number }) =>
      api.get<Paginated<ModelCorrection>>(`/api/data/corrections${buildQuery(params)}`),
    create: (body: { target_id: string; target_type: CorrectionTargetType; correction_type: CorrectionType; user_text?: string | null }) =>
      api.send<ModelCorrection>('POST', '/api/data/corrections', body, `mco:${uid()}`),
  },
  serviceContract: {
    get: () => api.get<ServiceContract>('/api/data/service-contract'),
    put: (body: Partial<ServiceContract>) =>
      api.send<ServiceContract>('PUT', '/api/data/service-contract', body, `sec:${uid()}`),
  },
  // === V4.3 Task 25.3 / 25.7：数据源权限（source_permissions 表读写） ===
  sourcePermissions: {
    list: () => api.get<SourcePermission[]>('/api/data/source-permissions'),
    grant: (body: { data_type: DataType; purpose?: string; scope?: Record<string, unknown> }) =>
      api.send<SourcePermission>('POST', '/api/data/source-permissions', body, `spm:${body.data_type}:${uid()}`),
    /** 撤回权限（仅写 revoked_at，不删除历史数据） */
    revoke: (dataType: DataType) =>
      api.send<{ ok: boolean; data_type: DataType; revokedAt: string }>(
        'POST', `/api/data/source-permissions/${dataType}/revoke`, {}, `spr:${dataType}:${uid()}`,
      ),
  },
  /** 删除指定来源的全部历史 evidence（SubTask 25.7：撤回权限时用户可选「同时删除历史数据」） */
  deleteEvidenceBySource: (source: string) =>
    api.del<{ ok: boolean; source: string; deletedCount: number; cascadedRecompute: number; deletedAt: string }>(
      `/api/data/evidence-by-source/${source}`,
    ),
  brief: {
    weekly: () => api.get<WeeklyBriefResponse>('/api/brief/weekly'),
    monthly: () => api.get<MonthlyBriefResponse>('/api/brief/monthly'),
  },
  audit: {
    list: (params?: { cursor?: string; limit?: number }) =>
      api.get<AuditPage>(`/api/data/audit${buildQuery(params)}`),
  },
};

/** 周镜/月镜 LLM 响应：generatedBy 标识来源，其余字段由 LLM 动态生成 */
export interface BriefResponse {
  generatedBy: 'llm' | 'fallback' | 'empty';
  [k: string]: unknown;
}

/**
 * 周镜 LLM 响应（V4.3 §A11，Task 10）。
 * 三态：'llm' 真实 LLM 生成 / 'fallback' LLM 不可用降级 / 'empty' 用户无数据。
 * 字段对齐后端 services/brief.ts WeeklyBrief。
 */
export interface WeeklyBriefResponse {
  generatedBy: 'llm' | 'fallback' | 'empty';
  highlights: string[];        // 本周 1-3 条值得记住的事
  patterns: string[];          // 本周 0-3 个反复出现的模式
  nextWeekFocus: string[];     // 下周 1-3 个可执行的关注点
  openQuestions: string[];     // 1-2 个值得思考的开放问题
}

/**
 * 月镜 LLM 响应（V4.3 §A11，Task 10）。
 * 三态同周镜；月镜产出少量候选经验、开放问题与失效旧认识（spec A11.3）。
 * 字段对齐后端 services/brief.ts MonthlyBrief。
 */
export interface MonthlyBriefResponse {
  generatedBy: 'llm' | 'fallback' | 'empty';
  monthlyTheme: string;                // 本月一个简短主题
  candidateExperiences: string[];      // 0-3 条候选经验
  openQuestions: string[];             // 1-3 个开放问题
  staleInsights: string[];             // 0-3 条失效旧认识
  nextMonthFocus: string[];            // 下月 1-3 个可执行的关注点
}

/** 通用分页响应 */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** 审计日志分页响应（Task 4.5 / spec M10.5） */
export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

/**
 * 规范化分页响应：兼容「数组（旧契约）」与「{ items, nextCursor }（新契约）」两种形态。
 *
 * Bug #5 修复（V4.3 §10）：后端 /audit /corrections /model-versions 端点均返回
 * 分页对象 { items, nextCursor }，但前端 store 多处将其直接当作数组使用，
 * 导致 pushAudit 时 `[newEntry, ...s.audit]` 抛出 "s.audit is not iterable"
 * （spread 不可迭代对象 → 同步 onPress 抛错 → 弹窗不关闭 → 后续用例全链路失败）。
 *
 * 此 helper 集中消除「分页对象 vs 数组」契约不一致，所有可能返回分页对象的端点
 * 在落库前必须经此函数归一为 T[]。无数据时返回空数组，绝不返回 undefined/null。
 */
export function unwrapList<T>(
  v: T[] | { items?: T[]; nextCursor?: string | null } | undefined | null,
): T[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && Array.isArray((v as any).items)) {
    return (v as any).items as T[];
  }
  return [];
}

/**
 * 构造分页查询串：避免 URLSearchParams 的 any 透传，显式拼接保证类型安全。
 * undefined 字段不参与查询。
 */
function buildQuery(params?: { cursor?: string; limit?: number }): string {
  if (!params) return '';
  const parts: string[] = [];
  if (params.cursor !== undefined) parts.push(`cursor=${encodeURIComponent(params.cursor)}`);
  if (params.limit !== undefined) parts.push(`limit=${String(params.limit)}`);
  return parts.length ? '?' + parts.join('&') : '';
}
