import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Glyph } from './glyphs';
import { useContinuityHandoffs } from '../hooks/useContinuityHandoffs';
import type { ContinuityHandoff, ContinuitySurface } from '../services/api';
import { useAppTheme } from '../theme/theme';

export function ContinuityInboxCard({
  target,
  onContinue,
  compact = false,
  hideWhenEmpty = false,
}: {
  target: ContinuitySurface;
  onContinue: (handoff: ContinuityHandoff) => void | Promise<void>;
  compact?: boolean;
  hideWhenEmpty?: boolean;
}) {
  const theme = useAppTheme();
  const { items, loading, error, refresh, consume, cancel } = useContinuityHandoffs(target);
  const [busyId, setBusyId] = useState<string | null>(null);
  const current = items[0];
  const sourceLabel = current?.source_surface === 'desktop' ? '电脑' : '手机';

  if (!current && hideWhenEmpty && !loading && !error) return null;

  const continueHandoff = async () => {
    if (!current || busyId) return;
    setBusyId(current.id);
    try {
      const consumed = await consume(current.id);
      await onContinue(consumed);
    } finally {
      setBusyId(null);
    }
  };

  const cancelHandoff = async () => {
    if (!current || busyId) return;
    setBusyId(current.id);
    try {
      await cancel(current.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View
      style={[
        styles.card,
        {
          padding: compact ? 11 : 14,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
        },
      ]}
      accessibilityLabel="跨端接力"
    >
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Glyph name="layers" size={compact ? 15 : 17} color={theme.colors.primary} />
          <Text style={{ color: theme.colors.textPrimary, fontSize: compact ? theme.font.small : theme.font.body, fontWeight: '800' }}>
            跨端接力
          </Text>
        </View>
        <Pressable
          onPress={refresh}
          accessibilityRole="button"
          accessibilityLabel="刷新跨端接力"
          hitSlop={8}
        >
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny }}>
            {loading ? '同步中…' : '刷新'}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={{ color: theme.colors.red, fontSize: theme.font.tiny, lineHeight: 17 }}>
          {error}
        </Text>
      ) : current ? (
        <>
          <Text
            style={{ color: theme.colors.textSecondary, fontSize: compact ? theme.font.small : theme.font.body, lineHeight: compact ? 19 : 22, marginTop: 7 }}
            numberOfLines={compact ? 2 : 3}
          >
            {current.title}
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny, marginTop: 5 }}>
            来自{sourceLabel} · 24 小时内有效
          </Text>
          <View style={[styles.actions, { marginTop: compact ? 8 : 11 }]}>
            <Pressable
              onPress={cancelHandoff}
              disabled={!!busyId}
              accessibilityRole="button"
              accessibilityLabel="取消接力"
              style={({ pressed }) => [
                styles.secondary,
                {
                  borderColor: theme.colors.borderSoft,
                  opacity: busyId ? 0.45 : pressed ? 0.65 : 1,
                  minHeight: compact ? 36 : 40,
                },
              ]}
            >
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.small, fontWeight: '650' as any }}>忽略</Text>
            </Pressable>
            <Pressable
              onPress={continueHandoff}
              disabled={!!busyId}
              accessibilityRole="button"
              accessibilityLabel={`继续来自${sourceLabel}的接力`}
              style={({ pressed }) => [
                styles.primary,
                {
                  backgroundColor: theme.colors.primary,
                  opacity: busyId ? 0.45 : pressed ? 0.72 : 1,
                  minHeight: compact ? 36 : 40,
                },
              ]}
            >
              <Text style={{ color: theme.colors.textInverse, fontSize: theme.font.small, fontWeight: '800' }}>
                {busyId ? '打开中…' : '继续处理'}
              </Text>
              <Glyph name="arrow" size={15} color={theme.colors.textInverse} />
            </Pressable>
          </View>
          {items.length > 1 ? (
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny, marginTop: 7 }}>
              还有 {items.length - 1} 条待接力
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: 19, marginTop: 6 }}>
          {loading ? '正在检查另一端的未完成事项…' : '当前没有待接力事项。'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  secondary: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { borderRadius: 9, paddingHorizontal: 13, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
});
