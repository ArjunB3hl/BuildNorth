import { useColorScheme } from 'react-native';

// The Rhythm website's design tokens (mobile/src/constants/theme.ts, WebColors): a soft page background, white (or
// raised dark) surfaces with hairline borders, and the website's accent. The Windows app is a desktop app on a wide
// canvas, like the website, so it takes the website's palette rather than the phone's.

export type Theme = {
  text: string;
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  textSecondary: string;
  /** Hairline borders around cards, the sidebar and inputs. */
  border: string;
  /** The sidebar (the website's: a surface with a border). */
  sidebar: string;
};
export type ThemeColor = keyof Theme;

export const Colors: { light: Theme; dark: Theme } = {
  light: {
    text: '#16171A',
    background: '#F6F7F9',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#ECEEF2',
    textSecondary: '#5F6470',
    border: '#E2E5EA',
    sidebar: '#FFFFFF',
  },
  dark: {
    text: '#EDEDEF',
    background: '#0B0B0D',
    backgroundElement: '#161619',
    backgroundSelected: '#232328',
    textSecondary: '#A0A1AB',
    border: '#27272D',
    sidebar: '#161619',
  },
};

/** The AI's own colours (violet, blue, cyan), as on the website, so AI features are easy to spot. */
export const AiColors = {
  violet: '#8B5CF6',
  blue: '#3B82F6',
  cyan: '#22D3EE',
} as const;

export const Accent = '#208AEF';
export const Danger = '#D93025';
export const Success = '#1E8E3E';

export const ToneColors = {
  error: { light: '#FDECEC', dark: '#3B1A1A', text: '#D93025' },
  success: { light: '#E7F6EC', dark: '#16301F', text: '#1E8E3E' },
  info: { light: '#E8F1FE', dark: '#17263A', text: Accent },
  warning: { light: '#FEF7E0', dark: '#3A2F12', text: '#B06000' },
} as const;
export type Tone = keyof typeof ToneColors;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
/** Grids and two-column pages (the website's WideContentWidth). */
export const WideContentWidth = 1120;

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

export function useTheme(): Theme {
  return Colors[useIsDark() ? 'dark' : 'light'];
}
