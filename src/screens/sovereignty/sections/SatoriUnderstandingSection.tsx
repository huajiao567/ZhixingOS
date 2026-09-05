/**
 * SatoriUnderstandingSection —— 「我注意到」子页（V4.3 Task 25.5）
 *
 * 显示当前 Satori 从数据中提炼的理解：候选模式、经验、技能、元原理。
 * 提供「纠正某一条」和「查看支撑证据」入口。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Card, Tag, PrimaryButton, useTextStyles } from '../../../components/ui';
import { Glyph } from '../../../components/glyphs';
import { useAppTheme } from '../../../theme/theme';
import { useEvidenceStore } from '../../../store/useEvidenceStore';
import type { PatternCandidate, ExperienceUnit, PersonalSkill, MetaPrinciple, CorrectionType } from '../../../types/models';

type TabKey = 'patterns' | 'experiences' | 'skills' | 'meta';

const TAB_ORDER: { key: TabKey; label: string }[] = [
  { key: 'patterns', label: '模式' },
  { key: 'experiences', label: '经验' },
  { key: 'skills', label: '技能' },
  { key: 'meta', label: '元原理' },
];

interface Props {
  pushAudit: (actor: string, action: string, targetRef?: string) => void;
  onTraceEvidences?: (evidenceIds: string[], title: string) => void;
}

export function SatoriUnderstandingSection({ pushAudit, onTraceEvidences }: Props) {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const [tab, setTab] = useState<TabKey>('patterns');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const patterns = useEvidenceStore((s) => s.patterns);
  const experiences = useEvidenceStore((s) => s.experiences);
  const personalSkills = useEvidenceStore((s) => s.personalSkills);
  const metaPrinciples = useEvidenceStore((s) => s.metaPrinciples);
  const addCorrection = useEvidenceStore((s) => s.createCorrection);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await useEvidenceStore.getState().loadAll('local');
    } catch (err: any) {
      setError(err?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refute = async (kind: string, id: string, title: string) => {
    try {
      const correctionType: CorrectionType = 'unlike-me';
      await addCorrection({
        target_id: id,
        target_type: kind as any,
        correction_type: correctionType,
        user_text: '不是这样',
      });
      pushAudit('用户', `反驳${kind}：${title}`, id);
      await load();
    } catch (err: any) {
      setError(err?.message ?? '操作失败');
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerWrap, { paddingVertical: theme.spacing.xl }]}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>正在读取我对你的理解…</Text>
      </View>
    );
  }

  const emptyMsg = (label: string) => `还没有${label}。多记录一些事件后，我会慢慢提出。`;

  return (
    <View>
      <Text style={[styles.intro, ts.secondary]}>
        这里显示我从你的数据中提炼的理解——模式、经验、技能、元原理。
        它们都是可纠正的：你觉得不对，点一下「不是这样」，我就会标记，不再据此推断。
      </Text>

      {error && (
        <View style={[styles.errorBox, { backgroundColor: theme.colors.redSoft, borderRadius: theme.radius.md, padding: theme.spacing.sm, marginBottom: theme.spacing.sm, borderColor: theme.colors.red }]}>
          <Glyph name="warn" size={14} color={theme.colors.red} />
          <Text style={[ts.secondary, { flex: 1, color: theme.colors.red }]}>{error}</Text>
          <Pressable onPress={() => setError(null)} accessibilityLabel="关闭错误提示" accessibilityRole="button">
            <Text style={{ color: theme.colors.red, fontSize: theme.font.tiny }}>×</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.tabBar, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: 4, marginBottom: theme.spacing.md, borderColor: theme.colors.border }]}>
        {TAB_ORDER.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabItem, active && [styles.tabItemActive, { backgroundColor: theme.colors.surfaceAlt }], { borderRadius: theme.radius.sm, minHeight: theme.touch.minTarget, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' }]}
              accessibilityLabel={`切换到${t.label}标签`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[ts.body, { color: active ? theme.colors.textPrimary : theme.colors.textSecondary, fontWeight: active ? '700' : '500' }]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView style={{ maxHeight: 520 }} nestedScrollEnabled>
        {tab === 'patterns' && (
          <View>
            {patterns.length === 0 && <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>{emptyMsg('模式')}</Text>}
            {patterns.map((p: PatternCandidate) => (
              <Card key={p.id} style={[styles.itemCard, { marginBottom: theme.spacing.sm }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={[ts.body, { flex: 1, fontWeight: '600' }]}>{p.statement}</Text>
                  <Tag text={`${p.recurrence_count} 次出现`} color={p.recurrence_count > 3 ? theme.colors.primary : theme.colors.textTertiary} />
                </View>
                <Text style={[ts.tertiary, { marginTop: 4 }]}>涉及 {p.domain_count} 个领域，支持证据 {p.support_ids.length} 条</Text>
                <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
                  {onTraceEvidences && (
                    <PrimaryButton small ghost title="查看支撑证据" onPress={() => onTraceEvidences(p.support_ids, p.statement)} accessibilityLabel="查看这条模式的支撑证据" />
                  )}
                  <PrimaryButton small ghost danger title="不是这样" onPress={() => refute('pattern', p.id, p.statement)} accessibilityLabel="反驳这条模式" />
                </View>
              </Card>
            ))}
          </View>
        )}

        {tab === 'experiences' && (
          <View>
            {experiences.length === 0 && <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>{emptyMsg('经验')}</Text>}
            {experiences.map((e: ExperienceUnit) => (
              <Card key={e.id} style={[styles.itemCard, { marginBottom: theme.spacing.sm }]}>
                <Text style={[ts.body, { fontWeight: '600' }]}>{e.lesson ?? e.problem ?? '经验'}</Text>
                {e.context && <Text style={[ts.tertiary, { marginTop: 4 }]}>情境：{e.context}</Text>}
                <Text style={[ts.tertiary, { marginTop: 4 }]}>成熟度：{e.maturity}，支持证据 {e.support_ids.length} 条</Text>
                <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
                  <PrimaryButton small ghost danger title="这不是我的经验" onPress={() => refute('experience', e.id, e.lesson ?? e.id)} accessibilityLabel="反驳这条经验" />
                </View>
              </Card>
            ))}
          </View>
        )}

        {tab === 'skills' && (
          <View>
            {personalSkills.length === 0 && <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>{emptyMsg('技能')}</Text>}
            {personalSkills.map((s: PersonalSkill) => (
              <Card key={s.id} style={[styles.itemCard, { marginBottom: theme.spacing.sm }]}>
                <Text style={[ts.body, { fontWeight: '600' }]}>{s.trigger ?? s.scope ?? '技能'}</Text>
                {s.procedure && s.procedure.length > 0 && (
                  <View style={{ marginTop: 4 }}>
                    {s.procedure.slice(0, 3).map((step, i) => (
                      <Text key={i} style={ts.tertiary}>• {step}</Text>
                    ))}
                  </View>
                )}
                <Text style={[ts.tertiary, { marginTop: 4 }]}>证据 {s.evidence_refs.length} 条，版本 v{s.version}</Text>
                <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
                  <PrimaryButton small ghost danger title="这不准确" onPress={() => refute('skill', s.id, s.trigger ?? s.id)} accessibilityLabel="反驳这条技能" />
                </View>
              </Card>
            ))}
          </View>
        )}

        {tab === 'meta' && (
          <View>
            {metaPrinciples.length === 0 && <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>{emptyMsg('元原理')}</Text>}
            {metaPrinciples.map((m: MetaPrinciple) => (
              <Card key={m.id} style={[styles.itemCard, { marginBottom: theme.spacing.sm }]}>
                <Text style={[ts.body, { fontWeight: '600' }]}>{m.statement}</Text>
                <Text style={[ts.tertiary, { marginTop: 4 }]}>领域：{m.domains.join('、')}，状态：{m.status}</Text>
                <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
                  <PrimaryButton small ghost danger title="我不这么认为" onPress={() => refute('meta_principle', m.id, m.statement)} accessibilityLabel="反驳这条元原理" />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { lineHeight: 19, marginBottom: 12 },
  centerWrap: { alignItems: 'center', justifyContent: 'center' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderWidth: 1,
    gap: 2,
  },
  tabItem: { flex: 1, alignItems: 'center' },
  tabItemActive: {},
  itemCard: {},
});
