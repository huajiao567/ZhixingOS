/**
 * 知行镜 ZhixingOS 设计系统 v2.0 — 多主题引擎
 *
 * 支持 7 套主题：
 *   - classic-dark    经典靛青暗夜（原默认，向后兼容）
 *   - classic-light   经典靛青白昼
 *   - cyberpunk-scifi 青少年·赛博科幻风（霓虹/全息/发光）
 *   - pink-pop        青少年·糖果粉系（渐变/圆润/甜美）
 *   - ios-minimal     青年人·苹果极简风（留白/毛玻璃/精致）
 *   - senior-easy     老年人·大字高对比（超大字号/极简元素）
 *   - deep-obsidian   暗夜·黑曜石OLED（纯黑/深邃/高级感）
 *
 * 每套主题包含：colors / spacing / radius / font / motion / shadow
 * 运行时通过 useAppTheme() 获取当前主题，setAppTheme() 切换。
 */
import { useSyncExternalStore, useEffect, useRef } from 'react';
import { useColorScheme, Platform, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/* ─────────────────── 类型定义 ─────────────────── */

export type ThemeId =
  | 'morning-mist'
  | 'night-voyage'
  | 'classic-dark'
  | 'classic-light'
  | 'cyberpunk-scifi'
  | 'pink-pop'
  | 'ios-minimal'
  | 'senior-easy'
  | 'deep-obsidian';

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceSoft: string;
  border: string;
  borderSoft: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  primary: string;
  primarySoft: string;
  primaryMuted: string;
  accent: string;
  accentSoft: string;
  green: string;
  greenSoft: string;
  red: string;
  redSoft: string;
  violet: string;
  violetSoft: string;
  teal: string;
  tealSoft: string;
  indigo: string;
  indigoSoft: string;
  indigoMuted: string;
  amber: string;
  amberSoft: string;
  l1: string;
  l2: string;
  l3: string;
  l4: string;
  l5: string;
  l6: string;
  layerFact: string;
  layerExperience: string;
  layerRelation: string;
  layerHypothesis: string;
  layerCommitment: string;
  glow?: string;
  gradientStart?: string;
  gradientEnd?: string;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface ThemeRadius {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export interface ThemeFont {
  hero: number;
  title: number;
  section: number;
  body: number;
  small: number;
  tiny: number;
}

export interface ThemeMotion {
  fast: number;
  normal: number;
  slow: number;
  springDamping: number;
  springStiffness: number;
  pageTransition: 'fade' | 'slide' | 'scale' | 'cube';
}

export interface ThemeShadowToken {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
  /** CSS box-shadow string for React Native Web */
  boxShadow: string;
}

export interface ThemeShadow {
  /** 小阴影：按钮、小卡片 */
  sm: ThemeShadowToken;
  /** 中阴影：标准卡片、IndexPill */
  md: ThemeShadowToken;
  /** 大阴影：浮层、模态框 */
  lg: ThemeShadowToken;
  /** 卡片阴影（向后兼容） */
  card: ThemeShadowToken;
  /** 发光效果 */
  glow?: ThemeShadowToken;
  /** 深色模式小阴影 */
  smDark: ThemeShadowToken;
  /** 深色模式中阴影 */
  mdDark: ThemeShadowToken;
}

/** Helper to build shadow tokens with both RN native props and CSS boxShadow */
function makeShadow(
  color: string, opacity: number, radius: number, offsetX: number, offsetY: number, elevation: number
): ThemeShadowToken {
  const rgba = color.startsWith('#') ? hexToRgba(color, opacity) : color;
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: offsetX, height: offsetY },
    elevation,
    boxShadow: `${offsetX}px ${offsetY}px ${radius}px ${rgba}`,
  };
}

/** Convert hex color to rgba string for CSS box-shadow */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Cross-platform shadow style resolver.
 * On Web: returns CSS boxShadow (avoids RNW deprecation warnings).
 * On Native: returns standard RN shadow props.
 */
export function shadowStyle(token: ThemeShadowToken): ViewStyle {
  if (Platform.OS === 'web') {
    return { boxShadow: token.boxShadow } as ViewStyle;
  }
  return {
    shadowColor: token.shadowColor,
    shadowOpacity: token.shadowOpacity,
    shadowRadius: token.shadowRadius,
    shadowOffset: token.shadowOffset,
    elevation: token.elevation,
  };
}

/** 触控目标尺寸（附录AJ：所有自定义可交互目标 ≥48dp） */
export interface ThemeTouch {
  minTarget: number;  // 最小触控目标尺寸（dp）
}

export interface AppTheme {
  id: ThemeId;
  name: string;
  description: string;
  dark: boolean;
  colors: ThemeColors;
  spacing: ThemeSpacing;
  radius: ThemeRadius;
  font: ThemeFont;
  motion: ThemeMotion;
  shadow: ThemeShadow;
  touch: ThemeTouch;
  avatarScene: 'room' | 'desk' | 'outdoor' | 'rest' | 'neon' | 'candy' | 'void';
  avatarStyle: 'default' | 'cyber' | 'kawaii' | 'minimal' | 'elder' | 'obsidian';
  scene3D: {
    /** 环境光强度（整体基础亮度） */
    ambientIntensity: number;
    /** 主方向光强度（模拟太阳光/主光源） */
    directionalIntensity: number;
    /** 补光强度（消除死黑阴影） */
    fillIntensity: number;
    /** 轮廓光强度（勾勒边缘，增加立体感） */
    rimIntensity: number;
    /** 环境光颜色（整体色温） */
    ambientColor: string;
    /** 主方向光颜色 */
    directionalColor: string;
    /** 补光颜色 */
    fillColor: string;
    /** 轮廓光颜色 */
    rimColor: string;
    /** ACES色调映射曝光值 */
    toneExposure: number;
  };
}

/* ─────────────────── 主题颜色规范化：自动派生别名，消除重复 ─────────────────── */

type ThemeColorsInput = Omit<ThemeColors, 'indigo' | 'indigoSoft' | 'indigoMuted' | 'amber' | 'amberSoft'>;

function normalizeColors(c: ThemeColorsInput): ThemeColors {
  return {
    ...c,
    indigo: c.primary,
    indigoSoft: c.primarySoft,
    indigoMuted: c.primaryMuted,
    amber: c.accent,
    amberSoft: c.accentSoft,
  };
}

/* ─────────────────── 晨雾镜境（V4.8 主推浅色主题） ───────────────────
 * 浅色 · 温润 · 私人 · 轻盈，适合白天与长时间阅读。
 * 低饱和暖灰雾底（非纯白、非奶油），冷暖平衡靛青强调色，柔和赭石辅色。
 * WCAG 对比度：textPrimary/bg ≥14:1 (AAA)，textSecondary/bg ≥5.5:1 (AA)。
 * 色温约 5100K（晨间自然光感），避免儿童App奶油风和蓝紫AI渐变。
 */
const morningMistColors: ThemeColors = normalizeColors({
  bg: '#F4F2ED',           // 暖雾灰底（非纯白），CIELAB L*≈95.8
  surface: '#FBFAF7',      // 表层卡片，极暖白
  surfaceAlt: '#EDE9E2',   // 次表层，雾感分层
  surfaceSoft: '#E4DFD6',  // 按压/选中态
  border: '#D8D2C7',       // 主边框，极淡暖灰
  borderSoft: '#DFDAD0',   // 软边框/分割线
  textPrimary: '#1A1E26',  // 主文字（墨青黑）L*≈10.8，对比≈14.5:1
  textSecondary: '#4C5463',// 次文字 L*≈35.2，对比≈5.8:1（WCAG AA large）
  textTertiary: '#7D8694', // 辅助文字 L*≈54.8，对比≈3.2:1（仅用于非关键文字）
  textInverse: '#FBFAF7',  // 反色文字（深色背景上的白字）
  primary: '#315D52',      // 松针绿：稳定、克制，不使用通用 AI 蓝紫
  primarySoft: 'rgba(49,93,82,0.10)',
  primaryMuted: '#47766A',
  accent: '#B35A43',       // 朱砂辅助色，仅用于重点与警示
  accentSoft: 'rgba(179,90,67,0.10)',
  green: '#2D8B5A',        // 健康绿（沉稳墨绿），H≈149°
  greenSoft: 'rgba(45,139,90,0.10)',
  red: '#C24640',          // 警示红（沉稳砖红，非亮红）
  redSoft: 'rgba(194,70,64,0.10)',
  violet: '#596A63',       // 经验灰绿，与主色同源，避免泛 AI 紫
  violetSoft: 'rgba(89,106,99,0.10)',
  teal: '#2B9085',         // 事实青（沉静青碧）
  tealSoft: 'rgba(43,144,133,0.10)',
  l1: '#2B9085',
  l2: '#596A63',
  l3: '#315D52',
  l4: '#B35A43',
  l5: '#C44A70',
  l6: '#6B7587',
  layerFact: '#315D52',
  layerExperience: '#596A63',
  layerRelation: '#C44A70',
  layerHypothesis: '#B35A43',
  layerCommitment: '#2D8B5A',
});

/* ─────────────────── 夜航镜境（V4.8 主推深色主题） ───────────────────
 * 深色 · 安静 · 沉浸，适合夜间与低光环境。
 * 层次深灰蓝（非纯黑 #000），色温约 7000K（深夜微光感），暖金辅助色保温暖。
 * 关键：3D角色必须保留肤色和材质（暖补光），状态色低饱和不刺眼。
 * WCAG 对比度：textPrimary/bg ≥13:1 (AAA)，textSecondary/bg ≥6:1。
 * 禁止霓虹发光、高饱和蓝紫渐变、元宇宙廉价科幻。
 */
const nightVoyageColors: ThemeColors = normalizeColors({
  bg: '#0C1018',           // 深空蓝灰底（非纯黑），L*≈4.2
  surface: '#141A25',      // 主卡片层
  surfaceAlt: '#1B2231',   // 次表层
  surfaceSoft: '#232C3E',  // 按压/选中/输入框
  border: '#2A3449',       // 主边框（微蓝灰，非高饱和蓝）
  borderSoft: '#1F2738',   // 软边框/分割线
  textPrimary: '#E6EBF3',  // 主文字（冷白，非纯白）L*≈92.3，对比≈14.2:1
  textSecondary: '#9BA6BA',// 次文字 L*≈66.4，对比≈6.3:1 (AA)
  textTertiary: '#727E94', // 辅助文字 L*≈51.8，对比≈3.8:1
  textInverse: '#0C1018',  // 反色文字（浅色背景上的深色字）
  primary: '#8DB7AA',      // 夜间松针绿，保持可读而不发霓虹
  primarySoft: 'rgba(141,183,170,0.14)',
  primaryMuted: '#A9CDC2',
  accent: '#D28A68',       // 暖朱砂
  accentSoft: 'rgba(210,138,104,0.13)',
  green: '#3FA87B',        // 健康绿（沉静森林绿，降低饱和）
  greenSoft: 'rgba(63,168,123,0.13)',
  red: '#D46464',          // 警示红（柔砖红，降低饱和不刺眼）
  redSoft: 'rgba(212,100,100,0.13)',
  violet: '#9EB0A9',       // 夜间经验灰绿
  violetSoft: 'rgba(158,176,169,0.13)',
  teal: '#4CAEA5',         // 事实青（沉静青）
  tealSoft: 'rgba(76,174,165,0.13)',
  l1: '#4CAEA5',
  l2: '#9EB0A9',
  l3: '#8DB7AA',
  l4: '#D28A68',
  l5: '#D16C8D',
  l6: '#808CA3',
  layerFact: '#8DB7AA',
  layerExperience: '#9EB0A9',
  layerRelation: '#D16C8D',
  layerHypothesis: '#D28A68',
  layerCommitment: '#3FA87B',
});

/* ─────────────────── 经典暗夜主题（原默认） ─────────────────── */

const classicDarkColors: ThemeColors = normalizeColors({
  bg: '#0E1116',
  surface: '#171C24',
  surfaceAlt: '#1F2630',
  surfaceSoft: '#242C38',
  border: '#2C3542',
  borderSoft: '#232B36',
  textPrimary: '#EDF1F6',
  textSecondary: '#A9B3C0',
  textTertiary: '#828D9A',
  textInverse: '#0E1116',
  primary: '#5B7CFF',
  primarySoft: 'rgba(91,124,255,0.14)',
  primaryMuted: '#8FA3FF',
  accent: '#E8A13D',
  accentSoft: 'rgba(232,161,61,0.14)',
  green: '#3FB27F',
  greenSoft: 'rgba(63,178,127,0.14)',
  red: '#E15B5B',
  redSoft: 'rgba(225,91,91,0.14)',
  violet: '#9B7BE0',
  violetSoft: 'rgba(155,123,224,0.14)',
  teal: '#4DB6AC',
  tealSoft: 'rgba(77,182,172,0.14)',
  l1: '#4DB6AC',
  l2: '#9B7BE0',
  l3: '#5B7CFF',
  l4: '#E8A13D',
  l5: '#E0638C',
  l6: '#8B99AE',
  layerFact: '#5B7CFF',
  layerExperience: '#9B7BE0',
  layerRelation: '#E0638C',
  layerHypothesis: '#E8A13D',
  layerCommitment: '#3FB27F',
});

/* ─────────────────── 经典白昼主题 ─────────────────── */

const classicLightColors: ThemeColors = normalizeColors({
  bg: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F0F2F7',
  surfaceSoft: '#E8EBF2',
  border: '#D8DDE6',
  borderSoft: '#E0E4ED',
  textPrimary: '#0E1116',
  textSecondary: '#5B647A',
  textTertiary: '#656D7F',
  textInverse: '#FFFFFF',
  primary: '#4A5BE8',
  primarySoft: 'rgba(74,91,232,0.10)',
  primaryMuted: '#6B7DFF',
  accent: '#C77F1F',
  accentSoft: 'rgba(199,127,31,0.10)',
  green: '#2E8E5C',
  greenSoft: 'rgba(46,142,92,0.10)',
  red: '#C8453F',
  redSoft: 'rgba(200,69,63,0.10)',
  violet: '#7755B8',
  violetSoft: 'rgba(119,85,184,0.10)',
  teal: '#2E9488',
  tealSoft: 'rgba(46,148,136,0.10)',
  l1: '#2E9488',
  l2: '#7755B8',
  l3: '#4A5BE8',
  l4: '#C77F1F',
  l5: '#C84B72',
  l6: '#6A7588',
  layerFact: '#4A5BE8',
  layerExperience: '#7755B8',
  layerRelation: '#C84B72',
  layerHypothesis: '#C77F1F',
  layerCommitment: '#2E8E5C',
});

/* ─────────────────── 赛博科幻风（青少年） ─────────────────── */

const cyberpunkColors: ThemeColors = normalizeColors({
  bg: '#0A0A1A',
  surface: '#12122E',
  surfaceAlt: '#1A1A3E',
  surfaceSoft: '#252550',
  border: '#3D3D7A',
  borderSoft: '#2A2A5A',
  textPrimary: '#E8E8FF',
  textSecondary: '#A0A0E0',
  textTertiary: '#7878C0',
  textInverse: '#0A0A1A',
  primary: '#00F0FF',
  primarySoft: 'rgba(0,240,255,0.18)',
  primaryMuted: '#60F8FF',
  accent: '#FF00E5',
  accentSoft: 'rgba(255,0,229,0.18)',
  green: '#00FF88',
  greenSoft: 'rgba(0,255,136,0.18)',
  red: '#FF3366',
  redSoft: 'rgba(255,51,102,0.18)',
  violet: '#A855F7',
  violetSoft: 'rgba(168,85,247,0.18)',
  teal: '#22D3EE',
  tealSoft: 'rgba(34,211,238,0.18)',
  l1: '#22D3EE',
  l2: '#A855F7',
  l3: '#00F0FF',
  l4: '#FBBF24',
  l5: '#FF00E5',
  l6: '#64748B',
  layerFact: '#00F0FF',
  layerExperience: '#A855F7',
  layerRelation: '#FF00E5',
  layerHypothesis: '#FBBF24',
  layerCommitment: '#00FF88',
  glow: 'rgba(0,240,255,0.5)',
  gradientStart: '#00F0FF',
  gradientEnd: '#FF00E5',
});

/* ─────────────────── 糖果粉系（青少年） ─────────────────── */

const pinkPopColors: ThemeColors = normalizeColors({
  bg: '#FFF5F8',
  surface: '#FFFFFF',
  surfaceAlt: '#FFECF2',
  surfaceSoft: '#FFE0EB',
  border: '#FFC2D4',
  borderSoft: '#FFD6E3',
  textPrimary: '#4A1942',
  textSecondary: '#7C4A72',
  textTertiary: '#A07098',
  textInverse: '#FFFFFF',
  primary: '#FF6B9D',
  primarySoft: 'rgba(255,107,157,0.16)',
  primaryMuted: '#FF94B8',
  accent: '#FFB347',
  accentSoft: 'rgba(255,179,71,0.16)',
  green: '#7ED6A5',
  greenSoft: 'rgba(126,214,165,0.16)',
  red: '#FF8A95',
  redSoft: 'rgba(255,138,149,0.16)',
  violet: '#C9A0DC',
  violetSoft: 'rgba(201,160,220,0.16)',
  teal: '#8DE0D8',
  tealSoft: 'rgba(141,224,216,0.16)',
  l1: '#8DE0D8',
  l2: '#C9A0DC',
  l3: '#FF6B9D',
  l4: '#FFB347',
  l5: '#FF8AB5',
  l6: '#B8A5C4',
  layerFact: '#FF6B9D',
  layerExperience: '#C9A0DC',
  layerRelation: '#FF8AB5',
  layerHypothesis: '#FFB347',
  layerCommitment: '#7ED6A5',
  gradientStart: '#FF6B9D',
  gradientEnd: '#FFC2D4',
});

/* ─────────────────── 苹果极简风（青年人） ─────────────────── */

const iosMinimalColors: ThemeColors = normalizeColors({
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceAlt: '#F8F8FC',
  surfaceSoft: '#EBEBF0',
  border: '#E5E5EA',
  borderSoft: '#EDEDF2',
  textPrimary: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',
  textInverse: '#FFFFFF',
  primary: '#007AFF',
  primarySoft: 'rgba(0,122,255,0.12)',
  primaryMuted: '#5AC8FA',
  accent: '#FF9500',
  accentSoft: 'rgba(255,149,0,0.12)',
  green: '#34C759',
  greenSoft: 'rgba(52,199,89,0.12)',
  red: '#FF3B30',
  redSoft: 'rgba(255,59,48,0.12)',
  violet: '#AF52DE',
  violetSoft: 'rgba(175,82,222,0.12)',
  teal: '#30B0C7',
  tealSoft: 'rgba(48,176,199,0.12)',
  l1: '#30B0C7',
  l2: '#AF52DE',
  l3: '#007AFF',
  l4: '#FF9500',
  l5: '#FF2D55',
  l6: '#8E8E93',
  layerFact: '#007AFF',
  layerExperience: '#AF52DE',
  layerRelation: '#FF2D55',
  layerHypothesis: '#FF9500',
  layerCommitment: '#34C759',
});

/* ─────────────────── 老年大字精简版 ─────────────────── */

const seniorEasyColors: ThemeColors = normalizeColors({
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F5',
  surfaceSoft: '#EEEEEE',
  border: '#CCCCCC',
  borderSoft: '#DDDDDD',
  textPrimary: '#000000',
  textSecondary: '#333333',
  textTertiary: '#555555',
  textInverse: '#FFFFFF',
  primary: '#0066CC',
  primarySoft: 'rgba(0,102,204,0.15)',
  primaryMuted: '#3399FF',
  accent: '#CC6600',
  accentSoft: 'rgba(204,102,0,0.15)',
  green: '#008844',
  greenSoft: 'rgba(0,136,68,0.15)',
  red: '#CC0000',
  redSoft: 'rgba(204,0,0,0.15)',
  violet: '#663399',
  violetSoft: 'rgba(102,51,153,0.15)',
  teal: '#007777',
  tealSoft: 'rgba(0,119,119,0.15)',
  l1: '#007777',
  l2: '#663399',
  l3: '#0066CC',
  l4: '#CC6600',
  l5: '#BB3366',
  l6: '#555555',
  layerFact: '#0066CC',
  layerExperience: '#663399',
  layerRelation: '#BB3366',
  layerHypothesis: '#CC6600',
  layerCommitment: '#008844',
});

/* ─────────────────── 黑曜石暗夜（OLED） ─────────────────── */

const deepObsidianColors: ThemeColors = normalizeColors({
  bg: '#000000',
  surface: '#0A0A0A',
  surfaceAlt: '#111111',
  surfaceSoft: '#181818',
  border: '#222222',
  borderSoft: '#151515',
  textPrimary: '#F0F0F0',
  textSecondary: '#A0A0A0',
  textTertiary: '#666666',
  textInverse: '#000000',
  primary: '#BBBBFF',
  primarySoft: 'rgba(187,187,255,0.12)',
  primaryMuted: '#DDDDFF',
  accent: '#E8C872',
  accentSoft: 'rgba(232,200,114,0.12)',
  green: '#88CCAA',
  greenSoft: 'rgba(136,204,170,0.12)',
  red: '#DD7777',
  redSoft: 'rgba(221,119,119,0.12)',
  violet: '#AA99DD',
  violetSoft: 'rgba(170,153,221,0.12)',
  teal: '#77BBBB',
  tealSoft: 'rgba(119,187,187,0.12)',
  l1: '#77BBBB',
  l2: '#AA99DD',
  l3: '#BBBBFF',
  l4: '#E8C872',
  l5: '#DDAABB',
  l6: '#777777',
  layerFact: '#BBBBFF',
  layerExperience: '#AA99DD',
  layerRelation: '#DDAABB',
  layerHypothesis: '#E8C872',
  layerCommitment: '#88CCAA',
  glow: 'rgba(187,187,255,0.3)',
});

/* ─────────────────── 间距 ─────────────────── */

const spacingStandard: ThemeSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

const spacingSenior: ThemeSpacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
};

/* ─────────────────── 圆角 ─────────────────── */

const radiusStandard: ThemeRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
};

const radiusSharp: ThemeRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

const radiusRound: ThemeRadius = {
  sm: 16,
  md: 24,
  lg: 32,
  xl: 40,
  full: 999,
};

const radiusPill: ThemeRadius = {
  sm: 20,
  md: 28,
  lg: 36,
  xl: 48,
  full: 999,
};

/* ─────────────────── 字体 ─────────────────── */

const fontStandard: ThemeFont = {
  hero: 28,
  title: 21,
  section: 17,
  body: 16,
  small: 14,
  tiny: 12,
};

const fontSenior: ThemeFont = {
  hero: 36,
  title: 28,
  section: 24,
  body: 20,
  small: 18,
  tiny: 16,
};

const fontCyber: ThemeFont = {
  hero: 32,
  title: 24,
  section: 18,
  body: 15,
  small: 13,
  tiny: 11,
};

/* ─────────────────── 动效 ─────────────────── */

const motionStandard: ThemeMotion = {
  fast: 150,
  normal: 250,
  slow: 400,
  springDamping: 15,
  springStiffness: 300,
  pageTransition: 'fade',
};

const motionEnergetic: ThemeMotion = {
  fast: 120,
  normal: 220,
  slow: 350,
  springDamping: 12,
  springStiffness: 400,
  pageTransition: 'scale',
};

const motionSmooth: ThemeMotion = {
  fast: 200,
  normal: 350,
  slow: 500,
  springDamping: 20,
  springStiffness: 200,
  pageTransition: 'slide',
};

const motionGentle: ThemeMotion = {
  fast: 300,
  normal: 450,
  slow: 600,
  springDamping: 25,
  springStiffness: 150,
  pageTransition: 'fade',
};

/* ─────────────────── 触控目标（附录AJ：≥48dp；老年版加大） ─────────────────── */

const touchStandard: ThemeTouch = {
  minTarget: 48,  // Apple HIG / Material Design 标准最小触控目标
};

const touchSenior: ThemeTouch = {
  minTarget: 56,  // 老年版加大触控目标，降低误触
};

/* ─────────────────── 阴影 ─────────────────── */

const shadowDark: ThemeShadow = {
  sm: makeShadow('#000000', 0.14, 4, 0, 1, 1),
  md: makeShadow('#000000', 0.18, 8, 0, 3, 2),
  lg: makeShadow('#000000', 0.24, 14, 0, 6, 4),
  card: makeShadow('#000000', 0.12, 6, 0, 2, 1),
  smDark: makeShadow('#000000', 0.30, 10, 0, 3, 4),
  mdDark: makeShadow('#000000', 0.40, 18, 0, 6, 7),
};

const shadowLight: ThemeShadow = {
  sm: makeShadow('#1A1E26', 0.025, 3, 0, 1, 0),
  md: makeShadow('#1A1E26', 0.04, 6, 0, 2, 1),
  lg: makeShadow('#1A1E26', 0.07, 12, 0, 5, 3),
  card: makeShadow('#1A1E26', 0.02, 4, 0, 1, 0),
  smDark: makeShadow('#000000', 0.25, 8, 0, 2, 3),
  mdDark: makeShadow('#000000', 0.35, 14, 0, 4, 5),
};

const shadowCyber: ThemeShadow = {
  sm: makeShadow('#00F0FF', 0.15, 8, 0, 2, 3),
  md: makeShadow('#00F0FF', 0.25, 16, 0, 4, 6),
  lg: makeShadow('#00F0FF', 0.35, 24, 0, 8, 9),
  card: makeShadow('#00F0FF', 0.25, 20, 0, 6, 8),
  glow: makeShadow('#00F0FF', 0.5, 15, 0, 0, 8),
  smDark: makeShadow('#00F0FF', 0.20, 10, 0, 2, 4),
  mdDark: makeShadow('#00F0FF', 0.30, 20, 0, 6, 8),
};

const shadowPink: ThemeShadow = {
  sm: makeShadow('#FF6B9D', 0.08, 8, 0, 2, 2),
  md: makeShadow('#FF6B9D', 0.12, 14, 0, 4, 4),
  lg: makeShadow('#FF6B9D', 0.18, 22, 0, 8, 7),
  card: makeShadow('#FF6B9D', 0.12, 16, 0, 6, 4),
  smDark: makeShadow('#FF6B9D', 0.20, 10, 0, 2, 3),
  mdDark: makeShadow('#FF6B9D', 0.28, 18, 0, 6, 6),
};

const shadowIos: ThemeShadow = {
  sm: makeShadow('#000000', 0.04, 6, 0, 1, 1),
  md: makeShadow('#000000', 0.06, 10, 0, 2, 2),
  lg: makeShadow('#000000', 0.10, 18, 0, 6, 4),
  card: makeShadow('#000000', 0.06, 10, 0, 2, 2),
  smDark: makeShadow('#000000', 0.20, 8, 0, 2, 2),
  mdDark: makeShadow('#000000', 0.30, 14, 0, 4, 4),
};

const shadowObsidian: ThemeShadow = {
  sm: makeShadow('#BBBBFF', 0.05, 8, 0, 2, 2),
  md: makeShadow('#BBBBFF', 0.08, 14, 0, 4, 4),
  lg: makeShadow('#BBBBFF', 0.12, 24, 0, 8, 6),
  card: makeShadow('#BBBBFF', 0.08, 24, 0, 4, 4),
  glow: makeShadow('#BBBBFF', 0.15, 20, 0, 0, 4),
  smDark: makeShadow('#BBBBFF', 0.10, 10, 0, 2, 3),
  mdDark: makeShadow('#BBBBFF', 0.15, 18, 0, 6, 6),
};

/* ─────────────────── 主题对象集合 ─────────────────── */

export const themes: Record<ThemeId, AppTheme> = {
  'morning-mist': {
    id: 'morning-mist',
    name: '晨雾镜境',
    description: '温润浅色，适合白天长读',
    dark: false,
    colors: morningMistColors,
    spacing: spacingStandard,
    radius: radiusStandard,
    font: fontStandard,
    motion: motionSmooth,
    shadow: shadowLight,
    touch: touchStandard,
    avatarScene: 'outdoor',
    avatarStyle: 'default',
    scene3D: {
      // 晨间自然光：暖白主光+冷蓝补光+暖金轮廓，色温约5200K
      ambientIntensity: 0.75,
      directionalIntensity: 1.8,
      fillIntensity: 0.55,
      rimIntensity: 0.35,
      ambientColor: '#f0ebe0',    // 暖雾色环境光
      directionalColor: '#fff8ee', // 晨间暖白日光
      fillColor: '#d5e3f0',       // 天空冷蓝补光（自然天光）
      rimColor: '#f5d9b2',        // 暖金轮廓（晨光侧逆光）
      toneExposure: 1.15,
    },
  },
  'night-voyage': {
    id: 'night-voyage',
    name: '夜航镜境',
    description: '安静深色，适合夜间沉浸',
    dark: true,
    colors: nightVoyageColors,
    spacing: spacingStandard,
    radius: radiusStandard,
    font: fontStandard,
    motion: motionStandard,
    shadow: shadowDark,
    touch: touchStandard,
    avatarScene: 'room',
    avatarStyle: 'default',
    scene3D: {
      // 夜航微光：深冷蓝环境+暖金主光+暖橙补光（保肤色）+冷蓝轮廓，色温约4500K主光
      ambientIntensity: 0.3,
      directionalIntensity: 1.1,
      fillIntensity: 0.45,
      rimIntensity: 0.55,
      ambientColor: '#141e33',    // 深空蓝环境光
      directionalColor: '#f0d0a0', // 暖金主光（夜灯/台灯感，保肤色不发灰）
      fillColor: '#d8a060',       // 暖橙补光（关键：从暖侧打光，防止暗部肤色发蓝发灰）
      rimColor: '#5a7aaa',        // 冷蓝轮廓（月光侧逆光）
      toneExposure: 0.95,
    },
  },
  'classic-dark': {
    id: 'classic-dark',
    name: '经典靛青',
    description: '深邃克制，内省观测',
    dark: true,
    colors: classicDarkColors,
    spacing: spacingStandard,
    radius: radiusStandard,
    font: fontStandard,
    motion: motionStandard,
    shadow: shadowDark,
    touch: touchStandard,
    avatarScene: 'room',
    avatarStyle: 'default',
    scene3D: {
      ambientIntensity: 0.35,
      directionalIntensity: 1.2,
      fillIntensity: 0.5,
      rimIntensity: 0.5,
      ambientColor: '#161d2e',
      directionalColor: '#d4dae8',
      fillColor: '#7088b8',
      rimColor: '#6880b0',
      toneExposure: 1.0,
    },
  },
  'classic-light': {
    id: 'classic-light',
    name: '白昼清新',
    description: '明亮通透，日间记录',
    dark: false,
    colors: classicLightColors,
    spacing: spacingStandard,
    radius: radiusStandard,
    font: fontStandard,
    motion: motionSmooth,
    shadow: shadowLight,
    touch: touchStandard,
    avatarScene: 'outdoor',
    avatarStyle: 'default',
    scene3D: {
      ambientIntensity: 0.8,
      directionalIntensity: 2.0,
      fillIntensity: 0.6,
      rimIntensity: 0.3,
      ambientColor: '#edf0f5',
      directionalColor: '#ffffff',
      fillColor: '#e0e8f5',
      rimColor: '#ffe8c8',
      toneExposure: 1.1,
    },
  },
  'cyberpunk-scifi': {
    id: 'cyberpunk-scifi',
    name: '赛博未来',
    description: '霓虹全息，科幻酷炫',
    dark: true,
    colors: cyberpunkColors,
    spacing: spacingStandard,
    radius: radiusSharp,
    font: fontCyber,
    motion: motionEnergetic,
    shadow: shadowCyber,
    touch: touchStandard,
    avatarScene: 'neon',
    avatarStyle: 'cyber',
    scene3D: {
      ambientIntensity: 0.25,
      directionalIntensity: 0.9,
      fillIntensity: 0.8,
      rimIntensity: 1.2,
      ambientColor: '#0a0a20',
      directionalColor: '#88ffff',
      fillColor: '#ff66dd',
      rimColor: '#00f0ff',
      toneExposure: 1.05,
    },
  },
  'pink-pop': {
    id: 'pink-pop',
    name: '糖果粉系',
    description: '甜美圆润，治愈可爱',
    dark: false,
    colors: pinkPopColors,
    spacing: spacingStandard,
    radius: radiusRound,
    font: fontStandard,
    motion: motionSmooth,
    shadow: shadowPink,
    touch: touchStandard,
    avatarScene: 'candy',
    avatarStyle: 'kawaii',
    scene3D: {
      ambientIntensity: 0.7,
      directionalIntensity: 1.5,
      fillIntensity: 0.7,
      rimIntensity: 0.4,
      ambientColor: '#ffeef4',
      directionalColor: '#ffffff',
      fillColor: '#ffc8dd',
      rimColor: '#ffb3d1',
      toneExposure: 1.1,
    },
  },
  'ios-minimal': {
    id: 'ios-minimal',
    name: '极简苹果',
    description: '精致留白，优雅质感',
    dark: false,
    colors: iosMinimalColors,
    spacing: spacingStandard,
    radius: radiusPill,
    font: fontStandard,
    motion: motionSmooth,
    shadow: shadowIos,
    touch: touchStandard,
    avatarScene: 'desk',
    avatarStyle: 'minimal',
    scene3D: {
      ambientIntensity: 0.75,
      directionalIntensity: 1.7,
      fillIntensity: 0.5,
      rimIntensity: 0.3,
      ambientColor: '#f0f0f5',
      directionalColor: '#ffffff',
      fillColor: '#e8e8f0',
      rimColor: '#e0d8c8',
      toneExposure: 1.08,
    },
  },
  'senior-easy': {
    id: 'senior-easy',
    name: '长辈大字',
    description: '超大字号，清晰易读',
    dark: false,
    colors: seniorEasyColors,
    spacing: spacingSenior,
    radius: radiusStandard,
    font: fontSenior,
    motion: motionGentle,
    shadow: shadowLight,
    touch: touchSenior,
    avatarScene: 'rest',
    avatarStyle: 'elder',
    scene3D: {
      ambientIntensity: 0.9,
      directionalIntensity: 2.2,
      fillIntensity: 0.7,
      rimIntensity: 0.35,
      ambientColor: '#f5f2e8',
      directionalColor: '#fffdf5',
      fillColor: '#e8e0d0',
      rimColor: '#ffe8c0',
      toneExposure: 1.2,
    },
  },
  'deep-obsidian': {
    id: 'deep-obsidian',
    name: '黑曜石夜',
    description: '纯黑深邃，OLED省电',
    dark: true,
    colors: deepObsidianColors,
    spacing: spacingStandard,
    radius: radiusStandard,
    font: fontStandard,
    motion: motionGentle,
    shadow: shadowObsidian,
    touch: touchStandard,
    avatarScene: 'void',
    avatarStyle: 'obsidian',
    scene3D: {
      ambientIntensity: 0.2,
      directionalIntensity: 0.9,
      fillIntensity: 0.35,
      rimIntensity: 0.6,
      ambientColor: '#050508',
      directionalColor: '#e0d8f0',
      fillColor: '#a090c0',
      rimColor: '#b8b0e0',
      toneExposure: 0.9,
    },
  },
};

/* ─────────────────── 主题列表（用于设置页展示） ─────────────────── */

export const themeList: { id: ThemeId; name: string; description: string; emoji: string }[] = [
  { id: 'morning-mist', name: '晨雾镜境', description: '温润浅色，适合白天长读', emoji: '🌫️' },
  { id: 'night-voyage', name: '夜航镜境', description: '安静深色，适合夜间沉浸', emoji: '🌌' },
  { id: 'cyberpunk-scifi', name: '赛博未来', description: '霓虹全息，科幻酷炫', emoji: '🌃' },
  { id: 'pink-pop', name: '糖果粉系', description: '甜美圆润，治愈可爱', emoji: '🌸' },
  { id: 'ios-minimal', name: '极简苹果', description: '精致留白，优雅质感', emoji: '🍎' },
  { id: 'classic-dark', name: '经典靛青', description: '深邃克制，内省观测', emoji: '🌙' },
  { id: 'classic-light', name: '白昼清新', description: '明亮通透，日间记录', emoji: '☀️' },
  { id: 'senior-easy', name: '长辈大字', description: '超大字号，清晰易读', emoji: '👴' },
  { id: 'deep-obsidian', name: '黑曜石夜', description: '纯黑深邃，OLED省电', emoji: '🖤' },
];

/* ─────────────────── 主题状态管理 ─────────────────── */

const THEME_STORAGE_KEY = 'zx_app_theme';

let currentThemeId: ThemeId | null = null; // null = follow system
const themeListeners = new Set<() => void>();
let themeInitialized = false;
let systemThemeId: ThemeId = 'night-voyage';

const subscribeTheme = (cb: () => void) => {
  themeListeners.add(cb);
  return () => {
    themeListeners.delete(cb);
  };
};

const getThemeSnapshot = () => currentThemeId ?? systemThemeId;

/** Resolve effective theme id: user override or system */
function resolveEffectiveThemeId(): ThemeId {
  if (currentThemeId !== null) return currentThemeId;
  return systemThemeId;
}

async function loadPersistedTheme(): Promise<void> {
  if (themeInitialized) return;
  try {
    const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'system') {
      currentThemeId = null; // follow system
    } else if (saved && themes[saved as ThemeId]) {
      currentThemeId = saved as ThemeId;
    } else {
      currentThemeId = null; // default: follow system
    }
  } catch {
    currentThemeId = null;
  }
  themeInitialized = true;
}

export function setAppTheme(id: ThemeId | 'system') {
  if (id === 'system') {
    if (currentThemeId === null) return;
    currentThemeId = null;
    AsyncStorage.setItem(THEME_STORAGE_KEY, 'system').catch(() => {});
  } else {
    if (id === currentThemeId) return;
    currentThemeId = id;
    AsyncStorage.setItem(THEME_STORAGE_KEY, id).catch(() => {});
  }
  themeListeners.forEach((l) => l());
}

/** 初始化主题（从持久化存储加载，应用启动时调用一次） */
export async function initTheme(): Promise<void> {
  await loadPersistedTheme();
  themeListeners.forEach((l) => l());
}

/** 非组件代码读取当前主题 */
export function getCurrentTheme(): AppTheme {
  return themes[resolveEffectiveThemeId()];
}

/**
 * useAppTheme：响应式主题 Hook
 * 返回完整主题对象 + setTheme 方法
 * 自动跟随系统：light→晨雾镜境, dark→夜航镜境
 */
export function useAppTheme(): AppTheme & { setTheme: (id: ThemeId | 'system') => void } {
  const systemScheme = useColorScheme();
  const themeId = useSyncExternalStore(subscribeTheme, getThemeSnapshot);

  // Update system-mapped theme when system scheme changes
  const prevSystemScheme = useRef(systemScheme);
  useEffect(() => {
    if (prevSystemScheme.current !== systemScheme) {
      prevSystemScheme.current = systemScheme;
      systemThemeId = systemScheme === 'light' ? 'morning-mist' : 'night-voyage';
      if (currentThemeId === null) {
        themeListeners.forEach((l) => l());
      }
    }
  }, [systemScheme]);

  // Initialize system theme on first render (for web where useColorScheme works immediately)
  useEffect(() => {
    systemThemeId = systemScheme === 'light' ? 'morning-mist' : 'night-voyage';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveId = currentThemeId ?? systemThemeId;
  const theme = themes[effectiveId];
  return { ...theme, setTheme: setAppTheme };
}

/* ─────────────────── 向后兼容导出（旧代码不动） ─────────────────── */

/** 旧代码通过 `import colors from '../theme/theme'` 引用 → 夜航镜境为默认深色 */
export default themes['night-voyage'].colors;

/** 旧代码通过命名 import 引用的变量，映射到主推主题 */
export const colors = themes['night-voyage'].colors;
export const lightColors = themes['morning-mist'].colors;
export const seniorColors = themes['senior-easy'].colors;
export const seniorFont = themes['senior-easy'].font;
export const spacingTokens = themes['night-voyage'].spacing;
export const radius = themes['night-voyage'].radius;
export const font = themes['night-voyage'].font;
export const shadow = themes['night-voyage'].shadow;

/** 函数式 spacing 向后兼容 */
export const spacing = (n: number) => n * 4;

/** 旧主题方案类型兼容 */
export type ThemeScheme = 'light' | 'dark' | 'senior' | 'system';
export type AppThemeMode = 'light' | 'dark' | 'senior';

const schemeListenersLegacy = new Set<() => void>();
let schemeOverride: AppThemeMode | null = null;

const subscribeScheme = (cb: () => void) => {
  schemeListenersLegacy.add(cb);
  return () => schemeListenersLegacy.delete(cb);
};

const getSchemeOverride = () => schemeOverride;

export const setAppScheme = (s: ThemeScheme) => {
  if (s === 'system') {
    setAppTheme('system');
  } else if (s === 'dark') {
    setAppTheme('night-voyage');
  } else if (s === 'light') {
    setAppTheme('morning-mist');
  } else if (s === 'senior') {
    setAppTheme('senior-easy');
  }
};

export function getAppThemeMode(): AppThemeMode {
  const effective = resolveEffectiveThemeId();
  if (effective === 'morning-mist' || effective === 'classic-light' || effective === 'ios-minimal' || effective === 'pink-pop' || effective === 'senior-easy') return 'light';
  return 'dark';
}
