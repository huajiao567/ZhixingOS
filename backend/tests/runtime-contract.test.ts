import assert from 'node:assert/strict';
import test from 'node:test';
import { actionReceiptSchema, continuityHandoffSchema, deviceRegistrationSchema, lifeObjectSchema, twinProfileSchema } from '../src/routes/runtime';

const now = '2026-08-22T01:00:00.000Z';

test('life object contract rejects reversed time and untraceable objects', () => {
  const base = {
    id: 'life-1', kind: 'event', title: '项目会', status: 'draft', version: 1,
    sourceRefs: ['env-1'], relations: [], createdAt: now, updatedAt: now,
  };
  assert.equal(lifeObjectSchema.safeParse(base).success, true);
  assert.equal(lifeObjectSchema.safeParse({ ...base, sourceRefs: [] }).success, false);
  assert.equal(lifeObjectSchema.safeParse({ ...base, startsAt: '2026-08-23T02:00:00.000Z', endsAt: '2026-08-23T01:00:00.000Z' }).success, false);
});

test('receipt contract preserves partial failure and undo evidence', () => {
  const parsed = actionReceiptSchema.parse({
    id: 'receipt-1', planId: 'plan-1', idempotencyKey: 'idem-1', status: 'partial_failure',
    stepResults: [
      { stepId: 'one', status: 'success', message: 'created', externalId: 'calendar-1', undoToken: 'undo-1' },
      { stepId: 'two', status: 'failed', message: 'offline' },
    ],
    affectedObjectIds: ['life-1'], executedAt: now, undoable: true,
  });
  assert.equal(parsed.status, 'partial_failure');
  assert.equal(parsed.stepResults[0].externalId, 'calendar-1');
});

test('twin profile contract requires a positive version and bounded collections', () => {
  const base = {
    id: 'twin-1', version: 1, identity: {}, currentState: {}, traits: [], boundaries: [], evidence: [], archivedTraits: [], updatedAt: now,
  };
  assert.equal(twinProfileSchema.safeParse(base).success, true);
  assert.equal(twinProfileSchema.safeParse({ ...base, version: 0 }).success, false);
});

test('continuity handoff contract is cross-surface, bounded and traceable', () => {
  const base = {
    id: 'handoff-1',
    sourceSurface: 'desktop',
    targetSurface: 'mobile',
    title: '继续整理实验记录',
    payload: { kind: 'workspace_text', text: '继续整理实验记录', route: 'Workspace' },
    createdAt: now,
    expiresAt: '2026-08-23T01:00:00.000Z',
  };
  assert.equal(continuityHandoffSchema.safeParse(base).success, true);
  assert.equal(continuityHandoffSchema.safeParse({ ...base, targetSurface: 'desktop' }).success, false);
  assert.equal(continuityHandoffSchema.safeParse({ ...base, payload: { kind: 'workspace_text' } }).success, false);
  assert.equal(continuityHandoffSchema.safeParse({ ...base, expiresAt: '2026-08-22T00:00:00.000Z' }).success, false);
});

test('device registration contract stores capabilities without hardware identifiers', () => {
  const base = {
    id: 'device-test-0001',
    label: 'Chrome 桌面',
    surface: 'desktop',
    platform: 'web',
    appVersion: '1.0.0',
    capabilities: ['keyboard', 'web'],
  };
  assert.equal(deviceRegistrationSchema.safeParse(base).success, true);
  assert.equal(deviceRegistrationSchema.safeParse({ ...base, id: 'short' }).success, false);
  assert.equal(deviceRegistrationSchema.safeParse({ ...base, platform: 'windows-x64-serial' }).success, false);
  assert.equal(deviceRegistrationSchema.safeParse({ ...base, capabilities: Array.from({ length: 33 }, (_, i) => `c${i}`) }).success, false);
});
