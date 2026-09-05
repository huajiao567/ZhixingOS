/**
 * ProactivitySection —— 「出现方式与主动通知」子页（V4.3 Task 25.4 + 25.10）
 *
 * 显示当前通知密度（P0–P4）、显示方式（是否在 3D / 头像 / 纯文字）、
 * 以及「每周报告的时间段、触发条件（承诺到期、可能有趣、关键节点、我问了又问了）。
 *
 * Avatar 四档：V0 文字 / V1 2D 图标 / V2 静态 3D / V3 动态 3D。
 * 注：V4.3 先实现 2D/3D 切换的开关逻辑，3D 模型由 Task 27 完成。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Switch, Pressable } from 'react-native';
import { Card, Tag, PrimaryButton, Divider, useTextStyles } from '../../../components/ui';
import { Glyph } from '../../../components/glyphs';
import { useAppTheme } from '../../../theme/theme';
import type { ServiceContract, ProactivityLevel, AvatarVisibility } from '../../../types/models';

const P_LABEL: Record<ProactivityLevel, string> = {
  P0: '不出现（等我找你）',
  P1: '只在承诺到期时',
  P2: '每天 1 次建议',
  P3: '关键节点提醒',
};

const P_DESC: Record<ProactivityLevel, string> = {
  P0: '你不找我，我就不出现。只在你打开 App 时才会说话。',
  P1: '只在我记下的承诺到期或任务截止前提醒你。',
  P2: '每天给你一次当日建议或当日简报，不打扰。',
  P3: '在关键节点提醒你——比如状态转折、实验完成、模式被推翻。',
};

const V_LABEL: Record<AvatarVisibility, string> = {
  V0: '纯文字（不显示形象）',
  V1: '2D 符号头像',
  V2: '静态 3D 形象',
  V3: '动态 3D 形象',
};

const V_DESC: Record<AvatarVisibility, string> = {
  V0: '只用文字回应，不显示任何头像或 3D 形象。',
  V1: '用简单 2D 图标表示状态，不加载 3D 模型，省流量省电。',
  V2: '展示完整 3D 卡通形象，但没有动画，性能友好。',
  V3: '完整动态 3D 形象，会眨眼、轻轻动，更有陪伴感。',
};

interface Props {
  contract: ServiceContract | null;
  onPatch: (patch: Partial<ServiceContract>) => void;
}

export function ProactivitySection({ contract, onPatch }: Props) {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const p = contract?.proactivity ?? 'P1';
  const v = contract?.avatar ?? 'V2';

  // P3+ 才会出现在哪些情境
  const triggerScenarios = useMemo(() => {
    if (p === 'P0') return [] as string[];
    const base: string[] = [];
    if (p >= 'P1') base.push('承诺到期 / 任务截止前');
    if (p >= 'P2') base.push('每日建议 / 今日简报');
    if (p >= 'P3') base.push('状态关键节点（比如模式被推翻、实验完成）');
    return base;
  }, [p]);

  const setP = (level: ProactivityLevel) => onPatch({ proactivity: level });
  const setV = (level: AvatarVisibility) => onPatch({ avatar: level });

  return (
    <View>
      <Text style={[styles.intro, ts.secondary]}>
        这里决定我会以什么方式、多频繁地出现。你可以随时调高调低。
      </Text>

      {/* 出现频率 */}
      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>出现频率</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          当前：<Text style={{ fontWeight: '700' }}>{P_LABEL[p]}</Text>
        </Text>
        <View style={styles.pList}>
          {(['P0', 'P1', 'P2', 'P3'] as ProactivityLevel[]).map((level) => {
          const active = p === level;
          return (
            <Pressable
              key={level}
              accessibilityLabel={`出现频率：${P_LABEL[level]}。${P_DESC[level]}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setP(level)}
              style={[styles.pRow, active && [styles.pRowActive, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }], { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                  {P_LABEL[level]}
                </Text>
                <Text style={ts.tertiary}>{P_DESC[level]}</Text>
              </View>
              <View style={[styles.radio, active && [styles.radioActive, { borderColor: theme.colors.primary }], { borderColor: theme.colors.border }]}>
                {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
              </View>
            </Pressable>
          );
        })}
        </View>

        <Divider />
        <Text style={[ts.tertiary, { marginBottom: theme.spacing.sm }]}>会触发出现的场景：</Text>
        {triggerScenarios.length === 0 ? (
          <Text style={ts.secondary}>（不主动出现）</Text>
        ) : (
          triggerScenarios.map((s, i) => (
            <View key={i} style={styles.scenarioItem}>
              <Glyph name="check" size={12} color={theme.colors.green} />
              <Text style={ts.secondary}>{s}</Text>
            </View>
          ))
        )}
      </Card>

      {/* 显示方式：2D/3D 形象（Task 25.10） */}
      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>显示方式</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          当前：<Text style={{ fontWeight: '700' }}>{V_LABEL[v]}</Text>
        </Text>
        <View style={styles.vList}>
          {(['V0', 'V1', 'V2', 'V3'] as AvatarVisibility[]).map((level) => {
            const active = v === level;
            return (
              <Pressable
                key={level}
                accessibilityLabel={`显示方式：${V_LABEL[level]}。${V_DESC[level]}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setV(level)}
                style={[styles.vRow, active && [styles.vRowActive, { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }], { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm }]}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                      {V_LABEL[level]}
                    </Text>
                  </View>
                  <Text style={ts.tertiary}>{V_DESC[level]}</Text>
                </View>
                <View style={[styles.radio, active && [styles.radioActive, { borderColor: theme.colors.primary }], { borderColor: theme.colors.border }]}>
                  {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* 晚间总结时段 */}
      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>晚间总结时段</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          每天 21:30 — 22:30 之间，如果你在 App 里，我会问你今天怎么样。
          不想被问就关掉。
        </Text>
        <View style={[styles.rowRight, { marginTop: theme.spacing.md }]}>
          <Text style={ts.body}>晚间总结</Text>
          <Switch
            value={p !== 'P0'}
            onValueChange={(v) => onPatch({ proactivity: v ? 'P2' : 'P0' })}
            trackColor={{ false: theme.colors.border, true: theme.colors.indigo }}
            thumbColor="#fff"
            accessibilityLabel={`晚间总结：${p !== 'P0' ? '已开启' : '已关闭'}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: p !== 'P0' }}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { lineHeight: 19, marginBottom: 12 },
  sectionCard: {},
  title: { fontWeight: '700' },
  pList: { marginTop: 12 },
  pRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  pRowActive: {},
  scenarioItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  vList: { marginTop: 12 },
  vRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  vRowActive: {},
  vRowDisabled: { opacity: 0.6 },
  rowRight: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginLeft: 12,
  },
  radioActive: {},
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
