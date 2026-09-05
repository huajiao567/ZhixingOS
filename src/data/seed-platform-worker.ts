/**
 * 知行镜 ZhixingOS 平台劳动者身份种子数据（V4.3 Task 18.3）
 *
 * 用户画像：李志强，28 岁，外卖骑手（早午晚高峰接单）+ 夜班网约车（部分日子）。
 * 生活节奏由算法派单、天气、电动车电池续航、收入日波动驱动，不由自由日历驱动。
 *
 * 设计要点（V4.3 §7.10 / §7.11 / 附录 AB 公平性测试）：
 *  1. 反监工模式：所有事件归因到劳动者自己的目标（安全、收入稳定、技能积累），不构建「接单排名/绩效羞耻」。
 *  2. 收入波动归因到外部因素（天气、算法派单、平台规则），不写成「我不够努力」。
 *  3. 雨天减速事件标记为「安全策略」（正向），不写成「偷懒」。
 *  4. 所有事件显式标注 axis（SubTask 18.6）。
 *  5. 假设卡 H-p01 显式陈述「收入波动 70% 来自外部因素」，反过度概括。
 */
import {
  LifeEvent, Commitment, Hypothesis, Experiment, MeaningDirection, SkillTrack,
  Project, UserProfile, CheckIn,
} from '../types/models';

const now = Date.now();
const day = 86400_000;
const iso = (offsetDays: number, hour = 9) => {
  const d = new Date(now + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

// ---------------- 用户 ----------------
export const seedUser_platformWorker: UserProfile = {
  name: '志强',
  lifeStage: '成年人',
  constraints: ['算法派单节奏决定接单时段', '天气影响单量与安全', '收入日波动大，按月结算不易预测', '电动车电池续航限制单日时长'],
  onboarded: true,
  silentMode: false,
  proactivity: 'P1',
  secretaryLevel: 'L1',
  weeksOfData: 6,
};

// ---------------- 承诺层 ----------------
export const seedCommitments_platformWorker: Commitment[] = [
  {
    id: 'cm-p1', statement: '月净收入稳定在 8000 元以上（含成本）', why: '还老家房贷 + 个人社保',
    domain: '财务', priority: 1, createdAt: iso(-40), deadline: iso(30),
    costNote: '雨天强制减速，不接受危险订单；每周保留 1 天休息',
    userConfirmed: true, status: 'active',
    acceptance: '连续 3 个月净收入 ≥ 8000 元',
    stopCondition: '若连续 2 个月因天气/平台规则调整低于 6000 元，重新评估是否兼职网约车而非硬撑接单',
  },
  {
    id: 'cm-p2', statement: '每周至少 1 天完整休息（不接单）', why: '平台劳动者恢复权，不是奖励',
    domain: '身体', priority: 2, createdAt: iso(-38),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周实际休息 ≥1 个完整日',
    stopCondition: '若遇极端天气高单量周可调整，但不可连续 2 周不休息',
  },
  {
    id: 'cm-p3', statement: '雨天强制限速 25km/h，不接受超时订单', why: '安全 > 单量；摔一次医药费 > 一周收入',
    domain: '身体', priority: 3, createdAt: iso(-35),
    userConfirmed: true, status: 'active',
    acceptance: '雨天所有订单限速 25km/h，超时主动告知客服',
    stopCondition: '永不停止（安全底线）',
  },
  {
    id: 'cm-p4', statement: '每月积累 2 次应急维修练习', why: '为转行做电动车维修技师做准备',
    domain: '学习', priority: 4, createdAt: iso(-25), deadline: iso(120),
    userConfirmed: true, status: 'active',
    acceptance: '连续 3 个月每月 ≥2 次实地练习',
    stopCondition: '若挤占休息时间则降为每月 1 次，不强行',
  },
];

// ---------------- 事件（事实层，全部显式 axis） ----------------
export const seedEvents_platformWorker: LifeEvent[] = [
  // === 未来 14 天高峰接单日历（outer） ===
  ...Array.from({ length: 14 }).flatMap((_, i): LifeEvent[] => {
    const dow = (new Date(now + i * day).getDay() + 6) % 7; // 0=周一
    const evts: LifeEvent[] = [];
    evts.push({
      id: `cal-p-morn-${i}`, type: 'calendar', title: '早高峰外卖（7:00-9:00）',
      sourceType: 'calendar', sourceRef: 'system-calendar',
      startTime: iso(i, 7), endTime: iso(i, 9), domain: '工作', sensitivity: 'normal',
      confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    });
    evts.push({
      id: `cal-p-noon-${i}`, type: 'calendar', title: '午高峰外卖（11:00-13:00）',
      sourceType: 'calendar', sourceRef: 'system-calendar',
      startTime: iso(i, 11), endTime: iso(i, 13), domain: '工作', sensitivity: 'normal',
      confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    });
    evts.push({
      id: `cal-p-eve-${i}`, type: 'calendar', title: '晚高峰外卖（17:00-20:00）',
      sourceType: 'calendar', sourceRef: 'system-calendar',
      startTime: iso(i, 17), endTime: iso(i, 20), domain: '工作', sensitivity: 'normal',
      confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    });
    if (dow === 2 || dow === 4 || dow === 6) {
      evts.push({
        id: `cal-p-night-${i}`, type: 'calendar', title: '夜班网约车（21:00-24:00）',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 21), endTime: iso(i, 24), domain: '工作', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
    }
    return evts;
  }),
  // === 过去 6 周健康摘要（outer） ===
  ...Array.from({ length: 10 }).map((_, i): LifeEvent => ({
    id: `hl-p-${i}`, type: 'health',
    title: `睡眠 ${i === 4 || i === 8 ? '6小时00分（夜班后）' : '7小时20分'} · 步数 ${18000 + ((i * 2317) % 6000)}（骑行+步行）`,
    detail: '设备端按日聚合摘要', sourceType: 'device', sourceRef: 'health-connect',
    startTime: iso(-9 + i, 7), domain: '身体', sensitivity: 'sensitive',
    confidence: 0.95, consentId: 'perm-health', layer: 'fact', axis: 'outer',
  })),
  // === 过去 6 周收入记录（outer，按日聚合）===
  ...Array.from({ length: 14 }).map((_, i): LifeEvent => {
    const weather = i === 2 || i === 9 ? '雨' : '晴';
    const income = weather === '雨' ? 380 + ((i * 17) % 80) : 220 + ((i * 13) % 70);
    return {
      id: `inc-p-${i}`, type: 'work', title: `日收入 ¥${income}（${weather}）`,
      detail: weather === '雨' ? '雨天加价 + 雨天补贴，但限速 25km/h' : '常规单量',
      sourceType: 'task_app', sourceRef: 'platform-income',
      startTime: iso(-13 + i, 22), domain: '财务', sensitivity: 'sensitive',
      confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer',
      relatedCommitmentId: 'cm-p1',
    };
  }),
  // === 天气与安全事件（outer）===
  { id: 'ev-p-rain1', type: 'work', title: '雨天主动限速：6 单全部按时限 25km/h 完成', detail: '2 单超时主动告知客服', sourceType: 'task_app', sourceRef: 'platform-app', startTime: iso(-12, 12), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-p3', userInterpretation: '雨天限速后没摔，比上周同行少 1 单但人没事' },
  { id: 'ev-p-rain2', type: 'work', title: '雨天接紧急单（拒绝）', detail: '超时 30 分钟订单，雨大路口积水', sourceType: 'task_app', sourceRef: 'platform-app', startTime: iso(-5, 18), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-p3' },
  // === 应急维修练习（outer，技能证据）===
  { id: 'ev-p-fix1', type: 'work', title: '电动车补胎练习（修理店观摩）', detail: '60 分钟，店主指导', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-21, 14), endTime: iso(-21, 15), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-p4' },
  { id: 'ev-p-fix2', type: 'work', title: '刹车线调整练习（独立完成）', detail: '45 分钟，店主检查通过', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-7, 14), endTime: iso(-7, 15), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-p4', userInterpretation: '第一次独立完成，店主说可以了' },
  // === 休息日事件（outer）===
  { id: 'ev-p-rest1', type: 'calendar', title: '完整休息日（不接单）', detail: '周二单量最低，选择休息', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-14, 0), endTime: iso(-14, 24), domain: '身体', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-p2' },
  { id: 'ev-p-rest2', type: 'calendar', title: '完整休息日（不接单）', detail: '周二单量最低，选择休息', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-7, 0), endTime: iso(-7, 24), domain: '身体', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-p2' },
  // === 反证事件：高单量日也坚持休息 ===
  { id: 'ev-p-rest-win', type: 'calendar', title: '雨天高单量日仍按计划休息', detail: '周二雨天预计单量高，仍选择休息', sourceType: 'journal', sourceRef: 'voice-diary', startTime: iso(-2, 0), endTime: iso(-2, 24), domain: '身体', sensitivity: 'normal', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-p2', userInterpretation: '本来想接，但回想上周摔车差点事，还是算了' },
  // === 日记（inner，主观体验）===
  { id: 'j-p-1', type: 'journal', title: '语音日记：算法改版后的无力感', detail: '转写 1 分 40 秒', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-10, 22), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '今天算法改版，同样的时段单量少了 30%。一开始想「是不是我跑得不够勤」，后来群里大家都说少了。可能不是我的问题，是算法规则变了。' },
  { id: 'j-p-2', type: 'journal', title: '日记：雨天摔车后的想法', sourceType: 'user', sourceRef: 'text-diary', startTime: iso(-4, 23), domain: '身体', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '今天雨大差点摔，幸好提前减速了。以前总觉得减速是亏钱，今天觉得是省医药费。安全这事不能算单笔账。' },
  { id: 'j-p-3', type: 'journal', title: '语音日记：维修店学习的满足', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-7, 22), domain: '学习', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '今天独立调了刹车线，店主说可以了。这是我第一次觉得「我也能学门手艺」，不只是卖力气。' },
  // === 决策卡（inner）===
  { id: 'd-p-1', type: 'decision', title: '决策卡：是否注册为平台全职骑手', detail: '选项、预测与理由已记录，30 天后复盘', sourceType: 'user', sourceRef: 'decision-card', startTime: iso(-6, 17), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '预测：全职有保底但失去网约车灵活性；理由：先兼职维持，等维修技能上来再考虑转行。' },
  // === 实验结果事件（inner，主观打卡）===
  { id: 'o-p-1', type: 'outcome', title: '实验记录：雨天限速 25km/h（第 4 天）', detail: '6 单完成，主观焦虑 3/10', sourceType: 'user', sourceRef: 'experiment-checkin', startTime: iso(-1, 21), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', relatedCommitmentId: 'cm-p3' },
];

// ---------------- 假设卡 ----------------
export const seedHypotheses_platformWorker: Hypothesis[] = [
  {
    id: 'H-p01', version: 2,
    statement: '过去六周，你的收入日波动约 70% 可由天气与算法派单节奏解释，剩余 30% 与个人接单时长相关；收入波动主要由外部因素驱动，不是个人努力程度。',
    supporting: [
      { eventId: 'inc-p-2', quote: '雨天日收入 ¥380+，晴天 ¥220+', time: iso(-11, 22), sourceType: 'task_app' },
      { eventId: 'inc-p-9', quote: '雨天日收入 ¥400+', time: iso(-4, 22), sourceType: 'task_app' },
      { eventId: 'j-p-1', quote: '算法改版后单量少 30%，群内同行普遍反映', time: iso(-10, 22), sourceType: 'journal' },
    ],
    countering: [
      { eventId: 'ev-p-rest-win', quote: '雨天高单量日主动休息，是个人选择影响收入', time: iso(-2, 0), sourceType: 'journal' },
    ],
    dataGaps: ['未导入同行同时段收入对照', '算法规则变更时间点无精确记录'],
    alternatives: ['收入波动部分由休息选择决定（反证 ev-p-rest-win）', '雨天高收入是平台补贴而非真实需求增长'],
    confidence: 0.60,
    harmNote: '可能被读作「骑手就是赚辛苦钱，别想多」——本假设不评判职业价值。收入波动的外部性是平台劳动的结构特征，不是个人能力问题。',
    suggestedExperimentId: 'exp-p2',
    reviewAt: iso(10),
    status: 'open',
    createdAt: iso(-7),
    history: [
      { at: iso(-14), change: '创建 v1（基于 2 周数据）', confidence: 0.50 },
      { at: iso(-7), change: 'v2：加入反证 ev-p-rest-win，置信度 0.50→0.60，明确外部性归因', confidence: 0.60 },
    ],
  },
  {
    id: 'H-p02', version: 1,
    statement: '你在雨天主动减速后的次日疲劳度低于上周同期；安全策略可能是可持续接单的条件，而不是收入损失。',
    supporting: [
      { eventId: 'ev-p-rain1', quote: '雨天限速 25km/h，6 单完成无事故', time: iso(-12, 12), sourceType: 'task_app' },
      { eventId: 'j-p-2', quote: '雨天减速后「省医药费」的认知转变', time: iso(-4, 23), sourceType: 'journal' },
      { eventId: 'hl-p-4', quote: '减速后次日睡眠 7 小时 20 分（正常）', time: iso(-5, 7), sourceType: 'device' },
    ],
    countering: [
      { eventId: 'inc-p-2', quote: '雨天减速后单笔收入仍高于晴天（平台补贴）', time: iso(-11, 22), sourceType: 'task_app' },
    ],
    dataGaps: ['未标准化「疲劳度」测量', '未对照不减速同行的次日疲劳'],
    alternatives: ['次日疲劳低是因为休息日临近，不是减速效应', '雨天补贴抵消了减速损失，不是减速本身可持续'],
    confidence: 0.52,
    harmNote: '不评判「该不该减速」——这是用户自主的安全选择。',
    suggestedExperimentId: 'exp-p1',
    reviewAt: iso(14),
    status: 'open',
    createdAt: iso(-3),
    history: [{ at: iso(-3), change: '创建 v1', confidence: 0.52 }],
  },
];

// ---------------- 实验 ----------------
const mkCheckIns_platform = (startOffset: number, n: number, pattern: (i: number) => [boolean, string]): CheckIn[] =>
  Array.from({ length: n }).map((_, i) => {
    const [done, note] = pattern(i);
    return { date: iso(startOffset + i), done, note };
  });

export const seedExperiments_platformWorker: Experiment[] = [
  {
    id: 'exp-p1', kind: '微调实验', hypothesisId: 'H-p02',
    question: '雨天强制限速 25km/h 连续 7 天，对比同期疲劳度与净收入，是否能验证「安全策略可持续」？',
    baseline: '过去 4 周雨天未系统限速，主观焦虑 6/10，曾 1 次近摔',
    intervention: '未来 7 个雨天，所有订单限速 25km/h；超时主动告知客服；记录每日疲劳度与净收入',
    metrics: ['主观疲劳度 1-10（主观）', '日净收入（外部）', '事故/近摔次数（行为）'],
    confounders: ['雨量大小', '平台补贴规则', '电池续航'],
    stopRule: '出现事故或连续 2 天净收入低于 100 元时暂停',
    sideEffects: '可能触发平台超时扣分，需接受短期评分下降',
    durationDays: 7, startDate: iso(-4), status: 'active',
    checkIns: mkCheckIns_platform(-4, 4, (i) => [
      true,
      ['限速完成 6 单，疲劳 4/10，收入 ¥280', '限速完成 5 单，疲劳 3/10，收入 ¥260', '限速完成 7 单，疲劳 5/10，雨大但无近摔', '限速完成 6 单，疲劳 3/10，收入 ¥300'][i],
    ]),
  },
  {
    id: 'exp-p2', kind: '结构实验', hypothesisId: 'H-p01',
    question: '每周固定 1 天休息（周二单量最低），连续 30 天，净收入影响是否在可接受范围？',
    baseline: '过去 4 周实际休息 1.5 天/周，但分布不规律',
    intervention: '未来 4 周，每周二固定不接单；其他 6 天正常接单',
    metrics: ['月净收入（外部）', '主观疲劳度 1-10（主观）', '事故/近摔次数（行为）'],
    confounders: ['天气', '平台规则变更', '电池续航'],
    stopRule: '月净收入低于 6000 元时暂停并重新评估',
    sideEffects: '可能错过周二偶发高单量日',
    durationDays: 30, startDate: iso(3), status: 'proposed',
    checkIns: [],
  },
];

// ---------------- 意义方向 ----------------
export const seedDirections_platformWorker: MeaningDirection[] = [
  {
    id: 'dir-p1', statement: '在不牺牲安全的前提下维持收入', serveWhom: '自己与家人',
    contribution: '雨天限速、每周休息、不接危险订单', costBoundary: '不以事故风险换收入',
    skillIds: [], projectIds: ['pj-p1'], evidenceScore: 0.55, trend: 'up',
  },
  {
    id: 'dir-p2', statement: '为转行积累可迁移技能', serveWhom: '未来的自己',
    contribution: '电动车维修练习、维修店观摩', costBoundary: '不挤占休息时间',
    skillIds: ['sk-p1'], projectIds: ['pj-p2'], evidenceScore: 0.35, trend: 'up',
  },
];

// ---------------- 技能 ----------------
export const seedSkills_platformWorker: SkillTrack[] = [
  {
    id: 'sk-p1', name: '电动车维修基础',
    targetPerformance: '能独立完成补胎、刹车线调整、电池检测 3 项基础操作',
    baseline: '观摩 1 次，未独立操作',
    rubric: ['补胎', '刹车系统', '电池检测', '电路排查', '工具使用'],
    prerequisites: ['安全意识', '工具熟悉'],
    stage: '基线诊断', mastery: 0.18, weeklyPlan: '本周：休息日去维修店观摩 1 次（90 分钟）+ 独立补胎练习 1 次',
    evidences: [
      { date: iso(-21), kind: '练习', note: '补胎观摩 60 分钟' },
      { date: iso(-7), kind: '作品', note: '刹车线调整独立完成（店主检查通过）' },
    ],
    replanReason: '原计划「每周 2 次练习」受天气与接单影响不稳定——改为「休息日固定 1 次」',
  },
  {
    id: 'sk-p2', name: '城市道路网络记忆',
    targetPerformance: '能不依赖导航完成主城区 80% 商圈与小区的最优路径',
    baseline: '已熟悉 60% 主城区，但远郊不熟',
    rubric: ['商圈路径', '小区捷径', '高峰避堵', '夜间识别', '天气适配'],
    prerequisites: ['长期接单经验'],
    stage: '迁移验证', mastery: 0.62, weeklyPlan: '本周：记录 3 个新学的小区捷径',
    evidences: [
      { date: iso(-15), kind: '迁移', note: '雨天发现 3 条避积水路线' },
      { date: iso(-3), kind: '练习', note: '记录 5 个新小区捷径' },
    ],
  },
];

// ---------------- 项目 ----------------
export const seedProjects_platformWorker: Project[] = [
  {
    id: 'pj-p1', name: '安全骑行与收入平衡',
    mission: '在不牺牲安全的前提下维持月净收入 ≥ 8000 元；成功 = 连续 3 个月达标 + 0 事故',
    nonGoals: '不追求平台排名，不接受平台「骑手激励」中的危险订单',
    nextKeyAction: '本周三雨天限速 25km/h，记录疲劳度与收入',
    criticalPath: ['雨天限速', '每周休息', '电池管理', '事故归零', '收入达标'],
    milestones: [
      { title: '雨天限速 7 天', due: iso(3), done: false, acceptance: '0 事故 + 疲劳度 ≤ 5/10' },
      { title: '4 周休息落地', due: iso(0), done: true, acceptance: '4 个完整休息日' },
      { title: '月收入达标', due: iso(30), done: false, acceptance: '净收入 ≥ 8000 元' },
    ],
    risks: [
      { title: '平台规则变更影响单量', signal: '单日单量下降 > 30%', level: 'high', mitigation: '不可控，记录但不自责；必要时增加网约车时段', reviewAt: iso(14) },
      { title: '雨天事故风险', signal: '单周近摔 ≥ 1 次', level: 'high', mitigation: '强制限速 25km/h + 拒绝超时订单', reviewAt: iso(7) },
    ],
    decisionLedger: [
      { date: iso(-6), options: '注册全职 / 维持兼职', decision: '维持兼职', reason: '保留灵活性，等维修技能上来再转行', reviewAt: iso(30) },
    ],
    meaningLoop: '服务方向 dir-p1；当前进度符合承诺 cm-p1/cm-p3。',
    progress: 0.45, status: 'active',
  },
  {
    id: 'pj-p2', name: '电动车维修技能积累',
    mission: '6 个月内能独立完成 5 项基础维修，为转行做准备；成功 = 店主确认可独立接单',
    nonGoals: '不急于开店，不挤占接单时间',
    nextKeyAction: '本周日去维修店观摩 90 分钟',
    criticalPath: ['观摩', '独立补胎', '独立刹车调整', '电池检测', '店主确认'],
    milestones: [
      { title: '观摩 4 次', due: iso(-7), done: true, acceptance: '店主认可学习态度' },
      { title: '独立补胎 3 次', due: iso(21), done: false, acceptance: '店主检查通过' },
      { title: '电池检测练习', due: iso(60), done: false, acceptance: '能识别 3 类常见电池故障' },
    ],
    risks: [
      { title: '天气挤占学习日', signal: '连续 2 周未去维修店', level: 'mid', mitigation: '改为室内理论学习（视频）', reviewAt: iso(14) },
    ],
    decisionLedger: [],
    meaningLoop: '服务方向 dir-p2；当前进度 30%，符合承诺 cm-p4。',
    progress: 0.30, status: 'active',
  },
];
