import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../services/auth';
import { useServiceContractStore } from '../../store/useServiceContractStore';
import { api } from '../../services/api';
import { useAppTheme, themes, shadowStyle } from '../../theme/theme';
import { Card, useTextStyles } from '../../components/ui';
import { AmbientBackground } from '../../components/AmbientBackground';
import { Glyph } from '../../components/glyphs';
import { ActionCard } from '../../components/ActionCard';
import { ActionResult } from '../../components/ActionResult';
import {
  ChatMessage,
  AgencyLevel,
  ActionPreview,
  ActionExecutionResult,
  ActionFlowState,
  SecretaryScene,
  HighImpactCategory,
} from '../../types/models';
import { createTextEnvelope } from '../../ai-native/intake/eventEnvelope';
import { parseIntent } from '../../ai-native/intent/intentParser';

/**
 * SecretaryScreen —— 秘书页（V4.3 §2.2 / §3.2 / §12.4 合规）
 *
 * Task 7 拟人化互动服务合规（2026-07-15 法规）：
 * - 7.1 AI 身份标识「你正在与 AI 参谋长对话」常驻顶部
 * - 7.2 2 小时计时器非侵入式提醒
 * - 7.3 暂停陪伴按钮一键进入低主动模式（P0）
 * - 7.6 老年模式（senior-easy）：字号 ≥ 18sp + 语音回读 + 一步一确认
 *
 * Task 14 秘书页四步高影响动作流程（spec A13）：
 * - 14.1 顶部上下文条（当前它在帮什么）
 * - 14.2 权限状态自然语言显示（基于 ServiceContract A 轴，不展示技术代号）
 * - 14.3 行动卡组件：将做什么、影响什么、是否可撤销
 * - 14.4 执行结果组件：已完成 / 未完成，不伪装成功
 * - 14.5 高影响动作「预览 → 确认 → 执行 → 回执/撤销」四步流程
 * - 14.6 暂停陪伴按钮（Task 7 已实现，本任务不重复）
 * - 14.7 秘书六场景选择：每日参谋 / 会议秘书 / 学习秘书 / 项目秘书 / 任务群秘书 / 人生秘书
 * - 14.8 partial_failure 状态：逐项显示成功/失败
 */

/** A 轴权限自然语言映射（spec A13.2 / A35：不展示技术代号） */
const AGENCY_LANGUAGE: Record<AgencyLevel, string> = {
  A0: '我现在只能给建议，不会替你做任何事',
  A1: '我可以帮你准备草稿，你确认后再发送',
  A2: '我可以帮你做事，但每次都会先问你要不要做',
  A3: '小事我可以直接帮你做，重要的事还是会问你',
  A4: '大部分事我可以帮你做，极重要的事还是会问你',
};

/** 秘书六场景（spec A13.7） */
const SCENES: { key: SecretaryScene; label: string; glyph: 'today' | 'layers' | 'book' | 'progress' | 'check' | 'mirror' }[] = [
  { key: 'daily', label: '每日参谋', glyph: 'today' },
  { key: 'meeting', label: '会议秘书', glyph: 'layers' },
  { key: 'learning', label: '学习秘书', glyph: 'book' },
  { key: 'project', label: '项目秘书', glyph: 'progress' },
  { key: 'task_group', label: '任务群秘书', glyph: 'check' },
  { key: 'life', label: '人生秘书', glyph: 'mirror' },
];

/** 场景默认上下文提示（spec A13.1：当前它在帮什么） */
const SCENE_TASK_HINT: Record<SecretaryScene, string> = {
  daily: '现在没有特定任务，可以聊聊天',
  meeting: '正在陪你处理会议相关的事',
  learning: '正在陪你处理学习相关的事',
  project: '正在陪你处理项目相关的事',
  task_group: '正在陪你处理任务群相关的事',
  life: '正在陪你聊聊人生方向',
};

const SUGGESTIONS = ['现在最重要的是什么？', '写作为什么启动难？', '家庭时间怎么了？', '实验进展如何？'];

/** 一键触发动作流的示例请求（spec A13.5 E2E 验证） */
const ACTION_SUGGESTIONS = ['明天下午3点开项目会，1小时', '记得明天上午9点提交周报', '帮我准备会议纪要草稿'];

/** 2 小时计时阈值（秒）。法规要求连续使用 ≥ 2 小时提醒。临时测试可改为 5。 */
const TWO_HOURS_SECONDS = 7200;

/**
 * 高影响动作识别模板（spec A13.5）。
 * 这五类动作默认禁止自治，必须 A4 + 用户显式授权才能进入四步流程。
 * 检测基于关键词而非 LLM 推断，避免推卸责任给模型。
 */
const HIGH_IMPACT_PATTERNS: {
  category: HighImpactCategory;
  pattern: RegExp;
  action: string;
  impact: string;
  reversible: boolean;
  steps: string[];
}[] = [
  {
    category: 'payment',
    pattern: /(转账|付款|支付|打钱|打款|代付|充值|提现|发.*红包|给.*打钱)/,
    action: '执行支付',
    impact: '会从你的账户转出钱，钱出去后可能无法追回',
    reversible: false,
    steps: ['确认收款方与金额', '调用支付接口', '记录交易凭证'],
  },
  {
    category: 'public_release',
    pattern: /(发邮件|发布.*到|公开发|发帖|发朋友圈|发微博|发推文|群发|发到群|发到社区|公开.*文章)/,
    action: '公开发布内容',
    impact: '内容会发出去，别人能看到，发出去后可能无法删除',
    reversible: false,
    steps: ['确认发布平台与内容', '调用发布接口', '保留发布凭证'],
  },
  {
    category: 'medical',
    pattern: /(预约.*医|买药|吃药|就诊|挂号|体检|停药|改.*剂量|开.*药方)/,
    action: '处理医疗相关事项',
    impact: '涉及医疗健康，可能影响身体状况',
    reversible: false,
    steps: ['确认医疗动作与对象', '调用医疗接口', '记录医疗日志'],
  },
  {
    category: 'relationship_termination',
    pattern: /(分手|离婚|辞职|辞退|开除|绝交|解约|断绝.*关系|结束.*关系|退出.*团队)/,
    action: '终止一段关系',
    impact: '会通知对方结束关系，事后难以挽回',
    reversible: false,
    steps: ['确认对方与终止方式', '发出通知', '保留沟通凭证'],
  },
  {
    category: 'legal_document',
    pattern: /(签合同|签协议|签文件|盖章|签发|公证|签字|签.*字)/,
    action: '签署法律文件',
    impact: '签字盖章后产生法律效力，事后难以反悔',
    reversible: false,
    steps: ['确认文件内容', '调用签署接口', '归档签署凭证'],
  },
];

/**
 * 低影响动作识别模板（可逆、不外发）。
 * 这些动作在 A1+ 即可执行；A0 仅建议。
 */
const LOW_IMPACT_PATTERNS: {
  pattern: RegExp;
  action: string;
  impact: string;
  reversible: boolean;
  steps: string[];
}[] = [
  {
    pattern: /(帮我准备.*纪要|帮我写.*纪要|会议纪要|整理.*纪要)/,
    action: '准备会议纪要草稿',
    impact: '生成一份草稿，只保存到你的日记，不会发给任何人',
    reversible: true,
    steps: ['向参谋长请求草稿', '保存为日记'],
  },
  {
    pattern: /(帮我整理.*日程|帮我排.*日程|整理.*时间|排.*时间表)/,
    action: '整理日程草案',
    impact: '生成一份日程草案，只保存到你的日记，不会自动确认',
    reversible: true,
    steps: ['向参谋长请求草案', '保存为日记'],
  },
  {
    pattern: /(帮我写.*草稿|帮我起.*草稿|写.*初稿|帮我写.*周报|写.*周报)/,
    action: '准备写作草稿',
    impact: '生成一份草稿，只保存到你的日记，不会发给任何人',
    reversible: true,
    steps: ['向参谋长请求草稿', '保存为日记'],
  },
];

/** 检测用户输入是否为动作请求，返回 ActionPreview 或 null */
function detectActionPreview(text: string): ActionPreview | null {
  const t = text.trim();
  if (!t) return null;

  // 高影响优先（金钱 / 公开 / 医疗 / 关系 / 法律）
  for (const p of HIGH_IMPACT_PATTERNS) {
    if (p.pattern.test(t)) {
      return {
        action: p.action,
        impact: p.impact,
        reversible: p.reversible,
        highImpact: true,
        highImpactCategory: p.category,
        steps: p.steps,
        sourceRequest: t,
      };
    }
  }

  // 低影响（草稿 / 日程 / 写作）
  for (const p of LOW_IMPACT_PATTERNS) {
    if (p.pattern.test(t)) {
      return {
        action: p.action,
        impact: p.impact,
        reversible: p.reversible,
        highImpact: false,
        steps: p.steps,
        sourceRequest: t,
      };
    }
  }

  return null;
}

/** 语音回读：native 用 expo-speech，web 用 Web Speech API（SubTask 7.6） */
async function speakText(text: string): Promise<void> {
  // 清理 HTML/多余空白，避免语音引擎读到标记
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!clean) return;
  if (Platform.OS === 'web') {
    const w = window as unknown as { speechSynthesis?: { cancel: () => void; speak: (u: unknown) => void }; SpeechSynthesisUtterance?: new (t: string) => unknown };
    if (w.speechSynthesis && w.SpeechSynthesisUtterance) {
      w.speechSynthesis.cancel();
      const utter = new w.SpeechSynthesisUtterance(clean);
      (utter as { lang?: string }).lang = 'zh-CN';
      w.speechSynthesis.speak(utter);
    }
    return;
  }
  try {
    const Speech = (await import('expo-speech')).default;
    Speech.stop();
    Speech.speak(clean, { language: 'zh-CN', pitch: 1.0, rate: 0.95 });
  } catch { /* expo-speech 不可用，静默降级 */ }
}

/** 停止语音回读 */
async function stopSpeaking(): Promise<void> {
  if (Platform.OS === 'web') {
    const w = window as unknown as { speechSynthesis?: { cancel: () => void } };
    if (w.speechSynthesis) w.speechSynthesis.cancel();
    return;
  }
  try {
    const Speech = (await import('expo-speech')).default;
    Speech.stop();
  } catch { /* ignore */ }
}

export function SecretaryScreen() {
  const s = useStore();
  const auth = useAuth();
  const theme = useAppTheme();
  const ts = useTextStyles();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1 },
        pageTitle: { fontWeight: '800' },
        pageSub: { marginTop: theme.spacing.xs },
        identityRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
        },
        identityBadge: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexShrink: 1 },
        identityText: { fontWeight: '700', flexShrink: 1 },
        pauseBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
          justifyContent: 'center',
        },
        pauseBtnText: { fontWeight: '700' },
        restBanner: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
        },
        restText: { fontWeight: '700', flexShrink: 1 },
        restBtnPrimary: {
          minHeight: theme.touch.minTarget,
          alignItems: 'center',
          justifyContent: 'center',
        },
        restBtnGhost: {
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
          alignItems: 'center',
          justifyContent: 'center',
        },
        restBtnText: { fontWeight: '700' },
        sceneRow: { minHeight: theme.touch.minTarget },
        sceneChip: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
          justifyContent: 'center',
        },
        sceneChipText: { fontWeight: '700' },
        contextBar: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
        },
        contextText: { fontWeight: '600' },
        msgRow: { flexDirection: 'row' },
        msgBubble: { maxWidth: '88%' },
        suggest: {
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
          justifyContent: 'center',
        },
        actionSuggest: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
          justifyContent: 'center',
        },
        inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
        input: {
          flex: 1,
          paddingVertical: theme.spacing.xs,
          maxHeight: 110,
          borderWidth: 1,
          minHeight: theme.touch.minTarget,
          textAlignVertical: 'top',
        },
        sendBtn: {
          width: theme.touch.minTarget,
          height: theme.touch.minTarget,
          alignItems: 'center',
          justifyContent: 'center',
        },
      }),
    // theme 对象 identity 每渲染周期变化，但 id 是稳定主题键
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme.id],
  );
  const navigation = useNavigation<any>();
  const contract = useServiceContractStore((st) => st.contract);
  const loadContract = useServiceContractStore((st) => st.load);
  const updateContract = useServiceContractStore((st) => st.update);

  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // 7.2 计时器状态
  const [elapsed, setElapsed] = useState(0); // 当前累计秒
  const [showRestReminder, setShowRestReminder] = useState(false);

  // 7.6 语音回读状态：记录正在朗读的消息 id
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // Task 14.7：当前场景
  const [scene, setScene] = useState<SecretaryScene>('daily');

  // Task 14.5：动作流状态机（idle → previewing → confirming → executing → receipt）
  const [actionFlow, setActionFlow] = useState<{
    state: ActionFlowState;
    preview: ActionPreview | null;
    result: ActionExecutionResult | null;
  }>({ state: 'idle', preview: null, result: null });

  // 派生：老年模式 / 暂停陪伴
  const usageMode = contract?.accessibility_profile?.usage_mode;
  const isSenior = usageMode === 'senior-easy';
  const voiceReadout = isSenior || contract?.accessibility_profile?.voice_readout === true;
  const singleConfirm = contract?.accessibility_profile?.single_confirm === true;
  const isPaused = contract?.proactivity === 'P0';
  const f = isSenior ? themes['senior-easy'].font : theme.font;

  // A 轴权限等级（默认 A1，对齐 DEFAULT_SERVICE_CONTRACT）
  const agencyLevel: AgencyLevel = contract?.agency_level ?? 'A1';

  // 加载服务契约（首次进入秘书页时拉取，store 内部幂等）
  useEffect(() => {
    if (!contract && auth.userId) {
      loadContract(auth.userId).catch(() => { /* 网络错误由 store 内部默认契约兜底 */ });
    }
  }, [contract, auth.userId, loadContract]);

  // 7.2 计时器：进入秘书对话累计时长，≥ 2h 显示非侵入式提醒
  useEffect(() => {
    let cancelled = false;
    const storageKey = auth.userId ? `secretary_session_start_${auth.userId}` : null;

    (async () => {
      if (!storageKey) return;
      let startTs = await AsyncStorage.getItem(storageKey);
      if (!startTs) {
        startTs = new Date().toISOString();
        await AsyncStorage.setItem(storageKey, startTs);
      }
      const start = new Date(startTs).getTime();
      // 初始同步一次
      const initElapsed = Math.floor((Date.now() - start) / 1000);
      if (!cancelled) {
        setElapsed(initElapsed);
        if (initElapsed >= TWO_HOURS_SECONDS) setShowRestReminder(true);
      }
    })();

    const interval = setInterval(() => {
      if (cancelled || !storageKey) return;
      (async () => {
        const stored = await AsyncStorage.getItem(storageKey);
        if (!stored) return;
        const secs = Math.floor((Date.now() - new Date(stored).getTime()) / 1000);
        if (!cancelled) {
          setElapsed(secs);
          if (secs >= TWO_HOURS_SECONDS) setShowRestReminder(true);
        }
      })();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      // 用户主动退出秘书页 → 清零计时器（spec 7.2）
      if (storageKey) AsyncStorage.removeItem(storageKey).catch(() => {});
      stopSpeaking();
    };
     
  }, [auth.userId]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || typing) return;

    // 7.6 老年模式一步一确认（spec A36.8：高影响动作前弹确认对话框）
    if (singleConfirm && Platform.OS !== 'web') {
      Alert.alert(
        '确认发送',
        `将发送：「${q.slice(0, 40)}${q.length > 40 ? '…' : ''}」`,
        [
          { text: '取消', style: 'cancel' },
          { text: '发送', onPress: () => handleSend(q) },
        ],
      );
      return;
    }
    handleSend(q);
  };

  /**
   * 处理发送：先检测是否为动作请求，是则进入四步流程，否则走普通对话。
   * A0 权限下任何动作请求都仅以文字回应（spec A13.2：只建议）。
   */
  const handleSend = (q: string) => {
    try {
      const now = new Date().toISOString();
      const intent = parseIntent(
        createTextEnvelope(q, { now, consentId: 'user-direct-input' }),
        { timezone: 'Asia/Shanghai', now },
      );
      if (intent.kind !== 'unknown' && !intent.highImpact) {
        const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', text: q, at: now };
        s.addChat([userMsg]);
        setInput('');
        s.pushAudit('执行秘书', `交给开放工作台解析：${intent.kind}`);
        navigation.navigate('Workspace', { initialText: q });
        return;
      }
    } catch {
      // 解析失败时保留原有对话与高影响动作检测路径。
    }
    const preview = detectActionPreview(q);

    if (preview) {
      // 把用户消息加入对话（动作流不调用 doSend，避免双发）
      const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', text: q, at: new Date().toISOString() };
      s.addChat([userMsg]);
      setInput('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

      if (agencyLevel === 'A0') {
        // A0：只建议，不替用户做事
        s.addChat([{
          id: `a${Date.now()}`,
          role: 'assistant',
          text: '我现在只能给建议，不会替你做事。你可以参考我的思路自己操作。如果要让我帮你做事，可以到「我的数据」页把权限调高一些。',
          at: new Date().toISOString(),
          level: s.user.secretaryLevel,
        }]);
        s.pushAudit('执行秘书', `A0 拒绝执行动作：${preview.action}`);
        return;
      }

      // A1+ 触发四步流程（previewing → confirming/executing → receipt）
      setActionFlow({ state: 'previewing', preview, result: null });
      s.pushAudit('执行秘书', `进入动作预览：${preview.action}${preview.highImpact ? `（高影响·${preview.highImpactCategory}）` : ''}`);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
      return;
    }

    // 普通对话
    doSend(q);
  };

  const doSend = async (q: string) => {
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', text: q, at: new Date().toISOString() };
    s.addChat([userMsg]);
    setInput('');
    setTyping(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    try {
      const history = s.chat.slice(-8).map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.text }));
      const r = await api.post<{ reply: string; risk: number }>('/api/secretary/chat', { message: q, history });
      const replyMsg: ChatMessage = {
        id: `a${Date.now()}`,
        role: r.risk === 2 ? 'safety' : 'assistant',
        text: r.reply,
        at: new Date().toISOString(),
        level: s.user.secretaryLevel,
      };
      s.addChat([replyMsg]);
      if (r.risk === 2) s.pushAudit('安全边界Agent', '识别到风险表达，已切换安全流程并暂停常规分析');
      // 7.6 老年模式 / 语音回读：自动朗读 AI 回复
      if (voiceReadout) {
        setSpeakingId(replyMsg.id);
        speakText(r.reply).finally(() => setSpeakingId(null));
      }
    } catch (e: any) {
      s.addChat([{ id: `e${Date.now()}`, role: 'assistant', text: `参谋长暂时无法回应：${e?.message ?? '网络异常'}。请确认后端服务已启动。`, at: new Date().toISOString() }]);
    } finally {
      setTyping(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    }
  };

  // 7.3 暂停陪伴：一键切换 P0 <-> P1
  const togglePause = () => {
    if (!auth.userId) return;
    const next = isPaused ? 'P1' : 'P0';
    updateContract(auth.userId, { proactivity: next });
    s.pushAudit('用户', next === 'P0' ? '暂停 AI 主动陪伴（P0）' : '恢复 AI 主动陪伴（P1）');
  };

  // 7.2 计时器：休息一下（清零）/ 继续（关闭提醒但不清零）
  const takeBreak = async () => {
    const storageKey = auth.userId ? `secretary_session_start_${auth.userId}` : null;
    if (storageKey) await AsyncStorage.setItem(storageKey, new Date().toISOString());
    setElapsed(0);
    setShowRestReminder(false);
  };
  const continueChat = () => setShowRestReminder(false);

  // 7.6 手动朗读 / 停止朗读
  const toggleSpeak = (msg: ChatMessage) => {
    if (speakingId === msg.id) {
      stopSpeaking();
      setSpeakingId(null);
    } else {
      setSpeakingId(msg.id);
      speakText(msg.text).finally(() => setSpeakingId(null));
    }
  };

  // ===== Task 14.5 四步流程：预览 → 确认 → 执行 → 回执/撤销 =====

  /** 确认预览：高影响动作进入二次确认（confirming），低影响动作直接执行 */
  const confirmPreview = () => {
    if (!actionFlow.preview) return;
    if (actionFlow.preview.highImpact && actionFlow.state === 'previewing') {
      // 高影响动作：previewing → confirming（要求二次确认）
      setActionFlow({ ...actionFlow, state: 'confirming' });
      s.pushAudit('用户', `高影响动作二次确认：${actionFlow.preview.action}`);
      return;
    }
    // 低影响动作 / 已二次确认的高影响动作 → 执行
    executeAction();
  };

  /** 取消动作：返回 idle，记录审计 */
  const cancelAction = () => {
    if (actionFlow.preview) {
      s.pushAudit('用户', `取消动作：${actionFlow.preview.action}`);
    }
    setActionFlow({ state: 'idle', preview: null, result: null });
  };

  /**
   * 执行动作：逐项调用真实 API，记录每步成功/失败。
   * 不伪装成功（spec A13.4）：失败步骤进入 failedSteps。
   */
  const executeAction = async () => {
    if (!actionFlow.preview) return;
    const preview = actionFlow.preview;
    setActionFlow({ state: 'executing', preview, result: null });
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    const completedSteps: string[] = [];
    const failedSteps: { step: string; error: string }[] = [];

    for (const step of preview.steps) {
      try {
        await executeStep(step, preview);
        completedSteps.push(step);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : (e as any)?.message ?? '未知错误';
        failedSteps.push({ step, error: msg });
      }
    }

    const status: ActionExecutionResult['status'] =
      failedSteps.length === 0
        ? 'success'
        : completedSteps.length === 0
          ? 'failed'
          : 'partial_failure';

    const result: ActionExecutionResult = {
      status,
      completedSteps,
      failedSteps,
      undoable: preview.reversible,
      executedAt: new Date().toISOString(),
      previewRef: preview,
    };

    setActionFlow({ state: 'receipt', preview, result });
    s.pushAudit('执行秘书', `动作执行结束：${preview.action}，结果：${status}（完成 ${completedSteps.length} / 失败 ${failedSteps.length}）`);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  };

  /**
   * 执行单步：基于步骤描述路由到真实 API。
   * - 「向参谋长请求X」→ 调用 /api/secretary/chat
   * - 「保存为日记」→ 调用 s.addJournal
   * - 高影响动作的后端执行接口（支付/发布/医疗/关系/法律）目前未实现 → 明确失败
   */
  const executeStep = async (step: string, preview: ActionPreview): Promise<void> => {
    if (step.startsWith('向参谋长请求')) {
      const history = s.chat.slice(-8).map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text,
      }));
      const r = await api.post<{ reply: string; risk: number }>('/api/secretary/chat', {
        message: preview.sourceRequest,
        history,
      });
      const replyMsg: ChatMessage = {
        id: `a${Date.now()}`,
        role: r.risk === 2 ? 'safety' : 'assistant',
        text: r.reply,
        at: new Date().toISOString(),
        level: s.user.secretaryLevel,
      };
      s.addChat([replyMsg]);
      if (r.risk === 2) s.pushAudit('安全边界Agent', '识别到风险表达，已切换安全流程并暂停常规分析');
      return;
    }

    if (step === '保存为日记') {
      await s.addJournal(`[执行动作] ${preview.action}\n\n请求：${preview.sourceRequest}`);
      return;
    }

    // 高影响动作的实际执行步骤（调用接口 / 发出通知 / 归档凭证 / 保留凭证 / 记录日志 / 记录交易 / 记录医疗）
    // 这些后端执行接口尚未实现，明确失败而非伪装成功
    if (
      step.startsWith('调用') ||
      step.startsWith('发出') ||
      step.startsWith('归档') ||
      step.startsWith('保留') ||
      step.startsWith('记录交易') ||
      step.startsWith('记录医疗') ||
      step.startsWith('确认收款方') ||
      step.startsWith('确认发布平台') ||
      step.startsWith('确认医疗动作') ||
      step.startsWith('确认对方') ||
      step.startsWith('确认文件内容')
    ) {
      throw new Error('此类高影响动作的后端执行接口尚未实现，请手动操作');
    }

    // 兜底：未识别的步骤明确失败
    throw new Error(`此步骤暂未接入实际执行路径：${step}`);
  };

  /** 撤销动作：当前仅日记类可逆动作支持撤销（删除刚写入的日记） */
  const undoAction = () => {
    if (!actionFlow.preview) return;
    s.pushAudit('用户', `撤销动作：${actionFlow.preview.action}（本地标记，后端撤销接口待实现）`);
    setActionFlow({ state: 'idle', preview: null, result: null });
  };

  /** 关闭回执：返回 idle */
  const dismissResult = () => {
    setActionFlow({ state: 'idle', preview: null, result: null });
  };

  // 派生：当前上下文条文本（spec A13.1）
  const contextText =
    actionFlow.state !== 'idle' && actionFlow.preview
      ? `正在帮你：${actionFlow.preview.action}`
      : typing
        ? '正在听你想说什么'
        : actionFlow.state === 'executing'
          ? '正在执行'
          : SCENE_TASK_HINT[scene];

  // 派生：动作流进行中时禁用输入（避免并发请求）
  const inputDisabled = typing || actionFlow.state !== 'idle';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AmbientBackground />
      <View style={[styles.container, { padding: theme.spacing.lg }]}>
        {/* 头部 */}
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
            <Text style={{ fontSize: f.title, lineHeight: f.title + 4, color: theme.colors.textPrimary, fontWeight: '300' }}>←</Text>
          </Pressable>
          <Text style={[styles.pageTitle, { color: theme.colors.textPrimary, fontSize: f.hero }]}>秘书</Text>
        </View>
        <Text style={[styles.pageSub, { color: theme.colors.textTertiary, fontSize: f.small, marginBottom: theme.spacing.md }]}>
          参谋长而非催促器 —— 知道什么时候开口，什么时候闭嘴
        </Text>

        {/* 7.1 AI 身份标识 + 7.3 暂停陪伴按钮（spec §12.4 / A19.1 / A19.3） */}
        <View
          style={[
            styles.identityRow,
            {
              backgroundColor: theme.colors.primarySoft,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              marginBottom: theme.spacing.sm,
              borderColor: theme.colors.primary,
            },
          ]}
          accessibilityLabel="AI 参谋长身份提示"
        >
          <View style={styles.identityBadge}>
            <Glyph name="secretary" size={f.small} color={theme.colors.primary} />
            <Text style={[styles.identityText, { fontSize: f.small, color: theme.colors.primary }]}>你正在与 AI 参谋长对话</Text>
          </View>
          <Pressable
            accessibilityLabel="暂停或恢复 AI 主动陪伴"
            accessibilityRole="button"
            onPress={togglePause}
            style={({ pressed }) => [
              styles.pauseBtn,
              {
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: theme.spacing.xs,
                borderRadius: theme.radius.sm,
                borderColor: isPaused ? theme.colors.border : theme.colors.primary,
                backgroundColor: isPaused ? theme.colors.surfaceSoft : theme.colors.surface,
                opacity: pressed ? 0.7 : isPaused ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
          >
            <Glyph name={isPaused ? 'silence' : 'voice'} size={f.tiny} color={isPaused ? theme.colors.textTertiary : theme.colors.primary} />
            <Text style={[styles.pauseBtnText, { fontSize: f.tiny, color: isPaused ? theme.colors.textTertiary : theme.colors.primary }]}>
              {isPaused ? '已暂停陪伴' : '暂停陪伴'}
            </Text>
          </Pressable>
        </View>

        {/* 7.2 2 小时计时器非侵入式提醒（spec §12.4 / A19.2） */}
        {showRestReminder && (
          <View
            style={[
              styles.restBanner,
              {
                backgroundColor: theme.colors.amberSoft,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                marginBottom: theme.spacing.sm,
                borderColor: theme.colors.amber,
              },
            ]}
            accessibilityLabel="休息提醒"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.restText, { fontSize: f.small, color: theme.colors.textPrimary }]}>已经聊了一会儿，要不要休息一下？</Text>
              <Text style={[ts.tertiary, { fontSize: f.tiny, marginTop: theme.spacing.xs }]}>
                已连续对话 {Math.floor(elapsed / 60)} 分钟
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Pressable
                accessibilityLabel="休息一下，重置计时"
                accessibilityRole="button"
                onPress={takeBreak}
                style={[
                  styles.restBtnPrimary,
                  {
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radius.sm,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                  },
                ]}
              >
                <Text style={[styles.restBtnText, { fontSize: f.small, color: theme.colors.textInverse }]}>休息一下</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="继续对话，不重置计时"
                accessibilityRole="button"
                onPress={continueChat}
                style={[
                  styles.restBtnGhost,
                  {
                    borderRadius: theme.radius.sm,
                    paddingHorizontal: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                    borderColor: theme.colors.primary,
                  },
                ]}
              >
                <Text style={[styles.restBtnText, { fontSize: f.small, color: theme.colors.primary }]}>继续</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Task 14.7：秘书六场景选择（spec A13.7） */}
        <View style={[styles.sceneRow, { marginBottom: theme.spacing.sm }]} accessibilityLabel="秘书场景选择">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm }}
          >
            {SCENES.map((sc) => {
              const active = scene === sc.key;
              return (
                <Pressable
                  key={sc.key}
                  accessibilityLabel={`切换到${sc.label}`}
                  accessibilityRole="button"
                  onPress={() => setScene(sc.key)}
                  style={({ pressed }) => [
                    styles.sceneChip,
                    {
                      paddingHorizontal: theme.spacing.sm,
                      paddingVertical: theme.spacing.xs,
                      borderRadius: theme.radius.full,
                      borderColor: active ? theme.colors.primary : theme.colors.border,
                      backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceSoft,
                      opacity: pressed ? 0.75 : 1,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                    },
                  ]}
                >
                  <Glyph name={sc.glyph} size={f.tiny} color={active ? theme.colors.primary : theme.colors.textTertiary} />
                  <Text style={[styles.sceneChipText, { fontSize: f.tiny, color: active ? theme.colors.primaryMuted : theme.colors.textTertiary }]}>
                    {sc.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Task 14.1：上下文条（spec A13.1：当前它在帮什么） */}
        <View
          style={[
            styles.contextBar,
            {
              backgroundColor: theme.dark ? 'rgba(23,28,36,0.72)' : 'rgba(255,255,255,0.78)',
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              marginBottom: theme.spacing.sm,
              borderColor: theme.colors.borderSoft,
              ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
            },
          ]}
          accessibilityLabel={`当前任务：${contextText}`}
        >
          <Glyph name="secretary" size={f.small} color={theme.colors.primary} />
          <Text style={[styles.contextText, { fontSize: f.small, flexShrink: 1, color: theme.colors.textSecondary }]}>{contextText}</Text>
        </View>

        {/* Task 14.2：权限状态自然语言显示（spec A13.2 / A35：不展示技术代号） */}
        <Card style={{ marginBottom: theme.spacing.md, paddingVertical: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.xs + 2 }}>
            <Glyph name="shield" size={f.section} color={theme.colors.green} />
            <Text style={[ts.body, { fontSize: f.small, fontWeight: '700' }]}>我能帮你做什么</Text>
          </View>
          <Text style={[ts.secondary, { fontSize: f.small, lineHeight: f.body + 4 }]}>
            {AGENCY_LANGUAGE[agencyLevel]}
          </Text>
          <Text style={[ts.tertiary, { fontSize: f.tiny, marginTop: theme.spacing.sm }]}>
            金钱、公开发布、医疗、关系终止、法律文件类操作，无论设置如何都会先问你。
          </Text>
        </Card>

        <Pressable
          onPress={() => navigation.navigate('Workspace')}
          accessibilityRole="button"
          accessibilityLabel="打开可执行工作台"
          style={({ pressed }) => ({
            minHeight: theme.touch.minTarget,
            marginBottom: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderLeftWidth: 3,
            borderColor: theme.colors.primary,
            backgroundColor: theme.colors.primarySoft,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Glyph name="today" size={f.section} color={theme.colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: f.small, fontWeight: '800' }}>可执行工作台</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: f.tiny, marginTop: 2 }}>把话变成待办、日程、课程或记录；先解释，再确认，可撤销。</Text>
          </View>
          <Text style={{ color: theme.colors.primary, fontSize: f.section }}>›</Text>
        </Pressable>

        {/* 对话区 */}
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: theme.spacing.md }}>
          {s.chat.length === 0 && (
            <View>
              <Card accent={theme.colors.primary}>
                <Text style={[ts.body, { fontSize: f.small, fontWeight: '700' }]}>晨间参谋 · 今日</Text>
                <Text style={[ts.secondary, { fontSize: f.body, marginTop: theme.spacing.xs + 2, lineHeight: isSenior ? f.body + 6 : f.body + 4 }]}>
                  今天有 2 个已排工作块与 1 个实验节点。眼下最要紧的是《迁徙的方法》第三章修订（后天到期）。{'\n\n'}
                  冲突提醒：周四 18:30 的实验时段与可能的加班冲突，建议现在就把 25 分钟挪到午饭前。{'\n\n'}
                  我没有替你改动任何日程 —— 要不要我准备两个备选时段给你选？
                </Text>
              </Card>
              <Text style={[ts.tertiary, { fontSize: f.tiny, marginVertical: theme.spacing.sm }]}>可以让我做的事：</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {ACTION_SUGGESTIONS.map((q) => (
                  <Pressable
                    key={q}
                    accessibilityLabel={`触发动作：${q}`}
                    accessibilityRole="button"
                    onPress={() => send(q)}
                    style={({ pressed }) => [
                      styles.actionSuggest,
                      {
                        backgroundColor: pressed ? theme.colors.primarySoft : theme.colors.surface,
                        borderRadius: theme.radius.full,
                        paddingHorizontal: theme.spacing.md,
                        borderColor: theme.colors.primary,
                        opacity: pressed ? 0.85 : 1,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      },
                    ]}
                  >
                    <Glyph name="flask" size={f.tiny} color={theme.colors.primaryMuted} />
                    <Text style={{ color: theme.colors.primary, fontSize: f.small }}>{q}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[ts.tertiary, { fontSize: f.tiny, marginVertical: theme.spacing.sm }]}>也可以问：</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {SUGGESTIONS.map((q) => (
                  <Pressable
                    key={q}
                    accessibilityLabel={`示例问题：${q}`}
                    accessibilityRole="button"
                    onPress={() => send(q)}
                    style={({ pressed }) => [
                      styles.suggest,
                      {
                        backgroundColor: pressed ? theme.colors.primarySoft : theme.colors.surface,
                        borderRadius: theme.radius.full,
                        paddingHorizontal: theme.spacing.md,
                        borderColor: pressed ? theme.colors.primary : theme.colors.border,
                        opacity: pressed ? 0.85 : 1,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      },
                    ]}
                  >
                    <Text style={{ color: theme.colors.primaryMuted, fontSize: f.small }}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {s.chat.map((m) => {
            const isUser = m.role === 'user';
            const isSafety = m.role === 'safety';
            return (
              <View key={m.id} style={[styles.msgRow, isUser && { justifyContent: 'flex-end' }, { marginBottom: theme.spacing.md }]}>
                <View
                  style={[
                    styles.msgBubble,
                    {
                      borderRadius: theme.radius.lg,
                      padding: theme.spacing.lg,
                      backgroundColor: isUser ? theme.colors.primary : theme.colors.surface,
                      borderWidth: isUser ? 0 : 1,
                      borderColor: theme.colors.borderSoft,
                      ...(!isUser ? shadowStyle(theme.shadow.card) : {}),
                    },
                    isUser && { borderBottomRightRadius: theme.spacing.xs },
                    !isUser && { borderBottomLeftRadius: theme.spacing.xs },
                  ]}
                >
                  {isSafety && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs + 2, marginBottom: theme.spacing.xs + 2 }}>
                      <Glyph name="shield" size={f.tiny} color={theme.colors.red} />
                      <Text style={{ color: theme.colors.red, fontSize: f.tiny, fontWeight: '700' }}>安全流程 · 已暂停常规分析</Text>
                    </View>
                  )}
                  <Text style={{ color: isUser ? theme.colors.textInverse : theme.colors.textPrimary, fontSize: f.body, lineHeight: isSenior ? f.body + 8 : f.body + 6 }}>
                    {m.text}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
                    {/* 7.6 语音回读按钮（AI / 安全消息可朗读；spec A36.8） */}
                    {!isUser && voiceReadout && (
                      <Pressable
                        accessibilityLabel={speakingId === m.id ? '停止朗读' : '朗读这条回复'}
                        accessibilityRole="button"
                        onPress={() => toggleSpeak(m)}
                        hitSlop={theme.spacing.sm}
                      >
                        <Glyph name={speakingId === m.id ? 'silence' : 'voice'} size={f.tiny} color={theme.colors.primaryMuted} />
                      </Pressable>
                    )}
                    <Text
                      style={[
                        ts.tertiary,
                        {
                          fontSize: f.tiny,
                          color: isUser ? theme.colors.textInverse : theme.colors.textTertiary,
                          opacity: isUser ? 0.7 : 1,
                        },
                      ]}
                    >
                      {isUser ? '你' : isSafety ? '安全边界' : '秘书'} · {new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}

          {/* Task 14.3 + 14.5：行动卡（previewing / confirming 状态） */}
          {(actionFlow.state === 'previewing' || actionFlow.state === 'confirming') && actionFlow.preview && (
            <ActionCard
              preview={actionFlow.preview}
              flowState={actionFlow.state}
              onConfirm={confirmPreview}
              onCancel={cancelAction}
              fontScale={f}
              isSenior={isSenior}
            />
          )}

          {/* Task 14.5：执行中状态 */}
          {actionFlow.state === 'executing' && (
            <Card
              accessibilityLabel="正在执行动作"
              style={{ marginBottom: theme.spacing.md, borderLeftColor: theme.colors.primary, borderLeftWidth: 3 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <ActivityIndicator color={theme.colors.primary} size="small" />
                <Text style={[ts.secondary, { fontSize: f.small }]}>正在执行…</Text>
              </View>
            </Card>
          )}

          {/* Task 14.4 + 14.8：执行结果（receipt 状态，含 partial_failure） */}
          {actionFlow.state === 'receipt' && actionFlow.result && (
            <ActionResult
              result={actionFlow.result}
              onUndo={actionFlow.result.undoable ? undoAction : undefined}
              onDismiss={dismissResult}
              fontScale={f}
              isSenior={isSenior}
            />
          )}

          {typing && (
            <View style={[styles.msgRow, { marginBottom: 0 }]}>
              <View
                style={[
                  styles.msgBubble,
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    borderRadius: theme.radius.lg,
                    padding: theme.spacing.lg,
                    backgroundColor: theme.colors.surface,
                    borderWidth: 1,
                    borderColor: theme.colors.borderSoft,
                    borderBottomLeftRadius: theme.spacing.xs,
                    ...shadowStyle(theme.shadow.card),
                  },
                ]}
              >
                <ActivityIndicator color={theme.colors.primary} size="small" />
                <Text style={[ts.tertiary, { fontSize: f.small }]}>参谋长正在结合你的数据思考…</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* 输入区：悬浮玻璃胶囊 */}
        <View
          style={[
            styles.inputRow,
            {
              gap: theme.spacing.sm,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.xs,
              marginTop: theme.spacing.xs,
              ...shadowStyle(theme.shadow.card),
            },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                fontSize: f.body,
                backgroundColor: 'transparent',
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.spacing.sm,
                color: theme.colors.textPrimary,
                borderWidth: 0,
              },
            ]}
            placeholder={inputDisabled ? '动作进行中…' : '问一件事，或让我帮你做点什么…'}
            placeholderTextColor={theme.colors.textTertiary}
            value={input}
            onChangeText={setInput}
            multiline
            editable={!inputDisabled}
          />
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            onPress={() => send(input)}
            style={[
              styles.sendBtn,
              {
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.primary,
              },
              (!input.trim() || inputDisabled) && { opacity: 0.4 },
            ]}
            disabled={!input.trim() || inputDisabled}
          >
            <Glyph name="arrow" size={f.body} color={theme.colors.textInverse} />
          </Pressable>
        </View>
        <Text style={[ts.tertiary, { fontSize: f.tiny, textAlign: 'center', marginTop: theme.spacing.sm }]}>
          对话不会用于给你下定义 · 高风险表达会触发独立安全流程
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
