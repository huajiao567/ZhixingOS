/**
 * Satori Avatar v2 — 档案 Store（zustand + AsyncStorage 持久化）
 *
 * 回退门：外观/身份相关修改均可撤回；时间线只增不覆盖。
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AvatarAppearance,
  AvatarAdaptiveAppearance,
  AvatarPatch,
  AvatarPermissions,
  AvatarProfileV2,
  AvatarTimelineEntry,
} from '../avatar/v2/avatarTypes';
import { createDefaultAvatarProfile , NEUTRAL_ADAPTIVE_APPEARANCE , NEUTRAL_GROWTH_TRAITS } from '../avatar/v2/avatarTypes';
import {
  applyDailyPatch,
  applyExpiry,
  applyUserCorrection,
  resetDailyOverride,
  evaluatePatch,
  updateGrowthTraits,
} from '../avatar/v2/avatarPatchEngine';
import { expireAdaptiveAppearance } from '../avatar/v2/adaptiveAppearance';
import type { PersonalModelVersion } from '../../types/models';
import { syncModelVersionsToAvatarTimeline } from '../avatar/avatarTimeline';
import {
  nextIdentityVersion,
  normalizeAvatarPersonalizationProvenance,
  personalizationDraftToProfile,
  type AvatarPersonalizationDraft,
  type AvatarPersonalizationProvenance,
} from '../avatar/v2/avatarPersonalization';

const LEGACY_STORAGE_KEY = 'satori_avatar_v2_profile';
let activeStorageKey: string | null = null;

function storageKeyFor(userId: string): string {
  return `satori_avatar_v2_profile:${userId}`;
}

interface AvatarV2State {
  profile: AvatarProfileV2;
  hydrated: boolean;
  /** 最近一次被应用的补丁（供「为什么」解释与撤回） */
  lastAppliedPatch: AvatarPatch | null;
  lastGateReason: string | null;

  hydrate: (userId: string) => Promise<void>;
  /** 应用每日补丁（过七道门） */
  applyPatch: (patch: AvatarPatch) => void;
  /** 撤销最近一个每日补丁（回到中性并标记） */
  revertDailyState: () => void;
  /** 用户纠正当日状态（用户优先门） */
  correctDailyState: (correction: Partial<AvatarProfileV2['dailyState']>) => void;
  /** 过期检查（App 启动与定时调用） */
  tickExpiry: () => void;
  /** 用户确认的外观修改（先预览后确认；递增外观版本并写时间线） */
  confirmAppearance: (next: Partial<AvatarAppearance>, label: string, note?: string) => void;
  /** 将编辑器中的脸型/体格/肤色/发色/服装色作为一个明确确认的数字孪生版本保存。 */
  confirmPersonalization: (
    draft: AvatarPersonalizationDraft,
    label: string,
    note?: string,
    provenance?: AvatarPersonalizationProvenance,
  ) => void;
  /** 保存「此时的我」到时间线 */
  saveTimelineSnapshot: (label: string, note?: string) => void;
  /** 将个人模型版本幂等同步为阶段快照，不读取原始弱证据。 */
  syncModelVersions: (versions: PersonalModelVersion[]) => void;
  /** 权限更新 */
  setPermissions: (p: Partial<AvatarPermissions>) => void;
  /** 应用由标准化生活信号推导的临时外观；不修改身份与已确认外观。 */
  applyAdaptiveAppearance: (appearance: AvatarAdaptiveAppearance) => void;
  /** 清空自适应效果；可选标记为用户纠正，阻止自动覆盖。 */
  resetAdaptiveAppearance: (userOverridden?: boolean) => void;
  /** 账号删除后移除本机完整 Avatar 档案。 */
  clearProfile: () => Promise<void>;
  /** 退出登录时卸载内存中的用户档案，但不删除其本地数据。 */
  releaseProfile: () => void;
}

export const useAvatarV2Store = create<AvatarV2State>((set, get) => ({
  profile: createDefaultAvatarProfile(new Date().toISOString()),
  hydrated: false,
  lastAppliedPatch: null,
  lastGateReason: null,

  hydrate: async (userId) => {
    if (!userId) return;
    activeStorageKey = storageKeyFor(userId);
    try {
      const scopedRaw = await AsyncStorage.getItem(activeStorageKey);
      const legacyRaw = scopedRaw ? null : await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      const raw = scopedRaw ?? legacyRaw;
      if (raw) {
        const parsed = JSON.parse(raw) as AvatarProfileV2;
        // 向后兼容：旧数据缺少growthTraits时填充默认值
        if (!parsed.growthTraits) {
          parsed.growthTraits = { ...NEUTRAL_GROWTH_TRAITS, updatedAt: new Date().toISOString() };
        }
        parsed.appearance = {
          ...parsed.appearance,
          hairColor: parsed.appearance?.hairColor ?? '#2A2028',
          outfitColor: parsed.appearance?.outfitColor ?? '#536BE8',
        };
        if (!parsed.adaptiveAppearance) {
          parsed.adaptiveAppearance = {
            ...NEUTRAL_ADAPTIVE_APPEARANCE,
            derivedAt: new Date().toISOString(),
          };
        }
        parsed.permissions = {
          cameraMirror: parsed.permissions?.cameraMirror ?? false,
          photoChangeDetection: parsed.permissions?.photoChangeDetection ?? false,
          healthDrivenMotion: parsed.permissions?.healthDrivenMotion ?? false,
          lifeDataAdaptation: parsed.permissions?.lifeDataAdaptation ?? true,
          bodyTrendAdaptation: parsed.permissions?.bodyTrendAdaptation ?? true,
        };
        set({ profile: parsed, hydrated: true });
        if (!scopedRaw && legacyRaw) {
          await AsyncStorage.setItem(activeStorageKey, legacyRaw);
          await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
        }
        get().tickExpiry();
        return;
      }
    } catch {
      // 损坏时回退默认档案，不影响主功能
    }
    set({ hydrated: true });
  },

  applyPatch: (patch) => {
    const { profile } = get();
    const gate = evaluatePatch(profile, patch);
    if (!gate.accepted) {
      set({ lastGateReason: gate.reason });
      return;
    }
    const next = applyDailyPatch(profile, patch, new Date().toISOString());
    set({ profile: next, lastAppliedPatch: patch, lastGateReason: null });
    persist(next);
  },

  revertDailyState: () => {
    const { profile } = get();
    const next = applyUserCorrection(profile, {
      energy: 0.5,
      tension: 0.4,
      focus: 0.5,
      socialOpenness: 0.5,
    });
    set({ profile: next, lastAppliedPatch: null });
    persist(next);
  },

  correctDailyState: (correction) => {
    const next = applyUserCorrection(get().profile, correction);
    set({ profile: next });
    persist(next);
  },

  tickExpiry: () => {
    const { profile } = get();
    let next = resetDailyOverride(profile);
    next = applyExpiry(next, new Date().toISOString());
    const adaptiveAppearance = expireAdaptiveAppearance(next.adaptiveAppearance, new Date().toISOString());
    if (adaptiveAppearance !== next.adaptiveAppearance) {
      next = { ...next, adaptiveAppearance };
    }
    // 更新成长痕迹（极慢变量，跨天时微弱增长）
    const growthResult = updateGrowthTraits(next.growthTraits, next.dailyState, new Date().toISOString());
    if (growthResult.changed) {
      next = { ...next, growthTraits: growthResult.traits };
    }
    if (next !== profile || growthResult.changed) {
      set({ profile: next });
      persist(next);
    }
  },

  confirmAppearance: (partial, label, note) => {
    const { profile } = get();
    const appearance: AvatarAppearance = {
      ...profile.appearance,
      ...partial,
      appearanceVersion: profile.appearance.appearanceVersion + 1,
    };
    const entry: AvatarTimelineEntry = {
      timelineVersion: profile.timeline.length + 1,
      kind: 'appearance_change',
      label,
      identityVersion: profile.identity.identityVersion,
      appearanceVersion: appearance.appearanceVersion,
      snapshot: {
        characterId: appearance.characterId,
        paletteId: appearance.paletteId,
        behavior: { ...profile.behaviorStyle },
      },
      createdAt: new Date().toISOString(),
      note,
    };
    const next: AvatarProfileV2 = {
      ...profile,
      appearance,
      timeline: [...profile.timeline, entry],
    };
    set({ profile: next });
    persist(next);
  },

  confirmPersonalization: (draft, label, note, provenance) => {
    const { profile } = get();
    const now = new Date().toISOString();
    const personalized = personalizationDraftToProfile(profile, draft);
    const normalizedProvenance = normalizeAvatarPersonalizationProvenance(provenance);
    const identityVersion = nextIdentityVersion(profile.identity.identityVersion);
    const appearanceVersion = profile.appearance.appearanceVersion + 1;
    const entry: AvatarTimelineEntry = {
      timelineVersion: profile.timeline.length + 1,
      kind: 'identity_change',
      label,
      identityVersion,
      appearanceVersion,
      snapshot: {
        characterId: personalized.appearance.characterId,
        paletteId: personalized.appearance.paletteId,
        behavior: { ...profile.behaviorStyle },
      },
      createdAt: now,
      personalizationSource: normalizedProvenance.mode,
      ...(normalizedProvenance.sourceRefs.length > 0
        ? { sourceRefs: normalizedProvenance.sourceRefs }
        : {}),
      note,
    };
    const next: AvatarProfileV2 = {
      ...personalized,
      identity: {
        ...personalized.identity,
        identityVersion,
        confirmedAt: now,
      },
      appearance: {
        ...personalized.appearance,
        appearanceVersion,
      },
      timeline: [...profile.timeline, entry],
    };
    set({ profile: next });
    persist(next);
  },

  saveTimelineSnapshot: (label, note) => {
    const { profile } = get();
    const entry: AvatarTimelineEntry = {
      timelineVersion: profile.timeline.length + 1,
      kind: 'user_saved',
      label,
      identityVersion: profile.identity.identityVersion,
      appearanceVersion: profile.appearance.appearanceVersion,
      snapshot: {
        characterId: profile.appearance.characterId,
        paletteId: profile.appearance.paletteId,
        behavior: { ...profile.behaviorStyle },
      },
      createdAt: new Date().toISOString(),
      note,
    };
    const next = { ...profile, timeline: [...profile.timeline, entry] };
    set({ profile: next });
    persist(next);
  },

  syncModelVersions: (versions) => {
    const profile = get().profile;
    const next = syncModelVersionsToAvatarTimeline(profile, versions, new Date().toISOString());
    if (next === profile) return;
    set({ profile: next });
    persist(next);
  },

  setPermissions: (p) => {
    const current = get().profile;
    const permissions = { ...current.permissions, ...p };
    const adaptiveAppearance = permissions.lifeDataAdaptation
      ? (permissions.bodyTrendAdaptation
          ? current.adaptiveAppearance
          : { ...current.adaptiveAppearance, bodyShapeDelta: 0 })
      : {
          ...NEUTRAL_ADAPTIVE_APPEARANCE,
          enabled: false,
          derivedAt: new Date().toISOString(),
          userOverridden: true,
        };
    const next = { ...current, permissions, adaptiveAppearance };
    set({ profile: next });
    persist(next);
  },

  applyAdaptiveAppearance: (appearance) => {
    const current = get().profile;
    if (!current.permissions.lifeDataAdaptation || current.adaptiveAppearance.userOverridden) return;
    const nextAppearance = current.permissions.bodyTrendAdaptation
      ? appearance
      : { ...appearance, bodyShapeDelta: 0 };
    const next = { ...current, adaptiveAppearance: nextAppearance };
    set({ profile: next });
    persist(next);
  },

  resetAdaptiveAppearance: (userOverridden = true) => {
    const current = get().profile;
    const next = {
      ...current,
      adaptiveAppearance: {
        ...NEUTRAL_ADAPTIVE_APPEARANCE,
        enabled: current.permissions.lifeDataAdaptation,
        derivedAt: new Date().toISOString(),
        userOverridden,
      },
    };
    set({ profile: next });
    persist(next);
  },

  clearProfile: async () => {
    const key = activeStorageKey;
    const profile = createDefaultAvatarProfile(new Date().toISOString());
    set({ profile, lastAppliedPatch: null, lastGateReason: null, hydrated: true });
    if (key) await AsyncStorage.removeItem(key);
  },

  releaseProfile: () => {
    activeStorageKey = null;
    set({
      profile: createDefaultAvatarProfile(new Date().toISOString()),
      hydrated: false,
      lastAppliedPatch: null,
      lastGateReason: null,
    });
  },
}));

function persist(profile: AvatarProfileV2): void {
  if (!activeStorageKey) return;
  AsyncStorage.setItem(activeStorageKey, JSON.stringify(profile)).catch(() => {
    // 持久化失败不影响运行时
  });
}
