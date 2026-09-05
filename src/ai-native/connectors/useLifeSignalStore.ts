import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useAvatarV2Store } from '../../mirror3d/store/useAvatarV2Store';
import { deriveAdaptiveAppearance } from '../../mirror3d/avatar/v2/adaptiveAppearance';
import { validateLifeSignal } from './registry';
import type { LifeConnectorId, LifeSignalObservation } from './types';

const LEGACY_STORAGE_KEY = 'zhixing_life_signal_observations_v1';
const MAX_OBSERVATIONS = 2_000;
let activeStorageKey: string | null = null;

function storageKeyFor(userId: string): string {
  return `zhixing_life_signal_observations_v1:${userId}`;
}

export interface LifeSignalIngestResult {
  accepted: number;
  rejected: number;
  reasons: string[];
}

interface LifeSignalState {
  observations: LifeSignalObservation[];
  hydrated: boolean;
  hydrate: (userId: string) => Promise<void>;
  ingest: (observations: LifeSignalObservation[]) => LifeSignalIngestResult;
  replaceConnector: (connectorId: LifeConnectorId, observations: LifeSignalObservation[]) => LifeSignalIngestResult;
  purgeConnector: (connectorId: LifeConnectorId) => void;
  clear: () => Promise<void>;
  release: () => void;
  recomputeAvatar: () => void;
}

function dedupeAndLimit(observations: LifeSignalObservation[]): LifeSignalObservation[] {
  const byId = new Map<string, LifeSignalObservation>();
  for (const item of observations) byId.set(`${item.connectorId}:${item.id}`, item);
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, MAX_OBSERVATIONS);
}

function persist(observations: LifeSignalObservation[]): void {
  if (!activeStorageKey) return;
  AsyncStorage.setItem(activeStorageKey, JSON.stringify(observations)).catch(() => {
    // 本地持久化失败不会伪装为已同步；调用方仍可从运行时状态查看数据。
  });
}

function applyToAvatar(observations: LifeSignalObservation[]): void {
  const avatar = useAvatarV2Store.getState();
  const appearance = deriveAdaptiveAppearance(observations, {
    enabled: avatar.profile.permissions.lifeDataAdaptation,
    allowBodyTrend: avatar.profile.permissions.bodyTrendAdaptation,
  });
  avatar.applyAdaptiveAppearance(appearance);
}

function validateBatch(observations: LifeSignalObservation[]): {
  accepted: LifeSignalObservation[];
  result: LifeSignalIngestResult;
} {
  const accepted: LifeSignalObservation[] = [];
  const reasons: string[] = [];
  for (const observation of observations) {
    const verdict = validateLifeSignal(observation);
    if (verdict.accepted) accepted.push(observation);
    else reasons.push(verdict.reason);
  }
  return {
    accepted,
    result: {
      accepted: accepted.length,
      rejected: observations.length - accepted.length,
      reasons: [...new Set(reasons)].slice(0, 8),
    },
  };
}

export const useLifeSignalStore = create<LifeSignalState>((set, get) => ({
  observations: [],
  hydrated: false,

  hydrate: async (userId) => {
    if (!userId) return;
    activeStorageKey = storageKeyFor(userId);
    try {
      const scopedRaw = await AsyncStorage.getItem(activeStorageKey);
      const legacyRaw = scopedRaw ? null : await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      const raw = scopedRaw ?? legacyRaw;
      const parsed = raw ? JSON.parse(raw) : [];
      const input = Array.isArray(parsed) ? parsed as LifeSignalObservation[] : [];
      const { accepted } = validateBatch(input);
      const observations = dedupeAndLimit(accepted);
      set({ observations, hydrated: true });
      if (!scopedRaw && legacyRaw) {
        await AsyncStorage.setItem(activeStorageKey, legacyRaw);
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      applyToAvatar(observations);
    } catch {
      set({ observations: [], hydrated: true });
    }
  },

  ingest: (incoming) => {
    const { accepted, result } = validateBatch(incoming);
    const observations = dedupeAndLimit([...accepted, ...get().observations]);
    set({ observations });
    persist(observations);
    applyToAvatar(observations);
    return result;
  },

  replaceConnector: (connectorId, incoming) => {
    const relevant = incoming.filter((item) => item.connectorId === connectorId);
    const { accepted, result } = validateBatch(relevant);
    const observations = dedupeAndLimit([
      ...accepted,
      ...get().observations.filter((item) => item.connectorId !== connectorId),
    ]);
    set({ observations });
    persist(observations);
    applyToAvatar(observations);
    return { ...result, rejected: result.rejected + (incoming.length - relevant.length) };
  },

  purgeConnector: (connectorId) => {
    const observations = get().observations.filter((item) => item.connectorId !== connectorId);
    set({ observations });
    persist(observations);
    applyToAvatar(observations);
  },

  clear: async () => {
    const key = activeStorageKey;
    set({ observations: [] });
    if (key) await AsyncStorage.removeItem(key);
    useAvatarV2Store.getState().resetAdaptiveAppearance(false);
  },

  release: () => {
    activeStorageKey = null;
    set({ observations: [], hydrated: false });
  },

  recomputeAvatar: () => applyToAvatar(get().observations),
}));
