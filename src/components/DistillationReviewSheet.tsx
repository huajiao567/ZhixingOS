/**
 * 「这次留下了什么」经验沉淀确认 Sheet（V4.3 Task 12 / spec A6 / §5.17 / §9.14）
 *
 * 触发场景（spec SubTask 12.1）：
 *   1. 项目结束 —— project.status ∈ {'done','stopped'}
 *   2. 重复错误 —— 同一 hypothesis 被 user 纠正 ≥ 2 次
 *   3. 重大纠正 —— correction_type ∈ {'wrong-reason','phase-changed'}
 *   4. 阶段成果出现 —— experiment.status='completed' 且 result 有值
 *
 * 每张卡（spec SubTask 12.2）：
 *   - 标题：「这次好像留下了一个以后可能有用的方法。」
 *   - 一句方法摘要（来自候选 lesson）
 *   - 三个轻动作：留下 / 改一下 / 只是这次特殊
 *   - 「为什么」展开链接（evidenceSummaries 来源列表）
 *   - 「更多」菜单：「以后别这么理解」（spec SubTask 12.6）
 *
 * 动作 API 映射：
 *   - 留下        → api.experiences.create({ maturity:'observed', ... })         （SubTask 12.3）
 *   - 改一下      → 弹出编辑框修改 lesson/scope 后 create                         （SubTask 12.4）
 *   - 只是这次特殊 → api.corrections.create({ correction_type:'special-case' })   （SubTask 12.5）
 *   - 以后别这么理解 → api.corrections.create({ correction_type:'no-more-inference' }) （SubTask 12.6）
 *
 * 微文案对齐 spec A35：生活化语言，避免技术术语与禁词。
 * 无障碍对齐 spec A36：accessibilityLabel 全覆盖，触控目标 ≥48dp，长按有按钮备选。
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, TextInput, ScrollView, ActivityIndicator,
} from 'react-native';
import { useAppTheme } from '../theme/theme';
import { Card, PrimaryButton, Divider, useTextStyles } from './ui';
import { api } from '../services/api';
import type {
  Project, Hypothesis, Experiment, ModelCorrection, ExperienceMaturity,
} from '../types/models';

// ---------- 类型 ----------

/** 候选来源类型 —— 对应 4 种触发场景 */
export type DistillationSource = 'project_end' | 'repeated_error' | 'major_correction' | 'milestone';

/** detectDistillationCandidates 需要的状态切片 */
export interface DistillationState {
  projects: Project[];
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  corrections: ModelCorrection[];
}

/**
 * 经验沉淀候选。每张卡展示一个候选，用户通过 3+1 个动作决定其去向。
 * - targetId/targetType：可选，用于 correction 类动作（只是这次特殊 / 以后别这么理解）。
 *   若候选无关联假设（如 project_end 无关联 hypothesis），correction 动作将被禁用。
 * - id 含来源计数以保证稳定性：如 repeat-err-{hid}-{count}，count 变化时生成新 ID，
 *   使 RootNavigator 的 handledIds 能区分「已处理旧重复」与「新一次重复」。
 */
export interface DistillationCandidate {
  id: string;
  source: DistillationSource;
  lesson: string;                // 方法摘要（一句）
  scope: string;                 // 适用范围
  context: string;               // 来源情境描述
  problem?: string;
  actions?: string[];
  outcome?: string;
  evidenceSummaries: string[];   // 「为什么」展开内容
  targetId?: string;             // correction 动作的目标 id
  targetType?: 'hypothesis' | 'pattern' | 'experience' | 'skill' | 'meta_principle';
}

interface DistillationReviewSheetProps {
  visible: boolean;
  candidates: DistillationCandidate[];
  /** 单个候选处理完成（不论动作）后回调，父组件据此从可见列表移除 */
  onHandled: (candidateId: string) => void;
  /** 关闭整个 Sheet（「先不处理」）—— 父组件应将当前可见候选全部标记 handled */
  onClose: () => void;
}

// ---------- detectDistillationCandidates：4 种触发场景 ----------

/**
 * 依据当前状态检测经验沉淀候选（spec SubTask 12.1 四种触发场景）。
 * 纯函数：不在内部触发副作用，由父组件决定何时展示。
 * 最多返回 3 条（spec A6.1），按优先级排序：
 *   major_correction > repeated_error > milestone > project_end
 */
export function detectDistillationCandidates(state: DistillationState): DistillationCandidate[] {
  const { projects, hypotheses, experiments, corrections } = state;
  const candidates: DistillationCandidate[] = [];

  // —— 场景 1：项目结束（project.status ∈ {'done','stopped'}）——
  for (const p of projects) {
    if (p.status !== 'done' && p.status !== 'stopped') continue;
    candidates.push({
      id: `proj-end-${p.id}`,
      source: 'project_end',
      lesson: `「${p.name}」结束了，这里面也许有个以后还能用的做法`,
      scope: `适用于「${p.name}」这类情境`,
      context: p.name,
      problem: p.mission,
      outcome: p.nextKeyAction,
      evidenceSummaries: [
        `项目：${p.name}`,
        `为什么做：${p.mission}`,
        p.milestones.length > 0 ? `里程碑 ${p.milestones.length} 个` : '',
        p.decisionLedger.length > 0 ? `决策记录 ${p.decisionLedger.length} 条` : '',
        `进度：${Math.round(p.progress * 100)}%`,
      ].filter(Boolean),
      // project_end 无直接关联假设；correction 动作将禁用（留下/改一下仍可用）
      targetId: undefined,
      targetType: undefined,
    });
  }

  // —— 场景 2：重复错误（同一 hypothesis 被纠正 ≥ 2 次）——
  const correctionCount = new Map<string, number>();
  for (const c of corrections) {
    if (c.target_type === 'hypothesis') {
      correctionCount.set(c.target_id, (correctionCount.get(c.target_id) ?? 0) + 1);
    }
  }
  for (const [hid, count] of correctionCount) {
    if (count < 2) continue;
    const h = hypotheses.find((x) => x.id === hid);
    if (!h) continue;
    const relatedCorrections = corrections.filter((c) => c.target_id === hid);
    candidates.push({
      // id 含 count：count 增加时生成新 ID，使父组件 handledIds 能识别「新一次重复」
      id: `repeat-err-${hid}-${count}`,
      source: 'repeated_error',
      lesson: `关于「${truncate(h.statement, 40)}」你已经纠正过 ${count} 次，这里也许有个值得留下的做法`,
      scope: '适用于类似的推断情境',
      context: h.statement,
      evidenceSummaries: [
        `猜想：${h.statement}`,
        `已纠正 ${count} 次`,
        ...relatedCorrections.slice(-3).map((c) =>
          `${formatDate(c.created_at)} · ${correctionTypeLabel(c.correction_type)}${c.user_text ? '：' + c.user_text : ''}`,
        ),
      ],
      targetId: hid,
      targetType: 'hypothesis',
    });
  }

  // —— 场景 3：重大纠正（correction_type ∈ {'wrong-reason','phase-changed'}）——
  for (const c of corrections) {
    if (c.correction_type !== 'wrong-reason' && c.correction_type !== 'phase-changed') continue;
    const label = c.correction_type === 'wrong-reason' ? '原因不是这个' : '以前是这样，现在不是了';
    candidates.push({
      id: `major-corr-${c.id}`,
      source: 'major_correction',
      lesson: c.user_text
        ? `你纠正了一个理解：「${truncate(c.user_text, 50)}」`
        : `你做了一个重要的纠正：${label}`,
      scope: '适用于这次纠正涉及的情境',
      context: `纠正：${label}`,
      evidenceSummaries: [
        `纠正类型：${label}`,
        c.user_text ? `你的说明：${c.user_text}` : '',
        `时间：${formatDate(c.created_at)}`,
      ].filter(Boolean),
      targetId: c.target_id,
      targetType: c.target_type as DistillationCandidate['targetType'],
    });
  }

  // —— 场景 4：阶段成果出现（experiment.status='completed' 且 result 有值）——
  for (const e of experiments) {
    if (e.status !== 'completed' || !e.result) continue;
    candidates.push({
      id: `milestone-${e.id}`,
      source: 'milestone',
      lesson: e.modelUpdate || e.result || `「${truncate(e.question, 40)}」有了结果`,
      scope: `适用于「${e.kind}」这类尝试`,
      context: e.question,
      problem: e.question,
      outcome: e.result,
      evidenceSummaries: [
        `试的小步：${e.question}`,
        `类型：${e.kind}`,
        `结果：${e.result}`,
        e.modelUpdate ? `对猜想的影响：${e.modelUpdate}` : '',
        `打卡 ${e.checkIns.length} 次`,
      ].filter(Boolean),
      targetId: e.hypothesisId,
      targetType: e.hypothesisId ? 'hypothesis' : undefined,
    });
  }

  // 按优先级排序并截断至 3 条（spec A6.1）
  const priority: Record<DistillationSource, number> = {
    major_correction: 0,
    repeated_error: 1,
    milestone: 2,
    project_end: 3,
  };
  candidates.sort((a, b) => priority[a.source] - priority[b.source]);
  return candidates.slice(0, 3);
}

// ---------- 辅助 ----------

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN');
}

function correctionTypeLabel(t: ModelCorrection['correction_type']): string {
  const map: Record<ModelCorrection['correction_type'], string> = {
    'unlike-me': '不太像我',
    'wrong-reason': '原因不是这个',
    'special-case': '只是这次特殊',
    'wait': '先留着看看',
    'no-more-inference': '以后别这么推断',
    'phase-changed': '以前是这样现在不是了',
  };
  return map[t] ?? t;
}

// ---------- DistillationReviewSheet 组件 ----------

export function DistillationReviewSheet({ visible, candidates, onHandled, onClose }: DistillationReviewSheetProps) {
  const theme = useAppTheme();
  const textStyles = useTextStyles();
  // 「为什么」展开状态：记录展开的 candidate id
  const [expandedWhy, setExpandedWhy] = useState<Set<string>>(new Set());
  // 「改一下」编辑弹层：当前编辑的候选
  const [editing, setEditing] = useState<DistillationCandidate | null>(null);
  const [editLesson, setEditLesson] = useState('');
  const [editScope, setEditScope] = useState('');
  // 「更多」菜单：当前打开菜单的 candidate id
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  // 提交中标记：`{candidateId}:{action}` 或 null
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 清理编辑弹层状态 */
  const resetEditor = () => {
    setEditing(null);
    setEditLesson('');
    setEditScope('');
  };

  /** 「留下」→ api.experiences.create({ maturity:'observed', ... }) （SubTask 12.3） */
  const handleKeep = async (c: DistillationCandidate) => {
    if (submitting) return;
    setSubmitting(`${c.id}:keep`);
    setError(null);
    try {
      await api.experiences.create({
        maturity: 'observed' as ExperienceMaturity,
        context: c.context,
        problem: c.problem,
        actions: c.actions,
        outcome: c.outcome,
        lesson: c.lesson,
        support_ids: [],
        counter_ids: [],
        applicability: c.scope,
        version: 1,
      });
      onHandled(c.id);
    } catch (e: any) {
      setError(e?.message ?? '保存失败，请稍后再试');
    } finally {
      setSubmitting(null);
    }
  };

  /** 「改一下」→ 打开编辑框（SubTask 12.4） */
  const handleEdit = (c: DistillationCandidate) => {
    setEditLesson(c.lesson);
    setEditScope(c.scope);
    setEditing(c);
    setMenuOpenFor(null);
  };

  /** 保存编辑后创建 experience（SubTask 12.4） */
  const handleSaveEdit = async () => {
    if (!editing || submitting) return;
    const c = editing;
    const lesson = editLesson.trim() || c.lesson;
    const scope = editScope.trim() || c.scope;
    setSubmitting(`${c.id}:edit`);
    setError(null);
    try {
      await api.experiences.create({
        maturity: 'observed' as ExperienceMaturity,
        context: c.context,
        problem: c.problem,
        actions: c.actions,
        outcome: c.outcome,
        lesson,
        support_ids: [],
        counter_ids: [],
        applicability: scope,
        version: 1,
      });
      resetEditor();
      onHandled(c.id);
    } catch (e: any) {
      setError(e?.message ?? '保存失败，请稍后再试');
    } finally {
      setSubmitting(null);
    }
  };

  /** 「只是这次特殊」→ api.corrections.create({ correction_type:'special-case' }) （SubTask 12.5） */
  const handleSpecialCase = async (c: DistillationCandidate) => {
    if (!c.targetId || !c.targetType || submitting) return;
    setSubmitting(`${c.id}:special`);
    setError(null);
    try {
      await api.corrections.create({
        target_id: c.targetId,
        target_type: c.targetType,
        correction_type: 'special-case',
      });
      onHandled(c.id);
    } catch (e: any) {
      setError(e?.message ?? '标记失败，请稍后再试');
    } finally {
      setSubmitting(null);
    }
  };

  /** 「以后别这么理解」→ api.corrections.create({ correction_type:'no-more-inference' }) （SubTask 12.6） */
  const handleNoMoreInference = async (c: DistillationCandidate) => {
    if (!c.targetId || !c.targetType || submitting) return;
    setSubmitting(`${c.id}:noinfer`);
    setError(null);
    setMenuOpenFor(null);
    try {
      await api.corrections.create({
        target_id: c.targetId,
        target_type: c.targetType,
        correction_type: 'no-more-inference',
      });
      onHandled(c.id);
    } catch (e: any) {
      setError(e?.message ?? '设置失败，请稍后再试');
    } finally {
      setSubmitting(null);
    }
  };

  /** 切换「为什么」展开 */
  const toggleWhy = (id: string) => {
    setExpandedWhy((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isBusy = (cid: string) => submitting?.startsWith(`${cid}:`) ?? false;

  const getSourceAccent = (s: DistillationSource): string => {
    const map: Record<DistillationSource, string> = {
      project_end: theme.colors.green,
      repeated_error: theme.colors.amber,
      major_correction: theme.colors.red,
      milestone: theme.colors.violet,
    };
    return map[s];
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={sheetStyles.overlay}
        onPress={onClose}
        accessibilityRole="alert"
        accessibilityLabel="经验沉淀确认弹层，背景点击关闭"
      >
        <Pressable
          style={[sheetStyles.sheet, {
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            borderColor: theme.colors.borderSoft,
            paddingBottom: theme.spacing.lg,
          }]}
          onPress={(e) => e.stopPropagation()}
          accessibilityLabel="这次留下了什么，经验沉淀确认"
        >
          {/* 标题区 */}
          <View style={[sheetStyles.header, {
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.sm,
          }]}>
            <Text style={[sheetStyles.title, textStyles.title, { color: theme.colors.textPrimary, fontSize: theme.font.section, marginBottom: theme.spacing.xs }]}>这次好像留下了一个以后可能有用的方法。</Text>
            <Text style={[sheetStyles.hint, textStyles.secondary, { color: theme.colors.textSecondary, fontSize: theme.font.small }]}>看看要不要留下来，留多少。</Text>
          </View>

          {error ? (
            <View style={[sheetStyles.errorBox, {
              marginHorizontal: theme.spacing.lg,
              marginBottom: theme.spacing.sm,
              backgroundColor: theme.colors.redSoft,
              borderRadius: theme.radius.sm,
              padding: theme.spacing.sm + 2,
              borderLeftColor: theme.colors.red,
            }]} accessibilityRole="alert">
              <Text style={[sheetStyles.errorText, { color: theme.colors.red, fontSize: theme.font.small }]}>{error}</Text>
            </View>
          ) : null}

          {/* 候选卡列表 */}
          <ScrollView
            style={sheetStyles.scroll}
            contentContainerStyle={[sheetStyles.scrollContent, {
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: theme.spacing.sm,
            }]}
            accessibilityLabel={`共 ${candidates.length} 条候选`}
          >
            {candidates.map((c, idx) => {
              const whyOpen = expandedWhy.has(c.id);
              const busy = isBusy(c.id);
              const canCorrect = !!(c.targetId && c.targetType);
              return (
                <Card key={c.id} style={[sheetStyles.card, { marginBottom: theme.spacing.md }]} accent={getSourceAccent(c.source)}>
                  <View style={[sheetStyles.cardHeader, { marginBottom: theme.spacing.sm }]}>
                    <Text style={[sheetStyles.sourceTag, { color: theme.colors.indigoMuted, fontSize: theme.font.tiny }]}>{sourceLabel(c.source)}</Text>
                    <Text style={textStyles.tertiary}>第 {idx + 1} 条</Text>
                  </View>

                  <Text style={[sheetStyles.lesson, textStyles.body, { color: theme.colors.textPrimary, fontSize: theme.font.body, marginBottom: theme.spacing.sm }]}>{c.lesson}</Text>

                  {/* 「为什么」展开 */}
                  <Pressable
                    onPress={() => toggleWhy(c.id)}
                    style={sheetStyles.whyBtn}
                    accessibilityRole="button"
                    accessibilityLabel={whyOpen ? '收起来源说明' : '展开来源说明'}
                  >
                    <Text style={[sheetStyles.whyText, { color: theme.colors.indigoMuted, fontSize: theme.font.small }]}>
                      {whyOpen ? '收起来源说明' : '为什么'}
                    </Text>
                  </Pressable>

                  {whyOpen ? (
                    <View style={[sheetStyles.whyList, {
                      marginTop: theme.spacing.xs,
                      backgroundColor: theme.colors.surfaceAlt,
                      borderRadius: theme.radius.sm,
                      padding: theme.spacing.md,
                    }]}>
                      {c.evidenceSummaries.length > 0 ? (
                        c.evidenceSummaries.map((s, i) => (
                          <Text key={i} style={[sheetStyles.whyItem, textStyles.secondary, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginBottom: theme.spacing.xs }]}>· {s}</Text>
                        ))
                      ) : (
                        <Text style={[sheetStyles.whyItem, textStyles.secondary, { color: theme.colors.textSecondary, fontSize: theme.font.small }]}>暂无来源说明</Text>
                      )}
                    </View>
                  ) : null}

                  <Divider />

                  {/* 三个轻动作 */}
                  <View style={[sheetStyles.actionRow, {
                    gap: theme.spacing.sm,
                    marginTop: theme.spacing.xs,
                  }]}>
                    <PrimaryButton
                      small
                      title={busy && submitting?.endsWith(':keep') ? '...' : '留下'}
                      onPress={() => handleKeep(c)}
                      disabled={busy}
                      accessibilityLabel="留下这个方法，保存为以后可用的经验"
                    />
                    <PrimaryButton
                      small
                      ghost
                      title={busy && submitting?.endsWith(':edit') ? '...' : '改一下'}
                      onPress={() => handleEdit(c)}
                      disabled={busy}
                      accessibilityLabel="先改一改再留下，可修改方法和适用范围"
                    />
                    <PrimaryButton
                      small
                      ghost
                      title={busy && submitting?.endsWith(':special') ? '...' : '只是这次特殊'}
                      onPress={() => canCorrect && handleSpecialCase(c)}
                      disabled={busy || !canCorrect}
                      accessibilityLabel={
                        canCorrect
                          ? '标记为只是这次特殊，不作为长期方法'
                          : '当前候选没有关联的猜想，无法标记为特殊情况'
                      }
                    />
                    {/* 「更多」按钮：长按菜单的按钮备选（spec A36.6 手势冗余） */}
                    <Pressable
                      onPress={() => setMenuOpenFor(menuOpenFor === c.id ? null : c.id)}
                      style={[sheetStyles.moreBtn, {
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.colors.surfaceSoft,
                        borderColor: theme.colors.borderSoft,
                      }]}
                      accessibilityRole="button"
                      accessibilityLabel="更多操作"
                      disabled={busy}
                    >
                      <Text style={[sheetStyles.moreBtnText, { color: theme.colors.textSecondary, fontSize: theme.font.body }]}>⋯</Text>
                    </Pressable>
                  </View>

                  {!canCorrect ? (
                    <Text style={[sheetStyles.hintSmall, {
                      color: theme.colors.textTertiary,
                      fontSize: theme.font.tiny,
                      marginTop: theme.spacing.xs + 2,
                    }]}>
                      这条没有关联的猜想，「只是这次特殊」和「以后别这么理解」暂不可用
                    </Text>
                  ) : null}

                  {/* 「更多」菜单 */}
                  <Modal
                    visible={menuOpenFor === c.id}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setMenuOpenFor(null)}
                  >
                    <Pressable
                      style={[menuStyles.overlay, { padding: theme.spacing.lg }]}
                      onPress={() => setMenuOpenFor(null)}
                      accessibilityRole="alert"
                      accessibilityLabel="更多操作弹层"
                    >
                      <Pressable
                        style={[menuStyles.card, {
                          backgroundColor: theme.colors.surface,
                          borderRadius: theme.radius.lg,
                          padding: theme.spacing.lg,
                          borderColor: theme.colors.borderSoft,
                        }]}
                        onPress={(e) => e.stopPropagation()}
                        accessibilityRole="none"
                        accessibilityLabel="更多操作弹层内容"
                      >
                        <Text style={[menuStyles.title, textStyles.title, { color: theme.colors.textPrimary, fontSize: theme.font.section, marginBottom: theme.spacing.xs }]}>更多操作</Text>
                        <Text style={[menuStyles.hint, textStyles.tertiary, { color: theme.colors.textTertiary, fontSize: theme.font.small, marginBottom: theme.spacing.md }]}>这些操作影响后续理解，请谨慎选择</Text>

                        <Pressable
                          style={[menuStyles.item, {
                            gap: theme.spacing.sm,
                            paddingVertical: theme.spacing.md,
                          }]}
                          onPress={() => canCorrect && handleNoMoreInference(c)}
                          accessibilityRole="menuitem"
                          accessibilityLabel="以后别这么理解：不再做同类推断"
                          disabled={!canCorrect || busy}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[menuStyles.itemTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>以后别这么理解</Text>
                            <Text style={[menuStyles.itemDesc, textStyles.secondary, { color: theme.colors.textSecondary, fontSize: theme.font.small }]}>
                              以后不再做同类的理解，再次出现时先问你
                            </Text>
                          </View>
                          {busy && submitting?.endsWith(':noinfer') ? (
                            <ActivityIndicator color={theme.colors.indigo} size="small" />
                          ) : (
                            <Text style={[menuStyles.arrow, { color: theme.colors.textTertiary, fontSize: theme.font.title }]}>›</Text>
                          )}
                        </Pressable>

                        {!canCorrect ? (
                          <Text style={[menuStyles.disabledHint, {
                            color: theme.colors.textTertiary,
                            fontSize: theme.font.tiny,
                            marginTop: theme.spacing.xs,
                          }]}>
                            这条没有关联的猜想，此操作暂不可用
                          </Text>
                        ) : null}

                        <Divider />

                        <View style={[menuStyles.footerRow, { marginTop: theme.spacing.sm }]}>
                          <PrimaryButton
                            title="取消"
                            ghost
                            small
                            onPress={() => setMenuOpenFor(null)}
                            disabled={busy}
                          />
                        </View>
                      </Pressable>
                    </Pressable>
                  </Modal>
                </Card>
              );
            })}
          </ScrollView>

          {/* 底部关闭按钮 */}
          <View style={[sheetStyles.footer, {
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.sm,
          }]}>
            <PrimaryButton
              title="先不处理"
              ghost
              onPress={onClose}
              accessibilityLabel="先不处理，关闭经验沉淀确认弹层"
            />
          </View>

          {/* 「改一下」编辑弹层 */}
          <Modal
            visible={editing !== null}
            transparent
            animationType="fade"
            onRequestClose={() => !submitting && resetEditor()}
          >
            <Pressable
              style={[editStyles.overlay, { padding: theme.spacing.lg }]}
              onPress={() => !submitting && resetEditor()}
              accessibilityRole="alert"
              accessibilityLabel="修改方法和适用范围弹层"
            >
              <Pressable
                style={[editStyles.card, {
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.lg,
                  padding: theme.spacing.lg,
                  borderColor: theme.colors.borderSoft,
                }]}
                onPress={(e) => e.stopPropagation()}
                accessibilityRole="none"
                accessibilityLabel="修改方法和适用范围弹层内容"
              >
                <Text style={[editStyles.title, textStyles.title, { color: theme.colors.textPrimary, fontSize: theme.font.section, marginBottom: theme.spacing.sm }]}>改一下再留下</Text>
                <Text style={[editStyles.label, textStyles.secondary, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginBottom: theme.spacing.sm }]}>你想留下的方法是什么？（一句话）</Text>
                <TextInput
                  style={[editStyles.input, {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radius.sm,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm + 2,
                    color: theme.colors.textPrimary,
                    fontSize: theme.font.body,
                    borderColor: theme.colors.borderSoft,
                  }]}
                  value={editLesson}
                  onChangeText={setEditLesson}
                  placeholder="例如：晚上把第二天的第一件事准备好，早上更容易开始"
                  placeholderTextColor={theme.colors.textTertiary}
                  multiline
                  maxLength={500}
                  accessibilityLabel="方法摘要输入框"
                  editable={!submitting}
                />
                <Text style={[editStyles.counter, { color: theme.colors.textTertiary, fontSize: theme.font.tiny, marginTop: theme.spacing.xs }]}>{editLesson.length}/500</Text>

                <Text style={[editStyles.label, textStyles.secondary, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginBottom: theme.spacing.sm, marginTop: theme.spacing.md }]}>适用于什么情境？</Text>
                <TextInput
                  style={[editStyles.input, {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radius.sm,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: theme.spacing.sm + 2,
                    color: theme.colors.textPrimary,
                    fontSize: theme.font.body,
                    borderColor: theme.colors.borderSoft,
                  }]}
                  value={editScope}
                  onChangeText={setEditScope}
                  placeholder="例如：早上起不来、注意力难集中的时候"
                  placeholderTextColor={theme.colors.textTertiary}
                  multiline
                  maxLength={300}
                  accessibilityLabel="适用范围输入框"
                  editable={!submitting}
                />
                <Text style={[editStyles.counter, { color: theme.colors.textTertiary, fontSize: theme.font.tiny, marginTop: theme.spacing.xs }]}>{editScope.length}/300</Text>

                <View style={[editStyles.btnRow, {
                  gap: theme.spacing.sm,
                  marginTop: theme.spacing.md,
                }]}>
                  <PrimaryButton
                    title="取消"
                    ghost
                    small
                    onPress={resetEditor}
                    disabled={!!submitting}
                  />
                  <PrimaryButton
                    title={submitting ? '保存中...' : '留下'}
                    small
                    onPress={handleSaveEdit}
                    disabled={!!submitting}
                    accessibilityLabel="保存修改并留下这个方法"
                  />
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- 样式 ----------

function sourceLabel(s: DistillationSource): string {
  const map: Record<DistillationSource, string> = {
    project_end: '项目结束',
    repeated_error: '重复纠正',
    major_correction: '重要纠正',
    milestone: '阶段成果',
  };
  return map[s];
}

const sheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '85%',
    borderWidth: 1,
  },
  header: {
  },
  title: {
    fontWeight: '700',
    lineHeight: 26,
  },
  hint: {
    lineHeight: 20,
  },
  hintSmall: {
    lineHeight: 16,
  },
  errorBox: {
    borderLeftWidth: 3,
  },
  errorText: {
    lineHeight: 19,
  },
  scroll: {
    maxHeight: '60%',
  },
  scrollContent: {
  },
  card: {
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourceTag: {
    fontWeight: '600',
  },
  lesson: {
    lineHeight: 24,
    fontWeight: '500',
  },
  whyBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
  },
  whyText: {
    fontWeight: '600',
  },
  whyList: {
  },
  whyItem: {
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  moreBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  moreBtnText: {
    fontWeight: '700',
    lineHeight: 18,
  },
  footer: {
    alignItems: 'center',
  },
});

const menuStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
  },
  title: {
    fontWeight: '700',
  },
  hint: {
    lineHeight: 18,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  itemTitle: {
    fontWeight: '600',
    marginBottom: 2,
  },
  itemDesc: {
    lineHeight: 18,
  },
  arrow: {
    fontWeight: '300',
  },
  disabledHint: {
    lineHeight: 16,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});

const editStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 460,
    borderWidth: 1,
  },
  title: {
    fontWeight: '700',
  },
  label: {
    lineHeight: 19,
  },
  input: {
    lineHeight: 22,
    minHeight: 64,
    textAlignVertical: 'top',
    borderWidth: 1,
  },
  counter: {
    textAlign: 'right',
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
