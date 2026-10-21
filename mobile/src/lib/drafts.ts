// Hands an unsaved draft (e.g. an AI-extracted recipe) from one screen to the editor.
// Drafts live only in memory until the user saves them; nothing is persisted here.

import type { RecipeDraft, RoutineInput } from '@/lib/types';

export type RecipeDraftHandoff = {
  draft: RecipeDraft;
  warnings: string[];
  source: 'pasted' | 'coach' | 'manual';
  notes?: string | null;
};

export type RoutineDraftHandoff = { draft: RoutineInput; warnings: string[] };

const drafts = new Map<string, unknown>();

export function putDraft<T>(value: T): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  drafts.set(id, value);
  return id;
}

export function getDraft<T>(id: string | undefined): T | undefined {
  return id ? (drafts.get(id) as T | undefined) : undefined;
}

export function dropDraft(id: string | undefined) {
  if (id) drafts.delete(id);
}

export function formatQuantity(quantity: number | null | undefined): string {
  if (quantity == null) return '';
  const rounded = Math.round(quantity * 100) / 100;
  const whole = Math.floor(rounded);
  const fraction = Math.round((rounded - whole) * 100) / 100;
  const glyph = { 0.25: '¼', 0.33: '⅓', 0.5: '½', 0.67: '⅔', 0.75: '¾' }[fraction];
  if (glyph) return whole ? `${whole}${glyph}` : glyph;
  return String(rounded);
}

export function formatAmount(quantity: number | null | undefined, unit: string | null | undefined): string {
  return [formatQuantity(quantity), unit ?? ''].filter(Boolean).join(' ');
}
