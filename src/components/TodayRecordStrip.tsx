import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LifeEvent } from '../types/models';
import { journalSourceLabel } from '../ai-native/intake/journalRecord';
import { useAppTheme } from '../theme/theme';

function isSameLocalDay(iso: string, now = new Date()): boolean {
  const value = new Date(iso);
  return !Number.isNaN(value.getTime())
    && value.getFullYear() === now.getFullYear()
    && value.getMonth() === now.getMonth()
    && value.getDate() === now.getDate();
}

function recordText(event: LifeEvent): string {
  const text = event.userInterpretation?.trim();
  if (text) {
    const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim();
    // Emoji are astral Unicode code points. Without the `u` flag the
    // character class can match only one surrogate half and leave the icon in
    // both visible text and the accessibility label.
    if (firstLine) return firstLine.replace(/^[📷🎤]\s*/u, '');
  }
  return event.title.replace(/^(日记|照片记录|语音记录|孪生记录)：/, '');
}

function timeLabel(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return '--:--';
  return value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function TodayRecordStrip({ events }: { events: LifeEvent[] }) {
  const theme = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const today = useMemo(
    () => events.filter((event) => event.type === 'journal' && isSameLocalDay(event.startTime)),
    [events],
  );
  const latest = today[0];

  if (!latest) {
    return (
      <View style={[styles.empty, { borderColor: theme.colors.borderSoft }]}>
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny }}>
          今天还没有记录 · 文字、照片和语音都会留在同一时间线
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { borderColor: theme.colors.borderSoft, backgroundColor: theme.colors.surface }]}>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起今天的记录' : '展开今天的记录'}
        style={({ pressed }) => [styles.summary, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.count, { backgroundColor: theme.colors.primarySoft }]}>
          <Text style={{ color: theme.colors.primary, fontSize: theme.font.tiny, fontWeight: '800' }}>今天 {today.length}</Text>
        </View>
        <Text style={[styles.source, { color: theme.colors.textTertiary }]}>
          {journalSourceLabel(latest.sourceRef)}
        </Text>
        <Text style={[styles.latest, { color: theme.colors.textSecondary }]} numberOfLines={1}>
          {recordText(latest)}
        </Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny }}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>

      {expanded ? (
        <View style={[styles.list, { borderTopColor: theme.colors.borderSoft }]}>
          {today.slice(0, 3).map((event, index) => (
            <View
              key={event.id}
              accessible
              accessibilityLabel={`今天记录，${journalSourceLabel(event.sourceRef)}，${timeLabel(event.startTime)}，${recordText(event)}`}
              style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.borderSoft }]}
            >
              <Text style={[styles.time, { color: theme.colors.textTertiary }]}>{timeLabel(event.startTime)}</Text>
              <View style={[styles.sourcePill, { backgroundColor: theme.colors.surfaceAlt }]}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.tiny, fontWeight: '700' }}>
                  {journalSourceLabel(event.sourceRef)}
                </Text>
              </View>
              <Text style={[styles.rowText, { color: theme.colors.textPrimary }]} numberOfLines={1}>{recordText(event)}</Text>
            </View>
          ))}
          {today.length > 3 ? (
            <Text style={[styles.more, { color: theme.colors.textTertiary }]}>还有 {today.length - 3} 条已保存</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { marginHorizontal: 16, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  empty: { marginHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, alignItems: 'center' },
  summary: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },
  count: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  source: { fontSize: 11, fontWeight: '700' },
  latest: { flex: 1, minWidth: 0, fontSize: 12 },
  list: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10 },
  row: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { width: 38, fontSize: 10, fontVariant: ['tabular-nums'] },
  sourcePill: { minWidth: 37, alignItems: 'center', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  rowText: { flex: 1, minWidth: 0, fontSize: 11 },
  more: { fontSize: 10, paddingBottom: 8, paddingLeft: 46 },
});
