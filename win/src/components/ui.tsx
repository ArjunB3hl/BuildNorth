import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';

import { useNav } from '../navigation';
import {
  Accent,
  Danger,
  MaxContentWidth,
  Spacing,
  ToneColors,
  useIsDark,
  useTheme,
  type Theme,
  type ThemeColor,
  type Tone,
} from '../theme';

// Ported from the BuildNorth iPhone app (src/components/ui.tsx, form.tsx, themed-text.tsx),
// with hover states and a page header in place of the native navigation bar.

export function useHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    hoverProps: {
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
    },
  };
}

type TextType = 'default' | 'small' | 'smallBold' | 'subtitle' | 'title';

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  ...rest
}: TextProps & { type?: TextType; themeColor?: ThemeColor }) {
  const theme = useTheme();
  return (
    <Text
      style={[{ color: theme[themeColor ?? 'text'] }, textStyles[type], style]}
      {...rest}
    />
  );
}

const textStyles = StyleSheet.create({
  default: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  small: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  smallBold: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  subtitle: { fontSize: 28, lineHeight: 36, fontWeight: '600' },
  title: { fontSize: 30, lineHeight: 38, fontWeight: '700' },
});

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet';

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'regular',
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: 'regular' | 'small';
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const inactive = disabled || loading;
  const filled = variant === 'primary' || variant === 'danger';
  const background =
    variant === 'primary'
      ? Accent
      : variant === 'danger'
      ? Danger
      : variant === 'quiet'
      ? hovered && !inactive
        ? theme.backgroundElement
        : 'transparent'
      : hovered && !inactive
      ? theme.backgroundSelected
      : theme.backgroundElement;
  const labelColor = filled
    ? '#ffffff'
    : variant === 'quiet'
    ? Accent
    : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        styles.button,
        size === 'small' && styles.buttonSmall,
        { backgroundColor: background },
        !inactive && styles.pointer,
        filled && hovered && !inactive && styles.hoveredFill,
        inactive ? styles.inactive : pressed && styles.pressed,
      ]}
    >
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

export function Notice({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  const colors = ToneColors[tone];
  const dark = useIsDark();
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      style={[
        styles.notice,
        { backgroundColor: dark ? colors.dark : colors.light },
      ]}
    >
      <ThemedText type="small" style={{ color: colors.text }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function TextField({
  label,
  style,
  ...props
}: TextInputProps & { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      {label ? <ThemedText type="smallBold">{label}</ThemedText> : null}
      <TextInput
        placeholderTextColor={theme.textSecondary}
        // Narrator reads the visible label unless the caller names the field.
        accessibilityLabel={label}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.backgroundSelected,
          },
          style,
        ]}
        {...props}
      />
    </View>
  );
}

/** Scrollable page with a header, used by every section except Coach. */
export function Screen({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.column}>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {children}
      </View>
    </ScrollView>
  );
}

/** Large title with a back link when the page was pushed inside a section. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const nav = useNav();
  return (
    <View style={styles.header}>
      {nav.backTitle ? (
        <View style={styles.backRow}>
          <Button
            title={`‹ ${nav.backTitle}`}
            size="small"
            variant="quiet"
            onPress={nav.back}
            accessibilityLabel={`Back to ${nav.backTitle}`}
          />
        </View>
      ) : null}
      <Row style={styles.titleRow}>
        <View style={styles.fill}>
          <ThemedText type="title" accessibilityRole="header">
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>
          ) : null}
        </View>
        {actions ? <Row>{actions}</Row> : null}
      </Row>
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeader} accessibilityRole="header">
      <ThemedText
        type="smallBold"
        themeColor="textSecondary"
        style={styles.sectionTitle}
      >
        {title.toUpperCase()}
      </ThemedText>
      {action}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <Card style={styles.empty}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {body ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.center}
        >
          {body}
        </ThemedText>
      ) : null}
      {action}
    </Card>
  );
}

export function Row({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.row, style]}>{children}</View>;
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
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        styles.chip,
        styles.pointer,
        {
          backgroundColor: selected
            ? Accent
            : hovered
            ? theme.backgroundSelected
            : theme.backgroundElement,
          borderColor: selected ? Accent : theme.backgroundSelected,
        },
        pressed && styles.pressed,
      ]}
    >
      <ThemedText type="small" style={selected && styles.onAccent}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function ChipGroup<T extends string>({
  options,
  selected,
  onChange,
  multiple = true,
}: {
  options: readonly { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
}) {
  return (
    <View style={styles.chips}>
      {options.map(option => {
        const isSelected = selected.includes(option.value);
        return (
          <Chip
            key={option.value}
            label={option.label}
            selected={isSelected}
            onPress={() => {
              if (multiple) {
                onChange(
                  isSelected
                    ? selected.filter(v => v !== option.value)
                    : [...selected, option.value],
                );
              } else {
                onChange([option.value]);
              }
            }}
          />
        );
      })}
    </View>
  );
}

/** Number picker with +/- buttons. */
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
  const stepButton = (sign: -1 | 1) => {
    const disabled = sign < 0 ? value <= min : value >= max;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${sign < 0 ? 'Decrease' : 'Increase'} ${label}`}
        disabled={disabled}
        onPress={() =>
          onChange(Math.min(max, Math.max(min, value + sign * step)))
        }
        style={[
          styles.stepperButton,
          { backgroundColor: theme.backgroundSelected },
          disabled ? styles.inactive : styles.pointer,
        ]}
      >
        <ThemedText type="smallBold">{sign < 0 ? '−' : '+'}</ThemedText>
      </Pressable>
    );
  };
  return (
    <View
      style={styles.stepper}
      accessibilityLabel={`${label}: ${value}${suffix ? ` ${suffix}` : ''}`}
    >
      <ThemedText type="small" style={styles.fill}>
        {label}
      </ThemedText>
      {stepButton(-1)}
      <ThemedText type="smallBold" style={styles.stepperValue}>
        {value}
        {suffix ? ` ${suffix}` : ''}
      </ThemedText>
      {stepButton(1)}
    </View>
  );
}

/** 1–5 rating as a row of buttons. */
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
        {[1, 2, 3, 4, 5].map(n => (
          <RatingButton
            key={n}
            n={n}
            label={label}
            selected={value === n}
            theme={theme}
            onPress={() => onChange(n)}
          />
        ))}
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

function RatingButton({
  n,
  label,
  selected,
  theme,
  onPress,
}: {
  n: number;
  label: string;
  selected: boolean;
  theme: Theme;
  onPress: () => void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} ${n} of 5`}
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.ratingButton,
        styles.pointer,
        {
          backgroundColor: selected
            ? Accent
            : hovered
            ? theme.backgroundElement
            : theme.backgroundSelected,
        },
      ]}
    >
      <ThemedText type="smallBold" style={selected && styles.onAccent}>
        {n}
      </ThemedText>
    </Pressable>
  );
}

/** Clickable row with a title, optional subtitle and trailing content. */
export function ListItem({
  title,
  subtitle,
  onPress,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      disabled={!onPress}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        styles.listItem,
        {
          backgroundColor:
            hovered && onPress
              ? theme.backgroundSelected
              : theme.backgroundElement,
        },
        onPress && styles.pointer,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.fill}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <ThemedText themeColor="textSecondary">›</ThemedText>
        ) : null)}
    </Pressable>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'muted' | 'accent';
}) {
  const theme = useTheme();
  const dark = useIsDark();
  const colors = {
    neutral: { bg: theme.backgroundSelected, fg: theme.text },
    success: { bg: dark ? '#16301F' : '#E7F6EC', fg: '#1E8E3E' },
    muted: { bg: theme.backgroundSelected, fg: theme.textSecondary },
    accent: { bg: dark ? '#17263A' : '#E8F1FE', fg: Accent },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg }]}>
      <ThemedText type="small" style={[styles.pillText, { color: colors.fg }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  onAccent: { color: '#ffffff' },
  center: { textAlign: 'center' },
  pointer: { cursor: 'pointer' },
  scroll: {
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
  },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  header: { gap: Spacing.one, marginBottom: Spacing.one },
  backRow: { alignItems: 'flex-start', marginLeft: -Spacing.two },
  titleRow: { alignItems: 'flex-end' },
  button: {
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  buttonSmall: {
    minHeight: 30,
    paddingHorizontal: Spacing.two + Spacing.one,
    borderRadius: 8,
  },
  hoveredFill: { opacity: 0.9 },
  pressed: { opacity: 0.75 },
  inactive: { opacity: 0.45 },
  notice: { borderRadius: 12, padding: Spacing.three },
  field: { gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    fontSize: 14,
  },
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  sectionTitle: { letterSpacing: 0.5, fontSize: 11 },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: 30,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 36,
  },
  stepperButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { minWidth: 56, textAlign: 'center' },
  ratingBlock: { gap: Spacing.two },
  ratingRow: { flexDirection: 'row', gap: Spacing.two },
  ratingButton: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    minHeight: 52,
  },
  pill: {
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 11, lineHeight: 15 },
});
