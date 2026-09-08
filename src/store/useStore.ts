import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  UserProfile, Commitment, Hypothesis, Experiment, MeaningDirection, SkillTrack,
  Project, Permission, AuditEntry, StateSnapshot, ChatMessage, LifeEvent,
  ProactivityLevel,
} from '../types/models';
import { api, unwrapList, type AuditPage } from '../services/api';
import { seedDemoDataIfEmpty } from '../services/seedSync';
import { seedPermissions } from '../data/seed';
import { toStateSnapshot } from '../engine/stateAdapter';
import { enqueue, flush, currentStatus, clearConflicts, clearQueue, type SyncConflict } from '../services/sync';
import { useServiceContractStore } from './useServiceContractStore';
import { inferJournalDomain, journalSourceLabel, journalTitle, type JournalInputOptions } from '../ai-native/intake/journalRecord';

const PROFILE_KEY = 'zx_profile';

const defaultUser: UserProfile = {
  name: '我',
  lifeStage: '成年人',
  constraints: [],
  onboarded: false,
  silentMode: false,        // 向后兼容（= proactivity === 'P0'）
  proactivity: 'P1',        // V4.3 Task 9.6：四级主动性默认 P1（每天一次）
  secretaryLevel: 'L2',
  weeksOfData: 0,
};

const emptyState: StateSnapshot = {
  inner: { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 },
  outer: { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 },
  divergence: 0,
  changePositions: [],
  evidenceLevels: { L1: 'insufficient', L2: 'insufficient', L3: 'insufficient', L4: 'insufficient', L5: 'insufficient', L6: 'insufficient' },
  note: '尚无足够数据',
};

interface AppState {
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
  chat: ChatMessage[];
  hydrated: boolean;
  hydrating: boolean;
  sync: { pending: number; conflicts: SyncConflict[]; lastError: string | null };

  hydrate: (email?: string, displayName?: string) => Promise<void>;
  completeOnboarding: (p: Partial<UserProfile>, commitments: Commitment[]) => Promise<void>;
  toggleSilentMode: () => void;
  /** V4.3 Task 9.6：四级主动性（P0 不主动 / P1 每天一次 / P2 有变化才说 / P3 立即提醒） */
  setProactivity: (level: ProactivityLevel) => void;
  setSecretaryLevel: (l: UserProfile['secretaryLevel']) => void;
  togglePermission: (id: string) => void;
  hypothesisAction: (id: string, action: 'confirm' | 'refute' | 'expire', note?: string) => Promise<void>;
  /**
   * Task 8：用户纠正状态机本地同步（spec A4.2 / SubTask 8.4）。
   * 仅更新本地假设状态与历史，不再调 pushMutation —— 状态变更已由后端 /corrections 端点在事务内完成。
   * 调用方应在 useEvidenceStore.createCorrection 成功返回后调用本方法。
   */
  applyHypothesisCorrection: (id: string, newStatus: Hypothesis['status'], note?: string) => void;
  experimentAction: (id: string, action: 'accept' | 'decline' | 'stop' | 'complete') => Promise<void>;
  /**
   * V4.3 Task 21.2 / spec A16.1：在引导步骤 5「第一件重要的事」中创建一个新实验。
   *
   * 流程（spec 严格规则）：
   *   1. 本地以 status='proposed' 推入 store.experiments（乐观更新）
   *   2. POST /api/data/experiments 创建服务端记录（带幂等键 exp:<id>）
   *   3. 调用方随后调 experimentAction(id, 'accept') 将状态 PATCH 为 'active'
   *
   * 不直接落 'active' 是为了让 SubTask 21.2 的「onPress 调 experimentAction 创建实验」语义保持单一路径
   * （创建走 addExperiment，激活走 experimentAction），与既有方法职责清晰隔离。
   */
  addExperiment: (e: Experiment) => Promise<void>;
  checkInExperiment: (id: string, note: string) => Promise<void>;
  addJournal: (text: string, options?: JournalInputOptions) => Promise<void>;
  addCommitment: (c: Commitment) => Promise<void>;
  addChat: (msgs: ChatMessage[]) => void;
  forgetEvent: (id: string) => Promise<void>;
  refreshState: () => Promise<void>;
  flushSync: () => Promise<void>;
  resolveConflicts: () => Promise<void>;
  resetStore: () => Promise<void>;
  pushAudit: (actor: string, action: string, targetRef?: string) => void;
}

async function loadProfile(): Promise<UserProfile> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // V4.3 Task 9.6 迁移：旧 profile 含 silentMode 但无 proactivity → silentMode=true 映射为 P0，否则 P1
      const migrated: UserProfile = { ...defaultUser, ...parsed };
      const p = parsed.proactivity;
      if (p !== 'P0' && p !== 'P1' && p !== 'P2' && p !== 'P3') {
        migrated.proactivity = parsed.silentMode === true ? 'P0' : 'P1';
      }
      // silentMode 始终从 proactivity 派生，避免双源真相
      migrated.silentMode = migrated.proactivity === 'P0';
      return migrated;
    }
  } catch { /* ignore */ }
  return defaultUser;
}

async function saveProfile(p: UserProfile): Promise<void> {
  try { await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** V4.3 Task 9.6：四级主动性短标签（用于 UI 显示） */
export function proactivityShortLabel(p: ProactivityLevel): string {
  return { P0: '静默中', P1: '每天', P2: '有变化', P3: '立即' }[p];
}

export const useStore = create<AppState>((set, get) => {
  // 写入经同步队列：乐观更新已在本机完成，这里只负责把写操作可靠送达服务端
  const pushMutation = (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    idempotencyKey: string,
  ) => {
    enqueue({ method, path, body, idempotencyKey }).then(syncStatus).catch(() => {});
  };
  const syncStatus = () => {
    const st = currentStatus();
    set({ sync: { pending: st.pending, conflicts: st.conflicts, lastError: null } });
  };

  return {
    user: defaultUser,
    events: [],
    commitments: [],
    hypotheses: [],
    experiments: [],
    directions: [],
    skills: [],
    projects: [],
    permissions: seedPermissions,
    audit: [],
    state: emptyState,
    chat: [],
    hydrated: false,
    hydrating: false,
    sync: { pending: 0, conflicts: [], lastError: null },

    hydrate: async (email, displayName) => {
      if (get().hydrating || get().hydrated) return;
      set({ hydrating: true });
      try {
        const profile = await loadProfile();
        if (!profile.name || profile.name === '我') {
          if (displayName) profile.name = displayName;
        }
        set({ user: profile });

        const [events, commitments, hypotheses, experiments, projects, skills, meanings, state, auditRaw] = await Promise.all([
          api.get<LifeEvent[]>('/api/data/events'),
          api.get<Commitment[]>('/api/data/commitments'),
          api.get<Hypothesis[]>('/api/data/hypotheses'),
          api.get<Experiment[]>('/api/data/experiments'),
          api.get<Project[]>('/api/data/projects'),
          api.get<SkillTrack[]>('/api/data/skills'),
          api.get<MeaningDirection[]>('/api/data/meanings'),
          api.get<StateSnapshot>('/api/data/state'),
          api.get<AuditPage>('/api/data/audit'),
        ]);
        const audit = unwrapList<AuditEntry>(auditRaw);

        if (email === 'demo@zhixingos.com') {
          const demoProfile: UserProfile = { ...profile, name: '一舟', onboarded: true, secretaryLevel: 'L2', weeksOfData: 6, constraints: ['季度冲刺期工作强度大', '周末需陪伴家人', '晚间 23 点后精力明显下降'] };
          await saveProfile(demoProfile);
          if (events.length === 0) {
            await seedDemoDataIfEmpty();
            const [e2, c2, h2, x2, p2, s2, m2, st2, a2Raw] = await Promise.all([
              api.get<LifeEvent[]>('/api/data/events'),
              api.get<Commitment[]>('/api/data/commitments'),
              api.get<Hypothesis[]>('/api/data/hypotheses'),
              api.get<Experiment[]>('/api/data/experiments'),
              api.get<Project[]>('/api/data/projects'),
              api.get<SkillTrack[]>('/api/data/skills'),
              api.get<MeaningDirection[]>('/api/data/meanings'),
              api.get<StateSnapshot>('/api/data/state'),
              api.get<AuditPage>('/api/data/audit'),
            ]);
            const a2 = unwrapList<AuditEntry>(a2Raw);
            set({ user: demoProfile, events: e2, commitments: c2, hypotheses: h2, experiments: x2, projects: p2, skills: s2, directions: m2, state: toStateSnapshot(st2, { events: e2, commitments: c2, experiments: x2 }), audit: a2, hydrated: true, hydrating: false });
          } else {
            set({ user: demoProfile, events, commitments, hypotheses, experiments, projects, skills, directions: meanings, state: toStateSnapshot(state, { events, commitments, experiments }), audit, hydrated: true, hydrating: false });
          }
          flush().then(syncStatus).catch(() => {});
          return;
        }

        set({
          events, commitments, hypotheses, experiments, projects, skills, directions: meanings,
          state: toStateSnapshot(state, { events, commitments, experiments }), audit, hydrated: true, hydrating: false,
        });
        flush().then(syncStatus).catch(() => {});
      } catch (e: any) {
        set({ hydrating: false, sync: { pending: 0, conflicts: [], lastError: e?.message ?? '数据加载失败' } });
      }
    },

    completeOnboarding: async (p, commitments) => {
      // V4.3 Task 21：记录首次完成引导的时间戳，供 Day 0/7/30 里程碑检测使用。
      // 若 p.onboardedAt 已传入则尊重；否则取当前时间。演示账号迁移路径保留向后兼容。
      const onboardedAt = p.onboardedAt ?? new Date().toISOString();
      const next: UserProfile = { ...get().user, ...p, onboarded: true, onboardedAt };
      await saveProfile(next);
      for (const c of commitments) {
        pushMutation('POST', '/api/data/commitments', c, `cm:${c.id}`);
      }
      set({ user: next, commitments });
      await get().refreshState();
      await get().flushSync();
    },

    toggleSilentMode: () => {
      // V4.3 Task 9.6：向后兼容包装 —— 在 P0 与 P1 之间切换（等价于旧布尔开关）
      const cur = get().user.proactivity;
      const next: ProactivityLevel = cur === 'P0' ? 'P1' : 'P0';
      get().setProactivity(next);
    },

    setProactivity: (level) => {
      // V4.3 Task 9.6：四级主动性同步到 UserProfile.proactivity 与服务契约 proactivity
      // silentMode 由 proactivity 派生（= level === 'P0'），保持向后兼容
      get().pushAudit('用户', `调整主动性至 ${level}`);
      const u: UserProfile = {
        ...get().user,
        proactivity: level,
        silentMode: level === 'P0',
      };
      saveProfile(u);
      set({ user: u });
      // 同步到服务契约 store（P 轴），后端 LLM 上下文裁剪将读此字段
      // 注：useServiceContractStore.update 内部已含乐观更新 + 网络重试，幂等键 sec: 前缀
      // 此处不阻塞 UI；如服务契约尚未 load（首次进入），由 SovereigntyScreen 触发 load 后会自动同步
      try {
        const sc = useServiceContractStore.getState();
        if (sc.contract && sc.contract.user_id) {
          sc.update(sc.contract.user_id, { proactivity: level }).catch(() => { /* 同步层重试 */ });
        }
      } catch { /* store 尚未初始化 */ }
    },

    setSecretaryLevel: (l) => {
      get().pushAudit('用户', `调整秘书权限等级至 ${l}`);
      const u = { ...get().user, secretaryLevel: l };
      saveProfile(u);
      set({ user: u });
    },

    togglePermission: (id) => {
      const perm = get().permissions.find((x) => x.id === id);
      if (!perm) return;
      const next = !perm.granted;
      get().pushAudit('用户', `${next ? '授予' : '撤回'}权限：${perm.kind}`);
      set((s) => ({
        permissions: s.permissions.map((x) =>
          x.id === id ? { ...x, granted: next, grantedAt: next ? new Date().toISOString() : x.grantedAt } : x,
        ),
      }));
    },

    hypothesisAction: async (id, action, note) => {
      const h = get().hypotheses.find((x) => x.id === id);
      if (!h) return;
      const status = action === 'confirm' ? 'confirmed' : action === 'refute' ? 'refuted' : 'expired';
      const label = action === 'confirm' ? '确认' : action === 'refute' ? '推翻' : '标记过期';
      const updated: Hypothesis = {
        ...h,
        status,
        history: [...h.history, { at: new Date().toISOString(), change: `用户${label}${note ? `（${note}）` : ''}`, confidence: h.confidence }],
      };
      set((s) => ({ hypotheses: s.hypotheses.map((x) => (x.id === id ? updated : x)) }));
      get().pushAudit('用户', `${label}假设 ${id}`);
      pushMutation('PATCH', `/api/data/hypotheses/${id}`, { status, history: updated.history }, `hy:${id}`);
      await get().refreshState();
    },

    applyHypothesisCorrection: (id, newStatus, note) => {
      const h = get().hypotheses.find((x) => x.id === id);
      if (!h) return;
      // 仅本地更新（后端 /corrections 端点已在事务内完成 hypothesis.status 变更）
      const labelMap: Record<string, string> = {
        rejected: '不像我',
        revised: '原因不是这个',
      };
      const label = labelMap[newStatus] ?? newStatus;
      const updated: Hypothesis = {
        ...h,
        status: newStatus,
        history: [...h.history, { at: new Date().toISOString(), change: `用户纠正：${label}${note ? `（${note}）` : ''}`, confidence: h.confidence }],
      };
      set((s) => ({ hypotheses: s.hypotheses.map((x) => (x.id === id ? updated : x)) }));
      get().pushAudit('用户', `纠正假设 ${id}：${label}`);
    },

    experimentAction: async (id, action) => {
      const statusMap = { accept: 'active', decline: 'declined', stop: 'stopped', complete: 'completed' } as const;
      const e = get().experiments.find((x) => x.id === id);
      if (!e) return;
      const updated = { ...e, status: statusMap[action] as Experiment['status'] };
      set((s) => ({ experiments: s.experiments.map((x) => (x.id === id ? updated : x)) }));
      get().pushAudit('用户', `实验 ${id}：${{ accept: '接受并开始', decline: '拒绝', stop: '主动停止', complete: '完成' }[action]}`);
      pushMutation('PATCH', `/api/data/experiments/${id}`, { status: updated.status }, `ex:${id}:${action}`);
      await get().refreshState();
    },

    // V4.3 Task 21.2 / spec A16.1：引导步骤 5 创建新实验。
    // 严格规则：本地乐观更新 + 后端 POST + 不替换已有同 id 实验（幂等）。
    addExperiment: async (e) => {
      // 幂等：若已存在同 id 则不重复推入（避免 onboarding 重入导致重复）
      if (get().experiments.some((x) => x.id === e.id)) return;
      set((s) => ({ experiments: [e, ...s.experiments] }));
      get().pushAudit('用户', `创建实验 ${e.id}：${e.kind}（${e.status}）`);
      pushMutation('POST', '/api/data/experiments', e, `ex:${e.id}`);
      try { await get().refreshState(); } catch { /* 网络重试由同步层负责 */ }
    },

    checkInExperiment: async (id, note) => {
      const e = get().experiments.find((x) => x.id === id);
      if (!e) return;
      const checkIn = { date: new Date().toISOString(), done: true, note };
      const checkIns = [...e.checkIns, checkIn];
      set((s) => ({ experiments: s.experiments.map((x) => (x.id === id ? { ...x, checkIns } : x)) }));
      get().pushAudit('用户', `实验 ${id} 打卡：${note}`);
      pushMutation('PATCH', `/api/data/experiments/${id}`, { checkIns }, `ex:${id}:ck:${checkIn.date}`);
      await get().refreshState();
    },

    addJournal: async (text, options = {}) => {
      const clean = text.trim();
      if (!clean) return;
      const sourceRef = options.sourceRef ?? 'text-diary';
      const ev: LifeEvent = {
        id: `j-${Date.now()}`,
        type: 'journal',
        title: journalTitle(clean, options.titlePrefix ?? '日记'),
        sourceType: 'user',
        sourceRef,
        startTime: new Date().toISOString(),
        domain: options.domain ?? inferJournalDomain(clean),
        sensitivity: options.sensitivity ?? 'sensitive',
        confidence: 1,
        consentId: options.consentId ?? 'perm-journal',
        layer: 'fact',
        axis: 'inner',
        userInterpretation: clean,
      };
      set((s) => ({ events: [ev, ...s.events] }));
      get().pushAudit('用户', `记录一条${journalSourceLabel(sourceRef)}记录`);
      pushMutation('POST', '/api/data/events', ev, `ev:${ev.id}`);
      try { await get().refreshState(); } catch { /* 网络重试由同步层负责 */ }
    },

    addCommitment: async (c) => {
      set((s) => ({ commitments: [c, ...s.commitments] }));
      pushMutation('POST', '/api/data/commitments', c, `cm:${c.id}`);
      try { await get().refreshState(); } catch { /* 网络重试由同步层负责 */ }
    },

    addChat: (msgs) => set((s) => ({ chat: [...s.chat, ...msgs] })),

    forgetEvent: async (id) => {
      set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
      get().pushAudit('用户', `删除事件 ${id}：原始记录与派生推断已彻底清除`);
      pushMutation('DELETE', `/api/data/events/${id}`, undefined, `evdel:${id}`);
      try { await get().refreshState(); } catch { /* 网络重试由同步层负责 */ }
    },

    refreshState: async () => {
      try {
        const raw = await api.get<any>('/api/data/state');
        set({ state: toStateSnapshot(raw, { events: get().events, commitments: get().commitments, experiments: get().experiments }) });
      } catch { /* 状态刷新失败不阻塞，保留本地状态 */ }
    },

    flushSync: async () => {
      const st = await flush();
      set({ sync: st });
    },

    resolveConflicts: async () => {
      await clearConflicts();
      syncStatus();
    },

    // P0-7：账号注销后清空本机全部数据与令牌残留，回到初始状态
    resetStore: async () => {
      try { await AsyncStorage.removeItem(PROFILE_KEY); } catch { /* ignore */ }
      try { await clearQueue(); } catch { /* ignore */ }
      set({
        user: defaultUser, events: [], commitments: [], hypotheses: [], experiments: [],
        directions: [], skills: [], projects: [], permissions: seedPermissions, audit: [],
        state: emptyState, chat: [], hydrated: false, hydrating: false,
        sync: { pending: 0, conflicts: [], lastError: null },
      });
    },

    pushAudit: (actor, action, targetRef) =>
      set((s) => ({
        audit: [{ id: `au${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), actor, action, targetRef }, ...s.audit],
      })),
  };
});

// V4.3：本 useStore 保留以维持向后兼容（现有页面 import 不变）。
// 新功能请优先使用按业务域拆分的子 store：
//   - useServiceContractStore  服务契约（R/A/D/P/V/S 维度）
//   - useEvidenceStore         证据/模式/经验/技能/元原理/模型版本/纠正
//   - useDistillationStore     自我沉淀作业
//   - useProactiveStore        主动性等级 P0-P3（向后兼容 silentMode：P0 ≡ silentMode=true）
