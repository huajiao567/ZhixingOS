import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyAvatarMaterial } from '../src/mirror3d/avatar/v2/avatarPersonalization';

interface GltfJson {
  materials?: { name?: string }[];
  meshes?: { name?: string; primitives?: { material?: number }[] }[];
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
      const combined = [mesh.name, material?.name].filter(Boolean).join(' ');
      if (!combined) continue;
      inspected.push(combined);
      const role = classifyAvatarMaterial(combined);
      if (role) roles.add(role);
    }
  }

  assert.ok(roles.has('skin'), 'no confidently classified skin material; inspected: ' + inspected.join(' | '));
  assert.ok(roles.has('hair'), 'no confidently classified hair material; inspected: ' + inspected.join(' | '));
  assert.ok(roles.has('outfit'), 'no confidently classified outfit material; inspected: ' + inspected.join(' | '));
});
