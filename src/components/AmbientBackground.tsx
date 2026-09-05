import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useAppTheme } from '../theme/theme';

/**
 * 背景氛围光
 *
 * Quiet paper-like page background. Keep the content hierarchy in typography
 * and dividers instead of decorative gradient orbs.
 */
export function AmbientBackground() {
  const theme = useAppTheme();
  return (
    <View style={[styles.ambientBg, { backgroundColor: theme.colors.bg }]} />
  );
}

const styles = StyleSheet.create({
  ambientBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    zIndex: 0,
    pointerEvents: 'none',
  },
});
