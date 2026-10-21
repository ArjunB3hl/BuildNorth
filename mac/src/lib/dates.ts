// Copied from the BuildNorth Expo app (src/lib/dates.ts).
// Calendar dates are the user's local dates (YYYY-MM-DD).

export function localDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function friendlyDate(day: string, today: string = localDate()): string {
  if (day === today) {
    return 'Today';
  }
  if (day === addDays(today, 1)) {
    return 'Tomorrow';
  }
  if (day === addDays(today, -1)) {
    return 'Yesterday';
  }
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  return addDays(day, -weekday);
}

export function weekdayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** friendlyDate for mid-sentence use: "yesterday", but "Fri, Oct 16" stays as is. */
export function friendlyDateInline(
  day: string,
  today: string = localDate(),
): string {
  const label = friendlyDate(day, today);
  return ['Today', 'Tomorrow', 'Yesterday'].includes(label)
    ? label.toLowerCase()
    : label;
}
