/**
 * 平台无关的 Avatar 几何与动画纯函数 v2.0
 *
 * 新增主题联动：avatarStyle (default / cyber / kawaii / minimal / elder / obsidian
 * 新增场景色：neon / candy / void
 */
import type {
  AnimationKind,
  AvatarIdentity,
  AvatarRenderState,
  OutfitKind,
  SceneKind,
} from '../types/avatar';
import { lerp } from './math';

export type AvatarStyle = 'default' | 'cyber' | 'kawaii' | 'minimal' | 'elder' | 'obsidian';

export interface StyleLightConfig {
  camera: {
    posY: number;
    posZ: number;
    fov: number;
  };
  lights: {
    ambient: number;
    ambientColor: string;
    key: number;
    keyColor: string;
    fill: number;
    fillColor: string;
    rim1: number;
    rim2: number;
    rim3: number;
    rim2Color: string;
    rim3Color: string;
    warm: number;
    warmColor: string;
    extraLights: {
      pos: [number, number, number];
      intensity: number;
      color: string;
      distance: number;
    }[];
  };
  shadow: {
    innerRadius: number;
    outerRadius: number;
    innerOpacity: number;
    outerOpacity: number;
    floorY: number;
  };
  particles: {
    count: number;
    size: number;
    color: string;
    opacity: number;
    useGlowColor: boolean;
  };
}

export const STYLE_LIGHT_CONFIG: Record<AvatarStyle, StyleLightConfig> = {
  default: {
    camera: { posY: 0.10, posZ: 4.7, fov: 50 },
    lights: {
      ambient: 0.62, ambientColor: '#FFFFFF',
      key: 0.95, keyColor: '#FFFFFF',
      fill: 0.50, fillColor: '#D0D8F0',
      rim1: 0.35, rim2: 0.25, rim3: 0.15,
      rim2Color: '#B0C0FF', rim3Color: '#C0B0FF',
      warm: 0.42, warmColor: '#FFE8D0',
      extraLights: [],
    },
    shadow: { innerRadius: 0.75, outerRadius: 1.9, innerOpacity: 0.16, outerOpacity: 0.04, floorY: -1.00 },
    particles: { count: 4, size: 0.018, color: '#FFFFFF', opacity: 0.10, useGlowColor: true },
  },
  cyber: {
    camera: { posY: 0.40, posZ: 4.9, fov: 48 },
    lights: {
      ambient: 0.40, ambientColor: '#101828',
      key: 0.78, keyColor: '#E0F0FF',
      fill: 0.55, fillColor: '#201030',
      rim1: 0.68, rim2: 0.52, rim3: 0.38,
      rim2Color: '#00F0FF', rim3Color: '#FF00E5',
      warm: 0.28, warmColor: '#201030',
      extraLights: [
        { pos: [0, 0.5, 2], intensity: 0.35, color: '#00F0FF', distance: 3 },
        { pos: [-1, 0.3, 1.5], intensity: 0.2, color: '#FF00E5', distance: 2.5 },
        { pos: [1, 0.4, 1.8], intensity: 0.15, color: '#A855F7', distance: 2.8 },
      ],
    },
    shadow: { innerRadius: 0.88, outerRadius: 2.3, innerOpacity: 0.25, outerOpacity: 0.08, floorY: -1.12 },
    particles: { count: 25, size: 0.025, color: '#00F0FF', opacity: 0.32, useGlowColor: false },
  },
  kawaii: {
    camera: { posY: -0.05, posZ: 4.2, fov: 55 },
    lights: {
      ambient: 0.72, ambientColor: '#FFF8FA',
      key: 1.05, keyColor: '#FFF5EE',
      fill: 0.55, fillColor: '#FFE8F0',
      rim1: 0.35, rim2: 0.28, rim3: 0.20,
      rim2Color: '#FFC0D8', rim3Color: '#FFD0E0',
      warm: 0.50, warmColor: '#FFF0E5',
      extraLights: [
        { pos: [0, 0.8, 1.8], intensity: 0.28, color: '#FFB8D0', distance: 3.5 },
        { pos: [-0.8, 0.6, 1.5], intensity: 0.15, color: '#FFD0E0', distance: 2.5 },
        { pos: [0.8, 0.6, 1.5], intensity: 0.15, color: '#FFE0E8', distance: 2.5 },
      ],
    },
    shadow: { innerRadius: 0.70, outerRadius: 1.8, innerOpacity: 0.14, outerOpacity: 0.05, floorY: -0.92 },
    particles: { count: 35, size: 0.035, color: '#FFB8D0', opacity: 0.40, useGlowColor: false },
  },
  minimal: {
    camera: { posY: 0.40, posZ: 5.1, fov: 45 },
    lights: {
      ambient: 0.58, ambientColor: '#F8F8F8',
      key: 0.82, keyColor: '#FFFFFF',
      fill: 0.35, fillColor: '#E8E8E8',
      rim1: 0.30, rim2: 0.22, rim3: 0.14,
      rim2Color: '#D0D0D8', rim3Color: '#E0E0E8',
      warm: 0.25, warmColor: '#FFF8F0',
      extraLights: [],
    },
    shadow: { innerRadius: 0.82, outerRadius: 2.0, innerOpacity: 0.18, outerOpacity: 0.04, floorY: -1.12 },
    particles: { count: 8, size: 0.018, color: '#FFFFFF', opacity: 0.10, useGlowColor: false },
  },
  elder: {
    camera: { posY: 0.40, posZ: 5.0, fov: 46 },
    lights: {
      ambient: 0.65, ambientColor: '#FFFAF5',
      key: 0.95, keyColor: '#FFF8F0',
      fill: 0.48, fillColor: '#F0E8E0',
      rim1: 0.35, rim2: 0.25, rim3: 0.18,
      rim2Color: '#E8D8C8', rim3Color: '#D8C8B8',
      warm: 0.42, warmColor: '#FFF0E0',
      extraLights: [
        { pos: [0, 1.0, 1.5], intensity: 0.12, color: '#FFF8E0', distance: 4 },
      ],
    },
    shadow: { innerRadius: 0.86, outerRadius: 2.15, innerOpacity: 0.22, outerOpacity: 0.06, floorY: -1.12 },
    particles: { count: 6, size: 0.02, color: '#FFE8C8', opacity: 0.12, useGlowColor: false },
  },
  obsidian: {
    camera: { posY: 0.40, posZ: 5.0, fov: 46 },
    lights: {
      ambient: 0.38, ambientColor: '#080810',
      key: 0.72, keyColor: '#E0E0F0',
      fill: 0.40, fillColor: '#151525',
      rim1: 0.58, rim2: 0.42, rim3: 0.30,
      rim2Color: '#8888CC', rim3Color: '#AA88CC',
      warm: 0.22, warmColor: '#181520',
      extraLights: [
        { pos: [0, 0.6, 2.2], intensity: 0.22, color: '#6666AA', distance: 3.5 },
        { pos: [-1.2, 0.2, 1.2], intensity: 0.12, color: '#AA88CC', distance: 2 },
      ],
    },
    shadow: { innerRadius: 0.84, outerRadius: 2.25, innerOpacity: 0.28, outerOpacity: 0.08, floorY: -1.12 },
    particles: { count: 18, size: 0.02, color: '#8888AA', opacity: 0.20, useGlowColor: true },
  },
};

export const SCENE_COLORS: Record<SceneKind, string> = {
  room: '#17202D',
  desk: '#162336',
  outdoor: '#17312D',
  rest: '#221E2D',
  neon: '#0A0A1A',
  candy: '#FFF5F8',
  void: '#000000',
};

export const SCENE_FLOOR_COLORS: Record<SceneKind, string> = {
  room: '#0F1520',
  desk: '#0E1828',
  outdoor: '#0E2522',
  rest: '#181420',
  neon: '#050510',
  candy: '#FFECF2',
  void: '#050505',
};

export const SCENE_GLOW_COLORS: Record<SceneKind, string> = {
  room: '#5B7CFF',
  desk: '#4DB6AC',
  outdoor: '#3FB27F',
  rest: '#9B7BE0',
  neon: '#00F0FF',
  candy: '#FF6B9D',
  void: '#BBBBFF',
};

export interface AvatarMetrics {
  faceX: number;
  faceY: number;
  eyeX: number;
  eyeScale: number;
  shoulderX: number;
  bodyScale: number;
}

/** 根据 avatar style 调整基础几何比例 */
const STYLE_GEOMETRY_MODIFIERS: Record<AvatarStyle, Partial<AvatarMetrics & { eyeSizeMul: number; headScale: number }>> = {
  default: { eyeSizeMul: 1, headScale: 1 },
  cyber: { eyeSizeMul: 1.15, headScale: 1.02, faceY: 1.05 },
  kawaii: { eyeSizeMul: 1.4, headScale: 1.08, faceY: 1.12, faceX: 0.95 },
  minimal: { eyeSizeMul: 0.85, headScale: 0.97 },
  elder: { eyeSizeMul: 0.9, headScale: 1, bodyScale: 1.05 },
  obsidian: { eyeSizeMul: 0.95, headScale: 0.98 },
};

export function computeAvatarMetrics(identity: AvatarIdentity, style: AvatarStyle = 'default'): AvatarMetrics {
  const mod = STYLE_GEOMETRY_MODIFIERS[style];
  const baseEye = 0.075 + identity.eyeSize * 0.055;
  return {
    faceX: (0.86 + identity.faceWidth * 0.24) * (mod.faceX ?? 1),
    faceY: (0.90 + identity.faceHeight * 0.22) * (mod.faceY ?? 1),
    eyeX: 0.16 + identity.eyeSpacing * 0.12,
    eyeScale: baseEye * (mod.eyeSizeMul ?? 1),
    shoulderX: 0.62 + identity.shoulderWidth * 0.30,
    bodyScale: (0.88 + identity.bodyScale * 0.20) * (mod.bodyScale ?? 1),
  };
}

export function computeOutfitColor(outfit: OutfitKind, identity: AvatarIdentity, style: AvatarStyle = 'default'): string {
  if (style === 'cyber') {
    switch (outfit) {
      case 'sport': return '#00F0FF';
      case 'work': return '#A855F7';
      case 'home': return '#FF00E5';
      case 'daily':
      default: return identity.shirtColor;
    }
  }
  if (style === 'kawaii') {
    switch (outfit) {
      case 'sport': return '#FF94B8';
      case 'work': return '#C9A0DC';
      case 'home': return '#FFB347';
      case 'daily':
      default: return identity.shirtColor;
    }
  }
  if (style === 'minimal') {
    switch (outfit) {
      case 'sport': return '#34C759';
      case 'work': return '#007AFF';
      case 'home': return '#8E8E93';
      case 'daily':
      default: return identity.shirtColor;
    }
  }
  if (style === 'obsidian') {
    switch (outfit) {
      case 'sport': return '#88CCAA';
      case 'work': return '#BBBBFF';
      case 'home': return '#AA99DD';
      case 'daily':
      default: return identity.shirtColor;
    }
  }
  switch (outfit) {
    case 'sport':
      return '#34A27B';
    case 'work':
      return '#3E506E';
    case 'home':
      return '#7C718E';
    case 'daily':
    default:
      return identity.shirtColor;
  }
}

export interface AnimationTargets {
  speed: number;
  bob: number;
  breathe: number;
  targetPosture: number;
  browRot: number;
  armSwing: number;
  blinkTarget: number;
  headRotX: number;
  headRotY: number;
  rootRotZ: number;
  rootRotX: number;
}

const STYLE_ANIMATION_MODIFIERS: Record<AvatarStyle, { speedMul: number; swayMul: number; blinkRate: number }> = {
  default: { speedMul: 1, swayMul: 1, blinkRate: 0.78 },
  cyber: { speedMul: 1.3, swayMul: 1.2, blinkRate: 0.9 },
  kawaii: { speedMul: 0.9, swayMul: 0.8, blinkRate: 0.65 },
  minimal: { speedMul: 0.85, swayMul: 0.6, blinkRate: 0.7 },
  elder: { speedMul: 0.7, swayMul: 0.7, blinkRate: 0.55 },
  obsidian: { speedMul: 0.75, swayMul: 0.5, blinkRate: 0.6 },
};

export function computeAnimationTargets(
  render: AvatarRenderState,
  t: number,
  style: AvatarStyle = 'default',
): AnimationTargets {
  const mod = STYLE_ANIMATION_MODIFIERS[style];
  const speed = (0.5 + render.motionSpeed * 1.4) * mod.speedMul;
  const targetPosture = lerp(-0.12, 0.1, render.posture);
  const sway = render.sway * mod.swayMul;
  return {
    speed,
    bob: Math.sin(t * speed * 2.2) * (0.015 + sway * 0.025),
    breathe: Math.sin(t * 1.7) * 0.012,
    targetPosture,
    browRot: lerp(0.04, 0.27, render.browTension),
    armSwing:
      render.animation === 'active' ? Math.sin(t * 3.2) * 0.12 : Math.sin(t * 0.9) * 0.025,
    blinkTarget: Math.sin(t * mod.blinkRate) > 0.985 ? 0.08 : render.eyeOpen,
    headRotX: lerp(0.12, -0.04, render.posture) + Math.sin(t * 0.7) * 0.01,
    headRotY: Math.sin(t * 0.42) * 0.035,
    rootRotZ: Math.sin(t * speed) * sway * 0.025,
    rootRotX: targetPosture * 0.12,
  };
}

export const ANIMATION_LABEL: Record<AnimationKind, string> = {
  idle: '平静呼吸',
  active: '活跃运动',
  focused: '专注凝视',
  tired: '疲惫恢复',
};

export const SCENE_LABEL: Record<SceneKind, string> = {
  room: '日常房间',
  desk: '专注书桌',
  outdoor: '户外',
  rest: '休息空间',
  neon: '霓虹赛博',
  candy: '糖果乐园',
  void: '虚空暗夜',
};

const OUTFIT_LABEL: Record<OutfitKind, string> = {
  daily: '日常服装',
  sport: '运动服装',
  work: '工作服装',
  home: '家居服装',
};

function describeLevel3(value: number): string {
  if (value < 0.34) return '偏低';
  if (value > 0.66) return '偏高';
  return '中等';
}

export function describeRenderState(render: AvatarRenderState): string {
  const parts: string[] = [
    `3D 镜像：${ANIMATION_LABEL[render.animation]}状态`,
    `${SCENE_LABEL[render.scene]}场景`,
    `穿着${OUTFIT_LABEL[render.outfit]}`,
  ];
  if (render.smile > 0.6) parts.push('面带微笑');
  else if (render.smile < 0.35) parts.push('表情低沉');
  else parts.push('表情平静');
  parts.push(`姿态${describeLevel3(render.posture)}`);
  parts.push(`动作幅度${describeLevel3(render.motionSpeed)}`);
  if (render.eyeOpen < 0.5) parts.push('眼睛微闭');
  else parts.push(`眼睛睁开${describeLevel3(render.eyeOpen)}`);
  if (render.browTension > 0.6) parts.push('眉头微皱');
  return parts.join('，');
}
