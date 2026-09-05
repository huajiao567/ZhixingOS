import type {
  AvatarRenderState,
  CalibrationBias,
  DailyState,
  MirrorSnapshot,
} from '../types/avatar';
import { clamp, exponentialSmooth, round } from './math';

export const DEFAULT_RENDER_STATE: AvatarRenderState = {
  smile: 0.48,
  eyeOpen: 0.82,
  browTension: 0.18,
  cheekLift: 0.35,
  posture: 0.58,
  motionSpeed: 0.55,
  sway: 0.25,
  animation: 'idle',
  outfit: 'daily',
  scene: 'room',
  sceneBrightness: 0.68,
};

export function mapStateToRender(
  state: DailyState,
  calibration: CalibrationBias,
): AvatarRenderState {
  const recoveryNeed = clamp(1 - (0.58 * state.energy + 0.42 * state.selfcare));
  const smile = clamp(0.18 + state.mood * 0.70 - state.stress * 0.18 + calibration.smile);
  const posture = clamp(0.26 + state.energy * 0.64 - state.stress * 0.24 + calibration.posture);
  const eyeOpen = clamp(0.44 + state.energy * 0.55 - recoveryNeed * 0.28 - calibration.fatigue);
  const browTension = clamp(0.06 + state.stress * 0.78);
  const cheekLift = clamp(smile * 0.76 + state.energy * 0.10);
  const motionSpeed = clamp(0.18 + state.energy * 0.48 + state.physicality * 0.36 - recoveryNeed * 0.24);
  const sway = clamp(0.12 + state.arousal * 0.42 + state.physicality * 0.20);

  const animation =
    recoveryNeed > 0.62
      ? 'tired'
      : state.focus > 0.70 && state.stress < 0.72
        ? 'focused'
        : state.physicality > 0.66
          ? 'active'
          : 'idle';

  const outfit = state.physicality > 0.66 ? 'sport' : state.focus > 0.72 ? 'work' : recoveryNeed > 0.62 ? 'home' : 'daily';
  const scene = state.focus > 0.70 ? 'desk' : recoveryNeed > 0.62 ? 'rest' : state.physicality > 0.66 ? 'outdoor' : 'room';

  return {
    smile: round(smile),
    eyeOpen: round(eyeOpen),
    browTension: round(browTension),
    cheekLift: round(cheekLift),
    posture: round(posture),
    motionSpeed: round(motionSpeed),
    sway: round(sway),
    animation,
    outfit,
    scene,
    sceneBrightness: round(clamp(0.38 + state.energy * 0.42 + state.mood * 0.20)),
  };
}

export function smoothRenderState(
  previous: AvatarRenderState,
  next: AvatarRenderState,
  alpha = 0.28,
): AvatarRenderState {
  return {
    smile: exponentialSmooth(previous.smile, next.smile, alpha),
    eyeOpen: exponentialSmooth(previous.eyeOpen, next.eyeOpen, alpha),
    browTension: exponentialSmooth(previous.browTension, next.browTension, alpha),
    cheekLift: exponentialSmooth(previous.cheekLift, next.cheekLift, alpha),
    posture: exponentialSmooth(previous.posture, next.posture, alpha),
    motionSpeed: exponentialSmooth(previous.motionSpeed, next.motionSpeed, alpha),
    sway: exponentialSmooth(previous.sway, next.sway, alpha),
    animation: next.animation,
    outfit: next.outfit,
    scene: next.scene,
    sceneBrightness: exponentialSmooth(previous.sceneBrightness, next.sceneBrightness, alpha),
  };
}

export function explainState(state: DailyState, render: AvatarRenderState): string[] {
  const items: string[] = [];
  if (state.energy < 0.42) items.push('睡眠与恢复信号偏低，形象动作已放缓。');
  if (state.stress > 0.66) items.push('压力线索偏高，仅以轻微眉部紧张表达，不作心理诊断。');
  if (state.focus > 0.68) items.push('专注与项目推进较强，镜像切换到专注场景。');
  if (state.physicality > 0.65) items.push('运动活跃度较高，镜像采用更有弹性的动作。');
  if (state.meaningMomentum > 0.66) items.push('近期行动与长期方向连接较强。');
  if (items.length === 0) items.push('当前状态较平稳，镜像保持日常待机形态。');
  if (render.animation === 'tired') items.push('“恢复中”是视觉提示，不等同于负面评价。');
  return items;
}

export function buildSnapshot(
  state: DailyState,
  render: AvatarRenderState,
): MirrorSnapshot {
  return {
    state,
    render,
    generatedAt: new Date().toISOString(),
    explanation: explainState(state, render),
  };
}
