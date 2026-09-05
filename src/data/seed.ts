/**
 * 知行镜 ZhixingOS 种子数据
 * 以策划书「用户 A：目标过多的知识工作者」与附录 D 洞察卡示例为蓝本，
 * 构造一位已使用约 6 周的演示用户：林一舟，32 岁，知识工作者。
 */
import {
  LifeEvent, Commitment, Hypothesis, Experiment, MeaningDirection, SkillTrack,
  Project, Permission, AuditEntry, MemoryItem, UserProfile, CheckIn,
} from '../types/models';

const now = Date.now();
const day = 86400_000;
const iso = (offsetDays: number, hour = 9) => {
  const d = new Date(now + offsetDays * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

// ---------------- 用户 ----------------
export const seedUser: UserProfile = {
  name: '一舟',
  lifeStage: '成年人',
  constraints: ['季度冲刺期工作强度大', '周末需陪伴家人', '晚间 23 点后精力明显下降'],
  onboarded: true,
  silentMode: false,        // 向后兼容（= proactivity === 'P0'）
  proactivity: 'P1',        // V4.3 Task 9.6：四级主动性默认 P1（每天一次）
  secretaryLevel: 'L2',
  weeksOfData: 6,
};

// ---------------- 承诺层 ----------------
export const seedCommitments: Commitment[] = [
  {
    id: 'cm1', statement: '把健康放在可预期作息上', why: '长期创作与家庭都需要稳定精力',
    domain: '身体', priority: 2, createdAt: iso(-40), deadline: iso(50),
    costNote: '每周至少 4 天 23:30 前入睡', userConfirmed: true, status: 'active',
    acceptance: '连续 2 周达成「每周 ≥4 天 23:30 前入睡」',
    stopCondition: '若连续 5 天无法早睡且无补偿休息，降优先级并复盘作息结构',
  },
  {
    id: 'cm2', statement: '完成写作集《迁徙的方法》初稿', why: '三年来的核心创作方向',
    domain: '创造', priority: 1, createdAt: iso(-40), deadline: iso(80),
    costNote: '接受前三个月产出质量不稳定', userConfirmed: true, status: 'active',
    acceptance: '完成 6 篇初稿并获得 ≥10 位目标读者真实反馈',
    stopCondition: '若 3 个月无实质产出且持续只能靠外部约定启动，重新评估方向而非硬撑',
  },
  {
    id: 'cm3', statement: '每周至少两个完整时段陪伴家人', why: '家庭是最重要的关系场域',
    domain: '家庭', priority: 3, createdAt: iso(-40),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周实际落地 ≥2 个不可占用家庭时段',
    stopCondition: '任一方感到被强制安排时暂停并重新协商',
  },
  {
    id: 'cm4', statement: '基于《迁徙的方法》试读反馈开设每月 newsletter', why: '把写作沉淀为可持续反馈回路',
    domain: '创造', priority: 4, createdAt: iso(-30), deadline: iso(120),
    costNote: '只在初稿完成后启动，不抢占写作时间', userConfirmed: true, status: 'active',
    dependsOn: ['cm2'],
    acceptance: '连续 3 期收到 ≥3 份读者反馈',
    stopCondition: '若 newsletter 退化为打卡式任务则停止，不强行维持',
  },
];

// ---------------- 事件（事实层，全部带来源 —— 验收 A-01） ----------------
export const seedEvents: LifeEvent[] = [
  // 日历：未来 14 天分布（工作 82% / 家庭 6% / 写作 0 固定时段 —— 复刻策划书 2.5.2 初始镜像）
  ...Array.from({ length: 14 }).flatMap((_, i): LifeEvent[] => {
    const base: LifeEvent[] = [
      {
        id: `cal-w-${i}`, type: 'calendar', title: i % 3 === 0 ? '产品评审会 + 跟进' : '迭代开发与跨团队对齐',
        detail: `第 ${i + 1} 天工作块`, sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 9), endTime: iso(i, 18), domain: '工作', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact',
      },
    ];
    if (i === 5 || i === 11) {
      base.push({
        id: `cal-f-${i}`, type: 'calendar', title: '家庭晚餐与公园散步', sourceType: 'calendar',
        sourceRef: 'system-calendar', startTime: iso(i, 18), endTime: iso(i, 20), domain: '家庭',
        sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact',
      });
    }
    if (i === 9) {
      base.push({
        id: 'cal-cowrite-1', type: 'calendar', title: '与老周共同写作（已约定）', detail: '第 4 次共同创作约定',
        sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(i, 19), endTime: iso(i, 21),
        domain: '创造', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact',
      });
    }
    return base;
  }),
  // 健康摘要（设备聚合，不传原始明细）
  ...Array.from({ length: 10 }).map((_, i): LifeEvent => ({
    id: `hl-${i}`, type: 'health', title: `睡眠 ${i % 4 === 2 ? '6小时12分' : i % 3 === 0 ? '7小时05分' : '6小时48分'} · 步数 ${3200 + ((i * 977) % 3800)}`,
    detail: '设备端按日聚合摘要', sourceType: 'device', sourceRef: 'health-connect',
    startTime: iso(-9 + i, 7), domain: '身体', sensitivity: 'sensitive',
    confidence: 0.95, consentId: 'perm-health', layer: 'fact',
  })),
  // 过去 6 周的关键行为证据（假设卡 H-031 的证据链）
  { id: 'ev-cw1', type: 'work', title: '共同写作 #1：按时开始，产出 1400 字', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-36, 19), endTime: iso(-36, 21), domain: '创造', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm2', userInterpretation: '有人等着的时候，开始并不难' },
  { id: 'ev-cw2', type: 'work', title: '共同写作 #2：按时开始，完成第三章框架', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-22, 19), endTime: iso(-22, 21), domain: '创造', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm2' },
  { id: 'ev-cw3', type: 'work', title: '共同写作 #3：按时开始，修订两节', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-8, 19), endTime: iso(-8, 21), domain: '创造', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm2' },
  { id: 'ev-solo1', type: 'task', title: '独处写作计划（推迟）', detail: '计划 2 小时，推迟至次日', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-30, 20), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', relatedCommitmentId: 'cm2' },
  { id: 'ev-solo2', type: 'task', title: '独处写作计划（推迟）', detail: '计划 1.5 小时，未启动', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-19, 20), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', relatedCommitmentId: 'cm2' },
  { id: 'ev-solo3', type: 'task', title: '独处写作计划（推迟）', detail: '计划 2 小时，改为整理资料', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-12, 20), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', relatedCommitmentId: 'cm2' },
  { id: 'ev-solo4', type: 'task', title: '独处写作计划（推迟）', detail: '计划 1 小时，未启动', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-5, 20), domain: '创造', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', relatedCommitmentId: 'cm2' },
  // 反证事件
  { id: 'ev-solo-win', type: 'work', title: '独处写作：连续 90 分钟', detail: '周日上午，无外部约定', sourceType: 'journal', sourceRef: 'voice-diary', startTime: iso(-15, 10), domain: '创造', sensitivity: 'normal', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm2', userInterpretation: '那天的题目特别顺' },
  // 日记（体验层内容经由 fact 事件承载，userInterpretation 为自述）
  { id: 'j-1', type: 'journal', title: '语音日记：评审会之后的空虚感', detail: '转写 2 分 14 秒', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-3, 22), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '会议很顺利，但结束后很空。好像这一天没有一件事是我自己选的。' },
  { id: 'j-2', type: 'journal', title: '日记：和老周聊完后的想法', sourceType: 'user', sourceRef: 'text-diary', startTime: iso(-9, 23), domain: '创造', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '他说"你需要的不是自律，是一个等你的读者"。当时不太服气。' },
  // 决策卡
  { id: 'd-1', type: 'decision', title: '决策卡：是否接下 Q3 的新项目', detail: '选项、预测与理由已记录，90 天后复盘', sourceType: 'user', sourceRef: 'decision-card', startTime: iso(-6, 17), domain: '工作', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '预测：会占用写作时间；理由：团队确实缺人，且是可见度机会。' },
  // 实验结果事件
  { id: 'o-1', type: 'outcome', title: '实验记录：晚饭前写作 25 分钟（第 4 天）', detail: '启动成功，主观阻力 3/10', sourceType: 'user', sourceRef: 'experiment-checkin', startTime: iso(-1, 18), domain: '创造', sensitivity: 'normal', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', relatedCommitmentId: 'cm2' },
];

// ---------------- 假设卡 ----------------
export const seedHypotheses: Hypothesis[] = [
  {
    id: 'H-031', version: 2,
    statement: '过去六周，你的稳定创作主要发生在与他人约定之后；外部承诺可能是启动条件，而不是你缺少创作兴趣。',
    supporting: [
      { eventId: 'ev-cw1', quote: '共同写作 #1 按时开始，产出 1400 字', time: iso(-36, 19), sourceType: 'calendar' },
      { eventId: 'ev-cw2', quote: '共同写作 #2 按时开始，完成第三章框架', time: iso(-22, 19), sourceType: 'calendar' },
      { eventId: 'ev-cw3', quote: '共同写作 #3 按时开始，修订两节', time: iso(-8, 19), sourceType: 'calendar' },
      { eventId: 'ev-solo1', quote: '独处计划 4 次中 3 次推迟或未启动', time: iso(-30, 20), sourceType: 'task_app' },
    ],
    countering: [
      { eventId: 'ev-solo-win', quote: '一次独处写作持续 90 分钟（无外部约定）', time: iso(-15, 10), sourceType: 'journal' },
    ],
    dataGaps: ['共同创作与独处写作的任务难度未标准化', '睡眠数据只覆盖近 10 天'],
    alternatives: ['共同创作的任务平均更简单', '工作日/周末差异：独处成功那次在周日', '选题顺利程度不同'],
    confidence: 0.63,
    harmNote: '可能被读作"你缺乏自律"——本假设不指向人格，只指向启动条件。',
    suggestedExperimentId: 'exp1',
    reviewAt: iso(9),
    status: 'open',
    createdAt: iso(-7),
    history: [
      { at: iso(-14), change: '创建 v1（基于 4 周数据）', confidence: 0.52 },
      { at: iso(-7), change: 'v2：加入反证 ev-solo-win，置信度 0.52→0.63，增加替代解释', confidence: 0.63 },
    ],
  },
  {
    id: 'H-032', version: 1,
    statement: '「家庭最重要」的价值排序与未来 14 天已排时间（家庭 6%）存在结构性差距；当前更像"角色挤压"而非价值改变。',
    supporting: [
      { eventId: 'cal-w-0', quote: '未来 14 天工作日历占比约 82%', time: iso(0, 9), sourceType: 'calendar' },
      { eventId: 'cal-f-5', quote: '14 天内仅 2 个家庭时段', time: iso(5, 18), sourceType: 'calendar' },
    ],
    countering: [],
    dataGaps: ['未检索到反证：冲刺期结束后日历尚未更新', '家庭互动的质量维度无数据'],
    alternatives: ['季度冲刺的临时现象（用户自述）', '角色边界尚未建立而非价值冲突'],
    confidence: 0.48,
    harmNote: '涉及家庭关系，展示时不做道德评判。',
    suggestedExperimentId: 'exp2',
    reviewAt: iso(14),
    status: 'open',
    createdAt: iso(-2),
    history: [{ at: iso(-2), change: '创建 v1（冲刺期结束后复审）', confidence: 0.48 }],
  },
  {
    id: 'H-028', version: 3,
    statement: '「我从不坚持」的叙事与历史完成记录冲突：你在有外部验收标准的领域（工作交付、共同创作）持续完成率高于自评。',
    supporting: [
      { eventId: 'ev-cw2', quote: '共同创作 3 次均完成约定产出', time: iso(-22, 19), sourceType: 'calendar' },
    ],
    countering: [
      { eventId: 'ev-solo2', quote: '无验收人的独处计划确实多次未启动', time: iso(-19, 20), sourceType: 'task_app' },
    ],
    dataGaps: ['6 周之前的历史数据未导入'],
    alternatives: ['坚持只发生在有外部结构的领域——这是条件差异，不是稳定的"能坚持"'],
    confidence: 0.55,
    reviewAt: iso(20),
    status: 'confirmed',
    createdAt: iso(-21),
    history: [
      { at: iso(-21), change: '创建 v1', confidence: 0.4 },
      { at: iso(-14), change: '用户补充 2 条反证，修正表述范围', confidence: 0.5 },
      { at: iso(-3), change: '用户确认修正版，标记为"已确认"（仍可推翻）', confidence: 0.55 },
    ],
  },
];

// ---------------- 实验 ----------------
const mkCheckIns = (startOffset: number, n: number, pattern: (i: number) => [boolean, string]): CheckIn[] =>
  Array.from({ length: n }).map((_, i) => {
    const [done, note] = pattern(i);
    return { date: iso(startOffset + i), done, note };
  });

export const seedExperiments: Experiment[] = [
  {
    id: 'exp1', kind: '微调实验', hypothesisId: 'H-031',
    question: '固定时段 + 最小剂量（25 分钟）能否在没有外部约定时启动写作？',
    baseline: '过去 4 周独处写作计划启动率 1/5',
    intervention: '未来 7 天，晚饭前 18:30-18:55 写作 25 分钟；写不完即停，不补偿',
    metrics: ['启动率（行为）', '主观阻力评分 1-10（主观）', '产出字数（外部）'],
    confounders: ['工作强度', '睡眠时长', '是否在周末'],
    stopRule: '连续两天主观阻力 >7 或影响必要职责时暂停',
    sideEffects: '可能挤压晚饭后的家庭时间，已在日历预留',
    durationDays: 7, startDate: iso(-4), status: 'active',
    checkIns: mkCheckIns(-4, 4, (i) => [
      true,
      ['启动成功，阻力 4/10，380 字', '启动成功，阻力 3/10，520 字', '差点没开始，把 25 分钟改成 15 分钟后启动了，阻力 5/10', '启动成功，阻力 3/10，写到一半进入状态多写了 20 分钟'][i],
    ]),
  },
  {
    id: 'exp2', kind: '结构实验', hypothesisId: 'H-032',
    question: '冲刺期结束后，预先声明的家庭时段能否从 6% 提升到 20%？',
    baseline: '未来 14 天家庭时段占比 6%（2/32 个时段块）',
    intervention: '与伴侣共同确认每周 3 个不可占用时段，写入双方日历；工作冲突需提前 24 小时协商',
    metrics: ['家庭时段占比（行为）', '时段被占用次数（行为）', '主观关系满意度（主观）'],
    confounders: ['冲刺期实际结束时间', '家庭成员临时安排'],
    stopRule: '任一方感到被强制时暂停并重新协商',
    durationDays: 30, startDate: iso(3), status: 'proposed',
    checkIns: [],
  },
  {
    id: 'exp0', kind: '停止实验',
    question: '暂停"每日英语打卡 30 天"任务，观察释放的时间与情绪变化',
    baseline: '打卡连续 21 天，但近一周主观描述为"在完成任务"',
    intervention: '暂停 14 天，不找替代任务',
    metrics: ['释放时间的实际去向（行为）', '晨起第一句话的情绪色彩（主观）'],
    confounders: ['工作强度'],
    stopRule: '出现明显焦虑或自责时记录并可以恢复',
    durationDays: 14, startDate: iso(-16), status: 'completed',
    checkIns: [],
    result: '14 天内未恢复打卡的欲望；释放时间约 60% 流向写作与睡眠。用户决定正式结束该任务。',
    modelUpdate: 'H-022「打卡类任务维持的是秩序感而非学习目标」置信度 0.41→0.58；该任务已归档为"有效停止"。',
  },
];

// ---------------- 意义方向 ----------------
export const seedDirections: MeaningDirection[] = [
  {
    id: 'dir1', statement: '写出能陪伴同代人的诚实文字', serveWhom: '30 岁前后、处在转型期的知识工作者',
    contribution: '写作集《迁徙的方法》、 newsletter 每月一篇', costBoundary: '不以牺牲睡眠与家庭时段为代价',
    skillIds: ['sk1'], projectIds: ['pj1'], evidenceScore: 0.62, trend: 'up',
  },
  {
    id: 'dir2', statement: '成为可以依靠的家人', serveWhom: '伴侣与孩子',
    contribution: '固定的共同时段、重要时刻在场', costBoundary: '接受职业节奏阶段性放缓',
    skillIds: [], projectIds: [], evidenceScore: 0.38, trend: 'flat',
  },
];

// ---------------- 技能 ----------------
export const seedSkills: SkillTrack[] = [
  {
    id: 'sk1', name: '长文叙事写作',
    targetPerformance: '独立完成 8000 字非虚构长文，并让 3 位目标读者准确复述核心论点',
    baseline: '60 分钟限时短文 3 篇，读者测试 2/3 能复述主旨',
    rubric: ['选题', '结构', '场景描写', '论证', '语言', '修订'],
    prerequisites: ['素材笔记法', '访谈提纲', '结构大纲', '节奏控制', '冷读修订'],
    stage: '刻意练习', mastery: 0.44, weeklyPlan: '本周：共同写作 1 次（修订第三章）+ 晚饭前 25 分钟 × 5（新素材）',
    evidences: [
      { date: iso(-22), kind: '作品', note: '第三章框架（共同写作产出）' },
      { date: iso(-15), kind: '测验', note: '限时 60 分钟短文，结构维度 3/5' },
      { date: iso(-9), kind: '反馈', note: '老周：场景描写有进步，论证段落仍跳步' },
      { date: iso(-1), kind: '练习', note: '晚饭前 25 分钟，新素材 520 字' },
    ],
    replanReason: '原定本周的「叙事理论阅读」延后——实验 exp1 显示启动条件比素材积累更紧迫',
  },
  {
    id: 'sk2', name: 'AI 辅助研究流程',
    targetPerformance: '用可复核的方式在 2 小时内完成一个陌生主题的文献地图',
    baseline: '未完成基线任务',
    rubric: ['检索策略', '来源核验', '结构化笔记'],
    prerequisites: ['检索语法', '引用管理'],
    stage: '定义能力', mastery: 0.08, weeklyPlan: '待 9 月启动（当前资源优先写作）',
    evidences: [],
  },
];

// ---------------- 项目 ----------------
export const seedProjects: Project[] = [
  {
    id: 'pj1', name: '《迁徙的方法》写作集',
    mission: '为处在转型期的同代人写下诚实、不煽情的迁徙故事；成功 = 完成 6 篇初稿并获得 10 位目标读者的真实反馈',
    nonGoals: '不追求出版谈判、不做营销账号、不接约稿',
    nextKeyAction: '周四 18:30 完成第三章「离开的人如何告别」修订稿 800 字',
    criticalPath: ['第三章修订', '第四章初稿', '内部试读（3 人）', '修订整编', '10 人试读'],
    milestones: [
      { title: '第三章修订完成', due: iso(2), done: false, acceptance: '老周通读一次无结构性质疑' },
      { title: '第四章初稿', due: iso(16), done: false, acceptance: '6000 字以上，含 2 个完整场景' },
      { title: '内部试读 3 人', due: iso(30), done: false, acceptance: '3 份书面反馈，每人 ≥300 字' },
    ],
    risks: [
      { title: '冲刺期延长挤压写作', signal: '连续 5 天无任何写作时段', level: 'high', mitigation: '启动「最小剂量」25 分钟模式；必要时暂停第四章', reviewAt: iso(7) },
      { title: '完美主义导致修订轮次失控', signal: '单章修订超过 4 轮', level: 'mid', mitigation: '每章修订上限 3 轮，超限进入试读', reviewAt: iso(14) },
    ],
    decisionLedger: [
      { date: iso(-6), options: '接 Q3 新项目 / 婉拒', decision: '接，但声明每周三晚与周日不可占用', reason: '团队缺人且是可见度机会；用边界保护写作', reviewAt: iso(84) },
    ],
    meaningLoop: '仍服务方向 dir1；当前代价（每周约 6 小时晚间）在承诺边界内，但需警惕冲刺期失衡。',
    progress: 0.35, status: 'active',
  },
  {
    id: 'pj2', name: '父亲体检陪诊与健康档案整理',
    mission: '陪父亲完成年度体检，把散落的检查报告整理为一份可持续更新的家庭健康档案',
    nonGoals: '不做医疗判断，所有指标解读以医生为准',
    nextKeyAction: '本周日预约体检中心并确认陪同时间',
    criticalPath: ['预约体检', '收集旧报告', '陪诊', '归档并建立更新提醒'],
    milestones: [
      { title: '完成预约', due: iso(5), done: false, acceptance: '收到确认短信' },
      { title: '完成陪诊与归档', due: iso(19), done: false, acceptance: '档案含全部历史报告扫描件' },
    ],
    risks: [
      { title: '父亲抗拒体检', signal: '两次推迟预约', level: 'mid', mitigation: '先陪他聊一次，了解抗拒点', reviewAt: iso(6) },
    ],
    decisionLedger: [],
    meaningLoop: '服务方向 dir2；是「成为可以依靠的家人」的具体化。',
    progress: 0.15, status: 'active',
  },
];

// ---------------- 权限 ----------------
export const seedPermissions: Permission[] = [
  { id: 'perm-calendar', kind: 'calendar', granted: true, purpose: '读取未来 14 天事件，用于「承诺—时间」事实镜像与实验排期', scope: '只读 · 未来 14 天', readWrite: 'read', grantedAt: iso(-40), lastAccessAt: iso(0, 8) },
  { id: 'perm-tasks', kind: 'tasks', granted: true, purpose: '读取任务完成与推迟记录，用于行动证据链', scope: '只读', readWrite: 'read', grantedAt: iso(-40), lastAccessAt: iso(0, 8) },
  { id: 'perm-health', kind: 'health', granted: true, purpose: '按日聚合的睡眠与步数摘要，用于身体状态情境', scope: '只读 · 仅日聚合摘要，不含原始明细', readWrite: 'read', grantedAt: iso(-26), lastAccessAt: iso(0, 7) },
  { id: 'perm-journal', kind: 'journal', granted: true, purpose: '你主动写下的日记与语音转写，本地保存', scope: '仅本设备', readWrite: 'read+write', grantedAt: iso(-40), lastAccessAt: iso(-1, 22) },
  { id: 'perm-works', kind: 'works', granted: false, purpose: '你主动上传的作品片段，作为技能证据', scope: '逐次选择', readWrite: 'read' },
  { id: 'perm-chat', kind: 'chat_snippet', granted: false, purpose: '你主动粘贴的精选对话片段，本地脱敏后由你确认', scope: '逐段选择 · 短期保存', readWrite: 'read' },
  { id: 'perm-location', kind: 'location', granted: false, purpose: '默认不接入。仅在明确场景下提供粗粒度选项', scope: '不启用', readWrite: 'read' },
];

// ---------------- 审计日志 ----------------
export const seedAudit: AuditEntry[] = [
  { id: 'au1', at: iso(0, 8), actor: '观察Agent', action: '读取日历未来 14 天事件 32 条', targetRef: 'perm-calendar' },
  { id: 'au2', at: iso(0, 8), actor: '证据Agent', action: '为 H-031 检索反证，命中 1 条（ev-solo-win）', targetRef: 'H-031' },
  { id: 'au3', at: iso(-1, 22), actor: '用户', action: '修正 H-028 表述范围（「从不坚持」→「无验收人时」）', targetRef: 'H-028' },
  { id: 'au4', at: iso(-1, 18), actor: '实验设计Agent', action: '记录实验 exp1 第 4 天打卡', targetRef: 'exp1' },
  { id: 'au5', at: iso(-2, 9), actor: '记忆治理Agent', action: '归档已停止任务「每日英语打卡」及其派生推断', targetRef: 'exp0' },
  { id: 'au6', at: iso(-3, 20), actor: '安全边界Agent', action: '日记 j-1 风险分级 L0（日常反思），继续正常流程', targetRef: 'j-1' },
];

// ---------------- 周镜 ----------------
export const seedWeeklyMirror = {
  week: '本周（第 6 周）',
  insights: [
    '实验「晚饭前 25 分钟」4/4 启动成功，初步支持「最小剂量+固定锚点」作为独处启动条件——但样本仍小，且均未在工作最重的两天。',
    '你在日记 j-1 中提到「没有一件事是我自己选的」，与 H-032 的角色挤压指向同一张力；这可能比写作启动更值得优先处理。',
  ],
  openQuestions: ['冲刺期结束后，如果没有共同写作约定，你希望先恢复独处写作还是先补家庭时段？'],
  invalidNarratives: ['「我从不坚持」——已有 3 个领域证据反对，建议停用该表述'],
};
