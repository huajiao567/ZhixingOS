import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ActionPlan, ActionReceipt, ContextSurface } from '../../ai-native/types';
import type { SecretaryRuntimePhase } from '../../hooks/useSecretaryRuntime';
import { useAppTheme } from '../../theme/theme';

const STATUS_TEXT: Record<ActionReceipt['status'], string> = {
  success: '全部完成',
  partial_failure: '部分完成',
  failed: '未完成',
  blocked: '未执行',
  undone: '已撤销',
};

export function ContextSurfaceView({
  surface,
  plan,
  receipt,
  phase,
  error,
  syncWarning,
  onExecute,
  onUndo,
  onReset,
}: {
  surface: ContextSurface;
  plan: ActionPlan | null;
  receipt: ActionReceipt | null;
  phase: SecretaryRuntimePhase;
  error: string | null;
  syncWarning: string | null;
  onExecute: () => void;
  onUndo: () => void;
  onReset: () => void;
}) {
  const theme = useAppTheme();
  const c = theme.colors;

  if (phase === 'parsing') {
    return (
      <View style={[styles.status, { borderColor: c.borderSoft }]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={c.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.statusTitle, { color: c.textPrimary, fontSize: theme.font.body }]}>正在识别对象与时间</Text>
          <Text style={{ color: c.textSecondary, fontSize: theme.font.small }}>还没有写入任何数据。</Text>
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[styles.error, { borderColor: c.red, backgroundColor: c.redSoft }]} accessibilityLiveRegion="assertive">
        <Text style={[styles.statusTitle, { color: c.textPrimary, fontSize: theme.font.body }]}>没有执行</Text>
        <Text style={{ color: c.textSecondary, fontSize: theme.font.small, lineHeight: 21 }}>{error}</Text>
        <Pressable onPress={onReset} style={styles.textButton} accessibilityRole="button" accessibilityLabel="返回工作台重新输入">
          <Text style={{ color: c.primary, fontWeight: '700' }}>重新输入</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'idle') {
    return (
      <View style={[styles.empty, { borderColor: c.borderSoft }]}>
        <Text style={[styles.eyebrow, { color: c.primary }]}>开放工作台</Text>
        <Text style={[styles.emptyTitle, { color: c.textPrimary, fontSize: theme.font.title }]}>{surface.title}</Text>
        <Text style={{ color: c.textSecondary, fontSize: theme.font.body, lineHeight: 25 }}>{surface.summary}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.lg }}>
      <View style={[styles.object, { borderColor: c.borderSoft }]}>
        <Text style={[styles.eyebrow, { color: c.primary }]}>{surface.eyebrow}</Text>
        <Text style={[styles.objectTitle, { color: c.textPrimary, fontSize: theme.font.title }]}>{surface.title}</Text>
        <Text style={{ color: c.textSecondary, fontSize: theme.font.body, lineHeight: 25 }}>{surface.summary}</Text>
        {surface.object?.startsAt ? (
          <Text style={{ color: c.textSecondary, fontSize: theme.font.small, marginTop: 8 }}>
            {new Date(surface.object.startsAt).toLocaleString('zh-CN')}
            {surface.object.endsAt ? ` — ${new Date(surface.object.endsAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </Text>
        ) : null}
        <Text style={{ color: c.textTertiary, fontSize: theme.font.tiny, marginTop: 8 }}>{surface.evidenceNote}</Text>
      </View>

      {surface.questions.length > 0 && phase === 'needs_input' ? (
        <View style={[styles.questions, { backgroundColor: c.accentSoft, borderColor: c.accent }]} accessibilityLiveRegion="polite">
          <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>执行前还缺什么</Text>
          {surface.questions.map((question) => (
            <Text key={question} style={{ color: c.textSecondary, lineHeight: 22 }}>· {question}</Text>
          ))}
        </View>
      ) : null}

      {surface.primaryPath ? (
        <View style={[styles.reasoning, { borderColor: c.borderSoft }]}>
          <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>变化依据</Text>
          <Text style={{ color: c.textSecondary, lineHeight: 22 }}>{surface.primaryPath.title}</Text>
          <View style={styles.operatorGrid}>
            {surface.primaryPath.assessments.map((item) => (
              <View key={item.operator} style={[styles.operator, { backgroundColor: c.surfaceAlt }]}>
                <Text style={[styles.operatorName, { color: c.primary }]}>{item.operator}</Text>
                <Text style={{ flex: 1, color: c.textSecondary, fontSize: theme.font.small, lineHeight: 20 }}>{item.reason}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: c.textTertiary, fontSize: theme.font.tiny, lineHeight: 19 }}>
            停止条件：{surface.primaryPath.stopCondition}
          </Text>
        </View>
      ) : null}

      {plan && phase === 'ready' ? (
        <View style={[styles.plan, { borderColor: c.primary, backgroundColor: c.primarySoft }]}>
          <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>确认后将执行</Text>
          {plan.steps.map((step, index) => (
            <Text key={step.id} style={{ color: c.textSecondary, lineHeight: 22 }}>{index + 1}. {step.executor === 'life_object' ? '写入知行镜生命对象' : step.executor === 'calendar' ? '写入设备系统日历' : step.executor === 'journal' ? '写入可追溯日记' : '生成草稿并保存，不对外发送'}</Text>
          ))}
          <Text style={{ color: c.textTertiary, fontSize: theme.font.tiny, marginTop: 6 }}>
            {plan.reversible ? '可撤销；系统会返回真实对象或系统 ID。' : '此动作不可撤销。'}
          </Text>
          <Pressable
            onPress={onExecute}
            style={({ pressed }) => [styles.primaryButton, { backgroundColor: c.primary, opacity: pressed ? 0.76 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`确认执行：${plan.title}`}
          >
            <Text style={{ color: c.textInverse, fontWeight: '800', fontSize: theme.font.body }}>确认执行</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'executing' ? (
        <View style={[styles.status, { borderColor: c.borderSoft }]} accessibilityLiveRegion="polite">
          <ActivityIndicator color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, { color: c.textPrimary }]}>正在逐步执行</Text>
            <Text style={{ color: c.textSecondary }}>每一步都要返回真实结果。</Text>
          </View>
        </View>
      ) : null}

      {receipt && phase === 'receipt' ? (
        <View style={[styles.receipt, { borderColor: receipt.status === 'success' ? c.green : receipt.status === 'undone' ? c.border : c.accent }]} accessibilityLiveRegion="polite">
          <Text style={[styles.eyebrow, { color: receipt.status === 'success' ? c.green : c.accent }]}>行动回执 · {STATUS_TEXT[receipt.status]}</Text>
          {receipt.stepResults.map((result) => (
            <View key={result.stepId} style={styles.receiptRow}>
              <Text style={{ color: receipt.status === 'undone' ? c.primary : result.status === 'success' ? c.green : c.red, fontWeight: '800' }}>
                {receipt.status === 'undone' ? '撤销' : result.status === 'success' ? '完成' : '失败'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.textSecondary, lineHeight: 21 }}>
                  {receipt.status === 'undone' ? `原动作 · ${result.message}` : result.message}
                </Text>
                {result.externalId ? <Text selectable style={{ color: c.textTertiary, fontSize: theme.font.tiny }}>ID · {result.externalId}</Text> : null}
              </View>
            </View>
          ))}
          {syncWarning ? <Text style={{ color: c.accent, lineHeight: 21 }}>{syncWarning}</Text> : null}
          <View style={styles.receiptActions}>
            {receipt.undoable ? (
              <Pressable onPress={onUndo} style={[styles.secondaryButton, { borderColor: c.border }]} accessibilityRole="button" accessibilityLabel="撤销已执行动作">
                <Text style={{ color: c.textPrimary, fontWeight: '700' }}>撤销</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onReset} style={[styles.secondaryButton, { borderColor: c.border }]} accessibilityRole="button" accessibilityLabel="处理下一件事">
              <Text style={{ color: c.primary, fontWeight: '700' }}>下一件事</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  empty: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 28, gap: 12 },
  emptyTitle: { fontWeight: '800', letterSpacing: -0.4 },
  status: { minHeight: 76, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  statusTitle: { fontWeight: '800', marginBottom: 4 },
  error: { borderLeftWidth: 3, padding: 16, gap: 10 },
  textButton: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  object: { borderTopWidth: 1, paddingTop: 18, gap: 10 },
  objectTitle: { fontWeight: '800', letterSpacing: -0.5 },
  questions: { borderLeftWidth: 3, padding: 16, gap: 8 },
  sectionTitle: { fontWeight: '800', marginBottom: 4 },
  reasoning: { borderTopWidth: 1, paddingTop: 18, gap: 12 },
  operatorGrid: { gap: 6 },
  operator: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 12, alignItems: 'flex-start' },
  operatorName: { width: 22, fontSize: 17, fontWeight: '900' },
  plan: { borderLeftWidth: 3, padding: 16, gap: 7 },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  receipt: { borderTopWidth: 2, borderBottomWidth: 1, paddingVertical: 18, gap: 14 },
  receiptRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  receiptActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  secondaryButton: { minHeight: 48, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
});
