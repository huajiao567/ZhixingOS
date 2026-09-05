import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import type { LifeObject } from '../ai-native/types';
import { permissionDecision, registerSourcePermission, type PermissionDecision } from './permissions';

export interface CalendarWriteResult {
  externalId: string;
  calendarId: string;
  calendarTitle: string;
  message: string;
  undoToken: string;
}

export function selectWritableCalendar<T extends {
  id: string;
  title: string;
  allowsModifications: boolean;
  isPrimary?: boolean;
  isVisible?: boolean;
  isSynced?: boolean;
}>(calendars: T[]): T | null {
  return [...calendars]
    .filter((item) => item.allowsModifications && item.isVisible !== false && item.isSynced !== false)
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || a.title.localeCompare(b.title))[0] ?? null;
}

export async function requestCalendarAccess(): Promise<PermissionDecision> {
  if (Platform.OS === 'web') {
    return { granted: false, status: 'unavailable', canAskAgain: false, message: '浏览器不能直接写入系统日历，已保留为待执行草稿' };
  }
  const response = await Calendar.requestCalendarPermissions(false);
  const decision = permissionDecision(response, '系统日历');
  if (decision.granted) {
    await registerSourcePermission('calendar', '仅在用户确认动作后创建或撤销日程', {
      access: 'read+write',
      execution: 'user_confirmed_only',
    });
  }
  return decision;
}

export async function createCalendarEvent(object: LifeObject): Promise<CalendarWriteResult> {
  if (object.kind !== 'event' && object.kind !== 'course') throw new Error('只有日程或课程对象可写入系统日历');
  if (!object.startsAt || !object.endsAt) throw new Error('日程缺少完整的开始或结束时间');
  if (Date.parse(object.startsAt) >= Date.parse(object.endsAt)) throw new Error('日程结束时间必须晚于开始时间');

  const permission = await requestCalendarAccess();
  if (!permission.granted) throw new Error(permission.message);
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const writable = selectWritableCalendar(calendars);
  if (!writable) throw new Error('设备上没有可写日历，请先在系统日历中创建或启用一个日历');

  const created = await writable.createEvent({
    title: object.title,
    notes: `由知行镜在用户确认后创建 · 对象 ${object.id}`,
    startDate: object.startsAt,
    endDate: object.endsAt,
    allDay: false,
  });
  if (!created.id) throw new Error('系统日历没有返回事件 ID，写入状态无法验证');
  return {
    externalId: created.id,
    calendarId: writable.id,
    calendarTitle: writable.title,
    message: `已写入系统日历「${writable.title}」`,
    undoToken: created.id,
  };
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('浏览器没有系统日历撤销能力');
  const permission = await Calendar.getCalendarPermissions(false);
  if (!permission.granted) throw new Error('系统日历权限已撤回，无法验证或撤销该事件');
  const event = await Calendar.ExpoCalendarEvent.get(eventId);
  await event.delete();
}

