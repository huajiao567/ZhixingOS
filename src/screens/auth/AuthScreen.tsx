import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform } from 'react-native';
import { useAuth } from '../../services/auth';
import { useAppTheme } from '../../theme/theme';
import { useTextStyles } from '../../components/ui';
import { Glyph } from '../../components/glyphs';
import { getApiBase, probeApiBase, setApiBase } from '../../services/api';

export function AuthScreen() {
  const theme = useAppTheme();
  const ts = useTextStyles();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverBusy, setServerBusy] = useState(false);
  const [serverStatus, setServerStatus] = useState<string | null>(null);

  useEffect(() => {
    getApiBase().then(setServerUrl).catch(() => undefined);
  }, []);

  const testAndSaveServer = async () => {
    setServerBusy(true);
    setServerStatus(null);
    try {
      const service = await probeApiBase(serverUrl);
      const saved = await setApiBase(serverUrl);
      setServerUrl(saved);
      setServerStatus(`连接成功：${service}`);
      setError(null);
    } catch (e: any) {
      setServerStatus(e?.message ?? '服务器连接失败');
    } finally {
      setServerBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password.trim()) { setError('请填写邮箱和密码'); return; }
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim() || undefined);
    } catch (e: any) {
      setError(e?.message ?? '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = () => {
    setMode('login');
    setEmail('demo@zhixingos.com');
    setPassword('demo1234');
    setError(null);
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.colors.bg }]}
      contentContainerStyle={[styles.container, { padding: theme.spacing.xl, paddingBottom: theme.spacing.xxl + theme.spacing.sm }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.brand, { marginBottom: theme.spacing.xl + theme.spacing.xs }]}>
        <Text style={[styles.kicker, { color: theme.colors.primary }]}>ZHIXING / 01</Text>
        <Text style={[ts.hero, styles.title]}>知行镜</Text>
        <Text style={[ts.secondary, styles.subtitle, { color: theme.colors.textSecondary }]}>记录发生的事，校准对自己的理解。</Text>
      </View>

      <View style={[styles.tabs, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, marginBottom: theme.spacing.lg }]}>
        {(['login', 'register'] as const).map((m) => (
          <Pressable
            key={m}
            style={[styles.tab, mode === m && { backgroundColor: theme.colors.indigo, borderRadius: theme.radius.md }, { minHeight: theme.touch.minTarget, justifyContent: 'center' }]}
            onPress={() => { setMode(m); setError(null); }}
            accessibilityLabel={`切换到${m === 'login' ? '登录' : '注册'}${mode === m ? '，已选中' : ''}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={[ts.body, styles.tabText, { color: mode === m ? theme.colors.textInverse : theme.colors.textTertiary }]}>{m === 'login' ? '登录' : '注册'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'register' && (
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>昵称</Text>
          <TextInput
          style={[styles.input, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.spacing.lg,
            color: theme.colors.textPrimary,
            fontSize: theme.font.body,
            marginBottom: theme.spacing.md,
            borderColor: theme.colors.border,
          }]}
          placeholder="昵称（可选）"
          placeholderTextColor={theme.colors.textTertiary}
          value={name}
          onChangeText={setName}
          />
        </View>
      )}
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>邮箱</Text>
        <TextInput
        style={[styles.input, {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.spacing.lg,
          color: theme.colors.textPrimary,
          fontSize: theme.font.body,
          marginBottom: theme.spacing.md,
          borderColor: theme.colors.border,
        }]}
        placeholder="邮箱"
        placeholderTextColor={theme.colors.textTertiary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        />
      </View>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>密码</Text>
        <TextInput
        style={[styles.input, {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.spacing.lg,
          color: theme.colors.textPrimary,
          fontSize: theme.font.body,
          marginBottom: theme.spacing.md,
          borderColor: theme.colors.border,
        }]}
        placeholder="密码（至少 6 位）"
        placeholderTextColor={theme.colors.textTertiary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        />
      </View>

      {error && <Text style={[ts.secondary, styles.error, { color: theme.colors.red, marginBottom: theme.spacing.sm }]}>{error}</Text>}

      <Pressable
        style={[styles.btn, { backgroundColor: theme.colors.indigo, borderRadius: theme.radius.lg, marginTop: theme.spacing.xs, minHeight: theme.touch.minTarget, justifyContent: 'center' }, busy && { opacity: 0.6 }]}
        onPress={submit}
        disabled={busy}
        accessibilityLabel={mode === 'login' ? '登录账号' : '创建新账号'}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
      >
        {busy ? <ActivityIndicator color={theme.colors.textInverse} size="small" /> : <Text style={[ts.body, styles.btnText, { color: theme.colors.textInverse }]}>{mode === 'login' ? '登录' : '创建账号'}</Text>}
      </Pressable>

      <Pressable
        style={[styles.serverToggle, { marginTop: theme.spacing.md, minHeight: theme.touch.minTarget }]}
        onPress={() => setShowServer((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showServer }}
        accessibilityLabel="配置后端服务器地址"
      >
        <Text style={[ts.secondary, { color: theme.colors.textTertiary }]}>服务器设置 {showServer ? '收起' : '展开'}</Text>
      </Pressable>

      {showServer && (
        <View style={[styles.serverPanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSoft, borderRadius: theme.radius.lg, padding: theme.spacing.md }]}>
          <Text style={[ts.tertiary, { color: theme.colors.textTertiary, marginBottom: theme.spacing.sm }]}>手机需能访问该地址；本机后端默认端口为 3001。</Text>
          <TextInput
            style={[styles.input, { color: theme.colors.textPrimary, borderColor: theme.colors.border, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md }]}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.10:3001"
            placeholderTextColor={theme.colors.textTertiary}
            accessibilityLabel="后端服务器地址"
          />
          <Pressable
            style={[styles.serverSave, { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, minHeight: theme.touch.minTarget }]}
            onPress={testAndSaveServer}
            disabled={serverBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: serverBusy }}
          >
            {serverBusy ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={[ts.secondary, { color: theme.colors.primary, fontWeight: '700' }]}>检测并保存</Text>}
          </Pressable>
          {serverStatus ? <Text style={[ts.tertiary, { color: serverStatus.startsWith('连接成功') ? theme.colors.green : theme.colors.red, marginTop: theme.spacing.sm }]}>{serverStatus}</Text> : null}
        </View>
      )}

      <Pressable
        style={[styles.demoBtn, { marginTop: theme.spacing.lg, padding: theme.spacing.sm, minHeight: theme.touch.minTarget, justifyContent: 'center' }]}
        onPress={fillDemo}
        accessibilityLabel="使用演示账号体验，自动填入 demo 邮箱与密码"
        accessibilityRole="button"
      >
        <Text style={[ts.secondary, styles.demoText, { color: theme.colors.primary }]}>填入演示账号</Text>
      </Pressable>

      <Text style={[ts.tertiary, styles.foot, { marginTop: theme.spacing.xl }]}>
        你的数据通过加密通道传输，存储于你自己的后端。{'\n'}
        本应用不提供医疗诊断，高风险表达会触发独立安全流程。
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', ...(Platform.OS === 'web' ? { maxWidth: 480, width: '100%', alignSelf: 'center' } : {}) },
  brand: { alignItems: 'flex-start' },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 2.2, marginBottom: 10 },
  title: { fontWeight: '700', letterSpacing: 0, fontSize: 38, lineHeight: 46 },
  subtitle: { marginTop: 8, lineHeight: 22 },
  tabs: { flexDirection: 'row', padding: 0, backgroundColor: 'transparent', borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 0 },
  tabText: { fontWeight: '700' },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 7, letterSpacing: 0.3 },
  input: {
    paddingVertical: 14,
    borderWidth: 1,
  },
  error: { textAlign: 'center' },
  btn: { paddingVertical: 15, alignItems: 'center' },
  btnText: { fontWeight: '700' },
  demoBtn: { borderWidth: 0, alignItems: 'center' },
  demoText: { textAlign: 'center' },
  serverToggle: { alignItems: 'center', justifyContent: 'center' },
  serverPanel: { borderWidth: 1 },
  serverSave: { alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  foot: { textAlign: 'center', lineHeight: 18 },
});
