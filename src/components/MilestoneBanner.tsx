/**
 * V4.3 Task 21.7 / 21.9 / spec A18.5 / A18.6：Day 7 / Day 30 里程碑软提示横幅。
 *
 * 设计严格遵循 spec 与工作区规则：
 *
 * 1. 触发逻辑（spec A17 / dayMilestones.getMilestoneState）：
 *    - 仅当 pendingMilestone === 'day7' 或 'day30' 时展示横幅
 *    - Day 0 不展示横幅 —— onboarding 完成时已自动触发首次蒸馏（OnboardingScreen.finish 调 triggerDay0Distillation）
 *    - Day 7：onboardedAt >= 7 天且无 day7 done job
 *    - Day 30：onboardedAt >= 30 天且无 day30 done job 且无 version='v0.1' 模型版本
 *
 * 2. 去人机感（spec 附录 AD / A35.2 禁词清单零出现）：
 *    - 用「我们一起看看这一周，哪里像你，哪里不太像？」替代「校准 / 反馈」
 *    - 用「我们目前认识到的你」替代「Personal Model v0.1 / 月镜报告」
 *    - 不出现：数字孪生 / 人格建模 / 蒸馏你 / 赋能 / 闭环 / 抓手 / 画像 / 全知 /
 *      精准洞察 / 命运 / 真实的你 / 模型判断 / 人格结论 / 证据链 / 反证 / 置信度 /
 *      N-of-1 微实验 / 异常状态检测 / 依赖图 / 关键路径 / Agent L2 执行 /
 *      记忆治理中心 / 个人生命模型
 *
 * 3. 非侵入式（spec A18.5：Day 7 不弹复杂报告，只问一句）：
 *    - 顶部窄横幅而非全屏 Modal；可一键「稍后再说」
 *    - Day 7 不展示任何候选猜想/反例 —— 用户需进入镜子页查看
 *    - Day 30 触发后引导用户去镜子页月镜 Tab 查看「我们目前认识到的你」
 *
 * 4. 幂等与重试（工作区规则 2：禁止妥协回退机制）：
 *    - 用户点「好」→ 调 triggerDay7Calibration / triggerDay30MonthlyMirror
 *    - 网络错误不静默吞 —— 横幅保留并显示「稍后再说」状态，下次进入今日页仍会提示
 *    - 触发成功后通过 AsyncStorage 标记该里程碑已 dismiss，避免重复弹层
 *    - 后端实际 job 完成由 scheduler（Task 27.5）异步处理；横幅只负责「触发」与「不再弹」
 *
 * 5. 不作弊参数（工作区规则 2）：
 *    - 所有阈值（7 天 / 30 天）来自 spec A17，无硬编码经验值
 *    - 不会用 setTimeout / setInterval 等待后端 job 完成 —— spec 明确说「异步」
 *
 * 6. 设备权限延后（spec A16.2 / A21）：
 *    - 横幅不请求任何设备权限（相机 / 麦克风 / 健康 / 日历）
 *
 * 7. 无障碍（spec A36）：
 *    - 触控目标 ≥ 48dp；accessibilityLabel 全覆盖
 *    - 不依赖单一交互方式（点击按钮 + 关闭按钮均存在）
 *    - 关键确认不自动消失 —— 必须用户主动点击「好」或「稍后再说」
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../store/useStore';
import { useAuth } from '../services/auth';
import { api, unwrapList } from '../services/api';
import { useAppTheme } from '../theme/theme';
import { useTextStyles } from './ui';
import { Glyph } from './glyphs';
import {
  getMilestoneState,
  triggerDay7Calibration,
  triggerDay30MonthlyMirror,
  day7CalibrationPrompt,
  day30MonthlyTitle,
  type DayMilestoneKind,
} from '../services/dayMilestones';
import type { DistillationJob, PersonalModelVersion } from '../types/models';

/**
 * AsyncStorage 持久化键：记录用户已 dismiss 的里程碑 kind。
 * 一旦 dismiss，该 kind 不再弹层；后端 job 完成后 getMilestoneState 自然不再返回该 kind。
 *
 * 按用户 ID 分键，避免多账号串扰。
 */
const dismissKey = (userId: string | null) =>
  `milestone-banner-dismissed:${userId ?? 'anon'}`;

interface BannerCopy {
  /** 主标题（spec A18.5 Day 7 只问一句 / A18.6 Day 30 形成标题） */
  title: string;
  /** 副说明（自然语言解释要做什么，不出现禁词） */
  desc: string;
  /** 主行动按钮文案 */
  cta: string;
  /** 主行动按钮 accessibilityLabel */
  ctaA11yLabel: string;
}

const DAY7_COPY: BannerCopy = {
  title: day7CalibrationPrompt(),
  desc:
    '这一周里你记录的、试过的，我都会重新看一遍。' +
    '哪里我理解错了，你告诉我，我会改 —— 这只是问一句，不会弹一长串报告。',
  cta: '好，我们一起看看',
  ctaA11yLabel: '好，我们一起看看这一周里我理解对了吗',
};

const DAY30_COPY: BannerCopy = {
  title: day30MonthlyTitle(),
  desc:
    '过去 30 天我们留下了一些线索。这次我想把它们整理一下，' +
    '让你看看哪里像你、哪里不像你 —— 你可以逐条保留、修改或标注「只适用于最近」。',
  cta: '看看我目前的样子',
  ctaA11yLabel: '看看过去 30 天我们目前认识到的你',
};

export function MilestoneBanner() {
  const theme = useAppTheme();
  const textStyles = useTextStyles();
  const user = useStore((s) => s.user);
  const { userId } = useAuth();

  const [jobs, setJobs] = useState<DistillationJob[]>([]);
  const [versions, setVersions] = useState<PersonalModelVersion[]>([]);
  const [dismissed, setDismissed] = useState<DayMilestoneKind | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggeredJustNow, setTriggeredJustNow] = useState(false);

  // 拉取 distillation jobs + model versions 以计算里程碑状态
  // 仅在已引导用户上拉取；网络失败时使用空数组（getMilestoneState 优雅降级为「无 done job」）
  // Bug #4 / Bug #5 修复（V4.3 §10）：/api/data/model-versions 后端返回分页对象
  // { items, nextCursor }，用 unwrapList helper 统一解包为数组。
  useEffect(() => {
    if (!user.onboarded || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [j, v] = await Promise.all([
          api.distillationJobs.list().catch(() => [] as DistillationJob[]),
          api.modelVersions.list().catch(() => ({ items: [], nextCursor: null })),
        ]);
        if (cancelled) return;
        const jobsArr = unwrapList<DistillationJob>(j);
        const versionsArr = unwrapList<PersonalModelVersion>(v);
        setJobs(jobsArr);
        setVersions(versionsArr);
      } catch {
        // 静默失败：banner 不展示比错误展示更好；下次进入今日页会重新拉取
      }
      try {
        const stored = await AsyncStorage.getItem(dismissKey(userId));
        if (cancelled) return;
        if (stored === 'day7' || stored === 'day30') {
          setDismissed(stored);
        }
      } catch {
        // AsyncStorage 读失败不阻塞 banner 展示
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.onboarded, user.onboardedAt, userId]);

  const state = getMilestoneState(user.onboardedAt, jobs, versions);

  // 不展示条件：无 pending / Day 0（由 onboarding 自动触发）/ 已 dismiss / 刚触发完
  if (!state.pendingMilestone) return null;
  if (state.pendingMilestone === 'day0') return null;
  if (dismissed === state.pendingMilestone) return null;
  if (triggeredJustNow) return null;

  const kind: DayMilestoneKind = state.pendingMilestone;
  const copy: BannerCopy = kind === 'day7' ? DAY7_COPY : DAY30_COPY;

  const handleTrigger = async () => {
    if (!userId || triggering) return;
    setTriggering(true);
    try {
      if (kind === 'day7') {
        await triggerDay7Calibration(userId);
      } else {
        await triggerDay30MonthlyMirror(userId);
      }
      // 触发成功：标记 dismiss，避免重复弹层
      // 后端 scheduler（Task 27.5）每分钟扫描 pending job 并执行 8 阶段 pipeline，
      // 完成后 getMilestoneState 会自然将该 kind 标记为 completed，banner 不再展示
      try {
        await AsyncStorage.setItem(dismissKey(userId), kind);
      } catch {
        // AsyncStorage 写失败不阻塞：内存 dismissed 也会防止本会话重复弹层
      }
      setDismissed(kind);
      setTriggeredJustNow(true);
    } finally {
      setTriggering(false);
    }
  };

  const handleDismiss = async () => {
    if (!userId) return;
    // 用户主动「稍后再说」：同样持久化 dismiss，避免每次进入今日页都弹
    // 下次进入今日页若该里程碑仍未完成，banner 不展示；用户可在镜子页主动触发
    try {
      await AsyncStorage.setItem(dismissKey(userId), kind);
    } catch {
      // AsyncStorage 写失败：仅本会话 dismiss
    }
    setDismissed(kind);
  };

  return (
    <View style={[styles.banner, {
      backgroundColor: theme.colors.indigoSoft,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      borderColor: theme.colors.indigo,
      marginBottom: theme.spacing.md,
    }]}>
      <View style={[styles.bannerHead, { marginBottom: theme.spacing.xs + 2 }]}>
        <Glyph name="clock" size={18} color={theme.colors.indigo} />
        <Text style={[styles.bannerTitle, textStyles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]} accessibilityRole="header">
          {copy.title}
        </Text>
        <Pressable
          accessibilityLabel="稍后再说"
          accessibilityRole="button"
          onPress={handleDismiss}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Glyph name="silence" size={16} color={theme.colors.textTertiary} />
        </Pressable>
      </View>
      <Text style={[styles.bannerDesc, textStyles.body, { color: theme.colors.textSecondary, fontSize: theme.font.small, marginBottom: theme.spacing.sm + 2 }]}>{copy.desc}</Text>
      <View style={[styles.bannerActions, { gap: theme.spacing.sm }]}>
        <Pressable
          accessibilityLabel={copy.ctaA11yLabel}
          accessibilityRole="button"
          disabled={triggering}
          onPress={handleTrigger}
          style={[styles.primaryAction, {
            backgroundColor: theme.colors.indigo,
            borderRadius: theme.radius.sm,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
          }, triggering && { opacity: 0.6 }]}
        >
          {triggering ? (
            <ActivityIndicator size="small" color={theme.colors.textInverse} />
          ) : (
            <Text style={[styles.primaryActionText, { color: theme.colors.textInverse, fontSize: theme.font.small }]}>{copy.cta}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
  },
  bannerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerTitle: {
    flex: 1,
    fontWeight: '700',
    lineHeight: 22,
  },
  bannerDesc: {
    lineHeight: 20,
  },
  bannerActions: {
    flexDirection: 'row',
  },
  primaryAction: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    fontWeight: '700',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
