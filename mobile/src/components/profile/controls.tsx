import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { Accent, Danger } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useContentWidth } from '@/components/profile/layout';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { easeOut } from '@/components/motion';

type Box = { x: number; y: number; width: number; height: number };

/**
 * One choice out of a few, as a row of segments. Once the segments are laid out, the selected one
 * is marked by a raised thumb that slides to each new choice (it simply moves with reduced motion).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  fill,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** Stretch the segments across the width. Defaults to true on phones and narrow pages. */
  fill?: boolean;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const narrow = useContentWidth() < 600;
  const stretch = fill ?? (Platform.OS !== 'web' || narrow);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const thumb = boxes[value];
  const measure = (key: string) => (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setBoxes((prev) => {
      const old = prev[key];
      if (old && old.x === x && old.y === y && old.width === width && old.height === height) return prev;
      return { ...prev, [key]: { x, y, width, height } };
    });
  };
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.segments, { backgroundColor: theme.backgroundSelected }, !stretch && styles.segmentsCompact]}>
      {thumb ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              backgroundColor: theme.backgroundElement,
              width: thumb.width,
              height: thumb.height,
              transform: [{ translateX: thumb.x }, { translateY: thumb.y }],
            },
            !reduced && {
              transitionProperty: ['transform', 'width', 'height'],
              transitionDuration: '260ms',
              transitionTimingFunction: easeOut,
            },
          ]}
        />
      ) : null}
      {options.map((option) => (
        <Segment
          key={option.value}
          label={option.label}
          selected={option.value === value}
          // Until the thumb can be placed, the selected segment draws its own background.
          raised={!thumb && option.value === value}
          fill={stretch}
          onLayout={measure(option.value)}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

function Segment({ label, selected, raised, fill, onLayout, onPress }: {
  label: string;
  selected: boolean;
  raised: boolean;
  fill: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      onLayout={onLayout}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.segment,
        fill && styles.segmentFill,
        raised && [styles.segmentSelected, { backgroundColor: theme.backgroundElement }],
      ]}>
      <ThemedText
        type={selected ? 'smallBold' : 'small'}
        themeColor={selected || hovered ? 'text' : 'textSecondary'}
        numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

// react-native-web only: a white thumb in both states, like the phone switches.
const webSwitchColors: object = Platform.OS === 'web' ? { thumbColor: '#ffffff', activeThumbColor: '#ffffff' } : {};

/** A switch with its label and a one-line explanation. */
export function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {description ? (
          <ThemedText type="small" themeColor="textSecondary">
            {description}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        // The web switch has no "off" track and a teal thumb unless told otherwise; phones keep their system look.
        trackColor={{ false: Platform.OS === 'web' ? theme.border : undefined, true: Accent }}
        {...webSwitchColors}
      />
    </View>
  );
}

/** A quiet button for actions that remove or revoke something: red text, no fill. */
export function DestructiveButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  size = 'small',
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  size?: 'regular' | 'small';
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={size === 'small' ? 6 : 0}
      style={({ pressed }) => [
        styles.destructive,
        size === 'small' && styles.destructiveSmall,
        hovered && !inactive && { backgroundColor: theme.backgroundSelected },
        inactive ? styles.inactive : pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={Danger} />
      ) : (
        <ThemedText type="smallBold" style={{ color: Danger }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

/** A row of buttons that wraps on narrow screens. */
export function ActionRow({ children, align = 'start', style }: { children: ReactNode; align?: 'start' | 'end'; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.actions, align === 'end' && styles.actionsEnd, style]}>{children}</View>;
}

/**
 * The buttons that finish a form. Phones stack them full width; the web keeps them
 * to their natural size at the end of the row.
 */
export function FormActions({ children }: { children: ReactNode }) {
  return <View style={Platform.OS === 'web' ? [styles.actions, styles.actionsEnd] : styles.stack}>{children}</View>;
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3 },
  segmentsCompact: { alignSelf: 'flex-start', flexWrap: 'wrap' },
  // Laid out at the container's corner, then moved onto the selected segment. No elevation on Android,
  // where it would draw the thumb above the segment labels; a hairline edge stands in for the shadow there.
  thumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 9,
    ...Platform.select({
      web: { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.10)' },
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
      default: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0, 0, 0, 0.08)' },
    }),
  },
  segment: { minHeight: 34, paddingHorizontal: Spacing.three, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segmentFill: { flexGrow: 1, paddingHorizontal: Spacing.two },
  segmentSelected: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.10)' },
    default: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  }),
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  toggleText: { flex: 1, minWidth: 0, gap: Spacing.half },
  destructive: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  destructiveSmall: { minHeight: 36, paddingHorizontal: Spacing.two + Spacing.one, borderRadius: 10 },
  pressed: { opacity: 0.7 },
  inactive: { opacity: 0.5 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  actionsEnd: { justifyContent: 'flex-end' },
  stack: { gap: Spacing.two },
});
