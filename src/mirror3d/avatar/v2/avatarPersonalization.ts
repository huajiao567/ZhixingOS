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

export interface AvatarIdentityGeometry {
  headScaleX: number;
  headScaleY: number;
  bodyScaleX: number;
  bodyScaleY: number;
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
 * The range is deliberately narrow: photo fitting may change proportions,
 * but cannot produce caricature-scale deformations.
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
    bodyScaleX: 1 + shoulderWidth * 0.06,
    bodyScaleY: 1 + bodyScale * 0.04,
  };
}

export function nextIdentityVersion(current: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) return '1.0.1';
  return [Number(match[1]), Number(match[2]), Number(match[3]) + 1].join('.');
}

export type AvatarMaterialRole = 'skin' | 'hair' | 'outfit';

export function classifyAvatarMaterial(name: string): AvatarMaterialRole | null {
  const normalized = name.toLowerCase();
  if (/(eye|iris|pupil|white|mouth|teeth|tongue|lip)/.test(normalized)) return null;
  if (/(hair|髪)/.test(normalized)) return 'hair';
  if (/(skin|face|body|head|肌|顔)/.test(normalized)) return 'skin';
  if (/(cloth|clothes|dress|shirt|jacket|top|bottom|outfit|uniform|shoe|socks|服|衣)/.test(normalized)) return 'outfit';
  return null;
}

export function safeAppearanceColor(value: string | undefined, fallback: string): string {
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return value.toUpperCase();
}
