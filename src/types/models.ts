/**
 * 知行镜 ZhixingOS 领域模型
 * 依据策划书：第三章（状态空间/五层记忆/假设卡）、第四章（数据表）、第五章（界面模块）
 */

// ---------- 通用 ----------
export type ID = string;
export type ISODate = string;
export type EvidenceLevel = 'insufficient' | 'preliminary' | 'consistent';

/** 数据来源类型：用户自述、设备、平台、AI 推断 —— 事实与推断在类型层隔离（验收 A-02） */
export type SourceType = 'user' | 'device' | 'calendar' | 'task_app' | 'journal' | 'ai_inference';

export type Sensitivity = 'normal' | 'sensitive' | 'highly_sensitive';

/** 生活领域（用户可自定义，不由系统固定） */
export type Domain =
  | '身体' | '工作' | '关系' | '创造' | '学习' | '家庭' | '公共贡献' | '财务' | '休息';

export type MemoryLayer = 'fact' | 'experience' | 'relation' | 'hypothesis' | 'commitment';

// ---------- 事件（事实层） ----------
export interface LifeEvent {
  id: ID;
  type: 'calendar' | 'task' | 'journal' | 'health' | 'decision' | 'outcome' | 'work' | 'chat_snippet';
  title: string;
  detail?: string;
  sourceType: SourceType;
  sourceRef: string;          // 原始来源引用（验收 A-01：100% 可追溯）
  startTime: ISODate;
  endTime?: ISODate;
  domain: Domain;
  sensitivity: Sensitivity;
  confidence: number;         // 来源置信度 0-1
  consentId: ID;              // 绑定授权记录
  relatedCommitmentId?: ID;
  layer: 'fact';
  userInterpretation?: string; // 用户当时解释（体验层，不覆盖事实）
  mood?: number;               // -1..1，事件情绪信号（供六位状态引擎，可选）
  /** P0-3：内观(inner)仅来自主观体验/价值/解释；外观(outer)仅来自日历/任务/作品/健康/现实反馈。
   *  同一记录不得同时生成两侧状态。缺省时由是否含用户自述推断。 */
  axis?: 'inner' | 'outer';
}

// ---------- 五层记忆条目 ----------
export interface MemoryItem {
  id: ID;
  layer: MemoryLayer;
  title: string;
  body: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  version: number;
  sourceRef?: string;
  evidenceIds: ID[];
  archived?: boolean;
  forgotten?: boolean;
}

// ---------- 承诺层 ----------
export interface Commitment {
  id: ID;
  statement: string;          // 承诺陈述（只有用户可确认或取消）
  why: string;                // 价值理由
  domain: Domain;
  priority: number;           // 1 = 最重要
  createdAt: ISODate;
  deadline?: ISODate;
  costNote?: string;          // 愿意承担的代价
  userConfirmed: boolean;
  status: 'active' | 'paused' | 'fulfilled' | 'cancelled';
  // P1-14：长期任务执行层（DAG / 验收 / 停止条件）
  dependsOn?: ID[];           // 前置承诺 id（构成任务 DAG）
  acceptance?: string;        // 阶段验收标准
  stopCondition?: string;     // 停止条件（避免无限拖延）
}

// ---------- 假设卡（产品最核心的界面单元） ----------
export interface Hypothesis {
  id: ID;                     // H-031
  version: number;
  statement: string;          // 一句可被推翻的陈述
  supporting: EvidenceRef[];  // 支持证据
  countering: EvidenceRef[];  // 反对证据
  dataGaps: string[];         // 数据缺口（未检索/未发现需明示，验收 A-03）
  alternatives: string[];     // 至少两个替代解释
  confidence: number;         // 0-1，区间用 lowConfidenceNote 表达
  harmNote?: string;          // 潜在伤害提示
  suggestedExperimentId?: ID;
  reviewAt: ISODate;          // 到期复审日（防固化）
  /** V4.3 Task 8：扩展 'rejected'（unlike-me）与 'revised'（wrong-reason），对齐后端 HypothesisRow.status */
  status: 'open' | 'confirmed' | 'refuted' | 'expired' | 'rejected' | 'revised';
  createdAt: ISODate;
  history: { at: ISODate; change: string; confidence: number }[];
}

export interface EvidenceRef {
  eventId: ID;
  quote: string;              // 证据摘要
  time: ISODate;
  sourceType: SourceType;
}

// ---------- 现实微实验 ----------
export type ExperimentKind =
  | '微调实验'   // 7天
  | '结构实验'   // 30天
  | '方向实验'   // 90天
  | '学习实验'   // 7-30天
  | '复杂任务实验'
  | '停止实验';  // 7-30天

export interface Experiment {
  id: ID;
  kind: ExperimentKind;
  question: string;           // 一次只验证一个主要假设
  hypothesisId?: ID;
  baseline: string;           // 基线说明
  intervention: string;       // 低风险、可逆、最小剂量
  metrics: string[];          // 行为 + 主观 + 外部 至少两类
  confounders: string[];      // 需记录的混杂因素
  stopRule: string;           // 停止规则（必需，100% 完整 —— 验收 A-10）
  sideEffects?: string;
  durationDays: 7 | 14 | 30 | 90;
  startDate: ISODate;
  status: 'proposed' | 'active' | 'completed' | 'stopped' | 'declined';
  checkIns: CheckIn[];
  result?: string;            // 允许无效、负效应和异质性
  modelUpdate?: string;       // 对假设升降置信度，不写成永久人格
}

export interface CheckIn {
  date: ISODate;
  done: boolean;
  note?: string;
  metricValues?: Record<string, number>;
}

// ---------- 六位动态状态（L1-L6） ----------
export interface SixPositions {
  L1: number; L2: number; L3: number; L4: number; L5: number; L6: number; // s_i ∈ [-1,1]
}

/**
 * 状态快照：暂停「置信度百分比 / 原型编号 / 阶段结论」等未经验证的精确展示（P0-4）。
 * 改用每位置三级证据：insufficient（证据不足）/ preliminary（初步迹象）/ consistent（多源一致）。
 * 本引擎是「启发式状态摘要器」，不宣称理解、预测或模拟用户。
 */
export interface StateSnapshot {
  inner: SixPositions;        // 内观后验（仅主观体验）
  outer: SixPositions;        // 观外后验（仅客观证据）
  divergence: number;         // 余弦距离 0-1
  changePositions: string[];  // 变化位置（原始描述）
  evidenceLevels: Record<keyof SixPositions, EvidenceLevel>;
  note: string;
}

// ---------- 意义方向 ----------
export interface MeaningDirection {
  id: ID;
  statement: string;          // 方向陈述（用户主动确认）
  serveWhom: string;          // 服务对象
  contribution: string;       // 当前贡献方式
  costBoundary: string;       // 代价边界
  skillIds: ID[];
  projectIds: ID[];
  evidenceScore: number;      // 意义证据 0-1（跨时间综合，非"人生分数"）
  trend: 'up' | 'flat' | 'down';
}

// ---------- 技能成长引擎 ----------
export interface SkillTrack {
  id: ID;
  name: string;               // 我想真正学会 X
  targetPerformance: string;  // 可观察目标表现
  baseline: string;           // 基线任务
  rubric: string[];           // 评价量规维度
  prerequisites: string[];    // 先修关系
  stage: '定义能力' | '基线诊断' | '学习规划' | '刻意练习' | '迁移验证' | '能力入库';
  mastery: number;            // 0-1，只有作品/测验/迁移证据可提升（验收 A-13）
  weeklyPlan: string;
  evidences: { date: ISODate; kind: '作品' | '测验' | '练习' | '反馈' | '迁移'; note: string }[];
  replanReason?: string;      // 动态重规划原因
}

// ---------- 项目参谋 ----------
export interface Project {
  id: ID;
  name: string;
  mission: string;            // 为什么做、服务谁、成功是什么
  nonGoals: string;           // 明确不做什么
  nextKeyAction: string;      // 下一关键行动（一个可执行动作，不是长待办）
  criticalPath: string[];     // 决定交付日期的任务链
  dependsOn?: ID[];           // 前置项目 id（项目级 DAG）
  milestones: { title: string; due: ISODate; done: boolean; acceptance: string }[];
  risks: { title: string; signal: string; level: 'low' | 'mid' | 'high'; mitigation: string; reviewAt: ISODate }[];
  decisionLedger: { date: ISODate; options: string; decision: string; reason: string; reviewAt: ISODate }[];
  meaningLoop: string;        // 是否仍服务用户认可的方向，代价是否可接受
  progress: number;           // 0-1
  status: 'active' | 'paused' | 'done' | 'stopped';
}

// ---------- 权限 / 审计 ----------
export type PermissionKind = 'calendar' | 'tasks' | 'health' | 'journal' | 'works' | 'chat_snippet' | 'location';

export interface Permission {
  id: ID;
  kind: PermissionKind;
  granted: boolean;
  purpose: string;            // 明确用途（不以"改善体验"概括）
  scope: string;              // 范围与期限
  readWrite: 'read' | 'read+write';
  grantedAt?: ISODate;
  lastAccessAt?: ISODate;
}

export interface AuditEntry {
  id: ID;
  at: ISODate;
  actor: string;              // 哪个 Agent / 用户
  action: string;
  targetRef?: string;
}

// ---------- 秘书 / 洞察 ----------
export type SecretaryLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface BriefCard {
  factChange: { title: string; detail: string; gap?: string };
  commitment?: Commitment;
  action: { title: string; detail: string };
  question: string;           // 高信息量问题（每天最多 1-2 个）
}

export interface ChatMessage {
  id: ID;
  role: 'user' | 'assistant' | 'safety';
  text: string;
  at: ISODate;
  level?: SecretaryLevel;
}

// ---------- 用户档案 ----------
export interface UserProfile {
  name: string;
  lifeStage: '成年人' | '青少年' | '儿童' | '老年人';
  constraints: string[];      // 当前约束
  onboarded: boolean;
  /**
   * V4.3 Task 21：首次完成引导的时间戳（ISODate）。
   * 用于 Day 0/7/30 自然沉淀里程碑检测（spec A17）：
   *   - Day 0：onboarding 完成 → 触发首次蒸馏 → Personal Model v0.01
   *   - Day 7：满 7 天 → 提示「哪里像 / 哪里不像」校准 → v0.05
   *   - Day 30：满 30 天 → 触发月镜 → v0.1
   * 旧 profile 无此字段时为 undefined，由 dayMilestones 优雅降级处理。
   */
  onboardedAt?: string;
  /** @deprecated V4.3 Task 9.6：被 proactivity 替换。保留向后兼容（= proactivity === 'P0'）。 */
  silentMode: boolean;
  /** V4.3 Task 9.6：四级主动性，替换原 silentMode 布尔开关 */
  proactivity: ProactivityLevel;
  secretaryLevel: SecretaryLevel;
  weeksOfData: number;        // 已积累数据周数（演示种子数据）
}

// === V4.3 自我沉淀系统类型 ===
// 注：字段命名采用 snake_case 对齐后端 SQL schema（V4.3 §4.18），与上方 camelCase 历史模型并存。

export type CorrectionType =
  | 'unlike-me'
  | 'wrong-reason'
  | 'special-case'
  | 'wait'
  | 'no-more-inference'
  | 'phase-changed';

export type CorrectionTargetType = 'hypothesis' | 'pattern' | 'experience' | 'skill' | 'meta_principle';

export type ExperienceMaturity =
  | 'candidate'
  | 'observed'
  | 'repeated'
  | 'validated'
  | 'stale'
  | 'retired';

/**
 * 候选模式审查状态（V4.3 §4.18）。
 *
 * 与后端 backend/src/types.ts 严格对齐：
 *   - candidate / keep / watch / reject / stale：阶段 6 用户/规则决定的审查状态
 *   - pending_user_review：阶段 7 高影响候选写入 pattern_candidates 后等待用户审查
 *     （见 backend/src/services/distillation/pipeline.ts stage7 userGate）
 */
export type PatternReviewState =
  | 'candidate'
  | 'keep'
  | 'watch'
  | 'reject'
  | 'stale'
  | 'pending_user_review';

export type EvidenceSourceType =
  | 'manual_text' | 'manual_voice' | 'photo'
  | 'calendar' | 'task' | 'health' | 'device_usage' | 'desktop_usage' | 'nutrition'
  | 'project' | 'system';

export type EvidenceType = 'fact' | 'self_report' | 'outcome' | 'correction' | 'context';

export type PrivacyLevel = 'D0' | 'D1' | 'D2' | 'D3';

export type DistillationStage =
  | 'pending' | 'scoping' | 'extracting' | 'candidate'
  | 'counter_search' | 'context_check' | 'independent_review'
  | 'user_gate' | 'commit' | 'done' | 'error';

export interface EvidenceRecord {
  id: string;
  user_id: string;
  source: EvidenceSourceType;
  evidence_type: EvidenceType;
  occurred_at: string;
  captured_at: string;
  content_ref: string | null;
  context: Record<string, unknown> | null;
  privacy_level: PrivacyLevel;
  quality_flags: Record<string, unknown> | null;
  status: 'active' | 'deleted' | 'invalid';
  provenance: { resource_type?: string; resource_id?: string } | null;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
}

export interface PatternCandidate {
  id: string;
  user_id: string;
  statement: string;
  scope: string | null;
  support_ids: string[];
  counter_ids: string[];
  alternative_explanations: string[];
  recurrence_count: number;
  domain_count: number;
  last_seen: string | null;
  review_state: PatternReviewState;
  user_note: string | null;
  created_at: string;
}

export interface ExperienceUnit {
  id: string;
  user_id: string;
  context: string | null;
  problem: string | null;
  actions: string[] | null;
  outcome: string | null;
  lesson: string | null;
  support_ids: string[];
  counter_ids: string[];
  applicability: string | null;
  maturity: ExperienceMaturity;
  last_validated_at: string | null;
  version: number;
  created_at: string;
}

export interface PersonalSkill {
  id: string;
  user_id: string;
  trigger: string | null;
  preconditions: string[] | null;
  procedure: string[] | null;
  anti_patterns: string[] | null;
  scope: string | null;
  evidence_refs: string[];
  last_validated_at: string | null;
  expiry_review: string | null;
  version: number;
  created_at: string;
}

export type MetaPrincipleStatus = 'candidate' | 'keep' | 'watch' | 'reject' | 'stale';

export interface MetaPrinciple {
  id: string;
  user_id: string;
  statement: string;
  domains: string[];
  evidence: string[];
  counterevidence: string[];
  status: MetaPrincipleStatus;
  last_validated: string | null;
  created_at: string;
}

/**
 * 个人模型完整快照（V4.3 §4.25）。
 *
 * 项目书附录AE最小Schema：snapshot/change_log/reason/created_at。
 * `reason`（用户可读的变化原因）存储在 change_log.change_summary 中，
 * 由后端 pipeline.ts stage8_commit 写入，满足附录AH验收要求。
 */
export interface PersonalModelVersion {
  id: string;
  user_id: string;
  version: string;
  snapshot: Record<string, unknown>;
  change_log: Record<string, unknown> | null;  // 含 change_summary（= reason）
  status: 'active' | 'archived' | 'superseded';
  created_at: string;
}

export interface DistillationJob {
  id: string;
  user_id: string;
  trigger: 'manual' | 'scheduled' | 'event' | 'project_end' | 'major_correction' | 'milestone';
  /**
   * input_scope 严格对齐后端 backend/src/db.ts rowToDistillationJob 的 JSON 解析结构：
   *   - timeWindow：{ start, end } 对象（ISODate），非字符串
   *   - project / topic / trigger：可选上下文标识
   * 旧库的 input_scope 字段为 JSON 字符串，由后端 rowToDistillationJob 解析为对象后通过 API 返回。
   */
  input_scope: {
    timeWindow?: { start: string; end: string };
    project?: string;
    topic?: string;
    trigger?: string;
  } | null;
  stage: DistillationStage;
  result: Record<string, any> | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ModelCorrection {
  id: string;
  user_id: string;
  target_id: string;
  /** V4.3 Task 8：扩展含 'meta_principle'，对齐后端 CorrectionTargetType */
  target_type: CorrectionTargetType;
  correction_type: CorrectionType;
  user_text: string | null;
  target_pattern: string | null;
  created_at: string;
}

// === V4.3 Task 25：数据源权限（source_permissions 表对齐） ===

/**
 * 数据源类型（对齐后端 DataType）。
 * 与 evidence_records.source 不同 —— 此处是用户授权层面的数据源分类。
 */
export type DataType =
  | 'calendar' | 'task' | 'health' | 'device_usage' | 'desktop_usage' | 'nutrition'
  | 'location' | 'photo' | 'microphone' | 'notification';

/**
 * 数据源权限记录（V4.3 §4.25 / Task 25.3）。
 * 一条记录代表一次授权或撤销；revoke 不删除历史，仅置 revoked_at。
 */
export interface SourcePermission {
  id: string;
  user_id: string;
  data_type: DataType;
  purpose: string | null;
  scope: Record<string, unknown> | null;
  granted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// === V4.3 服务契约类型 ===

export type ReflectionDepth = 'R0' | 'R1' | 'R2' | 'R3';
export type AgencyLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
export type DataScopeAxis = 'D0' | 'D1' | 'D2' | 'D3' | 'D4';
export type ProactivityLevel = 'P0' | 'P1' | 'P2' | 'P3';
export type AvatarVisibility = 'V0' | 'V1' | 'V2' | 'V3';
export type SupporterMode = 'S0' | 'S1' | 'S2';
export type UsageMode = 'quiet-mirror' | 'action-nav' | 'long-project' | 'voice-life' | 'explore-growth' | 'senior-easy';

export interface AccessibilityProfile {
  font_scale?: number;  // 1.0 默认，最大 2.0
  voice_readout?: boolean;
  single_confirm?: boolean;
  usage_mode?: UsageMode;
}

export interface QuietHours {
  start: string;  // 'HH:mm'
  end: string;
}

export interface ServiceContract {
  user_id: string;
  reflection_depth: ReflectionDepth;
  agency_level: AgencyLevel;
  data_scope: Record<DataScopeAxis, boolean>;
  proactivity: ProactivityLevel;
  avatar: AvatarVisibility;
  supporter_mode: SupporterMode;
  accessibility_profile: AccessibilityProfile;
  quiet_hours: QuietHours | null;
  high_impact_confirmation: boolean;
  model_provider: string;
  local_only: boolean;
  consent_version: string | null;
  policy_version: string | null;
  updated_at: string;
}

// === V4.3 Task 14：秘书页四步高影响动作流程（spec A13 / §2.2 / §3.2） ===

/**
 * 高影响动作分类（spec A13.5 / Safety Agent veto 场景）。
 * 这五类动作默认禁止自治，必须 A4 + 用户显式授权才能进入四步流程。
 */
export type HighImpactCategory =
  | 'payment'                  // 支付
  | 'public_release'           // 公开发布
  | 'medical'                  // 医疗
  | 'relationship_termination' // 关系终止
  | 'legal_document';          // 法律文件

/**
 * 行动卡预览（spec A13.3：执行前显示将做什么、影响什么、是否可撤销）。
 * 由前端基于用户请求本地构造，不依赖 LLM 生成（避免推卸责任给模型）。
 */
export interface ActionPreview {
  /** 动作简述（将做什么），如「准备会议纪要草稿」 */
  action: string;
  /** 影响范围（影响什么），如「生成一份草稿，只保存到你的日记」 */
  impact: string;
  /** 是否可撤销 */
  reversible: boolean;
  /** 是否为高影响动作 */
  highImpact: boolean;
  /** 高影响分类（仅当 highImpact=true 时填充） */
  highImpactCategory?: HighImpactCategory;
  /** 步骤列表，逐项执行并报告结果（spec A13.4 不伪装成功） */
  steps: string[];
  /** 来源请求文本（用户原始输入） */
  sourceRequest: string;
}

/**
 * 动作执行结果（spec A13.4：明确列出已完成和未完成，不伪装成功）。
 * partial_failure 状态（SubTask 14.8）逐项显示成功/失败。
 */
export interface ActionExecutionResult {
  /** 状态：success 全部成功 / partial_failure 部分失败 / failed 全部失败 */
  status: 'success' | 'partial_failure' | 'failed';
  /** 已完成步骤（按完成顺序） */
  completedSteps: string[];
  /** 失败步骤（含错误信息），不伪装成功 */
  failedSteps: { step: string; error: string }[];
  /** 是否可撤销 */
  undoable: boolean;
  /** 执行时间戳 */
  executedAt: ISODate;
  /** 关联的预览，便于回执展示「这次执行了什么」 */
  previewRef?: ActionPreview;
}

/** 动作流状态机（spec A13.5 四步流程：预览 → 确认 → 执行 → 回执/撤销） */
export type ActionFlowState = 'idle' | 'previewing' | 'confirming' | 'executing' | 'receipt';

/** 秘书六场景（spec A13.7） */
export type SecretaryScene = 'daily' | 'meeting' | 'learning' | 'project' | 'task_group' | 'life';

// === V4.8 默认服务契约：镜像主画布默认动态 3D，用户可随时降级 ===
export const DEFAULT_SERVICE_CONTRACT: Omit<ServiceContract, 'user_id' | 'updated_at'> = {
  reflection_depth: 'R1',
  agency_level: 'A1',
  data_scope: { D0: true, D1: false, D2: false, D3: false, D4: false },
  proactivity: 'P1',
  avatar: 'V3',
  supporter_mode: 'S0',
  accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'quiet-mirror' },
  quiet_hours: null,
  high_impact_confirmation: true,
  model_provider: 'deepseek',
  local_only: false,
  consent_version: null,
  policy_version: null,
};
