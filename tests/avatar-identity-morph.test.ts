import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAvatarProfile } from '../src/mirror3d/avatar/v2/avatarTypes';
import {
  deriveModelIdentityMorphWeights,
  resolveModelIdentityMorphSpec,
  toPositiveOnlyIdentityMorphWeight,
} from '../src/mirror3d/avatar/v2/identityMorphBridge';

test('identity morph bridge accepts only semantically equivalent structural targets', () => {
  assert.equal(resolveModelIdentityMorphSpec('eye_size')?.field, 'eyeSize');
  assert.equal(resolveModelIdentityMorphSpec('mouth_width')?.field, 'mouthWidth');

  // The research candidate exposes these real structural channels, but their
  // semantics do not equal the current product fields jawRoundness/noseSize.
  assert.equal(resolveModelIdentityMorphSpec('face_jaw_width'), null);
  assert.equal(resolveModelIdentityMorphSpec('nose_width'), null);

  // Expression and lip-sync names must never be reclassified as identity.
  for (const target of ['blink', 'happy', 'aa', 'oh', 'Mouth_A']) {
    assert.equal(resolveModelIdentityMorphSpec(target), null, target);
  }
});

test('increment-only identity morph never invents unsupported negative deformation', () => {
  assert.equal(toPositiveOnlyIdentityMorphWeight(0), 0);
  assert.equal(toPositiveOnlyIdentityMorphWeight(0.49), 0);
  assert.equal(toPositiveOnlyIdentityMorphWeight(0.5), 0);
  assert.equal(toPositiveOnlyIdentityMorphWeight(0.75), 0.5);
  assert.equal(toPositiveOnlyIdentityMorphWeight(1), 1);
  assert.equal(toPositiveOnlyIdentityMorphWeight(9), 1);
  assert.equal(toPositiveOnlyIdentityMorphWeight(Number.NaN), 0);
});

test('profile identity values derive independent real morph weights', () => {
  const base = createDefaultAvatarProfile('2026-09-13T00:00:00.000Z');
  const profile = {
    ...base,
    identity: {
      ...base.identity,
      faceMorphs: {
        ...base.identity.faceMorphs,
        eyeSize: 0.8,
        mouthWidth: 0.65,
        jawRoundness: 1,
        noseSize: 1,
      },
    },
  };

  assert.deepEqual(deriveModelIdentityMorphWeights(profile), {
    eyeSize: 0.6000000000000001,
    mouthWidth: 0.30000000000000004,
  });
});
