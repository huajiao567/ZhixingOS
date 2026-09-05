/**
 * V1 模式：符号化 2D 图标镜像（spec A3.1 / SubTask 17.1）。
 *
 * 当 Service Contract V 轴 = V1 时，AvatarCanvasFlagged 渲染本组件替代 3D 镜像。
 * 使用纯 RN View 形状（圆 + 圆角矩形）构建极简头像剪影，根据 render.animation
 * 切换语义色与动作指示，满足 spec「V1 → 符号化（2D 图标 + 状态文字）」。
 *
 * 设计原则：
 * - 不依赖 SVG / 三方绘图库，避免新增依赖
 * - 与 AvatarCanvas.web.tsx 的 Avatar2DFallback 视觉一致（同 identity 派生）
 * - 动画语义色复用 theme.colors 六位状态色，保持跨模块色彩语言统一
 * - Q版/kawaii风格体现大头小身比例
 */
import React from 'react';
import { Text, View } from 'react-native';
import type { AvatarIdentity, AvatarRenderState } from '../types/avatar';
import { SCENE_COLORS, SCENE_LABEL, describeRenderState } from './avatarGeometry';
import { useAppTheme } from '../../theme/theme';

interface Avatar2DIconProps {
  identity: AvatarIdentity;
  render: AvatarRenderState;
  /** 尺寸缩放因子，用于在时间线快照中显示更小的预览（默认 1.0） */
  scale?: number;
}

/** 动画类型 → 语义色 + 自然语言标签 */
const ANIMATION_META: Record<
  AvatarRenderState['animation'],
  { color: string; label: string; description: string }
> = {
  idle: {
    color: '#4DB6AC',
    label: '平静呼吸',
    description: '当前状态较平稳，保持日常待机形态。',
  },
  active: {
    color: '#66BB6A',
    label: '活跃运动',
    description: '运动活跃度较高，采用更有弹性的动作。',
  },
  focused: {
    color: '#F5B544',
    label: '专注凝视',
    description: '专注与项目推进较强，切换到专注场景。',
  },
  tired: {
    color: '#9B7BE0',
    label: '疲惫恢复',
    description: '睡眠与恢复信号偏低，形象动作已放缓。',
  },
};

export function Avatar2DIcon({ identity, render, scale = 1 }: Avatar2DIconProps) {
  const theme = useAppTheme();
  const avatarStyle = theme.avatarStyle;
  const sceneColor = SCENE_COLORS[render.scene];
  const meta = ANIMATION_META[render.animation];
  const isKawaii = avatarStyle === 'kawaii';
  const a11yLabel = `2D 符号镜像：${describeRenderState(render)}。${meta.description}`;

  const headSize = (isKawaii ? 96 : 78) * scale;
  const bodyWidth = (isKawaii ? 72 : 110) * scale;
  const bodyHeight = (isKawaii ? 58 : 92) * scale;
  const eyeSize = (isKawaii ? 10 : 7) * scale;
  const eyeY = headSize * 0.38;
  const eyeSpacing = headSize * (isKawaii ? 0.32 : 0.28);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: sceneColor,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16 * scale,
      }}
      accessibilityLabel={a11yLabel}
      accessibilityRole="image"
    >
      <View style={{ alignItems: 'center' }}>
        <View style={{ position: 'relative', marginBottom: -8 * scale, zIndex: 2 }}>
          {/* 头发（后脑勺） */}
          <View
            style={{
              position: 'absolute',
              width: headSize * 1.06,
              height: headSize * 0.72,
              borderRadius: headSize * 0.53,
              backgroundColor: identity.hairColor,
              top: -headSize * 0.08,
              left: -headSize * 0.03,
            }}
          />
          {/* 头部 */}
          <View
            style={{
              width: headSize,
              height: headSize,
              borderRadius: headSize / 2,
              backgroundColor: identity.skinTone,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* 眼睛 */}
            <View style={{ flexDirection: 'row', position: 'absolute', top: eyeY }}>
              <View
                style={{
                  width: eyeSize,
                  height: eyeSize * (isKawaii ? 1.2 : 1),
                  borderRadius: eyeSize / 2,
                  backgroundColor: '#2A2030',
                  marginRight: eyeSpacing,
                }}
              />
              <View
                style={{
                  width: eyeSize,
                  height: eyeSize * (isKawaii ? 1.2 : 1),
                  borderRadius: eyeSize / 2,
                  backgroundColor: '#2A2030',
                }}
              />
            </View>
            {/* kawaii风格腮红 */}
            {isKawaii && (
              <>
                <View
                  style={{
                    position: 'absolute',
                    width: 12 * scale,
                    height: 7 * scale,
                    borderRadius: 6 * scale,
                    backgroundColor: '#FF99AA',
                    opacity: 0.5,
                    left: headSize * 0.12,
                    top: headSize * 0.55,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    width: 12 * scale,
                    height: 7 * scale,
                    borderRadius: 6 * scale,
                    backgroundColor: '#FF99AA',
                    opacity: 0.5,
                    right: headSize * 0.12,
                    top: headSize * 0.55,
                  }}
                />
              </>
            )}
          </View>
        </View>

        {/* 身体 */}
        <View
          style={{
            width: bodyWidth,
            height: bodyHeight,
            borderTopLeftRadius: bodyWidth * 0.4,
            borderTopRightRadius: bodyWidth * 0.4,
            borderBottomLeftRadius: bodyWidth * 0.25,
            borderBottomRightRadius: bodyWidth * 0.25,
            backgroundColor: identity.shirtColor,
            borderWidth: 2.5 * scale,
            borderColor: meta.color,
            alignItems: 'center',
            paddingTop: bodyHeight * 0.15,
          }}
        >
          {/* kawaii风格小扣子 */}
          {isKawaii && (
            <View
              style={{
                width: 8 * scale,
                height: 8 * scale,
                borderRadius: 4 * scale,
                backgroundColor: '#FFFFFF',
                marginBottom: 6 * scale,
              }}
            />
          )}
        </View>

        {/* 动作指示点 */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 14 * scale,
          }}
        >
          <View
            style={{
              width: 8 * scale,
              height: 8 * scale,
              borderRadius: 4 * scale,
              backgroundColor: meta.color,
              marginRight: 6 * scale,
            }}
          />
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontSize: 14 * scale,
              fontWeight: '700',
            }}
          >
            {meta.label}
          </Text>
        </View>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 12 * scale,
            marginTop: 4 * scale,
          }}
        >
          {SCENE_LABEL[render.scene]}
        </Text>
        <Text
          style={{
            color: theme.colors.textTertiary,
            fontSize: 11 * scale,
            marginTop: 6 * scale,
            textAlign: 'center',
            maxWidth: 200 * scale,
            lineHeight: 15 * scale,
          }}
        >
          {meta.description}
        </Text>
      </View>
    </View>
  );
}
