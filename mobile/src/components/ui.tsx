import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Accent, Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useBottomBarInset } from '@/hooks/use-bottom-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';

/** Scrollable screen body for screens that sit under a native header. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  footer,
  aboveTabBar = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  /** False for full-screen modals, where no tab bar covers the footer. */
  aboveTabBar?: boolean;
}) {
  const theme = useTheme();
  const footerInset = useBottomBarInset(aboveTabBar);
  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        // Without a footer, the end of the content must also clear the floating tab bar.
        contentContainerStyle={[styles.scroll, !footer && { paddingBottom: Spacing.six + footerInset }]}
        refreshControl={onRefresh ? <PullToRefresh refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        <View style={styles.column}>{children}</View>
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { borderTopColor: theme.backgroundSelected, paddingBottom: footerInset }]}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * Pull-to-refresh that only spins for refreshes the user started. Background refetches
 * (after a save elsewhere) don't drop the spinner over the content and shift the layout.
 */
function PullToRefresh({ refreshing, onRefresh, ...props }: { refreshing: boolean; onRefresh: () => void }) {
  const [pulled, setPulled] = useState(false);
  // A pull ends when the refresh it triggered finishes; derived during render instead of in an effect.
  const [sawRefreshing, setSawRefreshing] = useState(false);
  if (pulled && refreshing && !sawRefreshing) setSawRefreshing(true);
  if (pulled && !refreshing && sawRefreshing) {
    setPulled(false);
    setSawRefreshing(false);
  }
  return (
    <RefreshControl
      {...props}
      refreshing={pulled}
      onRefresh={() => {
        setPulled(true);
        onRefresh();
      }}
    />
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader} accessibilityRole="header">
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {action}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card style={styles.empty}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {body ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {body}
        </ThemedText>
      ) : null}
      {action}
    </Card>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.loading} accessibilityLabel={label}>
      <ActivityIndicator />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

/** Error with a retry button; in development builds also shows the server's detail. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const detail = __DEV__ && error instanceof ApiError ? error.detail : undefined;
  return (
    <View style={styles.errorBox}>
      <Notice tone="error">
        {errorMessage(error)}
        {detail ? `\n(dev: ${detail})` : ''}
      </Notice>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Shown above cached content when the latest refresh failed. */
export function StaleBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <Notice tone="info">Showing your saved copy. We couldn&apos;t refresh just now.</Notice>;
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? Accent : theme.backgroundElement,
          borderColor: selected ? Accent : theme.backgroundSelected,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small" style={{ color: selected ? '#ffffff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function ChipGroup({
  options,
  selected,
  onChange,
  multiple = true,
}: {
  options: readonly { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <Chip
            key={option.value}
            label={option.label}
            selected={isSelected}
            onPress={() => {
              if (multiple) {
                onChange(isSelected ? selected.filter((v) => v !== option.value) : [...selected, option.value]);
              } else {
                onChange(isSelected ? [] : [option.value]);
              }
            }}
          />
        );
      })}
    </View>
  );
}

/** Integer picker with large +/- targets. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepper} accessibilityLabel={`${label}: ${value}${suffix ? ` ${suffix}` : ''}`}>
      <ThemedText type="small" style={styles.fill}>
        {label}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.stepperButton, { backgroundColor: theme.backgroundSelected }, value <= min && styles.inactive]}>
        <ThemedText type="smallBold">−</ThemedText>
      </Pressable>
      <ThemedText type="smallBold" style={styles.stepperValue}>
        {value}
        {suffix ? ` ${suffix}` : ''}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.stepperButton, { backgroundColor: theme.backgroundSelected }, value >= max && styles.inactive]}>
        <ThemedText type="smallBold">+</ThemedText>
      </Pressable>
    </View>
  );
}

/** 1–5 rating as a row of large buttons. */
export function Rating({
  label,
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  lowLabel: string;
  highLabel: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.ratingBlock}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.ratingRow}>
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${label} ${n} of 5`}
              onPress={() => onChange(n)}
              style={[
                styles.ratingButton,
                { backgroundColor: selected ? Accent : theme.backgroundSelected },
              ]}>
              <ThemedText type="smallBold" style={{ color: selected ? '#ffffff' : theme.text }}>
                {n}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ratingLabels}>
        <ThemedText type="small" themeColor="textSecondary">
          {lowLabel}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {highLabel}
        </ThemedText>
      </View>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

/** Tappable list row with a title, optional subtitle and trailing content. */
export function ListItem({
  title,
  subtitle,
  onPress,
  trailing,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.listItem, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
      <View style={styles.fill}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {trailing ?? (onPress ? <ThemedText themeColor="textSecondary">›</ThemedText> : null)}
    </Pressable>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'muted' | 'accent' }) {
  const theme = useTheme();
  const colors = {
    neutral: { bg: theme.backgroundSelected, fg: theme.text },
    success: { bg: '#E7F6EC', fg: '#1E8E3E' },
    muted: { bg: theme.backgroundSelected, fg: theme.textSecondary },
    accent: { bg: '#E8F1FE', fg: Accent },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg }]}>
      <ThemedText type="small" style={{ color: colors.fg, fontSize: 12, lineHeight: 16 }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  footer: { padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
  sectionTitle: { letterSpacing: 0.5, fontSize: 12 },
  empty: { alignItems: 'center', paddingVertical: Spacing.four, gap: Spacing.two },
  loading: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  errorBox: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: Spacing.three, justifyContent: 'center' },
  pressed: { opacity: 0.75 },
  inactive: { opacity: 0.4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  stepperButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 56, textAlign: 'center' },
  ratingBlock: { gap: Spacing.two },
  ratingRow: { flexDirection: 'row', gap: Spacing.two },
  ratingButton: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ratingLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.three, minHeight: 56 },
  pill: { borderRadius: 10, paddingHorizontal: Spacing.two, paddingVertical: 2, alignSelf: 'flex-start' },
});
