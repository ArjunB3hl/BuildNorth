import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type TextStyle } from 'react-native';
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { AiColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const web = Platform.OS === 'web';
const DOT_COLORS = [AiColors.violet, AiColors.blue, AiColors.cyan];

/** Each dot swells and brightens in turn, then rests for the remainder of the cycle. */
const pulse: CSSAnimationKeyframes = {
  '0%': { opacity: 0.45, transform: [{ translateY: 0 }, { scale: 0.8 }] },
  '25%': { opacity: 1, transform: [{ translateY: -3 }, { scale: 1 }] },
  '50%': { opacity: 0.45, transform: [{ translateY: 0 }, { scale: 0.8 }] },
  '100%': { opacity: 0.45, transform: [{ translateY: 0 }, { scale: 0.8 }] },
};

/** Three dots in the AI colours that pulse one after another. Still (and fully shown) with reduced motion. */
function ThinkingDots() {
  const reduced = useReducedMotion();
  return (
    <View style={styles.dots} aria-hidden>
      {DOT_COLORS.map((color, i) => (
        <Animated.View
          key={color}
          style={[
            styles.dot,
            { backgroundColor: color },
            !reduced && {
              animationName: pulse,
              animationDuration: '1.2s',
              animationDelay: `${i * 160}ms`,
              animationIterationCount: 'infinite',
              animationTimingFunction: 'ease-in-out',
              animationFillMode: 'both',
            },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Web only: a band of AI colour sweeps across the label. Reanimated's keyframes can't move a
 * background, so this uses react-native-web's own keyframes, which only `StyleSheet.create` compiles.
 */
const shimmerSweep = web
  ? StyleSheet.create({
      run: {
        animationKeyframes: [{ '0%': { backgroundPosition: '100% 0' }, '100%': { backgroundPosition: '0% 0' } }],
        animationDuration: '2.4s',
        animationIterationCount: 'infinite',
        animationTimingFunction: 'linear',
      } as TextStyle,
    }).run
  : undefined;

function shimmerFill(base: string): TextStyle {
  // A 300%-wide gradient: the colour band starts off the left edge and leaves off the right.
  return {
    backgroundImage: `linear-gradient(90deg, ${base} 0%, ${base} 40%, ${AiColors.violet} 46%, ${AiColors.cyan} 54%, ${base} 60%, ${base} 100%)`,
    backgroundSize: '300% 100%',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
  } as TextStyle;
}

/** Seconds since the component mounted, ticking once a second. */
function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

const formatElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);

/**
 * "Thinking" with pulsing dots, then the elapsed time once it passes 3 seconds. Only the label is a
 * live region, so screen readers hear "Coach is thinking" once rather than every tick of the clock.
 */
export function ThinkingStatus() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const seconds = useElapsedSeconds();
  const shimmer = web && !reduced;
  return (
    <View style={styles.row}>
      <View style={styles.row} accessible accessibilityRole="text" accessibilityLabel="Coach is thinking" accessibilityLiveRegion="polite">
        <ThemedText type="small" themeColor="textSecondary" style={[styles.label, shimmer && [shimmerFill(theme.textSecondary), shimmerSweep]]}>
          Thinking
        </ThemedText>
        <ThinkingDots />
      </View>
      {seconds >= 3 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.elapsed} aria-hidden>
          {`· ${formatElapsed(seconds)}`}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { fontWeight: '500' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 20, paddingTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  elapsed: { fontVariant: ['tabular-nums'] },
});
