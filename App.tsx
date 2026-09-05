import 'react-native-gesture-handler';
import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AuthProvider } from './src/services/auth';
import { useAppTheme, initTheme } from './src/theme/theme';
import { MotiView } from 'moti';

function ThemedApp() {
  const theme = useAppTheme();
  const [themeReady, setThemeReady] = useState(false);
  const [transitionBg, setTransitionBg] = useState<string | null>(null);
  const lastThemeId = useRef(theme.id);

  useEffect(() => {
    initTheme().then(() => setThemeReady(true));
  }, []);

  useEffect(() => {
    if (lastThemeId.current !== theme.id) {
      lastThemeId.current = theme.id;
      setTransitionBg(theme.colors.bg);
      const timer = setTimeout(() => {
        setTransitionBg(null);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [theme.id, theme.colors.bg]);

  const navTheme = {
    ...(theme.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.dark ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.colors.bg,
      card: theme.colors.surface,
      text: theme.colors.textPrimary,
      border: theme.colors.borderSoft,
      primary: theme.colors.primary,
    },
  };

  if (!themeReady) {
    return (
      <View style={[styles.root, styles.splash, { backgroundColor: theme.colors.bg }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaView>

      {transitionBg && (
        <MotiView
          from={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ type: 'timing', duration: 300 }}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: transitionBg, zIndex: 9999, pointerEvents: 'none' },
          ]}
        />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemedApp />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    ...(Platform.OS === 'web' ? {
      width: '100%',
      alignSelf: 'center',
    } : {}),
  },
  safe: { flex: 1 },
  splash: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
