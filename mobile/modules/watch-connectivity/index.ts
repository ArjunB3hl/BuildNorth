import { NativeModule, requireOptionalNativeModule } from 'expo';

/** The iPhone's WatchConnectivity session, as WCSession reports it. */
export type WatchState = {
  /** This device can pair with an Apple Watch (false on iPad). */
  supported: boolean;
  activated: boolean;
  paired: boolean;
  /** The BuildNorth watch app is installed on the paired watch. */
  watchAppInstalled: boolean;
  /** The watch app is running and reachable right now (not needed to link). */
  reachable: boolean;
};

type WatchEvents = {
  onStateChange(state: WatchState): void;
};

declare class BuildNorthWatchModule extends NativeModule<WatchEvents> {
  getState(): WatchState;
  sendLink(apiUrl: string, token: string): Promise<void>;
  unlink(): Promise<void>;
}

// Null in Expo Go, on Android and web, and in builds made before this module existed.
const native = requireOptionalNativeModule<BuildNorthWatchModule>('BuildNorthWatch');

/** Whether this build includes the native Apple Watch bridge (an iOS development or release build). */
export const available = native !== null;

const UNAVAILABLE: WatchState = { supported: false, activated: false, paired: false, watchAppInstalled: false, reachable: false };

export function getState(): WatchState {
  return native?.getState() ?? UNAVAILABLE;
}

/** Calls `listener` when activation, pairing, the watch app's install state or reachability changes. */
export function addStateListener(listener: (state: WatchState) => void): () => void {
  if (!native) return () => {};
  const subscription = native.addListener('onStateChange', listener);
  return () => subscription.remove();
}

export type WatchErrorCode = 'unavailable' | 'unsupported' | 'inactive' | 'not_paired' | 'app_not_installed' | 'failed';

export class WatchConnectivityError extends Error {
  constructor(
    readonly code: WatchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const NATIVE_CODES: Record<string, WatchErrorCode> = {
  ERR_WATCH_UNSUPPORTED: 'unsupported',
  ERR_WATCH_SESSION_INACTIVE: 'inactive',
  ERR_WATCH_NOT_PAIRED: 'not_paired',
  ERR_WATCH_APP_NOT_INSTALLED: 'app_not_installed',
};

async function call(run: (module: BuildNorthWatchModule) => Promise<void>): Promise<void> {
  if (!native) throw new WatchConnectivityError('unavailable', 'This build has no Apple Watch support.');
  try {
    await run(native);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : String(error);
    throw new WatchConnectivityError((typeof code === 'string' && NATIVE_CODES[code]) || 'failed', message);
  }
}

/**
 * Hands the API address and a watch token to the watch. The latest link replaces any earlier one and
 * arrives even while the watch app is closed. BuildNorth doesn't store the token on the phone, but the system
 * keeps the last application context, token included, until the next link or unlink replaces it.
 */
export function sendLink(apiUrl: string, token: string): Promise<void> {
  return call((module) => module.sendLink(apiUrl, token));
}

/** Tells the watch to forget its token and API address. */
export function unlink(): Promise<void> {
  return call((module) => module.unlink());
}
