import type { ContextSurface, LifeObject, PathCandidate } from '../types';

export interface SurfaceCompileInput {
  object?: LifeObject;
  paths?: PathCandidate[];
  questions?: string[];
}

export function compileContextSurface(input: SurfaceCompileInput): ContextSurface {
  if (!input.object) {
    return {
      id: 'surface-empty', state: 'empty', eyebrow: '开放工作台', title: '把此刻交给知行镜',
      summary: '可以记录感受，也可以创建待办、日程或课程。写入前会先让你确认。',
      alternativePaths: [], questions: [], evidenceNote: '尚未形成生命对象。',
    };
  }
  const paths = input.paths ?? [];
  const primaryPath = paths[0];
  const evidenceQuestions = primaryPath?.evidenceGaps.map((gap) => `为了继续，需要补充：${gap}`) ?? [];
  const questions = [...new Set([...(input.questions ?? []), ...evidenceQuestions])];
  const state = questions.length > 0 ? 'needs_input' : primaryPath ? 'ready' : 'blocked';
  return {
    id: `surface-${input.object.id}-${input.object.version}`,
    state,
    eyebrow: input.object.kind === 'course' ? '课程情境' : input.object.kind === 'event' ? '日程情境' : '当前事项',
    title: input.object.title,
    summary: primaryPath?.summary ?? '对象已经识别，但尚无安全可执行的路径。',
    object: input.object,
    primaryPath,
    alternativePaths: paths.slice(1),
    questions,
    evidenceNote: primaryPath?.evidenceGaps.length
      ? `仍有 ${primaryPath.evidenceGaps.length} 项证据缺口。`
      : '建议基于现有证据生成；执行前仍可修改。',
  };
}

