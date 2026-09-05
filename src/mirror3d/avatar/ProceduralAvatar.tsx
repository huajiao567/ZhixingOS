import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AvatarIdentity, AvatarRenderState } from '../types/avatar';
import {
  computeAvatarMetrics,
  computeOutfitColor,
  type AvatarStyle,
} from './avatarGeometry';
import { useAppTheme } from '../../theme/theme';

interface ProceduralAvatarProps {
  identity: AvatarIdentity;
  render: AvatarRenderState;
}

const STYLE_CONFIG: Record<AvatarStyle, {
  headScale: number;
  headPosY: number;
  bodySizeMul: number;
  eyeY: number;
  eyeX: number;
  eyeZ: number;
  eyeScale: number;
  skinRoughness: number;
  blushColor: string;
  blushOpacity: number;
  blushY: number;
  blushScale: [number, number, number];
  lipColor: string;
  lipShine: number;
  pantsColor: string;
  shoeColor: string;
  bodyY: number;
  armY: number;
  armLengthMul: number;
  armWidthMul: number;
  legScale: number;
  legPosY: number;
  shoeY: number;
  earScale: number;
  bodyWidth: number;
  bodyHeight: number;
  shoulderPosX: number;
  cheekFullness: number;
  neckVisible: boolean;
  neckScale: number;
  collarY: number;
  collarColor: string;
  hairRoughness: number;
  mouthY: number;
  mouthWidthMul: number;
  browY: number;
  blinkSpeed: number;
  breatheScale: number;
  irisColor: string;
  eyeWhiteColor: string;
  hasShine2: boolean;
  hasShine3: boolean;
  rootY: number;
  eyeIrisScale: number;
  lashDarkness: number;
  eyeShadowOpacity: number;
  noseShadowOpacity: number;
  chinShadowOpacity: number;
  lashCount: number;
  lowerLashCount: number;
  geometrySegments: number;
  skinSSS: number;
  clothDetail: boolean;
}> = {
  default: {
    headScale: 1.22,
    headPosY: 1.15,
    bodySizeMul: 0.72,
    eyeY: 0.03,
    eyeX: 0.26,
    eyeZ: 0.68,
    eyeScale: 1.18,
    skinRoughness: 0.68,
    blushColor: '#E89080',
    blushOpacity: 0.48,
    blushY: -0.25,
    blushScale: [0.18, 0.10, 0.03],
    lipColor: '#C07080',
    lipShine: 0.40,
    pantsColor: '#283040',
    shoeColor: '#2A3040',
    bodyY: 0.22,
    armY: 0.35,
    armLengthMul: 0.70,
    armWidthMul: 0.92,
    legScale: 0.26,
    legPosY: -0.26,
    shoeY: -0.58,
    earScale: 0.62,
    bodyWidth: 0.68,
    bodyHeight: 0.34,
    shoulderPosX: 0.36,
    cheekFullness: 1.20,
    neckVisible: true,
    neckScale: 0.48,
    collarY: 0.42,
    collarColor: '#F0F0F5',
    hairRoughness: 0.82,
    mouthY: -0.24,
    mouthWidthMul: 1.12,
    browY: 0.24,
    blinkSpeed: 1.0,
    breatheScale: 0.018,
    irisColor: '#505460',
    eyeWhiteColor: '#FFFEF8',
    hasShine2: true,
    hasShine3: true,
    rootY: -0.58,
    eyeIrisScale: 0.72,
    lashDarkness: 0.68,
    eyeShadowOpacity: 0.12,
    noseShadowOpacity: 0.08,
    chinShadowOpacity: 0.08,
    lashCount: 8,
    lowerLashCount: 4,
    geometrySegments: 48,
    skinSSS: 0.20,
    clothDetail: true,
  },
  cyber: {
    headScale: 1.10,
    headPosY: 1.08,
    bodySizeMul: 0.88,
    eyeY: 0.05,
    eyeX: 0.23,
    eyeZ: 0.63,
    eyeScale: 1.1,
    skinRoughness: 0.45,
    blushColor: '#FF6080',
    blushOpacity: 0.25,
    blushY: -0.22,
    blushScale: [0.13, 0.07, 0.02],
    lipColor: '#E04080',
    lipShine: 0.55,
    pantsColor: '#101028',
    shoeColor: '#181830',
    bodyY: 0.32,
    armY: 0.47,
    armLengthMul: 0.88,
    armWidthMul: 0.98,
    legScale: 0.34,
    legPosY: -0.18,
    shoeY: -0.58,
    earScale: 0.78,
    bodyWidth: 0.74,
    bodyHeight: 0.44,
    shoulderPosX: 0.44,
    cheekFullness: 1.0,
    neckVisible: true,
    neckScale: 0.68,
    collarY: 0.58,
    collarColor: '#00E5FF',
    hairRoughness: 0.38,
    mouthY: -0.20,
    mouthWidthMul: 1.05,
    browY: 0.24,
    blinkSpeed: 0.9,
    breatheScale: 0.012,
    irisColor: '#00E5FF',
    eyeWhiteColor: '#F0FFFF',
    hasShine2: true,
    hasShine3: true,
    rootY: -0.55,
    eyeIrisScale: 0.72,
    lashDarkness: 0.88,
    eyeShadowOpacity: 0.20,
    noseShadowOpacity: 0.10,
    chinShadowOpacity: 0.08,
    lashCount: 8,
    lowerLashCount: 5,
    geometrySegments: 48,
    skinSSS: 0.10,
    clothDetail: true,
  },
  kawaii: {
    headScale: 1.45,
    headPosY: 1.30,
    bodySizeMul: 0.58,
    eyeY: 0.00,
    eyeX: 0.32,
    eyeZ: 0.88,
    eyeScale: 1.45,
    skinRoughness: 0.78,
    blushColor: '#FF7096',
    blushOpacity: 0.75,
    blushY: -0.28,
    blushScale: [0.30, 0.16, 0.05],
    lipColor: '#F088A0',
    lipShine: 0.45,
    pantsColor: '#8A7AA8',
    shoeColor: '#AA9AC8',
    bodyY: 0.12,
    armY: 0.20,
    armLengthMul: 0.52,
    armWidthMul: 1.0,
    legScale: 0.16,
    legPosY: -0.32,
    shoeY: -0.52,
    earScale: 0.48,
    bodyWidth: 0.78,
    bodyHeight: 0.24,
    shoulderPosX: 0.28,
    cheekFullness: 1.38,
    neckVisible: false,
    neckScale: 0.12,
    collarY: 0.30,
    collarColor: '#FFFFFF',
    hairRoughness: 0.85,
    mouthY: -0.28,
    mouthWidthMul: 1.3,
    browY: 0.24,
    blinkSpeed: 1.2,
    breatheScale: 0.020,
    irisColor: '#9B8BDC',
    eyeWhiteColor: '#FFFEFA',
    hasShine2: true,
    hasShine3: true,
    rootY: -0.60,
    eyeIrisScale: 0.78,
    lashDarkness: 0.50,
    eyeShadowOpacity: 0.08,
    noseShadowOpacity: 0.06,
    chinShadowOpacity: 0.06,
    lashCount: 9,
    lowerLashCount: 5,
    geometrySegments: 52,
    skinSSS: 0.25,
    clothDetail: true,
  },
  minimal: {
    headScale: 1.0,
    headPosY: 0.95,
    bodySizeMul: 0.90,
    eyeY: 0.03,
    eyeX: 0.20,
    eyeZ: 0.60,
    eyeScale: 0.85,
    skinRoughness: 0.70,
    blushColor: '#D0A090',
    blushOpacity: 0.15,
    blushY: -0.20,
    blushScale: [0.10, 0.05, 0.02],
    lipColor: '#A06060',
    lipShine: 0.20,
    pantsColor: '#E8E8E8',
    shoeColor: '#D0D0D0',
    bodyY: 0.25,
    armY: 0.38,
    armLengthMul: 0.80,
    armWidthMul: 0.90,
    legScale: 0.35,
    legPosY: -0.25,
    shoeY: -0.62,
    earScale: 0.70,
    bodyWidth: 0.68,
    bodyHeight: 0.44,
    shoulderPosX: 0.40,
    cheekFullness: 1.0,
    neckVisible: true,
    neckScale: 0.60,
    collarY: 0.48,
    collarColor: '#FFFFFF',
    hairRoughness: 0.80,
    mouthY: -0.18,
    mouthWidthMul: 0.90,
    browY: 0.20,
    blinkSpeed: 1.1,
    breatheScale: 0.010,
    irisColor: '#505058',
    eyeWhiteColor: '#FEFEFE',
    hasShine2: false,
    hasShine3: false,
    rootY: -0.55,
    eyeIrisScale: 0.65,
    lashDarkness: 0.45,
    eyeShadowOpacity: 0.08,
    noseShadowOpacity: 0.07,
    chinShadowOpacity: 0.08,
    lashCount: 5,
    lowerLashCount: 3,
    geometrySegments: 36,
    skinSSS: 0.08,
    clothDetail: false,
  },
  elder: {
    headScale: 1.02,
    headPosY: 0.98,
    bodySizeMul: 0.92,
    eyeY: 0.02,
    eyeX: 0.21,
    eyeZ: 0.61,
    eyeScale: 0.9,
    skinRoughness: 0.75,
    blushColor: '#C89080',
    blushOpacity: 0.20,
    blushY: -0.21,
    blushScale: [0.11, 0.055, 0.02],
    lipColor: '#905050',
    lipShine: 0.18,
    pantsColor: '#404858',
    shoeColor: '#384050',
    bodyY: 0.28,
    armY: 0.42,
    armLengthMul: 0.82,
    armWidthMul: 0.92,
    legScale: 0.36,
    legPosY: -0.22,
    shoeY: -0.60,
    earScale: 0.78,
    bodyWidth: 0.74,
    bodyHeight: 0.46,
    shoulderPosX: 0.44,
    cheekFullness: 0.98,
    neckVisible: true,
    neckScale: 0.72,
    collarY: 0.52,
    collarColor: '#F5F5F0',
    hairRoughness: 0.82,
    mouthY: -0.19,
    mouthWidthMul: 0.95,
    browY: 0.21,
    blinkSpeed: 1.3,
    breatheScale: 0.010,
    irisColor: '#504440',
    eyeWhiteColor: '#FFFEF8',
    hasShine2: false,
    hasShine3: false,
    rootY: -0.55,
    eyeIrisScale: 0.62,
    lashDarkness: 0.50,
    eyeShadowOpacity: 0.12,
    noseShadowOpacity: 0.10,
    chinShadowOpacity: 0.10,
    lashCount: 5,
    lowerLashCount: 3,
    geometrySegments: 40,
    skinSSS: 0.10,
    clothDetail: false,
  },
  obsidian: {
    headScale: 1.0,
    headPosY: 1.0,
    bodySizeMul: 0.88,
    eyeY: 0.04,
    eyeX: 0.21,
    eyeZ: 0.61,
    eyeScale: 0.92,
    skinRoughness: 0.55,
    blushColor: '#604050',
    blushOpacity: 0.18,
    blushY: -0.21,
    blushScale: [0.11, 0.055, 0.02],
    lipColor: '#804050',
    lipShine: 0.40,
    pantsColor: '#101018',
    shoeColor: '#181820',
    bodyY: 0.28,
    armY: 0.42,
    armLengthMul: 0.85,
    armWidthMul: 0.95,
    legScale: 0.33,
    legPosY: -0.20,
    shoeY: -0.60,
    earScale: 0.75,
    bodyWidth: 0.72,
    bodyHeight: 0.43,
    shoulderPosX: 0.42,
    cheekFullness: 1.0,
    neckVisible: true,
    neckScale: 0.65,
    collarY: 0.52,
    collarColor: '#202030',
    hairRoughness: 0.60,
    mouthY: -0.20,
    mouthWidthMul: 0.98,
    browY: 0.22,
    blinkSpeed: 1.0,
    breatheScale: 0.012,
    irisColor: '#A0A0D0',
    eyeWhiteColor: '#F0F0F8',
    hasShine2: true,
    hasShine3: true,
    rootY: -0.55,
    eyeIrisScale: 0.66,
    lashDarkness: 0.82,
    eyeShadowOpacity: 0.22,
    noseShadowOpacity: 0.12,
    chinShadowOpacity: 0.10,
    lashCount: 7,
    lowerLashCount: 4,
    geometrySegments: 48,
    skinSSS: 0.08,
    clothDetail: true,
  },
};

function CuteEye({ side, styleCfg, skinTone, eyeOpenRef, gazeRef, saccadeRef, pupilScaleRef }: {
  side: number;
  styleCfg: typeof STYLE_CONFIG[AvatarStyle];
  skinTone: string;
  eyeOpenRef: React.MutableRefObject<number>;
  gazeRef: React.MutableRefObject<{ x: number; y: number }>;
  saccadeRef: React.MutableRefObject<{ x: number; y: number; progress: number }>;
  pupilScaleRef: React.MutableRefObject<number>;
}) {
  const upperLidRef = useRef<THREE.Mesh>(null);
  const lowerLidRef = useRef<THREE.Mesh>(null);
  const irisRef = useRef<THREE.Mesh>(null);
  const pupilRef = useRef<THREE.Mesh>(null);
  const shine1Ref = useRef<THREE.Mesh>(null);
  const shine2Ref = useRef<THREE.Mesh>(null);
  const shine3Ref = useRef<THREE.Mesh>(null);
  const upperLashGroupRef = useRef<THREE.Group>(null);
  const lowerLashGroupRef = useRef<THREE.Group>(null);
  const eyeSocketShadowRef = useRef<THREE.Mesh>(null);
  const lidCreaseRef = useRef<THREE.Mesh>(null);

  const eyeWhiteR = 0.085 * styleCfg.eyeScale;
  const irisR = eyeWhiteR * styleCfg.eyeIrisScale;
  const pupilR = irisR * 0.50;
  const lashColor = new THREE.Color(skinTone).multiplyScalar(1.0 - styleCfg.lashDarkness * 0.75);
  const seg = styleCfg.geometrySegments;

  useFrame(() => {
    const open = eyeOpenRef.current;
    const gaze = gazeRef.current;
    const saccade = saccadeRef.current;
    const pupilScale = pupilScaleRef.current;

    let gx = gaze.x;
    let gy = gaze.y;

    if (saccade.progress > 0) {
      const t = saccade.progress;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      gx = THREE.MathUtils.lerp(gaze.x, saccade.x, ease);
      gy = THREE.MathUtils.lerp(gaze.y, saccade.y, ease);
      saccade.progress -= 0.10;
    }

    const lidOpen = Math.max(0.01, open);
    const lidSquint = 1 - open;

    if (upperLidRef.current) {
      upperLidRef.current.scale.y = Math.max(0.008, 1.0 - open * 0.98);
      upperLidRef.current.position.y = eyeWhiteR * (0.85 - open * 0.7);
    }
    if (lowerLidRef.current) {
      lowerLidRef.current.scale.y = Math.max(0.008, 0.25 + lidSquint * 0.25);
      lowerLidRef.current.position.y = -eyeWhiteR * (0.18 + lidSquint * 0.12);
    }
    if (lidCreaseRef.current) {
      lidCreaseRef.current.scale.y = 0.04 + lidSquint * 0.08;
      lidCreaseRef.current.position.y = eyeWhiteR * (0.95 - open * 0.15);
      (lidCreaseRef.current.material as THREE.MeshStandardMaterial).opacity = 0.08 + lidSquint * 0.12;
    }
    if (irisRef.current) {
      irisRef.current.position.x = gx * 0.018;
      irisRef.current.position.y = gy * 0.012 - (1 - open) * 0.008;
      irisRef.current.scale.setScalar(0.94 + pupilScale * 0.04);
    }
    if (pupilRef.current) {
      pupilRef.current.position.x = gx * 0.018;
      pupilRef.current.position.y = gy * 0.012 - (1 - open) * 0.008;
      pupilRef.current.scale.setScalar(pupilScale);
    }
    if (shine1Ref.current) {
      shine1Ref.current.position.x = side * -0.018 + gx * 0.008;
      shine1Ref.current.position.y = 0.022 + gy * 0.006;
      shine1Ref.current.scale.setScalar(0.38 + pupilScale * 0.1);
    }
    if (shine2Ref.current && styleCfg.hasShine2) {
      shine2Ref.current.position.x = side * 0.014 + gx * 0.005;
      shine2Ref.current.position.y = -0.008 + gy * 0.004;
    }
    if (shine3Ref.current && styleCfg.hasShine3) {
      shine3Ref.current.position.x = side * -0.008 + gx * 0.004;
      shine3Ref.current.position.y = 0.008 + gy * 0.003;
    }
    if (upperLashGroupRef.current) {
      upperLashGroupRef.current.scale.y = Math.max(0.25, open);
      upperLashGroupRef.current.position.y = eyeWhiteR * (0.82 - lidSquint * 0.08);
    }
    if (lowerLashGroupRef.current) {
      lowerLashGroupRef.current.scale.y = Math.max(0.3, open * 0.8);
      lowerLashGroupRef.current.position.y = -eyeWhiteR * (0.68 - lidSquint * 0.05);
    }
    if (eyeSocketShadowRef.current) {
      (eyeSocketShadowRef.current.material as THREE.MeshStandardMaterial).opacity = styleCfg.eyeShadowOpacity * (0.7 + lidSquint * 0.5);
    }
  });

  const upperLashes = [];
  for (let i = 0; i < styleCfg.lashCount; i++) {
    const t = (i / (styleCfg.lashCount - 1) - 0.5) * 2;
    const xOff = t * eyeWhiteR * 0.88;
    const length = 0.022 + (1 - Math.abs(t)) * 0.018;
    const angle = 0.12 + Math.abs(t) * 0.22;
    upperLashes.push(
      <mesh key={`ul${i}`} position={[xOff, 0, 0]} rotation={[angle, 0, -t * 0.35]} scale={[0.008, length, 0.006]}>
        <capsuleGeometry args={[0.35, 0.55, 4, 6]} />
        <meshStandardMaterial color={lashColor} roughness={0.9} />
      </mesh>
    );
    if (i < styleCfg.lashCount - 1) {
      const t2 = (i + 0.5) / (styleCfg.lashCount - 1) - 0.5;
      const xOff2 = t2 * 2 * eyeWhiteR * 0.82;
      upperLashes.push(
        <mesh key={`uls${i}`} position={[xOff2, -0.003, -0.002]} rotation={[0.18 + Math.abs(t2) * 0.18, 0, -t2 * 0.28]} scale={[0.005, 0.016, 0.004]}>
          <capsuleGeometry args={[0.28, 0.40, 3, 5]} />
          <meshStandardMaterial color={lashColor} roughness={0.92} />
        </mesh>
      );
    }
  }

  const lowerLashes = [];
  for (let i = 0; i < styleCfg.lowerLashCount; i++) {
    const t = (i / (styleCfg.lowerLashCount - 1) - 0.5) * 1.6;
    const xOff = t * eyeWhiteR * 0.75;
    const length = 0.010 + (1 - Math.abs(t)) * 0.006;
    lowerLashes.push(
      <mesh key={`ll${i}`} position={[xOff, 0, 0]} rotation={[-0.30 - Math.abs(t) * 0.15, 0, -t * 0.20]} scale={[0.004, length, 0.003]}>
        <capsuleGeometry args={[0.25, 0.30, 3, 4]} />
        <meshStandardMaterial color={lashColor} roughness={0.92} />
      </mesh>
    );
  }

  return (
    <group position={[side * styleCfg.eyeX, styleCfg.eyeY, styleCfg.eyeZ]}>
      <mesh ref={eyeSocketShadowRef} position={[0, -eyeWhiteR * 0.12, -0.008]} scale={[1.18, 0.75, 0.35]}>
        <sphereGeometry args={[eyeWhiteR, Math.max(24, seg / 2), Math.max(18, seg / 2.5)]} />
        <meshStandardMaterial color={'#000000'} transparent opacity={styleCfg.eyeShadowOpacity} roughness={1} />
      </mesh>

      <mesh position={[0, -eyeWhiteR * 0.08, -0.002]} scale={[1.08, 0.88, 0.30]}>
        <sphereGeometry args={[eyeWhiteR, Math.max(24, seg / 2), Math.max(18, seg / 2.5)]} />
        <meshStandardMaterial color={skinTone} roughness={styleCfg.skinRoughness + 0.03} />
      </mesh>

      <mesh scale={[1.02, 0.92, 0.55]}>
        <sphereGeometry args={[eyeWhiteR, seg, Math.floor(seg * 0.7)]} />
        <meshStandardMaterial color={styleCfg.eyeWhiteColor} roughness={0.06} />
      </mesh>

      <mesh position={[0, -eyeWhiteR * 0.02, 0.035]} scale={[0.92, 0.18, 0.42]}>
        <sphereGeometry args={[eyeWhiteR * 0.98, Math.max(20, seg / 2.2), Math.max(14, seg / 3)]} />
        <meshStandardMaterial color={new THREE.Color(styleCfg.eyeWhiteColor).multiplyScalar(0.94)} roughness={0.12} />
      </mesh>

      <mesh ref={irisRef} position={[0, 0, 0.028]} scale={[0.96, 0.96, 0.42]}>
        <sphereGeometry args={[irisR, Math.max(24, seg / 2), Math.max(18, seg / 2.5)]} />
        <meshStandardMaterial
          color={styleCfg.irisColor}
          roughness={0.18}
          metalness={styleCfg.irisColor === '#00E5FF' ? 0.40 : 0.02}
          emissive={styleCfg.irisColor === '#00E5FF' ? styleCfg.irisColor : '#000000'}
          emissiveIntensity={styleCfg.irisColor === '#00E5FF' ? 0.40 : 0}
        />
      </mesh>

      <mesh position={[0, 0, 0.045]} scale={[irisR * 0.85, irisR * 0.85, 0.08]}>
        <ringGeometry args={[0.5, 1.0, 32]} />
        <meshBasicMaterial color={new THREE.Color(styleCfg.irisColor).multiplyScalar(0.7)} side={THREE.DoubleSide} transparent opacity={0.4} />
      </mesh>

      <mesh ref={pupilRef} position={[0, 0, 0.055]} scale={[0.92, 0.92, 0.28]}>
        <sphereGeometry args={[pupilR, Math.max(18, seg / 2.5), Math.max(14, seg / 3.2)]} />
        <meshBasicMaterial color="#05050C" />
      </mesh>

      <mesh position={[0, 0, 0.068]} scale={[pupilR * 0.30, pupilR * 0.30, 0.03]}>
        <circleGeometry args={[1, 16]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      <mesh ref={shine1Ref} position={[side * -0.018, 0.022, 0.080]} scale={[0.40, 0.44, 0.10]}>
        <sphereGeometry args={[eyeWhiteR, Math.max(12, seg / 3.5), Math.max(10, seg / 4.5)]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>

      {styleCfg.hasShine2 && (
        <mesh ref={shine2Ref} position={[side * 0.014, -0.008, 0.072]} scale={[0.20, 0.20, 0.06]}>
          <sphereGeometry args={[eyeWhiteR, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.65} />
        </mesh>
      )}

      {styleCfg.hasShine3 && (
        <mesh ref={shine3Ref} position={[side * -0.008, 0.008, 0.075]} scale={[0.12, 0.12, 0.04]}>
          <sphereGeometry args={[eyeWhiteR, 8, 6]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.45} />
        </mesh>
      )}

      <mesh ref={upperLidRef} position={[0, eyeWhiteR * 0.15, 0.042]} scale={[1.12, 0.02, 0.60]}>
        <sphereGeometry args={[eyeWhiteR * 1.06, Math.max(20, seg / 2.2), Math.max(16, seg / 2.8)]} />
        <meshStandardMaterial color={skinTone} roughness={styleCfg.skinRoughness + 0.01} />
      </mesh>

      <mesh ref={lowerLidRef} position={[0, -eyeWhiteR * 0.30, 0.032]} scale={[1.08, 0.25, 0.52]}>
        <sphereGeometry args={[eyeWhiteR * 1.02, Math.max(20, seg / 2.2), Math.max(16, seg / 2.8)]} />
        <meshStandardMaterial color={skinTone} roughness={styleCfg.skinRoughness + 0.02} />
      </mesh>

      <mesh ref={lidCreaseRef} position={[0, eyeWhiteR * 0.80, 0.048]} scale={[1.00, 0.04, 0.20]}>
        <capsuleGeometry args={[0.48, 0.50, 8, 10]} />
        <meshStandardMaterial color={'#000000'} transparent opacity={0.08} roughness={1} />
      </mesh>

      <group ref={upperLashGroupRef} position={[0, eyeWhiteR * 0.82, 0.062]}>
        {upperLashes}
      </group>

      <group ref={lowerLashGroupRef} position={[0, -eyeWhiteR * 0.68, 0.052]}>
        {lowerLashes}
      </group>

      <mesh position={[0, eyeWhiteR * 0.88, 0.050]} scale={[1.10, 0.05, 0.25]}>
        <capsuleGeometry args={[0.42, 0.52, 8, 10]} />
        <meshStandardMaterial color={lashColor} roughness={0.88} />
      </mesh>
    </group>
  );
}

function CuteMouth({ styleCfg, smile, mouthOpenRef }: {
  styleCfg: typeof STYLE_CONFIG[AvatarStyle];
  smile: number;
  mouthOpenRef: React.MutableRefObject<number>;
}) {
  const mouthRef = useRef<THREE.Mesh>(null);
  const mouthShadowRef = useRef<THREE.Mesh>(null);
  const upperLipRef = useRef<THREE.Mesh>(null);
  const lowerLipRef = useRef<THREE.Mesh>(null);
  const lipShineRef = useRef<THREE.Mesh>(null);
  const mouthCornerL = useRef<THREE.Mesh>(null);
  const mouthCornerR = useRef<THREE.Mesh>(null);
  const seg = styleCfg.geometrySegments;

  useFrame(() => {
    const open = mouthOpenRef.current;
    if (mouthRef.current) {
      const w = 0.12 * styleCfg.mouthWidthMul * (0.70 + smile * 0.50);
      const h = 0.018 + smile * 0.020 + open * 0.10;
      mouthRef.current.scale.set(w, h, 0.042);
      mouthRef.current.position.y = -smile * 0.010;
    }
    if (upperLipRef.current) {
      const w = 0.10 * styleCfg.mouthWidthMul * (0.65 + smile * 0.42);
      upperLipRef.current.scale.set(w, 0.014, 0.028);
      upperLipRef.current.position.y = 0.010 - smile * 0.006;
    }
    if (lowerLipRef.current) {
      const w = 0.11 * styleCfg.mouthWidthMul * (0.68 + smile * 0.45);
      lowerLipRef.current.scale.set(w, 0.018 + open * 0.010, 0.032);
      lowerLipRef.current.position.y = -0.012 - smile * 0.004 - open * 0.015;
    }
    if (lipShineRef.current) {
      (lipShineRef.current.material as THREE.MeshStandardMaterial).opacity = styleCfg.lipShine * (0.6 + smile * 0.4);
    }
    if (mouthCornerL.current) {
      mouthCornerL.current.position.y = -smile * 0.018;
      mouthCornerL.current.rotation.z = 0.15 + smile * 0.25;
    }
    if (mouthCornerR.current) {
      mouthCornerR.current.position.y = -smile * 0.018;
      mouthCornerR.current.rotation.z = -(0.15 + smile * 0.25);
    }
    if (mouthShadowRef.current) {
      const w = 0.15 * styleCfg.mouthWidthMul * (0.72 + smile * 0.48);
      mouthShadowRef.current.scale.set(w, 0.040 + open * 0.02, 0.025);
      mouthShadowRef.current.position.y = -smile * 0.008 - 0.018 - open * 0.02;
      (mouthShadowRef.current.material as THREE.MeshStandardMaterial).opacity = 0.10 + open * 0.12;
    }
  });

  return (
    <group position={[0, styleCfg.mouthY, styleCfg.eyeZ * 0.92]}>
      <mesh ref={mouthShadowRef} position={[0, -0.018, -0.010]} scale={[0.14, 0.04, 0.025]}>
        <sphereGeometry args={[1, Math.max(14, seg / 3), Math.max(10, seg / 4.5)]} />
        <meshStandardMaterial color="#000000" transparent opacity={0.10} roughness={1} />
      </mesh>

      <mesh ref={upperLipRef} position={[0, 0.010, 0.014]} scale={[0.10 * styleCfg.mouthWidthMul, 0.014, 0.028]}>
        <capsuleGeometry args={[0.52, 0.38, 8, 10]} />
        <meshStandardMaterial color={styleCfg.lipColor} roughness={0.48} />
      </mesh>

      <mesh ref={lowerLipRef} position={[0, -0.012, 0.010]} scale={[0.11 * styleCfg.mouthWidthMul, 0.018, 0.032]}>
        <capsuleGeometry args={[0.48, 0.42, 8, 10]} />
        <meshStandardMaterial color={new THREE.Color(styleCfg.lipColor).multiplyScalar(0.92)} roughness={0.52} />
      </mesh>

      <mesh ref={lipShineRef} position={[0, -0.008, 0.028]} scale={[0.035, 0.008, 0.012]} rotation={[-0.3, 0, 0]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#FFFFFF" transparent opacity={styleCfg.lipShine * 0.5} roughness={0.2} />
      </mesh>

      <mesh ref={mouthRef} position={[0, -0.002, 0.008]} scale={[0.12 * styleCfg.mouthWidthMul, 0.022, 0.038]}>
        <capsuleGeometry args={[0.38, 0.48, 8, 10]} />
        <meshStandardMaterial color={'#5A2030'} roughness={0.75} />
      </mesh>

      <mesh ref={mouthCornerL} position={[-0.06 * styleCfg.mouthWidthMul, 0, 0.012]} rotation={[0, 0, 0.15]} scale={[0.015, 0.010, 0.010]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={new THREE.Color(styleCfg.lipColor).multiplyScalar(0.85)} roughness={0.55} />
      </mesh>
      <mesh ref={mouthCornerR} position={[0.06 * styleCfg.mouthWidthMul, 0, 0.012]} rotation={[0, 0, -0.15]} scale={[0.015, 0.010, 0.010]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={new THREE.Color(styleCfg.lipColor).multiplyScalar(0.85)} roughness={0.55} />
      </mesh>

      {smile > 0.45 && (
        <mesh position={[0, -0.010, 0.024]} scale={[0.045 * (smile - 0.25) * 2.2, 0.020 * (smile - 0.25) * 2.2, 0.018]}>
          <sphereGeometry args={[1, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
          <meshStandardMaterial color="#F8F0F0" roughness={0.45} />
        </mesh>
      )}

      {smile > 0.6 && (
        <>
          <mesh position={[-0.022, -0.012, 0.020]} scale={[0.012, 0.008, 0.008]}>
            <sphereGeometry args={[1, 6, 4]} />
            <meshStandardMaterial color="#FFFFFF" roughness={0.5} />
          </mesh>
          <mesh position={[0.022, -0.012, 0.020]} scale={[0.012, 0.008, 0.008]}>
            <sphereGeometry args={[1, 6, 4]} />
            <meshStandardMaterial color="#FFFFFF" roughness={0.5} />
          </mesh>
        </>
      )}
    </group>
  );
}

function CuteBrow({ side, styleCfg, browLiftRef }: {
  side: number;
  styleCfg: typeof STYLE_CONFIG[AvatarStyle];
  browLiftRef: React.MutableRefObject<number>;
}) {
  const browRef = useRef<THREE.Group>(null);
  const innerBrowRef = useRef<THREE.Mesh>(null);
  const outerBrowRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (browRef.current) {
      browRef.current.position.y = styleCfg.browY + browLiftRef.current * 0.032;
      browRef.current.rotation.z = side * (-0.05 + browLiftRef.current * 0.10);
    }
    if (innerBrowRef.current) {
      innerBrowRef.current.position.y = browLiftRef.current * 0.015;
    }
    if (outerBrowRef.current) {
      outerBrowRef.current.position.y = browLiftRef.current * 0.028;
      outerBrowRef.current.rotation.z = side * (-0.08 + browLiftRef.current * 0.15);
    }
  });

  const browColor = '#2A1F1E';
  const isKawaii = styleCfg.headScale > 1.3;

  return (
    <group ref={browRef} position={[side * styleCfg.eyeX * 1.14, styleCfg.browY, styleCfg.eyeZ * 0.88]}>
      <mesh ref={innerBrowRef} scale={[isKawaii ? 0.10 : 0.12, 0.024, 0.030]} rotation={[0, 0, side * 0.02]}>
        <capsuleGeometry args={[0.50, 0.45, 6, 8]} />
        <meshStandardMaterial color={browColor} roughness={0.90} />
      </mesh>
      <mesh ref={outerBrowRef} position={[side * (isKawaii ? -0.08 : -0.09), -0.003, 0.006]} scale={[isKawaii ? 0.08 : 0.10, 0.018, 0.022]} rotation={[0, 0, side * (isKawaii ? 0.14 : 0.12)]}>
        <capsuleGeometry args={[0.42, 0.38, 5, 7]} />
        <meshStandardMaterial color={browColor} roughness={0.90} />
      </mesh>
      {isKawaii && (
        <mesh position={[side * -0.14, -0.006, 0.004]} scale={[0.045, 0.010, 0.012]} rotation={[0, 0, side * 0.22]}>
          <capsuleGeometry args={[0.30, 0.30, 4, 5]} />
          <meshStandardMaterial color={browColor} roughness={0.92} />
        </mesh>
      )}
    </group>
  );
}

function CuteHair({ identity, styleCfg }: { identity: AvatarIdentity; styleCfg: typeof STYLE_CONFIG[AvatarStyle] }) {
  const isKawaii = styleCfg.headScale > 1.3;
  const hairColor = identity.hairColor;
  const highlightColor = hairColor === '#14161B' ? '#404250' :
    hairColor === '#3B2A23' ? '#6A4A3E' :
    hairColor === '#6C4932' ? '#9C7858' :
    hairColor === '#8B735A' ? '#BBA388' :
    hairColor === '#FFB347' ? '#FFD080' :
    hairColor === '#00E5FF' ? '#80F5FF' : '#FFFFFF';
  const shadowColor = new THREE.Color(hairColor).multiplyScalar(0.72);
  const rootShadow = new THREE.Color(hairColor).multiplyScalar(0.60);
  const seg = styleCfg.geometrySegments;

  const bangStrands = [];
  for (let i = 0; i < (isKawaii ? 7 : 5); i++) {
    const t = (i / ((isKawaii ? 7 : 5) - 1) - 0.5) * 2;
    const xOff = t * styleCfg.cheekFullness * (isKawaii ? 0.58 : 0.52);
    const length = (isKawaii ? 0.30 : 0.22) + (1 - Math.abs(t)) * (isKawaii ? 0.08 : 0.06);
    const rotX = 0.15 + Math.abs(t) * 0.10;
    bangStrands.push(
      <group key={`bang${i}`} position={[xOff, -0.005 - (i === Math.floor((isKawaii ? 7 : 5) / 2) ? 0.015 : 0.035), 0.50]} rotation={[rotX, 0, -t * 0.28]}>
        <mesh scale={[isKawaii ? 0.075 : 0.065, length, isKawaii ? 0.070 : 0.058]}>
          <capsuleGeometry args={[0.42, 0.65, 6, 8]} />
          <meshStandardMaterial color={i % 2 === 0 ? hairColor : shadowColor} roughness={styleCfg.hairRoughness} metalness={hairColor === '#00E5FF' ? 0.25 : 0} emissive={hairColor === '#00E5FF' ? hairColor : '#000000'} emissiveIntensity={hairColor === '#00E5FF' ? 0.15 : 0} />
        </mesh>
        {isKawaii && (
          <mesh position={[t * 0.01, -length * 0.15, 0.015]} scale={[0.025, length * 0.25, 0.020]}>
            <capsuleGeometry args={[0.25, 0.35, 3, 4]} />
            <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.12} transparent opacity={0.28} />
          </mesh>
        )}
      </group>
    );
  }

  return (
    <group position={[0, 0.08, -0.08]}>
      <mesh scale={[styleCfg.cheekFullness * 1.06, 1.06, 1.15]} position={[0, 0.01, -0.06]}>
        <sphereGeometry args={[0.75, seg, Math.floor(seg * 0.8), 0, Math.PI * 2, 0, Math.PI * 0.88]} />
        <meshStandardMaterial color={rootShadow} roughness={styleCfg.hairRoughness + 0.08} metalness={hairColor === '#00E5FF' ? 0.15 : 0} />
      </mesh>

      <mesh scale={[styleCfg.cheekFullness * 1.03, 1.03, 1.10]} position={[0, 0.0, -0.03]}>
        <sphereGeometry args={[0.72, seg, Math.floor(seg * 0.75), 0, Math.PI * 2, 0, Math.PI * 0.85]} />
        <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} metalness={hairColor === '#00E5FF' ? 0.30 : hairColor === '#14161B' ? 0.10 : 0} emissive={hairColor === '#00E5FF' ? hairColor : '#000000'} emissiveIntensity={hairColor === '#00E5FF' ? 0.22 : 0} />
      </mesh>

      <mesh position={[0, 0.28, 0.12]} scale={[0.62, 0.28, 0.40]}>
        <sphereGeometry args={[0.54, Math.max(20, seg / 2.2), Math.max(16, seg / 2.8)]} />
        <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness + 0.04} />
      </mesh>

      <mesh position={[0, 0.30, 0.22]} scale={[0.38, 0.16, 0.18]}>
        <sphereGeometry args={[0.40, Math.max(14, seg / 3.2), Math.max(12, seg / 3.8)]} />
        <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.12} transparent opacity={isKawaii ? 0.30 : 0.20} />
      </mesh>

      <mesh position={[0, 0.22, 0.28]} scale={[0.20, 0.08, 0.10]} rotation={[0.4, 0, 0]}>
        <sphereGeometry args={[0.30, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
        <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.15} transparent opacity={0.18} />
      </mesh>

      {bangStrands}

      {identity.hairStyle === 'twin' && (
        <>
          <group position={[-styleCfg.cheekFullness * 0.64, -0.08, 0.08]} rotation={[0.42, 0.40, 0.60]}>
            <mesh scale={[0.16, isKawaii ? 0.58 : 0.44, 0.14]}>
              <capsuleGeometry args={[0.48, isKawaii ? 1.2 : 1.0, 8, 10]} />
              <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
            </mesh>
            <mesh position={[0, -0.10, 0.05]} scale={[0.08, 0.22, 0.07]}>
              <sphereGeometry args={[0.85, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
              <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
            </mesh>
            {isKawaii && (
              <mesh position={[0.03, -0.05, 0.06]} scale={[0.05, 0.30, 0.04]} rotation={[0, 0, 0.15]}>
                <capsuleGeometry args={[0.25, 0.50, 4, 5]} />
                <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.10} transparent opacity={0.25} />
              </mesh>
            )}
          </group>
          <group position={[styleCfg.cheekFullness * 0.64, -0.08, 0.08]} rotation={[0.42, -0.40, -0.60]}>
            <mesh scale={[0.16, isKawaii ? 0.58 : 0.44, 0.14]}>
              <capsuleGeometry args={[0.48, isKawaii ? 1.2 : 1.0, 8, 10]} />
              <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
            </mesh>
            <mesh position={[0, -0.10, 0.05]} scale={[0.08, 0.22, 0.07]}>
              <sphereGeometry args={[0.85, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
              <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
            </mesh>
            {isKawaii && (
              <mesh position={[-0.03, -0.05, 0.06]} scale={[0.05, 0.30, 0.04]} rotation={[0, 0, -0.15]}>
                <capsuleGeometry args={[0.25, 0.50, 4, 5]} />
                <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.10} transparent opacity={0.25} />
              </mesh>
            )}
          </group>
        </>
      )}

      {identity.hairStyle === 'tails' && (
        <>
          <mesh position={[-styleCfg.cheekFullness * 0.54, -0.30, -0.01]} rotation={[0.28, 0.28, 0.38]} scale={[0.13, isKawaii ? 0.50 : 0.38, 0.11]}>
            <capsuleGeometry args={[0.42, 1.0, 6, 8]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[styleCfg.cheekFullness * 0.54, -0.30, -0.01]} rotation={[0.28, -0.28, -0.38]} scale={[0.13, isKawaii ? 0.50 : 0.38, 0.11]}>
            <capsuleGeometry args={[0.42, 1.0, 6, 8]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
        </>
      )}

      {identity.hairStyle === 'ponytail' && (
        <group position={[0, -0.04, -0.46]} rotation={[0.28, 0, 0]}>
          <mesh scale={[0.17, isKawaii ? 0.60 : 0.50, 0.15]}>
            <capsuleGeometry args={[0.44, isKawaii ? 1.3 : 1.15, 8, 10]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[0, -0.18, 0.03]} scale={[0.09, 0.24, 0.08]}>
            <sphereGeometry args={[0.82, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
        </group>
      )}

      {identity.hairStyle === 'bun' && (
        <>
          <mesh position={[0, 0.52, -0.22]} scale={[0.32, 0.30, 0.30]}>
            <sphereGeometry args={[0.70, Math.max(20, seg / 2.2), Math.max(16, seg / 2.8)]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[0, 0.50, -0.24]} scale={[0.22, 0.14, 0.14]} rotation={[0.28, 0, 0]}>
            <torusGeometry args={[0.62, 0.20, 10, 18]} />
            <meshStandardMaterial color={shadowColor} roughness={styleCfg.hairRoughness + 0.05} />
          </mesh>
          <mesh position={[0, 0.55, -0.18]} scale={[0.15, 0.08, 0.08]}>
            <sphereGeometry args={[0.40, 10, 8]} />
            <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.10} transparent opacity={0.20} />
          </mesh>
        </>
      )}

      {identity.hairStyle === 'long' && (
        <>
          <mesh position={[-styleCfg.cheekFullness * 0.52, -0.28, -0.04]} rotation={[0.22, 0.22, 0.28]} scale={[0.11, 0.48, 0.10]}>
            <capsuleGeometry args={[0.40, 1.05, 6, 8]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[styleCfg.cheekFullness * 0.52, -0.28, -0.04]} rotation={[0.22, -0.22, -0.28]} scale={[0.11, 0.48, 0.10]}>
            <capsuleGeometry args={[0.40, 1.05, 6, 8]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[0, -0.32, -0.22]} rotation={[0.18, 0, 0]} scale={[0.44, 0.32, 0.12]}>
            <sphereGeometry args={[0.52, Math.max(16, seg / 2.8), Math.max(12, seg / 3.8)]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
        </>
      )}

      {identity.hairStyle === 'round' && (
        <>
          <mesh position={[0, -0.12, -0.10]} scale={[styleCfg.cheekFullness * 1.12, 0.95, 1.08]}>
            <sphereGeometry args={[0.78, seg, Math.floor(seg * 0.75)]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} metalness={hairColor === '#00E5FF' ? 0.25 : 0} emissive={hairColor === '#00E5FF' ? hairColor : '#000000'} emissiveIntensity={hairColor === '#00E5FF' ? 0.18 : 0} />
          </mesh>
          <mesh position={[-styleCfg.cheekFullness * 0.58, -0.10, 0.02]} rotation={[0.15, 0.20, 0.30]} scale={[0.15, 0.42, 0.13]}>
            <capsuleGeometry args={[0.48, 0.75, 6, 8]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[styleCfg.cheekFullness * 0.58, -0.10, 0.02]} rotation={[0.15, -0.20, -0.30]} scale={[0.15, 0.42, 0.13]}>
            <capsuleGeometry args={[0.48, 0.75, 6, 8]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[0, -0.38, -0.08]} scale={[styleCfg.cheekFullness * 0.78, 0.28, 0.20]}>
            <sphereGeometry args={[0.58, Math.max(14, seg / 3.2), Math.max(10, seg / 4.5)]} />
            <meshStandardMaterial color={shadowColor} roughness={styleCfg.hairRoughness + 0.05} />
          </mesh>
          {isKawaii && (
            <>
              <mesh position={[-0.12, -0.05, 0.25]} scale={[0.06, 0.18, 0.05]} rotation={[0.10, 0, 0.18]}>
                <capsuleGeometry args={[0.25, 0.45, 3, 5]} />
                <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.12} transparent opacity={0.25} />
              </mesh>
              <mesh position={[0.12, -0.05, 0.25]} scale={[0.06, 0.18, 0.05]} rotation={[0.10, 0, -0.18]}>
                <capsuleGeometry args={[0.25, 0.45, 3, 5]} />
                <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.12} transparent opacity={0.25} />
              </mesh>
            </>
          )}
        </>
      )}

      {identity.hairStyle === 'side' && (
        <>
          <mesh position={[-0.08, 0.06, -0.06]} scale={[styleCfg.cheekFullness * 1.08, 1.04, 1.10]}>
            <sphereGeometry args={[0.74, seg, Math.floor(seg * 0.78), 0, Math.PI * 2, 0, Math.PI * 0.90]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} metalness={hairColor === '#00E5FF' ? 0.28 : hairColor === '#14161B' ? 0.08 : 0} emissive={hairColor === '#00E5FF' ? hairColor : '#000000'} emissiveIntensity={hairColor === '#00E5FF' ? 0.20 : 0} />
          </mesh>
          <mesh position={[-styleCfg.cheekFullness * 0.68, -0.18, 0.06]} rotation={[0.20, 0.25, 0.42]} scale={[0.14, 0.50, 0.12]}>
            <capsuleGeometry args={[0.42, 0.95, 6, 8]} />
            <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
          </mesh>
          <mesh position={[styleCfg.cheekFullness * 0.45, -0.08, 0.02]} rotation={[0.12, -0.12, -0.15]} scale={[0.10, 0.20, 0.09]}>
            <capsuleGeometry args={[0.38, 0.45, 5, 7]} />
            <meshStandardMaterial color={shadowColor} roughness={styleCfg.hairRoughness + 0.04} />
          </mesh>
          {[[-0.25, -0.10], [-0.35, -0.02], [-0.15, -0.15]].map(([xOff, yOff], i) => (
            <mesh key={`sb${i}`} position={[xOff, yOff, 0.22]} rotation={[0.22, 0, 0.35 + i * 0.12]} scale={[0.028, isKawaii ? 0.20 : 0.16, 0.024]}>
              <capsuleGeometry args={[0.28, 0.50, 3, 5]} />
              <meshStandardMaterial color={i % 2 === 0 ? hairColor : highlightColor} roughness={styleCfg.hairRoughness} transparent opacity={i % 2 === 1 ? 0.28 : 1} />
            </mesh>
          ))}
          <mesh position={[0.18, 0.22, 0.16]} scale={[0.18, 0.10, 0.10]} rotation={[0.15, 0, -0.35]}>
            <sphereGeometry args={[0.50, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
            <meshStandardMaterial color={highlightColor} roughness={styleCfg.hairRoughness + 0.10} transparent opacity={0.22} />
          </mesh>
        </>
      )}

      <mesh position={[0.06, 0.36, 0.08]} rotation={[0.20, 0, 0.20]} scale={[0.07, isKawaii ? 0.22 : 0.18, 0.06]}>
        <capsuleGeometry args={[0.40, isKawaii ? 0.60 : 0.50, 4, 6]} />
        <meshStandardMaterial color={hairColor} roughness={styleCfg.hairRoughness} />
      </mesh>

      {[[-0.18, 0.32], [0.18, 0.32], [-0.08, 0.38], [0.12, 0.36]].map(([xOff, yOff], i) => (
        <mesh key={`ah${i}`} position={[xOff, yOff, 0.14 - i * 0.01]} rotation={[0.22 + i * 0.03, 0, -xOff * 0.7]} scale={[isKawaii ? 0.040 : 0.032, isKawaii ? 0.14 : 0.11, isKawaii ? 0.032 : 0.026]}>
          <capsuleGeometry args={[0.32, 0.42, 3, 5]} />
          <meshStandardMaterial color={i % 2 === 0 ? hairColor : highlightColor} roughness={styleCfg.hairRoughness} transparent opacity={i % 2 === 1 ? 0.35 : 1} />
        </mesh>
      ))}
    </group>
  );
}

function CuteBlush({ side, styleCfg }: { side: number; styleCfg: typeof STYLE_CONFIG[AvatarStyle] }) {
  if (styleCfg.blushOpacity < 0.12) return null;
  const seg = styleCfg.geometrySegments;

  return (
    <group position={[side * (0.35 + styleCfg.eyeScale * 0.06), styleCfg.blushY, styleCfg.eyeZ * 0.78]}>
      <mesh scale={styleCfg.blushScale}>
        <sphereGeometry args={[1, Math.max(16, seg / 2.8), Math.max(12, seg / 3.8)]} />
        <meshStandardMaterial color={styleCfg.blushColor} transparent opacity={styleCfg.blushOpacity * 0.7} roughness={1} />
      </mesh>
      <mesh scale={[styleCfg.blushScale[0] * 0.70, styleCfg.blushScale[1] * 0.60, styleCfg.blushScale[2] * 0.50]}>
        <sphereGeometry args={[1, Math.max(12, seg / 3.8), Math.max(10, seg / 4.5)]} />
        <meshStandardMaterial color={styleCfg.blushColor} transparent opacity={styleCfg.blushOpacity} roughness={1} />
      </mesh>
      {styleCfg.blushOpacity > 0.45 && (
        <>
          <mesh position={[side * -0.02, 0.005, 0.008]} scale={[styleCfg.blushScale[0] * 0.50, styleCfg.blushScale[1] * 0.40, 0.018]}>
            <sphereGeometry args={[1, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
            <meshStandardMaterial color={'#FFB8D0'} transparent opacity={styleCfg.blushOpacity * 0.50} roughness={1} />
          </mesh>
          {[-0.04, 0, 0.04].map((xOff, i) => (
            <mesh key={i} position={[xOff * styleCfg.blushScale[0] * 0.6, (i - 1) * 0.01, 0.012]} scale={[0.012, 0.006, 0.004]}>
              <sphereGeometry args={[1, 6, 4]} />
              <meshStandardMaterial color={'#FFFFFF'} transparent opacity={styleCfg.blushOpacity * 0.30} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

function CuteNose({ styleCfg, skinTone }: { styleCfg: typeof STYLE_CONFIG[AvatarStyle]; skinTone: string }) {
  const noseScale = styleCfg.headScale > 1.3 ? 0.12 : 0.20;
  const shadowColor = new THREE.Color(skinTone).multiplyScalar(0.76);
  const noseHighlight = new THREE.Color(skinTone).multiplyScalar(1.05);
  const seg = styleCfg.geometrySegments;

  return (
    <group position={[0, -0.08, styleCfg.eyeZ * 0.92]}>
      <mesh position={[0, 0.025, 0.025]} scale={[0.055 * noseScale, 0.045 * noseScale, 0.045 * noseScale]}>
        <sphereGeometry args={[1, Math.max(12, seg / 3.8), Math.max(10, seg / 4.5)]} />
        <meshStandardMaterial color={noseHighlight} roughness={styleCfg.skinRoughness - 0.02} />
      </mesh>

      <mesh position={[0, -0.035, 0.008]} scale={[0.09 * noseScale, 0.035 * noseScale, 0.025 * noseScale]}>
        <sphereGeometry args={[1, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
        <meshStandardMaterial color={shadowColor} transparent opacity={styleCfg.noseShadowOpacity} roughness={1} />
      </mesh>

      <mesh position={[-0.028 * noseScale, -0.015, 0.028]} scale={[0.020, 0.018, 0.014]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={shadowColor} transparent opacity={styleCfg.noseShadowOpacity * 1.3} roughness={1} />
      </mesh>
      <mesh position={[0.028 * noseScale, -0.015, 0.028]} scale={[0.020, 0.018, 0.014]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={shadowColor} transparent opacity={styleCfg.noseShadowOpacity * 1.3} roughness={1} />
      </mesh>

      <mesh position={[0, -0.005, 0.035]} scale={[0.015 * noseScale, 0.008 * noseScale, 0.008 * noseScale]}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshStandardMaterial color={noseHighlight} transparent opacity={0.20} roughness={0.4} />
      </mesh>
    </group>
  );
}

function CuteEar({ side, styleCfg, skinTone }: { side: number; styleCfg: typeof STYLE_CONFIG[AvatarStyle]; skinTone: string }) {
  const earShadow = new THREE.Color(skinTone).multiplyScalar(0.86);
  const earHighlight = new THREE.Color(skinTone).multiplyScalar(1.03);
  const seg = styleCfg.geometrySegments;

  return (
    <group position={[side * styleCfg.earScale * 0.44, -0.05, 0.05]}>
      <mesh scale={[0.13 * styleCfg.earScale, 0.19 * styleCfg.earScale, 0.11 * styleCfg.earScale]}>
        <sphereGeometry args={[1, Math.max(14, seg / 3.2), Math.max(12, seg / 3.8)]} />
        <meshStandardMaterial color={skinTone} roughness={styleCfg.skinRoughness + 0.01} />
      </mesh>
      <mesh position={[side * -0.012, 0, 0.025]} scale={[0.07 * styleCfg.earScale, 0.11 * styleCfg.earScale, 0.05 * styleCfg.earScale]}>
        <sphereGeometry args={[1, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
        <meshStandardMaterial color={earShadow} roughness={styleCfg.skinRoughness + 0.03} />
      </mesh>
      <mesh position={[side * -0.008, 0.02, 0.040]} scale={[0.03 * styleCfg.earScale, 0.04 * styleCfg.earScale, 0.02 * styleCfg.earScale]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={earHighlight} roughness={styleCfg.skinRoughness - 0.02} />
      </mesh>
    </group>
  );
}

export function ProceduralAvatar({ identity, render }: ProceduralAvatarProps) {
  const theme = useAppTheme();
  const avatarStyle = theme.avatarStyle;
  const styleCfg = STYLE_CONFIG[avatarStyle];

  const rootRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);

  const eyeOpenRef = useRef(render.eyeOpen);
  const blinkPhaseRef = useRef(Math.random() * 10);
  const blinkTimerRef = useRef(2 + Math.random() * 4);
  const isBlinkingRef = useRef(false);
  const blinkProgressRef = useRef(0);
  const gazeRef = useRef({ x: 0, y: 0 });
  const gazeTargetRef = useRef({ x: 0, y: 0 });
  const gazeTimerRef = useRef(1 + Math.random() * 2);
  const saccadeRef = useRef({ x: 0, y: 0, progress: 0 });
  const saccadeTimerRef = useRef(0.8 + Math.random() * 1.5);
  const mouthOpenRef = useRef(0);
  const browLiftRef = useRef((render.smile - 0.5) * 0.5);
  const pupilScaleRef = useRef(1.0);
  const microShiftRef = useRef({ x: 0, y: 0 });

  const { faceX, faceY, shoulderX, bodyScale } = computeAvatarMetrics(identity, avatarStyle);
  const outfitColor = computeOutfitColor(render.outfit, identity, avatarStyle);

  const faceScaleX = faceX * styleCfg.cheekFullness;
  const faceScaleY = faceY;
  const armLength = 0.30 * styleCfg.armLengthMul;
  const armWidth = 0.10 * styleCfg.armWidthMul;

  const rootScale = bodyScale * styleCfg.bodySizeMul;
  const isKawaii = avatarStyle === 'kawaii';
  const skinShadowColor = new THREE.Color(identity.skinTone).multiplyScalar(0.84);
  const chinShadowColor = new THREE.Color(identity.skinTone).multiplyScalar(0.72);
  const cheekShadowColor = new THREE.Color(identity.skinTone).multiplyScalar(0.88);
  const skinHighlightColor = new THREE.Color(identity.skinTone).multiplyScalar(1.04);
  const seg = styleCfg.geometrySegments;

  useFrame((_, delta) => {
    const t = performance.now() / 1000;
    const speedMul = styleCfg.blinkSpeed;

    blinkTimerRef.current -= delta * speedMul;
    if (blinkTimerRef.current <= 0 && !isBlinkingRef.current) {
      isBlinkingRef.current = true;
      blinkProgressRef.current = 0;
      blinkTimerRef.current = 3 + Math.random() * 4;
    }

    if (isBlinkingRef.current) {
      blinkProgressRef.current += delta * 10 * speedMul;
      if (blinkProgressRef.current < 1) {
        eyeOpenRef.current = 1 - blinkProgressRef.current;
        pupilScaleRef.current = 1.0 - blinkProgressRef.current * 0.15;
      } else if (blinkProgressRef.current < 1.20) {
        eyeOpenRef.current = 0;
        pupilScaleRef.current = 0.85;
      } else {
        const openProgress = Math.min(1, blinkProgressRef.current - 1.20) / 0.30;
        eyeOpenRef.current = openProgress;
        pupilScaleRef.current = 0.85 + openProgress * 0.15;
        if (blinkProgressRef.current >= 1.50) {
          isBlinkingRef.current = false;
          eyeOpenRef.current = 1;
          pupilScaleRef.current = 1.0;
        }
      }
    } else {
      const targetOpen = render.eyeOpen * (render.animation === 'tired' ? 0.62 : 1.0);
      eyeOpenRef.current += (targetOpen - eyeOpenRef.current) * Math.min(1, delta * 5);
      pupilScaleRef.current += (1.0 - pupilScaleRef.current) * Math.min(1, delta * 3);
    }

    gazeTimerRef.current -= delta;
    if (gazeTimerRef.current <= 0) {
      gazeTargetRef.current = {
        x: (Math.random() - 0.5) * 1.3,
        y: (Math.random() - 0.5) * 0.8,
      };
      gazeTimerRef.current = 2.0 + Math.random() * 3.5;
    }
    gazeRef.current.x += (gazeTargetRef.current.x - gazeRef.current.x) * Math.min(1, delta * 1.8);
    gazeRef.current.y += (gazeTargetRef.current.y - gazeRef.current.y) * Math.min(1, delta * 1.8);

    saccadeTimerRef.current -= delta;
    if (saccadeTimerRef.current <= 0 && saccadeRef.current.progress <= 0) {
      saccadeRef.current = {
        x: (Math.random() - 0.5) * 2.2,
        y: (Math.random() - 0.5) * 1.3,
        progress: 1.0,
      };
      saccadeTimerRef.current = 0.6 + Math.random() * 1.4;
    }

    microShiftRef.current.x += ((Math.random() - 0.5) * 0.05 - microShiftRef.current.x) * delta * 8;
    microShiftRef.current.y += ((Math.random() - 0.5) * 0.03 - microShiftRef.current.y) * delta * 6;

    const targetMouth = render.animation === 'active' ? 0.25 + Math.sin(t * 6.5) * 0.09 : render.animation === 'tired' ? 0.05 : 0.008;
    mouthOpenRef.current += (targetMouth - mouthOpenRef.current) * Math.min(1, delta * 4);

    const targetBrow = (render.smile - 0.5) * 0.6 + (render.animation === 'focused' ? -0.18 : render.animation === 'active' ? 0.20 : 0);
    browLiftRef.current += (targetBrow - browLiftRef.current) * Math.min(1, delta * 3);

    if (rootRef.current) {
      const breathe = Math.sin(t * 1.3) * styleCfg.breatheScale;
      const bob = Math.sin(t * 0.75) * 0.008 + microShiftRef.current.y * 0.02;
      rootRef.current.position.y = styleCfg.rootY + bob;
      rootRef.current.scale.setScalar(rootScale * (1 + breathe));
      rootRef.current.position.x = microShiftRef.current.x * 0.015;
    }

    if (headRef.current) {
      const tilt = Math.sin(t * 0.48) * 0.022 + microShiftRef.current.x * 0.08;
      const lookX = gazeRef.current.x * 0.05;
      const lookY = gazeRef.current.y * 0.035;
      headRef.current.rotation.y = tilt + lookX * 0.12;
      headRef.current.rotation.x = lookY * 0.18 + Math.sin(t * 0.85) * 0.008;
      headRef.current.rotation.z = lookX * 0.10 + microShiftRef.current.x * 0.03;
    }

    const armSwing = Math.sin(t * 0.65) * (render.animation === 'active' ? 0.06 : 0.030);
    const microMovement = Math.sin(t * 2.2) * 0.006;
    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = armSwing + Math.sin(t * 1.3) * 0.010 + microMovement;
      leftArmRef.current.rotation.z = 0.10 + Math.sin(t * 0.9) * 0.012;
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = -armSwing - Math.sin(t * 1.3 + 0.6) * 0.010 - microMovement;
      rightArmRef.current.rotation.z = -0.10 - Math.sin(t * 0.9 + 0.4) * 0.012;
    }
  });

  return (
    <group ref={rootRef} position={[0, styleCfg.rootY, 0]} scale={[rootScale, rootScale, rootScale]}>
      <group ref={headRef} position={[0, styleCfg.headPosY, 0]} scale={[styleCfg.headScale, styleCfg.headScale, styleCfg.headScale]}>
        <mesh scale={[faceScaleX * 0.985, faceScaleY * 1.05, 0.93]} position={[0, -0.015, 0]}>
          <sphereGeometry args={[0.70, seg, Math.floor(seg * 0.78)]} />
          <meshStandardMaterial
            color={identity.skinTone}
            roughness={styleCfg.skinRoughness}
            metalness={0.005}
          />
        </mesh>

        <mesh position={[0, 0.08, 0.28]} scale={[0.42, 0.18, 0.12]}>
          <sphereGeometry args={[0.5, Math.max(16, seg / 2.8), Math.max(12, seg / 3.8)]} />
          <meshStandardMaterial color={skinHighlightColor} transparent opacity={styleCfg.skinSSS * 0.4} roughness={0.8} />
        </mesh>

        <mesh position={[0, -0.38, 0.34]} scale={[0.40, 0.20, 0.14]}>
          <sphereGeometry args={[0.52, Math.max(20, seg / 2.2), Math.max(14, seg / 3.2)]} />
          <meshStandardMaterial color={chinShadowColor} transparent opacity={styleCfg.chinShadowOpacity} roughness={1} />
        </mesh>

        <mesh position={[-0.28 * styleCfg.cheekFullness, -0.12, 0.40]} scale={[0.18, 0.12, 0.08]}>
          <sphereGeometry args={[0.45, Math.max(14, seg / 3.2), Math.max(10, seg / 4.5)]} />
          <meshStandardMaterial color={cheekShadowColor} transparent opacity={0.06} roughness={1} />
        </mesh>
        <mesh position={[0.28 * styleCfg.cheekFullness, -0.12, 0.40]} scale={[0.18, 0.12, 0.08]}>
          <sphereGeometry args={[0.45, Math.max(14, seg / 3.2), Math.max(10, seg / 4.5)]} />
          <meshStandardMaterial color={cheekShadowColor} transparent opacity={0.06} roughness={1} />
        </mesh>

        <mesh position={[0, -0.16, 0.50]} scale={[0.22, 0.10, 0.08]}>
          <sphereGeometry args={[0.52, Math.max(14, seg / 3.2), Math.max(10, seg / 4.5)]} />
          <meshStandardMaterial color={skinShadowColor} transparent opacity={styleCfg.noseShadowOpacity * 0.6} roughness={1} />
        </mesh>

        <CuteEar side={-1} styleCfg={styleCfg} skinTone={identity.skinTone} />
        <CuteEar side={1} styleCfg={styleCfg} skinTone={identity.skinTone} />

        {styleCfg.neckVisible && (
          <group position={[0, -0.66, 0]}>
            <mesh scale={[0.15 * styleCfg.neckScale, 0.28 * styleCfg.neckScale, 0.15 * styleCfg.neckScale]}>
              <capsuleGeometry args={[0.58, 0.88, Math.max(12, seg / 3.8), Math.max(14, seg / 3.2)]} />
              <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.02} />
            </mesh>
            <mesh position={[0, -0.12, 0.08]} scale={[0.18 * styleCfg.neckScale, 0.10 * styleCfg.neckScale, 0.10 * styleCfg.neckScale]}>
              <sphereGeometry args={[0.82, Math.max(12, seg / 3.8), Math.max(10, seg / 4.5)]} />
              <meshStandardMaterial color={chinShadowColor} transparent opacity={0.10} roughness={1} />
            </mesh>
            <mesh position={[-0.06 * styleCfg.neckScale, -0.02, 0.10]} scale={[0.04 * styleCfg.neckScale, 0.08 * styleCfg.neckScale, 0.03 * styleCfg.neckScale]} rotation={[0, 0, 0.15]}>
              <capsuleGeometry args={[0.30, 0.50, 6, 8]} />
              <meshStandardMaterial color={skinShadowColor} transparent opacity={0.08} roughness={1} />
            </mesh>
            <mesh position={[0.06 * styleCfg.neckScale, -0.02, 0.10]} scale={[0.04 * styleCfg.neckScale, 0.08 * styleCfg.neckScale, 0.03 * styleCfg.neckScale]} rotation={[0, 0, -0.15]}>
              <capsuleGeometry args={[0.30, 0.50, 6, 8]} />
              <meshStandardMaterial color={skinShadowColor} transparent opacity={0.08} roughness={1} />
            </mesh>
          </group>
        )}

        <CuteEye side={-1} styleCfg={styleCfg} skinTone={identity.skinTone} eyeOpenRef={eyeOpenRef} gazeRef={gazeRef} saccadeRef={saccadeRef} pupilScaleRef={pupilScaleRef} />
        <CuteEye side={1} styleCfg={styleCfg} skinTone={identity.skinTone} eyeOpenRef={eyeOpenRef} gazeRef={gazeRef} saccadeRef={saccadeRef} pupilScaleRef={pupilScaleRef} />
        <CuteBrow side={-1} styleCfg={styleCfg} browLiftRef={browLiftRef} />
        <CuteBrow side={1} styleCfg={styleCfg} browLiftRef={browLiftRef} />
        <CuteNose styleCfg={styleCfg} skinTone={identity.skinTone} />
        <CuteMouth styleCfg={styleCfg} smile={render.smile} mouthOpenRef={mouthOpenRef} />
        <CuteBlush side={-1} styleCfg={styleCfg} />
        <CuteBlush side={1} styleCfg={styleCfg} />

        <CuteHair identity={identity} styleCfg={styleCfg} />
      </group>

      <group ref={bodyRef} position={[0, styleCfg.bodyY, 0]}>
        <mesh position={[0, 0, 0]} scale={[shoulderX * styleCfg.bodyWidth, styleCfg.bodyHeight, 0.44]}>
          <capsuleGeometry args={[0.54, 0.40, Math.max(16, seg / 2.8), Math.max(20, seg / 2.2)]} />
          <meshStandardMaterial
            color={outfitColor}
            roughness={avatarStyle === 'cyber' ? 0.38 : avatarStyle === 'obsidian' ? 0.52 : 0.70}
            metalness={avatarStyle === 'cyber' ? 0.22 : avatarStyle === 'obsidian' ? 0.12 : 0.01}
            emissive={avatarStyle === 'cyber' ? outfitColor : '#000000'}
            emissiveIntensity={avatarStyle === 'cyber' ? 0.20 : 0}
          />
        </mesh>

        {styleCfg.clothDetail && (
          <>
            <mesh position={[0, styleCfg.bodyHeight * 0.32, 0.20]} scale={[shoulderX * styleCfg.bodyWidth * 0.78, 0.025, 0.08]}>
              <capsuleGeometry args={[0.42, 0.48, 8, 10]} />
              <meshStandardMaterial color={'#000000'} transparent opacity={0.05} roughness={1} />
            </mesh>
            <mesh position={[0, -styleCfg.bodyHeight * 0.18, 0.22]} scale={[shoulderX * styleCfg.bodyWidth * 0.52, 0.035, 0.06]}>
              <capsuleGeometry args={[0.38, 0.38, 8, 10]} />
              <meshStandardMaterial color={'#000000'} transparent opacity={0.04} roughness={1} />
            </mesh>

            <mesh position={[-shoulderX * styleCfg.bodyWidth * 0.20, 0.02, 0.23]} scale={[0.03, styleCfg.bodyHeight * 0.65, 0.01]}>
              <capsuleGeometry args={[0.15, 0.50, 4, 6]} />
              <meshStandardMaterial color={new THREE.Color(outfitColor).multiplyScalar(0.88)} transparent opacity={0.15} roughness={0.8} />
            </mesh>
            <mesh position={[shoulderX * styleCfg.bodyWidth * 0.20, 0.02, 0.23]} scale={[0.03, styleCfg.bodyHeight * 0.65, 0.01]}>
              <capsuleGeometry args={[0.15, 0.50, 4, 6]} />
              <meshStandardMaterial color={new THREE.Color(outfitColor).multiplyScalar(0.88)} transparent opacity={0.15} roughness={0.8} />
            </mesh>
          </>
        )}

        <mesh position={[0, styleCfg.collarY - styleCfg.bodyY, 0.24]} rotation={[0.30, 0, 0]} scale={[0.42, 0.14, 0.16]}>
          <torusGeometry args={[0.54, 0.15, Math.max(10, seg / 4.5), Math.max(20, seg / 2.2), Math.PI * 0.86]} />
          <meshStandardMaterial color={styleCfg.collarColor} roughness={avatarStyle === 'cyber' ? 0.50 : 0.68} metalness={avatarStyle === 'cyber' ? 0.30 : 0.04} />
        </mesh>

        {(isKawaii || avatarStyle === 'default') && (
          <>
            <mesh position={[0, 0.12, 0.245]} scale={[0.038, 0.038, 0.030]}>
              <sphereGeometry args={[1, Math.max(12, seg / 3.8), Math.max(10, seg / 4.5)]} />
              <meshStandardMaterial color={styleCfg.collarColor} roughness={0.48} metalness={0.22} />
            </mesh>
            <mesh position={[0, 0.12, 0.265]} scale={[0.015, 0.012, 0.008]}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color={'#FFFFFF'} transparent opacity={0.50} roughness={0.2} />
            </mesh>
            {isKawaii && (
              <>
                <mesh position={[0, -0.00, 0.245]} scale={[0.038, 0.038, 0.030]}>
                  <sphereGeometry args={[1, Math.max(12, seg / 3.8), Math.max(10, seg / 4.5)]} />
                  <meshStandardMaterial color={styleCfg.collarColor} roughness={0.48} metalness={0.22} />
                </mesh>
                <mesh position={[0, -0.00, 0.265]} scale={[0.015, 0.012, 0.008]}>
                  <sphereGeometry args={[1, 8, 6]} />
                  <meshStandardMaterial color={'#FFFFFF'} transparent opacity={0.50} roughness={0.2} />
                </mesh>
              </>
            )}
          </>
        )}

        {!isKawaii && avatarStyle !== 'minimal' && styleCfg.clothDetail && (
          <>
            <mesh position={[-shoulderX * styleCfg.bodyWidth * 0.30, 0.0, 0.23]} rotation={[0.08, 0, 0.08]} scale={[0.08, 0.10, 0.025]}>
              <sphereGeometry args={[0.5, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
              <meshStandardMaterial color={'#000000'} transparent opacity={0.05} roughness={1} />
            </mesh>
            <mesh position={[shoulderX * styleCfg.bodyWidth * 0.30, 0.0, 0.23]} rotation={[0.08, 0, -0.08]} scale={[0.08, 0.10, 0.025]}>
              <sphereGeometry args={[0.5, Math.max(10, seg / 4.5), Math.max(8, seg / 5.5)]} />
              <meshStandardMaterial color={'#000000'} transparent opacity={0.05} roughness={1} />
            </mesh>
          </>
        )}

        <group ref={leftArmRef} position={[-shoulderX * styleCfg.shoulderPosX, styleCfg.armY - styleCfg.bodyY, 0]} rotation={[0.05, 0, 0.12]}>
          <mesh position={[0, -armLength * 0.55, 0]} scale={[armWidth, armLength, armWidth]}>
            <capsuleGeometry args={[0.48, avatarStyle === 'kawaii' ? 0.32 : 0.58, Math.max(12, seg / 3.8), Math.max(14, seg / 3.2)]} />
            <meshStandardMaterial color={outfitColor} roughness={avatarStyle === 'cyber' ? 0.45 : 0.72} metalness={avatarStyle === 'cyber' ? 0.14 : 0} />
          </mesh>
          {styleCfg.clothDetail && (
            <mesh position={[0, -armLength * 0.22, 0.018]} scale={[armWidth * 0.92, 0.035, armWidth * 0.48]}>
              <capsuleGeometry args={[0.32, 0.38, 6, 8]} />
              <meshStandardMaterial color={'#000000'} transparent opacity={0.04} roughness={1} />
            </mesh>
          )}
          {isKawaii ? (
            <group position={[0, -armLength * 1.08, 0.05]}>
              <mesh scale={[0.18 * 1.4, 0.16 * 1.3, 0.15 * 1.3]}>
                <sphereGeometry args={[1, Math.max(14, seg / 3.2), Math.max(12, seg / 3.8)]} />
                <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.01} />
              </mesh>
              <mesh position={[0, -0.08, 0.02]} scale={[0.07, 0.05, 0.05]}>
                <sphereGeometry args={[1, 8, 6]} />
                <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.02} />
              </mesh>
              {[[-0.06, -0.05], [0, -0.09], [0.06, -0.05]].map(([xOff, yOff], i) => (
                <mesh key={`lh${i}`} position={[xOff, yOff, 0.06]} scale={[0.035, 0.045, 0.03]}>
                  <sphereGeometry args={[1, 6, 5]} />
                  <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.02} />
                </mesh>
              ))}
            </group>
          ) : (
            <>
              <mesh position={[0, -armLength * 1.12, 0.04]} scale={[0.16, 0.14, 0.14]}>
                <sphereGeometry args={[1, Math.max(16, seg / 2.8), Math.max(14, seg / 3.2)]} />
                <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.01} />
              </mesh>
              {styleCfg.clothDetail && (
                <mesh position={[0, -armLength * 0.95, 0.06]} scale={[armWidth * 0.85, 0.025, armWidth * 0.45]} rotation={[0.15, 0, 0]}>
                  <capsuleGeometry args={[0.30, 0.35, 6, 8]} />
                  <meshStandardMaterial color={new THREE.Color(outfitColor).multiplyScalar(0.82)} roughness={0.75} />
                </mesh>
              )}
            </>
          )}
        </group>

        <group ref={rightArmRef} position={[shoulderX * styleCfg.shoulderPosX, styleCfg.armY - styleCfg.bodyY, 0]} rotation={[0.05, 0, -0.12]}>
          <mesh position={[0, -armLength * 0.55, 0]} scale={[armWidth, armLength, armWidth]}>
            <capsuleGeometry args={[0.48, avatarStyle === 'kawaii' ? 0.32 : 0.58, Math.max(12, seg / 3.8), Math.max(14, seg / 3.2)]} />
            <meshStandardMaterial color={outfitColor} roughness={avatarStyle === 'cyber' ? 0.45 : 0.72} metalness={avatarStyle === 'cyber' ? 0.14 : 0} />
          </mesh>
          {styleCfg.clothDetail && (
            <mesh position={[0, -armLength * 0.22, 0.018]} scale={[armWidth * 0.92, 0.035, armWidth * 0.48]}>
              <capsuleGeometry args={[0.32, 0.38, 6, 8]} />
              <meshStandardMaterial color={'#000000'} transparent opacity={0.04} roughness={1} />
            </mesh>
          )}
          {isKawaii ? (
            <group position={[0, -armLength * 1.08, 0.05]}>
              <mesh scale={[0.18 * 1.4, 0.16 * 1.3, 0.15 * 1.3]}>
                <sphereGeometry args={[1, Math.max(14, seg / 3.2), Math.max(12, seg / 3.8)]} />
                <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.01} />
              </mesh>
              <mesh position={[0, -0.08, 0.02]} scale={[0.07, 0.05, 0.05]}>
                <sphereGeometry args={[1, 8, 6]} />
                <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.02} />
              </mesh>
              {[[-0.06, -0.05], [0, -0.09], [0.06, -0.05]].map(([xOff, yOff], i) => (
                <mesh key={`rh${i}`} position={[xOff, yOff, 0.06]} scale={[0.035, 0.045, 0.03]}>
                  <sphereGeometry args={[1, 6, 5]} />
                  <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.02} />
                </mesh>
              ))}
            </group>
          ) : (
            <>
              <mesh position={[0, -armLength * 1.12, 0.04]} scale={[0.16, 0.14, 0.14]}>
                <sphereGeometry args={[1, Math.max(16, seg / 2.8), Math.max(14, seg / 3.2)]} />
                <meshStandardMaterial color={identity.skinTone} roughness={styleCfg.skinRoughness + 0.01} />
              </mesh>
              {styleCfg.clothDetail && (
                <mesh position={[0, -armLength * 0.95, 0.06]} scale={[armWidth * 0.85, 0.025, armWidth * 0.45]} rotation={[0.15, 0, 0]}>
                  <capsuleGeometry args={[0.30, 0.35, 6, 8]} />
                  <meshStandardMaterial color={new THREE.Color(outfitColor).multiplyScalar(0.82)} roughness={0.75} />
                </mesh>
              )}
            </>
          )}
        </group>

        <mesh position={[-0.15, styleCfg.legPosY - styleCfg.bodyY, 0]} scale={[0.15, styleCfg.legScale, 0.16]}>
          <capsuleGeometry args={[0.44, avatarStyle === 'kawaii' ? 0.30 : 0.54, Math.max(12, seg / 3.8), Math.max(14, seg / 3.2)]} />
          <meshStandardMaterial color={styleCfg.pantsColor} roughness={0.78} />
        </mesh>
        <mesh position={[0.15, styleCfg.legPosY - styleCfg.bodyY, 0]} scale={[0.15, styleCfg.legScale, 0.16]}>
          <capsuleGeometry args={[0.44, avatarStyle === 'kawaii' ? 0.30 : 0.54, Math.max(12, seg / 3.8), Math.max(14, seg / 3.2)]} />
          <meshStandardMaterial color={styleCfg.pantsColor} roughness={0.78} />
        </mesh>

        <group position={[-0.15, styleCfg.shoeY - styleCfg.bodyY, 0.05]}>
          <mesh scale={[0.22 * (isKawaii ? 0.72 : 1), 0.12 * (isKawaii ? 0.68 : 0.9), 0.30 * (isKawaii ? 0.75 : 1)]}>
            <capsuleGeometry args={[0.6, 0.55, Math.max(10, seg / 4.5), Math.max(12, seg / 3.8)]} />
            <meshStandardMaterial color={styleCfg.shoeColor} roughness={avatarStyle === 'kawaii' ? 0.78 : 0.72} />
          </mesh>
          <mesh position={[0, 0.01, 0.08]} scale={[0.16 * (isKawaii ? 0.65 : 0.85), 0.08 * (isKawaii ? 0.55 : 0.7), 0.14 * (isKawaii ? 0.6 : 0.8)]}>
            <sphereGeometry args={[1, Math.max(12, seg / 3.8), Math.max(10, seg / 4.5)]} />
            <meshStandardMaterial color={new THREE.Color(styleCfg.shoeColor).multiplyScalar(0.92)} roughness={0.82} />
          </mesh>
          {styleCfg.clothDetail && (
            <mesh position={[0, 0.06 * (isKawaii ? 0.7 : 1), -0.02]} scale={[0.14 * (isKawaii ? 0.6 : 0.8), 0.025, 0.08 * (isKawaii ? 0.6 : 0.75)]}>
              <capsuleGeometry args={[0.35, 0.30, 4, 6]} />
              <meshStandardMaterial color={new THREE.Color(styleCfg.shoeColor).multiplyScalar(1.12)} roughness={0.55} metalness={avatarStyle === 'cyber' ? 0.3 : 0.05} />
            </mesh>
          )}
          {isKawaii && (
            <mesh position={[0, 0.03, 0.10]} scale={[0.06, 0.04, 0.04]}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color={'#FFFFFF'} transparent opacity={0.45} roughness={0.3} />
            </mesh>
          )}
        </group>
        <group position={[0.15, styleCfg.shoeY - styleCfg.bodyY, 0.05]}>
          <mesh scale={[0.22 * (isKawaii ? 0.72 : 1), 0.12 * (isKawaii ? 0.68 : 0.9), 0.30 * (isKawaii ? 0.75 : 1)]}>
            <capsuleGeometry args={[0.6, 0.55, Math.max(10, seg / 4.5), Math.max(12, seg / 3.8)]} />
            <meshStandardMaterial color={styleCfg.shoeColor} roughness={avatarStyle === 'kawaii' ? 0.78 : 0.72} />
          </mesh>
          <mesh position={[0, 0.01, 0.08]} scale={[0.16 * (isKawaii ? 0.65 : 0.85), 0.08 * (isKawaii ? 0.55 : 0.7), 0.14 * (isKawaii ? 0.6 : 0.8)]}>
            <sphereGeometry args={[1, Math.max(12, seg / 3.8), Math.max(10, seg / 4.5)]} />
            <meshStandardMaterial color={new THREE.Color(styleCfg.shoeColor).multiplyScalar(0.92)} roughness={0.82} />
          </mesh>
          {styleCfg.clothDetail && (
            <mesh position={[0, 0.06 * (isKawaii ? 0.7 : 1), -0.02]} scale={[0.14 * (isKawaii ? 0.6 : 0.8), 0.025, 0.08 * (isKawaii ? 0.6 : 0.75)]}>
              <capsuleGeometry args={[0.35, 0.30, 4, 6]} />
              <meshStandardMaterial color={new THREE.Color(styleCfg.shoeColor).multiplyScalar(1.12)} roughness={0.55} metalness={avatarStyle === 'cyber' ? 0.3 : 0.05} />
            </mesh>
          )}
          {isKawaii && (
            <mesh position={[0, 0.03, 0.10]} scale={[0.06, 0.04, 0.04]}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color={'#FFFFFF'} transparent opacity={0.45} roughness={0.3} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}
