import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AvatarIdentity, AvatarRenderState } from '../types/avatar';
import { ProceduralAvatar } from './ProceduralAvatar';
import { SCENE_COLORS, SCENE_FLOOR_COLORS, SCENE_GLOW_COLORS, STYLE_LIGHT_CONFIG, describeRenderState } from './avatarGeometry';
import { useAppTheme } from '../../theme/theme';

interface AvatarCanvasProps {
  identity: AvatarIdentity;
  render: AvatarRenderState;
  paused?: boolean;
}

type DegradedReason = 'webgl' | 'error';

function isWebGLAvailable(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    return !!gl;
  } catch {
    return false;
  }
}

function RimLight({ color, intensity, position }: { color: string; intensity: number; position: [number, number, number] }) {
  return <pointLight position={position} intensity={intensity} color={color} distance={4.5} decay={2} />;
}

function ContactShadow({ floorColor, config }: { floorColor: string; config: { innerRadius: number; outerRadius: number; innerOpacity: number; outerOpacity: number; floorY: number } }) {
  return (
    <group position={[0, config.floorY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
        <circleGeometry args={[config.outerRadius * 1.2, 64]} />
        <meshStandardMaterial color={floorColor} roughness={0.98} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[config.innerRadius * 0.6, config.outerRadius * 0.85, 64]} />
        <meshBasicMaterial color="#000000" transparent opacity={config.outerOpacity * 0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]}>
        <ringGeometry args={[config.innerRadius * 0.35, config.outerRadius * 0.55, 56]} />
        <meshBasicMaterial color="#000000" transparent opacity={config.outerOpacity} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[config.innerRadius * 0.82, 48]} />
        <meshBasicMaterial color="#000000" transparent opacity={config.innerOpacity * 0.85} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0005, 0]}>
        <circleGeometry args={[config.innerRadius * 0.45, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={config.innerOpacity} />
      </mesh>
    </group>
  );
}

function ShadowCatcher({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, []);
  return <group ref={groupRef}>{children}</group>;
}

function FloatingParticles({ config, glowColor }: { config: { count: number; size: number; color: string; opacity: number; useGlowColor: boolean }; glowColor: string }) {
  const particlesRef = useRef<THREE.Points>(null);
  const count = config.count;

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 1] = Math.random() * 3 - 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 3 - 1;
    }
    return pos;
  }, [count]);

  useFrame(({ clock }) => {
    if (particlesRef.current) {
      const t = clock.getElapsedTime();
      const posArr = particlesRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < count; i++) {
        posArr[i * 3 + 1] += 0.002 + Math.sin(t + i) * 0.0005;
        posArr[i * 3] += Math.sin(t * 0.5 + i * 0.3) * 0.001;
        if (posArr[i * 3 + 1] > 2.5) posArr[i * 3 + 1] = -0.8;
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  const particleColor = config.useGlowColor ? glowColor : config.color;

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
      </bufferGeometry>
      <pointsMaterial size={config.size} color={particleColor} transparent opacity={config.opacity} sizeAttenuation />
    </points>
  );
}

function Avatar2DFallback({ identity, render, reason }: { identity: AvatarIdentity; render: AvatarRenderState; reason: DegradedReason }) {
  const theme = useAppTheme();
  const avatarStyle = theme.avatarStyle;
  const isKawaii = avatarStyle === 'kawaii';
  const sceneColor = SCENE_COLORS[render.scene];
  const headSize = isKawaii ? 76 : 64;
  const bodyW = isKawaii ? 58 : 88;
  const bodyH = isKawaii ? 46 : 72;
  const eyeS = isKawaii ? 8 : 6;
  const message = reason === 'webgl' ? '当前环境不支持 WebGL' : '3D 镜像加载失败';
  return (
    <View style={{ flex: 1, backgroundColor: sceneColor, alignItems: 'center', justifyContent: 'center', padding: 20 }} accessibilityLabel={describeRenderState(render)} accessibilityRole="image">
      <View style={{ alignItems: 'center' }}>
        <View style={{ position: 'relative', marginBottom: -6, zIndex: 2 }}>
          <View style={{ position: 'absolute', width: headSize * 1.06, height: headSize * 0.7, borderRadius: headSize * 0.53, backgroundColor: identity.hairColor, top: -headSize * 0.07, left: -headSize * 0.03 }} />
          <View style={{ width: headSize, height: headSize, borderRadius: headSize / 2, backgroundColor: identity.skinTone, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', position: 'absolute', top: headSize * 0.38 }}>
              <View style={{ width: eyeS, height: eyeS * (isKawaii ? 1.2 : 1), borderRadius: eyeS / 2, backgroundColor: '#2A2030', marginRight: headSize * (isKawaii ? 0.32 : 0.28) }} />
              <View style={{ width: eyeS, height: eyeS * (isKawaii ? 1.2 : 1), borderRadius: eyeS / 2, backgroundColor: '#2A2030' }} />
            </View>
            {isKawaii && (
              <>
                <View style={{ position: 'absolute', width: 10, height: 6, borderRadius: 5, backgroundColor: '#FF99AA', opacity: 0.5, left: headSize * 0.1, top: headSize * 0.55 }} />
                <View style={{ position: 'absolute', width: 10, height: 6, borderRadius: 5, backgroundColor: '#FF99AA', opacity: 0.5, right: headSize * 0.1, top: headSize * 0.55 }} />
              </>
            )}
          </View>
        </View>
        <View style={{ width: bodyW, height: bodyH, borderTopLeftRadius: bodyW * 0.4, borderTopRightRadius: bodyW * 0.4, borderBottomLeftRadius: bodyW * 0.25, borderBottomRightRadius: bodyW * 0.25, backgroundColor: identity.shirtColor, alignItems: 'center', paddingTop: bodyH * 0.12 }}>
          {isKawaii && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }} />}
        </View>
      </View>
      <Text style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 14, opacity: 0.7 }}>{message}</Text>
    </View>
  );
}

class AvatarErrorBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { hasError: boolean }> {
  state: { hasError: boolean } = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } { return { hasError: true }; }
  componentDidCatch(error: Error): void { console.warn('AvatarErrorBoundary caught:', error); }
  render(): React.ReactNode { return this.state.hasError ? this.props.fallback : this.props.children; }
}

export function AvatarCanvas({ identity, render, paused = false }: AvatarCanvasProps) {
  const theme = useAppTheme();
  const [mounted, setMounted] = useState(false);
  const [degraded, setDegraded] = useState<DegradedReason | null>(null);

  useEffect(() => {
    setMounted(true);
    if (!isWebGLAvailable()) setDegraded('webgl');
  }, []);

  const sceneKey = theme.avatarScene;
  const avatarStyle = theme.avatarStyle;
  const sceneColor = SCENE_COLORS[sceneKey];
  const floorColor = SCENE_FLOOR_COLORS[sceneKey];
  const glowColor = SCENE_GLOW_COLORS[sceneKey];
  const styleCfg = STYLE_LIGHT_CONFIG[avatarStyle];

  if (!mounted) return <View style={{ flex: 1, backgroundColor: sceneColor }} />;
  if (degraded !== null) return <Avatar2DFallback identity={identity} render={render} reason={degraded} />;

  const frameloop: 'always' | 'never' = paused ? 'never' : 'always';
  const sceneBrightness = render.sceneBrightness ?? 1.0;

  return (
    <View style={{ flex: 1, backgroundColor: sceneColor }} accessibilityLabel={describeRenderState(render)} accessibilityRole="image">
      <AvatarErrorBoundary fallback={<Avatar2DFallback identity={identity} render={render} reason="error" />}>
        <Canvas
          style={{ width: '100%', height: '100%' }}
          camera={{ position: [0, styleCfg.camera.posY, styleCfg.camera.posZ], fov: styleCfg.camera.fov, near: 0.1, far: 50 }}
          frameloop={frameloop}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true,
          }}
          dpr={[1, Math.min(window.devicePixelRatio, 2)]}
          shadows={{ type: THREE.PCFShadowMap }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.08;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.shadowMap.enabled = true;
            gl.shadowMap.type = THREE.PCFShadowMap;
          }}
        >
          <color attach="background" args={[sceneColor]} />
          <fog attach="fog" args={[sceneColor, 6, 12]} />
          <ambientLight intensity={styleCfg.lights.ambient * sceneBrightness} color={styleCfg.lights.ambientColor} />
          <directionalLight
            position={[2.5, 4.0, 3.0]}
            intensity={styleCfg.lights.key}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={0.5}
            shadow-camera-far={15}
            shadow-camera-left={-2.5}
            shadow-camera-right={2.5}
            shadow-camera-top={2.5}
            shadow-camera-bottom={-2.5}
            shadow-bias={-0.0003}
            shadow-normalBias={0.025}
            color={styleCfg.lights.keyColor}
          />
          <directionalLight
            position={[-1.8, 2.2, 1.2]}
            intensity={styleCfg.lights.fill}
            color={styleCfg.lights.fillColor}
          />
          <RimLight color={glowColor} intensity={styleCfg.lights.rim1} position={[0, 1.8, -2.2]} />
          <RimLight color={styleCfg.lights.rim2Color} intensity={styleCfg.lights.rim2} position={[-1.6, 1.2, -1.2]} />
          <RimLight color={styleCfg.lights.rim3Color} intensity={styleCfg.lights.rim3} position={[1.6, 0.8, -1.5]} />
          <pointLight
            position={[0, 1.4, 2.0]}
            intensity={styleCfg.lights.warm}
            color={styleCfg.lights.warmColor}
            distance={5}
            decay={2}
          />
          {styleCfg.lights.extraLights.map((light, i) => (
            <pointLight
              key={i}
              position={light.pos}
              intensity={light.intensity}
              color={light.color}
              distance={light.distance}
              decay={2}
            />
          ))}
          <ProceduralAvatar identity={identity} render={render} />
          <ContactShadow floorColor={floorColor} config={styleCfg.shadow} />
          {styleCfg.particles.count > 0 && <FloatingParticles config={styleCfg.particles} glowColor={glowColor} />}
        </Canvas>
      </AvatarErrorBoundary>
    </View>
  );
}
