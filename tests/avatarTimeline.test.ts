import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAvatarProfile } from '../src/mirror3d/avatar/v2/avatarTypes';
import { resolveAvatarRenderMode, syncModelVersionsToAvatarTimeline } from '../src/mirror3d/avatar/avatarTimeline';
import type { PersonalModelVersion } from '../src/types/models';

test('V 轴严格映射到四档渲染模式，缺省保持完整动态 3D', () => {
  assert.equal(resolveAvatarRenderMode('V0'), 'text');
  assert.equal(resolveAvatarRenderMode('V1'), 'icon');
  assert.equal(resolveAvatarRenderMode('V2'), 'static3d');
  assert.equal(resolveAvatarRenderMode('V3'), 'dynamic3d');
  assert.equal(resolveAvatarRenderMode(null), 'dynamic3d');
});

test('模型版本按时间追加为 Avatar 阶段快照且重复同步幂等', () => {
  const profile = createDefaultAvatarProfile('2026-07-01T00:00:00.000Z');
  const versions: PersonalModelVersion[] = [
    {
      id: 'model-new', user_id: 'u1', version: 'v0.1', snapshot: {},
      change_log: { change_summary: '月度回看确认了新的阶段' }, status: 'active', created_at: '2026-07-30T00:00:00.000Z',
    },
    {
      id: 'model-old', user_id: 'u1', version: 'v0.05', snapshot: {},
      change_log: null, status: 'archived', created_at: '2026-07-07T00:00:00.000Z',
    },
  ];

  const synced = syncModelVersionsToAvatarTimeline(profile, versions, '2026-08-12T00:00:00.000Z');
  const stages = synced.timeline.filter((entry) => entry.sourceModelVersionId);
  assert.deepEqual(stages.map((entry) => entry.sourceModelVersionId), ['model-old', 'model-new']);
  assert.equal(stages[0].snapshotProvenance, 'captured_on_first_sync');
  assert.match(stages[0].note ?? '', /不反推或重写过去/);

  const resynced = syncModelVersionsToAvatarTimeline(synced, versions, '2026-08-13T00:00:00.000Z');
  assert.equal(resynced, synced);
});
