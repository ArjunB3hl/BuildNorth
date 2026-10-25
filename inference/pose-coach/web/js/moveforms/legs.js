// Guard rails of the leg movements (web/js/moveform.js has the check's shape, bodyMetrics' measures and when a check
// is judged): side_kick_knee_raise, standing_side_crunch, wall_side_leg_raise, boxing_cardio_combo (track 'rhythm':
// their `rhythm.signal` in the library says which end of the movement is a 'peak' and which a 'trough'). Only clear,
// measurable mistakes, each line set from the movement's reference skeleton with a margin; never a matter of style.
// This file imports nothing from ../moveform.js (it imports this one): its helpers are its own.
//
// Measured on: the library's reference skeletons (SMPL joints seen as MediaPipe landmarks: tools/build_moves.mjs
// skeletonLandmarks), MediaPipe on the library's own footage of each movement (from the front; the wall leg raise's
// from behind), and the user's nine live recordings (2026-10-23 to 25: squats, lunges, knee raises, skips, jumping
// jacks, push-ups, held poses, standing, resting, walking to and from the camera), with each movement here named over
// the whole of each. None of them is one of these movements, so every cycle found in them is something else: nothing
// here is told on any of them.
//
// A part of the movement between the rhythm's two turns (the side kick's kick between its knee drives, where kneeMin
// is flat; the combo's knee drives between its squats) is judged over the whole cycle (`over` 'cycle'): one half
// cycle holds it or not as a degree or two at a flat turn falls, and a frame check on the lift's frames alone never
// saw a fault fixed (each lift's first frames, alone in SMOOTH_MS, read under the line: a good kick's at 30-33 deg).
//
// Dropped, and why:
//   - The leg barely sweeping out (wall leg raise, or side crunch below 35 deg): steps, skips and jumping jacks in
//     the negative recordings reach 22-34 deg, so these small lifts cannot be judged conservatively. The side crunch
//     now checks straight outward lifts above that band with a visibly straighter supporting leg.
//   - The trunk leaning away from the swept leg, not crunching toward it (side crunch). Measured from upright, the
//     reference leans away from its leg 18-20 deg at the top of each sweep, MediaPipe on its footage 13-14, the
//     user's live set 6-16: the hips hike with the leg and the trunk goes with them, so the user leaned away less
//     than the reference. Against the pelvis (the lean toward the leg plus the hips' tilt up on its side), the
//     reference bends 11-13 deg toward it, the footage 17-20, the user -2 to 11 (half of their sweeps under 5); but
//     MediaPipe's hip line reads -7 to 3 deg off level on the user standing still (the 5th to 95th percentile over
//     their recordings), so a line under the reference's 11 sits within that noise of the user's sweeps either side.
//   - The pelvis hiking with the wall leg raise: the reference tilts its pelvis 24-26 deg at every top (a leg raised to
//     80 deg needs it: the hip itself opens about 45), and MediaPipe on the footage reads 20-32 deg, top and bottom
//     alike; no line separates a hike from a good high raise.
//   - Squats not bending (boxing combo): one bending less than the rhythm's prominence (31 deg) is no cycle, so never
//     judged, and MediaPipe from the front reads the reference's 90-degree squats at 117-133: a depth line is noise.

const r0 = v => String(Math.round(v));
const r2 = v => v.toFixed(2);
const FRONTAL = ['front', 'angled'];
const other = s => (s === 'L' ? 'R' : 'L');
/** A leg's measure `name` (bodyMetrics' `${name}L` / `${name}R`). */
const of = (m, name, s) => m[`${name}${s}`];
/** The leg with the more bent knee, 'L' or 'R'. */
const bentLeg = m => (m.kneeL <= m.kneeR ? 'L' : 'R');
/** The leg with the higher ankle (the lifted one), 'L' or 'R'. */
const liftedLeg = m => (m.ankleUpL >= m.ankleUpR ? 'L' : 'R');
const raisedLeg = m => (m.thighFromDownL >= m.thighFromDownR ? 'L' : 'R');

/** The counter needs the visible trunk upright, including while the support knee bends incorrectly. This rejects
 * the recording's inverted tracking during setup; it is not movement recognition. Hips and knees must also be seen. */
export const sideCrunchStanding = m => !!m?.seen.trunk && m.trunkTilt < 50;

/** A knee drive: the more bent knee up, its thigh clearly lifted, its foot well off the floor, on a standing leg. The
 * knee folded to 100 deg or less: a drive folds it to 50-95 (the side kick's reference 62-66, its footage 79-94, the
 * user's own knee raises 49-73), while skipping and jogging fold it to 100-130 with the thigh at 35-55, and the user's
 * knee lifts while moving about, the thigh at 47-52 twice within seconds, to 104-107 (the recordings). The thigh 45 deg
 * up or more (a walking stride's swing reaches about 35: engine.js's knee raise), the foot 0.15 leg lengths above the
 * other, the other knee 140 or straighter (a squat bends both, its feet down). */
const driving = m => {
  const s = bentLeg(m);
  return of(m, 'knee', s) <= 100 && of(m, 'thighFromDown', s) >= 45 && of(m, 'ankleUp', s) >= 0.15
    && of(m, 'knee', other(s)) >= 140;
};
/** A kick: the lifted leg out straight (its knee 145 or straighter), its thigh `from` deg up or more, out to the side
 * (thighPlane 60 or less: the side kick's reference kicks at 38-42, its footage 13-21; a stride or a knee drive points
 * forward), its foot 0.1 leg lengths above the other. */
const kicking = (m, from) => {
  const s = liftedLeg(m);
  return of(m, 'knee', s) >= 145 && of(m, 'thighFromDown', s) >= from && of(m, 'thighPlane', s) <= 60
    && of(m, 'ankleUp', s) >= 0.1;
};
/** A leg swept out to the side, at the top of the sweep: its thigh 35 deg out or more (the references sweep to 72-83,
 * MediaPipe on their footage to 60-88; the user's steps, skips and jumping jacks that counted as sweeps reached 22-34),
 * out to the side (thighPlane 55 or less: the footage's sweeps 1-40 at the top), its foot 0.06 leg lengths above the
 * other (a jumping jack lands both feet). */
const sweeping = m => {
  const s = liftedLeg(m);
  return of(m, 'thighFromDown', s) >= 35 && of(m, 'thighPlane', s) <= 55 && of(m, 'ankleUp', s) >= 0.06;
};

/** The knee drive's height (side kick, boxing combo): the driving thigh from straight down (bodyMetrics
 * thighFromDown), its highest over `over` up to the rhythm's trough (the side kick's troughs are its drives; the
 * combo's are its squats, a drive in each cycle between them). The line at 55: 35 deg short of hip height, and 20
 * under MediaPipe's lowest reading of a good drive (the combo's footage, front on, the thigh in depth: 75-78). */
const kneeDrive = (order, over) => ({
  id: 'knee_drive_low', name: 'knee drive to hip height', label: 'knee drive below hip height', part: 'knee',
  side: bentLeg, needs: ['legs'], at: 'trough', take: 'max', ...(over ? { over } : {}), order, phase: driving,
  value: m => of(m, 'thighFromDown', bentLeg(m)), bad: v => v < 55, ok: v => v >= 62,
  measured: v => `knee driven up to ${r0(v)} degrees (hip height is 90)`,
  target: 'the thigh up level with the hip, about 90 degrees', cue: 'Drive your knee up to hip height.',
});
/** The standing knee at the top of a sweep (side crunch, wall leg raise): the lower leg's, at the rhythm's peak (the
 * feet widest). A soft knee is right (the wall raise's coaching asks for one); only a deep bend is told, under 115 deg
 * (a quarter squat on one leg). MediaPipe from the front reads a bend short (it lies in depth: the combo's 90-degree
 * squats read 117-133), so a knee it reads under 115 is bent further still. */
const standingKnee = order => ({
  id: 'standing_knee', name: 'standing leg long', label: 'standing knee bent a lot', part: 'knee',
  side: m => other(liftedLeg(m)), needs: ['legs'], at: 'peak', order, phase: sweeping,
  value: m => of(m, 'knee', other(liftedLeg(m))), bad: v => v < 115, ok: v => v >= 125,
  measured: v => `standing knee bent to ${r0(v)} degrees`, target: 'standing leg long, the knee soft',
  cue: 'Stand tall on your standing leg; keep that knee nearly straight.',
});

/** The sweeping leg's knee (standing side crunch), one check per side: `s` 'L' or 'R'. The leg in view by its own
 * landmarks alone (its `needs`): a camera close in loses the standing foot first (the user's live side crunch had both
 * ankles at the picture's bottom edge throughout, the swept one in the frame at the top of each sweep), and the check
 * is unseen while that leg is out of view. Judged on the sweep's upper part, from the turn before up to the rhythm's
 * peak (the feet widest), its most bent frame (each frame the median of it and its neighbours): the lifted leg 50 deg
 * out or more, not straight ahead (thighPlane 70 or less: MediaPipe put the user's sweeps at 36-68, the 10th to 90th
 * percentile, their knee raises at 83-90), the foot off the floor, and an upright trunk with a support knee above
 * 125 deg or a hip open at least 140. Knee flexion is the fault being measured, never a reason to skip the check:
 * the user's strongly bent sweeps pass below 100 deg. The support keeps bent-leg skips (hips 121-127, knees 103-111)
 * out without excluding those sweeps. The reference's swept knee reads 147-155 at its most bent over a sweep (at every pace, mirrored,
 * with jitter), MediaPipe on its footage 148-151. The user's live set: a first sweep straight (156), then 120-135, the
 * knee bent through the top (their sweeps under 50 deg out were not judged, nor those with the leg out of view). The
 * line at 130 leaves 18 deg of room under the footage. */
const sweptKnee = (s, order) => ({
  id: `swept_knee_${s === 'L' ? 'left' : 'right'}`, name: `${s === 'L' ? 'left' : 'right'} sweeping leg straight`,
  label: 'sweeping leg bent', part: 'knee', side: () => s, needs: [`leg${s}`], at: 'peak', take: 'min', order,
  phase: m => liftedLeg(m) === s && of(m, 'thighFromDown', s) >= 50 && of(m, 'thighPlane', s) <= 70
    && of(m, 'ankleUp', s) >= 0.06 && m.trunkTilt < 50
    && (Math.max(m.hipL, m.hipR) >= 140 || of(m, 'knee', other(s)) > 125),
  value: m => of(m, 'knee', s), bad: v => v < 130, ok: v => v >= 138,
  measured: v => `sweeping knee bent to ${r0(v)} degrees`, target: 'the sweeping leg long and straight',
  cue: 'Keep your sweeping leg straight as you lift it out to the side.',
});

/** Height of a straight sweep. The reference reaches 72-83 deg, footage 60-88; the user's low sweeps 34-48 and high
 * sweeps 99 / 126 (three-frame medians). Measure the maximum over the rise, never its lower passing frames. Below
 * 35 is ambiguous with steps / jacks; forward knee drives and bent sweeps are excluded. One check across sides:
 * MediaPipe briefly swaps the legs at a high lift, which must not split its evidence into two different sweeps. */
const sweepHeight = high => ({
  id: high ? 'sweep_high' : 'sweep_low', name: high ? 'leg lift no higher than hip height' : 'leg lifted toward hip height',
  label: high ? 'sweeping leg lifted too high' : 'sweeping leg lifted too little', part: 'leg', side: raisedLeg,
  needs: ['legs', 'trunk'], views: FRONTAL, at: 'peak', take: 'max', order: high ? 4 : 5,
  phase: m => {
    const s = raisedLeg(m);
    return of(m, 'thighFromDown', s) >= 35 && of(m, 'thighPlane', s) <= (high ? 60 : 40)
      && of(m, 'ankleUp', s) >= 0.06 && of(m, 'knee', s) >= 145
      && of(m, 'knee', other(s)) >= (high ? 125 : 140) && m.trunkTilt < 50;
  },
  value: m => of(m, 'thighFromDown', raisedLeg(m)),
  bad: v => high ? v > 95 : v < 50, ok: v => high ? v <= 90 : v >= 55,
  measured: v => `sweeping thigh lifted to ${r0(v)} degrees from down (hip height is 90)`,
  target: high ? 'lift toward hip height, not above it' : 'lift the straight leg toward hip height',
  cue: high ? 'Keep the lift controlled, no higher than hip height.' : 'Lift your straight leg higher, toward hip height.',
});

export default {
  // Side kick to twisting knee raise: a straight leg kicked out to the side, then its knee driven up across the body,
  // one side at a time. Its rhythm signal is the more bent knee (kneeMin): its troughs are the knee drives, and each
  // cycle from one drive to the next holds one kick.
  side_kick_knee_raise: [
    { ...kneeDrive(1),
      // over the half cycle up to each drive (the drive is the trough). The reference drives to 103-108 deg, MediaPipe
      // on its footage to 97-104 and on the user's own knee raises (front on) to 83-100. The user's knee lifts while
      // moving about with it named read 47-100: two under the line 2.3 s apart would be a fault at 60, none at 55
    },
    { id: 'kick_low', name: 'kick to hip height', label: 'kick too low', part: 'leg', side: liftedLeg,
      needs: ['legs'], views: FRONTAL, at: 'trough', take: 'max', over: 'cycle', order: 2, phase: m => kicking(m, 40),
      // the kicking thigh from straight down, its highest over the cycle from one knee drive to the next. The reference
      // kicks to 82-91 deg, MediaPipe on its footage to 68-73. The line at 50: 40 deg short of hip height, 18 under the
      // footage. Judged on a kick 40 deg up or more: the user's legs lowering straight from a knee lift while moving
      // about passed for kicks of 31-39 deg (four cycles over the recordings; judged from 30, one of them and a 43
      // 4.5 s later were a fault), and the two cycles left read 43 and 63, 45 s apart. (The reference played out and
      // back ends a kick at 41 deg where the clip ends, once in four cycles: 1 of 3 bad.) From the front: the kick
      // lies in the picture there
      value: m => of(m, 'thighFromDown', liftedLeg(m)), bad: v => v < 50, ok: v => v >= 56,
      measured: v => `kick up to ${r0(v)} degrees (hip height is 90)`, target: 'the kick out at hip height',
      cue: 'Kick your leg out higher, toward hip height.' },
    { id: 'lean_over', name: 'trunk upright as you kick', label: 'leaning far over the standing leg', part: 'trunk',
      needs: ['legs', 'trunk'], views: FRONTAL, at: 'frame', order: 3, phase: m => kicking(m, 45),
      // the trunk's lean to the side (bodyMetrics trunkLeanSide) toward the standing leg (positive), on the frames of
      // the kick well up: the reference -9 to 5 deg (a little toward the kick), MediaPipe on the footage -3 to 7. The
      // kick only: the twisting knee raise brings the trunk down to the knee, toward the standing side. The line at
      // 30 leaves 23 deg of room. A frame check (the kick lies between the rhythm's turns), its value about as steady
      // through a kick as the trunk is. From the front (the body's frontal plane)
      value: m => (liftedLeg(m) === 'L' ? -m.trunkLeanSide : m.trunkLeanSide), bad: v => v > 30, ok: v => v <= 24,
      measured: v => `trunk leaning ${r0(v)} degrees over the standing leg`,
      target: 'trunk upright, within about 15 degrees', cue: 'Stay tall as you kick; keep your chest up.' },
  ],
  // Standing side crunch: a straight leg swept out to the side, the trunk crunching toward it, one side at a time.
  // Its form follows thigh peaks; its approximate count combines thigh lifts and visible feet width. The standing
  // knee needs both legs in view: its angle is the shin's direction, and with the foot below the picture's edge (the
  // user's first two live sets) MediaPipe guesses where the shin goes; nothing showed that guess right for a bent
  // knee, and a guess that reads it straight would call the leg fine unseen. Out of view, the page asks to step back.
  standing_side_crunch: [
    { ...standingKnee(1),
      // at each peak: the reference's standing knee 149-156 deg (its SMPL knees never read straight), MediaPipe on the
      // footage 165-167; the line at 115 leaves 34 deg of room
    },
    sweptKnee('L', 2), sweptKnee('R', 3),
    sweepHeight(true), sweepHeight(false),
  ],
  // Wall-supported side leg raise: a straight leg raised out to the side, a hand on the wall. Its rhythm signal is the
  // feet's spread (feetWidth): its peaks are the leg up.
  wall_side_leg_raise: [
    { id: 'lean_side', name: 'trunk upright', label: 'trunk leaning far sideways', part: 'trunk',
      needs: ['trunk', 'legs'], views: FRONTAL, at: 'peak', order: 1, phase: sweeping,
      // the trunk's lean to either side at each peak (|trunkLeanSide|): the reference 7-23 deg, MediaPipe on the
      // footage 21-27 (toward the wall it holds, away from the leg). The line at 40 leaves 13 deg of room over the
      // footage, near half way to level: leaning on the wall to lift the leg. From the front or behind (the body's
      // frontal plane)
      value: m => Math.abs(m.trunkLeanSide), bad: v => v > 40, ok: v => v <= 34,
      measured: v => `trunk leaning ${r0(v)} degrees to the side`, target: 'trunk upright, the wall for balance only',
      cue: 'Stand tall; lean on the wall less and lift from the hip.' },
    { ...standingKnee(2),
      // at each peak: the reference's standing knee 131-160 deg (the clip's last raise sinks on it), MediaPipe on the
      // footage 158-168; the line at 115 leaves 16 deg of room
    },
  ],
  // Boxing cardio combo: punches, squats and knee drives. Its rhythm signal is the straighter knee (kneeMax): its
  // troughs are the squats' bottoms, and each cycle from one squat to the next holds one knee drive (left, then right).
  boxing_cardio_combo: [
    { id: 'knees_in', name: 'knees over the feet in the squats', label: 'knees caving in on the squats',
      part: 'knees', needs: ['legs'], views: ['front'], at: 'trough', order: 1,
      // a squat: both knees bent (150 or less), both feet down (an ankle within 0.12 leg lengths of the other; a knee
      // drive's standing knee bends too). The knees apart on screen over the ankles apart, as engine.js
      // kneeToAnkleGap: the picture sees them directly from the front (bodyMetrics kneeGap, through MediaPipe's world
      // depth, read 0.2 lower on a squat of the user's the engine found fine); not with the feet together (under 0.15
      // leg lengths apart: the ratio is noise). The reference 0.9-1.1 at the bottom, MediaPipe on the footage 1.0, the
      // user's squats 0.9-2.3. The line at 0.7 is under engine.js's squat line (0.8)
      phase: m => m.kneeL <= 150 && m.kneeR <= 150 && Math.abs(m.ankleUpL) < 0.12,
      value: (m, lm) => (m.stanceWidth >= 0.15
        ? Math.abs(lm.image[25].x - lm.image[26].x) / Math.abs(lm.image[27].x - lm.image[28].x) : NaN),
      bad: v => v < 0.7, ok: v => v >= 0.76,
      measured: v => `knees ${r2(v)} of your feet's width apart at the bottom`,
      target: 'knees out over the toes', cue: 'Push your knees out over your toes as you squat.' },
    { ...kneeDrive(2, 'cycle'),
      // over the cycle from one squat to the next. The reference drives to 86-110 deg, MediaPipe on its footage to
      // 75-78. The drives alternate sides, so one side low is bad on every other cycle: 2 of 3, told (its side the low
      // one's). The user's recordings: six cycles judged at 47-101, the two under the line 18 s apart (their verdicts
      // expire: VERDICT_MIN_MS)
    },
  ],
};
