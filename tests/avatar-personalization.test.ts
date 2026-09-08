import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultAvatarProfile } from '../src/mirror3d/avatar/v2/avatarTypes';
import {
  AVATAR_PERSONALIZATION_CAPABILITIES,
  deriveAvatarIdentityGeometry,
  deriveCompensatedHeadLocalScale,
  nextIdentityVersion,
  normalizeAvatarPersonalizationProvenance,
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

test('production geometry keeps face, body frame and shoulder channels separate', () => {
  const base = createDefaultAvatarProfile('2026-09-07T00:00:00.000Z');
  const low = {
    ...base,
    identity: { ...base.identity, faceMorphs: { faceWidth: 0, faceHeight: 0 }, bodyMorphs: { bodyScale: 0, shoulderWidth: 0 } },
  };
  const high = {
    ...base,
    identity: { ...base.identity, faceMorphs: { faceWidth: 1, faceHeight: 1 }, bodyMorphs: { bodyScale: 1, shoulderWidth: 1 } },
  };
  assert.deepEqual(deriveAvatarIdentityGeometry(low), {
    headScaleX: 0.94,
    headScaleY: 0.95,
    bodyScaleXZ: 0.96,
    bodyScaleY: 0.99,
    shoulderSpread: 0.94,
  });
  assert.deepEqual(deriveAvatarIdentityGeometry(high), {
    headScaleX: 1.06,
    headScaleY: 1.05,
    bodyScaleXZ: 1.04,
    bodyScaleY: 1.01,
    shoulderSpread: 1.06,
  });
});

test('head compensation prevents body scale from changing confirmed face world scale', () => {
  const base = createDefaultAvatarProfile('2026-09-07T00:00:00.000Z');
  const profile = {
    ...base,
    identity: {
      ...base.identity,
      faceMorphs: { faceWidth: 0.9, faceHeight: 0.2 },
      bodyMorphs: { bodyScale: 1, shoulderWidth: 1 },
    },
  };
  const geometry = deriveAvatarIdentityGeometry(profile);
  const bodyWorldScale = { x: geometry.bodyScaleXZ * 1.03, y: geometry.bodyScaleY, z: geometry.bodyScaleXZ * 1.03 };
  const local = deriveCompensatedHeadLocalScale(geometry, bodyWorldScale);

  assert.ok(Math.abs(local.x * bodyWorldScale.x - geometry.headScaleX) < 1e-12);
  assert.ok(Math.abs(local.y * bodyWorldScale.y - geometry.headScaleY) < 1e-12);
  assert.ok(Math.abs(local.z * bodyWorldScale.z - 1) < 1e-12);
});

test('production personalization capability contract is explicit about rendered versus stored-only fields', () => {
  for (const field of ['faceWidth', 'faceHeight', 'bodyScale', 'shoulderWidth', 'skinTone', 'hairColor', 'outfitColor'] as const) {
    assert.equal(AVATAR_PERSONALIZATION_CAPABILITIES[field].effect, 'rendered', field);
  }
  for (const field of ['jawRoundness', 'eyeSize', 'eyeSpacing', 'browAngle', 'noseSize', 'mouthWidth'] as const) {
    assert.equal(AVATAR_PERSONALIZATION_CAPABILITIES[field].effect, 'stored-only', field);
    assert.equal(AVATAR_PERSONALIZATION_CAPABILITIES[field].channel, 'stored-only', field);
  }
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


test('avatar personalization provenance persists only opaque local receipts', () => {
  assert.deepEqual(
    normalizeAvatarPersonalizationProvenance({
      mode: 'photo_assisted',
      sourceRefs: [
        'photo:local:abc123',
        ' photo:local:abc123 ',
        'file:///private/var/mobile/photo.jpg',
        'content://media/external/images/42',
        'blob:https://example.test/123',
        'data:image/jpeg;base64,AAAA',
        'https://example.test/photo.jpg',
      ],
    }),
    {
      mode: 'photo_assisted',
      sourceRefs: ['photo:local:abc123'],
    },
  );
});

test('photo-assisted provenance fails closed to manual without a valid opaque receipt', () => {
  assert.deepEqual(
    normalizeAvatarPersonalizationProvenance({
      mode: 'photo_assisted',
      sourceRefs: ['file:///tmp/raw.jpg'],
    }),
    {
      mode: 'manual',
      sourceRefs: [],
    },
  );
  assert.deepEqual(normalizeAvatarPersonalizationProvenance(), {
    mode: 'manual',
    sourceRefs: [],
  });
});
