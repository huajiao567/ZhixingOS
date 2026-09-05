import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoEnvelope, createTextEnvelope } from '../src/ai-native/intake/eventEnvelope';
import { parseIntent } from '../src/ai-native/intent/intentParser';
import { intentToLifeObject } from '../src/ai-native/objects/lifeObject';

const referenceNow = '2026-08-22T09:00:00.000+08:00';

test('intent parser turns a dated meeting into an executable event object', () => {
  const envelope = createTextEnvelope('明天下午3点开项目会，1小时', {
    now: referenceNow,
    consentId: 'consent-text',
  });
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: referenceNow });
  assert.equal(intent.kind, 'create_event');
  assert.equal(intent.title, '项目会');
  assert.equal(intent.time?.start, '2026-08-23T15:00:00.000+08:00');
  assert.equal(intent.time?.end, '2026-08-23T16:00:00.000+08:00');
  assert.deepEqual(intent.questions, []);

  const object = intentToLifeObject(intent, referenceNow);
  assert.equal(object.kind, 'event');
  assert.equal(object.status, 'draft');
  assert.deepEqual(object.sourceRefs, [envelope.id]);
});

test('intent parser recognizes a recurring learning context as a course', () => {
  const envelope = createTextEnvelope('下周一上午8点数学课，持续90分钟', {
    now: referenceNow,
    consentId: 'consent-text',
  });
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: referenceNow });
  assert.equal(intent.kind, 'create_course');
  assert.equal(intent.title, '数学课');
  assert.equal(intent.time?.start, '2026-08-24T08:00:00.000+08:00');
  assert.equal(intent.time?.end, '2026-08-24T09:30:00.000+08:00');
  assert.equal(intentToLifeObject(intent, referenceNow).kind, 'course');
});

test('task with no time remains a draft and asks instead of guessing', () => {
  const envelope = createTextEnvelope('记得买牛奶', { now: referenceNow, consentId: 'consent-text' });
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: referenceNow });
  assert.equal(intent.kind, 'create_task');
  assert.match(intent.questions.join(''), /什么时候|时间/);
  assert.equal(intentToLifeObject(intent, referenceNow).status, 'draft');
});

test('quantities are not misread as a clock time', () => {
  const envelope = createTextEnvelope('记得买2本书', { now: referenceNow, consentId: 'consent-text' });
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: referenceNow });
  assert.equal(intent.kind, 'create_task');
  assert.equal(intent.time, undefined);
  assert.match(intent.questions.join(''), /什么时候|时间/);
});

test('next-week weekday means the following calendar week', () => {
  const mondayNow = '2026-08-24T09:00:00.000+08:00';
  const envelope = createTextEnvelope('下周二上午8点英语课', { now: mondayNow, consentId: 'consent-text' });
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: mondayNow });
  assert.equal(intent.time?.start, '2026-09-01T08:00:00.000+08:00');
});

test('timezone option controls emitted offset instead of assuming Shanghai', () => {
  const utcNow = '2026-08-22T01:00:00.000Z';
  const envelope = createTextEnvelope('明天下午3点开项目会，1小时', { now: utcNow, consentId: 'consent-text' });
  const intent = parseIntent(envelope, { timezone: 'UTC', now: utcNow });
  assert.equal(intent.time?.start, '2026-08-23T15:00:00.000+00:00');
  assert.equal(intent.time?.end, '2026-08-23T16:00:00.000+00:00');
});

test('a reflection is captured without forcing it into a task', () => {
  const envelope = createTextEnvelope('记录一下，今天很累，但散步后好了一些', {
    now: referenceNow,
    consentId: 'consent-text',
  });
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: referenceNow });
  assert.equal(intent.kind, 'capture_note');
  assert.equal(intent.questions.length, 0);
  assert.equal(intentToLifeObject(intent, referenceNow).kind, 'note');
});

test('a photo envelope without caption is a quiet note that never infers psyche', () => {
  const envelope = createPhotoEnvelope(
    { sourceRef: 'photo:asset-1', width: 3024, height: 4032, mimeType: 'image/jpeg', origin: 'camera' },
    { now: referenceNow, consentId: 'consent-photo' },
  );
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: referenceNow });
  assert.equal(intent.kind, 'capture_note');
  assert.equal(intent.title, '照片记录');
  assert.ok(intent.constraints.some((item) => item.includes('不自动推断心理状态')));
  assert.match(intent.questions.join(''), /说明/);
});

test('a photo envelope with an actionable caption carries the intent but stays constrained', () => {
  const envelope = createPhotoEnvelope(
    { sourceRef: 'photo:asset-2', caption: '记得周末整理这批照片', origin: 'library' },
    { now: referenceNow, consentId: 'consent-photo' },
  );
  const intent = parseIntent(envelope, { timezone: 'Asia/Shanghai', now: referenceNow });
  assert.equal(intent.kind, 'create_task');
  assert.match(intent.title, /整理/);
  assert.ok(intent.constraints.some((item) => item.includes('照片仅作为记录附件')));
  assert.deepEqual(intentToLifeObject(intent, referenceNow).sourceRefs, [envelope.id]);
});

test('photo envelopes must be traceable and bound to consent', () => {
  assert.throws(() => createPhotoEnvelope({ sourceRef: '  ' }, { consentId: 'c' }), /可追溯来源/);
  assert.throws(
    () => createPhotoEnvelope({ sourceRef: 'photo:x' }, { consentId: '' }),
    /授权记录/,
  );
});

test('public, financial, medical, relational and legal actions are marked high-impact', () => {
  const samples = [
    ['替我公开发布这段话', 'public'],
    ['帮我支付这笔钱', 'money'],
    ['帮我停掉这个处方药', 'medical'],
    ['替我跟伴侣分手', 'relationship'],
    ['替我签署这份合同', 'legal'],
  ] as const;
  for (const [text, category] of samples) {
    const intent = parseIntent(createTextEnvelope(text, { now: referenceNow, consentId: 'c' }), {
      timezone: 'Asia/Shanghai', now: referenceNow,
    });
    assert.equal(intent.highImpact, true, text);
    assert.equal(intent.highImpactCategory, category, text);
  }
});
