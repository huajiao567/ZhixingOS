import type { AvatarProfileV2 } from './avatarTypes';

export interface AvatarPersonalizationDraft {
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
  skinTone: string;
  hairColor: string;
  outfitColor: string;
  hairId?: string;
}

export type AvatarPersonalizationField =
  | 'faceWidth'
  | 'faceHeight'
  | 'jawRoundness'
  | 'eyeSize'
  | 'eyeSpacing'
  | 'browAngle'
  | 'noseSize'
  | 'mouthWidth'
  | 'bodyScale'
  | 'shoulderWidth'
  | 'skinTone'
  | 'hairColor'
  | 'outfitColor';

export interface AvatarPersonalizationCapability {
  effect: 'rendered' | 'stored-only';
  channel: 'bone-scale' | 'bone-position' | 'material-tint' | 'stored-only';
  description: string;
}

/**
 * Product-level truth contract for the current production AvatarSample_G.
 * UI, photo fitting copy and renderer tests should derive claims from here
 * rather than independently claiming that every stored parameter is visible.
 */
export const AVATAR_PERSONALIZATION_CAPABILITIES: Record<
  AvatarPersonalizationField,
  AvatarPersonalizationCapability
> = {
  faceWidth: {
    effect: 'rendered',
    channel: 'bone-scale',
    description: '通过头骨横向缩放预览；身体宽度变化会被补偿，不会偷改脸宽。',
  },
  faceHeight: {
    effect: 'rendered',
    channel: 'bone-scale',
    description: '通过头骨纵向缩放预览；身体整体比例变化会被补偿。',
  },
  jawRoundness: {
    effect: 'stored-only',
    channel: 'stored-only',
    description: '当前生产模型没有可验证的结构性下颌 morph，仅保存到身份版本。',
  },
  eyeSize: {
    effect: 'stored-only',
    channel: 'stored-only',
    description: '当前生产模型没有身份级眼睛大小 morph，仅保存到身份版本。',
  },
  eyeSpacing: {
    effect: 'stored-only',
    channel: 'stored-only',
    description: '当前生产模型没有身份级眼距 morph，仅保存到身份版本。',
  },
  browAngle: {
    effect: 'stored-only',
    channel: 'stored-only',
    description: '当前生产模型的眉部 BlendShape 用于表情，不作为永久身份 morph。',
  },
  noseSize: {
    effect: 'stored-only',
    channel: 'stored-only',
    description: '当前生产模型没有可验证的鼻部尺寸 morph，仅保存到身份版本。',
  },
  mouthWidth: {
    effect: 'stored-only',
    channel: 'stored-only',
    description: '当前生产模型的嘴部 BlendShape 用于表情/口型，不作为永久嘴宽 morph。',
  },
  bodyScale: {
    effect: 'rendered',
    channel: 'bone-scale',
    description: '通过身体 X/Z 厚度与极小的 Y 比例变化预览，不再用身体比例修改头部形状。',
  },
  shoulderWidth: {
    effect: 'rendered',
    channel: 'bone-position',
    description: '通过左右肩骨；缺少独立肩骨时回退到上臂根节点的横向位置预览。',
  },
  skinTone: {
    effect: 'rendered',
    channel: 'material-tint',
    description: '只作用于真实识别为皮肤的材质。',
  },
  hairColor: {
    effect: 'rendered',
    channel: 'material-tint',
    description: '只作用于真实识别为头发的材质。',
  },
  outfitColor: {
    effect: 'rendered',
    channel: 'material-tint',
    description: '只作用于真实识别为服装的材质。',
  },
};

export interface AvatarIdentityGeometry {
  headScaleX: number;
  headScaleY: number;
  bodyScaleXZ: number;
  bodyScaleY: number;
  shoulderSpread: number;
}

export interface AvatarHeadLocalScale {
  x: number;
  y: number;
  z: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
const centered = (value: number) => clamp01(value) - 0.5;

export function personalizationDraftToProfile(
  profile: AvatarProfileV2,
  draft: AvatarPersonalizationDraft,
): AvatarProfileV2 {
  return {
    ...profile,
    identity: {
      ...profile.identity,
      faceMorphs: {
        ...profile.identity.faceMorphs,
        faceWidth: clamp01(draft.faceWidth),
        faceHeight: clamp01(draft.faceHeight),
        jawRoundness: clamp01(draft.jawRoundness),
        eyeSize: clamp01(draft.eyeSize),
        eyeSpacing: clamp01(draft.eyeSpacing),
        browAngle: clamp01(draft.browAngle),
        noseSize: clamp01(draft.noseSize),
        mouthWidth: clamp01(draft.mouthWidth),
      },
      bodyMorphs: {
        ...profile.identity.bodyMorphs,
        bodyScale: clamp01(draft.bodyScale),
        shoulderWidth: clamp01(draft.shoulderWidth),
      },
      skinMaterial: {
        ...profile.identity.skinMaterial,
        baseColor: draft.skinTone,
      },
    },
    appearance: {
      ...profile.appearance,
      hairId: draft.hairId ?? profile.appearance.hairId,
      hairColor: draft.hairColor,
      outfitColor: draft.outfitColor,
    },
  };
}

/**
 * Conservative geometry mapping used by the production VRM renderer.
 * face width/height are head-local identity changes; bodyScale is a separate
 * body-frame change; shoulderWidth has its own shoulder-root position channel.
 */
export function deriveAvatarIdentityGeometry(profile: AvatarProfileV2): AvatarIdentityGeometry {
  const face = profile.identity.faceMorphs ?? {};
  const body = profile.identity.bodyMorphs ?? {};

  const faceWidth = centered(face.faceWidth ?? 0.5);
  const faceHeight = centered(face.faceHeight ?? 0.5);
  const bodyScale = centered(body.bodyScale ?? 0.5);
  const shoulderWidth = centered(body.shoulderWidth ?? 0.5);

  return {
    headScaleX: 1 + faceWidth * 0.12,
    headScaleY: 1 + faceHeight * 0.10,
    bodyScaleXZ: 1 + bodyScale * 0.08,
    bodyScaleY: 1 + bodyScale * 0.02,
    shoulderSpread: 1 + shoulderWidth * 0.12,
  };
}

/**
 * The avatar body group is scaled for body-frame adaptation. Because the head
 * lives below that group, compensate its local scale so body/shoulder controls
 * cannot silently change the confirmed face shape in world space.
 */
export function deriveCompensatedHeadLocalScale(
  geometry: AvatarIdentityGeometry,
  bodyWorldScale: { x: number; y: number; z: number },
): AvatarHeadLocalScale {
  const safe = (value: number) => Math.max(0.001, Math.abs(value));
  return {
    x: geometry.headScaleX / safe(bodyWorldScale.x),
    y: geometry.headScaleY / safe(bodyWorldScale.y),
    z: 1 / safe(bodyWorldScale.z),
  };
}

export function nextIdentityVersion(current: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) return '1.0.1';
  return [Number(match[1]), Number(match[2]), Number(match[3]) + 1].join('.');
}

export type AvatarMaterialRole = 'skin' | 'hair' | 'outfit';

const PROTECTED_FACE_MATERIAL =
  /(eye|iris|pupil|white|mouth|teeth|tongue|lip|brow|eyeline|eyelash|highlight)/;
const EXPLICIT_OUTFIT_MATERIAL =
  /(cloth|clothes|dress|shirt|jacket|top|bottom|outfit|uniform|shoe|socks|服|衣)/;

/**
 * Classify a render material without letting a generic mesh name override a
 * more specific material contract. AvatarSample_G intentionally places skin,
 * clothing and some hair primitives under Body.baked, so materialName must
 * always win and meshName is only a fallback.
 */
export function classifyAvatarMaterial(
  materialName: string,
  meshName = '',
): AvatarMaterialRole | null {
  const material = materialName.toLowerCase();
  const mesh = meshName.toLowerCase();

  // Never tint facial detail materials through a Face.baked fallback.
  if (PROTECTED_FACE_MATERIAL.test(material)) return null;

  // Strong, production-asset material signals take precedence over the mesh.
  if (EXPLICIT_OUTFIT_MATERIAL.test(material)) return 'outfit';
  if (/(hair|髪)/.test(material)) return 'hair';
  if (/(skin|肌)/.test(material)) return 'skin';

  // Only then use weaker material semantics and finally the mesh name.
  if (/(face|body|head|顔)/.test(material)) return 'skin';

  if (PROTECTED_FACE_MATERIAL.test(mesh)) return null;
  if (EXPLICIT_OUTFIT_MATERIAL.test(mesh)) return 'outfit';
  if (/(hair|髪)/.test(mesh)) return 'hair';
  if (/(skin|face|body|head|肌|顔)/.test(mesh)) return 'skin';
  return null;
}

export function safeAppearanceColor(value: string | undefined, fallback: string): string {
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return value.toUpperCase();
}
