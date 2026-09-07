import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Glyph } from './glyphs';
import { isDeviceOnline, useDevicePresence } from './DevicePresenceProvider';
import { useAppTheme } from '../theme/theme';

function lastSeenLabel(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '时间未知';
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return '刚刚在线';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
  if (seconds < 86_400) return Math.floor(seconds / 3600) + ' 小时前';
  return Math.floor(seconds / 86_400) + ' 天前';
}

export function DevicePresencePanel({ compact = false }: { compact?: boolean }) {
  const theme = useAppTheme();
  const { currentDeviceId, devices, loading, error, refresh, revoke } = useDevicePresence();
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...devices].sort((a, b) => {
      if (a.id === currentDeviceId) return -1;
      if (b.id === currentDeviceId) return 1;
      return Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at);
    }),
    [devices, currentDeviceId],
  );

  const onlineCount = sorted.filter((device) => isDeviceOnline(device)).length;

  const handleRevoke = async (id: string) => {
    if (id === currentDeviceId || busyId) return;
    setBusyId(id);
    try {
      await revoke(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View
      style={[
        styles.root,
        {
          borderColor: theme.colors.borderSoft,
          backgroundColor: compact ? 'transparent' : theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: compact ? 0 : theme.spacing.md,
        },
      ]}
      accessibilityLabel="已登录设备"
    >
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Glyph name="data" size={compact ? 15 : 18} color={theme.colors.primary} />
          <View>
            <Text style={{ color: theme.colors.textPrimary, fontSize: compact ? theme.font.small : theme.font.body, fontWeight: '800' }}>
              已登录设备
            </Text>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny, marginTop: 2 }}>
              {loading ? '同步中…' : onlineCount + ' 台在线 · ' + sorted.length + ' 台有效'}
            </Text>
          </View>
        </View>
        <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel="刷新设备状态" hitSlop={8}>
          <Text style={{ color: theme.colors.primary, fontSize: theme.font.tiny, fontWeight: '700' }}>刷新</Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={{ color: theme.colors.red, fontSize: theme.font.tiny, marginTop: 8 }}>{error}</Text>
      ) : null}

      <View style={{ marginTop: compact ? 8 : 12 }}>
        {sorted.map((device, index) => {
          const current = device.id === currentDeviceId;
          const online = isDeviceOnline(device);
          return (
            <View
              key={device.id}
              style={[
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.borderSoft },
                { minHeight: compact ? 44 : 54 },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: online ? theme.colors.green : theme.colors.textTertiary }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.nameRow}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: theme.font.small, fontWeight: '700' }} numberOfLines={1}>
                    {device.label}
                  </Text>
                  {current ? (
                    <Text style={{ color: theme.colors.primary, fontSize: theme.font.tiny, fontWeight: '700' }}>本机</Text>
                  ) : null}
                </View>
                <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny, marginTop: 2 }}>
                  {device.surface === 'desktop' ? '电脑端' : '手机端'} · {device.platform} · {online ? '在线' : lastSeenLabel(device.last_seen_at)}
                </Text>
              </View>
              {!current && !compact ? (
                <Pressable
                  onPress={() => handleRevoke(device.id)}
                  disabled={busyId === device.id}
                  accessibilityRole="button"
                  accessibilityLabel={'撤销设备：' + device.label}
                  style={({ pressed }) => [{ paddingVertical: 7, paddingHorizontal: 9, opacity: busyId === device.id ? 0.4 : pressed ? 0.65 : 1 }]}
                >
                  <Text style={{ color: theme.colors.red, fontSize: theme.font.tiny, fontWeight: '700' }}>
                    {busyId === device.id ? '撤销中…' : '撤销'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {!loading && sorted.length === 0 ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, paddingVertical: 8 }}>
            暂无有效设备记录。
          </Text>
        ) : null}
      </View>

      {!compact ? (
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny, lineHeight: 17, marginTop: 8 }}>
          这里只保存随机设备 ID、平台类别、能力标签和最近在线时间；不采集硬件序列号、MAC 地址或精确设备指纹。
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
});
