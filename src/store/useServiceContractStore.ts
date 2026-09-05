import { create } from 'zustand';
import { ServiceContract, DEFAULT_SERVICE_CONTRACT } from '../types/models';
import { api } from '../services/api';

interface ServiceContractState {
  contract: ServiceContract | null;
  loading: boolean;
  error: string | null;
  load: (userId: string) => Promise<void>;
  update: (userId: string, patch: Partial<ServiceContract>) => Promise<void>;
  setLocal: (patch: Partial<ServiceContract>) => void;
}

function defaultContract(userId: string): ServiceContract {
  return {
    ...DEFAULT_SERVICE_CONTRACT,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
}

export const useServiceContractStore = create<ServiceContractState>((set, get) => ({
  contract: null,
  loading: false,
  error: null,

  load: async (userId) => {
    set({ loading: true, error: null });
    try {
      // 服务端未创建契约时返回 null 或 404，均落入默认契约（首次使用合理默认，非作弊回退）
      const c = await api.serviceContract.get();
      set({ contract: c ?? defaultContract(userId), loading: false });
    } catch (e: unknown) {
      // 服务端不可达或尚未创建：使用默认契约
      const msg = e instanceof Error ? e.message : null;
      set({ contract: defaultContract(userId), loading: false, error: msg });
    }
  },

  update: async (_userId, patch) => {
    const current = get().contract;
    if (!current) return;
    const next: ServiceContract = { ...current, ...patch, updated_at: new Date().toISOString() };
    set({ contract: next });
    try {
      // 直接调用 PUT（幂等方法，attemptWithRetry 已内置 3 次网络重试）
      // 服务端幂等键 sec: 由 api.serviceContract.put 内部生成
      await api.serviceContract.put(next);
    } catch {
      // 乐观更新已本地生效；网络错误由 attemptWithRetry 重试 3 次，
      // 仍失败时本地与服务端短暂不一致，下次 load() 会拉取服务端最新值覆盖本地。
      // 如需更强一致性，可改用 enqueueByPrefix('sec', 'PUT', ...) 入队由 sync 队列重试。
    }
  },

  setLocal: (patch) => {
    const current = get().contract;
    if (!current) return;
    set({ contract: { ...current, ...patch, updated_at: new Date().toISOString() } });
  },
}));
