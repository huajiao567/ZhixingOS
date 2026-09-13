import type { AvatarProfileV2 } from './avatarTypes';

export type ModelIdentityMorphField = 'eyeSize' | 'mouthWidth';

export interface ModelIdentityMorphSpec {
  field: ModelIdentityMorphField;
  /** Exact structural morph names only. Expression/lip-sync aliases are intentionally excluded. */
  targetNames: readonly string[];
  direction: 'positive-only';
  description: string;
}

/**
 * Model-capability bridge for structural identity morphs that are semantically
 * equivalent to existing ZhixingOS identity fields.
 *
 * Keep this deliberately narrow:
 * - `eye_size` really represents eye size, so it can map to `eyeSize`.
 * - `mouth_width` really represents mouth width, so it can map to `mouthWidth`.
 * - the research candidate's `face_jaw_width` is NOT `jawRoundness`.
 * - the research candidate's `nose_width` is NOT the broader `noseSize` field.
 *
 * A target being present does not make the current production AvatarSample_G
 * support that field. Product/UI capability labels remain model-specific and
 * must stay `stored-only` until the production asset is independently proven.
 */
export const MODEL_IDENTITY_MORPH_SPECS: readonly ModelIdentityMorphSpec[] = [
  {
    field: 'eyeSize',
    targetNames: ['eye_size'],
    direction: 'positive-only',
    description: '结构性眼睛尺寸 morph；仅在模型明确提供 eye_size 时应用。',
  },
  {
    field: 'mouthWidth',
    targetNames: ['mouth_width'],
    direction: 'positive-only',
    description: '结构性嘴宽 morph；仅在模型明确提供 mouth_width 时应用。',
  },
] as const;

const SPEC_BY_TARGET = new Map<string, ModelIdentityMorphSpec>();
for (const spec of MODEL_IDENTITY_MORPH_SPECS) {
  for (const target of spec.targetNames) SPEC_BY_TARGET.set(target, spec);
}

export function resolveModelIdentityMorphSpec(targetName: string): ModelIdentityMorphSpec | null {
  return SPEC_BY_TARGET.get(targetName.trim()) ?? null;
}

/**
 * The pinned MakeHuman research candidate currently carries increment-only
 * structural targets. Therefore values below the neutral midpoint cannot be
 * represented truthfully and must not be faked by negative weights.
 */
export function toPositiveOnlyIdentityMorphWeight(value: number): number {
  const finite = Number.isFinite(value) ? value : 0.5;
  const clamped = Math.max(0, Math.min(1, finite));
  return Math.max(0, Math.min(1, (clamped - 0.5) * 2));
}

export function deriveModelIdentityMorphWeights(
  profile: AvatarProfileV2,
): Record<ModelIdentityMorphField, number> {
  const face = profile.identity.faceMorphs ?? {};
  return {
    eyeSize: toPositiveOnlyIdentityMorphWeight(face.eyeSize ?? 0.5),
    mouthWidth: toPositiveOnlyIdentityMorphWeight(face.mouthWidth ?? 0.5),
  };
}
