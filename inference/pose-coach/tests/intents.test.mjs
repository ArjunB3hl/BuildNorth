// What the user's words ask of the page when it listens itself (Parakeet transcripts): an exercise named, "detect it",
// or an answer to "Done with this set?", and only when the words are meant so. Everything else goes to the coach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { EXERCISES } from '../web/js/engine.js';
import { TRACK_OF_KIND } from '../web/js/moves.js';
import { NAMES, afterEcho, chatter, exerciseIn, intentOf, movementIn, movementNames, words } from '../web/js/intents.js';

const ASKING = { exercise: true };            // "Which exercise are you doing?" is open
const SET_END = { setEnd: true };             // "Done with this set?" is open
const ex = key => ({ type: 'exercise', exercise: key });
const AUTO = { type: 'auto' };
const DONE = { type: 'set_end', done: true }, NOT_YET = { type: 'set_end', done: false };

test('every exercise has its names, and the forms people say (and Parakeet writes) find it', () => {
  assert.deepEqual(new Set(NAMES.map(([k]) => k)), new Set(Object.keys(EXERCISES)));
  const said = {
    squat: ['Squats.', 'squat', 'squatting'],
    squat_pulse: ['Squat pulses', 'pulse squats', 'pulses'],
    pushup: ['Push-ups', 'pushups', 'push ups', 'Press-ups', 'press ups', 'a push-up'],
    lunge: ['Lunges', 'lunge', 'walking lunges'],
    lateral_raise: ['Lateral raises', 'side raises', 'side lateral raises', 'laterals'],
    front_raise: ['Front raises', 'front raise'],
    biceps_curl: ['Biceps curls', 'bicep curls', 'curls', 'hammer curls'],
    triceps_kickback: ['Triceps kickbacks', 'tricep kick-backs', 'kickbacks'],
    overhead_press: ['Overhead press', 'shoulder presses', 'military press', 'push press'],
    hinge: ['Hip hinges', 'deadlifts', 'dead lifts', 'RDLs', 'do good mornings', 'some good mornings'],
    jump: ['Jumps', 'jump squats', 'squat jumps', 'tuck jumps', 'jumping'],
    jumping_jack: ['Jumping jacks', 'star jumps', 'jacks'],
    knee_raise: ['Knee raises', 'high knees', 'knee lifts'],
  };
  for (const [key, forms] of Object.entries(said)) {
    for (const f of forms) assert.equal(exerciseIn(f), key, f);
  }
  assert.equal(exerciseIn('sit-ups'), null);                      // (not one the engine counts)
  assert.equal(exerciseIn('raises'), null);                       // (lateral or front: not said)
  assert.equal(exerciseIn('my pulse'), null);
  assert.deepEqual(words("Let's do Push-ups!"), ['lets', 'do', 'push', 'ups']);
});

test('the more specific name wins inside a longer one, and of two names the one meant', () => {
  assert.equal(exerciseIn('squat jumps'), 'jump');
  assert.equal(exerciseIn('jumping jacks'), 'jumping_jack');
  assert.equal(exerciseIn('squat pulses'), 'squat_pulse');
  assert.equal(exerciseIn('press-ups'), 'pushup');                // (not a press)
  assert.equal(exerciseIn('switch from squats to lunges'), 'lunge');
  assert.equal(exerciseIn("I'm done with squats, now lunges"), 'lunge');
  assert.equal(exerciseIn('not squats, lunges'), 'lunge');
  assert.equal(exerciseIn('lunges instead of squats'), 'lunge');
  assert.equal(exerciseIn('squats then lunges'), 'squat');        // (the first: what comes now)
  assert.equal(exerciseIn('no more squats'), null);
});

test('the answer to "which exercise?": any mention that is not a question', () => {
  for (const [said, key] of [['Squats.', 'squat'], ["I'll start with lunges", 'lunge'], ['Um, push-ups I think', 'pushup'],
    ['I think I will start with squats today', 'squat'], ['Lateral raises, please.', 'lateral_raise'],
    ['Biceps curls?', 'biceps_curl'], ['I want to do some jumping jacks', 'jumping_jack']]) {
    assert.deepEqual(intentOf(said, ASKING), ex(key), said);
  }
  // "detect it", or not knowing yet
  for (const said of ['Detect it.', 'You figure it out', 'Detect for me', "I'm not sure", "I don't know yet", 'Auto',
    'Whatever, you decide', 'Just recognise it']) {
    assert.deepEqual(intentOf(said, ASKING), AUTO, said);
  }
  // questions and words about pain are the coach's to answer, the question open or not
  for (const said of ['How deep should my squats be?', 'What is a good warm-up for lunges?', 'Are squats bad for knees?',
    'My knee hurts when I squat', 'Is it OK to do push-ups every day?', 'Which is better, lunges or squats?']) {
    assert.equal(intentOf(said, ASKING), null, said);
  }
  assert.equal(intentOf('Good morning coach, how are you?', ASKING), null);
  assert.equal(intentOf('Hello!', ASKING), null);
});

test('"good morning" is a greeting (every coach greets at Start), good mornings the exercise only when asked for', () => {
  for (const opts of [ASKING, {}, SET_END, { exercise: true, setEnd: true }]) {
    for (const said of ['Good morning!', 'Good morning, coach', 'Good morning', 'Good mornings!', 'Morning!']) {
      assert.equal(intentOf(said, opts), null, `${said} ${JSON.stringify(opts)}`);
    }
  }
  assert.equal(exerciseIn('good morning'), null);
  assert.deepEqual(intentOf("Good morning! I'll do squats.", ASKING), ex('squat'));
  assert.deepEqual(intentOf("Good morning! Let's do lunges."), null);     // (more than a short switch: the coach answers)
  assert.deepEqual(intentOf("Let's do good mornings"), ex('hinge'));
  assert.deepEqual(intentOf('Some good mornings, please', ASKING), ex('hinge'));
});

test('words that turn an exercise down: the one meant is the other, or none', () => {
  assert.equal(intentOf("I don't want to do squats", ASKING), null);
  assert.equal(intentOf('I do not want squats', ASKING), null);
  assert.equal(intentOf("I'd rather not do squats", ASKING), null);
  assert.equal(intentOf('Anything but squats', ASKING), null);         // (no answer: the coach can suggest one)
  assert.equal(intentOf('I hate lunges', ASKING), null);
  assert.deepEqual(intentOf("I don't want squats, let's do lunges", ASKING), ex('lunge'));
  assert.deepEqual(intentOf('Anything but squats, lunges maybe', ASKING), ex('lunge'));
  assert.deepEqual(intentOf("Skip the squats, let's do lunges"), ex('lunge'));
  assert.deepEqual(intentOf('Not squats, you decide', ASKING), AUTO);
});

test('a short switch at any time; never a question, nor words about something else', () => {
  for (const [said, key] of [['Now lunges.', 'lunge'], ['Switch to curls', 'biceps_curl'], ["Let's do push-ups", 'pushup'],
    ["I'm doing squats", 'squat'], ['Lunges now', 'lunge'], ['Okay, so now let\'s do some lunges, please.', 'lunge'],
    ['Can we do lunges?', 'lunge'], ['Could you count curls now', 'biceps_curl'], ['Time for jumping jacks', 'jumping_jack'],
    ['Next up, high knees', 'knee_raise'], ["I'm done with squats, now lunges", 'lunge'], ['A set of lunges', 'lunge'],
    ['Back to squats', 'squat'], ['Moving on to shoulder presses', 'overhead_press'], ['Squats.', 'squat']]) {
    assert.deepEqual(intentOf(said), ex(key), said);
  }
  // the exercise being counted, named again, is no switch (in auto mode it would stop the detection of the others)
  for (const said of ['Squats.', "I'm doing squats", 'Now squats', "Let's do squats"]) {
    assert.equal(intentOf(said, { current: 'squat' }), null, said);
  }
  assert.deepEqual(intentOf('Now lunges', { current: 'squat' }), ex('lunge'));
  assert.deepEqual(intentOf('Squats.', { exercise: true, current: 'squat' }), ex('squat'));   // (the question's answer)
  // counting out loud, and more of the same, are no switch
  for (const said of ['Ten squats', 'eight, nine, ten squats', 'Twenty squats', '10 squats', 'Three sets of squats',
    'Two more squats', 'One more set of squats', 'Couple more squats', 'A few more push-ups']) {
    assert.equal(intentOf(said), null, said);
  }
  // asked by intonation only (Parakeet writes the "?"): a question for the coach, unless it is a request
  for (const said of ['Lunges next?', 'Push-ups now?', 'Squats?', 'So, squats now?', 'More squats?', 'Lunges, right?',
    'Lunges, can I?', 'Detect it?']) {
    assert.equal(intentOf(said), null, said);
  }
  assert.deepEqual(intentOf('Can we do lunges?'), ex('lunge'));
  assert.deepEqual(intentOf('Lunges next?', ASKING), ex('lunge'));     // (an answer to "which exercise?" may sound asked)
  for (const said of ['How was my squat depth?', 'How was my form on that set?', "I'm doing squats wrong",
    'My squat depth was bad', 'What about my lunges?', 'Should I do lunges next?', 'Do you think my curls are too fast?',
    'I hate lunges', 'Lunges are my favourite exercise of all of them', 'My shoulder is sore from the presses',
    'Did I do enough squats today', 'Can I do squats with my knees in?']) {
    assert.equal(intentOf(said), null, said);
  }
  // "detect it" as a short command, not words that only mention it
  for (const said of ['Detect it', 'Go back to auto', 'Auto mode', 'You figure it out', 'Can you detect it?']) {
    assert.deepEqual(intentOf(said), AUTO, said);
  }
  for (const said of ["I'm not sure", 'How do you detect the exercise?', 'Can you detect lunges and squats in one set?',
    'It did not detect my last rep']) {
    assert.equal(intentOf(said), null, said);
  }
});

test('"done with this set?": yes, done, finished against no, not yet, keep going, one more', () => {
  for (const said of ['Yes.', 'Yeah', 'Yep, done.', 'Done.', "I'm done", 'Finished', "That's it", 'All done', "That's the set",
    'No, I\'m done', 'Yeah I think I\'m done with this set']) {
    assert.deepEqual(intentOf(said, SET_END), DONE, said);
  }
  for (const said of ['No.', 'Nope', 'Not yet', 'Not done', 'Keep going', 'One more', 'Yes, one more', 'Hold on', 'Two more reps',
    "I'm not done", 'Still going', 'Wait']) {
    assert.deepEqual(intentOf(said, SET_END), NOT_YET, said);
  }
  // not an answer: a question, both at once, or something else
  for (const said of ['Am I done?', 'How many reps did I do?', "I'm done, one more", 'Okay', 'Breathe', 'One, two, three, four']) {
    assert.equal(intentOf(said, SET_END), null, said);
  }
  // with no question open, "done" or "yes" asks nothing of the page (the coach answers it)
  assert.equal(intentOf('Done.'), null);
  assert.equal(intentOf('Yes'), null);
  // naming the next exercise ends the set anyway (a switch): it comes first
  assert.deepEqual(intentOf('Yes, now lunges', SET_END), ex('lunge'));
  assert.deepEqual(intentOf('Done, switch to curls', SET_END), ex('biceps_curl'));
  assert.deepEqual(intentOf('Not done, squats', SET_END), NOT_YET);
  // more of the set's own exercise is "not yet", not a switch to it (the question stays answered, detection stays on)
  const SQUATS = { setEnd: true, current: 'squat' };
  for (const said of ['One more squat', 'One more squat.', 'Two more squats', 'Couple more squats', 'A few more squats']) {
    assert.deepEqual(intentOf(said, SQUATS), NOT_YET, said);
  }
  assert.deepEqual(intentOf('One more squat', SET_END), NOT_YET);
  assert.deepEqual(intentOf('Yes, squats', SQUATS), DONE);
  assert.deepEqual(intentOf('Now lunges', SQUATS), ex('lunge'));
  // "no more", "enough": done
  for (const said of ['No more squats', 'No more', 'No more reps', 'Enough', "That's enough", 'No more, I\'m done']) {
    assert.deepEqual(intentOf(said, SQUATS), DONE, said);
  }
  assert.deepEqual(intentOf('No, one more', SQUATS), NOT_YET);
  assert.equal(intentOf('Not enough', SQUATS), null);
});

test("the page's own voice heard back (the Mac's): taken out of a transcript, the user's words kept", () => {
  const Q = "That's 8 reps of Squat. Done with this set?";
  // the user's own answers, written down after the question: theirs, though they repeat its words
  for (const said of ["I'm done with this set", 'Yes, done with this set.', 'Not done with this set.', 'Yes', 'Not yet',
    "That's it, done.", 'One more squat']) {
    assert.equal(afterEcho(said, Q), said, said);
  }
  // the cue, all of it or the part the utterance opened on, a word misheard ("eight"): nothing of the user's
  for (const said of ["That's 8 reps of squat. Done with this set?", "That's eight reps of squat, done with this set.",
    'Done with this set?', 'squat, done with this set', 'Set.']) {
    assert.equal(afterEcho(said, Q), '', said);
  }
  // the cue and the user's answer in one utterance (an answer said over the cue, or a moment after it)
  assert.equal(afterEcho("That's 8 reps of squat. Done with this set? Yes.", Q), 'Yes.');
  assert.equal(afterEcho("reps of squat, done with this set? I'm done with this set.", Q), "I'm done with this set.");
  assert.equal(afterEcho('Which exercise are you doing? Or just start. Squats.', 'Which exercise are you doing? Or just start.'), 'Squats.');
  // the cue began while the user talked
  assert.equal(afterEcho("How many reps was that? That's 8 reps of squat. Done with", Q), 'How many reps was that?');
  // the tail of a long answer, cut at the 15 s limit
  assert.equal(afterEcho('a professional.', 'If it hurts, stop and see a professional.'), '');
  assert.equal(afterEcho('', Q), '');
  assert.equal(afterEcho('Now lunges', ''), 'Now lunges');
});

test('nothing, and words with nothing in them', () => {
  assert.equal(intentOf(''), null);
  assert.equal(intentOf('...', ASKING), null);
  assert.equal(intentOf(null, { exercise: true, setEnd: true }), null);
});

test('chatter: counting out loud and fillers are for nobody; a word of anything else is not', () => {
  for (const said of ['Um.', 'Uh, hmm', 'Seven, eight, nine', '10, 11, 12', 'One more! Come on!', 'Phew.', '']) assert.equal(chatter(said), true, said);
  for (const said of ['What?', 'How many was that?', 'Seven, eight, my knee hurts', 'Thanks']) assert.equal(chatter(said), false, said);
});

// --- movements of the library, named by the user (a made-up library in the shape of /moves/library.json) -----------
const LIBRARY = [
  { key: 'quad_stretch', kind: 'hold', synonyms: ['quad stretch', 'standing quad stretch'] },
  { key: 'triangle_pose', kind: 'hold', synonyms: ['triangle pose', 'triangle'] },
  { key: 'figure_four_balance', kind: 'hold', synonyms: ['figure-four balance', 'figure four'] },
  { key: 'freestyle_dance', kind: 'dance', synonyms: ['freestyle dance', 'freestyle', 'dancing', 'dance'] },
  { key: 'hip_hop_dance', kind: 'dance', synonyms: ['hip-hop dance', 'hip hop'] },
  { key: 'half_kneel_to_stand', kind: 'transition', synonyms: ['half kneel to stand', 'half kneeling', 'half kneel'] },
  { key: 'boxing_cardio_combo', kind: 'gym_reps', synonyms: ['boxing cardio combo', 'shadow boxing', 'boxing'] },
  { key: 'overhead_kettlebell_squat', kind: 'gym_counted', engine: 'squat', synonyms: ['overhead kettlebell squat', 'overhead squat'] },
  { key: 'push_up', kind: 'gym_counted', engine: 'pushup', synonyms: ['push-up', 'push up'] },
];
const MOVES = movementNames(LIBRARY);
const mv = key => ({ type: 'movement', movement: key });

test('a movement of the library is found by its spoken names and its key, singular or plural', () => {
  assert.deepEqual(MOVES.map(([k]) => k), LIBRARY.map(m => m.key));
  for (const [said, key] of [['Quad stretch', 'quad_stretch'], ['quad stretches', 'quad_stretch'],
    ['the standing quad stretch', 'quad_stretch'], ['Triangle pose.', 'triangle_pose'], ['triangle', 'triangle_pose'],
    ['figure four balance', 'figure_four_balance'], ['Figure-four.', 'figure_four_balance'], ['Hip-hop dance', 'hip_hop_dance'],
    ['hip hop', 'hip_hop_dance'], ['dancing', 'freestyle_dance'], ['a dance', 'freestyle_dance'], ['Freestyle', 'freestyle_dance'],
    ['Half kneeling', 'half_kneel_to_stand'], ['half kneel to stand', 'half_kneel_to_stand'], ['Shadow boxing', 'boxing_cardio_combo'],
    ['overhead kettlebell squats', 'overhead_kettlebell_squat']]) {
    assert.equal(movementIn(said, MOVES), key, said);
  }
  assert.equal(movementIn('squats', MOVES), null);                  // (an exercise of the engine's)
  assert.equal(movementIn('quad stretch', []), null);               // (no library: nothing)
  assert.deepEqual(movementNames([{ key: 'x' }, null, {}]).map(([k]) => k), ['x']);
});

test("a movement's longer name wins over the exercise in it; an exercise's own name as long stays the exercise", () => {
  const opts = { ...ASKING, movements: MOVES };
  assert.deepEqual(intentOf('Overhead kettlebell squats', opts), mv('overhead_kettlebell_squat'));
  assert.deepEqual(intentOf('overhead squats', opts), mv('overhead_kettlebell_squat'));
  assert.deepEqual(intentOf('Squats.', opts), ex('squat'));
  assert.deepEqual(intentOf('Push-ups', opts), ex('pushup'));        // (the library's push-up says it no longer)
  // (a movement word before an exercise describes it; walking lunges are lunges by their own name)
  assert.deepEqual(intentOf('Half kneeling shoulder press', opts), ex('overhead_press'));
  assert.deepEqual(intentOf('Now half kneeling curls', { movements: MOVES }), ex('biceps_curl'));
  assert.deepEqual(intentOf('Walking lunges', opts), ex('lunge'));
  assert.deepEqual(intentOf('Now walking lunges', { movements: MOVES }), ex('lunge'));
  assert.equal(exerciseIn('overhead kettlebell squats'), 'squat');  // (without the library, as before)
  // and the exercises are found as before with the library known
  for (const [said, key] of [['Jumping jacks', 'jumping_jack'], ['squat jumps', 'jump'], ['press-ups', 'pushup'],
    ['Lateral raises, please.', 'lateral_raise']]) {
    assert.deepEqual(intentOf(said, opts), ex(key), said);
  }
});

test('a movement named as a short switch, or as the answer to "which exercise?"; never a question nor about pain', () => {
  const opts = { movements: MOVES };
  for (const [said, key] of [["I'm doing a quad stretch", 'quad_stretch'], ["I'm doing a quad stretch.", 'quad_stretch'],
    ['Now dancing.', 'freestyle_dance'], ["Let's do some boxing", 'boxing_cardio_combo'], ['Boxing in place', 'boxing_cardio_combo'],
    ["I'm holding a triangle pose", 'triangle_pose'], ['Switch to the figure-four balance', 'figure_four_balance'],
    ['Some hip hop now', 'hip_hop_dance'], ['Going into a half kneel', 'half_kneel_to_stand'],
    ['Time for a quad stretch, please', 'quad_stretch']]) {
    assert.deepEqual(intentOf(said, opts), mv(key), said);
  }
  assert.deepEqual(intentOf("I think I'll start with a quad stretch today", { ...ASKING, movements: MOVES }), mv('quad_stretch'));
  for (const said of ['How long should I hold a quad stretch?', 'Is dancing good after squats?', 'Quad stretch next?',
    'My quad hurts in the quad stretch', 'The quad stretch is really hard for me', 'I hate dancing',
    'Should I do a triangle pose or a quad stretch?']) {
    assert.equal(intentOf(said, opts), null, said);
  }
  // the movement named now, named again, is no switch; another one, an exercise or "detect it" is
  const NAMED = { movements: MOVES, movement: 'quad_stretch', current: null };
  assert.equal(intentOf("I'm doing a quad stretch", NAMED), null);
  assert.deepEqual(intentOf('Now hip hop', NAMED), mv('hip_hop_dance'));
  assert.deepEqual(intentOf('Now squats', NAMED), ex('squat'));
  assert.deepEqual(intentOf('Detect it', NAMED), AUTO);
  assert.deepEqual(intentOf('Done with dancing, now lunges', opts), ex('lunge'));
  assert.equal(intentOf('No more dancing', opts), null);
  assert.deepEqual(intentOf('Not boxing, dancing', { ...ASKING, movements: MOVES }), mv('freestyle_dance'));
  // a counted one named now: its name, or its exercise's, again is no switch
  const COUNTED = { movements: MOVES, movement: 'overhead_kettlebell_squat', current: 'squat' };
  assert.equal(intentOf('Overhead kettlebell squats', COUNTED), null);
  assert.equal(intentOf('Squats', COUNTED), null);
  // the open "Done with this set?" question: a movement named ends the set anyway (the page does it), first
  assert.deepEqual(intentOf('Done, now a quad stretch', { ...SET_END, movements: MOVES }), mv('quad_stretch'));
  // without the library the words are the coach's, as before
  assert.equal(intentOf("I'm doing a quad stretch"), null);
});

test('the library\'s everyday words do not take an exercise named with them, nor make a longer answer', () => {
  const lib = [...LIBRARY, { key: 'forward_fold_roll_up', kind: 'flow', synonyms: ['forward fold', 'roll up'] }];
  const opts = { movements: movementNames(lib) }, asking = { ...opts, exercise: true };
  // an exercise named with a movement word: the exercise, unless the words bring the movement in
  assert.deepEqual(intentOf('Let me roll up my sleeves for some squats', asking), ex('squat'));
  assert.deepEqual(intentOf("I'm going to dance through some squats", asking), ex('squat'));
  assert.deepEqual(intentOf("Let's do squats with a dance after", asking), ex('squat'));
  assert.equal(intentOf('Let me roll up my sleeves for some squats', opts), null);
  assert.deepEqual(intentOf("I'm doing a quad stretch, then squats", asking), mv('quad_stretch'));
  assert.deepEqual(intentOf('From squats to hip hop', opts), mv('hip_hop_dance'));
  assert.deepEqual(intentOf('Now hip hop, then squats', opts), mv('hip_hop_dance'));
  // a longer answer to "which exercise?" names a movement only with an answer's words around it
  for (const said of ['Let me roll up my sleeves', "I'm boxing up my old clothes", 'I go dancing after this']) {
    assert.equal(intentOf(said, asking), null, said);
  }
  for (const [said, key] of [["I think I'll start with a quad stretch today", 'quad_stretch'], ['Quad stretch, right leg', 'quad_stretch'],
    ["I'd like to do a forward fold first", 'forward_fold_roll_up'], ['Probably some hip hop', 'hip_hop_dance']]) {
    assert.deepEqual(intentOf(said, asking), mv(key), said);
  }
  // (an exercise may still be a longer answer, as before)
  assert.deepEqual(intentOf('Let me warm up with some squats first', asking), ex('squat'));
});

// the library the build writes (git-ignored, licensed: only where it was built): every spoken name finds its own
// movement, and none is taken by another movement or by an exercise other than the one that counts it
const BUILT = new URL('../.data/moves/library.json', import.meta.url);
test('the built library: each name finds its own movement', { skip: !existsSync(BUILT) && 'no .data/moves/library.json here' }, () => {
  // (the movements the page keeps: those of the kinds moves.js offers, as a library built before may have others)
  const lib = JSON.parse(readFileSync(BUILT, 'utf8')).movements.filter(m => TRACK_OF_KIND[m.kind] === m.track);
  const names = movementNames(lib);
  assert.equal(names.length, lib.length);
  for (const m of lib) {
    for (const name of [...(m.synonyms || []), m.key.replace(/_/g, ' ')]) {
      const got = intentOf(name, { exercise: true, movements: names });
      const want = got?.type === 'exercise' && m.engine ? ex(m.engine) : mv(m.key);
      assert.deepEqual(got, want, `${m.key}: "${name}"`);
    }
  }
});
