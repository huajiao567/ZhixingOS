import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

interface AvatarAudit {
  bytes: number;
  sha256: string;
  vrm: {
    version: string;
    humanoidBones: string[];
    expressionCount: number;
    expressions: string[];
  };
  geometry: {
    meshCount: number;
    primitiveCount: number;
    materialCount: number;
    positionVertexReferences: number;
    estimatedTriangles: number;
  };
  morphs: {
    primitiveTargetBindingCount: number;
    namedTargetCount: number;
    structuralFamilies: Record<string, string[]>;
    namedStructuralFamilyCount: number;
  };
}

function auditProductionAvatar(): AvatarAudit {
  const output = execFileSync(
    process.execPath,
    ['scripts/audit-avatar-model.mjs', 'public/avatar/AvatarSample_G.glb', '--json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(output) as AvatarAudit;
}

test('production avatar audit is reproducible and tied to the reviewed model bytes', () => {
  const audit = auditProductionAvatar();

  assert.equal(audit.bytes, 15_321_932);
  assert.equal(
    audit.sha256,
    'ad5750ce944b708155abb7ac6807e19d7f5e73a939f0ee32daf0539acfca57c0',
  );
  assert.equal(audit.vrm.version, '0.x');

  for (const bone of ['hips', 'head', 'leftUpperArm', 'rightUpperArm']) {
    assert.ok(audit.vrm.humanoidBones.includes(bone), `production avatar is missing humanoid bone ${bone}`);
  }

  assert.ok(audit.geometry.meshCount > 0);
  assert.ok(audit.geometry.primitiveCount > 0);
  assert.ok(audit.geometry.materialCount > 0);
  assert.ok(audit.geometry.positionVertexReferences > 0);
  assert.ok(audit.geometry.estimatedTriangles > 0);
});

test('production avatar audit keeps expression morphs separate from structural identity evidence', () => {
  const audit = auditProductionAvatar();

  assert.ok(audit.morphs.primitiveTargetBindingCount > 0, 'production model should expose expression morph bindings');
  assert.ok(
    audit.vrm.expressions.some((name) => /blink/i.test(name)),
    `expected a blink expression, found: ${audit.vrm.expressions.join(', ')}`,
  );

  // The current model is intentionally treated as having no *verified named*
  // structural identity morphs. This does not prove that no unnamed vertex
  // deltas exist; it prevents UI from upgrading stored-only controls based on
  // expression BlendShapes or guesswork.
  assert.equal(audit.morphs.namedStructuralFamilyCount, 0);
  for (const [family, matches] of Object.entries(audit.morphs.structuralFamilies)) {
    assert.deepEqual(matches, [], `unexpected named structural morphs for ${family}: ${matches.join(', ')}`);
  }
});
