/** Only presentation preferences belong here. Health data and tokens never do. */
export const PREFERENCE_COOKIE = 'buildnorth_display';
export type DisplayPreference = 'comfortable' | 'compact';

export function readDisplayPreference(cookies: string): DisplayPreference | null {
  const value = cookies.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${PREFERENCE_COOKIE}=`))?.split('=')[1];
  return value === 'comfortable' || value === 'compact' ? value : null;
}

export function displayCookie(value: DisplayPreference | null, secure: boolean): string {
  return `${PREFERENCE_COOKIE}=${value ?? ''}; Path=/; Max-Age=${value ? 60 * 60 * 24 * 30 : 0}; SameSite=Lax${secure ? '; Secure' : ''}`;
}
