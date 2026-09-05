import type { ActionPlan, ActionStep, IntentGraph, LifeObject, PathCandidate } from '../types';

function cleanId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
}

export function buildActionPlan(
  intent: IntentGraph,
  object: LifeObject,
  reasoning?: PathCandidate,
): ActionPlan {
  const steps: ActionStep[] = [
    {
      id: `persist-${cleanId(object.id)}`,
      executor: 'life_object',
      operation: 'upsert',
      input: { object },
      reversible: true,
    },
  ];
  if (object.kind === 'event' || object.kind === 'course') {
    steps.push({
      id: `calendar-${cleanId(object.id)}`,
      executor: 'calendar',
      operation: 'create',
      input: { object },
      reversible: true,
    });
  } else if (object.kind === 'note') {
    steps.push({
      id: `journal-${cleanId(object.id)}`,
      executor: 'journal',
      operation: 'create',
      input: { object },
      reversible: true,
    });
  } else if (object.kind === 'draft') {
    steps.push({
      id: `draft-${cleanId(object.id)}`,
      executor: 'draft',
      operation: 'create',
      input: { object, request: intent.rawText },
      reversible: true,
    });
  }
  return {
    id: `plan-${cleanId(intent.id)}`,
    idempotencyKey: `${intent.sourceEnvelopeId}:${intent.id}:${object.version}`,
    sourceRequest: intent.rawText,
    intentId: intent.id,
    objectId: object.id,
    title: object.kind === 'course' ? '安排课程' : object.kind === 'event' ? '写入日程' : object.kind === 'task' ? '创建待办' : '保存记录',
    summary: intent.questions.length ? '需要先补充信息，不能直接执行。' : `将「${object.title}」写入知行镜${object.kind === 'event' || object.kind === 'course' ? '和系统日历' : ''}。`,
    risk: intent.highImpact ? 'high' : reasoning?.risk ?? 'low',
    reversible: steps.every((step) => step.reversible),
    requiresConfirmation: true,
    steps,
    reasoning,
  };
}
