import type { IntentGraph, LifeObject, LifeObjectKind } from '../types';

const KIND_MAP: Record<Exclude<IntentGraph['kind'], 'unknown'>, LifeObjectKind> = {
  capture_note: 'note',
  create_task: 'task',
  create_event: 'event',
  create_course: 'course',
  prepare_draft: 'draft',
};

export function intentToLifeObject(intent: IntentGraph, now = new Date().toISOString()): LifeObject {
  if (intent.kind === 'unknown') throw new Error('意图尚未明确，不能创建生命对象');
  return {
    id: `life-${intent.id}`,
    kind: KIND_MAP[intent.kind],
    title: intent.title,
    detail: intent.detail ?? intent.rawText,
    status: 'draft',
    startsAt: intent.time?.start,
    endsAt: intent.time?.end,
    domain: intent.domain,
    version: 1,
    sourceRefs: [intent.sourceEnvelopeId],
    relations: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function activateLifeObject(object: LifeObject, now = new Date().toISOString()): LifeObject {
  return { ...object, status: 'active', version: object.version + 1, updatedAt: now };
}

