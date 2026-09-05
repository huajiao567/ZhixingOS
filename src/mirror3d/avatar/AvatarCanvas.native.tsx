import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
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

function RimLight({ color, intensity, position }: { color: string; intensity: number; position: [number, number, number] }) {
  return (
    <pointLight
      position={position}
      intensity={intensity}
      color={color}
      distance={4.5}
      decay={2}
    />
  );
}

function ContactShadow({ floorColor, config }: { floorColor: string; config: { innerRadius: number; outerRadius: number; innerOpacity: number; outerOpacity: number; floorY: number } }) {
  return (
    <group position={[0, config.floorY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[config.innerRadius, 36]} />
        <meshBasicMaterial color="#000000" transparent opacity={config.innerOpacity} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <circleGeometry args={[config.outerRadius, 48]} />
        <meshStandardMaterial color={floorColor} roughness={0.96} metalness={0} />
      </mesh>
    </group>
  );
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
        if (posArr[i * 3 + 1] > 2.5) {
          posArr[i * 3 + 1] = -0.8;
        }
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  const particleColor = config.useGlowColor ? glowColor : config.color;

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
        />
      </bufferGeometry>
      <pointsMaterial
        size={config.size}
        color={particleColor}
        transparent
        opacity={config.opacity}
        sizeAttenuation
      />
    </points>
  );
}

export function AvatarCanvas({ identity, render, paused = false }: AvatarCanvasProps) {
  const theme = useAppTheme();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const onChange = (next: AppStateStatus) => setAppActive(next === 'active');
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const sceneKey = theme.avatarScene;
  const avatarStyle = theme.avatarStyle;
  const sceneColor = SCENE_COLORS[sceneKey];
  const floorColor = SCENE_FLOOR_COLORS[sceneKey];
  const glowColor = SCENE_GLOW_COLORS[sceneKey];
  const styleCfg = STYLE_LIGHT_CONFIG[avatarStyle];

  const frameloop = paused || !appActive ? 'never' : 'always';

  return (
    <View
      style={{ flex: 1, backgroundColor: sceneColor }}
      accessibilityLabel={
        '这是一个代表你当前状态的 3D 镜像。' + describeRenderState(render) +
        '。如看不到形象，可在「数据主权 · 主动性」里关闭 3D 显示，或切换为「长辈易用」模式以文字摘要替代。'
      }
      accessibilityRole="image"
    >
      <Canvas
        camera={{ position: [0, styleCfg.camera.posY, styleCfg.camera.posZ], fov: styleCfg.camera.fov }}
        frameloop={frameloop}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={[sceneColor]} />

        <ambientLight intensity={styleCfg.lights.ambient * render.sceneBrightness} color={styleCfg.lights.ambientColor} />

        <directionalLight
          position={[2.2, 3.8, 2.8]}
          intensity={styleCfg.lights.key}
          castShadow={false}
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

        <FloatingParticles config={styleCfg.particles} glowColor={glowColor} />
      </Canvas>
    </View>
  );
}
