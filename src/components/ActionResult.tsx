import React from 'react';
import { View, Text } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { Card, useTextStyles, PrimaryButton } from './ui';
import { Glyph } from './glyphs';
import type { ActionExecutionResult } from '../types/models';

/**
 * ActionResult —— V4.3 Task 14 执行结果组件（spec A13.4 / SubTask 14.8）
 *
 * 核心原则：不伪装成功。
 * - success：所有步骤完成
 * - partial_failure：部分步骤完成，逐项显示成功/失败
 * - failed：所有步骤失败，明确显示失败原因
 *
 * 可撤销时显示「撤销」按钮（spec A13.5 回执/撤销）。
 * 不展示技术代号（spec A35 生活语言）。
 */

const STATUS_LABEL: Record<ActionExecutionResult['status'], string> = {
  success: '已完成',
  partial_failure: '部分完成',
  failed: '没有完成',
};

const STATUS_GLYPH: Record<ActionExecutionResult['status'], 'check' | 'warn'> = {
  success: 'check',
  partial_failure: 'warn',
  failed: 'warn',
};

export interface ActionResultProps {
  result: ActionExecutionResult;
  onUndo?: () => void;
  onDismiss?: () => void;
  /** 字号方案（适老模式传入 seniorFont） */
  fontScale?: import('../theme/theme').ThemeFont;
  /** 是否适老模式（影响行高） */
  isSenior?: boolean;
}

export function ActionResult({
  result,
  onUndo,
  onDismiss,
  fontScale,
  isSenior,
}: ActionResultProps) {
  const theme = useAppTheme();
  const textStyles = useTextStyles();
  const f = fontScale ?? theme.font;
  const statusColorMap: Record<ActionExecutionResult['status'], string> = {
    success: theme.colors.green,
    partial_failure: theme.colors.amber,
    failed: theme.colors.red,
  };
  const color = statusColorMap[result.status];
  const label = STATUS_LABEL[result.status];
  const lineH = isSenior ? 24 : 20;

  return (
    <Card
      accessibilityLabel={
        `执行结果：${label}。完成 ${result.completedSteps.length} 步` +
        (result.failedSteps.length > 0 ? `，未完成 ${result.failedSteps.length} 步` : '') +
        (result.undoable ? '，可撤销' : '')
      }
      style={{
        marginBottom: theme.spacing.md,
        borderLeftColor: color,
        borderLeftWidth: 3,
      }}
    >
      {/* 头部：状态标识 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.spacing.sm }}>
        <Glyph name={STATUS_GLYPH[result.status]} size={f.section} color={color} />
        <Text style={[textStyles.title, { fontSize: f.section, fontWeight: '700', color }]}>
          {label}
        </Text>
      </View>

      {/* 状态描述：不伪装成功 */}
      <Text style={[textStyles.secondary, { fontSize: f.small, lineHeight: lineH }]}>
        {result.status === 'success' && '所有步骤都做完了。'}
        {result.status === 'partial_failure' &&
          `做完了 ${result.completedSteps.length} 步，但有 ${result.failedSteps.length} 步没有完成。下面是详细情况。`}
        {result.status === 'failed' &&
          '这次没有做成。下面是每一步失败的原因。'}
      </Text>

      {/* 已完成步骤 */}
      {result.completedSteps.length > 0 && (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Text style={[textStyles.tertiary, { fontSize: f.tiny, fontWeight: '700', marginBottom: 4 }]}>
            已完成
          </Text>
          {result.completedSteps.map((step, i) => (
            <View
              key={`done-${i}`}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}
              accessibilityLabel={`已完成步骤：${step}`}
            >
              <Glyph name="check" size={f.tiny} color={theme.colors.green} />
              <Text style={[textStyles.secondary, { fontSize: f.small, flexShrink: 1, lineHeight: lineH }]}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* 失败步骤 */}
      {result.failedSteps.length > 0 && (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Text
            style={[textStyles.tertiary, { fontSize: f.tiny, fontWeight: '700', color: theme.colors.red, marginBottom: 4 }]}
          >
            未完成
          </Text>
          {result.failedSteps.map((item, i) => (
            <View
              key={`fail-${i}`}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}
              accessibilityLabel={`未完成步骤：${item.step}。原因：${item.error}`}
            >
              <Glyph name="warn" size={f.tiny} color={theme.colors.red} />
              <View style={{ flexShrink: 1 }}>
                <Text style={[textStyles.secondary, { fontSize: f.small, lineHeight: lineH }]}>
                  {item.step}
                </Text>
                <Text style={[textStyles.tertiary, { fontSize: f.tiny, color: theme.colors.red, marginTop: 2 }]}>
                  原因：{item.error}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 操作按钮 */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
        {result.undoable && onUndo && (
          <PrimaryButton
            title="撤销"
            onPress={onUndo}
            ghost
            accessibilityLabel="撤销这次执行"
            style={{ flex: 1 }}
          />
        )}
        {onDismiss && (
          <PrimaryButton
            title="知道了"
            onPress={onDismiss}
            accessibilityLabel="关闭执行结果"
            style={{ flex: 1 }}
          />
        )}
      </View>
    </Card>
  );
}
