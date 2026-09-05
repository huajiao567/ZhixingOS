import {
  UserProfile, Commitment, Hypothesis, Experiment, MeaningDirection, SkillTrack,
  Project, Permission, AuditEntry, StateSnapshot, LifeEvent,
} from '../types/models';

/** 供引擎层读取的最小状态形状（避免循环依赖 store） */
export interface AppState {
  user: UserProfile;
  events: LifeEvent[];
  commitments: Commitment[];
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  directions: MeaningDirection[];
  skills: SkillTrack[];
  projects: Project[];
  permissions: Permission[];
  audit: AuditEntry[];
  state: StateSnapshot;
}
