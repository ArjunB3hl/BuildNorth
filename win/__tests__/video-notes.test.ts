/**
 * @format
 */

import { notesPreview, notesSize, parseNotes } from '../src/lib/video-notes';

// Rhythm's notes for a saved video, as the server writes them: a kind line, an overview, then headed sections of
// numbered steps or bullets.

const NOTES = [
  'Exercise notes',
  '',
  'A beginner boxing primer covering how to pick and set up your stance, basic footwork in four directions, and the',
  'first three punches (jab, cross, hook), building to a 1-2-hook-2 combination practiced as shadowboxing rounds.',
  '',
  'Stance',
  '1. Right-handed: left foot forward (orthodox).',
  '2) Front foot points about 1 o’clock.',
  '',
  'Footwork',
  '• Forward: step with the front foot first.',
  '- Keep the same distance between your feet.',
  '',
  'Missing details',
  'The transcript stops before the combinations',
  'are explained.',
].join('\n');

test('reads the label, the overview, headings, steps and bullets', () => {
  const { label, blocks } = parseNotes(NOTES);
  expect(label).toBe('Exercise notes');
  expect(blocks).toEqual([
    {
      kind: 'paragraph',
      text: expect.stringMatching(/^A beginner boxing primer .* shadowboxing rounds\.$/),
    },
    { kind: 'heading', text: 'Stance' },
    { kind: 'step', marker: '1.', text: 'Right-handed: left foot forward (orthodox).' },
    { kind: 'step', marker: '2)', text: 'Front foot points about 1 o’clock.' },
    { kind: 'heading', text: 'Footwork' },
    { kind: 'step', marker: '•', text: 'Forward: step with the front foot first.' },
    { kind: 'step', marker: '•', text: 'Keep the same distance between your feet.' },
    { kind: 'heading', text: 'Missing details' },
    // a short line that carries on a sentence isn't a heading
    { kind: 'paragraph', text: 'The transcript stops before the combinations are explained.' },
  ]);
});

test('plain notes with no sections are one paragraph', () => {
  expect(parseNotes('Three rounds: jab, cross, slip.')).toEqual({
    label: null,
    blocks: [{ kind: 'paragraph', text: 'Three rounds: jab, cross, slip.' }],
  });
  expect(parseNotes(null)).toEqual({ label: null, blocks: [] });
  expect(parseNotes('Squat slowly.\r\nThen rest.')).toEqual({
    label: null,
    blocks: [{ kind: 'paragraph', text: 'Squat slowly. Then rest.' }],
  });
});

test('the card’s preview is the overview, cut short at a word', () => {
  const preview = notesPreview(NOTES)!;
  expect(preview.length).toBeLessThanOrEqual(201);
  expect(preview.startsWith('A beginner boxing primer covering how to pick')).toBe(true);
  expect(preview.endsWith('…')).toBe(true);
  expect(preview).not.toMatch(/[\s,]…$/);
  expect(preview).not.toContain('Right-handed');
  // short notes are shown whole
  expect(notesPreview('Three rounds: jab, cross, slip.')).toBe('Three rounds: jab, cross, slip.');
  // notes that start straight away with steps preview their first step
  expect(notesPreview('Warm-up\n1. Skip for three minutes.')).toBe('Skip for three minutes.');
  expect(notesPreview('')).toBeNull();
});

test('the card says how long the notes are', () => {
  expect(notesSize(NOTES)).toBe('3 sections · 4 steps');
  expect(notesSize('Warm-up\n1. Skip.')).toBe('1 section · 1 step');
  expect(notesSize('Three rounds: jab, cross, slip.')).toBeNull();
});
