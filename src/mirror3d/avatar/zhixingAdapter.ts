import type { LifeEvent, Commitment, Project, Experiment } from '../../types/models';
import type { DailySignals, PersonalBaseline } from '../types/avatar';
import { clamp } from './math';

export interface ZhixingDataContext {
  events: LifeEvent[];
  commitments: Commitment[];
  projects: Project[];
  experiments: Experiment[];
  wearable?: Partial<Pick<DailySignals, 'sleepHours' | 'sleepQuality' | 'hrvRelative' | 'steps' | 'workoutMinutes'>>;
  baseline?: Partial<PersonalBaseline>;
}

/**
 * 把真实领域模型转换为 3D 镜像使用的可解释聚合信号（v1：不直接映射六位状态）。
 * 日记只在本机读取 userInterpretation；不发送任何原始记录到外部模型。
 */
export function deriveSignalsFromZhixing(context: ZhixingDataContext): DailySignals {
  const events = context.events.slice(-30);

  // 日记来自用户自述（主观体验）：axis === 'inner' 或 journal 类型，且含有 userInterpretation
  const diaryEvents = events.filter(
    (e) =>
      e.axis === 'inner' ||
      e.type === 'journal' ||
      (e.userInterpretation && e.userInterpretation.trim().length > 0),
  );
  const diary = diaryEvents
    .slice(-3)
    .map((e) => e.userInterpretation ?? '')
    .filter(Boolean)
    .join('；');

  const activeCommitments = context.commitments.filter((c) => c.status === 'active');
  const projectProgressValues = context.projects
    .map((p) => p.progress)
    .filter((value): value is number => typeof value === 'number');
  const projectMomentum = projectProgressValues.length
    ? projectProgressValues.reduce((sum, value) => sum + value, 0) / projectProgressValues.length
    : 0.45;

  const doneCheckIns = context.experiments
    .flatMap((e) => e.checkIns ?? [])
    .filter((c) => c.done).length;

  const moodValues = events.map((e) => e.mood).filter((m): m is number => typeof m === 'number');
  const avgMood = moodValues.length
    ? moodValues.reduce((sum, value) => sum + value, 0) / moodValues.length
    : 0;

  // 用真实字段（domain + title + userInterpretation）做关键词匹配
  const workEvents = events.filter((e) => {
    const text = `${e.domain ?? ''} ${e.title ?? ''} ${e.userInterpretation ?? ''}`;
    return /工作|行动|项目|学习|创作|完成|推进|健康|运动|作品/.test(text);
  }).length;

  return {
    sleepHours: context.wearable?.sleepHours ?? 7.1,
    sleepQuality: context.wearable?.sleepQuality ?? clamp(0.68 + avgMood * 0.12),
    hrvRelative: context.wearable?.hrvRelative ?? 1,
    steps: context.wearable?.steps ?? 6200,
    workoutMinutes: context.wearable?.workoutMinutes ?? 18,
    focusMinutes: Math.min(240, workEvents * 22),
    taskCompletion: clamp(0.38 + doneCheckIns * 0.08 + projectMomentum * 0.28),
    projectMomentum: clamp(projectMomentum),
    scheduleLoad: clamp(0.30 + activeCommitments.length * 0.10),
    diary,
  };
}
