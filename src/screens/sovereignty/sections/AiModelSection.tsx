/**
 * AiModelSection —— 「AI 与模型」子页（V4.3 Task 25.2）
 *
 * 显示当前模型供应商（DeepSeek）、发送的数据类别（基于 Service Contract R/A/D 轴裁剪后的上下文摘要），
 * 提供「仅本地 / 最小上下文」选项（local_only 开关 + model_provider 选择）。
 *
 * 去人机感：用「发送给模型的内容」替代「数据上传」，用「仅本地」替代「离线模式」。
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Switch, Pressable, Alert, Platform } from 'react-native';
import { Card, Tag, PrimaryButton, Divider, useTextStyles } from '../../../components/ui';
import { Glyph } from '../../../components/glyphs';
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
  { value: 'deepseek', label: 'DeepSeek', note: '调用 DeepSeek API。根据 DeepSeek 隐私政策，请求内容不用于训练。' },
  { value: 'openai-compatible', label: '其他 OpenAI 兼容接口', note: '通过你配置的 OpenAI 兼容接口调用。请自行确认供应商的隐私政策。' },
  { value: 'local', label: '本地模型', note: '在你本机运行的模型。数据不出设备。' },
];

export function AiModelSection({ contract, onPatch }: Props) {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const localOnly = contract?.local_only ?? false;
  const provider = contract?.model_provider ?? 'deepseek';

  // 基于服务契约 R/A/D 轴推导「发送给模型的内容」清单
  const sentCategories = useMemo(() => {
    const r = contract?.reflection_depth ?? 'R1';
    const d = contract?.data_scope ?? { D0: true, D1: false, D2: false, D3: false, D4: false };
    const items: string[] = [];
    // D 轴：每一类数据是否进入上下文
    (Object.keys(D_LABEL) as DataScopeAxis[]).forEach((k) => {
      if (d[k]) items.push(D_LABEL[k]);
    });
    // R 轴：决定是否含假设/模式/建议
    if (r === 'R0') {
      // R0：仅事实回放，已含事件，不含 hypotheses/patterns
    } else if (r === 'R1') {
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

  const toggleLocalOnly = (value: boolean) => {
    onPatch({ local_only: value });
  };

  const switchProvider = (value: string) => {
    onPatch({ model_provider: value });
    if (value === 'local') {
      // 切到本地时自动开启 local_only
      onPatch({ local_only: true });
    }
    const note = MODEL_PROVIDERS.find((p) => p.value === value)?.note ?? '';
    if (Platform.OS === 'web') {
      // Web 端不弹 Alert，用 toast 反馈（onPatch 会触发 SovereigntyScreen 的 toast）
    } else {
      Alert.alert('已切换模型供应商', note);
    }
  };

  return (
    <View>
      <Text style={[styles.intro, ts.secondary]}>
        这里告诉你我背后的模型是谁、发给它了哪些内容，以及怎么把发送范围缩到最小。
      </Text>

      {/* 当前模型供应商 */}
      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>当前模型</Text>
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

      {/* 发送的数据类别 */}
      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>发送给模型的内容</Text>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          根据你设定的「想听到多深」（{R_LABEL[contract?.reflection_depth ?? 'R1']}）和「我可以看哪些数据」，
          下面这些内容会作为上下文发给模型。
        </Text>
        <View style={styles.catList}>
          {sentCategories.length === 0 && (
            <Text style={ts.tertiary}>（当前不发送任何内容）</Text>
          )}
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
            不发送：原始照片像素、语音原始波形、精确位置、全量聊天记录、消费记录。
            服务器只接收已脱敏的文本与结构化特征。
          </Text>
        </View>
      </Card>

      {/* 仅本地 / 最小上下文 */}
      <Card style={[styles.sectionCard, { marginBottom: theme.spacing.md }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}>仅本地模式</Text>
          <Switch
            value={localOnly}
            onValueChange={toggleLocalOnly}
            trackColor={{ false: theme.colors.border, true: theme.colors.indigo }}
            thumbColor="#fff"
            accessibilityLabel={`仅本地模式：${localOnly ? '已开启' : '已关闭'}。开启后不再向模型发送任何内容`}
            accessibilityRole="switch"
            accessibilityState={{ checked: localOnly }}
          />
        </View>
        <Text style={[ts.secondary, { marginTop: theme.spacing.sm }]}>
          开启后，我不再调用云端模型。所有回应都来自本地的规则与已沉淀的方法。
          你仍可以记录事件、查看镜子、做实验；只是不会得到新的 AI 回应。
        </Text>
        {localOnly && (
          <View style={[styles.noteBox, { borderColor: theme.colors.amber, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md }]}>
            <Glyph name="warn" size={14} color={theme.colors.amber} />
            <Text style={[ts.tertiary, { flex: 1, lineHeight: 17 }]}>
              已开启仅本地。秘书对话与周镜/月镜将使用本地降级回应，不再调用模型。
            </Text>
          </View>
        )}
      </Card>

      {/* 最小上下文按钮：一键收紧 R/A/D 到最小 */}
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
  noteBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12,
    borderWidth: 1,
  },
  providerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1,
    minHeight: 48,
  },
  providerRowActive: {},
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', marginLeft: 12,
  },
  radioActive: {},
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
