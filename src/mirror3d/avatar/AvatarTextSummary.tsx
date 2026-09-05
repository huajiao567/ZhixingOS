/**
 * V0 模式：纯文字状态摘要（spec A3.1 / SubTask 17.1）。
 *
 * 当 Service Contract V 轴 = V0 时，AvatarCanvasFlagged 渲染本组件替代 3D 镜像。
 * 不含任何 3D / 2D 图形，仅以自然语言描述当前状态向量与镜像解释，
 * 满足 spec「V0 → 完全关闭（不显示 avatar，显示文字状态摘要）」。
 *
 * 设计原则：
 * - 不加载 @react-three/fiber（V0 模式下 3D 模块完全不在渲染路径上）
 * - 文本等价摘要满足 spec A36.4「3D Avatar 提供文本等价摘要」
 * - 所有数值采用三级证据语言，不展示未经验证的精确百分比（P0-4）
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { AvatarRenderState, DailyState } from '../types/avatar';
import { ANIMATION_LABEL, SCENE_COLORS, SCENE_LABEL, describeRenderState } from './avatarGeometry';
import { colors } from '../../theme/theme';

interface AvatarTextSummaryProps {
  render: AvatarRenderState;
  state?: DailyState;
  explanation?: string[];
}

/**
 * 把 0..1 区间的状态值映射为三级证据语言（spec P0-4：不展示未经验证的精确百分比）。
 * < 0.34 = 偏低，0.34..0.66 = 中等，> 0.66 = 偏高。
 */
function describeLevel(value: number): string {
  if (value < 0.34) return '偏低';
  if (value > 0.66) return '偏高';
  return '中等';
}

/**
 * 状态向量条目：每项返回 { label, level } 用于渲染。
 * 仅展示 daily state 中与镜像渲染直接相关的维度，避免堆砌全部字段。
 */
function buildStateRows(state: DailyState): { label: string; level: string }[] {
  return [
    { label: '能量', level: describeLevel(state.energy) },
    { label: '情绪', level: describeLevel(state.mood) },
    { label: '压力', level: describeLevel(state.stress) },
    { label: '专注', level: describeLevel(state.focus) },
    { label: '身体活跃', level: describeLevel(state.physicality) },
    { label: '恢复自护', level: describeLevel(state.selfcare) },
  ];
}

export function AvatarTextSummary({
  render,
  state,
  explanation = [],
}: AvatarTextSummaryProps) {
  const sceneColor = SCENE_COLORS[render.scene];
  const a11yLabel =
    `文字状态摘要：${describeRenderState(render)}。` +
    (state
      ? `能量${describeLevel(state.energy)}，情绪${describeLevel(state.mood)}，压力${describeLevel(state.stress)}。`
      : '当前状态向量未知。') +
    (explanation.length > 0 ? explanation[0] : '');

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: sceneColor,
        padding: 20,
        justifyContent: 'center',
      }}
      accessibilityLabel={a11yLabel}
      accessibilityRole="summary"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 18,
            fontWeight: '800',
            marginBottom: 8,
          }}
        >
          今日镜像（文字模式）
        </Text>
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 14,
            marginBottom: 16,
            lineHeight: 20,
          }}
        >
          {`当前形态：${ANIMATION_LABEL[render.animation]} · ${SCENE_LABEL[render.scene]}`}
        </Text>

        {state ? (
          <View
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderRadius: 10,
              padding: 12,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: colors.borderSoft,
            }}
          >
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 12,
                fontWeight: '700',
                marginBottom: 8,
                letterSpacing: 0.5,
              }}
            >
              状态向量
            </Text>
            {buildStateRows(state).map((row) => (
              <View
                key={row.label}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 3,
                }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{row.label}</Text>
                <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: '600' }}>
                  {row.level}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {explanation.length > 0 ? (
          <View>
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 12,
                fontWeight: '700',
                marginBottom: 6,
                letterSpacing: 0.5,
              }}
            >
              镜像解释
            </Text>
            {explanation.map((line, idx) => (
              <Text
                key={idx}
                style={{
                  color: colors.textPrimary,
                  fontSize: 14,
                  lineHeight: 20,
                  marginBottom: 6,
                }}
              >
                · {line}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
            当前证据不足，保持中性日常形态。
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
