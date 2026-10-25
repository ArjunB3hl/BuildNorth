// What the user's words ask of the page itself, when the page listens (web/js/listen.js; Parakeet on this Mac writes
// down what they said): an exercise named, "detect it", or an answer to "Done with this set?". The page applies those
// (as a chip or a button would) and tells the coach what it did, so the coach only confirms; everything else is for the
// coach to answer. Pure: no DOM, so the page and the tests share it.
//
//   intentOf(text, { exercise: true, setEnd: false, current: 'squat', movement: null, movements })
//       // -> {type: 'exercise', exercise: <EXERCISES key>} | {type: 'movement', movement: <library key>}
//       //    | {type: 'auto'} | {type: 'set_end', done} | null
//       // exercise: the page's question "which exercise?" is open (at the start, or Change exercise); setEnd: "Done
//       // with this set?" is open; current: the exercise being counted now (an EXERCISES key), if any; movement: the
//       // library movement named now (its key), if any; movements: movementNames(library), the names it knows
//   movementNames(list)  // the library's movements ({key, synonyms}: /moves/library.json) compiled for intentOf
//   exerciseIn(text)     // the exercise the words name (an EXERCISES key), or null
//   movementIn(text, movements) // the library movement the words name (its key), or null
//   chatter(text)        // nothing but fillers and counting ("um", "seven, eight"): no question for anyone
//   words(text)          // the words, lower case, without punctuation ("Push-ups!" -> ['push', 'ups'])
//   afterEcho(text, cue) // the transcript without the page's own cue heard back in it ('' if it was nothing else)
//
// When does a name count? Only when the words are meant as a choice. With the question open, any mention that is not a
// question ("squats", "I'll start with lunges"). Otherwise only a short switch to another exercise than the one being
// counted, every other word a switching word ("now lunges", "switch to curls", "let's do push-ups", "I'm doing squats",
// "can we do lunges"); never a question ("how was my squat depth?", "lunges next?") nor words about pain ("my knee hurts
// when I squat": the coach must answer that), nor counting ("eight, nine, ten squats", "one more squat": that is the
// set going on). A transcript can have small slips, so the names take the forms people say and Parakeet writes
// (press-ups, star jumps, high knees).
//
// A movement of the library (a stretch, a gym move, a dance: web/js/moves.js tracks it, it is never recognised) is
// named the same way, by the spoken names the library gives it: "I'm doing a quad stretch", "now hip hop". Its name
// wins over an exercise's it contains ("overhead kettlebell squats" is the library's, "squats" the engine's); an
// exercise's own name as long as it stays the exercise; and a movement word just before an exercise's name describes
// it ("half kneeling curls" are curls). Its names are everyday words, so less is taken as naming one: with an exercise
// named too, the exercise is meant unless the words bring the movement in ("I'm going to dance through some squats" is
// about squats); and a longer answer to "which exercise?" names one only with an answer's words around it ("let me
// roll up my sleeves" names nothing).

/** Each exercise's names, most specific first: "squat pulses" before "squats", "jumping jacks" before "jumps". */
export const NAMES = [
  ['squat_pulse', 'squat pulses?|pulse squats?|pulsing squats?|squat pulsing|pulses'],
  ['jumping_jack', 'jumping jacks?|star jumps?|jacks'],
  ['jump', 'jump squats?|squat jumps?|tuck jumps?|vertical jumps?|jumps?|jumping'],
  ['knee_raise', 'knee raises?|knee lifts?|knee ups?|high knees?|knee drives?'],
  ['pushup', 'push ?ups?|press ?ups?'],
  ['lunge', 'walking lunges?|lunges?|lunging'],
  ['front_raise', 'front raises?|forward raises?|front delt raises?'],
  ['lateral_raise', 'lateral raises?|side lateral raises?|side raises?|lat raises?|side delt raises?|laterals'],
  ['triceps_kickback', 'triceps? kick ?backs?|kick ?backs?'],
  ['biceps_curl', 'biceps? curls?|hammer curls?|dumbbell curls?|arm curls?|curls?|curling'],
  ['overhead_press', '(?:overhead|shoulder|military|push|dumbbell) press(?:es)?|presses'],
  // (good mornings, the exercise, only after a word that asks for one: "good morning!" is a greeting, and every coach
  // greets the user at Start)
  ['hinge', 'hip hinges?|hinges?|romanian dead ?lifts?|dead ?lifts?|rdls?|(?<=\\b(?:do|doing|some|of|to|onto|try|now|next|then) )good mornings?'],
  ['squat', 'squats?|squatting'],
].map(([key, re]) => [key, new RegExp(`\\b(?:${re})\\b`, 'g')]);

/** The words, lower case: apostrophes dropped (i'm -> im, let's -> lets), the rest of the punctuation a space. */
export function words(text) {
  return String(text || '').toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// a name just after one of these is not the one meant ("not squats, lunges", "done with squats, now lunges", "I don't
// want squats, let's do lunges", "anything but squats")
const NEGATED = /\b(?:not|no more|no|stop|stopping|enough|instead of|done with|finished with|quit|skip|skipping|hate|anything but|(?:dont|do not) (?:want|like)(?: to)?(?: do)?|rather not(?: do)?)(?: (?:the|my|doing|those|these|with|any|more))?$/;
// a name just after one of these is the one meant, when several are named ("from squats to lunges")
const CHOSEN = /\b(?:to|onto|now|instead)$/;
// An exercise and a movement of the library both named: the movement only if the words bring it in as the one done
// ("I'm doing a quad stretch, then squats", "from squats to hip hop"), else the exercise: the library's names are
// everyday words ("let me roll up my sleeves for some squats", "I'm going to dance through some squats": "to" after a
// verb of going or wanting is the verb's)
const BROUGHT_IN = /\b(?:to|onto|now|instead|do|doing|start with|starting with|begin with)(?: (?:a|an|the|some|my))?$/;
const TO_VERB = /\b(?:going|gonna|want|wanna|wanted|have|need|like|love|try|trying|got|able|used) to(?: (?:a|an|the|some|my))?$/;

const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a name's last word, singular or plural ("quad stretch" finds "quad stretches", "lunges" finds "lunge")
const plural = w => (/[^s]s$/.test(w) ? `${esc(w.slice(0, -1))}(?:s|es)?` : `${esc(w)}(?:s|es)?`);

/**
 * The library's movements' spoken names, for intentOf and movementIn: [[key, RegExp]]. Each movement goes by its
 * `synonyms` and by its key read out ("quad_stretch": "quad stretch"); the words may run together ("push ups",
 * "pushups"), the last one singular or plural.
 */
export function movementNames(list = []) {
  const out = [];
  for (const m of list || []) {
    if (!m?.key) continue;
    const forms = new Set();
    for (const name of [...(m.synonyms || []), m.key.replace(/_/g, ' ')]) {
      const w = words(name);
      if (w.length) forms.add([...w.slice(0, -1).map(esc), plural(w.at(-1))].join(' ?'));
    }
    if (forms.size) out.push([m.key, new RegExp(`\\b(?:${[...forms].join('|')})\\b`, 'g')]);
  }
  return out;
}

const overlaps = (x, y) => x.at < y.end && x.end > y.at;

/** The names in `s` (words joined by spaces), in order: {key, kind: 'exercise'|'movement', at, end, before, negated}.
 * `moves`: movementNames(), the library's. */
function mentions(s, moves = []) {
  let found = [];
  const taken = [];
  for (const [key, re] of NAMES) {
    for (const m of s.matchAll(re)) {
      const at = m.index, end = at + m[0].length;
      if (taken.some(([a, b]) => at < b && end > a)) continue;     // inside a more specific name already found
      taken.push([at, end]);
      found.push({ key, kind: 'exercise', at, end });
    }
  }
  if (moves.length) {
    // the library's names, the longest first; one wins over the exercise names it overlaps only if it is longer
    const named = [];
    for (const [key, re] of moves) for (const m of s.matchAll(re)) named.push({ key, kind: 'movement', at: m.index, end: m.index + m[0].length });
    named.sort((a, b) => b.end - b.at - (a.end - a.at) || a.at - b.at);
    const kept = [];
    for (const m of named) {
      if (kept.some(k => overlaps(k, m))) continue;
      const under = found.filter(f => overlaps(f, m));
      if (under.some(f => f.end - f.at >= m.end - m.at)) continue;
      found = found.filter(f => !under.includes(f));
      kept.push(m);
    }
    // a movement word just before an exercise's name describes the exercise: one name ("half kneeling curls")
    for (const m of kept) {
      const f = found.find(x => x.kind === 'exercise' && x.at === m.end + 1);
      if (f) f.at = m.at; else found.push(m);
    }
  }
  for (const f of found) { f.before = s.slice(0, f.at).trim(); f.negated = NEGATED.test(f.before); }
  return found.sort((a, b) => a.at - b.at);
}

/** The one exercise meant: the only one named and not negated, else the one right after "to" or "now", else the first.
 * With an exercise and a movement of the library named, the movement only if brought in as the one done. */
function pick(found) {
  const live = found.filter(m => !m.negated);
  if (!live.length) return null;
  if (new Set(live.map(m => `${m.kind}:${m.key}`)).size === 1) return live[0];
  const ex = live.filter(m => m.kind === 'exercise');
  if (ex.length && ex.length < live.length) {
    return live.find(m => m.kind === 'movement' && BROUGHT_IN.test(m.before) && !TO_VERB.test(m.before))
      ?? ex.find(m => CHOSEN.test(m.before)) ?? ex[0];
  }
  return live.find(m => CHOSEN.test(m.before)) ?? live[0];
}

export function exerciseIn(text) {
  return pick(mentions(words(text).join(' ')))?.key ?? null;
}

export function movementIn(text, moves = []) {
  const m = pick(mentions(words(text).join(' '), moves));
  return m?.kind === 'movement' ? m.key : null;
}

// --- questions, pain, and the words of a switch ---------------------------------------------------------------------
const QUESTION_START = /^(?:how|hows|what|whats|why|when|where|which|who|whos|whose|is|isnt|are|arent|am|was|wasnt|were|does|doesnt|did|didnt|should|shouldnt|would|wouldnt|have|has|had)\b|^(?:do|dont|can|cant|could|couldnt|will|wont|shall|may) (?:you|i|we|they|my|it|that|this|he|she|these|those)\b/;
// a request in a question's form is still a request ("can we do lunges", "could you count curls now", "can you detect it")
const POLITE = /^(?:can|could|shall|may|will) (?:we|i|you) (?:please )?(?:now )?(?:do|try|switch|change|move|go|start|count|begin|detect|recogni[sz]e)\b/;
const INNER_QUESTION = /\b(?:how|hows|what|whats|why|when|where|which)\b/;
// words about pain or an injury are for the coach to answer, whatever exercise they name
const HURT = /\b(?:hurts?|hurting|pain|painful|sore|injur(?:y|ed|ies)|ache|aches|aching|ouch|twinge|pulled|tweaked|dizzy|cramps?)\b/;

function isQuestion(s) {
  return (QUESTION_START.test(s) && !POLITE.test(s)) || INNER_QUESTION.test(s);
}
// a question by its intonation only: Parakeet ends it with "?" ("Lunges next?", "Squats?"), which words() drops. Not a
// request in a question's form ("Can we do lunges?")
const asksBy = (text, s) => /\?[\s"')\]]*$/.test(String(text)) && !POLITE.test(s);

// every word of a short switch other than the exercise's name ("now", "let's do", "switch to", "I'm doing", "a few",
// "please", fillers): a word outside these means the words are about something else ("I'm doing squats wrong"). No
// numbers nor "more": "eight, nine, ten squats" is counting out loud, and "one more squat" the set going on
const SWITCH = new Set(`now next then ok okay alright all right so um uh er erm hmm and well yeah yes yep sure lets let us
  do doing switch switching change changing move moving on onto to go going gonna im i am ill will we were start
  starting begin time for some a an few couple set sets of please coach counting count try trying back instead
  with up over the can could shall may you done finished from skip`.split(/\s+/));
// ... and the words a switch to a movement of the library may have too ("I'm holding a quad stretch", "boxing in
// place", "going into a half kneel", "a little bit of hip hop")
const MOVE_SWITCH = new Set('hold holding practice practise practicing practising track tracking little bit into in place for go going just'.split(' '));
// The answer to "which exercise?" may be a longer sentence ("I think I'll start with squats today"); for a movement of
// the library, whose names are everyday words, only with words an answer has besides the switch's ("let me roll up my
// sleeves", "I go dancing after this" are not answers)
const MOVE_ANSWER = new Set(`think guess maybe probably first today want wanna like id would love not no right left side
  sides leg legs arm arms both my on`.split(/\s+/));
const SHORT = 10;              // a switch is a few words ("okay so now let's do some lunges please": 9)
const ANSWER = 14;             // an answer to the open question may be a little longer ("I think I'll start with squats today")

// --- "detect it" ----------------------------------------------------------------------------------------------------
// asked for in so many words (also as a short command mid-workout: "detect it", "go back to auto")
const AUTO = /\b(?:(?:you )?figure (?:it|that) out|work it out|detect(?:ing)?|recogni[sz]e|recogni[sz]ing|auto(?:matic(?:ally)?)?|you (?:decide|choose|pick|tell me))\b/g;
// ... or, with "which exercise?" open, not knowing yet
const UNSURE = /\b(?:not sure|(?:i )?(?:dont|do not) know|dunno|no idea|not decided|havent decided|whatever|anything|surprise me|undecided|let me see|well see|ill see)\b/;
// the other words of a short "detect it" command
const AUTO_WORDS = new Set(`it them that this for me the exercise exercises my what im doing mode go back to please just
  you can could now ok okay so then and let lets on use i`.split(/\s+/));

// --- "done with this set?" ------------------------------------------------------------------------------------------
// "no more", "enough": done (before the rest: "no more reps" is not "more reps", nor "no more squats" a "no")
const ENOUGH = /\b(?:no more|(?<!not )enough)\b/g;
const NOT_DONE = /\b(?:not (?:yet|done|finished|quite|over)|keep going|still going|carry on|carrying on|continue|continuing|one more|two more|three more|a few more|a couple more|couple more|few more|more reps|another (?:one|rep|few|set)|hold on|wait|im not done)\b|^more$/g;
const DONE = /\b(?:done|finished|finish|thats it|thats all|that was it|thats the set|that was the set|thats my set|end (?:it|the set|this set))\b/;
const YES = /^(?:yes|yeah|yep|yup|ya|yea|sure|correct|right|affirmative|definitely|absolutely)\b/;
const NO = /^(?:no|nope|nah|negative)\b/;

/** An answer to "Done with this set?": true (done), false (not yet), or null (not an answer, or both at once). */
function setEndAnswer(s, n) {
  if (n > SHORT || isQuestion(s)) return null;
  const enough = s.match(ENOUGH) != null;
  s = s.replace(ENOUGH, ' ');
  const notDone = s.match(NOT_DONE) != null;
  const done = enough || DONE.test(s.replace(NOT_DONE, ' '));
  if (notDone && done) return null;                       // "I'm done, one more": not clear
  if (notDone) return false;
  if (done) return true;
  if (YES.test(s)) return true;
  if (NO.test(s)) return false;
  return null;
}

// counting out loud and fillers: said during a set, to nobody
const CHATTER = new Set(`um uh er erm hmm hm mm mmm mhm ah oh huh uh-huh ha phew whew wow ok okay and one two three four
  five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty last
  more go come on`.split(/\s+/));

export function chatter(text) {
  const w = words(text);
  return w.every(x => CHATTER.has(x) || /^\d+$/.test(x));
}

export function intentOf(text, { exercise: asking = false, setEnd = false, current = null, movement = null, movements = [] } = {}) {
  const w = words(text);
  if (!w.length) return null;
  const s = w.join(' ');
  if (HURT.test(s)) return null;
  const question = isQuestion(s), asks = asksBy(text, s);
  const found = mentions(s, movements), named = pick(found);
  // an exercise: as the answer to "which exercise?" ("Biceps curls?" too), or a short switch to another exercise at any
  // time (a switch also ends the set the question may be about, so it comes first: "done, now lunges"). The exercise
  // being counted named again is no switch: "squats" in a set of squats, or "two more squats" answering the question.
  // A movement of the library likewise (the one named now, named again, is no switch)
  if (named && !question) {
    let at = 0;
    const rest = w.filter(x => { const i = at; at += x.length + 1; return !found.some(m => i >= m.at && i < m.end); });
    const move = named.kind === 'movement';
    const same = move ? named.key === movement : named.key === current;
    const switchWord = x => SWITCH.has(x) || (move && MOVE_SWITCH.has(x));
    const switchy = !asks && !same && w.length <= SHORT && rest.every(switchWord);
    const answer = asking && w.length <= ANSWER && (!move || rest.every(x => switchWord(x) || MOVE_ANSWER.has(x)));
    if (switchy || answer) return move ? { type: 'movement', movement: named.key } : { type: 'exercise', exercise: named.key };
  }
  if (setEnd) {
    const done = setEndAnswer(s, w.length);
    if (done != null) return { type: 'set_end', done };
  }
  if (!question && !named) {
    const command = !asks && s.match(AUTO) != null && words(s.replace(AUTO, ' ')).every(x => AUTO_WORDS.has(x));
    if (command && w.length <= SHORT) return { type: 'auto' };
    // (not knowing yet, but not about an exercise turned down: "anything but squats" is for the coach to answer)
    if (asking && w.length <= ANSWER && (s.match(AUTO) != null || (UNSURE.test(s) && !found.length))) return { type: 'auto' };
  }
  return null;
}

// --- the page's own voice, heard back -------------------------------------------------------------------------------
// The Mac's voice plays outside the page, where echo cancellation cannot take it out of the microphone: an utterance
// heard while it spoke holds the cue (some of it, from where the utterance opened, or all of it from its start if the
// cue began while the user talked), and maybe the user's own words around it. The cue's words in order, a word missed
// or misheard here and there ("eight" for "8"), are taken out; what is left is the user's. Only for an utterance that
// overlapped that voice: the user's own "Done with this set" after the question is theirs.

/** The words of `text` with where each is in it: [{w, at, end}] (w as words() gives it). */
function spans(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/[\p{L}\p{N}'’]+/gu)) {
    for (const p of m[0].toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
      out.push({ w: p, at: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

/** From t[i] = c[k], how far the cue's words go on in order: {end (after the last word matched), matched}. */
function run(t, c, i, k) {
  let matched = 0, end = i;
  while (i < t.length && k < c.length) {
    if (t[i] === c[k]) { matched += 1; i += 1; k += 1; end = i; continue; }
    if (t[i + 1] === c[k]) i += 1;                              // a word the cue does not have
    else if (t[i] === c[k + 1]) k += 1;                         // a word of the cue not written down
    else if (t[i + 1] === c[k + 1]) { i += 1; k += 1; }         // one word for another
    else break;
  }
  return { end, matched };
}

export function afterEcho(text, cue) {
  const sp = spans(text), t = sp.map(x => x.w), c = words(cue);
  if (!t.length || !c.length) return String(text || '').trim();
  let best = null;
  const consider = (i, k) => {
    const r = run(t, c, i, k);
    if (!best || r.matched > best.matched) best = { start: i, ...r };
  };
  // the utterance opened on the cue (any part of it), or the cue began while the user talked (its first word)
  for (let k = 0; k < c.length; k++) if (c[k] === t[0]) consider(0, k);
  for (let i = 1; i < t.length; i++) if (t[i] === c[0]) consider(i, 0);
  // all of it is the cue; or a run of the cue's words in it (two or more: one word in common is no echo)
  if (!best || (best.matched < 2 && !(best.start === 0 && best.end === t.length))) return String(text).trim();
  const s = String(text);
  const before = best.start > 0 ? s.slice(0, sp[best.start].at) : '';
  const after = best.end < t.length ? s.slice(sp[best.end].at) : '';
  return [before, after].map(x => x.trim()).filter(Boolean).join(' ').replace(/^[^\p{L}\p{N}]+/u, '');
}
