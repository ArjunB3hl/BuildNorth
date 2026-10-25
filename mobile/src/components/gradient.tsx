import type { ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

import { AiColors } from '@/constants/theme';

/**
 * A CSS gradient as a background. The web passes `backgroundImage` straight to the browser
 * (so conic gradients work there); phones use React Native's `experimental_backgroundImage`,
 * which supports linear and radial gradients. Always set a solid backgroundColor underneath.
 */
export function gradientStyle(web: string, native: string = web): ViewStyle {
  return Platform.OS === 'web' ? ({ backgroundImage: web } as ViewStyle) : { experimental_backgroundImage: native };
}

export const aiLinear = `linear-gradient(135deg, ${AiColors.violet}, ${AiColors.blue} 55%, ${AiColors.cyan})`;
export const aiConic = `conic-gradient(from 200deg, ${AiColors.violet}, ${AiColors.blue}, ${AiColors.cyan}, #A855F7, ${AiColors.violet})`;

/** A view filled with the AI gradient (or any gradient), with a solid colour fallback. */
export function GradientView({ children, style, web = aiLinear, native, fallback = AiColors.blue }: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  web?: string;
  native?: string;
  fallback?: string;
}) {
  return <View style={[{ backgroundColor: fallback }, gradientStyle(web, native ?? (web.startsWith('conic') ? aiLinear : web)), style]}>{children}</View>;
}
