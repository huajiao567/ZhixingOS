import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  AvatarIdentity,
  AvatarRenderState,
  CalibrationBias,
  DailySignals,
  MirrorSnapshot,
  PersonalBaseline,
} from '../types/avatar';
import { inferDailyState } from '../avatar/stateInference';
import {
  buildSnapshot,
  DEFAULT_RENDER_STATE,
  mapStateToRender,
  smoothRenderState,
} from '../avatar/stateMapper';
import { clamp } from '../avatar/math';

export const DEFAULT_IDENTITY: AvatarIdentity = {
  faceWidth: 0.52,
  faceHeight: 0.55,
  jawRoundness: 0.68,
  eyeSize: 0.58,
  eyeSpacing: 0.50,
  browAngle: 0.46,
  noseSize: 0.45,
  mouthWidth: 0.52,
  bodyScale: 0.52,
  shoulderWidth: 0.54,
  skinTone: '#F0B98E',
  hairColor: '#1A1C22',
  shirtColor: '#536BE8',
  hairStyle: 'short',
};

export const DEFAULT_BASELINE: PersonalBaseline = {
  sleepHours: 7.4,
  sleepQuality: 0.72,
  hrvRelative: 1,
  steps: 7000,
  workoutMinutes: 25,
  focusMinutes: 100,
  taskCompletion: 0.62,
  projectMomentum: 0.56,
};

export const DEFAULT_SIGNALS: DailySignals = {
  sleepHours: 6.7,
  sleepQuality: 0.63,
  hrvRelative: 0.91,
  steps: 5600,
  workoutMinutes: 20,
  focusMinutes: 118,
  taskCompletion: 0.64,
  projectMomentum: 0.68,
  scheduleLoad: 0.64,
  diary: '今天有些疲惫，但项目取得了真实进展，晚上想继续完成一个小里程碑。',
};

const DEFAULT_CALIBRATION: CalibrationBias = {
  fatigue: 0,
  smile: 0,
  posture: 0,
};

type WebStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

// zustand persist 需要一个稳定的 storage 引用；web 端无 AsyncStorage 原生模块，
// 回退到 localStorage 以保证 Web 预览不报错、且体验一致。
function resolveStorage() {
  if (Platform.OS !== 'web') return AsyncStorage;
  const ls = (globalThis as unknown as { localStorage?: WebStorageLike }).localStorage;
  if (!ls) return AsyncStorage;
  return {
    getItem: (name: string) => Promise.resolve(ls.getItem(name)),
    setItem: (name: string, value: string) => Promise.resolve(ls.setItem(name, value)),
    removeItem: (name: string) => Promise.resolve(ls.removeItem(name)),
  };
}

function computeSnapshot(
  signals: DailySignals,
  baseline: PersonalBaseline,
  calibration: CalibrationBias,
  previous: AvatarRenderState,
): MirrorSnapshot {
  const state = inferDailyState(signals, baseline);
  const rawRender = mapStateToRender(state, calibration);
  const render = smoothRenderState(previous, rawRender, 0.38);
  return buildSnapshot(state, render);
}

const initialSnapshot = computeSnapshot(
  DEFAULT_SIGNALS,
  DEFAULT_BASELINE,
  DEFAULT_CALIBRATION,
  DEFAULT_RENDER_STATE,
);

interface Mirror3DStore {
  identity: AvatarIdentity;
  baseline: PersonalBaseline;
  signals: DailySignals;
  calibration: CalibrationBias;
  snapshot: MirrorSnapshot;
  updateIdentity: (patch: Partial<AvatarIdentity>) => void;
  updateSignals: (patch: Partial<DailySignals>) => void;
  updateBaseline: (patch: Partial<PersonalBaseline>) => void;
  recompute: () => void;
  feedback: (kind: 'accurate' | 'tooTired' | 'tooHappy' | 'tooSlouched') => void;
  loadScenario: (kind: 'focused' | 'active' | 'recovery' | 'balanced') => void;
  resetAll: () => void;
}

export const useMirror3DStore = create<Mirror3DStore>()(
  persist(
    (set, get) => ({
      identity: DEFAULT_IDENTITY,
      baseline: DEFAULT_BASELINE,
      signals: DEFAULT_SIGNALS,
      calibration: DEFAULT_CALIBRATION,
      snapshot: initialSnapshot,

      updateIdentity: (patch) => set((state) => ({ identity: { ...state.identity, ...patch } })),

      updateSignals: (patch) => {
        set((state) => ({ signals: { ...state.signals, ...patch } }));
      },

      updateBaseline: (patch) => set((state) => ({ baseline: { ...state.baseline, ...patch } })),

      recompute: () => {
        const state = get();
        set({
          snapshot: computeSnapshot(
            state.signals,
            state.baseline,
            state.calibration,
            state.snapshot.render,
          ),
        });
      },

      feedback: (kind) => {
        const state = get();
        const next = { ...state.calibration };
        if (kind === 'tooTired') next.fatigue = clamp(next.fatigue - 0.08, -0.25, 0.25);
        if (kind === 'tooHappy') next.smile = clamp(next.smile - 0.08, -0.25, 0.25);
        if (kind === 'tooSlouched') next.posture = clamp(next.posture + 0.08, -0.25, 0.25);
        if (kind === 'accurate') {
          next.fatigue *= 0.9;
          next.smile *= 0.9;
          next.posture *= 0.9;
        }
        set({ calibration: next });
        get().recompute();
      },

      loadScenario: (kind) => {
        const scenarios: Record<typeof kind, DailySignals> = {
          focused: {
            ...DEFAULT_SIGNALS,
            sleepHours: 7.6,
            sleepQuality: 0.78,
            focusMinutes: 190,
            taskCompletion: 0.82,
            projectMomentum: 0.86,
            scheduleLoad: 0.52,
            diary: '今天专注推进了重要项目，完成关键里程碑，感觉长期方向很值得。',
          },
          active: {
            ...DEFAULT_SIGNALS,
            sleepHours: 7.3,
            sleepQuality: 0.75,
            steps: 12500,
            workoutMinutes: 68,
            focusMinutes: 70,
            scheduleLoad: 0.42,
            diary: '今天运动很多，状态轻快，也和朋友见面交流，心情不错。',
          },
          recovery: {
            ...DEFAULT_SIGNALS,
            sleepHours: 5.3,
            sleepQuality: 0.38,
            hrvRelative: 0.72,
            steps: 1800,
            workoutMinutes: 0,
            focusMinutes: 35,
            taskCompletion: 0.30,
            projectMomentum: 0.28,
            scheduleLoad: 0.79,
            diary: '昨晚没睡好，今天很累，任务有些堆积，我需要休息并减少安排。',
          },
          balanced: DEFAULT_SIGNALS,
        };
        set({ signals: scenarios[kind] });
        get().recompute();
      },

      resetAll: () => set({
        identity: DEFAULT_IDENTITY,
        baseline: DEFAULT_BASELINE,
        signals: DEFAULT_SIGNALS,
        calibration: DEFAULT_CALIBRATION,
        snapshot: initialSnapshot,
      }),
    }),
    {
      name: 'zhixing-3d-mirror-demo-v1',
      storage: createJSONStorage(resolveStorage),
      partialize: (state) => ({
        identity: state.identity,
        baseline: state.baseline,
        signals: state.signals,
        calibration: state.calibration,
        snapshot: state.snapshot,
      }),
    },
  ),
);
