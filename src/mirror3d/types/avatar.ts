export type SceneKind = 'room' | 'desk' | 'outdoor' | 'rest' | 'neon' | 'candy' | 'void';
export type OutfitKind = 'daily' | 'sport' | 'work' | 'home';
export type AnimationKind = 'idle' | 'active' | 'focused' | 'tired';
export type HairStyle = 'short' | 'round' | 'side' | 'long' | 'twin' | 'tails' | 'ponytail' | 'bun';

export interface AvatarIdentity {
  faceWidth: number;
  faceHeight: number;
  jawRoundness: number;
  eyeSize: number;
  eyeSpacing: number;
  browAngle: number;
  noseSize: number;
  mouthWidth: number;
  bodyScale: number;
  shoulderWidth: number;
  skinTone: string;
  hairColor: string;
  shirtColor: string;
  hairStyle: HairStyle;
}

export interface PersonalBaseline {
  sleepHours: number;
  sleepQuality: number;
  hrvRelative: number;
  steps: number;
  workoutMinutes: number;
  focusMinutes: number;
  taskCompletion: number;
  projectMomentum: number;
}

export interface DailySignals {
  sleepHours: number;
  sleepQuality: number;
  hrvRelative: number;
  steps: number;
  workoutMinutes: number;
  focusMinutes: number;
  taskCompletion: number;
  projectMomentum: number;
  scheduleLoad: number;
  diary: string;
}

export interface DiaryFeatures {
  valence: number;
  stress: number;
  fatigue: number;
  meaning: number;
  focus: number;
  sociality: number;
  evidenceCount: number;
}

export interface DailyState {
  energy: number;
  mood: number;
  stress: number;
  arousal: number;
  sociality: number;
  focus: number;
  selfcare: number;
  physicality: number;
  meaningMomentum: number;
  evidenceCoverage: number;
}

export interface CalibrationBias {
  fatigue: number;
  smile: number;
  posture: number;
}

export interface AvatarRenderState {
  smile: number;
  eyeOpen: number;
  browTension: number;
  cheekLift: number;
  posture: number;
  motionSpeed: number;
  sway: number;
  animation: AnimationKind;
  outfit: OutfitKind;
  scene: SceneKind;
  sceneBrightness: number;
}

export interface MirrorSnapshot {
  state: DailyState;
  render: AvatarRenderState;
  generatedAt: string;
  explanation: string[];
}
