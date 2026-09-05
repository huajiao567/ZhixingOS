import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import type { LifeObject } from '../ai-native/types';
import { api } from './api';
import { permissionDecision, registerSourcePermission } from './permissions';

export interface TaskWriteResult {
  externalId: string;
  target: 'zhixingos' | 'ios_reminders';
  message: string;
  undoToken: string;
}

export async function persistLifeObject(object: LifeObject): Promise<TaskWriteResult> {
  const saved = await api.post<LifeObject>('/api/runtime/life-objects', object);
  return {
    externalId: saved.id,
    target: 'zhixingos',
    message: `已写入知行镜${saved.kind === 'course' ? '课程' : saved.kind === 'task' ? '待办' : '生命对象'}`,
    undoToken: `${saved.id}:${saved.version}`,
  };
}

export async function cancelLifeObject(undoToken: string): Promise<void> {
  const separator = undoToken.lastIndexOf(':');
  if (separator <= 0) throw new Error('生命对象撤销令牌无效');
  const id = undoToken.slice(0, separator);
  const expectedVersion = Number(undoToken.slice(separator + 1));
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('生命对象撤销版本无效');
  await api.post(`/api/runtime/life-objects/${encodeURIComponent(id)}/cancel`, { expectedVersion });
}

export async function createIosReminder(object: LifeObject): Promise<TaskWriteResult> {
  if (Platform.OS !== 'ios') throw new Error('系统提醒事项只在 iOS 提供；知行镜待办仍可正常使用');
  if (object.kind !== 'task') throw new Error('只有待办对象可同步到提醒事项');
  const response = await Calendar.requestRemindersPermissions();
  const permission = permissionDecision(response, '系统提醒事项');
  if (!permission.granted) throw new Error(permission.message);
  await registerSourcePermission('task', '仅在用户确认后同步到 iOS 提醒事项', {
    access: 'read+write', execution: 'user_confirmed_only',
  });
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.REMINDER);
  const writable = calendars.find((item) => item.allowsModifications);
  if (!writable) throw new Error('设备上没有可写的提醒事项列表');
  const reminder = await writable.createReminder({
    title: object.title,
    notes: `由知行镜在用户确认后创建 · 对象 ${object.id}`,
    startDate: object.startsAt,
    dueDate: object.endsAt ?? object.startsAt,
    completed: false,
  });
  if (!reminder.id) throw new Error('系统没有返回提醒事项 ID，写入状态无法验证');
  return {
    externalId: reminder.id,
    target: 'ios_reminders',
    message: '已同步到 iOS 提醒事项',
    undoToken: reminder.id,
  };
}

export async function deleteIosReminder(reminderId: string): Promise<void> {
  if (Platform.OS !== 'ios') throw new Error('当前平台没有 iOS 提醒事项撤销能力');
  const reminder = await Calendar.ExpoCalendarReminder.get(reminderId);
  await reminder.delete();
}

