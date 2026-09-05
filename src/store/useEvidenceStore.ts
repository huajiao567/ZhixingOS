import { create } from 'zustand';
import {
  EvidenceRecord,
  PatternCandidate,
  ExperienceUnit,
  PersonalSkill,
  MetaPrinciple,
  PersonalModelVersion,
  ModelCorrection,
  CorrectionType,
  CorrectionTargetType,
} from '../types/models';
import { api, unwrapList, type Paginated } from '../services/api';
import { enqueue } from '../services/sync';

interface EvidenceState {
  evidence: EvidenceRecord[];
  patterns: PatternCandidate[];
  experiences: ExperienceUnit[];
  personalSkills: PersonalSkill[];
  metaPrinciples: MetaPrinciple[];
  modelVersions: PersonalModelVersion[];
  corrections: ModelCorrection[];

  loadAll: (userId: string) => Promise<void>;
  addEvidence: (e: EvidenceRecord) => void;
  addPattern: (p: PatternCandidate) => void;
  updatePattern: (id: string, patch: Partial<PatternCandidate>) => void;
  addExperience: (e: ExperienceUnit) => void;
  updateExperience: (id: string, patch: Partial<ExperienceUnit>) => void;
  addPersonalSkill: (s: PersonalSkill) => void;
  updatePersonalSkill: (id: string, patch: Partial<PersonalSkill>) => void;
  addMetaPrinciple: (m: MetaPrinciple) => void;
  updateMetaPrinciple: (id: string, patch: Partial<MetaPrinciple>) => void;
  addModelVersion: (v: PersonalModelVersion) => void;
  addCorrection: (c: ModelCorrection) => void;
  /**
   * Task 8：提交用户纠正并同步本地状态（spec A4.2 / SubTask 8.4）。
   * - 直接调 api.corrections.create 拿到后端处理后的 ModelCorrection
   * - 在 corrections 数组前插入新 correction
   * - 若 correction_type 影响本地 patterns/modelVersions 状态，同步更新对应项
   * - 不再调用 pushMutation（/corrections 端点已在事务内完成所有变更）
   * - 返回创建的 ModelCorrection，调用方可据此更新 useStore.hypotheses
   */
  createCorrection: (input: {
    target_id: string;
    target_type: CorrectionTargetType;
    correction_type: CorrectionType;
    user_text?: string | null;
  }) => Promise<ModelCorrection>;
}

function pushMutation(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  idempotencyKey: string,
) {
  enqueue({ method, path, body, idempotencyKey }).catch(() => {
    // 同步队列负责重试，store 内不阻塞
  });
}

export const useEvidenceStore = create<EvidenceState>((set, get) => ({
  evidence: [],
  patterns: [],
  experiences: [],
  personalSkills: [],
  metaPrinciples: [],
  modelVersions: [],
  corrections: [],

  loadAll: async (_userId) => {
    const [ev, pa, ex, sk, mp, mvRaw, coRaw] = await Promise.all([
      api.get<EvidenceRecord[]>('/api/data/evidence').catch(() => [] as EvidenceRecord[]),
      api.get<PatternCandidate[]>('/api/data/patterns').catch(() => [] as PatternCandidate[]),
      api.get<ExperienceUnit[]>('/api/data/experiences').catch(() => [] as ExperienceUnit[]),
      api.get<PersonalSkill[]>('/api/data/personal-skills').catch(() => [] as PersonalSkill[]),
      api.get<MetaPrinciple[]>('/api/data/meta-principles').catch(() => [] as MetaPrinciple[]),
      api.get<Paginated<PersonalModelVersion>>('/api/data/model-versions').catch(() => ({ items: [], nextCursor: null })),
      api.get<Paginated<ModelCorrection>>('/api/data/corrections').catch(() => ({ items: [], nextCursor: null })),
    ]);
    const mv = unwrapList<PersonalModelVersion>(mvRaw);
    const co = unwrapList<ModelCorrection>(coRaw);
    set({
      evidence: ev,
      patterns: pa,
      experiences: ex,
      personalSkills: sk,
      metaPrinciples: mp,
      modelVersions: mv,
      corrections: co,
    });
  },

  addEvidence: (e) => {
    set((s) => ({ evidence: [e, ...s.evidence] }));
    pushMutation('POST', '/api/data/evidence', e, `ev:${e.id}`);
  },

  addPattern: (p) => {
    set((s) => ({ patterns: [p, ...s.patterns] }));
    pushMutation('POST', '/api/data/patterns', p, `pat:${p.id}`);
  },

  updatePattern: (id, patch) => {
    set((s) => ({ patterns: s.patterns.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    pushMutation('PATCH', `/api/data/patterns/${id}`, patch, `pat:${id}:upd`);
  },

  addExperience: (e) => {
    set((s) => ({ experiences: [e, ...s.experiences] }));
    pushMutation('POST', '/api/data/experiences', e, `exp:${e.id}`);
  },

  updateExperience: (id, patch) => {
    set((s) => ({ experiences: s.experiences.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    pushMutation('PATCH', `/api/data/experiences/${id}`, patch, `exp:${id}:upd`);
  },

  addPersonalSkill: (sk) => {
    set((s) => ({ personalSkills: [sk, ...s.personalSkills] }));
    pushMutation('POST', '/api/data/personal-skills', sk, `psk:${sk.id}`);
  },

  updatePersonalSkill: (id, patch) => {
    set((s) => ({ personalSkills: s.personalSkills.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    pushMutation('PATCH', `/api/data/personal-skills/${id}`, patch, `psk:${id}:upd`);
  },

  addMetaPrinciple: (m) => {
    set((s) => ({ metaPrinciples: [m, ...s.metaPrinciples] }));
    pushMutation('POST', '/api/data/meta-principles', m, `mep:${m.id}`);
  },

  updateMetaPrinciple: (id, patch) => {
    set((s) => ({ metaPrinciples: s.metaPrinciples.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    pushMutation('PATCH', `/api/data/meta-principles/${id}`, patch, `mep:${id}:upd`);
  },

  addModelVersion: (v) => {
    set((s) => ({ modelVersions: [v, ...s.modelVersions] }));
    pushMutation('POST', '/api/data/model-versions', v, `pmv:${v.id}`);
  },

  addCorrection: (c) => {
    set((s) => ({ corrections: [c, ...s.corrections] }));
    pushMutation('POST', '/api/data/corrections', c, `mco:${c.id}`);
  },

  createCorrection: async (input) => {
    // 调 API 创建纠正（后端在事务中处理所有 6 种 correction_type 的状态变化）
    const created = await api.corrections.create(input);

    // 同步本地 corrections 数组（前插）
    set((s) => ({ corrections: [created, ...s.corrections] }));

    // 同步本地 patterns 数组（仅当 target_type='pattern' 且 correction_type 影响状态）
    if (input.target_type === 'pattern') {
      const pid = input.target_id;
      if (input.correction_type === 'unlike-me') {
        // pattern.review_state → 'reject'
        set((s) => ({
          patterns: s.patterns.map((p) =>
            p.id === pid ? { ...p, review_state: 'reject' as const } : p,
          ),
        }));
      } else if (input.correction_type === 'special-case') {
        // pattern.user_note 追加「[特殊情况 date] user_text」
        const dateStr = new Date().toISOString().slice(0, 10);
        const noteText = `[特殊情况 ${dateStr}] ${input.user_text ?? '(用户未提供说明)'}`;
        set((s) => ({
          patterns: s.patterns.map((p) =>
            p.id === pid
              ? { ...p, user_note: p.user_note ? `${p.user_note}\n${noteText}` : noteText }
              : p,
          ),
        }));
      } else if (input.correction_type === 'phase-changed') {
        // pattern.review_state → 'stale'
        set((s) => ({
          patterns: s.patterns.map((p) =>
            p.id === pid ? { ...p, review_state: 'stale' as const } : p,
          ),
        }));
        // 重新拉取 modelVersions 列表（后端已归档旧版本 + 创建新版本）
        try {
          const fresh = await api.get<Paginated<PersonalModelVersion>>('/api/data/model-versions');
          const list = unwrapList<PersonalModelVersion>(fresh);
          set({ modelVersions: list });
        } catch { /* 拉取失败不阻塞 UI，下次 hydrate 时会同步 */ }
      }
    }

    // wrong-reason 不在本 store 同步范围（hypothesis 状态由 useStore 负责）
    // wait / no-more-inference 仅记录 correction，不影响业务对象本地状态

    return created;
  },
}));
