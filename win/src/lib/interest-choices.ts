// The user's own choices about their Rhythm interests: building the full lists for one change, and the short labels
// shown beside each interest. The website's mobile/src/lib/interest-choices.ts, without the "You've watched…" prompt
// (the website no longer shows it).
import {
  topicLabel,
  type InterestChoices,
  type LearnedInterest,
  type LearnedView,
  type Level,
  type RhythmResult,
  type Topic,
} from './rhythm';

export { topicLabel };

/** Rhythm's fixed topics, in the order the backend lists them. */
export const TOPICS: readonly Topic[] = [
  'boxing',
  'karate',
  'gym',
  'home exercise',
  'food',
];
export const LEVELS: readonly Level[] = [
  'beginner',
  'intermediate',
  'advanced',
];
/** Video lengths offered as chips, in minutes. */
export const LENGTHS: readonly number[] = [10, 20, 30, 45, 60];
export const EQUIPMENT: readonly string[] = [
  'No equipment',
  'Dumbbells',
  'Resistance bands',
  'Heavy bag',
  'Gym access',
];
/** The backend's limits on a saved equipment list. */
const MAX_EQUIPMENT = 16;
const MAX_TEXT = 80;

/** One thing the user did. Pinning or blocking a topic also marks it as decided (acknowledged). */
export type ChoiceChange =
  | { kind: 'pin'; topic: Topic }
  | { kind: 'unpin'; topic: Topic }
  | { kind: 'block'; topic: Topic }
  | { kind: 'unblock'; topic: Topic }
  /** Quick picks: pin several topics at once, and optionally a level. */
  | { kind: 'start'; topics: Topic[]; level: Level | null }
  /** null: switch back to "learn it". */
  | { kind: 'level'; value: Level | null }
  | { kind: 'minutes'; value: number | null }
  | { kind: 'equipment'; value: string[] | null };

export const NO_CHOICES: InterestChoices = {
  pinned: [],
  blocked: [],
  acknowledged: [],
  experienceLevel: null,
  preferredDurationMinutes: null,
  availableEquipment: null,
};

/** `GET /rhythm/learned` for a query. No profile yet is not an error: the page offers quick picks. */
export async function fetchLearned(api: {
  learned: () => Promise<RhythmResult>;
}): Promise<RhythmResult> {
  const result = await api.learned();
  if (result.status !== 'ok' && result.status !== 'profile_required')
    throw new Error(result.message);
  return result;
}

/** The view in a `/rhythm/learned` or choice-save result. `GET /rhythm/interests` puts a different summary there. */
export function learnedOf(
  result: RhythmResult | undefined | null,
): LearnedView | null {
  const learned = result?.learned as Partial<LearnedView> | undefined;
  return learned && Array.isArray(learned.interests) && learned.choices
    ? (learned as LearnedView)
    : null;
}

/** The saved choices, as the full set `PUT /rhythm/choices` expects. */
export function choicesOf(
  view: LearnedView | null | undefined,
): InterestChoices {
  const c = view?.choices;
  if (!c) return { ...NO_CHOICES };
  return {
    pinned: [...(c.pinned ?? [])],
    blocked: [...(c.blocked ?? [])],
    acknowledged: [...(c.acknowledged ?? [])],
    experienceLevel: c.experience_level ?? null,
    preferredDurationMinutes: c.preferred_duration_minutes ?? null,
    availableEquipment: c.available_equipment
      ? [...c.available_equipment]
      : null,
  };
}

const without = (list: Topic[], topic: Topic) => list.filter(t => t !== topic);
const withTopic = (list: Topic[], topic: Topic) =>
  list.includes(topic) ? list : [...list, topic];

/**
 * The full choices after one change. Every list is sent whole (the server replaces each one), and a
 * topic is never both pinned and blocked.
 */
export function applyChange(
  choices: InterestChoices,
  change: ChoiceChange,
): InterestChoices {
  const next: InterestChoices = {
    ...choices,
    pinned: [...choices.pinned],
    blocked: [...choices.blocked],
    acknowledged: [...choices.acknowledged],
    availableEquipment: choices.availableEquipment
      ? [...choices.availableEquipment]
      : null,
  };
  switch (change.kind) {
    case 'pin':
      next.pinned = withTopic(next.pinned, change.topic);
      next.blocked = without(next.blocked, change.topic);
      next.acknowledged = withTopic(next.acknowledged, change.topic);
      break;
    case 'unpin':
      next.pinned = without(next.pinned, change.topic);
      break;
    case 'block':
      next.blocked = withTopic(next.blocked, change.topic);
      next.pinned = without(next.pinned, change.topic);
      next.acknowledged = withTopic(next.acknowledged, change.topic);
      break;
    case 'unblock':
      next.blocked = without(next.blocked, change.topic);
      break;
    case 'start':
      for (const topic of change.topics) {
        next.pinned = withTopic(next.pinned, topic);
        next.blocked = without(next.blocked, topic);
        next.acknowledged = withTopic(next.acknowledged, topic);
      }
      if (change.level) next.experienceLevel = change.level;
      break;
    case 'level':
      next.experienceLevel = change.value;
      break;
    case 'minutes':
      next.preferredDurationMinutes = change.value;
      break;
    case 'equipment':
      next.availableEquipment =
        change.value === null ? null : cleanEquipment(change.value);
      break;
  }
  return next;
}

/** Whether the choices already include this change, e.g. after another screen made the same one. */
export function isApplied(
  choices: InterestChoices,
  change: ChoiceChange,
): boolean {
  return sameChoices(applyChange(choices, change), choices);
}

export function sameChoices(a: InterestChoices, b: InterestChoices): boolean {
  const sameList = <T>(x: readonly T[] | null, y: readonly T[] | null) =>
    x === y ||
    (!!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]));
  return (
    sameList(a.pinned, b.pinned) &&
    sameList(a.blocked, b.blocked) &&
    sameList(a.acknowledged, b.acknowledged) &&
    a.experienceLevel === b.experienceLevel &&
    a.preferredDurationMinutes === b.preferredDurationMinutes &&
    sameList(a.availableEquipment, b.availableEquipment)
  );
}

/** Trimmed, without blanks or repeats (ignoring case), and within the server's limits. */
export function cleanEquipment(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, MAX_EQUIPMENT);
}

export function levelLabel(level: string): string {
  return topicLabel(level);
}

const STATE_ORDER: Record<LearnedInterest['state'], number> = {
  pinned: 0,
  learned: 1,
  noticed: 2,
  blocked: 3,
};

/** The user's own picks first, then what was learned, then what was only noticed, then what they turned down. */
export function sortInterests(
  interests: readonly LearnedInterest[],
): LearnedInterest[] {
  return [...interests].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic),
  );
}

/** Topics not listed yet, which the user can add. */
export function addableTopics(interests: readonly LearnedInterest[]): Topic[] {
  const listed = new Set(interests.map(i => i.topic));
  return TOPICS.filter(t => !listed.has(t));
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Why Rhythm thinks so, from the evidence counts: "5 videos · 2 chats". Empty without evidence. */
export function evidenceText(
  interest: Pick<
    LearnedInterest,
    'videos' | 'saved' | 'chats' | 'feedback' | 'notInterested'
  >,
): string {
  const parts: string[] = [];
  if (interest.videos > 0) parts.push(plural(interest.videos, 'video'));
  if (interest.saved > 0) parts.push(`${interest.saved} saved`);
  if (interest.chats > 0) parts.push(plural(interest.chats, 'chat'));
  if (interest.feedback > 0)
    parts.push(plural(interest.feedback, 'kept recommendation'));
  if (interest.notInterested > 0)
    parts.push(`${interest.notInterested} not interested`);
  return parts.join(' · ');
}

export function hasEvidence(
  interest: Pick<
    LearnedInterest,
    'videos' | 'saved' | 'chats' | 'feedback' | 'notInterested'
  >,
): boolean {
  return (
    interest.videos +
      interest.saved +
      interest.chats +
      interest.feedback +
      interest.notInterested >
    0
  );
}

/** The short label and the one line under each interest. */
export function describeInterest(interest: LearnedInterest): {
  label: string;
  why: string;
} {
  const why = evidenceText(interest);
  switch (interest.state) {
    case 'pinned':
      return { label: 'You chose it', why };
    case 'learned':
      // Without evidence it's left over from settings saved before learning (or with learning off).
      return why
        ? { label: 'Learned', why }
        : { label: 'In use', why: 'From your saved interests' };
    case 'noticed':
      return {
        label: 'Noticed',
        why: why ? `${why} · not enough yet` : 'Not enough to go on yet',
      };
    case 'blocked':
      return { label: 'You said not interested', why: '' };
  }
}

/** The topics in use, the user's own first, for a compact summary. */
export function topicsInUse(
  view: LearnedView | null | undefined,
): { topic: Topic; pinned: boolean }[] {
  return sortInterests(
    (view?.interests ?? []).filter(
      i => i.state === 'pinned' || i.state === 'learned',
    ),
  ).map(i => ({ topic: i.topic, pinned: i.state === 'pinned' }));
}

/** Nothing learned or chosen yet: offer quick picks instead of an empty list. */
export function isBlank(view: LearnedView | null | undefined): boolean {
  return !view || view.interests.length === 0;
}

/** Who decided a level, length or equipment value. */
export function sourceText(
  source: 'you' | 'learned' | null,
  hasValue: boolean,
  learning: boolean,
): string {
  if (source === 'you') return 'You set it';
  if (source === 'learned') return 'Rhythm learned it';
  if (hasValue) return 'From your earlier settings';
  return learning ? 'Rhythm will learn it' : 'Not set';
}

export function minutesLabel(minutes: number | null): string {
  return minutes ? `${minutes} min` : 'Any length';
}
