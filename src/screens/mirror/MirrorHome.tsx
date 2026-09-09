import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Animated,
  Easing,
  PanResponder,
  useWindowDimensions,
  Alert,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../store/useStore';
import { useAppTheme, shadowStyle } from '../../theme/theme';
import { Glyph } from '../../components/glyphs';
import { AvatarCanvasFlagged } from '../../mirror3d/avatar/AvatarCanvasFlagged';
import { useAvatarV2Store } from '../../mirror3d/store/useAvatarV2Store';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { pickPhoto, takePhoto, useAudioCapture } from '../../services/mediaCapture';
import { assertEnvelopeTraceable, createPhotoEnvelope } from '../../ai-native/intake/eventEnvelope';
import { extractSelfReportedLifeSignals } from '../../ai-native/connectors/selfReportSignals';
import { useLifeSignalStore } from '../../ai-native/connectors/useLifeSignalStore';
import { TodayRecordStrip } from '../../components/TodayRecordStrip';
import { ContinuityInboxCard } from '../../components/ContinuityInboxCard';

type MirrorType = 'emotion' | 'health' | 'planning';

interface MirrorStatus {
  word: string;
  trend: string;
  desc: string;
  fresh: string;
  spark: number[] | null;
}

/* ═══════════════ 记忆吸入（V4.7 定型：900ms · 粒子≤0.6 · 胸口核心） ═══════════════ */

function MemoryInhale({ text, anim, startX, startY, endX, endY }: {
  text: string; anim: Animated.Value;
  startX: number; startY: number; endX: number; endY: number;
}) {
  const theme = useAppTheme();
  const particles = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => ({
        id: i,
        dx: (Math.random() - 0.5) * 36,
        dy: (Math.random() - 0.5) * 30,
        delay: i * 70 + 120,
        size: 2 + Math.random() * 2,
        color: i % 2 === 0 ? theme.colors.primary : theme.colors.textTertiary,
      })),
    [theme.colors.primary, theme.colors.textTertiary]
  );

  const textOpacity = anim.interpolate({ inputRange: [0, 0.1, 0.38, 1], outputRange: [0, 1, 1, 0.15] });
  const textScale = anim.interpolate({ inputRange: [0, 0.38, 1], outputRange: [1, 0.82, 0.4] });
  const midX = (startX - endX) * 0.25;
  const midY = (startY - endY) * 0.55 - 60;
  const textTranslateX = anim.interpolate({ inputRange: [0, 0.38, 1], outputRange: [0, midX, startX - endX] });
  const textTranslateY = anim.interpolate({ inputRange: [0, 0.38, 1], outputRange: [0, midY, startY - endY] });

  return (
    <View style={[styles.inhaleOverlay, { zIndex: 12, pointerEvents: 'none' }]}>
      <Animated.View
        style={[
          styles.inhaleTextWrap,
          {
            left: endX, top: endY,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.borderSoft,
            borderWidth: 1,
            opacity: textOpacity,
            transform: [{ translateX: textTranslateX }, { translateY: textTranslateY }, { scale: textScale }],
          },
        ]}
      >
        <Text style={[styles.inhaleText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
          {text}
        </Text>
      </Animated.View>
      {particles.map((p) => {
        const progress = anim.interpolate({
          inputRange: [0, p.delay / 900, 1],
          outputRange: [0, 0, 1],
          extrapolate: 'clamp',
        });
        const opacity = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.55, 0] });
        const scale = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1, 0.2] });
        const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [startX - endX + p.dx * 0.45, p.dx] });
        const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [startY - endY + p.dy * 0.45, p.dy] });
        return (
          <Animated.View
            key={p.id}
            style={[
              styles.inhaleParticle,
              { left: endX, top: endY, width: p.size, height: p.size, borderRadius: p.size / 2, backgroundColor: p.color, opacity, transform: [{ translateX }, { translateY }, { scale }] },
            ]}
          />
        );
      })}
    </View>
  );
}

/* ═══════════════ 指数签 IndexPill（V4.7 定型：无边框 · 2px 色条 · 微趋势） ═══════════════ */

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const poly = points.map((v, i) => `${(i * 40) / (points.length - 1)},${14 - v * 12}`).join(' ');
  return (
    <Svg width={40} height={14}>
      <Polyline points={poly} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

function IndexPill({ type, label, glyph, status, onPress, narrow = false }: {
  type: MirrorType; label: string; glyph: 'heart' | 'body' | 'compass';
  status: MirrorStatus; onPress: () => void; narrow?: boolean;
}) {
  const theme = useAppTheme();
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const colorMap = { emotion: theme.colors.l2, health: theme.colors.l1, planning: theme.colors.l4 };
  const bgMap = { emotion: theme.colors.violetSoft, health: theme.colors.tealSoft, planning: theme.colors.amberSoft };
  const color = colorMap[type];
  const softBg = bgMap[type];

  // V4.7设计规范：透明轻盈风格，无边框无阴影，仅2px色条+hover态淡色背景
  // 窄栏模式（手机端右栏）：优化字号确保可读性
  const pillPaddingH = narrow ? 6 : 12;
  const pillPaddingV = narrow ? 8 : 11;
  const labelSize = narrow ? 10 : 11;
  const wordSize = narrow ? 16 : 17;
  const trendPadH = narrow ? 0 : 6;
  const trendPadV = narrow ? 2 : 2;
  const trendSize = narrow ? 9 : 10;
  const descSize = narrow ? 10 : 11;
  const iconSize = narrow ? 12 : 14;
  const barWidth = 2;
  const barInset = narrow ? 3 : 4;
  const barOpacity = 0.85;
  const minH = narrow ? 68 : 72;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, tension: 300, friction: 30, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, tension: 300, friction: 30, useNativeDriver: true }).start()}
      accessibilityLabel={`${label}：${status.word}，${status.desc}`}
      accessibilityRole="button"
      style={({ pressed }) => ({
        position: 'relative',
        flex: narrow ? 1 : undefined,
        minWidth: 0,
        textAlign: 'left',
        backgroundColor: pressed ? softBg : 'transparent',
        borderRadius: theme.radius.md,
        paddingLeft: pillPaddingH + barWidth + 2,
        paddingRight: pillPaddingH,
        paddingTop: pillPaddingV,
        paddingBottom: pillPaddingV,
        minHeight: minH,
        opacity: pressed ? 0.72 : 1,
        overflow: 'hidden',
        ...(Platform.OS === 'web' ? {
          transition: 'background-color 0.15s cubic-bezier(0.22,1,0.36,1), transform 0.15s cubic-bezier(0.22,1,0.36,1)',
          cursor: 'pointer',
        } : {}),
      })}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }], width: '100%', minWidth: 0, overflow: 'hidden' }}>
        {/* 2px状态色条（V4.7规范：left:4px, top/bottom:12px, width:2px, opacity:0.85） */}
        <View style={{
          position: 'absolute',
          left: barInset,
          top: barInset + 2,
          bottom: barInset + 2,
          width: barWidth,
          borderRadius: 1,
          backgroundColor: color,
          opacity: barOpacity,
        }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <Glyph name={glyph} size={iconSize} color={color} />
          <Text style={{ fontSize: labelSize, fontWeight: '600', letterSpacing: 0.8, color: theme.colors.textTertiary }}>{label}</Text>
        </View>
        <Text style={{ fontSize: wordSize, fontWeight: '700', color, lineHeight: wordSize * 1.15, letterSpacing: 0.1, marginBottom: 3 }} numberOfLines={1}>
          {status.word}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ backgroundColor: narrow ? 'transparent' : softBg, paddingHorizontal: trendPadH, paddingVertical: trendPadV, borderRadius: theme.radius.sm, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: trendSize, fontWeight: '600', color }}>{status.trend}</Text>
          </View>
        </View>
        {!narrow && (
          <Text style={{
            fontSize: descSize,
            color: theme.colors.textSecondary,
            fontWeight: '400',
            lineHeight: descSize * 1.35,
            marginTop: 3,
          }} numberOfLines={2}>
            {status.desc}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

/* ═══════════════ 主界面（落地镜台 · V4.7） ═══════════════ */

export function MirrorHome() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const s = useStore();
  const audioCapture = useAudioCapture();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  /* v2 数字孪生 */
  const avatarProfile = useAvatarV2Store((state) => state.profile);
  const avatarHydrated = useAvatarV2Store((state) => state.hydrated);
  const applyAvatarPatch = useAvatarV2Store((state) => state.applyPatch);
  const tickAvatarExpiry = useAvatarV2Store((state) => state.tickExpiry);
  const ingestLifeSignals = useLifeSignalStore((state) => state.ingest);

  const [textInput, setTextInput] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'locked'>('idle');
  const [voiceCancelPending, setVoiceCancelPending] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [showSaveFeedback, setShowSaveFeedback] = useState(false);
  const [saveFeedbackText, setSaveFeedbackText] = useState('已收进今天');
  const [inhaleVisible, setInhaleVisible] = useState(false);
  const [inhaleKey, setInhaleKey] = useState(0);
  const [inhaleText, setInhaleText] = useState('');
  /** Avatar交互触发：递增数字触发动画，避免事件冒泡问题 */
  const [avatarTouchTrigger, setAvatarTouchTrigger] = useState(0);
  const [avatarAckTrigger, setAvatarAckTrigger] = useState(0);
  const feedbackAnim = useRef(new Animated.Value(0)).current;
  const inhaleAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoEventId = useRef<string | null>(null);
  const voiceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const voicePressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceCaptureActive = useRef(false);
  const waveAnims = useRef(Array.from({ length: 18 }, () => new Animated.Value(0.3))).current;

  // V4.7布局规范：所有屏幕尺寸都使用「左侧舞台+右侧垂直指数栏」
  // 手机端（<420px）：右栏114px确保文字可读；平板/桌面：右栏168px
  const isCompactPhone = screenWidth < 420;
  const isTablet = screenWidth >= 600;
  const railWidth = isCompactPhone ? 114 : (isTablet ? 168 : 128);
  const stageFlex = isCompactPhone ? 1 : (isTablet ? 1 : 1);

  useEffect(() => {
    if (isFocused && avatarHydrated) tickAvatarExpiry();
  }, [isFocused, avatarHydrated, tickAvatarExpiry]);



  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (voiceTimer.current) clearInterval(voiceTimer.current);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  /* 录音波形动画 */
  useEffect(() => {
    if (voiceState === 'idle') {
      waveAnims.forEach((a) => a.stopAnimation());
      return;
    }
    const loops = waveAnims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(a, { toValue: 0.5 + Math.random() * 0.5, duration: 320 + i * 24, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(a, { toValue: 0.25 + Math.random() * 0.2, duration: 300 + i * 18, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [voiceState, waveAnims]);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 9) return '早上好';
    if (hour < 12) return '上午好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    if (hour < 22) return '晚上好';
    return '夜深了';
  };

  const nowItem = () => {
    const today = new Date().toDateString();
    const todayCommitment = s.commitments.find((c) => c.deadline && new Date(c.deadline).toDateString() === today && c.status === 'active');
    if (todayCommitment) return { text: todayCommitment.statement };
    const activeProject = s.projects.find((p) => p.status === 'active');
    if (activeProject) return { text: activeProject.name };
    return null;
  };

  const currentItem = nowItem();

  const getMirrorStates = (): Record<MirrorType, MirrorStatus> => {
    const eventCount = s.events.length;
    const activeCount = s.projects.filter((p) => p.status === 'active').length;
    return {
      emotion:
        eventCount > 2
          ? { word: '有些记录', trend: '趋于平静', desc: '记录勾勒情绪轮廓', fresh: '2 小时前更新', spark: [0.5, 0.62, 0.45, 0.7, 0.55, 0.66, 0.58, 0.48] }
          : { word: '还看不清', trend: '待观察', desc: '多记录看模式', fresh: '数据较少', spark: null },
      health: { word: '待接入', trend: '未授权', desc: '连接数据看趋势', fresh: '随时可断开', spark: null },
      planning:
        activeCount > 0
          ? { word: `${activeCount}件事`, trend: '进行中', desc: '当前活跃事项', fresh: '刚刚更新', spark: null }
          : { word: '无事压顶', trend: '轻松', desc: '今日无必做', fresh: '刚刚更新', spark: null },
    };
  };

  const mirrors = getMirrorStates();

  /* ───── 保存反馈（含撤回 5s） ───── */
  const triggerSaveFeedback = useCallback((text: string, eventId: string | null) => {
    undoEventId.current = eventId;
    setSaveFeedbackText(text);
    setShowSaveFeedback(true);
    feedbackAnim.setValue(0);
    Animated.timing(feedbackAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      Animated.timing(feedbackAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setShowSaveFeedback(false);
        undoEventId.current = null;
      });
    }, 5000);
  }, [feedbackAnim]);

  const handleUndo = useCallback(async () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    const id = undoEventId.current;
    undoEventId.current = null;
    setShowSaveFeedback(false);
    if (id) {
      await s.forgetEvent(id);
    }
    setSaveFeedbackText('已撤回 · 内容没有留下');
    setShowSaveFeedback(true);
    feedbackAnim.setValue(1);
    setTimeout(() => {
      Animated.timing(feedbackAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setShowSaveFeedback(false));
    }, 2200);
  }, [feedbackAnim, s]);

  /* ───── 吸入动效（900ms） ───── */
  const triggerInhale = useCallback((text: string) => {
    setInhaleText(text.slice(0, 16));
    setInhaleKey((k) => k + 1);
    setInhaleVisible(true);
    inhaleAnim.setValue(0);
    Animated.timing(inhaleAnim, { toValue: 1, duration: 900, easing: Easing.out(Easing.exp), useNativeDriver: true }).start(() => {
      setInhaleVisible(false);
    });
  }, [inhaleAnim]);

  /* ───── 记录：数字孪生补丁（user_check_in 证据） ───── */
  const noteCheckInPatch = useCallback(() => {
    if (!avatarHydrated) return;
    applyAvatarPatch({
      patchId: `patch_${Date.now()}`,
      patchType: 'daily_state',
      changes: { socialOpenness: 0.04, energy: 0.02 },
      evidenceTypes: ['user_check_in'],
      confidence: 0.52,
      expiresInHours: 10,
      reversible: true,
      createdAt: new Date().toISOString(),
    });
  }, [applyAvatarPatch, avatarHydrated]);

  const captureEventIdAfterAdd = async (before: number) => {
    // addJournal 生成 j-<ts>，取最新一条
    const ev = useStore.getState().events[0];
    return ev && ev.id.startsWith('j-') ? ev.id : null;
  };

  const handleSubmitText = async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput('');
    await s.addJournal(text);
    const id = await captureEventIdAfterAdd(0);
    if (id) {
      const observations = extractSelfReportedLifeSignals(text, id);
      if (observations.length > 0) ingestLifeSignals(observations);
    }
    triggerSaveFeedback('已收进今天', id);
    triggerInhale(text);
    noteCheckInPatch();
    setAvatarAckTrigger((v) => v + 1);
  };

  const handlePhoto = async () => {
    try {
      const mode = await choosePhotoSource();
      if (!mode) return;
      const photo = mode === 'camera' ? await takePhoto() : await pickPhoto();
      if (!photo) return;
      const envelope = createPhotoEnvelope(
        {
          sourceRef: photo.sourceRef,
          width: photo.width,
          height: photo.height,
          mimeType: photo.mimeType,
          origin: mode,
        },
        { consentId: photo.consentId },
      );
      assertEnvelopeTraceable(envelope);
      await s.addJournal([
        '📷 照片记录',
        `信封：${envelope.id} · 隐私级别 ${envelope.privacyLevel}（仅不可逆引用凭据，不上传路径或像素）`,
        `来源：${mode === 'camera' ? '相机拍摄' : '相册选择'} · ${photo.width} × ${photo.height} · ${photo.mimeType}`,
        `引用凭据：${photo.sourceRef}`,
        '保存去向：今日日记 · 5 秒内可撤回',
      ].join('\n'), {
        // Persist the opaque capture receipt itself as the event provenance;
        // TodayRecordStrip derives the human label from the prefix.
        sourceRef: photo.sourceRef,
        consentId: photo.consentId,
        titlePrefix: '照片记录',
        sensitivity: 'sensitive',
      });
      const id = await captureEventIdAfterAdd(0);
      triggerSaveFeedback('照片已保存 · 可补一句说明', id);
      triggerInhale('📷 照片');
      noteCheckInPatch();
      setAvatarAckTrigger((v) => v + 1);
      setTextInput('📷 ');
    } catch (error) {
      const message = error instanceof Error ? error.message : '照片获取失败';
      triggerSaveFeedback(`没有保存 · ${message}`, null);
      if (Platform.OS !== 'web') Alert.alert('没有保存照片', message);
    }
  };

  const choosePhotoSource = (): Promise<'camera' | 'library' | null> =>
    new Promise((resolve) => {
      if (Platform.OS === 'web') {
        const useCamera = typeof window !== 'undefined' && window.confirm('拍摄新照片？\n「确定」调用相机，「取消」从相册选择');
        resolve(useCamera ? 'camera' : 'library');
        return;
      }
      Alert.alert('留下这张照片', '选择照片来源', [
        { text: '拍摄新照片', onPress: () => resolve('camera') },
        { text: '从相册选择', onPress: () => resolve('library') },
        { text: '取消', style: 'cancel' as const, onPress: () => resolve(null) },
      ]);
    });

  /* ───── 语音手势：点按 / 长按180ms / 上滑40px锁定 / 左滑60px取消 ───── */
  const beginVoiceTimer = () => {
    setVoiceSeconds(0);
    if (voiceTimer.current) clearInterval(voiceTimer.current);
    const t0 = Date.now();
    voiceTimer.current = setInterval(() => setVoiceSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
  };

  const beginVoiceRecording = async () => {
    if (voiceCaptureActive.current) return;
    voiceCaptureActive.current = true;
    try {
      await audioCapture.start();
      beginVoiceTimer();
      setVoiceState('recording');
    } catch (error) {
      voiceCaptureActive.current = false;
      const message = error instanceof Error ? error.message : '录音无法开始';
      triggerSaveFeedback(`没有录音 · ${message}`, null);
      if (Platform.OS !== 'web') Alert.alert('录音没有开始', message);
    }
  };

  const stopVoice = useCallback(async (commit: boolean) => {
    if (voiceTimer.current) clearInterval(voiceTimer.current);
    setVoiceCancelPending(false);
    setVoiceState('idle');
    if (!voiceCaptureActive.current) return;
    voiceCaptureActive.current = false;
    try {
      if (!commit) {
        await audioCapture.cancel();
        triggerSaveFeedback('录音已取消 · 内容没有留下', null);
        return;
      }
      const captured = await audioCapture.stop();
      const seconds = Math.max(0, Math.round(captured.durationMs / 1000));
      const label = `🎤 语音 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      await s.addJournal([
        '🎤 语音记录',
        `引用凭据：${captured.sourceRef}`,
        `时长：${captured.durationMs}ms`,
        `类型：${captured.mimeType}`,
        '隐私边界：事件同步不包含录音文件路径或音频字节；原始录音只存在应用本地文件。',
      ].join('\n'), {
        sourceRef: captured.sourceRef,
        consentId: captured.consentId,
        titlePrefix: '语音记录',
        sensitivity: 'sensitive',
      });
      const id = await captureEventIdAfterAdd(0);
      triggerSaveFeedback('语音已真实保存', id);
      triggerInhale(label);
      noteCheckInPatch();
      setAvatarAckTrigger((v) => v + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : '录音保存失败';
      triggerSaveFeedback(`没有保存 · ${message}`, null);
      if (Platform.OS !== 'web') Alert.alert('录音没有保存', message);
    }
  }, [audioCapture, noteCheckInPatch, s, triggerInhale, triggerSaveFeedback]);

  const voiceCancelPendingRef = useRef(false);
  useEffect(() => { voiceCancelPendingRef.current = voiceCancelPending; }, [voiceCancelPending]);

  const voicePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        voicePressStart.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
        setVoiceCancelPending(false);
        // 长按阈值 180ms 进入说话态
        longPressTimer.current = setTimeout(() => {
          void beginVoiceRecording();
        }, 180);
      },
      onPanResponderMove: (evt) => {
        const start = voicePressStart.current;
        if (!start) return;
        const dy = start.y - evt.nativeEvent.pageY;
        const dx = start.x - evt.nativeEvent.pageX;
        setVoiceState((prev) => {
          if (prev === 'recording' && dy > 40) return 'locked'; // 上滑 40px 锁定
          return prev;
        });
        setVoiceCancelPending(dx > 60); // 左滑 60px 取消预备
      },
      onPanResponderRelease: () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        setVoiceState((prev) => {
          if (prev === 'locked') return prev; // 锁定态由按钮收尾
          if (prev === 'recording') {
            void stopVoice(!voiceCancelPendingRef.current);
            return 'idle';
          }
          // 点按（未达到长按阈值）：开始/结束切换
          void beginVoiceRecording();
          return prev;
        });
      },
      onPanResponderTerminate: () => {
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        setVoiceState((prev) => {
          if (prev === 'recording') void stopVoice(false);
          return prev === 'recording' ? 'idle' : prev;
        });
      },
    })
  ).current;

  /* 落地镜台布局：V4.7规范 - 所有尺寸「左侧舞台+右侧垂直窄栏」
     手机端390px：左舞台flex:1 + 右栏114px（紧凑间距最大化舞台宽度）；桌面：左舞台flex:1 + 右栏168px */
  const stageHorizontalPadding = isCompactPhone ? 7 : (isTablet ? 20 : 14);
  const topBarPaddingH = isCompactPhone ? theme.spacing.md : theme.spacing.lg;
  const railGap = isCompactPhone ? 6 : 10;
  const railPaddingL = isCompactPhone ? 2 : 10;

  const inhaleStartX = screenWidth / 2;
  const inhaleStartY = screenHeight - insets.bottom - 72;
  // 胸口位置：舞台中心偏左（人物所在位置），约屏幕宽度38%处
  const inhaleEndX = screenWidth * (isCompactPhone ? 0.32 : 0.28);
  const inhaleEndY = screenHeight * (isCompactPhone ? 0.40 : 0.45);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 顶部感知流：平面编辑式页眉，避免悬浮玻璃卡片。 */}
      <View
        style={(() => {
          const st: any[] = [
            styles.awarenessBar,
            {
              marginHorizontal: isCompactPhone ? theme.spacing.lg : (isTablet ? 20 : 16),
              marginTop: insets.top + theme.spacing.sm,
              paddingTop: theme.spacing.xs,
              paddingHorizontal: 0,
              paddingBottom: theme.spacing.sm,
              backgroundColor: 'transparent',
              borderBottomWidth: 1,
              borderColor: theme.colors.borderSoft,
            },
          ];
          return st;
        })()}
      >
        <View style={styles.awarenessContent}>
          <View style={styles.topLeft}>
            <Text style={[styles.dateText, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>
              {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}
            </Text>
            {currentItem ? (
              <Pressable
                style={({ pressed }) => [styles.awarenessItem, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => navigation.navigate('Workspace')}
                accessibilityLabel={`打开工作台处理：${currentItem.text}`}
                accessibilityRole="button"
              >
                <View style={[styles.awarenessPill, { backgroundColor: 'transparent', paddingHorizontal: 0 }]}>
                  <Glyph name="pin" size={10} color={theme.colors.primaryMuted} />
                  <Text style={[styles.awarenessText, { color: theme.colors.textSecondary, fontSize: theme.font.small }]} numberOfLines={1}>
                    {currentItem.text}
                  </Text>
                </View>
              </Pressable>
            ) : (
              <Text style={[styles.greeting, { color: theme.colors.textTertiary, fontSize: theme.font.small }]}>
                {greeting()} · 此刻没有需要你看的事
              </Text>
            )}
          </View>

          <View style={styles.topActions}>
            <Pressable
              onPress={() => navigation.navigate('Workspace')}
              style={({ pressed }) => [
                styles.iconAction,
                { opacity: pressed ? 0.6 : 0.85, transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
              accessibilityLabel="开放工作台"
              accessibilityRole="button"
              hitSlop={12}
            >
              <View style={[styles.iconActionBg, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.borderSoft }]}>
                <Glyph name="today" size={18} color={theme.colors.primary} />
              </View>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Secretary')}
              style={({ pressed }) => [
                styles.iconAction,
                { opacity: pressed ? 0.6 : 0.85, transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
              accessibilityLabel="秘书"
              accessibilityRole="button"
              hitSlop={12}
            >
              <View style={[styles.iconActionBg, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.borderSoft }]}>
                <Glyph name="secretary" size={18} color={theme.colors.textSecondary} />
              </View>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Sovereignty')}
              style={({ pressed }) => [
                styles.iconAction,
                { opacity: pressed ? 0.6 : 0.85, transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
              accessibilityLabel="我的数据"
              accessibilityRole="button"
              hitSlop={12}
            >
              <View style={[styles.iconActionBg, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.borderSoft }]}>
                <Glyph name="data" size={18} color={theme.colors.textSecondary} />
              </View>
            </Pressable>
          </View>
        </View>
      </View>

      <View
        style={{
          marginHorizontal: isCompactPhone ? 16 : (isTablet ? 20 : 16),
          marginTop: 8,
          zIndex: 2,
        }}
      >
        <ContinuityInboxCard
          target="mobile"
          compact
          hideWhenEmpty
          onContinue={(handoff) => {
            const routeName = handoff.payload.route ?? 'Workspace';
            navigation.navigate(
              routeName,
              handoff.payload.text ? { initialText: handoff.payload.text } : undefined,
            );
          }}
        />
      </View>

      {/* 中段：手机为完整舞台 + 下方摘要；宽屏保留左右结构。 */}
      <View style={[styles.mainArea, {
        paddingHorizontal: stageHorizontalPadding,
        flexDirection: isCompactPhone ? 'column' : 'row',
        paddingVertical: isCompactPhone ? 4 : 6,
        gap: railGap,
      }]}>
        <View style={[styles.stageZone, { flex: 1, flexShrink: 1, flexGrow: 1, marginBottom: 0 }]}>
          <Pressable
            onPress={() => {
              setAvatarTouchTrigger((v) => v + 1);
              navigation.navigate('Mirror');
            }}
            style={[
              styles.stagePress,
              {
                borderRadius: theme.radius.xl,
                overflow: 'hidden',
                backgroundColor: 'transparent',
                borderWidth: 0,
              },
            ]}
            accessibilityLabel="现在的我"
            accessibilityRole="button"
          >
            <View style={styles.stageCanvas}>
              <AvatarCanvasFlagged
                profile={avatarProfile}
                paused={!isFocused}
                active={isFocused}
                fill
                style={{ backgroundColor: 'transparent' }}
                triggerTouchReaction={avatarTouchTrigger}
                triggerAcknowledge={avatarAckTrigger}
              />
            </View>
          </Pressable>
        </View>

        {/* 状态摘要：手机横排，宽屏纵排。 */}
        <View style={[
          styles.indexRail,
          {
            width: isCompactPhone ? '100%' : railWidth,
            flexBasis: isCompactPhone ? 80 : railWidth,
            flexShrink: 0,
            flexGrow: 0,
            paddingLeft: isCompactPhone ? 0 : railPaddingL,
            flexDirection: isCompactPhone ? 'row' : 'column',
            justifyContent: 'center',
            gap: isCompactPhone ? 2 : railGap,
            paddingTop: 0,
            paddingBottom: 0,
            overflow: 'visible',
          },
        ]}>
          <IndexPill narrow={isCompactPhone} type="emotion" label="情绪" glyph="heart" status={mirrors.emotion} onPress={() => navigation.navigate('Mirror')} />
          <IndexPill narrow={isCompactPhone} type="health" label="健康" glyph="body" status={mirrors.health} onPress={() => navigation.navigate('Mirror')} />
          <IndexPill narrow={isCompactPhone} type="planning" label="规划" glyph="compass" status={mirrors.planning} onPress={() => navigation.navigate('Progress')} />
        </View>
      </View>

      {/* 今天的记录保持低占用：默认一行，展开后最多显示最近三条。 */}
      <TodayRecordStrip events={s.events} />

      {/* 吸入记忆动画 */}
      {inhaleVisible && (
        <MemoryInhale key={inhaleKey} text={inhaleText} anim={inhaleAnim} startX={inhaleStartX} startY={inhaleStartY} endX={inhaleEndX} endY={inhaleEndY} />
      )}

      {/* 录音覆盖层 */}
      {voiceState !== 'idle' && (
        <View
          style={[
            styles.voiceOverlay,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.borderSoft,
              borderWidth: 1,
              bottom: insets.bottom + 96,
              borderRadius: theme.radius.lg,
              ...shadowStyle(theme.shadow.lg),
            },
          ]}
        >
          <View style={styles.voHead}>
            <Text style={[styles.voTime, { color: theme.colors.textPrimary }]}>
              {Math.floor(voiceSeconds / 60)}:{String(voiceSeconds % 60).padStart(2, '0')}
            </Text>
            <Text style={[styles.voState, { color: voiceCancelPending ? theme.colors.red : voiceState === 'locked' ? theme.colors.primary : theme.colors.red }]}>
              {voiceCancelPending ? '松开取消' : voiceState === 'locked' ? '已锁定 · 免按住' : '正在录音'}
            </Text>
          </View>
          <View style={styles.voWave}>
            {waveAnims.map((a, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.voBar,
                  {
                    backgroundColor: voiceState === 'locked' ? theme.colors.primary : theme.colors.red,
                    transform: [{ scaleY: a }],
                  },
                ]}
              />
            ))}
          </View>
          {voiceState === 'locked' ? (
            <View style={styles.voActions}>
              <Pressable onPress={() => stopVoice(false)} style={[styles.voAct, { backgroundColor: theme.colors.surfaceAlt }]} accessibilityLabel="取消录音">
                <Text style={{ color: theme.colors.textSecondary, fontWeight: '600' }}>取消</Text>
              </Pressable>
              <Pressable onPress={() => stopVoice(true)} style={[styles.voAct, { backgroundColor: theme.colors.primary }]} accessibilityLabel="发送语音">
                <Text style={{ color: theme.colors.textInverse, fontWeight: '600' }}>发送语音</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.voHints}>
              <Text style={[styles.voHint, { color: theme.colors.textTertiary }]}>↑ 上滑锁定</Text>
              <Text style={[styles.voHint, { color: voiceCancelPending ? theme.colors.red : theme.colors.textTertiary }]}>← 左滑取消</Text>
            </View>
          )}
        </View>
      )}

      {/* 保存反馈（含撤回） */}
      {showSaveFeedback && (
        <Animated.View
          style={[
            styles.saveFeedback,
            {
              backgroundColor: theme.dark ? 'rgba(20,26,37,0.88)' : 'rgba(251,250,247,0.92)',
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
              borderRadius: theme.radius.full,
              opacity: feedbackAnim,
              transform: [{ translateY: feedbackAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
              bottom: insets.bottom + theme.touch.minTarget + theme.spacing.lg * 2.2,
            },
          ]}
        >
          <View style={[styles.saveFeedbackDot, { backgroundColor: theme.colors.green }]} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.small, fontWeight: '500' }}>{saveFeedbackText}</Text>
          {undoEventId.current ? (
            <Pressable onPress={handleUndo} hitSlop={8} accessibilityLabel="撤回">
              <Text style={{ color: theme.colors.primaryMuted, fontSize: theme.font.small, fontWeight: '700' }}>撤回</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      )}

      {/* 底部零摩擦记录栏（V4.7规范：iOS药丸质感 · 玻璃拟态 · 16px侧距） */}
      <View
        style={(() => {
          const st: any[] = [
            styles.recordBar,
            {
              marginHorizontal: isCompactPhone ? 16 : (isTablet ? screenWidth * 0.22 : screenWidth * 0.12),
              marginBottom: insets.bottom + (isCompactPhone ? 14 : 16),
              padding: isCompactPhone ? 8 : 8,
              paddingHorizontal: 10,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.borderSoft,
              minHeight: 64,
            },
          ];
          st.push(shadowStyle(theme.shadow.sm));
          return st;
        })()}
      >
        <View style={[styles.recordRow, { gap: 10, minHeight: 48, alignItems: 'center' }]}>
          <Pressable
            onPress={handlePhoto}
            style={({ pressed }) => {
              const s: any[] = [styles.recordBtn, {
                backgroundColor: theme.dark ? theme.colors.surfaceAlt : theme.colors.surfaceAlt,
                width: 46,
                height: 46,
                borderRadius: theme.radius.md,
                opacity: pressed ? 0.6 : 1,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              }];
              if (Platform.OS === 'web') {
                s.push({ transition: 'all 0.15s cubic-bezier(0.22,1,0.36,1)' } as any);
              }
              return s;
            }}
            accessibilityLabel="选择照片记录"
            accessibilityRole="button"
            hitSlop={8}
          >
            <Glyph name="photo" size={21} color={theme.colors.textSecondary} />
          </Pressable>

          <View style={[styles.textInputWrapper, {
            flex: 1,
            backgroundColor: theme.dark ? theme.colors.bg : theme.colors.bg,
            borderRadius: theme.radius.md,
            paddingHorizontal: 16,
            borderWidth: 0.5,
            borderColor: theme.dark ? theme.colors.borderSoft : theme.colors.borderSoft,
            minHeight: 46,
          }]}>
            <TextInput
              ref={inputRef}
              style={[styles.textInput, { color: theme.colors.textPrimary, fontSize: theme.font.body, paddingVertical: 0, height: 46 }]}
              placeholder="说点什么…"
              placeholderTextColor={theme.colors.textTertiary}
              value={textInput}
              onChangeText={setTextInput}
              onSubmitEditing={handleSubmitText}
              returnKeyType="send"
              accessibilityLabel="快速记录"
            />
            {textInput.length > 0 ? (
              <Pressable
                onPress={handleSubmitText}
                style={({ pressed }) => {
                  const s: any[] = [{
                    opacity: pressed ? 0.75 : 1,
                    width: 34,
                    height: 34,
                    borderRadius: theme.radius.sm,
                    backgroundColor: theme.colors.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: pressed ? 0.9 : 1 }],
                  }];
                  if (Platform.OS === 'web') {
                    s.push({ transition: 'all 0.15s cubic-bezier(0.22,1,0.36,1)' } as any);
                  }
                  return s;
                }}
                hitSlop={8}
                accessibilityLabel="发送"
                accessibilityRole="button"
              >
                <Glyph name="arrow" size={16} color="#fff" />
              </Pressable>
            ) : null}
          </View>

          <View
            {...voicePan.panHandlers}
            style={[
              styles.recordBtn,
              {
                backgroundColor: voiceState === 'locked'
                  ? theme.colors.primary
                  : voiceState === 'recording'
                    ? theme.colors.red
                    : (theme.dark ? theme.colors.surfaceAlt : theme.colors.surfaceAlt),
                borderRadius: theme.radius.md,
                width: 46,
                height: 46,
                transform: [{ scale: voiceState !== 'idle' ? 1.08 : 1 }],
              },
            ]}
            accessibilityLabel={voiceState === 'idle' ? '语音记录' : '录音中'}
            accessibilityRole="button"
          >
            <Glyph name="voice" size={21} color={voiceState === 'idle' ? theme.colors.textSecondary : theme.colors.textInverse} />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  awarenessBar: { zIndex: 1 },
  awarenessContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topLeft: { flex: 1, justifyContent: 'center' },
  dateText: { fontWeight: '500', letterSpacing: 0.3, marginBottom: 4 },
  greeting: { fontWeight: '400' },
  awarenessItem: { alignSelf: 'flex-start' },
  awarenessPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, gap: 5, maxWidth: '95%' },
  awarenessText: { fontWeight: '500' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconAction: { alignItems: 'center', justifyContent: 'center' },
  iconActionBg: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  /* 3D舞台（V5.1精修：去边框去阴影，镜面沉浸感） */
  mainArea: { flex: 1, flexDirection: 'row', paddingVertical: 6, zIndex: 1 },
  stageZone: { alignItems: 'stretch', justifyContent: 'center' },
  stagePress: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  stageCanvas: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
  /* 指数窄栏（V5.1精修：更轻盈，不抢舞台注意力） */
  indexRail: { justifyContent: 'center', gap: 8, paddingLeft: 12, paddingVertical: 8 },
  indexPill: { paddingLeft: 12, paddingRight: 10, paddingVertical: 10, minHeight: 88, borderRadius: 16 },
  pillBar: { position: 'absolute', left: 3, top: 12, bottom: 12, width: 2.5, borderRadius: 2, opacity: 0.65 },
  pillHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  pillWord: { fontWeight: '700', lineHeight: 24, marginTop: 3 },
  pillMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  pillTrend: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  pillTrendText: { fontSize: 11, fontWeight: '600' },
  pillDesc: { fontSize: 12, lineHeight: 16, marginTop: 4, opacity: 0.8 },
  pillFresh: { fontSize: 11, marginTop: 3, opacity: 0.5 },
  /* 反馈 */
  saveFeedback: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 10 },
  saveFeedbackDot: { width: 7, height: 7, borderRadius: 4 },
  inhaleOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  inhaleTextWrap: { position: 'absolute', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  inhaleText: { fontSize: 12, fontWeight: '500' },
  inhaleParticle: { position: 'absolute' },
  /* 记录栏 */
  recordBar: { zIndex: 2 },
  recordRow: { flexDirection: 'row', alignItems: 'center', width: '100%', minWidth: 0 },
  recordBtn: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  textInputWrapper: { flexDirection: 'row', alignItems: 'center', minWidth: 0, flexShrink: 1 },
  textInput: { flex: 1, minWidth: 0, fontWeight: '400' },
  /* 语音覆盖层 */
  voiceOverlay: { position: 'absolute', left: 16, right: 16, padding: 16, borderWidth: 0, zIndex: 11, gap: 12, borderRadius: 24 },
  voHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  voTime: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  voState: { fontSize: 12, fontWeight: '600' },
  voWave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, height: 36 },
  voBar: { width: 3, height: 32, borderRadius: 2 },
  voHints: { flexDirection: 'row', justifyContent: 'space-between' },
  voHint: { fontSize: 11 },
  voActions: { flexDirection: 'row', gap: 10 },
  voAct: { flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: 'center' },
});
