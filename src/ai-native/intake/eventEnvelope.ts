import type { EventEnvelope, PrivacyLevel } from '../types';

export interface TextEnvelopeOptions {
  now?: string;
  occurredAt?: string;
  consentId: string;
  privacyLevel?: PrivacyLevel;
  sourceRef?: string;
}

export interface PhotoEnvelopeInput {
  sourceRef: string;
  width?: number;
  height?: number;
  mimeType?: string;
  caption?: string;
  origin?: 'camera' | 'library';
}

export interface PhotoEnvelopeOptions {
  now?: string;
  occurredAt?: string;
  consentId: string;
  privacyLevel?: PrivacyLevel;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createTextEnvelope(text: string, options: TextEnvelopeOptions): EventEnvelope<{ text: string }> {
  const normalized = text.trim();
  if (!normalized) throw new Error('文字输入不能为空');
  if (!options.consentId.trim()) throw new Error('文字输入必须绑定授权记录');

  const capturedAt = options.now ?? new Date().toISOString();
  const occurredAt = options.occurredAt ?? capturedAt;
  const checksum = stableHash(normalized);
  return {
    id: `env-text-${stableHash(`${capturedAt}:${normalized}`)}`,
    kind: 'text',
    payload: { text: normalized },
    occurredAt,
    capturedAt,
    source: 'user',
    sourceRef: options.sourceRef ?? `local:text:${checksum}`,
    consentId: options.consentId,
    privacyLevel: options.privacyLevel ?? 'D1',
    checksum,
  };
}

export function createPhotoEnvelope(
  photo: PhotoEnvelopeInput,
  options: PhotoEnvelopeOptions,
): EventEnvelope<{
  sourceRef: string;
  width?: number;
  height?: number;
  mimeType?: string;
  caption: string;
  origin: 'camera' | 'library';
}> {
  const sourceRef = photo.sourceRef?.trim();
  if (!sourceRef) throw new Error('照片输入缺少可追溯来源');
  if (!options.consentId.trim()) throw new Error('照片输入必须绑定授权记录');

  const capturedAt = options.now ?? new Date().toISOString();
  const occurredAt = options.occurredAt ?? capturedAt;
  const caption = (photo.caption ?? '').trim();
  const checksum = stableHash(`${sourceRef}:${caption}`);
  return {
    id: `env-photo-${stableHash(`${capturedAt}:${sourceRef}`)}`,
    kind: 'photo',
    payload: {
      sourceRef,
      width: photo.width,
      height: photo.height,
      mimeType: photo.mimeType,
      caption,
      origin: photo.origin ?? 'library',
    },
    occurredAt,
    capturedAt,
    source: 'user',
    sourceRef,
    consentId: options.consentId,
    privacyLevel: options.privacyLevel ?? 'D1',
    checksum,
  };
}

export function assertEnvelopeTraceable(envelope: EventEnvelope): void {
  if (!envelope.id || !envelope.sourceRef || !envelope.consentId) {
    throw new Error('输入缺少可追溯来源或授权记录');
  }
  if (Number.isNaN(Date.parse(envelope.occurredAt)) || Number.isNaN(Date.parse(envelope.capturedAt))) {
    throw new Error('输入时间无效');
  }
}

