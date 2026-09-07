import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyAvatarMaterial } from '../src/mirror3d/avatar/v2/avatarPersonalization';

interface GltfJson {
  materials?: { name?: string }[];
  meshes?: {
    name?: string;
    extras?: { targetNames?: string[] };
    primitives?: { material?: number; targets?: Record<string, number>[] }[];
  }[];
  extensions?: {
    VRM?: {
      humanoid?: {
        humanBones?: { bone?: string; node?: number }[];
      };
      blendShapeMaster?: {
        blendShapeGroups?: {
          name?: string;
          presetName?: string;
          binds?: { mesh?: number; index?: number; weight?: number }[];
        }[];
      };
    };
  };
}

function parseGlbJson(path: string): GltfJson {
  const buffer = readFileSync(path);
  assert.equal(buffer.toString('utf8', 0, 4), 'glTF', 'production avatar must be a GLB file');
  assert.equal(buffer.readUInt32LE(4), 2, 'production avatar must use GLB v2');

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4e4f534a) {
      const text = buffer.subarray(offset, offset + length).toString('utf8').replace(/\0/g, '').trim();
      return JSON.parse(text) as GltfJson;
    }
    offset += length;
  }
  throw new Error('GLB JSON chunk not found');
}

test('production AvatarSample_G exposes material names needed for safe runtime tinting', () => {
  const gltf = parseGlbJson(resolve('public/avatar/AvatarSample_G.glb'));
  const materials = gltf.materials ?? [];
  const meshes = gltf.meshes ?? [];
  const roles = new Set<string>();
  const inspected: string[] = [];

  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      const material = primitive.material === undefined ? undefined : materials[primitive.material];
      const materialName = material?.name ?? '';
      const meshName = mesh.name ?? '';
      const combined = [meshName, materialName].filter(Boolean).join(' ');
      if (!combined) continue;
      inspected.push(combined);
      const role = classifyAvatarMaterial(materialName, meshName);
      if (role) roles.add(role);

      if (/CLOTH/i.test(materialName)) {
        assert.equal(role, 'outfit', `CLOTH material must override mesh fallback: ${combined}`);
      }
      if (/HAIR/i.test(materialName)) {
        assert.equal(role, 'hair', `HAIR material must override mesh fallback: ${combined}`);
      }
      if (/SKIN/i.test(materialName)) {
        assert.equal(role, 'skin', `SKIN material must override mesh fallback: ${combined}`);
      }
    }
  }

  assert.ok(roles.has('skin'), 'no confidently classified skin material; inspected: ' + inspected.join(' | '));
  assert.ok(roles.has('hair'), 'no confidently classified hair material; inspected: ' + inspected.join(' | '));
  assert.ok(roles.has('outfit'), 'no confidently classified outfit material; inspected: ' + inspected.join(' | '));
});


test('production AvatarSample_G exposes the humanoid bones required by real face/body separation', () => {
  const gltf = parseGlbJson(resolve('public/avatar/AvatarSample_G.glb'));
  const humanBones = gltf.extensions?.VRM?.humanoid?.humanBones ?? [];
  const names = new Set(humanBones.map((entry) => entry.bone).filter(Boolean));

  for (const required of ['head', 'leftUpperArm', 'rightUpperArm']) {
    assert.ok(names.has(required), `production VRM missing required humanoid bone ${required}; found: ${[...names].join(', ')}`);
  }

  const hasDedicatedShoulders = names.has('leftShoulder') && names.has('rightShoulder');
  assert.ok(
    hasDedicatedShoulders || (names.has('leftUpperArm') && names.has('rightUpperArm')),
    'production VRM must support shoulder spread through shoulder bones or upper-arm roots',
  );
});


test('production AvatarSample_G morph inventory supports expressions but has no verified structural identity channels', () => {
  const gltf = parseGlbJson(resolve('public/avatar/AvatarSample_G.glb'));
  const meshes = gltf.meshes ?? [];
  const blendGroups = gltf.extensions?.VRM?.blendShapeMaster?.blendShapeGroups ?? [];

  const targetNames = meshes.flatMap((mesh) => mesh.extras?.targetNames ?? []);
  const morphPrimitiveCount = meshes.reduce(
    (count, mesh) => count + (mesh.primitives ?? []).filter((primitive) => (primitive.targets?.length ?? 0) > 0).length,
    0,
  );
  const blendGroupNames = blendGroups.flatMap((group) => [group.name, group.presetName]).filter(
    (name): name is string => Boolean(name),
  );

  assert.ok(
    morphPrimitiveCount > 0 || blendGroups.some((group) => (group.binds?.length ?? 0) > 0),
    'production avatar must expose at least one morph/expression binding',
  );
  assert.ok(
    blendGroupNames.some((name) => /^(blink(?:_l|_r)?|joy|angry|sorrow|fun|a|i|u|e|o)$/i.test(name.trim())),
    `production avatar should expose expression-oriented BlendShape groups; found: ${blendGroupNames.join(', ')}`,
  );

  // This is deliberately a "verified structural channel" heuristic, not a claim
  // that unnamed/internal morph deltas cannot exist. Any future model exposing a
  // clearly named identity morph should fail here so the product capability map
  // is reviewed instead of silently leaving a real channel marked stored-only.
  const structuralIdentityPattern =
    /(face[_ .-]?(width|height|shape)|head[_ .-]?(width|height)|jaw[_ .-]?(width|round|shape)|chin[_ .-]?(width|shape)|nose[_ .-]?(size|width|height)|eye[_ .-]?(size|spacing|distance)|mouth[_ .-]?width|brow[_ .-]?angle)/i;
  const verifiedStructuralNames = [...targetNames, ...blendGroupNames]
    .filter((name) => structuralIdentityPattern.test(name));

  assert.deepEqual(
    verifiedStructuralNames,
    [],
    `production model now appears to expose structural identity morphs; review stored-only capability mapping: ${verifiedStructuralNames.join(', ')}`,
  );

  console.log('[avatar-model-capability]', JSON.stringify({
    morphPrimitiveCount,
    targetNames,
    blendShapeGroups: blendGroups.map((group) => ({
      name: group.name ?? null,
      presetName: group.presetName ?? null,
      bindCount: group.binds?.length ?? 0,
    })),
    verifiedStructuralNames,
  }));
});
