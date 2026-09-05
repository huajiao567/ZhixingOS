import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, getRefreshToken, setRefreshToken } from './api';
import { useStore } from '../store/useStore';
import { useAvatarV2Store } from '../mirror3d/store/useAvatarV2Store';
import { useLifeSignalStore } from '../ai-native/connectors/useLifeSignalStore';

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  /** 发起密码重置：后端生成一次性令牌并发送邮件（Task 5.2 / spec A26.1） */
  forgotPassword: (email: string) => Promise<{ ok: boolean }>;
  /** 用一次性令牌重置密码：不自动登录，需用户手动登录（Task 5.2 / spec A26.1） */
  resetPassword: (token: string, newPassword: string) => Promise<{ ok: boolean }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, userId: null, email: null, displayName: null, loading: true, error: null });

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) { setState({ token: null, userId: null, email: null, displayName: null, loading: false, error: null }); return; }
      try {
        const me = await api.get<{ userId: string; email: string; displayName: string }>('/api/auth/me');
        setState({ token: t, userId: me.userId, email: me.email, displayName: me.displayName, loading: false, error: null });
      } catch {
        await setToken(null);
        await setRefreshToken(null);
        setState({ token: null, userId: null, email: null, displayName: null, loading: false, error: '登录已过期，请重新登录' });
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ id: string; accessToken: string; refreshToken: string }>('/api/auth/login', { email, password });
    await setToken(r.accessToken);
    await setRefreshToken(r.refreshToken);
    setState({ token: r.accessToken, userId: r.id, email, displayName: null, loading: false, error: null });
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const r = await api.post<{ id: string; accessToken: string; refreshToken: string }>('/api/auth/register', { email, password, displayName });
    await setToken(r.accessToken);
    await setRefreshToken(r.refreshToken);
    setState({ token: r.accessToken, userId: r.id, email, displayName: displayName ?? null, loading: false, error: null });
  }, []);

  const logout = useCallback(async () => {
    const rt = await getRefreshToken();
    if (rt) {
      try { await api.post('/api/auth/logout', { refreshToken: rt }); } catch { /* 忽略 */ }
    }
    await setToken(null);
    await setRefreshToken(null);
    useLifeSignalStore.getState().release();
    useAvatarV2Store.getState().releaseProfile();
    setState({ token: null, userId: null, email: null, displayName: null, loading: false, error: null });
  }, []);

  // P0-7：彻底注销——调用后端硬删除，成功后清空本机全部数据。
  // 若服务端删除失败则抛出错误，不在本地提前抹除，避免数据丢失。
  const deleteAccount = useCallback(async () => {
    await api.del('/api/auth/me');
    await setToken(null);
    await setRefreshToken(null);
    try { await useStore.getState().resetStore(); } catch { /* 忽略本地清理异常 */ }
    try {
      await Promise.all([
        useLifeSignalStore.getState().clear(),
        useAvatarV2Store.getState().clearProfile(),
      ]);
      useLifeSignalStore.getState().release();
      useAvatarV2Store.getState().releaseProfile();
    } catch { /* 服务端账号已删除；本机清理会在下一次清空操作重试 */ }
    setState({ token: null, userId: null, email: null, displayName: null, loading: false, error: null });
  }, []);

  // Task 5.2 / spec A26.1：发起密码重置——不修改 AuthState，不登录用户。
  // 后端生成一次性令牌（30 分钟过期）并发送邮件；前端只透传结果。
  const forgotPassword = useCallback(async (email: string): Promise<{ ok: boolean }> => {
    await api.post<{ ok: boolean }>('/api/auth/forgot-password', { email });
    return { ok: true };
  }, []);

  // Task 5.2 / spec A26.1：用一次性令牌重置密码——不自动登录，需用户手动登录。
  // 令牌一次性使用，30 分钟过期；失败时抛出 ApiError 由调用方展示。
  const resetPassword = useCallback(async (token: string, newPassword: string): Promise<{ ok: boolean }> => {
    await api.post<{ ok: boolean }>('/api/auth/reset-password', { token, newPassword });
    return { ok: true };
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, deleteAccount, forgotPassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
