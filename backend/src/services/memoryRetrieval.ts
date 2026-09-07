/**
 * 本地优先的个人记忆检索层。
 *
 * 设计来源：借鉴 TencentDB Agent Memory 的 L0-L3 分层、来源追踪、
 * 预算化召回与资产治理思想，但不引入其团队/云端运行时。这里的权限裁剪
 * 由调用方先完成，检索只接触本次服务契约已经允许的数据。
 */
import type {
  CommitmentRow,
  EventRow,
  ExperienceUnit,
  ExperimentRow,
  HypothesisRow,
  MetaPrinciple,
  PatternCandidate,
  PersonalSkill,
  TwinProfileRecord,
} from '../types.js';

export type PersonalMemoryLayer = 'L0' | 'L1' | 'L2' | 'L3';
export type PersonalMemoryKind =
  | 'event'
  | 'commitment'
  | 'hypothesis'
  | 'experiment'
  | 'pattern'
  | 'experience'
  | 'skill'
  | 'meta_principle'
  | 'twin_identity'
  | 'twin_trait'
  | 'twin_boundary';

export interface MemoryContextData {
  events: EventRow[];
  commitments: CommitmentRow[];
  hypotheses: HypothesisRow[];
  experiments: ExperimentRow[];
  patterns: PatternCandidate[];
  experiences: ExperienceUnit[];
  personalSkills: PersonalSkill[];
  metaPrinciples: MetaPrinciple[];
  twinProfile: TwinProfileRecord | null;
}

export interface PersonalMemoryAsset {
  id: string;
  ownerUserId: string;
  layer: PersonalMemoryLayer;
  kind: PersonalMemoryKind;
  title: string;
  content: string;
  sourceRefs: string[];
  version: number;
  status: 'active';
  visibility: 'private';
  agentBindings: string[];
  createdAt: string;
  score: number;
}

export interface MemoryRecallReceipt {
  strategy: 'local-lexical-recency-v1';
  assetIds: string[];
  layers: Record<PersonalMemoryLayer, number>;
  totalChars: number;
  considered: number;
  omitted: number;
  partial: boolean;
  reason?: 'budget' | 'timeout';
  durationMs: number;
}

export interface MemoryRecallResult {
  selectedData: MemoryContextData;
  assets: PersonalMemoryAsset[];
  receipt: MemoryRecallReceipt;
}

export interface MemoryRecallOptions {
  ownerUserId: string;
  agentId: string;
  query?: string;
  maxItems?: number;
  maxTotalChars?: number;
  maxCharsPerAsset?: number;
  timeoutMs?: number;
  now?: string;
}

type SourceCollection = keyof Omit<MemoryContextData, 'twinProfile'> | 'twinProfile';

interface Candidate {
  asset: Omit<PersonalMemoryAsset, 'content' | 'score'> & { content: string };
  collection: SourceCollection;
  index: number;
  confidence: number;
  pinned: boolean;
}

const HAN = /\p{Script=Han}/u;
const WORDS = /[\p{Script=Han}]+|[\p{L}\p{N}]+/gu;

function normalizeText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

/** 中文连续文本增加二元组，避免整句只有一个 token；拉丁文本按词切分。 */
export function memoryTokens(text: string): string[] {
  const normalized = normalizeText(text);
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(WORDS)) {
    const segment = match[0];
    if (HAN.test(segment)) {
      if (segment.length <= 2) tokens.add(segment);
      else {
        for (let i = 0; i < segment.length - 1; i += 1) tokens.add(segment.slice(i, i + 2));
      }
    } else if (segment.length >= 2) {
      tokens.add(segment);
    }
  }
  return [...tokens];
}

function lexicalScore(query: string, content: string): number {
  const q = memoryTokens(query);
  if (q.length === 0) return 0;
  const body = normalizeText(content);
  let hits = 0;
  for (const token of q) if (body.includes(token)) hits += 1;
  const coverage = hits / q.length;
  const exact = body.includes(normalizeText(query)) ? 0.2 : 0;
  return Math.min(1, coverage + exact);
}

function recencyScore(createdAt: string, nowMs: number): number {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return 0;
  const days = Math.max(0, (nowMs - at) / 86_400_000);
  return Math.exp(-days / 45);
}

function clip(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function baseAsset(
  options: MemoryRecallOptions,
  value: {
    id: string;
    layer: PersonalMemoryLayer;
    kind: PersonalMemoryKind;
    title: string;
    content: string;
    sourceRefs?: string[];
    version?: number;
    createdAt?: string | null;
  },
): Candidate['asset'] {
  return {
    id: value.id,
    ownerUserId: options.ownerUserId,
    layer: value.layer,
    kind: value.kind,
    title: value.title,
    content: value.content,
    sourceRefs: value.sourceRefs ?? [],
    version: Math.max(1, value.version ?? 1),
    status: 'active',
    visibility: 'private',
    agentBindings: [options.agentId],
    createdAt: value.createdAt ?? options.now ?? new Date().toISOString(),
  };
}

function buildCandidates(data: MemoryContextData, options: MemoryRecallOptions): Candidate[] {
  const result: Candidate[] = [];
  const add = (
    collection: SourceCollection,
    index: number,
    asset: Candidate['asset'],
    confidence: number,
    pinned = false,
  ) => result.push({ collection, index, asset, confidence, pinned });

  data.events.forEach((event, index) => add('events', index, baseAsset(options, {
    id: event.id ?? `event:${event.created_at}:${index}`,
    layer: 'L0', kind: 'event', title: event.layer,
    content: `${event.content}${event.user_interpretation ? `；用户解释：${event.user_interpretation}` : ''}`,
    sourceRefs: event.id ? [event.id] : [], createdAt: event.created_at,
  }), event.source === 'user' ? 0.9 : 0.72));

  data.commitments.forEach((item, index) => {
    if (item.status !== 'active') return;
    add('commitments', index, baseAsset(options, {
      id: item.id, layer: 'L1', kind: 'commitment', title: item.domain,
      content: item.text, sourceRefs: [item.id], createdAt: item.created_at,
    }), Math.max(0.55, Math.min(1, item.weight)));
  });

  data.hypotheses.forEach((item, index) => {
    if (item.status !== 'testing' && item.status !== 'confirmed') return;
    add('hypotheses', index, baseAsset(options, {
      id: item.id, layer: 'L1', kind: 'hypothesis', title: '可反驳假设',
      content: item.statement, sourceRefs: [item.id], createdAt: item.created_at,
    }), Math.max(0.3, Math.min(0.9, item.confidence)));
  });

  data.patterns.forEach((item, index) => {
    if (item.review_state !== 'keep' && item.review_state !== 'watch') return;
    add('patterns', index, baseAsset(options, {
      id: item.id, layer: 'L2', kind: 'pattern', title: item.scope ?? '情境模式',
      content: item.statement, sourceRefs: [...item.support_ids, ...item.counter_ids],
      createdAt: item.last_seen ?? item.created_at,
    }), Math.min(1, 0.45 + item.support_ids.length * 0.08));
  });

  data.experiences.forEach((item, index) => {
    if (!['observed', 'repeated', 'validated'].includes(item.maturity)) return;
    const content = [item.context, item.problem, item.lesson, item.applicability].filter(Boolean).join('；');
    if (!content) return;
    const maturityConfidence = item.maturity === 'validated' ? 1 : item.maturity === 'repeated' ? 0.82 : 0.66;
    add('experiences', index, baseAsset(options, {
      id: item.id, layer: 'L2', kind: 'experience', title: item.context ?? '个人经验',
      content, sourceRefs: [...item.support_ids, ...item.counter_ids], version: item.version,
      createdAt: item.last_validated_at ?? item.created_at,
    }), maturityConfidence);
  });

  data.experiments.forEach((item, index) => {
    if (!['planned', 'running', 'active'].includes(item.status)) return;
    add('experiments', index, baseAsset(options, {
      id: item.id, layer: 'L2', kind: 'experiment', title: '当前实验',
      content: `${item.title}；周期 ${item.duration_days} 天；状态 ${item.status}`,
      sourceRefs: [item.id], createdAt: item.started_at,
    }), 0.72);
  });

  data.personalSkills.forEach((item, index) => {
    const procedure = strings(item.procedure).join(' → ');
    const content = [item.trigger, item.scope, procedure, ...strings(item.preconditions)].filter(Boolean).join('；');
    if (!content) return;
    add('personalSkills', index, baseAsset(options, {
      id: item.id, layer: 'L2', kind: 'skill', title: item.trigger ?? item.scope ?? '个人方法',
      content, sourceRefs: item.evidence_refs, version: item.version,
      createdAt: item.last_validated_at ?? item.created_at,
    }), Math.min(1, 0.55 + item.evidence_refs.length * 0.08));
  });

  data.metaPrinciples.forEach((item, index) => {
    if (item.status !== 'keep' && item.status !== 'watch') return;
    add('metaPrinciples', index, baseAsset(options, {
      id: item.id, layer: 'L3', kind: 'meta_principle', title: item.domains.join(' / ') || '跨情境原则',
      content: item.statement, sourceRefs: [...item.evidence, ...item.counterevidence],
      createdAt: item.last_validated ?? item.created_at,
    }), Math.min(1, 0.58 + item.evidence.length * 0.07));
  });

  const twin = data.twinProfile;
  const doc = twin?.doc;
  if (twin && doc && typeof doc === 'object') {
    const identity = doc.identity && typeof doc.identity === 'object'
      ? doc.identity as Record<string, unknown>
      : {};
    const selfDescription = typeof identity.selfDescription === 'string' ? identity.selfDescription.trim() : '';
    if (selfDescription) add('twinProfile', 0, baseAsset(options, {
      id: `twin:${twin.user_id}:identity`, layer: 'L3', kind: 'twin_identity', title: '用户自述',
      content: selfDescription, sourceRefs: [`twin-profile:${twin.version}`], version: twin.version,
      createdAt: twin.updated_at,
    }), 1, true);

    const traits = Array.isArray(doc.traits) ? doc.traits : [];
    traits.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return;
      const trait = raw as Record<string, unknown>;
      if (trait.status !== 'confirmed' || typeof trait.feature !== 'string') return;
      const value = ['string', 'number', 'boolean'].includes(typeof trait.value) ? String(trait.value) : '';
      if (!value) return;
      add('twinProfile', index + 1, baseAsset(options, {
        id: `twin:${twin.user_id}:trait:${trait.feature}`, layer: 'L3', kind: 'twin_trait',
        title: trait.feature, content: `${trait.feature}：${value}`,
        sourceRefs: strings(trait.supportIds), version: twin.version, createdAt: twin.updated_at,
      }), trait.confidence === 'consistent' ? 0.9 : 0.62);
    });

    // Boundaries are high priority, but must not monopolize all 16 recall slots.
    // Keep the latest eight; older corrections remain inspectable in the profile/version history.
    strings(doc.boundaries).slice(-8).forEach((boundary, index) => add('twinProfile', 10_000 + index, baseAsset(options, {
      id: `twin:${twin.user_id}:boundary:${index}`, layer: 'L3', kind: 'twin_boundary',
      title: '用户纠正与边界', content: boundary, sourceRefs: [`twin-profile:${twin.version}`],
      version: twin.version, createdAt: twin.updated_at,
    }), 1, true));
  }

  return result;
}

function emptySelected(): MemoryContextData {
  return {
    events: [], commitments: [], hypotheses: [], experiments: [], patterns: [],
    // Twin fields are represented only by selected, clipped assets. Returning the full
    // profile here would bypass the item/character budget for future callers.
    experiences: [], personalSkills: [], metaPrinciples: [], twinProfile: null,
  };
}

/**
 * 召回只返回私有且已绑定到当前 agent 的资产。稳定身份/纠正边界被固定携带；
 * 其他内容按词面相关性、证据质量、层级和时效综合排序，并受双重预算约束。
 */
export function recallPersonalMemory(data: MemoryContextData, options: MemoryRecallOptions): MemoryRecallResult {
  const started = Date.now();
  const maxItems = Math.max(1, Math.min(50, options.maxItems ?? 16));
  const maxTotalChars = Math.max(200, Math.min(20_000, options.maxTotalChars ?? 5_000));
  const maxCharsPerAsset = Math.max(80, Math.min(2_000, options.maxCharsPerAsset ?? 700));
  const timeoutMs = Math.max(1, Math.min(1_000, options.timeoutMs ?? 25));
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const query = options.query ?? '';
  const candidates = buildCandidates(data, options);
  const layerBase: Record<PersonalMemoryLayer, number> = { L0: 0.08, L1: 0.12, L2: 0.16, L3: 0.2 };

  const ranked = candidates.map((candidate) => {
    const lexical = lexicalScore(query, `${candidate.asset.title} ${candidate.asset.content}`);
    const freshness = recencyScore(candidate.asset.createdAt, Number.isFinite(nowMs) ? nowMs : Date.now());
    const score = candidate.pinned
      ? 10 + lexical
      : lexical * 0.62 + candidate.confidence * 0.2 + freshness * 0.1 + layerBase[candidate.asset.layer];
    return { ...candidate, score };
  }).sort((a, b) => b.score - a.score || b.asset.createdAt.localeCompare(a.asset.createdAt));

  // Candidate construction can incur one-time Unicode/locale initialization costs that vary by OS.
  // Apply the soft timeout to the actual selection phase so identical inputs do not recall zero
  // assets on slower runners before the first candidate is even considered.
  const selectionStarted = Date.now();
  const selected = emptySelected();
  const selectedCandidates: Array<Candidate & { score: number; boundedContent: string }> = [];
  let totalChars = 0;
  let reason: MemoryRecallReceipt['reason'];

  for (const candidate of ranked) {
    if (Date.now() - selectionStarted >= timeoutMs) { reason = 'timeout'; break; }
    if (selectedCandidates.length >= maxItems) { reason = 'budget'; break; }
    const boundedContent = clip(candidate.asset.content, maxCharsPerAsset);
    if (!boundedContent) continue;
    if (totalChars + boundedContent.length > maxTotalChars) { reason = 'budget'; continue; }
    selectedCandidates.push({ ...candidate, boundedContent });
    totalChars += boundedContent.length;
    if (candidate.collection !== 'twinProfile') {
      const target = selected[candidate.collection] as unknown[];
      const source = data[candidate.collection] as unknown[];
      target.push(source[candidate.index]);
    }
  }

  const assets: PersonalMemoryAsset[] = selectedCandidates.map(({ asset, score, boundedContent }) => ({
    ...asset,
    content: boundedContent,
    score: Math.round(score * 10_000) / 10_000,
  }));
  const layers: Record<PersonalMemoryLayer, number> = { L0: 0, L1: 0, L2: 0, L3: 0 };
  for (const asset of assets) layers[asset.layer] += 1;
  const omitted = Math.max(0, candidates.length - assets.length);

  return {
    selectedData: selected,
    assets,
    receipt: {
      strategy: 'local-lexical-recency-v1', assetIds: assets.map((asset) => asset.id), layers,
      totalChars, considered: candidates.length, omitted, partial: omitted > 0,
      reason: reason ?? (omitted > 0 ? 'budget' : undefined), durationMs: Date.now() - started,
    },
  };
}
