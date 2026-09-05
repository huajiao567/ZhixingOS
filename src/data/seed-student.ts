/**
 * 知行镜 ZhixingOS 学生身份种子数据（V4.3 Task 18.1）
 *
 * 用户画像：陈知夏，21 岁，某 985 高校社会学大三学生。
 * 生活节奏由课表、考试周、社团读书会负责人、周末兼职家教构成。
 * 6 周数据覆盖：日常课程 → 期中考试周 → 社团交接筹备 → 兼职 → 室友关系 → 毕业论文选题启动。
 *
 * 设计要点：
 *  1. 所有事件显式标注 axis（SubTask 18.6）—— calendar/health/task 类=outer，journal/decision/outcome 含主观=inner。
 *  2. 学生最常见的认知模式：「截止日期前才高效」「平时作业拖延」—— 用假设卡 H-s01 表达，并明确 harmNote
 *     指出这指向启动条件而非人格，避免「我就是不自律」的过度概括。
 *  3. 公平性：考试周睡眠不足归因为「考试节奏外部约束」，userInterpretation 显式说明，不写成「我又熬夜」的内归因。
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
export const seedUser_student: UserProfile = {
  name: '知夏',
  lifeStage: '成年人',
  constraints: ['大三专业课密度高，期中考试周压力集中', '周末上午需做兼职家教', '社团读书会负责人，每月一次活动筹备'],
  onboarded: true,
  silentMode: false,
  proactivity: 'P1',
  secretaryLevel: 'L1',
  weeksOfData: 6,
};

// ---------------- 承诺层 ----------------
export const seedCommitments_student: Commitment[] = [
  {
    id: 'cm-s1', statement: '专业核心课保持 GPA ≥ 3.5', why: '保研资格与毕业论文选题都依赖专业基础',
    domain: '学习', priority: 1, createdAt: iso(-40), deadline: iso(50),
    costNote: '期中考试周每天复习 ≤ 4 小时，避免通宵',
    userConfirmed: true, status: 'active',
    acceptance: '连续 2 学期专业核心课加权平均 ≥ 85',
    stopCondition: '若连续 2 周无法完成基本作业且出现明显身心信号，暂停社团活动腾出恢复时间',
  },
  {
    id: 'cm-s2', statement: '完成毕业论文初步选题与文献综述', why: '为大四上开题做准备',
    domain: '学习', priority: 2, createdAt: iso(-30), deadline: iso(60),
    costNote: '每周保留 2 个 90 分钟文献阅读时段',
    userConfirmed: true, status: 'active',
    acceptance: '与导师确认 1 个选题方向 + 10 篇核心文献笔记',
    stopCondition: '若选题方向 3 次被导师否定，重新评估方向而非硬撑',
  },
  {
    id: 'cm-s3', statement: '完成读书会年内交接，培养 2 位副负责人', why: '社团可持续不依赖单点',
    domain: '公共贡献', priority: 3, createdAt: iso(-25), deadline: iso(90),
    userConfirmed: true, status: 'active',
    acceptance: '2 位副负责人独立策划并落地 1 次活动',
    stopCondition: '若交接导致读书会质量明显下降，延长交接期不强行截止',
  },
  {
    id: 'cm-s4', statement: '每周六上午家教（补贴生活费，不挤占学习）', why: '经济独立的一部分',
    domain: '财务', priority: 4, createdAt: iso(-40),
    userConfirmed: true, status: 'active',
    acceptance: '连续 4 周按时完成家教且不调课',
    stopCondition: '若家教占用学习时间超过每周 4 小时（含通勤），重新评估是否续约',
  },
];

// ---------------- 事件（事实层，全部显式 axis） ----------------
export const seedEvents_student: LifeEvent[] = [
  // === 未来 14 天课程日历（outer） ===
  ...Array.from({ length: 14 }).flatMap((_, i): LifeEvent[] => {
    const dow = (new Date(now + i * day).getDay() + 6) % 7; // 0=周一
    const evts: LifeEvent[] = [];
    if (dow < 5) {
      evts.push({
        id: `cal-s-c${i}`, type: 'calendar', title: '专业核心课 · 中国社会学史',
        detail: `第 ${i + 1} 天课程块`, sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 8), endTime: iso(i, 9), domain: '学习', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
      evts.push({
        id: `cal-s-c2-${i}`, type: 'calendar', title: '选修课 · 城市社会学',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 14), endTime: iso(i, 16), domain: '学习', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
    }
    if (dow === 2) {
      evts.push({
        id: `cal-s-club-${i}`, type: 'calendar', title: '读书会策划会',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 19), endTime: iso(i, 21), domain: '公共贡献', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
    }
    if (dow === 5) {
      evts.push({
        id: `cal-s-tutor-${i}`, type: 'calendar', title: '周末家教（高二英语）',
        sourceType: 'calendar', sourceRef: 'system-calendar',
        startTime: iso(i, 9), endTime: iso(i, 11), domain: '财务', sensitivity: 'normal',
        confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
      });
    }
    return evts;
  }),
  // === 过去 2 周健康摘要（outer，按日聚合，覆盖完整 14 天） ===
  ...Array.from({ length: 14 }).map((_, i): LifeEvent => ({
    id: `hl-s-${i}`, type: 'health',
    title: `睡眠 ${i === 3 || i === 7 ? '5小时40分（期中复习）' : i % 2 === 0 ? '7小时10分' : '6小时30分'} · 步数 ${4800 + ((i * 631) % 4200)}`,
    detail: '设备端按日聚合摘要', sourceType: 'device', sourceRef: 'health-connect',
    startTime: iso(-13 + i, 7), domain: '身体', sensitivity: 'sensitive',
    confidence: 0.95, consentId: 'perm-health', layer: 'fact', axis: 'outer',
  })),
  // === 过去 6 周学习行为证据（假设卡 H-s01 的证据链）===
  { id: 'ev-s-exam1', type: 'work', title: '期中复习：社会学史 4 小时连续完成', detail: '考前 2 天启动，启动后无中断', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-28, 14), endTime: iso(-28, 18), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s1', userInterpretation: '考试前两天反而能坐住，平时很难这样' },
  { id: 'ev-s-exam2', type: 'work', title: '期中考试：中国社会学史 92 分', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-26, 10), domain: '学习', sensitivity: 'normal', confidence: 1, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s1' },
  { id: 'ev-s-daily1', type: 'task', title: '平时作业：城市社会学读书报告（推迟 3 天提交）', detail: '原计划 2 小时，实际分 4 次完成', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-34, 20), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s1' },
  { id: 'ev-s-daily2', type: 'task', title: '平时作业：研究方法习题（推迟 2 天）', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-21, 20), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s1' },
  { id: 'ev-s-daily3', type: 'task', title: '平时作业：文献综述初稿（按时提交）', detail: '与导师约谈后第二天完成', sourceType: 'task_app', sourceRef: 'task-app', startTime: iso(-10, 16), domain: '学习', sensitivity: 'normal', confidence: 0.9, consentId: 'perm-tasks', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s2' },
  // === 反证事件：无外部 deadline 也启动成功 ===
  { id: 'ev-s-self-study', type: 'work', title: '自主文献阅读：90 分钟无中断', detail: '周日上午，无 deadline', sourceType: 'journal', sourceRef: 'voice-diary', startTime: iso(-15, 10), domain: '学习', sensitivity: 'normal', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s2', userInterpretation: '那天选了一篇自己真的感兴趣的文献' },
  // === 社团活动 ===
  { id: 'ev-s-club1', type: 'work', title: '读书会 #8：主持《乡土中国》讨论', detail: '12 人到场，3 位新成员', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-30, 19), endTime: iso(-30, 21), domain: '公共贡献', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s3' },
  { id: 'ev-s-club2', type: 'work', title: '读书会 #9：副负责人候选 L 第一次独立策划', detail: '提前 1 周交接选题', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-16, 19), endTime: iso(-16, 21), domain: '公共贡献', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s3' },
  { id: 'ev-s-club3', type: 'work', title: '读书会 #10：副负责人候选 W 第一次主持', detail: '主持节奏偏快，但流程完整', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-2, 19), endTime: iso(-2, 21), domain: '公共贡献', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer', relatedCommitmentId: 'cm-s3' },
  // === 兼职家教 ===
  ...Array.from({ length: 6 }).map((_, i): LifeEvent => ({
    id: `ev-s-tutor-${i}`, type: 'work', title: `家教第 ${i + 1} 次：高二英语语法专题`,
    detail: i === 4 ? '学生反馈有用，主动加了一次' : '按计划完成',
    sourceType: 'calendar', sourceRef: 'system-calendar',
    startTime: iso(-35 + i * 7, 9), endTime: iso(-35 + i * 7, 11),
    domain: '财务', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer',
    relatedCommitmentId: 'cm-s4',
  })),
  // === 室友关系 ===
  { id: 'ev-s-room1', type: 'calendar', title: '室友 4 人聚餐（生日）', sourceType: 'calendar', sourceRef: 'system-calendar', startTime: iso(-20, 18), endTime: iso(-20, 21), domain: '关系', sensitivity: 'normal', confidence: 1, consentId: 'perm-calendar', layer: 'fact', axis: 'outer' },
  { id: 'ev-s-room2', type: 'calendar', title: '室友夜聊（持续到凌晨 1 点）', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-12, 23), domain: '关系', sensitivity: 'sensitive', confidence: 0.85, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '聊了很多关于未来的事，第二天起得晚，但情绪上不后悔' },
  // === 日记（inner） ===
  { id: 'j-s-1', type: 'journal', title: '语音日记：期中考试周后的空虚', detail: '转写 1 分 50 秒', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-25, 22), domain: '学习', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '考完那天突然不知道该干嘛，原来高压下的效率让我有种「我在努力」的安全感，平时没有。' },
  { id: 'j-s-2', type: 'journal', title: '日记：导师约谈后的想法', sourceType: 'user', sourceRef: 'text-diary', startTime: iso(-11, 23), domain: '学习', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '导师说「你不是不自律，是缺少自己设定 deadline 的练习」。当时不太服气，但好像有点对。' },
  { id: 'j-s-3', type: 'journal', title: '语音日记：读书会交接前的紧张', sourceType: 'user', sourceRef: 'voice-diary', startTime: iso(-3, 22), domain: '公共贡献', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '怕 W 主持不好又忍不住插手。但其实她做得不错，是我放手太少。' },
  // === 决策卡（inner） ===
  { id: 'd-s-1', type: 'decision', title: '决策卡：是否接暑期田野调查助理', detail: '选项、预测与理由已记录，30 天后复盘', sourceType: 'user', sourceRef: 'decision-card', startTime: iso(-7, 17), domain: '学习', sensitivity: 'sensitive', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', userInterpretation: '预测：会挤占论文选题时间；理由：田野经验对学术方向有用，且导师推荐。' },
  // === 实验结果事件（inner，主观打卡） ===
  { id: 'o-s-1', type: 'outcome', title: '实验记录：图书馆 25 分钟启动法（第 4 天）', detail: '启动成功，主观阻力 3/10', sourceType: 'user', sourceRef: 'experiment-checkin', startTime: iso(-1, 16), domain: '学习', sensitivity: 'normal', confidence: 1, consentId: 'perm-journal', layer: 'fact', axis: 'inner', relatedCommitmentId: 'cm-s2' },
];

// ---------------- 假设卡 ----------------
export const seedHypotheses_student: Hypothesis[] = [
  {
    id: 'H-s01', version: 2,
    statement: '过去六周，你的高效率时段集中在有外部 deadline 的期中考试周与平时作业截止前夜；外部截止日期可能是你的启动条件，而不是你缺少学习兴趣或自律。',
    supporting: [
      { eventId: 'ev-s-exam1', quote: '期中复习考前 2 天 4 小时连续完成', time: iso(-28, 14), sourceType: 'task_app' },
      { eventId: 'ev-s-exam2', quote: '期中考试 92 分', time: iso(-26, 10), sourceType: 'task_app' },
      { eventId: 'ev-s-daily1', quote: '平时读书报告推迟 3 天提交', time: iso(-34, 20), sourceType: 'task_app' },
      { eventId: 'ev-s-daily2', quote: '研究方法习题推迟 2 天', time: iso(-21, 20), sourceType: 'task_app' },
    ],
    countering: [
      { eventId: 'ev-s-self-study', quote: '周日自主文献阅读 90 分钟无中断（无 deadline）', time: iso(-15, 10), sourceType: 'journal' },
      { eventId: 'ev-s-daily3', quote: '文献综述按时提交（导师约谈次日）', time: iso(-10, 16), sourceType: 'task_app' },
    ],
    dataGaps: ['6 周前的历史作业完成时间未导入', '不同课程的难度差异未标准化'],
    alternatives: ['期中复习的高效率是任务难度集中而非 deadline 效应', '平时作业推迟可能是任务本身不吸引人', '反证 ev-s-self-study 在周日，可能是休息日效应'],
    confidence: 0.58,
    harmNote: '可能被读作「你就是不自律」——本假设不指向人格，只指向启动结构。学生在没有外部 deadline 的领域普遍存在启动困难，这是发展性课题，不是缺陷。',
    suggestedExperimentId: 'exp-s1',
    reviewAt: iso(10),
    status: 'open',
    createdAt: iso(-7),
    history: [
      { at: iso(-14), change: '创建 v1（基于期中周数据）', confidence: 0.48 },
      { at: iso(-7), change: 'v2：加入反证 ev-s-self-study 与 ev-s-daily3，置信度 0.48→0.58，明确反过度概括', confidence: 0.58 },
    ],
  },
  {
    id: 'H-s02', version: 1,
    statement: '你在社团副负责人交接时的「想插手」倾向，可能与对「读书会质量=我」的认同绑定有关；这是身份过渡期的正常张力，不是 W 能力不足。',
    supporting: [
      { eventId: 'ev-s-club2', quote: 'L 第一次独立策划，你提前 1 周交接选题', time: iso(-16, 19), sourceType: 'calendar' },
      { eventId: 'j-s-3', quote: '日记：「怕 W 主持不好又忍不住插手」', time: iso(-3, 22), sourceType: 'journal' },
    ],
    countering: [
      { eventId: 'ev-s-club3', quote: 'W 第一次主持流程完整', time: iso(-2, 19), sourceType: 'calendar' },
    ],
    dataGaps: ['W 与 L 的主观体验无数据', '前几届负责人交接模式无对照'],
    alternatives: ['W 节奏偏快确实是客观问题，不是你的投射', '想插手是出于责任而非身份绑定'],
    confidence: 0.45,
    harmNote: '涉及身份过渡，不做「控制欲强」的人格评判。',
    suggestedExperimentId: 'exp-s2',
    reviewAt: iso(20),
    status: 'open',
    createdAt: iso(-2),
    history: [{ at: iso(-2), change: '创建 v1', confidence: 0.45 }],
  },
];

// ---------------- 实验 ----------------
const mkCheckIns_student = (startOffset: number, n: number, pattern: (i: number) => [boolean, string]): CheckIn[] =>
  Array.from({ length: n }).map((_, i) => {
    const [done, note] = pattern(i);
    return { date: iso(startOffset + i), done, note };
  });

export const seedExperiments_student: Experiment[] = [
  {
    id: 'exp-s1', kind: '微调实验', hypothesisId: 'H-s01',
    question: '在没有外部 deadline 时，「图书馆 + 25 分钟最小剂量」能否替代「宿舍 + 等灵感」启动平时作业？',
    baseline: '过去 4 周平时作业启动率 2/5（推迟提交 3 次）',
    intervention: '未来 7 天，每天下午 16:00-16:25 在图书馆（非宿舍）启动当前作业；写不完即停，不补偿',
    metrics: ['启动率（行为）', '主观阻力评分 1-10（主观）', '完成字数（外部）'],
    confounders: ['课程难度', '前一日睡眠时长', '是否在周末'],
    stopRule: '连续两天主观阻力 >7 或影响社团/家教时暂停',
    sideEffects: '可能挤压晚饭后的休息时段，已在日历预留',
    durationDays: 7, startDate: iso(-4), status: 'active',
    checkIns: mkCheckIns_student(-4, 4, (i) => [
      true,
      ['启动成功，阻力 4/10，350 字', '启动成功，阻力 5/10，420 字', '差点没开始，把 25 分钟改成 15 分钟后启动了，阻力 6/10', '启动成功，阻力 3/10，多写了 20 分钟'][i],
    ]),
  },
  {
    id: 'exp-s2', kind: '结构实验', hypothesisId: 'H-s02',
    question: '下一次读书会由 W 独立主持时，你是否能忍住不在中途插手，且事后不主动「复盘指正」？',
    baseline: '过去 2 次 W/L 主持，你 2 次都在中途补充发言',
    intervention: '未来 1 次读书会，仅作为参与者出席，发言不超过 2 次，且不在活动当天给「改进建议」',
    metrics: ['插手次数（行为）', '主观焦虑评分 1-10（主观）', 'W 自评主持满意度（外部反馈）'],
    confounders: ['话题熟悉度', '到场人数', 'W 当日状态'],
    stopRule: '出现明显冷场或冲突时可以介入，但需事后向 W 说明',
    durationDays: 30, startDate: iso(2), status: 'proposed',
    checkIns: [],
  },
];

// ---------------- 意义方向 ----------------
export const seedDirections_student: MeaningDirection[] = [
  {
    id: 'dir-s1', statement: '用社会学视角理解自己出身的群体', serveWhom: '与我有相似出身的学生',
    contribution: '毕业论文选题、读书会主题策划', costBoundary: '不以牺牲专业基础为代价',
    skillIds: ['sk-s1'], projectIds: ['pj-s1'], evidenceScore: 0.55, trend: 'up',
  },
  {
    id: 'dir-s2', statement: '让读书会不依赖单点存在', serveWhom: '社团成员与下一届负责人',
    contribution: '培养副负责人、文档化流程', costBoundary: '交接期延长不强行截止',
    skillIds: [], projectIds: ['pj-s2'], evidenceScore: 0.42, trend: 'up',
  },
];

// ---------------- 技能 ----------------
export const seedSkills_student: SkillTrack[] = [
  {
    id: 'sk-s1', name: '社会学论文写作',
    targetPerformance: '独立完成 8000 字文献综述，并能让导师准确复述核心论点',
    baseline: '60 分钟限时短文 3 篇，导师评价 2/3 结构清晰',
    rubric: ['选题', '文献检索', '论证结构', '引用规范', '修订'],
    prerequisites: ['文献管理工具', '研究方法基础', '学术语言'],
    stage: '刻意练习', mastery: 0.38, weeklyPlan: '本周：图书馆 25 分钟 × 5（文献综述初稿）+ 与导师 15 分钟对齐 1 次',
    evidences: [
      { date: iso(-28), kind: '作品', note: '期中复习笔记（中国社会学史）' },
      { date: iso(-15), kind: '练习', note: '自主文献阅读 90 分钟，2 篇笔记' },
      { date: iso(-10), kind: '作品', note: '文献综述初稿按时提交' },
      { date: iso(-1), kind: '练习', note: '图书馆 25 分钟启动法第 4 天，420 字' },
    ],
    replanReason: '原计划「每天 90 分钟文献阅读」失败——实验 exp-s1 显示启动条件比时长更紧迫，先解决启动',
  },
  {
    id: 'sk-s2', name: '社团组织与交接',
    targetPerformance: '能独立策划一次 15 人规模的读书讨论，并培养 2 位继任者',
    baseline: '已主持 8 次，但未系统化流程',
    rubric: ['选题', '流程设计', '现场引导', '成员培养', '文档化'],
    prerequisites: ['议题库', '流程模板'],
    stage: '迁移验证', mastery: 0.52, weeklyPlan: '本周：W 主持复盘 + 流程文档整理',
    evidences: [
      { date: iso(-30), kind: '作品', note: '读书会 #8 主持（12 人）' },
      { date: iso(-16), kind: '迁移', note: 'L 第一次独立策划（提前 1 周交接）' },
      { date: iso(-2), kind: '迁移', note: 'W 第一次主持（流程完整）' },
    ],
  },
];

// ---------------- 项目 ----------------
export const seedProjects_student: Project[] = [
  {
    id: 'pj-s1', name: '毕业论文选题与文献综述',
    mission: '为本科毕业论文确定一个能持续 1 年的选题；成功 = 与导师确认 1 个方向 + 10 篇核心文献笔记',
    nonGoals: '不追求创新性理论贡献，不预先写正文',
    nextKeyAction: '本周三 16:00 与导师 15 分钟对齐「城乡流动与身份认同」方向',
    criticalPath: ['方向初选', '导师约谈', '文献检索', '10 篇核心文献笔记', '方向确认'],
    milestones: [
      { title: '方向初选 3 个', due: iso(-10), done: true, acceptance: '每个方向 200 字说明' },
      { title: '导师约谈 1 次', due: iso(-5), done: true, acceptance: '导师书面反馈' },
      { title: '10 篇核心文献笔记', due: iso(20), done: false, acceptance: '每篇 ≥300 字结构化笔记' },
      { title: '方向最终确认', due: iso(40), done: false, acceptance: '导师邮件确认' },
    ],
    risks: [
      { title: '选题被导师多次否定', signal: '连续 2 次约谈无收敛', level: 'mid', mitigation: '每次约谈后整理 3 个候选，不押单方向', reviewAt: iso(14) },
      { title: '文献阅读启动困难', signal: '连续 3 天未启动', level: 'high', mitigation: '启动 exp-s1（图书馆 25 分钟法）', reviewAt: iso(7) },
    ],
    decisionLedger: [
      { date: iso(-7), options: '接暑期田野助理 / 婉拒', decision: '接，但声明周日不可占用', reason: '田野经验对选题有用，用周日保护阅读', reviewAt: iso(60) },
    ],
    meaningLoop: '服务方向 dir-s1；当前代价（每周约 5 小时阅读）在承诺边界内。',
    progress: 0.30, status: 'active',
  },
  {
    id: 'pj-s2', name: '读书会年内交接',
    mission: '培养 2 位副负责人独立主持，使读书会不依赖单点；成功 = 2 位副负责人各独立落地 1 次活动',
    nonGoals: '不做主题内容统一化，保留负责人个人风格',
    nextKeyAction: '本周三晚复盘 W 第一次主持，记录流程改进点',
    criticalPath: ['候选识别', '副负责人候选独立策划', '副负责人候选独立主持', '流程文档化', '正式交接'],
    milestones: [
      { title: '识别 2 位候选', due: iso(-20), done: true, acceptance: '两人均同意' },
      { title: 'L 独立策划 1 次', due: iso(-16), done: true, acceptance: '活动按时落地' },
      { title: 'W 独立主持 1 次', due: iso(-2), done: true, acceptance: '流程完整' },
      { title: '流程文档 v1', due: iso(14), done: false, acceptance: '含选题/引导/复盘 3 个模板' },
      { title: '正式交接', due: iso(90), done: false, acceptance: '2 位副负责人签字确认' },
    ],
    risks: [
      { title: '交接导致质量下降', signal: '到场人数连续 2 次下降', level: 'mid', mitigation: '延长交接期，不强行截止', reviewAt: iso(30) },
    ],
    decisionLedger: [],
    meaningLoop: '服务方向 dir-s2；当前进度 60%，符合承诺 cm-s3。',
    progress: 0.60, status: 'active',
  },
];
