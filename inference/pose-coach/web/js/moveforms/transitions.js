// Guard rails of the transitions (web/js/moveform.js has the check's shape, bodyMetrics' measures and when a check is
// judged): kneel_and_stand, half_kneel_to_stand (track 'moving': no cycles, so 'frame' checks only, a `phase` for the
// part of the movement each applies to). Only clear, measurable mistakes, each line set from the movement's reference
// skeleton with a margin; never a matter of style.
// This file imports nothing from ../moveform.js (it imports this one): its helpers are its own.

const r0 = v => String(Math.round(v)), r2 = v => v.toFixed(2);

/** The legs against the floor on one frame (world landmarks: metres around the hips' middle, y down): each knee's
 * height above the floor (the lowest of the ankles, heels and toes), in leg lengths, `low` the lower knee's and `high`
 * the other's, `up` the side of the higher one ('L' or 'R'), and the hips' height. */
function legs(m, lm) {
  const y = i => lm.world[i].y;
  const floor = Math.max(y(27), y(28), y(29), y(30), y(31), y(32));
  const L = (floor - y(25)) / m.legLen, R = (floor - y(26)) / m.legLen;
  return { low: Math.min(L, R), high: Math.max(L, R), up: L > R ? 'L' : 'R', hips: floor / m.legLen };
}
/** The front leg of a kneel ('L' or 'R'): the one whose thigh points further from straight down (forward, its foot
 * planted ahead), the kneeling leg's thigh near vertical under the hips. The value and the side (side(m, lm)) both go
 * by it, so a fault's side is the leg its value measured. On every kneeling frame of the references, their footage
 * and the library's other kneels and lunges it is the leg with the higher knee too; the phases below hold only where
 * the two agree (they disagreed on a few frames of the user's recordings, MediaPipe guessing the legs as they walked
 * to the camera). */
const front = m => (m.thighFromDownL > m.thighFromDownR ? 'L' : 'R');

/** Kneeling on one knee: that knee near the floor, the other a good way higher (the front foot planted, its knee up),
 * the hips over the kneeling knee, both knees bent, the higher knee the front leg's. Held, the references kneel with
 * the kneeling knee 0.07 and 0.19 leg lengths above the lowest foot point; MediaPipe on their footage 0.16-0.26 and
 * 0.25-0.33 (its world landmarks are the camera's axes: a camera pitched down lifts what lies behind), so up to 0.4
 * here; standing knees read 0.55-0.6. The front knee 0.20-0.40 higher, the hips 0.24-0.52 over the kneeling knee, the
 * knees bent to 37-118 deg. A squat has neither knee down (the user's: 0.54 up and more) and keeps them level (0.05
 * apart in height, 0.14 at most), a push-up or a plank keeps its knees straight, and a person lying down has the hips
 * at the knees' height. */
function kneeling(m, lm) {
  const g = legs(m, lm);
  return g.low <= 0.4 && g.high - g.low >= 0.15 && g.hips - g.low >= 0.2 && Math.max(m.kneeL, m.kneeR) < 130
    && g.up === front(m);
}
/** Kneeling, or pushing up off the knee until the knees come level (on the reference skeletons the back knee is 0.41
 * and 0.42 leg lengths up by then), the front knee still bent under 140 deg. */
function pushingUp(m, lm) {
  const g = legs(m, lm);
  return g.low <= 0.45 && g.high - g.low >= 0.15 && g.hips - g.low >= 0.2 && m[`knee${front(m)}`] < 140
    && g.up === front(m);
}
/** The front knee inside its ankle, side to side along the hips' line (level), in leg lengths: positive with the knee
 * in toward the other leg (caving in), negative with it out over the little toe; NaN without a hips' line to go by. */
function kneeIn(m, lm) {
  const s = front(m), W = i => lm.world[i], [kn, an] = s === 'L' ? [25, 27] : [26, 28];
  const lx = W(23).x - W(24).x, lz = (W(23).z ?? 0) - (W(24).z ?? 0), n = Math.hypot(lx, lz);
  if (!(n > 1e-6)) return NaN;
  const across = p => (p.x * lx + (p.z ?? 0) * lz) / n;
  return (s === 'L' ? 1 : -1) * (across(W(an)) - across(W(kn))) / m.legLen;
}

// Kneel on one knee and stand up; half-kneel to stand. The same two guard rails for both, measured on the library's
// reference skeletons (seen as MediaPipe landmarks, as tools/build_moves.mjs skeletonLandmarks does), MediaPipe on
// the library's own footage of both (front view), the library's other kneels and lunges, and the user's recordings
// (none of them kneels: lunges, squats, push-ups, holds, standing and walking to the camera).
// Left out, measured. The front knee far past the toes, or the front foot too close for a stable half-kneel: the
// references kneel that way themselves (the front knee bent to about 50 deg, its shin held 49 and 24 deg forward of
// vertical; MediaPipe on their footage 57-71 and 8-29), so no line tells a fault from their own form. Not standing
// fully tall at the top: a frame cannot tell the top of the rise from the rise itself (on the half-kneel's footage
// MediaPipe put the hips 0.9-1.0 leg lengths up while the knees were still at 103-117 deg), and once up the person
// stands still, which is not judged.
// Both are `still` checks (moveform.js): judged on every kneeling frame, moving or not, from the person's first
// movement after the movement was named. These movements are mostly held: judged only on the frames the tracker counts
// as moving, after each run's warm-up, neither reference was judged at all at its own pace (the kneel holds still past
// PAUSE_MS, each rise a new run inside its warm-up; the half-kneel rises within its first warm-up), and a 60 deg fold
// was never told. The phases keep a person at rest out: standing, sitting or lying down is not kneeling on one knee.
const TALL = {
  id: 'torso_fold', name: 'torso tall while kneeling', label: 'torso folding forward while kneeling', part: 'trunk',
  needs: ['legs', 'trunk'], at: 'frame', still: true, order: 1, phase: kneeling,
  // the trunk's lean forward (bodyMetrics trunkLeanFwd), kneeling. The reference skeletons lean 0-28 deg kneeling (the
  // most as they push up off the knee); MediaPipe on their footage 25-39 (its world landmarks are the camera's axes: a
  // camera pitched down adds its pitch, here 15-20 deg, standing as kneeling). The library's low lunge folding its
  // hands to the mat reads 63-66, a kneeling bow 82-106; the user's lunges -7 to 28 (their camera reads them standing
  // at 0-6). The line at 55 leaves the footage 16 deg of room: a person leaning 35 deg before such a camera is told,
  // one kneeling tall never. Past 120 deg either way the trunk would point at the floor: not a kneel but MediaPipe's
  // trunk flipped (a few frames of the user's recordings: 137-166)
  value: m => (Math.abs(m.trunkLeanFwd) <= 120 ? m.trunkLeanFwd : NaN), bad: v => v > 55, ok: v => v <= 50,
  measured: v => `torso leaning ${r0(v)} degrees forward while kneeling`,
  target: 'torso tall over the hips, within about 20 degrees of upright',
  cue: 'Lift your chest and keep your torso tall over your hips while you kneel.',
};
const KNEE = {
  id: 'front_knee_in', name: 'front knee over the foot', label: 'front knee caving in', part: 'knee', side: front,
  needs: ['legs'], views: ['front'], at: 'frame', still: true, order: 2,
  // squarely facing the camera only (frontness 0.6 and up; the footage 0.66-1.03, the user's lunges 0.63-0.77): the
  // knee's place side to side lies in the picture there, while turned half away MediaPipe guesses it in depth (a
  // reverse lunge's footage at frontness 0.2-0.5: the front knee 0.07-0.16 leg lengths in where its skeleton has it
  // 0.08-0.14 out)
  phase: (m, lm) => m.frontness >= 0.6 && pushingUp(m, lm),
  // the front knee inside its ankle (kneeIn), kneeling and pushing up. The reference skeletons 0.13 out to 0.02 out;
  // MediaPipe on their footage 0.23 out (the kneel) to 0.06 in (the half-kneel), on a split squat's 0.18 to 0.02 out,
  // the user's lunges 0.11 out to 0.03 in. A knee 0.15 in (about 13 cm for a 0.85 m leg: the shin tipped some 20 deg
  // in) is clearly caving; the footage keeps 0.09 of room
  value: kneeIn, bad: v => v > 0.15, ok: v => v <= 0.1,
  measured: v => `front knee ${r2(v)} leg lengths inside the foot`,
  target: 'front knee over the foot, in line with the toes',
  cue: 'Push your front knee out so it stays over your foot.',
};

export default {
  kneel_and_stand: [TALL, KNEE],
  half_kneel_to_stand: [TALL, KNEE],
};
