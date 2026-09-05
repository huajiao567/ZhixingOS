export type IntakeKind = 'text' | 'photo' | 'audio' | 'calendar' | 'task' | 'device';
export type PrivacyLevel = 'D0' | 'D1' | 'D2' | 'D3';

export interface EventEnvelope<TPayload = unknown> {
  id: string;
  kind: IntakeKind;
  payload: TPayload;
  occurredAt: string;
  capturedAt: string;
  source: 'user' | 'device' | 'calendar' | 'task_app' | 'system';
  sourceRef: string;
  consentId: string;
  privacyLevel: PrivacyLevel;
  checksum?: string;
}

export type IntentKind =
  | 'capture_note'
  | 'create_task'
  | 'create_event'
  | 'create_course'
  | 'prepare_draft'
  | 'unknown';

export interface IntentTime {
  start?: string;
  end?: string;
  allDay?: boolean;
  timezone?: string;
  raw?: string;
}

export interface IntentGraph {
  id: string;
  sourceEnvelopeId: string;
  kind: IntentKind;
  title: string;
  detail?: string;
  time?: IntentTime;
  domain?: string;
  questions: string[];
  confidence: number;
  highImpact: boolean;
  highImpactCategory?: 'money' | 'public' | 'medical' | 'relationship' | 'legal';
  constraints: string[];
  rawText: string;
}

export type LifeObjectKind = 'note' | 'task' | 'event' | 'course' | 'draft' | 'project' | 'habit';

export interface LifeObject {
  id: string;
  kind: LifeObjectKind;
  title: string;
  detail?: string;
  status: 'draft' | 'active' | 'done' | 'cancelled';
  startsAt?: string;
  endsAt?: string;
  domain?: string;
  version: number;
  sourceRefs: string[];
  relations: { type: 'depends_on' | 'part_of' | 'conflicts_with' | 'supports'; targetId: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface ChangeEvidence {
  id: string;
  kind: 'fact' | 'self_report' | 'outcome' | 'constraint' | 'correction';
  quality: 'insufficient' | 'preliminary' | 'consistent';
  occurredAt: string;
  summary: string;
}

export interface ChangeContext {
  now: string;
  object: LifeObject;
  evidence: ChangeEvidence[];
  constraints: string[];
  commitments: string[];
  stakeholders: string[];
  recentMomentum: 'declining' | 'stable' | 'growing' | 'unknown';
  agencyLevel: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
}

export interface ChangeOperatorAssessment {
  operator: '时' | '位' | '势' | '应' | '变' | '中';
  fit: 'unknown' | 'weak' | 'balanced' | 'strong';
  reason: string;
  evidenceIds: string[];
}

export interface PathCandidate {
  id: string;
  title: string;
  summary: string;
  assessments: ChangeOperatorAssessment[];
  reversible: boolean;
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  stopCondition: string;
  reviewAt: string;
  evidenceGaps: string[];
  score: number;
}

export type SurfaceState = 'empty' | 'needs_input' | 'ready' | 'blocked';

export interface ContextSurface {
  id: string;
  state: SurfaceState;
  eyebrow: string;
  title: string;
  summary: string;
  object?: LifeObject;
  primaryPath?: PathCandidate;
  alternativePaths: PathCandidate[];
  questions: string[];
  evidenceNote: string;
}

export type ActionRisk = 'low' | 'medium' | 'high';

export interface ActionStep {
  id: string;
  executor: 'life_object' | 'calendar' | 'journal' | 'draft' | 'task' | string;
  operation: string;
  input: Record<string, unknown>;
  reversible: boolean;
}

export interface ActionPlan {
  id: string;
  idempotencyKey: string;
  sourceRequest: string;
  intentId: string;
  objectId?: string;
  title: string;
  summary: string;
  risk: ActionRisk;
  reversible: boolean;
  requiresConfirmation: boolean;
  steps: ActionStep[];
  reasoning?: PathCandidate;
}

export interface ActionStepResult {
  stepId: string;
  status: 'success' | 'failed';
  externalId?: string;
  message: string;
  undoToken?: string;
}

export interface ActionReceipt {
  id: string;
  planId: string;
  idempotencyKey: string;
  status: 'success' | 'partial_failure' | 'failed' | 'blocked' | 'undone';
  stepResults: ActionStepResult[];
  affectedObjectIds: string[];
  executedAt: string;
  undoable: boolean;
  undoneAt?: string;
  blockReason?: string;
}

export interface ActionExecutorResult {
  externalId?: string;
  objectId?: string;
  message: string;
  undoToken?: string;
}

export interface ActionExecutor {
  execute(step: ActionStep): Promise<ActionExecutorResult>;
  undo?(undoToken: string, step: ActionStep): Promise<void>;
}

export interface TwinEvidence {
  id: string;
  feature: string;
  value: number | string | boolean;
  scope: string;
  polarity: 'support' | 'counter';
  occurredAt: string;
  sourceRef: string;
}

export interface TwinTrait {
  feature: string;
  value: number | string | boolean;
  status: 'candidate' | 'confirmed' | 'stale';
  scope: string[];
  supportIds: string[];
  counterIds: string[];
  confidence: 'preliminary' | 'consistent';
  reviewAt: string;
}

export interface TwinProfile {
  id: string;
  version: number;
  identity: { displayName?: string; selfDescription?: string };
  currentState: Record<string, { value: number | string | boolean; evidenceId: string; expiresAt: string }>;
  traits: TwinTrait[];
  boundaries: string[];
  evidence: TwinEvidence[];
  archivedTraits: TwinTrait[];
  updatedAt: string;
}

