// Run: node --experimental-strip-types --test src/lib/*.test.mjs   (Node 22.6+; the flag is the default from 23.6)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NO_CHOICES, addableTopics, applyChange, choicesOf, cleanEquipment, describeInterest, evidenceText, fetchLearned,
  isApplied, isBlank, learnedOf, sortInterests, sourceText, topicsInUse,
} from './interest-choices.ts';

const interest = (topic, state, counts = {}) => ({
  topic, state, score: 1, videos: 0, saved: 0, chats: 0, feedback: 0, notInterested: 0, ...counts,
});

const view = (overrides = {}) => ({
  learning: true, confirmed: true, interests: [],
  experienceLevel: { value: null, source: null }, preferredDurationMinutes: { value: null, source: null },
  availableEquipment: { value: [], source: null }, avoid: [],
  choices: {
    pinned: ['boxing'], blocked: ['food'], acknowledged: ['boxing'], experience_level: 'beginner',
    preferred_duration_minutes: 20, available_equipment: ['Dumbbells'],
  },
  suggestion: null, counts: {}, learnedAt: null, deferred: false,
  ...overrides,
});

test('choicesOf: the saved snake_case choices become the full camelCase set', () => {
  assert.deepEqual(choicesOf(view()), {
    pinned: ['boxing'], blocked: ['food'], acknowledged: ['boxing'], experienceLevel: 'beginner',
    preferredDurationMinutes: 20, availableEquipment: ['Dumbbells'],
  });
  assert.deepEqual(choicesOf(null), NO_CHOICES);
  assert.notEqual(choicesOf(null), NO_CHOICES, 'a fresh copy, so callers can change it');
});

test('learnedOf: only a LearnedView counts; the interests endpoint puts a different summary there', () => {
  assert.equal(learnedOf({ learned: view() }).learning, true);
  assert.equal(learnedOf({ learned: { learning: false, pinned: [], blocked: [], why: {} } }), null);
  assert.equal(learnedOf({ status: 'profile_required' }), null);
  assert.equal(learnedOf(undefined), null);
});

test('applyChange: every list is sent whole, and the other choices are kept', () => {
  const next = applyChange(choicesOf(view()), { kind: 'pin', topic: 'gym' });
  assert.deepEqual(next, {
    pinned: ['boxing', 'gym'], blocked: ['food'], acknowledged: ['boxing', 'gym'], experienceLevel: 'beginner',
    preferredDurationMinutes: 20, availableEquipment: ['Dumbbells'],
  });
});

test('applyChange: pinning a blocked topic unblocks it, and blocking a pinned one unpins it', () => {
  const pinned = applyChange(choicesOf(view()), { kind: 'pin', topic: 'food' });
  assert.deepEqual(pinned.pinned, ['boxing', 'food']);
  assert.deepEqual(pinned.blocked, []);
  const blocked = applyChange(choicesOf(view()), { kind: 'block', topic: 'boxing' });
  assert.deepEqual(blocked.pinned, []);
  assert.deepEqual(blocked.blocked, ['food', 'boxing']);
  for (const c of [pinned, blocked]) assert.ok(!c.pinned.some((t) => c.blocked.includes(t)));
});

test('applyChange: pin and block answer the prompt; unpin and undo leave it answered', () => {
  assert.deepEqual(applyChange(NO_CHOICES, { kind: 'block', topic: 'gym' }).acknowledged, ['gym']);
  const unpinned = applyChange(choicesOf(view()), { kind: 'unpin', topic: 'boxing' });
  assert.deepEqual(unpinned.pinned, []);
  assert.deepEqual(unpinned.acknowledged, ['boxing']);
  const undone = applyChange(choicesOf(view()), { kind: 'unblock', topic: 'food' });
  assert.deepEqual(undone.blocked, []);
  assert.deepEqual(undone.pinned, ['boxing']);
});

test('applyChange: quick picks pin each topic once and set a level only when one was picked', () => {
  const start = applyChange(choicesOf(view()), { kind: 'start', topics: ['boxing', 'food', 'gym'], level: null });
  assert.deepEqual(start.pinned, ['boxing', 'food', 'gym']);
  assert.deepEqual(start.blocked, []);
  assert.deepEqual(start.acknowledged, ['boxing', 'food', 'gym']);
  assert.equal(start.experienceLevel, 'beginner');
  assert.equal(applyChange(NO_CHOICES, { kind: 'start', topics: ['karate'], level: 'advanced' }).experienceLevel, 'advanced');
});

test('applyChange: null switches a value back to "learn it"', () => {
  const c = choicesOf(view());
  assert.equal(applyChange(c, { kind: 'level', value: null }).experienceLevel, null);
  assert.equal(applyChange(c, { kind: 'minutes', value: null }).preferredDurationMinutes, null);
  assert.equal(applyChange(c, { kind: 'equipment', value: null }).availableEquipment, null);
  assert.equal(applyChange(c, { kind: 'minutes', value: 45 }).preferredDurationMinutes, 45);
  assert.deepEqual(applyChange(c, { kind: 'equipment', value: [] }).availableEquipment, [], 'an empty list is a choice too');
});

test('applyChange: the input is never changed', () => {
  const c = choicesOf(view());
  const before = structuredClone(c);
  applyChange(c, { kind: 'pin', topic: 'karate' });
  applyChange(c, { kind: 'equipment', value: ['Heavy bag'] });
  assert.deepEqual(c, before);
});

test('isApplied: a change another screen already made needs no second save', () => {
  const c = choicesOf(view());
  assert.equal(isApplied(c, { kind: 'pin', topic: 'gym' }), false);
  assert.equal(isApplied(c, { kind: 'unpin', topic: 'gym' }), true);
  assert.equal(isApplied(c, { kind: 'level', value: 'beginner' }), true);
  assert.equal(isApplied(c, { kind: 'equipment', value: [' dumbbells '] }), false, 'case is kept as typed');
  assert.equal(isApplied(c, { kind: 'equipment', value: ['Dumbbells'] }), true);
});

test('cleanEquipment: trims, drops blanks and repeats, and keeps to the server limits', () => {
  assert.deepEqual(cleanEquipment(['  Heavy   bag ', '', 'heavy bag', 'Dumbbells']), ['Heavy bag', 'Dumbbells']);
  assert.equal(cleanEquipment(Array.from({ length: 20 }, (_, i) => `Item ${i}`)).length, 16);
  assert.equal(cleanEquipment(['x'.repeat(100)])[0].length, 80);
});

test('evidenceText: short counts, plural where needed, empty without evidence', () => {
  assert.equal(evidenceText(interest('boxing', 'learned', { videos: 5, chats: 2 })), '5 videos · 2 chats');
  assert.equal(evidenceText(interest('gym', 'learned', { videos: 1, saved: 1, chats: 1, feedback: 1 })),
    '1 video · 1 saved · 1 chat · 1 kept recommendation');
  assert.equal(evidenceText(interest('food', 'noticed')), '');
});

test('describeInterest: each state says who decided', () => {
  assert.deepEqual(describeInterest(interest('boxing', 'pinned')), { label: 'You chose it', why: '' });
  assert.deepEqual(describeInterest(interest('gym', 'learned', { videos: 3 })), { label: 'Learned', why: '3 videos' });
  assert.deepEqual(describeInterest(interest('gym', 'learned')), { label: 'In use', why: 'From your saved interests' });
  assert.equal(describeInterest(interest('food', 'noticed', { chats: 1 })).why, '1 chat · not enough yet');
  assert.deepEqual(describeInterest(interest('karate', 'blocked', { videos: 2 })), { label: 'You said not interested', why: '' });
});

test('sortInterests and addableTopics: your picks first; only unlisted topics can be added', () => {
  const list = [interest('food', 'blocked'), interest('gym', 'noticed'), interest('karate', 'learned'), interest('boxing', 'pinned')];
  assert.deepEqual(sortInterests(list).map((i) => i.topic), ['boxing', 'karate', 'gym', 'food']);
  assert.deepEqual(addableTopics(list), ['home exercise']);
  assert.deepEqual(addableTopics([]), ['boxing', 'karate', 'gym', 'home exercise', 'food']);
});

test('isBlank: quick picks only when nothing was learned, chosen or suggested', () => {
  assert.equal(isBlank(null), true);
  assert.equal(isBlank(view()), true);
  assert.equal(isBlank(view({ interests: [interest('gym', 'noticed')] })), false);
  assert.equal(isBlank(view({ suggestion: { topic: 'gym', text: 'Want more gym workouts?' } })), false);
});

test('sourceText: says whether you set it or Rhythm learned it', () => {
  assert.equal(sourceText('you', true, true), 'You set it');
  assert.equal(sourceText('learned', true, true), 'Rhythm learned it');
  assert.equal(sourceText(null, true, false), 'From your earlier settings');
  assert.equal(sourceText(null, false, true), 'Rhythm will learn it');
  assert.equal(sourceText(null, false, false), 'Not set');
});

test('topicsInUse: pinned and learned topics only, your own first', () => {
  const v = view({ interests: [interest('gym', 'learned'), interest('food', 'noticed'), interest('karate', 'blocked'), interest('boxing', 'pinned')] });
  assert.deepEqual(topicsInUse(v), [{ topic: 'boxing', pinned: true }, { topic: 'gym', pinned: false }]);
  assert.deepEqual(topicsInUse(null), []);
});

test('fetchLearned: no profile yet is a result, any other status an error', async () => {
  const api = (result) => ({ learned: async () => result });
  assert.equal((await fetchLearned(api({ status: 'profile_required', message: '' }))).status, 'profile_required');
  assert.equal((await fetchLearned(api({ status: 'ok', learned: view() }))).status, 'ok');
  await assert.rejects(fetchLearned(api({ status: 'permission_required', message: 'No.' })), /No\./);
});
