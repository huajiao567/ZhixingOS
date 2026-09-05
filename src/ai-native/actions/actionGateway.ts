import type {
  ActionExecutor,
  ActionPlan,
  ActionReceipt,
  ActionStep,
  ActionStepResult,
} from '../types';

export interface ActionGatewayOptions {
  agencyLevel: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
  executors: Record<string, ActionExecutor>;
  now?: () => string;
  saveReceipt?: (receipt: ActionReceipt) => Promise<void> | void;
}

export interface ExecutionConfirmation {
  confirmed: boolean;
}

interface StoredExecution {
  plan: ActionPlan;
  receipt: ActionReceipt;
}

function receiptId(plan: ActionPlan): string {
  return `receipt-${plan.id}-${plan.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}`;
}

export function createActionGateway(options: ActionGatewayOptions) {
  const byIdempotency = new Map<string, StoredExecution>();
  const byReceiptId = new Map<string, StoredExecution>();
  const now = options.now ?? (() => new Date().toISOString());

  async function persist(plan: ActionPlan, receipt: ActionReceipt): Promise<ActionReceipt> {
    const record = { plan, receipt };
    byIdempotency.set(plan.idempotencyKey, record);
    byReceiptId.set(receipt.id, record);
    await options.saveReceipt?.(receipt);
    return receipt;
  }

  async function blocked(plan: ActionPlan, reason: string): Promise<ActionReceipt> {
    return {
      id: receiptId(plan), planId: plan.id, idempotencyKey: plan.idempotencyKey,
      status: 'blocked', stepResults: [], affectedObjectIds: [], executedAt: now(),
      undoable: false, blockReason: reason,
    };
  }

  return {
    async execute(plan: ActionPlan, confirmation: ExecutionConfirmation): Promise<ActionReceipt> {
      const existing = byIdempotency.get(plan.idempotencyKey);
      if (existing) return existing.receipt;
      if (options.agencyLevel === 'A0') return blocked(plan, '当前为 A0 建议权限，秘书没有执行权限。');
      if ((plan.requiresConfirmation || plan.risk === 'high') && !confirmation.confirmed) {
        return blocked(plan, '动作尚未获得用户明确确认。');
      }

      const stepResults: ActionStepResult[] = [];
      const affectedObjectIds = new Set<string>();
      for (const step of plan.steps) {
        const executor = options.executors[step.executor];
        if (!executor) {
          stepResults.push({ stepId: step.id, status: 'failed', message: `未注册执行器：${step.executor}` });
          continue;
        }
        try {
          const result = await executor.execute(step);
          if (result.objectId) affectedObjectIds.add(result.objectId);
          stepResults.push({
            stepId: step.id, status: 'success', externalId: result.externalId,
            message: result.message, undoToken: result.undoToken,
          });
        } catch (error) {
          stepResults.push({
            stepId: step.id, status: 'failed',
            message: error instanceof Error ? error.message : '执行器返回未知错误',
          });
        }
      }

      const succeeded = stepResults.filter((item) => item.status === 'success').length;
      const failed = stepResults.length - succeeded;
      const status: ActionReceipt['status'] = succeeded === 0 ? 'failed' : failed > 0 ? 'partial_failure' : 'success';
      const undoable = succeeded > 0 && plan.reversible && stepResults.every((result) => {
        if (result.status === 'failed') return true;
        const step = plan.steps.find((item) => item.id === result.stepId);
        const executor = step ? options.executors[step.executor] : undefined;
        return Boolean(step?.reversible && result.undoToken && executor?.undo);
      });
      return persist(plan, {
        id: receiptId(plan), planId: plan.id, idempotencyKey: plan.idempotencyKey,
        status, stepResults, affectedObjectIds: [...affectedObjectIds], executedAt: now(), undoable,
      });
    },

    async undo(id: string): Promise<ActionReceipt> {
      const stored = byReceiptId.get(id);
      if (!stored) throw new Error('行动回执不存在');
      if (!stored.receipt.undoable || stored.receipt.status === 'undone') throw new Error('此动作不可撤销或已经撤销');
      const successful = stored.receipt.stepResults.filter((item) => item.status === 'success').reverse();
      for (const result of successful) {
        const step = stored.plan.steps.find((item) => item.id === result.stepId) as ActionStep | undefined;
        const executor = step ? options.executors[step.executor] : undefined;
        if (!step || !result.undoToken || !executor?.undo) throw new Error(`步骤 ${result.stepId} 缺少真实撤销路径`);
        await executor.undo(result.undoToken, step);
      }
      const receipt: ActionReceipt = { ...stored.receipt, status: 'undone', undoneAt: now(), undoable: false };
      await persist(stored.plan, receipt);
      return receipt;
    },
  };
}

