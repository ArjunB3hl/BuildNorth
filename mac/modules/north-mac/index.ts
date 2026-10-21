import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ColorValue, ViewProps } from 'react-native';

// JS side of the local Expo module in ./ios. It is only built into the macOS app, so
// everything here is optional: on other platforms and in Jest it reports `available: false`.

type NorthMacNative = {
  appDataDirectoryUri: string | null;
  setDockBadge(label: string | null): Promise<void>;
  setKeepAwake(enabled: boolean, reason: string | null): Promise<void>;
};

const native = requireOptionalNativeModule<NorthMacNative>('NorthMac');

export const available = native != null;

/**
 * file:// URL of ~/Library/Application Support/<bundle id>; null where the module isn't built in.
 * A URL rather than a path so expo-sqlite keeps the space in "Application Support".
 */
export const appDataDirectoryUri: string | null =
  native?.appDataDirectoryUri ?? null;

const warn = (name: string) => (error: unknown) =>
  console.warn(`NorthMac.${name} failed`, error);

/** Shows `label` on the app's Dock icon; null clears it. */
export function setDockBadge(label: string | null): void {
  native?.setDockBadge(label).catch(warn('setDockBadge'));
}

/** Keeps the display awake until called again with `false`. */
export function setKeepAwake(enabled: boolean, reason?: string): void {
  native?.setKeepAwake(enabled, reason ?? null).catch(warn('setKeepAwake'));
}

export type SymbolViewProps = ViewProps & {
  /** SF Symbol name, e.g. "sun.max". */
  name: string;
  color?: ColorValue;
  size?: number;
  weight?: 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
};

/** Native SF Symbol view; null where the module isn't built in. */
export const SymbolView: ComponentType<SymbolViewProps> | null = available
  ? requireNativeView<SymbolViewProps>('NorthMac')
  : null;
