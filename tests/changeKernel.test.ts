import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateChangePaths } from '../src/ai-native/reasoning/changeKernel';
import { compileContextSurface } from '../src/ai-native/surfaces/surfaceCompiler';
import type { ChangeContext, LifeObject } from '../src/ai-native/types';

const object: LifeObject = {
  id: 'task-1', kind: 'task', title: '准备开源发布', status: 'draft', version: 1,
  sourceRefs: ['env-1'], relations: [], createdAt: '2026-08-22T01:00:00.000Z', updatedAt: '2026-08-22T01:00:00.000Z',
};

function context(evidenceCount = 2): ChangeContext {
  return {
    now: '2026-08-22T01:00:00.000Z', object,
    evidence: Array.from({ length: evidenceCount }, (_, index) => ({
      id: `e-${index}`, kind: index === 0 ? 'constraint' : 'fact',
      quality: index > 1 ? 'consistent' : 'preliminary',
      occurredAt: `2026-08-${20 + index}T01:00:00.000Z`, summary: index === 0 ? '每晚只有一小时' : '已经完成核心代码',
    })),
    constraints: ['每晚只有一小时'], commitments: ['不牺牲数据主权'], stakeholders: ['维护者', '使用者'],
    recentMomentum: 'growing', agencyLevel: 'A2',
  };
}

test('change kernel always assesses 时位势应变中 and proposes reversible paths', () => {
  const result = evaluateChangePaths(context(3));
  assert.ok(result.length >= 2);
  assert.deepEqual(result[0].assessments.map((item) => item.operator), ['时', '位', '势', '应', '变', '中']);
  assert.equal(result[0].reversible, true);
  assert.ok(result[0].stopCondition.length > 4);
  assert.ok(Date.parse(result[0].reviewAt) > Date.parse(context().now));
  assert.doesNotMatch(JSON.stringify(result), /吉|凶|命定|占卜/);
});

test('insufficient evidence lowers autonomy and becomes a visible question', () => {
  const result = evaluateChangePaths(context(0));
  assert.equal(result[0].requiresConfirmation, true);
  assert.ok(result[0].evidenceGaps.length > 0);
  const surface = compileContextSurface({ object, paths: result, questions: [] });
  assert.equal(surface.state, 'needs_input');
  assert.ok(surface.questions.length > 0);
});

test('surface compiler exposes one primary path and keeps alternatives', () => {
  const paths = evaluateChangePaths(context(3));
  const surface = compileContextSurface({ object, paths, questions: [] });
  assert.equal(surface.state, 'ready');
  assert.equal(surface.primaryPath?.id, paths[0].id);
  assert.equal(surface.alternativePaths.length, paths.length - 1);
});

