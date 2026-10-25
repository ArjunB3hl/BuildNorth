import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

/**
 * Shared motion. Every animation here is skipped when the system asks for reduced motion.
 * Durations: entrances 420 ms (ease-out curve), hovers 180 ms, ambient loops 1.4–9 s.
 */
/**
 * The house ease-out curve. Always use this, never a 'cubic-bezier(...)' string directly: browsers
 * accept that string, but Reanimated on iOS and Android throws on it ("Invalid predefined timing
 * function"). Phones get the closest named curve instead.
 */
export const easeOut = Platform.OS === 'web' ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease-out';

/** How long a FadeIn takes; anything timed against it should read this. */
export const FADE_IN_MS = 420;

const rise: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: 10 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};

/** Fades content up into place when it first appears. `index` staggers items in a list (capped at 8 steps). */
export function FadeIn({ children, index = 0, delay = 0, style }: {
  children: ReactNode;
  index?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  // The delay is fixed when the item mounts: if a refetch later shifts its index, nothing replays.
  const [startDelay] = useState(delay + Math.min(index, 8) * 60);
  return (
    <Animated.View
      style={[
        style,
        !reduced && {
          animationName: rise,
          animationDuration: `${FADE_IN_MS}ms`,
          animationDelay: `${startDelay}ms`,
          animationFillMode: 'both',
          animationTimingFunction: easeOut,
        },
      ]}>
      {children}
    </Animated.View>
  );
}


/** `FadeIn` under the name some screens use for single sections. */
export const Enter = FadeIn;

/**
 * Wraps each child in a staggered entrance, keyed by the child's own key, so a refetch that keeps
 * the same keys never replays it. Null children are skipped (they'd otherwise take a gap slot).
 */
export function Stagger({ children, delay = 0, max = 6, itemStyle }: {
  children: ReactNode;
  delay?: number;
  /** The last stagger step; later items enter together with it, keeping long pages quick. */
  max?: number;
  itemStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <FadeIn key={isValidElement(child) && child.key != null ? child.key : i} index={Math.min(i, max)} delay={delay} style={itemStyle}>
          {child}
        </FadeIn>
      ))}
    </>
  );
}

// Two copies of one pop: switching between them restarts it without remounting the content.
const popA: CSSAnimationKeyframes = {
  '0%': { transform: [{ scale: 1 }] },
  '40%': { transform: [{ scale: 1.15 }] },
  '100%': { transform: [{ scale: 1 }] },
};
const popB: CSSAnimationKeyframes = {
  '0%': { transform: [{ scale: 1 }] },
  '41%': { transform: [{ scale: 1.15 }] },
  '100%': { transform: [{ scale: 1 }] },
};

/**
 * Scales its content 1 → 1.15 → 1 each time `count` goes up, for a check mark being ticked.
 * Nothing plays while `count` is 0, so items that load already ticked stay still.
 */
export function Pop({ count, style, children }: { count: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <Animated.View
      style={[
        style,
        count > 0 && !reduced && {
          animationName: count % 2 ? popA : popB,
          animationDuration: '280ms',
          animationTimingFunction: easeOut,
        },
      ]}>
      {children}
    </Animated.View>
  );
}

/** A progress fill whose width eases to each new value. Place it in a track with `overflow: 'hidden'`. */
export function FillBar({ progress, color, style }: { progress: number; color: string; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 1000) / 10;
  return (
    <Animated.View
      style={[
        { height: '100%', width: `${percent}%`, backgroundColor: color },
        style,
        !reduced && { transitionProperty: 'width', transitionDuration: '360ms', transitionTimingFunction: easeOut },
      ]}
    />
  );
}

const reveal: CSSAnimationKeyframes = {
  from: { opacity: 0, transform: [{ translateY: -6 }] },
  to: { opacity: 1, transform: [{ translateY: 0 }] },
};
const conceal: CSSAnimationKeyframes = {
  from: { opacity: 1, transform: [{ translateY: 0 }] },
  to: { opacity: 0, transform: [{ translateY: -6 }] },
};
const COLLAPSE_MS = 160;

/**
 * Content that fades and slides in when `open` turns on, and out before it is removed.
 * With reduced motion it simply appears and disappears.
 */
export function Collapse({ open, style, children }: { open: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduced = useReducedMotion();
  // Still on screen while the closing animation plays; derived during render, cleared by a timer.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const closing = shown && !open;
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setShown(false), reduced ? 0 : COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [closing, reduced]);
  if (!shown || (closing && reduced)) return null;
  return (
    <Animated.View
      style={[
        style,
        !reduced && {
          animationName: closing ? conceal : reveal,
          animationDuration: closing ? `${COLLAPSE_MS}ms` : '240ms',
          animationFillMode: 'both',
          animationTimingFunction: easeOut,
        },
      ]}>
      {children}
    </Animated.View>
  );
}

/** A CSS transition for plain React Native views on the web (react-native-web passes it through). */
export function webTransition(properties: string, duration = 160): ViewStyle {
  return (Platform.OS === 'web' ? { transitionProperty: properties, transitionDuration: `${duration}ms`, transitionTimingFunction: 'ease-out' } : {}) as ViewStyle;
}

const pulse: CSSAnimationKeyframes = {
  '0%': { opacity: 0.5 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.5 },
};

/** A placeholder block that gently pulses while content loads. */
export function Skeleton({ width = '100%', height = 14, radius = 8, style }: {
  width?: ViewStyle['width'];
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: theme.backgroundSelected },
        !reduced && { animationName: pulse, animationDuration: '1.4s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' },
        style,
      ]}
    />
  );
}

/** A card-shaped placeholder: a title line and a few text lines. */
export function SkeletonCard({ lines = 2, style }: { lines?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, style]}>
      <Skeleton width="55%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </Animated.View>
  );
}

/** Hover state for web pointer devices; always false on phones. */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered: Platform.OS === 'web' && hovered,
    hoverProps: { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) },
  };
}

// react-native-web passes CSS transitions through; they aren't in React Native's style types.
const liftTransition = (Platform.OS === 'web'
  ? { transitionProperty: 'transform, box-shadow, border-color, background-color', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' }
  : {}) as ViewStyle;

/**
 * Style for a clickable card: on the web it rises 2 px with a softer, larger shadow on hover.
 * Spread it into a static style (it is safe inside `StyleSheet.flatten` for `<Link asChild>` children).
 */
export function liftStyle(hovered: boolean): ViewStyle {
  if (Platform.OS !== 'web') return {};
  if (!hovered) return liftTransition;
  // With reduced motion the card keeps its stronger shadow but doesn't move.
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return { ...liftTransition, ...(still ? null : { transform: [{ translateY: -2 }] }), boxShadow: '0 10px 28px rgba(16, 24, 40, 0.10)' };
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 20, gap: 10, borderWidth: Platform.OS === 'web' ? 1 : 0 },
});
