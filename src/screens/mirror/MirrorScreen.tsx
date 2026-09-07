import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { useStore } from '../../store/useStore';
import { useAppTheme, shadowStyle } from '../../theme/theme';
import { Card, Tag, BipolarBar, Bar, PrimaryButton, useTextStyles } from '../../components/ui';
import { AmbientBackground } from '../../components/AmbientBackground';
import { HypothesisCard } from '../../components/HypothesisCard';
import { POSITION_META } from '../../domain/positions';
import { EvidenceLevel } from '../../types/models';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Mirror3DPanel } from '../../mirror3d/integration';
import { api, type WeeklyBriefResponse, type MonthlyBriefResponse } from '../../services/api';
import { journalSourceLabel } from '../../ai-native/intake/journalRecord';
import { preloadMirror3DEditor } from '../../mirror3d/screens/loadMirror3DEditor';

type Tab = 'hypotheses' | 'timeline' | 'state' | 'weekly' | 'monthly';

type BriefSource = 'llm' | 'fallback' | 'empty' | 'loading';

const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  insufficient: '证据不足',
  preliminary: '初步迹象',
  consistent: '多源一致',
};

export function MirrorScreen() {
  const [tab, setTab] = useState<Tab>('hypotheses');
  const s = useStore();
  const theme = useAppTheme();
  const ts = useTextStyles();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const [domainFilter, setDomainFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!isFocused) return;
    const timer = setTimeout(() => preloadMirror3DEditor(), 250);
    return () => clearTimeout(timer);
  }, [isFocused]);

  // ---------- 周镜状态（SubTask 10.4） ----------
  const [weeklyBrief, setWeeklyBrief] = useState<WeeklyBriefResponse | null>(null);
  const [weeklySource, setWeeklySource] = useState<BriefSource>('loading');

  // ---------- 月镜状态（SubTask 10.5） ----------
  const [monthlyBrief, setMonthlyBrief] = useState<MonthlyBriefResponse | null>(null);
  const [monthlySource, setMonthlySource] = useState<BriefSource>('loading');

  // 月镜候选经验的 UI 操作状态（删除/标注后从 UI 移除）
  const [removedExperiences, setRemovedExperiences] = useState<Set<number>>(new Set());
  const [removedQuestions, setRemovedQuestions] = useState<Set<number>>(new Set());
  const [removedStaleInsights, setRemovedStaleInsights] = useState<Set<number>>(new Set());

  // 月镜「修改」编辑弹层
  const [editingExperience, setEditingExperience] = useState<{ index: number; original: string } | null>(null);
  const [editLesson, setEditLesson] = useState('');
  const [editScope, setEditScope] = useState('');

  // 顶部下拉刷新（同时刷新周月镜）
  const [refreshing, setRefreshing] = useState(false);

  const refreshWeekly = useCallback(async () => {
    setWeeklySource('loading');
    try {
      const b = await api.brief.weekly();
      setWeeklyBrief(b);
      setWeeklySource(b.generatedBy);
    } catch {
      setWeeklyBrief(null);
      setWeeklySource('fallback');
    }
  }, []);

  const refreshMonthly = useCallback(async () => {
    setMonthlySource('loading');
    setRemovedExperiences(new Set());
    setRemovedQuestions(new Set());
    setRemovedStaleInsights(new Set());
    try {
      const b = await api.brief.monthly();
      setMonthlyBrief(b);
      setMonthlySource(b.generatedBy);
    } catch {
      setMonthlyBrief(null);
      setMonthlySource('fallback');
    }
  }, []);

  // 切到周镜/月镜 Tab 时按需拉取
  useEffect(() => {
    if (tab === 'weekly' && weeklySource === 'loading') {
      refreshWeekly();
    }
    if (tab === 'monthly' && monthlySource === 'loading') {
      refreshMonthly();
    }
  }, [tab, weeklySource, monthlySource, refreshWeekly, refreshMonthly]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshWeekly(), refreshMonthly()]);
    setRefreshing(false);
  }, [refreshWeekly, refreshMonthly]);

  // ---------- 月镜候选经验操作（SubTask 10.5） ----------
  const handleKeepExperience = async (text: string, index: number) => {
    try {
      await api.experiences.create({
        maturity: 'observed',
        lesson: text,
        applicability: '用户在月镜中确认保留',
        version: 1,
      });
      setRemovedExperiences((prev) => new Set(prev).add(index));
      Alert.alert('已留下', '这条经验已记入「我的长期档案」。');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ?? '请稍后重试');
    }
  };

  const handleEditExperience = (text: string, index: number) => {
    setEditingExperience({ index, original: text });
    setEditLesson(text);
    setEditScope('');
  };

  const handleSubmitEdit = async () => {
    if (!editingExperience) return;
    const lesson = editLesson.trim();
    if (!lesson) {
      Alert.alert('请填写方法摘要');
      return;
    }
    try {
      await api.experiences.create({
        maturity: 'observed',
        lesson,
        applicability: editScope.trim() || '用户在月镜中修改后保留',
        version: 1,
      });
      setRemovedExperiences((prev) => new Set(prev).add(editingExperience.index));
      setEditingExperience(null);
      setEditLesson('');
      setEditScope('');
      Alert.alert('已留下', '修改后的方法已记入「我的长期档案」。');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ?? '请稍后重试');
    }
  };

  const handleDeleteExperience = (index: number) => {
    setRemovedExperiences((prev) => new Set(prev).add(index));
  };

  const handleSpecialCase = async (index: number) => {
    try {
      await api.corrections.create({
        target_id: `cand-exp-${index}`,
        target_type: 'experience',
        correction_type: 'special-case',
        user_text: '只适用于最近',
      });
      setRemovedExperiences((prev) => new Set(prev).add(index));
      Alert.alert('已标注', '这条经验被标注为「只适用于最近」，不会作为长期模式使用。');
    } catch (e: any) {
      Alert.alert('标注失败', e?.message ?? '请稍后重试');
    }
  };

  // ---------- 月镜开放问题操作 ----------
  const handleThinkAboutQuestion = async (question: string, index: number) => {
    try {
      const id = `H-mirror-${Date.now()}`;
      const nowIso = new Date().toISOString();
      const reviewAt = new Date(Date.now() + 14 * 86400_000).toISOString();
      await api.post('/api/data/hypotheses', {
        id,
        statement: question,
        confidence: 0.3,
        status: 'open',
        supporting: [],
        countering: [],
        alternatives: [],
        dataGaps: [],
        harmNote: '来自月镜开放问题，需用户进一步补充证据与反证。',
        reviewAt,
        createdAt: nowIso,
        history: [{ at: nowIso, change: '从月镜开放问题创建', confidence: 0.3 }],
      });
      setRemovedQuestions((prev) => new Set(prev).add(index));
      Alert.alert('已记下', '这个问题已变成一张假设卡，可在「假设卡」Tab 继续追踪。');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ?? '请稍后重试');
    }
  };

  // ---------- 月镜失效旧认识操作 ----------
  const handlePhaseChanged = async (insight: string, index: number) => {
    try {
      await api.corrections.create({
        target_id: `stale-insight-${index}`,
        target_type: 'pattern',
        correction_type: 'phase-changed',
        user_text: insight,
      });
      setRemovedStaleInsights((prev) => new Set(prev).add(index));
      Alert.alert('已记下', '这条旧认识被标记为「以前是这样，现在不是了」。');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message ?? '请稍后重试');
    }
  };

  const handleStillUsingInsight = (index: number) => {
    setRemovedStaleInsights((prev) => new Set(prev).add(index));
  };

  const domains = Array.from(new Set(s.events.map((e) => e.domain)));
  const timeline = s.events
    .filter((e) => !domainFilter || e.domain === domainFilter)
    .sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime))
    .slice(0, 40);

  const openHypotheses = s.hypotheses.filter((h) => h.status === 'open' || h.status === 'confirmed');

  return (
    <View style={[styles.scroll, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { padding: theme.spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
        }
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.xs / 2 }}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="返回主页"
            style={({ pressed }) => ({
              width: 40, height: 40, borderRadius: 20,
              alignItems: 'center', justifyContent: 'center',
              marginLeft: -8, marginRight: 4,
              backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
            })}
          >
            <Text style={{ fontSize: 28, lineHeight: 32, color: theme.colors.textPrimary, fontWeight: '300' }}>←</Text>
          </Pressable>
          <Text style={[styles.pageTitle, { color: theme.colors.textPrimary, fontSize: theme.font.hero }]}>镜像</Text>
        </View>
        <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, marginTop: theme.spacing.xs / 2, marginBottom: theme.spacing.md }}>
          事实、假设与状态 —— 一切可反驳，一切可修正
        </Text>

        <Mirror3DPanel
          height={360}
          paused={!isFocused}
          onOpenEditor={() => navigation.navigate('Mirror3DEditor')}
        />

        {/* Tab 切换 */}
        <View style={[styles.tabRow, {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.borderSoft,
          marginBottom: theme.spacing.lg,
          padding: theme.spacing.xs,
        }]}>
          {([
            ['hypotheses', '假设卡'],
            ['timeline', '时间线'],
            ['state', '六位状态'],
            ['weekly', '周镜'],
            ['monthly', '月镜'],
          ] as [Tab, string][]).map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setTab(k)}
              style={({ pressed }) => [
                {
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: theme.spacing.sm,
                  minHeight: theme.touch.minTarget,
                  borderRadius: theme.radius.sm,
                  opacity: pressed ? 0.75 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                },
                tab === k && { backgroundColor: theme.colors.primarySoft },
              ]}
              accessibilityRole="tab"
              accessibilityLabel={`切换到${label}Tab`}
              accessibilityState={{ selected: tab === k }}
            >
              <Text style={{ color: tab === k ? theme.colors.primary : theme.colors.textTertiary, fontSize: theme.font.small, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'hypotheses' && (
          <View>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: theme.font.small * 1.5, marginBottom: theme.spacing.md }}>
              假设不是结论。每张卡都带来源证据、反证、替代解释与到期日；你可以确认、修正或推翻，你的修正优先于模型。
            </Text>
            {openHypotheses.map((h) => <HypothesisCard key={h.id} h={h} />)}
            {s.hypotheses.filter((h) => h.status === 'refuted' || h.status === 'expired').length > 0 && (
              <Text style={[ts.tertiary, { textAlign: 'center', marginTop: theme.spacing.md }]}>
                另有 {s.hypotheses.filter((h) => h.status === 'refuted' || h.status === 'expired').length} 张已推翻/过期卡片，保存在记忆治理中
              </Text>
            )}
          </View>
        )}

        {tab === 'timeline' && (
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.spacing.md }}>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Pressable onPress={() => setDomainFilter(null)}>
                  <Tag text="全部" color={!domainFilter ? theme.colors.primary : theme.colors.textTertiary} bg={!domainFilter ? theme.colors.primarySoft : theme.colors.surface} />
                </Pressable>
                {domains.map((d) => (
                  <Pressable key={d} onPress={() => setDomainFilter(d === domainFilter ? null : d)}>
                    <Tag text={d} color={domainFilter === d ? theme.colors.primary : theme.colors.textTertiary} bg={domainFilter === d ? theme.colors.primarySoft : theme.colors.surface} />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: theme.font.small * 1.5, marginBottom: theme.spacing.md }}>
              每条事实都标注来源与时间。时间线不替你讲故事，只保留可追溯的记录。
            </Text>
            {timeline.map((e) => (
              <Card key={e.id} accent={theme.colors.primary} style={{ marginBottom: theme.spacing.sm }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Tag text={e.domain} color={theme.colors.textSecondary} bg={theme.colors.surfaceSoft} />
                  <Text style={ts.tertiary}>
                    {new Date(e.startTime).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                    {new Date(e.startTime).getHours() ? ` ${String(new Date(e.startTime).getHours()).padStart(2, '0')}:00` : ''}
                  </Text>
                </View>
                <Text style={[ts.body, { marginTop: theme.spacing.sm, fontSize: theme.font.small }]}>{e.title}</Text>
                {e.userInterpretation && (
                  <Text style={{ color: theme.colors.violet, fontSize: theme.font.small, fontStyle: 'italic', marginTop: theme.spacing.xs, lineHeight: theme.font.small * 1.5 }}>
                    「{e.userInterpretation}」
                  </Text>
                )}
                <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
                  来源：{e.type === 'journal' ? journalSourceLabel(e.sourceRef) : e.sourceRef} · {e.confidence >= 0.7 ? '来源较可靠' : e.confidence >= 0.4 ? '来源仅供参考' : '来源待核实'}
                </Text>
              </Card>
            ))}
          </View>
        )}

        {tab === 'state' && (
          <View>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: theme.font.small * 1.5, marginBottom: theme.spacing.md }}>
              六位状态只是一个「启发式状态摘要器」的粗略估计，不是你的人格标签，也不宣称理解或预测你。证据不足时，它只说「我们还看不清」，而不是下结论。
            </Text>
            <Card accent={theme.colors.primary}>
              <Text style={ts.title}>当前摘要</Text>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs }]}>{s.state.note}</Text>
            </Card>

            <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.violet}>
              <Text style={ts.title}>六位结构</Text>
              <Text style={[ts.tertiary, { marginBottom: theme.spacing.md }]}>内观来自主观自述，观外来自日历、任务、作品与健康证据；只呈现方向，不把人压缩成分数。</Text>
              {POSITION_META.map((m) => {
                const inner = s.state.inner[m.key];
                const outer = s.state.outer[m.key];
                const level = s.state.evidenceLevels[m.key];
                const isChange = s.state.changePositions.some((c) => c.startsWith(m.key));
                const lColor = theme.colors[m.key.toLowerCase() as 'l1'];
                const evidenceColor = level === 'consistent' ? theme.colors.green : level === 'preliminary' ? theme.colors.amber : theme.colors.textTertiary;
                return (
                  <View key={m.key} style={{ marginBottom: theme.spacing.lg }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={[ts.body, { fontSize: theme.font.small, fontWeight: '700' }]}>
                        {m.key} {m.label} {isChange ? '· 变化位置' : ''}
                      </Text>
                      <Tag text={EVIDENCE_LABEL[level]} color={evidenceColor} />
                    </View>
                    <Text style={[ts.tertiary, { marginBottom: theme.spacing.xs }]}>{m.desc}</Text>
                    <Text style={[ts.tertiary, { marginBottom: theme.spacing.xs }]}>
                      内观来源：{m.innerSource} ｜ 观外来源：{m.outerSource}
                    </Text>
                    <View style={{ gap: theme.spacing.xs }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Text style={[ts.tertiary, { width: 30 }]}>内观</Text>
                        <View style={{ flex: 1 }}><BipolarBar value={inner} color={lColor} /></View>
                        <Text style={[ts.tertiary, { width: 72, textAlign: 'right' }]}>{inner > 0.2 ? '较为舒展' : inner < -0.2 ? '有所收缩' : '信号平缓'}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Text style={[ts.tertiary, { width: 30 }]}>观外</Text>
                        <View style={{ flex: 1 }}><BipolarBar value={outer} color={theme.colors.textTertiary} /></View>
                        <Text style={[ts.tertiary, { width: 72, textAlign: 'right' }]}>{outer > 0.2 ? '较为舒展' : outer < -0.2 ? '有所收缩' : '信号平缓'}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>

            <Card style={{ marginTop: theme.spacing.md }} accent={Math.abs(s.state.divergence) > 0.25 ? theme.colors.red : theme.colors.green}>
              <Text style={ts.title}>两条证据链的关系</Text>
              <Text style={ts.secondary}>
                {s.state.divergence > 0.25
                  ? '落差偏高。系统不会宣布"你言行不一"，而是检查替代解释（疲劳、照护责任、环境压力），并优先提出高信息量问题。'
                  : '两条证据链暂无显著落差，可形成暂时洞察并设计可验证的行动。'}
              </Text>
            </Card>
          </View>
        )}

        {tab === 'weekly' && (
          <WeeklyMirrorPanel
            source={weeklySource}
            brief={weeklyBrief}
            onRefresh={refreshWeekly}
            theme={theme}
            ts={ts}
          />
        )}

        {tab === 'monthly' && (
          <MonthlyMirrorPanel
            source={monthlySource}
            brief={monthlyBrief}
            removedExperiences={removedExperiences}
            removedQuestions={removedQuestions}
            removedStaleInsights={removedStaleInsights}
            onKeepExperience={handleKeepExperience}
            onEditExperience={handleEditExperience}
            onDeleteExperience={handleDeleteExperience}
            onSpecialCase={handleSpecialCase}
            onThinkAboutQuestion={handleThinkAboutQuestion}
            onPhaseChanged={handlePhaseChanged}
            onStillUsingInsight={handleStillUsingInsight}
            onRefresh={refreshMonthly}
            theme={theme}
            ts={ts}
          />
        )}

        <View style={{ height: theme.spacing.xxl * 2 }} />

        {/* 月镜「修改」编辑弹层 */}
        <Modal
          visible={editingExperience !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingExperience(null)}
        >
          <View style={[editModalStyles.overlay, { padding: theme.spacing.lg }]}>
            <View style={[
              editModalStyles.card,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.borderSoft,
                ...shadowStyle(theme.shadow.card),
              },
            ]} accessibilityRole="alert" accessibilityLabel="修改方法摘要弹层">
              <Text style={{ color: theme.colors.textPrimary, fontSize: theme.font.title, marginBottom: theme.spacing.sm }}>改一下这条方法</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.tiny, fontWeight: '600', marginBottom: theme.spacing.xs }}>方法摘要</Text>
              <TextInput
                style={[
                  editModalStyles.input,
                  {
                    backgroundColor: theme.colors.bg,
                    borderRadius: theme.radius.md,
                    color: theme.colors.textPrimary,
                    fontSize: theme.font.body,
                    borderWidth: 1,
                    borderColor: theme.colors.borderSoft,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    minHeight: theme.touch.minTarget,
                  },
                ]}
                value={editLesson}
                onChangeText={setEditLesson}
                placeholder="一句话写下这次留下的方法"
                placeholderTextColor={theme.colors.textTertiary}
                multiline
                accessibilityLabel="方法摘要输入框"
              />
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.tiny, fontWeight: '600', marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs }}>适用范围（可选）</Text>
              <TextInput
                style={[
                  editModalStyles.input,
                  {
                    backgroundColor: theme.colors.bg,
                    borderRadius: theme.radius.md,
                    color: theme.colors.textPrimary,
                    fontSize: theme.font.body,
                    borderWidth: 1,
                    borderColor: theme.colors.borderSoft,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm,
                    minHeight: theme.touch.minTarget,
                  },
                ]}
                value={editScope}
                onChangeText={setEditScope}
                placeholder="例如：只在冲刺期 / 只对写作任务"
                placeholderTextColor={theme.colors.textTertiary}
                accessibilityLabel="适用范围输入框"
              />
              <View style={[editModalStyles.btnRow, { marginTop: theme.spacing.md, gap: theme.spacing.sm }]}>
                <PrimaryButton
                  title="取消"
                  ghost
                  small
                  onPress={() => setEditingExperience(null)}
                  accessibilityLabel="取消修改方法"
                />
                <PrimaryButton
                  title="留下"
                  small
                  onPress={handleSubmitEdit}
                  accessibilityLabel="确认保存修改后的方法"
                />
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </View>
  );
}

// ---------- 周镜子组件（SubTask 10.4） ----------
function WeeklyMirrorPanel({
  source,
  brief,
  onRefresh,
  theme,
  ts,
}: {
  source: BriefSource;
  brief: WeeklyBriefResponse | null;
  onRefresh: () => void;
  theme: ReturnType<typeof useAppTheme>;
  ts: ReturnType<typeof useTextStyles>;
}) {
  if (source === 'loading') {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.xxl * 2, paddingHorizontal: theme.spacing.lg }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={[ts.tertiary, { marginTop: theme.spacing.md }]}>正在生成周镜……</Text>
      </View>
    );
  }

  if (source === 'empty') {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.xxl * 2, paddingHorizontal: theme.spacing.lg }}>
        <Text style={[panelStyles.emptyTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title, fontWeight: '700' }]}>这周还没有记录</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm, textAlign: 'center' }]}>
          先记一条试试？周镜会基于本周真实记录，给出值得记住的事和下周关注点。
        </Text>
        <View style={{ marginTop: theme.spacing.md }}>
          <PrimaryButton title="重新生成" ghost small onPress={onRefresh} accessibilityLabel="重新生成周镜" />
        </View>
      </View>
    );
  }

  if (!brief) {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.xxl * 2, paddingHorizontal: theme.spacing.lg }}>
        <Text style={[panelStyles.emptyTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title, fontWeight: '700' }]}>周镜暂时生成不了</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm, textAlign: 'center' }]}>
          可能是网络问题，稍后再试一次。
        </Text>
        <View style={{ marginTop: theme.spacing.md }}>
          <PrimaryButton title="重试" ghost small onPress={onRefresh} accessibilityLabel="重试生成周镜" />
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: theme.font.small * 1.5, marginBottom: theme.spacing.md }}>
        周镜只输出本周值得记住的事、反复出现的模式与下周关注点；不生成「本周人格」。
      </Text>

      <Card accent={theme.colors.primary}>
        <Tag text="本周值得记住的事" color={theme.colors.primary} />
        {brief.highlights.length === 0 ? (
          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>（这周没有足够记录）</Text>
        ) : (
          brief.highlights.map((t, i) => (
            <View key={i} style={{ marginTop: theme.spacing.md }}>
              <Text style={[ts.body, { fontSize: theme.font.small, fontWeight: '700' }]}>第 {i + 1} 条</Text>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs / 2 }]}>{t}</Text>
            </View>
          ))
        )}
      </Card>

      {brief.patterns.length > 0 && (
        <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.violet}>
          <Tag text="反复出现的模式" color={theme.colors.violet} />
          {brief.patterns.map((t, i) => (
            <Text key={i} style={[ts.secondary, { marginTop: theme.spacing.sm }]}>{t}</Text>
          ))}
        </Card>
      )}

      <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.green}>
        <Tag text="下周关注点" color={theme.colors.green} />
        {brief.nextWeekFocus.length === 0 ? (
          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>（暂无）</Text>
        ) : (
          brief.nextWeekFocus.map((t, i) => (
            <Text key={i} style={[ts.secondary, { marginTop: theme.spacing.sm }]}>{i + 1}. {t}</Text>
          ))
        )}
      </Card>

      <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.amber}>
        <Tag text="开放问题" color={theme.colors.amber} />
        {brief.openQuestions.length === 0 ? (
          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>（暂无）</Text>
        ) : (
          brief.openQuestions.map((q, i) => (
            <Text key={i} style={[ts.secondary, { marginTop: theme.spacing.sm }]}>{q}</Text>
          ))
        )}
      </Card>

      {source === 'fallback' && (
        <Text style={[ts.tertiary, { marginTop: theme.spacing.md, textAlign: 'center' }]}>
          周镜暂时用了简化版本。配置 LLM 后可获得更深入的回顾。
        </Text>
      )}
    </View>
  );
}

// ---------- 月镜子组件（SubTask 10.5） ----------
function MonthlyMirrorPanel({
  source,
  brief,
  removedExperiences,
  removedQuestions,
  removedStaleInsights,
  onKeepExperience,
  onEditExperience,
  onDeleteExperience,
  onSpecialCase,
  onThinkAboutQuestion,
  onPhaseChanged,
  onStillUsingInsight,
  onRefresh,
  theme,
  ts,
}: {
  source: BriefSource;
  brief: MonthlyBriefResponse | null;
  removedExperiences: Set<number>;
  removedQuestions: Set<number>;
  removedStaleInsights: Set<number>;
  onKeepExperience: (text: string, index: number) => void;
  onEditExperience: (text: string, index: number) => void;
  onDeleteExperience: (index: number) => void;
  onSpecialCase: (index: number) => void;
  onThinkAboutQuestion: (question: string, index: number) => void;
  onPhaseChanged: (insight: string, index: number) => void;
  onStillUsingInsight: (index: number) => void;
  onRefresh: () => void;
  theme: ReturnType<typeof useAppTheme>;
  ts: ReturnType<typeof useTextStyles>;
}) {
  if (source === 'loading') {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.xxl * 2, paddingHorizontal: theme.spacing.lg }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={[ts.tertiary, { marginTop: theme.spacing.md }]}>正在生成月镜……</Text>
      </View>
    );
  }

  if (source === 'empty') {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.xxl * 2, paddingHorizontal: theme.spacing.lg }}>
        <Text style={[panelStyles.emptyTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title, fontWeight: '700' }]}>这个月还没有足够记录</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm, textAlign: 'center' }]}>
          再记几天看看？月镜会基于本月的真实记录，提炼少量候选经验、开放问题和失效旧认识。
        </Text>
        <View style={{ marginTop: theme.spacing.md }}>
          <PrimaryButton title="重新生成" ghost small onPress={onRefresh} accessibilityLabel="重新生成月镜" />
        </View>
      </View>
    );
  }

  if (!brief) {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: theme.spacing.xxl * 2, paddingHorizontal: theme.spacing.lg }}>
        <Text style={[panelStyles.emptyTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title, fontWeight: '700' }]}>月镜暂时生成不了</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm, textAlign: 'center' }]}>
          可能是网络问题，稍后再试一次。
        </Text>
        <View style={{ marginTop: theme.spacing.md }}>
          <PrimaryButton title="重试" ghost small onPress={onRefresh} accessibilityLabel="重试生成月镜" />
        </View>
      </View>
    );
  }

  const visibleExperiences = brief.candidateExperiences
    .map((text, index) => ({ text, index }))
    .filter(({ index }) => !removedExperiences.has(index));
  const visibleQuestions = brief.openQuestions
    .map((q, index) => ({ q, index }))
    .filter(({ index }) => !removedQuestions.has(index));
  const visibleStaleInsights = brief.staleInsights
    .map((text, index) => ({ text, index }))
    .filter(({ index }) => !removedStaleInsights.has(index));

  return (
    <View>
      <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: theme.font.small * 1.5, marginBottom: theme.spacing.md }}>
        月镜是月度深度回顾：少量候选经验、开放问题与失效旧认识。这些都不是定论，你可以逐条保留、修改、删除或标注「只适用于最近」。
      </Text>

      <Card accent={theme.colors.primary}>
        <Tag text="本月主题" color={theme.colors.primary} />
        <Text style={[ts.body, { marginTop: theme.spacing.sm, fontWeight: '600' }]}>
          {brief.monthlyTheme || '（本月主题待生成）'}
        </Text>
      </Card>

      {/* 候选经验（spec A11.3 / SubTask 10.5） */}
      <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.green}>
        <Tag text="候选经验" color={theme.colors.green} />
        <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
          这些只是候选，不是定论。你可以逐条决定怎么处理。
        </Text>
        {visibleExperiences.length === 0 ? (
          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>
            {brief.candidateExperiences.length === 0 ? '（本月没有识别到候选经验）' : '（已全部处理）'}
          </Text>
        ) : (
          visibleExperiences.map(({ text, index }) => (
            <View key={index} style={{ marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.borderSoft }}>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs / 2 }]}>{text}</Text>
              <View style={[panelStyles.actionRow, { marginTop: theme.spacing.sm, gap: theme.spacing.sm }]}>
                <PrimaryButton
                  title="留下"
                  small
                  onPress={() => onKeepExperience(text, index)}
                  accessibilityLabel={`留下第${index + 1}条候选经验`}
                />
                <PrimaryButton
                  title="改一下"
                  small
                  ghost
                  onPress={() => onEditExperience(text, index)}
                  accessibilityLabel={`修改第${index + 1}条候选经验`}
                />
                <PrimaryButton
                  title="只是这次特殊"
                  small
                  ghost
                  onPress={() => onSpecialCase(index)}
                  accessibilityLabel={`把第${index + 1}条候选经验标注为只适用于最近`}
                />
                <PrimaryButton
                  title="删掉"
                  small
                  danger
                  onPress={() => onDeleteExperience(index)}
                  accessibilityLabel={`删掉第${index + 1}条候选经验`}
                />
              </View>
            </View>
          ))
        )}
      </Card>

      {/* 开放问题（spec A11.3 / SubTask 10.5） */}
      <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.amber}>
        <Tag text="开放问题" color={theme.colors.amber} />
        <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
          这些是本月遗留的开放问题。如果想继续想，可以变成一张假设卡。
        </Text>
        {visibleQuestions.length === 0 ? (
          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>
            {brief.openQuestions.length === 0 ? '（本月没有开放问题）' : '（已全部处理）'}
          </Text>
        ) : (
          visibleQuestions.map(({ q, index }) => (
            <View key={index} style={{ marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.borderSoft }}>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs / 2 }]}>{q}</Text>
              <View style={[panelStyles.actionRow, { marginTop: theme.spacing.sm, gap: theme.spacing.sm }]}>
                <PrimaryButton
                  title="我想想想这个"
                  small
                  ghost
                  onPress={() => onThinkAboutQuestion(q, index)}
                  accessibilityLabel={`把第${index + 1}个开放问题变成假设卡`}
                />
              </View>
            </View>
          ))
        )}
      </Card>

      {/* 失效旧认识（spec A11.3 / SubTask 10.5） */}
      <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.red}>
        <Tag text="失效旧认识" color={theme.colors.red} />
        <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
          这些旧认识看起来不再适用了。你确认后，系统会标记为「以前是这样，现在不是了」。
        </Text>
        {visibleStaleInsights.length === 0 ? (
          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>
            {brief.staleInsights.length === 0 ? '（本月没有识别到失效旧认识）' : '（已全部处理）'}
          </Text>
        ) : (
          visibleStaleInsights.map(({ text, index }) => (
            <View key={index} style={{ marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.borderSoft }}>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs / 2 }]}>{text}</Text>
              <View style={[panelStyles.actionRow, { marginTop: theme.spacing.sm, gap: theme.spacing.sm }]}>
                <PrimaryButton
                  title="确实不再适用"
                  small
                  danger
                  onPress={() => onPhaseChanged(text, index)}
                  accessibilityLabel={`确认第${index + 1}条旧认识确实不再适用`}
                />
                <PrimaryButton
                  title="还在用"
                  small
                  ghost
                  onPress={() => onStillUsingInsight(index)}
                  accessibilityLabel={`标记第${index + 1}条旧认识还在用`}
                />
              </View>
            </View>
          ))
        )}
      </Card>

      {/* 下月关注点 */}
      {brief.nextMonthFocus.length > 0 && (
        <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.violet}>
          <Tag text="下月关注点" color={theme.colors.violet} />
          {brief.nextMonthFocus.map((t, i) => (
            <Text key={i} style={[ts.secondary, { marginTop: theme.spacing.sm }]}>{i + 1}. {t}</Text>
          ))}
        </Card>
      )}

      {source === 'fallback' && (
        <Text style={[ts.tertiary, { marginTop: theme.spacing.md, textAlign: 'center' }]}>
          月镜暂时用了简化版本。配置 LLM 后可获得更深入的回顾。
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { paddingBottom: 80 },
  pageTitle: { fontWeight: '800' },
  tabRow: { flexDirection: 'row' },
});

const panelStyles = StyleSheet.create({
  emptyTitle: { textAlign: 'center' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap' },
});

const editModalStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  card: { width: '100%', maxWidth: 460 },
  input: { textAlignVertical: 'top' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end' },
});
