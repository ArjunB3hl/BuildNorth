import { SymbolView } from 'expo-symbols';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion, type CSSAnimationKeyframes } from 'react-native-reanimated';

import { aiConic, aiLinear, gradientStyle } from '@/components/gradient';
import { AiColors } from '@/constants/theme';

const spin: CSSAnimationKeyframes = {
  from: { transform: [{ rotate: '0deg' }] },
  to: { transform: [{ rotate: '360deg' }] },
};
const breathe: CSSAnimationKeyframes = {
  '0%': { transform: [{ scale: 1 }] },
  '50%': { transform: [{ scale: 1.08 }] },
  '100%': { transform: [{ scale: 1 }] },
};

/**
 * The coach's identity: a slowly turning gradient orb with a sparkle. While the coach is
 * thinking it turns faster, breathes and glows brighter. Still when reduced motion is on.
 */
export function AiOrb({ size = 28, thinking = false, still = false, style }: {
  size?: number;
  thinking?: boolean;
  /** Don't animate: for orbs that repeat down a list, so only the newest one moves (saves battery). */
  still?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion() || still;
  const glow = { boxShadow: `0 0 ${Math.round(size * (thinking ? 0.9 : 0.5))}px ${AiColors.glow}` };
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width: size, height: size, borderRadius: size / 2 },
        glow,
        thinking && !reduced && { animationName: breathe, animationDuration: '1.6s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' },
        style,
      ]}>
      <View style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: size / 2, backgroundColor: AiColors.blue }]}>
        <Animated.View
          style={[
            styles.spinner,
            gradientStyle(aiConic, aiLinear),
            !reduced && { animationName: spin, animationDuration: thinking ? '1.8s' : '9s', animationIterationCount: 'infinite', animationTimingFunction: 'linear' },
          ]}
        />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={Math.round(size * 0.56)} tintColor="#ffffff" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  // Oversized so the rotating square always covers the circle.
  spinner: { position: 'absolute', top: '-25%', left: '-25%', width: '150%', height: '150%' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
