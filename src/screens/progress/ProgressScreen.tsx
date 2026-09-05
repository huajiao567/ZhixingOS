import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Switch, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../../store/useStore';
import { useDistillationStore } from '../../store/useDistillationStore';
import { useAuth } from '../../services/auth';
import { api } from '../../services/api';
import { useAppTheme } from '../../theme/theme';
import { Card, Tag, Bar, PrimaryButton, Divider, useTextStyles } from '../../components/ui';
import { AmbientBackground } from '../../components/AmbientBackground';
import { Glyph } from '../../components/glyphs';
import { analyzeTaskGraph, type TaskGraphReport, type NodeState } from '../../services/taskGraph';
import { Commitment, Domain, PersonalSkill, Project } from '../../types/models';

type Tab = 'commitments' | 'experiments' | 'projects' | 'skills' | 'directions';

const DOMAIN_OPTIONS: Domain[] = ['身体', '工作', '关系', '创造', '学习', '家庭', '公共贡献', '财务', '休息'];

export function ProgressScreen() {
  const theme = useAppTheme();
  const styles = useProgressStyles();
  const ts = useTextStyles();
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('commitments');
  const s = useStore();
  const report = useMemo(() => analyzeTaskGraph(s.commitments, s.projects), [s.commitments, s.projects]);

  return (
    <View style={styles.scroll}>
      <AmbientBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="返回主页"
            style={({ pressed }) => [styles.backBtn, { backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent' }]}
          >
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
          <Text style={styles.pageTitle}>进程</Text>
        </View>
        <Text style={styles.pageSub}>从意义到能力、项目与实验 —— 每一步都要有现实证据</Text>

        <MyMethodsSection />

        <View style={styles.tabRow}>
          {([['commitments', '承诺'], ['experiments', '实验'], ['projects', '项目'], ['skills', '技能'], ['directions', '意义方向']] as [Tab, string][]).map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setTab(k)}
              style={({ pressed }) => [
                styles.tab,
                tab === k && { backgroundColor: theme.colors.primarySoft },
                { opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}
            >
              <Text style={[styles.tabText, { color: tab === k ? theme.colors.primary : theme.colors.textSecondary }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'commitments' && <CommitmentsTab report={report} />}
        {tab === 'experiments' && <ExperimentsTab />}
        {tab === 'projects' && <ProjectsTab report={report} />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'directions' && <DirectionsTab />}

        <View style={{ height: theme.spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

function CommitmentsTab({ report }: { report: TaskGraphReport }) {
  const theme = useAppTheme();
  const styles = useProgressStyles();
  const ts = useTextStyles();
  const { commitments, addCommitment } = useStore();
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState('');
  const [domain, setDomain] = useState<Domain>('工作');
  const [deps, setDeps] = useState<string[]>([]);

  const submit = () => {
    const text = statement.trim();
    if (!text) return;
    const c: Commitment = {
      id: `cm-${Date.now()}`,
      statement: text,
      why: '',
      domain,
      priority: commitments.length + 1,
      createdAt: new Date().toISOString(),
      costNote: '',
      userConfirmed: true,
      status: 'active',
      dependsOn: deps.length ? deps : undefined,
    };
    addCommitment(c);
    setStatement('');
    setDeps([]);
    setDomain('工作');
    setAdding(false);
  };

  const toggleDep = (id: string) =>
    setDeps((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const stateMeta: Record<NodeState, { label: string; color: string }> = {
    ready: { label: '可行动', color: theme.colors.green },
    blocked: { label: '受阻', color: theme.colors.amber },
    done: { label: '已完成', color: theme.colors.textTertiary },
    broken: { label: '需重规划', color: theme.colors.red },
  };

  return (
    <View>
      <Text style={styles.intro}>
        长期任务引擎（最小可用）：用前置依赖把承诺连成一张先后顺序图，标出可立即行动 / 受阻 / 已完成，并提示计划漂移与同日截止冲突。依赖、阶段验收与停止条件都由你设定。
      </Text>

      {report.hasCycle && (
        <View style={[styles.riskBox, { borderLeftColor: theme.colors.red, backgroundColor: theme.colors.redSoft }]}>
          <Text style={[ts.secondary, { fontWeight: '700', color: theme.colors.red }]}>循环依赖告警</Text>
          <Text style={ts.tertiary}>
            {report.cycleNodes.map((id) => report.byId[id]?.label ?? id).join(' ⇄ ')}
          </Text>
        </View>
      )}

      {report.warnings.filter((w) => w.kind !== 'cycle').map((w, i) => (
        <View key={i} style={[styles.riskBox, { borderLeftColor: w.level === 'danger' ? theme.colors.red : theme.colors.amber, backgroundColor: w.level === 'danger' ? theme.colors.redSoft : theme.colors.amberSoft }]}>
          <Text style={[ts.tertiary, { lineHeight: 17 }]}>⚠ {w.message}</Text>
        </View>
      ))}

      <View style={styles.tagRow}>
        <Tag text={`就绪 ${report.summary.ready}`} color={theme.colors.green} />
        <Tag text={`受阻 ${report.summary.blocked}`} color={theme.colors.amber} />
        <Tag text={`需重规划 ${report.summary.broken}`} color={theme.colors.red} />
        <Tag text={`已完成 ${report.summary.done}`} color={theme.colors.textTertiary} />
      </View>
      {report.criticalPath.length > 1 && (
        <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>
          关键路径（最长 {report.criticalPath.length} 步）：{report.criticalPath.map((id) => report.byId[id]?.label ?? id).join(' → ')}
        </Text>
      )}

      {commitments.map((c) => {
        const n = report.byId[c.id];
        const meta = n ? stateMeta[n.state] : stateMeta.ready;
        return (
          <Card key={c.id} style={{ marginBottom: theme.spacing.md }} accent={meta.color}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{c.statement}</Text>
              <Tag text={meta.label} color={meta.color} />
            </View>
            <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
              {c.domain} · 优先级 {c.priority}
              {c.deadline ? ` · 截止 ${new Date(c.deadline).toLocaleDateString('zh-CN')}` : ''}
              {c.status !== 'active' ? ` · ${c.status}` : ''}
            </Text>

            {n && n.blockers.length > 0 && (
              <View style={styles.nextAction}>
                <Glyph name="warn" size={15} color={theme.colors.amber} />
                <Text style={styles.nextActionText}>
                  <Text style={styles.nextActionPrefix}>等待前置：</Text>
                  {n.blockers.map((id) => report.byId[id]?.label ?? id).join('、')}
                </Text>
              </View>
            )}

            {c.acceptance && (
              <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>阶段验收：{c.acceptance}</Text>
            )}
            {c.stopCondition && (
              <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>停止条件：{c.stopCondition}</Text>
            )}
            {c.dependsOn && c.dependsOn.length > 0 && (
              <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
                前置依赖：{c.dependsOn.map((id) => report.byId[id]?.label ?? id).join('、')}
              </Text>
            )}
          </Card>
        );
      })}

      {!adding ? (
        <PrimaryButton title="+ 新建承诺" onPress={() => setAdding(true)} />
      ) : (
        <Card>
          <Text style={styles.subHead}>新建承诺</Text>
          <TextInput
            value={statement}
            onChangeText={setStatement}
            placeholder="一句你愿意确认的承诺…"
            placeholderTextColor={theme.colors.textTertiary}
            style={styles.input}
          />
          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>领域</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            {DOMAIN_OPTIONS.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDomain(d)}
                style={[styles.chip, domain === d && styles.chipActive]}
              >
                <Text style={[styles.chipText, domain === d ? styles.chipActiveText : styles.chipInactiveText]}>{d}</Text>
              </Pressable>
            ))}
          </View>
          {commitments.length > 0 && (
            <>
              <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>前置依赖（可选）</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
                {commitments.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => toggleDep(c.id)}
                    style={[styles.chip, deps.includes(c.id) && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, deps.includes(c.id) ? styles.chipActiveText : styles.chipInactiveText]}>
                      {c.statement.slice(0, 8)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <View style={styles.buttonRow}>
            <PrimaryButton small title="保存" onPress={submit} />
            <PrimaryButton
              small
              ghost
              title="取消"
              onPress={() => {
                setAdding(false);
                setStatement('');
                setDeps([]);
                setDomain('工作');
              }}
            />
          </View>
        </Card>
      )}
    </View>
  );
}

function ExperimentsTab() {
  const theme = useAppTheme();
  const styles = useProgressStyles();
  const ts = useTextStyles();
  const { experiments, experimentAction, checkInExperiment } = useStore();
  const statusMeta: Record<string, { label: string; color: string }> = {
    active: { label: '进行中', color: theme.colors.green },
    proposed: { label: '待你决定', color: theme.colors.amber },
    completed: { label: '已完成', color: theme.colors.primary },
    stopped: { label: '已停止', color: theme.colors.textTertiary },
    declined: { label: '已谢绝', color: theme.colors.textTertiary },
  };
  return (
    <View>
      <Text style={styles.intro}>
        实验是最小控制单元：低风险、可逆、有停止规则。发现假设错误、停止无价值项目，同样是有效结果。
      </Text>
      {experiments.map((e) => {
        const meta = statusMeta[e.status];
        const doneCount = e.checkIns.filter((c) => c.done).length;
        return (
          <Card key={e.id} style={{ marginBottom: theme.spacing.md }} accent={meta.color}>
            <View style={[styles.cardHeader, { marginBottom: theme.spacing.sm }]}>
              <Tag text={`${e.kind} · ${e.durationDays} 天`} color={theme.colors.amber} />
              <Tag text={meta.label} color={meta.color} />
            </View>
            <Text style={styles.cardTitle}>{e.question}</Text>

            <View style={styles.kv}><Text style={styles.k}>基线</Text><Text style={styles.v}>{e.baseline}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>干预</Text><Text style={styles.v}>{e.intervention}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>指标</Text><Text style={styles.v}>{e.metrics.join('；')}</Text></View>
            <View style={styles.kv}><Text style={styles.k}>混杂</Text><Text style={styles.v}>{e.confounders.join('；')}</Text></View>
            <View style={styles.stopBox}>
              <Glyph name="warn" size={15} color={theme.colors.red} />
              <Text style={styles.stopText}>停止规则：{e.stopRule}</Text>
            </View>

            {e.status === 'active' && (
              <View style={{ marginTop: theme.spacing.sm }}>
                <View style={styles.progressLabel}>
                  <Text style={ts.tertiary}>进度 {doneCount}/{e.durationDays} 天</Text>
                </View>
                <Bar value={doneCount / e.durationDays} color={theme.colors.green} />
                {e.checkIns.slice(-3).map((c, i) => (
                  <Text key={i} style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
                    {new Date(c.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {c.note}
                  </Text>
                ))}
                <View style={styles.buttonRow}>
                  <PrimaryButton small title="今日打卡" onPress={() => checkInExperiment(e.id, '已完成今日实验')} />
                  <PrimaryButton small ghost danger title="停止实验" onPress={() => experimentAction(e.id, 'stop')} />
                </View>
              </View>
            )}
            {e.status === 'proposed' && (
              <View style={styles.buttonRow}>
                <PrimaryButton small title="接受并开始" onPress={() => experimentAction(e.id, 'accept')} />
                <PrimaryButton small ghost title="暂不做" onPress={() => experimentAction(e.id, 'decline')} />
              </View>
            )}
            {e.result && (
              <View style={styles.resultBox}>
                <Text style={[ts.secondary, { fontWeight: '700' }]}>结果（允许无效与负效应）</Text>
                <Text style={[ts.secondary, { marginTop: theme.spacing.xs }]}>{e.result}</Text>
                {e.modelUpdate && <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>模型更新：{e.modelUpdate}</Text>}
              </View>
            )}
          </Card>
        );
      })}
    </View>
  );
}

function ProjectsTab({ report }: { report: TaskGraphReport }) {
  const theme = useAppTheme();
  const styles = useProgressStyles();
  const ts = useTextStyles();
  const { projects } = useStore();
  return (
    <View>
      <Text style={styles.intro}>
        项目参谋维护使命、关键路径、风险与验收。AI 每天只呈现「下一关键行动」，范围、承诺与停止由你决定。
      </Text>
      {projects.map((p) => (
        <Card key={p.id} style={{ marginBottom: theme.spacing.md }} accent={p.status === 'active' ? theme.colors.green : theme.colors.textTertiary}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{p.name}</Text>
            <Tag text={p.status === 'active' ? '进行中' : p.status} color={p.status === 'active' ? theme.colors.green : theme.colors.textTertiary} />
          </View>
          <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>{p.mission}</Text>
          <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>不做：{p.nonGoals}</Text>

          <View style={{ marginTop: theme.spacing.md }}>
            <View style={styles.progressLabel}>
              <Text style={ts.tertiary}>总进度</Text>
              <Text style={ts.tertiary}>{Math.round(p.progress * 100)}%</Text>
            </View>
            <Bar value={p.progress} color={theme.colors.primary} />
          </View>

          <View style={styles.nextAction}>
            <Glyph name="arrow" size={16} color={theme.colors.amber} />
            <Text style={styles.nextActionText}>
              <Text style={styles.nextActionPrefix}>下一关键行动：</Text>{p.nextKeyAction}
            </Text>
          </View>

          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>关键路径：{p.criticalPath.join(' → ')}</Text>

          {p.dependsOn && p.dependsOn.length > 0 && (() => {
            const open = p.dependsOn.filter((id) => report.byId[id] && report.byId[id].state !== 'done');
            if (open.length === 0) {
              return <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>前置项目：{p.dependsOn.map((id) => report.byId[id]?.label ?? id).join('、')}（已全部完成）</Text>;
            }
            return (
              <View style={styles.nextAction}>
                <Glyph name="warn" size={15} color={theme.colors.amber} />
                <Text style={styles.nextActionText}>
                  <Text style={styles.nextActionPrefix}>前置未完成：</Text>
                  {open.map((id) => report.byId[id]?.label ?? id).join('、')}
                </Text>
              </View>
            );
          })()}

          <Divider />
          <Text style={styles.subHead}>里程碑</Text>
          {p.milestones.map((m, i) => (
            <View key={i} style={styles.milestoneRow}>
              <Glyph name={m.done ? 'check' : 'clock'} size={15} color={m.done ? theme.colors.green : theme.colors.textTertiary} />
              <View style={{ flex: 1 }}>
                <Text style={[ts.secondary, { color: m.done ? theme.colors.textTertiary : theme.colors.textPrimary }]}>
                  {m.title} · {new Date(m.due).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                </Text>
                <Text style={ts.tertiary}>验收：{m.acceptance}</Text>
              </View>
            </View>
          ))}

          {p.risks.length > 0 && (
            <>
              <Text style={[styles.subHead, { marginTop: theme.spacing.sm }]}>风险账本</Text>
              {p.risks.map((r, i) => (
                <View key={i} style={[styles.riskBox, { borderLeftColor: r.level === 'high' ? theme.colors.red : theme.colors.amber, backgroundColor: r.level === 'high' ? theme.colors.redSoft : theme.colors.amberSoft }]}>
                  <Text style={[ts.secondary, { fontWeight: '700' }]}>{r.title}</Text>
                  <Text style={ts.tertiary}>前置信号：{r.signal} · 应对：{r.mitigation}</Text>
                </View>
              ))}
            </>
          )}

          {p.decisionLedger.length > 0 && (
            <>
              <Text style={[styles.subHead, { marginTop: theme.spacing.sm }]}>决策账本</Text>
              {p.decisionLedger.map((d, i) => (
                <Text key={i} style={[ts.tertiary, { marginBottom: theme.spacing.xs, lineHeight: 17 }]}>
                  {new Date(d.date).toLocaleDateString('zh-CN')} · {d.decision}（{d.reason}）· {new Date(d.reviewAt).toLocaleDateString('zh-CN')} 复盘
                </Text>
              ))}
            </>
          )}

          <Text style={[ts.tertiary, { marginTop: theme.spacing.sm, fontStyle: 'italic' }]}>意义回路：{p.meaningLoop}</Text>
        </Card>
      ))}
    </View>
  );
}

function SkillsTab() {
  const theme = useAppTheme();
  const styles = useProgressStyles();
  const ts = useTextStyles();
  const { skills } = useStore();
  return (
    <View>
      <Text style={styles.intro}>
        只有作品、测验、迁移任务或他人反馈能推进掌握度 —— 观看时长与收藏不算证据。
      </Text>
      {skills.map((sk) => (
        <Card key={sk.id} style={{ marginBottom: theme.spacing.md }} accent={theme.colors.primary}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{sk.name}</Text>
            <Tag text={sk.stage} color={theme.colors.primary} />
          </View>
          <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>目标表现：{sk.targetPerformance}</Text>
          <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>量规：{sk.rubric.join(' · ')}</Text>

          <View style={{ marginTop: theme.spacing.md }}>
            <Text style={ts.tertiary}>掌握度（仅由证据推进）：{sk.mastery >= 0.8 ? '熟练' : sk.mastery >= 0.5 ? '较熟练' : sk.mastery >= 0.3 ? '有一些经验' : '刚开始'}</Text>
          </View>

          <Text style={[ts.secondary, { marginTop: theme.spacing.md, fontWeight: '700' }]}>本周计划</Text>
          <Text style={ts.secondary}>{sk.weeklyPlan}</Text>
          {sk.replanReason && (
            <View style={[styles.riskBox, { borderLeftColor: theme.colors.violet, backgroundColor: theme.colors.violetSoft, marginTop: theme.spacing.sm }]}>
              <Text style={[ts.tertiary, { lineHeight: 17 }]}>已动态重规划：{sk.replanReason}</Text>
            </View>
          )}

          {sk.evidences.length > 0 && (
            <>
              <Text style={[styles.subHead, { marginTop: theme.spacing.md }]}>能力证据</Text>
              {sk.evidences.map((ev, i) => (
                <View key={i} style={styles.evidenceRow}>
                  <Tag text={ev.kind} color={theme.colors.violet} bg={theme.colors.violetSoft} />
                  <Text style={[ts.tertiary, { flex: 1, lineHeight: 17 }]}>
                    {new Date(ev.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {ev.note}
                  </Text>
                </View>
              ))}
            </>
          )}
        </Card>
      ))}
    </View>
  );
}

function DirectionsTab() {
  const theme = useAppTheme();
  const styles = useProgressStyles();
  const ts = useTextStyles();
  const { directions, skills, projects } = useStore();
  return (
    <View>
      <Text style={styles.intro}>
        意义方向不是口号，由服务对象、贡献方式、代价边界与持续证据共同定义。系统持续比较：你说重要的、实际投入的、产生外部价值的是否一致。
      </Text>
      {directions.map((d) => (
        <Card key={d.id} style={{ marginBottom: theme.spacing.md }} accent={d.trend === 'up' ? theme.colors.green : theme.colors.textTertiary}>
          <Text style={styles.cardTitle}>{d.statement}</Text>
          <View style={styles.kv}><Text style={styles.k}>服务谁</Text><Text style={styles.v}>{d.serveWhom}</Text></View>
          <View style={styles.kv}><Text style={styles.k}>贡献方式</Text><Text style={styles.v}>{d.contribution}</Text></View>
          <View style={styles.kv}><Text style={styles.k}>代价边界</Text><Text style={styles.v}>{d.costBoundary}</Text></View>
          <View style={{ marginTop: theme.spacing.md }}>
            <View style={styles.progressLabel}>
              <Text style={ts.tertiary}>意义证据（跨时间综合，非分数）</Text>
              <Text style={[ts.tertiary, { color: d.trend === 'up' ? theme.colors.green : theme.colors.textTertiary }]}>
                {d.trend === 'up' ? '↑ 增强中' : d.trend === 'down' ? '↓ 减弱' : '→ 持平'}
              </Text>
            </View>
            <Bar value={d.evidenceScore} color={theme.colors.layerCommitment} />
          </View>
          {(d.skillIds.length > 0 || d.projectIds.length > 0) && (
            <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>
              关联：{d.skillIds.map((id) => skills.find((x) => x.id === id)?.name).filter(Boolean).join('、')}
              {d.skillIds.length > 0 && d.projectIds.length > 0 ? '；' : ''}
              {d.projectIds.map((id) => projects.find((x) => x.id === id)?.name).filter(Boolean).join('、')}
            </Text>
          )}
        </Card>
      ))}
    </View>
  );
}

// ============================================================================
// V4.3 Task 13：「我的方法」Personal Playbook（spec A7 / §2.3 / §4.23）
// ============================================================================
// 在「进程」页顶部展示与当前活动项目最相关的 1–3 条 PersonalSkill。
// 关联逻辑：基于项目文本（name+mission+nonGoals）与 skill.scope/trigger 的关键词匹配。
// 情境检查：比对 skill.preconditions 与项目文本，若存在不一致项，明确列出差异。
// 「关闭自动调用」开关：本地持久化（AsyncStorage），后端 source_permissions API 由后续任务接入。
// 「这次有什么不一样?」入口：触发 distillation 作业（POST /api/data/distillation-jobs）。
// ============================================================================

/** Domain 关键词列表（与 types/models.ts Domain 联合类型对齐） */
const DOMAIN_KEYWORDS: readonly string[] = ['身体', '工作', '关系', '创造', '学习', '家庭', '公共贡献', '财务', '休息'];

/** AsyncStorage 键：记录被用户关闭自动调用的 PersonalSkill id 集合 */
const DISABLED_SKILLS_KEY = 'zx_disabled_personal_skills';

/** 提取文本中的关键词：按中英文分隔符切分，过滤长度 < 2 的噪声 token */
function extractKeywords(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[\s,，。、;；:：!！?？()（）\[\]【】""''「」『』\-_\/\\|\n\r]+/)
    .filter((t) => t.length >= 2);
}

/**
 * SubTask 13.2：PersonalSkill 与 Project 关联匹配算法。
 * 评分规则（无作弊权重，所有权重均为 1 或 3，可解释）：
 *   - Domain 关键词命中（如「工作」「学习」同时出现在 scope 与 project 文本中）：+3
 *     理由：Domain 是策划书定义的生活领域分类，命中表明该 skill 与项目所属领域一致
 *   - scope 中其他关键词出现在 project 文本中：+1
 *     理由：关键词重叠表明主题相关
 *   - trigger 中关键词出现在 project 文本中：+1
 *     理由：trigger 描述触发条件，与项目情境重叠表明适用
 *   - 无 scope 的 skill 不参与匹配（评分 0，不展示）
 */
function matchSkillToProject(skill: PersonalSkill, project: Project): number {
  if (!skill.scope) return 0;
  const scopeLower = skill.scope.toLowerCase();
  const projectText = `${project.name} ${project.mission} ${project.nonGoals}`.toLowerCase();

  let score = 0;

  // Domain 关键词命中（高权重 3）
  for (const d of DOMAIN_KEYWORDS) {
    if (scopeLower.includes(d.toLowerCase()) && projectText.includes(d.toLowerCase())) {
      score += 3;
    }
  }

  // scope 中其他关键词命中（权重 1）
  const scopeTokens = extractKeywords(skill.scope);
  for (const t of scopeTokens) {
    if (DOMAIN_KEYWORDS.some((d) => d.toLowerCase() === t)) continue; // 避免与 Domain 双重计数
    if (projectText.includes(t)) score += 1;
  }

  // trigger 中关键词命中（权重 1）
  if (skill.trigger) {
    const triggerTokens = extractKeywords(skill.trigger);
    for (const t of triggerTokens) {
      if (DOMAIN_KEYWORDS.some((d) => d.toLowerCase() === t)) continue;
      if (projectText.includes(t)) score += 1;
    }
  }

  return score;
}

/**
 * SubTask 13.4：情境检查 —— 比对 skill.preconditions 与当前项目文本。
 * 若某条 precondition 的所有关键词（长度 ≥ 2）均未出现在项目文本中，视为「条件不同」。
 * 返回不一致的 precondition 列表（用于 UI 展示「这次有 N 个条件不同」）。
 *
 * 严格性：只要 precondition 中有任一关键词在项目文本中出现，就认为该条件已满足
 *       （宁可漏报不可误报，避免对用户造成不必要的认知负担）。
 */
function checkContextDifferences(skill: PersonalSkill, project: Project): string[] {
  if (!skill.preconditions || skill.preconditions.length === 0) return [];
  const projectText = `${project.name} ${project.mission} ${project.nonGoals}`.toLowerCase();
  const differences: string[] = [];
  for (const pc of skill.preconditions) {
    const tokens = extractKeywords(pc);
    // 无法提取关键词的 precondition 不参与判定（信息不足，不强行报差异）
    if (tokens.length === 0) continue;
    const matched = tokens.some((t) => projectText.includes(t));
    if (!matched) differences.push(pc);
  }
  return differences;
}

async function loadDisabledMap(): Promise<Record<string, boolean>> {
  try {
    const raw = await AsyncStorage.getItem(DISABLED_SKILLS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

async function saveDisabledMap(map: Record<string, boolean>): Promise<void> {
  try {
    await AsyncStorage.setItem(DISABLED_SKILLS_KEY, JSON.stringify(map));
  } catch {
    // 持久化失败不阻塞 UI，下次启动重新加载
  }
}

interface MatchedSkill {
  skill: PersonalSkill;
  project: Project;
  score: number;
}

function MyMethodsSection() {
  const theme = useAppTheme();
  const styles = useProgressStyles();
  const ts = useTextStyles();
  const projects = useStore((s) => s.projects);
  const triggerDistillation = useDistillationStore((s) => s.trigger);
  const { userId } = useAuth();

  const [skills, setSkills] = useState<PersonalSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabledMap, setDisabledMap] = useState<Record<string, boolean>>({});
  const [triggering, setTriggering] = useState<string | null>(null);

  // 加载 PersonalSkill 列表与关闭状态（首次挂载）
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [list, disabled] = await Promise.all([
        api.personalSkills.list().catch(() => [] as PersonalSkill[]),
        loadDisabledMap(),
      ]);
      if (!mounted) return;
      setSkills(list);
      setDisabledMap(disabled);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // SubTask 13.2：按当前活动项目匹配最相关 1–3 条 PersonalSkill
  const matched: MatchedSkill[] = useMemo(() => {
    const activeProjects = projects.filter((p) => p.status === 'active');
    if (activeProjects.length === 0 || skills.length === 0) return [];

    const results: MatchedSkill[] = [];
    for (const skill of skills) {
      let bestProject: Project | null = null;
      let bestScore = 0;
      for (const p of activeProjects) {
        const sc = matchSkillToProject(skill, p);
        if (sc > bestScore) {
          bestScore = sc;
          bestProject = p;
        }
      }
      if (bestProject && bestScore > 0) {
        results.push({ skill, project: bestProject, score: bestScore });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 3);
  }, [skills, projects]);

  // 空状态：仍在加载时不渲染（避免闪烁）
  if (loading) {
    return (
      <View style={styles.methodsContainer} accessibilityLabel="我的方法加载中">
        <ActivityIndicator color={theme.colors.primary} size="small" />
      </View>
    );
  }

  // 空状态：无任何 PersonalSkill —— 显示引导文案
  if (skills.length === 0) {
    return (
      <View style={styles.methodsContainer}>
        <Text style={styles.methodsTitle}>我的方法</Text>
        <Text style={styles.methodsEmpty}>
          还没有积累方法。完成项目复盘后，会在这里看到沉淀下来的经验。
        </Text>
      </View>
    );
  }

  // 有 PersonalSkill 但无匹配当前活动项目 —— 不显示该子区（避免噪声）
  if (matched.length === 0) return null;

  const toggleDisable = (skillId: string) => {
    const next = { ...disabledMap };
    if (next[skillId]) {
      delete next[skillId];
    } else {
      next[skillId] = true;
    }
    setDisabledMap(next);
    saveDisabledMap(next);
    // TODO V4.3 后续任务：将 disabled 状态写入 source_permissions 表
    //   POST /api/data/source-permissions { kind: 'personal_skill', target_id: skillId, granted: !disabled }
    //   当前 source_permissions 表已存在（backend/src/db.ts），但 REST API 未暴露
  };

  const handleWhatsDifferent = (item: MatchedSkill) => {
    if (triggering) return; // 防止重复触发
    setTriggering(item.skill.id);
    const topic = `这次有什么不一样？（方法：${item.skill.trigger ?? item.skill.id}，项目：${item.project.name}）`;
    triggerDistillation(userId ?? '', 'manual', {
      topic,
      project: item.project.id,
    })
      .then(() => {
        Alert.alert(
          '已触发复盘',
          'Satori 将在后台整理这次与上次的差异。复盘完成后会在「镜像」页提醒你。',
        );
      })
      .catch(() => {
        Alert.alert('触发失败', '网络异常，已加入队列稍后重试。');
      })
      .finally(() => {
        setTriggering(null);
      });
  };

  return (
    <View style={styles.methodsContainer}>
      <Text style={styles.methodsTitle}>我的方法</Text>
      <Text style={styles.methodsSub}>
        当前活动项目可能用得上的旧经验。先看情境是否相同，再决定是否套用。
      </Text>

      {matched.map(({ skill, project }) => {
        const differences = checkContextDifferences(skill, project);
        const isDisabled = !!disabledMap[skill.id];
        const title = skill.trigger ?? '未命名方法';
        return (
          <Card
            key={skill.id}
            style={styles.methodCard}
            accent={isDisabled ? theme.colors.textTertiary : theme.colors.primary}
          >
            <View style={styles.methodHeader}>
              <Text style={styles.cardTitle} accessibilityLabel={`方法标题：${title}`}>
                {title}
              </Text>
              {isDisabled && <Tag text="已停用自动调用" color={theme.colors.textTertiary} />}
            </View>

            {skill.scope ? (
              <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
                这个方法在 {skill.scope} 时候用过
              </Text>
            ) : null}

            {skill.procedure && skill.procedure.length > 0 ? (
              <View style={styles.procedureList}>
                {skill.procedure.map((step, i) => (
                  <Text
                    key={i}
                    style={[ts.secondary, { lineHeight: 19 }]}
                    accessibilityLabel={`步骤 ${i + 1}：${step}`}
                  >
                    {i + 1}. {step}
                  </Text>
                ))}
              </View>
            ) : null}

            {differences.length > 0 ? (
              <View
                style={[styles.riskBox, { borderLeftColor: theme.colors.amber, backgroundColor: theme.colors.amberSoft }]}
                accessibilityLabel={`情境差异提示：我们以前这样做过，但这次有${differences.length}个条件不同`}
              >
                <Text style={[ts.secondary, { fontWeight: '700', color: theme.colors.amber }]}>
                  我们以前这样做过，但这次有{differences.length}个条件不同
                </Text>
                {differences.map((d, i) => (
                  <Text key={i} style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
                    · {d}
                  </Text>
                ))}
              </View>
            ) : null}

            <Divider />

            <View style={styles.methodFooter}>
              <View style={styles.switchRow}>
                <Switch
                  value={!isDisabled}
                  onValueChange={() => toggleDisable(skill.id)}
                  trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                  thumbColor={theme.colors.textInverse}
                  accessibilityLabel={`不让 Satori 自动用这个方法：${title}`}
                  accessibilityRole="switch"
                />
                <Text style={ts.tertiary}>不让 Satori 自动用这个方法</Text>
              </View>
              <PrimaryButton
                small
                ghost
                title={triggering === skill.id ? '触发中…' : '这次有什么不一样?'}
                onPress={() => handleWhatsDifferent({ skill, project, score: 0 })}
                disabled={triggering === skill.id}
                accessibilityLabel={`触发复盘：这次与「${title}」有什么不一样`}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function useProgressStyles() {
  const theme = useAppTheme();
  return useMemo(
    () =>
      StyleSheet.create({
        scroll: { flex: 1, backgroundColor: theme.colors.bg },
        container: { padding: theme.spacing.lg },
        headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.xs },
        backBtn: {
          width: 40,
          height: 40,
          borderRadius: theme.radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: -theme.spacing.sm,
          marginRight: theme.spacing.xs,
        },
        backArrow: { fontSize: 28, lineHeight: 32, color: theme.colors.textPrimary, fontWeight: '300' },
        pageTitle: { color: theme.colors.textPrimary, fontSize: theme.font.hero, fontWeight: '800' },
        pageSub: {
          color: theme.colors.textTertiary,
          fontSize: theme.font.small,
          marginTop: theme.spacing.xs,
          marginBottom: theme.spacing.md,
        },
        tabRow: {
          flexDirection: 'row',
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.md,
          borderColor: theme.colors.borderSoft,
          borderWidth: 1,
          padding: theme.spacing.xs,
          marginBottom: theme.spacing.md,
        },
        tab: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: theme.spacing.sm,
          borderRadius: theme.radius.sm,
          minHeight: theme.touch.minTarget,
        },
        tabText: { fontSize: theme.font.small, fontWeight: '600' },
        intro: { color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: 19, marginBottom: theme.spacing.md },
        cardTitle: { color: theme.colors.textPrimary, fontSize: theme.font.body, fontWeight: '700', lineHeight: 22 },
        cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        tagRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm, flexWrap: 'wrap' },
        kv: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
        k: { width: 56, color: theme.colors.textTertiary, fontSize: theme.font.small },
        v: { flex: 1, color: theme.colors.textSecondary, fontSize: theme.font.small, lineHeight: 19 },
        stopBox: {
          flexDirection: 'row',
          gap: theme.spacing.sm,
          alignItems: 'flex-start',
          marginTop: theme.spacing.md,
          backgroundColor: theme.colors.redSoft,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
        },
        stopText: { color: theme.colors.red, fontSize: theme.font.small, flex: 1, lineHeight: 18 },
        nextAction: {
          flexDirection: 'row',
          gap: theme.spacing.sm,
          alignItems: 'flex-start',
          marginTop: theme.spacing.md,
          backgroundColor: theme.colors.amberSoft,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
        },
        nextActionText: { color: theme.colors.textPrimary, fontSize: theme.font.small, flex: 1, lineHeight: 19 },
        nextActionPrefix: { color: theme.colors.amber, fontWeight: '700' },
        subHead: { color: theme.colors.textPrimary, fontSize: theme.font.small, fontWeight: '700', marginBottom: theme.spacing.sm },
        riskBox: {
          borderLeftWidth: 3,
          borderRadius: theme.radius.md,
          padding: theme.spacing.md,
          marginBottom: theme.spacing.sm,
        },
        input: {
          borderWidth: 1,
          marginTop: theme.spacing.sm,
          backgroundColor: theme.colors.surfaceSoft,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          color: theme.colors.textPrimary,
          fontSize: theme.font.small,
          borderColor: theme.colors.borderSoft,
        },
        chip: {
          paddingVertical: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
          borderRadius: theme.radius.full,
          borderWidth: 1,
          borderColor: theme.colors.borderSoft,
          backgroundColor: theme.colors.surfaceSoft,
        },
        chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
        chipText: { fontSize: theme.font.tiny },
        chipActiveText: { color: theme.colors.textInverse },
        chipInactiveText: { color: theme.colors.textSecondary },
        buttonRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md },
        progressLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.xs },
        resultBox: { marginTop: theme.spacing.md, backgroundColor: theme.colors.surfaceSoft, borderRadius: theme.radius.md, padding: theme.spacing.md },
        milestoneRow: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start', marginBottom: theme.spacing.sm },
        evidenceRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.xs },
        methodsContainer: { marginBottom: theme.spacing.md },
        methodsTitle: { color: theme.colors.textPrimary, fontSize: theme.font.section, fontWeight: '700', marginBottom: theme.spacing.xs },
        methodsSub: { color: theme.colors.textTertiary, fontSize: theme.font.tiny, lineHeight: 16, marginBottom: theme.spacing.sm },
        methodsEmpty: { color: theme.colors.textTertiary, fontSize: theme.font.small, lineHeight: 19, fontStyle: 'italic' },
        methodCard: { marginBottom: theme.spacing.sm },
        methodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing.sm },
        procedureList: { gap: theme.spacing.xs, marginTop: theme.spacing.sm },
        methodFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap', marginTop: theme.spacing.md },
        switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flex: 1, minWidth: 200 },
      }),
    [theme]
  );
}
