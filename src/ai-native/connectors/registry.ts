import type { ConnectorDescriptor, LifeDataCategory, LifeMetric, LifeSignalObservation } from './types';

export const LIFE_CONNECTOR_REGISTRY: readonly ConnectorDescriptor[] = [
  {
    id: 'manual_entry',
    label: '本人直接记录',
    category: 'health',
    platforms: ['android', 'ios', 'web'],
    metrics: ['sleep_duration_hours', 'late_night_minutes', 'stress_score', 'meal_load_score', 'body_weight_kg'],
    implementationStatus: 'ready',
    setup: '无需额外安装；仅处理用户主动提交的本地记录。',
    privacyDefault: 'private_aggregate',
  },
  {
    id: 'health_connect',
    label: 'Android Health Connect',
    category: 'health',
    platforms: ['android'],
    metrics: ['sleep_duration_hours', 'steps', 'active_minutes', 'heart_rate_bpm', 'resting_heart_rate_bpm', 'body_weight_kg'],
    implementationStatus: 'native_adapter_required',
    setup: 'Android 14+ 使用系统组件；Android 9-13 需安装 Health Connect，并在系统设置中逐项授权。',
    privacyDefault: 'private_aggregate',
  },
  {
    id: 'xiaomi_mi_fitness',
    label: '小米运动健康 / Mi Fitness',
    category: 'health',
    platforms: ['android'],
    metrics: ['sleep_duration_hours', 'steps', 'active_minutes', 'heart_rate_bpm', 'resting_heart_rate_bpm'],
    implementationStatus: 'contract_only',
    setup: '优先由 Mi Fitness 写入 Health Connect；可用性取决于手环型号、地区、系统和小米应用版本。',
    privacyDefault: 'private_aggregate',
  },
  {
    id: 'xiaomi_export',
    label: '小米账号数据导入',
    category: 'health',
    platforms: ['import'],
    metrics: ['sleep_duration_hours', 'steps', 'active_minutes', 'heart_rate_bpm', 'body_weight_kg'],
    implementationStatus: 'contract_only',
    setup: '由用户从小米账号隐私页面导出后显式导入；禁止后台抓取账号或密码。',
    privacyDefault: 'local_raw',
  },
  {
    id: 'apple_health',
    label: 'Apple HealthKit',
    category: 'health',
    platforms: ['ios'],
    metrics: ['sleep_duration_hours', 'steps', 'active_minutes', 'heart_rate_bpm', 'resting_heart_rate_bpm', 'body_weight_kg'],
    implementationStatus: 'native_adapter_required',
    setup: '需要 iOS 原生 HealthKit 能力、用途声明和用户逐项授权。',
    privacyDefault: 'private_aggregate',
  },
  {
    id: 'android_usage_stats',
    label: 'Android 手机使用摘要',
    category: 'device_usage',
    platforms: ['android'],
    metrics: ['phone_screen_minutes', 'late_night_minutes'],
    implementationStatus: 'native_adapter_required',
    setup: '需要用户进入系统“使用情况访问权限”页面手动授权；只保存按日聚合，不使用无障碍服务。',
    privacyDefault: 'local_raw',
  },
  {
    id: 'ios_device_activity',
    label: 'iOS DeviceActivity',
    category: 'device_usage',
    platforms: ['ios'],
    metrics: ['phone_screen_minutes', 'late_night_minutes'],
    implementationStatus: 'platform_entitlement_required',
    setup: '需要 Apple Family Controls entitlement、系统选择器和用户生物识别授权。',
    privacyDefault: 'local_raw',
  },
  {
    id: 'activitywatch',
    label: 'ActivityWatch 电脑活动摘要',
    category: 'desktop_usage',
    platforms: ['windows', 'macos', 'linux'],
    metrics: ['desktop_active_minutes', 'late_night_minutes'],
    implementationStatus: 'desktop_companion_required',
    setup: '需要用户安装开源 ActivityWatch 或知行桌面伴侣；默认只传每日聚合，不传窗口标题和 URL。',
    privacyDefault: 'local_raw',
  },
  {
    id: 'food_camera',
    label: '饮食拍照识别',
    category: 'nutrition',
    platforms: ['android', 'ios'],
    metrics: ['meal_load_score', 'energy_balance_kcal'],
    implementationStatus: 'native_adapter_required',
    setup: '照片先在本机生成候选；份量与营养必须由用户确认，未确认候选不影响数字孪生。',
    privacyDefault: 'local_raw',
  },
  {
    id: 'food_barcode',
    label: '零食条码与营养标签',
    category: 'nutrition',
    platforms: ['android', 'ios'],
    metrics: ['meal_load_score', 'energy_balance_kcal'],
    implementationStatus: 'contract_only',
    setup: '条码可查询开放食品库，营养标签可本地 OCR；数据库结果仍需用户确认份量。',
    privacyDefault: 'private_aggregate',
  },
] as const;

export function connectorsForCategory(category: LifeDataCategory): readonly ConnectorDescriptor[] {
  return LIFE_CONNECTOR_REGISTRY.filter((item) => item.category === category);
}

const METRIC_RANGES: Record<LifeMetric, readonly [number, number]> = {
  sleep_duration_hours: [0, 24],
  late_night_minutes: [0, 1_440],
  steps: [0, 200_000],
  active_minutes: [0, 1_440],
  heart_rate_bpm: [20, 260],
  resting_heart_rate_bpm: [20, 220],
  stress_score: [0, 1],
  phone_screen_minutes: [0, 1_440],
  desktop_active_minutes: [0, 1_440],
  meal_load_score: [0, 1],
  energy_balance_kcal: [-10_000, 10_000],
  body_weight_kg: [20, 500],
};

const METRIC_CATEGORIES: Record<LifeMetric, LifeDataCategory> = {
  sleep_duration_hours: 'health',
  late_night_minutes: 'device_usage',
  steps: 'health',
  active_minutes: 'health',
  heart_rate_bpm: 'health',
  resting_heart_rate_bpm: 'health',
  stress_score: 'health',
  phone_screen_minutes: 'device_usage',
  desktop_active_minutes: 'desktop_usage',
  meal_load_score: 'nutrition',
  energy_balance_kcal: 'nutrition',
  body_weight_kg: 'health',
};

export interface LifeSignalValidation {
  accepted: boolean;
  reason: string;
}

export function validateLifeSignal(observation: LifeSignalObservation, nowMs = Date.now()): LifeSignalValidation {
  if (observation.schemaVersion !== 1) return { accepted: false, reason: '不支持的生活信号版本' };
  if (!observation.id || observation.id.length > 128) return { accepted: false, reason: '无效的信号 ID' };
  if (!observation.sourceRef || observation.sourceRef.length > 240) return { accepted: false, reason: '无效的来源引用' };
  if (!Number.isFinite(observation.value)) return { accepted: false, reason: '数值不是有限数' };
  if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) {
    return { accepted: false, reason: '置信度必须在 0 到 1 之间' };
  }
  const occurredAt = Date.parse(observation.occurredAt);
  const capturedAt = Date.parse(observation.capturedAt);
  if (!Number.isFinite(occurredAt) || !Number.isFinite(capturedAt)) return { accepted: false, reason: '时间戳无效' };
  if (occurredAt > nowMs + 5 * 60_000 || capturedAt > nowMs + 5 * 60_000) {
    return { accepted: false, reason: '未来时间戳不能驱动数字孪生' };
  }
  const range = METRIC_RANGES[observation.metric];
  if (observation.value < range[0] || observation.value > range[1]) {
    return { accepted: false, reason: `${observation.metric} 超出可信范围` };
  }
  const connector = LIFE_CONNECTOR_REGISTRY.find((item) => item.id === observation.connectorId);
  if (
    !connector
    || METRIC_CATEGORIES[observation.metric] !== observation.category
    || !(connector.metrics as readonly LifeMetric[]).includes(observation.metric)
  ) {
    return { accepted: false, reason: '连接器、分类和指标不匹配' };
  }
  return { accepted: true, reason: '通过' };
}
