import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  EvidenceRecord,
  EvidenceSource,
  EvidenceType,
  PrivacyLevel,
  PatternCandidate,
  PatternReviewState,
  ExperienceUnit,
  ExperienceMaturity,
  PersonalSkill,
  MetaPrinciple,
  MetaPrincipleStatus,
  PersonalModelVersion,
  ModelVersionStatus,
  DistillationJob,
  DistillationStage,
  DistillationTrigger,
  ModelCorrection,
  CorrectionType,
  CorrectionTargetType,
  SourcePermission,
  DataType,
  ServiceContract,
  ReflectionDepth,
  AgencyLevel,
  ProactivityLevel,
  AvatarVisibility,
  DataScopeAxis,
  SupporterMode,
  LifeObjectRecord,
  ActionReceiptRecord,
  TwinProfileRecord,
} from './types.js';

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

// 文档存储 schema：doc 列保存 App 端完整领域对象（全保真），
// 索引列供状态引擎/简报上下文/查询使用（从 doc 中提取）。
// 事件新增 axis 列（inner=内观来源 / outer=外观来源），用于拆分两条证据链。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  layer TEXT NOT NULL,
  mood REAL,
  tags TEXT NOT NULL DEFAULT '[]',
  user_interpretation TEXT,
  created_at TEXT NOT NULL,
  axis TEXT,
  deleted_at TEXT,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_layer ON events(user_id, layer);

CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  domain TEXT NOT NULL,
  weight REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commit_user ON commitments(user_id);

CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  statement TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  doc TEXT NOT NULL,
  review_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hyp_user ON hypotheses(user_id);
-- idx_hyp_review_at 索引在 migrate() 中创建（需 ALTER TABLE 补列后才能建），
-- 不能放在此处 SCHEMA 中：旧库 hypotheses 表已存在但无 review_at 列时，
-- CREATE INDEX 会报 "no such column: review_at"。

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exp_user ON experiments(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meanings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL,
  created_at TEXT NOT NULL,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, ts DESC);

CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  ts TEXT NOT NULL
);

-- 幂等表：相同 key 在 24h 内重复提交视为重复，服务端去重（P0-5）
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- 刷新令牌表：可撤销、有期限（P0-8）
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id);

-- 访问令牌吊销表：JWT 无状态，注销/登出时记录 jti 使其立即失效（P0-8 增强）
CREATE TABLE IF NOT EXISTS revoked_access_tokens (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rat_exp ON revoked_access_tokens(expires_at);

-- ========== V4.3 自我沉淀系统（10 张新表，对齐 V4.3 §4.4 / §4.18 / §4.25） ==========

-- 1. evidence_records: 跨模块来源层（V4.3 §4.4）
CREATE TABLE IF NOT EXISTS evidence_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,           -- manual_text/manual_voice/photo/calendar/task/health/project/system
  evidence_type TEXT NOT NULL,    -- fact/self_report/outcome/correction/context
  occurred_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_ref TEXT,               -- 文本内容或 blob 引用
  context TEXT,                   -- JSON
  privacy_level TEXT NOT NULL DEFAULT 'D0',  -- D0-D3
  quality_flags TEXT,             -- JSON
  status TEXT NOT NULL DEFAULT 'active',     -- active/deleted/invalid
  provenance TEXT,                -- JSON: { resource_type, resource_id }
  resource_type TEXT,             -- 冗余字段便于查询: event/commitment/hypothesis/...
  resource_id TEXT,               -- 冗余字段: 对应业务对象 ID
  created_at TEXT NOT NULL
);

-- 2. pattern_candidates: 候选模式（V4.3 §4.18）
CREATE TABLE IF NOT EXISTS pattern_candidates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  statement TEXT NOT NULL,
  scope TEXT,
  support_ids TEXT NOT NULL DEFAULT '[]',     -- JSON array of evidence_ids
  counter_ids TEXT NOT NULL DEFAULT '[]',     -- JSON array of evidence_ids
  alternative_explanations TEXT NOT NULL DEFAULT '[]',  -- JSON array (>=1 非人格化)
  recurrence_count INTEGER NOT NULL DEFAULT 0,
  domain_count INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT,
  review_state TEXT NOT NULL DEFAULT 'candidate',  -- candidate/keep/watch/reject/stale
  user_note TEXT,
  created_at TEXT NOT NULL
);

-- 3. experience_units: 可复用经验（V4.3 §4.18）
CREATE TABLE IF NOT EXISTS experience_units (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  context TEXT,
  problem TEXT,
  actions TEXT,                  -- JSON
  outcome TEXT,
  lesson TEXT,
  support_ids TEXT NOT NULL DEFAULT '[]',     -- JSON
  counter_ids TEXT NOT NULL DEFAULT '[]',     -- JSON
  applicability TEXT,
  maturity TEXT NOT NULL DEFAULT 'candidate', -- candidate/observed/repeated/validated/stale/retired
  last_validated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 4. personal_skills: 领域方法 Personal Playbook（V4.3 §4.18）
CREATE TABLE IF NOT EXISTS personal_skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  trigger TEXT,
  preconditions TEXT,            -- JSON
  procedure TEXT,                -- JSON
  anti_patterns TEXT,            -- JSON
  scope TEXT,
  evidence_refs TEXT NOT NULL DEFAULT '[]',   -- JSON
  last_validated_at TEXT,
  expiry_review TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 5. meta_principles: 跨领域原则（V4.3 §4.18）
CREATE TABLE IF NOT EXISTS meta_principles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  statement TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',         -- JSON
  evidence TEXT NOT NULL DEFAULT '[]',        -- JSON
  counterevidence TEXT NOT NULL DEFAULT '[]', -- JSON
  status TEXT NOT NULL DEFAULT 'candidate',
  last_validated TEXT,
  created_at TEXT NOT NULL
);

-- 6. personal_model_versions: 完整快照（V4.3 §4.25）
CREATE TABLE IF NOT EXISTS personal_model_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  version TEXT NOT NULL,         -- v0.01/v0.05/v0.1/...
  snapshot TEXT NOT NULL,        -- JSON: 完整快照
  change_log TEXT,               -- JSON
  status TEXT NOT NULL DEFAULT 'active',  -- active/archived/superseded（Task 4.4 回滚用）
  created_at TEXT NOT NULL
);

-- 7. distillation_jobs: 流水线任务（V4.3 §4.18，Task 11.2 补 completed_at）
CREATE TABLE IF NOT EXISTS distillation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  trigger TEXT NOT NULL,         -- manual/scheduled/event/project_end/major_correction/milestone
  input_scope TEXT,              -- JSON: { timeWindow:{start,end}, project?, topic?, trigger? }
  stage TEXT NOT NULL DEFAULT 'pending',  -- pending/scoping/extracting/candidate/counter_search/context_check/independent_review/user_gate/commit/done/error
  result TEXT,                   -- JSON
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,  -- Task 11.5 worker 重试计数
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

-- 8. model_corrections: 用户纠正记录（V4.3 §4.20）
CREATE TABLE IF NOT EXISTS model_corrections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  target_id TEXT NOT NULL,       -- 被纠正的 hypothesis_id 或 pattern_id
  target_type TEXT NOT NULL,     -- hypothesis/pattern/experience/skill
  correction_type TEXT NOT NULL, -- unlike-me/wrong-reason/special-case/wait/no-more-inference/phase-changed
  user_text TEXT,
  target_pattern TEXT,           -- 用于 no-more-inference 类型的 pattern 标识
  created_at TEXT NOT NULL
);

-- 9. source_permissions: 数据源权限（V4.3 §4.25）
CREATE TABLE IF NOT EXISTS source_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  data_type TEXT NOT NULL,       -- calendar/task/health/device_usage/desktop_usage/nutrition/location/photo/microphone/notification
  purpose TEXT,
  scope TEXT,                    -- JSON: 细粒度范围
  granted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

-- 10. service_contracts: 七轴可调服务契约（每用户唯一，V4.3 §4.25 附录 X）
CREATE TABLE IF NOT EXISTS service_contracts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  reflection_depth TEXT NOT NULL DEFAULT 'R1',  -- R0-R3
  agency_level TEXT NOT NULL DEFAULT 'A1',       -- A0-A4
  data_scope TEXT NOT NULL DEFAULT '{}',         -- JSON: { D0:bool, D1:bool, ... D4:bool }
  proactivity TEXT NOT NULL DEFAULT 'P1',        -- P0-P3
  avatar TEXT NOT NULL DEFAULT 'V3',             -- V0-V3；V4.8 默认镜像主画布
  supporter_mode TEXT NOT NULL DEFAULT 'S0',     -- S0-S2
  accessibility_profile TEXT NOT NULL DEFAULT '{}',  -- JSON: { font_scale, voice_readout, single_confirm, usage_mode }
  quiet_hours TEXT,                              -- JSON: { start, end }
  high_impact_confirmation INTEGER NOT NULL DEFAULT 1,
  model_provider TEXT NOT NULL DEFAULT 'deepseek',
  local_only INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT,
  policy_version TEXT,
  updated_at TEXT NOT NULL
);

-- 11. password_reset_tokens: 密码重置令牌（V4.3 §10 路线图 A26，Task 4.7）
-- 30 分钟过期 + 一次性使用 + 哈希落库（不存明文）
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,         -- SHA-256 哈希
  expires_at TEXT NOT NULL,         -- ISO 时间戳
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token_hash);

-- ========== V4.8 AI-native 个人智能环境运行时 ==========

CREATE TABLE IF NOT EXISTS life_objects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  starts_at TEXT,
  ends_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  doc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS action_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  doc TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  undone_at TEXT,
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS twin_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  doc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function migrate(db: DatabaseSync) {
  db.exec(SCHEMA);
  // 兼容已存在的开发库：为旧表补 axis 列与索引（新库在 CREATE TABLE 时已含）
  try {
    db.exec('ALTER TABLE events ADD COLUMN axis TEXT');
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_events_axis ON events(user_id, axis)');
  } catch {
    /* 索引已存在则忽略 */
  }
  // Task 4.4: 为旧库的 personal_model_versions 补 status 列（新库在 CREATE TABLE 时已含）
  try {
    db.exec("ALTER TABLE personal_model_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  } catch {
    /* 列已存在则忽略 */
  }
  // Task 11.2: 为旧库的 distillation_jobs 补 retry_count / completed_at 列（新库在 CREATE TABLE 时已含）
  try {
    db.exec('ALTER TABLE distillation_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.exec('ALTER TABLE distillation_jobs ADD COLUMN completed_at TEXT');
  } catch {
    /* 列已存在则忽略 */
  }
  // Task 27.2: 为旧库的 hypotheses 补 review_at 列（新库在 CREATE TABLE 时已含）
  // review_at 为可空 ISO 时间字符串，NULL 表示无到期复审计划
  try {
    db.exec('ALTER TABLE hypotheses ADD COLUMN review_at TEXT');
  } catch {
    /* 列已存在则忽略 */
  }
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_hyp_review_at ON hypotheses(review_at) WHERE review_at IS NOT NULL'
    );
  } catch {
    /* 索引已存在则忽略 */
  }
  // V4.3 自我沉淀系统索引（SubTask 2.6）
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_evidence_user_time ON evidence_records(user_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_evidence_resource ON evidence_records(resource_type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_pattern_user_review ON pattern_candidates(user_id, review_state);
    CREATE INDEX IF NOT EXISTS idx_experience_user_maturity ON experience_units(user_id, maturity);
    CREATE INDEX IF NOT EXISTS idx_corrections_target ON model_corrections(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_distillation_pending ON distillation_jobs(stage, updated_at);
    CREATE INDEX IF NOT EXISTS idx_model_versions_user ON personal_model_versions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_life_objects_user_status ON life_objects(user_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_life_objects_user_time ON life_objects(user_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_action_receipts_user_time ON action_receipts(user_id, executed_at DESC);
  `);
}

// 审计日志：append-only，永不删除；仅账号彻底注销时随 purgeUser 一并清除
export function audit(userId: string, action: string, detail: unknown = {}): void {
  const d = getDb();
  d.prepare(
    'INSERT INTO audit_logs (id, user_id, action, detail, ts) VALUES (?, ?, ?, ?, ?)'
  ).run(cryptoRandom(), userId, action, JSON.stringify(detail), new Date().toISOString());
}

export function cryptoRandom(): string {
  return randomUUID();
}

// ---------- 用户级缓存（按 userId 命名空间，便于注销时清理） ----------
function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function llmCacheGet(userId: string, key: string): string | null {
  const row = getDb()
    .prepare('SELECT response FROM llm_cache WHERE key = ?')
    .get(`${userId}:${sha(key)}`) as { response: string } | undefined;
  return row?.response ?? null;
}

export function llmCacheSet(userId: string, key: string, response: string): void {
  getDb()
    .prepare('INSERT OR REPLACE INTO llm_cache (key, response, ts) VALUES (?, ?, ?)')
    .run(`${userId}:${sha(key)}`, response, new Date().toISOString());
}

/** 注销时清除该用户所有派生缓存（P0-7：真正删除的一部分） */
export function clearUserCache(userId: string): void {
  getDb().prepare('DELETE FROM llm_cache WHERE key LIKE ?').run(`${userId}:%`);
}

/**
 * 清除该用户指定天数内的 LLM 缓存（Task 6 删除级联重算用）。
 * llm_cache.key 格式为 `${userId}:${sha(key)}`，故用 LIKE 精确匹配用户前缀。
 * 返回被删除的行数。
 */
export function clearUserCacheRecent(userId: string, days: number): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = getDb()
    .prepare('DELETE FROM llm_cache WHERE key LIKE ? AND ts >= ?')
    .run(`${userId}:%`, cutoff);
  return Number(result.changes);
}

// ---------- 幂等（P0-5） ----------
export function idempotencyCheck(key: string): { duplicate: boolean } {
  const d = getDb();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const existing = d.prepare('SELECT key FROM idempotency WHERE key = ? AND created_at > ?').get(key, cutoff);
  if (existing) return { duplicate: true };
  d.prepare('INSERT OR IGNORE INTO idempotency (key, created_at) VALUES (?, ?)').run(key, new Date().toISOString());
  return { duplicate: false };
}

// ---------- 刷新令牌（P0-8） ----------
export function saveRefreshToken(userId: string, tokenHash: string, expiresAt: string): void {
  getDb()
    .prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)')
    .run(cryptoRandom(), userId, tokenHash, expiresAt, new Date().toISOString());
}

export function getRefreshToken(tokenHash: string): { user_id: string; revoked: number; expires_at: string } | undefined {
  return getDb()
    .prepare('SELECT user_id, revoked, expires_at FROM refresh_tokens WHERE token_hash = ?')
    .get(tokenHash) as { user_id: string; revoked: number; expires_at: string } | undefined;
}

export function revokeRefreshToken(tokenHash: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(tokenHash);
}

export function revokeAllRefreshTokens(userId: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
}

// ---------- 访问令牌吊销（P0-8 增强：注销/登出后立即使当前 access token 失效） ----------
export function revokeAccessToken(jti: string, expiresAtMs: number): void {
  const d = getDb();
  // 顺手清理已自然过期的条目，避免表无界增长
  d.prepare('DELETE FROM revoked_access_tokens WHERE expires_at < ?').run(Date.now());
  d.prepare('INSERT OR IGNORE INTO revoked_access_tokens (jti, expires_at) VALUES (?, ?)').run(jti, expiresAtMs);
}

export function isAccessTokenRevoked(jti: string): boolean {
  const row = getDb().prepare('SELECT jti FROM revoked_access_tokens WHERE jti = ? AND expires_at > ?').get(jti, Date.now());
  return !!row;
}

/**
 * 彻底注销用户：清除全部原始数据、派生摘要(缓存)、审计与刷新令牌。
 * 注意：这不做"软删除"——软删除不得称为遗忘（P0-7）。
 * V4.3 升级：清理范围覆盖自我沉淀系统全部 10 张新表，确保用户主权完整。
 */
export function purgeUser(userId: string): void {
  const d = getDb();
  // 顺序：先删子表（FK 约束），最后删 users
  // V4.3 修复：原实现漏删 users 表本身，导致「彻底注销」后用户仍能登录（spec P0-7）
  const tables = [
    // 8 张原始业务表
    'events', 'commitments', 'hypotheses', 'experiments', 'projects', 'skills', 'meanings', 'audit_logs',
    // V4.3 自我沉淀系统 10 张派生表
    'evidence_records', 'pattern_candidates', 'experience_units', 'personal_skills',
    'meta_principles', 'personal_model_versions', 'distillation_jobs', 'model_corrections',
    'source_permissions', 'service_contracts',
    // V4.8 AI-native 运行时
    'life_objects', 'action_receipts', 'twin_profiles',
    // Task 4.7: 密码重置令牌
    'password_reset_tokens',
    // V4.3 修复：刷新令牌表有 user_id FK，必须在删 users 前清空
    'refresh_tokens',
  ];
  for (const t of tables) {
    d.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  }
  // 最后删除用户记录本身（spec P0-7：彻底注销=真正删除账号，硬删除非软删除）
  d.prepare('DELETE FROM users WHERE id = ?').run(userId);
  clearUserCache(userId);
  // revokeAllRefreshTokens 已无意义（refresh_tokens 行已删除），保留调用以清理任何残留状态
  revokeAllRefreshTokens(userId);
}

// ========== V4.3 自我沉淀系统辅助函数（SubTask 2.5） ==========

// ---------- 内部工具：JSON 字段安全解析 ----------
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ========== V4.8 AI-native 运行时持久化 ==========

function rowToLifeObject(row: any): LifeObjectRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    version: row.version,
    doc: parseJson(row.doc, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getLifeObject(userId: string, id: string): LifeObjectRecord | null {
  const row = getDb().prepare(
    'SELECT * FROM life_objects WHERE user_id = ? AND id = ? AND deleted_at IS NULL'
  ).get(userId, id) as any;
  return row ? rowToLifeObject(row) : null;
}

export function getLifeObjects(userId: string, limit = 100): LifeObjectRecord[] {
  const rows = getDb().prepare(
    'SELECT * FROM life_objects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?'
  ).all(userId, limit) as any[];
  return rows.map(rowToLifeObject);
}

export function upsertLifeObject(userId: string, input: {
  id: string;
  kind: string;
  title: string;
  status: string;
  startsAt?: string | null;
  endsAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  doc: Record<string, unknown>;
}): LifeObjectRecord | null {
  getDb().prepare(`
    INSERT INTO life_objects
      (id, user_id, kind, title, status, starts_at, ends_at, version, doc, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      title = excluded.title,
      status = excluded.status,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      version = excluded.version,
      doc = excluded.doc,
      updated_at = excluded.updated_at,
      deleted_at = NULL
    WHERE life_objects.user_id = excluded.user_id AND excluded.version >= life_objects.version
  `).run(
    input.id, userId, input.kind, input.title, input.status,
    input.startsAt ?? null, input.endsAt ?? null, input.version, JSON.stringify(input.doc),
    input.createdAt, input.updatedAt,
  );
  return getLifeObject(userId, input.id);
}

export function cancelLifeObject(userId: string, id: string, expectedVersion: number, at: string): LifeObjectRecord | null {
  const current = getLifeObject(userId, id);
  if (!current || current.version !== expectedVersion) return null;
  const doc = { ...current.doc, status: 'cancelled', version: current.version + 1, updatedAt: at };
  const result = getDb().prepare(`
    UPDATE life_objects SET status = 'cancelled', version = ?, doc = ?, updated_at = ?
    WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL
  `).run(current.version + 1, JSON.stringify(doc), at, userId, id, expectedVersion);
  return Number(result.changes) === 1 ? getLifeObject(userId, id) : null;
}

function rowToActionReceipt(row: any): ActionReceiptRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    plan_id: row.plan_id,
    idempotency_key: row.idempotency_key,
    status: row.status,
    doc: parseJson(row.doc, {}),
    executed_at: row.executed_at,
    undone_at: row.undone_at ?? null,
  };
}

export function getActionReceipt(userId: string, id: string): ActionReceiptRecord | null {
  const row = getDb().prepare('SELECT * FROM action_receipts WHERE user_id = ? AND id = ?').get(userId, id) as any;
  return row ? rowToActionReceipt(row) : null;
}

export function getActionReceipts(userId: string, limit = 100): ActionReceiptRecord[] {
  const rows = getDb().prepare(
    'SELECT * FROM action_receipts WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?'
  ).all(userId, limit) as any[];
  return rows.map(rowToActionReceipt);
}

export function saveActionReceipt(userId: string, input: {
  id: string;
  planId: string;
  idempotencyKey: string;
  status: string;
  executedAt: string;
  undoneAt?: string | null;
  doc: Record<string, unknown>;
}): ActionReceiptRecord {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO action_receipts
      (id, user_id, plan_id, idempotency_key, status, doc, executed_at, undone_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id, userId, input.planId, input.idempotencyKey, input.status,
    JSON.stringify(input.doc), input.executedAt, input.undoneAt ?? null,
  );
  const row = db.prepare(
    'SELECT * FROM action_receipts WHERE user_id = ? AND idempotency_key = ?'
  ).get(userId, input.idempotencyKey) as any;
  return rowToActionReceipt(row);
}

export function markActionReceiptUndone(userId: string, id: string, at: string): ActionReceiptRecord | null {
  const current = getActionReceipt(userId, id);
  if (!current || current.status === 'undone') return current;
  if (current.status !== 'success' && current.status !== 'partial_failure') return null;
  const doc = { ...current.doc, status: 'undone', undoneAt: at, undoable: false };
  getDb().prepare(
    "UPDATE action_receipts SET status = 'undone', doc = ?, undone_at = ? WHERE user_id = ? AND id = ?"
  ).run(JSON.stringify(doc), at, userId, id);
  return getActionReceipt(userId, id);
}

function rowToTwinProfile(row: any): TwinProfileRecord {
  return { user_id: row.user_id, version: row.version, doc: parseJson(row.doc, {}), updated_at: row.updated_at };
}

export function getTwinProfile(userId: string): TwinProfileRecord | null {
  const row = getDb().prepare('SELECT * FROM twin_profiles WHERE user_id = ?').get(userId) as any;
  return row ? rowToTwinProfile(row) : null;
}

export function upsertTwinProfile(userId: string, input: {
  version: number;
  doc: Record<string, unknown>;
  updatedAt: string;
  expectedVersion?: number;
}): { profile: TwinProfileRecord | null; conflict: boolean } {
  const existing = getTwinProfile(userId);
  if (existing && input.expectedVersion !== undefined && existing.version !== input.expectedVersion) {
    return { profile: existing, conflict: true };
  }
  getDb().prepare(`
    INSERT INTO twin_profiles (user_id, version, doc, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, doc = excluded.doc, updated_at = excluded.updated_at
    WHERE excluded.version >= twin_profiles.version
  `).run(userId, input.version, JSON.stringify(input.doc), input.updatedAt);
  return { profile: getTwinProfile(userId), conflict: false };
}

// ---------- Evidence 证据记录（V4.3 §4.4） ----------

/** 创建证据记录 */
export function createEvidence(userId: string, input: {
  source: EvidenceSource;
  evidence_type: EvidenceType;
  occurred_at: string;
  captured_at?: string;
  content_ref?: string;
  context?: Record<string, unknown>;
  privacy_level?: PrivacyLevel;
  quality_flags?: Record<string, unknown>;
  resource_type?: string;
  resource_id?: string;
}): EvidenceRecord {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  const capturedAt = input.captured_at ?? now;
  const privacyLevel = input.privacy_level ?? 'D0';
  const provenance = input.resource_type || input.resource_id
    ? { resource_type: input.resource_type, resource_id: input.resource_id }
    : null;
  d.prepare(
    `INSERT INTO evidence_records
      (id, user_id, source, evidence_type, occurred_at, captured_at, content_ref, context,
       privacy_level, quality_flags, status, provenance, resource_type, resource_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(
    id, userId, input.source, input.evidence_type, input.occurred_at, capturedAt,
    input.content_ref ?? null,
    input.context ? JSON.stringify(input.context) : null,
    privacyLevel,
    input.quality_flags ? JSON.stringify(input.quality_flags) : null,
    provenance ? JSON.stringify(provenance) : null,
    input.resource_type ?? null,
    input.resource_id ?? null,
    now
  );
  return getEvidenceById(id)!;
}

/** 按 id 取单条证据 */
export function getEvidenceById(evidenceId: string): EvidenceRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM evidence_records WHERE id = ?')
    .get(evidenceId) as EvidenceRow | undefined;
  return row ? rowToEvidence(row) : null;
}

/** 列出用户的证据（按 occurred_at 倒序） */
export function getEvidencesByUser(userId: string, limit = 200): EvidenceRecord[] {
  // V4.3 修复：过滤 status='deleted'（软删除记录不得在常规列表中返回，否则用户会看到已删证据）
  const rows = getDb()
    .prepare("SELECT * FROM evidence_records WHERE user_id = ? AND status = 'active' ORDER BY occurred_at DESC LIMIT ?")
    .all(userId, limit) as EvidenceRow[];
  return rows.map(rowToEvidence);
}

/** 按业务资源查询证据 */
export function getEvidencesByResource(
  userId: string,
  resourceType: string,
  resourceId: string
): EvidenceRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM evidence_records WHERE user_id = ? AND resource_type = ? AND resource_id = ? ORDER BY occurred_at DESC'
    )
    .all(userId, resourceType, resourceId) as EvidenceRow[];
  return rows.map(rowToEvidence);
}

/** 软删除证据（status=deleted），不级联删除派生对象（由 Task 6 处理重算） */
export function deleteEvidence(userId: string, evidenceId: string): void {
  getDb()
    .prepare("UPDATE evidence_records SET status = 'deleted' WHERE id = ? AND user_id = ?")
    .run(evidenceId, userId);
}

/**
 * 查询依赖该证据的所有派生对象（pattern/experience/skill/metaPrinciple）。
 * 用于删除级联重算（Task 6 调用）。
 */
export function getDependents(evidenceId: string): {
  patterns: PatternCandidate[];
  experiences: ExperienceUnit[];
  skills: PersonalSkill[];
  metaPrinciples: MetaPrinciple[];
} {
  const d = getDb();
  // pattern_candidates: support_ids 或 counter_ids 包含 evidenceId
  const patternRows = d
    .prepare(
      `SELECT * FROM pattern_candidates
       WHERE support_ids LIKE ? OR counter_ids LIKE ?`
    )
    .all(`%"${evidenceId}"%`, `%"${evidenceId}"%`) as PatternRow[];
  // experience_units: support_ids 或 counter_ids 包含 evidenceId
  const experienceRows = d
    .prepare(
      `SELECT * FROM experience_units
       WHERE support_ids LIKE ? OR counter_ids LIKE ?`
    )
    .all(`%"${evidenceId}"%`, `%"${evidenceId}"%`) as ExperienceRow[];
  // personal_skills: evidence_refs 包含 evidenceId
  const skillRows = d
    .prepare('SELECT * FROM personal_skills WHERE evidence_refs LIKE ?')
    .all(`%"${evidenceId}"%`) as PersonalSkillRow[];
  // meta_principles: evidence 或 counterevidence 包含 evidenceId
  const metaRows = d
    .prepare(
      `SELECT * FROM meta_principles
       WHERE evidence LIKE ? OR counterevidence LIKE ?`
    )
    .all(`%"${evidenceId}"%`, `%"${evidenceId}"%`) as MetaPrincipleRow[];
  return {
    patterns: patternRows.map(rowToPattern),
    experiences: experienceRows.map(rowToExperience),
    skills: skillRows.map(rowToPersonalSkill),
    metaPrinciples: metaRows.map(rowToMetaPrinciple),
  };
}

// ---------- Pattern 候选模式（V4.3 §4.18） ----------

/** 创建候选模式 */
export function createPattern(userId: string, input: {
  statement: string;
  scope?: string;
  support_ids?: string[];
  counter_ids?: string[];
  alternative_explanations?: string[];
  recurrence_count?: number;
  domain_count?: number;
  last_seen?: string;
  review_state?: PatternReviewState;
  user_note?: string;
}): PatternCandidate {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO pattern_candidates
      (id, user_id, statement, scope, support_ids, counter_ids, alternative_explanations,
       recurrence_count, domain_count, last_seen, review_state, user_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, userId, input.statement, input.scope ?? null,
    JSON.stringify(input.support_ids ?? []),
    JSON.stringify(input.counter_ids ?? []),
    JSON.stringify(input.alternative_explanations ?? []),
    input.recurrence_count ?? 0,
    input.domain_count ?? 0,
    input.last_seen ?? null,
    input.review_state ?? 'candidate',
    input.user_note ?? null,
    now
  );
  return rowToPattern(d.prepare('SELECT * FROM pattern_candidates WHERE id = ?').get(id) as PatternRow);
}

/** 列出用户的候选模式（按 created_at 倒序） */
export function getPatternsByUser(userId: string, limit = 100): PatternCandidate[] {
  const rows = getDb()
    .prepare('SELECT * FROM pattern_candidates WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as PatternRow[];
  return rows.map(rowToPattern);
}

/** 更新候选模式评审状态 */
export function updatePatternReviewState(patternId: string, reviewState: PatternReviewState): void {
  getDb()
    .prepare('UPDATE pattern_candidates SET review_state = ? WHERE id = ?')
    .run(reviewState, patternId);
}

/**
 * 原子地更新模式 review_state 与 support_ids / counter_ids（Task 6 删除级联重算用）。
 * 单次 UPDATE 避免竞态，同时刷新 last_seen。
 */
export function updatePatternReviewStateAndSupportIds(
  patternId: string,
  reviewState: PatternReviewState,
  supportIds: string[],
  counterIds?: string[]
): void {
  const d = getDb();
  const now = new Date().toISOString();
  if (counterIds !== undefined) {
    d.prepare(
      `UPDATE pattern_candidates
       SET review_state = ?, support_ids = ?, counter_ids = ?, last_seen = ?
       WHERE id = ?`
    ).run(reviewState, JSON.stringify(supportIds), JSON.stringify(counterIds), now, patternId);
  } else {
    d.prepare(
      `UPDATE pattern_candidates
       SET review_state = ?, support_ids = ?, last_seen = ?
       WHERE id = ?`
    ).run(reviewState, JSON.stringify(supportIds), now, patternId);
  }
}

// ---------- Experience 可复用经验（V4.3 §4.18） ----------

/** 创建可复用经验 */
export function createExperience(userId: string, input: {
  context?: string;
  problem?: string;
  actions?: unknown[];
  outcome?: string;
  lesson?: string;
  support_ids?: string[];
  counter_ids?: string[];
  applicability?: string;
  maturity?: ExperienceMaturity;
  last_validated_at?: string;
  version?: number;
}): ExperienceUnit {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO experience_units
      (id, user_id, context, problem, actions, outcome, lesson, support_ids, counter_ids,
       applicability, maturity, last_validated_at, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, userId,
    input.context ?? null, input.problem ?? null,
    input.actions ? JSON.stringify(input.actions) : null,
    input.outcome ?? null, input.lesson ?? null,
    JSON.stringify(input.support_ids ?? []),
    JSON.stringify(input.counter_ids ?? []),
    input.applicability ?? null,
    input.maturity ?? 'candidate',
    input.last_validated_at ?? null,
    input.version ?? 1,
    now
  );
  return rowToExperience(d.prepare('SELECT * FROM experience_units WHERE id = ?').get(id) as ExperienceRow);
}

/** 列出用户的经验（按 created_at 倒序） */
export function getExperiencesByUser(userId: string, limit = 100): ExperienceUnit[] {
  const rows = getDb()
    .prepare('SELECT * FROM experience_units WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as ExperienceRow[];
  return rows.map(rowToExperience);
}

/** 更新经验成熟度（同时刷新 last_validated_at） */
export function updateExperienceMaturity(experienceId: string, maturity: ExperienceMaturity): void {
  getDb()
    .prepare(
      `UPDATE experience_units
       SET maturity = ?, last_validated_at = ?
       WHERE id = ?`
    )
    .run(maturity, new Date().toISOString(), experienceId);
}

/**
 * 经验状态机「升级」函数（Task 11.3）。
 *
 * 升级方向（不可跳级，不可降级——降级仍由 Task 6 的 recomputeDependents 处理）：
 *   candidate → observed → repeated → validated
 *
 * stale / retired 是终态，不可升级。
 *
 * 升级条件由调用方（pipeline.ts 阶段 8 commit 或后续监控）保证：
 *   - candidate → observed：≥2 不同时间段支持证据 + 已执行反例检索 + 无强用户反对
 *   - observed → repeated：新的相似任务结果支持
 *   - repeated → validated：用户明确确认
 *
 * 函数本身只做方向校验与原子更新；调用方负责条件检查。
 * 写审计日志（不保存原文）。
 *
 * 返回：升级后的 maturity；若方向非法或经验不存在，返回 null。
 */
export function promoteExperience(
  experienceId: string,
  newMaturity: ExperienceMaturity
): ExperienceMaturity | null {
  const d = getDb();
  const row = d
    .prepare('SELECT user_id, maturity FROM experience_units WHERE id = ?')
    .get(experienceId) as { user_id: string; maturity: string } | undefined;
  if (!row) return null;

  const current = row.maturity as ExperienceMaturity;
  const allowed: Record<ExperienceMaturity, ExperienceMaturity | null> = {
    candidate: 'observed',
    observed: 'repeated',
    repeated: 'validated',
    // stale / retired 是终态，不可升级
    stale: null,
    retired: null,
    // validated 是最高级，不可再升级
    validated: null,
  };
  const expected = allowed[current];
  if (expected !== newMaturity) {
    // 非法升级方向（不可跳级、不可降级、不可从终态升级）
    return null;
  }
  const now = new Date().toISOString();
  d.prepare(
    `UPDATE experience_units
     SET maturity = ?, last_validated_at = ?
     WHERE id = ?`
  ).run(newMaturity, now, experienceId);
  audit(row.user_id, 'experience.promote', {
    experienceId,
    from: current,
    to: newMaturity,
  });
  return newMaturity;
}

/**
 * 原子地更新经验成熟度与 support_ids / counter_ids（Task 6 删除级联重算用）。
 * 单次 UPDATE 避免竞态。不刷新 last_validated_at（降级不应延长验证时间）。
 */
export function updateExperienceMaturityAndSupportIds(
  experienceId: string,
  maturity: ExperienceMaturity,
  supportIds: string[],
  counterIds?: string[]
): void {
  const d = getDb();
  if (counterIds !== undefined) {
    d.prepare(
      `UPDATE experience_units
       SET maturity = ?, support_ids = ?, counter_ids = ?
       WHERE id = ?`
    ).run(maturity, JSON.stringify(supportIds), JSON.stringify(counterIds), experienceId);
  } else {
    d.prepare(
      `UPDATE experience_units
       SET maturity = ?, support_ids = ?
       WHERE id = ?`
    ).run(maturity, JSON.stringify(supportIds), experienceId);
  }
}

// ---------- PersonalSkill 领域方法（V4.3 §4.18 Personal Playbook） ----------

/** 创建领域方法 */
export function createPersonalSkill(userId: string, input: {
  trigger?: string;
  preconditions?: unknown[];
  procedure?: unknown[];
  anti_patterns?: unknown[];
  scope?: string;
  evidence_refs?: string[];
  last_validated_at?: string;
  expiry_review?: string;
  version?: number;
}): PersonalSkill {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO personal_skills
      (id, user_id, trigger, preconditions, procedure, anti_patterns, scope,
       evidence_refs, last_validated_at, expiry_review, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, userId,
    input.trigger ?? null,
    input.preconditions ? JSON.stringify(input.preconditions) : null,
    input.procedure ? JSON.stringify(input.procedure) : null,
    input.anti_patterns ? JSON.stringify(input.anti_patterns) : null,
    input.scope ?? null,
    JSON.stringify(input.evidence_refs ?? []),
    input.last_validated_at ?? null,
    input.expiry_review ?? null,
    input.version ?? 1,
    now
  );
  return rowToPersonalSkill(d.prepare('SELECT * FROM personal_skills WHERE id = ?').get(id) as PersonalSkillRow);
}

/** 列出用户的领域方法（按 created_at 倒序） */
export function getPersonalSkillsByUser(userId: string, limit = 100): PersonalSkill[] {
  const rows = getDb()
    .prepare('SELECT * FROM personal_skills WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as PersonalSkillRow[];
  return rows.map(rowToPersonalSkill);
}

/**
 * 更新领域方法的 evidence_refs（Task 6 删除级联重算用）。
 * personal_skills 无 maturity / status 字段，仅清理引用。
 */
export function updatePersonalSkillEvidenceRefs(
  skillId: string,
  evidenceRefs: string[]
): void {
  getDb()
    .prepare('UPDATE personal_skills SET evidence_refs = ? WHERE id = ?')
    .run(JSON.stringify(evidenceRefs), skillId);
}

// ---------- MetaPrinciple 跨领域原则（V4.3 §4.18） ----------

/** 创建跨领域原则 */
export function createMetaPrinciple(userId: string, input: {
  statement: string;
  domains?: string[];
  evidence?: string[];
  counterevidence?: string[];
  status?: MetaPrincipleStatus;
  last_validated?: string;
}): MetaPrinciple {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO meta_principles
      (id, user_id, statement, domains, evidence, counterevidence, status, last_validated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, userId, input.statement,
    JSON.stringify(input.domains ?? []),
    JSON.stringify(input.evidence ?? []),
    JSON.stringify(input.counterevidence ?? []),
    input.status ?? 'candidate',
    input.last_validated ?? null,
    now
  );
  return rowToMetaPrinciple(d.prepare('SELECT * FROM meta_principles WHERE id = ?').get(id) as MetaPrincipleRow);
}

/** 列出用户的跨领域原则（按 created_at 倒序） */
export function getMetaPrinciplesByUser(userId: string, limit = 100): MetaPrinciple[] {
  const rows = getDb()
    .prepare('SELECT * FROM meta_principles WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as MetaPrincipleRow[];
  return rows.map(rowToMetaPrinciple);
}

/**
 * 原子地更新跨领域原则的 status / evidence / counterevidence（Task 6 删除级联重算用）。
 * 同时刷新 last_validated。
 */
export function updateMetaPrincipleEvidence(
  metaPrincipleId: string,
  evidence: string[],
  counterevidence: string[],
  status?: MetaPrincipleStatus
): void {
  const d = getDb();
  const now = new Date().toISOString();
  if (status !== undefined) {
    d.prepare(
      `UPDATE meta_principles
       SET evidence = ?, counterevidence = ?, status = ?, last_validated = ?
       WHERE id = ?`
    ).run(JSON.stringify(evidence), JSON.stringify(counterevidence), status, now, metaPrincipleId);
  } else {
    d.prepare(
      `UPDATE meta_principles
       SET evidence = ?, counterevidence = ?, last_validated = ?
       WHERE id = ?`
    ).run(JSON.stringify(evidence), JSON.stringify(counterevidence), now, metaPrincipleId);
  }
}

// ---------- PersonalModelVersion 完整快照（V4.3 §4.25） ----------

/** 创建个人模型版本快照 */
export function createModelVersion(userId: string, input: {
  version: string;
  snapshot: Record<string, unknown>;
  change_log?: Record<string, unknown>;
}): PersonalModelVersion {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO personal_model_versions
      (id, user_id, version, snapshot, change_log, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id, userId, input.version,
    JSON.stringify(input.snapshot),
    input.change_log ? JSON.stringify(input.change_log) : null,
    now
  );
  return rowToModelVersion(d.prepare('SELECT * FROM personal_model_versions WHERE id = ?').get(id) as ModelVersionRow);
}

/** 列出用户的模型版本（按 created_at 倒序） */
export function getModelVersionsByUser(userId: string, limit = 50): PersonalModelVersion[] {
  const rows = getDb()
    .prepare('SELECT * FROM personal_model_versions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as ModelVersionRow[];
  return rows.map(rowToModelVersion);
}

/** 取用户当前 active 模型版本（Task 11.1 stage 8 commit 用） */
export function getActiveModelVersion(userId: string): PersonalModelVersion | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM personal_model_versions
       WHERE user_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId) as ModelVersionRow | undefined;
  return row ? rowToModelVersion(row) : null;
}

/** 统计用户已有模型版本数（用于自动版本号生成，Task 11.1 stage 8） */
export function countModelVersionsByUser(userId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM personal_model_versions WHERE user_id = ?')
    .get(userId) as { n: number } | undefined;
  return row?.n ?? 0;
}

// ---------- DistillationJob 蒸馏流水线任务（V4.3 §4.18） ----------

/** 创建蒸馏任务 */
export function createDistillationJob(userId: string, input: {
  trigger: DistillationTrigger;
  input_scope?: {
    timeWindow?: { start: string; end: string };
    project?: string;
    topic?: string;
  };
}): DistillationJob {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO distillation_jobs
      (id, user_id, trigger, input_scope, stage, result, error, retry_count, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, 'pending', NULL, NULL, 0, ?, ?, NULL)`
  ).run(
    id, userId, input.trigger,
    input.input_scope ? JSON.stringify(input.input_scope) : null,
    now, now
  );
  return rowToDistillationJob(d.prepare('SELECT * FROM distillation_jobs WHERE id = ?').get(id) as DistillationJobRow);
}

/** 更新蒸馏任务阶段（同步刷新 updated_at） */
export function updateDistillationJobStage(
  jobId: string,
  stage: DistillationStage,
  result?: Record<string, unknown>,
  error?: string
): void {
  getDb()
    .prepare(
      `UPDATE distillation_jobs
       SET stage = ?, result = ?, error = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      stage,
      result ? JSON.stringify(result) : null,
      error ?? null,
      new Date().toISOString(),
      jobId
    );
}

/** 标记蒸馏任务完成（stage='done' + completed_at + 最终 result） */
export function completeDistillationJob(jobId: string, result: Record<string, unknown>): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE distillation_jobs
       SET stage = 'done', result = ?, error = NULL, updated_at = ?, completed_at = ?
       WHERE id = ?`
    )
    .run(JSON.stringify(result), now, now, jobId);
}

/** 标记蒸馏任务失败（stage='error' + completed_at + error 文本） */
export function failDistillationJob(jobId: string, error: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE distillation_jobs
       SET stage = 'error', error = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`
    )
    .run(error, now, now, jobId);
}

/** 拉取待处理蒸馏任务（按 updated_at 升序，FIFO） */
export function getPendingDistillationJobs(limit = 10): DistillationJob[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM distillation_jobs
       WHERE stage IN ('pending', 'scoping', 'extracting', 'candidate', 'counter_search',
                       'context_check', 'independent_review', 'user_gate', 'commit')
       ORDER BY updated_at ASC LIMIT ?`
    )
    .all(limit) as DistillationJobRow[];
  return rows.map(rowToDistillationJob);
}

/** 按 id 取单条蒸馏任务（worker 恢复执行用） */
export function getDistillationJobById(jobId: string): DistillationJob | null {
  const row = getDb()
    .prepare('SELECT * FROM distillation_jobs WHERE id = ?')
    .get(jobId) as DistillationJobRow | undefined;
  return row ? rowToDistillationJob(row) : null;
}

/** 增加蒸馏任务重试计数（worker 重试机制用） */
export function incrementDistillationJobRetry(jobId: string): number {
  const d = getDb();
  const now = new Date().toISOString();
  // 原子自增：UPDATE 后 SELECT 返回新值
  d.prepare(
    `UPDATE distillation_jobs
     SET retry_count = retry_count + 1, updated_at = ?
     WHERE id = ?`
  ).run(now, jobId);
  const row = d.prepare('SELECT retry_count FROM distillation_jobs WHERE id = ?').get(jobId) as
    | { retry_count: number }
    | undefined;
  return row?.retry_count ?? 0;
}

/** 按时间窗口查询证据（Task 11.1 stage 1 scope 用） */
export function getEvidencesByTimeWindow(
  userId: string,
  start: string,
  end: string,
  project?: string,
  topic?: string
): EvidenceRecord[] {
  const d = getDb();
  let sql = `SELECT * FROM evidence_records
             WHERE user_id = ? AND status = 'active'
               AND occurred_at >= ? AND occurred_at <= ?`;
  const params: Array<string | number> = [userId, start, end];
  if (project) {
    sql += ` AND resource_type = 'project' AND resource_id = ?`;
    params.push(project);
  }
  if (topic) {
    // topic 关键词匹配 content_ref
    sql += ` AND content_ref LIKE ?`;
    params.push(`%${topic}%`);
  }
  sql += ` ORDER BY occurred_at ASC`;
  const rows = d.prepare(sql).all(...params) as EvidenceRow[];
  return rows.map(rowToEvidence);
}

// ---------- ModelCorrection 用户纠正记录（V4.3 §4.20） ----------

/** 创建用户纠正记录 */
export function createModelCorrection(userId: string, input: {
  target_id: string;
  target_type: CorrectionTargetType;
  correction_type: CorrectionType;
  // 与 types.ts ModelCorrection.user_text 类型对齐：string | null
  user_text?: string | null;
  target_pattern?: string;
}): ModelCorrection {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO model_corrections
      (id, user_id, target_id, target_type, correction_type, user_text, target_pattern, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, userId, input.target_id, input.target_type, input.correction_type,
    input.user_text ?? null, input.target_pattern ?? null, now
  );
  return rowToModelCorrection(d.prepare('SELECT * FROM model_corrections WHERE id = ?').get(id) as ModelCorrectionRow);
}

/** 列出用户的纠正记录（按 created_at 倒序） */
export function getModelCorrectionsByUser(userId: string, limit = 100): ModelCorrection[] {
  const rows = getDb()
    .prepare('SELECT * FROM model_corrections WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as ModelCorrectionRow[];
  return rows.map(rowToModelCorrection);
}

// ---------- Task 8 用户纠正状态机辅助函数（V4.3 §4.20 / A4.2） ----------

/**
 * 更新假设状态（Task 8：unlike-me → 'rejected'；wrong-reason → 'revised'）。
 * 同时把 doc 中缓存的 status 同步刷新（保持索引列与 doc 一致）。
 */
export function updateHypothesisStatus(hypothesisId: string, status: 'testing' | 'confirmed' | 'revised' | 'rejected'): void {
  const d = getDb();
  // 先取 doc，合并后回写，保证 doc.status 与索引列一致
  const row = d.prepare('SELECT doc FROM hypotheses WHERE id = ?').get(hypothesisId) as { doc: string } | undefined;
  if (!row) return;
  let doc: Record<string, unknown> = {};
  try { doc = JSON.parse(row.doc) as Record<string, unknown>; } catch { doc = {}; }
  doc.status = status;
  d.prepare('UPDATE hypotheses SET status = ?, doc = ? WHERE id = ?').run(status, JSON.stringify(doc), hypothesisId);
}

/**
 * 设置假设的到期复审时间（Task 27.2 / A27.1）。
 *
 * - reviewAt 为 ISO 时间字符串（如 new Date().toISOString()），表示该 hypothesis 在此时间到期、需复审
 * - 传入 null 清除复审计划（用户已完成复审或主动取消）
 * - 同时把 doc.reviewAt 同步刷新（保持索引列与 doc 一致）
 *
 * 不修改 hypothesis 的 status —— 用户需主动复审，避免系统误改状态（spec Task 27.2 严格规则）。
 */
export function setHypothesisReviewAt(hypothesisId: string, reviewAt: string | null): void {
  const d = getDb();
  const row = d.prepare('SELECT doc FROM hypotheses WHERE id = ?').get(hypothesisId) as { doc: string } | undefined;
  if (!row) return;
  let doc: Record<string, unknown> = {};
  try { doc = JSON.parse(row.doc) as Record<string, unknown>; } catch { doc = {}; }
  if (reviewAt === null) {
    delete doc.reviewAt;
  } else {
    doc.reviewAt = reviewAt;
  }
  d.prepare('UPDATE hypotheses SET review_at = ?, doc = ? WHERE id = ?').run(reviewAt, JSON.stringify(doc), hypothesisId);
}

/** getHypothesesDueForReview 的返回行结构 */
export type HypothesisDueForRow = {
  id: string;
  user_id: string;
  statement: string;
  status: string;
  review_at: string;
};

/**
 * 获取所有到期需复审的 hypothesis（Task 27.2 / A27.1）。
 *
 * - now 默认为 new Date()，调用方可显式注入便于测试
 * - 仅返回 review_at <= now 且 status 处于开放状态（'open' / 'candidate'）的记录
 *   —— 已确认/已驳回的 hypothesis 不再触发复审提醒，避免噪音
 * - 不修改任何状态：用户需主动复审后调用 setHypothesisReviewAt(id, null) 或 updateHypothesisStatus
 *
 * SQL 利用 idx_hyp_review_at 部分索引（WHERE review_at IS NOT NULL），扫描代价低。
 */
export function getHypothesesDueForReview(now: Date = new Date()): HypothesisDueForRow[] {
  const d = getDb();
  const nowIso = now.toISOString();
  return d
    .prepare(
      `SELECT id, user_id, statement, status, review_at
       FROM hypotheses
       WHERE review_at IS NOT NULL
         AND review_at <= ?
         AND status IN ('open', 'candidate')
       ORDER BY review_at ASC`
    )
    .all(nowIso) as HypothesisDueForRow[];
}

/**
 * 在 pattern_candidates.user_note 末尾追加文本（Task 8：special-case）。
 * 若已有 user_note 则换行追加，否则直接写入。
 */
export function appendPatternUserNote(patternId: string, note: string): void {
  const d = getDb();
  const row = d.prepare('SELECT user_note FROM pattern_candidates WHERE id = ?').get(patternId) as { user_note: string | null } | undefined;
  if (!row) return;
  const existing = row.user_note ?? '';
  const next = existing ? `${existing}\n${note}` : note;
  d.prepare('UPDATE pattern_candidates SET user_note = ? WHERE id = ?').run(next, patternId);
}

/**
 * 把该用户当前所有 active 模型版本归档为 'archived'（Task 8：phase-changed 创建新 active 版本前调用）。
 * 与 rollbackModelVersion 中的归档逻辑一致：归档后由调用方创建新的 active 版本。
 * 返回被归档的版本 id 列表（用于审计）。
 */
export function archiveActiveModelVersions(userId: string): string[] {
  const d = getDb();
  const rows = d.prepare(
    "SELECT id FROM personal_model_versions WHERE user_id = ? AND status = 'active'"
  ).all(userId) as { id: string }[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  d.prepare(
    "UPDATE personal_model_versions SET status = 'archived' WHERE user_id = ? AND status = 'active'"
  ).run(userId);
  return ids;
}

/**
 * 列出用户被「以后别这么推断」禁止的 pattern_id 列表（Task 8：LLM 上下文构建时调用）。
 * 从 model_corrections 表中取 correction_type='no-more-inference' 的 target_pattern 字段。
 * target_pattern 优先于 target_id（schema 中 no-more-inference 的 target_pattern 是显式记录的）。
 */
export function getInferenceBlockedPatternIds(userId: string): string[] {
  const d = getDb();
  const rows = d.prepare(
    `SELECT target_id, target_pattern FROM model_corrections
     WHERE user_id = ? AND correction_type = 'no-more-inference'`
  ).all(userId) as { target_id: string; target_pattern: string | null }[];
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.target_pattern ?? r.target_id);
  }
  return Array.from(ids);
}

// ---------- ServiceContract 服务契约（V4.3 §4.25 附录 X，每用户唯一） ----------

/** 读取用户服务契约，未创建则返回 null */
export function getServiceContract(userId: string): ServiceContract | null {
  const row = getDb()
    .prepare('SELECT * FROM service_contracts WHERE user_id = ?')
    .get(userId) as ServiceContractRow | undefined;
  return row ? rowToServiceContract(row) : null;
}

/** 创建或更新用户服务契约（部分字段，未传字段保留原值） */
export function upsertServiceContract(userId: string, input: Partial<{
  reflection_depth: ReflectionDepth;
  agency_level: AgencyLevel;
  data_scope: Record<string, boolean>;
  proactivity: ProactivityLevel;
  avatar: AvatarVisibility;
  supporter_mode: SupporterMode;
  accessibility_profile: Record<string, unknown>;
  quiet_hours: { start: string; end: string } | null;
  high_impact_confirmation: boolean;
  model_provider: string;
  local_only: boolean;
  consent_version: string;
  policy_version: string;
}>): ServiceContract {
  const d = getDb();
  const now = new Date().toISOString();
  const existing = getServiceContract(userId);
  if (!existing) {
    // 创建默认契约
    d.prepare(
      `INSERT INTO service_contracts
        (user_id, reflection_depth, agency_level, data_scope, proactivity, avatar, supporter_mode,
         accessibility_profile, quiet_hours, high_impact_confirmation, model_provider, local_only,
         consent_version, policy_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      input.reflection_depth ?? 'R1',
      input.agency_level ?? 'A1',
      JSON.stringify(input.data_scope ?? { D0: true, D1: false, D2: false, D3: false, D4: false }),
      input.proactivity ?? 'P1',
      input.avatar ?? 'V3',
      input.supporter_mode ?? 'S0',
      JSON.stringify(input.accessibility_profile ?? {}),
      input.quiet_hours ? JSON.stringify(input.quiet_hours) : null,
      input.high_impact_confirmation !== undefined ? (input.high_impact_confirmation ? 1 : 0) : 1,
      input.model_provider ?? 'deepseek',
      input.local_only !== undefined ? (input.local_only ? 1 : 0) : 0,
      input.consent_version ?? null,
      input.policy_version ?? null,
      now
    );
  } else {
    // 更新提供的字段
    const sets: string[] = ['updated_at = ?'];
    const vals: Array<string | number | null> = [now];
    if (input.reflection_depth !== undefined) { sets.push('reflection_depth = ?'); vals.push(input.reflection_depth); }
    if (input.agency_level !== undefined) { sets.push('agency_level = ?'); vals.push(input.agency_level); }
    if (input.data_scope !== undefined) { sets.push('data_scope = ?'); vals.push(JSON.stringify(input.data_scope)); }
    if (input.proactivity !== undefined) { sets.push('proactivity = ?'); vals.push(input.proactivity); }
    if (input.avatar !== undefined) { sets.push('avatar = ?'); vals.push(input.avatar); }
    if (input.supporter_mode !== undefined) { sets.push('supporter_mode = ?'); vals.push(input.supporter_mode); }
    if (input.accessibility_profile !== undefined) {
      sets.push('accessibility_profile = ?');
      vals.push(JSON.stringify(input.accessibility_profile));
    }
    if (input.quiet_hours !== undefined) {
      sets.push('quiet_hours = ?');
      vals.push(input.quiet_hours ? JSON.stringify(input.quiet_hours) : null);
    }
    if (input.high_impact_confirmation !== undefined) {
      sets.push('high_impact_confirmation = ?');
      vals.push(input.high_impact_confirmation ? 1 : 0);
    }
    if (input.model_provider !== undefined) { sets.push('model_provider = ?'); vals.push(input.model_provider); }
    if (input.local_only !== undefined) { sets.push('local_only = ?'); vals.push(input.local_only ? 1 : 0); }
    if (input.consent_version !== undefined) { sets.push('consent_version = ?'); vals.push(input.consent_version); }
    if (input.policy_version !== undefined) { sets.push('policy_version = ?'); vals.push(input.policy_version); }
    vals.push(userId);
    d.prepare(`UPDATE service_contracts SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
  }
  return getServiceContract(userId)!;
}

// ---------- SourcePermission 数据源权限（V4.3 §4.25） ----------

/** 创建数据源权限授权记录 */
export function createSourcePermission(userId: string, input: {
  data_type: DataType;
  purpose?: string;
  scope?: Record<string, unknown>;
}): SourcePermission {
  const d = getDb();
  const now = new Date().toISOString();
  const id = cryptoRandom();
  d.prepare(
    `INSERT INTO source_permissions
      (id, user_id, data_type, purpose, scope, granted_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    id, userId, input.data_type,
    input.purpose ?? null,
    input.scope ? JSON.stringify(input.scope) : null,
    now, now
  );
  return rowToSourcePermission(d.prepare('SELECT * FROM source_permissions WHERE id = ?').get(id) as SourcePermissionRow);
}

/** 列出用户的所有数据源权限（含已撤销） */
export function getSourcePermissionsByUser(userId: string): SourcePermission[] {
  const rows = getDb()
    .prepare('SELECT * FROM source_permissions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as SourcePermissionRow[];
  return rows.map(rowToSourcePermission);
}

/** 撤销指定数据类型权限（写入 revoked_at，保留历史） */
export function revokeSourcePermission(userId: string, dataType: string): void {
  getDb()
    .prepare(
      `UPDATE source_permissions
       SET revoked_at = ?
       WHERE user_id = ? AND data_type = ? AND revoked_at IS NULL`
    )
    .run(new Date().toISOString(), userId, dataType);
}

// ---------- linkEvidence 跨模块关联（Task 4.1，V4.3 §4.4） ----------

/**
 * 建立 Evidence 与业务对象的跨模块关联。
 * 更新 evidence_records 的 resource_type / resource_id / provenance 字段。
 * 若 evidence 不存在或不属于该用户，返回 false。
 */
export function linkEvidence(
  userId: string,
  evidenceId: string,
  resourceType: string,
  resourceId: string
): boolean {
  const d = getDb();
  const existing = d
    .prepare('SELECT id FROM evidence_records WHERE id = ? AND user_id = ?')
    .get(evidenceId, userId);
  if (!existing) return false;
  const provenance = { resource_type: resourceType, resource_id: resourceId };
  d.prepare(
    `UPDATE evidence_records
     SET resource_type = ?, resource_id = ?, provenance = ?
     WHERE id = ? AND user_id = ?`
  ).run(resourceType, resourceId, JSON.stringify(provenance), evidenceId, userId);
  return true;
}

// ---------- rollbackModelVersion 模型版本回滚（Task 4.4，V4.3 §4.25） ----------

/**
 * 回滚到指定模型版本：
 * - 将目标版本之后的所有版本标记为 'archived'
 * - 将目标版本标记为 'active'
 * 返回回滚后的版本；若版本不存在则返回 null。
 */
export function rollbackModelVersion(userId: string, versionId: string): PersonalModelVersion | null {
  const d = getDb();
  const target = d
    .prepare('SELECT * FROM personal_model_versions WHERE id = ? AND user_id = ?')
    .get(versionId, userId) as ModelVersionRow | undefined;
  if (!target) return null;
  // 将目标版本之后创建的所有版本归档
  d.prepare(
    `UPDATE personal_model_versions
     SET status = 'archived'
     WHERE user_id = ? AND created_at > ? AND status != 'archived'`
  ).run(userId, target.created_at);
  // 将目标版本设为 active
  d.prepare(
    `UPDATE personal_model_versions SET status = 'active' WHERE id = ? AND user_id = ?`
  ).run(versionId, userId);
  return rowToModelVersion(
    d.prepare('SELECT * FROM personal_model_versions WHERE id = ?').get(versionId) as ModelVersionRow
  );
}

// ---------- 密码重置令牌（Task 4.7，V4.3 §10 路线图 A26） ----------

/** 密码重置令牌有效期：30 分钟（spec 硬约束，非经验值；单一来源供 db/email 共享） */
export const PASSWORD_RESET_TTL_MINUTES = 30;
const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_MINUTES * 60 * 1000;

/**
 * 创建密码重置令牌（明文 token 返回给调用方发邮件，哈希落库）。30 分钟过期、一次性使用。
 *
 * 安全硬约束（spec Task 27.7）：
 * - 令牌用 crypto.randomBytes(32).toString('hex') 生成（64 字符 hex，256 位熵）
 *   —— 不用 randomUUID()（UUID v4 仅 122 位熵，不满足 spec「至少 32 字节随机」）
 * - 落库的是 SHA-256 哈希，不存明文
 */
export function createPasswordResetToken(userId: string): { token: string; expiresAt: string } {
  const d = getDb();
  const token = randomBytes(32).toString('hex');  // 64 字符 hex，256 位熵
  const tokenHash = sha(token);  // SHA-256 哈希落库（不存明文）
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`
  ).run(cryptoRandom(), userId, tokenHash, expiresAt, now);
  return { token, expiresAt };
}

/**
 * 消费密码重置令牌：校验有效+未过期+未使用，标记 used_at。
 * 返回 user_id；若令牌无效则返回 null。
 */
export function consumePasswordResetToken(token: string): { userId: string } | null {
  const d = getDb();
  const tokenHash = sha(token);
  const row = d
    .prepare(
      `SELECT user_id, expires_at, used_at FROM password_reset_tokens
       WHERE token_hash = ?`
    )
    .get(tokenHash) as { user_id: string; expires_at: string; used_at: string | null } | undefined;
  if (!row) return null;
  if (row.used_at) return null;  // 一次性使用
  if (new Date(row.expires_at).getTime() < Date.now()) return null;  // 已过期
  d.prepare(
    `UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?`
  ).run(new Date().toISOString(), tokenHash);
  return { userId: row.user_id };
}

/** 更新用户密码（重置密码用，需调用方完成认证后调用） */
export function updateUserPassword(userId: string, passwordHash: string): void {
  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(passwordHash, userId);
}

/** 按 email 查找用户（找回密码用，不存在返回 null） */
export function findUserByEmail(email: string): { id: string; email: string; display_name: string | null } | null {
  const row = getDb()
    .prepare('SELECT id, email, display_name FROM users WHERE email = ?')
    .get(email.toLowerCase()) as { id: string; email: string; display_name: string | null } | undefined;
  return row ?? null;
}

// ========== 行 → 类型化对象 转换函数（私有） ==========

type EvidenceRow = {
  id: string; user_id: string; source: string; evidence_type: string;
  occurred_at: string; captured_at: string; content_ref: string | null;
  context: string | null; privacy_level: string; quality_flags: string | null;
  status: string; provenance: string | null; resource_type: string | null;
  resource_id: string | null; created_at: string;
};
function rowToEvidence(r: EvidenceRow): EvidenceRecord {
  return {
    id: r.id, user_id: r.user_id,
    source: r.source as EvidenceSource,
    evidence_type: r.evidence_type as EvidenceType,
    occurred_at: r.occurred_at, captured_at: r.captured_at,
    content_ref: r.content_ref,
    context: parseJson<Record<string, unknown> | null>(r.context, null),
    privacy_level: r.privacy_level as PrivacyLevel,
    quality_flags: parseJson<Record<string, unknown> | null>(r.quality_flags, null),
    status: r.status as EvidenceRecord['status'],
    provenance: parseJson<EvidenceRecord['provenance']>(r.provenance, null),
    resource_type: r.resource_type,
    resource_id: r.resource_id,
    created_at: r.created_at,
  };
}

type PatternRow = {
  id: string; user_id: string; statement: string; scope: string | null;
  support_ids: string; counter_ids: string; alternative_explanations: string;
  recurrence_count: number; domain_count: number; last_seen: string | null;
  review_state: string; user_note: string | null; created_at: string;
};
function rowToPattern(r: PatternRow): PatternCandidate {
  return {
    id: r.id, user_id: r.user_id, statement: r.statement, scope: r.scope,
    support_ids: parseJson<string[]>(r.support_ids, []),
    counter_ids: parseJson<string[]>(r.counter_ids, []),
    alternative_explanations: parseJson<string[]>(r.alternative_explanations, []),
    recurrence_count: r.recurrence_count, domain_count: r.domain_count,
    last_seen: r.last_seen,
    review_state: r.review_state as PatternReviewState,
    user_note: r.user_note, created_at: r.created_at,
  };
}

type ExperienceRow = {
  id: string; user_id: string; context: string | null; problem: string | null;
  actions: string | null; outcome: string | null; lesson: string | null;
  support_ids: string; counter_ids: string; applicability: string | null;
  maturity: string; last_validated_at: string | null; version: number; created_at: string;
};
function rowToExperience(r: ExperienceRow): ExperienceUnit {
  return {
    id: r.id, user_id: r.user_id, context: r.context, problem: r.problem,
    actions: parseJson<unknown[] | null>(r.actions, null),
    outcome: r.outcome, lesson: r.lesson,
    support_ids: parseJson<string[]>(r.support_ids, []),
    counter_ids: parseJson<string[]>(r.counter_ids, []),
    applicability: r.applicability,
    maturity: r.maturity as ExperienceMaturity,
    last_validated_at: r.last_validated_at, version: r.version, created_at: r.created_at,
  };
}

type PersonalSkillRow = {
  id: string; user_id: string; trigger: string | null;
  preconditions: string | null; procedure: string | null; anti_patterns: string | null;
  scope: string | null; evidence_refs: string; last_validated_at: string | null;
  expiry_review: string | null; version: number; created_at: string;
};
function rowToPersonalSkill(r: PersonalSkillRow): PersonalSkill {
  return {
    id: r.id, user_id: r.user_id, trigger: r.trigger,
    preconditions: parseJson<unknown[] | null>(r.preconditions, null),
    procedure: parseJson<unknown[] | null>(r.procedure, null),
    anti_patterns: parseJson<unknown[] | null>(r.anti_patterns, null),
    scope: r.scope,
    evidence_refs: parseJson<string[]>(r.evidence_refs, []),
    last_validated_at: r.last_validated_at,
    expiry_review: r.expiry_review, version: r.version, created_at: r.created_at,
  };
}

type MetaPrincipleRow = {
  id: string; user_id: string; statement: string; domains: string;
  evidence: string; counterevidence: string; status: string;
  last_validated: string | null; created_at: string;
};
function rowToMetaPrinciple(r: MetaPrincipleRow): MetaPrinciple {
  return {
    id: r.id, user_id: r.user_id, statement: r.statement,
    domains: parseJson<string[]>(r.domains, []),
    evidence: parseJson<string[]>(r.evidence, []),
    counterevidence: parseJson<string[]>(r.counterevidence, []),
    status: r.status as MetaPrincipleStatus,
    last_validated: r.last_validated, created_at: r.created_at,
  };
}

type ModelVersionRow = {
  id: string; user_id: string; version: string; snapshot: string;
  change_log: string | null; status: string; created_at: string;
};
function rowToModelVersion(r: ModelVersionRow): PersonalModelVersion {
  return {
    id: r.id, user_id: r.user_id, version: r.version,
    snapshot: parseJson<Record<string, unknown>>(r.snapshot, {}),
    change_log: parseJson<Record<string, unknown> | null>(r.change_log, null),
    status: r.status as ModelVersionStatus,
    created_at: r.created_at,
  };
}

type DistillationJobRow = {
  id: string; user_id: string; trigger: string; input_scope: string | null;
  stage: string; result: string | null; error: string | null;
  retry_count: number; created_at: string; updated_at: string; completed_at: string | null;
};
export function rowToDistillationJob(r: DistillationJobRow): DistillationJob {
  return {
    id: r.id, user_id: r.user_id,
    trigger: r.trigger as DistillationTrigger,
    input_scope: parseJson<DistillationJob['input_scope']>(r.input_scope, null),
    stage: r.stage as DistillationStage,
    result: parseJson<Record<string, unknown> | null>(r.result, null),
    error: r.error,
    retry_count: r.retry_count ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

type ModelCorrectionRow = {
  id: string; user_id: string; target_id: string; target_type: string;
  correction_type: string; user_text: string | null; target_pattern: string | null;
  created_at: string;
};
function rowToModelCorrection(r: ModelCorrectionRow): ModelCorrection {
  return {
    id: r.id, user_id: r.user_id, target_id: r.target_id,
    target_type: r.target_type as CorrectionTargetType,
    correction_type: r.correction_type as CorrectionType,
    user_text: r.user_text, target_pattern: r.target_pattern, created_at: r.created_at,
  };
}

type SourcePermissionRow = {
  id: string; user_id: string; data_type: string; purpose: string | null;
  scope: string | null; granted_at: string | null; revoked_at: string | null;
  created_at: string;
};
function rowToSourcePermission(r: SourcePermissionRow): SourcePermission {
  return {
    id: r.id, user_id: r.user_id,
    data_type: r.data_type as DataType,
    purpose: r.purpose,
    scope: parseJson<Record<string, unknown> | null>(r.scope, null),
    granted_at: r.granted_at, revoked_at: r.revoked_at, created_at: r.created_at,
  };
}

type ServiceContractRow = {
  user_id: string; reflection_depth: string; agency_level: string;
  data_scope: string; proactivity: string; avatar: string; supporter_mode: string;
  accessibility_profile: string; quiet_hours: string | null;
  high_impact_confirmation: number; model_provider: string; local_only: number;
  consent_version: string | null; policy_version: string | null; updated_at: string;
};
function rowToServiceContract(r: ServiceContractRow): ServiceContract {
  return {
    user_id: r.user_id,
    reflection_depth: r.reflection_depth as ReflectionDepth,
    agency_level: r.agency_level as AgencyLevel,
    data_scope: parseJson<Record<string, boolean>>(r.data_scope, {}),
    proactivity: r.proactivity as ProactivityLevel,
    avatar: r.avatar as AvatarVisibility,
    supporter_mode: r.supporter_mode as SupporterMode,
    accessibility_profile: parseJson<ServiceContract['accessibility_profile']>(r.accessibility_profile, {}),
    quiet_hours: parseJson<ServiceContract['quiet_hours']>(r.quiet_hours, null),
    high_impact_confirmation: r.high_impact_confirmation === 1,
    model_provider: r.model_provider,
    local_only: r.local_only === 1,
    consent_version: r.consent_version,
    policy_version: r.policy_version,
    updated_at: r.updated_at,
  };
}
