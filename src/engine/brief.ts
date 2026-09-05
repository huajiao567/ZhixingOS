/**
 * 今日简报（90 秒知行简报）与秘书回复引擎
 * 策划书 5.3：最多一条事实变化、一个重要承诺、一个建议行动、一个高信息量问题
 *
 * V4.3 修复：原 factChange 为硬编码假数据（"晚饭前 25 分钟连续 4 天启动成功"），
 * 违反「禁止作弊经验参数」。现改为基于真实 s.events / s.experiments / s.state 计算。
 */
import { AppState } from './briefTypes';
import { BriefCard } from '../types/models';

export function buildTodayBrief(s: AppState): BriefCard {
  const activeExp = s.experiments.find((e) => e.status === 'active');
  const topCommitment = s.commitments
    .filter((c) => c.status === 'active')
    .sort((a, b) => a.priority - b.priority)[0];

  // 事实变化：基于真实最近事件（不再硬编码）
  const recentEvents = s.events.slice(0, 3);
  const latest = recentEvents[0];
  const factChange: { title: string; detail: string; gap?: string } = latest
    ? {
        title: latest.title,
        detail: latest.userInterpretation ?? latest.detail ?? '（无补充说明）',
        gap: recentEvents.length < 3 ? '记录还较少，暂看不出稳定规律。' : undefined,
      }
    : {
        title: '今天还没有记录',
        detail: '记一件今天真实发生的小事，作为镜子里的第一块基石。',
        gap: '尚无记录，无法识别变化。',
      };

  // 建议行动：基于真实 active experiment 或 top commitment
  const action = activeExp
    ? {
        title: activeExp.intervention ? `今天尝试：${activeExp.intervention}` : '推进进行中的实验',
        detail: `正在验证：${activeExp.question}（已打卡 ${activeExp.checkIns.length} 天）`,
      }
    : topCommitment
      ? {
          title: `推进「${topCommitment.statement}」`,
          detail: topCommitment.why ? `为什么重要：${topCommitment.why}` : '今天一个小步骤即可。',
        }
      : { title: '从镜像中选择一个 7 天实验', detail: '把本周观察转为一次低风险现实验证。' };

  // 高信息量问题：基于 divergence（内外落差）动态选择
  const highDiv = s.state?.divergence != null && s.state.divergence > 0.3;
  const question = highDiv
    ? '你外在表现出的状态，和你内在真实感受之间，差在哪里？'
    : '今天哪件小事最值得被记住？';

  return {
    factChange,
    commitment: topCommitment,
    action,
    question,
  };
}

/** 高风险表达识别（策划书 3.9：L2 高风险线索 → 停止常规模型，提供现实求助路径）
 * 采用「词组命中」而非整句匹配，避免被插入语绕过 */
const L2_TERMS = ['不想活', '自杀', '结束生命', '伤害自己', '自残', '活着没', '活着真没', '想死', '死了算', '轻生', '杀了他', '伤害别人', '报复社会'];

export function riskLevel(text: string): 0 | 1 | 2 {
  const compact = text.replace(/[\s，。、！？!?,.\u3000]/g, '');
  if (L2_TERMS.some((t) => compact.includes(t))) return 2;
  if (/崩溃|撑不住|绝望|失眠.{0,6}(周|个月)|抑郁|焦虑到/.test(compact)) return 1;
  return 0;
}
