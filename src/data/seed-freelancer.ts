/**
 * 知行镜 ZhixingOS 自由职业者身份种子数据（V4.3 Task 18.5）
 *
 * 用户画像：林溪，30 岁，自由设计师/插画师。客户项目 + 自主创作并行，收入月度波动，自我管理难度大，独居有孤独感。
 * 生活节奏由客户对接、提案、收入到账、自主创作节奏驱动，不由固定日历驱动。
 *
 * 设计要点（V4.3 §7.10）：
 *  1. 创作周期模式：保护探索/空白期，作品证据优于日更。
 *  2. 收入波动归因到外部因素（客户付款周期、市场行情），不写成「我不够好」。
 *  3. 提案被拒事件标记为「信息反馈」（中性），不写成「我能力不行」。
 *  4. 孤独感通过「每月 2 位同行深度交流」承诺结构性缓解，不写成「需要陪伴」的个人缺陷。
 *  5. 所有事件显式标注 axis（SubTask 18.6）。
 */
import {
  LifeEvent, Commitment, Hypothesis, Experiment, MeaningDirection, SkillTrack,
  Project, UserProfile, CheckIn,
} from '../types/models';

const now = Date.now();
const day = 86400_000;
const iso = (offsetDays: number, hour = 9, minute = 0) => {
  const d = new Date(now + offsetDays * day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

// ---------------- 用户 ----------------
export const seedUser_freelancer: UserProfile = {
  name: '林溪',
  lifeStage: '成年人',
  constraints: ['客户对接节奏不可控', '收入月度波动大', '自我管理无外部结构', '独居，长期创作有孤独感'],
  onboarded: true,
  silentMode: false,
  proactivity: 'P1',
  secretaryLevel: 'L2',
  weeksOfData: 6,
};

// ---------------- 承诺层 ----------------
export const seedCommitments_freelancer: Commitment[] = [
  {
    id: 'cm-f1', statement: '每月至少完成 1 个客户项目', why: '维持基本收入与作品集更新',
    domain: '创造', priority: 1, createdAt: iso(-40), deadline: iso(20),
    costNote: '客户项目优先于自主创作，但每周保留 1 天自主日',
    userConfirmed: true, status: 'active',
    acceptance: '连续 3 个月每月 ≥1 个客户项目交付且客户验收通过',
    stopCondition: '若连续 2 个月无客户签约，启动转售作品集而非硬撑低价接单',
  },
  {
    id: 'cm-f2', statement: '每周保留 1 天自主创作（不被客户挤占）', why: '自主作品集是议价权的来源',
    domain: '创造', priority: 2, createdAt: iso(-38),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周实际落地 ≥1 个自主创作日',
    stopCondition: '若客户项目紧急可调整为半天，但不可连续 2 周取消',
  },
  {
    id: 'cm-f3', statement: '每月与 2 位同行深度交流（≥ 60 分钟）', why: '对抗自由职业的孤独感与视野收窄',
    domain: '关系', priority: 3, createdAt: iso(-30),
    userConfirmed: true, status: 'active',
    acceptance: '连续 3 个月每月 ≥2 次同行深度交流',
    stopCondition: '若交流退化为「互相吐槽」则暂停，改为按主题约谈',
  },
  {
    id: 'cm-f4', statement: '建立 3 个月应急基金（覆盖基本开支）', why: '收入波动下的心理安全底线',
    domain: '财务', priority: 4, createdAt: iso(-25), deadline: iso(90),
    userConfirmed: true, status: 'active',
    acceptance: '应急基金 ≥ 3 个月基本开支',
    stopCondition: '若遇客户大额欠款可动用，事后补充即可',
  },
];

// ---------------- 事件（事实层，全部显式 axis） ----------------
export const seedEvents_freelancer: LifeEvent[] = [
  // === 未来 14 天客户项目日历（outer） ===
  ...Array.from({ length: 14 }).flatMap((_, i): LifeEvent[] => {
    const dow = (new Date(now + i * day).getDay() + 6) % 7; // 0=周一
    const evts: LifeEvent[] = [];
    if (dow < 5) {
      evts.push({
        id: `cal-f-client-${i}`, type: 'calendar', title: '客户项目 A：品牌视觉设计',
        detail: `第 ${i + 1} 天工作块`, sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 10), endTime: iso(i, 13), domain: '创造', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
        relatedCommitmentId: 'cm-f1',
      });
      evts.push({
        id: `cal-f-comm-${i}`, type: 'calendar', title: '客户沟通（邮件/视频）',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 14), endTime: iso(i, 15), domain: '工作', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
    }
    if (dow === 1) {
      evts.push({
        id: `cal-f-self-${i}`, type: 'calendar', title: '自主创作日（不被客户挤占）',
        detail: '周二全天，主题：城市记忆插画系列', sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 10), endTime: iso(i, 18), domain: '创造', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
        relatedCommitmentId: 'cm-f2',
      });
    }
    return evts;
  }),
  // === 过去 2 周健康摘要（outer，按日聚合，覆盖完整 14 天） ===
  ...Array.from({ length: 14 }).map((_, i): LifeEvent => ({
    id: `hl-f-${i}`, type: 'health',
    title: `睡眠 ${i === 4 || i === 8 ? '5小时30分（客户deadline前夜）' : '7小时30分'} · 步数 ${1800 + ((i * 527) % 2500)}`,
    detail: '设备端按日聚合摘要', sourceType: 'device', sourceRef: 'health-connect',
    startTime: iso(-13 + i, 7), domain: '身体', sensitivity: 'sensitive',
    confidence: 0.95, consentId: 'perm-health', layer: 'fact', axis: 'outer',
  })),
  // === 过去 6 周客户项目行为证据（假设卡 H-f01 证据链） ===
  { id: 'ev-f-cli1', type: 'work', title: '客户项目 A：按时启动，3 天完成初稿', detail: '收入到账后第 2 天启动', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-35, 10), endTime: iso(-35, 13), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1', userInterpretation: '那笔款到了心里踏实，启动不难' },
  { id: 'ev-f-cli2', type: 'task', title: '客户项目 B：计划启动（推迟 4 天）', detail: '原计划 3 天完成，推迟到第 5 天启动', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-25, 10), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1' },
  { id: 'ev-f-cli3', type: 'task', title: '客户项目 B：启动后又中断 2 天', detail: '启动后遇到需求反复', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-22, 10), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1' },
  { id: 'ev-f-cli4', type: 'work', title: '客户项目 B：25 分钟最小剂量重新启动', detail: '改用番茄钟后启动成功', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-20, 10), endTime: iso(-20, 11), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1', userInterpretation: '把「开始做」改成「开始 25 分钟」反而开始了' },
  // === 收入事件（outer，按月聚合）===
  { id: 'inc-f-1', type: 'work', title: '客户项目 A 收入到账 ¥8000', detail: '按里程碑付款，第 1 期', sourceType: 'task_app', sourceRef: 'platform-income', startTime: iso(-36, 11), domain: '财务', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1' },
  { id: 'inc-f-2', type: 'work', title: '客户项目 B 首付款到账 ¥3000', detail: '按合同 30% 预付', sourceType: 'task_app', sourceRef: 'platform-income', startTime: iso(-26, 11), domain: '财务', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1' },
  { id: 'inc-f-3', type: 'work', title: '客户项目 B 尾款到账 ¥7000', detail: '验收通过后 15 天付款', sourceType: 'task_app', sourceRef: 'platform-income', startTime: iso(-3, 11), domain: '财务', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1' },
  // === 提案被拒事件（outer，中性归因）===
  { id: 'ev-f-reject1', type: 'work', title: '提案被拒：C 公司品牌项目', detail: '客户反馈「方向不符」，未中标', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-18, 15), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', userInterpretation: '不是能力问题，是方向不匹配。客户要的是更商业化的风格，我擅长的是叙事性插画。记下来下次先问清方向。' },
  { id: 'ev-f-reject2', type: 'work', title: '提案被拒：D 公司插画约稿', detail: '客户预算砍半，无法接受', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-8, 15), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer' },
  // === 自主创作事件（outer，假设卡 H-f02 证据链）===
  { id: 'ev-f-self1', type: 'work', title: '自主创作：城市记忆 #3 完成', detail: '周二自主日，4 小时完成', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-28, 10), endTime: iso(-28, 14), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f2', userInterpretation: '固定周二这个锚点，比等灵感靠谱多了' },
  { id: 'ev-f-self2', type: 'task', title: '自主创作计划（推迟）', detail: '原计划周三 3 小时，未启动', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-21, 14), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f2' },
  { id: 'ev-f-self3', type: 'work', title: '自主创作：城市记忆 #4 完成', detail: '周二自主日，3.5 小时', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-14, 10), endTime: iso(-14, 14), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f2' },
  { id: 'ev-f-self4', type: 'work', title: '自主创作：城市记忆 #5 完成', detail: '周二自主日，5 小时进入心流', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-7, 10), endTime: iso(-7, 15), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f2' },
  // === 同行交流事件（outer）===
  { id: 'ev-f-peer1', type: 'calendar', title: '同行深度交流：与设计师老张（90 分钟）', detail: '主题：自由职业定价策略', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-24, 15), endTime: iso(-24, 17), domain: '关系', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f3', userInterpretation: '老张说他第一年也差点放弃，定价不是靠信心，是靠数据' },
  { id: 'ev-f-peer2', type: 'calendar', title: '同行深度交流：与插画师小林（75 分钟）', detail: '主题：客户类型与议价权', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-10, 15), endTime: iso(-10, 16, 15), domain: '关系', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f3' },
  { id: 'ev-f-peer3', type: 'calendar', title: '同行线上交流：与摄影师大周（60 分钟）', detail: '主题：客户付款周期管理', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-3, 20), endTime: iso(-3, 21), domain: '关系', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f3', userInterpretation: '大周建议合同里加滞纳金条款，比靠信任靠谱' },
  // === 客户修订轮次（outer，假设卡 H-f01 的补充证据：客户因素也会打乱启动）===
  { id: 'ev-f-revise1', type: 'task', title: '客户项目 A：第 2 轮修订（客户反馈延迟 3 天）', detail: '等客户反馈期间无法推进下一项', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-18, 10), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f1' },
  // === 自主创作探索期（outer，反证：探索期无产出不是「停滞」）===
  { id: 'ev-f-explore1', type: 'work', title: '自主创作：素材收集日（无产出但有积累）', detail: '走街拍照 2 小时，为 #6 选址', sourceType: 'journal', sourceRef: 'voice-diary', startTime: iso(-9, 14), endTime: iso(-9, 16), domain: '创造', sensitivity: 'normal', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f2', userInterpretation: '今天没出稿，但走了 3 条街拍了 40 张素材。探索期不算停滞。' },
  // === 反证事件：无固定锚点也启动成功 ===
  { id: 'ev-f-self-win', type: 'work', title: '自主创作：周日额外完成 1 张草稿', detail: '无固定时段，主动启动', sourceType: 'journal', sourceRef: 'voice-diary', startTime: iso(-5, 10), endTime: iso(-5, 12), domain: '创造', sensitivity: 'normal', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-f2', userInterpretation: '那天想法一直在脑子里，没等到周二就动了手' },
  // === 日记（inner） ===
  { id: 'j-f-1', type: 'journal', title: '语音日记：客户项目 B 推迟启动的真相', detail: '转写 1 分 50 秒', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-23, 22), domain: '创造', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '今天本该启动客户 B，但一直刷手机。一开始想自责「我就是不专业」，后来发现：A 的尾款还没到，我在担心下个月房租。是焦虑卡住了启动，不是不上心。' },
  { id: 'j-f-2', type: 'journal', title: '日记：提案被拒后的想法', sourceType: 'user', sourceRef: 'text-diary', startTime: iso(-17, 23), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: 'C 公司那个提案被拒了。刚开始有点难受，但回看反馈是「方向不符」不是「能力不行」。我擅长叙事性，他们要商业感，这是匹配问题。' },
  { id: 'j-f-3', type: 'journal', title: '语音日记：孤独感与同行交流', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-9, 22), domain: '关系', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '和老张聊完之后明显没那么焦虑了。一个人工作久了，会以为只有自己遇到这些问题。其实大家都在解决类似的题。' },
  // === 决策卡（inner） ===
  { id: 'd-f-1', type: 'decision', title: '决策卡：是否签 C 公司年度框架协议', detail: '选项、预测与理由已记录，60 天后复盘', sourceType: 'user', sourceRef: 'decision-card', startTime: iso(-6, 17), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '预测：稳定收入但风格受限；理由：先用 3 个月应急基金过渡，等自主作品集上来再议价。' },
  // === 实验结果事件（inner） ===
  { id: 'o-f-1', type: 'outcome', title: '实验记录：25 分钟最小剂量启动客户项目（第 4 天）', detail: '启动成功，主观阻力 3/10', sourceType: 'user', sourceRef: 'experiment-checkin', startTime: iso(-1, 10), domain: '创造', sensitivity: 'normal', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', relatedCommitmentId: 'cm-f1' },
];

// ---------------- 假设卡 ----------------
export const seedHypotheses_freelancer: Hypothesis[] = [
  {
    id: 'H-f01', version: 2,
    statement: '过去六周，你的客户项目启动延迟集中在收入到账延迟的次周；焦虑是启动阻力，而不是你缺少专业精神或创作兴趣。',
    supporting: [
      { eventId: 'ev-f-cli1', quote: '客户 A 收入到账后第 2 天按时启动', time: iso(-35, 10), sourceType: 'task_app' },
      { eventId: 'ev-f-cli2', quote: '客户 B 推迟 4 天启动（首付款延迟）', time: iso(-25, 10), sourceType: 'task_app' },
      { eventId: 'j-f-1', quote: '日记：「A 的尾款还没到，我在担心房租。是焦虑卡住了启动」', time: iso(-23, 22), sourceType: 'journal' },
    ],
    countering: [
      { eventId: 'ev-f-cli4', quote: '25 分钟最小剂量后启动成功', time: iso(-20, 10), sourceType: 'task_app' },
    ],
    dataGaps: ['未导入 6 周前的收入-启动对照', '焦虑程度未量化'],
    alternatives: ['启动延迟是任务本身难度，不是焦虑', '反证 ev-f-cli4 显示剂量调整也能解决，可能不是焦虑主因'],
    confidence: 0.60,
    harmNote: '可能被读作「自由职业者就是不自律」——本假设显式否定这一概括。收入波动是自由职业的结构特征，焦虑是合理反应，不是缺陷。',
    suggestedExperimentId: 'exp-f1',
    reviewAt: iso(10),
    status: 'open',
    createdAt: iso(-7),
    history: [
      { at: iso(-14), change: '创建 v1（基于 2 周数据）', confidence: 0.50 },
      { at: iso(-7), change: 'v2：加入反证 ev-f-cli4，置信度 0.50→0.60，强化反过度概括', confidence: 0.60 },
    ],
  },
  {
    id: 'H-f02', version: 1,
    statement: '你的自主创作在每周固定时段（周二）启动率 4/4，无固定时段时启动率 1/4；固定锚点比动机更可靠，这与「等灵感」的叙事相反。',
    supporting: [
      { eventId: 'ev-f-self1', quote: '周二自主日 4 小时完成 #3', time: iso(-28, 10), sourceType: 'task_app' },
      { eventId: 'ev-f-self3', quote: '周二自主日 3.5 小时完成 #4', time: iso(-14, 10), sourceType: 'task_app' },
      { eventId: 'ev-f-self4', quote: '周二自主日 5 小时心流完成 #5', time: iso(-7, 10), sourceType: 'task_app' },
      { eventId: 'ev-f-self2', quote: '无固定时段的周三计划未启动', time: iso(-21, 14), sourceType: 'task_app' },
    ],
    countering: [
      { eventId: 'ev-f-self-win', quote: '周日额外完成 1 张草稿（无固定时段）', time: iso(-5, 10), sourceType: 'journal' },
    ],
    dataGaps: ['未对照不同创作主题的启动难度', '周二的「灵感积累」效应未量化'],
    alternatives: ['周二启动率高是因为周一客户沟通后状态好', '反证 ev-f-self-win 显示灵感来时也能启动，固定时段不是唯一条件'],
    confidence: 0.62,
    harmNote: '不评判「该不该等灵感」——这是用户的创作方式选择。',
    suggestedExperimentId: 'exp-f2',
    reviewAt: iso(14),
    status: 'open',
    createdAt: iso(-3),
    history: [{ at: iso(-3), change: '创建 v1', confidence: 0.62 }],
  },
];

// ---------------- 实验 ----------------
const mkCheckIns_freelancer = (startOffset: number, n: number, pattern: (i: number) => [boolean, string]): CheckIn[] =>
  Array.from({ length: n }).map((_, i) => {
    const [done, note] = pattern(i);
    return { date: iso(startOffset + i), done, note };
  });

export const seedExperiments_freelancer: Experiment[] = [
  {
    id: 'exp-f1', kind: '微调实验', hypothesisId: 'H-f01',
    question: '客户项目启动用「25 分钟最小剂量」替代「等状态」，连续 7 天，能否维持启动率？',
    baseline: '过去 4 周客户项目启动率 2/5（推迟 3 次）',
    intervention: '未来 7 天，每天 10:00-10:25 启动当前客户项目；写不完即停，不补偿',
    metrics: ['启动率（行为）', '主观阻力评分 1-10（主观）', '完成稿数（外部）'],
    confounders: ['收入到账时点', '任务难度', '是否在周末'],
    stopRule: '连续 2 天主观阻力 >7 或影响自主创作日时暂停',
    sideEffects: '25 分钟剂量可能不够完成大块任务，需接受拆分',
    durationDays: 7, startDate: iso(-4), status: 'active',
    checkIns: mkCheckIns_freelancer(-4, 4, (i) => [
      true,
      ['启动成功，阻力 4/10，完成 1 个图标', '启动成功，阻力 3/10，完成品牌色板', '差点没开始，把 25 分钟改成 15 分钟后启动了，阻力 6/10', '启动成功，阻力 2/10，多做了 30 分钟'][i],
    ]),
  },
  {
    id: 'exp-f2', kind: '结构实验', hypothesisId: 'H-f02',
    question: '连续 30 天周二固定自主创作日，对比启动率与主观满意度，能否验证「固定锚点 > 等灵感」？',
    baseline: '过去 4 周周二自主日启动率 4/4，无固定时段 1/4',
    intervention: '未来 4 周，每周二 10:00-17:00 固定自主创作日；客户项目不得占用；记录启动率与作品产出',
    metrics: ['自主日启动率（行为）', '主观满意度 1-10（主观）', '作品完成数（外部）'],
    confounders: ['客户项目紧急程度', '身体状态', '季节性灵感波动'],
    stopRule: '若客户项目连续 2 周紧急可调整为半天，但不可取消',
    sideEffects: '可能错过客户高峰期，需与客户提前协商',
    durationDays: 30, startDate: iso(3), status: 'proposed',
    checkIns: [],
  },
];

// ---------------- 意义方向 ----------------
export const seedDirections_freelancer: MeaningDirection[] = [
  {
    id: 'dir-f1', statement: '把自主创作沉淀为可持续的作品集', serveWhom: '未来想合作的客户与同代创作者',
    contribution: '城市记忆系列、每月 1 张作品', costBoundary: '不以牺牲客户项目交付为代价',
    skillIds: ['sk-f1'], projectIds: ['pj-f1', 'pj-f2'], evidenceScore: 0.55, trend: 'up',
  },
  {
    id: 'dir-f2', statement: '不把收入波动归因于个人价值', serveWhom: '自己',
    contribution: '建立应急基金、按月记录收入结构', costBoundary: '接受 3 个月过渡期收入不稳定',
    skillIds: [], projectIds: ['pj-f3'], evidenceScore: 0.40, trend: 'flat',
  },
];

// ---------------- 技能 ----------------
export const seedSkills_freelancer: SkillTrack[] = [
  {
    id: 'sk-f1', name: '叙事性品牌插画',
    targetPerformance: '独立完成一组 8 张叙事性品牌插画，并让 3 位目标客户准确复述品牌故事',
    baseline: '60 分钟限时草稿 3 张，2/3 客户能复述主旨',
    rubric: ['选题', '叙事结构', '角色设计', '色彩语言', '商业适配'],
    prerequisites: ['速写基础', '色彩理论', '品牌理解'],
    stage: '刻意练习', mastery: 0.46, weeklyPlan: '本周：周二自主日 5 小时（城市记忆 #6）+ 25 分钟 × 5（客户项目启动）',
    evidences: [
      { date: iso(-28), kind: '作品', note: '城市记忆 #3 完成（4 小时）' },
      { date: iso(-14), kind: '作品', note: '城市记忆 #4 完成（3.5 小时）' },
      { date: iso(-7), kind: '作品', note: '城市记忆 #5 完成（5 小时心流）' },
      { date: iso(-1), kind: '练习', note: '25 分钟启动法第 4 天，完成 1 个图标' },
    ],
    replanReason: '原计划「每天 90 分钟自主创作」失败——实验 exp-f1 显示启动条件比时长更紧迫',
  },
  {
    id: 'sk-f2', name: '客户沟通与定价',
    targetPerformance: '能在 30 分钟内完成客户需求澄清并报出符合市场价的价格',
    baseline: '沟通平均 60 分钟，定价偏低 20%',
    rubric: ['需求澄清', '报价策略', '议价沟通', '合同条款', '尾款管理'],
    prerequisites: ['作品集', '市场行情了解'],
    stage: '迁移验证', mastery: 0.38, weeklyPlan: '本周：与老张讨论 1 次定价策略 + 整理 3 个客户报价对照',
    evidences: [
      { date: iso(-24), kind: '反馈', note: '老张：定价偏低，建议按作品集档次报价' },
      { date: iso(-10), kind: '迁移', note: '与 C 公司报价时尝试按档次报，客户接受' },
    ],
  },
];

// ---------------- 项目 ----------------
export const seedProjects_freelancer: Project[] = [
  {
    id: 'pj-f1', name: '客户项目 A：品牌视觉设计',
    mission: '按时交付品牌视觉系统并收到尾款；成功 = 客户验收通过 + 收入到账',
    nonGoals: '不接包后续运营设计，不低价续约',
    nextKeyAction: '本周三 14:00 与客户对齐第 2 期里程碑',
    criticalPath: ['初稿', '客户反馈', '修订', '终稿', '验收', '尾款'],
    milestones: [
      { title: '初稿完成', due: iso(-32), done: true, acceptance: '客户书面反馈' },
      { title: '第 2 期修订', due: iso(-10), done: true, acceptance: '客户确认方向' },
      { title: '终稿交付', due: iso(5), done: false, acceptance: '客户验收通过' },
      { title: '尾款到账', due: iso(-3), done: true, acceptance: '¥7000 入账' },
    ],
    risks: [
      { title: '客户付款延迟', signal: '尾款超过合同期 7 天', level: 'mid', mitigation: '合同约定滞纳金，必要时暂停下一期', reviewAt: iso(7) },
    ],
    decisionLedger: [
      { date: iso(-30), options: '按里程碑付款 / 一次性付款', decision: '按里程碑', reason: '降低客户跑单风险', reviewAt: iso(30) },
    ],
    meaningLoop: '服务方向 dir-f1 + dir-f2；当前进度 80%，符合承诺 cm-f1。',
    progress: 0.80, status: 'active',
  },
  {
    id: 'pj-f2', name: '城市记忆插画系列（自主作品集）',
    mission: '完成 12 张城市记忆系列插画，作为议价权作品集；成功 = 完成 12 张 + 3 位目标客户认可',
    nonGoals: '不追求社交媒体流量，不接商业约稿',
    nextKeyAction: '本周二 10:00 完成城市记忆 #6 草稿',
    criticalPath: ['选题', '草图', '正稿', '配色', '系列整编', '目标客户试读'],
    milestones: [
      { title: '#1-#5 完成', due: iso(-7), done: true, acceptance: '5 张正稿' },
      { title: '#6-#10 完成', due: iso(35), done: false, acceptance: '5 张正稿' },
      { title: '#11-#12 完成', due: iso(70), done: false, acceptance: '2 张正稿' },
      { title: '3 位客户试读', due: iso(90), done: false, acceptance: '3 份书面反馈' },
    ],
    risks: [
      { title: '客户项目挤占自主日', signal: '连续 2 周周二被占用', level: 'high', mitigation: '启动 exp-f2（周二保护）+ 必要时拒绝紧急客户', reviewAt: iso(14) },
      { title: '灵感枯竭', signal: '连续 3 个自主日无产出', level: 'mid', mitigation: '改为素材收集日，不强行创作', reviewAt: iso(21) },
    ],
    decisionLedger: [],
    meaningLoop: '服务方向 dir-f1；当前代价（每周 1 天）在承诺边界内。',
    progress: 0.42, status: 'active',
  },
  {
    id: 'pj-f3', name: '3 个月应急基金建立',
    mission: '建立覆盖 3 个月基本开支的应急基金；成功 = 账户余额达标',
    nonGoals: '不投资高风险产品，不动用作为日常周转',
    nextKeyAction: '本月发款后转入 ¥3000 到应急账户',
    criticalPath: ['月度定额转入', '账户分离', '3 个月达标'],
    milestones: [
      { title: '第 1 个月转入', due: iso(-15), done: true, acceptance: '¥3000 入账' },
      { title: '第 2 个月转入', due: iso(15), done: false, acceptance: '¥3000 入账' },
      { title: '3 个月达标', due: iso(75), done: false, acceptance: '账户余额 ≥ 3 个月开支' },
    ],
    risks: [
      { title: '客户欠款动用应急基金', signal: '连续 2 个月需动用', level: 'mid', mitigation: '启动转售作品集而非低价接单', reviewAt: iso(30) },
    ],
    decisionLedger: [],
    meaningLoop: '服务方向 dir-f2；当前进度 33%，符合承诺 cm-f4。',
    progress: 0.33, status: 'active',
  },
];
