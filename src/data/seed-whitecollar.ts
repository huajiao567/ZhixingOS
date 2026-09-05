/**
 * 知行镜 ZhixingOS 白领身份种子数据（V4.3 Task 18.4）
 *
 * 用户画像：周敏，35 岁，互联网公司产品经理。季度 OKR 冲刺期，会议密集，通勤单程 1.5 小时，孩子 3 岁。
 * 生活节奏由会议、项目截止、KPI、通勤驱动。
 *
 * 设计要点（V4.3 §7.10）：
 *  1. 白领的核心张力是「会议碎片化 vs 深度工作」「项目截止 vs 家庭边界」——不增加第 N 个生产力工具。
 *  2. 所有事件显式标注 axis（SubTask 18.6）。
 *  3. 假设卡 H-w01 显式指出「真正的杠杆是会议间保护块」，不做「你应该更自律」的概括。
 *  4. 加班事件归因到「项目截止外部约束」，不写成「我效率低」。
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
export const seedUser_whitecollar: UserProfile = {
  name: '周敏',
  lifeStage: '成年人',
  constraints: ['季度 OKR 冲刺期会议密集', '通勤单程 1.5 小时', '孩子 3 岁，晚间需轮流陪护'],
  onboarded: true,
  silentMode: false,
  proactivity: 'P1',
  secretaryLevel: 'L2',
  weeksOfData: 6,
};

// ---------------- 承诺层 ----------------
export const seedCommitments_whitecollar: Commitment[] = [
  {
    id: 'cm-w1', statement: '季度 OKR 按时交付（核心 3 项）', why: '团队绩效与个人可见度',
    domain: '工作', priority: 1, createdAt: iso(-40), deadline: iso(20),
    costNote: '冲刺期每周加班 ≤ 2 晚，不超过 21:30',
    userConfirmed: true, status: 'active',
    acceptance: '3 项核心 OKR 全部交付且 2 项达成挑战值',
    stopCondition: '若连续 2 周加班 > 3 晚且出现身心信号，与上级重新协商排期',
  },
  {
    id: 'cm-w2', statement: '每周 2 个完整家庭时段（≥ 2 小时）', why: '孩子成长期不可逆',
    domain: '家庭', priority: 2, createdAt: iso(-40),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周实际落地 ≥2 个不可占用家庭时段',
    stopCondition: '任一方感到被强制时暂停并重新协商',
  },
  {
    id: 'cm-w3', statement: '周三晚 21 点后不工作（边界承诺）', why: '保护次日决策精力',
    domain: '休息', priority: 3, createdAt: iso(-30),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周周三 21 点后无工作事件',
    stopCondition: '若季度截止前 1 周确实无法实现，提前与家人协商而非默认打破',
  },
  {
    id: 'cm-w4', statement: '每天 1 个 90 分钟深度工作保护块', why: '会议碎片化是结构问题，保护块是杠杆',
    domain: '工作', priority: 4, createdAt: iso(-25), deadline: iso(60),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周每周 ≥ 4 天落地保护块',
    stopCondition: '若保护块连续 5 天被会议占用，重新评估会议结构而非放弃保护块',
  },
];

// ---------------- 事件（事实层，全部显式 axis） ----------------
export const seedEvents_whitecollar: LifeEvent[] = [
  // === 未来 14 天日历（outer） ===
  ...Array.from({ length: 14 }).flatMap((_, i): LifeEvent[] => {
    const dow = (new Date(now + i * day).getDay() + 6) % 7; // 0=周一
    const evts: LifeEvent[] = [];
    if (dow < 5) {
      evts.push({
        id: `cal-w-meet-${i}`, type: 'calendar', title: '产品评审会 + 跨团队对齐',
        detail: `第 ${i + 1} 天会议块`, sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 9), endTime: iso(i, 11), domain: '工作', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
      evts.push({
        id: `cal-w-deep-${i}`, type: 'calendar', title: '深度工作保护块（10:00-11:30）',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 10), endTime: iso(i, 11, 30), domain: '工作', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
        relatedCommitmentId: 'cm-w4',
      });
      evts.push({
        id: `cal-w-commute-${i}`, type: 'calendar', title: '通勤（地铁 1.5 小时）',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 7), endTime: iso(i, 8, 30), domain: '工作', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
    }
    if (dow === 2) {
      evts.push({
        id: `cal-w-family-${i}`, type: 'calendar', title: '家庭晚餐 + 亲子阅读',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 18), endTime: iso(i, 21), domain: '家庭', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
        relatedCommitmentId: 'cm-w2',
      });
    }
    return evts;
  }),
  // === 过去 6 周健康摘要（outer） ===
  ...Array.from({ length: 10 }).map((_, i): LifeEvent => ({
    id: `hl-w-${i}`, type: 'health',
    title: `睡眠 ${i === 3 || i === 7 ? '6小时10分（项目截止前夜）' : '7小时00分'} · 步数 ${3200 + ((i * 877) % 2800)}`,
    detail: '设备端按日聚合摘要', sourceType: 'device', sourceRef: 'health-connect',
    startTime: iso(-9 + i, 7), domain: '身体', sensitivity: 'sensitive',
    confidence: 0.95, consentId: 'perm-health', layer: 'fact', axis: 'outer',
  })),
  // === 过去 6 周深度工作行为证据（假设卡 H-w01 证据链） ===
  { id: 'ev-w-deep1', type: 'work', title: '深度工作保护块：90 分钟无中断完成 PRD', detail: '上午 10:00-11:30', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-28, 10), endTime: iso(-28, 11, 30), domain: '工作', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w4', userInterpretation: '那天会议被推迟了，反而保护块保住了' },
  { id: 'ev-w-deep2', type: 'task', title: '深度工作保护块（被会议占用）', detail: '原计划 90 分钟，被临时会议占用 60 分钟', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-21, 10), endTime: iso(-21, 11), domain: '工作', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w4' },
  { id: 'ev-w-deep3', type: 'task', title: '深度工作保护块（被会议占用）', detail: '原计划 90 分钟，全部被占用', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-14, 10), endTime: iso(-14, 11, 30), domain: '工作', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w4' },
  { id: 'ev-w-deep4', type: 'work', title: '深度工作保护块：60 分钟完成需求拆解', detail: '保护块缩到 60 分钟但保住', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-7, 10), endTime: iso(-7, 11), domain: '工作', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w4', userInterpretation: '把 90 分钟改成 60 分钟反而更容易保住' },
  // === 反证事件：保护块被占用那天仍能完成 ===
  { id: 'ev-w-deep-win', type: 'work', title: '保护块被占用后，下午自主补回 45 分钟', detail: '无外部约定，自主启动', sourceType: 'journal', sourceRef: 'voice-diary', startTime: iso(-14, 15), endTime: iso(-14, 16), domain: '工作', sensitivity: 'normal', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w4', userInterpretation: '那天本想放弃，但下午发现 45 分钟就够了' },
  // === 加班事件（归因到项目截止，outer）===
  { id: 'ev-w-ot1', type: 'work', title: '项目截止前加班：21:30 离开', detail: 'OKR 核心项冲刺', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-20, 19), endTime: iso(-20, 21, 30), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w1' },
  { id: 'ev-w-ot2', type: 'work', title: '项目截止前加班：22:00 离开', detail: 'OKR 核心项冲刺', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-13, 19), endTime: iso(-13, 22), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w1' },
  // === 家庭时段事件（outer）===
  ...Array.from({ length: 4 }).map((_, i): LifeEvent => ({
    id: `ev-w-fam-${i}`, type: 'calendar', title: `家庭时段：亲子阅读 + 晚餐（第 ${i + 1} 次）`,
    detail: '周三晚 2.5 小时', sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(-28 + i * 7, 18), endTime: iso(-28 + i * 7, 21),
    domain: '家庭', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    relatedCommitmentId: 'cm-w2',
  })),
  // === 周三晚边界事件 ===
  { id: 'ev-w-boundary1', type: 'calendar', title: '周三晚 21 点后停止工作（边界保住）', detail: '关闭工作通知', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-21, 21), domain: '休息', sensitivity: 'normal', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w3' },
  { id: 'ev-w-boundary2', type: 'task', title: '周三晚 21 点后仍在工作（边界打破）', detail: '项目截止前临时任务', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-14, 21), endTime: iso(-14, 23), domain: '工作', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w3' },
  { id: 'ev-w-boundary3', type: 'calendar', title: '周三晚 21 点后停止工作（边界保住）', detail: '关闭工作通知', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-7, 21), domain: '休息', sensitivity: 'normal', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-w3' },
  // === 日记（inner） ===
  { id: 'j-w-1', type: 'journal', title: '语音日记：会议密度后的疲惫', detail: '转写 2 分 00 秒', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-15, 22), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '今天 5 个会，每个会都很重要，但开完发现自己一整天没产出。这不是我效率低，是会议结构本身的问题。' },
  { id: 'j-w-2', type: 'journal', title: '日记：周三边界打破后的反思', sourceType: 'user', sourceRef: 'text-diary', startTime: iso(-13, 23), domain: '休息', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '本来保了 3 周边界，今天破了。理由是项目截止，但其实是我没提前拒绝一个临时会议。下次得学会说「明天再议」。' },
  { id: 'j-w-3', type: 'journal', title: '语音日记：保护块被占用后的状态', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-7, 22), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '这周保护块又被占了 2 次。把时间改成 60 分钟反而保住了。可能我之前定的 90 分钟太长，会议容易塞进来。' },
  // === 决策卡（inner） ===
  { id: 'd-w-1', type: 'decision', title: '决策卡：是否接 Q4 项目主导', detail: '选项、预测与理由已记录，90 天后复盘', sourceType: 'user', sourceRef: 'decision-card', startTime: iso(-6, 17), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '预测：会进一步挤压家庭时段；理由：是晋升机会，但需要先与家人协商边界。' },
  // === 实验结果事件（inner） ===
  { id: 'o-w-1', type: 'outcome', title: '实验记录：60 分钟保护块（第 4 天）', detail: '保住 4/5，主观阻力 2/10', sourceType: 'user', sourceRef: 'experiment-checkin', startTime: iso(-1, 11), domain: '工作', sensitivity: 'normal', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', relatedCommitmentId: 'cm-w4' },
];

// ---------------- 假设卡 ----------------
export const seedHypotheses_whitecollar: Hypothesis[] = [
  {
    id: 'H-w01', version: 2,
    statement: '过去六周，你的深度工作产出与「保护块是否被会议占用」强相关，而与「会议总数」相关性弱；真正的杠杆是保护块完整性，不是减少会议总量。',
    supporting: [
      { eventId: 'ev-w-deep1', quote: '保护块保住那天 90 分钟完成 PRD', time: iso(-28, 10), sourceType: 'task_app' },
      { eventId: 'ev-w-deep3', quote: '保护块全部被占用那天 0 产出', time: iso(-14, 10), sourceType: 'task_app' },
      { eventId: 'ev-w-deep4', quote: '保护块缩到 60 分钟后保住率上升', time: iso(-7, 10), sourceType: 'task_app' },
    ],
    countering: [
      { eventId: 'ev-w-deep-win', quote: '保护块被占用后下午自主补回 45 分钟', time: iso(-14, 15), sourceType: 'journal' },
    ],
    dataGaps: ['未记录会议总数对照', '不同任务的难度未标准化'],
    alternatives: ['保护块被占用是会议突发性的结果，不是保护块本身有效', '反证 ev-w-deep-win 显示个人意愿也能补回产出'],
    confidence: 0.62,
    harmNote: '可能被读作「你应该更自律地保护时间」——本假设指向会议结构（外部约束），不是个人意志力。',
    suggestedExperimentId: 'exp-w1',
    reviewAt: iso(10),
    status: 'open',
    createdAt: iso(-7),
    history: [
      { at: iso(-14), change: '创建 v1（基于 3 周数据）', confidence: 0.50 },
      { at: iso(-7), change: 'v2：加入反证 ev-w-deep-win，置信度 0.50→0.62，明确归因到会议结构', confidence: 0.62 },
    ],
  },
  {
    id: 'H-w02', version: 1,
    statement: '周三晚 21 点后停止工作的 3 周里，你的周四决策质量主观评分更高；边界可能提升决策而非牺牲产出。',
    supporting: [
      { eventId: 'ev-w-boundary1', quote: '周三晚边界保住', time: iso(-21, 21), sourceType: 'task_app' },
      { eventId: 'ev-w-boundary3', quote: '周三晚边界保住', time: iso(-7, 21), sourceType: 'task_app' },
      { eventId: 'j-w-2', quote: '边界打破后次日主观反思「应该提前拒绝」', time: iso(-13, 23), sourceType: 'journal' },
    ],
    countering: [
      { eventId: 'ev-w-boundary2', quote: '边界打破那次是项目截止前，确实必要', time: iso(-14, 21), sourceType: 'task_app' },
    ],
    dataGaps: ['未标准化「决策质量」测量', '未对照不设边界的同事'],
    alternatives: ['决策质量提升是休息效应，不是边界效应', '边界打破的反证显示边界并非总是可行'],
    confidence: 0.48,
    harmNote: '不评判「该不该加班」——这是用户自主的边界选择。',
    suggestedExperimentId: 'exp-w2',
    reviewAt: iso(20),
    status: 'open',
    createdAt: iso(-3),
    history: [{ at: iso(-3), change: '创建 v1', confidence: 0.48 }],
  },
];

// ---------------- 实验 ----------------
const mkCheckIns_whitecollar = (startOffset: number, n: number, pattern: (i: number) => [boolean, string]): CheckIn[] =>
  Array.from({ length: n }).map((_, i) => {
    const [done, note] = pattern(i);
    return { date: iso(startOffset + i), done, note };
  });

export const seedExperiments_whitecollar: Experiment[] = [
  {
    id: 'exp-w1', kind: '微调实验', hypothesisId: 'H-w01',
    question: '保护块从 90 分钟降到 60 分钟，连续 7 天，保住率与产出能否同时维持？',
    baseline: '过去 4 周 90 分钟保护块保住率 1/5',
    intervention: '未来 7 天，每天 10:00-11:00 设为 60 分钟保护块；会议不得占用；写不完即停',
    metrics: ['保护块保住率（行为）', '主观阻力评分 1-10（主观）', '产出字数/任务数（外部）'],
    confounders: ['会议突发性', '任务难度', '是否在冲刺期'],
    stopRule: '连续 2 天保护块被占用或主观阻力 >7 时暂停',
    sideEffects: '60 分钟可能不够完成大块任务，需接受拆分',
    durationDays: 7, startDate: iso(-4), status: 'active',
    checkIns: mkCheckIns_whitecollar(-4, 4, (i) => [
      true,
      ['保住 60 分钟，阻力 3/10，完成 PRD 1 节', '保住 60 分钟，阻力 2/10，完成需求拆解', '被占用 30 分钟，剩余 30 分钟启动，阻力 5/10', '保住 60 分钟，阻力 3/10，完成 1 个评审材料'][i],
    ]),
  },
  {
    id: 'exp-w2', kind: '结构实验', hypothesisId: 'H-w02',
    question: '连续 30 天周三晚 21 点后关闭工作通知，能否维持决策质量且不牺牲 OKR 进度？',
    baseline: '过去 4 周周三晚边界保住率 2/4',
    intervention: '未来 4 周，每周三 21 点后关闭工作通知；紧急事项由妻子转告；次日 9 点统一回复',
    metrics: ['周三边界保住率（行为）', '周四决策质量主观评分 1-10（主观）', 'OKR 进度（外部）'],
    confounders: ['冲刺期实际结束时间', '团队临时安排', '家庭事务'],
    stopRule: '若季度 OKR 出现重大风险可临时打破，但需事后记录',
    durationDays: 30, startDate: iso(3), status: 'proposed',
    checkIns: [],
  },
];

// ---------------- 意义方向 ----------------
export const seedDirections_whitecollar: MeaningDirection[] = [
  {
    id: 'dir-w1', statement: '在不透支家庭的前提下完成职业目标', serveWhom: '自己与家人',
    contribution: '保护块、边界承诺、OKR 按时交付', costBoundary: '不以牺牲睡眠与家庭时段为代价',
    skillIds: ['sk-w1'], projectIds: ['pj-w1'], evidenceScore: 0.55, trend: 'up',
  },
  {
    id: 'dir-w2', statement: '成为孩子稳定的陪伴者', serveWhom: '孩子',
    contribution: '每周 2 个完整家庭时段、周三晚边界', costBoundary: '接受职业节奏阶段性放缓',
    skillIds: [], projectIds: ['pj-w2'], evidenceScore: 0.40, trend: 'flat',
  },
];

// ---------------- 技能 ----------------
export const seedSkills_whitecollar: SkillTrack[] = [
  {
    id: 'sk-w1', name: '产品需求文档（PRD）写作',
    targetPerformance: '能在 60 分钟内完成一个功能的完整 PRD（含验收标准）',
    baseline: '90 分钟保护块内完成 1 节 PRD',
    rubric: ['需求拆解', '用户故事', '验收标准', '边界条件', '语言精度'],
    prerequisites: ['业务理解', '技术可行性判断', '用户访谈'],
    stage: '刻意练习', mastery: 0.42, weeklyPlan: '本周：60 分钟保护块 × 5 + 1 次完整 PRD',
    evidences: [
      { date: iso(-28), kind: '作品', note: '保护块 90 分钟完成 PRD 1 节' },
      { date: iso(-14), kind: '练习', note: '保护块被占用后下午补 45 分钟' },
      { date: iso(-7), kind: '练习', note: '60 分钟保护块完成需求拆解' },
      { date: iso(-1), kind: '作品', note: '60 分钟完成 1 个评审材料' },
    ],
    replanReason: '原计划「90 分钟保护块」保住率 1/5——实验 exp-w1 显示 60 分钟更易保住',
  },
  {
    id: 'sk-w2', name: '跨团队沟通',
    targetPerformance: '能在 30 分钟会议内达成跨团队决策且不需要二次对齐',
    baseline: '会议平均 60 分钟，二次对齐率 40%',
    rubric: ['议程设计', '利益方识别', '冲突调解', '决策记录', '跟进闭环'],
    prerequisites: ['业务理解', '关系建立'],
    stage: '迁移验证', mastery: 0.55, weeklyPlan: '本周：3 次跨团队会，记录决策点与二次对齐次数',
    evidences: [
      { date: iso(-15), kind: '反馈', note: '同事反馈：议程清晰但决策记录偏慢' },
      { date: iso(-3), kind: '迁移', note: '1 次会议 30 分钟内达成决策' },
    ],
  },
];

// ---------------- 项目 ----------------
export const seedProjects_whitecollar: Project[] = [
  {
    id: 'pj-w1', name: 'Q3 OKR 核心项交付',
    mission: '按时交付 3 项核心 OKR，其中 2 项达成挑战值；成功 = 季度评审通过',
    nonGoals: '不追求 OKR 总数，不接受「顺便」新增的非核心项',
    nextKeyAction: '本周五 16:00 完成核心项 2 的 PRD 终稿',
    criticalPath: ['PRD 终稿', '技术评审', '开发排期', '联调', '上线'],
    milestones: [
      { title: '核心项 1 上线', due: iso(-7), done: true, acceptance: '线上无 P0 bug' },
      { title: '核心项 2 PRD 终稿', due: iso(2), done: false, acceptance: '技术评审通过' },
      { title: '核心项 3 联调', due: iso(14), done: false, acceptance: '联调通过率 ≥ 90%' },
      { title: '季度评审', due: iso(20), done: false, acceptance: '3 项核心 OKR 全部交付' },
    ],
    risks: [
      { title: '冲刺期延长挤压家庭', signal: '连续 2 周加班 > 3 晚', level: 'high', mitigation: '与上级重新协商排期，启动 60 分钟保护块', reviewAt: iso(7) },
      { title: '会议碎片化侵蚀保护块', signal: '保护块保住率 < 50%', level: 'high', mitigation: '启动 exp-w1（60 分钟保护块）', reviewAt: iso(7) },
    ],
    decisionLedger: [
      { date: iso(-6), options: '接 Q4 项目主导 / 婉拒', decision: '接，但声明周三晚与周日不可占用', reason: '晋升机会；用边界保护家庭', reviewAt: iso(84) },
    ],
    meaningLoop: '服务方向 dir-w1；当前代价（每周约 8 小时加班）在承诺边界内，但需警惕冲刺期失衡。',
    progress: 0.55, status: 'active',
  },
  {
    id: 'pj-w2', name: '家庭健康档案与亲子时段',
    mission: '建立可持续更新的家庭健康档案，每周保留 2 个完整亲子时段；成功 = 连续 4 周落地',
    nonGoals: '不做医疗判断，所有指标解读以医生为准',
    nextKeyAction: '本周三 18:00 家庭晚餐 + 亲子阅读',
    criticalPath: ['亲子时段保护', '周三晚边界', '健康档案整理', '配偶协商'],
    milestones: [
      { title: '4 周亲子时段落地', due: iso(0), done: true, acceptance: '4 次 ≥2 小时段' },
      { title: '健康档案 v1', due: iso(21), done: false, acceptance: '含孩子疫苗记录与家庭体检' },
    ],
    risks: [
      { title: '冲刺期打破边界', signal: '连续 2 周周三晚加班', level: 'mid', mitigation: '提前 24 小时与家人协商替代时段', reviewAt: iso(14) },
    ],
    decisionLedger: [],
    meaningLoop: '服务方向 dir-w2；当前进度符合承诺 cm-w2/cm-w3。',
    progress: 0.50, status: 'active',
  },
];
