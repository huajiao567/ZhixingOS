import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useStore } from '../store/useStore';
import { useEvidenceStore } from '../store/useEvidenceStore';
import { useServiceContractStore } from '../store/useServiceContractStore';
import { useAvatarV2Store } from '../mirror3d/store/useAvatarV2Store';
import { useLifeSignalStore } from '../ai-native/connectors/useLifeSignalStore';
import { useAuth } from '../services/auth';
import { MirrorHome } from '../screens/mirror/MirrorHome';
import { MirrorScreen } from '../screens/mirror/MirrorScreen';
import { ProgressScreen } from '../screens/progress/ProgressScreen';
import { SecretaryScreen } from '../screens/secretary/SecretaryScreen';
import { WorkspaceScreen } from '../screens/workspace/WorkspaceScreen';
import { DesktopHubScreen } from '../screens/desktop/DesktopHubScreen';
import { SovereigntyScreen } from '../screens/sovereignty/SovereigntyScreen';
import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { DistillationReviewSheet, detectDistillationCandidates } from '../components/DistillationReviewSheet';
import { useAppTheme } from '../theme/theme';
import { MotiView } from 'moti';
import { classifyFormFactor } from '../platform/formFactor';
import { loadMirror3DEditor } from '../mirror3d/screens/loadMirror3DEditor';

const Stack = createNativeStackNavigator();

// 编辑器屏连同其 three/@react-three 依赖延迟求值：不进入首屏启动包
// （同 AvatarCanvasFlagged 的 3D 懒加载策略）。
const Mirror3DEditor = React.lazy(() =>
  loadMirror3DEditor().then((m) => ({ default: m.Mirror3DEditor })),
);

function Splash({ hint }: { hint: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.splash, { backgroundColor: theme.colors.bg }]}>
      <MotiView
        from={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 15, stiffness: 200 }}
        style={[styles.logoRing, { borderColor: theme.colors.primary }]}
      >
        <View style={[styles.logoDot, { backgroundColor: theme.colors.primary }]} />
      </MotiView>
      <Text style={[styles.splashTitle, { color: theme.colors.textPrimary }]}>知行镜</Text>
      <ActivityIndicator color={theme.colors.primary} size="small" style={{ marginTop: theme.spacing.lg }} />
      <Text style={[styles.splashHint, { color: theme.colors.textTertiary, fontSize: theme.font.small }]}>{hint}</Text>
    </View>
  );
}

function DistillationReviewSheetGlobal() {
  const projects = useStore((s) => s.projects);
  const hypotheses = useStore((s) => s.hypotheses);
  const experiments = useStore((s) => s.experiments);
  const corrections = useEvidenceStore((s) => s.corrections);

  const candidates = useMemo(
    () => detectDistillationCandidates({ projects, hypotheses, experiments, corrections }),
    [projects, hypotheses, experiments, corrections],
  );

  const [handledIds, setHandledIds] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (candidates.length > 0) {
        setHandledIds(new Set(candidates.map((c) => c.id)));
      }
      return;
    }
    const hasNew = candidates.some((c) => !handledIds.has(c.id));
    if (hasNew) {
      setDismissed(false);
    }
  }, [candidates]);

  const visibleCandidates = candidates.filter((c) => !handledIds.has(c.id));
  const showSheet = visibleCandidates.length > 0 && !dismissed;

  const handleHandled = (cid: string) => {
    setHandledIds((prev) => {
      const next = new Set(prev);
      next.add(cid);
      return next;
    });
  };

  const handleClose = () => {
    setHandledIds((prev) => {
      const next = new Set(prev);
      visibleCandidates.forEach((c) => next.add(c.id));
      return next;
    });
    setDismissed(true);
  };

  if (!showSheet) return null;

  return (
    <DistillationReviewSheet
      visible={showSheet}
      candidates={visibleCandidates}
      onHandled={handleHandled}
      onClose={handleClose}
    />
  );
}

export function RootNavigator() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const formFactor = classifyFormFactor({ width, platform: Platform.OS });
  const auth = useAuth();
  const hydrated = useStore((s) => s.hydrated);
  const hydrating = useStore((s) => s.hydrating);
  const syncError = useStore((s) => s.sync.lastError);
  const onboarded = useStore((s) => s.user.onboarded);
  const hydrate = useStore((s) => s.hydrate);
  const loadContract = useServiceContractStore((s) => s.load);
  const loadEvidence = useEvidenceStore((s) => s.loadAll);
  const modelVersions = useEvidenceStore((s) => s.modelVersions);
  const hydrateAvatar = useAvatarV2Store((s) => s.hydrate);
  const avatarHydrated = useAvatarV2Store((s) => s.hydrated);
  const syncModelVersions = useAvatarV2Store((s) => s.syncModelVersions);
  const hydrateLifeSignals = useLifeSignalStore((s) => s.hydrate);
  const lifeSignalsHydrated = useLifeSignalStore((s) => s.hydrated);

  useEffect(() => {
    if (auth.token && !hydrated && !hydrating) {
      hydrate(auth.email ?? undefined, auth.displayName ?? undefined);
    }
  }, [auth.token, hydrated, hydrating, hydrate, auth.email, auth.displayName]);

  useEffect(() => {
    if (!auth.token || !auth.userId) return;
    loadContract(auth.userId);
    loadEvidence(auth.userId);
  }, [auth.token, auth.userId, loadContract, loadEvidence]);

  useEffect(() => {
    if (auth.token && auth.userId && !avatarHydrated) hydrateAvatar(auth.userId);
  }, [auth.token, auth.userId, avatarHydrated, hydrateAvatar]);

  useEffect(() => {
    if (auth.token && auth.userId && avatarHydrated && !lifeSignalsHydrated) hydrateLifeSignals(auth.userId);
  }, [auth.token, auth.userId, avatarHydrated, lifeSignalsHydrated, hydrateLifeSignals]);

  useEffect(() => {
    if (avatarHydrated && modelVersions.length > 0) {
      syncModelVersions(modelVersions);
    }
  }, [avatarHydrated, modelVersions, syncModelVersions]);

  if (auth.loading) return <Splash hint="正在校验登录状态…" />;
  if (!auth.token) return <AuthScreen />;
  if (!hydrated) return <Splash hint={syncError ? `加载失败：${syncError}` : '正在同步你的记忆数据…'} />;
  if (!onboarded) return <OnboardingScreen />;

  return (
    <>
      <Suspense fallback={null}>
        <Stack.Navigator
          initialRouteName={formFactor === 'desktop' ? 'DesktopHub' : 'MirrorHome'}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.bg },
          }}
        >
        <Stack.Screen
          name="DesktopHub"
          component={DesktopHubScreen}
        />
        <Stack.Screen
          name="MirrorHome"
          component={MirrorHome}
        />
        <Stack.Screen
          name="Mirror"
          component={MirrorScreen}
        />
        <Stack.Screen
          name="Progress"
          component={ProgressScreen}
        />
        <Stack.Screen
          name="Workspace"
          component={WorkspaceScreen}
        />
        <Stack.Screen
          name="Secretary"
          component={SecretaryScreen}
        />
        <Stack.Screen
          name="Sovereignty"
          component={SovereigntyScreen}
        />
        <Stack.Screen
          name="Mirror3DEditor"
          component={Mirror3DEditor}
          options={{
            presentation: 'modal',
          }}
        />
      </Stack.Navigator>
      </Suspense>
      <DistillationReviewSheetGlobal />
    </>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoRing: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
  },
  logoDot: { width: 18, height: 18, borderRadius: 9 },
  splashTitle: { fontSize: 28, fontWeight: '800', letterSpacing: 3, marginTop: 16 },
  splashHint: { marginTop: 12 },
});
