/**
 * Satori Avatar v2 — AvatarModelView（Web / R3F）
 *
 * V6.0 专业VRM数字孪生渲染器（VRMAvatarView内部自动定位相机）：
 *   - 使用允许再分发的 VRM 3D 人形模型（VRoid Studio beta AvatarSample_G）
 *   - 标准glTF/VRM管线：SkinnedMesh蒙皮 + 骨骼系统 + BlendShape表情 + SpringBone物理
 *   - 自然动画系统（由VRMAvatarView内部实现）：
 *     * AIRI标准自然眨眼（正弦曲线平滑 + 随机1.5-5.5s间隔）
 *     * 自然眼跳(saccades)模拟真实眼球微动（300-800ms间隔）
 *     * 情绪状态机（easeInOutCubic平滑过渡，6种情绪状态）
 *     * 呼吸动画（脊柱/胸部/肩膀协调运动）
 *     * 头部自然微动（与视线活跃度挂钩）
 *   - 自动包围盒相机定位（VRMAvatarView内部根据模型尺寸计算）
 *   - 双主题光照统一（晨雾/夜航），3D场景与2D UI色调一致
 *   - 三点光照：环境光 + 主方向光（投射阴影）+ 补光 + 轮廓光
 *   - 失败/不支持 WebGL → 明确错误，不用 2D 或占位模型冒充 3D 成功
 *
 * 模型来源与许可证：见 THIRD_PARTY_ASSETS.md；该文件的嵌入 VRM 元数据允许
 * 商业使用、修改和再分发，但并非以 CC0 为依据。
 */
import React, { Component, useCallback, useEffect, useState, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Platform, Text, View, Pressable, useWindowDimensions } from 'react-native';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { AvatarProfileV2 } from './avatarTypes';
import { useAppTheme } from '../../../theme/theme';
import { VRMAvatarView, type AvatarLoadState } from './VRMAvatarView';

// 交给 Metro 管理，确保 development、production Web 导出和原生 APK 都引用同一份真实模型。
const BUNDLED_VRM = require('../../../../public/avatar/AvatarSample_G.glb') as string;

/* ───────────── 可诊断状态（WebGL 不可用 / 加载失败） ───────────── */

function ThreeStatus({ reason, loadState }: { reason: 'webgl' | 'error' | 'loading'; loadState?: AvatarLoadState }) {
  const theme = useAppTheme();
  const percent = loadState?.total && loadState.loaded
    ? Math.min(100, Math.round((loadState.loaded / loadState.total) * 100))
    : null;
  const loadingLabel = loadState?.phase === 'optimizing'
    ? '正在整理骨骼与表情…'
    : loadState?.phase === 'parsed' || loadState?.phase === 'preparing' || loadState?.phase === 'model-mounted'
      ? '正在准备镜像…'
      : percent !== null
        ? `正在加载 3D 数字人 · ${percent}%`
        : '正在加载 3D 数字人…';
  const label = reason === 'loading' ? loadingLabel : reason === 'webgl' ? '当前环境不支持 WebGL，无法显示 3D 数字人' : '3D 数字人加载失败，请刷新后重试';
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }} accessibilityLabel={label} accessibilityRole={reason === 'error' ? 'alert' : 'progressbar'}>
      <Text style={{ color: reason === 'loading' ? theme.colors.textSecondary : theme.colors.red, fontSize: 12, fontWeight: '600', textAlign: 'center', paddingHorizontal: 16 }}>{label}</Text>
      {reason === 'loading' && (
        <View style={{ width: 112, height: 2, overflow: 'hidden', backgroundColor: theme.colors.borderSoft }}>
          <View style={{ width: percent === null ? '22%' : `${Math.max(4, percent)}%`, height: 2, backgroundColor: theme.colors.primary }} />
        </View>
      )}
    </View>
  );
}

class AvatarCanvasErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Avatar] Canvas render failed:', error, info.componentStack);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* ───────────── 光照（从theme.scene3D读取，双主题精确统一 · 专业人像摄影布光） ───────────── */

function SceneLighting() {
  const theme = useAppTheme();
  const { scene3D } = theme;
  const isDark = theme.dark;

  return (
    <>
      {/* 环境光：整体基础亮度与色温，柔和填充 - 提升亮度让肤色更通透 */}
      <ambientLight color={scene3D.ambientColor} intensity={scene3D.ambientIntensity * (isDark ? 1.15 : 1.0)} />
      {/* 半球光：天空/地面双色反射，增加环境色层次感（人像肤色更自然） */}
      <hemisphereLight
        color={isDark ? '#8ba8d0' : '#f0f4fa'}
        groundColor={isDark ? '#2a3040' : '#f0e8dd'}
        intensity={isDark ? 0.50 : 0.60}
      />
      {/* 主方向光：模拟主光源，45度伦勃朗光位，投射柔和阴影 */}
      <directionalLight
        position={[2.0, 2.6, 2.4]}
        color={scene3D.directionalColor}
        intensity={scene3D.directionalIntensity * (isDark ? 1.0 : 0.92)}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={10}
        shadow-camera-near={0.4}
        shadow-camera-left={-1.8}
        shadow-camera-right={1.8}
        shadow-camera-top={1.8}
        shadow-camera-bottom={-1.8}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-radius={isDark ? 8 : 6}
      />
      {/* 补光：暗部补光，暖色调保肤色，强度低于主光 */}
      <directionalLight
        position={[-2.0, 1.2, 1.8]}
        color={scene3D.fillColor}
        intensity={scene3D.fillIntensity * (isDark ? 1.25 : 1.08)}
      />
      {/* 轮廓光：从后方勾勒发丝和肩膀边缘 */}
      <directionalLight
        position={[-0.6, 2.2, -2.2]}
        color={isDark ? '#a8c0e8' : '#e0edf8'}
        intensity={isDark ? 0.42 : 0.32}
      />
      {/* 顶部柔光：模拟天空漫射光，照亮头顶和头发 */}
      <directionalLight
        position={[0, 3.2, 0.3]}
        color={isDark ? '#94add5' : '#f5f8fc'}
        intensity={isDark ? 0.18 : 0.22}
      />
      {/* 底部微弱反光：模拟地面反弹光，减少下巴死黑 */}
      <directionalLight
        position={[0.1, -0.8, 1.0]}
        color={isDark ? '#505c75' : '#faf3e8'}
        intensity={isDark ? 0.15 : 0.20}
      />
    </>
  );
}

/* ───────────── 径向渐变背景（人像摄影背景纸效果 · 多层渐变增加深度感） ───────────── */

function SceneBackground({ framing }: { framing: 'bust' | 'full' }) {
  const theme = useAppTheme();
  const { scene } = useThree();

  useEffect(() => {
    // 多层径向渐变：主亮区 + 微妙环境色晕染，营造摄影棚背景纸质感
    // 专业人像摄影背景：中心亮，边缘暗，顶部微妙冷暖调，底部柔和反光
    const center = new THREE.Color(theme.dark ? '#283a58' : theme.colors.surface);
    const mid = new THREE.Color(theme.dark ? '#1d2a3e' : new THREE.Color(theme.colors.surface).lerp(new THREE.Color(theme.colors.bg), 0.2));
    const edge = new THREE.Color(theme.colors.bg);
    // 胸像：亮区在偏上位置（面部）；全身：亮区在中部偏上（胸部/上半身）
    const gradientCenterY = framing === 'bust' ? 0.30 : 0.40;
    const gradientRadius = framing === 'bust' ? 0.58 : 0.70;

    if (Platform.OS === 'web') {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;

      // 第一层：边缘深色基础（带极微妙的底部暖调反光）
      const baseGrad = ctx.createLinearGradient(0, 0, 0, size);
      baseGrad.addColorStop(0, `#${edge.getHexString()}`);
      baseGrad.addColorStop(0.82, `#${edge.getHexString()}`);
      baseGrad.addColorStop(1, theme.dark ? '#242e40' : '#f3ede3');
      ctx.fillStyle = baseGrad;
      ctx.fillRect(0, 0, size, size);

      // 第二层：大范围中间色过渡（更柔和的扩散）
      const gradientMid = ctx.createRadialGradient(
        size * 0.5, size * (gradientCenterY + 0.06), 0,
        size * 0.5, size * 0.50, size * (gradientRadius + 0.25)
      );
      gradientMid.addColorStop(0, `#${mid.getHexString()}`);
      gradientMid.addColorStop(0.55, `#${mid.clone().lerp(edge, 0.45).getHexString()}`);
      gradientMid.addColorStop(1, 'transparent');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = gradientMid;
      ctx.fillRect(0, 0, size, size);

      // 第三层：主亮区（面部/人物区域，柔边椭圆）
      const gradient = ctx.createRadialGradient(
        size * 0.5, size * gradientCenterY, 0,
        size * 0.5, size * (gradientCenterY + 0.04), size * gradientRadius
      );
      gradient.addColorStop(0, `#${center.getHexString()}`);
      gradient.addColorStop(0.32, `#${center.clone().lerp(edge, 0.25).getHexString()}`);
      gradient.addColorStop(0.68, `#${center.clone().lerp(edge, 0.62).getHexString()}`);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      // 第四层：极微妙的顶部环境光感（冷暖微调，增加空间深度）
      if (theme.dark) {
        const topGlow = ctx.createLinearGradient(0, 0, 0, size * 0.45);
        topGlow.addColorStop(0, 'rgba(110,150,200,0.08)');
        topGlow.addColorStop(0.5, 'rgba(90,120,170,0.03)');
        topGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = topGlow;
        ctx.fillRect(0, 0, size, size);
      } else {
        const topGlow = ctx.createLinearGradient(0, 0, 0, size * 0.40);
        topGlow.addColorStop(0, 'rgba(255,252,245,0.20)');
        topGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = topGlow;
        ctx.fillRect(0, 0, size, size);
      }

      // 第五层：底部微弱暖调反光（人像摄影必备：地面/环境反弹光）
      const bottomGlow = ctx.createRadialGradient(
        size * 0.5, size * 0.95, 0,
        size * 0.5, size * 0.95, size * 0.45
      );
      bottomGlow.addColorStop(0, theme.dark ? 'rgba(180,140,80,0.06)' : 'rgba(250,240,220,0.30)');
      bottomGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = bottomGlow;
      ctx.fillRect(0, 0, size, size);

      // 第六层：极微妙的暗角效果（边缘轻微压暗，聚焦中心人物）
      const vignette = ctx.createRadialGradient(
        size * 0.5, size * 0.48, size * 0.30,
        size * 0.5, size * 0.48, size * 0.75
      );
      vignette.addColorStop(0, 'transparent');
      vignette.addColorStop(1, theme.dark ? 'rgba(0,0,0,0.20)' : 'rgba(0,0,0,0.05)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, size, size);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;

      return () => {
        texture.dispose();
        scene.background = null;
      };
    } else {
      scene.background = edge;
      return () => {
        scene.background = null;
      };
    }
  }, [scene, theme.dark, theme.colors.bg, theme.colors.surface, framing]);

  return null;
}

/* ───────────── 接触阴影：模型下方多层柔和椭圆阴影，专业人像布光风格 ───────────── */

function ContactShadow({ framing }: { framing: 'bust' | 'full' }) {
  const theme = useAppTheme();
  const isDark = theme.dark;

  if (framing === 'bust') {
    // 胸像模式：小巧集中的柔和阴影
    return (
      <mesh position={[0, -0.48, 0.12]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[0.45, 64]} />
        <meshBasicMaterial
          color={isDark ? '#060a14' : '#8a7d6d'}
          transparent
          opacity={isDark ? 0.20 : 0.08}
          depthWrite={false}
        />
      </mesh>
    );
  }

  // 全身模式：多层渐变阴影，模拟真实地面接触效果
  // 核心（脚底下深黑）+ 中圈（柔和扩散）+ 外圈（极淡环境光遮蔽）
  const shadowColor = isDark ? '#03060d' : '#5a4f42';
  return (
    <group position={[0, -0.045, 0.06]} renderOrder={-1}>
      {/* 核心阴影：双脚正下方，最深最集中 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[0, 0.18, 48]} />
        <meshBasicMaterial color={shadowColor} transparent opacity={isDark ? 0.35 : 0.15} depthWrite={false} />
      </mesh>
      {/* 中圈阴影：脚步周围 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <ringGeometry args={[0.18, 0.42, 64]} />
        <meshBasicMaterial color={shadowColor} transparent opacity={isDark ? 0.18 : 0.07} depthWrite={false} />
      </mesh>
      {/* 外圈阴影：大范围柔和扩散 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0.02]}>
        <ringGeometry args={[0.42, 0.72, 64]} />
        <meshBasicMaterial color={shadowColor} transparent opacity={isDark ? 0.07 : 0.03} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ───────────── 主舞台 ───────────── */

interface StageProps {
  profile: AvatarProfileV2;
  paused: boolean;
  framing: 'bust' | 'full';
  onAvatarPress?: () => void;
  triggerAcknowledge?: number;
  triggerTouchReaction?: number;
  onLoadStateChange: (state: AvatarLoadState) => void;
}

function Stage({ profile, paused, framing, onAvatarPress, triggerAcknowledge, triggerTouchReaction, onLoadStateChange, onRenderError }: StageProps & { onRenderError: () => void }) {
  const theme = useAppTheme();

  return (
    <View style={{ flex: 1, width: '100%', height: '100%' }}>
      <Canvas
        style={{ flex: 1, width: '100%', height: '100%' }}
        camera={{ position: [0, 1.35, 1.5], fov: 30, near: 0.05, far: 100 }}
        frameloop={paused ? 'never' : 'always'}
        dpr={[1, 2]}
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = theme.scene3D.toneExposure * (theme.dark ? 1.08 : 1.05);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFShadowMap;
        }}
      >
        <SceneBackground framing={framing} />
        <SceneLighting />
        <ContactShadow framing={framing} />
        <Suspense fallback={null}>
          <VRMAvatarView
            profile={profile}
            modelUrl={BUNDLED_VRM}
            paused={paused ?? false}
            framing={framing}
            onAvatarPress={onAvatarPress}
            triggerAcknowledge={triggerAcknowledge}
            triggerTouchReaction={triggerTouchReaction}
            onLoadStateChange={onLoadStateChange}
            onError={onRenderError}
          />
        </Suspense>
      </Canvas>
    </View>
  );
}

/* ───────────── 主组件 ───────────── */

export interface AvatarModelViewProps {
  profile: AvatarProfileV2;
  paused?: boolean;
  height?: number;
  onAvatarPress?: () => void;
  triggerAcknowledge?: number;
  triggerTouchReaction?: number;
  fallback?: ReactNode;
}

export function AvatarModelView({
  profile,
  paused = false,
  onAvatarPress,
  triggerAcknowledge,
  triggerTouchReaction,
  fallback,
}: AvatarModelViewProps) {
  const theme = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const [webgl, setWebgl] = useState(true);
  const [framing, setFraming] = useState<'bust' | 'full'>('bust');
  const [hintVisible, setHintVisible] = useState(true);
  const [renderFailed, setRenderFailed] = useState(false);
  const [loadState, setLoadState] = useState<AvatarLoadState>({ phase: 'idle' });
  const handleRenderError = useCallback(() => setRenderFailed(true), []);

  // 手机端（宽度<600）适配参数
  const isNarrow = screenWidth < 600;
  const isCompactPhone = screenWidth < 420;
  // 注意：AvatarModelView在3D舞台区域内部，控件位置相对于舞台而非屏幕
  // 手机端：舞台下方是三镜卡片，控件只需距离舞台底部足够边距
  const controlBottom = isNarrow ? (isCompactPhone ? 16 : 20) : 24;
  const controlRight = isNarrow ? (isCompactPhone ? 12 : 14) : 16;
  const hintLeft = isNarrow ? (isCompactPhone ? 14 : 16) : 20;
  const hintBottom = isNarrow ? (isCompactPhone ? 20 : 24) : 28;
  const ctrlPaddingH = isNarrow ? (isCompactPhone ? 12 : 14) : 18;
  const ctrlPaddingV = isNarrow ? (isCompactPhone ? 6 : 7) : 8;
  const resetBtnSize = isNarrow ? (isCompactPhone ? 34 : 36) : 40;
  const fontSize = isNarrow ? (isCompactPhone ? 11 : 12) : 13;

  // 操作提示6秒后自动淡出，用户交互时短暂恢复
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const showHint = () => {
    setHintVisible(true);
    setTimeout(() => setHintVisible(false), 4000);
  };

  const handleFramingChange = (f: 'bust' | 'full') => {
    setFraming(f);
    showHint();
  };

  const handleResetCamera = () => {
    if (typeof window !== 'undefined' && (window as any).__resetAvatarCamera) {
      (window as any).__resetAvatarCamera();
    }
    showHint();
  };

  // WebGL检测：简化方式，避免创建额外canvas导致上下文冲突
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // 直接假设WebGL可用，R3F Canvas内部会处理错误
    // ErrorBoundary会在真正失败时降级
    setWebgl(true);
  }, []);

  // Web端：修复React Native Web中R3F Canvas不传递尺寸样式的问题
  useEffect(() => {
    if (Platform.OS !== 'web' || !webgl) return;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;
    const fixSize = () => {
      attempts++;
      const canvases = document.querySelectorAll('canvas');
      let fixed = false;
      canvases.forEach((c) => {
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.display = 'block';
        if (c.parentElement && c.parentElement.clientWidth > 100) {
          fixed = true;
        }
      });
      if (canvases.length === 0 && attempts < MAX_ATTEMPTS) {
        setTimeout(fixSize, 200);
      } else if (!fixed && attempts < MAX_ATTEMPTS) {
        setTimeout(fixSize, 200);
      } else if (fixed && attempts <= 5) {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
      }
    };
    fixSize();
    const onResize = () => {
      document.querySelectorAll('canvas').forEach((c) => {
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.display = 'block';
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [webgl]);

  const failureFallback = <ThreeStatus reason={webgl ? 'error' : 'webgl'} />;
  if (!webgl || renderFailed) return <>{failureFallback}</>;
  return (
    <AvatarCanvasErrorBoundary fallback={failureFallback} onError={handleRenderError}>
      <View style={{ flex: 1, width: '100%', height: '100%', position: 'relative', pointerEvents: 'box-none' }}>
        <Suspense fallback={<ThreeStatus reason="loading" />}>
          <Stage
            profile={profile}
            paused={paused}
            framing={framing}
            onAvatarPress={onAvatarPress}
            triggerAcknowledge={triggerAcknowledge}
            triggerTouchReaction={triggerTouchReaction}
            onLoadStateChange={setLoadState}
            onRenderError={handleRenderError}
          />
        </Suspense>

        {loadState.phase !== 'ready' && loadState.phase !== 'model-mounted' && loadState.phase !== 'error' && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              zIndex: 6,
              pointerEvents: 'none',
              backgroundColor: theme.dark ? 'rgba(16, 24, 28, 0.74)' : 'rgba(247, 245, 239, 0.82)',
            }}
          >
            <ThreeStatus reason="loading" loadState={loadState} />
          </View>
        )}

      {/* 视角控制：与应用视觉系统一致的克制分段控制器。 */}
      <View
        style={{
          position: 'absolute',
          right: controlRight,
          bottom: controlBottom,
          flexDirection: 'row',
          gap: isNarrow ? 8 : 10,
          zIndex: 10,
          alignItems: 'center',
          pointerEvents: 'box-none',
        }}
      >
        {/* 半身/全身分段控制器 */}
        <View style={(() => {
          const s: any[] = [
            {
              flexDirection: 'row' as const,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: isNarrow ? (isCompactPhone ? 2.5 : 3) : 4,
              overflow: 'hidden',
              pointerEvents: 'auto',
            },
          ];
          if (Platform.OS === 'web') {
            s.push({
              boxShadow: `0px 2px 8px rgba(0,0,0,${theme.dark ? 0.24 : 0.08})`,
            });
          } else {
            s.push({
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: theme.dark ? 0.24 : 0.08,
              shadowRadius: 8,
              elevation: 3,
            });
          }
          return s;
        })()}>
          <Pressable
            onPress={() => handleFramingChange('bust')}
            style={({ pressed }) => ([
              {
                paddingHorizontal: ctrlPaddingH,
                paddingVertical: ctrlPaddingV,
                borderRadius: theme.radius.sm,
                backgroundColor: framing === 'bust'
                  ? theme.colors.primarySoft
                  : 'transparent',
                transform: [{ scale: pressed ? 0.94 : 1 }],
              },
              Platform.OS === 'web' ? { transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' } as any : {},
            ])}
          >
            <Text style={{
              fontSize: fontSize,
              color: framing === 'bust'
                ? theme.colors.primary
                : theme.colors.textSecondary,
              fontWeight: framing === 'bust' ? '600' : '500',
              letterSpacing: 0.3,
            }}>半身</Text>
          </Pressable>
          <Pressable
            onPress={() => handleFramingChange('full')}
            style={({ pressed }) => ([
              {
                paddingHorizontal: ctrlPaddingH,
                paddingVertical: ctrlPaddingV,
                borderRadius: theme.radius.sm,
                backgroundColor: framing === 'full'
                  ? theme.colors.primarySoft
                  : 'transparent',
                transform: [{ scale: pressed ? 0.94 : 1 }],
              },
              Platform.OS === 'web' ? { transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' } as any : {},
            ])}
          >
            <Text style={{
              fontSize: fontSize,
              color: framing === 'full'
                ? theme.colors.primary
                : theme.colors.textSecondary,
              fontWeight: framing === 'full' ? '600' : '500',
              letterSpacing: 0.3,
            }}>全身</Text>
          </Pressable>
        </View>

        {/* 重置视角 */}
        <Pressable
          onPress={handleResetCamera}
          style={({ pressed }) => {
            const s: any[] = [
              {
                width: resetBtnSize,
                height: resetBtnSize,
                borderRadius: theme.radius.md,
                alignItems: 'center' as const,
                justifyContent: 'center' as const,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                transform: [{ scale: pressed ? 0.90 : 1 }, { rotate: pressed ? '-30deg' : '0deg' }],
              },
            ];
            if (Platform.OS === 'web') {
              s.push({
                transition: 'all 0.18s ease',
                boxShadow: `0px 2px 8px rgba(0,0,0,${theme.dark ? 0.24 : 0.08})`,
              });
            } else {
              s.push({
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: theme.dark ? 0.24 : 0.08,
                shadowRadius: 8,
                elevation: 3,
              });
            }
            return s;
          }}
          accessibilityLabel="重置视角"
        >
          <Text style={{ fontSize: isNarrow ? (isCompactPhone ? 15 : 16) : 18, color: theme.colors.textSecondary, marginTop: -1, fontWeight: '400' }}>↻</Text>
        </Pressable>
      </View>

      {/* 操作提示：左下角轻量提示，优雅淡入淡出 */}
      <View
        style={(() => {
          const s: any[] = [
            {
              position: 'absolute' as const,
              left: hintLeft,
              bottom: hintBottom,
              zIndex: 10,
              opacity: hintVisible ? 0.55 : 0,
              transform: [{ translateY: hintVisible ? 0 : 4 }],
              pointerEvents: 'none',
            },
          ];
          if (Platform.OS === 'web') {
            s.push({ transition: 'opacity 0.8s ease, transform 0.8s ease' });
          }
          return s;
        })()}
      >
        <Text style={(() => {
          const s: any[] = [
            {
              fontSize: isNarrow ? 10 : 11,
              color: theme.colors.textTertiary,
              letterSpacing: 0.3,
            },
          ];
          if (Platform.OS === 'web') {
            s.push({
              textShadow: `0px 1px 2px ${theme.dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)'}`,
            });
          } else {
            s.push({
              textShadowColor: theme.dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 2,
            });
          }
          return s;
        })()}>
          {Platform.OS === 'web' ? '拖拽旋转 · 滚轮缩放 · 双击复位' : '单指旋转 · 双指缩放平移'}
        </Text>
      </View>
      </View>
    </AvatarCanvasErrorBoundary>
  );
}
