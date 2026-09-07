import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Glyph } from '../../components/glyphs';
import { ContinuityInboxCard } from '../../components/ContinuityInboxCard';
import { DevicePresencePanel } from '../../components/DevicePresencePanel';
import { sendWorkspaceHandoff } from '../../hooks/useContinuityHandoffs';
import { useStore } from '../../store/useStore';
import { useAppTheme } from '../../theme/theme';

type GlyphName = React.ComponentProps<typeof Glyph>['name'];

const NAV_ITEMS: Array<{ label: string; route: string; glyph: GlyphName; shortcut?: string }> = [
  { label: '镜像主页', route: 'MirrorHome', glyph: 'mirror', shortcut: '⌘1' },
  { label: '开放工作台', route: 'Workspace', glyph: 'today', shortcut: '⌘2' },
  { label: '进程', route: 'Progress', glyph: 'progress', shortcut: '⌘3' },
  { label: '秘书', route: 'Secretary', glyph: 'secretary' },
  { label: '我的数据', route: 'Sovereignty', glyph: 'data' },
];

function formatDate(value?: string) {
  if (!value) return '未设日期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期未知';
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function DesktopHubScreen() {
  const theme = useAppTheme();
  const navigation = useNavigation<any>();
  const inputRef = useRef<TextInput>(null);
  const [command, setCommand] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState<string | null>(null);
  const user = useStore((s) => s.user);
  const events = useStore((s) => s.events);
  const commitments = useStore((s) => s.commitments);
  const projects = useStore((s) => s.projects);
  const experiments = useStore((s) => s.experiments);
  const sync = useStore((s) => s.sync);

  const activeCommitments = useMemo(
    () => commitments
      .filter((item) => item.status === 'active')
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 5),
    [commitments],
  );
  const activeProjects = useMemo(
    () => projects.filter((item) => item.status === 'active').slice(0, 4),
    [projects],
  );
  const activeExperiments = useMemo(
    () => experiments.filter((item) => item.status === 'active').slice(0, 3),
    [experiments],
  );
  const latestEvent = events[0];

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (key === '1') {
        event.preventDefault();
        navigation.navigate('MirrorHome');
      } else if (key === '2') {
        event.preventDefault();
        navigation.navigate('Workspace');
      } else if (key === '3') {
        event.preventDefault();
        navigation.navigate('Progress');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigation]);

  const handToWorkspace = () => {
    const text = command.trim();
    if (!text) return;
    setCommand('');
    navigation.navigate('Workspace', { initialText: text });
  };

  const sendToMobile = async () => {
    const text = command.trim();
    if (!text || handoffBusy) return;
    setHandoffBusy(true);
    setHandoffMessage(null);
    try {
      await sendWorkspaceHandoff('desktop', 'mobile', text, `电脑继续：${text.slice(0, 48)}`);
      setCommand('');
      setHandoffMessage('已发送到手机，24 小时内可继续');
    } catch (error) {
      setHandoffMessage(error instanceof Error ? error.message : '发送到手机失败');
    } finally {
      setHandoffBusy(false);
    }
  };

  const greeting = user.name && user.name !== '我' ? `${user.name}，这是你的电脑工作台` : '这是你的电脑工作台';

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <View style={[styles.sidebar, { borderColor: theme.colors.borderSoft, backgroundColor: theme.colors.surface }]}>
        <View style={styles.brand}>
          <View style={[styles.brandMark, { borderColor: theme.colors.primary }]}>
            <View style={[styles.brandDot, { backgroundColor: theme.colors.primary }]} />
          </View>
          <View>
            <Text style={[styles.brandName, { color: theme.colors.textPrimary }]}>知行镜</Text>
            <Text style={[styles.brandMeta, { color: theme.colors.textTertiary }]}>DESKTOP</Text>
          </View>
        </View>

        <View style={styles.nav}>
          <View style={[styles.navItem, { backgroundColor: theme.colors.surfaceAlt }]}>
            <Glyph name="layers" size={19} color={theme.colors.primary} />
            <Text style={[styles.navText, { color: theme.colors.textPrimary }]}>电脑端工作台</Text>
          </View>
          {NAV_ITEMS.map((item) => (
            <Pressable
              key={item.route}
              onPress={() => navigation.navigate(item.route)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => [styles.navItem, { opacity: pressed ? 0.62 : 1 }]}
            >
              <Glyph name={item.glyph} size={19} color={theme.colors.textSecondary} />
              <Text style={[styles.navText, { color: theme.colors.textSecondary }]}>{item.label}</Text>
              {item.shortcut ? <Text style={[styles.shortcut, { color: theme.colors.textTertiary }]}>{item.shortcut}</Text> : null}
            </Pressable>
          ))}
        </View>

        <View style={[styles.sidebarFooter, { borderColor: theme.colors.borderSoft }]}>
          <Text style={[styles.footerTitle, { color: theme.colors.textSecondary }]}>同一账号 · 同一对象</Text>
          <Text style={[styles.footerBody, { color: theme.colors.textTertiary }]}>
            手机与电脑共享后端生命对象、行动回执与记忆；本轮暂不伪装系统级跨设备剪贴板。
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.canvas}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topbar}>
          <View>
            <Text style={[styles.kicker, { color: theme.colors.primary }]}>ZHIXINGOS / DESKTOP WORKBENCH</Text>
            <Text style={[styles.hero, { color: theme.colors.textPrimary }]}>{greeting}</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textTertiary }]}>
              深度规划放在电脑，感知与即时执行留给手机；底层仍是同一个个人智能内核。
            </Text>
          </View>
          <View style={[styles.syncPill, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSoft }]}>
            <View style={[styles.syncDot, { backgroundColor: sync.lastError ? theme.colors.red : sync.pending ? theme.colors.amber : theme.colors.green }]} />
            <Text style={[styles.syncText, { color: theme.colors.textSecondary }]}>
              {sync.lastError ? '同步异常' : sync.pending ? `待同步 ${sync.pending}` : '已同步'}
            </Text>
          </View>
        </View>

        <View style={[styles.commandPanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSoft }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionLabel, { color: theme.colors.textTertiary }]}>快速交代</Text>
            <TextInput
              ref={inputRef}
              value={command}
              onChangeText={setCommand}
              onSubmitEditing={handToWorkspace}
              placeholder="交代一件事、安排一个日程，或记录此刻…"
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.commandInput, { color: theme.colors.textPrimary }]}
              accessibilityLabel="桌面快速输入"
            />
            <Text style={[styles.commandHint, { color: theme.colors.textTertiary }]}>Ctrl/Cmd + K 聚焦 · 所有动作仍经过解释、确认与回执</Text>
          </View>
          <View style={styles.commandActions}>
            <Pressable
              onPress={sendToMobile}
              disabled={!command.trim() || handoffBusy}
              accessibilityRole="button"
              accessibilityLabel="发送到手机继续"
              style={[styles.commandButton, { backgroundColor: theme.colors.surfaceAlt, opacity: handoffBusy ? 0.5 : 1 }]}
            >
              <Glyph name="layers" size={17} color={command.trim() ? theme.colors.primary : theme.colors.textTertiary} />
              <Text style={{ color: command.trim() ? theme.colors.textSecondary : theme.colors.textTertiary, fontWeight: '700' }}>
                {handoffBusy ? '发送中…' : '到手机'}
              </Text>
            </Pressable>
          <Pressable
            onPress={handToWorkspace}
            disabled={!command.trim()}
            accessibilityRole="button"
            accessibilityLabel="交给工作台"
            style={[styles.commandButton, { backgroundColor: command.trim() ? theme.colors.primary : theme.colors.surfaceAlt }]}
          >
            <Text style={{ color: command.trim() ? theme.colors.textInverse : theme.colors.textTertiary, fontWeight: '700' }}>交给工作台</Text>
            <Glyph name="arrow" size={17} color={command.trim() ? theme.colors.textInverse : theme.colors.textTertiary} />
          </Pressable>
          </View>
        </View>
        {handoffMessage ? (
          <View style={[styles.handoffNotice, { borderColor: theme.colors.borderSoft, backgroundColor: theme.colors.surfaceAlt }]}>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>{handoffMessage}</Text>
          </View>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.mainColumn}>
            <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSoft }]}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={[styles.sectionLabel, { color: theme.colors.textTertiary }]}>FOCUS</Text>
                  <Text style={[styles.panelTitle, { color: theme.colors.textPrimary }]}>现在最重要的事</Text>
                </View>
                <Text style={[styles.panelMeta, { color: theme.colors.textTertiary }]}>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</Text>
              </View>
              {activeCommitments.length ? activeCommitments.map((item, index) => (
                <View key={item.id} style={[styles.focusRow, index > 0 && { borderTopWidth: 1, borderColor: theme.colors.borderSoft }]}>
                  <View style={[styles.priority, { backgroundColor: index === 0 ? theme.colors.primary : theme.colors.surfaceAlt }]}>
                    <Text style={{ color: index === 0 ? theme.colors.textInverse : theme.colors.textSecondary, fontWeight: '800' }}>{index + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]}>{item.statement}</Text>
                    <Text style={[styles.rowMeta, { color: theme.colors.textTertiary }]}>{item.domain} · {formatDate(item.deadline)} · {item.why}</Text>
                  </View>
                </View>
              )) : (
                <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>当前没有主动承诺。可以把新的事项交给开放工作台。</Text>
              )}
            </View>

            <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSoft }]}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={[styles.sectionLabel, { color: theme.colors.textTertiary }]}>PROJECTS</Text>
                  <Text style={[styles.panelTitle, { color: theme.colors.textPrimary }]}>长期进程</Text>
                </View>
                <Pressable onPress={() => navigation.navigate('Progress')} accessibilityRole="button" accessibilityLabel="查看全部进程">
                  <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>查看全部</Text>
                </Pressable>
              </View>
              <View style={styles.projectGrid}>
                {activeProjects.length ? activeProjects.map((project) => (
                  <Pressable
                    key={project.id}
                    onPress={() => navigation.navigate('Progress')}
                    accessibilityRole="button"
                    accessibilityLabel={`打开项目：${project.name}`}
                    style={({ pressed }) => [styles.projectCard, { backgroundColor: theme.colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Text style={[styles.projectName, { color: theme.colors.textPrimary }]} numberOfLines={1}>{project.name}</Text>
                    <Text style={[styles.projectAction, { color: theme.colors.textSecondary }]} numberOfLines={2}>{project.nextKeyAction}</Text>
                    <View style={[styles.progressTrack, { backgroundColor: theme.colors.borderSoft }]}>
                      <View style={[styles.progressFill, { backgroundColor: theme.colors.primary, width: `${Math.max(0, Math.min(1, project.progress)) * 100}%` }]} />
                    </View>
                    <Text style={[styles.rowMeta, { color: theme.colors.textTertiary }]}>{Math.round(project.progress * 100)}% · {project.milestones.filter((m) => !m.done).length} 个未完成里程碑</Text>
                  </Pressable>
                )) : (
                  <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>没有活跃项目。</Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.sideColumn}>
            <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSoft }]}>
              <Text style={[styles.sectionLabel, { color: theme.colors.textTertiary }]}>CONTINUITY</Text>
              <Text style={[styles.panelTitle, { color: theme.colors.textPrimary }]}>跨端连续性 v1</Text>
              <Text style={[styles.panelCopy, { color: theme.colors.textSecondary }]}>
                接力是显式、可取消、会过期的对象；不会把共享数据库冒充成系统级剪贴板。
              </Text>
              <ContinuityInboxCard
                target="desktop"
                onContinue={(handoff) => {
                  navigation.navigate(
                    handoff.payload.route ?? 'Workspace',
                    handoff.payload.text ? { initialText: handoff.payload.text } : undefined,
                  );
                }}
              />
              <View style={{ marginTop: 14 }}>
                <DevicePresencePanel compact />
              </View>
              <View style={[styles.metricRow, { borderColor: theme.colors.borderSoft, marginTop: 12 }]}>
                <Text style={{ color: theme.colors.textTertiary }}>待同步</Text>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '800' }}>{sync.pending}</Text>
              </View>
              <View style={[styles.metricRow, { borderColor: theme.colors.borderSoft }]}>
                <Text style={{ color: theme.colors.textTertiary }}>冲突</Text>
                <Text style={{ color: sync.conflicts.length ? theme.colors.amber : theme.colors.textPrimary, fontWeight: '800' }}>{sync.conflicts.length}</Text>
              </View>
              {latestEvent ? (
                <View style={[styles.continueCard, { backgroundColor: theme.colors.surfaceAlt }]}>
                  <Text style={[styles.sectionLabel, { color: theme.colors.textTertiary }]}>最近记录</Text>
                  <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]} numberOfLines={2}>{latestEvent.userInterpretation || latestEvent.title}</Text>
                  <Text style={[styles.rowMeta, { color: theme.colors.textTertiary }]}>{formatDate(latestEvent.startTime)} · {latestEvent.domain}</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.panel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.borderSoft }]}>
              <Text style={[styles.sectionLabel, { color: theme.colors.textTertiary }]}>EXPERIMENTS</Text>
              <Text style={[styles.panelTitle, { color: theme.colors.textPrimary }]}>正在验证</Text>
              {activeExperiments.length ? activeExperiments.map((item) => (
                <View key={item.id} style={[styles.experimentRow, { borderColor: theme.colors.borderSoft }]}>
                  <Glyph name="flask" size={17} color={theme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: theme.colors.textPrimary }]} numberOfLines={2}>{item.question}</Text>
                    <Text style={[styles.rowMeta, { color: theme.colors.textTertiary }]}>{item.durationDays} 天 · {item.checkIns.length} 次记录</Text>
                  </View>
                </View>
              )) : <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>当前没有进行中的微实验。</Text>}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', minWidth: 0 },
  sidebar: { width: 232, borderRightWidth: 1, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 18 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, marginBottom: 28 },
  brandMark: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  brandDot: { width: 9, height: 9, borderRadius: 5 },
  brandName: { fontSize: 17, fontWeight: '800', letterSpacing: 1.2 },
  brandMeta: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginTop: 2 },
  nav: { gap: 5 },
  navItem: { minHeight: 44, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12 },
  navText: { flex: 1, fontSize: 13, fontWeight: '650' as any },
  shortcut: { fontSize: 10, fontWeight: '600' },
  sidebarFooter: { marginTop: 'auto', borderTopWidth: 1, paddingTop: 16, paddingHorizontal: 8 },
  footerTitle: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  footerBody: { fontSize: 10, lineHeight: 16 },
  scroll: { flex: 1, minWidth: 0 },
  canvas: { paddingHorizontal: 34, paddingTop: 28, paddingBottom: 42, maxWidth: 1500, width: '100%', alignSelf: 'center' },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start', marginBottom: 24 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.6, marginBottom: 8 },
  hero: { fontSize: 30, lineHeight: 37, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 13, lineHeight: 20, maxWidth: 760, marginTop: 7 },
  syncPill: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  syncDot: { width: 7, height: 7, borderRadius: 4 },
  syncText: { fontSize: 11, fontWeight: '700' },
  commandPanel: { borderWidth: 1, borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 22 },
  sectionLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 5 },
  commandInput: { fontSize: 18, lineHeight: 26, paddingVertical: 2, outlineStyle: 'none' as any },
  commandHint: { fontSize: 10, marginTop: 6 },
  commandActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commandButton: { height: 46, paddingHorizontal: 16, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  handoffNotice: { borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: -12, marginBottom: 18 },
  grid: { flexDirection: 'row', gap: 22, alignItems: 'flex-start' },
  mainColumn: { flex: 1.75, gap: 22, minWidth: 0 },
  sideColumn: { flex: 0.85, gap: 22, minWidth: 300 },
  panel: { borderWidth: 1, borderRadius: 16, padding: 18 },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, marginBottom: 13 },
  panelTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  panelMeta: { fontSize: 10, fontWeight: '600' },
  panelCopy: { fontSize: 12, lineHeight: 19, marginTop: 9, marginBottom: 14 },
  focusRow: { minHeight: 66, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 },
  priority: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
  rowMeta: { fontSize: 10, lineHeight: 16, marginTop: 4 },
  emptyText: { fontSize: 12, lineHeight: 19, paddingVertical: 10 },
  projectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  projectCard: { width: '48.8%', minHeight: 126, borderRadius: 12, padding: 13 },
  projectName: { fontSize: 13, fontWeight: '800', marginBottom: 8 },
  projectAction: { fontSize: 11, lineHeight: 17, minHeight: 34 },
  progressTrack: { height: 4, borderRadius: 3, overflow: 'hidden', marginTop: 13 },
  progressFill: { height: 4, borderRadius: 3 },
  metricRow: { borderTopWidth: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  continueCard: { borderRadius: 12, padding: 12, marginTop: 12 },
  experimentRow: { borderTopWidth: 1, paddingVertical: 11, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
