import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../theme/theme';
import { Card, useTextStyles } from './ui';
import {
  DEFAULT_NATIVE_LLM_CONFIG,
  getNativeLlmConfig,
  hasNativeLlmApiKey,
  saveNativeLlmConfig,
  setNativeLlmApiKey,
  type NativeLlmProvider,
} from '../services/nativeLlm';

export function NativeLlmSettingsCard() {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<NativeLlmProvider>('deepseek');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_NATIVE_LLM_CONFIG.baseUrl);
  const [model, setModel] = useState(DEFAULT_NATIVE_LLM_CONFIG.model);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getNativeLlmConfig(), hasNativeLlmApiKey()])
      .then(([config, keyExists]) => {
        setEnabled(config.enabled);
        setProvider(config.provider);
        setBaseUrl(config.baseUrl);
        setModel(config.model);
        setHasKey(keyExists);
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : '读取模型配置失败'))
      .finally(() => setBusy(false));
  }, []);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await saveNativeLlmConfig({ enabled, provider, baseUrl, model });
      if (apiKey.trim()) {
        await setNativeLlmApiKey(apiKey);
        setApiKey('');
      }
      const keyExists = await hasNativeLlmApiKey();
      setHasKey(keyExists);
      setStatus(enabled && !keyExists
        ? '配置已保存在本机；还需要填写 API Key 才会调用模型。'
        : '配置已保存在本机。API Key 写入系统安全存储，不进入普通数据区。');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存模型配置失败');
    } finally {
      setBusy(false);
    }
  };

  const chooseProvider = (next: NativeLlmProvider) => {
    setProvider(next);
    if (next === 'deepseek') {
      setBaseUrl('https://api.deepseek.com');
      setModel('deepseek-chat');
    }
  };

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <View style={styles.head}>
        <View style={{ flex: 1, paddingRight: theme.spacing.md }}>
          <Text style={[ts.body, { color: theme.colors.textPrimary, fontWeight: '700' }]}>原生端大模型 API</Text>
          <Text style={[ts.tertiary, { marginTop: 4, lineHeight: 17 }]}>这是原生 App 唯一允许的外部网络出口。未启用或没有密钥时，秘书只做本地规则处理。</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          accessibilityLabel={`大模型 API：${enabled ? '已启用' : '已关闭'}`}
        />
      </View>

      <View style={[styles.segment, { marginTop: theme.spacing.md }]}>
        {(['deepseek', 'openai-compatible'] as NativeLlmProvider[]).map((value) => (
          <Pressable
            key={value}
            onPress={() => chooseProvider(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: provider === value }}
            style={[
              styles.segmentButton,
              { borderColor: provider === value ? theme.colors.primary : theme.colors.borderSoft, borderRadius: theme.radius.md },
              provider === value ? { backgroundColor: theme.colors.primarySoft } : null,
            ]}
          >
            <Text style={[ts.tertiary, { color: provider === value ? theme.colors.primary : theme.colors.textSecondary, fontWeight: '700' }]}>
              {value === 'deepseek' ? 'DeepSeek' : 'OpenAI 兼容'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>API 基址（仅 HTTPS）</Text>
      <TextInput
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="大模型 API 基址"
        style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }]}
        placeholder="https://api.example.com/v1"
        placeholderTextColor={theme.colors.textTertiary}
      />

      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>模型</Text>
      <TextInput
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="大模型名称"
        style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }]}
        placeholder="deepseek-chat"
        placeholderTextColor={theme.colors.textTertiary}
      />

      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>API Key</Text>
      <TextInput
        value={apiKey}
        onChangeText={setApiKey}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        accessibilityLabel="大模型 API Key"
        style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface }]}
        placeholder={hasKey ? '已保存在系统安全存储；留空保持不变' : '输入后只写入系统安全存储'}
        placeholderTextColor={theme.colors.textTertiary}
      />

      <Pressable
        onPress={save}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="保存本机模型配置"
        style={[styles.save, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md, minHeight: theme.touch.minTarget }, busy ? { opacity: 0.6 } : null]}
      >
        {busy ? <ActivityIndicator color={theme.colors.textInverse} /> : <Text style={[ts.body, { color: theme.colors.textInverse, fontWeight: '700' }]}>保存本机模型配置</Text>}
      </Pressable>

      {status ? <Text style={[ts.tertiary, { marginTop: theme.spacing.sm, color: status.includes('失败') || status.includes('无效') ? theme.colors.red : theme.colors.textSecondary }]}>{status}</Text> : null}
      <Text style={[ts.tertiary, { marginTop: theme.spacing.sm, lineHeight: 17 }]}>不会自动上传照片、语音、精确位置、完整时间线或本地数据库。秘书调用模型时只发送当前输入与最多 8 条对话上下文。</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  segment: { flexDirection: 'row', gap: 8 },
  segmentButton: { flex: 1, minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  save: { marginTop: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
});
