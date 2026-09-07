import { Router } from 'express';
import { z } from 'zod';
import {
  audit,
  cancelLifeObject,
  getActionReceipt,
  getActionReceipts,
  getLifeObject,
  getLifeObjects,
  getTwinProfile,
  getContinuityHandoffs,
  createContinuityHandoff,
  consumeContinuityHandoff,
  cancelContinuityHandoff,
  markActionReceiptUndone,
  saveActionReceipt,
  upsertLifeObject,
  upsertTwinProfile,
} from '../db.js';

export const runtimeRouter = Router();

const isoDate = z.string().datetime({ offset: true });
const relationSchema = z.object({
  type: z.enum(['depends_on', 'part_of', 'conflicts_with', 'supports']),
  targetId: z.string().min(1),
});

export const lifeObjectSchema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(['note', 'task', 'event', 'course', 'draft', 'project', 'habit']),
  title: z.string().trim().min(1).max(500),
  detail: z.string().max(10_000).optional(),
  status: z.enum(['draft', 'active', 'done', 'cancelled']),
  startsAt: isoDate.optional(),
  endsAt: isoDate.optional(),
  domain: z.string().max(100).optional(),
  version: z.number().int().positive(),
  sourceRefs: z.array(z.string().min(1)).min(1).max(100),
  relations: z.array(relationSchema).max(200),
  createdAt: isoDate,
  updatedAt: isoDate,
}).superRefine((value, ctx) => {
  if (value.startsAt && value.endsAt && Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endsAt 必须晚于 startsAt', path: ['endsAt'] });
  }
});

const actionStepResultSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(['success', 'failed']),
  externalId: z.string().optional(),
  message: z.string().max(2000),
  undoToken: z.string().optional(),
});

export const actionReceiptSchema = z.object({
  id: z.string().min(1).max(200),
  planId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(240),
  status: z.enum(['success', 'partial_failure', 'failed', 'blocked', 'undone']),
  stepResults: z.array(actionStepResultSchema).max(100),
  affectedObjectIds: z.array(z.string()).max(100),
  executedAt: isoDate,
  undoable: z.boolean(),
  undoneAt: isoDate.optional(),
  blockReason: z.string().max(1000).optional(),
});

export const twinProfileSchema = z.object({
  id: z.string().min(1).max(160),
  version: z.number().int().positive(),
  identity: z.record(z.string(), z.unknown()),
  currentState: z.record(z.string(), z.unknown()),
  traits: z.array(z.record(z.string(), z.unknown())).max(500),
  boundaries: z.array(z.string().max(1000)).max(500),
  evidence: z.array(z.record(z.string(), z.unknown())).max(5000),
  archivedTraits: z.array(z.record(z.string(), z.unknown())).max(2000),
  updatedAt: isoDate,
});

export const continuityHandoffSchema = z.object({
  id: z.string().min(1).max(200),
  sourceSurface: z.enum(['desktop', 'mobile']),
  targetSurface: z.enum(['desktop', 'mobile']),
  title: z.string().trim().min(1).max(500),
  payload: z.object({
    kind: z.enum(['workspace_text', 'life_object']),
    text: z.string().trim().min(1).max(10_000).optional(),
    route: z.enum(['Workspace', 'Progress', 'Mirror', 'Secretary']).optional(),
    objectIds: z.array(z.string().min(1).max(200)).max(100).optional(),
  }),
  createdAt: isoDate,
  expiresAt: isoDate,
}).superRefine((value, ctx) => {
  if (value.sourceSurface === value.targetSurface) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '来源端与目标端必须不同', path: ['targetSurface'] });
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expiresAt 必须晚于 createdAt', path: ['expiresAt'] });
  }
  if (value.payload.kind === 'workspace_text' && !value.payload.text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'workspace_text 必须包含 text', path: ['payload', 'text'] });
  }
});

function userId(req: unknown): string {
  return (req as { userId: string }).userId;
}

function limit(raw: unknown, fallback = 100): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.min(200, Math.trunc(value))) : fallback;
}

runtimeRouter.get('/life-objects', (req, res) => {
  res.json({ items: getLifeObjects(userId(req), limit(req.query.limit)), nextCursor: null });
});

runtimeRouter.get('/life-objects/:id', (req, res) => {
  const object = getLifeObject(userId(req), req.params.id);
  if (!object) { res.status(404).json({ error: '生命对象不存在' }); return; }
  res.json(object.doc);
});

runtimeRouter.post('/life-objects', (req, res) => {
  const parsed = lifeObjectSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' }); return; }
  const object = parsed.data;
  const stored = upsertLifeObject(userId(req), {
    id: object.id, kind: object.kind, title: object.title, status: object.status,
    startsAt: object.startsAt, endsAt: object.endsAt, version: object.version,
    createdAt: object.createdAt, updatedAt: object.updatedAt, doc: object,
  });
  if (!stored) { res.status(409).json({ error: '对象 ID 已由其他账号占用或版本冲突' }); return; }
  audit(userId(req), 'life_object.upsert', { id: object.id, kind: object.kind, version: object.version });
  res.status(201).json(stored.doc);
});

runtimeRouter.post('/life-objects/:id/cancel', (req, res) => {
  const parsed = z.object({ expectedVersion: z.number().int().positive() }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: 'expectedVersion 必须为正整数' }); return; }
  const at = new Date().toISOString();
  const object = cancelLifeObject(userId(req), req.params.id, parsed.data.expectedVersion, at);
  if (!object) { res.status(409).json({ error: '对象不存在或版本已变化，请刷新后重试' }); return; }
  audit(userId(req), 'life_object.cancel', { id: req.params.id, version: object.version });
  res.json(object.doc);
});

runtimeRouter.get('/action-receipts', (req, res) => {
  res.json({ items: getActionReceipts(userId(req), limit(req.query.limit)), nextCursor: null });
});

runtimeRouter.get('/action-receipts/:id', (req, res) => {
  const receipt = getActionReceipt(userId(req), req.params.id);
  if (!receipt) { res.status(404).json({ error: '行动回执不存在' }); return; }
  res.json(receipt.doc);
});

runtimeRouter.post('/action-receipts', (req, res) => {
  const parsed = actionReceiptSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' }); return; }
  const receipt = parsed.data;
  const stored = saveActionReceipt(userId(req), {
    id: receipt.id, planId: receipt.planId, idempotencyKey: receipt.idempotencyKey,
    status: receipt.status, executedAt: receipt.executedAt, undoneAt: receipt.undoneAt, doc: receipt,
  });
  audit(userId(req), 'action_receipt.create', {
    id: stored.id, planId: stored.plan_id, status: stored.status,
    succeeded: receipt.stepResults.filter((step) => step.status === 'success').length,
    failed: receipt.stepResults.filter((step) => step.status === 'failed').length,
  });
  res.status(201).json(stored.doc);
});

runtimeRouter.post('/action-receipts/:id/undo', (req, res) => {
  const stored = markActionReceiptUndone(userId(req), req.params.id, new Date().toISOString());
  if (!stored) { res.status(409).json({ error: '回执不存在或当前状态不可标记为已撤销' }); return; }
  audit(userId(req), 'action_receipt.undo', { id: stored.id });
  res.json(stored.doc);
});

runtimeRouter.get('/continuity-handoffs', (req, res) => {
  const target = z.enum(['desktop', 'mobile']).safeParse(req.query.target);
  if (!target.success) { res.status(400).json({ error: 'target 必须为 desktop 或 mobile' }); return; }
  res.json({ items: getContinuityHandoffs(userId(req), target.data, limit(req.query.limit, 20)), nextCursor: null });
});

runtimeRouter.post('/continuity-handoffs', (req, res) => {
  const parsed = continuityHandoffSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数错误' }); return; }
  const handoff = parsed.data;
  const maxTtlMs = 7 * 24 * 60 * 60 * 1000;
  if (Date.parse(handoff.expiresAt) - Date.parse(handoff.createdAt) > maxTtlMs) {
    res.status(400).json({ error: '接力最长保留 7 天' });
    return;
  }
  const stored = createContinuityHandoff(userId(req), {
    id: handoff.id,
    sourceSurface: handoff.sourceSurface,
    targetSurface: handoff.targetSurface,
    title: handoff.title,
    payload: handoff.payload,
    createdAt: handoff.createdAt,
    expiresAt: handoff.expiresAt,
  });
  if (!stored) { res.status(409).json({ error: '接力记录创建失败' }); return; }
  audit(userId(req), 'continuity_handoff.create', {
    id: stored.id,
    sourceSurface: stored.source_surface,
    targetSurface: stored.target_surface,
    kind: stored.payload.kind,
  });
  res.status(201).json(stored);
});

runtimeRouter.post('/continuity-handoffs/:id/consume', (req, res) => {
  const at = new Date().toISOString();
  const stored = consumeContinuityHandoff(userId(req), req.params.id, at);
  if (!stored) { res.status(409).json({ error: '接力不存在、已处理或已过期' }); return; }
  audit(userId(req), 'continuity_handoff.consume', { id: stored.id, targetSurface: stored.target_surface });
  res.json(stored);
});

runtimeRouter.post('/continuity-handoffs/:id/cancel', (req, res) => {
  const at = new Date().toISOString();
  const stored = cancelContinuityHandoff(userId(req), req.params.id, at);
  if (!stored) { res.status(409).json({ error: '接力不存在或当前状态不可取消' }); return; }
  audit(userId(req), 'continuity_handoff.cancel', { id: stored.id });
  res.json(stored);
});

runtimeRouter.get('/twin-profile', (req, res) => {
  const profile = getTwinProfile(userId(req));
  if (!profile) { res.status(404).json({ error: '孪生档案尚未创建' }); return; }
  res.json(profile.doc);
});

runtimeRouter.put('/twin-profile', (req, res) => {
  const body = z.object({ profile: twinProfileSchema, expectedVersion: z.number().int().positive().optional() }).safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message ?? '参数错误' }); return; }
  const result = upsertTwinProfile(userId(req), {
    version: body.data.profile.version,
    doc: body.data.profile,
    updatedAt: body.data.profile.updatedAt,
    expectedVersion: body.data.expectedVersion,
  });
  if (result.conflict) { res.status(409).json({ error: '孪生档案版本冲突', current: result.profile?.doc }); return; }
  audit(userId(req), 'twin_profile.update', {
    version: body.data.profile.version,
    traitCount: body.data.profile.traits.length,
    evidenceCount: body.data.profile.evidence.length,
  });
  res.json(result.profile?.doc);
});

export default runtimeRouter;

