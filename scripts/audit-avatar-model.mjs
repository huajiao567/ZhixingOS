import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const JSON_CHUNK = 0x4e4f534a;
const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;

const CORE_HUMANOID_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
  'leftUpperLeg',
  'rightUpperLeg',
  'leftLowerLeg',
  'rightLowerLeg',
  'leftFoot',
  'rightFoot',
];

const STRUCTURAL_FAMILY_PATTERNS = {
  faceContour: [
    /(?:face|head|jaw|chin|cheek).*(?:width|height|shape|round|size|scale|depth|wide|narrow|long|short)/i,
    /(?:width|height|shape|round|size|scale|depth|wide|narrow|long|short).*(?:face|head|jaw|chin|cheek)/i,
  ],
  eye: [
    /eye.*(?:size|spacing|distance|width|height|shape|scale|large|small|wide|narrow)/i,
    /(?:size|spacing|distance|width|height|shape|scale|large|small|wide|narrow).*eye/i,
  ],
  nose: [
    /nose.*(?:size|width|height|length|shape|scale|tip|bridge|nostril)/i,
    /(?:size|width|height|length|shape|scale|tip|bridge|nostril).*nose/i,
  ],
  mouth: [
    /(?:mouth|lip).*(?:size|width|height|shape|scale|thick|thin|wide|narrow)/i,
    /(?:size|width|height|shape|scale|thick|thin|wide|narrow).*(?:mouth|lip)/i,
  ],
  brow: [
    /(?:brow|eyebrow).*(?:angle|height|width|shape|spacing|distance|scale)/i,
    /(?:angle|height|width|shape|spacing|distance|scale).*(?:brow|eyebrow)/i,
  ],
  body: [
    /(?:body|torso|shoulder|chest|waist|hip).*(?:width|height|size|shape|scale|depth|broad|narrow)/i,
    /(?:width|height|size|shape|scale|depth|broad|narrow).*(?:body|torso|shoulder|chest|waist|hip)/i,
  ],
};

function readGlbJson(buffer) {
  if (buffer.length < 20 || buffer.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error('avatar candidate must be a binary glTF/GLB file');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}; expected 2`);

  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) {
    throw new Error(`GLB byte length mismatch: header=${declaredLength}, file=${buffer.length}`);
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + chunkLength > buffer.length) throw new Error('GLB chunk extends beyond file boundary');
    if (chunkType === JSON_CHUNK) {
      const text = buffer.subarray(offset, offset + chunkLength).toString('utf8').replace(/\0+$/g, '').trim();
      return JSON.parse(text);
    }
    offset += chunkLength;
  }
  throw new Error('GLB JSON chunk not found');
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function vrmVersion(gltf) {
  if (gltf.extensions?.VRMC_vrm) return '1.0';
  if (gltf.extensions?.VRM) return '0.x';
  return 'none';
}

function vrmHumanoidBones(gltf) {
  const vrm1 = gltf.extensions?.VRMC_vrm?.humanoid?.humanBones;
  if (vrm1 && typeof vrm1 === 'object' && !Array.isArray(vrm1)) return Object.keys(vrm1);

  const vrm0 = gltf.extensions?.VRM?.humanoid?.humanBones;
  if (Array.isArray(vrm0)) return unique(vrm0.map((entry) => entry?.bone));
  return [];
}

function vrmExpressions(gltf) {
  const vrm1 = gltf.extensions?.VRMC_vrm?.expressions;
  const vrm1Names = [
    ...Object.keys(vrm1?.preset ?? {}),
    ...Object.keys(vrm1?.custom ?? {}),
  ];

  const vrm0Groups = gltf.extensions?.VRM?.blendShapeMaster?.blendShapeGroups ?? [];
  const vrm0Names = vrm0Groups.flatMap((group) => [group?.name, group?.presetName]);
  return unique([...vrm1Names, ...vrm0Names]);
}

function licenseMetadata(gltf) {
  const vrm1 = gltf.extensions?.VRMC_vrm?.meta;
  if (vrm1) {
    return {
      schema: 'VRM1',
      name: vrm1.name ?? null,
      authors: Array.isArray(vrm1.authors) ? vrm1.authors : [],
      licenseUrl: vrm1.licenseUrl ?? null,
      otherLicenseUrl: vrm1.otherLicenseUrl ?? null,
      avatarPermission: vrm1.avatarPermission ?? null,
      commercialUsage: vrm1.commercialUsage ?? null,
      creditNotation: vrm1.creditNotation ?? null,
      allowRedistribution: vrm1.allowRedistribution ?? null,
      modification: vrm1.modification ?? null,
    };
  }

  const vrm0 = gltf.extensions?.VRM?.meta;
  if (vrm0) {
    return {
      schema: 'VRM0',
      title: vrm0.title ?? null,
      author: vrm0.author ?? null,
      licenseName: vrm0.licenseName ?? null,
      otherLicenseUrl: vrm0.otherLicenseUrl ?? null,
      commercialUsageName: vrm0.commercialUssageName ?? null,
      allowedUserName: vrm0.allowedUserName ?? null,
      otherPermissionUrl: vrm0.otherPermissionUrl ?? null,
    };
  }
  return { schema: 'none' };
}

function primitiveElementCount(gltf, primitive) {
  const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
  if (!Number.isInteger(accessorIndex)) return 0;
  const accessor = gltf.accessors?.[accessorIndex];
  return Number.isFinite(accessor?.count) ? accessor.count : 0;
}

function primitiveTriangleCount(gltf, primitive) {
  const count = primitiveElementCount(gltf, primitive);
  const mode = primitive.mode ?? TRIANGLES;
  if (mode === TRIANGLES) return Math.floor(count / 3);
  if (mode === TRIANGLE_STRIP || mode === TRIANGLE_FAN) return Math.max(0, count - 2);
  return 0;
}

function collectTargetNames(gltf) {
  const names = [];
  for (const mesh of gltf.meshes ?? []) {
    for (const name of mesh.extras?.targetNames ?? []) names.push(name);
  }
  return unique(names);
}

function structuralMorphFamilies(names) {
  return Object.fromEntries(
    Object.entries(STRUCTURAL_FAMILY_PATTERNS).map(([family, patterns]) => [
      family,
      names.filter((name) => patterns.some((pattern) => pattern.test(name))),
    ]),
  );
}

export function auditAvatarModel(path) {
  const absolutePath = resolve(path);
  const buffer = readFileSync(absolutePath);
  const gltf = readGlbJson(buffer);
  const meshes = gltf.meshes ?? [];
  const materials = gltf.materials ?? [];
  const bones = unique(vrmHumanoidBones(gltf));
  const expressions = vrmExpressions(gltf);
  const targetNames = collectTargetNames(gltf);
  const families = structuralMorphFamilies(targetNames);

  let primitiveCount = 0;
  let morphTargetBindingCount = 0;
  let estimatedTriangles = 0;
  let positionVertexReferences = 0;

  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      primitiveCount += 1;
      morphTargetBindingCount += primitive.targets?.length ?? 0;
      estimatedTriangles += primitiveTriangleCount(gltf, primitive);
      const positionAccessorIndex = primitive.attributes?.POSITION;
      if (Number.isInteger(positionAccessorIndex)) {
        const accessor = gltf.accessors?.[positionAccessorIndex];
        if (Number.isFinite(accessor?.count)) positionVertexReferences += accessor.count;
      }
    }
  }

  const missingCoreBones = CORE_HUMANOID_BONES.filter((bone) => !bones.includes(bone));

  return {
    path,
    bytes: statSync(absolutePath).size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    gltf: {
      version: gltf.asset?.version ?? null,
      generator: gltf.asset?.generator ?? null,
      extensionsUsed: unique(gltf.extensionsUsed ?? []),
      extensionsRequired: unique(gltf.extensionsRequired ?? []),
    },
    vrm: {
      version: vrmVersion(gltf),
      license: licenseMetadata(gltf),
      humanoidBoneCount: bones.length,
      humanoidBones: bones,
      missingCoreBones,
      expressionCount: expressions.length,
      expressions,
    },
    geometry: {
      meshCount: meshes.length,
      primitiveCount,
      materialCount: materials.length,
      imageCount: gltf.images?.length ?? 0,
      textureCount: gltf.textures?.length ?? 0,
      accessorCount: gltf.accessors?.length ?? 0,
      positionVertexReferences,
      estimatedTriangles,
    },
    morphs: {
      primitiveTargetBindingCount: morphTargetBindingCount,
      namedTargetCount: targetNames.length,
      namedTargets: targetNames,
      structuralFamilies: families,
      namedStructuralFamilyCount: Object.values(families).filter((matches) => matches.length > 0).length,
    },
    materials: materials.map((material, index) => ({
      index,
      name: material?.name ?? '',
      alphaMode: material?.alphaMode ?? 'OPAQUE',
      doubleSided: material?.doubleSided === true,
    })),
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const modelPath = args.shift() ?? 'public/avatar/AvatarSample_G.glb';
  let jsonOnly = false;
  let outputPath = null;
  let maxBytes = null;
  let requireFamilies = [];

  for (const arg of args) {
    if (arg === '--json') jsonOnly = true;
    else if (arg.startsWith('--output=')) outputPath = arg.slice('--output='.length);
    else if (arg.startsWith('--max-bytes=')) maxBytes = Number(arg.slice('--max-bytes='.length));
    else if (arg.startsWith('--require-families=')) {
      requireFamilies = arg.slice('--require-families='.length).split(',').map((value) => value.trim()).filter(Boolean);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { modelPath, jsonOnly, outputPath, maxBytes, requireFamilies };
}

function validateAudit(audit, options) {
  const errors = [];
  if (Number.isFinite(options.maxBytes) && audit.bytes > options.maxBytes) {
    errors.push(`file is ${audit.bytes} bytes, above max ${options.maxBytes}`);
  }
  for (const family of options.requireFamilies) {
    if (!(family in audit.morphs.structuralFamilies)) {
      errors.push(`unknown structural morph family "${family}"`);
      continue;
    }
    if (audit.morphs.structuralFamilies[family].length === 0) {
      errors.push(`no explicitly named structural morph target matched family "${family}"`);
    }
  }
  return errors;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2));
  const audit = auditAvatarModel(options.modelPath);
  const errors = validateAudit(audit, options);
  const json = JSON.stringify(audit, null, options.jsonOnly ? 0 : 2);

  if (options.outputPath) writeFileSync(resolve(options.outputPath), `${json}\n`);
  if (options.jsonOnly) {
    process.stdout.write(`${json}\n`);
  } else {
    console.log('[avatar-model-audit]', json);
    if (errors.length > 0) console.error('[avatar-model-audit] gate failures:', errors.join('; '));
  }

  if (errors.length > 0) process.exitCode = 1;
}
