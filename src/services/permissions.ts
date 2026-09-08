import { api } from './api';
import type { SourcePermission } from '../types/models';

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
): Promise<SourcePermission> {
  // Return the persisted permission row so downstream records can retain the
  // exact consent grant that authorized this capture. Do not replace it with a
  // generic "journal" consent marker.
  return api.sourcePermissions.grant({
    data_type: dataType,
    purpose,
    scope,
  });
}
