import { addDays, localDate } from '../lib/dates';

export type DemoCalendarEntry = {
  id: string;
  kind: 'meal' | 'activity';
  title: string;
  date: string;
  time: string;
  minutes: number | null;
  /** Signed in: entries the server derives (finished sessions, done meals, Watch data) can't be edited. */
  readOnly?: boolean;
};

export function demoCalendar(today = localDate()): DemoCalendarEntry[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(today, -offset);
    return [
      {
        id: `demo-${date}-breakfast`,
        kind: 'meal' as const,
        title: offset % 2 ? 'Avocado toast' : 'Greek yogurt & berries',
        date,
        time: '08:15',
        minutes: null,
      },
      {
        id: `demo-${date}-lunch`,
        kind: 'meal' as const,
        title: offset % 2 ? 'Chickpea grain bowl' : 'Chicken caesar wrap',
        date,
        time: '12:30',
        minutes: null,
      },
      {
        id: `demo-${date}-move`,
        kind: 'activity' as const,
        title: offset % 2 ? 'Evening walk' : 'Full body strength',
        date,
        time: '17:40',
        minutes: offset % 2 ? 25 : 32,
      },
      {
        id: `demo-${date}-dinner`,
        kind: 'meal' as const,
        title: 'Red lentil dal',
        date,
        time: '19:15',
        minutes: null,
      },
    ];
  }).flat();
}
