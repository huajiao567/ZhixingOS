/**
 * 生活数据连接器的稳定边界。
 *
 * 原生 SDK、桌面伴侣或文件导入只能在这里标准化数据；渲染器不得读取
 * 厂商原始对象、窗口标题、URL、照片像素或服务端密钥。
 */
export type LifeConnectorId =
  | 'manual_entry'
  | 'health_connect'
  | 'xiaomi_mi_fitness'
  | 'xiaomi_export'
  | 'apple_health'
  | 'android_usage_stats'
  | 'ios_device_activity'
  | 'activitywatch'
  | 'food_camera'
  | 'food_barcode';

export type LifeDataCategory = 'health' | 'device_usage' | 'desktop_usage' | 'nutrition';

export type LifeMetric =
  | 'sleep_duration_hours'
  | 'late_night_minutes'
  | 'steps'
  | 'active_minutes'
  | 'heart_rate_bpm'
  | 'resting_heart_rate_bpm'
  | 'stress_score'
  | 'phone_screen_minutes'
  | 'desktop_active_minutes'
  | 'meal_load_score'
  | 'energy_balance_kcal'
  | 'body_weight_kg';

export type LifeSignalUnit = 'hours' | 'minutes' | 'count' | 'bpm' | 'score_0_1' | 'kcal' | 'kg';
export type LifeSignalStatus = 'candidate' | 'confirmed' | 'rejected';
export type LifeSignalPrivacy = 'local_raw' | 'private_aggregate';

export interface LifeSignalObservation {
  schemaVersion: 1;
  id: string;
  connectorId: LifeConnectorId;
  category: LifeDataCategory;
  metric: LifeMetric;
  value: number;
  unit: LifeSignalUnit;
  occurredAt: string;
  capturedAt: string;
  confidence: number;
  status: LifeSignalStatus;
  privacy: LifeSignalPrivacy;
  /** 不可逆引用或外部记录 ID；不得放原文、URL、照片路径或窗口标题。 */
  sourceRef: string;
  /** 可选的去标识设备引用。 */
  deviceRef?: string;
  /** 个体基线，例如目标睡眠时长；不提供时使用保守默认值。 */
  baseline?: number;
}

export type ConnectorAvailabilityStatus =
  | 'available'
  | 'needs_setup'
  | 'needs_native_module'
  | 'needs_companion'
  | 'needs_entitlement'
  | 'unsupported';

export interface ConnectorAvailability {
  status: ConnectorAvailabilityStatus;
  message: string;
  checkedAt: string;
}

export interface ConnectorAuthorization {
  granted: boolean;
  scopes: string[];
  message: string;
}

export interface ConnectorSyncRequest {
  cursor?: string;
  since?: string;
  limit?: number;
}

export interface ConnectorSyncResult {
  observations: LifeSignalObservation[];
  nextCursor?: string;
  partial: boolean;
  message: string;
}

export interface LifeDataConnector {
  readonly id: LifeConnectorId;
  checkAvailability(): Promise<ConnectorAvailability>;
  requestAuthorization(scopes: string[]): Promise<ConnectorAuthorization>;
  sync(request: ConnectorSyncRequest): Promise<ConnectorSyncResult>;
  revoke(): Promise<void>;
  purgeLocalData(): Promise<void>;
}

export type ConnectorImplementationStatus =
  | 'ready'
  | 'contract_only'
  | 'native_adapter_required'
  | 'desktop_companion_required'
  | 'platform_entitlement_required';

export interface ConnectorDescriptor {
  id: LifeConnectorId;
  label: string;
  category: LifeDataCategory;
  platforms: ('android' | 'ios' | 'web' | 'windows' | 'macos' | 'linux' | 'import')[];
  metrics: LifeMetric[];
  implementationStatus: ConnectorImplementationStatus;
  setup: string;
  privacyDefault: LifeSignalPrivacy;
}

