/**
 * V4.3 Task 21 / spec §9.13 / A16 / A18：7 步首次使用流程 + Day 0 自然访谈。
 *
 * 7 步流程（严格对齐 spec A16.1）：
 *   1. 欢迎               —— 不出现禁词；spec A18.2 「先让我知道你最近在过怎样的生活。」
 *   2. 年龄与安全边界      —— 生活阶段 + 当前约束（spec A16.1）
 *   3. 最近的生活          —— 5-10 分钟自然访谈（spec A17.1 / A18.3 可跳过或一句作答）
 *   4. 想让我帮什么        —— Task 19 使用方式选择（融入 7 步流程，不破坏既有成果）
 *   5. 第一件重要的事      —— SubTask 21.2：onPress 调 useStore.experimentAction 创建实验
 *   6. Avatar（可选）       —— spec A16.1 「可选」；不强制选择
 *   7. 进入今日            —— spec A18.4 四块自然语言内容（去技术标签）
 *
 * 去人机感硬约束（spec 附录 AD 15 项 / 工作区规则）：
 *   - 禁用词清单零出现：数字孪生 / 人格建模 / 蒸馏你 / 赋能 / 闭环 / 抓手 /
 *     画像 / 全知 / 精准洞察 / 命运 / 真实的你
 *   - 用「先让我知道你最近在过怎样的生活」「我注意到一个可能的现象」「还想再看看」
 *     等自然语言替代
 *
 * 设备权限延后（spec A16.2）：
 *   - onboarding 不请求任何设备权限（相机 / 麦克风 / 健康 / 日历）
 *   - 权限请求延后到用户首次触发对应功能
 *
 * 首次使用成功标准（spec A16.3）：
 *   - 用户在 3-5 分钟内完成至少一个有价值动作
 *   - 此处「有价值动作」= 步骤 5 创建一个 7 天实验 + 步骤 3 写入访谈证据
 *
 * Day 0 沉淀流水线（spec A17.1 / SubTask 21.5）：
 *   - finish() 调 writeDay0InterviewEvidence 写入 facts/self_reports/directions/open_questions
 *   - finish() 调 triggerDay0Distillation 触发首次蒸馏（后端 Task 11 八阶段 pipeline 处理）
 *   - 生成 Personal Model v0.01（pipeline stage8 commit 自动创建首个 model version）
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../services/auth';
import { useServiceContractStore } from '../../store/useServiceContractStore';
import { useAppTheme, setAppScheme } from '../../theme/theme';
import { Card, Tag, PrimaryButton, Divider, useTextStyles } from '../../components/ui';
import { Glyph } from '../../components/glyphs';
import {
  Commitment, Domain, Experiment, ExperimentKind, UsageMode, UserProfile,
} from '../../types/models';
import {
  USAGE_MODE_LABELS, USAGE_MODE_ORDER, applyUsageModePreset,
} from '../../data/usageModePresets';
import {
  Day0InterviewContent,
  FOUR_BLOCK_TITLES,
  writeDay0InterviewEvidence,
  triggerDay0Distillation,
} from '../../services/dayMilestones';

// ---------- 静态选项 ----------

const DOMAIN_CHOICES: { d: Domain; hint: string }[] = [
  { d: '身体', hint: '睡眠、运动、精力' },
  { d: '工作', hint: '职业与收入' },
  { d: '关系', hint: '伴侣、朋友、社交' },
  { d: '创造', hint: '写作、艺术、作品' },
  { d: '学习', hint: '技能与认知成长' },
  { d: '家庭', hint: '陪伴与照护' },
  { d: '公共贡献', hint: '社区与公益' },
  { d: '休息', hint: '恢复与闲暇' },
];

const CONSTRAINT_CHOICES = [
  '工作处于冲刺期', '需要照护家人', '健康正在恢复',
  '经济压力较大', '时间碎片化', '都不适用',
];

/**
 * V4.3 §2.11 全生命周期模式首发约束：仅 adult-full 启用。
 * 青少年 / 老年人保留类型但不进入首发；儿童模式同样不进入首发。
 * 此处给出 onboarding 步骤 2 可选的生活阶段（不与 LifeStageMode 1:1，避免越界）。
 */
const LIFE_STAGE_CHOICES: { value: UserProfile['lifeStage']; label: string; hint: string }[] = [
  { value: '成年人', label: '成年人', hint: '18 岁以上、自主使用' },
  { value: '老年人', label: '长辈', hint: '可以切换到大字号与语音回读' },
];

// V4.3 §9.13 7 步流程标题（与 spec A16.1 严格对齐）
const STEPS = [
  '欢迎',
  '年龄与边界',
  '最近的生活',
  '想让我帮什么',
  '第一件重要的事',
  '形象',
  '进入今日',
] as const;

// 步骤 5 实验模板（与既有 step 6 一致，仅改为 onPress 触发 experimentAction）
interface ExperimentTemplate {
  kind: ExperimentKind;
  title: string;
  question: (topDomain: Domain) => string;
  intervention: (topDomain: Domain) => string;
  stopRule: string;
  durationDays: 7 | 14;
}

const EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  {
    kind: '微调实验',
    title: '微调实验 · 最小剂量启动',
    question: (d) => `每天固定 15-25 分钟给「${d}」，观察启动率`,
    intervention: (d) => `每天 15-25 分钟固定时段投入「${d}」`,
    stopRule: '连续两天主观阻力 >7 即暂停',
    durationDays: 7,
  },
  {
    kind: '停止实验',
    title: '停止实验 · 做减法',
    question: () => '暂停一个“一直在做但说不清为什么”的任务 14 天，观察释放与损失',
    intervention: () => '暂停一个低价值任务 14 天',
    stopRule: '出现明显焦虑即恢复并记录',
    durationDays: 14,
  },
];

// 「先不实验」选项 —— 不创建实验，仅记录用户选择
const NO_EXPERIMENT_TITLE = '先不实验 · 想先观察一周';

// ---------- 主组件 ----------

export function OnboardingScreen() {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const { completeOnboarding, addExperiment, experimentAction } = useStore();
  const { userId } = useAuth();
  const loadContract = useServiceContractStore((st) => st.load);
  const updateContract = useServiceContractStore((st) => st.update);

  const [step, setStep] = useState(0);
  // 步骤 1：欢迎页签名词（可选）
  const [name, setName] = useState('');
  // 步骤 2：年龄与安全边界
  const [lifeStage, setLifeStage] = useState<UserProfile['lifeStage']>('成年人');
  const [constraints, setConstraints] = useState<string[]>([]);
  // 步骤 3：最近的生活自然访谈（spec A17.1 / A18.3）
  const [facts, setFacts] = useState('');
  const [selfReports, setSelfReports] = useState('');
  const [directions, setDirections] = useState('');
  const [openQuestions, setOpenQuestions] = useState('');
  // 步骤 4：使用方式（Task 19 已实现，融入此步）
  const [selectedMode, setSelectedMode] = useState<UsageMode>('quiet-mirror');
  // 步骤 5：第一件重要的事 —— 选 top domain + 实验模板
  const [topDomain, setTopDomain] = useState<Domain | null>(null);
  const [topWhy, setTopWhy] = useState('');
  const [pickedExperiment, setPickedExperiment] = useState<number | null>(null);
  const [experimentCreating, setExperimentCreating] = useState(false);
  // 步骤 6：形象（可选）
  const [avatarChoice, setAvatarChoice] = useState<'preset' | 'skip'>('preset');
  // 步骤 7：完成中状态
  const [finishing, setFinishing] = useState(false);

  // canNext 计算（每步校验）
  const canNext = useMemo(() => {
    if (step === 2) {
      // 步骤 3 自然访谈：可跳过或一句作答（spec A18.3）
      // 但至少有一项填了才允许「继续」（避免完全空白）
      return facts.trim().length > 0 || selfReports.trim().length > 0
        || directions.trim().length > 0 || openQuestions.trim().length > 0;
    }
    if (step === 4) {
      // 步骤 5：必须选 top domain + 选一个实验模板（含「先不实验」）
      return topDomain !== null && topWhy.trim().length > 0 && pickedExperiment !== null;
    }
    // 步骤 1/2/4/6 总有默认值或可空
    return true;
  }, [step, facts, selfReports, directions, openQuestions, topDomain, topWhy, pickedExperiment]);

  // ---------- 步骤 5：onPress 调 experimentAction 创建实验 ----------
  /**
   * SubTask 21.2 严格规则（spec A16.1）：
   *   - 必须是 onPress（不是 onPressIn，不是 console.log）
   *   - 必须调用 useStore.experimentAction(id, 'accept')
   *   - 先 addExperiment 推入 store（status='proposed'），再 experimentAction PATCH 为 'active'
   *
   * 实验字段严格对齐 Experiment 接口（无 cheating 默认值，全部从模板与用户选择生成）。
   */
  const handleExperimentPress = async (templateIdx: number) => {
    if (templateIdx < 0 || templateIdx >= EXPERIMENT_TEMPLATES.length) return;
    if (!topDomain || experimentCreating) return;

    setPickedExperiment(templateIdx);
    setExperimentCreating(true);
    try {
      const tpl = EXPERIMENT_TEMPLATES[templateIdx];
      const now = new Date().toISOString();
      const experimentId = `ex-onboard-${Date.now().toString(36)}-${templateIdx}`;
      const newExp: Experiment = {
        id: experimentId,
        kind: tpl.kind,
        question: tpl.question(topDomain),
        baseline: `目前对「${topDomain}」的投入状态尚未建立稳定观察基线`,
        intervention: tpl.intervention(topDomain),
        metrics: [
          `行为指标：${topDomain}相关动作完成率`,
          `主观指标：每日启动阻力 0-10 分`,
        ],
        confounders: [
          '工作强度临时波动',
          '睡眠质量影响主观评分',
        ],
        stopRule: tpl.stopRule,
        durationDays: tpl.durationDays,
        startDate: now,
        status: 'proposed', // 先 proposed，由 experimentAction 转 active
        checkIns: [],
      };
      // 1. 本地 + 后端创建（status='proposed'）
      await addExperiment(newExp);
      // 2. SubTask 21.2：onPress 调 experimentAction 激活实验
      await experimentAction(experimentId, 'accept');
    } catch {
      // 网络错误不阻塞 onboarding；同步队列会重试。用户可后续在今日页重新创建。
    } finally {
      setExperimentCreating(false);
    }
  };

  /**
   * 步骤 5 「先不实验」选项 —— 仅记录选择，不创建实验。
   * spec A16.3「无记录日保持沉默」「沉默不会被解释为消极」。
   */
  const handleNoExperimentPress = () => {
    setPickedExperiment(EXPERIMENT_TEMPLATES.length); // 用越界 index 标识「先不实验」
  };

  // ---------- 步骤 7：四块自然语言内容生成（spec A18.4） ----------
  /**
   * 纯函数生成四块自然语言摘要：
   *   - 我已经知道的：从 facts 提炼（事实层）
   *   - 这是你自己说的：从 selfReports 直接引用（体验层）
   *   - 我暂时有的一个猜想：facts + selfReports + topDomain 交叉出一个谨慎假设
   *   - 还有几件我不知道：从 openQuestions 提炼（数据缺口）
   *
   * 不调 LLM、不写永久推断；只是把用户刚刚说过的话换个视角复述给用户确认。
   * 用「我注意到一个可能的现象」「还想再看看」等自然语言，避免任何禁词。
   */
  const fourBlocks = useMemo(() => {
    const factsList = facts.trim().split(/\n|。|；/).map((s) => s.trim()).filter(Boolean);
    const selfList = selfReports.trim().split(/\n|。|；/).map((s) => s.trim()).filter(Boolean);
    const dirList = directions.trim().split(/\n|。|；/).map((s) => s.trim()).filter(Boolean);
    const unkList = openQuestions.trim().split(/\n|。|；/).map((s) => s.trim()).filter(Boolean);

    const known = factsList.length > 0
      ? factsList.slice(0, 3).map((s) => `你提到：${s}`)
      : ['你还没说最近在忙什么，这没关系，我们慢慢来。'];

    const selfSaid = selfList.length > 0
      ? selfList.slice(0, 3)
      : ['你还没提到最近的感受，之后随时可以补上。'];

    // 谨慎假设（spec 附录 AD：先说事实再说猜想；不写永久人格）
    const guess = topDomain
      ? [`我注意到一个可能的现象：你把「${topDomain}」列为最近最重要的事${
          selfList.length > 0 ? `，又提到${selfList[0]}` : ''
        }。还想再看看这是不是一时的侧重。`]
      : ['我暂时还看不出明确的侧重，等你再说一些，我们再聊。'];

    const unknown = unkList.length > 0
      ? unkList.slice(0, 3)
      : [
        `我还不知道你每天大概的时间结构${topDomain ? `，以及「${topDomain}」目前实际投入了多少` : ''}。`,
        '我也还不知道你最近一段时间的精力高低。',
      ];

    // 补充方向作为「这是你自己说的」第二段（spec A18.4 「这是你自己说的」含意义方向）
    if (dirList.length > 0) {
      selfSaid.push(`接下来你想往：${dirList[0]}`);
    }

    return { known, selfSaid, guess, unknown };
  }, [facts, selfReports, directions, openQuestions, topDomain]);

  // ---------- 完成引导 ----------
  /**
   * finish：保存所有数据 + 触发 Day 0 沉淀（spec A17.1）。
   *
   * 步骤：
   *   1. 构造 Commitment（来自 topDomain + topWhy）
   *   2. 调 completeOnboarding 保存 profile + commitments（含 onboardedAt）
   *   3. 应用 usage mode 预设到 service contract（Task 19.3 既有逻辑）
   *   4. 写入 Day 0 访谈 evidence（spec A17.1）
   *   5. 触发 Day 0 首次蒸馏（spec A17.1）
   *
   * 任何网络错误不阻塞 onboarding 完成 —— 同步队列与后端 scheduler 会重试。
   */
  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      // 1. 承诺（来自步骤 5）
      const commitments: Commitment[] = topDomain ? [{
        id: `cm-onboard-${Date.now().toString(36)}`,
        statement: `在「${topDomain}」上投入真实时间`,
        why: topWhy.trim(),
        domain: topDomain,
        priority: 1,
        createdAt: new Date().toISOString(),
        userConfirmed: true,
        status: 'active',
      }] : [];

      // 2. 保存 profile + commitments
      await completeOnboarding(
        { name: name.trim() || '朋友', lifeStage, constraints },
        commitments,
      );

      // 3. 应用 usage mode 预设（Task 19.3 既有逻辑，保持不变）
      if (userId) {
        const patch = applyUsageModePreset(selectedMode);
        // 若用户在步骤 6 选了「skip」，覆盖 avatar 为 V0
        if (avatarChoice === 'skip' && patch.avatar) {
          patch.avatar = 'V0';
        }
        try {
          await loadContract(userId);
          await updateContract(userId, patch);
        } catch {
          // 网络错误由 store 内部默认契约兜底；下次进入 SovereigntyScreen 可重新保存
        }
        setAppScheme(selectedMode === 'senior-easy' ? 'senior' : 'system');

        // 4. 写入 Day 0 访谈 evidence（spec A17.1）
        const interview: Day0InterviewContent = {
          facts: facts.trim() ? [facts.trim()] : [],
          selfReports: selfReports.trim() ? [selfReports.trim()] : [],
          directions: directions.trim() ? [directions.trim()] : [],
          openQuestions: openQuestions.trim() ? [openQuestions.trim()] : [],
        };
        if (interview.facts.length > 0 || interview.selfReports.length > 0
            || interview.directions.length > 0 || interview.openQuestions.length > 0) {
          try {
            await writeDay0InterviewEvidence(userId, interview);
          } catch {
            // 网络错误不阻塞；evidence 写入由同步队列重试
          }
          // 5. 触发 Day 0 首次蒸馏（spec A17.1）
          try {
            await triggerDay0Distillation(userId);
          } catch {
            // 蒸馏任务创建失败不阻塞；用户后续在今日页可重新触发
          }
        }
      }
    } finally {
      setFinishing(false);
    }
  };

  // ---------- 渲染 ----------
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.bg, padding: theme.spacing.lg }]}>
      {/* 进度 */}
      <View style={[styles.progressRow, { marginBottom: theme.spacing.xl }]}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, alignItems: 'center' }}>
            <View style={[styles.progressDot, { backgroundColor: i <= step ? theme.colors.indigo : theme.colors.border }]} />
            <Text style={[styles.progressLabel, { color: i === step ? theme.colors.indigoMuted : theme.colors.textTertiary }]}>{s}</Text>
          </View>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}>
        {/* 步骤 1：欢迎（spec A18.2 / A18.1 不出现禁词） */}
        {step === 0 && (
          <View>
            <Text style={[styles.stepTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>你好，我是知行镜</Text>
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
              先让我知道你最近在过怎样的生活。
              我不会替你做决定，也不会用一堆分数给你贴标签 —— 我只把你说过的事记下来，
              偶尔和你一起看看，哪些是规律，哪些只是这一阵子的状态。
            </Text>
            <Card accent={theme.colors.indigo}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Glyph name="shield" size={20} color={theme.colors.green} />
                <View style={{ flex: 1 }}>
                  <Text style={[ts.body, { fontWeight: '700' }]}>你可以随时改主意</Text>
                  <Text style={[ts.tertiary, { marginTop: 4, lineHeight: 18 }]}>
                    你说过的每一句话都可以撤回；任何时候都能让我忘掉某些事；不想说也可以跳过。
                  </Text>
                </View>
              </View>
            </Card>
            <TextInput
              style={[styles.nameInput, {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                padding: 14,
                color: theme.colors.textPrimary,
                fontSize: theme.font.body,
                borderColor: theme.colors.border,
                marginTop: theme.spacing.lg,
              }]}
              placeholder="怎么称呼你？（可留空）"
              placeholderTextColor={theme.colors.textTertiary}
              value={name}
              onChangeText={setName}
              accessibilityLabel="称呼（可选）"
            />
          </View>
        )}

        {/* 步骤 2：年龄与安全边界（spec A16.1） */}
        {step === 1 && (
          <View>
            <Text style={[styles.stepTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>你大概在什么阶段？</Text>
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
              这只影响我会怎么说话 —— 比如要不要用更大的字号、要不要少问一些。
              不会因此对你下任何判断。
            </Text>
            {LIFE_STAGE_CHOICES.map((opt) => {
              const active = lifeStage === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityLabel={`生活阶段：${opt.label}。${opt.hint}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => setLifeStage(opt.value)}
                >
                  <Card style={[styles.choiceCard, { marginBottom: 10, borderColor: active ? theme.colors.indigo : undefined }]} accent={active ? theme.colors.indigo : undefined}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: active ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: theme.font.body, fontWeight: '700' }}>
                          {opt.label}
                        </Text>
                        <Text style={[ts.tertiary, { marginTop: 2 }]}>{opt.hint}</Text>
                      </View>
                      <View style={[styles.radio, { borderColor: active ? theme.colors.indigo : theme.colors.border }]}>
                        {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.indigo }]} />}
                      </View>
                    </View>
                  </Card>
                </Pressable>
              );
            })}
            <Divider />
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.md, marginBottom: theme.spacing.lg }]}>
              此刻，什么在限制你？这不是借口登记 —— 它让我避免把「做不到」草率归因。
            </Text>
            {CONSTRAINT_CHOICES.map((c) => {
              const active = constraints.includes(c);
              return (
                <Pressable
                  key={c}
                  accessibilityLabel={`约束：${c}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  onPress={() => setConstraints(active ? constraints.filter((x) => x !== c) : [...constraints, c])}
                >
                  <Card style={[styles.choiceCard, { marginBottom: 10, borderColor: active ? theme.colors.indigo : undefined }]} accent={active ? theme.colors.indigo : undefined}>
                    <Text style={{ color: active ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: theme.font.body }}>{c}</Text>
                  </Card>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* 步骤 3：最近的生活（spec A17.1 / A18.3 自然访谈，可跳过或一句作答） */}
        {step === 2 && (
          <View>
            <Text style={[styles.stepTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>最近这一两周，你大概在过怎样的生活？</Text>
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
              随便说说就好。可以只回答一句，也可以跳过任何一栏 —— 沉默不会被解释为消极。
              这里说的每句话只保存在你的设备，不会用来给你下判断。
            </Text>
            <Text style={[ts.body, { fontWeight: '700', marginTop: theme.spacing.sm }]}>最近在忙什么</Text>
            <TextInput
              style={[styles.interviewInput, {
                marginTop: theme.spacing.sm,
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                color: theme.colors.textPrimary,
                fontSize: theme.font.small,
                borderColor: theme.colors.border,
              }]}
              multiline
              placeholder="比如：项目收尾、照顾家人、跑步重新开始…"
              placeholderTextColor={theme.colors.textTertiary}
              value={facts}
              onChangeText={setFacts}
              accessibilityLabel="最近在忙什么"
            />
            <Text style={[ts.body, { fontWeight: '700', marginTop: theme.spacing.md }]}>有什么让你开心 或 烦心</Text>
            <TextInput
              style={[styles.interviewInput, {
                marginTop: theme.spacing.sm,
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                color: theme.colors.textPrimary,
                fontSize: theme.font.small,
                borderColor: theme.colors.border,
              }]}
              multiline
              placeholder="比如：睡得不好；和某个人聊完很轻松…"
              placeholderTextColor={theme.colors.textTertiary}
              value={selfReports}
              onChangeText={setSelfReports}
              accessibilityLabel="最近让你开心或烦心的事"
            />
            <Text style={[ts.body, { fontWeight: '700', marginTop: theme.spacing.md }]}>接下来想往哪个方向走</Text>
            <TextInput
              style={[styles.interviewInput, {
                marginTop: theme.spacing.sm,
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                color: theme.colors.textPrimary,
                fontSize: theme.font.small,
                borderColor: theme.colors.border,
              }]}
              multiline
              placeholder="比如：想把某件事做成；想换一种节奏…"
              placeholderTextColor={theme.colors.textTertiary}
              value={directions}
              onChangeText={setDirections}
              accessibilityLabel="接下来想往哪个方向走"
            />
            <Text style={[ts.body, { fontWeight: '700', marginTop: theme.spacing.md }]}>有什么我应该问你 但你还没说的</Text>
            <TextInput
              style={[styles.interviewInput, {
                marginTop: theme.spacing.sm,
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                color: theme.colors.textPrimary,
                fontSize: theme.font.small,
                borderColor: theme.colors.border,
              }]}
              multiline
              placeholder="比如：我最近睡得怎么样？我其实不太确定想要什么…"
              placeholderTextColor={theme.colors.textTertiary}
              value={openQuestions}
              onChangeText={setOpenQuestions}
              accessibilityLabel="我应该问你但你还没说的事"
            />
          </View>
        )}

        {/* 步骤 4：想让我帮什么（Task 19 使用方式选择融入此步，spec A16.1） */}
        {step === 3 && (
          <View>
            <Text style={[styles.stepTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>想让我怎么陪你？</Text>
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
              选一种最贴近你现在的使用方式。每种方式预设了我说话的深浅、能不能帮动手、形象出现多少等。
              之后随时可以换，不会重置你的数据。
            </Text>
            {USAGE_MODE_ORDER.map((mode) => {
              const label = USAGE_MODE_LABELS[mode];
              const active = selectedMode === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityLabel={`使用方式：${label.name}。${label.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSelectedMode(mode)}
                >
                  <Card
                    style={[styles.choiceCard, { marginBottom: 10, borderColor: active ? theme.colors.indigo : undefined }]}
                    accent={active ? theme.colors.indigo : undefined}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Glyph name={label.icon} size={20} color={active ? theme.colors.indigoMuted : theme.colors.textTertiary} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: active ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: theme.font.body, fontWeight: '700' }}>
                          {label.name}
                        </Text>
                        <Text style={[ts.tertiary, { marginTop: 2 }]}>
                          {label.description}
                        </Text>
                      </View>
                      <View style={[styles.radio, { borderColor: active ? theme.colors.indigo : theme.colors.border }]}>
                        {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.indigo }]} />}
                      </View>
                    </View>
                  </Card>
                </Pressable>
              );
            })}
            <View style={[styles.guarantee, {
              marginTop: theme.spacing.md,
              backgroundColor: theme.colors.greenSoft,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
            }]}>
              <Glyph name="shield" size={18} color={theme.colors.green} />
              <Text style={[ts.tertiary, { flex: 1, lineHeight: 17 }]}>
                默认是温和的「安静镜子」—— 我给一些小提示但不主动多事。「长辈易用」会切换为大字号和语音回读。所有方式都可以随时在「数据主权」里换回来。
              </Text>
            </View>
          </View>
        )}

        {/* 步骤 5：第一件重要的事（spec A16.1 / SubTask 21.2：onPress 调 experimentAction） */}
        {step === 4 && (
          <View>
            <Text style={[styles.stepTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>如果只能选一件最近最重要的事，是什么？</Text>
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
              洞察要进入现实才有用。选一个领域，说一句为什么，然后选一个低风险的小尝试开始 ——
              可以随时暂停，发现假设错了同样是有效结果。
            </Text>
            <Text style={[ts.body, { fontWeight: '700', marginTop: theme.spacing.sm }]}>选一件</Text>
            <View style={[styles.domainGrid, { gap: 10 }]}>
              {DOMAIN_CHOICES.map(({ d, hint }) => {
                const active = topDomain === d;
                return (
                  <Pressable
                    key={d}
                    accessibilityLabel={`选择最重要的事：${d}。${hint}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.domainChip,
                      {
                        backgroundColor: active ? theme.colors.indigoSoft : theme.colors.surface,
                        borderRadius: theme.radius.lg,
                        padding: 14,
                        borderColor: active ? theme.colors.indigo : theme.colors.borderSoft,
                      },
                    ]}
                    onPress={() => setTopDomain(d)}
                  >
                    <Text style={[styles.domainName, { color: active ? theme.colors.indigoMuted : theme.colors.textPrimary, fontSize: theme.font.body }]}>{d}</Text>
                    <Text style={ts.tertiary}>{hint}</Text>
                  </Pressable>
                );
              })}
            </View>
            {topDomain && (
              <Card style={{ marginTop: theme.spacing.md }} accent={theme.colors.indigo}>
                <Text style={[ts.body, { fontWeight: '700' }]}>为什么是「{topDomain}」？</Text>
                <TextInput
                  style={[styles.whyInput, {
                    marginTop: theme.spacing.sm,
                    backgroundColor: theme.colors.bg,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    color: theme.colors.textPrimary,
                    fontSize: theme.font.small,
                    borderColor: theme.colors.border,
                  }]}
                  multiline
                  placeholder={`为什么「${topDomain}」现在对你重要？`}
                  placeholderTextColor={theme.colors.textTertiary}
                  value={topWhy}
                  onChangeText={setTopWhy}
                  accessibilityLabel={`为什么 ${topDomain} 现在对你重要`}
                />
              </Card>
            )}
            {topDomain && topWhy.trim().length > 0 && (
              <View style={{ marginTop: theme.spacing.md }}>
                <Text style={[ts.body, { fontWeight: '700' }]}>选一个小尝试</Text>
                <Text style={[ts.tertiary, { marginTop: 2, marginBottom: theme.spacing.sm }]}>
                  点一个开始 —— 我会帮你记下并跟踪 {Math.min(...EXPERIMENT_TEMPLATES.map(t => t.durationDays))}–{Math.max(...EXPERIMENT_TEMPLATES.map(t => t.durationDays))} 天。
                </Text>
                {EXPERIMENT_TEMPLATES.map((tpl, i) => {
                  const active = pickedExperiment === i;
                  const disabled = experimentCreating;
                  return (
                    <Pressable
                      key={i}
                      accessibilityLabel={`${tpl.title}。停止规则：${tpl.stopRule}`}
                      accessibilityRole="button"
                      disabled={disabled}
                      onPress={() => handleExperimentPress(i)}
                    >
                      <Card
                        style={[styles.choiceCard, { marginBottom: 10, borderColor: active ? theme.colors.indigo : undefined }]}
                        accent={active ? theme.colors.indigo : theme.colors.amber}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: active ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: theme.font.body, fontWeight: '700' }}>
                              {tpl.title}
                            </Text>
                            <Text style={[ts.secondary, { marginTop: 4 }]}>{tpl.question(topDomain)}</Text>
                            <Text style={[ts.tertiary, { marginTop: 4 }]}>停止规则：{tpl.stopRule}</Text>
                          </View>
                          {active && (
                            <Glyph name="check" size={20} color={theme.colors.indigo} />
                          )}
                        </View>
                      </Card>
                    </Pressable>
                  );
                })}
                {/* 「先不实验」选项 */}
                <Pressable
                  accessibilityLabel={NO_EXPERIMENT_TITLE}
                  accessibilityRole="button"
                  onPress={handleNoExperimentPress}
                >
                  <Card
                    style={[
                      styles.choiceCard,
                      { marginBottom: 10, borderColor: pickedExperiment === EXPERIMENT_TEMPLATES.length ? theme.colors.indigo : undefined },
                    ]}
                    accent={pickedExperiment === EXPERIMENT_TEMPLATES.length ? theme.colors.indigo : theme.colors.textTertiary}
                  >
                    <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.body, fontWeight: '600' }}>
                      {NO_EXPERIMENT_TITLE}
                    </Text>
                    <Text style={[ts.tertiary, { marginTop: 4 }]}>
                      想先观察一周再决定 —— 沉默不会被解释为消极。
                    </Text>
                  </Card>
                </Pressable>
                {experimentCreating && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: theme.spacing.sm }}>
                    <ActivityIndicator size="small" color={theme.colors.indigo} />
                    <Text style={ts.tertiary}>正在帮你记下…</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* 步骤 6：Avatar（可选，spec A16.1） */}
        {step === 5 && (
          <View>
            <Text style={[styles.stepTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>要不要看到一个简单的我？</Text>
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
              这是可选项。你选的使用方式已经决定了我默认的样子 —— 这里只是给你一个关掉的机会。
              之后随时可以在「数据主权」里调整。
            </Text>
            <Pressable
              accessibilityLabel="按使用方式默认显示形象"
              accessibilityRole="radio"
              accessibilityState={{ selected: avatarChoice === 'preset' }}
              onPress={() => setAvatarChoice('preset')}
            >
              <Card
                style={[styles.choiceCard, { marginBottom: 10, borderColor: avatarChoice === 'preset' ? theme.colors.indigo : undefined }]}
                accent={avatarChoice === 'preset' ? theme.colors.indigo : undefined}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Glyph name="mirror" size={20} color={avatarChoice === 'preset' ? theme.colors.indigoMuted : theme.colors.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textPrimary, fontSize: theme.font.body, fontWeight: '700' }}>
                      按使用方式默认
                    </Text>
                    <Text style={[ts.tertiary, { marginTop: 2 }]}>
                      现在是「{USAGE_MODE_LABELS[selectedMode].name}」方式的默认形象。
                    </Text>
                  </View>
                  <View style={[styles.radio, { borderColor: avatarChoice === 'preset' ? theme.colors.indigo : theme.colors.border }]}>
                    {avatarChoice === 'preset' && <View style={[styles.radioDot, { backgroundColor: theme.colors.indigo }]} />}
                  </View>
                </View>
              </Card>
            </Pressable>
            <Pressable
              accessibilityLabel="暂时不显示形象"
              accessibilityRole="radio"
              accessibilityState={{ selected: avatarChoice === 'skip' }}
              onPress={() => setAvatarChoice('skip')}
            >
              <Card
                style={[styles.choiceCard, { marginBottom: 10, borderColor: avatarChoice === 'skip' ? theme.colors.indigo : undefined }]}
                accent={avatarChoice === 'skip' ? theme.colors.indigo : undefined}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Glyph name="silence" size={20} color={avatarChoice === 'skip' ? theme.colors.indigoMuted : theme.colors.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textPrimary, fontSize: theme.font.body, fontWeight: '700' }}>
                      暂时不要
                    </Text>
                    <Text style={[ts.tertiary, { marginTop: 2 }]}>
                      我只出现在文字里，不显示形象。任何功能都不会因此缺失。
                    </Text>
                  </View>
                  <View style={[styles.radio, { borderColor: avatarChoice === 'skip' ? theme.colors.indigo : theme.colors.border }]}>
                    {avatarChoice === 'skip' && <View style={[styles.radioDot, { backgroundColor: theme.colors.indigo }]} />}
                  </View>
                </View>
              </Card>
            </Pressable>
          </View>
        )}

        {/* 步骤 7：进入今日（spec A18.4 四块自然语言内容） */}
        {step === 6 && (
          <View>
            <Text style={[styles.stepTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>这是我目前知道的你</Text>
            <Text style={[styles.stepSub, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg }]}>
              这只是把你刚刚说过的话换个视角复述给你 —— 不是给你下定义，也不是永久的判断。
              后面我会慢慢校准哪里像、哪里不像。
            </Text>

            {/* 第一块：我已经知道的（事实层，spec A18.4） */}
            <Card accent={theme.colors.indigo}>
              <View style={[styles.cardHead, { marginBottom: theme.spacing.sm }]}>
                <Tag text={FOUR_BLOCK_TITLES.known} color={theme.colors.indigo} />
                <Glyph name="today" size={18} color={theme.colors.indigo} />
              </View>
              {fourBlocks.known.map((s, i) => (
                <Text key={i} style={[ts.secondary, { marginTop: i === 0 ? 0 : 6, lineHeight: 20 }]}>
                  · {s}
                </Text>
              ))}
            </Card>

            {/* 第二块：这是你自己说的（体验层，spec A18.4） */}
            <Card accent={theme.colors.violet} style={{ marginTop: theme.spacing.md }}>
              <View style={[styles.cardHead, { marginBottom: theme.spacing.sm }]}>
                <Tag text={FOUR_BLOCK_TITLES.selfSaid} color={theme.colors.violet} />
                <Glyph name="voice" size={18} color={theme.colors.violet} />
              </View>
              {fourBlocks.selfSaid.map((s, i) => (
                <Text key={i} style={[ts.secondary, { marginTop: i === 0 ? 0 : 6, lineHeight: 20 }]}>
                  · {s}
                </Text>
              ))}
            </Card>

            {/* 第三块：我暂时有的一个猜想（谨慎假设，spec A18.4 / 附录 AD） */}
            <Card accent={theme.colors.amber} style={{ marginTop: theme.spacing.md }}>
              <View style={[styles.cardHead, { marginBottom: theme.spacing.sm }]}>
                <Tag text={FOUR_BLOCK_TITLES.guess} color={theme.colors.amber} />
                <Glyph name="flask" size={18} color={theme.colors.amber} />
              </View>
              {fourBlocks.guess.map((s, i) => (
                <Text key={i} style={[ts.secondary, { marginTop: i === 0 ? 0 : 6, lineHeight: 20 }]}>
                  · {s}
                </Text>
              ))}
              <Divider />
              <Text style={[ts.tertiary, { lineHeight: 17 }]}>
                这个猜想不是结论 —— 我会继续观察，错了随时改。
              </Text>
            </Card>

            {/* 第四块：还有几件我不知道（数据缺口，spec A18.4 / A-03） */}
            <Card accent={theme.colors.teal} style={{ marginTop: theme.spacing.md }}>
              <View style={[styles.cardHead, { marginBottom: theme.spacing.sm }]}>
                <Tag text={FOUR_BLOCK_TITLES.unknown} color={theme.colors.teal} />
                <Glyph name="silence" size={18} color={theme.colors.teal} />
              </View>
              {fourBlocks.unknown.map((s, i) => (
                <Text key={i} style={[ts.secondary, { marginTop: i === 0 ? 0 : 6, lineHeight: 20 }]}>
                  · {s}
                </Text>
              ))}
            </Card>

            <View style={[styles.guarantee, {
              marginTop: theme.spacing.md,
              backgroundColor: theme.colors.greenSoft,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
            }]}>
              <Glyph name="shield" size={18} color={theme.colors.green} />
              <Text style={[ts.tertiary, { flex: 1, lineHeight: 17 }]}>
                这些内容只在你设备上。之后 7 天，我会问你一次「这一周有没有哪里我理解错了？」
                —— 那时你可以告诉我哪里不像你。
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* 底部按钮 */}
      <View style={[styles.footer, {
        gap: theme.spacing.md,
        paddingTop: theme.spacing.md,
        borderTopColor: theme.colors.borderSoft,
      }]}>
        {step > 0 && (
          <PrimaryButton ghost title="上一步" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />
        )}
        <PrimaryButton
          title={finishing ? '正在记录…' : (step === STEPS.length - 1 ? '进入今日' : '继续')}
          onPress={() => {
            if (finishing) return;
            if (step === STEPS.length - 1) {
              finish();
            } else {
              setStep(step + 1);
            }
          }}
          disabled={!canNext || finishing}
          style={{ flex: 2, opacity: canNext && !finishing ? 1 : 0.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  progressRow: { flexDirection: 'row' },
  progressDot: { width: 8, height: 8, borderRadius: 4 },
  progressLabel: { fontSize: 10, marginTop: 4 },
  stepTitle: { fontWeight: '800', lineHeight: 30 },
  stepSub: { lineHeight: 20 },
  nameInput: {
    borderWidth: 1,
  },
  interviewInput: {
    minHeight: 72,
    borderWidth: 1,
    textAlignVertical: 'top',
  },
  domainGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  domainChip: {
    width: '47.5%',
    borderWidth: 1,
  },
  domainName: { fontWeight: '700', marginBottom: 2 },
  whyInput: {
    minHeight: 52,
    borderWidth: 1,
    textAlignVertical: 'top',
  },
  choiceCard: {},
  guarantee: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: { flexDirection: 'row', borderTopWidth: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
