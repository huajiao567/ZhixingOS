/**
 * AvatarCanvasFlagged — 用户服务契约的 V 级显示入口（V0文字/V1图标/V2静态/V3动态）
 *
 * V6.0 统一使用VRM专业数字孪生方案：
 *   - V0/V1 仅由用户明确选择，不作为 3D 错误回退
 *   - V0: 纯文字摘要
 *   - V1: 2D简约图标 + 文字
 *   - V2: 静态3D VRM模型（无动画）
 *   - V3: 动态3D VRM模型（自然动画系统）
 */
import { Suspense, lazy, useMemo } from 'react';
import { View, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useServiceContractStore } from '../../store/useServiceContractStore';
import { useAppTheme } from '../../theme/theme';
import type { AvatarProfileV2 } from './v2/avatarTypes';
import { resolveAvatarRenderMode } from './avatarTimeline';

// 3D 模块（three/@react-three/@pixiv/three-vrm）延迟到真正渲染 V2/V3 时才求值：
// V0/V1（文字/图标）模式下不承担 3D 启动成本（对应 proposals P2-A 低端机方向）。
const AvatarModelView = lazy(() =>
  import('./v2/AvatarModelView').then((m) => ({ default: m.AvatarModelView })),
);

interface AvatarCanvasFlaggedProps {
  profile: AvatarProfileV2;
  size?: number;
  fill?: boolean;
  paused?: boolean;
  /** 导航失焦时彻底停止挂载 3D runtime，避免隐藏页面继续解析/占用 WebGL。 */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  onAvatarPress?: () => void;
  triggerAcknowledge?: number;
  triggerTouchReaction?: number;
}

/* ───────────── V0: 纯文字摘要 ───────────── */
function V0TextSummary({ profile }: { profile: AvatarProfileV2 }) {
  const theme = useAppTheme();
  const { dailyState } = profile;

  const describeLevel = (value: number): string => {
    if (value < 0.34) return '偏低';
    if (value > 0.66) return '偏高';
    return '中等';
  };

  return (
    <View style={styles.v0Container}>
      <Text style={[styles.v0Title, { color: theme.colors.textPrimary }]}>
        今日镜像（文字模式）
      </Text>
      <Text style={[styles.v0Subtitle, { color: theme.colors.textSecondary }]}>
        {`能量${describeLevel(dailyState.energy)} · 压力${describeLevel(dailyState.tension)} · 专注${describeLevel(dailyState.focus)}`}
      </Text>
      <View style={[styles.v0Card, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderSoft }]}>
        {[
          { label: '专注', value: describeLevel(dailyState.focus) },
          { label: '活力', value: describeLevel(dailyState.energy) },
          { label: '亲和', value: describeLevel(dailyState.socialOpenness) },
        ].map((row) => (
          <View key={row.label} style={styles.v0Row}>
            <Text style={[styles.v0Label, { color: theme.colors.textSecondary }]}>{row.label}</Text>
            <Text style={[styles.v0Value, { color: theme.colors.textPrimary }]}>{row.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ───────────── V1: 2D简约图标 ───────────── */
function V1IconFallback({ profile }: { profile: AvatarProfileV2 }) {
  const theme = useAppTheme();
  const { dailyState } = profile;

  const moodColor = dailyState.energy > 0.6 ? theme.colors.l2 :
                   dailyState.tension > 0.6 ? theme.colors.l1 :
                   theme.colors.primary;

  return (
    <View style={styles.v1Container}>
      <View style={[styles.v1Head, { backgroundColor: '#F5D0C5' }]}>
        <View style={styles.v1EyesRow}>
          <View style={[styles.v1Eye, { backgroundColor: '#2A2030' }]} />
          <View style={[styles.v1Eye, { backgroundColor: '#2A2030', marginLeft: 18 }]} />
        </View>
        {dailyState.energy > 0.55 && (
          <>
            <View style={[styles.v1Blush, { left: 14, backgroundColor: '#FF99AA', opacity: 0.4 }]} />
            <View style={[styles.v1Blush, { right: 14, backgroundColor: '#FF99AA', opacity: 0.4 }]} />
          </>
        )}
      </View>
      <View style={[styles.v1Body, { borderColor: moodColor }]} />
      <Text style={[styles.v1Label, { color: theme.colors.textSecondary, marginTop: 12 }]}>
        {dailyState.energy > 0.6 ? '状态舒展' : dailyState.tension > 0.6 ? '略感紧绷' : '平静日常'}
      </Text>
    </View>
  );
}

/* ───────────── 主组件 ───────────── */

export function AvatarCanvasFlagged({
  profile,
  size,
  fill = false,
  paused,
  active = true,
  style,
  onAvatarPress,
  triggerAcknowledge,
  triggerTouchReaction,
}: AvatarCanvasFlaggedProps) {
  const theme = useAppTheme();
  const contract = useServiceContractStore((s) => s.contract);
  const mode = resolveAvatarRenderMode(contract?.avatar);

  const containerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.container,
      fill || !size
        ? { flex: 1, width: '100%', height: '100%', borderRadius: theme.radius.lg, backgroundColor: 'transparent' }
        : { width: size, height: size, borderRadius: theme.radius.lg, backgroundColor: 'transparent' },
      style,
    ],
    [size, fill, theme, style]
  );

  if (mode === 'text') {
    return (
      <View style={containerStyle}>
        <V0TextSummary profile={profile} />
      </View>
    );
  }

  if (mode === 'icon') {
    return (
      <View style={containerStyle}>
        <V1IconFallback profile={profile} />
      </View>
    );
  }

  const isStatic = mode === 'static3d';

  // 失焦页面不保留隐藏的 Canvas/VRM runtime。它们不可见，却仍会解析 15MB+
  // 模型并占用 WebGL/动画资源；重新获得焦点时再从共享 GLB bytes 建立独立实例。
  if (!active) {
    return <View style={containerStyle} />;
  }

  return (
    <View style={containerStyle}>
      <Suspense fallback={<View style={styles.lazyFallback} collapsable={false} />}>
        <AvatarModelView
          profile={profile}
          paused={paused ?? isStatic}
          onAvatarPress={onAvatarPress}
          triggerAcknowledge={triggerAcknowledge}
          triggerTouchReaction={triggerTouchReaction}
        />
      </Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lazyFallback: {
    flex: 1,
    width: '100%',
  },
  /* V0 文字模式 */
  v0Container: {
    flex: 1,
    width: '100%',
    padding: 16,
    justifyContent: 'center',
  },
  v0Title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  v0Subtitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  v0Card: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  v0Row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  v0Label: {
    fontSize: 13,
  },
  v0Value: {
    fontSize: 13,
    fontWeight: '600',
  },
  /* V1 图标模式 */
  v1Container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  v1Head: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: -8,
    zIndex: 2,
  },
  v1EyesRow: {
    flexDirection: 'row',
    position: 'absolute',
    top: 28,
  },
  v1Eye: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  v1Blush: {
    position: 'absolute',
    width: 12,
    height: 7,
    borderRadius: 4,
    top: 42,
  },
  v1Body: {
    width: 88,
    height: 56,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: '#E8E4E0',
    borderWidth: 2,
    alignItems: 'center',
    paddingTop: 8,
  },
  v1Label: {
    fontSize: 12,
    fontWeight: '500',
  },
});
