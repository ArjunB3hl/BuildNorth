/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

const NativeColors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    border: '#E0E1E6',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    border: '#2E3135',
  },
} as const;

/** The web app sits on a wide canvas: a soft page background, white (or raised dark) surfaces and hairline borders. */
const WebColors = {
  light: {
    text: '#16171A',
    background: '#F6F7F9',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#ECEEF2',
    textSecondary: '#5F6470',
    border: '#E2E5EA',
  },
  dark: {
    text: '#EDEDEF',
    background: '#0B0B0D',
    backgroundElement: '#161619',
    backgroundSelected: '#232328',
    textSecondary: '#A0A1AB',
    border: '#27272D',
  },
} as const;

export const Colors = Platform.OS === 'web' ? WebColors : NativeColors;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Extra room for the tab bar under a bottom bar (composer, save button), on top of the safe-area inset.
 * On iOS the floating tab bar already sits inside the area the safe-area inset covers (measured on an
 * iPhone 17 simulator), so nothing extra is needed; 50 left a ~60 pt gap above it. Android is unmeasured.
 */
export const BottomTabInset = Platform.select({ ios: 0, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
/** Web only: the column for grids and two-column pages. */
export const WideContentWidth = 1120;

/** The AI's own colours (violet → blue → cyan), kept apart from the app accent so AI features are easy to spot. */
export const AiColors = {
  violet: '#8B5CF6',
  blue: '#3B82F6',
  cyan: '#22D3EE',
  glow: 'rgba(124, 92, 255, 0.45)',
} as const;
