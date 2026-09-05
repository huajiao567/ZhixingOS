import { Router } from 'express';
import { z } from 'zod';
import {
  getDb, audit, cryptoRandom, idempotencyCheck, purgeUser,
  createEvidence, getEvidencesByUser, getEvidenceById, deleteEvidence, linkEvidence, getEvidencesByResource,
  getPatternsByUser, updatePatternReviewState,
  createExperience, getExperiencesByUser, updateExperienceMaturity,
  createPersonalSkill, getPersonalSkillsByUser,
  createMetaPrinciple, getMetaPrinciplesByUser,
  rollbackModelVersion,
  getServiceContract, upsertServiceContract,
  createModelCorrection,
  updateHypothesisStatus,
  setHypothesisReviewAt,
  appendPatternUserNote,
  archiveActiveModelVersions,
  createModelVersion,
  createSourcePermission, getSourcePermissionsByUser, revokeSourcePermission,
  rowToDistillationJob,
} from '../db.js';
import type {
  EvidenceSource, EvidenceType, PrivacyLevel,
  PatternReviewState, ExperienceMaturity,
  ReflectionDepth, AgencyLevel, ProactivityLevel, AvatarVisibility, SupporterMode,
  DataScopeAxis,
  CorrectionType, CorrectionTargetType, DataType,
} from '../types.js';
import { deriveState } from '../services/stateEngine.js';
import { recomputeDependents, type RecomputeResult } from '../services/dependencyRecompute.js';
import { runDistillationPipeline } from '../services/distillation/pipeline.js';
import type { DistillationTrigger } from '../types.js';

export const dataRouter = Router();

function uid() { return cryptoRandom(); }
function now() { return new Date().toISOString(); }
const parse = (s: string, fallback: unknown) => { try { return JSON.parse(s); } catch { return fallback; } };

// P0-5：幂等写。相同 key 在 24h 内重复提交视为重复，返回已存在记录而非重复插入。
function dedupe(key: string): { duplicate: boolean; existingId?: string } {
  const { duplicate } = idempotencyCheck(key);
  return { duplicate };
}

/**
 * 解析分页参数 ?cursor=&limit=
 * - cursor: 上一页最后一条的排序字段值（ISO 时间戳字符串）
 * - limit: 整数，clamp 到 [min, max]
 */
function parsePagination(query: unknown, defaultLimit: number, maxLimit: number): { cursor: string | null; limit: number } {
  const q = (query ?? {}) as Record<string, unknown>;
  const cursor = typeof q.cursor === 'string' && q.cursor.length > 0 ? q.cursor : null;
  let limit = defaultLimit;
  if (typeof q.limit === 'string') {
    const n = parseInt(q.limit, 10);
    if (!Number.isNaN(n) && n > 0) limit = Math.min(n, maxLimit);
  } else if (typeof q.limit === 'number' && Number.isFinite(q.limit) && q.limit > 0) {
    limit = Math.min(Math.floor(q.limit), maxLimit);
  }
  return { cursor, limit };
}

// 读取 Idempotency-Key 头（可选），与 body.id 二选一
function idemKey(req: { headers: Record<string, string | string[] | undefined> }, body: any, prefix: string): string {
  const header = req.headers['idempotency-key'];
  const headerVal = Array.isArray(header) ? header[0] : header;
  if (typeof headerVal === 'string' && headerVal.length > 0) return `${prefix}:${headerVal}`;
  const id = (body?.id ?? uid()) as string;
  return `${prefix}:${id}`;
}

// 从请求体（App 端领域对象）提取索引列，兼容多种字段命名
// 安全数值转换：接受 number / 数字字符串 / null，拒绝对象/数组/NaN/Infinity（避免 SQLite REAL 列绑定崩溃）
// spec: mood ∈ [-1, 1]，weight ∈ [0, 1]，confidence ∈ [0, 1]；此处不 clamp，仅做类型守卫，
// 真正的 clamp 由 stateEngine 在读取时完成（保持写入宽容、读取严格的原则）
function safeNumber(v: unknown, fallback: number | null = null): number | null {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  // 对象、数组、布尔等无法安全绑定到 REAL 列 → fallback
  return fallback;
}
function safeInt(v: unknown, fallback: number): number {
  const n = safeNumber(v, fallback);
  return n == null ? fallback : Math.trunc(n);
}

function extractEvent(body: any) {
  const axis: 'inner' | 'outer' =
    body.axis === 'inner' || body.axis === 'outer'
      ? body.axis
      : body.userInterpretation != null
        ? 'inner'
        : 'outer';
  return {
    content: body.content ?? body.title ?? body.statement ?? '(未命名事件)',
    source: body.source ?? body.sourceType ?? 'user',
    layer: body.layer ?? 'fact',
    mood: safeNumber(body.mood, null),
    tags: JSON.stringify(body.tags ?? (body.domain ? [body.domain] : [])),
    user_interpretation: body.user_interpretation ?? body.userInterpretation ?? null,
    axis,
    created_at: body.created_at ?? body.startTime ?? body.createdAt ?? now(),
  };
}
function extractCommitment(body: any) {
  const w = safeNumber(body.weight, null);
  const p = safeNumber(body.priority, null);
  // weight 默认 0.5；若指定了 priority（数值且非 0），则 weight = 1 / priority
  const weight = w ?? (p != null && p !== 0 ? 1 / p : 0.5);
  return {
    text: body.text ?? body.statement ?? '(承诺)',
    domain: body.domain ?? '生活',
    weight,
    status: body.status ?? 'active',
    created_at: body.created_at ?? body.createdAt ?? now(),
  };
}
function extractHypothesis(body: any) {
  return {
    statement: body.statement ?? '(假设)',
    confidence: safeNumber(body.confidence, 0.5) ?? 0.5,
    status: body.status ?? 'testing',
    created_at: body.created_at ?? body.createdAt ?? now(),
  };
}
function extractExperiment(body: any) {
  return {
    title: body.title ?? body.question ?? '(实验)',
    duration_days: safeInt(body.duration_days ?? body.durationDays, 7),
    status: body.status ?? 'planned',
    started_at: body.started_at ?? body.startDate ?? body.startedAt ?? now(),
  };
}

// 返回 doc（完整 App 对象），保证 id 字段存在
function rowToDoc(row: any): any {
  const doc = parse(row.doc, {});
  return { ...doc, id: row.id };
}

// 引擎用的索引视图（事件）
export function getIndexedEvents(userId: string) {
  const rows = getDb()
    .prepare('SELECT id, content, source, layer, mood, tags, user_interpretation, axis, created_at FROM events WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200')
    .all(userId) as any[];
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    layer: r.layer,
    mood: r.mood ?? 0,
    tags: parse(r.tags, []) as string[],
    user_interpretation: r.user_interpretation ?? null,
    axis: (r.axis === 'inner' || r.axis === 'outer' ? r.axis : 'outer') as 'inner' | 'outer',
    created_at: r.created_at,
  }));
}

export function getIndexedCommitments(userId: string) {
  return getDb()
    .prepare('SELECT id, user_id, text, domain, weight, status, created_at FROM commitments WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(userId) as any[];
}

// ---------- 事件 ----------
// V4.3 修复：原 GET /events 完全未用 parsePagination，?limit=N 不生效（实测请求 limit=2 返回 39 条）
dataRouter.get('/events', (req, res) => {
  const userId = (req as any).userId;
  const { cursor, limit } = parsePagination(req.query, 50, 200);
  const rows = cursor
    ? getDb().prepare('SELECT * FROM events WHERE user_id = ? AND deleted_at IS NULL AND created_at < ? ORDER BY created_at DESC LIMIT ?').all(userId, cursor, limit) as any[]
    : getDb().prepare('SELECT * FROM events WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?').all(userId, limit) as any[];
  res.json(rows.map(rowToDoc));
});

dataRouter.post('/events', (req, res) => {
  const body = req.body ?? {};
  const id = body.id ?? uid();
  if (dedupe(`ev:${id}`).duplicate) {
    const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as any;
    if (row) { res.json(rowToDoc(row)); return; }
  }
  const idx = extractEvent(body);
  getDb().prepare(
    `INSERT INTO events (id, user_id, content, source, layer, mood, tags, user_interpretation, axis, created_at, doc) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, (req as any).userId, idx.content, idx.source, idx.layer, idx.mood, idx.tags, idx.user_interpretation, idx.axis, idx.created_at, JSON.stringify({ ...body, id, axis: idx.axis }));
  audit((req as any).userId, 'event.create', { id, content: idx.content, axis: idx.axis });
  const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as any;
  res.json(rowToDoc(row));
});

// P0-7：真正删除（硬删除，非软删除）——"软删除"不得称为遗忘
// Task 6: 删除 event 时级联重算所有关联 evidence 的派生对象
dataRouter.delete('/events/:id', (req, res) => {
  const userId = (req as any).userId;
  const db = getDb();
  const ev = db.prepare('SELECT id FROM events WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!ev) { res.status(404).json({ error: '事件不存在' }); return; }

  // Task 6: 先查该 event 关联的所有 evidence_records，逐个触发级联重算
  const linkedEvidence = getEvidencesByResource(userId, 'event', req.params.id);
  const recomputeResults: RecomputeResult[] = [];
  for (const evidenceRec of linkedEvidence) {
    // 级联重算：移除 evidenceId 引用 + 降级/失效 + LLM 缓存清理 + 审计
    const result = recomputeDependents(evidenceRec.id);
    recomputeResults.push(result);
    // 软删除 evidence（status='deleted'，保留记录用于审计追溯）
    deleteEvidence(userId, evidenceRec.id);
  }

  // 硬删除 event
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  audit(userId, 'event.delete', {
    id: req.params.id,
    cascadedEvidenceCount: linkedEvidence.length,
  });
  res.json({ ok: true, deletedAt: now(), cascadedRecompute: recomputeResults });
});

// ---------- 承诺 ----------
dataRouter.get('/commitments', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM commitments WHERE user_id = ? ORDER BY created_at DESC').all((req as any).userId);
  res.json(rows.map(rowToDoc));
});

dataRouter.post('/commitments', (req, res) => {
  const body = req.body ?? {};
  const id = body.id ?? uid();
  if (dedupe(`cm:${id}`).duplicate) {
    const row = getDb().prepare('SELECT * FROM commitments WHERE id = ?').get(id) as any;
    if (row) { res.json(rowToDoc(row)); return; }
  }
  const idx = extractCommitment(body);
  getDb().prepare('INSERT INTO commitments (id, user_id, text, domain, weight, status, created_at, doc) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, (req as any).userId, idx.text, idx.domain, idx.weight, idx.status, idx.created_at, JSON.stringify({ ...body, id }));
  audit((req as any).userId, 'commitment.create', { id, text: idx.text });
  res.json(rowToDoc(getDb().prepare('SELECT * FROM commitments WHERE id = ?').get(id) as any));
});

// ---------- 假设 ----------
dataRouter.get('/hypotheses', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM hypotheses WHERE user_id = ? ORDER BY created_at DESC').all((req as any).userId);
  res.json(rows.map(rowToDoc));
});

dataRouter.post('/hypotheses', (req, res) => {
  const body = req.body ?? {};
  const id = body.id ?? uid();
  if (dedupe(`hy:${id}`).duplicate) {
    const row = getDb().prepare('SELECT * FROM hypotheses WHERE id = ?').get(id) as any;
    if (row) { res.json(rowToDoc(row)); return; }
  }
  const idx = extractHypothesis(body);
  getDb().prepare('INSERT INTO hypotheses (id, user_id, statement, confidence, status, created_at, doc) VALUES (?,?,?,?,?,?,?)')
    .run(id, (req as any).userId, idx.statement, idx.confidence, idx.status, idx.created_at, JSON.stringify({ ...body, id }));
  audit((req as any).userId, 'hypothesis.create', { id, statement: idx.statement });
  res.json(rowToDoc(getDb().prepare('SELECT * FROM hypotheses WHERE id = ?').get(id) as any));
});

dataRouter.patch('/hypotheses/:id', (req, res) => {
  const userId = (req as any).userId;
  const existing = getDb().prepare('SELECT doc FROM hypotheses WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;
  if (!existing) { res.status(404).json({ error: '假设不存在' }); return; }
  const merged = { ...parse(existing.doc, {}), ...req.body, id: req.params.id };
  const idx = extractHypothesis(merged);
  getDb().prepare('UPDATE hypotheses SET statement=?, confidence=?, status=?, created_at=?, doc=? WHERE id=?')
    .run(idx.statement, idx.confidence, idx.status, idx.created_at, JSON.stringify(merged), req.params.id);
  // Task 27.2: 支持 review_at 字段（ISO 时间字符串或 null）
  // review_at 不在 extractHypothesis 中提取，单独通过 setHypothesisReviewAt 写入，
  // 保证 doc.reviewAt 与索引列 review_at 一致（与 updateHypothesisStatus 同样的合并模式）
  if (Object.prototype.hasOwnProperty.call(req.body, 'review_at')) {
    const rawReviewAt = req.body.review_at;
    // 校验：仅接受 ISO 字符串或 null，避免脏数据写入索引列
    if (rawReviewAt !== null && (typeof rawReviewAt !== 'string' || Number.isNaN(Date.parse(rawReviewAt)))) {
      res.status(400).json({ error: 'review_at 必须为 ISO 时间字符串或 null' });
      return;
    }
    setHypothesisReviewAt(req.params.id, rawReviewAt);
    // 同步到 merged，使返回值反映最新状态
    if (rawReviewAt === null) {
      delete merged.reviewAt;
    } else {
      merged.reviewAt = rawReviewAt;
    }
    audit(userId, 'hypothesis.review_at.set', { id: req.params.id, reviewAt: rawReviewAt });
  }
  audit(userId, 'hypothesis.update', { id: req.params.id });
  res.json(merged);
});

// ---------- 实验 ----------
dataRouter.get('/experiments', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM experiments WHERE user_id = ? ORDER BY started_at DESC').all((req as any).userId);
  res.json(rows.map(rowToDoc));
});

dataRouter.post('/experiments', (req, res) => {
  const body = req.body ?? {};
  const id = body.id ?? uid();
  if (dedupe(`ex:${id}`).duplicate) {
    const row = getDb().prepare('SELECT * FROM experiments WHERE id = ?').get(id) as any;
    if (row) { res.json(rowToDoc(row)); return; }
  }
  const idx = extractExperiment(body);
  getDb().prepare('INSERT INTO experiments (id, user_id, title, duration_days, status, started_at, doc) VALUES (?,?,?,?,?,?,?)')
    .run(id, (req as any).userId, idx.title, idx.duration_days, idx.status, idx.started_at, JSON.stringify({ ...body, id }));
  audit((req as any).userId, 'experiment.create', { id, title: idx.title });
  res.json(rowToDoc(getDb().prepare('SELECT * FROM experiments WHERE id = ?').get(id) as any));
});

dataRouter.patch('/experiments/:id', (req, res) => {
  const userId = (req as any).userId;
  const existing = getDb().prepare('SELECT doc FROM experiments WHERE id = ? AND user_id = ?').get(req.params.id, userId) as any;
  if (!existing) { res.status(404).json({ error: '实验不存在' }); return; }
  const merged = { ...parse(existing.doc, {}), ...req.body, id: req.params.id };
  const idx = extractExperiment(merged);
  getDb().prepare('UPDATE experiments SET title=?, duration_days=?, status=?, started_at=?, doc=? WHERE id=?')
    .run(idx.title, idx.duration_days, idx.status, idx.started_at, JSON.stringify(merged), req.params.id);
  audit(userId, 'experiment.update', { id: req.params.id });
  res.json(merged);
});

// ---------- 项目 ----------
dataRouter.get('/projects', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC').all((req as any).userId);
  res.json(rows.map(rowToDoc));
});

dataRouter.post('/projects', (req, res) => {
  const body = req.body ?? {};
  const id = body.id ?? uid();
  if (dedupe(`pj:${id}`).duplicate) {
    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (row) { res.json(rowToDoc(row)); return; }
  }
  getDb().prepare('INSERT INTO projects (id, user_id, name, created_at, doc) VALUES (?,?,?,?,?)')
    .run(id, (req as any).userId, body.name ?? body.title ?? '(项目)', now(), JSON.stringify({ ...body, id }));
  audit((req as any).userId, 'project.create', { id });
  res.json(rowToDoc(getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as any));
});

// ---------- 技能 / 意义 ----------
dataRouter.get('/skills', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM skills WHERE user_id = ?').all((req as any).userId);
  res.json(rows.map(rowToDoc));
});

dataRouter.post('/skills', (req, res) => {
  const body = req.body ?? {};
  const id = body.id ?? uid();
  if (dedupe(`sk:${id}`).duplicate) {
    const row = getDb().prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
    if (row) { res.json(rowToDoc(row)); return; }
  }
  getDb().prepare('INSERT INTO skills (id, user_id, name, doc) VALUES (?,?,?,?)')
    .run(id, (req as any).userId, body.name ?? '(技能)', JSON.stringify({ ...body, id }));
  res.json(rowToDoc(getDb().prepare('SELECT * FROM skills WHERE id = ?').get(id) as any));
});

dataRouter.get('/meanings', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM meanings WHERE user_id = ? ORDER BY created_at DESC').all((req as any).userId);
  res.json(rows.map(rowToDoc));
});

dataRouter.post('/meanings', (req, res) => {
  const body = req.body ?? {};
  const id = body.id ?? uid();
  if (dedupe(`mn:${id}`).duplicate) {
    const row = getDb().prepare('SELECT * FROM meanings WHERE id = ?').get(id) as any;
    if (row) { res.json(rowToDoc(row)); return; }
  }
  getDb().prepare('INSERT INTO meanings (id, user_id, direction, created_at, doc) VALUES (?,?,?,?,?)')
    .run(id, (req as any).userId, body.direction ?? body.statement ?? '(意义方向)', now(), JSON.stringify({ ...body, id }));
  res.json(rowToDoc(getDb().prepare('SELECT * FROM meanings WHERE id = ?').get(id) as any));
});

// ---------- 六位状态（实时计算） ----------
dataRouter.get('/state', (req, res) => {
  res.json(deriveState(getIndexedEvents((req as any).userId), getIndexedCommitments((req as any).userId)));
});

// ---------- 审计日志（Task 4.5：cursor 分页） ----------
dataRouter.get('/audit', (req, res) => {
  const userId = (req as any).userId;
  const { cursor, limit } = parsePagination(req.query, 200, 500);
  const d = getDb();
  let rows: any[];
  if (cursor) {
    rows = d.prepare('SELECT * FROM audit_logs WHERE user_id = ? AND ts < ? ORDER BY ts DESC LIMIT ?').all(userId, cursor, limit) as any[];
  } else {
    rows = d.prepare('SELECT * FROM audit_logs WHERE user_id = ? ORDER BY ts DESC LIMIT ?').all(userId, limit) as any[];
  }
  const items = rows.map((r) => ({ id: r.id, at: r.ts, actor: '系统', action: r.action, detail: parse(r.detail, {}) }));
  const nextCursor = rows.length === limit ? (rows[rows.length - 1] as any).ts : null;
  res.json({ items, nextCursor });
});

// ========== V4.3 自我沉淀系统端点（Task 4.1-4.4） ==========

// ---------- Evidence 证据记录（幂等键前缀 ev:） ----------
const evidenceSourceSchema = z.enum([
  'manual_text', 'manual_voice', 'photo', 'calendar', 'task', 'health',
  'device_usage', 'desktop_usage', 'nutrition', 'project', 'system',
]);
const evidenceTypeSchema = z.enum(['fact', 'self_report', 'outcome', 'correction', 'context']);
const privacyLevelSchema = z.enum(['D0', 'D1', 'D2', 'D3']);

const createEvidenceSchema = z.object({
  id: z.string().optional(),
  source: evidenceSourceSchema,
  evidence_type: evidenceTypeSchema,
  occurred_at: z.string().min(1),
  captured_at: z.string().optional(),
  content_ref: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  privacy_level: privacyLevelSchema.optional(),
  quality_flags: z.record(z.unknown()).optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
});

dataRouter.get('/evidence', (req, res) => {
  const userId = (req as any).userId;
  const list = getEvidencesByUser(userId, 500);
  res.json(list);
});

dataRouter.post('/evidence', (req, res) => {
  const userId = (req as any).userId;
  const parsed = createEvidenceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const body = parsed.data;
  const key = idemKey(req, body, 'ev');
  if (dedupe(key).duplicate) {
    // 幂等重复：返回 200（非 201）
    res.status(200).json({ ok: true, duplicate: true, idempotencyKey: key });
    return;
  }
  const ev = createEvidence(userId, {
    source: body.source as EvidenceSource,
    evidence_type: body.evidence_type as EvidenceType,
    occurred_at: body.occurred_at,
    captured_at: body.captured_at,
    content_ref: body.content_ref,
    context: body.context,
    privacy_level: body.privacy_level as PrivacyLevel | undefined,
    quality_flags: body.quality_flags,
    resource_type: body.resource_type,
    resource_id: body.resource_id,
  });
  // 若含 resource_type/resource_id，自动调用 linkEvidence 建立跨模块关联（显式调用，确保关联建立）
  if (body.resource_type && body.resource_id) {
    linkEvidence(userId, ev.id, body.resource_type, body.resource_id);
  }
  audit(userId, 'evidence.create', { id: ev.id, source: ev.source, evidence_type: ev.evidence_type });
  res.status(201).json(ev);
});

dataRouter.delete('/evidence/:id', (req, res) => {
  const userId = (req as any).userId;
  const evId = req.params.id;
  // 校验 evidence 存在且属于该用户（安全检查：防止跨用户触发级联）
  const existing = getEvidenceById(evId);
  if (!existing || existing.user_id !== userId) {
    res.status(404).json({ error: '证据不存在' });
    return;
  }
  // 软删除证据（status='deleted'，保留记录用于审计追溯）
  deleteEvidence(userId, evId);
  // 触发删除级联重算（Task 6 完整实现：降级/失效 + LLM 缓存清理 + 审计）
  const recomputeResult = recomputeDependents(evId);
  audit(userId, 'evidence.delete', { id: evId, recompute: recomputeResult });
  res.json({ ok: true, deletedAt: now(), recompute: recomputeResult });
});

// ---------- Pattern 候选模式（幂等键前缀 pat:） ----------
const patternReviewStateSchema = z.enum(['candidate', 'keep', 'watch', 'reject', 'stale']);
const createPatternSchema = z.object({
  id: z.string().optional(),
  statement: z.string().min(1),
  scope: z.string().optional(),
  support_ids: z.array(z.string()).optional(),
  counter_ids: z.array(z.string()).optional(),
  alternative_explanations: z.array(z.string()).optional(),
  recurrence_count: z.number().int().min(0).optional(),
  domain_count: z.number().int().min(0).optional(),
  last_seen: z.string().optional(),
  review_state: patternReviewStateSchema.optional(),
  user_note: z.string().optional(),
});
const patchPatternSchema = z.object({
  review_state: patternReviewStateSchema.optional(),
  user_note: z.string().optional(),
});

dataRouter.get('/patterns', (req, res) => {
  const userId = (req as any).userId;
  const list = getPatternsByUser(userId, 200);
  res.json(list);
});

dataRouter.patch('/patterns/:id', (req, res) => {
  const userId = (req as any).userId;
  const parsed = patchPatternSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  // 校验 pattern 归属
  const existing = getDb().prepare('SELECT id FROM pattern_candidates WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!existing) { res.status(404).json({ error: '模式不存在' }); return; }
  if (parsed.data.review_state) {
    updatePatternReviewState(req.params.id, parsed.data.review_state as PatternReviewState);
  }
  if (parsed.data.user_note !== undefined) {
    getDb().prepare('UPDATE pattern_candidates SET user_note = ? WHERE id = ?').run(parsed.data.user_note, req.params.id);
  }
  audit(userId, 'pattern.update', { id: req.params.id, fields: Object.keys(parsed.data) });
  const row = getDb().prepare('SELECT * FROM pattern_candidates WHERE id = ?').get(req.params.id) as any;
  res.json(row);
});

// ---------- Experience 可复用经验（幂等键前缀 exp:） ----------
const experienceMaturitySchema = z.enum([
  'candidate', 'observed', 'repeated', 'validated', 'stale', 'retired',
]);
const createExperienceSchema = z.object({
  id: z.string().optional(),
  context: z.string().optional(),
  problem: z.string().optional(),
  actions: z.array(z.unknown()).optional(),
  outcome: z.string().optional(),
  lesson: z.string().optional(),
  support_ids: z.array(z.string()).optional(),
  counter_ids: z.array(z.string()).optional(),
  applicability: z.string().optional(),
  maturity: experienceMaturitySchema.optional(),
  last_validated_at: z.string().optional(),
  version: z.number().int().min(1).optional(),
});
const patchExperienceSchema = z.object({
  maturity: experienceMaturitySchema.optional(),
  lesson: z.string().optional(),
  applicability: z.string().optional(),
});

dataRouter.get('/experiences', (req, res) => {
  const userId = (req as any).userId;
  const list = getExperiencesByUser(userId, 200);
  res.json(list);
});

dataRouter.post('/experiences', (req, res) => {
  const userId = (req as any).userId;
  const parsed = createExperienceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const body = parsed.data;
  const key = idemKey(req, body, 'exp');
  if (dedupe(key).duplicate) {
    res.status(200).json({ ok: true, duplicate: true, idempotencyKey: key });
    return;
  }
  const exp = createExperience(userId, {
    context: body.context,
    problem: body.problem,
    actions: body.actions,
    outcome: body.outcome,
    lesson: body.lesson,
    support_ids: body.support_ids,
    counter_ids: body.counter_ids,
    applicability: body.applicability,
    maturity: body.maturity as ExperienceMaturity | undefined,
    last_validated_at: body.last_validated_at,
    version: body.version,
  });
  audit(userId, 'experience.create', { id: exp.id, maturity: exp.maturity });
  res.status(201).json(exp);
});

dataRouter.patch('/experiences/:id', (req, res) => {
  const userId = (req as any).userId;
  const parsed = patchExperienceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const existing = getDb().prepare('SELECT id FROM experience_units WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!existing) { res.status(404).json({ error: '经验不存在' }); return; }
  if (parsed.data.maturity) {
    updateExperienceMaturity(req.params.id, parsed.data.maturity as ExperienceMaturity);
  }
  if (parsed.data.lesson !== undefined) {
    getDb().prepare('UPDATE experience_units SET lesson = ? WHERE id = ?').run(parsed.data.lesson, req.params.id);
  }
  if (parsed.data.applicability !== undefined) {
    getDb().prepare('UPDATE experience_units SET applicability = ? WHERE id = ?').run(parsed.data.applicability, req.params.id);
  }
  audit(userId, 'experience.update', { id: req.params.id, fields: Object.keys(parsed.data) });
  const row = getDb().prepare('SELECT * FROM experience_units WHERE id = ?').get(req.params.id) as any;
  res.json(row);
});

// ---------- PersonalSkill 领域方法（幂等键前缀 psk:） ----------
const createPersonalSkillSchema = z.object({
  id: z.string().optional(),
  trigger: z.string().optional(),
  preconditions: z.array(z.unknown()).optional(),
  procedure: z.array(z.unknown()).optional(),
  anti_patterns: z.array(z.unknown()).optional(),
  scope: z.string().optional(),
  evidence_refs: z.array(z.string()).optional(),
  last_validated_at: z.string().optional(),
  expiry_review: z.string().optional(),
  version: z.number().int().min(1).optional(),
});

dataRouter.get('/personal-skills', (req, res) => {
  const userId = (req as any).userId;
  const list = getPersonalSkillsByUser(userId, 200);
  res.json(list);
});

dataRouter.post('/personal-skills', (req, res) => {
  const userId = (req as any).userId;
  const parsed = createPersonalSkillSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const body = parsed.data;
  const key = idemKey(req, body, 'psk');
  if (dedupe(key).duplicate) {
    res.status(200).json({ ok: true, duplicate: true, idempotencyKey: key });
    return;
  }
  const skill = createPersonalSkill(userId, {
    trigger: body.trigger,
    preconditions: body.preconditions,
    procedure: body.procedure,
    anti_patterns: body.anti_patterns,
    scope: body.scope,
    evidence_refs: body.evidence_refs,
    last_validated_at: body.last_validated_at,
    expiry_review: body.expiry_review,
    version: body.version,
  });
  audit(userId, 'personal_skill.create', { id: skill.id, scope: skill.scope });
  res.status(201).json(skill);
});

// ---------- MetaPrinciple 跨领域原则（幂等键前缀 mep:） ----------
const createMetaPrincipleSchema = z.object({
  id: z.string().optional(),
  statement: z.string().min(1),
  domains: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
  counterevidence: z.array(z.string()).optional(),
  status: z.enum(['candidate', 'keep', 'watch', 'reject', 'stale']).optional(),
  last_validated: z.string().optional(),
});

dataRouter.get('/meta-principles', (req, res) => {
  const userId = (req as any).userId;
  const list = getMetaPrinciplesByUser(userId, 200);
  res.json(list);
});

dataRouter.post('/meta-principles', (req, res) => {
  const userId = (req as any).userId;
  const parsed = createMetaPrincipleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const body = parsed.data;
  const key = idemKey(req, body, 'mep');
  if (dedupe(key).duplicate) {
    res.status(200).json({ ok: true, duplicate: true, idempotencyKey: key });
    return;
  }
  const mp = createMetaPrinciple(userId, {
    statement: body.statement,
    domains: body.domains,
    evidence: body.evidence,
    counterevidence: body.counterevidence,
    status: body.status as any,
    last_validated: body.last_validated,
  });
  audit(userId, 'meta_principle.create', { id: mp.id, statement: mp.statement });
  res.status(201).json(mp);
});

// ---------- DistillationJob 蒸馏任务（V4.3 §4.18 / Task 11） ----------
// GET  列表查询（含状态、stage、result）
// POST 手动触发流水线（trigger='manual' 或 'event' 等）
//      同步执行 8 阶段并返回完整结果；worker 仅负责失败重试
const distillationTriggerSchema = z.enum([
  'manual', 'scheduled', 'event', 'project_end', 'major_correction', 'milestone',
]);
const createDistillationJobSchema = z.object({
  trigger: distillationTriggerSchema,
  timeWindow: z.object({
    start: z.string().min(1),
    end: z.string().min(1),
  }),
  project: z.string().optional(),
  topic: z.string().optional(),
});

dataRouter.get('/distillation-jobs', (req, res) => {
  const userId = (req as any).userId;
  // 仅返回该用户的蒸馏任务，按 created_at 倒序
  // V4.3 修复：用 rowToDistillationJob 解析 input_scope/result JSON 字段（与其他端点一致）
  const rows = getDb()
    .prepare('SELECT * FROM distillation_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(userId) as any[];
  res.json(rows.map(rowToDistillationJob));
});

dataRouter.post('/distillation-jobs', async (req, res) => {
  const userId = (req as any).userId;
  const parsed = createDistillationJobSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const { trigger, timeWindow, project, topic } = parsed.data;
  // 校验时间窗：start 必须 < end
  if (Date.parse(timeWindow.start) >= Date.parse(timeWindow.end)) {
    res.status(400).json({ error: 'timeWindow.start 必须早于 timeWindow.end' });
    return;
  }
  // 幂等键：相同内容 24h 内不重复触发
  const idemKey = `dj:${userId}:${trigger}:${timeWindow.start}:${timeWindow.end}:${project ?? ''}:${topic ?? ''}`;
  if (dedupe(idemKey).duplicate) {
    res.status(200).json({ ok: true, duplicate: true, idempotencyKey: idemKey });
    return;
  }
  try {
    const result = await runDistillationPipeline({
      userId,
      timeWindow,
      project,
      topic,
      trigger: trigger as DistillationTrigger,
    });
    audit(userId, 'distillation.job.created', {
      jobId: result.jobId,
      trigger,
      candidatesCommitted: result.candidatesCommitted,
      candidatesPendingUserReview: result.candidatesPendingUserReview,
      stageCount: result.stages.length,
    });
    res.status(201).json(result);
  } catch (e: any) {
    audit(userId, 'distillation.job.failed', { trigger, error: String(e?.message ?? e) });
    res.status(500).json({ error: '蒸馏流水线执行失败', detail: e?.message ?? String(e) });
  }
});

// ---------- ServiceContract 服务契约（Task 4.2，每用户唯一） ----------
const reflectionDepthSchema = z.enum(['R0', 'R1', 'R2', 'R3']);
const agencyLevelSchema = z.enum(['A0', 'A1', 'A2', 'A3', 'A4']);
const proactivitySchema = z.enum(['P0', 'P1', 'P2', 'P3']);
const avatarVisibilitySchema = z.enum(['V0', 'V1', 'V2', 'V3']);
const supporterModeSchema = z.enum(['S0', 'S1', 'S2']);

const putServiceContractSchema = z.object({
  reflection_depth: reflectionDepthSchema.optional(),
  agency_level: agencyLevelSchema.optional(),
  data_scope: z.record(z.string(), z.boolean()).optional(),
  proactivity: proactivitySchema.optional(),
  avatar: avatarVisibilitySchema.optional(),
  supporter_mode: supporterModeSchema.optional(),
  accessibility_profile: z.record(z.string(), z.unknown()).optional(),
  quiet_hours: z.union([
    z.object({ start: z.string(), end: z.string() }),
    z.null(),
  ]).optional(),
  high_impact_confirmation: z.boolean().optional(),
  model_provider: z.string().optional(),
  local_only: z.boolean().optional(),
  consent_version: z.string().optional(),
  policy_version: z.string().optional(),
});

dataRouter.get('/service-contract', (req, res) => {
  const userId = (req as any).userId;
  let contract = getServiceContract(userId);
  if (!contract) {
    // 不存在则用默认值创建
    contract = upsertServiceContract(userId, {});
    audit(userId, 'service_contract.default_created', {});
  }
  res.json(contract);
});

dataRouter.put('/service-contract', (req, res) => {
  const userId = (req as any).userId;
  const parsed = putServiceContractSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  // 敏感操作：记录审计但 detail 不保存原文敏感数据（仅记录修改的字段名）
  const changedFields = Object.keys(parsed.data);
  const contract = upsertServiceContract(userId, {
    reflection_depth: parsed.data.reflection_depth as ReflectionDepth | undefined,
    agency_level: parsed.data.agency_level as AgencyLevel | undefined,
    data_scope: parsed.data.data_scope,
    proactivity: parsed.data.proactivity as ProactivityLevel | undefined,
    avatar: parsed.data.avatar as AvatarVisibility | undefined,
    supporter_mode: parsed.data.supporter_mode as SupporterMode | undefined,
    accessibility_profile: parsed.data.accessibility_profile,
    quiet_hours: parsed.data.quiet_hours ?? undefined,
    high_impact_confirmation: parsed.data.high_impact_confirmation,
    model_provider: parsed.data.model_provider,
    local_only: parsed.data.local_only,
    consent_version: parsed.data.consent_version,
    policy_version: parsed.data.policy_version,
  });
  audit(userId, 'service_contract.update', { changedFields });
  res.json(contract);
});

// ---------- ModelCorrection 用户纠正列表（Task 4.3） ----------
dataRouter.get('/corrections', (req, res) => {
  const userId = (req as any).userId;
  const { cursor, limit } = parsePagination(req.query, 50, 200);
  const d = getDb();
  let rows: any[];
  if (cursor) {
    rows = d.prepare(
      'SELECT * FROM model_corrections WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, cursor, limit) as any[];
  } else {
    rows = d.prepare(
      'SELECT * FROM model_corrections WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as any[];
  }
  const nextCursor = rows.length === limit ? (rows[rows.length - 1] as any).created_at : null;
  res.json({ items: rows, nextCursor });
});

// ---------- ModelCorrection 用户纠正提交（Task 8：6 种 correction_type 状态机） ----------
// spec A4.2：6 种 correction_type 各有不同后台变化，全部在事务中完成
const correctionSchema = z.object({
  target_id: z.string().min(1),
  target_type: z.enum(['hypothesis', 'pattern', 'experience', 'skill', 'meta_principle']),
  correction_type: z.enum(['unlike-me', 'wrong-reason', 'special-case', 'wait', 'no-more-inference', 'phase-changed']),
  // nullish：同时接受 string / null / undefined。
  // 理由：types.ts ModelCorrection.user_text 类型为 `string | null`；
  // wait/no-more-inference 等纠正类型用户无需提供说明，前端可能传 null 或省略字段；
  // 旧 schema 仅 .optional() 接受 undefined 但拒绝 null，与类型定义不一致。
  user_text: z.string().max(2000).nullish(),
});

dataRouter.post('/corrections', (req, res) => {
  const userId = (req as any).userId;
  const parsed = correctionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const { target_id, target_type, correction_type, user_text } = parsed.data;

  // 幂等键：用户纠正同样支持 24h 内重复提交去重
  const key = idemKey(req, parsed.data, 'mco');
  if (dedupe(key).duplicate) {
    res.status(200).json({ ok: true, duplicate: true, idempotencyKey: key });
    return;
  }

  const d = getDb();
  let createdCorrection: ReturnType<typeof createModelCorrection> | null = null;
  let newEvidenceId: string | null = null;
  let archivedVersionIds: string[] = [];
  let newModelVersionId: string | null = null;

  try {
    d.exec('BEGIN');

    // 1️⃣ unlike-me：当前候选降级（pattern.review_state='reject' / hypothesis.status='rejected'）
    if (correction_type === 'unlike-me') {
      if (target_type === 'pattern') {
        updatePatternReviewState(target_id, 'reject');
      } else if (target_type === 'hypothesis') {
        updateHypothesisStatus(target_id, 'rejected');
      }
      // spec SubTask 8.2：不写 hard negative（已通过 review_state='reject' 表达）
    }

    // 2️⃣ wrong-reason：保留事实，原 hypothesis.status='revised'；用户输入作为新 Evidence（evidence_type='self_report'）
    if (correction_type === 'wrong-reason') {
      if (target_type === 'hypothesis') {
        updateHypothesisStatus(target_id, 'revised');
      }
      // 创建用户自述 Evidence（privacy_level='D1' 含敏感个人信息）
      const ev = createEvidence(userId, {
        source: 'system',
        evidence_type: 'self_report',
        occurred_at: now(),
        content_ref: user_text ?? '(用户未提供具体说明)',
        context: { correction_target: target_id, correction_target_type: target_type },
        privacy_level: 'D1',
        resource_type: 'hypothesis',
        resource_id: target_type === 'hypothesis' ? target_id : undefined,
      });
      newEvidenceId = ev.id;
      // spec A4.2「保留事实」→ 不删除原 evidence，不调 recomputeDependents
      // 新 evidence 尚未被任何 pattern 引用，调 recomputeDependents 返回空结果，故不调用
    }

    // 3️⃣ special-case：创建 context exception（pattern.user_note 追加「[特殊情况 ${date}] ${user_text}」）
    if (correction_type === 'special-case') {
      if (target_type === 'pattern') {
        const dateStr = new Date().toISOString().slice(0, 10);
        const noteText = `[特殊情况 ${dateStr}] ${user_text ?? '(用户未提供说明)'}`;
        appendPatternUserNote(target_id, noteText);
      }
      // 不改变 review_state（仍可继续观察）
    }

    // 4️⃣ wait：保持 candidate 状态不变，仅记录 model_corrections
    // 仍允许 LLM 后续推断时引用此 pattern（不主动降低 confidence 字段，由 LLM 上下文层处理）
    if (correction_type === 'wait') {
      // 显式空操作，注释表明意图
    }

    // 5️⃣ no-more-inference：在 model_corrections 表中 correction_type='no-more-inference'
    //    + target_pattern=target_id；后续 LLM 上下文构建时通过 llmContextBuilder.getInferenceBlockRules 过滤
    if (correction_type === 'no-more-inference') {
      // target_pattern 字段在 createModelCorrection 中显式传入
      // getInferenceBlockedPatternIds 会读取 target_pattern ?? target_id
    }

    // 6️⃣ phase-changed：关闭旧 pattern 适用范围（review_state='stale'），创建版本迁移节点
    if (correction_type === 'phase-changed') {
      if (target_type === 'pattern') {
        updatePatternReviewState(target_id, 'stale');
      }
      // 归档当前 active 版本，再创建新 active 版本
      archivedVersionIds = archiveActiveModelVersions(userId);
      const versionLabel = user_text && user_text.trim().length > 0 ? user_text.slice(0, 60) : '阶段变化';
      const newVersion = createModelVersion(userId, {
        version: `v-phase-${new Date().toISOString().slice(0, 10)}`,
        snapshot: {
          type: 'phase_change',
          trigger_target_id: target_id,
          trigger_target_type: target_type,
          label: versionLabel,
          archived_version_ids: archivedVersionIds,
        },
        change_log: {
          type: 'phase_change',
          change_summary: '用户标记阶段变化',
          evidence_ids: [],
          archived_version_ids: archivedVersionIds,
        },
      });
      newModelVersionId = newVersion.id;
    }

    // 写入 model_corrections（所有 6 种 type 都记录）
    // no-more-inference 显式写入 target_pattern 字段，其余 type 不传
    const targetPattern = correction_type === 'no-more-inference' ? target_id : undefined;
    createdCorrection = createModelCorrection(userId, {
      target_id,
      target_type: target_type as CorrectionTargetType,
      correction_type: correction_type as CorrectionType,
      user_text,
      target_pattern: targetPattern,
    });

    d.exec('COMMIT');
  } catch (e: any) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    audit(userId, 'correction.error', {
      target_id, target_type, correction_type, error: String(e?.message ?? e),
    });
    res.status(500).json({ error: '纠正处理失败', detail: e?.message ?? String(e) });
    return;
  }

  // 审计日志：不保存 user_text 原文（spec A4.4），仅记录 correction_type 与 target_id
  audit(userId, 'correction.create', {
    correction_id: createdCorrection!.id,
    target_id,
    target_type,
    correction_type,
    new_evidence_id: newEvidenceId,
    new_model_version_id: newModelVersionId,
    archived_version_count: archivedVersionIds.length,
  });

  res.status(201).json(createdCorrection);
});

// ---------- PersonalModelVersion 模型版本（Task 4.4） ----------
dataRouter.get('/model-versions', (req, res) => {
  const userId = (req as any).userId;
  const { cursor, limit } = parsePagination(req.query, 50, 200);
  const d = getDb();
  let rows: any[];
  if (cursor) {
    rows = d.prepare(
      'SELECT * FROM personal_model_versions WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, cursor, limit) as any[];
  } else {
    rows = d.prepare(
      'SELECT * FROM personal_model_versions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit) as any[];
  }
  const nextCursor = rows.length === limit ? (rows[rows.length - 1] as any).created_at : null;
  const items = rows.map((row) => ({
    ...row,
    snapshot: parse(row.snapshot, {}),
    change_log: row.change_log ? parse(row.change_log, null) : null,
  }));
  res.json({ items, nextCursor });
});

dataRouter.post('/model-versions/rollback/:id', (req, res) => {
  const userId = (req as any).userId;
  const versionId = req.params.id;
  const rolledBack = rollbackModelVersion(userId, versionId);
  if (!rolledBack) {
    res.status(404).json({ error: '模型版本不存在' });
    return;
  }
  // 敏感操作：记录审计但不保存快照原文
  audit(userId, 'model_version.rollback', { versionId, version: rolledBack.version });
  res.json({ ok: true, version: rolledBack });
});

// ---------- SourcePermission 数据源权限（V4.3 §4.25 / Task 25.3 / 25.7） ----------
// 撤回权限 ≠ 删除历史数据：revoke 仅写 revoked_at；历史 evidence 保留供审计与重算。
// 删除历史数据走 DELETE /api/data/evidence-by-source/:source，由前端在撤回 Modal 中二次确认后调用。
const dataTypeSchema = z.enum([
  'calendar', 'task', 'health', 'device_usage', 'desktop_usage', 'nutrition',
  'location', 'photo', 'microphone', 'notification',
]);
const createSourcePermissionSchema = z.object({
  data_type: dataTypeSchema,
  purpose: z.string().max(200).optional(),
  scope: z.record(z.unknown()).optional(),
});

dataRouter.get('/source-permissions', (req, res) => {
  const userId = (req as any).userId;
  const list = getSourcePermissionsByUser(userId);
  res.json(list);
});

dataRouter.post('/source-permissions', (req, res) => {
  const userId = (req as any).userId;
  const parsed = createSourcePermissionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' });
    return;
  }
  const body = parsed.data;
  const key = idemKey(req, body, `spm:${body.data_type}`);
  if (dedupe(key).duplicate) {
    res.status(200).json({ ok: true, duplicate: true, idempotencyKey: key });
    return;
  }
  const perm = createSourcePermission(userId, {
    data_type: body.data_type as DataType,
    purpose: body.purpose,
    scope: body.scope,
  });
  audit(userId, 'source_permission.grant', { data_type: body.data_type, purpose: body.purpose });
  res.status(201).json(perm);
});

/**
 * 撤回数据源权限（仅写 revoked_at，不删除历史数据）。
 * SubTask 25.7：是否同时删除历史数据由前端 Modal 二次确认后调 DELETE /evidence-by-source/:source。
 */
dataRouter.post('/source-permissions/:dataType/revoke', (req, res) => {
  const userId = (req as any).userId;
  const dataType = req.params.dataType as DataType;
  // 校验 data_type 合法
  const safe = dataTypeSchema.safeParse(dataType);
  if (!safe.success) {
    res.status(400).json({ error: '不支持的数据类型' });
    return;
  }
  revokeSourcePermission(userId, dataType);
  audit(userId, 'source_permission.revoke', { data_type: dataType });
  res.json({ ok: true, data_type: dataType, revokedAt: now() });
});

/**
 * 删除指定来源的全部历史 evidence（SubTask 25.7：撤回权限时用户可选「同时删除历史数据」）。
 * 软删除（status='deleted'），触发级联重算（Task 6），不真正硬删除以保留审计追溯。
 * 返回受影响条数与级联重算结果。
 */
dataRouter.delete('/evidence-by-source/:source', (req, res) => {
  const userId = (req as any).userId;
  const sourceParam = req.params.source as EvidenceSource;
  // 安全校验：source 必须是合法的 EvidenceSource
  const validSources: EvidenceSource[] = [
    'manual_text', 'manual_voice', 'photo', 'calendar', 'task', 'health',
    'device_usage', 'desktop_usage', 'nutrition', 'project', 'system',
  ];
  if (!validSources.includes(sourceParam)) {
    res.status(400).json({ error: '不支持的证据来源' });
    return;
  }
  // 查询该用户该来源的全部 active evidence
  const rows = getDb()
    .prepare(
      `SELECT id FROM evidence_records
       WHERE user_id = ? AND source = ? AND status = 'active'`
    )
    .all(userId, sourceParam) as { id: string }[];
  const recomputeResults: RecomputeResult[] = [];
  for (const row of rows) {
    deleteEvidence(userId, row.id);
    const result = recomputeDependents(row.id);
    recomputeResults.push(result);
  }
  audit(userId, 'evidence.delete_by_source', {
    source: sourceParam,
    deletedCount: rows.length,
    cascadedRecompute: recomputeResults.length,
  });
  res.json({
    ok: true,
    source: sourceParam,
    deletedCount: rows.length,
    cascadedRecompute: recomputeResults.length,
    deletedAt: now(),
  });
});

// ---------- 导出 ----------
dataRouter.get('/export', (req, res) => {
  const userId = (req as any).userId;
  const tables = [
    'events', 'commitments', 'hypotheses', 'experiments', 'projects', 'skills', 'meanings', 'audit_logs',
    'evidence_records', 'pattern_candidates', 'experience_units', 'personal_skills', 'meta_principles',
    'personal_model_versions', 'model_corrections', 'source_permissions', 'service_contracts',
    'life_objects', 'action_receipts', 'twin_profiles',
  ];
  const out: Record<string, unknown> = {};
  for (const t of tables) {
    out[t] = getDb().prepare(`SELECT * FROM ${t} WHERE user_id = ?`).all(userId);
  }
  audit(userId, 'data.export', { tables });
  res.json({ exportedAt: now(), data: out });
});

export default dataRouter;
