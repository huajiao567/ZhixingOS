import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, TextInput, ActivityIndicator } from 'react-native';
import { Hypothesis, CorrectionType } from '../types/models';
import { useAppTheme } from '../theme/theme';
import { Card, Tag, ConfidenceRing, PrimaryButton, Divider, useTextStyles } from './ui';
import { useStore } from '../store/useStore';
import { useEvidenceStore } from '../store/useEvidenceStore';
import { presentHypothesisStatement } from '../services/hypothesisPresentation';

/**
 * 假设卡（V4.3 Task 8 / spec A4.3）
 *
 * 4 个主按钮（status === 'open' 时显示）：
 *   - 像我          → hypothesisAction('confirm')            （非纠正，正向确认）
 *   - 不太像        → correction_type='unlike-me'            （hypothesis.status='rejected'）
 *   - 原因不是这个  → correction_type='wrong-reason'         （hypothesis.status='revised' + 新 Evidence；需 user_text）
 *   - 先留着看看    → correction_type='wait'                 （保持 candidate）
 *
 * 长按菜单（同时提供「更多」按钮入口，V4.3 §9.20 / Task 20：长按不能是唯一方式）：
 *   - 以后别这么推断      → correction_type='no-more-inference'   （禁止后续同类推断）
 *   - 以前是这样现在不是了 → correction_type='phase-changed'       （关闭旧 pattern + 创建版本迁移节点；可附 user_text）
 *
 * 说明：
 *   - 纠正调用 useEvidenceStore.createCorrection（已同步本地 patterns/modelVersions）
 *   - wrong-reason / unlike-me 后调 useStore.applyHypothesisCorrection 同步本地 hypothesis 状态
 *   - 等待 user_text 的纠正类型通过 Modal TextInput 收集（跨平台，不依赖 iOS-only Alert.prompt）
 */

/** 需要附加 user_text 输入的纠正类型 */
type InputCorrectionType = 'wrong-reason' | 'phase-changed';

function HypothesisCardImpl({ h }: { h: Hypothesis }) {
  const theme = useAppTheme();
  const textStyles = useTextStyles();

  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputModal, setInputModal] = useState<{ type: InputCorrectionType } | null>(null);
  const [inputText, setInputText] = useState('');
  /** 提交中标记：CorrectionType 或 'confirm'（像我按钮，正向确认非纠正） */
  const [submitting, setSubmitting] = useState<CorrectionType | 'confirm' | null>(null);

  const { hypothesisAction, experiments, applyHypothesisCorrection } = useStore();
  const { createCorrection } = useEvidenceStore();

  const statusMeta: Record<Hypothesis['status'], { label: string; color: string }> = {
    open: { label: '开放中', color: theme.colors.amber },
    confirmed: { label: '已确认', color: theme.colors.green },
    refuted: { label: '已推翻', color: theme.colors.red },
    expired: { label: '已过期', color: theme.colors.textTertiary },
    rejected: { label: '不像我', color: theme.colors.red },
    revised: { label: '原因已修订', color: theme.colors.violet },
  };

  const meta = statusMeta[h.status];
  const exp = experiments.find((e) => e.id === h.suggestedExperimentId);
  const reviewDate = new Date(h.reviewAt);
  const daysToReview = Math.ceil((reviewDate.getTime() - Date.now()) / 86400000);
  const canAct = h.status === 'open';
  const presentedStatement = presentHypothesisStatement(h.statement);

  /** 「像我」正向确认（非纠正） */
  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting('confirm');
    try {
      await hypothesisAction(h.id, 'confirm');
    } finally {
      setSubmitting(null);
    }
  };

  /** 提交纠正（无 user_text 类型） */
  const handleCorrection = async (type: CorrectionType) => {
    if (submitting) return;
    setSubmitting(type);
    try {
      await createCorrection({
        target_id: h.id,
        target_type: 'hypothesis',
        correction_type: type,
      });
      // unlike-me → 后端将 hypothesis.status 置为 'rejected'
      if (type === 'unlike-me') {
        applyHypothesisCorrection(h.id, 'rejected');
      }
      // wait / no-more-inference：不改变 hypothesis.status，仅记录纠正
    } catch (e: any) {
      console.warn('HypothesisCard: correction failed', type, e?.message ?? e);
    } finally {
      setSubmitting(null);
      setMenuOpen(false);
    }
  };

  /** 打开 user_text 输入弹层 */
  const openInputModal = (type: InputCorrectionType) => {
    setInputText('');
    setInputModal({ type });
    setMenuOpen(false);
  };

  /** 提交带 user_text 的纠正 */
  const submitInputCorrection = async () => {
    if (!inputModal || submitting) return;
    const type = inputModal.type;
    setSubmitting(type);
    try {
      await createCorrection({
        target_id: h.id,
        target_type: 'hypothesis',
        correction_type: type,
        user_text: inputText.trim() || undefined,
      });
      // wrong-reason → 后端将 hypothesis.status 置为 'revised'，并创建 self_report Evidence
      if (type === 'wrong-reason') {
        applyHypothesisCorrection(h.id, 'revised', inputText.trim() || undefined);
      }
      // phase-changed → 后端归档 active model versions + 创建新版本；hypothesis.status 不变
      setInputModal(null);
      setInputText('');
    } catch (e: any) {
      console.warn('HypothesisCard: input correction failed', type, e?.message ?? e);
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <Card style={[styles.card, { marginBottom: theme.spacing.md }]}>
      <Pressable
        onLongPress={canAct ? () => setMenuOpen(true) : undefined}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`假设 ${h.id}：${presentedStatement}。长按显示更多纠正选项`}
      >
        <View style={[styles.headerRow, { gap: theme.spacing.md }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <Tag text={`${h.id} · v${h.version}`} color={theme.colors.textSecondary} bg={theme.colors.surfaceSoft} />
              <Tag text={meta.label} color={meta.color} />
            </View>
            <Text style={[styles.statement, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>{presentedStatement}</Text>
          </View>
          <ConfidenceRing value={h.confidence} />
        </View>
      </Pressable>

      <Pressable onPress={() => setExpanded(!expanded)} style={[styles.expandBtn, { marginTop: theme.spacing.md, minHeight: theme.touch.minTarget, justifyContent: 'center' }]} accessibilityRole="button" accessibilityLabel={expanded ? '收起证据链' : '展开证据链'}>
        <Text style={{ color: theme.colors.indigoMuted, fontSize: theme.font.small, fontWeight: '600' }}>
          {expanded ? '收起证据链' : `查看证据链（支持 ${h.supporting.length} · 反证 ${h.countering.length}）`}
        </Text>
      </Pressable>

      {expanded && (
        <View>
          <Divider />
          <Text style={[styles.evTitle, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginBottom: theme.spacing.sm }]}>支持证据</Text>
          {h.supporting.map((ev, i) => (
            <View key={i} style={[styles.evRow, { gap: theme.spacing.sm, marginBottom: theme.spacing.sm }]}>
              <View style={[styles.evDot, { backgroundColor: theme.colors.green }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.evText, { color: theme.colors.textPrimary, fontSize: theme.font.small }]}>{ev.quote}</Text>
                <Text style={textStyles.tertiary}>{new Date(ev.time).toLocaleDateString('zh-CN')} · 来源 {ev.sourceType}</Text>
              </View>
            </View>
          ))}

          <Text style={[styles.evTitle, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm }]}>反对证据</Text>
          {h.countering.length === 0 ? (
            <Text style={[styles.gapText, { color: theme.colors.textTertiary, fontSize: theme.font.small }]}>未发现 / 未检索到反证（这是需要警惕的信号，不代表假设成立）</Text>
          ) : h.countering.map((ev, i) => (
            <View key={i} style={[styles.evRow, { gap: theme.spacing.sm, marginBottom: theme.spacing.sm }]}>
              <View style={[styles.evDot, { backgroundColor: theme.colors.red }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.evText, { color: theme.colors.textPrimary, fontSize: theme.font.small }]}>{ev.quote}</Text>
                <Text style={textStyles.tertiary}>{new Date(ev.time).toLocaleDateString('zh-CN')} · 来源 {ev.sourceType}</Text>
              </View>
            </View>
          ))}

          <Text style={[styles.evTitle, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm }]}>替代解释</Text>
          {h.alternatives.map((a, i) => (
            <Text key={i} style={[styles.altText, { color: theme.colors.violet, fontSize: theme.font.small }]}>· {a}</Text>
          ))}

          {h.dataGaps.length > 0 && (
            <>
              <Text style={[styles.evTitle, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm }]}>数据缺口</Text>
              {h.dataGaps.map((g, i) => (
                <Text key={i} style={[styles.gapText, { color: theme.colors.textTertiary, fontSize: theme.font.small }]}>· {g}</Text>
              ))}
            </>
          )}

          {h.harmNote ? (
            <View style={[styles.harmBox, {
              marginTop: theme.spacing.md,
              backgroundColor: theme.colors.amberSoft,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
              borderLeftWidth: 3,
              borderLeftColor: theme.colors.amber,
            }]}>
              <Text style={{ color: theme.colors.amber, fontSize: theme.font.small, lineHeight: 18 }}>{h.harmNote}</Text>
            </View>
          ) : null}

          <Text style={[textStyles.tertiary, { marginTop: theme.spacing.sm }]}>
            {daysToReview >= 0 ? `${daysToReview} 天后到期复审` : '已过复审日期'} · 版本历史 {h.history.length} 次
          </Text>
        </View>
      )}

      {canAct && (
        <View style={[styles.actionRow, { gap: theme.spacing.sm, marginTop: theme.spacing.md }]}>
          <PrimaryButton
            small
            title={submitting === 'confirm' ? '...' : '像我'}
            onPress={handleConfirm}
            disabled={submitting !== null}
          />
          <PrimaryButton
            small
            ghost
            title={submitting === 'unlike-me' ? '...' : '不太像'}
            onPress={() => handleCorrection('unlike-me')}
            disabled={submitting !== null}
          />
          <PrimaryButton
            small
            ghost
            title={submitting === 'wrong-reason' ? '...' : '原因不是这个'}
            onPress={() => openInputModal('wrong-reason')}
            disabled={submitting !== null}
          />
          <PrimaryButton
            small
            ghost
            title={submitting === 'wait' ? '...' : '先留着看看'}
            onPress={() => handleCorrection('wait')}
            disabled={submitting !== null}
          />
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="更多纠正选项"
            style={[styles.moreBtn, {
              minWidth: theme.touch.minTarget,
              minHeight: theme.touch.minTarget,
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.surfaceSoft,
              borderColor: theme.colors.borderSoft,
            }]}
          >
            <Text style={[styles.moreBtnText, { color: theme.colors.textSecondary, fontSize: theme.font.body }]}>⋯</Text>
          </Pressable>
        </View>
      )}

      {exp && canAct && (
        <Text style={[textStyles.tertiary, { marginTop: theme.spacing.sm }]}>
          关联实验：{exp.question.slice(0, 34)}…（{exp.durationDays} 天）
        </Text>
      )}

      {/* 长按菜单：以后别这么推断 / 以前是这样现在不是了 */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={menuStyles.overlay} onPress={() => setMenuOpen(false)} accessibilityRole="alert" accessibilityLabel="更多纠正选项弹层">
          <Pressable style={[menuStyles.card, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            borderColor: theme.colors.borderSoft,
          }]} onPress={(e) => { e.stopPropagation(); }} accessibilityRole="none" accessibilityLabel="更多纠正选项弹层内容">
            <Text style={[menuStyles.title, { color: theme.colors.textPrimary, fontSize: theme.font.section, marginBottom: theme.spacing.xs }]}>更多纠正选项</Text>
            <Text style={[menuStyles.hint, { color: theme.colors.textTertiary, fontSize: theme.font.small, marginBottom: theme.spacing.md }]}>这些操作影响后续推断，请谨慎选择</Text>

            <Pressable
              style={[menuStyles.item, { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }]}
              onPress={() => handleCorrection('no-more-inference')}
              accessibilityRole="menuitem"
              accessibilityLabel="以后别这么推断：禁止后续同类推断"
              disabled={submitting !== null}
            >
              <View style={{ flex: 1 }}>
                <Text style={[menuStyles.itemTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body, marginBottom: 2 }]}>以后别这么推断</Text>
                <Text style={[menuStyles.itemDesc, { color: theme.colors.textSecondary, fontSize: theme.font.small }]}>禁止 Satori 后续做同类推断，再次出现时必须先经你确认</Text>
              </View>
              {submitting === 'no-more-inference' ? (
                <ActivityIndicator color={theme.colors.indigo} size="small" />
              ) : (
                <Text style={[menuStyles.arrow, { color: theme.colors.textTertiary, fontSize: theme.font.title }]}>›</Text>
              )}
            </Pressable>

            <Divider />

            <Pressable
              style={[menuStyles.item, { gap: theme.spacing.sm, paddingVertical: theme.spacing.md }]}
              onPress={() => openInputModal('phase-changed')}
              accessibilityRole="menuitem"
              accessibilityLabel="以前是这样现在不是了：标记阶段变化，归档旧版本"
              disabled={submitting !== null}
            >
              <View style={{ flex: 1 }}>
                <Text style={[menuStyles.itemTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body, marginBottom: 2 }]}>以前是这样，现在不是了</Text>
                <Text style={[menuStyles.itemDesc, { color: theme.colors.textSecondary, fontSize: theme.font.small }]}>关闭旧阶段的适用范围，创建一个新的个人模型版本节点</Text>
              </View>
              {submitting === 'phase-changed' ? (
                <ActivityIndicator color={theme.colors.indigo} size="small" />
              ) : (
                <Text style={[menuStyles.arrow, { color: theme.colors.textTertiary, fontSize: theme.font.title }]}>›</Text>
              )}
            </Pressable>

            <View style={[menuStyles.footerBtnRow, { marginTop: theme.spacing.sm }]}>
              <PrimaryButton title="取消" ghost small onPress={() => setMenuOpen(false)} disabled={submitting !== null} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 文本输入弹层：wrong-reason / phase-changed */}
      <Modal
        visible={inputModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => inputModal === null && setInputModal(null)}
      >
        <Pressable style={inputStyles.overlay} onPress={() => submitting === null && setInputModal(null)} accessibilityRole="alert" accessibilityLabel="纠正说明输入弹层">
          <Pressable style={[inputStyles.card, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            borderColor: theme.colors.borderSoft,
          }]} onPress={(e) => { e.stopPropagation(); }} accessibilityRole="none" accessibilityLabel="纠正说明输入弹层内容">
            <Text style={[inputStyles.title, { color: theme.colors.textPrimary, fontSize: theme.font.section, marginBottom: theme.spacing.sm }]}>
              {inputModal?.type === 'wrong-reason' ? '原因不是这个' : '阶段变化说明'}
            </Text>
            <Text style={[inputStyles.label, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginBottom: theme.spacing.sm }]}>
              {inputModal?.type === 'wrong-reason'
                ? '那你觉得真正的原因是什么？这句话会作为你的自述保存为新的证据。'
                : '可一句话描述这次阶段变化（可选），将记录在新模型版本节点上。'}
            </Text>
            <TextInput
              style={[inputStyles.input, {
                backgroundColor: theme.colors.surfaceAlt,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm + 2,
                color: theme.colors.textPrimary,
                fontSize: theme.font.body,
                borderColor: theme.colors.borderSoft,
              }]}
              value={inputText}
              onChangeText={setInputText}
              placeholder={inputModal?.type === 'wrong-reason' ? '例如：是因为最近家里有事，不是因为我懒' : '例如：换了工作 / 搬了家 / 进入新阶段'}
              placeholderTextColor={theme.colors.textTertiary}
              multiline
              maxLength={2000}
              accessibilityLabel="纠正说明输入框"
              editable={submitting === null}
            />
            <Text style={[inputStyles.counter, { color: theme.colors.textTertiary, fontSize: theme.font.tiny, marginTop: theme.spacing.xs }]}>{inputText.length}/2000</Text>
            <View style={[inputStyles.btnRow, { gap: theme.spacing.sm, marginTop: theme.spacing.md }]}>
              <PrimaryButton
                title="取消"
                ghost
                small
                onPress={() => { setInputModal(null); setInputText(''); }}
                disabled={submitting !== null}
              />
              <PrimaryButton
                title={submitting ? '提交中...' : '确认'}
                small
                onPress={submitInputCorrection}
                disabled={submitting !== null}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}

// 屏幕级组件 state 变化会整屏重渲染；memo 使 props 未变的卡片跳过渲染。
export const HypothesisCard = React.memo(HypothesisCardImpl);

const styles = StyleSheet.create({
  card: {},
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  statement: { lineHeight: 22, fontWeight: '500' },
  expandBtn: {},
  evTitle: { fontWeight: '700' },
  evRow: { flexDirection: 'row', alignItems: 'flex-start' },
  evDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  evText: { lineHeight: 19 },
  altText: { lineHeight: 20 },
  gapText: { lineHeight: 20, fontStyle: 'italic' },
  harmBox: {
    borderLeftWidth: 3,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  moreBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  moreBtnText: { fontWeight: '700', lineHeight: 18 },
});

const menuStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    padding: 24,
    borderWidth: 1,
  },
  title: { fontWeight: '700' },
  hint: { lineHeight: 18 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemTitle: { fontWeight: '600', marginBottom: 2 },
  itemDesc: { lineHeight: 18 },
  arrow: { fontWeight: '300' },
  footerBtnRow: { flexDirection: 'row', justifyContent: 'flex-end' },
});

const inputStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    padding: 24,
    borderWidth: 1,
  },
  title: { fontWeight: '700' },
  label: { lineHeight: 19 },
  input: {
    borderWidth: 1,
    minHeight: 80,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  counter: { textAlign: 'right' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end' },
});
