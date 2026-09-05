/**
 * Android/iOS 原生 VRM 渲染入口。
 *
 * 约束：V2/V3 不允许降级为 2D、图标或占位模型。模型/GPU 失败时显示
 * 可诊断错误并允许重试，确保测试结果不会把降级误判为 3D 成功。
 */
import React, { Component, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import type { AvatarProfileV2 } from './avatarTypes';
import { VRMAvatarView, subscribeAvatarLoad, type AvatarLoadState } from './VRMAvatarView';
import { useAppTheme } from '../../../theme/theme';

// 静态 require 让 Metro 将真实 VRM/GLB 写入 release APK；原生 R3F 会把资源复制到缓存后交给 GLTFLoader。
const BUNDLED_VRM = require('../../../../public/avatar/AvatarSample_G.glb') as number;

export interface AvatarModelViewProps {
  profile: AvatarProfileV2;
  paused?: boolean;
  height?: number;
  onAvatarPress?: () => void;
  triggerAcknowledge?: number;
  triggerTouchReaction?: number;
  fallback?: ReactNode;
}

class Native3DErrorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Avatar/Native] 3D render failed', error, info.componentStack);
    this.props.onError(error);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function Loading3D({ loadState }: { loadState?: AvatarLoadState }) {
  const theme = useAppTheme();
  const percent = loadState?.total && loadState.loaded
    ? Math.min(100, Math.round((loadState.loaded / loadState.total) * 100))
    : null;
  const label = loadState?.phase === 'optimizing'
    ? '正在整理骨骼与表情…'
    : percent === null
      ? '正在加载原生 3D 数字人…'
      : `正在加载原生 3D 数字人 · ${percent}%`;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: theme.colors.bg }} accessibilityRole="progressbar" accessibilityLabel={label}>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>{label}</Text>
      <View style={{ width: 112, height: 2, overflow: 'hidden', backgroundColor: theme.colors.borderSoft }}>
        <View style={{ width: percent === null ? '22%' : `${Math.max(4, percent)}%`, height: 2, backgroundColor: theme.colors.primary }} />
      </View>
    </View>
  );
}

function NativeStage({
  profile,
  paused,
  onAvatarPress,
  triggerAcknowledge,
  triggerTouchReaction,
  onError,
}: Omit<AvatarModelViewProps, 'height' | 'fallback'> & { onError: (error: Error) => void }) {
  const theme = useAppTheme();
  return (
    <Canvas
      camera={{ position: [0, 1.4, 2.2], fov: 46, near: 0.05, far: 100 }}
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => gl.setClearColor(theme.colors.bg)}
    >
      <color attach="background" args={[theme.colors.bg]} />
      <ambientLight color={theme.scene3D.ambientColor} intensity={theme.scene3D.ambientIntensity} />
      <hemisphereLight color="#9db5d8" groundColor="#242d3b" intensity={0.48} />
      <directionalLight position={[2, 2.8, 2.4]} color={theme.scene3D.directionalColor} intensity={theme.scene3D.directionalIntensity} />
      <directionalLight position={[-2, 1.2, 1.6]} color={theme.scene3D.fillColor} intensity={theme.scene3D.fillIntensity} />
      <directionalLight position={[0, 2.4, -2]} color={theme.scene3D.rimColor} intensity={theme.scene3D.rimIntensity} />
      <Suspense fallback={null}>
        <VRMAvatarView
          profile={profile}
          modelUrl={BUNDLED_VRM as unknown as string}
          paused={paused}
          framing="bust"
          onAvatarPress={onAvatarPress}
          triggerAcknowledge={triggerAcknowledge}
          triggerTouchReaction={triggerTouchReaction}
          onError={onError}
        />
      </Suspense>
    </Canvas>
  );
}

export function AvatarModelView({
  profile,
  paused = false,
  onAvatarPress,
  triggerAcknowledge,
  triggerTouchReaction,
}: AvatarModelViewProps) {
  const theme = useAppTheme();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<Error | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [loadState, setLoadState] = useState<AvatarLoadState>({ phase: 'idle' });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => subscribeAvatarLoad(setLoadState), []);

  if (error) {
    return (
      <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }} accessibilityRole="alert">
        <Text style={{ color: theme.colors.red, fontWeight: '700', fontSize: 16 }}>原生 3D 数字人加载失败</Text>
        <Text selectable style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 10, textAlign: 'center' }}>{error.message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重试加载原生 3D 数字人"
          onPress={() => { setError(null); setRetryKey((value) => value + 1); }}
          style={{ marginTop: 16, minHeight: 48, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.colors.primary }}
        >
          <Text style={{ color: theme.colors.textInverse, fontWeight: '700' }}>重试 3D</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Native3DErrorBoundary key={retryKey} onError={setError}>
      <View style={{ flex: 1, width: '100%', height: '100%', backgroundColor: theme.colors.bg }}>
        <Suspense fallback={<Loading3D loadState={loadState} />}>
          <NativeStage
            profile={profile}
            paused={paused || !appActive}
            onAvatarPress={onAvatarPress}
            triggerAcknowledge={triggerAcknowledge}
            triggerTouchReaction={triggerTouchReaction}
            onError={setError}
          />
        </Suspense>
        {loadState.phase !== 'ready' && loadState.phase !== 'model-mounted' && loadState.phase !== 'error' && (
          <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' }}>
            <Loading3D loadState={loadState} />
          </View>
        )}
      </View>
    </Native3DErrorBoundary>
  );
}
