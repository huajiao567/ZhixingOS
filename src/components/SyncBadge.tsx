import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useStore } from '../store/useStore';
import { useAppTheme } from '../theme/theme';
import { useTextStyles } from './ui';

/**
 * 可见的同步状态（P0-5）：展示待同步条目数与冲突数。
 * 冲突需用户主动处理（先核对服务端），不自动丢弃写入。
 */
export function SyncBadge() {
  const theme = useAppTheme();
  const textStyles = useTextStyles();
  const sync = useStore((s) => s.sync);
  const resolve = useStore((s) => s.resolveConflicts);
  const flush = useStore((s) => s.flushSync);

  if (sync.pending === 0 && sync.conflicts.length === 0) return null;

  return (
    <View style={styles.row}>
      {sync.pending > 0 && (
        <View style={[styles.chip, { backgroundColor: theme.colors.surfaceSoft, paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius.full }]}>
          <Text style={[textStyles.tertiary, { fontSize: theme.font.tiny }]}>同步中 {sync.pending}</Text>
        </View>
      )}
      {sync.conflicts.length > 0 && (
        <Pressable
          onPress={async () => {
            await resolve();
            await flush();
          }}
          accessibilityLabel="处理同步冲突"
        >
          <View style={[styles.chip, { backgroundColor: theme.colors.redSoft ?? theme.colors.surfaceSoft, paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius.full }]}>
            <Text style={[textStyles.tertiary, { fontSize: theme.font.tiny, color: theme.colors.red }]}>
              需处理冲突 {sync.conflicts.length}
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = {
  row: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const },
  chip: { paddingVertical: 4 },
};
