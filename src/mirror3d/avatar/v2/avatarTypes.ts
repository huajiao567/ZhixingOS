/**
 * Satori Avatar v2 — 可演化数字孪生四层模型
 *
 * 四层职责：
 *   AvatarIdentity   核心身份层 —— 长期稳定，只经用户确认变更
 *   AvatarAppearance 个性外观层 —— 用户主动选择的长期审美
 *   AvatarDailyState 每日状态层 —— 当日轻微状态，可过期回归中性
 *   AvatarTimeline   时间版本层 —— 阶段形象与生活痕迹，只增不覆盖
 *
 * 第三方生成服务一律经 Provider Adapter 隔离（见 avatarProviderAdapter.ts）。
 */

/* ───────────────────── 核心身份层 ───────────────────── */

export interface AvatarIdentityV2 {
  avatarId: string;
  /** 身份结构版本；任何变更都需要用户确认并递增 */
  identityVersion: string;
  /** 统一人形骨骼版本（satori_humanoid_1 = KayKit 兼容 41 骨） */
  rigVersion: 'satori_humanoid_1';
  /** 基础模型资源（本地缓存 URI 或打包资源） */
  baseModelUri: string;
  /** 脸型/体型参数（0-1 归一），来源：手动捏脸或用户确认的候选 */
  faceMorphs: Record<string, number>;
  bodyMorphs: Record<string, number>;
  skinMaterial: { baseColor: string; roughness: number };
  /** 用户确认时间（ISO） */
  confirmedAt: string;
}

/* ───────────────────── 个性外观层 ───────────────────── */

export interface AvatarAppearance {
  /** 每次用户确认的外观修改递增；不得自动递增 */
  appearanceVersion: number;
  characterId: 'mage' | 'knight' | 'rogue' | 'barbarian' | 'rogue_hooded';
  hairId: string;
  /** 生产 VRM 可安全映射的用户确认发色；旧档案缺失时由渲染器使用模型原色。 */
  hairColor?: string;
  glassesId: string | null;
  outfitId: string;
  /** 生产 VRM 可安全映射的服装主色；只作用于识别出的服装材质。 */
  outfitColor?: string;
  accessories: string[];
  paletteId: string;
  /** 卡通化程度 0（写实）-1（卡通），默认 0.8 */
  toonLevel: number;
  scenePreference: 'room' | 'desk' | 'outdoor' | 'rest' | 'void';
}

/* ──────────────── 行为气质（慢变量） ───────────────────── */

export interface AvatarBehaviorStyle {
  /** 待机动画频率 0-1 */
  idleFrequency: number;
  /** 动作幅度 0-1 */
  gestureAmplitude: number;
  /** 视线直接程度 0-1（高=更常看向用户） */
  gazeDirectness: number;
  /** 动作节奏 0-1（映射 timeScale 0.85-1.15） */
  motionTempo: number;
}

/* ──────────────── 成长痕迹（极慢变量：周/月级别，只增不回退） ───────────────────── */

/**
 * 成长痕迹：长期行为累积在外观上留下的微弱印记
 * 设计原则：
 * - 所有值范围 0-1，默认0（初始中性）
 * - 增长极慢：单日增量上限0.003，连续300+天达到满值（约一年）
 * - 只增不回退（成长是不可逆的痕迹）
 * - 幅度极端克制：最终效果不超过BlendShape的15%，避免"变脸"
 * - 每个trait对应一种长期行为模式的外在体现
 */
export interface AvatarGrowthTraits {
  /** 沉稳度：长期高专注 → 眼神更坚定、眉头微收，嘴角略平 */
  composure: number;
  /** 活力感：长期高精力 → 眉眼更舒展，嘴角微扬 */
  vibrancy: number;
  /** 亲和感：长期高社交开放 → 眼神更柔和，嘴角放松 */
  warmth: number;
  /** 从容度：长期低压力 → 眉间舒展，下颌放松 */
  ease: number;
  /** 最后更新时间 */
  updatedAt: string;
}

export const NEUTRAL_GROWTH_TRAITS: AvatarGrowthTraits = {
  composure: 0,
  vibrancy: 0,
  warmth: 0,
  ease: 0,
  updatedAt: new Date(0).toISOString(),
};

/* ───────────────────── 每日状态层 ───────────────────── */

export interface AvatarDailyStateV2 {
  energy: number;          // 0-1
  tension: number;         // 0-1
  focus: number;           // 0-1
  socialOpenness: number;  // 0-1
  /** 到期回归中性（ISO）；空表示长期中性 */
  expiresAt: string | null;
  /** 本状态依据的证据类型（用于「为什么」解释） */
  evidenceTypes: string[];
  /** 用户是否纠正过本日状态（用户优先门） */
  userOverridden: boolean;
}

export const NEUTRAL_DAILY_STATE: AvatarDailyStateV2 = {
  energy: 0.5,
  tension: 0.4,
  focus: 0.5,
  socialOpenness: 0.5,
  expiresAt: null,
  evidenceTypes: [],
  userOverridden: false,
};

/* ──────────────── 生活数据自适应层（可衰减、可撤回） ───────────────────── */

export interface AvatarAdaptiveAppearance {
  /** 用户总开关；关闭时渲染器必须保持中性。 */
  enabled: boolean;
  /** 眼下疲劳可见度 0-1；只由近期睡眠与夜间使用摘要驱动。 */
  darkCircles: number;
  /** 恢复需求 0-1；用于动作、呼吸和眼神，不等同于健康诊断。 */
  recoveryNeed: number;
  /** 紧绷程度 0-1；不得命名为焦虑症或其他医学结论。 */
  tension: number;
  /** 餐后短时饱足 0-1；不会改变长期体型。 */
  postMealFullness: number;
  /** 有证据门的长期体型微调，绝对值最多 0.06。 */
  bodyShapeDelta: number;
  confidence: number;
  reasons: string[];
  evidenceRefs: string[];
  derivedAt: string;
  expiresAt: string | null;
  userOverridden: boolean;
}

export const NEUTRAL_ADAPTIVE_APPEARANCE: AvatarAdaptiveAppearance = {
  enabled: true,
  darkCircles: 0,
  recoveryNeed: 0,
  tension: 0,
  postMealFullness: 0,
  bodyShapeDelta: 0,
  confidence: 0,
  reasons: [],
  evidenceRefs: [],
  derivedAt: new Date(0).toISOString(),
  expiresAt: null,
  userOverridden: false,
};

/* ───────────────────── 时间版本层 ───────────────────── */

export interface AvatarTimelineEntry {
  timelineVersion: number;
  kind: 'created' | 'identity_change' | 'appearance_change' | 'stage_confirmed' | 'project_phase' | 'user_saved';
  label: string;
  identityVersion: string;
  appearanceVersion: number;
  /** 轻量快照（渲染参数，不含原始照片） */
  snapshot: {
    characterId: AvatarAppearance['characterId'];
    paletteId: string;
    behavior: AvatarBehaviorStyle;
  };
  createdAt: string;
  /** 关联的个人模型版本；时间线只读取版本摘要，不读取原始弱证据。 */
  sourceModelVersionId?: string;
  sourceModelVersion?: string;
  /** 既有版本补录时如实标注首次同步捕获，避免伪造历史外观。 */
  snapshotProvenance?: 'captured_on_first_sync';
  capturedAt?: string;
  /**
   * How this confirmed identity/appearance version was authored. Historical
   * entries may omit this field.
   */
  personalizationSource?: 'manual' | 'photo_assisted';
  /**
   * Opaque local evidence receipts only; never raw image/audio paths, URIs or
   * pixel payloads.
   */
  sourceRefs?: string[];
  note?: string;
}

/* ───────────────────── 每日补丁 ───────────────────── */

export interface AvatarPatch {
  patchId: string;
  patchType: 'daily_state' | 'appearance_candidate' | 'behavior_style';
  changes: Partial<{
    energy: number;
    tension: number;
    focus: number;
    socialOpenness: number;
  }>;
  evidenceTypes: string[];
  confidence: number;        // 0-1
  expiresInHours: number;
  reversible: true;
  createdAt: string;
}

/* ───────────────────── 权限 ───────────────────── */

export interface AvatarPermissions {
  cameraMirror: boolean;
  photoChangeDetection: boolean;
  healthDrivenMotion: boolean;
  /** 生活数据是否可以驱动临时表情和姿态。 */
  lifeDataAdaptation: boolean;
  /** 跨日趋势是否可以驱动克制的体型变化。 */
  bodyTrendAdaptation: boolean;
}

/* ───────────────────── 聚合档案 ───────────────────── */

export interface AvatarProfileV2 {
  identity: AvatarIdentityV2;
  appearance: AvatarAppearance;
  behaviorStyle: AvatarBehaviorStyle;
  /** 成长痕迹（极慢变量，长期行为累积的外观变化） */
  growthTraits: AvatarGrowthTraits;
  dailyState: AvatarDailyStateV2;
  adaptiveAppearance: AvatarAdaptiveAppearance;
  timeline: AvatarTimelineEntry[];
  permissions: AvatarPermissions;
}

/* ───────────────────── 渲染映射输出 ───────────────────── */

export interface AvatarRuntimePose {
  /** 动画 timeScale（0.85-1.15） */
  timeScale: number;
  /** 脊柱前倾/放松（弧度，±0.06） */
  spineRelax: number;
  /** 头部视线活跃（弧度幅值 0-0.12） */
  gazeAmplitude: number;
  /** 环境暖色强度（0-1） */
  ambientWarmth: number;
  /** 待机动画选择 */
  idleClip: 'Idle' | 'Sit_Chair_Idle';
  /** 合并生活数据后的有效能量/紧绷，仅供运行时渲染。 */
  effectiveEnergy: number;
  effectiveTension: number;
  /** 眼下疲劳层可见度与全身横向微调。 */
  darkCircleOpacity: number;
  bodyScaleXZ: number;
}

/* ─────────────────���─── 默认档案（首次创建） ───────────────────── */

export function createDefaultAvatarProfile(nowIso: string): AvatarProfileV2 {
  return {
    identity: {
      avatarId: 'avatar_user_001',
      identityVersion: '1.0.0',
      rigVersion: 'satori_humanoid_1',
      baseModelUri: 'builtin_vrm_sample_g',
      faceMorphs: {},
      bodyMorphs: {},
      skinMaterial: { baseColor: '#F2C89B', roughness: 0.7 },
      confirmedAt: nowIso,
    },
    appearance: {
      appearanceVersion: 1,
      characterId: 'mage',
      hairId: 'mage_default',
      hairColor: '#2A2028',
      glassesId: null,
      outfitId: 'robe_default',
      outfitColor: '#536BE8',
      accessories: [],
      paletteId: 'indigo_quiet',
      toonLevel: 0.8,
      scenePreference: 'room',
    },
    behaviorStyle: {
      idleFrequency: 0.25,
      gestureAmplitude: 0.35,
      gazeDirectness: 0.4,
      motionTempo: 0.5,
    },
    growthTraits: { ...NEUTRAL_GROWTH_TRAITS, updatedAt: nowIso },
    dailyState: { ...NEUTRAL_DAILY_STATE },
    adaptiveAppearance: {
      ...NEUTRAL_ADAPTIVE_APPEARANCE,
      derivedAt: nowIso,
    },
    timeline: [
      {
        timelineVersion: 1,
        kind: 'created',
        label: '初始创建',
        identityVersion: '1.0.0',
        appearanceVersion: 1,
        snapshot: {
          characterId: 'mage',
          paletteId: 'indigo_quiet',
          behavior: { idleFrequency: 0.25, gestureAmplitude: 0.35, gazeDirectness: 0.4, motionTempo: 0.5 },
        },
        createdAt: nowIso,
      },
    ],
    permissions: {
      cameraMirror: false,
      photoChangeDetection: false,
      healthDrivenMotion: false,
      lifeDataAdaptation: true,
      bodyTrendAdaptation: true,
    },
  };
}
