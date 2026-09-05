import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { Card, useTextStyles, PrimaryButton } from './ui';
import { Glyph } from './glyphs';
import type { ActionPreview, HighImpactCategory } from '../types/models';

/**
 * ActionCard —— V4.3 Task 14 行动卡组件（spec A13.3）
 *
 * 执行前显示：将做什么、影响什么、是否可撤销、步骤列表。
 * 高影响动作（payment / public_release / medical / relationship_termination / legal_document）
 * 在 confirming 阶段展示二次确认提示（spec A13.5）。
 *
 * 设计原则：
 * - 不展示技术代号（A0/A1 等对齐 spec A35 生活语言）
 * - 高影响动作使用红色边条 + 警告标识
 * - 不可撤销动作明确告知
 * - 所有交互元素均含 accessibilityLabel
 */

const HIGH_IMPACT_LABEL: Record<HighImpactCategory, string> = {
  payment: '支付',
  public_release: '公开发布',
  medical: '医疗',
  relationship_termination: '关系终止',
  legal_document: '法律文件',
};

export interface ActionCardProps {
  preview: ActionPreview;
  /** 当前流状态：previewing 显示「确认执行」；confirming 高影响动作展示二次确认提示 */
  flowState: 'previewing' | 'confirming';
  onConfirm: () => void;
  onCancel: () => void;
  /** 字号方案（适老模式传入 seniorFont） */
  fontScale?: import('../theme/theme').ThemeFont;
  /** 是否适老模式（影响行高） */
  isSenior?: boolean;
}

function ActionCardImpl({
  preview,
  flowState,
  onConfirm,
  onCancel,
  fontScale,
  isSenior,
}: ActionCardProps) {
  const theme = useAppTheme();
  const textStyles = useTextStyles();
  const f = fontScale ?? theme.font;
  const isConfirming = flowState === 'confirming';
  const accent = preview.highImpact ? theme.colors.red : theme.colors.amber;

  const confirmLabel = isConfirming
    ? preview.highImpact
      ? '我确认要做这件事'
      : '确认执行'
    : '确认执行';

  return (
    <Card
      accessibilityLabel={
        preview.highImpact
          ? `高影响动作预览：${preview.action}，${preview.reversible ? '可撤销' : '不可撤销'}`
          : `动作预览：${preview.action}，${preview.reversible ? '可撤销' : '不可撤销'}`
      }
      style={{
        marginBottom: theme.spacing.md,
        borderLeftColor: accent,
        borderLeftWidth: 3,
      }}
    >
      {/* 头部：动作标题 + 高影响标识 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.spacing.sm }}>
        <Glyph
          name={preview.highImpact ? 'warn' : 'flask'}
          size={f.section}
          color={accent}
        />
        <Text
          style={[textStyles.title, { fontSize: f.section, fontWeight: '700', flexShrink: 1, color: theme.colors.textPrimary }]}
        >
          {preview.action}
        </Text>
      </View>

      {/* 高影响分类标识 */}
      {preview.highImpact && preview.highImpactCategory && (
        <View
          style={[styles.highImpactBanner, {
            backgroundColor: theme.colors.redSoft,
            borderRadius: theme.radius.sm,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xs + 2,
          }]}
          accessibilityLabel={`高影响分类：${HIGH_IMPACT_LABEL[preview.highImpactCategory]}`}
        >
          <Glyph name="shield" size={f.tiny} color={theme.colors.red} />
          <Text style={[textStyles.tertiary, { fontSize: f.tiny, color: theme.colors.red, fontWeight: '700' }]}>
            高影响动作 · {HIGH_IMPACT_LABEL[preview.highImpactCategory]}
          </Text>
        </View>
      )}

      {/* 影响范围 */}
      <View style={{ marginTop: theme.spacing.sm }}>
        <Text style={[textStyles.tertiary, { fontSize: f.tiny, fontWeight: '700', marginBottom: 4 }]}>
          影响什么
        </Text>
        <Text style={[textStyles.secondary, { fontSize: f.small, lineHeight: isSenior ? 24 : 20 }]}>
          {preview.impact}
        </Text>
      </View>

      {/* 可撤销性 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.spacing.sm }}>
        <Glyph
          name={preview.reversible ? 'check' : 'warn'}
          size={f.tiny}
          color={preview.reversible ? theme.colors.green : theme.colors.amber}
        />
        <Text style={[textStyles.tertiary, { fontSize: f.tiny }]}>
          {preview.reversible ? '可撤销：执行后可以回退' : '不可撤销：执行后无法回退'}
        </Text>
      </View>

      {/* 步骤列表 */}
      <View style={{ marginTop: theme.spacing.sm }}>
        <Text style={[textStyles.tertiary, { fontSize: f.tiny, fontWeight: '700', marginBottom: 6 }]}>
          将执行的步骤
        </Text>
        {preview.steps.map((step, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
            <Text style={{ color: theme.colors.indigo, fontSize: f.tiny, fontWeight: '700', minWidth: 18 }}>
              {i + 1}.
            </Text>
            <Text style={[textStyles.secondary, { fontSize: f.small, flexShrink: 1, lineHeight: isSenior ? 24 : 20 }]}>
              {step}
            </Text>
          </View>
        ))}
      </View>

      {/* 二次确认提示（高影响动作在 confirming 阶段） */}
      {isConfirming && preview.highImpact && (
        <View style={[styles.confirmAgainBanner, {
          backgroundColor: theme.colors.amberSoft,
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          marginTop: theme.spacing.sm,
          borderColor: theme.colors.amber,
        }]} accessibilityLabel="高影响动作二次确认提示">
          <Glyph name="warn" size={f.small} color={theme.colors.amber} />
          <Text style={[textStyles.body, { fontSize: f.small, color: theme.colors.amber, fontWeight: '700', flexShrink: 1 }]}>
            这是高影响动作，确认要做吗？
          </Text>
        </View>
      )}

      {/* 操作按钮 */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
        <PrimaryButton
          title={confirmLabel}
          onPress={onConfirm}
          danger={preview.highImpact}
          accessibilityLabel={confirmLabel}
          style={{ flex: 1 }}
        />
        <PrimaryButton
          title="取消"
          onPress={onCancel}
          ghost
          accessibilityLabel="取消执行"
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

// 屏幕级组件 state 变化会整屏重渲染；memo 使 props 未变的卡片跳过渲染。
export const ActionCard = React.memo(ActionCardImpl);

const styles = StyleSheet.create({
  highImpactBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  confirmAgainBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
  },
});
