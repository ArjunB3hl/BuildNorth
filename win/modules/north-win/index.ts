import { TurboModuleRegistry, type TurboModule } from 'react-native';

// JS side of NorthWin, a small C++ module in the Windows app project
// (windows/NorthAssistant/NorthWin.h). It does for Windows what the Mac app's NorthMac Swift
// module and expo-sqlite do on macOS. It only exists in the Windows app, so everything here is
// optional: in Jest it reports `available: false`.

interface Spec extends TurboModule {
  getConstants(): {
    deviceName: string;
    windowsVersion: string;
    dataFile: string;
  };
  readState(): string | null;
  writeState(json: string): void;
  setKeepAwake(enabled: boolean): void;
  setBadge(count: number): void;
}

const native = TurboModuleRegistry.get<Spec>('NorthWin');

export const available = native != null;

const constants = native?.getConstants();

/** This PC's name; null where the module isn't built in. */
export const deviceName: string | null = constants?.deviceName || null;

/** e.g. "Windows 11, version 25H2 (build 26300.1234)"; null where the module isn't built in. */
export const windowsVersion: string | null =
  constants?.windowsVersion || null;

/** Where the store is saved; null where the module isn't built in. */
export const dataFile: string | null = constants?.dataFile || null;

const guard = <T>(name: string, call: () => T, fallback: T): T => {
  try {
    return call();
  } catch (error) {
    console.warn(`NorthWin.${name} failed`, error);
    return fallback;
  }
};

/** The saved store as JSON, or null when nothing is saved yet. */
export function readState(): string | null {
  return native ? guard('readState', () => native.readState(), null) : null;
}

/** Replaces the saved store. */
export function writeState(json: string): void {
  if (native) {
    guard('writeState', () => native.writeState(json), undefined);
  }
}

/** Shows `count` on the app's taskbar button; 0 clears it. */
export function setBadge(count: number): void {
  if (native) {
    guard('setBadge', () => native.setBadge(count), undefined);
  }
}

/** Keeps the display awake until called again with `false`. */
export function setKeepAwake(enabled: boolean): void {
  if (native) {
    guard('setKeepAwake', () => native.setKeepAwake(enabled), undefined);
  }
}
