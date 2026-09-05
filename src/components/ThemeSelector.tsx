import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { useAppTheme, themeList, themes, type ThemeId } from '../theme/theme';

interface ThemeSelectorProps {
  visible: boolean;
  onClose: () => void;
}

export function ThemeSelector({ visible, onClose }: ThemeSelectorProps) {
  const theme = useAppTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.mask}>
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.lg,
            },
          ]}
        >
          <Text style={[styles.title, { color: theme.colors.textPrimary, fontSize: theme.font.title }]}>
            显示风格
          </Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary, fontSize: theme.font.small }]}>
            色彩、字级与三维场景同时切换，功能和数据不会改变。
          </Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            <View style={styles.grid}>
              {themeList.map((t) => {
                const selected = theme.id === t.id;
                const previewTheme = themes[t.id as ThemeId];
                return (
                  <Pressable
                      key={t.id}
                      onPress={() => { theme.setTheme(t.id as ThemeId); }}
                      accessibilityLabel={`${t.name}主题${selected ? '，已选中' : ''}：${t.description}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={({ pressed }) => {
                        return [
                          styles.themeCard,
                          {
                            backgroundColor: previewTheme.colors.surface,
                            borderRadius: theme.radius.md,
                            borderWidth: 1,
                            borderColor: selected ? previewTheme.colors.primary : previewTheme.colors.borderSoft,
                            opacity: pressed ? 0.85 : 1,
                            transform: [{ scale: pressed ? 0.96 : 1 }],
                            minHeight: theme.touch.minTarget + 18,
                          },
                        ];
                      }}
                    >
                      <View style={styles.previewRow}>
                              <View style={[styles.previewDot, { backgroundColor: previewTheme.colors.primary }]} />
                              <View style={[styles.previewDot, { backgroundColor: previewTheme.colors.accent }]} />
                              <View style={[styles.previewDot, { backgroundColor: previewTheme.colors.surfaceSoft }]} />
                      </View>
                      <View style={styles.cardCopy}>
                            <Text style={[styles.cardName, { color: previewTheme.colors.textPrimary, fontSize: previewTheme.font.body, fontWeight: '700' }]}> 
                              {t.name}
                            </Text>
                            <Text style={[styles.cardDesc, { color: previewTheme.colors.textTertiary, fontSize: previewTheme.font.tiny }]}>
                              {t.description}
                            </Text>
                      </View>
                      {selected && (
                              <View style={[styles.checkBadge, { backgroundColor: previewTheme.colors.primary }]}> 
                                <Text style={styles.checkText}>✓</Text>
                              </View>
                      )}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <Pressable
            onPress={onClose}
            accessibilityLabel="完成主题选择"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.closeBtn,
              {
                backgroundColor: theme.colors.primary,
                borderRadius: theme.radius.md,
                minHeight: theme.touch.minTarget,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={[styles.closeText, { fontSize: theme.font.body, fontWeight: '600' }]}>完成</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(12,16,24,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    padding: 20,
    borderWidth: 1,
  },
  title: {
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    marginBottom: 16,
    lineHeight: 18,
  },
  list: {
    maxHeight: 400,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeCard: {
    width: '100%',
    padding: 12,
    alignItems: 'center',
    flexDirection: 'row',
    position: 'relative',
  },
  previewRow: {
    flexDirection: 'row',
    gap: 6,
    marginRight: 12,
  },
  previewDot: {
    width: 8,
    height: 32,
    borderRadius: 2,
  },
  cardCopy: { flex: 1 },
  cardName: {
    marginBottom: 2,
  },
  cardDesc: {
    textAlign: 'center',
    lineHeight: 14,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  closeBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
  },
});
