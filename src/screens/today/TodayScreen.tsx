import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, ActivityIndicator, RefreshControl, Alert, Platform } from 'react-native';
import { useStore, proactivityShortLabel } from '../../store/useStore';
import { useTodayBrief } from '../../services/useTodayBrief';
import { useAppTheme } from '../../theme/theme';
import { Card, SectionTitle, Tag, PrimaryButton, useTextStyles } from '../../components/ui';
import { Glyph } from '../../components/glyphs';
import { SyncBadge } from '../../components/SyncBadge';
import { MilestoneBanner } from '../../components/MilestoneBanner';
import { ThemeSelector } from '../../components/ThemeSelector';
import { AvatarCanvasFlagged } from '../../mirror3d/avatar/AvatarCanvasFlagged';
import { useAvatarV2Store } from '../../mirror3d/store/useAvatarV2Store';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { pickPhoto, takePhoto } from '../../services/mediaCapture';
import { assertEnvelopeTraceable, createPhotoEnvelope } from '../../ai-native/intake/eventEnvelope';
import type { ProactivityLevel } from '../../types/models';

const PROACTIVITY_OPTIONS: { value: ProactivityLevel; label: string; desc: string }[] = [
  { value: 'P0', label: '不主动', desc: '我不会主动找你，你叫我我才出现。' },
  { value: 'P1', label: '每天一次', desc: '我每天最多主动找你一次。' },
  { value: 'P2', label: '有变化才说', desc: '我发现到值得说的变化时才主动找你。' },
  { value: 'P3', label: '立即提醒', desc: '我看到值得立刻说的事，会马上提醒你。' },
];

export function TodayScreen() {
  const s = useStore();
  const theme = useAppTheme();
  const ts = useTextStyles();
  const { brief, loading, source, refresh } = useTodayBrief();
  const flush = useStore((s) => s.flushSync);
  const syncPending = useStore((s) => s.sync.pending);
  const [recordOpen, setRecordOpen] = useState(false);
  const [journal, setJournal] = useState('');
  const [proactOpen, setProactOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();

  const choosePhotoSource = useCallback((): Promise<'camera' | 'library' | null> =>
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
    }), []);

  const handleQuickPhoto = useCallback(async () => {
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
        { consentId: 'user-direct-input' },
      );
      assertEnvelopeTraceable(envelope);
      await s.addJournal([
        '📷 照片记录',
        `信封：${envelope.id} · 隐私级别 ${envelope.privacyLevel}（仅不可逆引用凭据，不上传路径或像素）`,
        `来源：${mode === 'camera' ? '相机拍摄' : '相册选择'} · ${photo.width} × ${photo.height} · ${photo.mimeType}`,
        `引用凭据：${photo.sourceRef}`,
        '保存去向：今日日记',
      ].join('\n'));
      if (Platform.OS !== 'web') Alert.alert('照片已保存', '已生成可追溯的照片记录。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '照片获取失败';
      if (Platform.OS !== 'web') Alert.alert('没有保存照片', message);
    }
  }, [choosePhotoSource, s]);

  const avatarProfile = useAvatarV2Store((state) => state.profile);

  useEffect(() => {
    if (syncPending === 0) return;
    const t = setInterval(() => { flush(); }, 25000);
    return () => clearInterval(t);
  }, [syncPending, flush]);

  const activeExp = s.experiments.find((e) => e.status === 'active');
  const todayChecked = activeExp?.checkIns.some(
    (c) => new Date(c.date).toDateString() === new Date().toDateString(),
  );

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.colors.bg }]}
      contentContainerStyle={[styles.container, { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl * 2 }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={theme.colors.primary} />}
    >
      {/* 头部 - 3D分身 + 问候语 */}
      <View style={[styles.headerRow, { marginBottom: theme.spacing.md }]}>
        <Pressable
          onPress={() => navigation.navigate('Mirror3DEditor')}
          style={[styles.avatarContainer, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.colors.borderSoft,
            overflow: 'hidden',
          }]}
          accessibilityLabel="打开三维镜像编辑器"
          accessibilityRole="button"
        >
          <AvatarCanvasFlagged
            profile={avatarProfile}
            paused={!isFocused}
            size={160}
          />
        </Pressable>
        <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
          <Text style={[ts.tertiary]}>
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          </Text>
          <Text style={[styles.hello, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>
            早上好，{s.user.name}
          </Text>
          <Text style={[ts.secondary, { marginTop: 4, fontSize: theme.font.small }]} numberOfLines={2}>
            {avatarProfile.dailyState.energy > 0.6 ? '状态舒展，能量充足' : avatarProfile.dailyState.tension > 0.6 ? '略感紧绷，记得放松' : '今天也是新的一天。'}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Pressable
              onPress={() => setThemeOpen(true)}
              accessibilityLabel="切换主题风格"
              accessibilityRole="button"
              style={[
                styles.miniBtn,
                {
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radius.md,
                  minHeight: theme.touch.minTarget,
                },
              ]}
            >
              <Glyph name="data" size={14} color={theme.colors.primaryMuted} />
              <Text style={{ color: theme.colors.primaryMuted, fontSize: theme.font.tiny, marginLeft: 4 }}>主题</Text>
            </Pressable>
            <Pressable
              onPress={() => setProactOpen(true)}
              accessibilityLabel={`调整主动性，当前 ${proactivityShortLabel(s.user.proactivity)}`}
              accessibilityRole="button"
              style={[
                styles.miniBtn,
                {
                  backgroundColor: s.user.proactivity === 'P0' ? theme.colors.primarySoft : theme.colors.surface,
                  borderRadius: theme.radius.md,
                  minHeight: theme.touch.minTarget,
                },
              ]}
            >
              <Glyph name="silence" size={14} color={s.user.proactivity === 'P0' ? theme.colors.primary : theme.colors.textTertiary} />
              <Text style={{
                color: s.user.proactivity === 'P0' ? theme.colors.primaryMuted : theme.colors.textTertiary,
                fontSize: theme.font.tiny,
                marginLeft: 4,
              }}>
                {proactivityShortLabel(s.user.proactivity)}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={{ marginBottom: theme.spacing.sm }}>
        <SyncBadge />
      </View>

      <MilestoneBanner />

      <View style={[styles.briefNoteRow, { marginBottom: theme.spacing.lg }]}>
        <Text style={[styles.briefNote, { color: theme.colors.textTertiary, fontSize: theme.font.tiny }]}>
          今日简报 · 约 90 秒 · 沉默不会被解释为消极
        </Text>
        {source === 'llm' && (
          <Text style={{
            color: theme.colors.primary,
            fontSize: theme.font.tiny,
            fontWeight: '700',
            backgroundColor: theme.colors.primarySoft,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: theme.radius.sm,
          }}>
            AI 生成
          </Text>
        )}
        {source === 'fallback' && (
          <Text style={{
            color: theme.colors.textTertiary,
            fontSize: theme.font.tiny,
            backgroundColor: theme.colors.surfaceSoft,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: theme.radius.sm,
          }}>
            本地规则
          </Text>
        )}
      </View>

      {/* 事实变化 */}
      <Card accent={theme.colors.layerFact}>
        <View style={styles.cardHead}>
          <Tag text="事实变化" color={theme.colors.layerFact} />
          <Glyph name="today" size={18} color={theme.colors.layerFact} />
        </View>
        <Text style={[styles.factTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>
          {brief.factChange.title}
        </Text>
        <Text style={ts.secondary}>{brief.factChange.detail}</Text>
        {brief.factChange.gap && (
          <Text style={[ts.tertiary, { marginTop: 6, fontStyle: 'italic' }]}>数据缺口：{brief.factChange.gap}</Text>
        )}
      </Card>

      {/* 今日承诺 */}
      {brief.commitment && (
        <Card accent={theme.colors.layerCommitment} style={{ marginTop: theme.spacing.md }}>
          <View style={styles.cardHead}>
            <Tag text="今日承诺" color={theme.colors.layerCommitment} />
            <Text style={ts.tertiary}>可更换，不制造压力</Text>
          </View>
          <Text style={[styles.factTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>
            {brief.commitment.statement}
          </Text>
          <Text style={ts.secondary}>为什么重要：{brief.commitment.why}</Text>
          {brief.commitment.costNote && (
            <Text style={[ts.tertiary, { marginTop: 4 }]}>代价边界：{brief.commitment.costNote}</Text>
          )}
        </Card>
      )}

      {/* 建议行动 */}
      <Card accent={theme.colors.layerHypothesis} style={{ marginTop: theme.spacing.md }}>
        <View style={styles.cardHead}>
          <Tag text="建议行动" color={theme.colors.layerHypothesis} />
          <Text style={ts.tertiary}>默认「准备」而非自动执行</Text>
        </View>
        <Text style={[styles.factTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>
          {brief.action.title}
        </Text>
        <Text style={ts.secondary}>{brief.action.detail}</Text>
        {activeExp && !todayChecked && (
          <PrimaryButton
            small
            style={{ marginTop: theme.spacing.md, alignSelf: 'flex-start' }}
            title="打卡今天的实验"
            onPress={() => s.checkInExperiment(activeExp.id, '今日已完成（快速打卡）')}
          />
        )}
        {todayChecked && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.spacing.md }}>
            <Glyph name="check" size={16} color={theme.colors.green} />
            <Text style={{ color: theme.colors.green, fontSize: theme.font.small }}>
              今天已打卡 · 连续 {activeExp?.checkIns.filter((c) => c.done).length} 天
            </Text>
          </View>
        )}
      </Card>

      {/* 高信息量问题 */}
      <Card accent={theme.colors.layerExperience} style={{ marginTop: theme.spacing.md }}>
        <View style={styles.cardHead}>
          <Tag text="一个问题" color={theme.colors.layerExperience} />
          <Text style={ts.tertiary}>今天只有这 1 个</Text>
        </View>
        <Text style={[styles.factTitle, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>
          {brief.question}
        </Text>
        <Text style={ts.secondary}>这个问题能显著地区分两种解释。想好了再答，不答也可以。</Text>
      </Card>

      {/* 快速记录 */}
      <SectionTitle title="快速记录" right={<Text style={ts.tertiary}>原始内容先保存在本机</Text>} />
      <View style={[styles.recordRow, { gap: theme.spacing.md }]}>
        {[
          { g: 'voice' as const, label: '语音', note: '镜像主页长按说话' },
          { g: 'pen' as const, label: '文字', note: '即写即存' },
          { g: 'photo' as const, label: '照片', note: '拍摄 / 相册' },
        ].map((r) => (
          <Pressable
            key={r.g}
            accessibilityLabel={`${r.label}记录：${r.note}`}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.recordBtn,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.lg,
                borderWidth: 1,
                borderColor: theme.colors.borderSoft,
                minHeight: theme.touch.minTarget * 1.5,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              },
            ]}
            onPress={() => {
              if (r.g === 'photo') {
                void handleQuickPhoto();
              } else if (r.g === 'voice') {
                navigation.navigate('MirrorHome');
              } else {
                setRecordOpen(true);
              }
            }}
          >
            <Glyph name={r.g} size={24} color={theme.colors.primaryMuted} />
            <Text style={{
              color: theme.colors.textPrimary,
              fontSize: theme.font.small,
              fontWeight: '600',
              marginTop: 6,
            }}>{r.label}</Text>
            <Text style={ts.tertiary}>{r.note}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[ts.tertiary, { textAlign: 'center', marginTop: theme.spacing.md }]}>
        今天不记录也是合法选择 —— 系统不会用沉默推断你的状态
      </Text>

      {/* 记录弹窗 */}
      <Modal visible={recordOpen} transparent animationType="slide">
        <View style={styles.modalMask}>
          <View style={[
            styles.modalCard,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.lg,
              borderTopRightRadius: theme.radius.lg,
              padding: theme.spacing.xl,
              borderTopWidth: 1,
              borderColor: theme.colors.border,
            },
          ]}>
            <Text style={[styles.factTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>
              现在想记下什么？
            </Text>
            <Text style={[ts.secondary, { marginTop: 4 }]}>
              这段内容只保存在你的设备上，属于「体验层」，不会被改写成客观事实。
            </Text>
            <TextInput
              style={{
                marginTop: theme.spacing.lg,
                minHeight: 110,
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                color: theme.colors.textPrimary,
                fontSize: theme.font.body,
                textAlignVertical: 'top',
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
              multiline
              placeholder="此刻的观察、感受或理由…"
              placeholderTextColor={theme.colors.textTertiary}
              value={journal}
              onChangeText={setJournal}
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'flex-end', marginTop: theme.spacing.lg }}>
              <PrimaryButton small ghost title="放弃" onPress={() => { setRecordOpen(false); setJournal(''); }} />
              <PrimaryButton
                small
                title="保存到本地"
                onPress={() => {
                  if (journal.trim()) s.addJournal(journal.trim());
                  setRecordOpen(false);
                  setJournal('');
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* 主动性选择器 */}
      <Modal visible={proactOpen} transparent animationType="slide">
        <View style={styles.modalMask}>
          <View style={[
            styles.modalCard,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.lg,
              borderTopRightRadius: theme.radius.lg,
              padding: theme.spacing.xl,
              borderTopWidth: 1,
              borderColor: theme.colors.border,
            },
          ]}>
            <Text style={[styles.factTitle, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>
              多久主动找我
            </Text>
            <Text style={[ts.tertiary, { marginTop: 4, marginBottom: theme.spacing.lg }]}>
              我多久主动找你一次。完全静默也不会影响你记录和查看镜子。
            </Text>
            {PROACTIVITY_OPTIONS.map((opt) => {
              const active = s.user.proactivity === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityLabel={`主动性：${opt.label}。${opt.desc}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => { s.setProactivity(opt.value); setProactOpen(false); }}
                  style={[
                    styles.proactRow,
                    {
                      paddingVertical: theme.spacing.md,
                      paddingHorizontal: theme.spacing.md,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.primary : theme.colors.borderSoft,
                      marginBottom: theme.spacing.sm,
                      minHeight: 48,
                      backgroundColor: active ? theme.colors.primarySoft : 'transparent',
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[
                      ts.body,
                      { fontWeight: '700', color: active ? theme.colors.primaryMuted : theme.colors.textPrimary },
                    ]}>{opt.label}</Text>
                    <Text style={[ts.tertiary, { marginTop: 2 }]}>{opt.desc}</Text>
                  </View>
                  <View style={{
                    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {active && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} />}
                  </View>
                </Pressable>
              );
            })}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.lg }}>
              <PrimaryButton small ghost title="关闭" onPress={() => setProactOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>

      {/* 主题选择器 */}
      <ThemeSelector visible={themeOpen} onClose={() => setThemeOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { paddingBottom: 80 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  avatarContainer: { width: 160, height: 160 },
  hello: { fontWeight: '800', marginTop: 2 },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 36,
  },
  briefNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  briefNote: {},
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  factTitle: { fontWeight: '700', lineHeight: 22, marginBottom: 4 },
  recordRow: { flexDirection: 'row' },
  recordBtn: {
    flex: 1,
    alignItems: 'center',
  },
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  proactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
