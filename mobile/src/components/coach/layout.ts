import { Platform, type TextStyle } from 'react-native';

import { aiLinear } from '@/components/gradient';
import { AiColors } from '@/constants/theme';

/** Widest the conversation and composer get on a large screen, for comfortable line lengths. */
export const ChatColumnWidth = 760;

/** A faint violet wash (about 12% opacity) behind the coach's icons; works on light and dark pages. */
export const AiTint = `${AiColors.violet}1F`;

/** An AI-tinted border for hovered cards (about 45% violet). */
export const AiBorder = `${AiColors.violet}73`;

/**
 * Text filled with a gradient on the web (the gradient is clipped to the letters). Phones,
 * where text can't take a background image, use a solid colour instead.
 */
export function gradientText(gradient: string = aiLinear, fallback: string = AiColors.blue): TextStyle {
  if (Platform.OS !== 'web') return { color: fallback };
  // react-native-web passes these straight to the browser; they aren't in React Native's style types.
  return { backgroundImage: gradient, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' } as TextStyle;
}
