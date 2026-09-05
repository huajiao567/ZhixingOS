import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api } from '../services/api';
import {
  applyTwinCorrection,
  applyTwinEvidence,
  createTwinProfile,
  rollbackTwinProfile,
} from '../ai-native/twin/twinProfile';
import type { TwinEvidence, TwinProfile } from '../ai-native/types';

const STORAGE_PREFIX = 'zhixingos:twin-profile:v1';
const HISTORY_LIMIT = 20;

interface TwinProfileState {
  profile: TwinProfile | null;
  history: TwinProfile[];
  hydratedFor: string | null;
  syncing: boolean;
  error: string | null;
  hydrate: (userId: string) => Promise<void>;
  ingest: (userId: string, evidence: TwinEvidence) => Promise<TwinProfile>;
  correct: (userId: string, feature: string, userText: string) => Promise<TwinProfile>;
  rollback: (userId: string, version: number) => Promise<TwinProfile>;
  sync: (userId: string) => Promise<void>;
}

function key(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

async function persist(userId: string, profile: TwinProfile, history: TwinProfile[]): Promise<void> {
  await AsyncStorage.setItem(key(userId), JSON.stringify({ profile, history: history.slice(-HISTORY_LIMIT) }));
}

export const useTwinProfileStore = create<TwinProfileState>((set, get) => ({
  profile: null,
  history: [],
  hydratedFor: null,
  syncing: false,
  error: null,

  hydrate: async (userId) => {
    if (get().hydratedFor === userId) return;
    const raw = await AsyncStorage.getItem(key(userId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { profile?: TwinProfile; history?: TwinProfile[] };
        if (parsed.profile) {
          set({ profile: parsed.profile, history: parsed.history ?? [], hydratedFor: userId, error: null });
          return;
        }
      } catch {
        await AsyncStorage.removeItem(key(userId));
      }
    }
    const profile = createTwinProfile(`twin-${userId}`);
    await persist(userId, profile, []);
    set({ profile, history: [], hydratedFor: userId, error: null });
  },

  ingest: async (userId, evidence) => {
    await get().hydrate(userId);
    const current = get().profile ?? createTwinProfile(`twin-${userId}`);
    const next = applyTwinEvidence(current, evidence);
    const history = [...get().history, current].slice(-HISTORY_LIMIT);
    await persist(userId, next, history);
    set({ profile: next, history, error: null });
    return next;
  },

  correct: async (userId, feature, userText) => {
    await get().hydrate(userId);
    const current = get().profile ?? createTwinProfile(`twin-${userId}`);
    const next = applyTwinCorrection(current, feature, userText);
    const history = [...get().history, current].slice(-HISTORY_LIMIT);
    await persist(userId, next, history);
    set({ profile: next, history, error: null });
    return next;
  },

  rollback: async (userId, version) => {
    await get().hydrate(userId);
    const current = get().profile ?? createTwinProfile(`twin-${userId}`);
    const target = get().history.find((item) => item.version === version);
    if (!target) throw new Error(`未找到孪生档案版本 ${version}`);
    const next = rollbackTwinProfile(current, target);
    const history = [...get().history, current].slice(-HISTORY_LIMIT);
    await persist(userId, next, history);
    set({ profile: next, history, error: null });
    return next;
  },

  sync: async (userId) => {
    await get().hydrate(userId);
    const profile = get().profile;
    if (!profile) return;
    set({ syncing: true, error: null });
    try {
      await api.put<TwinProfile>('/api/runtime/twin-profile', { profile });
      set({ syncing: false });
    } catch (error) {
      set({ syncing: false, error: error instanceof Error ? error.message : '孪生档案同步失败' });
      throw error;
    }
  },
}));

