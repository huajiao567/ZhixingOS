/**
 * AiModelSection —— 「AI 与模型」子页（V4.3 Task 25.2）
 *
 * Web keeps the existing service-contract model provider controls. Native
 * builds additionally expose the only permitted external network boundary:
 * an explicitly configured HTTPS LLM API whose key stays in SecureStore.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Switch, Pressable, Alert, Platform } from 'react-native';
import { Card, Tag, PrimaryButton, Divider, useTextStyles } from '../../../components/ui';
import { Glyph } from '../../../components/glyphs';
import { NativeLlmSettingsCard } from '../../../components/NativeLlmSettingsCard';
import { useAppTheme } from '../../../theme/theme';
import type { ServiceContract, ReflectionDepth, AgencyLevel, DataScopeAxis } from '../../../types/models';

interface Props {
  contract: ServiceContract | null;
  onPatch: (patch: Partial<ServiceContract>) => void;
}

const R_LABEL: Record<ReflectionDepth, string> = {
  R0: '只说事实',
  R1: '加上模式提示',
  R2: '给出可反驳的猜想',
  R3: '提建议让我试',
};

const A_LABEL: Record<AgencyLevel, string> = {
  A0: '只听我说',
  A1: '给建议',
  A2: '帮我准备',
  A3: '帮我执行',
  A4: '全自动',
};

const D_LABEL: Record<DataScopeAxis, string> = {
  D0: '事件',
  D1: '承诺',
  D2: '假设',
  D3: '实验与方法',
  D4: '健康与日历',
};

const MODEL_PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', note: '调用你自己配置的 DeepSeek API。请求内容会发送给该模型供应商。' },
  { value: 'openai-compatible', label: '其他 OpenAI 兼容接口', note: '调用你自己配置的 OpenAI 兼容 HTTPS 接口。请自行确认供应商的数据政策。' },
  { value: 'local', label: '不调用外部模型', note: '只运行设备内规则和算法，不向模型供应商发送内容。' },
];

export function AiModelSection({ contract, onPatch }: Props) {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const localOnly = contract?.local_only ?? false;
  const provider = contract?.model_provider ?? 'deepseek';

  const sentCategories = useMemo(() => {
    const r = contract?.reflection_depth ?? 'R1';
    const d = contract?.data_scope ?? { D0: true, D1: false, D2: false, D3: false, D4: false };
    const items: string[] = [];
    (Object.keys(D_LABEL) as DataScopeAxis[]).forEach((k) => {
      if (d[k]) items.push(D_LABEL[k]);
    });
    if (r === 'R1') {
      items.push('我注意到的可能（候选猜想）');
    } else if (r === 'R2') {
      items.push('我注意到的可能（候选猜想）');
      items.push('可反驳的猜想');
    } else if (r === 'R3') {
      items.push('我注意到的可能（候选猜想）');
      items.push('可反驳的猜想');
      items.push('小实验建议');
    }
    return items;
  }, [contract?.reflection_depth, contract?.data_scope]);

  const toggleLocalOnly = (value: boolean) => onPatch({ local_only: value });

  const switchProvider = (value: string) => {
    onPatch({ model_provider: value });
    if (value === 'local') onPatch({ local_only: true });
    const note = MODEL_PROVIDERS.find((p) => p.value === value)?.note ?? '';
    if (Platform.OS !== 'web') Alert.alert('已切换模型供应商', note);
  };

  return (
    <View>
      <Text style={[styles.intro, ts.secondary]}>
        这里告诉你模型是谁、哪些文本可能发给它，以及怎么把发送范围收紧。原生 App 的个人数据库、数字孪生、确定性算法和媒体文件默认都留在设备内。
      </Text>

      {Platform.OS !== 'web' ? <NativeLlmSettingsCard /> : null}

      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>当前模型策略</Text>
          <Tag text={MODEL_PROVIDERS.find((p) => p.value === provider)?.label ?? provider} color={theme.colors.indigoMuted} />
        </View>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          {MODEL_PROVIDERS.find((p) => p.value === provider)?.note ?? '未配置模型供应商。'}
        </Text>
        <Divider />
        <Text style={[ts.tertiary, { marginBottom: theme.spacing.sm }]}>切换模型：</Text>
        {MODEL_PROVIDERS.map((p) => {
          const active = provider === p.value;
          return (
            <Pressable
              key={p.value}
              accessibilityLabel={`切换模型到 ${p.label}。${p.note}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => switchProvider(p.value)}
              style={[styles.providerRow, active && [styles.providerRowActive, { borderColor: theme.colors.indigo, backgroundColor: theme.colors.indigoSoft }], { borderColor: theme.colors.borderSoft, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[ts.body, { fontWeight: '600', color: active ? theme.colors.indigoMuted : theme.colors.textPrimary }]}>
                  {p.label}
                </Text>
                <Text style={ts.tertiary}>{p.note}</Text>
              </View>
              <View style={[styles.radio, active && [styles.radioActive, { borderColor: theme.colors.indigo }], { borderColor: theme.colors.border }]}>
                {active && <View style={[styles.radioDot, { backgroundColor: theme.colors.indigo }]} />}
              </View>
            </Pressable>
          );
        })}
      </Card>

      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>可能发送给模型的内容</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          根据「想听到多深」（{R_LABEL[contract?.reflection_depth ?? 'R1']}）和数据范围，下面这些类别可以被选入模型上下文。
          原生端当前秘书实现进一步收紧为：只发送本次输入与最多 8 条对话上下文，不自动上传本地数据库。
        </Text>
        <View style={styles.catList}>
          {sentCategories.length === 0 && <Text style={ts.tertiary}>（当前不发送任何内容）</Text>}
          {sentCategories.map((cat, i) => (
            <View key={i} style={styles.catItem}>
              <Glyph name="check" size={12} color={theme.colors.green} />
              <Text style={ts.secondary}>{cat}</Text>
            </View>
          ))}
        </View>
        <View style={[styles.noteBox, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, borderColor: theme.colors.borderSoft }]}>
          <Glyph name="shield" size={14} color={theme.colors.green} />
          <Text style={[ts.tertiary, { flex: 1, lineHeight: 17 }]}>
            原生端不会自动发送：原始照片像素、语音原始波形、精确位置、完整时间线、本地数据库和数字人模型。API Key 只存入系统安全存储。
          </Text>
        </View>
      </Card>

      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>停止外部模型调用</Text>
          <Switch
            value={localOnly}
            onValueChange={toggleLocalOnly}
            trackColor={{ false: theme.colors.border, true: theme.colors.indigo }}
            thumbColor="#fff"
            accessibilityLabel={`停止外部模型调用：${localOnly ? '已开启' : '已关闭'}`}
            accessibilityRole="switch"
            accessibilityState={{ checked: localOnly }}
          />
        </View>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          开启后不调用任何云端大模型。记录、数字孪生、状态推导、意图解析、实验和本地规则仍可运行。
          无论这个开关是否开启，原生 App 的个人数据存储与确定性算法都保持在设备内。
        </Text>
        {localOnly && (
          <View style={[styles.noteBox, { borderColor: theme.colors.amber, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md }]}>
            <Glyph name="warn" size={14} color={theme.colors.amber} />
            <Text style={[ts.tertiary, { flex: 1, lineHeight: 17 }]}>已停止外部模型调用。秘书会使用本地规则回应。</Text>
          </View>
        )}
      </Card>

      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>一键收紧到最小</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          把「想听到多深」收到只说事实、「我可以看哪些数据」只留事件、关掉所有主动出现。
          你仍能看到今天的简报和镜子，但我不会主动找你。
        </Text>
        <PrimaryButton
          small ghost
          title="收紧到最小路径"
          onPress={() => onPatch({
            reflection_depth: 'R0',
            agency_level: 'A0',
            data_scope: { D0: true, D1: false, D2: false, D3: false, D4: false },
            proactivity: 'P0',
            avatar: 'V1',
          })}
          style={{ marginTop: theme.spacing.md, alignSelf: 'flex-start' }}
          accessibilityLabel="一键把服务契约收紧到最小数据路径"
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { lineHeight: 19, marginBottom: 12 },
  sectionCard: {},
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontWeight: '700' },
  catList: { marginTop: 12, gap: 6 },
  catItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  noteBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12, borderWidth: 1 },
  providerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1, minHeight: 48,
  },
  providerRowActive: {},
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  radioActive: {},
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
