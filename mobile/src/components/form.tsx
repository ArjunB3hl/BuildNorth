import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

export const Accent = '#208AEF';
export const Danger = '#D93025';
export const Success = '#1E8E3E';
const ToneColors = {
  error: { light: '#FDECEC', dark: '#3B1A1A', text: '#D93025' },
  success: { light: '#E7F6EC', dark: '#16301F', text: '#1E8E3E' },
  info: { light: '#E8F1FE', dark: '#17263A', text: Accent },
  warning: { light: '#FEF7E0', dark: '#3A2F12', text: '#B06000' },
} as const;

export function FormScreen({ children }: { children: ReactNode }) {
  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled">
            <View style={styles.column}>{children}</View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <ThemedView style={[styles.fill, styles.centered]}>
      <ActivityIndicator size="large" />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

export function TextField({ label, style, onFocus, onBlur, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: focused ? Accent : theme.border,
          },
          // The accent border is the focus indicator; the browser's own outline would double it.
          Platform.OS === 'web' && styles.noOutline,
          style,
        ]}
        {...props}
      />
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'regular',
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  size?: 'regular' | 'small';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const inactive = disabled || loading;
  const filled = variant === 'primary' || variant === 'danger';
  const background =
    variant === 'primary' ? Accent : variant === 'danger' ? Danger : variant === 'quiet' ? 'transparent' : theme.backgroundElement;
  const labelColor = filled ? '#ffffff' : variant === 'quiet' ? Accent : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={size === 'small' ? 6 : 0}
      style={(state) => {
        // react-native-web adds `hovered` to the press state.
        const hovered = !inactive && (state as { hovered?: boolean }).hovered;
        return [
          styles.button,
          size === 'small' && styles.buttonSmall,
          { backgroundColor: background },
          // Secondary buttons share their fill with cards, so they need an outline to read as buttons.
          variant === 'secondary' && { borderWidth: 1, borderColor: theme.border },
          Platform.OS === 'web' && buttonTransition,
          hovered && (filled ? styles.hoveredFilled : { backgroundColor: theme.backgroundSelected }),
          inactive ? styles.inactive : state.pressed && styles.pressed,
        ];
      }}>
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <ThemedText type="smallBold" style={{ color: labelColor }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function Notice({ tone, children }: { tone: keyof typeof ToneColors; children: ReactNode }) {
  const colors = ToneColors[tone];
  const background = useColorScheme() === 'dark' ? colors.dark : colors.light;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      style={[styles.notice, { backgroundColor: background }]}>
      <ThemedText type="small" style={{ color: colors.text }}>
        {children}
      </ThemedText>
    </View>
  );
}

// react-native-web passes CSS transitions through; they aren't in React Native's style types.
const buttonTransition = { transitionProperty: 'background-color, opacity, transform', transitionDuration: '150ms' } as object;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  scrollContent: { flexGrow: 1, padding: Spacing.four },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  field: { gap: Spacing.two },
  noOutline: { outlineWidth: 0 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: Spacing.two + Spacing.one, borderRadius: 10 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  hoveredFilled: { opacity: 0.9 },
  inactive: { opacity: 0.5 },
  notice: { borderRadius: 12, padding: Spacing.three },
});
