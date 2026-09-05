import type { TwinEvidence, TwinProfile, TwinTrait } from '../types';

const DAY = 86_400_000;

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function cloneTrait(trait: TwinTrait): TwinTrait {
  return { ...trait, scope: [...trait.scope], supportIds: [...trait.supportIds], counterIds: [...trait.counterIds] };
}

export function createTwinProfile(id: string, now = new Date().toISOString()): TwinProfile {
  return {
    id, version: 1, identity: {}, currentState: {}, traits: [], boundaries: [], evidence: [], archivedTraits: [], updatedAt: now,
  };
}

export function applyTwinEvidence(profile: TwinProfile, item: TwinEvidence, now = new Date().toISOString()): TwinProfile {
  if (profile.evidence.some((existing) => existing.id === item.id)) return profile;
  const evidence = [...profile.evidence, item];
  const related = evidence.filter((entry) => entry.feature === item.feature && entry.value === item.value);
  const support = related.filter((entry) => entry.polarity === 'support');
  const counter = related.filter((entry) => entry.polarity === 'counter');
  const scopes = unique(support.map((entry) => entry.scope));
  const qualifies = support.length >= 3 && scopes.length >= 2;
  const existing = profile.traits.find((trait) => trait.feature === item.feature);
  let traits = profile.traits.map(cloneTrait);

  if (qualifies) {
    const trait: TwinTrait = {
      feature: item.feature,
      value: item.value,
      status: existing?.status ?? 'candidate',
      scope: scopes,
      supportIds: support.map((entry) => entry.id),
      counterIds: counter.map((entry) => entry.id),
      confidence: 'consistent',
      reviewAt: new Date(Date.parse(now) + 30 * DAY).toISOString(),
    };
    traits = [...traits.filter((entry) => entry.feature !== item.feature), trait];
  } else if (existing) {
    traits = traits.map((trait) => trait.feature === item.feature
      ? { ...trait, counterIds: counter.map((entry) => entry.id), supportIds: support.map((entry) => entry.id) }
      : trait);
  }

  return {
    ...profile,
    version: profile.version + 1,
    currentState: {
      ...profile.currentState,
      [item.feature]: { value: item.value, evidenceId: item.id, expiresAt: new Date(Date.parse(now) + 3 * DAY).toISOString() },
    },
    traits,
    evidence,
    updatedAt: now,
  };
}

export function applyTwinCorrection(
  profile: TwinProfile,
  feature: string,
  userText: string,
  now = new Date().toISOString(),
): TwinProfile {
  const removed = profile.traits.filter((trait) => trait.feature === feature).map((trait) => ({ ...cloneTrait(trait), status: 'stale' as const }));
  return {
    ...profile,
    version: profile.version + 1,
    traits: profile.traits.filter((trait) => trait.feature !== feature).map(cloneTrait),
    archivedTraits: [...profile.archivedTraits.map(cloneTrait), ...removed],
    boundaries: userText.trim() ? [...profile.boundaries, `用户纠正 ${feature}：${userText.trim()}`] : [...profile.boundaries],
    updatedAt: now,
  };
}

export function rollbackTwinProfile(
  current: TwinProfile,
  target: TwinProfile,
  now = new Date().toISOString(),
): TwinProfile {
  return {
    ...target,
    id: current.id,
    version: current.version + 1,
    identity: { ...target.identity },
    currentState: { ...target.currentState },
    traits: target.traits.map(cloneTrait),
    boundaries: [...target.boundaries],
    evidence: [...target.evidence],
    archivedTraits: target.archivedTraits.map(cloneTrait),
    updatedAt: now,
  };
}

