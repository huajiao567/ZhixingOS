import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vector3 } from 'three';
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

// A bone accepting a quaternion is not enough: prove that the mapped humanoid bone is actually
// part of the bound skin and that rotating it changes evaluated skinned vertex positions.
const leftUpperArm = vrm.humanoid.getRawBoneNode('leftUpperArm');
if (!leftUpperArm) throw new Error('runtime humanoid is missing leftUpperArm');

let skinDeformationProof = null;
vrm.scene.traverse((object) => {
  if (skinDeformationProof || !object.isSkinnedMesh || !object.skeleton) return;
  const boneIndex = object.skeleton.bones.indexOf(leftUpperArm);
  if (boneIndex < 0) return;

  const position = object.geometry?.attributes?.position;
  const skinIndex = object.geometry?.attributes?.skinIndex;
  const skinWeight = object.geometry?.attributes?.skinWeight;
  if (!position || !skinIndex || !skinWeight || position.count !== skinIndex.count || position.count !== skinWeight.count) {
    return;
  }

  const component = (attribute, vertexIndex, lane) => {
    if (lane === 0) return attribute.getX(vertexIndex);
    if (lane === 1) return attribute.getY(vertexIndex);
    if (lane === 2) return attribute.getZ(vertexIndex);
    return attribute.getW(vertexIndex);
  };

  const influenced = [];
  let maxLeftUpperArmWeight = 0;
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    let weight = 0;
    for (let lane = 0; lane < 4; lane += 1) {
      if (component(skinIndex, vertexIndex, lane) === boneIndex) {
        weight += component(skinWeight, vertexIndex, lane);
      }
    }
    if (weight > 1e-6) {
      influenced.push(vertexIndex);
      maxLeftUpperArmWeight = Math.max(maxLeftUpperArmWeight, weight);
    }
  }
  if (!influenced.length) return;

  vrm.scene.updateMatrixWorld(true);
  object.skeleton.update();
  const before = influenced.map((vertexIndex) => {
    const point = new Vector3().fromBufferAttribute(position, vertexIndex);
    return object.applyBoneTransform(vertexIndex, point);
  });

  const originalQuaternion = leftUpperArm.quaternion.clone();
  leftUpperArm.rotation.z += 0.05;
  vrm.scene.updateMatrixWorld(true);
  object.skeleton.update();

  let movedVertexCount = 0;
  let maxSkinnedVertexDelta = 0;
  for (let i = 0; i < influenced.length; i += 1) {
    const vertexIndex = influenced[i];
    const point = new Vector3().fromBufferAttribute(position, vertexIndex);
    object.applyBoneTransform(vertexIndex, point);
    const delta = point.distanceTo(before[i]);
    if (delta > 1e-8) movedVertexCount += 1;
    maxSkinnedVertexDelta = Math.max(maxSkinnedVertexDelta, delta);
  }

  const changedRotation = leftUpperArm.quaternion.angleTo(originalQuaternion);
  leftUpperArm.quaternion.copy(originalQuaternion);
  vrm.scene.updateMatrixWorld(true);
  object.skeleton.update();

  skinDeformationProof = {
    mesh: object.name,
    bone: 'leftUpperArm',
    boneIndex,
    influencedVertexCount: influenced.length,
    movedVertexCount,
    maxLeftUpperArmWeight,
    maxSkinnedVertexDelta,
    rotationDeltaRadians: changedRotation,
  };
});

if (!skinDeformationProof) {
  throw new Error('leftUpperArm is not connected to any runtime SkinnedMesh skin');
}
if (!(skinDeformationProof.rotationDeltaRadians > 0.01)) {
  throw new Error(`runtime humanoid bone did not accept a real transform: ${JSON.stringify(skinDeformationProof)}`);
}
if (skinDeformationProof.movedVertexCount < 10 || skinDeformationProof.maxSkinnedVertexDelta <= 1e-6) {
  throw new Error(`runtime bone transform did not deform bound skin geometry: ${JSON.stringify(skinDeformationProof)}`);
}

console.log('[rigged-vrm-runtime-probe]', JSON.stringify({
  candidatePath,
  bytes: bytes.length,
  coreBoneCount: coreBones.length,
  missingBones,
  skinnedMeshes,
  runtimeTargets: [...runtimeTargets].sort(),
  morphDeltaProof,
  skinDeformationProof,
}));
