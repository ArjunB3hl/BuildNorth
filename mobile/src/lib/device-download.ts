export type DownloadDevice = 'windows' | 'mac' | 'android' | 'iphone' | 'other';
export const deviceNames: Record<DownloadDevice, string> = { windows: 'Windows', mac: 'Mac', android: 'Android', iphone: 'iPhone / iPad', other: 'your device' };
/** A hint only: iPad desktop mode reports Mac, and UA data isn't available in every browser. */
export function detectDevice(ua = '', platform = '', touchPoints = 0): DownloadDevice {
  if (/android/i.test(ua + platform)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(platform + ua) && touchPoints > 1)) return 'iphone';
  if (/windows|win32|win64/i.test(ua + platform)) return 'windows';
  if (/mac/i.test(ua + platform)) return 'mac';
  return 'other';
}
export function downloadUrl(value?: string): string | null {
  try { const u = new URL(value || ''); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; }
  catch { return null; }
}
export const buildUrls: Partial<Record<DownloadDevice, string | undefined>> = {
  windows: process.env.EXPO_PUBLIC_DOWNLOAD_WINDOWS_URL,
  mac: process.env.EXPO_PUBLIC_DOWNLOAD_MAC_URL,
  android: process.env.EXPO_PUBLIC_DOWNLOAD_ANDROID_URL,
  iphone: process.env.EXPO_PUBLIC_DOWNLOAD_IPHONE_URL,
};
