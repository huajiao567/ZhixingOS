import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from './api';
import { useStore } from '../store/useStore';
import { buildTodayBrief } from '../engine/brief';
import type { BriefCard } from '../types/models';

interface ApiBrief {
  factChanges: string[];
  todayCommitments: string[];
  suggestedActions: string[];
  highInfoQuestion: string;
  silenceHint?: string;
  generatedBy: 'llm' | 'fallback' | 'empty';
}

function adapt(b: ApiBrief, fallback: BriefCard): BriefCard {
  const topCommitment = fallback.commitment;
  return {
    factChange: {
      title: b.factChanges[0] || fallback.factChange.title,
      detail: b.factChanges.slice(1).join('；') || fallback.factChange.detail,
      gap: fallback.factChange.gap,
    },
    commitment: topCommitment,
    action: {
      title: b.suggestedActions[0] || fallback.action.title,
      detail: b.suggestedActions.slice(1).join('；') || fallback.action.detail,
    },
    question: b.highInfoQuestion || fallback.question,
  };
}

/**
 * Task 5.5 修复：原依赖 `[s.events.length, s.commitments.length, s.experiments.length]`
 * 在「内容变化但长度不变」时不触发 refresh。改为对三类资源计算内容 hash
 * （仅取影响 brief 的关键字段），hash 变化才重建 fallback 与 refresh。
 *
 * fallback 用 useMemo 包裹，避免每次渲染重建对象导致 refresh 频繁重建。
 */
export function useTodayBrief() {
  const s = useStore();

  // events 内容 hash：取影响 brief 的字段（title/detail/userInterpretation/mood/startTime/axis）
  const eventsHash = useMemo(
    () =>
      JSON.stringify(
        s.events.map((e) => ({
          id: e.id,
          type: e.type,
          title: e.title,
          detail: e.detail,
          userInterpretation: e.userInterpretation,
          mood: e.mood,
          startTime: e.startTime,
          axis: e.axis,
        })),
      ),
    [s.events],
  );

  // commitments 内容 hash：取影响 buildTodayBrief 的字段（statement/status/priority）
  const commitmentsHash = useMemo(
    () =>
      JSON.stringify(
        s.commitments.map((c) => ({
          id: c.id,
          statement: c.statement,
          status: c.status,
          priority: c.priority,
        })),
      ),
    [s.commitments],
  );

  // experiments 内容 hash：取影响 buildTodayBrief 的字段（question/intervention/status/startDate）
  const experimentsHash = useMemo(
    () =>
      JSON.stringify(
        s.experiments.map((e) => ({
          id: e.id,
          question: e.question,
          intervention: e.intervention,
          status: e.status,
          startDate: e.startDate,
        })),
      ),
    [s.experiments],
  );

  // fallback 仅在三个 hash 变化时重建，避免每次渲染产生新对象
  const fallback = useMemo(
    () => buildTodayBrief(s),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsHash, commitmentsHash, experimentsHash],
  );

  const [brief, setBrief] = useState<BriefCard>(fallback);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<'llm' | 'fallback' | 'loading'>('loading');

  const refresh = useCallback(async () => {
    setLoading(true);
    setSource('loading');
    try {
      const b = await api.get<ApiBrief>('/api/brief/today');
      setBrief(adapt(b, fallback));
      setSource(b.generatedBy === 'llm' ? 'llm' : 'fallback');
    } catch {
      setBrief(fallback);
      setSource('fallback');
    } finally {
      setLoading(false);
    }
  }, [fallback]);

  // fallback 变化（即 events/commitments/experiments 内容变化）时同步本地 brief，
  // 避免在 API 响应到达前显示陈旧内容。
  useEffect(() => {
    setBrief(fallback);
  }, [fallback]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { brief, loading, source, refresh };
}
