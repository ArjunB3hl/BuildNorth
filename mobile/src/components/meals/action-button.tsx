import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Accent, Danger } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const web = Platform.OS === 'web';

/**
 * Secondary action for what the shared `Button` doesn't cover: a leading icon, a count badge,
 * a red (danger) outline, icon-only and borderless in-row buttons. Plain text secondary actions
 * use `Button variant="secondary"`. Give icon-only buttons an `accessibilityLabel`.
 */
export function ActionButton({
  title,
  icon,
  onPress,
  tone = 'neutral',
  size = 'regular',
  badge,
  loading = false,
  disabled = false,
  iconOnly = false,
  bare = false,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  icon?: SymbolViewProps['name'];
  onPress: () => void;
  tone?: 'neutral' | 'danger' | 'accent';
  size?: 'regular' | 'small';
  /** A short count shown after the label, e.g. items still to buy. */
  badge?: string | number;
  loading?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  /** No border or fill until hovered, for icon buttons inside list rows. */
  bare?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const inactive = disabled || loading;
  const color = tone === 'danger' ? Danger : tone === 'accent' ? Accent : theme.text;
  const iconColor = tone === 'neutral' ? theme.textSecondary : color;
  const small = size === 'small';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={small ? 6 : 0}
      style={[
        styles.button,
        small ? styles.small : styles.regular,
        iconOnly && (small ? styles.iconSmall : styles.iconRegular),
        {
          borderColor: bare ? 'transparent' : theme.border,
          backgroundColor: hovered && !inactive ? theme.backgroundSelected : bare ? 'transparent' : theme.backgroundElement,
        },
        inactive ? styles.inactive : pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={iconColor} />
      ) : (
        <>
          {icon ? <SymbolView name={icon} size={small ? 18 : 20} tintColor={iconColor} /> : null}
          {iconOnly ? null : (
            <ThemedText type="smallBold" style={{ color }} numberOfLines={1}>
              {title}
            </ThemedText>
          )}
          {badge != null && !iconOnly ? (
            <View style={[styles.badge, { backgroundColor: Accent }]}>
              <ThemedText type="smallBold" style={styles.badgeText}>
                {badge}
              </ThemedText>
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
  },
  regular: { minHeight: 48, borderRadius: 12, paddingHorizontal: Spacing.three },
  small: { minHeight: 36, borderRadius: 10, paddingHorizontal: Spacing.two + Spacing.one },
  // Icon-only buttons stay at least 44pt on phones; the web can be denser.
  iconSmall: { width: web ? 36 : 44, minHeight: web ? 36 : 44, paddingHorizontal: 0 },
  iconRegular: { width: 48, paddingHorizontal: 0 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: Spacing.one + Spacing.half, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: 12, lineHeight: 16 },
  pressed: { opacity: 0.8 },
  inactive: { opacity: 0.5 },
});
