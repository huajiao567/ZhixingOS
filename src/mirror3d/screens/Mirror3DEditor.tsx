import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Slider from '@react-native-community/slider';
import { AvatarCanvasFlagged } from '../avatar/AvatarCanvasFlagged';
import {
  extractPhotoFitting,
  fitIdentityFromBodyMetrics,
  fitIdentityFromFaceMetrics,
} from '../avatar/photoFitting';
import { useMirror3DStore } from '../store/useMirror3DStore';
import type { AvatarIdentity } from '../types/avatar';
import { useStore } from '../../store/useStore';
import { useAppTheme } from '../../theme/theme';
import { ThemeSelector } from '../../components/ThemeSelector';
import { StateExplainer } from '../avatar/StateExplainer';
import { deleteTemporaryPhotoCopy, pickPhoto } from '../../services/mediaCapture';
import { useAvatarV2Store } from '../store/useAvatarV2Store';
import {
  AVATAR_PERSONALIZATION_CAPABILITIES,
  personalizationDraftToProfile,
  type AvatarPersonalizationDraft,
} from '../avatar/v2/avatarPersonalization';

type Tab = 'mirror' | 'state' | 'identity' | 'data';

const SKIN_TONES = ['#F8D1B0', '#F0B98E', '#D9996C', '#B87551', '#8D563E'];
const HAIR_COLORS = ['#14161B', '#3B2A23', '#6C4932', '#8B735A'];
const SHIRT_COLORS: { c: string; n: string }[] = [
  { c: '#536BE8', n: '静蓝' },
  { c: '#34A27B', n: '青碧' },
  { c: '#A768B8', n: '紫藤' },
  { c: '#C77B43', n: '暖橙' },
];

const signalLevel = (v: number): string => {
  if (v < 0.2) return '很低';
  if (v < 0.4) return '偏低';
  if (v < 0.6) return '中等';
  if (v < 0.8) return '偏高';
  return '很高';
};

const hrvLevel = (v: number): string => {
  if (v < 0.7) return '恢复差';
  if (v < 0.9) return '恢复一般';
  if (v < 1.1) return '恢复正常';
  if (v < 1.3) return '恢复良好';
  return '恢复很好';
};

const SIGNAL_CONTROLS: {
  key: keyof DailySignalsLike;
  label: string;
  min: number;
  max: number;
  step: number;
  f: (v: number) => string;
}[] = [
  { key: 'sleepHours', label: '睡眠时长', min: 3, max: 10, step: 0.5, f: (v) => v.toFixed(1) + ' 小时' },
  { key: 'sleepQuality', label: '睡眠质量', min: 0, max: 1, step: 0.05, f: signalLevel },
  { key: 'hrvRelative', label: '身体恢复', min: 0.5, max: 1.5, step: 0.05, f: hrvLevel },
  { key: 'steps', label: '今日步数', min: 0, max: 20000, step: 500, f: (v) => String(Math.round(v)) + ' 步' },
  { key: 'workoutMinutes', label: '运动时长', min: 0, max: 120, step: 5, f: (v) => Math.round(v) + ' 分钟' },
  { key: 'focusMinutes', label: '专注时长', min: 0, max: 300, step: 10, f: (v) => Math.round(v) + ' 分钟' },
  { key: 'taskCompletion', label: '任务完成', min: 0, max: 1, step: 0.05, f: signalLevel },
  { key: 'projectMomentum', label: '项目推进', min: 0, max: 1, step: 0.05, f: signalLevel },
  { key: 'scheduleLoad', label: '日程负荷', min: 0, max: 1, step: 0.05, f: signalLevel },
];

const IDENTITY_CONTROLS: { key: keyof IdentityLike; label: string }[] = [
  { key: 'faceWidth', label: '脸宽' },
  { key: 'faceHeight', label: '脸长' },
  { key: 'jawRoundness', label: '下颌圆润度' },
  { key: 'eyeSize', label: '眼睛大小' },
  { key: 'eyeSpacing', label: '眼距' },
  { key: 'browAngle', label: '眉形角度' },
  { key: 'noseSize', label: '鼻子大小' },
  { key: 'mouthWidth', label: '嘴宽' },
  { key: 'bodyScale', label: '身体比例' },
  { key: 'shoulderWidth', label: '肩宽' },
];

type DailySignalsLike = {
  sleepHours: number; sleepQuality: number; hrvRelative: number; steps: number;
  workoutMinutes: number; focusMinutes: number; taskCompletion: number;
  projectMomentum: number; scheduleLoad: number; diary: string;
};
type IdentityLike = {
  faceWidth: number; faceHeight: number; jawRoundness: number; eyeSize: number; eyeSpacing: number;
  browAngle: number; noseSize: number; mouthWidth: number; bodyScale: number; shoulderWidth: number;
};

type PhotoDraftProvenance = {
  sourceRef: string;
  width: number;
  height: number;
  fittedAt: string;
  fittedParts: string[];
};

export function Mirror3DEditor() {
  const theme = useAppTheme();
  const D = theme.colors;
  const navigation = useNavigation<any>();

  const [tab, setTab] = useState<Tab>('mirror');
  const [themeSelectorVisible, setThemeSelectorVisible] = useState(false);
  const [explainerVisible, setExplainerVisible] = useState(false);
  const identity = useMirror3DStore((s) => s.identity);
  const signals = useMirror3DStore((s) => s.signals);
  const snapshot = useMirror3DStore((s) => s.snapshot);
  const calibration = useMirror3DStore((s) => s.calibration);
  const updateIdentity = useMirror3DStore((s) => s.updateIdentity);
  const updateSignals = useMirror3DStore((s) => s.updateSignals);
  const recompute = useMirror3DStore((s) => s.recompute);
  const feedback = useMirror3DStore((s) => s.feedback);
  const loadScenario = useMirror3DStore((s) => s.loadScenario);
  const resetAll = useMirror3DStore((s) => s.resetAll);
  const v2Profile = useAvatarV2Store((s) => s.profile);
  const confirmPersonalization = useAvatarV2Store((s) => s.confirmPersonalization);
  const correctDailyState = useAvatarV2Store((s) => s.correctDailyState);
  const draftInitializedRef = useRef(false);

  const [fbActive, setFbActive] = useState<string | null>(null);
  const [scActive, setScActive] = useState<string | null>(null);
  const [diary, setDiary] = useState(signals.diary);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoHint, setPhotoHint] = useState<string | null>(null);
  const [photoDraftProvenance, setPhotoDraftProvenance] = useState<PhotoDraftProvenance | null>(null);
  const [photoPrivacyDetailsExpanded, setPhotoPrivacyDetailsExpanded] = useState(false);
  const [storedOnlyExpanded, setStoredOnlyExpanded] = useState(false);

  useEffect(() => {
    recompute();
  }, [recompute]);

  // 编辑器首次进入时从当前生产 V2 档案初始化草稿，避免旧 Demo store 覆盖真实数字孪生。
  useEffect(() => {
    if (draftInitializedRef.current) return;
    draftInitializedRef.current = true;
    const face = v2Profile.identity.faceMorphs ?? {};
    const body = v2Profile.identity.bodyMorphs ?? {};
    updateIdentity({
      faceWidth: face.faceWidth ?? 0.5,
      faceHeight: face.faceHeight ?? 0.5,
      jawRoundness: face.jawRoundness ?? 0.5,
      eyeSize: face.eyeSize ?? 0.5,
      eyeSpacing: face.eyeSpacing ?? 0.5,
      browAngle: face.browAngle ?? 0.5,
      noseSize: face.noseSize ?? 0.5,
      mouthWidth: face.mouthWidth ?? 0.5,
      bodyScale: body.bodyScale ?? 0.5,
      shoulderWidth: body.shoulderWidth ?? 0.5,
      skinTone: v2Profile.identity.skinMaterial.baseColor,
      hairColor: v2Profile.appearance.hairColor ?? '#2A2028',
      shirtColor: v2Profile.appearance.outfitColor ?? '#536BE8',
    });
  }, [updateIdentity, v2Profile]);

  const personalizationDraft = useMemo<AvatarPersonalizationDraft>(() => ({
    faceWidth: identity.faceWidth,
    faceHeight: identity.faceHeight,
    jawRoundness: identity.jawRoundness,
    eyeSize: identity.eyeSize,
    eyeSpacing: identity.eyeSpacing,
    browAngle: identity.browAngle,
    noseSize: identity.noseSize,
    mouthWidth: identity.mouthWidth,
    bodyScale: identity.bodyScale,
    shoulderWidth: identity.shoulderWidth,
    skinTone: identity.skinTone,
    hairColor: identity.hairColor,
    outfitColor: identity.shirtColor,
  }), [identity]);

  const previewProfile = useMemo(() => {
    const personalized = personalizationDraftToProfile(v2Profile, personalizationDraft);
    return {
      ...personalized,
      dailyState: {
        ...personalized.dailyState,
        energy: snapshot.state.energy,
        tension: snapshot.state.stress,
        focus: snapshot.state.focus,
        socialOpenness: snapshot.state.sociality,
        evidenceTypes: ['editor_preview'],
        userOverridden: true,
      },
    };
  }, [v2Profile, personalizationDraft, snapshot.state]);

  const handleFeedback = (kind: 'accurate' | 'tooTired' | 'tooHappy' | 'tooSlouched') => {
    feedback(kind);
    setFbActive(kind);
    const label: Record<typeof kind, string> = {
      accurate: '基本准确',
      tooTired: '显得太疲惫',
      tooHappy: '显得太开心',
      tooSlouched: '姿态太低沉',
    };
    useStore.getState().pushAudit('用户', `校正三维镜像：${label[kind]}`);
  };

  const apply = async () => {
    const previousDiary = signals.diary;
    updateSignals({ diary });
    recompute();
    const nextState = useMirror3DStore.getState().snapshot.state;
    correctDailyState({
      energy: nextState.energy,
      tension: nextState.stress,
      focus: nextState.focus,
      socialOpenness: nextState.sociality,
      evidenceTypes: ['editor_user_adjustment'],
    });
    if (diary.trim() && diary.trim() !== previousDiary.trim()) {
      await useStore.getState().addJournal(diary.trim(), { sourceRef: 'avatar-editor', titlePrefix: '镜像记录' });
    }
    useStore.getState().pushAudit('用户', '确认三维镜像今日状态');
    setTab('mirror');
  };

  const savePersonalization = async () => {
    const photoSourceRef = photoDraftProvenance?.sourceRef;
    const sourceMode = photoSourceRef ? 'photo_assisted' : 'manual';
    const versionNote = photoSourceRef
      ? `来自三维镜像编辑器；照片只在本地生成预览草稿。正式版本仅保留不含原始路径的不透明来源凭据 ${photoSourceRef} 与用户确认后的参数，不保存图片路径或原始像素。`
      : '来自三维镜像编辑器的手动调整；保存动作由用户明确触发，未关联照片来源。';

    confirmPersonalization(
      personalizationDraft,
      '确认我的三维形象',
      versionNote,
      {
        mode: sourceMode,
        sourceRefs: photoSourceRef ? [photoSourceRef] : [],
      },
    );
    await useStore.getState().addJournal([
      '[孪生] 用户确认更新三维形象',
      '已应用：脸宽/脸长、身体框架、肩骨宽度、肤色、发色与服装色。',
      '已保存待后续模型支持：下颌、眼睛、眼距、眉形、鼻子、嘴部等精细参数。',
      photoSourceRef
        ? `来源：照片辅助草稿 + 用户明确确认；只保留不透明来源凭据 ${photoSourceRef}，不保存原始路径或像素。`
        : '来源：用户在三维镜像编辑器中手动调整并明确确认。',
    ].join('\n'), {
      sourceRef: photoSourceRef ? `avatar-editor:${photoSourceRef}` : 'avatar-editor',
      titlePrefix: '孪生记录',
    });
    useStore.getState().pushAudit(
      '用户',
      `确认三维数字孪生身份与外观版本（${photoSourceRef ? '照片辅助' : '手动'}）`,
      photoSourceRef,
    );
    setPhotoDraftProvenance(null);
    setPhotoHint(photoSourceRef
      ? '已确认并保存。正式版本只保留不透明照片来源凭据，不保存原始路径或像素。'
      : '已保存到正式数字孪生，并写入新的身份版本。');
  };

  const reset = () => {
    resetAll();
    setFbActive(null);
    setScActive(null);
    setDiary('');
    setPhotoDraftProvenance(null);
  };

  const handlePhotoFitting = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoHint(null);
    let temporaryPhotoUri: string | null = null;
    try {
      // 不做正方形裁剪：体格拟合需要保留全身比例
      const photo = await pickPhoto();
      if (!photo) return;
      const uri = photo.uri;
      temporaryPhotoUri = uri;

      const { face, body } = await extractPhotoFitting(uri);
      if (!face && !body) {
        setPhotoHint('没识别到脸或身体，试试光线更好的环境，或换一张正面/全身照片。');
        return;
      }

      const patch: Partial<AvatarIdentity> = {};
      if (face) Object.assign(patch, fitIdentityFromFaceMetrics(face));
      const bodyApplied = Boolean(body?.completeness.shoulders);
      if (body && bodyApplied) Object.assign(patch, fitIdentityFromBodyMetrics(body));
      updateIdentity(patch);

      const parts: string[] = [];
      if (face) parts.push('脸型（脸宽/脸长视觉生效，五官精细参数仅保存）');
      if (bodyApplied) {
        parts.push(body?.completeness.fullBody
          ? '身体框架与肩宽'
          : '肩宽（半身照，身体框架保持中性）');
      }
      setPhotoDraftProvenance({
        sourceRef: photo.sourceRef,
        width: photo.width,
        height: photo.height,
        fittedAt: new Date().toISOString(),
        fittedParts: parts,
      });
      setPhotoHint(`已根据照片调整${parts.join('与')}，你可以继续微调；只有标记为“预览生效”的参数会改变当前生产数字人。`);

      // 照片结果先只形成本地草稿；只有用户点击“保存到我的数字孪生”才进入正式身份版本。
      // 审计只持有不透明 sourceRef，不保存 file/content/blob URI。
      useStore.getState().pushAudit(
        '用户',
        `本地照片生成三维形象草稿：${parts.join('、') || '无'}`,
        photo.sourceRef,
      );
    } catch (err) {
      console.warn('[Mirror3DEditor] 从照片拟合失败:', err);
      setPhotoHint(err instanceof Error ? err.message : '处理照片时出错，请稍后再试。');
    } finally {
      if (temporaryPhotoUri) deleteTemporaryPhotoCopy(temporaryPhotoUri);
      setPhotoBusy(false);
    }
  };

  const Section = ({ title, children }: React.PropsWithChildren<{ title: string }>) => (
    <View style={{ backgroundColor: D.surface, borderRadius: theme.radius.lg, padding: theme.spacing.md, marginBottom: theme.spacing.md, borderWidth: 1, borderColor: D.border }}>
      <Text style={{ color: D.textPrimary, fontWeight: '700', fontSize: theme.font.body - 1, marginBottom: theme.spacing.md }}>{title}</Text>
      {children}
    </View>
  );

  const Chip = ({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${label}${active ? '，已选中' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: active ? D.primary : D.border,
        backgroundColor: active ? D.primary : D.surface,
        borderRadius: theme.radius.full,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        marginRight: theme.spacing.sm,
        marginBottom: theme.spacing.sm,
        minHeight: theme.touch.minTarget,
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text style={{ color: active ? '#fff' : D.textSecondary, fontSize: theme.font.small }}>{label}</Text>
    </Pressable>
  );

  const SignalSlider = ({
    label, value, min, max, step, format, onValue, capabilityStatus, capabilityDescription,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onValue: (v: number) => void;
    capabilityStatus?: '预览生效' | '当前仅保存';
    capabilityDescription?: string;
  }) => (
    <View style={{ marginBottom: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.xs, alignItems: 'center' }}>
        <Text style={{ color: D.textPrimary, fontSize: theme.font.small, fontWeight: '600', flexShrink: 1 }}>{label}</Text>
        {capabilityStatus ? (
          <Text style={{ color: capabilityStatus === '预览生效' ? D.teal : D.textTertiary, fontSize: theme.font.tiny, marginLeft: theme.spacing.sm }}>
            {capabilityStatus}
          </Text>
        ) : (
          <Text style={{ color: D.teal, fontSize: theme.font.small }}>{format(value)}</Text>
        )}
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onValue}
        minimumTrackTintColor={D.primary}
        maximumTrackTintColor={D.borderSoft}
        thumbTintColor="#fff"
        accessibilityLabel={`${label}，${capabilityStatus ? capabilityStatus + '，' : ''}当前值 ${format(value)}，范围 ${format(min)} 到 ${format(max)}`}
        accessibilityRole="adjustable"
      />
      {capabilityDescription ? (
        <Text style={{ color: D.textTertiary, fontSize: theme.font.tiny, lineHeight: 16, marginTop: 2 }}>
          {capabilityDescription}
        </Text>
      ) : null}
    </View>
  );

  const StatusBar = () => (
    <View style={{ height: 62, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.sm }}>
      <Text style={{ fontSize: theme.font.body - 1, fontWeight: '700', color: D.textPrimary }}>9:41</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginRight: theme.spacing.xs }}>
          {[6, 9, 12, 15].map((h, i) => (
            <View key={i} style={{ width: 3, height: h, borderRadius: 1.5, backgroundColor: D.textPrimary, opacity: i < 3 ? 1 : 0.4, marginRight: 2 }} />
          ))}
        </View>
        <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: D.textPrimary, marginRight: theme.spacing.xs, opacity: 0.9 }} />
        <View style={{ width: 24, height: 12, borderRadius: 3, borderWidth: 1, borderColor: D.textPrimary, padding: 1.5 }}>
          <View style={{ flex: 1, backgroundColor: D.textPrimary, borderRadius: 1.5 }} />
        </View>
      </View>
    </View>
  );

  const describeLevel = (value: number): { label: string; color: string } => {
    if (value < 0.3) return { label: '偏低', color: D.red };
    if (value < 0.45) return { label: '稍低', color: D.amber };
    if (value < 0.6) return { label: '中等', color: D.textSecondary };
    if (value < 0.78) return { label: '良好', color: D.teal };
    return { label: '充足', color: D.primary };
  };

  const describeCoverage = (value: number): string => {
    if (value < 0.3) return '证据不足';
    if (value < 0.5) return '证据有限';
    if (value < 0.75) return '证据较充分';
    return '证据充分';
  };

  const state = snapshot.state;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: D.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar />
        <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: 34 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.md }}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => ({
                width: 40, height: 40, borderRadius: 20,
                alignItems: 'center', justifyContent: 'center',
                marginLeft: -8, marginRight: 4,
                opacity: pressed ? 0.6 : 1,
              })}
              accessibilityLabel="关闭"
              accessibilityRole="button"
              hitSlop={12}
            >
              <Text style={{ color: D.textPrimary, fontSize: 28, fontWeight: '300', lineHeight: 30 }}>×</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: D.textPrimary, fontSize: theme.font.hero - 5, fontWeight: '800' }}>我的三维镜像</Text>
              <Text style={{ color: D.textSecondary, marginTop: 2, fontSize: theme.font.small, lineHeight: 19 }}>
                同一个身份，依据身体、日记和行动证据表达今天的状态。
              </Text>
            </View>
          </View>

          <View style={{ height: 340, borderRadius: theme.radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: D.border, backgroundColor: D.surface }}>
            <AvatarCanvasFlagged profile={previewProfile} paused={false} fill />
            <View style={{ position: 'absolute', top: theme.spacing.sm, left: theme.spacing.sm, backgroundColor: theme.dark ? 'rgba(10,14,22,0.78)' : 'rgba(255,255,255,0.85)', borderRadius: theme.radius.md, paddingHorizontal: 11, paddingVertical: 8 }}>
              <Text style={{ color: D.textPrimary, fontWeight: '700', fontSize: theme.font.small }}>{snapshot.render.animation === 'idle' ? '平静' : snapshot.render.animation === 'active' ? '活跃' : snapshot.render.animation === 'focused' ? '专注' : '疲惫'}</Text>
              <Text style={{ color: D.textSecondary, fontSize: theme.font.tiny, marginTop: 2 }}>V2 · 身份 {v2Profile.identity.identityVersion} · {theme.name}</Text>
            </View>
            <View style={{ position: 'absolute', top: theme.spacing.sm, right: theme.spacing.sm, flexDirection: 'row', backgroundColor: theme.dark ? 'rgba(10,14,22,0.7)' : 'rgba(255,255,255,0.8)', borderRadius: theme.radius.full, padding: 4, borderWidth: 1, borderColor: D.border }}>
              <Pressable
                onPress={() => setExplainerVisible(true)}
                accessibilityLabel="查看状态映射解释"
                accessibilityRole="button"
                style={({ pressed }) => ({ width: theme.touch.minTarget, height: theme.touch.minTarget, borderRadius: 999, backgroundColor: D.surfaceAlt, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1, marginRight: 4 })}
              >
                <Text style={{ fontSize: 18, fontWeight: '800', color: D.textSecondary }}>?</Text>
              </Pressable>
              <Pressable
                onPress={() => setThemeSelectorVisible(true)}
                accessibilityLabel="切换主题风格"
                accessibilityRole="button"
                style={({ pressed }) => ({ width: theme.touch.minTarget, height: theme.touch.minTarget, borderRadius: 999, backgroundColor: D.primary, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ fontSize: 20 }}>🎨</Text>
              </Pressable>
            </View>
          </View>

          <View style={{ flexDirection: 'row', marginVertical: theme.spacing.md, backgroundColor: D.surface, borderRadius: 14, padding: 4, borderWidth: 1, borderColor: D.border }}>
            {([{ v: 'mirror', l: '镜像' }, { v: 'state', l: '状态' }, { v: 'identity', l: '捏脸' }, { v: 'data', l: '数据' }] as { v: Tab; l: string }[]).map((t) => (
              <Pressable
                key={t.v}
                onPress={() => setTab(t.v)}
                accessibilityLabel={`切换到${t.l}标签${tab === t.v ? '，已选中' : ''}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.v }}
                style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: theme.touch.minTarget, borderRadius: 10, backgroundColor: tab === t.v ? D.primary : 'transparent', opacity: pressed ? 0.8 : 1 })}
              >
                <Text style={{ color: tab === t.v ? '#fff' : D.textSecondary, fontSize: theme.font.small, fontWeight: '600' }}>{t.l}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'mirror' && (
            <>
              <Section title="今日状态证据">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  {([
                    ['精力', state.energy], ['情绪', state.mood], ['压力', 1 - state.stress],
                    ['专注', state.focus], ['运动', state.physicality], ['意义推进', state.meaningMomentum],
                  ] as [string, number][]).map(([l, v]) => {
                    const level = describeLevel(v);
                    return (
                      <View key={l} style={{ width: '31.5%', backgroundColor: D.surfaceAlt, borderRadius: theme.radius.md, paddingVertical: 11, paddingHorizontal: 10, marginBottom: 10, borderWidth: 1, borderColor: D.border }}>
                        <Text style={{ color: level.color, fontSize: theme.font.title - 3, fontWeight: '800' }}>{level.label}</Text>
                        <Text style={{ color: D.textSecondary, fontSize: theme.font.tiny, marginTop: 3 }}>{l}</Text>
                        <View style={{ height: 4, borderRadius: 2, backgroundColor: D.border, marginTop: 8, overflow: 'hidden' }}>
                          <View style={{ height: '100%', width: `${Math.round(v * 100)}%`, backgroundColor: level.color }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </Section>

              <Section title="镜像为什么这样呈现">
                {snapshot.explanation.map((item) => (
                  <Text key={item} style={{ color: D.textSecondary, fontSize: theme.font.small, lineHeight: 21, marginBottom: 7 }}>• {item}</Text>
                ))}
                <Text style={{ color: D.accent, fontSize: theme.font.tiny, lineHeight: 20, marginTop: 4 }}>
                  证据状态：{describeCoverage(state.evidenceCoverage)}；这是可修正的视觉表达，不是心理诊断。
                </Text>
              </Section>

              <Section title="这像今天的你吗？">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  <Chip label="基本准确" active={fbActive === 'accurate'} onPress={() => handleFeedback('accurate')} />
                  <Chip label="显得太疲惫" active={fbActive === 'tooTired'} onPress={() => handleFeedback('tooTired')} />
                  <Chip label="显得太开心" active={fbActive === 'tooHappy'} onPress={() => handleFeedback('tooHappy')} />
                  <Chip label="姿态太低沉" active={fbActive === 'tooSlouched'} onPress={() => handleFeedback('tooSlouched')} />
                </View>
                <Text style={{ color: D.textSecondary, fontSize: theme.font.tiny }}>
                  校正偏差：疲惫 {calibration.fatigue.toFixed(2)} / 微笑 {calibration.smile.toFixed(2)} / 姿态 {calibration.posture.toFixed(2)}
                </Text>
              </Section>

              <Section title="快速场景演示">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {([
                    ['focused', '深度专注'],
                    ['active', '运动活跃'],
                    ['recovery', '需要恢复'],
                    ['balanced', '平衡日常'],
                  ] as ['focused' | 'active' | 'recovery' | 'balanced', string][]).map(([k, l]) => (
                    <Chip key={k} label={l} active={scActive === k} onPress={() => { loadScenario(k); setScActive(k); }} />
                  ))}
                </View>
              </Section>
            </>
          )}

          {tab === 'state' && (
            <>
              <Section title="手环与日程模拟输入">
                {SIGNAL_CONTROLS.map((c) => (
                  <SignalSlider
                    key={c.key}
                    label={c.label}
                    value={signals[c.key] as number}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    format={c.f}
                    onValue={(v) => updateSignals({ [c.key]: v } as Partial<DailySignalsLike>)}
                  />
                ))}
              </Section>

              <Section title="今日一句话记录">
                <TextInput
                  multiline
                  value={diary}
                  onChangeText={setDiary}
                  placeholder="例如：今天虽然累，但完成了一件真正重要的事。"
                  placeholderTextColor={D.textSecondary}
                  style={{ minHeight: 96, color: D.textPrimary, backgroundColor: D.surfaceAlt, borderRadius: theme.radius.md, padding: theme.spacing.md, textAlignVertical: 'top', lineHeight: 21, fontSize: theme.font.small }}
                />
              </Section>

              <Pressable
                onPress={() => { void apply(); }}
                accessibilityLabel="重新生成今日镜像并保存记录"
                accessibilityRole="button"
                style={({ pressed }) => ({ backgroundColor: D.primary, borderRadius: theme.radius.md, paddingVertical: theme.spacing.md, alignItems: 'center', marginBottom: theme.spacing.md, opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: theme.font.body }}>重新生成今日镜像</Text>
              </Pressable>
            </>
          )}

          {tab === 'identity' && (
            <>
              <Section title="从照片生成（脸 + 体格）">
                <Pressable
                  onPress={handlePhotoFitting}
                  disabled={photoBusy}
                  accessibilityLabel="从照片生成脸与体格参数"
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    backgroundColor: photoBusy ? D.surfaceAlt : D.primary,
                    borderRadius: theme.radius.md,
                    minHeight: theme.touch.minTarget,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: theme.spacing.md,
                    borderWidth: 1,
                    borderColor: D.border,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  {photoBusy ? (
                    <>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: theme.font.body, marginLeft: 8 }}>
                        正在分析照片…
                      </Text>
                    </>
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: theme.font.body }}>
                      从照片生成
                    </Text>
                  )}
                </Pressable>
                <View style={{ marginTop: theme.spacing.sm }}>
                  <Text style={{ color: D.textSecondary, fontSize: theme.font.tiny, lineHeight: 18 }}>
                    照片像素仅在本机/浏览器会话中分析，不作为输入数据上传。
                  </Text>
                  <Text style={{ color: D.textSecondary, fontSize: theme.font.tiny, lineHeight: 18, marginTop: 2 }}>
                    正式 Avatar 版本只保存确认后的参数与不透明来源凭据，不保存图片路径或原始像素。
                  </Text>
                  <Pressable
                    onPress={() => setPhotoPrivacyDetailsExpanded((value) => !value)}
                    accessibilityRole="button"
                    accessibilityLabel={photoPrivacyDetailsExpanded ? '收起照片拟合技术与缓存说明' : '展开照片拟合技术与缓存说明'}
                    accessibilityState={{ expanded: photoPrivacyDetailsExpanded }}
                    style={({ pressed }) => ({
                      minHeight: theme.touch.minTarget,
                      alignSelf: 'flex-start',
                      justifyContent: 'center',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: D.teal, fontSize: theme.font.tiny, fontWeight: '700' }}>
                      技术与缓存说明 {photoPrivacyDetailsExpanded ? '⌃' : '⌄'}
                    </Text>
                  </Pressable>
                  {photoPrivacyDetailsExpanded && (
                    <Text style={{ color: D.textTertiary, fontSize: theme.font.tiny, lineHeight: 18 }}>
                      Android APK 使用随包内置的 ML Kit 人脸与 33 点姿态模型；Web 使用 MediaPipe，并会从外部 CDN/Google 下载运行代码与模型。
                      MediaPipe 官方说明不会发送输入图像数据，但其 Tasks API 可能发送性能与使用指标。全身照拟合体格，半身照只更新肩宽。
                      原生端若图片选择器生成应用缓存工作副本，分析结束后会尝试删除该副本。
                    </Text>
                  )}
                </View>
                {photoHint && (
                  <Text style={{ color: D.accent, fontSize: theme.font.tiny, lineHeight: 18, marginTop: theme.spacing.xs }}>
                    {photoHint}
                  </Text>
                )}
                {photoDraftProvenance && (
                  <View
                    accessible
                    accessibilityLabel={`照片拟合草稿，仅本地分析，待确认，来源凭据 ${photoDraftProvenance.sourceRef}`}
                    style={{
                      marginTop: theme.spacing.sm,
                      paddingVertical: theme.spacing.sm,
                      paddingHorizontal: theme.spacing.md,
                      borderRadius: theme.radius.md,
                      backgroundColor: D.surfaceAlt,
                    }}
                  >
                    <Text style={{ color: D.textPrimary, fontSize: theme.font.tiny, fontWeight: '700' }}>
                      照片拟合草稿 · 仅本地分析 · 待确认
                    </Text>
                    <Text style={{ color: D.textTertiary, fontSize: theme.font.tiny, lineHeight: 16, marginTop: 2 }}>
                      {photoDraftProvenance.width}×{photoDraftProvenance.height} · 来源凭据 {photoDraftProvenance.sourceRef}
                    </Text>
                    <Text style={{ color: D.textTertiary, fontSize: theme.font.tiny, lineHeight: 16, marginTop: 2 }}>
                      正式版本只会保存确认后的参数与该不透明来源凭据；不会保存原始照片路径或像素。
                    </Text>
                  </View>
                )}
              </Section>

              <Section title="脸部与体型">
                {IDENTITY_CONTROLS
                  .filter((control) => AVATAR_PERSONALIZATION_CAPABILITIES[control.key].effect === 'rendered')
                  .map((control) => {
                    const capability = AVATAR_PERSONALIZATION_CAPABILITIES[control.key];
                    return (
                      <SignalSlider
                        key={control.key}
                        label={control.label}
                        value={identity[control.key] as number}
                        min={0}
                        max={1}
                        step={0.02}
                        format={(v) => v.toFixed(2)}
                        capabilityStatus="预览生效"
                        capabilityDescription={capability.description}
                        onValue={(v) => updateIdentity({ [control.key]: v } as Partial<IdentityLike>)}
                      />
                    );
                  })}

                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: D.borderSoft, paddingTop: theme.spacing.sm }}>
                  <Pressable
                    onPress={() => setStoredOnlyExpanded((value) => !value)}
                    accessibilityRole="button"
                    accessibilityLabel={storedOnlyExpanded ? '收起当前仅保存参数' : '展开当前仅保存参数'}
                    accessibilityState={{ expanded: storedOnlyExpanded }}
                    style={({ pressed }) => ({
                      minHeight: theme.touch.minTarget,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      opacity: pressed ? 0.72 : 1,
                    })}
                  >
                    <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
                      <Text style={{ color: D.textPrimary, fontSize: theme.font.small, fontWeight: '700' }}>
                        更多精细参数 · 当前仅保存
                      </Text>
                      <Text style={{ color: D.textTertiary, fontSize: theme.font.tiny, lineHeight: 16, marginTop: 2 }}>
                        下颌、眼睛、眼距、眉形、鼻子和嘴宽共 6 项；当前生产 VRM 无可验证身份 morph。
                      </Text>
                    </View>
                    <Text style={{ color: D.textSecondary, fontSize: theme.font.body }}>
                      {storedOnlyExpanded ? '⌃' : '⌄'}
                    </Text>
                  </Pressable>

                  {storedOnlyExpanded && (
                    <View style={{ marginTop: theme.spacing.sm }}>
                      {IDENTITY_CONTROLS
                        .filter((control) => AVATAR_PERSONALIZATION_CAPABILITIES[control.key].effect === 'stored-only')
                        .map((control) => (
                          <SignalSlider
                            key={control.key}
                            label={control.label}
                            value={identity[control.key] as number}
                            min={0}
                            max={1}
                            step={0.02}
                            format={(v) => v.toFixed(2)}
                            capabilityStatus="当前仅保存"
                            onValue={(v) => updateIdentity({ [control.key]: v } as Partial<IdentityLike>)}
                          />
                        ))}
                    </View>
                  )}
                </View>
              </Section>

              <Section title="正式形象颜色">
                <Text style={{ color: D.textSecondary, marginVertical: theme.spacing.sm, fontSize: theme.font.small }}>肤色</Text>
                <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                  {SKIN_TONES.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => updateIdentity({ skinTone: c })}
                      accessibilityLabel={`肤色选项 ${c}${identity.skinTone === c ? '，已选中' : ''}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: identity.skinTone === c }}
                      style={({ pressed }) => ({ width: theme.touch.minTarget, height: theme.touch.minTarget, borderRadius: theme.touch.minTarget / 2, backgroundColor: c, marginRight: theme.spacing.sm, borderWidth: identity.skinTone === c ? 3 : 1, borderColor: identity.skinTone === c ? D.teal : D.border, opacity: pressed ? 0.85 : 1 })}
                    />
                  ))}
                </View>

                <Text style={{ color: D.textSecondary, marginVertical: theme.spacing.sm, fontSize: theme.font.small }}>发色</Text>
                <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                  {HAIR_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => updateIdentity({ hairColor: c })}
                      accessibilityLabel={`发色选项 ${c}${identity.hairColor === c ? '，已选中' : ''}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: identity.hairColor === c }}
                      style={({ pressed }) => ({ width: theme.touch.minTarget, height: theme.touch.minTarget, borderRadius: theme.touch.minTarget / 2, backgroundColor: c, marginRight: theme.spacing.sm, borderWidth: identity.hairColor === c ? 3 : 1, borderColor: identity.hairColor === c ? D.teal : D.border, opacity: pressed ? 0.85 : 1 })}
                    />
                  ))}
                </View>

                <Text style={{ color: D.textSecondary, marginVertical: theme.spacing.sm, fontSize: theme.font.small }}>基础服装色</Text>
                <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                  {SHIRT_COLORS.map((c) => (
                    <Pressable
                      key={c.c}
                      onPress={() => updateIdentity({ shirtColor: c.c })}
                      accessibilityLabel={`服装色${c.n}${identity.shirtColor === c.c ? '，已选中' : ''}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: identity.shirtColor === c.c }}
                      style={({ pressed }) => ({ width: theme.touch.minTarget, height: theme.touch.minTarget, borderRadius: theme.touch.minTarget / 2, backgroundColor: c.c, marginRight: theme.spacing.sm, borderWidth: identity.shirtColor === c.c ? 3 : 1, borderColor: identity.shirtColor === c.c ? D.teal : D.border, opacity: pressed ? 0.85 : 1 })}
                    />
                  ))}
                </View>

                <Text style={{ color: D.textSecondary, fontSize: theme.font.tiny, lineHeight: 18, marginTop: theme.spacing.md }}>
                  当前页面直接预览正式 V2 VRM。身体框架与肩宽已经与脸型解耦：肩宽走肩骨/上臂根节点，身体比例不会再连带改变脸宽。下颌、眼睛、眼距、眉形、鼻子和嘴部仍明确标为“当前仅保存”，不会伪装成已视觉生效。
                </Text>
              </Section>

              <Pressable
                onPress={() => { void savePersonalization(); }}
                accessibilityLabel="保存到我的数字孪生"
                accessibilityRole="button"
                style={({ pressed }) => ({
                  backgroundColor: D.primary,
                  borderRadius: theme.radius.md,
                  minHeight: theme.touch.minTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: theme.spacing.md,
                  marginBottom: theme.spacing.md,
                  opacity: pressed ? 0.82 : 1,
                })}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: theme.font.body }}>保存到我的数字孪生</Text>
              </Pressable>
              <Text style={{ color: D.textSecondary, fontSize: theme.font.tiny, lineHeight: 18, marginBottom: theme.spacing.md }}>
                滑杆和照片分析都只是预览草稿；只有点击这里才会生成新的身份/外观版本并进入时间线。
              </Text>
            </>
          )}

          {tab === 'data' && (
            <>
              <Section title="给本地 Agent 的实时状态对象">
                <Text selectable style={{ color: D.textPrimary, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: theme.font.tiny, lineHeight: 17 }}>
                  {JSON.stringify({ identity, signals, calibration, snapshot }, null, 2)}
                </Text>
              </Section>
              <Pressable
                onPress={() => Alert.alert('重置 Demo', '确定恢复默认身份与状态吗？', [
                  { text: '取消', style: 'cancel' },
                  { text: '重置', style: 'destructive', onPress: reset },
                ])}
                accessibilityLabel="恢复默认演示数据，会重置身份与状态"
                accessibilityRole="button"
                style={({ pressed }) => ({ borderColor: D.red, borderWidth: 1, borderRadius: theme.radius.md, minHeight: theme.touch.minTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md, opacity: pressed ? 0.8 : 1 })}
              >
                <Text style={{ color: D.red, fontWeight: '700', fontSize: theme.font.small }}>恢复默认 Demo</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ThemeSelector visible={themeSelectorVisible} onClose={() => setThemeSelectorVisible(false)} />
      <StateExplainer visible={explainerVisible} onClose={() => setExplainerVisible(false)} render={snapshot.render} state={snapshot.state} />
    </SafeAreaView>
  );
}
