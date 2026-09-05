import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextStyle, Pressable, StyleProp, AccessibilityRole } from 'react-native';
import { MotiView, MotiText } from 'moti';
import { useAppTheme, shadowStyle } from '../theme/theme';

export function Card({ children, style, accent, accessibilityLabel, accessibilityRole }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: string;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          borderWidth: 1,
          borderColor: theme.colors.borderSoft,
          ...shadowStyle(theme.shadow.card),
        },
        accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : null,
        style,
      ]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm, paddingHorizontal: 2,
      }}>
      <Text
        style={{ color: theme.colors.textPrimary, fontSize: theme.font.section, fontWeight: '700', letterSpacing: 0.2 }}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Tag({ text, color, bg }: { text: string; color?: string; bg?: string }) {
  const theme = useAppTheme();
  const c = color ?? theme.colors.primary;
  return (
    <MotiView
      style={{
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.sm + 2,
        paddingVertical: 3,
        alignSelf: 'flex-start',
        backgroundColor: bg ?? `${c}22`,
      }}>
      <MotiText
        style={{ fontSize: theme.font.tiny, fontWeight: '600', color: c }}
      >
        {text}
      </MotiText>
    </MotiView>
  );
}

export function Bar({ value, color, height = 6, track }: {
  value: number; color?: string; height?: number; track?: string;
}) {
  const theme = useAppTheme();
  const c = color ?? theme.colors.primary;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View style={{
      width: '100%',
      backgroundColor: track ?? theme.colors.borderSoft,
      height,
      borderRadius: height / 2,
      overflow: 'hidden',
    }}>
      <MotiView
        from={{ width: '0%' }}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'timing', duration: theme.motion.normal }}
        style={{ backgroundColor: c, height, borderRadius: height / 2 }}
      />
    </View>
  );
}

export function BipolarBar({ value, color, height = 8 }: { value: number; color: string; height?: number }) {
  const theme = useAppTheme();
  const v = Math.max(-1, Math.min(1, value));
  const pct = Math.abs(v) * 50;
  return (
    <View style={{
      width: '100%',
      backgroundColor: theme.colors.borderSoft,
      height,
      borderRadius: height / 2,
      overflow: 'hidden',
      justifyContent: 'center',
    }}>
      <View style={{ position: 'absolute', left: '50%', width: 1, height: '100%', backgroundColor: theme.colors.textTertiary }} />
      {v >= 0 ? (
        <MotiView
          from={{ width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'timing', duration: theme.motion.normal }}
          style={{ position: 'absolute', left: '50%', backgroundColor: color, height, borderRadius: height / 2 }}
        />
      ) : (
        <MotiView
          from={{ width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'timing', duration: theme.motion.normal }}
          style={{ position: 'absolute', right: '50%', backgroundColor: color, height, borderRadius: height / 2 }}
        />
      )}
    </View>
  );
}

export function ConfidenceRing({ value, size = 46 }: { value: number; size?: number }) {
  const theme = useAppTheme();
  const { label, color } = value >= 0.66
    ? { label: '充分', color: theme.colors.green }
    : value >= 0.4
      ? { label: '初步', color: theme.colors.amber }
      : { label: '待证', color: theme.colors.textTertiary };
  return (
    <MotiView
      from={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', damping: 18, stiffness: 250 }}
      style={{
        width: Math.max(size, theme.touch.minTarget * 0.9),
        height: Math.max(size, theme.touch.minTarget * 0.9),
        borderRadius: Math.max(size, theme.touch.minTarget * 0.9) / 2,
        borderWidth: 3, borderColor: color, alignItems: 'center', justifyContent: 'center',
        backgroundColor: `${color}14`,
      }}
    >
      <Text style={{ color, fontSize: size * 0.3, fontWeight: '700' }}>{label}</Text>
    </MotiView>
  );
}

export function PrimaryButton({ title, onPress, ghost, danger, small, style, disabled, accessibilityLabel, accessibilityRole }: {
  title: string;
  onPress: () => void;
  ghost?: boolean;
  danger?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}) {
  const theme = useAppTheme();
  const bg = danger
    ? theme.colors.redSoft
    : ghost
      ? 'transparent'
      : theme.colors.primary;
  const fg = danger
    ? theme.colors.red
    : ghost
      ? theme.colors.primaryMuted
      : '#fff';

  return (
    <Pressable
      onPress={disabled ? () => {} : onPress}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
    >
      {({ pressed }) => (
        <MotiView
          animate={{
            opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
            scale: 1,
            translateY: 0,
          }}
          transition={{ type: 'spring', damping: theme.motion.springDamping + 5, stiffness: theme.motion.springStiffness }}
          style={[
            {
              borderRadius: theme.radius.md,
              paddingVertical: small ? 7 : 11,
              paddingHorizontal: small ? 12 : 18,
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 48,
              minWidth: 48,
              backgroundColor: bg,
              ...(ghost ? {} : shadowStyle(theme.shadow.sm)),
            },
            ghost && { borderWidth: 1, borderColor: theme.colors.primary },
            disabled && { borderColor: theme.colors.borderSoft },
            style,
          ]}
        >
          <MotiText
            animate={{ opacity: disabled ? 0.6 : 1 }}
            transition={{ type: 'timing', duration: theme.motion.fast }}
            style={{
              color: disabled ? theme.colors.textTertiary : fg,
              fontWeight: '600',
              fontSize: small ? theme.font.small : theme.font.body,
            }}
          >
            {title}
          </MotiText>
        </MotiView>
      )}
    </Pressable>
  );
}

export function Divider() {
  const theme = useAppTheme();
  return (
    <MotiView
      from={{ opacity: 0, scaleX: 0.8 }}
      animate={{ opacity: 1, scaleX: 1 }}
      transition={{ type: 'timing', duration: theme.motion.normal }}
      style={{ height: 1, backgroundColor: theme.colors.borderSoft, marginVertical: theme.spacing.md }}
    />
  );
}

export function useTextStyles() {
  const theme = useAppTheme();
  const lineHeightRatio = 1.45;
  return StyleSheet.create({
    hero: { color: theme.colors.textPrimary, fontSize: theme.font.hero, fontWeight: '700', letterSpacing: 0, lineHeight: theme.font.hero * 1.25 } as TextStyle,
    title: { color: theme.colors.textPrimary, fontSize: theme.font.title, fontWeight: '700', lineHeight: theme.font.title * lineHeightRatio } as TextStyle,
    body: { color: theme.colors.textPrimary, fontSize: theme.font.body, lineHeight: theme.font.body * lineHeightRatio } as TextStyle,
    secondary: { color: theme.colors.textSecondary, fontSize: theme.font.small, lineHeight: theme.font.small * lineHeightRatio } as TextStyle,
    tertiary: { color: theme.colors.textTertiary, fontSize: theme.font.tiny, lineHeight: theme.font.tiny * lineHeightRatio } as TextStyle,
  });
}

export const textStyles = StyleSheet.create({
  hero: { fontWeight: '800', letterSpacing: 0.3 } as TextStyle,
  title: { fontWeight: '700' } as TextStyle,
  body: { lineHeight: 22 } as TextStyle,
  secondary: { lineHeight: 19 } as TextStyle,
  tertiary: { lineHeight: 16 } as TextStyle,
});
