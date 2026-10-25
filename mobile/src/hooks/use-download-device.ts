import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { detectDevice, type DownloadDevice } from '@/lib/device-download';

const subscribe = () => () => {};
const serverDevice = (): DownloadDevice => 'other';
const browserDevice = (): DownloadDevice => {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectDevice(nav.userAgent, nav.userAgentData?.platform || nav.platform, nav.maxTouchPoints);
};
export function useDownloadDevice() { return useSyncExternalStore(subscribe, browserDevice, serverDevice); }
