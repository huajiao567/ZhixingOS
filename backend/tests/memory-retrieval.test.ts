import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryTokens, recallPersonalMemory, type MemoryContextData } from '../src/services/memoryRetrieval';

const now = '2026-08-23T12:00:00.000Z';

function emptyData(): MemoryContextData {
  return {
    events: [], commitments: [], hypotheses: [], experiments: [], patterns: [],
    experiences: [], personalSkills: [], metaPrinciples: [], twinProfile: null,
  };
}

test('Chinese lexical recall is relevant, private, source-traceable and budgeted', () => {
  const data = emptyData();
  data.events = [
    {
      id: 'event-study', content: '周三复习高等数学，重点是微积分错题', source: 'user',
      layer: 'fact', tags: ['学习'], created_at: '2026-08-22T12:00:00.000Z',
    },
    {
      id: 'event-food', content: '晚餐买了新鲜蔬菜', source: 'user',
      layer: 'fact', tags: ['生活'], created_at: '2026-08-23T11:30:00.000Z',
    },
  ];
  data.personalSkills = [{
    id: 'skill-math', user_id: 'user-a', trigger: '复习数学',
    preconditions: ['有错题记录'], procedure: ['先分类', '再重做'], anti_patterns: [],
    scope: '学习', evidence_refs: ['event-study'], last_validated_at: now,
    expiry_review: null, version: 3, created_at: now,
  }];

  const result = recallPersonalMemory(data, {
    ownerUserId: 'user-a', agentId: 'secretary', query: '怎么安排数学复习',
    maxItems: 2, maxTotalChars: 200, maxCharsPerAsset: 120, now,
  });

  assert.equal(result.assets.length, 2);
  assert.equal(result.assets[0].id, 'skill-math');
  assert.ok(result.assets.some((asset) => asset.id === 'event-study'));
  assert.ok(result.assets.every((asset) => asset.ownerUserId === 'user-a'));
  assert.ok(result.assets.every((asset) => asset.visibility === 'private'));
  assert.ok(result.assets.every((asset) => asset.agentBindings.includes('secretary')));
  assert.equal(result.assets[0].version, 3);
  assert.ok(result.receipt.totalChars <= 200);
  assert.equal(result.receipt.strategy, 'local-lexical-recency-v1');
});

test('only governed L2/L3 assets are recalled and user boundaries stay pinned', () => {
  const data = emptyData();
  data.experiences = [
    {
      id: 'exp-candidate', user_id: 'user-a', context: '工作', problem: '拖延', actions: [],
      outcome: null, lesson: '尚未验证的建议', support_ids: ['e1'], counter_ids: [],
      applicability: null, maturity: 'candidate', last_validated_at: null, version: 1, created_at: now,
    },
    {
      id: 'exp-valid', user_id: 'user-a', context: '工作', problem: '拖延', actions: [],
      outcome: '完成', lesson: '先做十分钟能降低启动阻力', support_ids: ['e1', 'e2', 'e3'], counter_ids: [],
      applicability: '低风险任务', maturity: 'validated', last_validated_at: now, version: 4, created_at: now,
    },
  ];
  data.metaPrinciples = [
    {
      id: 'meta-watch', user_id: 'user-a', statement: '先做可逆的小步', domains: ['工作', '学习'],
      evidence: ['e1', 'e2'], counterevidence: [], status: 'watch', last_validated: now, created_at: now,
    },
    {
      id: 'meta-candidate', user_id: 'user-a', statement: '未审查原则', domains: ['工作'],
      evidence: ['e1'], counterevidence: [], status: 'candidate', last_validated: null, created_at: now,
    },
  ];
  data.twinProfile = {
    user_id: 'user-a', version: 7, updated_at: now,
    doc: {
      identity: { selfDescription: '我重视自主和长期主义' },
      boundaries: ['不要把一次熬夜推断成长期人格'],
      traits: [
        { feature: '节奏', value: '稳健', status: 'confirmed', confidence: 'consistent', supportIds: ['e1'] },
        { feature: '社交', value: '内向', status: 'candidate', confidence: 'preliminary', supportIds: ['e2'] },
      ],
    },
  };

  const result = recallPersonalMemory(data, {
    ownerUserId: 'user-a', agentId: 'secretary', query: '工作拖延怎么办', now,
  });
  const ids = new Set(result.assets.map((asset) => asset.id));
  assert.ok(ids.has('exp-valid'));
  assert.ok(ids.has('meta-watch'));
  assert.ok(ids.has('twin:user-a:identity'));
  assert.ok(ids.has('twin:user-a:trait:节奏'));
  assert.ok([...ids].some((id) => id.startsWith('twin:user-a:boundary:')));
  assert.ok(!ids.has('exp-candidate'));
  assert.ok(!ids.has('meta-candidate'));
  assert.ok(!ids.has('twin:user-a:trait:社交'));
  assert.equal(result.assets.find((asset) => asset.kind === 'twin_boundary')?.score, 10);
  assert.equal(result.selectedData.twinProfile, null, 'full twin document must not bypass recall budgets');
});

test('memory tokenization keeps Chinese phrases searchable without a segmenter dependency', () => {
  const tokens = memoryTokens('安排高等数学复习 and Project Alpha');
  assert.ok(tokens.includes('高等'));
  assert.ok(tokens.includes('数学'));
  assert.ok(tokens.includes('project'));
  assert.ok(tokens.includes('alpha'));
});
