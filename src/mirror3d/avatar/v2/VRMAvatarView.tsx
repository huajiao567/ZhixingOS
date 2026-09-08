/**
 * Satori Avatar v2 — VRMAvatarView（专业VRM数字孪生渲染器）
 *
 * 借鉴AIRI开源项目(https://github.com/moeru-ai/airi)的动画系统实现：
 *   - VRM/GLB模型加载与SkinnedMesh渲染
 *   - 只缓存不可变 GLB 二进制源；每个渲染实例独立解析 scene/skeleton/VRM runtime
 *   - VRMUtils性能优化（removeUnnecessaryVertices · combineSkeletons，每个独立实例执行）
 *   - AIRI风格精确包围盒计算（mesh-only · world-space · 排除碰撞器）
 *   - 自动胸像构图（38-42°中长焦 · 人像摄影标准 · pivot上移1/5）
 *   - T-pose → A-pose自然手臂姿势修正
 *   - VRM LookAt视线追踪（眼睛自然跟随鼠标指针 · 平滑lerp）
 *   - 自然动画系统（受用户状态profile驱动调制）：
 *     * 自然眨眼（正弦曲线平滑 · 快闭慢睁 · 受focus/tension调制频率）
 *     * 眼跳微抖动（叠加在LookAt之上 · 概率分布间隔 · 受gazeAmplitude调制）
 *     * 情绪表情（VRM expressionManager · easeInOutCubic平滑过渡）
 *     * 呼吸动画（脊柱/肩膀协调起伏 · 受tension/energy调制）
 *     * 头部微动（缓慢摆动 · 受gazeAmplitude调制）
 *     * 肩颈紧张度表达（tension>0.5时肩膀微抬）
 *     * 成长痕迹（极慢变量映射到BlendShape基线 · 幅度≤15%）
 *   - 双主题兼容（光照由父组件AvatarModelView统一控制）
 */
import React, { useRef, useEffect, useState, Suspense, Component, useCallback, type ReactNode, type ErrorInfo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three-stdlib';
import type { GLTF } from 'three-stdlib';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import * as THREE from 'three';
import type { AvatarProfileV2 } from './avatarTypes';
import { deriveRuntimePose, growthTraitsToBlendShapes } from './avatarPatchEngine';
import {
  classifyAvatarMaterial,
  deriveAvatarIdentityGeometry,
  deriveCompensatedHeadLocalScale,
  safeAppearanceColor,
} from './avatarPersonalization';

interface VRMAvatarViewProps {
  profile: AvatarProfileV2;
  modelUrl?: string;
  paused?: boolean;
  framing?: 'bust' | 'full';
  /** 点击Avatar时的回调（进入镜子页面） */
  onAvatarPress?: () => void;
  /** 触发记录完成反应（轻微舒展动作）- 值变化时触发 */
  triggerAcknowledge?: number;
  /** 触发触摸反应动画（外部点击舞台时）- 值变化时触发 */
  triggerTouchReaction?: number;
  onError?: (error: Error) => void;
}

export type AvatarLoadPhase = 'idle' | 'effect-start' | 'requesting' | 'parsed' | 'optimizing' | 'loaded' | 'preparing' | 'model-mounted' | 'ready' | 'discarded' | 'error';

export interface AvatarLoadState {
  phase: AvatarLoadPhase;
  url?: string;
  loaded?: number;
  total?: number;
  message?: string;
  updatedAt?: number;
  size?: { x: number; y: number; z: number };
  center?: { x: number; y: number; z: number };
}

export interface AvatarRuntimeProbe {
  updatedAt: number;
  identity: {
    faceWidth: number;
    faceHeight: number;
    jawRoundness: number;
    eyeSize: number;
    eyeSpacing: number;
    browAngle: number;
    noseSize: number;
    mouthWidth: number;
    bodyScale: number;
    shoulderWidth: number;
  };
  geometry: {
    groupScale: { x: number; y: number; z: number };
    headLocalScale?: { x: number; y: number; z: number };
    headWorldScale?: { x: number; y: number; z: number };
    shoulderRootNames: string[];
    shoulderWorldDistance?: number;
  };
  appearance: {
    skin?: string;
    hair?: string;
    outfit?: string;
  };
}

// 相机构图基线由 Web 与 Native 共用；不能依赖 window，否则 Android 首帧会崩溃。
const cameraDefaults = {
  distance: 1.5,
  targetX: 0,
  targetY: 1.4,
};

interface GLBModelProps {
  url: string;
  onLoaded?: (size: THREE.Vector3, center: THREE.Vector3, headY: number, headCenterX: number, headBoneY: number, shoulderY: number, chestY: number, shoulderWidth: number) => void;
  onError?: (e: Error) => void;
  paused: boolean;
  profile: AvatarProfileV2;
  triggerAcknowledge?: number;
  triggerTouchReaction?: number;
  /** OrbitControls检测到的点击事件（递增触发） */
  tapTriggerRef?: React.MutableRefObject<number>;
  /** 点击时的屏幕归一化坐标 [-1,1]，由OrbitControls设置 */
  tapScreenPosRef?: React.MutableRefObject<{ x: number; y: number }>;
}

/* ───────────── Error Boundary ───────────── */
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }
class AvatarErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError?: (error: Error) => void }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode; fallback: ReactNode; onError?: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[VRM] Render error:', error, info.componentStack);
    this.props.onError?.(error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/* ───────────── 数学工具 ───────────── */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

type TintableMaterial = THREE.Material & {
  color?: THREE.Color;
  roughness?: number;
  metalness?: number;
  userData: Record<string, unknown>;
};


function applyConfirmedAppearanceToModel(
  root: THREE.Object3D,
  profile: AvatarProfileV2,
): AvatarRuntimeProbe['appearance'] {
  const targets = {
    skin: new THREE.Color(safeAppearanceColor(profile.identity.skinMaterial.baseColor, '#F2C89B')),
    hair: new THREE.Color(safeAppearanceColor(profile.appearance.hairColor, '#2A2028')),
    outfit: new THREE.Color(safeAppearanceColor(profile.appearance.outfitColor, '#536BE8')),
  };
  const strengths = { skin: 0.22, hair: 0.52, outfit: 0.44 } as const;
  const sample: AvatarRuntimeProbe['appearance'] = {};

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const tintable = material as TintableMaterial;
      if (!tintable.color) continue;
      const role = classifyAvatarMaterial(material.name ?? '', mesh.name);
      if (!role) continue;

      const originalKey = 'zhixingOriginalColor';
      const originalHex = typeof tintable.userData?.[originalKey] === 'string'
        ? String(tintable.userData[originalKey])
        : `#${tintable.color.getHexString()}`;
      tintable.userData = tintable.userData ?? {};
      tintable.userData[originalKey] = originalHex;

      const original = new THREE.Color(originalHex);
      tintable.color.copy(original).lerp(targets[role], strengths[role]);
      tintable.needsUpdate = true;
      sample[role] ??= `#${tintable.color.getHexString().toUpperCase()}`;
    }
  });
  return sample;
}

/* ───────────── AIRI眼跳间隔概率分布（移植自AIRI eye-motions.ts） ─────────────
 * 人类眼跳间隔：800ms内快速眼跳占~45%，0.8-2s中等注视占~40%，2-4s长注视占~15%
 */
const EYE_SACCADE_INT_STEP = 400;
const EYE_SACCADE_INT_P: [number, number][] = [
  [0.075, 800],
  [0.110, 0],
  [0.125, 0],
  [0.140, 0],
  [0.125, 0],
  [0.050, 0],
  [0.040, 0],
  [0.030, 0],
  [0.020, 0],
  [1.000, 0],
];
for (let i = 1; i < EYE_SACCADE_INT_P.length; i++) {
  EYE_SACCADE_INT_P[i][0] += EYE_SACCADE_INT_P[i - 1][0];
  EYE_SACCADE_INT_P[i][1] = EYE_SACCADE_INT_P[i - 1][1] + EYE_SACCADE_INT_STEP;
}

function randomSaccadeInterval(): number {
  const r = Math.random();
  for (let i = 0; i < EYE_SACCADE_INT_P.length; i++) {
    if (r <= EYE_SACCADE_INT_P[i][0]) {
      return (EYE_SACCADE_INT_P[i][1] + Math.random() * EYE_SACCADE_INT_STEP) / 1000;
    }
  }
  return (EYE_SACCADE_INT_P.at(-1)![1] + Math.random() * EYE_SACCADE_INT_STEP) / 1000;
}

/* ───────────── 自然动画状态管理 ───────────── */
interface EmotionState {
  current: string;
  transitionProgress: number;
  isTransitioning: boolean;
  blendDuration: number;
  currentWeights: Map<string, number>;
  targetWeights: Map<string, number>;
}

interface EyeSaccadeState {
  /** 当前注视目标（相对于正视前方的偏移，弧度） */
  targetX: number;
  targetY: number;
  /** 当前平滑插值位置 */
  currentX: number;
  currentY: number;
  /** 下次眼跳时间 */
  nextSaccadeAt: number;
  /** 是否正在快速移动中（眼跳） */
  isSaccading: boolean;
  /** 眼跳进度 */
  saccadeProgress: number;
  /** 眼跳持续时间 */
  saccadeDuration: number;
  /** 眼跳起点 */
  startX: number;
  startY: number;
}

/** 点击/触摸反馈状态 */
interface TouchReactionState {
  active: boolean;
  progress: number;
  duration: number;
  /** 头部轻微倾斜方向 */
  headTiltDir: number;
  /** 点击的身体部位 */
  bodyPart: 'head' | 'leftArm' | 'rightArm' | 'body' | 'none';
}

/** 记录确认/倾听反应状态 */
interface AcknowledgeState {
  active: boolean;
  progress: number;
  duration: number;
  /** 上次触发值（用于检测变化） */
  lastTrigger: number;
}

/** AIRI风格非对称眨眼阶段 */
type BlinkPhase = 'closing' | 'closed' | 'opening';

interface NaturalMotionState {
  // 眨眼（AIRI非对称生物曲线：快闭75ms/easeOutQuart → 短暂闭合10-30ms → 慢睁150-250ms/easeInOutCubic）
  blinkActive: boolean;
  blinkPhase: BlinkPhase;
  blinkProgress: number;
  nextBlinkTime: number;
  /** 闭合阶段持续时间 */
  blinkCloseDuration: number;
  /** 完全闭合保持时间 */
  blinkHoldDuration: number;
  /** 睁开阶段持续时间 */
  blinkOpenDuration: number;
  // 呼吸
  breathPhase: number;
  // 头部微动
  headSwayPhase: number;
  headNodPhase: number;
  // 眼球运动（AIRI式眼跳）
  eyes: EyeSaccadeState;
  // 情绪表情
  emotion: EmotionState;
  // 成长痕迹缓存（避免每帧重建Map）
  growthWeights: Map<string, number>;
  // 触摸点击反馈
  touch: TouchReactionState;
  // 记录确认/倾听反应
  acknowledge: AcknowledgeState;
  // 时间累积
  elapsed: number;
}

const EMOTION_PRESETS = new Map<string, { expressions: { name: string; value: number }[]; blendDuration: number }>([
  ['neutral', { expressions: [{ name: 'relaxed', value: 0.15 }], blendDuration: 0.6 }],
  ['happy', { expressions: [{ name: 'happy', value: 0.55 }, { name: 'aa', value: 0.12 }], blendDuration: 0.4 }],
  ['calm', { expressions: [{ name: 'relaxed', value: 0.35 }], blendDuration: 0.5 }],
  ['focused', { expressions: [{ name: 'blink', value: 0 }], blendDuration: 0.3 }],
  ['tired', { expressions: [{ name: 'relaxed', value: 0.2 }, { name: 'sad', value: 0.15 }], blendDuration: 0.5 }],
  ['tense', { expressions: [{ name: 'angry', value: 0.2 }], blendDuration: 0.3 }],
]);

function createInitialMotionState(): NaturalMotionState {
  return {
    blinkActive: false,
    blinkPhase: 'closing',
    blinkProgress: 0,
    nextBlinkTime: 1.5 + Math.random() * 2.5,
    // AIRI风格非对称生物眨眼：快闭75ms(easeOutQuart) → 闭合10-30ms → 慢睁150-250ms(easeInOutCubic)
    blinkCloseDuration: 0.065 + Math.random() * 0.02,
    blinkHoldDuration: 0.01 + Math.random() * 0.02,
    blinkOpenDuration: 0.15 + Math.random() * 0.08,
    breathPhase: Math.random() * Math.PI * 2,
    headSwayPhase: Math.random() * Math.PI * 2,
    headNodPhase: Math.random() * Math.PI * 2,
    eyes: {
      targetX: 0,
      targetY: 0,
      currentX: 0,
      currentY: 0,
      nextSaccadeAt: 0.8 + Math.random() * 1.2,
      isSaccading: false,
      saccadeProgress: 0,
      saccadeDuration: 0.06 + Math.random() * 0.04,
      startX: 0,
      startY: 0,
    },
    emotion: {
      current: 'neutral',
      transitionProgress: 1,
      isTransitioning: false,
      blendDuration: 0.6,
      currentWeights: new Map(),
      targetWeights: new Map(),
    },
    growthWeights: new Map(),
    touch: {
      active: false,
      progress: 0,
      duration: 0.5,
      headTiltDir: Math.random() > 0.5 ? 1 : -1,
      bodyPart: 'none',
    },
    acknowledge: {
      active: false,
      progress: 0,
      duration: 0.9,
      lastTrigger: 0,
    },
    elapsed: 0,
  };
}

/* ───────────── 骨骼查找 ───────────── */
interface FoundBones {
  leftUpperArm: THREE.Bone | null;
  rightUpperArm: THREE.Bone | null;
  leftLowerArm: THREE.Bone | null;
  rightLowerArm: THREE.Bone | null;
  leftShoulder: THREE.Bone | null;
  rightShoulder: THREE.Bone | null;
  spine: THREE.Bone | null;
  chest: THREE.Bone | null;
  head: THREE.Bone | null;
  neck: THREE.Bone | null;
  leftEye: THREE.Bone | null;
  rightEye: THREE.Bone | null;
}

function findBones(scene: THREE.Group): FoundBones {
  const result: FoundBones = {
    leftUpperArm: null, rightUpperArm: null, leftLowerArm: null, rightLowerArm: null,
    leftShoulder: null, rightShoulder: null, spine: null, chest: null,
    head: null, neck: null, leftEye: null, rightEye: null,
  };
  const allBones: string[] = [];

  // 左右侧判断：支持多种命名约定 (left/right, _l/_r, _L_/_R_, .l/.r, L_/R_前缀, _L/_R后缀)
  const isLeft = (name: string): boolean => /left|(^|[_.])l([_.]|$)|(^|[_.])L([_.]|$)/i.test(name);
  const isRight = (name: string): boolean => /right|(^|[_.])r([_.]|$)|(^|[_.])R([_.]|$)/i.test(name);

  scene.traverse((child) => {
    if (!(child as THREE.Bone).isBone) return;
    const bone = child as THREE.Bone;
    const name = bone.name.toLowerCase();
    allBones.push(bone.name);

    // 肩膀（日式BIP通常没有单独的shoulder骨骼，VRM可能有）
    if (name.includes('shoulder')) {
      if (isLeft(bone.name) && !result.leftShoulder) result.leftShoulder = bone;
      else if (isRight(bone.name) && !result.rightShoulder) result.rightShoulder = bone;
    }

    // 上臂：upperarm / upper arm
    const isUpperArm = (name.includes('upperarm') || name.includes('upper_arm') ||
      (name.includes('arm') && name.includes('upper'))) &&
      !name.includes('lower') && !name.includes('fore') &&
      !name.includes('hand') && !name.includes('elbow') && !name.includes('wrist') &&
      !name.includes('shoulder') && !name.includes('twist');
    if (isUpperArm) {
      if (isLeft(bone.name) && !result.leftUpperArm) result.leftUpperArm = bone;
      else if (isRight(bone.name) && !result.rightUpperArm) result.rightUpperArm = bone;
    }

    // 前臂：lowerarm / forearm / elbow
    const isLowerArm = (name.includes('lowerarm') || name.includes('lower_arm') ||
      name.includes('forearm') || (name.includes('arm') && name.includes('fore'))) &&
      !name.includes('upper') && !name.includes('hand') && !name.includes('wrist') && !name.includes('twist');
    if (isLowerArm) {
      if (isLeft(bone.name) && !result.leftLowerArm) result.leftLowerArm = bone;
      else if (isRight(bone.name) && !result.rightLowerArm) result.rightLowerArm = bone;
    }

    // 眼球骨骼：包含eye，排除brow/lid/eyetrack/look等非眼球骨
    // 日式BIP: J_Adj_L_FaceEye / J_Adj_R_FaceEye 是眼球骨骼
    // 注意：faceeye在日式命名中是眼球本身，不是调整器；排除faceeyeset(父节点组)
    if (name.includes('eye') && !name.includes('brow') && !name.includes('lid') &&
      !name.includes('eyetrack') && !name.includes('look') && !name.includes('eyeset')) {
      if (isLeft(bone.name) && !result.leftEye) result.leftEye = bone;
      else if (isRight(bone.name) && !result.rightEye) result.rightEye = bone;
      else if (!result.leftEye) result.leftEye = bone;
      else if (!result.rightEye) result.rightEye = bone;
    }

    // 脊柱/胸部/脖子/头（中心骨骼，C_前缀或不含左右标记）
    if (name.includes('spine') && !result.spine) result.spine = bone;
    if ((name.includes('chest') || name.includes('upperbody') || name.includes('upper_body')) && !result.chest) result.chest = bone;
    if (!result.head && (name === 'head' || (name.includes('head') && !name.includes('forehead') && !name.includes('end')))) {
      // 优先选不带end/suffix的头部骨骼
      result.head = bone;
    }
    if (name.includes('neck') && !name.includes('end') && !result.neck) result.neck = bone;
  });

  return result;
}

/* ───────────── BlendShape查找 ───────────── */
function findBlendShapeMeshes(scene: THREE.Group): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      meshes.push(mesh);
    }
  });
  return meshes;
}

function getBlendShapeIndex(mesh: THREE.SkinnedMesh, names: string[]): number {
  if (!mesh.morphTargetDictionary) return -1;
  for (const name of names) {
    const idx = mesh.morphTargetDictionary[name];
    if (idx !== undefined) return idx;
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(mesh.morphTargetDictionary)) {
      if (key.toLowerCase().includes(lowerName)) return value;
    }
  }
  return -1;
}

/**
 * 精确计算模型包围盒（借鉴AIRI computeBoundingBox）
 */
function computePreciseBoundingBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const childBox = new THREE.Box3();
  root.updateMatrixWorld(true);

  root.traverse((obj) => {
    if (!obj.visible) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (mesh.name.startsWith('VRMC_springBone_collider')) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();

    childBox.copy(mesh.geometry.boundingBox!);
    childBox.applyMatrix4(mesh.matrixWorld);
    box.union(childBox);
  });

  return box;
}

function deriveEmotionFromState(dailyState: AvatarProfileV2['dailyState']): string {
  const { energy, tension, focus } = dailyState;
  if (focus > 0.75) return 'focused';
  if (tension > 0.7) return 'tense';
  if (energy < 0.3) return 'tired';
  if (energy > 0.65 && tension < 0.4) return 'happy';
  if (energy > 0.4 && tension < 0.45) return 'calm';
  return 'neutral';
}

/* ───────────── 不可变模型源缓存 ─────────────
 * 只能共享原始 GLB bytes，绝不能共享已解析的 GLTF.scene/VRM runtime。
 * scene、骨骼、expressionManager、lookAt、springBone 都是可变对象；跨多个
 * AvatarCanvas 共享会让后挂载实例把前一个实例的身份变形当成“原始基线”，
 * 造成 1.06^N 一类跨屏累积污染。
 */
const modelSourceCache = new Map<string, Promise<ArrayBuffer>>();
let currentAvatarLoadState: AvatarLoadState = { phase: 'idle' };
const avatarLoadListeners = new Set<(state: AvatarLoadState) => void>();
const avatarLoadPhaseRank: Record<AvatarLoadPhase, number> = {
  idle: 0,
  'effect-start': 1,
  requesting: 2,
  parsed: 3,
  optimizing: 4,
  loaded: 5,
  preparing: 6,
  'model-mounted': 7,
  ready: 8,
  discarded: 0,
  error: 9,
};

export function subscribeAvatarLoad(listener: (state: AvatarLoadState) => void) {
  avatarLoadListeners.add(listener);
  listener(currentAvatarLoadState);
  return () => {
    avatarLoadListeners.delete(listener);
  };
}

function reportAvatarLoad(phase: AvatarLoadPhase, details: Omit<AvatarLoadState, 'phase'> = {}) {
  const sameResource = !details.url || !currentAvatarLoadState.url || details.url === currentAvatarLoadState.url;
  if (
    sameResource
    && phase !== 'error'
    && phase !== 'discarded'
    && avatarLoadPhaseRank[phase] < avatarLoadPhaseRank[currentAvatarLoadState.phase]
  ) {
    return;
  }
  currentAvatarLoadState = {
    ...currentAvatarLoadState,
    ...details,
    phase,
    updatedAt: Date.now(),
  };
  avatarLoadListeners.forEach((listener) => listener(currentAvatarLoadState));
  if (typeof globalThis === 'undefined') return;
  const root = globalThis as typeof globalThis & {
    __avatarLoadState?: AvatarLoadState;
  };
  root.__avatarLoadState = currentAvatarLoadState;
}

function reportAvatarRuntimeProbe(probe: AvatarRuntimeProbe) {
  if (typeof globalThis === 'undefined') return;
  const root = globalThis as typeof globalThis & {
    __avatarRuntimeProbe?: AvatarRuntimeProbe;
  };
  root.__avatarRuntimeProbe = probe;
}

async function loadModelSourceCached(url: string): Promise<ArrayBuffer> {
  let cached = modelSourceCache.get(url);
  if (!cached) {
    reportAvatarLoad('requesting', { url, loaded: 0, total: 0 });
    cached = fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Avatar model request failed: HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const headerTotal = Number(response.headers.get('content-length') ?? 0);
        reportAvatarLoad('requesting', {
          url,
          loaded: buffer.byteLength,
          total: headerTotal > 0 ? headerTotal : buffer.byteLength,
        });
        return buffer;
      })
      .catch((error) => {
        modelSourceCache.delete(url);
        reportAvatarLoad('error', {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
    modelSourceCache.set(url, cached);
  }
  return cached;
}

async function loadGLTFInstance(url: string): Promise<GLTF> {
  const source = await loadModelSourceCached(url);

  return new Promise<GLTF>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register(((parser: any) => new VRMLoaderPlugin(parser)) as any);
    loader.parse(
      source,
      '',
      (gltf) => {
        reportAvatarLoad('parsed', { url });
        const vrm: VRM | undefined = (gltf as any).userData?.vrm;
        if (vrm) {
          reportAvatarLoad('optimizing', { url });
          VRMUtils.removeUnnecessaryVertices(vrm.scene);
          VRMUtils.combineSkeletons(vrm.scene);
        }
        reportAvatarLoad('loaded', { url });
        resolve(gltf);
      },
      (error) => {
        reportAvatarLoad('error', {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      },
    );
  });
}

/* ───────────── GLB Model ───────────── */
function GLBModel({ url, onLoaded, onError, paused, profile, triggerAcknowledge, triggerTouchReaction, tapTriggerRef, tapScreenPosRef }: GLBModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const bonesRef = useRef<FoundBones>(
    { leftUpperArm: null, rightUpperArm: null, leftLowerArm: null, rightLowerArm: null, leftShoulder: null, rightShoulder: null, spine: null, chest: null, head: null, neck: null, leftEye: null, rightEye: null }
  );
  const blendMeshesRef = useRef<THREE.SkinnedMesh[]>([]);
  const blinkIndicesRef = useRef<{ mesh: THREE.SkinnedMesh; idx: number }[]>([]);
  const emotionIndicesRef = useRef<Map<THREE.SkinnedMesh, Map<string, number>>>(new Map());
  /** VRM实例（如果模型包含VRM扩展） */
  const vrmRef = useRef<VRM | null>(null);
  const motionRef = useRef<NaturalMotionState>(createInitialMotionState());
  const initialRotationsRef = useRef<Map<THREE.Bone, THREE.Euler>>(new Map());
  const initialScalesRef = useRef<Map<THREE.Bone, THREE.Vector3>>(new Map());
  const initialPositionsRef = useRef<Map<THREE.Bone, THREE.Vector3>>(new Map());
  const appearanceProbeRef = useRef<AvatarRuntimeProbe['appearance']>({});
  const lastRuntimeProbeAtRef = useRef(0);
  /** 眼下疲劳是独立、可移除的临时材质层，不修改基础模型纹理。 */
  const fatigueOverlayRef = useRef<THREE.Group | null>(null);
  const fatigueMaterialsRef = useRef<THREE.MeshBasicMaterial[]>([]);
  /** 眼睛高度（模型加载后计算，用于LookAt目标Y） */
  const eyeYRef = useRef(1.4);
  /** VRM LookAt目标（跟随鼠标位置，驱动自然视线追踪） */
  const lookAtTargetRef = useRef<THREE.Object3D>(new THREE.Object3D());
  /** 鼠标归一化坐标 [-1,1]，由DOM事件更新 */
  const mouseRef = useRef({ x: 0, y: -0.08 });
  /** 平滑后的lookAt目标位置 */
  const lookAtSmoothRef = useRef(new THREE.Vector3(0, 1.4, 0.8));
  /** 目标位置（复用避免GC） */
  const lookAtTargetPosRef = useRef(new THREE.Vector3());
  /** 射线检测，用于点击身体部位判定 */
  const raycasterRef = useRef(new THREE.Raycaster());
  /** 上一次处理的tapTrigger值，用于检测新点击 */
  const lastHandledTapRef = useRef(0);

  /** R3F Three.js上下文 */
  const { gl, camera } = useThree();

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        reportAvatarLoad('effect-start', { url });
        const gltf = await loadGLTFInstance(url);
        if (disposed) {
          reportAvatarLoad('discarded', { url });
          return;
        }
        reportAvatarLoad('preparing', { url });

        const scene = gltf.scene;

        // 重置变换（幂等：缓存场景被多次挂载时需要先复位）
        scene.position.set(0, 0, 0);
        scene.rotation.set(0, 0, 0);
        scene.scale.set(1, 1, 1);

        // glTF/VRM坐标系：+Z是模型前方，相机看向-Z，需旋转180度让模型面朝用户
        scene.rotation.y = Math.PI;

        // 获取VRM实例（如果模型包含VRM扩展）
        const vrm: VRM | null = (gltf as any).userData?.vrm ?? null;
        vrmRef.current = vrm;

        // 设置VRM LookAt视线追踪目标（鼠标位置）
        if (vrm?.lookAt) {
          vrm.lookAt.target = lookAtTargetRef.current;
          vrm.lookAt.autoUpdate = true;
        }

        scene.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });

        scene.updateMatrixWorld(true);

        const bones = findBones(scene);
        bonesRef.current = bones;

        // 为有标准眼球/头骨的模型建立临时眼下疲劳层。层随头骨运动，
        // 强度由可衰减状态驱动；模型本体、贴图和身份版本均不被修改。
        fatigueOverlayRef.current?.removeFromParent();
        for (const material of fatigueMaterialsRef.current) material.dispose();
        fatigueMaterialsRef.current = [];
        if (bones.head && bones.leftEye && bones.rightEye) {
          scene.updateMatrixWorld(true);
          const overlay = new THREE.Group();
          overlay.name = 'ZhixingAdaptiveEyeFatigue';
          const initialOpacity = deriveRuntimePose(profile).darkCircleOpacity;
          for (const eye of [bones.leftEye, bones.rightEye]) {
            const world = new THREE.Vector3();
            eye.getWorldPosition(world);
            const local = bones.head.worldToLocal(world.clone());
            const geometry = new THREE.CircleGeometry(1, 24);
            const material = new THREE.MeshBasicMaterial({
              color: 0x493847,
              transparent: true,
              opacity: initialOpacity,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
            const mark = new THREE.Mesh(geometry, material);
            mark.position.set(local.x, local.y - 0.022, local.z + 0.012);
            mark.scale.set(0.043, 0.012, 1);
            mark.renderOrder = 12;
            overlay.add(mark);
            fatigueMaterialsRef.current.push(material);
          }
          bones.head.add(overlay);
          fatigueOverlayRef.current = overlay;
        }

        // A-pose 自然站立姿势（VRoid T-pose时双臂水平外展，需旋转下垂）
        const deg = (d: number) => (d * Math.PI) / 180;
        if (bones.leftUpperArm) {
          bones.leftUpperArm.rotation.z = deg(82);
          bones.leftUpperArm.rotation.x = deg(4);
        }
        if (bones.rightUpperArm) {
          bones.rightUpperArm.rotation.z = -deg(82);
          bones.rightUpperArm.rotation.x = deg(4);
        }
        if (bones.leftLowerArm) {
          bones.leftLowerArm.rotation.x = -deg(28);
        }
        if (bones.rightLowerArm) {
          bones.rightLowerArm.rotation.x = -deg(28);
        }

        scene.updateMatrixWorld(true);

        // 保存A-pose作为初始旋转/缩放/位置基线。身份几何始终相对这个基线应用，
        // 避免每次渲染累积变形，也不修改原始 GLB 资产。
        initialRotationsRef.current.clear();
        initialScalesRef.current.clear();
        initialPositionsRef.current.clear();
        Object.values(bones).forEach(bone => {
          if (bone) {
            initialRotationsRef.current.set(bone, bone.rotation.clone());
            initialScalesRef.current.set(bone, bone.scale.clone());
            initialPositionsRef.current.set(bone, bone.position.clone());
          }
        });

        appearanceProbeRef.current = applyConfirmedAppearanceToModel(scene, profile);

        const blendMeshes = findBlendShapeMeshes(scene);
        blendMeshesRef.current = blendMeshes;

        blinkIndicesRef.current = [];
        emotionIndicesRef.current.clear();

        if (vrm?.expressionManager) {
          const exprMap = vrm.expressionManager.expressionMap;
          const exprNames = Object.keys(exprMap);
          for (const name of exprNames) {
            vrm.expressionManager.setValue(name, 0);
          }
        } else {
          const emotionShapeNames = ['happy', 'angry', 'sad', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'joy', 'sorrow', 'fun'];
          for (const mesh of blendMeshes) {
            const emotionMap = new Map<string, number>();
            for (const name of emotionShapeNames) {
              const idx = getBlendShapeIndex(mesh, [name]);
              if (idx >= 0) emotionMap.set(name, idx);
            }
            emotionIndicesRef.current.set(mesh, emotionMap);
            const blinkIdx = getBlendShapeIndex(mesh, ['blink', 'Blink', 'eye_close', 'mabataki']);
            if (blinkIdx >= 0) blinkIndicesRef.current.push({ mesh, idx: blinkIdx });
          }
        }

        scene.updateMatrixWorld(true);
        const preciseBox = computePreciseBoundingBox(scene);
        const preciseCenter = preciseBox.getCenter(new THREE.Vector3());

        // 水平居中：基于头部骨骼位置，避免马尾辫等不对称装饰导致视觉偏移
        let headCenterX = preciseCenter.x;
        let headBoneY = 0;
        if (bones.head) {
          const headWorldPos = new THREE.Vector3();
          bones.head.getWorldPosition(headWorldPos);
          headCenterX = headWorldPos.x;
          headBoneY = headWorldPos.y;
        }

        scene.position.x = -headCenterX;
        scene.position.z = -preciseCenter.z;
        scene.position.y = -preciseBox.min.y;

        scene.updateMatrixWorld(true);

        const finalBox = computePreciseBoundingBox(scene);
        const finalSize = finalBox.getSize(new THREE.Vector3());
        const finalCenter = finalBox.getCenter(new THREE.Vector3());

        // 重新计算居中后的头部中心X、头骨Y、肩膀Y、胸部Y
        let finalHeadCenterX = finalCenter.x;
        let finalHeadBoneY = headBoneY - preciseBox.min.y; // 场景Y偏移后
        let finalShoulderY = finalCenter.y;
        let finalChestY = finalCenter.y;

        if (bones.head) {
          const headWorldPos = new THREE.Vector3();
          bones.head.getWorldPosition(headWorldPos);
          finalHeadCenterX = headWorldPos.x;
          finalHeadBoneY = headWorldPos.y;
        }

        // 肩膀高度和宽度：收集肩部骨骼和上臂骨骼
        // 注意：不使用isLeft/isRight区分左右，因为角色面向相机时，
        // 角色的L(左)对应我们屏幕的+X(右)，R(右)对应-X(左)，直接用min/max即可
        const shoulderPositions: number[] = [];
        let shoulderLeftX = 0;
        let shoulderRightX = 0;
        let hasShoulderWidth = false;

        // 先收集所有肩部/上臂骨骼的Y高度（用于确定shoulderY）
        const allShoulderBones: THREE.Bone[] = [];
        const addShoulderBone = (bone: THREE.Bone | null) => {
          if (!bone) return;
          allShoulderBones.push(bone);
          const p = new THREE.Vector3();
          bone.getWorldPosition(p);
          shoulderPositions.push(p.y);
        };
        addShoulderBone(bones.leftShoulder);
        addShoulderBone(bones.rightShoulder);
        addShoulderBone(bones.leftUpperArm);
        addShoulderBone(bones.rightUpperArm);

        if (shoulderPositions.length > 0) {
          finalShoulderY = Math.max(...shoulderPositions);
        }

        // 肩宽：只使用Y高度接近shoulderY的骨骼（在±3cm范围内），避免用上臂中段/手肘计算
        const shoulderYEstimate = finalShoulderY;
        for (const bone of allShoulderBones) {
          const p = new THREE.Vector3();
          bone.getWorldPosition(p);
          if (Math.abs(p.y - shoulderYEstimate) > 0.03) continue; // 只取肩部附近
          if (!hasShoulderWidth) {
            shoulderLeftX = p.x;
            shoulderRightX = p.x;
            hasShoulderWidth = true;
          } else {
            shoulderLeftX = Math.min(shoulderLeftX, p.x);
            shoulderRightX = Math.max(shoulderRightX, p.x);
          }
        }

        let actualShoulderWidth = Math.abs(shoulderRightX - shoulderLeftX);
        if (actualShoulderWidth < 0.1 || !hasShoulderWidth) {
          // 回退：头骨宽度 × 2.2作为肩宽估算（VRoid动漫人物肩宽≈2.2倍头宽）
          const skullToTopFb = finalBox.max.y - finalHeadBoneY;
          actualShoulderWidth = skullToTopFb * 1.4 * 2.2;
        }

        if (shoulderPositions.length === 0) {
          // 回退：头骨下方约1.8倍头骨到头顶距离为肩膀（VRoid模型比例）
          const skullToTopFb = finalBox.max.y - finalHeadBoneY;
          finalShoulderY = finalHeadBoneY - skullToTopFb * 1.8;
        }

        // 胸部高度：使用chest骨骼位置
        if (bones.chest) {
          const p = new THREE.Vector3();
          bones.chest.getWorldPosition(p);
          finalChestY = p.y;
        } else if (bones.spine) {
          const p = new THREE.Vector3();
          bones.spine.getWorldPosition(p);
          finalChestY = p.y + (finalShoulderY - p.y) * 0.4;
        } else {
          const skullToTop = finalBox.max.y - finalHeadBoneY;
          finalChestY = finalShoulderY - skullToTop * 0.5;
        }

        const neutralPreset = EMOTION_PRESETS.get('neutral')!;
        motionRef.current.emotion.current = 'neutral';
        motionRef.current.emotion.currentWeights.clear();
        motionRef.current.emotion.targetWeights.clear();
        for (const { name, value } of neutralPreset.expressions) {
          motionRef.current.emotion.targetWeights.set(name, value);
          motionRef.current.emotion.currentWeights.set(name, value);
        }

        motionRef.current.growthWeights = growthTraitsToBlendShapes(profile.growthTraits);

        setModel(scene);
        reportAvatarLoad('model-mounted', { url });
        // 眼睛高度：优先使用眼球骨骼位置，fallback到估算
        let estimatedEyeY: number;
        const skullToTop = finalBox.max.y - finalHeadBoneY;
        if (bones.leftEye && bones.rightEye) {
          const lp = new THREE.Vector3();
          const rp = new THREE.Vector3();
          bones.leftEye.getWorldPosition(lp);
          bones.rightEye.getWorldPosition(rp);
          estimatedEyeY = (lp.y + rp.y) / 2;
        } else {
          // fallback: VRM head骨骼在头骨基部，眼睛在头部约45%处（从基部到头顶）
          estimatedEyeY = finalHeadBoneY + skullToTop * 0.45;
        }
        eyeYRef.current = estimatedEyeY;
        lookAtSmoothRef.current.set(0, estimatedEyeY, 0.8);

        onLoaded?.(finalSize, finalCenter, estimatedEyeY, finalHeadCenterX, finalHeadBoneY, finalShoulderY, finalChestY, actualShoulderWidth);
        reportAvatarLoad('ready', {
          url,
          size: { x: finalSize.x, y: finalSize.y, z: finalSize.z },
          center: { x: finalCenter.x, y: finalCenter.y, z: finalCenter.z },
        });
      } catch (error: unknown) {
        console.error('[VRM] Failed to load model:', url, error);
        reportAvatarLoad('error', {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!disposed) {
          const err = error instanceof Error ? error : new Error(String(error));
          setLoadError(err);
          onError?.(err);
        }
      }
    })();

    return () => {
      disposed = true;
      const overlay = fatigueOverlayRef.current;
      if (overlay) {
        overlay.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
        });
        overlay.removeFromParent();
      }
      for (const material of fatigueMaterialsRef.current) material.dispose();
      fatigueOverlayRef.current = null;
      fatigueMaterialsRef.current = [];
    };
  }, [url, onLoaded, onError]);

  // 用户确认的肤色/发色/服装色只作用于明确识别出的材质。
  // 每次都从首次缓存的原始材质颜色重新混合，避免热更新或多次保存造成颜色累积漂移。
  useEffect(() => {
    if (!model) return;
    appearanceProbeRef.current = applyConfirmedAppearanceToModel(model, profile);
  }, [
    model,
    profile.identity.skinMaterial.baseColor,
    profile.appearance.hairColor,
    profile.appearance.outfitColor,
  ]);

  // 成长痕迹只在growthTraits变化时重新计算（极低频）
  const traitsRef = useRef(profile.growthTraits);
  useEffect(() => {
    if (traitsRef.current !== profile.growthTraits) {
      traitsRef.current = profile.growthTraits;
      motionRef.current.growthWeights = growthTraitsToBlendShapes(profile.growthTraits);
    }
  }, [profile.growthTraits]);

  // 鼠标/指针追踪（驱动VRM LookAt视线跟随）
  useEffect(() => {
    const canvas = gl.domElement;
    if (!canvas || typeof (canvas as any).addEventListener !== 'function') return;
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const onPointerLeave = () => {
      mouseRef.current.x = 0;
      mouseRef.current.y = -0.08;
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [gl]);

  // 监听triggerAcknowledge变化，触发记录确认反应
  const lastAckTriggerRef = useRef(triggerAcknowledge ?? 0);
  useEffect(() => {
    if (triggerAcknowledge && triggerAcknowledge !== lastAckTriggerRef.current) {
      lastAckTriggerRef.current = triggerAcknowledge;
      const state = motionRef.current;
      state.acknowledge.active = true;
      state.acknowledge.progress = 0;
      state.acknowledge.duration = 0.9;
    }
  }, [triggerAcknowledge]);

  // 监听triggerTouchReaction变化，触发触摸反应（外部点击舞台时）
  const lastTouchTriggerRef = useRef(triggerTouchReaction ?? 0);
  useEffect(() => {
    if (triggerTouchReaction && triggerTouchReaction !== lastTouchTriggerRef.current) {
      lastTouchTriggerRef.current = triggerTouchReaction;
      const state = motionRef.current;
      state.touch.active = true;
      state.touch.progress = 0;
      state.touch.duration = 0.5;
      state.touch.headTiltDir = (Math.random() > 0.5 ? 1 : -1);
      state.touch.bodyPart = 'body';
    }
  }, [triggerTouchReaction]);

  /** 通过射线检测判定点击的身体部位 */
  const detectBodyPart = (screenX: number, screenY: number): 'head' | 'leftArm' | 'rightArm' | 'body' => {
    if (!model || !camera) return 'body';
    const raycaster = raycasterRef.current;
    const mouse = new THREE.Vector2(screenX, screenY);
    raycaster.setFromCamera(mouse, camera as THREE.PerspectiveCamera);
    const intersects = raycaster.intersectObject(model, true);
    if (intersects.length === 0) return 'body';

    const hit = intersects[0];
    const hitPoint = hit.point;
    const eyeY = eyeYRef.current;
    const shoulderY = (() => {
      // 估算肩膀Y：在眼睛下方约0.22m处（VRoid模型比例）
      const shoulderPositions: number[] = [];
      const bones = bonesRef.current;
      [bones.leftUpperArm, bones.rightUpperArm, bones.leftShoulder, bones.rightShoulder].forEach(b => {
        if (b) {
          const p = new THREE.Vector3();
          b.getWorldPosition(p);
          shoulderPositions.push(p.y);
        }
      });
      return shoulderPositions.length > 0 ? Math.max(...shoulderPositions) : eyeY - 0.22;
    })();

    // 头部区域：Y > shoulderY 且在中央附近
    if (hitPoint.y > shoulderY + 0.05) {
      return 'head';
    }
    // 手臂区域：X偏移较大（角色面向-Z，角色左=屏幕右=+X，角色右=屏幕左=-X）
    // 注意：模型已旋转180度面朝相机，所以这里需要反向
    if (Math.abs(hitPoint.x) > 0.15 && hitPoint.y < eyeY - 0.05) {
      return hitPoint.x > 0 ? 'leftArm' : 'rightArm';
    }
    return 'body';
  };

  useFrame((_, delta) => {
    if (!groupRef.current || !model || paused) return;

    const state = motionRef.current;
    const pose = deriveRuntimePose(profile);
    const identityGeometry = deriveAvatarIdentityGeometry(profile);
    const ts = pose.timeScale;

    // 用户确认的基础体格与生活数据临时体型变化分层叠加：
    // identityGeometry.bodyScaleXZ 是稳定身体框架，pose.bodyScaleXZ 是会衰减的临时状态。
    // shoulderWidth 不再通过整个 group 缩放实现，避免连头部一起被拉宽。
    const scaleBlend = 1 - Math.exp(-2.4 * Math.min(delta, 0.05));
    const bodyWidthTarget = pose.bodyScaleXZ * identityGeometry.bodyScaleXZ;
    groupRef.current.scale.x += (bodyWidthTarget - groupRef.current.scale.x) * scaleBlend;
    groupRef.current.scale.z += (bodyWidthTarget - groupRef.current.scale.z) * scaleBlend;
    groupRef.current.scale.y += (identityGeometry.bodyScaleY - groupRef.current.scale.y) * scaleBlend;
    for (const material of fatigueMaterialsRef.current) {
      material.opacity += (pose.darkCircleOpacity - material.opacity) * scaleBlend;
    }

    state.elapsed += delta * ts;
    const dt = Math.min(delta * ts, 0.05);

    const eyes = state.eyes;
    const vrm = vrmRef.current;

    /* ───── -1. 检测新点击：raycast判定身体部位，触发差异化触摸反应 ───── */
    if (tapTriggerRef && tapTriggerRef.current !== lastHandledTapRef.current) {
      lastHandledTapRef.current = tapTriggerRef.current;
      // 从tapScreenPosRef获取点击坐标，进行射线检测
      let bodyPart: 'head' | 'leftArm' | 'rightArm' | 'body' = 'body';
      if (tapScreenPosRef) {
        bodyPart = detectBodyPart(tapScreenPosRef.current.x, tapScreenPosRef.current.y);
      }
      // 初始化触摸反应
      state.touch.active = true;
      state.touch.progress = 0;
      state.touch.duration = bodyPart === 'head' ? 0.7 : bodyPart.includes('Arm') ? 0.55 : 0.5;
      state.touch.headTiltDir = bodyPart === 'head' ? (Math.random() > 0.5 ? 1 : -1) : (bodyPart === 'leftArm' ? 1 : -1);
      state.touch.bodyPart = bodyPart;
    }

    /* ───── 0. 更新LookAt目标位置（平滑追踪鼠标+自然眼跳微抖动） ───── */
    const mouse = mouseRef.current;
    // 微抖动（自然注视不稳定 · 叠加在鼠标追踪之上）
    if (!eyes.isSaccading && state.elapsed >= eyes.nextSaccadeAt) {
      eyes.isSaccading = true;
      eyes.saccadeProgress = 0;
      eyes.saccadeDuration = 0.06 + Math.random() * 0.06;
      eyes.startX = eyes.currentX;
      eyes.startY = eyes.currentY;
      if (Math.random() < 0.35) {
        // 偶尔回到正视前方
        eyes.targetX = 0;
        eyes.targetY = 0;
      } else {
        const saccadeMaxX = pose.gazeAmplitude * 0.3;
        const saccadeMaxY = pose.gazeAmplitude * 0.18;
        eyes.targetX = (Math.random() * 2 - 1) * saccadeMaxX;
        eyes.targetY = (Math.random() * 2 - 1) * saccadeMaxY;
      }
    }
    if (eyes.isSaccading) {
      eyes.saccadeProgress += dt / eyes.saccadeDuration;
      if (eyes.saccadeProgress >= 1) {
        eyes.saccadeProgress = 1;
        eyes.isSaccading = false;
        eyes.currentX = eyes.targetX;
        eyes.currentY = eyes.targetY;
        eyes.nextSaccadeAt = state.elapsed + randomSaccadeInterval();
      } else {
        // 快速眼跳（saccade）：使用easeOutCubic曲线，眼球运动开始快结束慢
        const t = 1 - Math.pow(1 - eyes.saccadeProgress, 3);
        eyes.currentX = eyes.startX + (eyes.targetX - eyes.startX) * t;
        eyes.currentY = eyes.startY + (eyes.targetY - eyes.startY) * t;
      }
    } else {
      // 注视时的微小漂移（microsaccades/tremor），极其细微
      const drift = 0.0003 * dt * 60;
      eyes.currentX += (Math.random() - 0.5) * drift;
      eyes.currentY += (Math.random() - 0.5) * drift;
    }

    // LookAt目标：鼠标位置 + 眼跳偏移，视线活跃度gazeAmplitude控制鼠标追踪强度
    const mouseFollowStrength = 0.4 + pose.gazeAmplitude * 2.0; // 0.4~0.6
    const targetX = mouse.x * mouseFollowStrength + eyes.currentX;
    // 眼睛默认略向下看（自然状态不直视），鼠标Y偏移幅度较小
    const targetY = eyeYRef.current + mouse.y * 0.15 + eyes.currentY * 0.5;
    const tgtPos = lookAtTargetPosRef.current.set(targetX, targetY, 0.8);
    // 平滑插值（自然追随，不僵硬）：lerp系数根据距离自适应
    const smoothFactor = 1 - Math.exp(-6 * dt);
    lookAtSmoothRef.current.lerp(tgtPos, smoothFactor);
    lookAtTargetRef.current.position.copy(lookAtSmoothRef.current);
    lookAtTargetRef.current.updateMatrixWorld(true);

    const { leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm, leftShoulder, rightShoulder, spine, chest, head, neck, leftEye, rightEye } = bonesRef.current;
    const initialRots = initialRotationsRef.current;

    /* ───── 1. 呼吸相位提前计算（供表情和骨骼动画共用） ───── */
    const breathRate = 1.2 + (pose.effectiveTension - 0.5) * 0.6;
    const breathDepth = 0.008 - (pose.effectiveTension - 0.5) * 0.003 + (0.5 - pose.effectiveEnergy) * 0.002;
    state.breathPhase += dt * breathRate;
    const breathAmount = Math.sin(state.breathPhase) * 0.5 + 0.5;
    const breathSin = Math.sin(state.breathPhase);

    /* ───── 2. 情绪状态机 + 嘴部微动 + 成长痕迹 + 嘴角状态（统一表情计算） ───── */
    const targetEmotion = deriveEmotionFromState({
      ...profile.dailyState,
      energy: pose.effectiveEnergy,
      tension: pose.effectiveTension,
    });
    const emo = state.emotion;

    // VRM表情名称映射（我们的名称 → VRM expressionManager名称）
    const vrmExprMap: Record<string, string> = {
      happy: 'happy', relaxed: 'relaxed', angry: 'angry', sad: 'sad',
      surprised: 'Surprised', joy: 'happy', sorrow: 'sad', fun: 'happy',
    };

    if (targetEmotion !== emo.current && !emo.isTransitioning) {
      const preset = EMOTION_PRESETS.get(targetEmotion);
      if (preset) {
        emo.isTransitioning = true;
        emo.transitionProgress = 0;
        emo.blendDuration = preset.blendDuration;
        emo.currentWeights.clear();

        // 借鉴AIRI：从VRM expressionManager捕获当前实际表情值作为过渡起点
        // 这样即使有嘴部微动/成长痕迹/眨眼等叠加值，过渡也从当前显示状态平滑开始
        if (vrm?.expressionManager) {
          const exprMap = vrm.expressionManager.expressionMap;
          for (const name of Object.keys(exprMap)) {
            const cur = vrm.expressionManager.getValue(name) || 0;
            if (cur > 0.001) emo.currentWeights.set(name, cur);
          }
        } else {
          // 非VRM模式：从morphTarget读取当前值
          for (const mesh of blendMeshesRef.current) {
            const emoMap = emotionIndicesRef.current.get(mesh);
            if (!emoMap || !mesh.morphTargetInfluences) continue;
            for (const [name, idx] of emoMap) {
              const cur = mesh.morphTargetInfluences[idx] || 0;
              if (cur > 0.001) emo.currentWeights.set(name, cur);
            }
          }
          // 同时保留上一帧的targetWeights中仍>0的值
          for (const [name, w] of emo.targetWeights) {
            if (w > 0.001 && !emo.currentWeights.has(name)) emo.currentWeights.set(name, w);
          }
        }

        emo.targetWeights.clear();
        for (const { name, value } of preset.expressions) emo.targetWeights.set(name, value);
        emo.current = targetEmotion;
      }
    }

    // 计算嘴部自然微动（与呼吸同步 · 极其细微）
    const mouthBreathOpen = Math.max(0, breathSin) * 0.5;
    const tensionMod = 1 - pose.effectiveTension * 0.6;
    const energyMod = 1 + (0.5 - pose.effectiveEnergy) * 0.2;
    const mouthBaseAmp = 0.025 * tensionMod * energyMod;
    const mouthOpenAmount = mouthBreathOpen * mouthBaseAmp;
    const swallowCycle = Math.sin(state.elapsed * 0.15) * Math.sin(state.elapsed * 0.07);
    const swallowTrigger = swallowCycle > 0.92 ? (swallowCycle - 0.92) / 0.08 : 0;
    const mouthSwallow = swallowTrigger * 0.015;
    const mouthMicroNoise = Math.sin(state.elapsed * 0.8) * Math.sin(state.elapsed * 1.9) * 0.004;
    const finalMouthAmp = clamp01(mouthOpenAmount + mouthSwallow + mouthMicroNoise);

    // 嘴角放松度：疲惫时略微下垂，精力好时略微上扬（极微弱，≤2%）
    const mouthCornerLift = (pose.effectiveEnergy - 0.5) * 0.02 - (pose.effectiveTension - 0.5) * 0.01;

    // 统一计算所有表情权重（情绪 + 成长痕迹 + 嘴部微动 + 嘴角状态）
    const computeFinalWeight = (name: string, emoBase: number): number => {
      let w = emoBase;
      w += state.growthWeights.get(name) ?? 0;
      if (name === 'aa') w += finalMouthAmp;
      if (name === 'happy' && mouthCornerLift > 0) w += mouthCornerLift;
      if (name === 'sad' && mouthCornerLift < 0) w += Math.abs(mouthCornerLift);
      if (name === 'sad' && profile.permissions.lifeDataAdaptation) {
        w += (profile.adaptiveAppearance?.recoveryNeed ?? 0) * 0.035;
      }
      return clamp01(w);
    };

    if (emo.isTransitioning) {
      emo.transitionProgress += dt / emo.blendDuration;
      if (emo.transitionProgress >= 1) {
        emo.transitionProgress = 1;
        emo.isTransitioning = false;
      }
      const t = easeInOutCubic(emo.transitionProgress);

      if (vrm?.expressionManager) {
        // 收集所有需要设置的表情名称（情绪 + aa嘴型 + 成长痕迹涉及的表情）
        const allNames = new Set<string>([...emo.targetWeights.keys(), 'aa', 'blink']);
        for (const name of state.growthWeights.keys()) allNames.add(name);
        if (mouthCornerLift > 0) allNames.add('happy');
        if (mouthCornerLift < 0) allNames.add('sad');

        for (const name of allNames) {
          if (name === 'blink') continue; // blink单独处理
          const from = emo.currentWeights.get(name) ?? 0;
          const to = emo.targetWeights.get(name) ?? 0;
          const emoBlend = from + (to - from) * t;
          const finalW = computeFinalWeight(name, emoBlend);
          const vrmName = vrmExprMap[name] ?? name;
          vrm.expressionManager.setValue(vrmName, finalW);
        }
      } else {
        for (const mesh of blendMeshesRef.current) {
          const emoMap = emotionIndicesRef.current.get(mesh);
          if (!emoMap || !mesh.morphTargetInfluences) continue;
          for (const [name, idx] of emoMap) {
            if (name === 'blink') continue;
            const from = emo.currentWeights.get(name) ?? 0;
            const to = emo.targetWeights.get(name) ?? 0;
            mesh.morphTargetInfluences[idx] = computeFinalWeight(name, from + (to - from) * t);
          }
        }
      }
    } else {
      if (vrm?.expressionManager) {
        const allNames = new Set<string>([...emo.targetWeights.keys(), 'aa']);
        for (const name of state.growthWeights.keys()) allNames.add(name);
        if (mouthCornerLift > 0) allNames.add('happy');
        if (mouthCornerLift < 0) allNames.add('sad');

        for (const name of allNames) {
          const vrmName = vrmExprMap[name] ?? name;
          vrm.expressionManager.setValue(vrmName, computeFinalWeight(name, emo.targetWeights.get(name) ?? 0));
        }
      } else {
        for (const mesh of blendMeshesRef.current) {
          const emoMap = emotionIndicesRef.current.get(mesh);
          if (!emoMap || !mesh.morphTargetInfluences) continue;
          for (const [name, idx] of emoMap) {
            if (name === 'blink') continue;
            mesh.morphTargetInfluences[idx] = computeFinalWeight(name, emo.targetWeights.get(name) ?? 0);
          }
        }
      }
    }

    /* ───── 3. 眨眼动画（AIRI风格非对称生物曲线） ─────
     * 三阶段：快闭(easeOutQuart, 65-85ms) → 短暂闭合(10-30ms) → 慢睁(easeInOutCubic, 150-230ms)
     * 比对称正弦曲线更自然，符合真实人类眨眼生物力学
     */
    const blinkBaseInterval = 3.0;
    const focusFactor = profile.dailyState.focus > 0.7 ? 1.4 : 1.0;
    const tensionFactor = pose.effectiveTension > 0.65 ? 0.75 : 1.0;
    const blinkInterval = blinkBaseInterval * focusFactor * tensionFactor;

    if (!state.blinkActive && state.elapsed >= state.nextBlinkTime) {
      state.blinkActive = true;
      state.blinkPhase = 'closing';
      state.blinkProgress = 0;
      // 随机化各阶段时长（避免机械感）
      state.blinkCloseDuration = (0.065 + Math.random() * 0.02) / ts;
      state.blinkHoldDuration = (0.01 + Math.random() * 0.02) / ts;
      state.blinkOpenDuration = (0.15 + Math.random() * 0.08) / ts;
    }

    let blinkAmount = 0;
    if (state.blinkActive) {
      const totalDur = state.blinkCloseDuration + state.blinkHoldDuration + state.blinkOpenDuration;
      state.blinkProgress += dt;

      if (state.blinkPhase === 'closing') {
        const t = Math.min(1, state.blinkProgress / state.blinkCloseDuration);
        // easeOutQuart：快速闭眼
        blinkAmount = 1 - Math.pow(1 - t, 4);
        if (t >= 1) {
          state.blinkPhase = 'closed';
          state.blinkProgress = 0;
        }
      } else if (state.blinkPhase === 'closed') {
        blinkAmount = 1;
        state.blinkProgress += dt;
        if (state.blinkProgress >= state.blinkHoldDuration) {
          state.blinkPhase = 'opening';
          state.blinkProgress = 0;
        }
      } else if (state.blinkPhase === 'opening') {
        const t = Math.min(1, state.blinkProgress / state.blinkOpenDuration);
        // easeInOutCubic：缓慢睁眼
        blinkAmount = t < 0.5
          ? 1 - 4 * t * t * t
          : 1 - (1 - Math.pow(-2 * t + 2, 3) / 2);
        if (t >= 1) {
          state.blinkActive = false;
          state.blinkProgress = 0;
          state.nextBlinkTime = state.elapsed + (1.0 + Math.random() * blinkInterval);
        }
      }
      blinkAmount = Math.max(0, Math.min(1, blinkAmount));
    }

    if (vrm?.expressionManager) {
      vrm.expressionManager.setValue('blink', blinkAmount);
    } else {
      for (const { mesh, idx } of blinkIndicesRef.current) {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = blinkAmount;
      }
    }

    /* ───── 4. VRM系统更新（lookAt+表情应用+骨骼重置到T-pose+SpringBone头发物理） ───── */
    if (vrm) {
      vrm.update(delta);
      // SpringBone头发弹簧骨骼物理更新（VRM标准头发/饰品物理）
      if (vrm.springBoneManager) {
        vrm.springBoneManager.update(delta);
      }
    }

    // VRM.update 可能会重置标准骨骼，因此在其后应用用户已确认的身份几何。
    // 头部先抵消身体 group 的世界缩放，再叠加脸宽/脸长，保证体格与肩宽不会偷改脸。
    if (head) {
      const baseScale = initialScalesRef.current.get(head);
      if (baseScale) {
        const compensated = deriveCompensatedHeadLocalScale(identityGeometry, groupRef.current.scale);
        head.scale.x = baseScale.x * compensated.x;
        head.scale.y = baseScale.y * compensated.y;
        head.scale.z = baseScale.z * compensated.z;
      }
    }

    // 肩宽使用真实肩骨横向位置；模型没有独立 shoulder bone 时回退到 upperArm 根节点。
    // 只改变局部 X 位置，Y/Z 保持生产模型基线，避免把肩宽伪装成全身横向缩放。
    const shoulderRoots = [
      leftShoulder ?? leftUpperArm,
      rightShoulder ?? rightUpperArm,
    ];
    for (const bone of shoulderRoots) {
      if (!bone) continue;
      const basePosition = initialPositionsRef.current.get(bone);
      if (!basePosition) continue;
      bone.position.x = basePosition.x * identityGeometry.shoulderSpread;
      bone.position.y = basePosition.y;
      bone.position.z = basePosition.z;
    }

    /* ───── 4. 非VRM模型眼球控制（VRM模型由lookAt系统自动控制） ───── */
    if (!vrm?.lookAt) {
      const applyEyeRot = (eye: THREE.Bone | null) => {
        if (!eye) return;
        const init = initialRots.get(eye);
        if (!init) return;
        eye.rotation.y = init.y + eyes.currentX;
        eye.rotation.x = init.x + eyes.currentY;
      };
      applyEyeRot(leftEye);
      applyEyeRot(rightEye);
    }

    /* ───── 5. 呼吸骨骼动画（覆盖VRM T-pose重置，breathAmount/breathDepth已提前计算） ───── */
    const spineAdjust = pose.spineRelax;

    // 肩膀紧张度表达
    const shoulderTension = pose.effectiveTension > 0.5 ? (pose.effectiveTension - 0.5) * 0.04 : 0;
    if (leftShoulder && initialRots.has(leftShoulder)) {
      const init = initialRots.get(leftShoulder)!;
      leftShoulder.rotation.z = init.z - shoulderTension;
    }
    if (rightShoulder && initialRots.has(rightShoulder)) {
      const init = initialRots.get(rightShoulder)!;
      rightShoulder.rotation.z = init.z + shoulderTension;
    }
    // 上臂：在A-pose基础上叠加呼吸微动和紧张度
    if (leftUpperArm && initialRots.has(leftUpperArm)) {
      const init = initialRots.get(leftUpperArm)!;
      leftUpperArm.rotation.x = init.x + breathAmount * 0.008 - shoulderTension * 0.5;
      leftUpperArm.rotation.z = init.z + shoulderTension * 0.3;
    }
    if (rightUpperArm && initialRots.has(rightUpperArm)) {
      const init = initialRots.get(rightUpperArm)!;
      rightUpperArm.rotation.x = init.x + breathAmount * 0.008 - shoulderTension * 0.5;
      rightUpperArm.rotation.z = init.z - shoulderTension * 0.3;
    }
    // 前臂：呼吸时轻微起伏
    if (leftLowerArm && initialRots.has(leftLowerArm)) {
      const init = initialRots.get(leftLowerArm)!;
      leftLowerArm.rotation.x = init.x + breathAmount * 0.006;
    }
    if (rightLowerArm && initialRots.has(rightLowerArm)) {
      const init = initialRots.get(rightLowerArm)!;
      rightLowerArm.rotation.x = init.x + breathAmount * 0.006;
    }

    /* ───── 6. 头部微动 + 触摸/确认反应（差异化身体部位反应） ───── */
    state.headSwayPhase += dt * 0.35 * ts;
    state.headNodPhase += dt * 0.25 * ts;

    // 触摸反应进度
    let touchTilt = 0;
    let touchNod = 0;
    let touchScale = 1;
    /** 手臂触摸反应：轻微抬起 */
    let touchArmLiftL = 0;
    let touchArmLiftR = 0;
    if (state.touch.active) {
      state.touch.progress += dt / state.touch.duration;
      if (state.touch.progress >= 1) {
        state.touch.active = false;
        state.touch.progress = 0;
        state.touch.bodyPart = 'none';
      } else {
        const tp = state.touch.progress;
        const bp = state.touch.bodyPart;

        if (bp === 'head') {
          // 摸头：更大幅度的歪头+小幅度前后点头（开心反应）
          const tiltEase = tp < 0.35
            ? (tp / 0.35) * 0.14
            : 0.14 * (1 - Math.pow((tp - 0.35) / 0.65, 1.5));
          touchTilt = state.touch.headTiltDir * tiltEase;
          // 小幅度上下点（蹭手的感觉）
          const nodCycle = Math.sin(tp * Math.PI * 2) * 0.03;
          touchNod = tp < 0.2 ? -0.02 * (tp / 0.2) : (tp < 0.7 ? -0.02 + nodCycle * (0.7 - tp) / 0.5 : -0.02 * (1 - tp) / 0.3);
          touchScale = 1 + (tp < 0.2 ? 0.012 * (tp / 0.2) : 0.012 * (1 - (tp - 0.2) / 0.8));
        } else if (bp === 'leftArm' || bp === 'rightArm') {
          // 摸手臂：被摸侧手臂轻微动一下，头部微转
          const liftEase = tp < 0.3
            ? (tp / 0.3) * 0.06
            : 0.06 * (1 - Math.pow((tp - 0.3) / 0.7, 2));
          if (bp === 'leftArm') touchArmLiftL = liftEase;
          else touchArmLiftR = liftEase;
          // 头部微转向被摸的一侧
          touchTilt = state.touch.headTiltDir * 0.04 * (tp < 0.4 ? tp / 0.4 : (1 - tp) / 0.6);
          touchNod = 0.01 * (tp < 0.3 ? tp / 0.3 : (1 - tp) / 0.7);
        } else {
          // 身体/其他：普通轻点反应
          const tiltEase = tp < 0.3
            ? (tp / 0.3) * 0.08
            : 0.08 * (1 - Math.pow((tp - 0.3) / 0.7, 2));
          touchTilt = state.touch.headTiltDir * tiltEase;
          touchNod = tp < 0.2 ? -0.04 * (tp / 0.2) : -0.04 * (1 - (tp - 0.2) / 0.8);
          touchScale = 1 + (tp < 0.15 ? 0.008 * (tp / 0.15) : 0.008 * (1 - (tp - 0.15) / 0.85));
        }
      }
    }

    // 记录确认反应（轻微舒展+点头，表示"收到了"）
    let ackNod = 0;
    let ackSpineRelax = 0;
    if (state.acknowledge.active) {
      state.acknowledge.progress += dt / state.acknowledge.duration;
      if (state.acknowledge.progress >= 1) {
        state.acknowledge.active = false;
        state.acknowledge.progress = 0;
      } else {
        const ap = state.acknowledge.progress;
        // 轻微点头两次（慢-快-慢）
        if (ap < 0.35) {
          ackNod = -Math.sin((ap / 0.35) * Math.PI) * 0.06;
        } else if (ap < 0.65) {
          ackNod = -Math.sin(((ap - 0.35) / 0.30) * Math.PI * 0.8) * 0.04;
        }
        // 脊柱舒展（姿态打开，表明确认）
        ackSpineRelax = ap < 0.5 ? (ap / 0.5) * 0.05 : 0.05 * (1 - (ap - 0.5) / 0.5);
      }
    }

    const swayScale = clamp01(pose.gazeAmplitude / 0.10);
    const swayAmount = Math.sin(state.headSwayPhase) * 0.015 * swayScale;
    const nodAmount = Math.sin(state.headNodPhase) * 0.008 * swayScale;

    if (head && initialRots.has(head)) {
      const init = initialRots.get(head)!;
      head.rotation.y = init.y + swayAmount + touchTilt;
      head.rotation.x = init.x + nodAmount - spineAdjust * 0.2 + touchNod + ackNod;

      // 自然动作只能在已确认身份几何上做临时微扰，不能用 setScalar()
      // 抹掉同一帧前面已经应用的脸宽/脸长。这里重新从不可变基线计算最终尺度。
      const baseScale = initialScalesRef.current.get(head);
      if (baseScale) {
        const compensated = deriveCompensatedHeadLocalScale(identityGeometry, groupRef.current.scale);
        head.scale.set(
          baseScale.x * compensated.x * touchScale,
          baseScale.y * compensated.y * touchScale,
          baseScale.z * compensated.z * touchScale,
        );
      }
    } else if (neck && initialRots.has(neck)) {
      const init = initialRots.get(neck)!;
      neck.rotation.y = init.y + (swayAmount + touchTilt) * 0.7;
      neck.rotation.x = init.x + (nodAmount - spineAdjust * 0.15 + touchNod + ackNod) * 0.5;
    }

    // 脊柱/胸部：呼吸起伏 + spineRelax姿态 + 确认反应舒展
    if (chest && initialRots.has(chest)) {
      const init = initialRots.get(chest)!;
      chest.rotation.x = init.x + breathAmount * breathDepth * 0.5 - (spineAdjust + ackSpineRelax) * 0.4;
      chest.rotation.z = init.z + Math.sin(state.breathPhase * 0.5) * breathDepth * 0.2;
    }
    if (spine && initialRots.has(spine)) {
      const init = initialRots.get(spine)!;
      spine.rotation.x = init.x + breathAmount * breathDepth * 0.3 - (spineAdjust + ackSpineRelax) * 0.6;
    }

    // 浏览器诊断只报告 renderer 已经实际应用后的 Three.js 世界变换与材质结果。
    // Playwright 用它证明“控件值变化”确实穿过正式 VRM 渲染链，而不是只改 store/UI。
    const now = performance.now();
    if (now - lastRuntimeProbeAtRef.current >= 80) {
      lastRuntimeProbeAtRef.current = now;
      groupRef.current.updateMatrixWorld(true);
      model.updateMatrixWorld(true);

      const headLocalScale = head ? head.scale : null;
      const headWorldScale = head ? head.getWorldScale(new THREE.Vector3()) : null;
      const activeShoulderRoots = [leftShoulder ?? leftUpperArm, rightShoulder ?? rightUpperArm].filter(
        (bone): bone is THREE.Bone => Boolean(bone),
      );
      let shoulderWorldDistance: number | undefined;
      if (activeShoulderRoots.length === 2) {
        const left = activeShoulderRoots[0].getWorldPosition(new THREE.Vector3());
        const right = activeShoulderRoots[1].getWorldPosition(new THREE.Vector3());
        shoulderWorldDistance = left.distanceTo(right);
      }
      const face = profile.identity.faceMorphs ?? {};
      const body = profile.identity.bodyMorphs ?? {};
      reportAvatarRuntimeProbe({
        updatedAt: Date.now(),
        identity: {
          faceWidth: face.faceWidth ?? 0.5,
          faceHeight: face.faceHeight ?? 0.5,
          jawRoundness: face.jawRoundness ?? 0.5,
          eyeSize: face.eyeSize ?? 0.5,
          eyeSpacing: face.eyeSpacing ?? 0.5,
          browAngle: face.browAngle ?? 0.5,
          noseSize: face.noseSize ?? 0.5,
          mouthWidth: face.mouthWidth ?? 0.5,
          bodyScale: body.bodyScale ?? 0.5,
          shoulderWidth: body.shoulderWidth ?? 0.5,
        },
        geometry: {
          groupScale: {
            x: groupRef.current.scale.x,
            y: groupRef.current.scale.y,
            z: groupRef.current.scale.z,
          },
          headLocalScale: headLocalScale ? {
            x: headLocalScale.x,
            y: headLocalScale.y,
            z: headLocalScale.z,
          } : undefined,
          headWorldScale: headWorldScale ? {
            x: headWorldScale.x,
            y: headWorldScale.y,
            z: headWorldScale.z,
          } : undefined,
          shoulderRootNames: activeShoulderRoots.map((bone) => bone.name),
          shoulderWorldDistance,
        },
        appearance: appearanceProbeRef.current,
      });
    }
  });

  if (loadError) {
    return null;
  }

  if (!model) return null;

  const staticPose = deriveRuntimePose(profile);
  return (
    <group ref={groupRef} scale={[staticPose.bodyScaleXZ, 1, staticPose.bodyScaleXZ]}>
      <primitive object={model} />
    </group>
  );
}

/* ───────────── Loading Fallback ───────────── */
function LoadingFallback() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.8;
  });
  return (
    <mesh ref={ref} position={[0, 0.3, 0]}>
      <torusGeometry args={[0.12, 0.035, 16, 32]} />
      <meshStandardMaterial color="#8b7fcf" emissive="#4f46a5" emissiveIntensity={0.3} />
    </mesh>
  );
}

/* ───────────── 完整轨道相机控制器 ─────────────
 * 交互方式：
 *   - 鼠标左键拖拽 / 单指滑动：旋转（环绕目标点）
 *   - 滚轮 / 双指捏合：缩放
 *   - 鼠标右键拖拽 / 双指滑动：平移（移动目标点）
 *   - 双击：重置到默认胸像构图
 *
 * 球坐标系统：
 *   - spherical: { theta(方位角), phi(极角), radius(距离) }  相机相对于target的位置
 *   - target: 轨道中心（平移时移动，默认眼睛位置）
 *   - 约束：phi ∈ [5°, 175°]，radius ∈ [0.3×base, 3.5×base]
 *
 * 移动端手势区分：
 *   - 单指：检测移动距离>5px为旋转，<8px+<500ms为点击（触发onPress）
 *   - 双指：两指距离变化→缩放，中心位移→平移
 */

interface OrbitState {
  /** 方位角（水平旋转，弧度），0=正前方(相机在+Z看向-Z)，正=顺时针 */
  theta: number;
  /** 极角（垂直旋转，弧度），0=正上方，π/2=正前方，π=正下方 */
  phi: number;
  /** 相机到target的距离 */
  radius: number;
  /** 轨道中心（target/lookAt点） */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** 是否已经由自动构图初始化过 */
  initialized: boolean;
  /** 强制重置信号（CameraRig设置此值+1来通知OrbitControls立即同步target） */
  resetSignal: number;
  /** 强制重置的目标值 */
  resetTheta: number;
  resetPhi: number;
  resetRadius: number;
  resetTargetX: number;
  resetTargetY: number;
  resetTargetZ: number;
  /** 强制重新初始化构图信号（外部+1来通知CameraRig重新计算初始构图参数） */
  reinitSignal: number;
}

function CameraOrbitControls({ orbitRef, modelInfoRef, tapTriggerRef, tapScreenPosRef }: {
  orbitRef: React.MutableRefObject<OrbitState>;
  modelInfoRef: React.MutableRefObject<{
    size: THREE.Vector3; center: THREE.Vector3; headY: number;
    headCenterX: number; headBoneY: number; shoulderY: number; chestY: number;
    shoulderWidth: number;
  } | null>;
  tapTriggerRef: React.MutableRefObject<number>;
  tapScreenPosRef?: React.MutableRefObject<{ x: number; y: number }>;
}) {
  const { gl } = useThree();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const canvas = gl.domElement as HTMLElement;
    if (!canvas) return;

    // ─── 缩放参数 ───
    const MIN_RADIUS_FACTOR = 0.25;  // 更近：面部特写
    const MAX_RADIUS_FACTOR = 7.0;   // 更远：全身视图（7倍基础距离足够看到完整角色）
    const ZOOM_SPEED = 0.0015;
    const ROTATE_SPEED = 0.0065;
    const PAN_SPEED = 0.002;
    const DAMPING = 0.15; // 阻尼平滑因子（0.15：跟手且不生硬）

    // ─── 鼠标状态 ───
    let isDragging = false;
    let dragButton = -1; // 0=左键(旋转), 2=右键(平移)
    let lastX = 0;
    let lastY = 0;
    let mouseDownX = 0;
    let mouseDownY = 0;
    let mouseDownTime = 0;
    let hasDragged = false; // 本次按下是否发生了拖拽（用于区分点击和拖拽）

    // ─── 触摸状态 ───
    let touchMode: 'none' | 'rotate' | 'pinch' | 'pan' = 'none';
    let initialPinchDist = 0;
    let initialPinchRadius = 0;
    let lastSingleTouchX = 0;
    let lastSingleTouchY = 0;
    let lastPinchCenterX = 0;
    let lastPinchCenterY = 0;
    let lastTapTime = 0;
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;

    // ─── 目标值（用于阻尼插值，orbitRef.current是当前值） ───
    const target = {
      theta: 0,
      phi: Math.PI / 2,
      radius: 1.5,
      targetX: 0,
      targetY: 1.4,
      targetZ: 0,
    };

    const applyDamping = () => {
      const o = orbitRef.current;
      o.theta += (target.theta - o.theta) * DAMPING;
      o.phi += (target.phi - o.phi) * DAMPING;
      o.radius += (target.radius - o.radius) * DAMPING;
      o.targetX += (target.targetX - o.targetX) * DAMPING;
      o.targetY += (target.targetY - o.targetY) * DAMPING;
      o.targetZ += (target.targetZ - o.targetZ) * DAMPING;
    };

    const getBaseRadius = () => {
      const info = modelInfoRef.current;
      if (!info) return 1.5;
      // 返回初始构图计算出的baseDistance
      return cameraDefaults.distance;
    };

    const getBaseTarget = (): [number, number, number] => {
      const info = modelInfoRef.current;
      if (!info) return [0, 1.4, 0];
      return [
        cameraDefaults.targetX ?? info.headCenterX,
        cameraDefaults.targetY ?? info.headY,
        0,
      ];
    };

    const clampRadius = (r: number): number => {
      const base = getBaseRadius();
      return Math.max(base * MIN_RADIUS_FACTOR, Math.min(base * MAX_RADIUS_FACTOR, r));
    };

    const resetOrbit = () => {
      // 只触发reinitSignal强制CameraRig重新计算构图参数，
      // CameraRig计算完成后会自动触发resetSignal用新参数重置位置
      orbitRef.current.reinitSignal++;
    };

    // ─── 鼠标事件 ───
    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      dragButton = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
      mouseDownTime = Date.now();
      hasDragged = false;
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      const totalDx = e.clientX - mouseDownX;
      const totalDy = e.clientY - mouseDownY;
      if (totalDx * totalDx + totalDy * totalDy > 25) hasDragged = true;

      if (dragButton === 0) {
        target.theta -= dx * ROTATE_SPEED;
        target.phi -= dy * ROTATE_SPEED;
        target.phi = Math.max(0.087, Math.min(Math.PI - 0.087, target.phi));
      } else if (dragButton === 2) {
        const panScale = target.radius * PAN_SPEED;
        target.targetX -= dx * panScale * Math.cos(target.theta);
        target.targetZ -= dx * panScale * Math.sin(target.theta);
        target.targetY += dy * panScale;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isDragging && !hasDragged && dragButton === 0) {
        const dt = Date.now() - mouseDownTime;
        if (dt < 500) {
          // 存储归一化屏幕坐标供body raycast使用
          if (tapScreenPosRef && canvas) {
            const rect = canvas.getBoundingClientRect();
            tapScreenPosRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            tapScreenPosRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          }
          tapTriggerRef.current++;
        }
      }
      isDragging = false;
      dragButton = -1;
      hasDragged = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      const factor = 1 + delta * ZOOM_SPEED * Math.min(Math.abs(e.deltaY), 100);
      target.radius = clampRadius(target.radius * factor);
    };

    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const onDblClick = () => {
      resetOrbit();
    };

    // ─── 触摸事件 ───
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      touchStartTime = Date.now();
      if (e.touches.length === 1) {
        touchMode = 'rotate';
        lastSingleTouchX = e.touches[0].clientX;
        lastSingleTouchY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        touchMode = 'pinch';
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialPinchDist = Math.sqrt(dx * dx + dy * dy);
        initialPinchRadius = target.radius;
        lastPinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastPinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && touchMode === 'rotate') {
        // 单指：旋转
        const dx = e.touches[0].clientX - lastSingleTouchX;
        const dy = e.touches[0].clientY - lastSingleTouchY;
        lastSingleTouchX = e.touches[0].clientX;
        lastSingleTouchY = e.touches[0].clientY;
        target.theta -= dx * ROTATE_SPEED * 1.25;
        target.phi -= dy * ROTATE_SPEED * 1.25;
        target.phi = Math.max(0.087, Math.min(Math.PI - 0.087, target.phi));
      } else if (e.touches.length === 2 && touchMode === 'pinch') {
        // 双指：捏合缩放 + 平移
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (initialPinchDist > 0) {
          const scale = initialPinchDist / dist;
          target.radius = clampRadius(initialPinchRadius * scale);
        }
        // 双指中心点移动→平移
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const pdx = cx - lastPinchCenterX;
        const pdy = cy - lastPinchCenterY;
        if (Math.abs(pdx) > 3 || Math.abs(pdy) > 3) {
          const panScale = target.radius * PAN_SPEED * 1.3;
          target.targetX -= pdx * panScale * Math.cos(target.theta);
          target.targetZ -= pdx * panScale * Math.sin(target.theta);
          target.targetY += pdy * panScale;
          lastPinchCenterX = cx;
          lastPinchCenterY = cy;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchMode === 'rotate' && e.touches.length === 0) {
        // 单指结束：检测是单击/双击还是拖拽
        const dt = Date.now() - touchStartTime;
        const dx = lastSingleTouchX - touchStartX;
        const dy = lastSingleTouchY - touchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 8 && dt < 500) {
          // 单击或双击
          const now = Date.now();
          if (now - lastTapTime < 300) {
            // 双击：重置相机
            resetOrbit();
            lastTapTime = 0;
          } else {
            // 单击：触发tap（进入镜子等），存储触摸坐标
            if (tapScreenPosRef && canvas) {
              const rect = canvas.getBoundingClientRect();
              const tx = (lastSingleTouchX - rect.left) / rect.width * 2 - 1;
              const ty = -((lastSingleTouchY - rect.top) / rect.height) * 2 + 1;
              tapScreenPosRef.current.x = tx;
              tapScreenPosRef.current.y = ty;
            }
            lastTapTime = now;
            tapTriggerRef.current++;
          }
        }
      }
      if (e.touches.length === 0) {
        touchMode = 'none';
        initialPinchDist = 0;
      } else if (e.touches.length === 1) {
        touchMode = 'rotate';
        lastSingleTouchX = e.touches[0].clientX;
        lastSingleTouchY = e.touches[0].clientY;
      }
    };

    // ─── 阻尼动画循环（使用requestAnimationFrame） ───
    let animFrameId = 0;
    let lastResetSignal = 0;
    const animate = () => {
      const o = orbitRef.current;
      // 检测CameraRig的强制重置信号（最可靠的同步方式）
      if (o.resetSignal !== lastResetSignal) {
        lastResetSignal = o.resetSignal;
        // 直接设置target和orbitRef为目标值，完全跳过阻尼
        target.theta = o.resetTheta;
        target.phi = o.resetPhi;
        target.radius = o.resetRadius;
        target.targetX = o.resetTargetX;
        target.targetY = o.resetTargetY;
        target.targetZ = o.resetTargetZ;
        o.theta = o.resetTheta;
        o.phi = o.resetPhi;
        o.radius = o.resetRadius;
        o.targetX = o.resetTargetX;
        o.targetY = o.resetTargetY;
        o.targetZ = o.resetTargetZ;
        o.initialized = true;
      }

      applyDamping();
      animFrameId = requestAnimationFrame(animate);
    };
    animate();

    // ─── 初始化 ───
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    // 暴露resetOrbit供外部调用
    (window as any).__resetAvatarCamera = resetOrbit;

    return () => {
      cancelAnimationFrame(animFrameId);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [gl, orbitRef, modelInfoRef, tapTriggerRef]);

  return null;
}

/* ───────────── 自动相机控制器（每帧更新相机位置，支持轨道控制） ───────────── */

function CameraRig({ framing, modelInfoRef, orbitRef }: {
  framing: 'bust' | 'full';
  modelInfoRef: React.MutableRefObject<{
    size: THREE.Vector3; center: THREE.Vector3; headY: number;
    headCenterX: number; headBoneY: number; shoulderY: number; chestY: number;
    shoulderWidth: number;
  } | null>;
  orbitRef: React.MutableRefObject<OrbitState>;
}) {
  const { camera, size: canvasSize } = useThree();
  const initFramesRef = useRef(0);
  const lastAspectRef = useRef(0);
  const baseFovRef = useRef(32);
  const hadInfoRef = useRef(false);
  const lastFramingRef = useRef(framing);
  const lastReinitSignalRef = useRef(0);

  useFrame(() => {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
    const perspCam = camera as THREE.PerspectiveCamera;
    const info = modelInfoRef.current;
    const aspect = canvasSize.width > 0 && canvasSize.height > 0 ? canvasSize.width / canvasSize.height : 1.0;

    // 当外部请求强制重新初始化构图时（如点击重置按钮或代码热更新后）
    if (orbitRef.current.reinitSignal !== lastReinitSignalRef.current) {
      lastReinitSignalRef.current = orbitRef.current.reinitSignal;
      initFramesRef.current = 0;
      orbitRef.current.initialized = false;
    }

    // 当framing模式切换时，重置初始化帧计数，重新计算构图
    if (lastFramingRef.current !== framing) {
      lastFramingRef.current = framing;
      initFramesRef.current = 0;
      orbitRef.current.initialized = false; // 强制重新设置orbit初始位置
    }

    // 当info从null变为有数据（模型刚加载完成），重置初始化帧计数
    if (info && !hadInfoRef.current) {
      initFramesRef.current = 0;
      hadInfoRef.current = true;
    }

    const needsInit = initFramesRef.current < 30;
    const needsAspectUpdate = Math.abs(aspect - lastAspectRef.current) > 0.001;

    if (!info) {
      if (needsAspectUpdate) {
        perspCam.aspect = aspect;
        perspCam.updateProjectionMatrix();
        lastAspectRef.current = aspect;
      }
      return;
    }

    // ─── 初次或窗口大小变化时：重新计算基础构图参数 ───
    if (needsInit || needsAspectUpdate) {
      const { size, center, headY: eyeY, headCenterX, headBoneY, shoulderY, shoulderWidth } = info;

      if (framing === 'bust') {
        // 专业人像胸像构图（Bust/Headshot）：
        // 手机竖屏优先：大脸+头肩为主，眼睛在画面垂直40%位置（自然自拍感）
        // 竖屏vs横屏策略差异化：
        //   - 竖屏：头部充满画面，眼睛/脸是核心，发型边缘可贴近画面边缘（自拍常规）
        //   - 横屏：保证完整头肩+发型，两侧留白
        const isPortrait = aspect < 1.0;
        const fov = isPortrait ? 46 : 38; // 竖屏稍广视角容纳侧马尾
        const vFovRad = (fov / 2) * Math.PI / 180;
        const hFovRad = 2 * Math.atan(Math.tan(vFovRad) * aspect);
        const tanHalfFovV = Math.tan(vFovRad);
        const tanHalfFovH = Math.tan(hFovRad / 2);

        const bboxTop = center.y + size.y / 2;
        const skullH = bboxTop - headBoneY;

        // 构图边界：
        // - 上：头顶/马尾 + 少量留白（竖屏稍多留白避免马尾贴顶）
        // - 下：胸部/上腹部（经典胸像构图，竖屏显示更多上半身）
        const topMargin = skullH * (isPortrait ? 0.15 : 0.12);
        const bottomExtra = skullH * (isPortrait ? 0.55 : 0.35);
        const frameTop = bboxTop + topMargin;
        const frameBottom = shoulderY - bottomExtra;
        
        // 水平宽度策略：竖屏vs横屏差异化
        // skullH是头骨基部到头顶高度，头宽≈skullH×0.72
        const headWidthApprox = skullH * 0.72;
        let visualWidth: number;
        let sideMarginRatio: number;
        
        if (isPortrait) {
          // 竖屏自拍特写：优先脸部大小，采用人像摄影经典胸像构图
          // - 头部+基础发型必须完整（马尾/侧发需要留出空间）
          // - 肩膀可见但允许轻微裁切（手机自拍常见），避免相机过远导致脸太小
          // - 注意：侧马尾模型需要更宽的hairWidth，侧马尾单侧伸出，用2.8倍头宽
          const hairBase = headWidthApprox * 2.8;
          // 肩宽检测修正：如果检测到的肩宽<0.25m（异常小，说明骨骼匹配不准），
          // 使用包围盒宽度×0.30作为估算（VRoid模型肩宽约占总宽度30%）
          const effectiveShoulderWidth = shoulderWidth > 0.25 ? shoulderWidth : size.x * 0.30;
          const shoulderMin = effectiveShoulderWidth * 1.8;
          visualWidth = Math.max(hairBase, shoulderMin);
          sideMarginRatio = 0.05;
        } else {
          // 横屏：完整头肩+发型，两侧留足够白
          const hairWidth = headWidthApprox * 2.2;
          const shoulderMin = shoulderWidth > 0.1 ? shoulderWidth * 2.5 : 0;
          visualWidth = Math.max(hairWidth, shoulderMin);
          sideMarginRatio = 0.06;
        }
        
        const sideMargin = visualWidth * sideMarginRatio;
        const requiredVisibleW = visualWidth + sideMargin * 2;

        // 眼睛在画面从上往下40%位置（手机自拍比经典1/3稍低更自然）
        // Three.js y轴向上：画面顶部=targetY+halfH（y最大），底部=targetY-halfH（y最小）
        // 从上往下40%位置的y = 顶部y - 0.4*总高度 = (targetY+halfH) - 0.4*2halfH = targetY + 0.2halfH
        // 令eyeY = 该位置：eyeY = targetY + 0.2halfH => targetY = eyeY - 0.2halfH
        const eyePosRatio = 0.40; // 眼睛垂直位置（0=顶，1=底）
        const eyeOffsetFromCenter = (eyePosRatio - 0.5) * 2; // = -0.2，眼睛在中心上方0.2*halfH处

        // 二分查找合适的halfH，使得画面能完整覆盖frameTop和frameBottom
        let halfH = Math.max(frameTop - eyeY, eyeY - frameBottom);
        // 迭代调整确保垂直边界都能覆盖
        for (let i = 0; i < 8; i++) {
          const targetY = eyeY + eyeOffsetFromCenter * halfH;
          const actualTop = targetY + halfH;
          const actualBottom = targetY - halfH;
          let needsGrow = 1.0;
          if (actualTop < frameTop) needsGrow = Math.max(needsGrow, (frameTop - targetY) / halfH);
          if (actualBottom > frameBottom) needsGrow = Math.max(needsGrow, (targetY - frameBottom) / halfH);
          if (needsGrow <= 1.001) break;
          halfH *= needsGrow * 1.02;
        }

        // 同时计算垂直和水平约束需要的距离
        const distanceForHeight = (halfH / tanHalfFovV) * 1.04;
        const distanceForWidthRaw = (requiredVisibleW / 2) / tanHalfFovH * 1.04;
        
        // 竖屏特写策略：保证发型完整可见，同时脸部不要太小
        // 允许距离比垂直距离大65%以内（在窄竖屏中平衡脸大小和发型完整性）
        const maxAcceptableDistance = distanceForHeight * 1.65;
        let distance: number;
        if (isPortrait) {
          distance = Math.min(distanceForWidthRaw, maxAcceptableDistance);
        } else {
          distance = Math.max(distanceForHeight, distanceForWidthRaw);
        }
        const distanceForWidth = distanceForWidthRaw;
        let actualHalfH = distance * tanHalfFovV;
        let frameCenterY = eyeY + eyeOffsetFromCenter * actualHalfH;

        // 垂直方向需要的可视高度（frameBottom到frameTop）
        const requiredVisibleH = frameTop - frameBottom;

        baseFovRef.current = fov;
        perspCam.fov = fov;
        perspCam.near = 0.05;
        perspCam.far = 50;

        // Debug info
        cameraDefaults.distance = distance;
        cameraDefaults.targetX = headCenterX;
        cameraDefaults.targetY = frameCenterY;
        if (typeof window !== 'undefined') (window as any).__avatarDebug = {
          mode: 'bust',
          fov,
          isPortrait,
          bboxTop,
          headBoneY,
          eyeY,
          shoulderY,
          shoulderWidth,
          skullH,
          frameTop,
          frameBottom,
          halfH,
          requiredVisibleH,
          requiredVisibleW,
          distanceForH: requiredVisibleH / (2 * Math.tan(vFovRad)),
          distanceForWidth,
          distance,
          frameCenterY,
          sizeY: size.y,
          centerY: center.y,
          aspect,
        };

        // 初始化/重置orbit状态
        if (needsInit && initFramesRef.current === 0) {
          orbitRef.current.resetTheta = 0;
          orbitRef.current.resetPhi = Math.PI / 2;
          orbitRef.current.resetRadius = distance;
          orbitRef.current.resetTargetX = headCenterX;
          orbitRef.current.resetTargetY = frameCenterY;
          orbitRef.current.resetTargetZ = 0;
          orbitRef.current.resetSignal++;
        }

      } else {
        // 全身构图：参考50mm标准镜头全身人像，头顶留空+脚底留地+两侧留边
        const isPortrait = aspect < 1.0;
        const fov = isPortrait ? 45 : 42; // 竖屏稍广视角容纳全身
        const vFovRad = (fov / 2) * Math.PI / 180;
        const hFovRad = 2 * Math.atan(Math.tan(vFovRad) * aspect);

        // 模型实际尺寸（feetY=0因为我们已经把模型底部对齐到y=0）
        const feetY = 0;
        const modelHeight = size.y;
        
        // 躯干宽度估算：使用肩宽×1.5（A-pose下手臂会超出这个宽度，
        // 但人像摄影中手臂可以靠近边缘甚至轻微裁切，避免相机拉得过远导致人物太小）
        // 如果肩宽检测失败，fallback到包围盒宽度的60%（排除张开的手臂）
        let torsoWidth: number;
        if (shoulderWidth > 0.1) {
          torsoWidth = shoulderWidth * 3.0; // 肩宽×1.5每侧，总共约3倍肩宽容纳身体+手臂
        } else {
          torsoWidth = size.x * 0.6;
        }

        // 全身构图边距：头顶留8%身高空间，脚底留12%（接地感），两侧留10%
        const topMargin = modelHeight * 0.08;
        const bottomMargin = modelHeight * 0.12;
        const sideMargin = torsoWidth * 0.10;

        // 垂直方向需要容纳的高度：从脚底-botMargin到头顶+topMargin
        const requiredVisibleH = modelHeight + topMargin + bottomMargin;
        // 水平方向需要容纳的宽度（基于躯干而非手臂张开宽度）
        const requiredVisibleW = torsoWidth + sideMargin * 2;

        // 分别计算垂直和水平约束需要的距离
        const distanceForHeight = (requiredVisibleH / 2) / Math.tan(vFovRad);
        const distanceForWidth = (requiredVisibleW / 2) / Math.tan(hFovRad / 2);

        // 取较大值保证完整容纳，额外留3%安全边距
        const distance = Math.max(distanceForHeight, distanceForWidth) * 1.03;

        // 构图中心：略低于几何中心，让人物稍微偏下（人像摄影常规）
        // frameCenterY从feetY到top+margin的范围，眼睛在上2/5处≈人物自然重心
        const frameCenterY = (feetY - bottomMargin + modelHeight + topMargin) * 0.45;

        baseFovRef.current = fov;
        perspCam.fov = fov;
        perspCam.near = 0.05;
        perspCam.far = 100; // 全身视图需要更远far平面

        cameraDefaults.distance = distance;
        cameraDefaults.targetX = headCenterX; // 水平居中于头部而非包围盒
        cameraDefaults.targetY = frameCenterY;
        if (typeof window !== 'undefined') (window as any).__avatarDebug = {
          mode: 'full',
          fov,
          isPortrait,
          modelHeight,
          torsoWidth,
          shoulderWidth,
          feetY,
          topMargin,
          bottomMargin,
          sideMargin,
          requiredVisibleH,
          requiredVisibleW,
          distanceForHeight,
          distanceForWidth,
          distance,
          frameCenterY,
          sizeY: size.y,
          centerY: center.y,
          bboxWidth: size.x,
          aspect,
        };

        // 初始化/重置orbit状态：通过resetSignal机制只触发一次
        if (needsInit && initFramesRef.current === 0) {
          orbitRef.current.resetTheta = 0;
          orbitRef.current.resetPhi = Math.PI / 2;
          orbitRef.current.resetRadius = distance;
          orbitRef.current.resetTargetX = headCenterX;
          orbitRef.current.resetTargetY = frameCenterY;
          orbitRef.current.resetTargetZ = 0;
          orbitRef.current.resetSignal++;
        }
      }
    }

    // ─── 每帧从orbit状态计算相机位置 ───
    const o = orbitRef.current;
    const sinPhi = Math.sin(o.phi);
    const cosPhi = Math.cos(o.phi);
    const sinTheta = Math.sin(o.theta);
    const cosTheta = Math.cos(o.theta);

    // 球坐标→笛卡尔坐标：相机在target的(r*sin(phi)*sin(theta), r*cos(phi), r*sin(phi)*cos(theta))
    // 因为初始时相机在+Z方向(看向-Z)，theta=0对应正前方
    const camX = o.targetX + o.radius * sinPhi * sinTheta;
    const camY = o.targetY + o.radius * cosPhi;
    const camZ = o.targetZ + o.radius * sinPhi * cosTheta;

    perspCam.position.set(camX, camY, camZ);
    perspCam.lookAt(o.targetX, o.targetY, o.targetZ);

    if (needsInit || needsAspectUpdate) {
      perspCam.aspect = aspect;
    }
    perspCam.updateProjectionMatrix();

    lastAspectRef.current = aspect;
    initFramesRef.current++;
  });

  return null;
}

/* ───────────── Main Component ───────────── */
export function VRMAvatarView({
  profile,
  modelUrl = '/avatar/AvatarSample_G.glb',
  paused = false,
  framing = 'bust',
  onAvatarPress,
  triggerAcknowledge,
  triggerTouchReaction,
  onError,
}: VRMAvatarViewProps) {
  const { gl } = useThree();
  const modelInfoRef = useRef<{
    size: THREE.Vector3; center: THREE.Vector3; headY: number;
    headCenterX: number; headBoneY: number; shoulderY: number; chestY: number;
    shoulderWidth: number;
  } | null>(null);
  const orbitRef = useRef<OrbitState>({
    theta: 0,
    phi: Math.PI / 2,
    radius: 1.5,
    targetX: 0,
    targetY: 1.4,
    targetZ: 0,
    initialized: false,
    resetSignal: 0,
    resetTheta: 0,
    resetPhi: Math.PI / 2,
    resetRadius: 1.5,
    resetTargetX: 0,
    resetTargetY: 1.4,
    resetTargetZ: 0,
    reinitSignal: 0,
  });
  /** 点击触发计数（由OrbitControls在检测到tap时递增） */
  const tapTriggerRef = useRef(0);
  /** 点击时的屏幕归一化坐标 [-1,1]，由OrbitControls设置 */
  const tapScreenPosRef = useRef({ x: 0, y: 0 });
  /** 用于useEffect依赖的tap状态 */
  const [tapCount, setTapCount] = useState(0);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const canvas = gl.domElement as HTMLCanvasElement;
    if (canvas) {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      canvas.style.touchAction = 'none';
    }
  }, [gl]);

  // 监听tap计数变化，调用onAvatarPress（导航+触摸反应由上层和GLBModel分别处理）
  useEffect(() => {
    if (tapCount > 0) {
      onAvatarPress?.();
    }
  }, [tapCount, onAvatarPress]);

  // 将setTapCount连接到tapTriggerRef：通过监听ref变化来更新state
  // 使用一个ref来桥接OrbitControls（在R3F内部无法直接调用setState）
  const tapCountRef = useRef(0);
  useEffect(() => {
    const checkTap = () => {
      if (tapTriggerRef.current !== tapCountRef.current) {
        tapCountRef.current = tapTriggerRef.current;
        setTapCount(tapTriggerRef.current);
      }
    };
    const id = setInterval(checkTap, 30);
    return () => clearInterval(id);
  }, []);

  const handleModelLoaded = useCallback((size: THREE.Vector3, center: THREE.Vector3, headY: number, headCenterX: number, headBoneY: number, shoulderY: number, chestY: number, shoulderWidth: number) => {
    modelInfoRef.current = { size: size.clone(), center: center.clone(), headY, headCenterX, headBoneY, shoulderY, chestY, shoulderWidth };
  }, []);

  return (
    <AvatarErrorBoundary onError={onError} fallback={null}>
      <CameraOrbitControls orbitRef={orbitRef} modelInfoRef={modelInfoRef} tapTriggerRef={tapTriggerRef} tapScreenPosRef={tapScreenPosRef} />
      <CameraRig framing={framing} modelInfoRef={modelInfoRef} orbitRef={orbitRef} />
      <Suspense fallback={<LoadingFallback />}>
        <GLBModel
          url={modelUrl}
          onLoaded={handleModelLoaded}
          onError={onError}
          paused={paused}
          profile={profile}
          triggerAcknowledge={triggerAcknowledge}
          triggerTouchReaction={triggerTouchReaction}
          tapTriggerRef={tapTriggerRef}
          tapScreenPosRef={tapScreenPosRef}
        />
      </Suspense>
    </AvatarErrorBoundary>
  );
}

export interface AutoCameraParams {
  fov: number;
  position: [number, number, number];
  lookAt: [number, number, number];
}
