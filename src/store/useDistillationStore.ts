import { create } from 'zustand';
import { DistillationJob } from '../types/models';
import { api } from '../services/api';
import { enqueue } from '../services/sync';

interface DistillationState {
  jobs: DistillationJob[];
  loading: boolean;
  error: string | null;

  load: (userId: string) => Promise<void>;
  trigger: (userId: string, trigger: DistillationJob['trigger'], inputScope?: DistillationJob['input_scope']) => Promise<DistillationJob | null>;
  patchJob: (id: string, patch: Partial<DistillationJob>) => void;
}

export const useDistillationStore = create<DistillationState>((set, get) => ({
  jobs: [],
  loading: false,
  error: null,

  load: async (_userId) => {
    set({ loading: true, error: null });
    try {
      const jobs = await api.get<DistillationJob[]>('/api/data/distillation-jobs').catch(() => [] as DistillationJob[]);
      set({ jobs, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message ?? null });
    }
  },

  trigger: async (userId, trigger, inputScope) => {
    const job: DistillationJob = {
      id: `dj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      user_id: userId,
      trigger,
      input_scope: inputScope ?? null,
      stage: 'pending',
      result: null,
      error: null,
      retry_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    };
    set((s) => ({ jobs: [job, ...s.jobs] }));
    enqueue({ method: 'POST', path: '/api/data/distillation-jobs', body: job, idempotencyKey: `dj:${job.id}` }).catch(() => {
      // 同步队列负责重试
    });
    return job;
  },

  patchJob: (id, patch) => {
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id ? { ...j, ...patch, updated_at: new Date().toISOString() } : j,
      ),
    }));
    enqueue({ method: 'PATCH', path: `/api/data/distillation-jobs/${id}`, body: patch, idempotencyKey: `dj:${id}:upd` }).catch(() => {
      // 同步队列负责重试
    });
  },
}));
