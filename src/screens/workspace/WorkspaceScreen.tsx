import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ContextSurfaceView } from '../../components/workspace/ContextSurfaceView';
import { Glyph } from '../../components/glyphs';
import { useSecretaryRuntime } from '../../hooks/useSecretaryRuntime';
import { useAuth } from '../../services/auth';
import { useAppTheme } from '../../theme/theme';
import { classifyFormFactor } from '../../platform/formFactor';
import { sendWorkspaceHandoff } from '../../hooks/useContinuityHandoffs';

const EXAMPLES = [
  '记得明天上午9点买牛奶',
  '明天下午3点开项目会，1小时',
  '下周一上午8点数学课，持续90分钟',
  '记录一下，今天散步后轻松了一些',
];

export function WorkspaceScreen() {
  const theme = useAppTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const auth = useAuth();
  const runtime = useSecretaryRuntime(auth.userId);
  const { width } = useWindowDimensions();
  const surface = classifyFormFactor({ width, platform: Platform.OS });
  const handoffTarget = surface === 'desktop' ? 'mobile' : 'desktop';
  const [input, setInput] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const initialHandled = useRef(false);
  const needsAnswer = runtime.state.phase === 'needs_input';

  useEffect(() => {
    const initialText = route.params?.initialText;
    if (!initialHandled.current && typeof initialText === 'string' && initialText.trim()) {
      initialHandled.current = true;
      runtime.analyze(initialText);
    }
  }, [route.params?.initialText, runtime.analyze]);

  const submit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (needsAnswer) await runtime.answer(text);
    else await runtime.analyze(text);
  };

  const handoff = async () => {
    const text = input.trim();
    if (!text || handoffBusy) return;
    setHandoffBusy(true);
    setHandoffMessage(null);
    try {
      await sendWorkspaceHandoff(
        surface,
        handoffTarget,
        text,
        `从${surface === 'desktop' ? '电脑' : '手机'}继续：${text.slice(0, 48)}`,
      );
      setInput('');
      setHandoffMessage(`已发送到${handoffTarget === 'desktop' ? '电脑' : '手机'}，24 小时内可继续`);
    } catch (error) {
      setHandoffMessage(error instanceof Error ? error.message : '跨端接力发送失败');
    } finally {
      setHandoffBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: theme.colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { borderColor: theme.colors.borderSoft }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="返回主页" accessibilityRole="button">
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.body }}>‹ 返回</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>开放工作台</Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny }}>理解 · 解释 · 确认 · 执行 · 可撤销</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Secretary')} style={styles.headerButton} accessibilityLabel="打开秘书对话" accessibilityRole="button">
          <Glyph name="secretary" size={20} color={theme.colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <ContextSurfaceView
          surface={runtime.state.surface}
          plan={runtime.state.plan}
          receipt={runtime.state.receipt}
          phase={runtime.state.phase}
          error={runtime.state.error}
          syncWarning={runtime.state.syncWarning}
          onExecute={runtime.execute}
          onUndo={runtime.undo}
          onReset={runtime.reset}
        />

        {runtime.state.phase === 'idle' ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.textTertiary, fontSize: theme.font.tiny }}>可以这样说</Text>
            {EXAMPLES.map((example) => (
              <Pressable
                key={example}
                onPress={() => runtime.analyze(example)}
                accessibilityRole="button"
                accessibilityLabel={`示例：${example}`}
                style={({ pressed }) => [styles.example, { borderColor: theme.colors.borderSoft, opacity: pressed ? 0.65 : 1 }]}
              >
                <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.small, lineHeight: 21 }}>{example}</Text>
                <Text style={{ color: theme.colors.primary, fontSize: 18 }}>›</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {handoffMessage ? (
        <View style={[styles.handoffNotice, { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.borderSoft }]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.font.tiny }}>{handoffMessage}</Text>
        </View>
      ) : null}

      {runtime.state.phase !== 'executing' && runtime.state.phase !== 'parsing' ? (
        <View style={[styles.composer, { borderColor: theme.colors.borderSoft, backgroundColor: theme.colors.surface }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submit}
            placeholder={needsAnswer ? '补充缺少的信息…' : '交代一件事，或记录此刻…'}
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.input, { color: theme.colors.textPrimary, fontSize: theme.font.body }]}
            multiline
            accessibilityLabel={needsAnswer ? '补充信息' : '工作台输入'}
          />
          <Pressable
            onPress={handoff}
            disabled={!input.trim() || handoffBusy}
            style={[styles.send, { backgroundColor: input.trim() ? theme.colors.surfaceAlt : theme.colors.surfaceAlt, opacity: handoffBusy ? 0.5 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`发送到${handoffTarget === 'desktop' ? '电脑' : '手机'}继续`}
          >
            <Glyph name="layers" size={17} color={input.trim() ? theme.colors.primary : theme.colors.textTertiary} />
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={!input.trim()}
            style={[styles.send, { backgroundColor: input.trim() ? theme.colors.primary : theme.colors.surfaceAlt }]}
            accessibilityRole="button"
            accessibilityLabel={needsAnswer ? '提交补充信息' : '解析输入'}
          >
            <Glyph name="arrow" size={17} color={input.trim() ? theme.colors.textInverse : theme.colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 72, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  headerButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '800', letterSpacing: -0.4 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingTop: 24, paddingBottom: 36, gap: 24 },
  example: { minHeight: 50, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  composer: { borderTopWidth: 1, padding: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: { flex: 1, minHeight: 48, maxHeight: 112, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top' },
  send: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, flexShrink: 0 },
  handoffNotice: { borderTopWidth: 1, paddingVertical: 7, paddingHorizontal: 16, alignItems: 'center' },
});
