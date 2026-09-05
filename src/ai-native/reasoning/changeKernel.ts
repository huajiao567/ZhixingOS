import type {
  ChangeContext,
  ChangeOperatorAssessment,
  PathCandidate,
} from '../types';

const DAY = 86_400_000;

function reviewAt(now: string, days: number): string {
  return new Date(Date.parse(now) + days * DAY).toISOString();
}

function qualityRank(context: ChangeContext): number {
  if (context.evidence.some((item) => item.quality === 'consistent')) return 2;
  if (context.evidence.length >= 2) return 1;
  return 0;
}

function assessments(context: ChangeContext, reversible: boolean): ChangeOperatorAssessment[] {
  const evidenceIds = context.evidence.map((item) => item.id);
  const rank = qualityRank(context);
  return [
    {
      operator: '时', fit: rank === 0 ? 'unknown' : 'balanced',
      reason: rank === 0 ? '尚缺少近期证据，先确认时间窗口' : '以当前时间窗口和七日复审控制承诺长度', evidenceIds,
    },
    {
      operator: '位', fit: context.constraints.length ? 'balanced' : 'unknown',
      reason: context.constraints.length ? `已纳入当前边界：${context.constraints.join('；')}` : '尚未提供可用时间、资源或角色边界', evidenceIds,
    },
    {
      operator: '势', fit: context.recentMomentum === 'growing' ? 'strong' : context.recentMomentum === 'unknown' ? 'unknown' : 'balanced',
      reason: context.recentMomentum === 'growing' ? '近期已有推进，适合延续最小下一步' : '近期趋势不明确，避免扩大投入', evidenceIds,
    },
    {
      operator: '应', fit: context.stakeholders.length ? 'balanced' : 'unknown',
      reason: context.stakeholders.length ? `需照顾相关方：${context.stakeholders.join('、')}` : '相关人物与系统响应尚未明确', evidenceIds,
    },
    {
      operator: '变', fit: reversible ? 'strong' : 'weak',
      reason: reversible ? '优先选择可撤销的小步变化' : '当前路径不易撤销，应先缩小范围', evidenceIds,
    },
    {
      operator: '中', fit: context.commitments.length ? 'balanced' : 'unknown',
      reason: context.commitments.length ? `以既有承诺校准负担：${context.commitments.join('；')}` : '尚缺少价值承诺，不能替用户判断取舍', evidenceIds,
    },
  ];
}

export function evaluateChangePaths(context: ChangeContext): PathCandidate[] {
  const rank = qualityRank(context);
  const gaps = [
    ...(rank === 0 ? ['缺少足够的近期事实或用户自述'] : []),
    ...(context.constraints.length === 0 ? ['缺少可用时间或资源边界'] : []),
    ...(context.commitments.length === 0 ? ['缺少用户确认的价值承诺'] : []),
  ];
  const safePath: PathCandidate = {
    id: `path-minimal-${context.object.id}`,
    title: `先推进「${context.object.title}」的最小一步`,
    summary: rank === 0 ? '先补齐一条关键事实，再决定是否执行。' : '利用现有势能完成一个可撤销步骤，七日内复审。',
    assessments: assessments(context, true),
    reversible: true,
    risk: rank === 0 ? 'medium' : 'low',
    requiresConfirmation: rank === 0 || context.agencyLevel === 'A0' || context.agencyLevel === 'A1',
    stopCondition: '一旦超出用户给定边界、出现新风险或首步失败，立即停止并回到确认。',
    reviewAt: reviewAt(context.now, 7),
    evidenceGaps: gaps,
    score: rank === 2 ? 0.82 : rank === 1 ? 0.66 : 0.38,
  };
  const observePath: PathCandidate = {
    id: `path-observe-${context.object.id}`,
    title: '暂不执行，先补充情境',
    summary: '保持现状，收集时间、资源或相关方响应后再比较路径。',
    assessments: assessments(context, true),
    reversible: true,
    risk: 'low',
    requiresConfirmation: rank === 0,
    stopCondition: '获得关键缺失信息或到达复审时间后结束观察。',
    reviewAt: reviewAt(context.now, 3),
    evidenceGaps: gaps,
    score: rank === 0 ? 0.72 : 0.52,
  };
  return [safePath, observePath].sort((a, b) => b.score - a.score);
}
