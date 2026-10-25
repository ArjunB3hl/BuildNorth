// Guard rails of the arm movements (web/js/moveform.js has the check's shape, bodyMetrics' measures and when a check
// is judged): shoulder_external_rotation, y_to_w_raise, step_touch_arm_swings (track 'rhythm': their `rhythm.signal`
// in the library says which end of the movement is a 'peak' and which a 'trough'). Only clear, measurable mistakes,
// each line set from the movement's reference skeleton with a margin; never a matter of style.
// This file imports nothing from ../moveform.js (it imports this one): its helpers are its own.
//
// Measured on (2026-10-25; tests/moveforms-arms.test.mjs runs each): the library's reference skeleton of each
// movement, played out and back through the movement tracker with its landmarks (as the page), at its own pace and
// twice it, mirrored, and with MediaPipe-sized jitter; MediaPipe on the library's own footage of it, played the same
// way; the reference with each fault put in; and the user's nine live recordings (squats, lunges, jumping jacks,
// skips, a knee raise, push-ups, two held poses, standing about and walking to the camera; none of these movements)
// with each movement named over the whole recording. The numbers are the values a check took on the cycles judged.
//
// What counts as the movement (each check's `phase`). The rhythm count takes any swing of its signal, whatever the
// person is doing, so a check judges a cycle only where the body is in the movement's own shape: standing, for the
// two done standing still in the legs, and the arms where the movement puts them. Without it, with the user's
// recordings named as these movements, cycles of walking up to the camera were judged (MediaPipe there: the trunk
// read upside down, the ankles at the top of the picture) and faults came from them; with it, none is judged.

const r0 = v => String(Math.round(v)), r2 = v => v.toFixed(2);
const DEG = 180 / Math.PI;
const FRONTAL = ['front', 'angled'];
/** The side whose measure `name` (bodyMetrics' `${name}L` / `${name}R`) is past `line`: 'L', 'R', or null for both
 * (then the larger, should neither be on its own frame). */
const sideOver = (m, name, line) => {
  const L = m[`${name}L`] > line, R = m[`${name}R`] > line;
  if (L && R) return null;
  return L ? 'L' : R ? 'R' : m[`${name}L`] >= m[`${name}R`] ? 'L' : 'R';
};
/** ...and the side whose measure is under `line` (both: null; neither: the smaller). */
const sideUnder = (m, name, line) => {
  const L = m[`${name}L`] < line, R = m[`${name}R`] < line;
  if (L && R) return null;
  return L ? 'L' : R ? 'R' : m[`${name}L`] <= m[`${name}R`] ? 'L' : 'R';
};

/** Standing on both feet, upright, at a steady distance from the camera: MoveForm's floor known (the legs in view, no
 * nearer or further than over the last few seconds) and the lower ankle on it, both knees straight and the trunk
 * upright. The two references' knees 161-171 deg, MediaPipe on their footage 149-163; the trunk at most 7 deg off
 * upright, MediaPipe 18. The user standing still: the more bent knee under 140 on 5% of frames, the trunk over 25 deg
 * on 1%. Walking up to the camera, the floor was known on a quarter of the frames with the legs in view. */
const standing = m => Number.isFinite(m.feetLift) && m.feetLift < 0.15 && m.kneeL > 135 && m.kneeR > 135
  && m.trunkTilt < 30;
/** Shoulder external rotation's shape: standing, both elbows bent and both upper arms below level. Its reference's
 * elbows 86-97 deg, MediaPipe on the footage 98-119 (it reads them straighter as the forearms turn out); the user's
 * arms hanging read 144 at the more bent elbow (the median; under 85 on 5% of frames), so arms let down are not
 * judged. An upper arm 75 deg out is raised, not drifting (the fault caught is 45-75): the user's jumping jacks,
 * named as this movement, read 75-105 at the hands' widest. */
const rotating = m => standing(m) && m.elbowL < 135 && m.elbowR < 135 && m.armL < 75 && m.armR < 75;

/** A W: both upper arms under 60 deg from the sides, the straighter elbow bent under 125, both forearms turned out 15
 * deg or more past straight ahead. The reference's W: elbows at most 86 deg, the forearms 36 deg out or more;
 * MediaPipe on its footage 98-105 and 30 or more. The user standing about: the elbows bent with the arms down on 40%
 * of the frames labelled still (hands on the hips, together in front), the forearms out as well on 8 of 8231; never
 * in a jumping jack (arms down there: straight). */
const isW = (m, lm) => {
  const f = forearmsOut(lm);
  return m.armL < 60 && m.armR < 60 && Math.max(m.elbowL, m.elbowR) < 125 && Math.min(f.L, f.R) >= 15;
};
/** The Y-to-W raise's shape: standing, and both arms raised (over 60 deg: the Y, on the way to it and from it), or a
 * W. */
const yToW = (m, lm) => standing(m) && ((m.armL > 60 && m.armR > 60) || isW(m, lm));

/** The forearm turned out less than `line` on a frame (forearmsOut of its landmarks): 'L', 'R', null for both
 * (neither: the lesser). */
const forearmSide = (lm, line) => {
  const f = forearmsOut(lm);
  if (!(f.L >= line) && !(f.R >= line)) return null;
  return f.L <= f.R ? 'L' : 'R';
};
/** How far each forearm (elbow to wrist) turns out to its own side, from pointing straight ahead: degrees, 0 forward
 * (or straight down), 90 out to the side, negative across the body ({L, R}; NaN without landmarks). Its outward part
 * along the hips' line (the body's left) over its length: from the front that part lies across the picture, where
 * MediaPipe measures, and the forward part, in depth, is left out. */
function forearmsOut(lm) {
  const W = lm?.world;
  if (!W || W.length < 25) return { L: NaN, R: NaN };
  const lx = W[23].x - W[24].x, lz = (W[23].z ?? 0) - (W[24].z ?? 0), n = Math.hypot(lx, lz);
  if (!(n > 1e-6)) return { L: NaN, R: NaN };
  const out = (el, wr, sign) => {
    const d = [W[wr].x - W[el].x, W[wr].y - W[el].y, (W[wr].z ?? 0) - (W[el].z ?? 0)], len = Math.hypot(...d);
    const across = (sign * (d[0] * lx + d[2] * lz)) / n;
    return len > 1e-6 ? Math.asin(Math.max(-1, Math.min(1, across / len))) * DEG : NaN;
  };
  return { L: out(13, 15, 1), R: out(14, 16, -1) };
}

export default {
  // Shoulder external rotation: elbows bent to 90 deg at the sides, the forearms turning out and back. Its rhythm
  // signal is the hands' spread across the picture (counted from the front only), so its peak is the hands out: where
  // an elbow drifting off the side, or a forearm not turning out, shows most. Both judged from the front only, as the
  // count (SIGNALS wristSpread): an elbow drifting forward lies in depth there, the forearm's turn across the picture.
  shoulder_external_rotation: [
    { id: 'elbows_out', name: 'elbows at your sides', label: 'elbows drifting off the sides', part: 'elbow',
      side: m => sideOver(m, 'arm', 45), needs: ['arms', 'trunk', 'legs'], views: ['front'], at: 'peak', order: 1,
      phase: rotating,
      // the upper arm from the torso (bodyMetrics armL/R, the further arm), at each peak (`take` 'at': the median of
      // the frames around the hands' widest). The reference skeleton: 17-21 deg with the hands together, 27-29 at its
      // far end (its elbows drift out a little as the hands go wide), 29 at every peak played out and back, at twice
      // its pace and mirrored the same, 28-33 with jitter; MediaPipe on its footage 31. Its upper arms turned 20 deg
      // out from the sides read 48 at the peaks, one 30 deg out 57. The line at 45 leaves the reference 12 deg of room
      // over its highest reading (a person whose elbows sit a little wider), and an elbow 45 deg off the side is
      // clearly not pinned (engine.js's biceps curl calls 40 elbow drift)
      value: m => Math.max(m.armL, m.armR), bad: v => v > 45, ok: v => v <= 40,
      measured: v => `elbow ${r0(v)} degrees out from your side as your hands turn out`,
      target: 'elbows tucked in at your sides, within about 30 degrees',
      cue: 'Keep your elbows pinned to your sides as you turn your hands out.' },
    { id: 'forearm_not_out', name: 'forearms turning out', label: 'forearm not turning out', part: 'arm',
      side: (m, lm) => forearmSide(lm, 10), needs: ['arms', 'trunk', 'legs'], views: ['front'], at: 'peak', order: 2,
      phase: rotating, after: ['elbows_out'],
      // the forearm that turns out less (forearmsOut), at each peak: the reference 41 deg out past straight ahead at
      // every peak (it starts with the hands together, the forearms 46 deg across the body), 37-42 with jitter,
      // MediaPipe on its footage 40. Its forearms held from turning past 5 deg out read 5 at the peaks, past 0 read 0:
      // the hands still spread across the picture far enough for a cycle (from together to straight ahead), so the
      // count runs and the forearm is judged; one forearm held, the other turning, the same, on its side. Held at
      // 20 deg the forearm passes (a small turn is not called wrong): the line at 10 is a forearm that never turns
      // past straight ahead. Held back while an elbow drifts off the side (the forearm's angle then says little)
      value: (m, lm) => { const f = forearmsOut(lm); return Math.min(f.L, f.R); },
      bad: v => v < 10, ok: v => v >= 15,
      measured: v => (v > 0 ? `forearm turned only ${r0(v)} degrees out past straight ahead`
        : 'forearm not turning out past straight ahead'),
      target: 'both forearms turning out, about 40 degrees past straight ahead',
      cue: 'Turn both forearms out to the sides, keeping your elbows at your waist.' },
  ],
  // Y-to-W raise: the arms long and overhead in a Y, then pulled down into a W, the elbows bent toward the ribs. Its
  // rhythm signal is the higher arm against the torso: its peak is the Y, its trough the W. Judged standing, from the
  // front or angled: the Y lies in the body's frontal plane, in depth from the side.
  // Each Y is judged at the W after it (`at` 'trough', `take` 'max' over the half cycle from the Y down: the most the
  // arms reached there), and only when the arms come down into a W (the frames at the trough must pass the phase:
  // yToW, a W there): judged at the Y itself, any two arms raised were a Y. On the user's recordings named as this
  // movement, the arms flicked up to 112-128 deg twice, standing still, and jumping jacks were told "reach your arms
  // all the way up into a wide Y"; now none of their cycles is judged (no W after them). A frame of the half cycle
  // with the arms down is the W itself: the values below say which frames count
  // No check of the W (the elbows not bent there): arms lowered straight are arms at rest. The user's arms hanging
  // read 144 deg at the elbow (the median), a W lowered straight 150-180, the reference's W 69 (MediaPipe on its
  // footage 98), and every rest between two arm raises is a trough of the signal. With the user's recordings named
  // as this movement, a W check (the straighter elbow at the trough over 130 deg, standing) told three faults, two of
  // them on a cycle of the arms at rest: after reaching back from the camera, after a one-arm raise. The trough cannot
  // tell a W from a rest without the Y before it, which a cycle check is not given. Judged over the whole cycle
  // instead (`over` 'cycle': the straighter elbow at its most bent while both arms pass 45-75 deg, standing), rests
  // and one-arm raises are left out (the reference 93, 89-94 with jitter, MediaPipe on its footage 110), but any two
  // arms swinging through that height are judged: on the user's recordings 17 cycles, 10 bad (jumping jacks, skips,
  // squats with the arms raised, moving about between exercises, some on 1-2 frames of the swing), and two faults
  // told, one of them moving about. Not clear enough to tell anyone to bend their elbows.
  y_to_w_raise: [
    { id: 'short_of_y', name: 'arms up in a full Y', label: 'arms short of the Y', part: 'arm',
      side: m => sideUnder(m, 'arm', 120), needs: ['arms', 'trunk', 'legs'], views: FRONTAL, at: 'trough',
      take: 'max', order: 1, phase: yToW,
      // the lower arm from the torso, at its highest from the Y down to the W: the reference 140 deg, 139-147 with
      // jitter, MediaPipe on its footage 141-143. Its arms' rise from straight down scaled by 0.75 read 106 (one arm
      // 109, on its side), held to 110 deg 118, held to 125 deg 130 (passes). The line at 120: an arm no more than
      // about 30 deg above level is not overhead. At most 60 the arms never rose together before the W (the highest
      // is the W's own): no Y to judge, neither bad nor fine
      value: m => Math.min(m.armL, m.armR), bad: v => v > 60 && v < 120, ok: v => v >= 125,
      measured: v => `arm raised ${r0(v)} degrees from your side at the top`,
      target: 'arms long and overhead in a Y, about 140 degrees from your sides',
      cue: 'Reach your arms all the way up overhead into a wide Y.' },
    { id: 'arms_forward', name: 'arms out to the sides', label: 'arms drifting forward in the Y', part: 'arm',
      side: m => sideOver(m, 'armPlane', 70), needs: ['arms', 'trunk', 'legs'], views: FRONTAL, at: 'trough',
      take: 'max', order: 2, phase: yToW,
      // where the more forward upper arm points, seen from above, against the shoulders' line (bodyMetrics armPlane:
      // 0 out to the side, 90 forward), the most over the frames with both arms over 100 deg from the Y down to the W
      // (-1 on the others: with none, neither bad nor fine): the reference 28 deg, 31-42 with jitter, MediaPipe on its
      // footage 30-49 (it puts the arms overhead further forward in depth than they are, 38-41 at the Y itself); the
      // user's jumping jacks, judged at their tops before, 8-27 (the arms overhead, out to the sides). Its arms
      // turned 50 deg forward read 78, one arm 60 deg 83, on its side; turned 30 deg 58, passing (a Y a little in
      // front of the body is still a Y). The line at 70 leaves MediaPipe's highest reading of the reference 21 deg
      value: m => (m.armL > 100 && m.armR > 100 ? Math.max(m.armPlaneL, m.armPlaneR) : -1), bad: v => v > 70,
      ok: v => v >= 0 && v <= 60,
      measured: v => `arm ${r0(v)} degrees forward of your sides in the Y`,
      target: 'arms out to the sides in the Y, in line with your body',
      cue: 'Open your arms out to the sides in the Y, in line with your shoulders.' },
  ],
  // Step touch with overhead arm swings: a step out to the side and back, low impact, the arms swinging up overhead
  // with each step. Its rhythm signal is the lower hand's height: its peak is both hands up. Each check takes the most
  // over the half cycle up to the peak (`take` 'max'): at twice the reference's pace (a swing every 0.6 s) the frames
  // around the extreme alone miss the top of the swing (the reference's lower arm read 106-140 there, MediaPipe's
  // 104-129, and on its footage a fault was told; over the half cycle 132-148).
  step_touch_arm_swings: [
    { id: 'jumping', name: 'a foot on the floor', label: 'both feet leaving the floor', part: 'feet',
      needs: ['arms', 'trunk', 'legs'], at: 'peak', take: 'max', order: 1,
      // judged with both arms raised over 45 deg (the rising half of the swing, where a jumping jack jumps out), the
      // trunk upright, a lift no higher than 0.8 body lengths (higher is the person moving nearer the camera or a
      // landmark gone wrong: 2.4 on the user's recording, walking about), and the ankles within 0.1 m of each other in
      // depth (MediaPipe's world z, along the camera's line of sight). The floor is the lower ankle's height in the
      // picture, and with the feet apart in depth the lower one is the nearer: turned 20-45 deg to a camera (a pinhole
      // one, 0.5-1.5 m up), the reference's step to the side carries it nearer and further and read 0.22-0.69, "both
      // feet off the floor" told every few swings; with the ankles level in depth, nothing at any of those angles.
      // The ankles' depth apart: the reference 0.03 m (the median; at most 0.09), MediaPipe on its footage 0.04 (0.15
      // or more on a tenth of its frames), the user's jumping jacks under 0.08 on 90% of frames. Turned like that, a
      // hop is not judged either; facing such a camera, 0.5-1.5 m up, a 12 cm one is caught (0.15-0.26 a swing,
      // 0.21-0.25 the median). Not yet: the person drifting nearer and further facing it (0.2 m each way, 1.4-1.5 m
      // up) lifts the feet on screen too, told every few swings; only the floor at each distance can tell (withFloor)
      phase: (m, lm) => m.armL > 45 && m.armR > 45 && m.feetLift < 0.8 && m.trunkTilt < 45
        && Math.abs(lm.world[27].z - lm.world[28].z) < 0.1,
      // the lower ankle above the floor (MoveForm feetLift, in body lengths), known now with the arms overhead too (on
      // the reference's frames with both arms over 110 deg, 98%; before the steady scale, 43%): every half cycle is
      // judged (52 of 52 played out and back; before, 37). The reference 0.02-0.06 over each half cycle, up to 0.10
      // with jitter, MediaPipe on its footage 0.04-0.06. The reference lifted off the floor 12 cm twice a swing read
      // 0.18-0.27; 8 cm 0.10-0.19 and 4 cm 0.05-0.11 (both pass: too close to the jitter to call a jump). The user's
      // jumping jacks, named as this movement, 0.07-0.22 a cycle (the most of each set, frame by frame, 0.15-0.30).
      // The line at 0.2: both feet clearly off the floor (engine.js's jump: from 0.15)
      value: m => m.feetLift, bad: v => v > 0.2, ok: v => v <= 0.15,
      measured: v => `both feet ${r2(v)} body lengths off the floor`,
      target: 'one foot on the floor at all times: step, do not jump',
      cue: 'Keep it low impact: step side to side and keep one foot on the floor.' },
    { id: 'arms_not_overhead', name: 'arms reaching overhead', label: 'arms not reaching overhead', part: 'arm',
      side: m => sideUnder(m, 'arm', 110), needs: ['arms', 'trunk', 'legs'], views: FRONTAL, at: 'peak', take: 'max',
      order: 2,
      // judged with both arms swinging up (both over 45 deg, one over 75: one arm raised is not the swing), the feet
      // stepped apart (over 0.45 leg lengths: at the top of the reference's swing 0.62-1.25, MediaPipe's 0.76-1.24;
      // the user moving about between exercises with the arms raised, 0.29, the median, and told "arm raised 81
      // degrees" at a third of the frame rate before), the knees over 90 (the reference's bend to 103, MediaPipe's
      // 108) and the trunk upright (MediaPipe on the footage leans it up to 35 deg)
      phase: m => Math.min(m.armL, m.armR) > 45 && Math.max(m.armL, m.armR) > 75 && m.stanceWidth > 0.45
        && m.kneeL > 90 && m.kneeR > 90 && m.trunkTilt < 45,
      // the lower arm from the torso, at its highest in the swing up: the reference 132-148 deg (at its own pace and
      // twice it), 128-152 with jitter, MediaPipe on its footage 139-151. Its arms' rise scaled by 0.7 read 93-107, one
      // arm 99-109 (on its side); held to level 91-95. The line at 110 leaves the reference's lowest swing 18 deg of
      // room: an arm no more than about 20 deg above level is not overhead
      value: m => Math.min(m.armL, m.armR), bad: v => v < 110, ok: v => v >= 115,
      measured: v => `arm raised ${r0(v)} degrees from your side at the top of the swing`,
      target: 'both arms swinging up overhead, about 140 degrees from your sides',
      cue: 'Swing both arms all the way up overhead.' },
  ],
};
