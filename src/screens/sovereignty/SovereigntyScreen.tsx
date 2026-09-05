import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Alert, Platform, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../services/auth';
import { useServiceContractStore } from '../../store/useServiceContractStore';
import { useAppTheme, setAppScheme } from '../../theme/theme';
import { Card, Tag, PrimaryButton, Divider, useTextStyles } from '../../components/ui';
import { AmbientBackground } from '../../components/AmbientBackground';
import { Glyph } from '../../components/glyphs';
import { api, unwrapList } from '../../services/api';
import {
  MemoryLayer, UsageMode, ServiceContract,
  ReflectionDepth, AgencyLevel, DataScopeAxis, ProactivityLevel,
  AvatarVisibility, SupporterMode, DEFAULT_SERVICE_CONTRACT,
} from '../../types/models';
import {
  USAGE_MODE_PRESETS, USAGE_MODE_LABELS, USAGE_MODE_ORDER, GlyphName,
} from '../../data/usageModePresets';
import { SatoriUnderstandingSection } from './sections/SatoriUnderstandingSection';
import { AiModelSection } from './sections/AiModelSection';
import { ConnectedDataSection } from './sections/ConnectedDataSection';
import { ProactivitySection } from './sections/ProactivitySection';

/**
 * SovereigntyScreen —— 数据主权页（V4.3 §2.1 / §12.4 / §12.5 / spec A26 / A35）
 *
 * Task 7 拟人化互动服务合规：
 * - 7.4 交互日志导出（spec A26 数据可携权）：调 api.audit.list({limit:500}) 导出 JSON
 * - 7.6 使用方式切换入口：6 种模式（quiet-mirror / action-nav / long-project / voice-life / explore-growth / senior-easy）
 *       每种模式预设 R/A/D/P/V/S/X 默认值（spec Task 19.2）；切换后数据不重置（spec Task 19.4）
 *
 * Task 9 七轴服务契约 UI（V4.3 §2.9 / spec A3 / A35 / Task 9.1-9.4）：
 * - 新增「陪伴方式」tab，含 7 个生活语言滑块/选择器（R/A/D/P/V/S/X）
 * - 微文案严格对齐 spec A35 词典，禁用「赋能/闭环/抓手/画像/全知/精准洞察/命运/真实的你」等词
 * - 不出现 P0/P1 等技术词作为主标签，仅作为 accessibilityLabel 辅助标识
 * - 默认值 R1 / A1 / D0 / P1 / V1 / S0 / X 默认 quiet-mirror（spec A3.4 / Task 9.3）
 * - 滑块变化即 setLocal 本地更新；debounce 1s 后 PUT；成功后 toast「已更新 Satori 的陪伴方式」
 */

// ---------- V4.3 Task 9.1：七轴选项（生活语言，对齐 spec A35 微文案词典） ----------

interface AxisOption<T extends string> {
  value: T;
  label: string;        // 主标签（生活语言，不含 P0/R1 等技术词）
  description: string;  // 选中后下方显示的描述句
}

const R_OPTIONS: AxisOption<ReflectionDepth>[] = [
  { value: 'R0', label: '只说事实', description: '我只复述发生了什么，不做任何解读。' },
  { value: 'R1', label: '加上模式提示', description: '我看到事实，也会给你一些小提示。' },
  { value: 'R2', label: '给出可反驳的假设', description: '我会说出一个可以推翻的猜想，你也可以反驳。' },
  { value: 'R3', label: '提建议让我试', description: '我会给你一些可以尝试的小方法和实验。' },
];

const A_OPTIONS: AxisOption<AgencyLevel>[] = [
  { value: 'A0', label: '只听我说', description: '我只会听你说，不会给建议。' },
  { value: 'A1', label: '给建议', description: '我可以给你一些建议，由你决定要不要做。' },
  { value: 'A2', label: '帮我准备', description: '我可以帮你准备好草稿和方案，你来执行。' },
  { value: 'A3', label: '帮我执行', description: '我可以帮你执行，每次执行前会先问你。' },
  { value: 'A4', label: '全自动', description: '我可以全自动，但重要的事情仍然会先问你。' },
];

const P_OPTIONS: AxisOption<ProactivityLevel>[] = [
  { value: 'P0', label: '不主动', description: '我不会主动找你，你叫我我才出现。' },
  { value: 'P1', label: '每天一次', description: '我每天最多主动找你一次。' },
  { value: 'P2', label: '有变化才说', description: '我发现到值得说的变化时才主动找你。' },
  { value: 'P3', label: '立即提醒', description: '我看到值得立刻说的事，会马上提醒你。' },
];

const V_OPTIONS: AxisOption<AvatarVisibility>[] = [
  { value: 'V0', label: '纯文字', description: '只用文字回应，不显示任何形象。' },
  { value: 'V1', label: '2D 头像', description: '简单 2D 图标表示状态，省流量省电。' },
  { value: 'V2', label: '静态 3D', description: '完整 3D 卡通形象但无动画，性能友好。' },
  { value: 'V3', label: '动态 3D', description: '会眨眼、轻轻动，更有陪伴感。' },
];

const S_OPTIONS: AxisOption<SupporterMode>[] = [
  { value: 'S0', label: '不开启', description: '只有你自己能看到你的数据。' },
  { value: 'S1', label: '我可以分享', description: '你可以选择把某些内容分享给家人或支持者。' },
  { value: 'S2', label: '支持者可以看', description: '你指定的支持者可以看到一些你的进展。' },
];

/** D 轴：5 个数据源逐项布尔（spec A3.1 / Task 9.1：与 D0-D4 对应） */
const D_SOURCES: { key: DataScopeAxis; label: string; description: string }[] = [
  { key: 'D0', label: '事件', description: '你记录下来的事' },
  { key: 'D1', label: '承诺', description: '你确认的方向和行动' },
  { key: 'D2', label: '假设', description: '我和你一起测试的猜想' },
  { key: 'D3', label: '实验与方法', description: '你正在试的小实验和已经沉淀的方法' },
  { key: 'D4', label: '健康与日历', description: '你已经授权的健康摘要和日历（如果连接了）' },
];

/**
 * 6 种使用模式（spec §2.10 / Task 19.2）：UI 展示数据派生自 src/data/usageModePresets.ts。
 * 预设值（R/A/D/P/V/S/X）严格对齐 spec Task 19.2 表，集中维护避免多处漂移。
 * SubTask 19.4：preset 仅含服务契约字段，切换不触达业务数据。
 */
const USAGE_MODES: { mode: UsageMode; name: string; desc: string; icon: GlyphName; preset: Partial<ServiceContract> }[] =
  USAGE_MODE_ORDER.map((mode) => ({
    mode,
    name: USAGE_MODE_LABELS[mode].name,
    desc: USAGE_MODE_LABELS[mode].description,
    icon: USAGE_MODE_LABELS[mode].icon,
    preset: USAGE_MODE_PRESETS[mode],
  }));

const PERM_NAME: Record<string, string> = {
  calendar: '日历', tasks: '任务', health: '健康摘要', journal: '日记/语音',
  works: '作品', chat_snippet: '精选对话片段', location: '位置',
};

export function SovereigntyScreen() {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const s = useStore();
  const navigation = useNavigation<any>();
  const { deleteAccount, userId } = useAuth();
  const contract = useServiceContractStore((st) => st.contract);
  const loadContract = useServiceContractStore((st) => st.load);
  const updateContract = useServiceContractStore((st) => st.update);
  const setLocal = useServiceContractStore((st) => st.setLocal);
  const [tab, setTab] = useState<'permissions' | 'memory' | 'audit' | 'companion' | 'usage-mode' | 'export' | 'satori' | 'ai-model' | 'connected' | 'proactivity'>('permissions');
  const [layer, setLayer] = useState<MemoryLayer>('fact');
  const [forgetTarget, setForgetTarget] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportingLog, setExportingLog] = useState(false);
  // V4.3 Task 9.2-9.4：debounce 保存 + toast
  const [toastText, setToastText] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Partial<ServiceContract>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // V4.3 Task 25.5：Personal Model Package 导出状态
  const [exportingPackage, setExportingPackage] = useState(false);
  // V4.3 Task 25.6：反向追溯 Modal —— 展示某条认识对应的证据列表 / 某条事件支持的候选认识
  const [reverseTrace, setReverseTrace] = useState<{
    kind: 'evidences' | 'patterns';
    title: string;
    evidenceIds?: string[];     // kind='evidences' 时使用
    eventId?: string;            // kind='patterns' 时使用，从 event 反查 pattern_candidates
  } | null>(null);
  const [traceData, setTraceData] = useState<{
    evidences?: { id: string; content_ref?: string; source: string; occurred_at: string }[];
    patterns?: { id: string; statement: string; review_state: string }[];
  }>({});
  const [traceLoading, setTraceLoading] = useState(false);

  const LAYER_META: { key: MemoryLayer; name: string; desc: string; color: string }[] = [
    { key: 'fact', name: '事实层', desc: '带来源与时间的可核验事件', color: theme.colors.layerFact },
    { key: 'experience', name: '体验层', desc: '你当时的感受与解释，不会被改写成事实', color: theme.colors.layerExperience },
    { key: 'relation', name: '关系层', desc: '角色、互动、承诺与边界', color: theme.colors.layerRelation },
    { key: 'hypothesis', name: '假设层', desc: 'AI 的推断，含支持理由、相反例子和到期复审', color: theme.colors.layerHypothesis },
    { key: 'commitment', name: '承诺层', desc: '你主动确认的方向与行动，只有你能修改', color: theme.colors.layerCommitment },
  ];

  // 加载服务契约（首次进入数据页拉取，store 内部幂等）
  useEffect(() => {
    if (!contract && userId) {
      loadContract(userId).catch(() => { /* 网络错误由 store 内部默认契约兜底 */ });
    }
  }, [contract, userId, loadContract]);

  // 卸载时清理 debounce 定时器，避免内存泄漏与卸载后 setState
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // V4.3 Task 9.2-9.4：滑块变化 → 即时 setLocal + 1s debounce 后 PUT + 成功 toast
  const handleAxisChange = useCallback((patch: Partial<ServiceContract>) => {
    setLocal(patch);  // 即时本地更新，UI 立即响应
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!userId) return;
      const patchToSave = pendingPatch.current;
      pendingPatch.current = {};
      try {
        await updateContract(userId, patchToSave);
        // 成功 toast（spec Task 9.4）
        setToastText('已更新 Satori 的陪伴方式');
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToastText(null), 2200);
      } catch {
        // 网络错误由 store 内部默认契约兜底；不弹错误 toast 避免打扰
      }
    }, 1000);
  }, [setLocal, updateContract, userId]);

  // 同步适老主题到全局 scheme（spec A36.8 / SubTask 7.6）
  useEffect(() => {
    const um = contract?.accessibility_profile?.usage_mode;
    if (um === 'senior-easy') setAppScheme('senior');
    else setAppScheme('system');
  }, [contract?.accessibility_profile?.usage_mode]);

  // 真正导出：序列化本机全部数据，Web 端下载文件，原生端通过系统分享
  const doExport = () => {
    const archive = {
      导出时间: new Date().toISOString(),
      用户: s.user,
      事实与体验: s.events,
      承诺: s.commitments,
      假设: s.hypotheses,
      实验: s.experiments,
      项目: s.projects,
      意义方向: s.directions,
      技能: s.skills,
      审计: s.audit,
    };
    const json = JSON.stringify(archive, null, 2);
    if (Platform.OS === 'web') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `知行镜_个人档案_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Alert.alert('已导出', '个人档案 JSON 已下载到本机。');
    } else {
      Share.share({ message: json, title: '知行镜个人档案导出' });
    }
  };

  // 7.4 交互日志导出（spec A26 数据可携权）：调 api.audit.list({limit:500}) 导出 JSON
  const doExportInteractionLog = async () => {
    if (exportingLog) return;
    setExportingLog(true);
    try {
      const page = await api.audit.list({ limit: 500 });
      const payload = {
        导出时间: new Date().toISOString(),
        类型: 'zhixingos-interaction-log',
        说明: '交互日志（审计记录）。包含用户与 AI 的操作历史，可复制、可删除。',
        条目数: page.items.length,
        是否还有更多: page.nextCursor !== null,
        items: page.items,
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `zhixingos-interaction-log-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        Alert.alert('已导出', `交互日志 ${page.items.length} 条已下载。${page.nextCursor ? '（仍有更多，已导出最近 500 条）' : ''}`);
      } else {
        Share.share({ message: json, title: filename });
      }
      s.pushAudit('用户', `导出交互日志 ${page.items.length} 条`);
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ?? '请检查网络后重试');
    } finally {
      setExportingLog(false);
    }
  };

  /**
   * V4.3 Task 25.5：Personal Model Package 导出（spec A25）。
   * 不新增后端端点，前端调多个 list API 收集八类数据，组装为单一 JSON 下载。
   * 八类：evidence / pattern / experience / skill / metaPrinciple / modelVersion / serviceContract / auditLogs
   */
  const doExportPersonalModelPackage = async () => {
    if (exportingPackage) return;
    setExportingPackage(true);
    try {
      const [evidence, patterns, experiences, skills, metaPrinciples, modelVersionsRaw, correctionsRaw, serviceContract, auditPage] = await Promise.all([
        api.evidence.list(),
        api.patterns.list(),
        api.experiences.list(),
        api.personalSkills.list(),
        api.metaPrinciples.list(),
        api.modelVersions.list(),
        api.corrections.list({ limit: 500 }),
        api.serviceContract.get(),
        api.audit.list({ limit: 500 }),
      ]);
      // modelVersions 与 corrections 端点返回分页对象，用 unwrapList 统一解包
      const modelVersions = unwrapList(modelVersionsRaw);
      const corrections = unwrapList(correctionsRaw);
      const payload = {
        schema: 'zhixingos-personal-model-package-v1',
        schemaVersion: '1.0',
        导出时间: new Date().toISOString(),
        说明: 'Personal Model Package —— 你的全部个人模型资产。可迁移到其他工具，防止平台锁定。',
        identity: { user: s.user, userId },
        evidence,
        patterns,
        experiences,
        skills,
        metaPrinciples,
        modelVersions,
        corrections,
        serviceContract,
        auditLogs: auditPage.items,
        统计: {
          evidenceCount: evidence.length,
          patternCount: patterns.length,
          experienceCount: experiences.length,
          skillCount: skills.length,
          metaPrincipleCount: metaPrinciples.length,
          modelVersionCount: modelVersions.length,
          correctionCount: corrections.length,
          auditLogCount: auditPage.items.length,
        },
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `zhixingos-personal-model-package-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        Alert.alert(
          '已导出个人模型包',
          `共 ${payload.统计.evidenceCount + payload.统计.patternCount + payload.统计.experienceCount + payload.统计.skillCount + payload.统计.metaPrincipleCount + payload.统计.modelVersionCount + payload.统计.correctionCount + payload.统计.auditLogCount} 条记录。`,
        );
      } else {
        Share.share({ message: json, title: filename });
      }
      s.pushAudit('用户', `导出 Personal Model Package（evidence ${payload.统计.evidenceCount} / pattern ${payload.统计.patternCount} / experience ${payload.统计.experienceCount}）`);
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ?? '请检查网络后重试');
    } finally {
      setExportingPackage(false);
    }
  };

  /**
   * V4.3 Task 25.6：反向追溯 —— 展示某条认识（pattern/experience/skill/metaPrinciple）支持的证据列表。
   * 在 SatoriUnderstandingSection 中点击「查看支持的证据」时调用。
   */
  const handleTraceEvidences = useCallback(async (evidenceIds: string[], title: string) => {
    setReverseTrace({ kind: 'evidences', title, evidenceIds });
    setTraceLoading(true);
    setTraceData({});
    try {
      const all = await api.evidence.list();
      const filtered = all.filter((e) => evidenceIds.includes(e.id));
      setTraceData({
        evidences: filtered.map((e) => ({
          id: e.id,
          content_ref: e.content_ref ?? undefined,
          source: e.source,
          occurred_at: e.occurred_at,
        })),
      });
    } catch {
      setTraceData({ evidences: [] });
    } finally {
      setTraceLoading(false);
    }
  }, []);

  /**
   * V4.3 Task 25.6：反向追溯 —— 从一条日记（event）反查它支持的候选认识（pattern_candidates）。
   * 算法：先找 evidence_records 中 resource_type='event' 且 resource_id=event.id 的记录，
   * 再找 pattern_candidates 中 support_ids 包含这些 evidence id 的记录。
   */
  const handleTracePatternsForEvent = useCallback(async (eventId: string, eventTitle: string) => {
    setReverseTrace({ kind: 'patterns', title: `支持「${eventTitle.slice(0, 24)}${eventTitle.length > 24 ? '…' : ''}」的候选猜想`, eventId });
    setTraceLoading(true);
    setTraceData({});
    try {
      const [allEvidence, allPatterns] = await Promise.all([
        api.evidence.list(),
        api.patterns.list(),
      ]);
      // 1. 找出与该 event 关联的 evidence（resource_type='event' 且 resource_id=event.id）
      const linkedEvidenceIds = allEvidence
        .filter((e) => e.resource_type === 'event' && e.resource_id === eventId)
        .map((e) => e.id);
      // 2. 找出 support_ids 包含任意 linkedEvidenceId 的 pattern_candidates
      const linkedPatterns = allPatterns.filter((p) =>
        p.support_ids.some((sid) => linkedEvidenceIds.includes(sid))
      );
      setTraceData({
        patterns: linkedPatterns.map((p) => ({
          id: p.id,
          statement: p.statement,
          review_state: p.review_state,
        })),
      });
    } catch {
      setTraceData({ patterns: [] });
    } finally {
      setTraceLoading(false);
    }
  }, []);

  /**
   * 7.6 / Task 19.4 切换使用模式：仅更新服务契约预设，不重置任何业务数据。
   *
   * SubTask 19.4 数据连续性保证：
   *   - patch 仅含 R/A/D/P/V/S/X 服务契约字段（来自 USAGE_MODE_PRESETS）
   *   - updateContract 内部仅 PUT /api/data/service-contract，不触达业务表
   *   - useStore.events / commitments / hypotheses / experiments / projects / skills /
   *     model_corrections 等业务数组长度在切换前后保持不变
   *   - 用户纠错记录（model_corrections）同样保留，不会因模式切换而丢失
   */
  const switchUsageMode = (mode: UsageMode) => {
    if (!userId) return;
    const preset = USAGE_MODES.find((m) => m.mode === mode)?.preset;
    if (!preset) return;
    updateContract(userId, preset);
    s.pushAudit('用户', `切换使用方式：${USAGE_MODES.find((m) => m.mode === mode)?.name ?? mode}`);
    // 适老模式即时同步主题（spec A36.8）—— seniorFont 保证 body ≥ 18sp
    setAppScheme(mode === 'senior-easy' ? 'senior' : 'system');
  };

  const currentUsageMode = contract?.accessibility_profile?.usage_mode ?? 'quiet-mirror';

  // P0-7：真正注销——调用后端硬删除，成功后 RootNavigator 因 token 清空自动跳回登录
  const doDelete = async () => {
    setConfirmDelete(false);
    if (busy) return;
    setBusy(true);
    try {
      await deleteAccount();
      // 成功后导航由 auth.token 变化驱动，无需手动跳转
    } catch (e: any) {
      setBusy(false);
      Alert.alert('注销失败', (e && e.message ? String(e.message) : '请检查网络后重试'));
    }
  };

  const askDelete = () => {
    if (Platform.OS === 'web') { setConfirmDelete(true); return; }
    Alert.alert('彻底注销账号？', '将永久删除你的全部数据与派生模型，并生成删除证明。此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      { text: '彻底注销', style: 'destructive', onPress: doDelete },
    ]);
  };

  const layerCounts: Record<MemoryLayer, number> = {
    fact: s.events.length,
    experience: s.events.filter((e) => !!e.userInterpretation).length,
    relation: s.commitments.filter((c) => c.domain === '家庭' || c.domain === '关系').length,
    hypothesis: s.hypotheses.length,
    commitment: s.commitments.length,
  };

  const confirmForget = (id: string) => {
    if (Platform.OS === 'web') {
      setForgetTarget(id);
      return;
    }
    Alert.alert('遗忘这条记录？', '将同时删除其派生的向量、摘要与相关推断，并生成删除证明。此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      { text: '彻底遗忘', style: 'destructive', onPress: () => s.forgetEvent(id) },
    ]);
  };

  const tabs: readonly [typeof tab, string][] = [
    ['permissions', '权限'], ['memory', '记忆'], ['audit', '审计'],
    ['satori', '我注意到'], ['ai-model', 'AI 与模型'],
    ['connected', '连接的数据'], ['proactivity', '主动性'],
    ['companion', '陪伴'], ['usage-mode', '使用'], ['export', '带走 / 清空'],
  ];

  return (
    <View style={[styles.scroll, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.xs }}>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="返回主页"
            style={({ pressed }) => ({
              width: theme.touch.minTarget,
              height: theme.touch.minTarget,
              borderRadius: theme.radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: -theme.spacing.sm,
              marginRight: theme.spacing.xs,
              backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
            })}
          >
            <Text style={{ fontSize: theme.font.hero, lineHeight: theme.font.hero + 4, color: theme.colors.textPrimary, fontWeight: '300' }}>←</Text>
          </Pressable>
          <Text style={[styles.pageTitle, { color: theme.colors.textPrimary, fontSize: theme.font.hero }]}>数据主权</Text>
        </View>
        <Text style={[styles.pageSub, { color: theme.colors.textTertiary, fontSize: theme.font.small, marginBottom: theme.spacing.md }]}>你的数据由你掌控 —— 查看、更正、导出、遗忘，都在这里</Text>

        <View style={[styles.tabRow, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderColor: theme.colors.borderSoft, marginBottom: theme.spacing.md }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.tabScroll,
              { padding: theme.spacing.xs, gap: theme.spacing.xs },
              Platform.OS === 'web' && { paddingVertical: theme.spacing.sm },
            ]}
          >
            {tabs.map(([k, label]) => (
              <Pressable
                key={k}
                accessibilityLabel={`切换到${label}标签`}
                accessibilityRole="tab"
                onPress={() => setTab(k)}
                style={({ pressed }) => [
                  styles.tab,
                  tab === k && { backgroundColor: theme.colors.primarySoft },
                  {
                    minHeight: theme.touch.minTarget,
                    justifyContent: 'center',
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.sm,
                    opacity: pressed ? 0.75 : 1,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  },
                ]}
              >
                <Text style={{ color: tab === k ? theme.colors.primary : theme.colors.textTertiary, fontSize: theme.font.small, fontWeight: '600' }}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {tab === 'permissions' && (
          <View>
            <Text style={[styles.intro, ts.secondary]}>
              每类数据绑定明确用途，逐权授权、实时撤回。撤回后相关后台读取立即停止，派生推断进入失效流程。
            </Text>
            {s.permissions.map((p) => (
              <Card
                key={p.id}
                style={{ marginBottom: theme.spacing.md }}
                accent={p.granted ? theme.colors.green : theme.colors.amber}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Text style={[ts.body, { fontWeight: '700' }]}>{PERM_NAME[p.kind]}</Text>
                    <Tag text={p.readWrite === 'read' ? '只读' : '读写'} color={p.readWrite === 'read' ? theme.colors.green : theme.colors.amber} />
                  </View>
                  <Switch
                    value={p.granted}
                    onValueChange={() => s.togglePermission(p.id)}
                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                    thumbColor={theme.colors.surface}
                    accessibilityLabel={`数据权限「${PERM_NAME[p.kind]}」：${p.granted ? '已授权，点击撤回' : '未授权，点击授权'}。用途：${p.purpose}`}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: p.granted }}
                  />
                </View>
                <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>用途：{p.purpose}</Text>
                <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>
                  范围：{p.scope}
                  {p.lastAccessAt && p.granted ? ` · 最近访问 ${new Date(p.lastAccessAt).toLocaleDateString('zh-CN')}` : ''}
                </Text>
              </Card>
            ))}
            <View style={[styles.noteBox, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderColor: theme.colors.borderSoft, borderLeftColor: theme.colors.green }]}>
              <Glyph name="shield" size={theme.font.body} color={theme.colors.green} />
              <Text style={[ts.tertiary, { flex: 1, lineHeight: theme.font.body * 1.5 }]}>
                不会接入：全量聊天记录、精确位置、消费记录。不会向雇主、保险、信贷、广告输出任何个人模型。
              </Text>
            </View>
          </View>
        )}

        {tab === 'memory' && (
          <View>
            <Text style={[styles.intro, ts.secondary]}>
              五层记忆严格隔离：事实与推断分库存储，AI 无法把假设写入事实层。你可以逐层检查、更正与遗忘。
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginBottom: theme.spacing.lg }}>
              {LAYER_META.map((l) => (
                <Pressable
                  key={l.key}
                  onPress={() => setLayer(l.key)}
                  accessibilityLabel={`切换到${l.name}，共 ${layerCounts[l.key]} 条。${l.desc}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: layer === l.key }}
                >
                  <Tag text={`${l.name} ${layerCounts[l.key]}`} color={layer === l.key ? l.color : theme.colors.textTertiary} bg={layer === l.key ? `${l.color}22` : theme.colors.surface} />
                </Pressable>
              ))}
            </View>

            {layer === 'fact' && s.events.slice(0, 12).map((e) => (
              <Card key={e.id} style={{ marginBottom: theme.spacing.sm, paddingVertical: theme.spacing.md }} accent={theme.colors.layerFact}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={[ts.secondary, { flex: 1, color: theme.colors.textPrimary }]}>{e.title}</Text>
                  <Pressable
                    onPress={() => confirmForget(e.id)}
                    accessibilityLabel={`遗忘事件：${e.title}`}
                    accessibilityRole="button"
                    style={{ paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md, minHeight: theme.touch.minTarget, minWidth: theme.touch.minTarget, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm }}
                  >
                    <Text style={{ color: theme.colors.red, fontSize: theme.font.small }}>遗忘</Text>
                  </Pressable>
                </View>
                <Text style={ts.tertiary}>
                  {new Date(e.startTime).toLocaleDateString('zh-CN')} · 来源 {e.sourceRef} · {e.sensitivity === 'normal' ? '普通' : e.sensitivity === 'sensitive' ? '敏感' : '高度敏感'}
                </Text>
                {/* V4.3 Task 25.6：反向追溯 —— 从事件反查它支持的候选认识 */}
                <Pressable
                  onPress={() => handleTracePatternsForEvent(e.id, e.title)}
                  accessibilityLabel={`查看事件「${e.title}」支持的候选猜想列表`}
                  accessibilityRole="button"
                  style={{ marginTop: theme.spacing.sm, alignSelf: 'flex-start', paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md, minHeight: theme.touch.minTarget, justifyContent: 'center', borderRadius: theme.radius.sm }}
                >
                  <Text style={{ color: theme.colors.primaryMuted, fontSize: theme.font.tiny }}>查看支持的候选猜想</Text>
                </Pressable>
              </Card>
            ))}

            {layer === 'experience' && s.events.filter((e) => e.userInterpretation).map((e) => (
              <Card key={e.id} style={{ marginBottom: theme.spacing.sm, paddingVertical: theme.spacing.md }} accent={theme.colors.layerExperience}>
                <Text style={[ts.secondary, { color: theme.colors.violet, fontStyle: 'italic' }]}>「{e.userInterpretation}」</Text>
                <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>附着于事实：{e.title} · {new Date(e.startTime).toLocaleDateString('zh-CN')}</Text>
              </Card>
            ))}

            {layer === 'hypothesis' && s.hypotheses.map((h) => (
              <Card key={h.id} style={{ marginBottom: theme.spacing.sm, paddingVertical: theme.spacing.md }} accent={theme.colors.layerHypothesis}>
                <Text style={[ts.secondary, { color: theme.colors.textPrimary }]}>{h.id} v{h.version} · {h.statement}</Text>
                <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{h.confidence >= 0.7 ? '较有把握' : h.confidence >= 0.4 ? '暂时猜想' : '初步猜测'} · {new Date(h.reviewAt).toLocaleDateString('zh-CN')} 到期复审</Text>
              </Card>
            ))}

            {layer === 'commitment' && s.commitments.map((c) => (
              <Card key={c.id} style={{ marginBottom: theme.spacing.sm, paddingVertical: theme.spacing.md }} accent={theme.colors.layerCommitment}>
                <Text style={[ts.secondary, { color: theme.colors.textPrimary, fontWeight: '700' }]}>{c.statement}</Text>
                <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{c.why} · 状态：{c.status === 'active' ? '生效中' : c.status}</Text>
              </Card>
            ))}

            {layer === 'relation' && (
              <Card accent={theme.colors.layerRelation}>
                <Text style={[ts.secondary, { color: theme.colors.textPrimary }]}>关系层保存角色与承诺，不分析第三方人格。</Text>
                <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>
                  当前 {layerCounts.relation} 条与关系相关的承诺。涉及他人的信息遵循最小化与脱敏原则，第三方默认以你定义的角色代称出现。
                </Text>
              </Card>
            )}
          </View>
        )}

        {tab === 'audit' && (
          <View>
            <Text style={[styles.intro, ts.secondary]}>不可篡改的访问日志：谁（你或哪个 Agent）在何时访问、推断或执行了什么。</Text>
            {s.audit.map((a, idx) => (
              <View
                key={a.id}
                style={[
                  styles.auditRow,
                  { gap: theme.spacing.md, paddingVertical: theme.spacing.md },
                  idx !== s.audit.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.borderSoft },
                ]}
              >
                <View style={[styles.auditDot, { backgroundColor: theme.colors.primary }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[ts.secondary, { color: theme.colors.textPrimary }]}>{a.action}</Text>
                  <Text style={ts.tertiary}>
                    {a.actor} · {new Date(a.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {a.targetRef ? ` · 关联 ${a.targetRef}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* V4.3 Task 25.1 / 25.6：「我注意到」子页 —— Satori 的理解 + 反向追溯入口 */}
        {tab === 'satori' && (
          <SatoriUnderstandingSection
            onTraceEvidences={handleTraceEvidences}
            pushAudit={s.pushAudit}
          />
        )}

        {/* V4.3 Task 25.2：「AI 与模型」子页 —— 模型供应商 + 仅本地 + 最小上下文 */}
        {tab === 'ai-model' && contract && (
          <AiModelSection contract={contract} onPatch={handleAxisChange} />
        )}
        {tab === 'ai-model' && !contract && (
          <View style={[styles.centerWrap, { paddingVertical: theme.spacing.xl }]}>
            <Text style={ts.tertiary}>正在读取服务契约…</Text>
          </View>
        )}

        {/* V4.3 Task 25.3 / 25.7：「连接的数据」子页 —— 数据源权限 + 撤回与删除分离 */}
        {tab === 'connected' && (
          <ConnectedDataSection pushAudit={s.pushAudit} />
        )}

        {/* V4.3 Task 25.4：「主动性」子页 —— 通知/周镜/3D 程度（生活语言） */}
        {tab === 'proactivity' && contract && (
          <ProactivitySection contract={contract} onPatch={handleAxisChange} />
        )}
        {tab === 'proactivity' && !contract && (
          <View style={[styles.centerWrap, { paddingVertical: theme.spacing.xl }]}>
            <Text style={ts.tertiary}>正在读取服务契约…</Text>
          </View>
        )}

        {/* V4.3 Task 9.1-9.4：「陪伴方式」子页 —— 7 轴服务契约 UI（spec A3.2 / A35 / A36） */}
        {tab === 'companion' && (
          <View>
            <Text style={[styles.intro, ts.secondary]}>
              你可以一句话告诉我希望我怎么陪你。每改一项我都会立即记下；连续修改只会保存最后一次。默认是温和的「安静镜子」状态。
            </Text>

            {/* R 轴：想听到多深（反思深度） */}
            <Card style={[styles.axisCard, { marginBottom: theme.spacing.md }]} accent={theme.colors.primary}>
              <View style={[styles.axisHead, { borderBottomColor: theme.colors.borderSoft, marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
                <Text style={[styles.axisTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>想听到多深</Text>
                <Text style={[styles.axisHint, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>我从事实到建议的解读深度</Text>
              </View>
              {R_OPTIONS.map((opt) => {
                const active = contract?.reflection_depth === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={`想听到多深：${opt.label}。${opt.description}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => handleAxisChange({ reflection_depth: opt.value })}
                    style={[
                      styles.axisOption,
                      active && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
                      { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                        {opt.label}
                      </Text>
                      {active && <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{opt.description}</Text>}
                    </View>
                    <View style={[styles.radio, active && { borderColor: theme.colors.primary }, { borderColor: theme.colors.border }]}>
                      {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </Card>

            {/* A 轴：能帮到哪一步（主动程度） */}
            <Card style={[styles.axisCard, { marginBottom: theme.spacing.md }]} accent={theme.colors.primary}>
              <View style={[styles.axisHead, { borderBottomColor: theme.colors.borderSoft, marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
                <Text style={[styles.axisTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>能帮到哪一步</Text>
                <Text style={[styles.axisHint, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>我能不能给建议、准备、执行</Text>
              </View>
              {A_OPTIONS.map((opt) => {
                const active = contract?.agency_level === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={`能帮到哪一步：${opt.label}。${opt.description}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => handleAxisChange({ agency_level: opt.value })}
                    style={[
                      styles.axisOption,
                      active && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
                      { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                        {opt.label}
                      </Text>
                      {active && <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{opt.description}</Text>}
                    </View>
                    <View style={[styles.radio, active && { borderColor: theme.colors.primary }, { borderColor: theme.colors.border }]}>
                      {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </Card>

            {/* D 轴：我可以看哪些数据（逐项布尔） */}
            <Card style={[styles.axisCard, { marginBottom: theme.spacing.md }]} accent={theme.colors.primary}>
              <View style={[styles.axisHead, { borderBottomColor: theme.colors.borderSoft, marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
                <Text style={[styles.axisTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>我可以看哪些数据</Text>
                <Text style={[styles.axisHint, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>每一类单独开关</Text>
              </View>
              {D_SOURCES.map((src) => {
                const enabled = contract?.data_scope?.[src.key] ?? false;
                return (
                  <View key={src.key} style={[styles.dRow, { marginBottom: theme.spacing.sm }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.body, { fontWeight: '600', color: theme.colors.textPrimary }]}>
                        {src.label}
                      </Text>
                      <Text style={ts.tertiary}>{src.description}</Text>
                    </View>
                    <Switch
                      value={enabled}
                      onValueChange={(v) => handleAxisChange({
                        data_scope: {
                          ...(contract?.data_scope ?? DEFAULT_SERVICE_CONTRACT.data_scope),
                          [src.key]: v,
                        },
                      })}
                      trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                      thumbColor={theme.colors.surface}
                      accessibilityLabel={`数据授权「${src.label}」：${src.description}。当前 ${enabled ? '已授权' : '未授权'}`}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: enabled }}
                    />
                  </View>
                );
              })}
            </Card>

            {/* P 轴：多久主动找我（主动性） */}
            <Card style={[styles.axisCard, { marginBottom: theme.spacing.md }]} accent={theme.colors.primary}>
              <View style={[styles.axisHead, { borderBottomColor: theme.colors.borderSoft, marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
                <Text style={[styles.axisTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>多久主动找我</Text>
                <Text style={[styles.axisHint, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>我主动出现的频率</Text>
              </View>
              {P_OPTIONS.map((opt) => {
                const active = contract?.proactivity === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={`多久主动找我：${opt.label}。${opt.description}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => handleAxisChange({ proactivity: opt.value })}
                    style={[
                      styles.axisOption,
                      active && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
                      { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                        {opt.label}
                      </Text>
                      {active && <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{opt.description}</Text>}
                    </View>
                    <View style={[styles.radio, active && { borderColor: theme.colors.primary }, { borderColor: theme.colors.border }]}>
                      {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </Card>

            {/* V 轴：3D 出现多少（Avatar 可见度） */}
            <Card style={[styles.axisCard, { marginBottom: theme.spacing.md }]} accent={theme.colors.primary}>
              <View style={[styles.axisHead, { borderBottomColor: theme.colors.borderSoft, marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
                <Text style={[styles.axisTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>3D 出现多少</Text>
                <Text style={[styles.axisHint, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>我的形象在哪里出现、是否动起来</Text>
              </View>
              {V_OPTIONS.map((opt) => {
                const active = contract?.avatar === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={`3D 出现多少：${opt.label}。${opt.description}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => handleAxisChange({ avatar: opt.value })}
                    style={[
                      styles.axisOption,
                      active && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
                      { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                        {opt.label}
                      </Text>
                      {active && <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{opt.description}</Text>}
                    </View>
                    <View style={[styles.radio, active && { borderColor: theme.colors.primary }, { borderColor: theme.colors.border }]}>
                      {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </Card>

            {/* S 轴：家人或支持者（支持者模式） */}
            <Card style={[styles.axisCard, { marginBottom: theme.spacing.md }]} accent={theme.colors.primary}>
              <View style={[styles.axisHead, { borderBottomColor: theme.colors.borderSoft, marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
                <Text style={[styles.axisTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>家人或支持者</Text>
                <Text style={[styles.axisHint, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>是否允许他人参与你的进展</Text>
              </View>
              {S_OPTIONS.map((opt) => {
                const active = contract?.supporter_mode === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={`家人或支持者：${opt.label}。${opt.description}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => handleAxisChange({ supporter_mode: opt.value })}
                    style={[
                      styles.axisOption,
                      active && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
                      { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                        {opt.label}
                      </Text>
                      {active && <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{opt.description}</Text>}
                    </View>
                    <View style={[styles.radio, active && { borderColor: theme.colors.primary }, { borderColor: theme.colors.border }]}>
                      {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </Card>

            {/* X 轴：怎样用更舒服（使用模式预设） */}
            <Card style={[styles.axisCard, { marginBottom: theme.spacing.md }]} accent={theme.colors.primary}>
              <View style={[styles.axisHead, { borderBottomColor: theme.colors.borderSoft, marginBottom: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
                <Text style={[styles.axisTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>怎样用更舒服</Text>
                <Text style={[styles.axisHint, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>每种模式会一次调整上面多个选项</Text>
              </View>
              {USAGE_MODES.map((m) => {
                const active = currentUsageMode === m.mode;
                return (
                  <Pressable
                    key={m.mode}
                    accessibilityLabel={`使用方式：${m.name}。${m.desc}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      handleAxisChange(m.preset);
                      // 适老模式即时同步主题（spec A36.8）
                      setAppScheme(m.mode === 'senior-easy' ? 'senior' : 'system');
                    }}
                    style={[
                      styles.axisOption,
                      active && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
                      { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm },
                    ]}
                  >
                    <Glyph name={m.icon} size={theme.font.body} color={active ? theme.colors.primary : theme.colors.textTertiary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.primary : theme.colors.textPrimary }]}>
                        {m.name}
                      </Text>
                      <Text style={[ts.tertiary, { marginTop: theme.spacing.xs }]}>{m.desc}</Text>
                    </View>
                    <View style={[styles.radio, active && { borderColor: theme.colors.primary }, { borderColor: theme.colors.border }]}>
                      {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                    </View>
                  </Pressable>
                );
              })}
            </Card>

            <View style={[styles.noteBox, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderColor: theme.colors.borderSoft, borderLeftColor: theme.colors.green }]}>
              <Glyph name="shield" size={theme.font.body} color={theme.colors.green} />
              <Text style={[ts.tertiary, { flex: 1, lineHeight: theme.font.body * 1.5 }]}>
                默认是温和的「安静镜子」状态：我给一些小提示但不主动多事，只看你今天记下的事，3D 只在镜子页出现，没有支持者参与。最小数据路径下你仍能看到今天的简报和镜子。
              </Text>
            </View>
          </View>
        )}

        {tab === 'export' && (
          <View>
            <Text style={[styles.intro, ts.secondary]}>
              导出为可读报告 + 结构化机器文件，支持迁移，防止平台锁定。删除将覆盖原始记录、向量、缓存、摘要与派生模型，并生成可读证明。
            </Text>
            <Card style={{ marginBottom: theme.spacing.md }} accent={theme.colors.green}>
              <Text style={[ts.body, { fontWeight: '700' }]}>导出个人档案</Text>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs }]}>事实时间线、承诺、假设版本史、实验记录、决策账本 —— 导出为结构化 JSON，可迁移，防止平台锁定。</Text>
              <PrimaryButton small ghost title="导出本机档案" style={{ marginTop: theme.spacing.md, alignSelf: 'flex-start' }}
                onPress={doExport} />
            </Card>

            {/* V4.3 Task 25.5：Personal Model Package 导出（spec A25 / 数据可携权） */}
            <Card style={{ marginBottom: theme.spacing.md }} accent={theme.colors.green}>
              <Text style={[ts.body, { fontWeight: '700' }]}>导出个人模型包</Text>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs }]}>
                包含我注意到的候选猜想、经验、方法、跨领域原则、模型版本、纠正记录、服务契约与审计日志。
                适合迁移到其他工具，或留作本地备份。所有内容为结构化 JSON。
              </Text>
              <PrimaryButton
                small ghost
                title={exportingPackage ? '正在导出…' : '导出个人模型包'}
                style={{ marginTop: theme.spacing.md, alignSelf: 'flex-start' }}
                onPress={doExportPersonalModelPackage}
                disabled={exportingPackage}
                accessibilityLabel="导出 Personal Model Package，包含八类个人模型资产"
              />
            </Card>

            {/* 7.4 交互日志导出（spec A26 数据可携权 / §12.4 A19.4） */}
            <Card style={{ marginBottom: theme.spacing.md }} accent={theme.colors.green}>
              <Text style={[ts.body, { fontWeight: '700' }]}>交互日志导出</Text>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs }]}>
                你与 AI 参谋长的交互记录（审计日志）。交互数据可复制与删除 —— 导出为结构化 JSON，包含每条操作的时间、执行者与动作。
              </Text>
              <PrimaryButton
                small ghost
                title={exportingLog ? '正在导出…' : '导出交互日志'}
                style={{ marginTop: theme.spacing.md, alignSelf: 'flex-start' }}
                onPress={doExportInteractionLog}
                disabled={exportingLog}
              />
            </Card>

            <Card style={{ marginBottom: theme.spacing.md }} accent={theme.colors.red}>
              <Text style={[ts.body, { fontWeight: '700', color: theme.colors.red }]}>全部遗忘</Text>
              <Text style={[ts.secondary, { marginTop: theme.spacing.xs }]}>删除全部数据与派生模型，保留一份可验证的删除证明。此操作不可撤销，且会立即从服务器硬删除。</Text>
              <PrimaryButton small danger title={busy ? '正在注销…' : '彻底注销账号'} style={{ marginTop: theme.spacing.md, alignSelf: 'flex-start' }}
                onPress={askDelete} disabled={busy} />
            </Card>

            <Divider />
            <View style={[styles.noteBox, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderColor: theme.colors.borderSoft, borderLeftColor: theme.colors.primary }]}>
              <Glyph name="book" size={theme.font.body} color={theme.colors.textTertiary} />
              <Text style={[ts.tertiary, { flex: 1, lineHeight: theme.font.body * 1.5 }]}>
                非医疗声明：知行镜是个人反思、行为支持与生活组织工具，不替代心理咨询师、精神科医生或其他持证专业人员，不提供诊断、治疗或危机处置承诺。
              </Text>
            </View>
          </View>
        )}

        {/* 7.6 使用方式切换入口（spec §2.10 / Task 19.2 / A36.8） */}
        {tab === 'usage-mode' && (
          <View>
            <Text style={[styles.intro, ts.secondary]}>
              选择最适合你的使用方式。每种方式预设了主动程度、3D 出现程度和辅助选项。切换不会重置你的数据、项目和纠错记录 —— 随时可以换回来。
            </Text>
            {USAGE_MODES.map((m) => {
              const active = currentUsageMode === m.mode;
              return (
                <Pressable
                  key={m.mode}
                  accessibilityLabel={`选择使用方式：${m.name}。${m.desc}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => switchUsageMode(m.mode)}
                >
                  <Card
                    style={{ marginBottom: theme.spacing.md }}
                    accent={active ? theme.colors.primary : theme.colors.borderSoft}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                          <Glyph name={m.icon} size={theme.font.body} color={active ? theme.colors.primary : theme.colors.textTertiary} />
                          <Text style={[ts.body, { fontWeight: '700', fontSize: theme.font.body, color: active ? theme.colors.primary : theme.colors.textPrimary }]}>{m.name}</Text>
                          {active && <Tag text="当前" color={theme.colors.green} />}
                        </View>
                        <Text style={[ts.secondary, { marginTop: theme.spacing.xs, fontSize: theme.font.small }]}>{m.desc}</Text>
                        <Text style={[ts.tertiary, { marginTop: theme.spacing.xs, fontSize: theme.font.tiny }]}>
                          {m.mode === 'senior-easy'
                            ? '大字号 · 语音回读 · 一步一确认 · 3D 关闭'
                            : m.mode === 'voice-life'
                              ? '语音优先 · 3D 关闭'
                              : `主动 ${m.preset.proactivity} · 3D ${m.preset.avatar}`}
                        </Text>
                      </View>
                      <View style={[styles.radio, active && { borderColor: theme.colors.primary }, { borderColor: theme.colors.border }]}>
                        {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />}
                      </View>
                    </View>
                  </Card>
                </Pressable>
              );
            })}
            <View style={[styles.noteBox, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderColor: theme.colors.borderSoft, borderLeftColor: theme.colors.green }]}>
              <Glyph name="shield" size={theme.font.body} color={theme.colors.green} />
              <Text style={[ts.tertiary, { flex: 1, lineHeight: theme.font.body * 1.5 }]}>
                「长辈易用」模式会切换为大字号和浅色背景，并开启语音回读。其他模式恢复标准深色界面。所有模式都可以随时切换回去。
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: theme.spacing.xxl }} />
      </ScrollView>

      {/* Web 端自定义遗忘确认（Alert 在 Web 原生 confirm 体验差，改为应用内对话框） */}
      {forgetTarget && (
        <View style={[styles.forgetOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
          <View style={[
            styles.forgetCard,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderColor: theme.colors.borderSoft,
              ...(Platform.OS === 'web' ? { boxShadow: theme.shadow.card.boxShadow } : theme.shadow.card),
            },
          ]}>
            <Text style={[ts.title, { fontSize: theme.font.section }]}>遗忘这条记录？</Text>
            <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
              将同时删除其派生的向量、摘要与相关推断，并生成删除证明。此操作不可撤销。
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.lg, justifyContent: 'flex-end' }}>
              <PrimaryButton small ghost title="取消" onPress={() => setForgetTarget(null)} />
              <PrimaryButton small danger title="彻底遗忘" onPress={() => { s.forgetEvent(forgetTarget); setForgetTarget(null); }} />
            </View>
          </View>
        </View>
      )}

      {/* Web 端彻底注销确认 */}
      {confirmDelete && (
        <View style={[styles.forgetOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
          <View style={[
            styles.forgetCard,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderColor: theme.colors.borderSoft,
              ...(Platform.OS === 'web' ? { boxShadow: theme.shadow.card.boxShadow } : theme.shadow.card),
            },
          ]}>
            <Text style={[ts.title, { fontSize: theme.font.section, color: theme.colors.red }]}>彻底注销账号？</Text>
            <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
              将永久删除你的全部数据与派生模型，并生成删除证明。此操作不可撤销，会立即从服务器硬删除。
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.lg, justifyContent: 'flex-end' }}>
              <PrimaryButton small ghost title="取消" onPress={() => setConfirmDelete(false)} />
              <PrimaryButton small danger title="彻底注销" onPress={doDelete} />
            </View>
          </View>
        </View>
      )}

      {/* V4.3 Task 25.6：反向追溯 Modal —— 展示证据列表 / 候选认识列表 */}
      {reverseTrace && (
        <View style={[styles.forgetOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
          <View style={[
            styles.traceCard,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderColor: theme.colors.borderSoft,
              ...(Platform.OS === 'web' ? { boxShadow: theme.shadow.card.boxShadow } : theme.shadow.card),
            },
          ]}>
            <View style={[styles.traceHead, { borderBottomColor: theme.colors.borderSoft, paddingBottom: theme.spacing.sm }]}>
              <Text style={[ts.title, { fontSize: theme.font.section, flex: 1 }]} numberOfLines={2}>
                {reverseTrace.title}
              </Text>
              <Pressable
                onPress={() => setReverseTrace(null)}
                accessibilityLabel="关闭反向追溯窗口"
                accessibilityRole="button"
                style={[styles.traceCloseBtn, { borderRadius: theme.radius.full, backgroundColor: theme.colors.surfaceAlt }]}
              >
                <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.body, fontWeight: '600' }}>×</Text>
              </Pressable>
            </View>

            {traceLoading && (
              <View style={styles.traceBody}>
                <Text style={ts.tertiary}>正在追溯…</Text>
              </View>
            )}

            {!traceLoading && reverseTrace.kind === 'evidences' && (
              <View style={styles.traceBody}>
                {(traceData.evidences?.length ?? 0) === 0 && (
                  <Text style={ts.tertiary}>（找不到证据记录，可能已被删除）</Text>
                )}
                {traceData.evidences?.map((e) => (
                  <View key={e.id} style={[styles.traceRow, { borderBottomColor: theme.colors.borderSoft }]}>
                    <View style={[styles.traceDot, { backgroundColor: theme.colors.primary }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[ts.secondary, { color: theme.colors.textPrimary }]} numberOfLines={3}>
                        {e.content_ref ?? '(无内容摘要)'}
                      </Text>
                      <Text style={ts.tertiary}>
                        来源 {e.source} · {new Date(e.occurred_at).toLocaleDateString('zh-CN')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {!traceLoading && reverseTrace.kind === 'patterns' && (
              <View style={styles.traceBody}>
                {(traceData.patterns?.length ?? 0) === 0 && (
                  <Text style={ts.tertiary}>（这条事件还没有支持任何候选猜想）</Text>
                )}
                {traceData.patterns?.map((p) => {
                  const stateColor = p.review_state === 'reject' || p.review_state === 'stale'
                    ? theme.colors.textTertiary
                    : p.review_state === 'keep' ? theme.colors.green
                    : p.review_state === 'watch' ? theme.colors.amber
                    : theme.colors.primaryMuted;
                  return (
                    <View key={p.id} style={[styles.traceRow, { borderBottomColor: theme.colors.borderSoft }]}>
                      <View style={[styles.traceDot, { backgroundColor: theme.colors.primary }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[ts.secondary, { color: theme.colors.textPrimary }]} numberOfLines={3}>
                          {p.statement}
                        </Text>
                        <Tag text={p.review_state} color={stateColor} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.md }}>
              <PrimaryButton
                small ghost
                title="关闭"
                onPress={() => setReverseTrace(null)}
                accessibilityLabel="关闭反向追溯窗口"
              />
            </View>
          </View>
        </View>
      )}

      {/* V4.3 Task 9.4：保存成功 toast（spec A36.7 —— Toast 仅作次要反馈，2.2 秒后自动消失） */}
      {toastText && (
        <View style={[styles.toastWrap, { bottom: theme.spacing.xl, pointerEvents: 'none' }]}>
          <View style={[
            styles.toastCard,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderColor: theme.colors.green,
              ...(Platform.OS === 'web' ? { boxShadow: theme.shadow.card.boxShadow } : theme.shadow.card),
            },
          ]}>
            <Glyph name="check" size={theme.font.body} color={theme.colors.green} />
            <Text style={[styles.toastText, { color: theme.colors.green, fontSize: theme.font.small }]}>{toastText}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  pageTitle: { fontWeight: '800' },
  pageSub: { marginTop: 2 },
  tabRow: {
    flexDirection: 'row',
    borderWidth: 1,
  },
  tabScroll: {
    flexDirection: 'row',
  },
  tab: {
    alignItems: 'center',
  },
  intro: { lineHeight: 19, marginBottom: 12 },
  noteBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  auditRow: { flexDirection: 'row' },
  auditDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  forgetOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 99,
  },
  forgetCard: {
    padding: 20,
    borderWidth: 1,
    maxWidth: 340, width: '88%',
  },
  // V4.3 Task 9.1-9.4：7 轴服务契约 UI 样式（spec A36.1 触控目标 ≥48dp / A36.3 对比度）
  axisCard: {
    padding: 12,
  },
  axisHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    borderBottomWidth: 1,
  },
  axisTitle: {
    fontWeight: '700',
  },
  axisHint: {
    marginLeft: 12,
    textAlign: 'right',
    flexShrink: 1,
  },
  axisOption: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  dRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 8,
    minHeight: 48,
  },
  // V4.3 Task 9.4：保存成功 toast 样式（spec A36.7 仅作次要反馈）
  toastWrap: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', zIndex: 50,
  },
  toastCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 16,
    borderWidth: 1,
  },
  toastText: {
    fontWeight: '600',
  },
  // V4.3 Task 25.6：反向追溯 Modal 样式
  centerWrap: {
    alignItems: 'center', justifyContent: 'center',
  },
  traceCard: {
    padding: 16,
    borderWidth: 1,
    maxWidth: 380, width: '92%',
    maxHeight: '80%',
  },
  traceHead: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderBottomWidth: 1,
  },
  traceCloseBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
  },
  traceBody: {
    paddingVertical: 8, maxHeight: 360,
  },
  traceRow: {
    flexDirection: 'row', gap: 8, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  traceDot: {
    width: 8, height: 8, borderRadius: 4, marginTop: 6,
  },
});
