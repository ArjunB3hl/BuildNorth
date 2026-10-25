import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Accent, Danger } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** SF Symbols on iOS, Material Symbols on Android and the web. */
export const Icons = {
  routine: { ios: 'figure.strengthtraining.traditional', android: 'fitness_center', web: 'fitness_center' },
  exercises: { ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' },
  time: { ios: 'clock', android: 'schedule', web: 'schedule' },
  timer: { ios: 'timer', android: 'timer', web: 'timer' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  calendar: { ios: 'calendar', android: 'calendar_today', web: 'calendar_today' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  up: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  down: { ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' },
  remove: { ios: 'trash', android: 'delete', web: 'delete' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  done: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  resume: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
} satisfies Record<string, SymbolViewProps['name']>;

export type IconName = keyof typeof Icons;

/** A decorative icon. Screen readers skip it, so the text beside it must carry the meaning. */
export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <SymbolView name={Icons[name]} size={size} tintColor={color ?? theme.textSecondary} />
    </View>
  );
}

/** A square icon tile, used to mark a card's kind (a routine, an unfinished session). */
export function IconTile({ name }: { name: IconName }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
      <Icon name={name} size={20} color={Accent} />
    </View>
  );
}

/** A compact icon-only button for row tools (move, remove). Always give it a spoken label. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  tone = 'neutral',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        !disabled && (hovered || pressed) && { backgroundColor: theme.backgroundSelected },
        disabled && styles.disabled,
      ]}>
      <Icon name={icon} size={20} color={tone === 'danger' ? Danger : theme.textSecondary} />
    </Pressable>
  );
}

/** A full-width dashed button that adds another item to a list. */
export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.add,
        { borderColor: hovered ? Accent : theme.border },
        hovered && { backgroundColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      <Icon name="add" size={20} color={Accent} />
      <ThemedText type="smallBold" style={{ color: Accent }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconButton: {
    width: Platform.OS === 'web' ? 36 : 40,
    height: Platform.OS === 'web' ? 36 : 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.75 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
