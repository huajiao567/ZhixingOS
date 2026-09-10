import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

const candidatePath = resolve(process.argv[2] ?? 'artifacts/makehuman-rigged-candidate/MakeHuman_Core_Rigged_Candidate.vrm');
const bytes = readFileSync(candidatePath);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

const gltf = await new Promise((resolveLoad, rejectLoad) => {
  loader.parse(arrayBuffer, '', resolveLoad, rejectLoad);
});
const vrm = gltf.userData?.vrm;
if (!vrm) throw new Error('three-vrm did not create a VRM runtime object');
if (!vrm.humanoid) throw new Error('three-vrm loaded the file without a humanoid runtime');

const coreBones = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
];
const missingBones = coreBones.filter((name) => !vrm.humanoid.getRawBoneNode(name));
if (missingBones.length) throw new Error(`three-vrm missing core humanoid bones: ${missingBones.join(', ')}`);

const skinnedMeshes = [];
const morphDictionaries = [];
vrm.scene.traverse((object) => {
  if (object.isSkinnedMesh) {
    skinnedMeshes.push({
      name: object.name,
      skeletonBones: object.skeleton?.bones?.length ?? 0,
      vertexCount: object.geometry?.attributes?.position?.count ?? 0,
    });
  }
  if (object.morphTargetDictionary) {
    morphDictionaries.push({ name: object.name, targets: Object.keys(object.morphTargetDictionary) });
  }
});
if (!skinnedMeshes.length) throw new Error('candidate has no runtime SkinnedMesh after GLTFLoader/three-vrm parsing');
if (skinnedMeshes.some((mesh) => mesh.skeletonBones === 0)) throw new Error('candidate SkinnedMesh has no bound skeleton bones');

const requiredTargets = ['face_jaw_width', 'eye_size', 'nose_width', 'mouth_width'];
const runtimeTargets = new Set(morphDictionaries.flatMap((entry) => entry.targets));
const missingTargets = requiredTargets.filter((target) => !runtimeTargets.has(target));
if (missingTargets.length) throw new Error(`runtime morph targets missing: ${missingTargets.join(', ')}`);

// Prove a structural runtime channel changes actual vertex geometry rather than only metadata.
let morphDeltaProof = null;
vrm.scene.traverse((object) => {
  if (morphDeltaProof || !object.isSkinnedMesh || !object.morphTargetDictionary) return;
  const targetIndex = object.morphTargetDictionary.nose_width;
  if (!Number.isInteger(targetIndex)) return;
  const base = object.geometry.attributes.position;
  const morph = object.geometry.morphAttributes.position?.[targetIndex];
  if (!base || !morph || base.count !== morph.count) return;
  let changedVertices = 0;
  let maxDelta = 0;
  for (let i = 0; i < morph.count; i += 1) {
    const dx = morph.getX(i);
    const dy = morph.getY(i);
    const dz = morph.getZ(i);
    const magnitude = Math.hypot(dx, dy, dz);
    if (magnitude > 1e-8) changedVertices += 1;
    if (magnitude > maxDelta) maxDelta = magnitude;
  }
  morphDeltaProof = { target: 'nose_width', changedVertices, maxDelta };
});
if (!morphDeltaProof || morphDeltaProof.changedVertices < 10 || morphDeltaProof.maxDelta <= 0) {
  throw new Error(`runtime nose morph has no meaningful vertex delta: ${JSON.stringify(morphDeltaProof)}`);
}

// Bone motion must propagate through an actual bound skeleton without mutating the source file.
const leftUpperArm = vrm.humanoid.getRawBoneNode('leftUpperArm');
const originalRotation = leftUpperArm.rotation.clone();
leftUpperArm.rotation.z += 0.05;
leftUpperArm.updateMatrixWorld(true);
const changedRotation = leftUpperArm.rotation.angleTo(originalRotation);
leftUpperArm.rotation.copy(originalRotation);
if (!(changedRotation > 0.01)) throw new Error('runtime humanoid bone did not accept a real transform');

console.log('[rigged-vrm-runtime-probe]', JSON.stringify({
  candidatePath,
  bytes: bytes.length,
  coreBoneCount: coreBones.length,
  missingBones,
  skinnedMeshes,
  runtimeTargets: [...runtimeTargets].sort(),
  morphDeltaProof,
  leftUpperArmRotationDeltaRadians: changedRotation,
}));
