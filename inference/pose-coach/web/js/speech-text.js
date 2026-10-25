// How a cue is cut for speech synthesis (server/kokoro_worker.py has the same rule in Python): by sentence, so the first
// sentence plays while the next is made. A sentence ends at . ! or ? (and a closing quote or bracket) followed by the
// end, or by a space and anything but a lowercase letter: so not inside a number ("1.5" would be read "one. five") or
// after an abbreviation that goes on in lowercase ("e.g. like"). A piece with no letter or digit ("...") has nothing to
// say and is dropped. A short first sentence ("Nice work.") goes with the next one, since Kokoro is weak on very short
// utterances; then the first chunk ends at its first comma, semicolon or colon when that leaves at least 12 characters
// on each side, so the first sound comes sooner (measured on an M3: the first sentence's median 527 -> 476 ms, 90th
// percentile 1210 -> 874 ms).
export const SHORT_FIRST = 25;
export const MIN_CLAUSE = 12;
const SENTENCE = /[\s\S]+?(?:[.!?]+["')\]]*(?=\s+[^a-z\s]|\s*$)|$)/g;

/** The cue's chunks for synthesis, in order. */
export function sentences(text) {
  const parts = (String(text).match(SENTENCE) ?? []).map(s => s.trim()).filter(s => /[\p{L}\p{N}]/u.test(s));
  if (parts.length > 1 && parts[0].length < SHORT_FIRST) parts.splice(0, 2, `${parts[0]} ${parts[1]}`);
  const m = parts.length ? /[,;:]\s/.exec(parts[0]) : null;
  if (m && m.index >= MIN_CLAUSE && parts[0].length - (m.index + m[0].length) >= MIN_CLAUSE) {
    parts.splice(0, 1, parts[0].slice(0, m.index + 1).trim(), parts[0].slice(m.index + m[0].length).trim());
  }
  return parts;
}
