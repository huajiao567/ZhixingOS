import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ContinuityHandoff,
  type ContinuitySurface,
} from '../services/api';

function handoffId(): string {
  return `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendWorkspaceHandoff(
  source: ContinuitySurface,
  target: ContinuitySurface,
  text: string,
  title?: string,
): Promise<ContinuityHandoff> {
  const clean = text.trim();
  if (!clean) throw new Error('接力内容不能为空');
  if (source === target) throw new Error('接力目标必须是另一端');

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
  return api.continuity.create({
    id: handoffId(),
    sourceSurface: source,
    targetSurface: target,
    title: (title?.trim() || clean).slice(0, 80),
    payload: {
      kind: 'workspace_text',
      text: clean,
      route: 'Workspace',
    },
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
}

export function useContinuityHandoffs(target: ContinuitySurface) {
  const [items, setItems] = useState<ContinuityHandoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.continuity.list(target, 20);
      setItems(response.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '跨端接力同步失败');
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!active) return;
      await refresh();
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const consume = useCallback(async (id: string) => {
    const consumed = await api.continuity.consume(id);
    setItems((current) => current.filter((item) => item.id !== id));
    return consumed;
  }, []);

  const cancel = useCallback(async (id: string) => {
    const cancelled = await api.continuity.cancel(id);
    setItems((current) => current.filter((item) => item.id !== id));
    return cancelled;
  }, []);

  return { items, loading, error, refresh, consume, cancel };
}
