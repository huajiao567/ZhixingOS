/**
 * V4.3 §2.10 / Task 19.2：6 种使用模式预设值
 *
 * 每种模式预设 R/A/D/P/V/S/X 默认值（X = accessibility_profile）。
 * 严格对齐 spec Task 19.2 预设值表，禁止自定义作弊参数。
 *
 * | 模式            | 中文名   | R  | A  | D  | P  | V  | S  | X 特殊                       |
 * | --------------- | -------- | -- | -- | -- | -- | -- | -- | ---------------------------- |
 * | quiet-mirror    | 安静镜子 | R1 | A0 | D1 | P0 | V1 | S0 | 默认字号                    |
 * | action-nav      | 行动导航 | R1 | A2 | D2 | P2 | V1 | S0 | 默认字号                    |
 * | long-project    | 长期项目 | R2 | A1 | D2 | P1 | V2 | S0 | 默认字号                    |
 * | voice-life      | 语音生活 | R1 | A1 | D1 | P1 | V0 | S0 | 语音回读开启                |
 * | explore-growth  | 探索成长 | R3 | A3 | D3 | P2 | V3 | S0 | 默认字号                    |
 * | senior-easy     | 长辈易用 | R1 | A1 | D0 | P1 | V0 | S1 | 大字号 ≥18sp + 语音回读     |
 *
 * D 轴累计授权语义（对齐 SovereigntyScreen D_SOURCES）：
 *   D0 = 事件（始终为 true，最小数据路径基底）
 *   D1 = 承诺   D2 = 假设   D3 = 实验与方法   D4 = 健康与日历
 *   表中 D1/D2/D3 表示「授权到该层级（含以下所有层）」。
 *
 * SubTask 19.4 数据连续性保证：
 *   applyUsageModePreset 返回的 patch 仅含服务契约字段（R/A/D/P/V/S/X），
 *   不包含 events/commitments/hypotheses/experiments/projects/skills/model_corrections
 *   等业务数据。调用方仅 put 到 /api/data/service-contract，不触达业务表。
 *   切换前后 useStore 中业务数组长度不变。
 *
 * SubTask 19.5 全生命周期模式（V4.3 §2.11）：
 *   见文件底部 LIFE_STAGE_MODES —— adult-full 为首发默认，
 *   child / teen / senior 仅保留接口，不进入首发。
 */

import type {
  UsageMode,
  ServiceContract,
  DataScopeAxis,
} from '../types/models';

// ---------- 类型定义 ----------

/** 服务契约补丁：与 api.serviceContract.put(body) 入参一致 */
export type ServiceContractPatch = Partial<ServiceContract>;

/** Glyph 名称联合类型 —— 与 src/components/glyphs.tsx 中 Glyph 的 name prop 保持同步 */
export type GlyphName =
  | 'today' | 'mirror' | 'progress' | 'secretary' | 'data'
  | 'check' | 'warn' | 'flask' | 'clock' | 'arrow'
  | 'shield' | 'voice' | 'photo' | 'pen' | 'silence'
  | 'book' | 'layers';

/** UI 展示用 label */
export interface UsageModeLabel {
  /** 中文名 */
  name: string;
  /** 一句生活语言描述（对齐 spec A35 词典，禁用「赋能/闭环/抓手/画像」等词） */
  description: string;
  /** 配套图标 Glyph 名称 */
  icon: GlyphName;
}

// ---------- 内部辅助：构造 data_scope ----------

/**
 * 构造累计授权的 data_scope 对象。
 * @param maxLevel 授权到该层级（含以下所有层）。D0=事件始终为 true。
 *                 D1=承诺 D2=假设 D3=实验与方法 D4=健康与日历
 */
function dataScopeUpTo(maxLevel: 0 | 1 | 2 | 3 | 4): Record<DataScopeAxis, boolean> {
  return {
    D0: true,
    D1: maxLevel >= 1,
    D2: maxLevel >= 2,
    D3: maxLevel >= 3,
    D4: maxLevel >= 4,
  };
}

// ---------- 6 种使用模式预设值 ----------

export const USAGE_MODE_PRESETS: Record<UsageMode, ServiceContractPatch> = {
  'quiet-mirror': {
    reflection_depth: 'R1',
    agency_level: 'A0',
    data_scope: dataScopeUpTo(1),
    proactivity: 'P0',
    avatar: 'V1',
    supporter_mode: 'S0',
    accessibility_profile: {
      font_scale: 1.0,
      voice_readout: false,
      single_confirm: false,
      usage_mode: 'quiet-mirror',
    },
  },

  'action-nav': {
    reflection_depth: 'R1',
    agency_level: 'A2',
    data_scope: dataScopeUpTo(2),
    proactivity: 'P2',
    avatar: 'V1',
    supporter_mode: 'S0',
    accessibility_profile: {
      font_scale: 1.0,
      voice_readout: false,
      single_confirm: false,
      usage_mode: 'action-nav',
    },
  },

  'long-project': {
    reflection_depth: 'R2',
    agency_level: 'A1',
    data_scope: dataScopeUpTo(2),
    proactivity: 'P1',
    avatar: 'V2',
    supporter_mode: 'S0',
    accessibility_profile: {
      font_scale: 1.0,
      voice_readout: false,
      single_confirm: false,
      usage_mode: 'long-project',
    },
  },

  'voice-life': {
    reflection_depth: 'R1',
    agency_level: 'A1',
    data_scope: dataScopeUpTo(1),
    proactivity: 'P1',
    avatar: 'V0',
    supporter_mode: 'S0',
    accessibility_profile: {
      font_scale: 1.0,
      voice_readout: true,  // 语音回读开启（spec Task 19.2）
      single_confirm: false,
      usage_mode: 'voice-life',
    },
  },

  'explore-growth': {
    reflection_depth: 'R3',
    agency_level: 'A3',
    data_scope: dataScopeUpTo(3),
    proactivity: 'P2',
    avatar: 'V3',
    supporter_mode: 'S0',
    accessibility_profile: {
      font_scale: 1.0,
      voice_readout: false,
      single_confirm: false,
      usage_mode: 'explore-growth',
    },
  },

  'senior-easy': {
    reflection_depth: 'R1',
    agency_level: 'A1',
    data_scope: dataScopeUpTo(0),  // 仅事件，最小数据路径
    proactivity: 'P1',
    avatar: 'V0',  // 3D 关闭
    supporter_mode: 'S1',
    accessibility_profile: {
      // font_scale 1.5 配合 seniorFont（body 18sp）—— 主题层已保证 ≥18sp
      // 这里 font_scale 用于服务端记录与未来跨端一致渲染
      font_scale: 1.5,
      voice_readout: true,  // 语音回读开启（spec Task 19.2）
      single_confirm: true, // 一步一确认（spec A36.8 适老）
      usage_mode: 'senior-easy',
    },
  },
};

// ---------- UI 展示标签 ----------

export const USAGE_MODE_LABELS: Record<UsageMode, UsageModeLabel> = {
  'quiet-mirror': {
    name: '安静镜子',
    description: '多观察、少打扰。我 mostly 只看，偶尔轻提一句。',
    icon: 'mirror',
  },
  'action-nav': {
    name: '行动导航',
    description: '帮你把事做完。可以准备草稿和方案，你确认后执行。',
    icon: 'arrow',
  },
  'long-project': {
    name: '长期项目',
    description: '跟踪长期目标，定期回看进度和卡点。',
    icon: 'progress',
  },
  'voice-life': {
    name: '语音生活',
    description: '语音优先，文字简洁。适合不想多打字的时候。',
    icon: 'voice',
  },
  'explore-growth': {
    name: '探索成长',
    description: '深度反思，多尝试小实验，看什么真的有用。',
    icon: 'flask',
  },
  'senior-easy': {
    name: '长辈易用',
    description: '大字号、语音回读、一步一确认。适合长辈或不想看小字的时候。',
    icon: 'shield',
  },
};

/** 6 种使用模式的有序列表（用于 UI 渲染） */
export const USAGE_MODE_ORDER: UsageMode[] = [
  'quiet-mirror',
  'action-nav',
  'long-project',
  'voice-life',
  'explore-growth',
  'senior-easy',
];

// ---------- 工具函数 ----------

/**
 * 应用使用模式预设：返回服务契约补丁。
 *
 * 调用方应：
 *   1. useServiceContractStore.update(userId, applyUsageModePreset(mode))
 *   2. 若 mode === 'senior-easy'，调用 setAppScheme('senior') 同步主题字号
 *   3. 若 mode !== 'senior-easy' 且当前 scheme === 'senior'，调用 setAppScheme('system')
 *
 * SubTask 19.4：返回的 patch 仅含 R/A/D/P/V/S/X，不触达业务数据。
 */
export function applyUsageModePreset(mode: UsageMode): ServiceContractPatch {
  const preset = USAGE_MODE_PRESETS[mode];
  if (!preset) {
    throw new Error(`未知的 usage_mode: ${mode}`);
  }
  // 返回浅拷贝，避免调用方误改常量
  // 注：data_scope 显式构造字段而非 spread —— TypeScript 对 Record 的 spread 会产生可选属性，
  // 与 Record<DataScopeAxis, boolean>（全必填）不兼容
  const ds = preset.data_scope;
  const dataScopeCopy: Record<DataScopeAxis, boolean> | undefined = ds
    ? { D0: ds.D0, D1: ds.D1, D2: ds.D2, D3: ds.D3, D4: ds.D4 }
    : undefined;
  return {
    ...preset,
    accessibility_profile: { ...preset.accessibility_profile },
    data_scope: dataScopeCopy,
  };
}

// ---------- SubTask 19.5：全生命周期模式接口（V4.3 §2.11） ----------

/**
 * 全生命周期模式（V4.3 §2.11）。
 *
 * 首发仅启用 'adult-full'（成年人完整模式，默认）。
 * 'child' / 'teen' / 'senior' 三种模式 V4.3 §2.11 已明确不进入首发，
 * 仅保留类型与接口，便于后续阶段实现：
 *   - child：儿童模式（需要监护人同意、内容过滤、强化隐私）
 *   - teen：青少年模式（家长可见性、内容分级、教育导向）
 *   - senior：老年模式（与 usage_mode='senior-easy' 互补的领域逻辑裁剪）
 *
 * 注意：'senior' 此处是 life_stage_mode（人口学模式），
 *      与 usage_mode 中的 'senior-easy'（使用方式）是两个独立维度。
 *      前者裁剪业务逻辑（如关闭复杂实验配置），后者裁剪交互方式（大字号、语音）。
 */
export type LifeStageMode = 'adult-full' | 'child' | 'teen' | 'senior';

/** 首发可用的全生命周期模式（仅 adult-full） */
export const AVAILABLE_LIFE_STAGE_MODES: LifeStageMode[] = ['adult-full'];

/** 全生命周期模式默认值 */
export const DEFAULT_LIFE_STAGE_MODE: LifeStageMode = 'adult-full';

/** 全生命周期模式标签（仅用于未来 UI 展示，首发不渲染选择器） */
export const LIFE_STAGE_MODE_LABELS: Record<LifeStageMode, { name: string; description: string; available: boolean }> = {
  'adult-full': {
    name: '成年人完整模式',
    description: '完整功能开放，由用户自主选择使用方式。',
    available: true,
  },
  'child': {
    name: '儿童模式',
    description: '需监护人同意，内容过滤，强化隐私保护。',
    available: false,  // V4.3 §2.11 不进入首发
  },
  'teen': {
    name: '青少年模式',
    description: '家长可见性配置，内容分级，教育导向。',
    available: false,  // V4.3 §2.11 不进入首发
  },
  'senior': {
    name: '老年模式',
    description: '业务逻辑简化，与「长辈易用」使用方式互补。',
    available: false,  // V4.3 §2.11 不进入首发
  },
};
