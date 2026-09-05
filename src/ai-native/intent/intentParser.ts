import type { EventEnvelope, IntentGraph, IntentKind, IntentTime } from '../types';
import { assertEnvelopeTraceable } from '../intake/eventEnvelope';

export interface IntentParserOptions {
  timezone: string;
  now?: string;
}

const IMPACT_PATTERNS: {
  pattern: RegExp;
  category: NonNullable<IntentGraph['highImpactCategory']>;
}[] = [
  { pattern: /(支付|转账|付款|买入|卖出|交易)/, category: 'money' },
  { pattern: /(公开发布|发到网上|发微博|发朋友圈|对外发布)/, category: 'public' },
  { pattern: /(停药|处方药|治疗方案|手术|诊断)/, category: 'medical' },
  { pattern: /(分手|离婚|绝交|辞退|解雇)/, category: 'relationship' },
  { pattern: /(签署|签合同|起诉|撤诉|法律文件)/, category: 'legal' },
];

function hash(value: string): string {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(31, result) + value.charCodeAt(i) | 0;
  return (result >>> 0).toString(36);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

interface LocalDateParts { year: number; month: number; day: number }

interface LocalDateTimeParts extends LocalDateParts { hour: number; minute: number }

function zonedParts(instant: number, timezone: string): LocalDateTimeParts {
  if (!Number.isFinite(instant)) throw new Error('解析基准时间无效');
  let formatted: Intl.DateTimeFormatPart[];
  try {
    formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
  } catch {
    throw new Error(`不支持的时区：${timezone}`);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formatted.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

function dateParts(iso: string, timezone: string): LocalDateParts {
  return zonedParts(Date.parse(iso), timezone);
}

function addDays(parts: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function weekday(parts: LocalDateParts): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function offsetMinutesAt(instant: number, timezone: string): number {
  const local = zonedParts(instant, timezone);
  const representedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return Math.round((representedAsUtc - instant) / 60_000);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function withTimezoneOffset(parts: LocalDateParts, hour: number, minute: number, timezone: string): string {
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute);
  let instant = wallClock;
  let offset = 0;
  // Two passes cover ordinary DST boundaries without introducing a date library.
  for (let pass = 0; pass < 2; pass += 1) {
    offset = offsetMinutesAt(instant, timezone);
    instant = wallClock - offset * 60_000;
  }
  offset = offsetMinutesAt(instant, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(hour)}:${pad(minute)}:00.000${formatOffset(offset)}`;
}

function formatInstant(instant: number, timezone: string): string {
  const local = zonedParts(instant, timezone);
  return `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}:00.000${formatOffset(offsetMinutesAt(instant, timezone))}`;
}

function parseTime(text: string, now: string, timezone: string): IntentTime | undefined {
  const today = dateParts(now, timezone);
  let date: typeof today | undefined;

  if (/明天/.test(text)) date = addDays(today, 1);
  else if (/后天/.test(text)) date = addDays(today, 2);
  else if (/今天|今晚|今早|今晨/.test(text)) date = today;
  else {
    const weekdayMatch = text.match(/(下周|周|星期)([一二三四五六日天])/);
    if (weekdayMatch) {
      const target = '日一二三四五六'.indexOf(weekdayMatch[2]);
      if (weekdayMatch[1] === '下周') {
        const daysToNextMonday = (1 - weekday(today) + 7) % 7 || 7;
        const daysAfterMonday = target === 0 ? 6 : target - 1;
        date = addDays(today, daysToNextMonday + daysAfterMonday);
      } else {
        const deltaBase = (target - weekday(today) + 7) % 7;
        date = addDays(today, deltaBase === 0 ? 7 : deltaBase);
      }
    }
  }

  const periodClock = text.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*(\d{1,2})(?:[:：点时](\d{1,2})?分?)?/);
  const explicitClock = periodClock ? undefined : text.match(/(?:^|[^\d])(\d{1,2})(?:[:：](\d{2})|[点时](\d{0,2})分?)/);
  if (!date && !periodClock && !explicitClock) return undefined;

  let hour = periodClock ? Number(periodClock[2]) : explicitClock ? Number(explicitClock[1]) : 9;
  const minute = Number(periodClock?.[3] || explicitClock?.[2] || explicitClock?.[3] || 0);
  const period = periodClock?.[1] ?? '';
  if (hour > 23 || minute > 59) return undefined;
  if (/(下午|傍晚|晚上)/.test(period) && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  if (period === '凌晨' && hour === 12) hour = 0;

  const resolvedDate = date ?? today;
  const start = withTimezoneOffset(resolvedDate, hour, minute, timezone);
  const durationHour = text.match(/(\d+(?:\.\d+)?)\s*小时/);
  const durationMinute = text.match(/(\d+)\s*分钟/);
  const duration = durationHour ? Number(durationHour[1]) * 60 : durationMinute ? Number(durationMinute[1]) : undefined;
  let end: string | undefined;
  if (duration !== undefined) {
    const startUtc = Date.parse(start);
    end = formatInstant(startUtc + duration * 60_000, timezone);
  }
  return { start, end, allDay: false, timezone, raw: (periodClock?.[0] ?? explicitClock?.[0])?.trim() };
}

function detectKind(text: string): IntentKind {
  if (/(记录一下|记一下|写日记|存个记录|今天.*(?:感觉|很|有些))/.test(text)) return 'capture_note';
  if (/(草稿|初稿|周报|邮件|纪要)/.test(text)) return 'prepare_draft';
  if (/(课程|上课|[语数英]文课|数学课|英语课|物理课|化学课)/.test(text)) return 'create_course';
  if (/(开会|会议|项目会|约会|日程|安排.*(?:会|访谈|沟通))/.test(text)) return 'create_event';
  if (/(记得|待办|提醒我|要去|需要|买|提交|完成)/.test(text)) return 'create_task';
  return 'unknown';
}

function cleanTitle(text: string, kind: IntentKind): string {
  if (kind === 'capture_note') return text.replace(/^(记录一下|记一下)[，,：:\s]*/, '').trim();
  let title = text
    .replace(/(今天|明天|后天|今晚|今早|今晨|下周[一二三四五六日天]|星期[一二三四五六日天]|周[一二三四五六日天])/g, '')
    .replace(/[，,、]?\s*(?:持续)?\s*\d+(?:\.\d+)?\s*(小时|分钟)/g, '')
    .replace(/(?:(?:凌晨|早上|上午|中午|下午|傍晚|晚上)\s*\d{1,2}(?:[:：点时]\d{0,2}分?)?|\d{1,2}[:：点时]\d{0,2}分?)/g, '')
    .replace(/^(请|帮我|替我|给我|记得|提醒我|安排|创建|新增|添加|开)/, '')
    .replace(/^(一个|一条|一下)/, '')
    .trim();
  if (kind === 'create_task') title = title.replace(/^要/, '').trim();
  return title || '未命名事项';
}

type ParserPayload = { text?: string; caption?: string; sourceRef?: string };

export function parseIntent(
  envelope: EventEnvelope<ParserPayload>,
  options: IntentParserOptions,
): IntentGraph {
  assertEnvelopeTraceable(envelope);
  const isPhoto = envelope.kind === 'photo';
  if (!isPhoto && (envelope.kind !== 'text' || typeof envelope.payload?.text !== 'string')) {
    throw new Error('当前解析器仅接受文字输入');
  }
  const rawText = (isPhoto ? (envelope.payload?.caption ?? '') : (envelope.payload?.text ?? '')).trim();
  const kind = isPhoto && !rawText ? 'capture_note' : detectKind(rawText);
  const time = rawText ? parseTime(rawText, options.now ?? envelope.occurredAt, options.timezone) : undefined;
  const highImpact = rawText ? IMPACT_PATTERNS.find((item) => item.pattern.test(rawText)) : undefined;
  const questions: string[] = [];
  if (isPhoto && !rawText) {
    questions.push('想为这张照片留一句说明吗？（可选，不填写也只是一条安静的记录）');
  }
  if ((kind === 'create_task' || kind === 'create_event' || kind === 'create_course') && !time?.start) {
    questions.push('这件事希望安排在什么时候？');
  }
  if (kind === 'unknown' && !highImpact) questions.push('你希望我把它记录、安排到日程，还是创建为待办？');
  if ((kind === 'create_event' || kind === 'create_course') && time?.start && !time.end) {
    questions.push('预计持续多久？');
  }

  const constraints: string[] = [];
  if (isPhoto) constraints.push('照片仅作为记录附件保留本地引用，不自动推断心理状态');
  if (highImpact) constraints.push('高影响动作必须由用户明确确认，且不得由本地解析器直接执行');

  return {
    id: `intent-${hash(`${envelope.id}:${rawText}`)}`,
    sourceEnvelopeId: envelope.id,
    kind,
    title: isPhoto && !rawText ? '照片记录' : cleanTitle(rawText, kind),
    time,
    questions,
    confidence: isPhoto ? (rawText ? 0.6 : 0.45) : kind === 'unknown' ? 0.25 : questions.length > 0 ? 0.66 : 0.9,
    highImpact: Boolean(highImpact),
    highImpactCategory: highImpact?.category,
    constraints,
    rawText,
  };
}
