// 知行镜领域类型（后端权威定义，与 App 端保持语义一致）

export type SourceType = 'user' | 'device' | 'calendar' | 'task_app' | 'ai_inference';
export type MemoryLayer = 'fact' | 'experience' | 'relation' | 'hypothesis' | 'commitment';

export interface EventRow {
  id?: string;
  user_id?: string;
  content: string;
  source: SourceType;
  layer: MemoryLayer;
  mood?: number | null;          // -1..1
  tags: string[];                // JSON
  user_interpretation?: string | null;
  ai_inference?: string | null;
  confidence?: number | null;    // 0..1
  created_at: string;
  deleted_at?: string | null;
  axis?: 'inner' | 'outer' | null; // P0-3：内观/外观数据源拆分
}

export interface CommitmentRow {
  id: string;
  user_id: string;
  text: string;
  domain: string;
  weight: number;                // 0..1
  status: 'active' | 'fulfilled' | 'broken' | 'released';
  created_at: string;
}

export interface HypothesisRow {
  id: string;
  user_id: string;
  statement: string;
  confidence: number;            // 0..1
  status: 'testing' | 'confirmed' | 'revised' | 'rejected';
  evidence: HypothesisEvidence[];
  counter_evidence: HypothesisEvidence[];
  alternatives: string[];
  expires_at?: string | null;
  created_at: string;
}

export interface HypothesisEvidence {
  text: string;
  source: string;
  date: string;
}

export interface ExperimentRow {
  id: string;
  user_id: string;
  title: string;
  hypothesis_id?: string | null;
  duration_days: number;
  started_at: string;
  ended_at?: string | null;
  status: 'planned' | 'running' | 'active' | 'completed' | 'stopped' | 'declined' | 'proposed';
  checkins: ExperimentCheckin[];
  stop_rule?: string | null;
}

export interface ExperimentCheckin {
  date: string;
  note: string;
  result?: 'aligned' | 'misaligned' | 'neutral';
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  mission: string;
  milestones: Milestone[];
  risks: Risk[];
  decisions: Decision[];
  next_action?: string | null;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
}

export interface Milestone { name: string; status: 'pending' | 'active' | 'done'; date?: string }
export interface Risk { text: string; severity: 'low' | 'medium' | 'high'; mitigation?: string }
export interface Decision { date: string; text: string; rationale: string }

export interface SkillRow {
  id: string;
  user_id: string;
  name: string;
  baseline: number;              // 0..1
  works: string[];
  tests: { date: string; score: number }[];
  transfer_progress: number;     // 0..1
  mastery: number;               // 0..1
}

export interface MeaningRow {
  id: string;
  user_id: string;
  direction: string;
  evidence: string[];
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  user_id: string;
  action: string;
  detail: unknown;               // JSON
  ts: string;
}

// ---------- V4.3 自我沉淀系统类型 ----------

/** 证据来源类型（V4.3 §4.4） */
export type EvidenceSource =
  | 'manual_text' | 'manual_voice' | 'photo' | 'calendar' | 'task' | 'health'
  | 'device_usage' | 'desktop_usage' | 'nutrition' | 'project' | 'system';

/** 证据类型：事实/自述/结果/纠正/上下文 */
export type EvidenceType = 'fact' | 'self_report' | 'outcome' | 'correction' | 'context';

/** 隐私等级 D0-D3 */
export type PrivacyLevel = 'D0' | 'D1' | 'D2' | 'D3';

/** 证据状态 */
export type EvidenceStatus = 'active' | 'deleted' | 'invalid';

/** 证据记录：跨模块来源层（V4.3 §4.4） */
export interface EvidenceRecord {
  id: string;
  user_id: string;
  source: EvidenceSource;
  evidence_type: EvidenceType;
  occurred_at: string;
  captured_at: string;
  content_ref: string | null;
  context: Record<string, unknown> | null;  // JSON
  privacy_level: PrivacyLevel;
  quality_flags: Record<string, unknown> | null;  // JSON
  status: EvidenceStatus;
  provenance: { resource_type?: string; resource_id?: string } | null;  // JSON
  resource_type: string | null;  // 冗余字段便于查询
  resource_id: string | null;     // 冗余字段
  created_at: string;
}

/** 候选模式评审状态（Task 11.4 新增 'pending_user_review'：高影响候选等待用户审查） */
export type PatternReviewState =
  | 'candidate' | 'keep' | 'watch' | 'reject' | 'stale' | 'pending_user_review';

/** 候选模式（V4.3 §4.18） */
export interface PatternCandidate {
  id: string;
  user_id: string;
  statement: string;
  scope: string | null;
  support_ids: string[];           // JSON: 支持证据 id 数组
  counter_ids: string[];           // JSON: 反例证据 id 数组
  alternative_explanations: string[];  // JSON: 非人格化替代解释（>=1）
  recurrence_count: number;
  domain_count: number;
  last_seen: string | null;
  review_state: PatternReviewState;
  user_note: string | null;
  created_at: string;
}

/** 经验成熟度 */
export type ExperienceMaturity = 'candidate' | 'observed' | 'repeated' | 'validated' | 'stale' | 'retired';

/** 可复用经验（V4.3 §4.18） */
export interface ExperienceUnit {
  id: string;
  user_id: string;
  context: string | null;
  problem: string | null;
  actions: unknown[] | null;       // JSON
  outcome: string | null;
  lesson: string | null;
  support_ids: string[];           // JSON
  counter_ids: string[];           // JSON
  applicability: string | null;
  maturity: ExperienceMaturity;
  last_validated_at: string | null;
  version: number;
  created_at: string;
}

/** 领域方法 Personal Playbook（V4.3 §4.18） */
export interface PersonalSkill {
  id: string;
  user_id: string;
  trigger: string | null;
  preconditions: unknown[] | null;  // JSON
  procedure: unknown[] | null;      // JSON
  anti_patterns: unknown[] | null;  // JSON
  scope: string | null;
  evidence_refs: string[];          // JSON
  last_validated_at: string | null;
  expiry_review: string | null;
  version: number;
  created_at: string;
}

/** 跨领域原则候选状态 */
export type MetaPrincipleStatus = 'candidate' | 'keep' | 'watch' | 'reject' | 'stale';

/** 跨领域原则（V4.3 §4.18） */
export interface MetaPrinciple {
  id: string;
  user_id: string;
  statement: string;
  domains: string[];               // JSON
  evidence: string[];              // JSON
  counterevidence: string[];       // JSON
  status: MetaPrincipleStatus;
  last_validated: string | null;
  created_at: string;
}

/** 个人模型版本状态：active（当前生效）/ archived（已被回滚归档）/ superseded（被新版本取代） */
export type ModelVersionStatus = 'active' | 'archived' | 'superseded';

/** 个人模型完整快照（V4.3 §4.25）
 *
 * 项目书附录AE要求 PersonalModelVersion 最小Schema：snapshot/change_log/reason/created_at。
 * 其中 `reason`（用户可读的变化原因）存储在 change_log.change_summary 字段中，
 * 由 pipeline.ts stage8_commit 写入（如"蒸馏 N 条候选"），满足附录AH"所有模型版本均有
 * change_log、created_at 和用户可读的变化原因"的验收要求。
 */
export interface PersonalModelVersion {
  id: string;
  user_id: string;
  version: string;                 // v0.01/v0.05/v0.1/...
  snapshot: Record<string, unknown>;  // JSON: 完整快照
  change_log: Record<string, unknown> | null;  // JSON: 含 change_summary（= reason）
  status: ModelVersionStatus;
  created_at: string;
}

/** 密码重置令牌（V4.3 §10 路线图 A26） */
export interface PasswordResetToken {
  id: string;
  user_id: string;
  token_hash: string;              // SHA-256 哈希，不存明文
  expires_at: string;              // ISO 时间戳，30 分钟过期
  used_at: string | null;          // 一次性使用标记
  created_at: string;
}

/** 蒸馏流水线阶段 */
export type DistillationStage =
  | 'pending' | 'scoping' | 'extracting' | 'candidate' | 'counter_search'
  | 'context_check' | 'independent_review' | 'user_gate' | 'commit' | 'done' | 'error';

/** 蒸馏任务触发类型 */
export type DistillationTrigger =
  | 'manual' | 'scheduled' | 'event' | 'project_end' | 'major_correction' | 'milestone';

/** 蒸馏流水线任务（V4.3 §4.18，Task 11.2 补 retry_count / completed_at） */
export interface DistillationJob {
  id: string;
  user_id: string;
  trigger: DistillationTrigger;
  input_scope: {
    timeWindow?: { start: string; end: string };
    project?: string;
    topic?: string;
  } | null;  // JSON
  stage: DistillationStage;
  result: Record<string, unknown> | null;  // JSON
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** 用户纠正类型（V4.3 §4.20） */
export type CorrectionType =
  | 'unlike-me' | 'wrong-reason' | 'special-case' | 'wait' | 'no-more-inference' | 'phase-changed';

/** 纠正目标类型（V4.3 §4.20，Task 8 扩展含 meta_principle） */
export type CorrectionTargetType = 'hypothesis' | 'pattern' | 'experience' | 'skill' | 'meta_principle';

/** 用户纠正记录（V4.3 §4.20） */
export interface ModelCorrection {
  id: string;
  user_id: string;
  target_id: string;
  target_type: CorrectionTargetType;
  correction_type: CorrectionType;
  user_text: string | null;
  target_pattern: string | null;
  created_at: string;
}

/** 数据源类型 */
export type DataType =
  | 'calendar' | 'task' | 'health' | 'device_usage' | 'desktop_usage' | 'nutrition'
  | 'location' | 'photo' | 'microphone' | 'notification';

/** 数据源权限（V4.3 §4.25） */
export interface SourcePermission {
  id: string;
  user_id: string;
  data_type: DataType;
  purpose: string | null;
  scope: Record<string, unknown> | null;  // JSON: 细粒度范围
  granted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// ---------- 七轴服务契约（V4.3 §4.25 附录 X） ----------

export type ReflectionDepth = 'R0' | 'R1' | 'R2' | 'R3';
export type AgencyLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
export type DataScopeAxis = 'D0' | 'D1' | 'D2' | 'D3' | 'D4';
export type ProactivityLevel = 'P0' | 'P1' | 'P2' | 'P3';
export type AvatarVisibility = 'V0' | 'V1' | 'V2' | 'V3';
export type SupporterMode = 'S0' | 'S1' | 'S2';

/** 使用模式（V4.3 §2.10） */
export type UsageMode =
  | 'quiet-mirror' | 'action-nav' | 'long-project' | 'voice-life' | 'explore-growth' | 'senior-easy';

/** 服务契约（每用户唯一，V4.3 §4.25 附录 X） */
export interface ServiceContract {
  user_id: string;
  reflection_depth: ReflectionDepth;
  agency_level: AgencyLevel;
  data_scope: Record<DataScopeAxis, boolean>;  // JSON: { D0:bool, ... D4:bool }
  proactivity: ProactivityLevel;
  avatar: AvatarVisibility;
  supporter_mode: SupporterMode;
  accessibility_profile: {
    font_scale?: number;
    voice_readout?: boolean;
    single_confirm?: boolean;
    usage_mode?: UsageMode;
  };  // JSON
  quiet_hours: { start: string; end: string } | null;  // JSON
  high_impact_confirmation: boolean;
  model_provider: string;
  local_only: boolean;
  consent_version: string | null;
  policy_version: string | null;
  updated_at: string;
}

export interface SixPositionState {
  inner: Record<string, number>; // L1..L6, -1..1
  outer: Record<string, number>;
  divergence: number;            // 0..1（余弦距离）
  changePositions: string[];
  positions?: import('./domain/positions.js').PositionDef[]; // 权威语义定义（P0-1）
}

// ---------- AI-native 个人智能环境运行时 ----------

export type LifeObjectKind = 'note' | 'task' | 'event' | 'course' | 'draft' | 'project' | 'habit';
export type LifeObjectStatus = 'draft' | 'active' | 'done' | 'cancelled';

export interface LifeObjectRecord {
  id: string;
  user_id: string;
  kind: LifeObjectKind;
  title: string;
  status: LifeObjectStatus;
  starts_at: string | null;
  ends_at: string | null;
  version: number;
  doc: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ActionReceiptStatus = 'success' | 'partial_failure' | 'failed' | 'blocked' | 'undone';

export interface ActionReceiptRecord {
  id: string;
  user_id: string;
  plan_id: string;
  idempotency_key: string;
  status: ActionReceiptStatus;
  doc: Record<string, unknown>;
  executed_at: string;
  undone_at: string | null;
}

export interface TwinProfileRecord {
  user_id: string;
  version: number;
  doc: Record<string, unknown>;
  updated_at: string;
}

export type DeviceSurface = 'desktop' | 'mobile';
export type DevicePlatform = 'web' | 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'unknown';

export interface DeviceRecord {
  id: string;
  user_id: string;
  label: string;
  surface: DeviceSurface;
  platform: DevicePlatform;
  app_version: string | null;
  capabilities: string[];
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export type ContinuitySurface = 'desktop' | 'mobile';
export type ContinuityHandoffStatus = 'open' | 'consumed' | 'cancelled';

export interface ContinuityHandoffRecord {
  id: string;
  user_id: string;
  source_surface: ContinuitySurface;
  target_surface: ContinuitySurface;
  title: string;
  payload: {
    kind: 'workspace_text' | 'life_object';
    text?: string;
    route?: 'Workspace' | 'Progress' | 'Mirror' | 'Secretary';
    objectIds?: string[];
  };
  status: ContinuityHandoffStatus;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  cancelled_at: string | null;
}

// 请求体校验 schema（zod）在 routes 内定义
export interface AuthedRequest extends Express.Request {
  userId?: string;
}
