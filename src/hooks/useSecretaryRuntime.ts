import { useCallback, useMemo, useState } from 'react';
import { api } from '../services/api';
import { createCalendarEvent, deleteCalendarEvent } from '../services/calendarSync';
import { cancelLifeObject, persistLifeObject } from '../services/taskSync';
import { useStore } from '../store/useStore';
import { useServiceContractStore } from '../store/useServiceContractStore';
import { useTwinProfileStore } from '../store/useTwinProfileStore';
import { createActionGateway } from '../ai-native/actions/actionGateway';
import { buildActionPlan } from '../ai-native/actions/executors';
import { receiptToTwinEvidence } from '../ai-native/evidence/evidenceFeedback';
import { createTextEnvelope } from '../ai-native/intake/eventEnvelope';
import { parseIntent } from '../ai-native/intent/intentParser';
import { activateLifeObject, intentToLifeObject } from '../ai-native/objects/lifeObject';
import { evaluateChangePaths } from '../ai-native/reasoning/changeKernel';
import { compileContextSurface } from '../ai-native/surfaces/surfaceCompiler';
import type {
  ActionPlan,
  ActionReceipt,
  ContextSurface,
  IntentGraph,
  LifeObject,
} from '../ai-native/types';

export type SecretaryRuntimePhase =
  | 'idle'
  | 'parsing'
  | 'needs_input'
  | 'ready'
  | 'executing'
  | 'receipt'
  | 'error';

export interface SecretaryRuntimeState {
  phase: SecretaryRuntimePhase;
  rawText: string;
  intent: IntentGraph | null;
  object: LifeObject | null;
  surface: ContextSurface;
  plan: ActionPlan | null;
  receipt: ActionReceipt | null;
  error: string | null;
  syncWarning: string | null;
}

const EMPTY_SURFACE = compileContextSurface({});

function latestJournalId(): string | null {
  const latest = useStore.getState().events[0];
  return latest?.id ?? null;
}

export function useSecretaryRuntime(userId?: string | null) {
  const agencyLevel = useServiceContractStore((state) => state.contract?.agency_level ?? 'A1');
  const twin = useTwinProfileStore();
  const [state, setState] = useState<SecretaryRuntimeState>({
    phase: 'idle', rawText: '', intent: null, object: null, surface: EMPTY_SURFACE,
    plan: null, receipt: null, error: null, syncWarning: null,
  });

  const gateway = useMemo(() => createActionGateway({
    agencyLevel,
    executors: {
      life_object: {
        execute: async (step) => {
          const draft = step.input.object as LifeObject;
          const active = activateLifeObject(draft);
          const result = await persistLifeObject(active);
          return { externalId: result.externalId, objectId: active.id, message: result.message, undoToken: result.undoToken };
        },
        undo: async (token) => cancelLifeObject(token),
      },
      calendar: {
        execute: async (step) => {
          const result = await createCalendarEvent(step.input.object as LifeObject);
          return { externalId: result.externalId, objectId: (step.input.object as LifeObject).id, message: result.message, undoToken: result.undoToken };
        },
        undo: async (token) => deleteCalendarEvent(token),
      },
      journal: {
        execute: async (step) => {
          const object = step.input.object as LifeObject;
          await useStore.getState().addJournal(object.detail ?? object.title);
          const eventId = latestJournalId();
          if (!eventId) throw new Error('日记写入后没有返回可验证的事件 ID');
          return { externalId: eventId, objectId: object.id, message: '已写入可追溯日记', undoToken: eventId };
        },
        undo: async (token) => useStore.getState().forgetEvent(token),
      },
      draft: {
        execute: async (step) => {
          const object = step.input.object as LifeObject;
          const response = await api.post<{ reply: string; risk: number }>('/api/secretary/chat', {
            message: step.input.request,
            history: [],
          });
          if (response.risk === 2) throw new Error('请求触发安全边界，草稿没有自动保存');
          await useStore.getState().addJournal(`[草稿] ${object.title}\n\n${response.reply}`);
          const eventId = latestJournalId();
          if (!eventId) throw new Error('草稿写入后没有返回可验证的事件 ID');
          return { externalId: eventId, objectId: object.id, message: '草稿已生成并写入日记，未对外发送', undoToken: eventId };
        },
        undo: async (token) => useStore.getState().forgetEvent(token),
      },
    },
  }), [agencyLevel]);

  const analyze = useCallback(async (text: string) => {
    const rawText = text.trim();
    if (!rawText) return;
    setState((current) => ({ ...current, phase: 'parsing', rawText, error: null, syncWarning: null, receipt: null }));
    await Promise.resolve();
    try {
      const now = new Date().toISOString();
      const envelope = createTextEnvelope(rawText, { now, consentId: 'user-direct-input' });
      const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now });
      if (intent.highImpact) {
        setState({
          phase: 'error', rawText, intent, object: null, surface: EMPTY_SURFACE, plan: null, receipt: null,
          error: '这属于高影响动作。知行镜可以帮助梳理信息和准备草稿，但不会直接支付、发布、停药、终止关系或签署法律文件。',
          syncWarning: null,
        });
        return;
      }
      if (intent.kind === 'unknown') {
        const surface = { ...EMPTY_SURFACE, state: 'needs_input' as const, questions: intent.questions, title: '还需要确认你的意图' };
        setState({ phase: 'needs_input', rawText, intent, object: null, surface, plan: null, receipt: null, error: null, syncWarning: null });
        return;
      }

      const object = intentToLifeObject(intent, now);
      const app = useStore.getState();
      const eventEvidence = app.events.slice(0, 6).map((event, index) => ({
        id: event.id,
        kind: (event.userInterpretation || event.axis === 'inner' ? 'self_report' : 'fact') as 'self_report' | 'fact',
        quality: (index >= 2 ? 'consistent' : 'preliminary') as 'consistent' | 'preliminary',
        occurredAt: event.startTime,
        summary: event.title,
      }));
      const evidence = [
        { id: envelope.id, kind: 'self_report' as const, quality: 'preliminary' as const, occurredAt: envelope.occurredAt, summary: '用户当前明确输入' },
        { id: `consent-${envelope.id}`, kind: 'constraint' as const, quality: 'preliminary' as const, occurredAt: envelope.capturedAt, summary: '仅执行当前确认且可撤销的动作' },
        ...eventEvidence,
      ];
      const paths = evaluateChangePaths({
        now,
        object,
        evidence,
        constraints: [...app.user.constraints, '仅执行当前用户明确请求且可撤销的步骤'],
        commitments: [
          ...app.commitments.filter((item) => item.status === 'active').slice(0, 3).map((item) => item.statement),
          '保留用户自主性与数据主权',
        ],
        stakeholders: [],
        recentMomentum: app.events.length >= 3 ? 'growing' : 'unknown',
        agencyLevel,
      });
      const surface = compileContextSurface({ object, paths, questions: intent.questions });
      const plan = buildActionPlan(intent, object, paths[0]);
      setState({
        phase: surface.state === 'needs_input' ? 'needs_input' : 'ready',
        rawText, intent, object, surface, plan, receipt: null, error: null, syncWarning: null,
      });
    } catch (error) {
      setState((current) => ({ ...current, phase: 'error', error: error instanceof Error ? error.message : '无法理解这条输入' }));
    }
  }, [agencyLevel]);

  const answer = useCallback(async (text: string) => {
    await analyze(`${state.rawText}，${text.trim()}`);
  }, [analyze, state.rawText]);

  const execute = useCallback(async () => {
    if (!state.plan || !state.object) return;
    setState((current) => ({ ...current, phase: 'executing', error: null, syncWarning: null }));
    try {
      const receipt = await gateway.execute(state.plan, { confirmed: true });
      let syncWarning: string | null = null;
      try {
        await api.post<ActionReceipt>('/api/runtime/action-receipts', receipt);
      } catch (error) {
        syncWarning = `动作已经按回执执行，但回执同步失败：${error instanceof Error ? error.message : '网络异常'}`;
      }
      if (userId) {
        const evidence = receiptToTwinEvidence(receipt, state.object);
        if (evidence) {
          try {
            await twin.ingest(userId, evidence);
            await twin.sync(userId);
          } catch (error) {
            syncWarning = `${syncWarning ? `${syncWarning}；` : ''}孪生档案待同步：${error instanceof Error ? error.message : '网络异常'}`;
          }
        }
      }
      setState((current) => ({ ...current, phase: 'receipt', receipt, syncWarning }));
    } catch (error) {
      setState((current) => ({ ...current, phase: 'error', error: error instanceof Error ? error.message : '动作执行失败' }));
    }
  }, [gateway, state.object, state.plan, twin, userId]);

  const undo = useCallback(async () => {
    if (!state.receipt) return;
    try {
      const receipt = await gateway.undo(state.receipt.id);
      let syncWarning: string | null = null;
      try {
        await api.post(`/api/runtime/action-receipts/${encodeURIComponent(receipt.id)}/undo`, {});
      } catch (error) {
        syncWarning = `实际动作已撤销，但服务端回执待同步：${error instanceof Error ? error.message : '网络异常'}`;
      }
      setState((current) => ({ ...current, receipt, phase: 'receipt', syncWarning }));
    } catch (error) {
      setState((current) => ({ ...current, phase: 'error', error: error instanceof Error ? error.message : '撤销失败' }));
    }
  }, [gateway, state.receipt]);

  const reset = useCallback(() => setState({
    phase: 'idle', rawText: '', intent: null, object: null, surface: EMPTY_SURFACE,
    plan: null, receipt: null, error: null, syncWarning: null,
  }), []);

  return { state, analyze, answer, execute, undo, reset };
}

