import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  api,
  type DevicePlatform,
  type DevicePresenceRecord,
  type DeviceSurface,
} from '../services/api';

const DEVICE_ID_KEY = 'zx_device_id_v1';

interface DevicePresenceContextValue {
  currentDeviceId: string | null;
  surface: DeviceSurface;
  devices: DevicePresenceRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  revoke: (id: string) => Promise<void>;
}

const DevicePresenceContext = createContext<DevicePresenceContextValue | null>(null);

function makeDeviceId(): string {
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function localDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = makeDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function devicePlatform(): DevicePlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'unknown';
}

function deviceLabel(surface: DeviceSurface): string {
  if (Platform.OS === 'ios') return 'iPhone / iPad';
  if (Platform.OS === 'android') return 'Android 手机';
  return surface === 'desktop' ? 'Web 电脑' : 'Web 手机';
}

function deviceCapabilities(surface: DeviceSurface): string[] {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return ['touch', 'native-shell'];
  }
  return surface === 'desktop' ? ['web', 'keyboard'] : ['web', 'touch'];
}

export function isDeviceOnline(device: DevicePresenceRecord, nowMs = Date.now()): boolean {
  const seen = Date.parse(device.last_seen_at);
  return Number.isFinite(seen) && nowMs - seen <= 75_000;
}

export function DevicePresenceProvider({
  surface,
  children,
}: {
  surface: DeviceSurface;
  children: React.ReactNode;
}) {
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DevicePresenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.devices.list(50);
      setDevices(result.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '设备状态同步失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const id = await localDeviceId();
        if (disposed) return;
        setCurrentDeviceId(id);
        await api.devices.register({
          id,
          label: deviceLabel(surface),
          surface,
          platform: devicePlatform(),
          appVersion: '1.0.0',
          capabilities: deviceCapabilities(surface),
        });
        if (!disposed) await refresh();
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : '设备注册失败');
          setLoading(false);
        }
      }
    })();
    return () => { disposed = true; };
  }, [surface, refresh]);

  useEffect(() => {
    if (!currentDeviceId) return;
    let disposed = false;

    const heartbeat = async () => {
      try {
        await api.devices.heartbeat(currentDeviceId);
        if (!disposed) setError(null);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : '设备在线状态更新失败');
      }
    };

    const heartbeatTimer = setInterval(heartbeat, 30_000);
    const refreshTimer = setInterval(() => { void refresh(); }, 10_000);
    return () => {
      disposed = true;
      clearInterval(heartbeatTimer);
      clearInterval(refreshTimer);
    };
  }, [currentDeviceId, refresh]);

  const revoke = useCallback(async (id: string) => {
    await api.devices.revoke(id);
    setDevices((current) => current.filter((device) => device.id !== id));
  }, []);

  const value = useMemo<DevicePresenceContextValue>(() => ({
    currentDeviceId,
    surface,
    devices,
    loading,
    error,
    refresh,
    revoke,
  }), [currentDeviceId, surface, devices, loading, error, refresh, revoke]);

  return (
    <DevicePresenceContext.Provider value={value}>
      {children}
    </DevicePresenceContext.Provider>
  );
}

export function useDevicePresence(): DevicePresenceContextValue {
  const value = useContext(DevicePresenceContext);
  if (!value) throw new Error('useDevicePresence 必须在 DevicePresenceProvider 内使用');
  return value;
}
