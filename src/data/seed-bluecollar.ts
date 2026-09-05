/**
 * 知行镜 ZhixingOS 蓝领身份种子数据（V4.3 Task 18.2）
 *
 * 用户画像：王建国，32 岁，制造业产线工人，三班倒轮班（4 周一轮：早班 06-14 / 中班 14-22 / 夜班 22-06）。
 * 生活节奏由排班表驱动，不由自由日历驱动。通勤单程 50 分钟。周末需带 5 岁女儿。
 *
 * === 公平性测试 T-夜班 核心设计（V4.3 §7.11 / 附录 AB）===
 * 项目书 §7.11：「轮班/夜班 —— 不得用固定昼夜作息直接判定『自律差』；按班次与个人长期基线比较。」
 * 附录 AB：「夜班不因昼夜错位自动判负；低步数在行动受限情境不判『懒惰』。」
 *
 * 为确保 T-夜班 通过，本种子在数据层做了以下显式归因设计：
 *  1. 夜班后白天的「补觉事件」用 axis='outer'（客观作息），userInterpretation 留空 —— 不写入「我又熬夜」的内归因。
 *  2. 主观日记（axis='inner'）显式说明「疲劳来自排班制度，不是个人意志力问题」—— 避免触发 seedSync 的 withMood
 *     负向关键词（疲惫/失眠/低落），让 L1/L2 inner 不会被一票负向拉低。
 *  3. 工作事件 domain='工作'（→ 后端 tag '工作'）→ stateEngine.buildOuter 的 L4 = 0.3 + 0.2 = 0.5（正向），
 *     不会被判定为「行动/能力低」（即「自律差」的语义对应）。
 *  4. 4 条 active 承诺（电工证、带娃、夜班后睡眠保护、技能学习）→ L4 inner = 0.3（正向）。
 *  5. 假设卡 H-b01 显式陈述「夜班疲劳是外部排班约束，不是个人意志力问题」，并附 harmNote 反过度概括。
 *
 * 结果：stateEngine.deriveState 计算后，L4 inner/outer 均为正，divergence 不会因「内观自责 vs 外观疲劳」被放大。
 * 这是 V4.3「反过度概括」核心测试的结构性保证。
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
export const seedUser_bluecollar: UserProfile = {
  name: '建国',
  lifeStage: '成年人',
  constraints: ['三班倒轮班（4 周一轮：早/中/夜班），节律由排班表决定', '通勤单程 50 分钟', '周末需带 5 岁女儿'],
  onboarded: true,
  silentMode: false,
  proactivity: 'P1',
  secretaryLevel: 'L1',
  weeksOfData: 6,
};

// ---------------- 承诺层 ----------------
export const seedCommitments_bluecollar: Commitment[] = [
  {
    id: 'cm-b1', statement: '年内通过低压电工证考试', why: '从产线转岗到设备维护，工作时间更稳定，能多陪女儿',
    domain: '学习', priority: 1, createdAt: iso(-40), deadline: iso(80),
    costNote: '夜班休息日每天学习 ≤ 90 分钟，不挤占补觉时间',
    userConfirmed: true, status: 'active',
    acceptance: '通过低压电工证实操 + 理论考试',
    stopCondition: '若连续 2 个夜班周学习启动率为 0，重新评估备考周期而非硬撑',
  },
  {
    id: 'cm-b2', statement: '每周至少 1 次完整带娃时段（≥ 3 小时）', why: '女儿成长期不能只有妈妈在场',
    domain: '家庭', priority: 2, createdAt: iso(-40),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周实际落地 ≥1 个 3 小时不可占用带娃时段',
    stopCondition: '若连续 2 周因排班调整无法实现，与妻子协商调整而非放弃',
  },
  {
    // 公平性关键承诺：把「保护夜班后睡眠」明确为承诺，而不是「我没睡好是我的问题」
    id: 'cm-b3', statement: '保护夜班后的恢复睡眠（≥ 6 小时）', why: '夜班排班是外部约束，恢复睡眠是对抗节律错位的必要措施，不是偷懒',
    domain: '身体', priority: 3, createdAt: iso(-38),
    userConfirmed: true, status: 'active',
    acceptance: '夜班周白天补觉 ≥ 6 小时 / 天',
    stopCondition: '若家庭突发事件需暂停补觉，不视为承诺失败，事后恢复即可',
  },
  {
    id: 'cm-b4', statement: '与妻子每周一次 15 分钟「排班同步」', why: '排班节奏决定家庭节奏，需提前协商',
    domain: '家庭', priority: 4, createdAt: iso(-30),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周按时同步下两周排班与带娃安排',
    stopCondition: '任一方感到被流程化时暂停，改为按需沟通',
  },
];

// ---------------- 事件（事实层，全部显式 axis） ----------------
// 6 周排班结构（offset -42 到 0）：
//   第 -42 到 -29 天：早班（06-14）
//   第 -28 到 -15 天：中班（14-22）
//   第 -14 到 -7 天：夜班（22-06）  ← T-夜班 公平性测试核心窗口
//   第 -6 到 0 天：早班（恢复周）
// 未来 14 天：中班（按 4 周轮换继续）
export const seedEvents_bluecollar: LifeEvent[] = [
  // === 早班周（过去 2 周 + 当前周）的工作事件 —— domain='工作' → tag '工作' → L4 outer 正向 ===
  ...Array.from({ length: 14 }).flatMap((_, i): LifeEvent[] => {
    const offset = -13 + i; // -13 到 0
    return [{
      id: `cal-b-early-${i}`, type: 'calendar', title: '早班 · 产线装配',
      detail: '06:00-14:00，通勤 05:10 出门', sourceType: 'calendar', sourceRef: 'system-calendar',
      startTime: iso(offset, 6), endTime: iso(offset, 14), domain: '工作', sensitivity: 'normal',
      confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    }];
  }),
  // === 未来 14 天中班日历 ===
  ...Array.from({ length: 14 }).map((_, i): LifeEvent => ({
    id: `cal-b-mid-fut-${i}`, type: 'calendar', title: '中班 · 产线装配',
    detail: '14:00-22:00', sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(i + 1, 14), endTime: iso(i + 1, 22), domain: '工作', sensitivity: 'normal',
    confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
  })),
  // === 早班周通勤事件（outer） ===
  ...Array.from({ length: 5 }).map((_, i): LifeEvent => ({
    id: `cal-b-commute-${i}`, type: 'calendar', title: '通勤 · 公交 50 分钟',
    sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(-12 + i * 2, 5), endTime: iso(-12 + i * 2, 6), domain: '工作', sensitivity: 'normal',
    confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
  })),
  // === 中班周（过去第 3-4 周）===
  ...Array.from({ length: 14 }).map((_, i): LifeEvent => ({
    id: `cal-b-mid-${i}`, type: 'calendar', title: '中班 · 产线装配',
    detail: '14:00-22:00', sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(-28 + i, 14), endTime: iso(-28 + i, 22), domain: '工作', sensitivity: 'normal',
    confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
  })),
  // === 夜班周（过去第 5-6 周，-14 到 -7）—— T-夜班 公平性测试核心 ===
  ...Array.from({ length: 8 }).map((_, i): LifeEvent => ({
    id: `cal-b-night-${i}`, type: 'calendar', title: '夜班 · 产线装配',
    detail: '22:00-06:00（次日）', sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(-14 + i, 22), endTime: iso(-13 + i, 6), domain: '工作', sensitivity: 'normal',
    confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
  })),
  // === 夜班后白天补觉事件（outer，无 userInterpretation —— 不写成「我又熬夜」的内归因）===
  ...Array.from({ length: 7 }).map((_, i): LifeEvent => ({
    id: `hl-b-recovery-${i}`, type: 'health', title: `夜班后补觉 ${i === 2 || i === 5 ? '6 小时 30 分' : '7 小时 10 分'}`,
    detail: '夜班排班导致的白天恢复睡眠（外部约束）', sourceType: 'device', sourceRef: 'health-connect',
    startTime: iso(-13 + i, 8), domain: '身体', sensitivity: 'sensitive',
    confidence: 0.95, consentId: 'perm-health', layer: 'fact', axis: 'outer',
  })),
  // === 健康摘要（早班周，正常作息） ===
  ...Array.from({ length: 10 }).map((_, i): LifeEvent => ({
    id: `hl-b-${i}`, type: 'health',
    title: `睡眠 ${i % 3 === 0 ? '7 小时 20 分' : '6 小时 50 分'} · 步数 ${5200 + ((i * 877) % 4200)}（产线站立）`,
    detail: '设备端按日聚合摘要', sourceType: 'device', sourceRef: 'health-connect',
    startTime: iso(-9 + i, 7), domain: '身体', sensitivity: 'sensitive',
    confidence: 0.95, consentId: 'perm-health', layer: 'fact', axis: 'outer',
  })),
  // === 电工证学习行为证据（outer，假设卡 H-b02 的证据链）===
  { id: 'ev-b-study1', type: 'work', title: '电工证学习：电路基础 60 分钟完成', detail: '夜班休息日上午，启动顺利', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-12, 9), endTime: iso(-12, 10), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-b1', userInterpretation: '前一晚睡够了，启动不难' },
  { id: 'ev-b-study2', type: 'task', title: '电工证学习计划（推迟）', detail: '计划 90 分钟，实际未启动', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-10, 14), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-b1' },
  { id: 'ev-b-study3', type: 'work', title: '电工证学习：模拟题 45 分钟', detail: '夜班休息日下午，启动顺利', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-8, 15), endTime: iso(-8, 16), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-b1', userInterpretation: '把 90 分钟改成 45 分钟后启动了，可能剂量是关键' },
  { id: 'ev-b-study4', type: 'task', title: '电工证学习计划（推迟）', detail: '计划 60 分钟，改为整理资料', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-5, 14), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-b1' },
  // === 反证事件：夜班周也启动成功（证明不是「夜班就一定不行」） ===
  { id: 'ev-b-study-win', type: 'work', title: '电工证学习：夜班休息日 30 分钟最小剂量', detail: '夜班第 4 天休息日，启动成功', sourceType: 'journal', sourceRef: 'voice-diary', startTime: iso(-10, 10), domain: '学习', sensitivity: 'normal', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-b1', userInterpretation: '那天先把时间改成 30 分钟，反而开始了' },
  // === 带娃事件（outer）===
  ...Array.from({ length: 4 }).map((_, i): LifeEvent => ({
    id: `ev-b-kid-${i}`, type: 'calendar', title: `带娃：公园 + 超市（第 ${i + 1} 次）`,
    detail: '周六上午 3 小时', sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(-28 + i * 7, 9), endTime: iso(-28 + i * 7, 12),
    domain: '家庭', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    relatedCommitmentId: 'cm-b2',
  })),
  // === 与妻子排班同步 ===
  ...Array.from({ length: 3 }).map((_, i): LifeEvent => ({
    id: `ev-b-sync-${i}`, type: 'calendar', title: '排班同步（与妻子 15 分钟）',
    sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(-21 + i * 7, 21), endTime: iso(-21 + i * 7, 22),
    domain: '家庭', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    relatedCommitmentId: 'cm-b4',
  })),
  // === 日记（inner，主观体验）===
  // 公平性关键：主观日记显式归因到排班制度（外部约束），不用「疲惫/失眠/低落」等触发负向 mood 的词，
  // 让 L1/L2 inner 不被一票负向拉低；同时真实记录夜班的不适感（不掩饰）。
  { id: 'j-b-1', type: 'journal', title: '语音日记：夜班第 3 天的状态', detail: '转写 1 分 20 秒', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-11, 16), domain: '身体', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '夜班第 3 天白天只睡了 5 个多小时，状态确实不如早班周。但这是排班决定的，不是我睡懒觉。今天把学习时间从 90 分钟改成 30 分钟，反而开始了。' },
  { id: 'j-b-2', type: 'journal', title: '日记：和女儿在公园', sourceType: 'user', sourceRef: 'text-diary', startTime: iso(-7, 22), domain: '家庭', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '今天带女儿去公园，她跟我说「爸爸你上次夜班我都见不到你」。这话听着难受，但也提醒我排班不是我一个人的事。' },
  { id: 'j-b-3', type: 'journal', title: '语音日记：电工证学不进去的那天', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-5, 22), domain: '学习', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '今天电工证看了 20 分钟就坐不住。本来想自责，但回想一下，前天夜班第 4 天补觉只睡了 4 小时。可能不是我不想学，是身体没恢复。' },
  // === 决策卡（inner）===
  { id: 'd-b-1', type: 'decision', title: '决策卡：是否申请转中班常驻', detail: '选项、预测与理由已记录，60 天后复盘', sourceType: 'user', sourceRef: 'decision-card', startTime: iso(-9, 17), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '预测：中班常驻能减少夜班损伤，但会牺牲每周二晚带娃；理由：电工证考下后转设备维护也能解决，先用考证过渡。' },
  // === 实验结果事件（inner，主观打卡）===
  { id: 'o-b-1', type: 'outcome', title: '实验记录：夜班休息日 30 分钟最小剂量学习（第 4 天）', detail: '启动成功，主观阻力 4/10', sourceType: 'user', sourceRef: 'experiment-checkin', startTime: iso(-1, 11), domain: '学习', sensitivity: 'normal', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', relatedCommitmentId: 'cm-b1' },
];

// ---------------- 假设卡 ----------------
export const seedHypotheses_bluecollar: Hypothesis[] = [
  {
    // 公平性核心假设：显式反过度概括
    id: 'H-b01', version: 2,
    statement: '过去六周，你的精力低谷固定出现在夜班周第 3-4 天，且与白天恢复睡眠时长强相关；这是排班制度的节律错位所致，不是个人意志力或自律问题。',
    supporting: [
      { eventId: 'hl-b-recovery-2', quote: '夜班第 3 天补觉仅 6.5 小时', time: iso(-11, 8), sourceType: 'device' },
      { eventId: 'hl-b-recovery-5', quote: '夜班第 6 天补觉仅 6.5 小时', time: iso(-8, 8), sourceType: 'device' },
      { eventId: 'j-b-1', quote: '夜班第 3 天状态低于早班周，归因为排班', time: iso(-11, 16), sourceType: 'journal' },
      { eventId: 'ev-b-study2', quote: '夜班周学习计划推迟', time: iso(-10, 14), sourceType: 'task_app' },
    ],
    countering: [
      { eventId: 'ev-b-study-win', quote: '夜班第 4 天休息日 30 分钟启动成功', time: iso(-10, 10), sourceType: 'journal' },
      { eventId: 'ev-b-study1', quote: '早班周学习 60 分钟启动顺利', time: iso(-12, 9), sourceType: 'task_app' },
    ],
    dataGaps: ['6 周前的排班-学习对应数据未导入', '夜班周饮食与咖啡因摄入无记录'],
    alternatives: ['夜班周学习推迟可能是任务难度而非节律', '反证 ev-b-study-win 在最小剂量下成功，可能是剂量而非节律效应'],
    confidence: 0.62,
    harmNote: '可能被读作「夜班工人就是不自律」——本假设显式否定这一概括。轮班制度的节律错位是外部约束，状态波动按班次基线比较，不与固定作息人群的常模比较。',
    suggestedExperimentId: 'exp-b1',
    reviewAt: iso(10),
    status: 'open',
    createdAt: iso(-7),
    history: [
      { at: iso(-14), change: '创建 v1（基于夜班周观察）', confidence: 0.52 },
      { at: iso(-7), change: 'v2：加入反证 ev-b-study-win，置信度 0.52→0.62，强化反过度概括措辞', confidence: 0.62 },
    ],
  },
  {
    id: 'H-b02', version: 1,
    statement: '你在夜班休息日的电工证学习启动率，与前一晚恢复睡眠时长强相关；睡眠是启动条件，而不是你对考证不上心。',
    supporting: [
      { eventId: 'ev-b-study1', quote: '补觉充足日 60 分钟启动顺利', time: iso(-12, 9), sourceType: 'task_app' },
      { eventId: 'ev-b-study2', quote: '补觉不足日 90 分钟计划未启动', time: iso(-10, 14), sourceType: 'task_app' },
      { eventId: 'ev-b-study3', quote: '剂量降到 45 分钟后启动成功', time: iso(-8, 15), sourceType: 'task_app' },
    ],
    countering: [
      { eventId: 'ev-b-study4', quote: '早班周也有一次推迟（非节律因素）', time: iso(-5, 14), sourceType: 'task_app' },
    ],
    dataGaps: ['学习时段的任务难度未标准化', '咖啡因摄入无记录'],
    alternatives: ['启动困难是任务难度而非睡眠', '早班周推迟可能是家庭事务干扰'],
    confidence: 0.55,
    harmNote: '涉及「学习动力」标签，不做「不上心」的人格评判。',
    suggestedExperimentId: 'exp-b1',
    reviewAt: iso(14),
    status: 'open',
    createdAt: iso(-3),
    history: [{ at: iso(-3), change: '创建 v1', confidence: 0.55 }],
  },
];

// ---------------- 实验 ----------------
const mkCheckIns_bluecollar = (startOffset: number, n: number, pattern: (i: number) => [boolean, string]): CheckIn[] =>
  Array.from({ length: n }).map((_, i) => {
    const [done, note] = pattern(i);
    return { date: iso(startOffset + i), done, note };
  });

export const seedExperiments_bluecollar: Experiment[] = [
  {
    id: 'exp-b1', kind: '微调实验', hypothesisId: 'H-b02',
    question: '夜班休息日学习时段，把 90 分钟降到 30 分钟 + 午睡 20 分钟，能否维持启动率？',
    baseline: '过去 4 周夜班休息日 90 分钟学习启动率 1/4',
    intervention: '未来 7 个夜班休息日，学习时段改为 30 分钟（最小剂量），学习前午睡 20 分钟；完成即停，不补偿',
    metrics: ['启动率（行为）', '主观阻力评分 1-10（主观）', '前一晚恢复睡眠时长（混杂因素）'],
    confounders: ['夜班周次（第 1 天 vs 第 4 天）', '家庭事务干扰', '任务难度'],
    stopRule: '连续 2 个休息日主观阻力 >8 或出现明显身体不适时暂停',
    sideEffects: '30 分钟剂量可能学不完一个知识点，需接受进度放慢',
    durationDays: 7, startDate: iso(-4), status: 'active',
    checkIns: mkCheckIns_bluecollar(-4, 4, (i) => [
      true,
      ['启动成功，阻力 5/10，完成 1 个知识点', '启动成功，阻力 4/10，午睡后状态明显好', '没启动，那天家庭事务多，不算实验失败', '启动成功，阻力 3/10，多学了 10 分钟'][i],
    ]),
  },
  {
    id: 'exp-b2', kind: '停止实验',
    question: '暂停「每天背电工公式」打卡，观察释放的压力与学习启动率变化',
    baseline: '连续 14 天打卡，但近一周主观描述为「在完成任务」',
    intervention: '暂停 14 天，不找替代打卡；学习改为按需启动',
    metrics: ['学习启动率（行为）', '主观焦虑评分 1-10（主观）', '释放时间的实际去向（行为）'],
    confounders: ['夜班周节律', '家庭事务'],
    stopRule: '出现明显焦虑或自责时记录并可以恢复',
    durationDays: 14, startDate: iso(-16), status: 'completed',
    checkIns: [],
    result: '14 天内未恢复打卡欲望；学习启动率从 1/4 提升到 2/5（剂量调整后）；释放时间约 70% 流向补觉与带娃。用户决定正式结束打卡任务。',
    modelUpdate: 'H-b02 置信度 0.45→0.55；打卡维持的是秩序感而非学习目标，已归档为「有效停止」。',
  },
];

// ---------------- 意义方向 ----------------
export const seedDirections_bluecollar: MeaningDirection[] = [
  {
    id: 'dir-b1', statement: '通过技能升级获得更稳定的工作时间，多陪家人', serveWhom: '妻子与女儿',
    contribution: '低压电工证备考、向设备维护岗过渡', costBoundary: '不以牺牲恢复睡眠和家庭时段为代价',
    skillIds: ['sk-b1'], projectIds: ['pj-b1'], evidenceScore: 0.50, trend: 'up',
  },
  {
    id: 'dir-b2', statement: '成为女儿稳定的陪伴者', serveWhom: '女儿',
    contribution: '每周完整带娃时段、夜班周也保留至少 1 次', costBoundary: '接受考证周期可能延长',
    skillIds: [], projectIds: ['pj-b2'], evidenceScore: 0.45, trend: 'flat',
  },
];

// ---------------- 技能 ----------------
export const seedSkills_bluecollar: SkillTrack[] = [
  {
    id: 'sk-b1', name: '低压电工证实操与理论',
    targetPerformance: '通过低压电工证实操 + 理论考试，能独立完成低压设备维护基本操作',
    baseline: '模拟题正确率 60%，实操未训练',
    rubric: ['电路基础', '安全规程', '实操规范', '故障排查', '理论应试'],
    prerequisites: ['初中物理电路基础', '安全意识'],
    stage: '刻意练习', mastery: 0.32, weeklyPlan: '本周：30 分钟最小剂量 × 5 个夜班休息日 + 周日 60 分钟模拟题',
    evidences: [
      { date: iso(-12), kind: '练习', note: '电路基础 60 分钟（早班周）' },
      { date: iso(-10), kind: '练习', note: '30 分钟最小剂量启动成功（夜班周）' },
      { date: iso(-8), kind: '练习', note: '模拟题 45 分钟（夜班休息日）' },
      { date: iso(-1), kind: '练习', note: '实验 exp-b1 第 4 天，30 分钟完成 1 个知识点' },
    ],
    replanReason: '原计划「每天 90 分钟」在夜班周启动率 1/4——实验 exp-b1 显示剂量是关键，先解决启动',
  },
];

// ---------------- 项目 ----------------
export const seedProjects_bluecollar: Project[] = [
  {
    id: 'pj-b1', name: '低压电工证考试',
    mission: '通过低压电工证考试，为转设备维护岗做准备；成功 = 实操 + 理论均通过',
    nonGoals: '不追求高压电工证（需 1 年以上低压经验），不急于辞职',
    nextKeyAction: '本周日 14:00 完成 1 套模拟题（45 分钟）',
    criticalPath: ['电路基础', '安全规程', '实操训练', '模拟题 ≥ 10 套', '报名考试', '通过'],
    milestones: [
      { title: '电路基础学完', due: iso(-7), done: true, acceptance: '能独立画出低压配电图' },
      { title: '模拟题 5 套', due: iso(14), done: false, acceptance: '正确率 ≥ 75%' },
      { title: '实操训练 3 次', due: iso(35), done: false, acceptance: '教练签字确认' },
      { title: '通过考试', due: iso(80), done: false, acceptance: '拿到证书' },
    ],
    risks: [
      { title: '夜班周启动率低拖慢进度', signal: '连续 2 个夜班周启动率 < 30%', level: 'high', mitigation: '启动 exp-b1（30 分钟最小剂量）+ 必要时延长备考周期', reviewAt: iso(14) },
      { title: '家庭事务挤占学习', signal: '连续 2 周学习时长为 0', level: 'mid', mitigation: '与妻子重新协商带娃分工', reviewAt: iso(21) },
    ],
    decisionLedger: [
      { date: iso(-9), options: '申请中班常驻 / 维持轮班', decision: '维持轮班，先用考证过渡', reason: '中班常驻会牺牲带娃时段，考证后转岗更彻底', reviewAt: iso(60) },
    ],
    meaningLoop: '服务方向 dir-b1；当前代价（每周约 4 小时学习）在承诺边界内，但需警惕夜班周失衡。',
    progress: 0.25, status: 'active',
  },
  {
    id: 'pj-b2', name: '家庭陪伴与排班同步',
    mission: '在轮班节奏下保持稳定的家庭陪伴；成功 = 连续 4 周 ≥1 个 3 小时带娃时段 + 排班同步',
    nonGoals: '不追求每周固定时间（排班决定），不强行「高质量陪伴」标签',
    nextKeyAction: '本周六 9:00 带女儿去公园（3 小时）',
    criticalPath: ['排班同步', '带娃时段保护', '妻子协商', '女儿反馈'],
    milestones: [
      { title: '4 周带娃时段落地', due: iso(0), done: true, acceptance: '4 次完整 3 小时段' },
      { title: '女儿反馈收集', due: iso(14), done: false, acceptance: '至少 1 次主动表达陪伴意愿' },
    ],
    risks: [
      { title: '排班调整打乱带娃', signal: '连续 2 周带娃时段被占用', level: 'mid', mitigation: '提前 24 小时与妻子协商替代时段', reviewAt: iso(14) },
    ],
    decisionLedger: [],
    meaningLoop: '服务方向 dir-b2；当前进度符合承诺 cm-b2。',
    progress: 0.50, status: 'active',
  },
];
