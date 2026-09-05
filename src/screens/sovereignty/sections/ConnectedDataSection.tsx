/**
 * ConnectedDataSection —— 「连接的数据」子页（V4.3 Task 25.3 + 25.7）
 *
 * 显示用户已授权的数据源：读取什么、上次读取时间、用于什么、撤回。
 * 撤回权限与删除历史数据分离（SubTask 25.7）：
 *   - 撤回权限：仅写 source_permissions.revoked_at，后台不再读取该源
 *   - 删除历史数据：调 DELETE /api/data/evidence-by-source/:source，软删除该来源的全部 evidence
 * 用户可在撤回 Modal 中选择「同时删除历史数据」。
 *
 * 每类授权把可用连接器和“仅聚合”范围写入 scope；原生适配器必须单独报告可用性，
 * 不允许在模块缺失时用假数据或另一来源静默替代。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Switch, Platform, Alert } from 'react-native';
import { Card, Tag, PrimaryButton, Divider, useTextStyles } from '../../../components/ui';
import { Glyph } from '../../../components/glyphs';
import { useAppTheme } from '../../../theme/theme';
import { api } from '../../../services/api';
import type { SourcePermission, DataType } from '../../../types/models';
import { useAvatarV2Store } from '../../../mirror3d/store/useAvatarV2Store';
import { useLifeSignalStore } from '../../../ai-native/connectors/useLifeSignalStore';

/** 数据源类型 → 显示信息映射 */
const DATA_TYPE_META: {
  key: DataType;
  label: string;
  purpose: string;
  evidenceSource: string;
  connectors?: string[];
  setup?: string;
}[] = [
  { key: 'calendar', label: '日历', purpose: '记录会议与截止时间，用于今日简报与镜子页', evidenceSource: 'calendar' },
  { key: 'task', label: '任务', purpose: '记录任务完成情况，用于进度回顾', evidenceSource: 'task' },
  {
    key: 'health', label: '穿戴与健康摘要', purpose: '记录睡眠、步数、活动与心率聚合，用于恢复状态和镜像微调', evidenceSource: 'health',
    connectors: ['health_connect', 'xiaomi_mi_fitness', 'xiaomi_export', 'apple_health'],
    setup: '小米手环优先由 Mi Fitness 写入 Health Connect；地区或型号不支持时可走用户导出文件。',
  },
  {
    key: 'device_usage', label: '手机使用摘要', purpose: '记录总屏幕时长与深夜使用分钟数，不读取输入内容', evidenceSource: 'device_usage',
    connectors: ['android_usage_stats', 'ios_device_activity'],
    setup: 'Android 需要系统“使用情况访问权限”；iOS 需要 Family Controls entitlement。',
  },
  {
    key: 'desktop_usage', label: '电脑使用摘要', purpose: '记录活跃时长与深夜使用摘要，不上传窗口标题和 URL', evidenceSource: 'desktop_usage',
    connectors: ['activitywatch'],
    setup: '需要电脑端 ActivityWatch 或后续桌面伴侣；手机不能直接读取另一台电脑的本地数据。',
  },
  {
    key: 'nutrition', label: '饮食与零食', purpose: '拍照或条码先生成候选，用户确认份量后才进入营养趋势', evidenceSource: 'nutrition',
    connectors: ['food_camera', 'food_barcode'],
    setup: '未确认的图片候选不会影响数字孪生；原照片默认仅在本机短暂处理。',
  },
  { key: 'photo', label: '照片', purpose: '用户明确发起的本地尺寸或形象拟合处理，不上传像素，不推断情绪', evidenceSource: 'photo' },
  { key: 'microphone', label: '麦克风', purpose: '语音转文字记录，不上传原始音频', evidenceSource: 'manual_voice' },
  { key: 'location', label: '位置', purpose: '粗粒度位置用于情境识别，不追踪精确轨迹', evidenceSource: 'system' },
  { key: 'notification', label: '通知', purpose: '记录来自其他 App 的提醒，用于上下文', evidenceSource: 'system' },
];

interface Props {
  pushAudit: (actor: string, action: string, targetRef?: string) => void;
}

export function ConnectedDataSection({ pushAudit }: Props) {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const [permissions, setPermissions] = useState<SourcePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 撤回确认 Modal 状态：null = 关闭，{dataType, label} = 等待用户确认是否同时删除历史
  const [revokeConfirm, setRevokeConfirm] = useState<{ dataType: DataType; label: string } | null>(null);
  const [deleteHistoryToo, setDeleteHistoryToo] = useState(false);
  const avatarPermissions = useAvatarV2Store((state) => state.profile.permissions);
  const setAvatarPermissions = useAvatarV2Store((state) => state.setPermissions);
  const resetAdaptiveAppearance = useAvatarV2Store((state) => state.resetAdaptiveAppearance);
  const recomputeAvatar = useLifeSignalStore((state) => state.recomputeAvatar);
  const purgeConnector = useLifeSignalStore((state) => state.purgeConnector);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.sourcePermissions.list();
      setPermissions(list);
    } catch (err: any) {
      setError(err?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 取某数据类型当前生效的授权记录（granted_at 非空且 revoked_at 为空）
  const activePerm = useCallback((dt: DataType): SourcePermission | null => {
    const matches = permissions.filter((p) => p.data_type === dt);
    // 按 created_at 倒序取第一条 revoked_at 为空的
    return matches.find((p) => p.granted_at && !p.revoked_at) ?? null;
  }, [permissions]);

  // 取该数据类型最近一次授权的 granted_at（用于显示「上次读取时间」）
  const lastGrantedAt = useCallback((dt: DataType): string | null => {
    const matches = permissions.filter((p) => p.data_type === dt && p.granted_at);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => (b.granted_at ?? '').localeCompare(a.granted_at ?? ''))[0].granted_at;
  }, [permissions]);

  // 授权一个数据源
  const grant = async (dt: DataType) => {
    if (busy) return;
    setBusy(true);
    try {
      const meta = DATA_TYPE_META.find((m) => m.key === dt);
      await api.sourcePermissions.grant({
        data_type: dt,
        purpose: meta?.purpose,
        scope: meta?.connectors ? {
          connectorIds: meta.connectors,
          collection: 'aggregate_only',
          adaptiveTwin: 'explainable_bounded',
          rawUpload: false,
        } : undefined,
      });
      pushAudit('用户', `授权数据源：${meta?.label ?? dt}`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? '授权失败');
    } finally {
      setBusy(false);
    }
  };

  // 撤回权限：先弹 Modal 确认是否同时删除历史数据
  const askRevoke = (dt: DataType, label: string) => {
    setDeleteHistoryToo(false);
    setRevokeConfirm({ dataType: dt, label });
  };

  // 执行撤回（可选同时删除历史数据）
  const doRevoke = async () => {
    if (!revokeConfirm || busy) return;
    const { dataType, label } = revokeConfirm;
    setBusy(true);
    try {
      // 1. 撤回权限（仅写 revoked_at）
      await api.sourcePermissions.revoke(dataType);
      pushAudit('用户', `撤回数据源权限：${label}`);

      // 2. 若用户选择「同时删除历史数据」，调删除接口
      if (deleteHistoryToo) {
        const meta = DATA_TYPE_META.find((m) => m.key === dataType);
        if (meta) {
          try {
            const result = await api.deleteEvidenceBySource(meta.evidenceSource);
            for (const connectorId of meta.connectors ?? []) {
              purgeConnector(connectorId as Parameters<typeof purgeConnector>[0]);
            }
            pushAudit('用户', `同时删除 ${label} 历史数据 ${result.deletedCount} 条`);
            if (Platform.OS !== 'web') {
              Alert.alert('已撤回并删除', `已撤回 ${label} 权限，并删除了 ${result.deletedCount} 条历史数据。`);
            }
          } catch (err: any) {
            setError(`删除历史数据失败：${err?.message ?? '未知错误'}`);
          }
        }
      } else if (Platform.OS !== 'web') {
        Alert.alert('已撤回', `已撤回 ${label} 权限。历史数据保留，但你可以在「带走 / 清空」中单独删除。`);
      }

      setRevokeConfirm(null);
      await load();
    } catch (err: any) {
      setError(err?.message ?? '撤回失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centerWrap, { paddingVertical: theme.spacing.xl }]}>
        <ActivityIndicator color={theme.colors.indigo} />
        <Text style={[ts.tertiary, { marginTop: theme.spacing.sm }]}>正在读取已连接的数据源…</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={[styles.intro, ts.secondary]}>
        这里显示你授权我读取的每一类数据。接口、用途和隐私范围已经固定；原生模块或桌面伴侣未安装时会明确显示不可用，不会用模拟数据代替。
      </Text>

      <Card style={[styles.permCard, { marginBottom: theme.spacing.md, paddingVertical: theme.spacing.md }]}>
        <Text style={[ts.body, { fontWeight: '800' }]}>3D 数字孪生适应</Text>
        <Text style={[ts.tertiary, { marginTop: 4, lineHeight: 18 }]}>
          已确认的生活摘要可形成会衰减的黑眼圈、恢复动作和紧绷表现。它不改写身份或性格，也不作医学诊断。
        </Text>
        <View style={[styles.adaptationRow, { borderTopColor: theme.colors.borderSoft }]}>
          <View style={{ flex: 1 }}>
            <Text style={[ts.body, { fontWeight: '600' }]}>允许临时状态微调</Text>
            <Text style={ts.tertiary}>关闭会立即清空当前效果，保留原始授权由你单独管理。</Text>
          </View>
          <Switch
            value={avatarPermissions.lifeDataAdaptation}
            onValueChange={(enabled) => {
              setAvatarPermissions({ lifeDataAdaptation: enabled });
              if (enabled) {
                resetAdaptiveAppearance(false);
                recomputeAvatar();
              }
              pushAudit('用户', `${enabled ? '开启' : '关闭'}数字孪生生活数据适应`);
            }}
            accessibilityLabel="允许生活数据微调数字孪生"
            accessibilityRole="switch"
            accessibilityState={{ checked: avatarPermissions.lifeDataAdaptation }}
          />
        </View>
        <View style={[styles.adaptationRow, { borderTopColor: theme.colors.borderSoft }]}>
          <View style={{ flex: 1 }}>
            <Text style={[ts.body, { fontWeight: '600' }]}>允许长期体型趋势</Text>
            <Text style={ts.tertiary}>单餐绝不改变体型；至少需要跨 14 天的体重或跨日能量趋势。</Text>
          </View>
          <Switch
            value={avatarPermissions.bodyTrendAdaptation}
            onValueChange={(enabled) => {
              setAvatarPermissions({ bodyTrendAdaptation: enabled });
              recomputeAvatar();
              pushAudit('用户', `${enabled ? '开启' : '关闭'}数字孪生体型趋势适应`);
            }}
            accessibilityLabel="允许长期趋势微调数字孪生体型"
            accessibilityRole="switch"
            accessibilityState={{ checked: avatarPermissions.bodyTrendAdaptation }}
            disabled={!avatarPermissions.lifeDataAdaptation}
          />
        </View>
      </Card>

      {error && (
        <View style={[styles.errorBox, { backgroundColor: theme.colors.redSoft, borderRadius: theme.radius.md, padding: theme.spacing.sm, marginBottom: theme.spacing.sm, borderColor: theme.colors.red }]}>
          <Glyph name="warn" size={14} color={theme.colors.red} />
          <Text style={[ts.secondary, { flex: 1, color: theme.colors.red }]}>{error}</Text>
          <Pressable onPress={() => setError(null)} accessibilityLabel="关闭错误提示" accessibilityRole="button">
            <Text style={{ color: theme.colors.red, fontSize: theme.font.tiny }}>×</Text>
          </Pressable>
        </View>
      )}

      {DATA_TYPE_META.map((meta) => {
        const active = activePerm(meta.key);
        const lastAt = lastGrantedAt(meta.key);
        return (
          <Card key={meta.key} style={[styles.permCard, { marginBottom: theme.spacing.sm, paddingVertical: theme.spacing.md }]}>
            <View style={[styles.permHead, { gap: theme.spacing.sm }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[ts.body, { fontWeight: '700' }]}>{meta.label}</Text>
                  {active ? (
                    <Tag text="用途已授权" color={theme.colors.green} />
                  ) : (
                    <Tag text="未授权" color={theme.colors.textTertiary} />
                  )}
                </View>
                <Text style={[ts.tertiary, { marginTop: 4 }]}>用途：{meta.purpose}</Text>
                {meta.setup ? <Text style={[ts.tertiary, { marginTop: 3 }]}>接入：{meta.setup}</Text> : null}
                {lastAt && (
                  <Text style={ts.tertiary}>
                    上次用途授权：{new Date(lastAt).toLocaleDateString('zh-CN')}
                  </Text>
                )}
              </View>
              <Switch
                value={!!active}
                onValueChange={(v) => v ? grant(meta.key) : askRevoke(meta.key, meta.label)}
                trackColor={{ false: theme.colors.border, true: theme.colors.green }}
                thumbColor="#fff"
                accessibilityLabel={`${meta.label}：${active ? '用途已授权，点击撤回' : '未授权，点击授权'}`}
                accessibilityRole="switch"
                accessibilityState={{ checked: !!active }}
                disabled={busy}
              />
            </View>
          </Card>
        );
      })}

      <View style={[styles.noteBox, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderColor: theme.colors.borderSoft }]}>
        <Glyph name="shield" size={16} color={theme.colors.green} />
        <Text style={[ts.tertiary, { flex: 1, lineHeight: 17 }]}>
          撤回权限不会自动删除已经记录下的历史数据。如果你希望同时删除，撤回时会单独问你一次。
          也可以之后在「带走 / 清空」里单独删除某一类的全部历史。
        </Text>
      </View>

      {/* 撤回确认 Modal：是否同时删除历史数据 */}
      {revokeConfirm && (
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, borderColor: theme.colors.border }]}>
            <Text style={[ts.title, { fontSize: theme.font.section }]}>
              撤回「{revokeConfirm.label}」权限
            </Text>
            <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
              撤回后我不会再读取这一类数据。已记录下的历史数据会保留供审计，但不会再用作新的推断。
            </Text>
            <View style={[styles.deleteRow, { marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, borderColor: theme.colors.borderSoft }]}>
              <View style={{ flex: 1 }}>
                <Text style={[ts.body, { fontWeight: '600' }]}>同时删除历史数据</Text>
                <Text style={ts.tertiary}>
                  勾选后会立即软删除这一类的全部历史证据，并触发派生认识的重算。不可撤销。
                </Text>
              </View>
              <Switch
                value={deleteHistoryToo}
                onValueChange={setDeleteHistoryToo}
                trackColor={{ false: theme.colors.border, true: theme.colors.red }}
                thumbColor="#fff"
                accessibilityLabel={`是否同时删除 ${revokeConfirm.label} 的历史数据`}
                accessibilityRole="switch"
                accessibilityState={{ checked: deleteHistoryToo }}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.lg, justifyContent: 'flex-end' }}>
              <PrimaryButton small ghost title="取消" onPress={() => setRevokeConfirm(null)} disabled={busy} />
              <PrimaryButton
                small danger
                title={busy ? '处理中…' : (deleteHistoryToo ? '撤回并删除历史' : '仅撤回权限')}
                onPress={doRevoke}
                disabled={busy}
                accessibilityLabel={deleteHistoryToo ? '撤回权限并删除历史数据' : '仅撤回权限，保留历史数据'}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { lineHeight: 19, marginBottom: 12 },
  centerWrap: { alignItems: 'center', justifyContent: 'center' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1,
  },
  permCard: {},
  permHead: { flexDirection: 'row', alignItems: 'center' },
  adaptationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, marginTop: 12,
    borderTopWidth: 1,
  },
  noteBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12,
    borderWidth: 1,
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', zIndex: 99,
  },
  modalCard: {
    borderWidth: 1,
    maxWidth: 360, width: '90%',
  },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1,
  },
});
