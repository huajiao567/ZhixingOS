/**
 * 状态可解释映射（spec SubTask 17.5 / A36.4）。
 *
 * 当用户点击「为什么这样显示?」时弹出本模态，展示 avatar 表情 / 姿态 / 动画
 * 与底层状态向量之间的映射关系。映射逻辑严格复用 stateMapper.mapStateToRender，
 * 不引入新的经验参数（用户规则 2）。
 *
 * 设计原则：
 * - 所有映射关系源自 stateMapper.ts 的真实公式，可在源码中追溯
 * - 状态值采用三级证据语言（偏低 / 中等 / 偏高），不展示未经验证的精确百分比（P0-4）
 * - 复用 explainState 自然语言解释，避免重复维护文案
 */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { AvatarRenderState, DailyState } from '../types/avatar';
import { explainState } from './stateMapper';
import { useAppTheme } from '../../theme/theme';

interface StateExplainerProps {
  visible: boolean;
  onClose: () => void;
  render: AvatarRenderState;
  state?: DailyState;
}

/** 动画类型 → 自然语言标签 + 触发条件 */
const ANIMATION_EXPLANATION: Record<
  AvatarRenderState['animation'],
  { label: string; trigger: string }
> = {
  idle: {
    label: '平静呼吸',
    trigger: '恢复需求不高、专注不强、身体活跃不高时进入日常待机形态。',
  },
  active: {
    label: '活跃运动',
    trigger: '身体活跃度较高（physicality > 0.66）时切换到更有弹性的动作。',
  },
  focused: {
    label: '专注凝视',
    trigger: '专注较强（focus > 0.70）且压力不高（stress < 0.72）时切换到专注场景。',
  },
  tired: {
    label: '疲惫恢复',
    trigger: '恢复需求较高（recoveryNeed > 0.62）时放缓动作，提示恢复，不作心理诊断。',
  },
};

/** 把 0..1 区间值映射为三级证据语言 */
function describeLevel(value: number): string {
  if (value < 0.34) return '偏低';
  if (value > 0.66) return '偏高';
  return '中等';
}

/**
 * 渲染参数行：label / 当前值（0..1 的三级证据描述）/ 影响它的状态维度。
 * 映射关系严格对应 stateMapper.mapStateToRender 的公式，不引入新参数。
 */
interface RenderRow {
  label: string;
  value: number;
  sources: string[];
}

function buildRenderRows(render: AvatarRenderState): RenderRow[] {
  return [
    { label: '微笑（表情）', value: render.smile, sources: ['情绪 mood (+)', '压力 stress (-)', '校准 smile'] },
    { label: '姿态开放度', value: render.posture, sources: ['能量 energy (+)', '压力 stress (-)', '校准 posture'] },
    { label: '眼神睁开度', value: render.eyeOpen, sources: ['能量 energy (+)', '恢复需求 (-)', '校准 fatigue'] },
    { label: '眉部紧张度', value: render.browTension, sources: ['压力 stress (+)'] },
    { label: '动作速度', value: render.motionSpeed, sources: ['能量 energy (+)', '身体活跃 physicality (+)', '恢复需求 (-)'] },
    { label: '身体摆动', value: render.sway, sources: ['唤起 arousal (+)', '身体活跃 physicality (+)'] },
  ];
}

/** 状态向量行：label / 当前值 / 三级证据描述 */
interface StateRow {
  label: string;
  value: number;
}

function buildStateRows(state: DailyState): StateRow[] {
  return [
    { label: '能量 energy', value: state.energy },
    { label: '情绪 mood', value: state.mood },
    { label: '压力 stress', value: state.stress },
    { label: '唤起 arousal', value: state.arousal },
    { label: '社交 sociality', value: state.sociality },
    { label: '专注 focus', value: state.focus },
    { label: '自护 selfcare', value: state.selfcare },
    { label: '身体活跃 physicality', value: state.physicality },
    { label: '意义动量 meaningMomentum', value: state.meaningMomentum },
  ];
}

function SectionHeader({ C, children }: { C: any; children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: C.textTertiary,
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 8,
        marginTop: 16,
        letterSpacing: 0.5,
      }}
    >
      {children}
    </Text>
  );
}

function Card({ C, children }: { C: any; children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 10,
        padding: 12,
        borderWidth: 1,
        borderColor: C.borderSoft,
      }}
    >
      {children}
    </View>
  );
}

export function StateExplainer({ visible, onClose, render, state }: StateExplainerProps) {
  const theme = useAppTheme();
  const C = theme.colors;
  const animationMeta = ANIMATION_EXPLANATION[render.animation];
  const renderRows = buildRenderRows(render);
  const stateRows = state ? buildStateRows(state) : [];
  const explanations = state ? explainState(state, render) : [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityLabel="avatar 状态映射解释模态"
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <View
          style={{
            backgroundColor: C.surface,
            borderRadius: 16,
            maxHeight: '85%',
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: C.borderSoft,
            }}
          >
            <Text
              style={{ color: C.textPrimary, fontSize: 17, fontWeight: '800' }}
              accessibilityRole="header"
            >
              为什么这样显示?
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭状态映射解释"
              hitSlop={8}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
                backgroundColor: C.surfaceAlt,
              }}
            >
              <Text style={{ color: C.textSecondary, fontSize: 14, fontWeight: '600' }}>
                关闭
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16 }}
            showsVerticalScrollIndicator={false}
          >
            <SectionHeader C={C}>当前形象</SectionHeader>
            <Card C={C}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={{ color: C.textSecondary, fontSize: 14 }}>动画</Text>
                <Text style={{ color: C.textPrimary, fontSize: 14, fontWeight: '600' }}>
                  {animationMeta.label}
                </Text>
              </View>
              <Text
                style={{
                  color: C.textTertiary,
                  fontSize: 12,
                  lineHeight: 17,
                  marginTop: 4,
                }}
              >
                {animationMeta.trigger}
              </Text>
            </Card>

            <SectionHeader C={C}>表情 / 姿态参数 ← 状态来源</SectionHeader>
            <Card C={C}>
              {renderRows.map((row) => (
                <View key={row.label} style={{ paddingVertical: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: C.textSecondary, fontSize: 13 }}>{row.label}</Text>
                    <Text style={{ color: C.textPrimary, fontSize: 13, fontWeight: '600' }}>
                      {describeLevel(row.value)}
                    </Text>
                  </View>
                  <Text style={{ color: C.textTertiary, fontSize: 11, marginTop: 2 }}>
                    {row.sources.join(' · ')}
                  </Text>
                </View>
              ))}
            </Card>

            {state ? (
              <>
                <SectionHeader C={C}>当前状态向量</SectionHeader>
                <Card C={C}>
                  {stateRows.map((row) => (
                    <View
                      key={row.label}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        paddingVertical: 3,
                      }}
                    >
                      <Text style={{ color: C.textSecondary, fontSize: 13 }}>{row.label}</Text>
                      <Text style={{ color: C.textPrimary, fontSize: 13, fontWeight: '600' }}>
                        {describeLevel(row.value)}
                      </Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {explanations.length > 0 ? (
              <>
                <SectionHeader C={C}>镜像解释</SectionHeader>
                <Card C={C}>
                  {explanations.map((line, idx) => (
                    <Text
                      key={idx}
                      style={{
                        color: C.textPrimary,
                        fontSize: 13,
                        lineHeight: 19,
                        marginBottom: 6,
                      }}
                    >
                      · {line}
                    </Text>
                  ))}
                </Card>
              </>
            ) : null}

            <Text
              style={{
                color: C.textTertiary,
                fontSize: 11,
                lineHeight: 16,
                marginTop: 16,
                textAlign: 'center',
              }}
            >
              所有映射源自 stateMapper.mapStateToRender 公式，可在源码中追溯。
              {'\n'}「恢复中」等视觉提示不等同于心理诊断。
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
