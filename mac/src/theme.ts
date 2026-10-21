import { useColorScheme } from 'react-native';

// Same design tokens as the BuildNorth iPhone app
// (src/constants/theme.ts and src/components/form.tsx in the Expo project).

export type Theme = {
  text: string;
  background: string;
  backgroundElement: string;
  backgroundSelected: string;
  textSecondary: string;
  /** Mac only: the source-list sidebar. */
  sidebar: string;
};
export type ThemeColor = keyof Theme;

export const Colors: { light: Theme; dark: Theme } = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    sidebar: '#F7F7F9',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    sidebar: '#111113',
  },
};

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

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

export function useTheme(): Theme {
  return Colors[useIsDark() ? 'dark' : 'light'];
}
