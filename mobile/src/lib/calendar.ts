import { addDays, localDate, weekStart } from './dates';

export const calendarTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export function monthDays(day: string): string[] {
  const first = `${day.slice(0, 7)}-01`;
  return Array.from({ length: 42 }, (_, i) => addDays(weekStart(first), i));
}
export function changeMonth(day: string, amount: number): string {
  const [y, m] = day.split('-').map(Number);
  return localDate(new Date(y, m - 1 + amount, 1));
}
export function dateAtNoon(day: string): Date {
  return new Date(`${day}T12:00:00`);
}
export function clockLabel(value: string): string {
  const [h, m] = value.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
/** Reject normalized invalid dates and skipped DST hours rather than silently changing the log. */
export function entryInstant(day: string, clock: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
    throw new Error('Use YYYY-MM-DD for the date and HH:mm (24-hour) for the time.');
  }
  const value = new Date(`${day}T${clock}:00`);
  if (
    !Number.isFinite(value.getTime()) ||
    localDate(value) !== day ||
    value.getHours() !== Number(clock.slice(0, 2)) ||
    value.getMinutes() !== Number(clock.slice(3))
  ) {
    throw new Error('That date or local time does not exist. Please choose another.');
  }
  if (value.getTime() > Date.now() + 5 * 60_000)
    throw new Error('Choose a time in the past for a completed meal or workout.');
  return value.toISOString();
}
