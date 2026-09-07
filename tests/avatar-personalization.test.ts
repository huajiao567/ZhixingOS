import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAvatarProfile } from '../src/mirror3d/avatar/v2/avatarTypes';
import {
  deriveAvatarIdentityGeometry,
  nextIdentityVersion,
  personalizationDraftToProfile,
  safeAppearanceColor,
} from '../src/mirror3d/avatar/v2/avatarPersonalization';

test('personalization draft updates only explicit identity and appearance fields', () => {
  const base = createDefaultAvatarProfile('2026-09-07T00:00:00.000Z');
  const next = personalizationDraftToProfile(base, {
    faceWidth: 0.8,
    faceHeight: 0.2,
    jawRoundness: 0.7,
    eyeSize: 0.6,
    eyeSpacing: 0.4,
    browAngle: 0.5,
    noseSize: 0.3,
    mouthWidth: 0.65,
    bodyScale: 0.55,
    shoulderWidth: 0.75,
    skinTone: '#E6B18A',
    hairColor: '#251C1A',
    outfitColor: '#5267D9',
  });
  assert.equal(next.identity.faceMorphs.faceWidth, 0.8);
  assert.equal(next.identity.bodyMorphs.shoulderWidth, 0.75);
  assert.equal(next.identity.skinMaterial.baseColor, '#E6B18A');
  assert.equal(next.appearance.hairColor, '#251C1A');
  assert.equal(next.appearance.outfitColor, '#5267D9');
  assert.equal(next.dailyState, base.dailyState);
});

test('production geometry stays within conservative deformation bounds', () => {
  const base = createDefaultAvatarProfile('2026-09-07T00:00:00.000Z');
  const low = {
    ...base,
    identity: { ...base.identity, faceMorphs: { faceWidth: 0, faceHeight: 0 }, bodyMorphs: { bodyScale: 0, shoulderWidth: 0 } },
  };
  const high = {
    ...base,
    identity: { ...base.identity, faceMorphs: { faceWidth: 1, faceHeight: 1 }, bodyMorphs: { bodyScale: 1, shoulderWidth: 1 } },
  };
  assert.deepEqual(deriveAvatarIdentityGeometry(low), { headScaleX: 0.94, headScaleY: 0.95, bodyScaleX: 0.97, bodyScaleY: 0.98 });
  assert.deepEqual(deriveAvatarIdentityGeometry(high), { headScaleX: 1.06, headScaleY: 1.05, bodyScaleX: 1.03, bodyScaleY: 1.02 });
});

test('identity version increments only the patch component', () => {
  assert.equal(nextIdentityVersion('1.0.0'), '1.0.1');
  assert.equal(nextIdentityVersion('2.4.9'), '2.4.10');
  assert.equal(nextIdentityVersion('legacy'), '1.0.1');
});

test('appearance color accepts only six-digit hex', () => {
  assert.equal(safeAppearanceColor('#aabbcc', '#000000'), '#AABBCC');
  assert.equal(safeAppearanceColor('red', '#123456'), '#123456');
});
