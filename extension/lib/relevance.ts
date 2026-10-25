import vocabulary from '../../mobile/backend/app/rhythm/relevance-rules.json' with { type: 'json' };
import type { Interests, Relevance, VideoMetadata } from '../../mobile/src/lib/rhythm';

export const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const contains = (text: string, phrase: string) => ` ${text} `.includes(` ${normalize(phrase)} `);

/**
 * Learning's local check, the same rule as the server's `kept_video()` in app/rhythm/learn.py: a watched video is
 * kept only if its title, description excerpt or displayed transcript names one of Rhythm's topics and it isn't
 * spectator or out-of-scope (BJJ) content. Returns the matched topics, or null when the video must stay in the browser.
 */
export function keptVideo(raw: string): string[] | null {
  const text = normalize(raw);
  if (!text || [...vocabulary.outOfScope, ...vocabulary.spectator].some((word) => contains(text, word))) return null;
  const topics = Object.entries(vocabulary.topics)
    .filter(([, words]) => words.some((word) => contains(text, word))).map(([topic]) => topic);
  return topics.length ? topics : null;
}

/** Only this local metadata decision runs before a page can be sent to the backend. */
export function screen(profile: Interests, metadata: VideoMetadata): Relevance {
  const text = normalize([metadata.title, metadata.descriptionExcerpt].filter(Boolean).join(' '));
  const limitations: string[] = [];
  for (const [field, label] of Object.entries({ title: 'Title', channelName: 'Channel', descriptionExcerpt: 'Description', durationSeconds: 'Duration' })) {
    if (metadata[field as keyof VideoMetadata] === null) limitations.push(`${label} is unavailable.`);
  }
  if (profile.preferredLanguages.length) limitations.push('Spoken language is not established by page metadata.');
  const result = (status: Relevance['status'], reason: string): Relevance =>
    ({ status, reasons: [reason], matchingPreferences: [], limitations, score: 0 });
  if (!text) return result('uncertain', 'There is not enough visible metadata.');
  if (vocabulary.outOfScope.some((word) => contains(text, word))) return result('irrelevant', "This topic is outside Rhythm's selected activities.");
  for (const excluded of [...profile.excludedTopics, ...profile.excludedContentTypes]) {
    const words = (vocabulary.exclusions as Record<string, string[]>)[normalize(excluded)] ?? [excluded];
    if (words.some((word) => contains(text, word))) return result('irrelevant', `Excluded by you: ${excluded}.`);
  }
  if (vocabulary.spectator.some((word) => contains(text, word))) {
    return result('irrelevant', 'This is spectator content, not technique practice, a workout or a recipe.');
  }
  const topics = profile.topics.filter((topic) =>
    ((vocabulary.topics as Record<string, string[]>)[topic] ?? []).some((word) => contains(text, word)));
  const purposes = profile.purposes.filter((purpose) =>
    ((vocabulary.purposes as Record<string, string[]>)[purpose] ?? []).some((word) => contains(text, word)));
  if (!topics.length || !purposes.length) {
    const other = Object.entries(vocabulary.topics).some(([key, words]) =>
      !profile.topics.includes(key) && words.some((word) => contains(text, word)));
    return result(other && !topics.length ? 'irrelevant' : 'uncertain',
      'The metadata does not establish both a selected interest and your intended activity.');
  }
  const equipment = profile.availableEquipment.map(normalize);
  for (const [name, words] of Object.entries(vocabulary.equipment)) {
    const required = words.some((word) => contains(text, word) && !['no', 'without'].some((neg) => contains(text, `${neg} ${word}`)));
    if (required && equipment.length && !equipment.includes(name) && !equipment.includes('gym access')) {
      return result('irrelevant', `Mentions equipment you did not select: ${name}.`);
    }
  }
  const duration = metadata.durationSeconds;
  const preferred = profile.preferredDurationMinutes;
  if (profile.strictDuration && (duration === null || duration > (preferred ?? 0) * 60)) {
    return result(duration === null ? 'uncertain' : 'irrelevant',
      duration === null ? 'The strict duration limit cannot be verified.' : 'Exceeds your strict duration limit.');
  }
  const reasons = [...topics.map((v) => `Matches your interest: ${v}.`), ...purposes.map((v) => `Matches your purpose: ${v}.`)];
  const matchingPreferences = [...topics, ...purposes];
  let score = matchingPreferences.length * 10;
  if (profile.experienceLevel && contains(text, profile.experienceLevel)) {
    reasons.push(`Described as ${profile.experienceLevel}.`); matchingPreferences.push(profile.experienceLevel); score += 3;
  } else limitations.push('Experience level needs review.');
  if (duration !== null && preferred) {
    if (duration <= preferred * 60) { reasons.push('Within your preferred duration.'); score += 2; }
    else limitations.push('Longer than your preferred duration (a preference, not a strict limit).');
  }
  if (equipment.includes('no equipment') && ['no equipment', 'without equipment', 'bodyweight'].some((word) => contains(text, word))) {
    reasons.push('Described as requiring no equipment.'); score += 3;
  } else limitations.push('Equipment requirements may be incomplete.');
  return { status: 'relevant', reasons, matchingPreferences, limitations, score };
}
