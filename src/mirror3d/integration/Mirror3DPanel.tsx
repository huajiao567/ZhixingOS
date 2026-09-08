import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { AvatarCanvasFlagged } from '../avatar/AvatarCanvasFlagged';
import { useAvatarV2Store } from '../store/useAvatarV2Store';
import { useAppTheme } from '../../theme/theme';

interface Mirror3DPanelProps {
  height?: number;
  paused?: boolean;
  active?: boolean;
  onOpenEditor?: () => void;
}

/**
 * 可直接插入现有 MirrorScreen 的轻量Panel。
 */
export function Mirror3DPanel({
  height = 360,
  paused,
  active = true,
  onOpenEditor,
}: Mirror3DPanelProps) {
  const theme = useAppTheme();
  const avatarProfile = useAvatarV2Store((state) => state.profile);
  const [explanationVisible, setExplanationVisible] = useState(false);
  const [timelineVisible, setTimelineVisible] = useState(false);

  const stageTimeline = useMemo(
    () => [...avatarProfile.timeline]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [avatarProfile.timeline],
  );

  const level = (value: number) => value < 0.34 ? '偏低' : value > 0.66 ? '偏高' : '中等';

  return (
    <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.borderSoft }}>
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <AvatarCanvasFlagged profile={avatarProfile} paused={paused} active={active} size={Math.min(height * 0.9, 320)} />
      </View>
      <View style={{ padding: theme.spacing.md }}>
        <Text style={{ color: theme.colors.textPrimary, fontWeight: '800', fontSize: theme.font.body }}>今天的镜像</Text>
        <Text style={{ color: theme.colors.textSecondary, lineHeight: 19, marginTop: 4 }} numberOfLines={2}>
          {avatarProfile.adaptiveAppearance.recoveryNeed > 0.55
            ? '近期恢复信号偏低，镜像正在轻微放慢'
            : avatarProfile.adaptiveAppearance.tension > 0.55 || avatarProfile.dailyState.tension > 0.6
              ? '近期略感紧绷，镜像保持克制表达'
              : avatarProfile.dailyState.energy > 0.6
                ? '状态舒展，能量充足'
                : '平静日常，保持节奏'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 10 }}>
          <Pressable
            onPress={() => setExplanationVisible(true)}
            accessibilityLabel="查看镜像为什么这样显示"
            accessibilityRole="button"
          >
            <Text style={{ color: theme.colors.primaryMuted, fontWeight: '700' }}>为什么这样显示 ›</Text>
          </Pressable>
          <Pressable
            onPress={() => setTimelineVisible(true)}
            accessibilityLabel="查看时间中的自己"
            accessibilityRole="button"
          >
            <Text style={{ color: theme.colors.primaryMuted, fontWeight: '700' }}>时间中的自己 ›</Text>
          </Pressable>
          {onOpenEditor ? (
            <Pressable
              onPress={onOpenEditor}
              accessibilityLabel="调整形象与状态，打开三维镜像编辑器"
              accessibilityRole="button"
            >
              <Text style={{ color: theme.colors.primaryMuted, fontWeight: '700' }}>调整形象 ›</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Modal visible={explanationVisible} transparent animationType="fade" onRequestClose={() => setExplanationVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'center', padding: theme.spacing.lg }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            <Text accessibilityRole="header" style={{ color: theme.colors.textPrimary, fontSize: theme.font.title, fontWeight: '800' }}>为什么这样显示</Text>
            <Text style={{ color: theme.colors.textSecondary, lineHeight: 21, marginTop: theme.spacing.sm }}>
              镜像只对今天的状态做克制表达，不把一次记录变成人格判断。任何状态都可以由你纠正，并会自动过期回到中性。
            </Text>
            {avatarProfile.adaptiveAppearance.reasons.map((reason) => (
              <View key={reason} style={{ borderTopWidth: 1, borderTopColor: theme.colors.borderSoft, marginTop: theme.spacing.md, paddingTop: theme.spacing.sm }}>
                <Text style={{ color: theme.colors.textPrimary, lineHeight: 20 }}>· {reason}</Text>
              </View>
            ))}
            {avatarProfile.adaptiveAppearance.evidenceRefs.length > 0 ? (
              <Text style={{ color: theme.colors.textTertiary, marginTop: theme.spacing.sm }}>
                依据：{avatarProfile.adaptiveAppearance.evidenceRefs.length} 条可追溯摘要；不显示原始照片、窗口标题或输入正文。
              </Text>
            ) : null}
            {[
              ['能量', avatarProfile.dailyState.energy, '影响呼吸与动作幅度'],
              ['紧张', avatarProfile.dailyState.tension, '只影响肩颈与眉部的轻微变化'],
              ['专注', avatarProfile.dailyState.focus, '影响视线稳定与动作节奏'],
              ['社交开放', avatarProfile.dailyState.socialOpenness, '影响视线与表情开放度'],
            ].map(([label, value, note]) => (
              <View key={String(label)} style={{ borderTopWidth: 1, borderTopColor: theme.colors.borderSoft, marginTop: theme.spacing.md, paddingTop: theme.spacing.sm }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{label}：{level(value as number)}</Text>
                <Text style={{ color: theme.colors.textTertiary, marginTop: 3 }}>{note}</Text>
              </View>
            ))}
            <Pressable onPress={() => setExplanationVisible(false)} accessibilityRole="button" accessibilityLabel="关闭显示解释" style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing.lg, backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md }}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>我知道了</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={timelineVisible} transparent animationType="slide" onRequestClose={() => setTimelineVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, padding: theme.spacing.lg, maxHeight: '78%' }}>
            <Text accessibilityRole="header" style={{ color: theme.colors.textPrimary, fontSize: theme.font.title, fontWeight: '800' }}>时间中的自己</Text>
            <Text style={{ color: theme.colors.textSecondary, lineHeight: 20, marginTop: theme.spacing.sm }}>
              这里只读取个人模型的版本摘要，不直接读取原始弱证据，也不会用今天的形象重写过去。
            </Text>
            <ScrollView style={{ marginTop: theme.spacing.md }}>
              {stageTimeline.length === 0 ? (
                <Text style={{ color: theme.colors.textTertiary, paddingVertical: theme.spacing.xl }}>还没有形成阶段版本。日常记录仍可正常使用。</Text>
              ) : stageTimeline.map((entry) => (
                <View key={`${entry.timelineVersion}-${entry.createdAt}`} style={{ borderTopWidth: 1, borderTopColor: theme.colors.borderSoft, paddingVertical: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.textPrimary, fontWeight: '800' }}>
                    {entry.label || entry.sourceModelVersion || `版本 ${entry.timelineVersion}`}
                  </Text>
                  <Text style={{ color: theme.colors.textTertiary, marginTop: 3 }}>
                    身份 {entry.identityVersion} · 外观 {entry.appearanceVersion} · {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                  </Text>
                  {entry.sourceModelVersion ? (
                    <Text style={{ color: theme.colors.textTertiary, marginTop: 3 }}>个人模型：{entry.sourceModelVersion}</Text>
                  ) : null}
                  {entry.note ? <Text style={{ color: theme.colors.textSecondary, lineHeight: 20, marginTop: 6 }}>{entry.note}</Text> : null}
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setTimelineVisible(false)} accessibilityRole="button" accessibilityLabel="关闭时间中的自己" style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center', marginTop: theme.spacing.md, backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.md }}>
              <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
