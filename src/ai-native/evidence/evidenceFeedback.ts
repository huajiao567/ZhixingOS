import type { ActionReceipt, LifeObject, TwinEvidence } from '../types';

export function lifeObjectToTwinEvidence(object: LifeObject, sourceRef: string): TwinEvidence {
  return {
    id: `twin-evidence-object-${object.id}-v${object.version}`,
    feature: `engages_with_${object.kind}`,
    value: true,
    scope: object.domain ?? object.kind,
    polarity: object.status === 'cancelled' ? 'counter' : 'support',
    occurredAt: object.updatedAt,
    sourceRef,
  };
}

export function receiptToTwinEvidence(
  receipt: ActionReceipt,
  object: LifeObject,
): TwinEvidence | null {
  if (receipt.status === 'blocked' || receipt.status === 'failed') return null;
  return {
    id: `twin-evidence-receipt-${receipt.id}`,
    feature: `follows_through_${object.kind}`,
    value: receipt.status === 'success',
    scope: object.domain ?? object.kind,
    polarity: receipt.status === 'success' ? 'support' : 'counter',
    occurredAt: receipt.executedAt,
    sourceRef: `action_receipt:${receipt.id}`,
  };
}

