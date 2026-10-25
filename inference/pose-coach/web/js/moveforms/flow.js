// Guard rails of the dances and the flow (web/js/moveform.js has the check's shape, bodyMetrics' measures and when a
// check is judged): bharatanatyam_arms, forward_fold_roll_up; freestyle_dance, hip_hop_dance (track 'moving': no
// cycles, so 'frame' checks only, a `phase` for the part of the movement each applies to). Only clear, measurable
// mistakes, each line set from the movement's reference skeleton with a margin; never a matter of style (a dance is
// free). A movement left out has no form check: the tracker says so (form: null), and the coach does not call it
// right or wrong. Measured (2026-10-25) on the library's reference skeletons, MediaPipe on the library's footage of
// each, and the user's own recordings (tests/moveforms-flow.test.mjs).
// This file imports nothing from ../moveform.js (it imports this one): its helpers are its own.
//
// Left out, as nothing measured holds:
//   bharatanatyam_arms' stance (its one guard rail is its hands). Its half-sit cannot be told from standing up: the
//     reference's more bent knee reads 146-165 deg (its other knee is straight), MediaPipe on its footage 144-162,
//     and MediaPipe reads the user standing still at 160 (median; 95th percentile 164). Its feet together (ankles
//     0.14-0.15 leg lengths apart; MediaPipe 0.11-0.21) are the stance itself (heels together), and the toes'
//     turn-out a check would need is guessed in depth from the front. Its more bent hip reads 163 (median; its
//     footage 168), the user standing 171.
//   freestyle_dance, hip_hop_dance. Knees caving in means something with both knees bent and both feet down apart,
//     and that is under 4% of either reference; there the hip-hop reference crosses its bent knees on purpose (knees
//     0.1 of the feet's width apart), and MediaPipe reads the freestyle footage's ordinary steps down to 0.62
//     (engine.js's squat calls 0.8 caving in). Neither reference hops (the feet at most 0.12 body lengths up; airborne
//     is 0.15), and a landing lasts a frame or two where a frame check needs FAULT_MS of its frames.

const r0 = v => String(Math.round(v));
const SIDES = ['L', 'R'];
/** The arms in view (bodyMetrics `seen`): from the side MediaPipe barely sees the far one. */
const armsSeen = m => SIDES.filter(s => m.seen[`arm${s}`]);
/** The smallest of a per-side measure over the arms in view (NaN with none in view). */
const lowest = (m, name) => {
  const a = armsSeen(m);
  return a.length ? Math.min(...a.map(s => m[`${name}${s}`])) : NaN;
};
/** The side whose measure is under `line` while the other's is `fine` or more, both arms in view: 'L', 'R', or null
 * (both short, one arm seen, or the other near the line: MediaPipe's jitter puts both arms held short a few degrees
 * apart, one of them over the line on a frame now and then). */
const sideUnder = (m, name, line, fine) => {
  const a = armsSeen(m), under = a.filter(s => m[`${name}${s}`] < line);
  return a.length === 2 && under.length === 1 && m[`${name}${a.find(s => s !== under[0])}`] >= fine ? under[0] : null;
};
const LM = { L: { el: 13, wr: 15 }, R: { el: 14, wr: 16 } };
/** A hand's height in the picture: the wrist above its shoulder over the trunk's height there (the shoulders' middle
 * to the hips' middle, on screen; negative: below), NaN with the trunk too short on screen to tell. The picture's own
 * heights: MediaPipe's world depth flattens a hand raised by the face to half of it. */
const handUp = (lm, s) => {
  const im = lm.image, sh = s === 'L' ? 11 : 12, trunk = (im[23].y + im[24].y - im[11].y - im[12].y) / 2;
  return trunk > 0.02 ? (im[sh].y - im[LM[s].wr].y) / trunk : NaN;
};
/** A forearm's direction in the picture, in degrees above level (elbow to wrist; aspect-corrected, either way out;
 * 90: straight up, negative: down). */
const forearmUp = (lm, s) => {
  const im = lm.image, el = im[LM[s].el], wr = im[LM[s].wr];
  return (Math.atan2(el.y - wr.y, Math.abs((wr.x - el.x) * (lm.aspect ?? 16 / 9))) * 180) / Math.PI;
};
/** An arm in a gesture: the elbow bent (under 140 deg) and the upper arm raised from the side (over 35). */
const gesturing = (m, s) => m[`elbow${s}`] < 140 && m[`armFromDown${s}`] > 35;
const OTHER = { L: 'R', R: 'L' }, SIDE_WORD = { L: 'left', R: 'right' };

export default {
  // Bharatanatyam arm gestures: from both arms out wide, the right hand comes in to the chest, then the left, then the
  // right rises to the upper chest; each hand brought in to the body, the forearm across it. One guard rail per hand:
  // raised by the face instead. Judge a standing, front-facing chest gesture with the other forearm across the
  // body, not a boxing guard or goblet hold. Low chest gestures do not clear an upper-chest fault.
  // The 45-degree threshold leaves space above the reference's near-level forearm; the fix is at 30 degrees.
  // `still` includes held gestures after movement. Shorter smoothing (400 ms) and persistence (800 ms) distinguish
  // a held raised hand from a brief swing into the chest. Personal measurements and replay notes stay private.
  bharatanatyam_arms: ['L', 'R'].map(s => ({
    id: `hand_raised_${SIDE_WORD[s]}`, name: `${SIDE_WORD[s]} hand in at the chest`,
    label: `${SIDE_WORD[s]} hand raised by the face, not brought in to the chest`, part: 'arm', side: () => s,
    // (the other arm in view a matter of the phase, not of `needs`: a plank from the side, its far arm unseen, is no
    // call to step back)
    needs: [`arm${s}`, 'trunk'], views: ['front', 'angled'], at: 'frame', still: true, order: 1,
    smoothMs: 400, faultMs: 800,
    phase: (m, lm) => m.trunkTilt < 30 && gesturing(m, s) && handUp(lm, s) > -0.2 && m.seen[`arm${OTHER[s]}`]
      && gesturing(m, OTHER[s]) && Math.abs(forearmUp(lm, OTHER[s])) <= 30,
    value: (m, lm) => forearmUp(lm, s), bad: v => v > 45, ok: v => v <= 30,
    measured: v => `forearm raised ${r0(v)} degrees above level (straight up is 90)`,
    target: 'the hand in at the chest, the forearm across it, 30 degrees or less from level',
    cue: 'Bring that hand in to your chest, the forearm across your body, not up by your face.' })),
  // Forward fold roll-up to overhead reach: folded, the trunk rolls up to standing, then both arms reach up overhead
  // (where its reference ends). One guard rail, the reach. Not the knees locked in the fold: MediaPipe reads the
  // user's straight standing knees at 160 deg, the reference's knees 167-175 throughout (no angle shows a knee pushed
  // back past straight). Not the trunk upright at the top: a swan dive down from the reach leans it, the hands up.
  // `still`: the reach is held, which the stillness measure takes for not moving; judged only on frames moving, it was
  // never judged at half the reference's pace (each stillness a pause, the reach in the warm-up after it), and its fix
  // was seen at its own pace only with jitter keeping the top moving. Its phase keeps a person at rest out. Its arms
  // put short are caught at the first reach from 0.15 to 1 times the reference's pace, the second at 1.5, the third at
  // 2 (a quick reach that short is in its phase about a second, its first SETTLE_MS not judged), and fixed at the
  // first good reach (the second at 1.5 and 2). At 0.1 the tracker never counts it as moving: nothing is judged
  forward_fold_roll_up: [
    { id: 'reach_short', name: 'arms overhead at the top', label: 'arms short of overhead at the top', part: 'arm',
      side: m => sideUnder(m, 'armFromDown', 110, 120), needs: ['trunk'], at: 'frame', still: true, order: 1,
      // only at the top, standing tall with the arms raised: the trunk within 20 deg of upright (folded the reference
      // leans 120-125 forward, its top 0-3; the arms hang until the trunk is up), and every arm in view raised past
      // level (the upper arm over 90 deg from down, the wrist above its shoulder) with the elbow straighter than 110
      // (hands on the head bend it under 90; MediaPipe reads the footage's reaching near elbow 119-146)
      phase: m => Math.abs(m.trunkLeanFwd) < 20 && armsSeen(m).every(s => m[`armFromDown${s}`] > 90
        && m[`wristUp${s}`] > 0 && m[`elbow${s}`] > 110),
      // the lower arm in view from straight down (bodyMetrics armFromDownL/R: 90 level, 180 straight up). The
      // reference's top reads 141-147, mirrored the same, and nothing is told played out and back at 0.1 to 2 times
      // its pace, mirrored, with MediaPipe-sized jitter; MediaPipe on its footage (from the side: the near arm) reads
      // 146-149. Its arms put to reach 70% as high read 91-103. The line at 110 (20 deg above level) leaves the
      // reference 31 deg of room, and a still check judges the arms on their way down too: made-up arms lowered from
      // overhead pass it quietly down to 10 deg/s (told at 8; at 115, told at 12). Judged on every frame of the
      // library's other footage and skeletons, it was crossed only where arms truly were held 90-110 (one arm level
      // and the other overhead, both reaching forward and up)
      value: m => lowest(m, 'armFromDown'), bad: v => v < 110, ok: v => v >= 120,
      measured: v => `arms raised ${r0(v)} degrees at the top (straight up is 180)`,
      target: 'arms reaching up overhead, 140 degrees or more',
      cue: 'At the top, reach both arms all the way up overhead.' },
  ],
};
