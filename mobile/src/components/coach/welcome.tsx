import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from 'react-native-reanimated';

import { AiOrb } from '@/components/ai-orb';
import { AiBorder, AiTint, gradientText } from '@/components/coach/layout';
import { GradientView, gradientStyle } from '@/components/gradient';
import { FadeIn, liftStyle, useHover } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { AiColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const web = Platform.OS === 'web';

const STARTERS: { text: string; icon: SymbolViewProps['name'] }[] = [
  { text: 'What should I cook tonight?', icon: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' } },
  { text: 'Plan a 20-minute workout I can do at home', icon: { ios: 'figure.run', android: 'fitness_center', web: 'fitness_center' } },
  { text: 'Help me plan meals for tomorrow', icon: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' } },
  { text: 'Suggest a quick, high-protein lunch', icon: { ios: 'takeoutbag.and.cup.and.straw', android: 'lunch_dining', web: 'lunch_dining' } },
];

/** First screen of an empty conversation: what the coach is for, and a few ways to start. */
export function CoachWelcome({ onSelect, disabled, wide }: { onSelect: (text: string) => void; disabled: boolean; wide: boolean }) {
  // Phones get a tighter hero so the starters fit above the composer.
  const hero = wide ? 120 : 96;
  return (
    <View style={[styles.welcome, !wide && styles.compact]}>
      <FadeIn style={[styles.hero, { width: hero, height: hero }]}>
        {web ? <Halo box={hero} /> : null}
        <AiOrb size={72} />
      </FadeIn>
      <FadeIn index={1} style={styles.intro}>
        <ThemedText accessibilityRole="header" style={[styles.heading, !wide && styles.headingCompact, gradientText()]}>
          How can I help today?
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          Meals, cooking and workouts, tailored to your profile and memory. Completed meals and workouts you report are added to Calendar, and it isn’t
          medical advice.
        </ThemedText>
      </FadeIn>
      <View style={[styles.grid, !wide && styles.gridCompact]}>
        {STARTERS.map((starter, i) => (
          <FadeIn key={starter.text} index={i + 3} style={styles.cell}>
            <StarterCard {...starter} wide={wide} disabled={disabled} onPress={() => onSelect(starter.text)} />
          </FadeIn>
        ))}
      </View>
    </View>
  );
}

const glow: CSSAnimationKeyframes = {
  from: { opacity: 0.7, transform: [{ scale: 0.92 }] },
  to: { opacity: 1, transform: [{ scale: 1.06 }] },
};

/** The halo reaches a little past the hero box (its edge fades to nothing), staying inside the list's top padding. */
const HALO_SCALE = 1.75;
const haloGradient = `radial-gradient(closest-side, ${AiColors.violet}4D, ${AiColors.blue}24 55%, ${AiColors.cyan}00 100%)`;

/** Web only: a soft violet-to-blue light behind the orb that slowly swells and settles. */
function Halo({ box }: { box: number }) {
  const reduced = useReducedMotion();
  const size = box * HALO_SCALE;
  const offset = (box - size) / 2;
  return (
    <Animated.View
      aria-hidden
      style={[
        styles.halo,
        { width: size, height: size, borderRadius: size / 2, left: offset, top: offset },
        gradientStyle(haloGradient),
        !reduced && {
          animationName: glow,
          animationDuration: '4.5s',
          animationIterationCount: 'infinite',
          animationDirection: 'alternate',
          animationTimingFunction: 'ease-in-out',
        },
      ]}
    />
  );
}

// react-native-web passes CSS transitions through; they aren't in React Native's style types.
const fadeTransition = (web ? { transitionProperty: 'opacity, transform', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' } : {}) as ViewStyle;

function StarterCard({
  text,
  icon,
  wide,
  disabled,
  onPress,
}: {
  text: string;
  icon: SymbolViewProps['name'];
  wide: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const active = hovered && !disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        styles.starter,
        wide ? styles.starterRow : styles.starterColumn,
        { backgroundColor: theme.backgroundElement, borderColor: active ? AiBorder : theme.border },
        liftStyle(active),
        active && styles.starterGlow,
        pressed && !disabled && styles.pressed,
        disabled && styles.inactive,
      ]}>
      <View style={[styles.chip, { backgroundColor: AiTint }]}>
        {/* On hover the chip fills with the AI gradient and the icon turns white. */}
        <GradientView style={[StyleSheet.absoluteFill, fadeTransition, { opacity: active ? 1 : 0 }]} />
        <SymbolView name={icon} size={18} tintColor={active ? '#ffffff' : AiColors.violet} />
      </View>
      <ThemedText type="small" style={[styles.starterText, wide && styles.fill]}>
        {text}
      </ThemedText>
      {wide && web ? (
        <View aria-hidden style={[fadeTransition, active ? styles.arrowShown : styles.arrowHidden]}>
          <SymbolView name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={16} tintColor={AiColors.violet} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: 'center' },
  welcome: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.four },
  compact: { gap: Spacing.two + Spacing.one, paddingVertical: Spacing.two },
  hero: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', pointerEvents: 'none' },
  intro: { alignItems: 'center', gap: Spacing.two, maxWidth: 560 },
  heading: Platform.select({
    web: { fontSize: 30, lineHeight: 38, fontWeight: '600', letterSpacing: -0.5, textAlign: 'center' },
    default: { fontSize: 24, lineHeight: 32, fontWeight: '700', textAlign: 'center' },
  }),
  headingCompact: { fontSize: 24, lineHeight: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two + Spacing.one, width: '100%', marginTop: Spacing.three },
  gridCompact: { marginTop: Spacing.one },
  // Two cards to a row: each starts at 40% and grows into the space left.
  cell: { flexBasis: '40%', flexGrow: 1 },
  starter: { flexGrow: 1, borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two + Spacing.one },
  // Wide screens: icon, text and a hover arrow in a row. Phones: icon above the text.
  starterRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  starterColumn: { minHeight: 100, padding: Spacing.three - Spacing.half, gap: Spacing.two },
  starterText: { lineHeight: 20 },
  starterGlow: { boxShadow: `0 10px 28px ${AiColors.violet}29` },
  chip: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  arrowShown: { opacity: 1, transform: [{ translateX: 0 }] },
  arrowHidden: { opacity: 0, transform: [{ translateX: -4 }] },
  pressed: { transform: [{ scale: 0.98 }] },
  inactive: { opacity: 0.5 },
});
