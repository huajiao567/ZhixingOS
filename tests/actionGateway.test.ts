import assert from 'node:assert/strict';
import test from 'node:test';
import { createActionGateway } from '../src/ai-native/actions/actionGateway';
import type { ActionExecutor, ActionPlan } from '../src/ai-native/types';

function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    id: 'plan-1', idempotencyKey: 'idem-1', sourceRequest: '明天三点开会', intentId: 'intent-1',
    objectId: 'event-1', title: '创建日历事件', summary: '写入系统日历', risk: 'low', reversible: true,
    requiresConfirmation: true,
    steps: [{ id: 'step-1', executor: 'calendar', operation: 'create', input: { title: '开会' }, reversible: true }],
    ...overrides,
  };
}

test('A0 blocks execution and returns an honest receipt', async () => {
  let calls = 0;
  const executor: ActionExecutor = { execute: async () => { calls += 1; return { message: 'ok' }; } };
  const gateway = createActionGateway({ agencyLevel: 'A0', executors: { calendar: executor } });
  const receipt = await gateway.execute(plan(), { confirmed: true });
  assert.equal(receipt.status, 'blocked');
  assert.equal(calls, 0);
  assert.match(receipt.blockReason ?? '', /权限|建议/);
});

test('confirmation is mandatory before a high-impact or confirmable plan', async () => {
  const gateway = createActionGateway({
    agencyLevel: 'A2',
    executors: { calendar: { execute: async () => ({ message: 'created' }) } },
  });
  const receipt = await gateway.execute(plan({ risk: 'high' }), { confirmed: false });
  assert.equal(receipt.status, 'blocked');
  assert.match(receipt.blockReason ?? '', /确认/);
});

test('partial failure is never represented as success', async () => {
  const gateway = createActionGateway({
    agencyLevel: 'A2',
    executors: {
      calendar: { execute: async () => ({ message: 'created', externalId: 'sys-42', undoToken: 'undo-42' }) },
      task: { execute: async () => { throw new Error('task service offline'); } },
    },
  });
  const receipt = await gateway.execute(plan({
    steps: [
      { id: 'calendar', executor: 'calendar', operation: 'create', input: {}, reversible: true },
      { id: 'task', executor: 'task', operation: 'create', input: {}, reversible: true },
    ],
  }), { confirmed: true });
  assert.equal(receipt.status, 'partial_failure');
  assert.deepEqual(receipt.stepResults.map((item) => item.status), ['success', 'failed']);
});

test('idempotency returns the same receipt and undo calls the real executor', async () => {
  let executeCalls = 0;
  let undoCalls = 0;
  const executor: ActionExecutor = {
    execute: async () => { executeCalls += 1; return { message: 'created', externalId: 'sys-1', undoToken: 'undo-1', objectId: 'event-1' }; },
    undo: async (token) => { assert.equal(token, 'undo-1'); undoCalls += 1; },
  };
  const gateway = createActionGateway({ agencyLevel: 'A2', executors: { calendar: executor } });
  const first = await gateway.execute(plan(), { confirmed: true });
  const duplicate = await gateway.execute(plan(), { confirmed: true });
  assert.equal(duplicate.id, first.id);
  assert.equal(executeCalls, 1);

  const undone = await gateway.undo(first.id);
  assert.equal(undone.status, 'undone');
  assert.equal(undoCalls, 1);
});

