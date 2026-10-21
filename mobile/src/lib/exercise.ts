import { formatDuration } from '@/lib/dates';
import type { Exercise } from '@/lib/types';

export function describeExercise(e: Exercise): string {
  const parts: string[] = [];
  if (e.sets && e.reps) parts.push(`${e.sets} × ${e.reps} reps`);
  else if (e.reps) parts.push(`${e.reps} reps`);
  else if (e.sets) parts.push(`${e.sets} sets`);
  if (e.durationSeconds) parts.push(`${e.sets && !e.reps ? `${e.sets} × ` : ''}${formatDuration(e.durationSeconds)}`);
  if (e.weight) parts.push(`${e.weight} ${e.weightUnit ?? 'kg'}`);
  if (e.restSeconds) parts.push(`rest ${formatDuration(e.restSeconds)}`);
  return parts.join(' · ') || 'No targets set';
}
