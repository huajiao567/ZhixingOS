import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTwinCorrection, applyTwinEvidence, createTwinProfile, rollbackTwinProfile } from '../src/ai-native/twin/twinProfile';
import type { TwinEvidence } from '../src/ai-native/types';

const now = '2026-08-22T01:00:00.000Z';

function evidence(id: string, scope: string, polarity: TwinEvidence['polarity'] = 'support'): TwinEvidence {
  return { id, feature: 'prefers_morning_focus', value: true, scope, polarity, occurredAt: now, sourceRef: `event:${id}` };
}

test('a single observation updates temporary state but does not become personality', () => {
  const profile = applyTwinEvidence(createTwinProfile('twin-1', now), evidence('e1', 'work'), now);
  assert.equal(profile.traits.length, 0);
  assert.equal(profile.currentState.prefers_morning_focus.evidenceId, 'e1');
});

test('repeated cross-context evidence creates only a reviewable candidate trait', () => {
  let profile = createTwinProfile('twin-1', now);
  profile = applyTwinEvidence(profile, evidence('e1', 'work'), now);
  profile = applyTwinEvidence(profile, evidence('e2', 'study'), now);
  profile = applyTwinEvidence(profile, evidence('e3', 'work'), now);
  assert.equal(profile.traits.length, 1);
  assert.equal(profile.traits[0].status, 'candidate');
  assert.equal(profile.traits[0].confidence, 'consistent');
  assert.deepEqual(profile.traits[0].scope, ['study', 'work']);
});

test('counterevidence is retained and a user correction archives the inferred trait', () => {
  let profile = createTwinProfile('twin-1', now);
  for (const item of [evidence('e1', 'work'), evidence('e2', 'study'), evidence('e3', 'home'), evidence('e4', 'work', 'counter')]) {
    profile = applyTwinEvidence(profile, item, now);
  }
  assert.deepEqual(profile.traits[0].counterIds, ['e4']);
  const corrected = applyTwinCorrection(profile, 'prefers_morning_focus', '这只适用于赶项目时', now);
  assert.equal(corrected.traits.length, 0);
  assert.equal(corrected.archivedTraits.at(-1)?.status, 'stale');
  assert.ok(corrected.boundaries.some((item) => item.includes('赶项目')));
});

test('profile versions can be rolled back without inventing evidence', () => {
  const base = createTwinProfile('twin-1', now);
  const changed = applyTwinEvidence(base, evidence('e1', 'work'), now);
  const rolledBack = rollbackTwinProfile(changed, base, '2026-08-23T01:00:00.000Z');
  assert.equal(rolledBack.version, changed.version + 1);
  assert.deepEqual(rolledBack.evidence, base.evidence);
  assert.deepEqual(rolledBack.traits, base.traits);
});

