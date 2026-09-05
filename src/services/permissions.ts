import { api } from './api';

export type RuntimeDataType =
  | 'calendar' | 'task' | 'health' | 'device_usage' | 'desktop_usage' | 'nutrition'
  | 'location' | 'photo' | 'microphone' | 'notification';

export interface PermissionDecision {
  granted: boolean;
  status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  canAskAgain: boolean;
  message: string;
}

export function permissionDecision(input: {
  granted?: boolean;
  status?: string;
  canAskAgain?: boolean;
}, capability: string): PermissionDecision {
  const granted = input.granted === true || input.status === 'granted';
  const normalized = granted
    ? 'granted'
    : input.status === 'denied'
      ? 'denied'
      : input.status === 'undetermined'
        ? 'undetermined'
        : 'unavailable';
  return {
    granted,
    status: normalized,
    canAskAgain: input.canAskAgain !== false,
    message: granted ? `已获得${capability}授权` : `${capability}未获授权，未执行任何写入`,
  };
}

export async function registerSourcePermission(
  dataType: RuntimeDataType,
  purpose: string,
  scope: Record<string, unknown>,
): Promise<void> {
  await api.post('/api/data/source-permissions', {
    data_type: dataType,
    purpose,
    scope,
  });
}
