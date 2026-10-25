// The form of a held pose (web/js/moves.js, track 'hold'): what the camera can measure of a few held poses, each
// fault raised only once it lasts, one correction at a time, and its fix noticed. Pure ES module (no DOM): the page
// and the Node tests share it.
//
//   const m = poseMetrics(world, image, aspect)   // one frame's measures (MediaPipe world + image landmarks)
//   const hf = new HoldForm({ key })              // a HOLD_FORMS key; hf.reset() at each new hold
//   events = hf.update(m, tMs)                    // [{type: 'hold_fault', fault, label, measured, target, cue, part,
//                                                 //   side} | {type: 'hold_fix', fault, label}]
//   hf.state()                                    // now: {checked, open, pending, unseen, wrongView} (below)
//   hf.summary()                                  // the hold so far: {checked, faults: [{fault, label, fixed, told}]}
//   hf.settle(tMs)                                // the hold was told now (hold_start): what is open counts as told
//   const ip = new InPose({ key })                // in the pose at all? (IN_POSE: a key of HOLD_FORMS)
//   ip.update(m, tMs)                             // 'in', 'out' (clearly out of the pose) or null (no decision: its
//                                                 // parts out of view); while 'out', ip.leftT: when the pose was
//                                                 // left, ip.lastOutT: the last frame clearly out of it
//
// state(): `open` the faults told (announced) and not fixed, the latest told first ({fault, label, measured, target,
// cue, part, side}; `measured` as now, `side` as told), whatever the frame shows now (a fault told and still there is
// never hidden); `checked` the names of the checks measured now and fine ("stance width": a check's `name`, so a list
// of them reads as what was found right); `pending` the names of the checks measured now as faults and not told yet
// (waiting their turn: AFTER_FIX_MS after a fix, NEXT_MS after the last one told, or FAULT_MS for the fault to last);
// `unseen` the names of the checks whose parts are out of the frame now (stepping back shows them); `wrongView` the
// names of the checks measurable only from another view (one in the body's frontal plane seen from the side: stepping
// back changes nothing, turning to the camera does). The form is fine only with something checked and nothing open,
// pending, unseen or wrong-view: a fault waiting its turn was in no list, and a hold was called good a second or two
// before it was told (a made-up hold with the top arm raised at 3 s, the trunk too upright told 2.5 s after that fix;
// on the user's triangle recording the feet too close together waited NEXT_MS behind the top arm). summary():
// `checked` the checks measured in the hold and fine at its end; `faults` every fault told in the hold or still there
// at its end (but one held back by another: `after`), `fixed` when it was gone by then, `told` when it was told.
//
// When a fault is told: once it has lasted FAULT_MS on the smoothed values (each check's median over SMOOTH_MS of
// frames), the most important first (`order`), one at a time: the next once the one told is fixed (AFTER_FIX_MS later,
// for the praise), or NEXT_MS after it; each at most once a hold, unless it was fixed and came back. A fix: the value
// ok for FIX_MS (`ok`: a little inside the fault's line). A check whose parts are out of view (or seen from the side,
// for one in the body's frontal plane) is neither bad nor good: its timers wait. A check's `when` (the chest: only
// tipped into the pose) is judged on the smoothed values too, the median of each measure over SMOOTH_MS of the frames
// that check sees: on the last raw frame, one glitch below the line dropped the chest from `checked`, or hid it
// once told.
//
// What to show in red (a fault's `part` and `side`, in hold_fault and each entry of state().open): the body part, a
// name web/js/formcheck.js bonesFor and web/js/retarget.js faultBones colour (the user's held frames replayed, on the
// Y Bot too, next to the movement's reference pose), and for a part on one side of the body, the user's own side of
// it on the frame the fault is told on ('left' / 'right' as MediaPipe names the landmarks, as engine.js's faults: the
// top arm, the more bent knee, the lifted or crossed leg, the standing one); null for a part of both sides (the
// feet, the trunk, both arms, the hips). One frame is enough: held, the sides lie far apart next to MediaPipe's few
// millimetres or degrees of noise (the wrists a metre or more apart in height in a triangle; the lifted ankle 0.44-0.87
// leg lengths above the other in the reference skeletons; a knee bent under the fault's 130 degrees, where straight
// legs read 150-175: two knees bent alike are both the fault, either one names it).
//
// A movement without an entry in HOLD_FORMS has no form check: the tracker says so (form: null), and the coach must
// not call it right or wrong.
//
// In the pose at all (IN_POSE, InPose): a loose test on each pose's key measures that says only when the person has
// clearly left it (stood up out of the triangle, put the lifted foot back down), far outside the checks' fault lines:
// a pose done badly is still in the pose, and its faults are told. The tracker (moves.js) starts no hold while out of
// the pose, ends one once out of it for a second, and the form never sees those frames (the user stood up out of a
// triangle in under a second of movement and stood there: the hold ran on 7 s, and 2 s after standing up the coach was
// told their trunk was too upright). Parts out of view: no decision (the hold goes on as without the test).
//
// Measured on: the user's live recording of Triangle pose (2026-10-24: two holds of 21 and 26 s, front and angled
// views),
// the library's reference skeletons of the three poses (SMPL joints seen as MediaPipe landmarks, as
// tools/build_moves.mjs skeletonFeatures does) and MediaPipe on the library's own footage of them (front view for
// the triangle and the quad stretch, side view for the figure-four). The numbers behind each threshold are by it.

/** BlazePose landmarks used here, by side. */
const SIDE = {
  L: { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27 },
  R: { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28 },
};
const other = s => (s === 'L' ? 'R' : 'L');

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const DEG = 180 / Math.PI;
/** Angle between two vectors, degrees (NaN for a zero vector). */
const between = (a, b) => {
  const n = len(a) * len(b);
  return n ? Math.acos(Math.max(-1, Math.min(1, dot(a, b) / n))) * DEG : NaN;
};
const UP = [0, -1, 0], DOWN = [0, 1, 0];          // world landmarks: y points down

/** A landmark counts as seen from this visibility, inside the frame. On the user's second triangle hold the ankles sat
 * at 0.95-0.98 of the picture's height (the feet below its edge) with visibility 0.34 and 0.54, while the knees (0.63,
 * 0.89) put the legs where the ankles said: MediaPipe's guess was right. engine.js's 0.6 for a whole leg would have
 * left the stance unmeasured. */
export const SEEN = 0.3;

/** One frame's measures of the pose, from MediaPipe landmarks: `world` [{x, y, z}] metres around the hips (y down),
 * `image` [{x, y, visibility}] normalised to the picture. Angles in degrees, lengths in leg lengths (hip to knee to
 * ankle, the two legs' mean), so they do not depend on the person's size or the camera's distance. The working side
 * is found in every frame, so either side counts the same: `front` the leg the trunk leans over (triangle), `top` the
 * arm with the higher wrist, `lift` the leg with the higher ankle (the quad stretch's bent leg, the figure-four's
 * crossed one; the other is the standing leg). `seen`: which parts are in view (every landmark of it in the frame,
 * visibility SEEN or more; as engine.js vis(), a landmark outside the frame is unseen whatever its score). `view`:
 * as engine.js ('front', 'angled', 'side': the shoulders' or hips' width on screen over the torso's length). Null
 * without landmarks. */
export function poseMetrics(world, image, aspect = 16 / 9) {
  if (!world || !image || world.length < 29 || image.length < 29) return null;
  const W = i => [world[i].x, world[i].y, world[i].z ?? 0];
  const inFrame = p => p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.985;
  const vis = i => (inFrame(image[i]) ? image[i].visibility ?? 1 : 0);
  const seenAll = ids => ids.every(i => vis(i) >= SEEN);
  const S = s => SIDE[s];
  const legLen = s => len(sub(W(S(s).hip), W(S(s).kn))) + len(sub(W(S(s).kn), W(S(s).an)));
  const knee = s => between(sub(W(S(s).hip), W(S(s).kn)), sub(W(S(s).an), W(S(s).kn)));
  const hip = s => between(sub(W(S(s).sh), W(S(s).hip)), sub(W(S(s).kn), W(S(s).hip)));
  const arm = s => sub(W(S(s).wr), W(S(s).sh));
  const thigh = s => sub(W(S(s).kn), W(S(s).hip));
  const leg = (legLen('L') + legLen('R')) / 2;
  const trunk = sub(mid(W(11), W(12)), mid(W(23), W(24)));          // hips to shoulders
  const hipLine = sub(W(23), W(24)), shoulderLine = sub(W(11), W(12));   // right to left
  // the trunk leans over the front leg: its lean along the hips' line (left to right, level) says which side
  const front = trunk[0] * hipLine[0] + trunk[2] * hipLine[2] > 0 ? 'L' : 'R';
  const top = W(15)[1] < W(16)[1] ? 'L' : 'R';
  const lift = W(27)[1] < W(28)[1] ? 'L' : 'R', stand = other(lift);
  // the chest's facing: out of the chest, square to the shoulders' line and the trunk (forward for a person standing);
  // how far it points below level, in degrees (0: the chest faces ahead or to the side, 90: the floor)
  const chest = cross(shoulderLine, trunk);
  const I = i => ({ x: image[i].x * aspect, y: image[i].y });
  const iShW = Math.abs(I(11).x - I(12).x), iHipW = Math.abs(I(23).x - I(24).x);
  const iTorso = Math.hypot((I(11).x + I(12).x - I(23).x - I(24).x) / 2,
    (I(11).y + I(12).y - I(23).y - I(24).y) / 2) || 1e-6;
  const frontness = Math.max(iShW, iHipW) / iTorso;
  const legIds = s => [S(s).hip, S(s).kn, S(s).an], armIds = s => [S(s).sh, S(s).el, S(s).wr];
  return {
    view: frontness > 0.45 ? 'front' : frontness < 0.22 ? 'side' : 'angled', frontness, front, top, lift,
    seen: {
      legs: seenAll([...legIds('L'), ...legIds('R')]), arms: seenAll([...armIds('L'), ...armIds('R')]),
      trunk: seenAll([11, 12, 23, 24]), topArm: seenAll(armIds(top)),
      liftLeg: seenAll(legIds(lift)), standLeg: seenAll(legIds(stand)),
    },
    stance: len(sub(W(27), W(28))) / leg,                       // ankles apart
    topArmFromUp: between(arm(top), UP),                        // shoulder to wrist, from straight up
    armsLine: between(arm('L'), arm('R')),                      // 180: one line from hand to hand
    trunkTilt: between(trunk, UP),                              // hips to shoulders, from upright
    chestDown: 90 - between(chest, DOWN),
    kneeMin: Math.min(knee('L'), knee('R')),                    // 180: straight
    kneeFront: knee(front), kneeBack: knee(other(front)),
    kneeLift: knee(lift), kneeStand: knee(stand),
    thighsApart: between(thigh(lift), thigh(stand)),            // the bent knee away from the standing one
    hipFold: 180 - hip(stand),                                  // the standing hip bent: sitting back
    ankleToKnee: len(sub(W(S(lift).an), W(S(stand).kn))) / leg, // the lifted ankle to the standing knee
    footUp: (W(S(stand).an)[1] - W(S(lift).an)[1]) / leg,       // the lifted ankle above the other (0: both down)
  };
}

const r0 = v => String(Math.round(v)), r2 = v => v.toFixed(2);
const FRONTAL = ['front', 'angled'];
/** The more bent knee's side ('L' / 'R'). */
const bentKnee = m => (m.kneeFront <= m.kneeBack ? m.front : other(m.front));
/** The user's side as a fault names it: 'left', 'right' or null. */
const sideName = s => (s === 'L' ? 'left' : s === 'R' ? 'right' : null);

/** The checks of each held pose. A check: {id, name (what it checks, a few words), label (the fault, a few words),
 * needs (parts of poseMetrics `seen`), views (when only some views can see it), when(m) (only then does it apply),
 * value(m), bad(v), ok(v) (fixed: a little inside `bad`, so a value on the line does not flicker), measured(v),
 * target, cue (the spoken fix), order (priority: the lowest is told first), after (checks that, while faulted, hold
 * this one back: one fault is not told twice in other words), part (the body part to show in red: a name of
 * formcheck.js bonesFor and retarget.js faultBones), side(m) (for a part on one side of the body: which, 'L' or 'R',
 * on a frame's metrics; none for a part of both sides)}. */
export const HOLD_FORMS = {
  // Triangle pose. All in the body's frontal plane, where the legs, the trunk and the arms lie: from the side
  // (view 'side') they all lie in depth, nothing is judged. Facing the camera the stacked shoulders are narrow on
  // screen, so the pose reads 'angled' (the footage: frontness 0.37-0.39) as often as 'front'.
  triangle_pose: [
    { id: 'stance', name: 'stance width', label: 'feet too close together', needs: ['legs'], views: FRONTAL, order: 1,
      part: 'feet',
      // the reference skeleton 1.06-1.08 leg lengths, the footage 1.23-1.27; the user 0.43-0.55 and 0.43-0.52 (each
      // second's median over the two holds)
      value: m => m.stance, bad: v => v < 0.75, ok: v => v >= 0.8,
      measured: v => `feet ${r2(v)} leg lengths apart`, target: 'about one leg length apart',
      cue: "Step your feet wider, about a leg's length apart." },
    { id: 'knees', name: 'long legs', label: 'knee bent', needs: ['legs'], views: FRONTAL, order: 2,
      part: 'knee', side: bentKnee,
      // MediaPipe on the footage's straight legs: front knee 162-172, back 156-161. The user's more bent knee, over
      // each second of both holds: 141-153 (no video to say whether it was bent): only a clearly bent knee. (The
      // skeleton's 148-153 is the SMPL joints' geometry, not comparable.)
      value: m => m.kneeMin, bad: v => v < 130, ok: v => v >= 135,
      measured: v => `a knee bent to ${r0(v)} degrees`, target: 'both legs long, nearly straight',
      cue: 'Lengthen both legs; straighten your knees without locking them.' },
    { id: 'top_arm', name: 'top arm', label: 'top arm not straight up', needs: ['topArm'], views: FRONTAL, order: 3,
      part: 'arm', side: m => m.top,
      // the skeleton 8-12 deg from straight up, the footage 15-20; the user 26-42 and 57-65
      value: m => m.topArmFromUp, bad: v => v > 25, ok: v => v <= 22,
      measured: v => `top arm ${r0(v)} degrees from straight up`, target: 'straight up, over the shoulder',
      cue: 'Reach your top arm straight up, stacked over your shoulder.' },
    { id: 'trunk_tilt', name: 'trunk tilt', label: 'trunk too upright', needs: ['trunk'], views: FRONTAL, order: 4,
      part: 'torso',
      // the skeleton 59-62 deg, the footage 72-73; the user 59-74 and 40-49
      value: m => m.trunkTilt, bad: v => v < 38, ok: v => v >= 42,
      measured: v => `trunk tipped ${r0(v)} degrees`, target: 'about 60 degrees, out over the front leg',
      cue: 'Reach out over your front leg, then tip your trunk further down.' },
    { id: 'arms_line', name: 'arms in one line', label: 'arms not in one line', needs: ['arms'], views: FRONTAL,
      order: 5, after: ['top_arm'], part: 'arms',
      // the skeleton 157 deg, the footage 150-152; the user 147-162 and 116-123. Held back while the top arm is off:
      // a top arm off straight up bends the line too (the user's 116-123 came with the top arm 57-65 deg off)
      value: m => m.armsLine, bad: v => v < 140, ok: v => v >= 144,
      measured: v => `arms ${r0(180 - v)} degrees off one line`, target: 'one straight line from hand to hand',
      cue: 'Make one straight line from your bottom hand up to your top hand.' },
    { id: 'chest', name: 'open chest', label: 'chest turned to the floor', needs: ['trunk'], views: FRONTAL, order: 6,
      part: 'chest',
      // depth (the chest's facing, 0 when it faces ahead or to the side): the skeleton 7-8 deg toward the floor, the
      // footage -13 to -8 (a little up), the user 8-19 and 12-22. Judged only tipped into the pose (bending forward
      // instead of to the side turns the chest to the floor as far as the trunk tips)
      when: m => m.trunkTilt >= 35,
      value: m => m.chestDown, bad: v => v > 40, ok: v => v <= 35,
      measured: v => `chest turned ${r0(v)} degrees toward the floor`, target: 'chest open, facing forward',
      cue: 'Roll your top shoulder back and open your chest.' },
  ],
  // Standing quad stretch. 3D angles of the world landmarks, from any view: on the library's footage (front view)
  // MediaPipe read the bent knee 40-50 deg where the skeleton has 38-56.
  quad_stretch: [
    { id: 'heel', name: 'heel to glute', label: 'heel far from the glute', needs: ['liftLeg'], order: 1,
      part: 'knee', side: m => m.lift,
      // the skeleton's bent knee 38-56 deg, the footage 40-50
      value: m => m.kneeLift, bad: v => v > 85, ok: v => v <= 80,
      measured: v => `bent knee at ${r0(v)} degrees`, target: 'heel close to the glute, knee bent to about 45 degrees',
      cue: 'Pull your heel in close to your glute.' },
    { id: 'knees_together', name: 'knees together', label: 'bent knee drifting away', needs: ['liftLeg', 'standLeg'],
      order: 2, part: 'knee', side: m => m.lift,
      // the bent thigh against the standing one: the skeleton 19-29 deg held (40 while getting into it), the footage
      // 11-26
      value: m => m.thighsApart, bad: v => v > 40, ok: v => v <= 35,
      measured: v => `bent knee ${r0(v)} degrees away from the standing leg`,
      target: 'knees side by side, the bent knee pointing down',
      cue: 'Bring your bent knee back beside your standing knee, pointing down.' },
    { id: 'upright', name: 'standing tall', label: 'leaning over', needs: ['trunk'], order: 3, part: 'torso',
      // the skeleton 10-14 deg from upright, the footage 10-19
      value: m => m.trunkTilt, bad: v => v > 30, ok: v => v <= 25,
      measured: v => `trunk leaning ${r0(v)} degrees`, target: 'upright, within about 15 degrees',
      cue: 'Stand tall and lift your chest.' },
    { id: 'standing_knee', name: 'standing leg', label: 'standing knee bent', needs: ['standLeg'], order: 4,
      part: 'knee', side: m => other(m.lift),
      // the skeleton 164-171 deg, the footage 151-173 (MediaPipe reads straight legs 150-175): only clearly bent
      value: m => m.kneeStand, bad: v => v < 130, ok: v => v >= 135,
      measured: v => `standing knee bent to ${r0(v)} degrees`, target: 'standing leg long, nearly straight',
      cue: 'Straighten your standing leg and stand tall on it.' },
  ],
  // Standing figure-four balance.
  figure_four_balance: [
    { id: 'ankle_on_knee', name: 'ankle above the knee', label: 'ankle not on the knee',
      needs: ['liftLeg', 'standLeg'], views: FRONTAL, order: 1, part: 'leg', side: m => m.lift,
      // the skeleton's crossed ankle 0.03-0.10 leg lengths from the standing knee. From the side the legs overlap:
      // on the footage (side view) MediaPipe put that ankle 0.4-0.5 leg lengths below the knee for half the hold
      value: m => m.ankleToKnee, bad: v => v > 0.3, ok: v => v <= 0.25,
      measured: v => `ankle ${r2(v)} leg lengths from the standing knee`,
      target: 'resting just above the standing knee',
      cue: 'Cross your ankle over your standing leg, just above the knee.' },
    { id: 'sit_back', name: 'sitting back', label: 'not sitting back', needs: ['standLeg', 'trunk'], order: 2,
      part: 'hips',
      // the standing hip bent: the skeleton 47-65 deg, the footage 49-82 (side view); standing tall, MediaPipe reads
      // 2-18 (the quad stretch's footage, its standing leg)
      value: m => m.hipFold, bad: v => v < 25, ok: v => v >= 30,
      measured: v => `hips folded ${r0(v)} degrees`, target: 'hips sitting back, folded about 50 degrees',
      cue: 'Sit your hips back, as if into a chair.' },
    { id: 'chest_up', name: 'chest up', label: 'chest dropping', needs: ['trunk'], order: 3, part: 'torso',
      // the skeleton 23-33 deg from upright, the footage 27-36
      value: m => m.trunkTilt, bad: v => v > 55, ok: v => v <= 50,
      measured: v => `chest tipped ${r0(v)} degrees forward`, target: 'chest up, within about 35 degrees of upright',
      cue: 'Lift your chest and keep your back long.' },
  ],
};

export const FORM_TUNING = {
  SMOOTH_MS: 1000,        // a check's value is the median of its last SMOOTH_MS of frames (MediaPipe jitters by a few
                          // degrees; a landmark glitches for a frame or two)
  FAULT_MS: 1500,         // ...bad this long (frames measured): a fault. A half-second glitch raises nothing
  FIX_MS: 1500,           // ...ok this long, once a fault: fixed
  NEXT_MS: 8000,          // one correction at a time: the next fault is told this long after the last one...
  AFTER_FIX_MS: 2500,     // ...or this long after the last one was fixed (time to praise the fix first)
  POSE_MS: 500,           // in the pose at all (InPose): what most of the last POSE_MS of frames say, once they
                          // span half of it (a glitch, a frame or two, decides nothing)
};
const DT_MAX = 300;       // a frame stands for the time since the one before, at most this (as moves.js)

/** In the pose at all, for each pose of HOLD_FORMS: a frame is clearly out of it (`out(m)`), back in it (`back(m)`, a
 * little inside the out line, so a value on the line does not flicker) or between; `needs` and `views` as a check's
 * (its parts out of view, or seen from a view that cannot tell: no decision); `label` what out of it looks like. The
 * lines lie well beyond the checks' fault lines: a pose held badly is still in the pose, and its faults are told. The
 * numbers: the user's seven recordings standing still (the trunk within 30 deg of upright, front or angled view: 6196
 * frames, of which each pose's test calls 99.8-100% out), the reference skeletons and MediaPipe on the library's
 * footage over their held part (the second half, as the tests), every frame of it back in the pose. */
export const IN_POSE = {
  // Standing up: the trunk's tilt from upright. Standing still, the user's recording of the triangle 1-21 deg (99th
  // percentile 20; half a second's median at most 18), the six others' 99th percentiles 9-15. In the pose the user
  // 40-75, the skeleton 59-62, the footage 69-73 (both clips start already tipped about 30). From 20 to 38 the trunk
  // is too upright: that fault is told, the pose not left. Front or angled, as its checks (from the side the lean lies
  // in depth, where MediaPipe guesses)
  triangle_pose: { label: 'standing upright', needs: ['trunk'], views: FRONTAL,
    out: m => m.trunkTilt < 20, back: m => m.trunkTilt >= 25 },
  // Both feet on the floor, the knee straight. Standing still, the higher ankle 0-0.23 leg lengths above the other
  // (99th percentile 0.06), its knee 110-168 deg (1st percentile 148). Held, the skeleton's foot 0.79-0.87 up and its
  // knee 46-56 deg, the footage's 0.78-0.85 and 41-50. A heel let down to 90-120 deg, the foot off the floor: the
  // heel's fault, told. Front or angled only: from the side MediaPipe puts a raised foot on the floor (the
  // figure-four's footage, below)
  quad_stretch: { label: 'both feet down', needs: ['liftLeg', 'standLeg'], views: FRONTAL,
    out: m => m.kneeLift > 135 && m.footUp < 0.2, back: m => m.kneeLift <= 120 || m.footUp >= 0.3 },
  // Both feet on the floor, the crossed ankle off the standing knee. Standing still, that ankle 0.36-0.74 leg lengths
  // from the other knee (1st percentile 0.46) and 0-0.23 above the other ankle. Held, the skeleton's 0.02-0.11 from the
  // knee and 0.44-0.53 up. The footage is a side view, where MediaPipe put the crossed foot within 0.2 of the floor on
  // 68 of the held part's 105 frames (0-0.49 up, 0.18-0.82 from the knee: 65 would read out): front or angled only,
  // as the ankle check
  figure_four_balance: { label: 'both feet down', needs: ['liftLeg', 'standLeg'], views: FRONTAL,
    out: m => m.ankleToKnee > 0.35 && m.footUp < 0.2, back: m => m.ankleToKnee <= 0.3 || m.footUp >= 0.3 },
};

/** Whether the person is in a pose at all (IN_POSE), frame by frame. The decision is what most of the last POSE_MS of
 * frames with its parts in view say (clearly out, or back in); a frame between keeps it. Until told otherwise the
 * person is in the pose (as without the test). While out: `leftT`, when the pose was left (the first frame clearly out
 * after the last one in it), and `lastOutT`, the last frame clearly out (lastOutT - leftT: how long out of it so far;
 * the decision lags the frames by about POSE_MS / 2, the frames do not). */
export class InPose {
  constructor({ key, tuning = {} } = {}) {
    if (!IN_POSE[key]) throw new Error(`no in-pose test for ${key}`);
    this.key = key; this.p = IN_POSE[key]; this.k = { ...FORM_TUNING, ...tuning };
    this.reset();
  }

  reset() { this.votes = []; this.out = false; this.leftT = null; this.lastOutT = null; }

  /** One frame's metrics (poseMetrics; null: nobody) at t ms: 'out', 'in', or null: no decision on this frame (nobody,
   * its parts out of view, or a view that cannot tell; the last decision stands). */
  update(m, t) {
    const v = this.votes, p = this.p;
    while (v.length && v[0].t <= t - this.k.POSE_MS) v.shift();
    if (!m || !p.needs.every(n => m.seen[n]) || (p.views && !p.views.includes(m.view))) return null;
    v.push({ t, c: p.out(m) ? 1 : p.back(m) ? -1 : 0 });
    // (frames over less than half of POSE_MS, the first ones seen: too few to change anything)
    const most = c => t - v[0].t >= this.k.POSE_MS / 2 && 2 * v.filter(x => x.c === c).length > v.length;
    // out: left at the first frame clearly out since the last one in the pose (none since: not yet)
    const left = v.slice(v.findLastIndex(x => x.c === -1) + 1).find(x => x.c === 1);
    if (!this.out && left && most(1)) {
      this.out = true; this.leftT = left.t; this.lastOutT = v.findLast(x => x.c === 1).t;
    } else if (this.out && most(-1)) {
      this.out = false; this.leftT = null; this.lastOutT = null;
    } else if (this.out && v.at(-1).c === 1) this.lastOutT = t;
    return this.out ? 'out' : 'in';
  }
}

const median = v => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
/** Frames' metrics (poseMetrics) smoothed: each measure's median over them (the rest as on the last frame). */
function smoothed(frames) {
  const out = { ...frames.at(-1) };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === 'number') out[key] = median(frames.map(f => f[key]).filter(Number.isFinite)) ?? NaN;
  }
  return out;
}

/** The landmarks the parts of poseMetrics `seen` (a check's `needs`) take in, on a frame's metrics `m` (the top arm,
 * the lifted and the standing leg are its own on that frame; without one, both sides). */
export function neededLandmarks(needs, m = null) {
  const arm = s => [SIDE[s].sh, SIDE[s].el, SIDE[s].wr], leg = s => [SIDE[s].hip, SIDE[s].kn, SIDE[s].an];
  const either = (f, s) => (s ? f(s) : [...f('L'), ...f('R')]);
  const ids = { legs: [...leg('L'), ...leg('R')], arms: [...arm('L'), ...arm('R')], trunk: [11, 12, 23, 24],
    topArm: either(arm, m?.top), liftLeg: either(leg, m?.lift), standLeg: either(leg, m?.lift && other(m.lift)) };
  return [...new Set(needs.flatMap(n => ids[n] ?? []))];
}

export class HoldForm {
  /** `forms`: the held poses' checks (HOLD_FORMS; a test gives made-up ones). */
  constructor({ key, tuning = {}, forms = HOLD_FORMS } = {}) {
    if (!forms[key]) throw new Error(`no form check for ${key}`);
    this.key = key; this.k = { ...FORM_TUNING, ...tuning };
    this.checks = [...forms[key]].sort((a, b) => a.order - b.order);
    this.reset();
  }

  /** A new hold: nothing measured, nothing told. */
  reset() {
    // per check: its last frames {t, v} and their median (`value`), when last measured, the time bad or ok in a row,
    // whether it is a fault (`present`), told (and not fixed since; `side`: the part's side on the frame it was told
    // on), ever told this hold, ever measured; on the last frame, why it was not measured (`now`: 'unseen', 'view',
    // 'when', or 'measured'); for a check with a `when`, the last frames it saw {t, m} (the smoothed values `when` is
    // judged on)
    this.s = Object.fromEntries(this.checks.map(c => [c.id, { samples: [], value: NaN, seenT: null, badMs: 0, okMs: 0,
      present: false, told: false, toldT: null, side: null, everTold: false, measuredEver: false, now: 'unseen',
      seen: [] }]));
    this.lastT = null; this.lastToldT = -Infinity; this.lastFixT = -Infinity;
  }

  /** One frame's metrics (poseMetrics; null: nobody, nothing measured) at t ms: the faults told and fixed. */
  update(m, t) {
    const k = this.k, out = [];
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(DT_MAX, t - this.lastT));
    this.lastT = t;
    for (const c of this.checks) {
      const s = this.s[c.id];
      while (s.samples.length && s.samples[0].t <= t - k.SMOOTH_MS) s.samples.shift();
      s.now = this.judged(c, m, t);
      const v = s.now === 'measured' ? c.value(m) : NaN;
      if (!Number.isFinite(v)) {                        // unseen: neither bad nor good (its value stays the last)
        if (s.now === 'measured') s.now = 'unseen';     // (a measure MediaPipe could not give: as out of view)
        continue;
      }
      s.samples.push({ t, v }); s.seenT = t; s.measuredEver = true;
      s.value = median(s.samples.map(x => x.v));
      if (c.bad(s.value)) { s.badMs += dt; s.okMs = 0; }
      else if ((c.ok ?? (x => !c.bad(x)))(s.value)) { s.okMs += dt; s.badMs = 0; }
      else { s.badMs = 0; s.okMs = 0; }                 // on the line: no change either way
      if (!s.present && s.badMs >= k.FAULT_MS) s.present = true;
      else if (s.present && s.okMs >= k.FIX_MS) {
        s.present = false;
        if (s.told) { s.told = false; this.lastFixT = t; out.push({ type: 'hold_fix', fault: c.id, label: c.label }); }
      }
    }
    // one correction at a time: the most important fault not told yet, once none told is still open (and the fix was
    // praised), or NEXT_MS after the last one told
    const open = this.checks.some(c => this.s[c.id].present && this.s[c.id].told);
    const due = open ? t - this.lastToldT >= k.NEXT_MS : t - this.lastFixT >= k.AFTER_FIX_MS;
    if (due) {
      const c = this.checks.find(x => {
        const s = this.s[x.id];
        return s.present && !s.told && s.seenT === t && !(x.after ?? []).some(id => this.s[id]?.present);
      });
      if (c) {
        const s = this.s[c.id];
        s.told = true; s.everTold = true; s.toldT = t; this.lastToldT = t;
        s.side = sideName(c.side?.(m));                 // (measured on this frame: seenT === t)
        out.push({ type: 'hold_fault', ...this.fault(c) });
      }
    }
    return out;
  }

  /** The hold was told at t (hold_start, carrying state()): the faults open then count as told then, so the next one
   * waits NEXT_MS from there (not from when it was measured, before anyone heard of it). */
  settle(t) {
    if (this.checks.some(c => this.s[c.id].present && this.s[c.id].told)) this.lastToldT = Math.max(this.lastToldT, t);
  }

  /** Whether the check can be judged on this frame (m at t): 'measured', or why not: 'unseen' (nobody, or its parts
   * out of the frame), 'view' (seen from a view that cannot see it) or 'when' (it does not apply now: `when`, on the
   * smoothed values of the frames it saw over SMOOTH_MS, this one included). */
  judged(c, m, t) {
    if (!m || !(c.needs ?? []).every(p => m.seen[p])) return 'unseen';
    if (c.views && !c.views.includes(m.view)) return 'view';
    if (!c.when) return 'measured';
    const seen = this.s[c.id].seen;
    while (seen.length && seen[0].t <= t - this.k.SMOOTH_MS) seen.shift();
    seen.push({ t, m });
    return c.when(smoothed(seen.map(x => x.m))) ? 'measured' : 'when';
  }

  /** A fault told: what it is, as measured now, and what to show in red (`part`, and `side` as told). */
  fault(c) {
    const s = this.s[c.id];
    return { fault: c.id, label: c.label, measured: c.measured(s.value), target: c.target, cue: c.cue, part: c.part,
      side: s.side };
  }

  /** Measured within the last SMOOTH_MS (else out of view, from the wrong side, or not applying now). */
  fresh(c) { const s = this.s[c.id]; return s.seenT !== null && this.lastT - s.seenT < this.k.SMOOTH_MS; }

  /** Measured now as a fault: one already (present), or bad on its smoothed value and waiting FAULT_MS to last. */
  faulty(c) {
    const s = this.s[c.id];
    return s.present || (this.fresh(c) && s.now !== 'when' && c.bad(s.value));
  }

  /** Now: {checked: names of the checks measured now and fine, open: the faults told and not fixed (the latest told
   * first), pending: names of the checks measured now as faults and not told yet, unseen: names of the checks whose
   * parts are out of the frame, wrongView: names of the checks only another view can see}. A check that does not
   * apply now (`when`: the chest, standing up) is in none, unless it is a fault told and still there (open). */
  state() {
    const checked = [], open = [], pending = [], unseen = [], wrongView = [];
    const byId = id => this.checks.find(x => x.id === id);
    for (const c of this.checks) {
      const s = this.s[c.id];
      if (s.present && s.told) open.push({ ...this.fault(c), toldT: s.toldT });    // (whatever this frame shows)
      else if (!this.fresh(c)) {                        // not measured over SMOOTH_MS: why, on the last frame
        if (s.now === 'view') wrongView.push(c.name);
        else if (s.now === 'unseen') unseen.push(c.name);
      } else if (s.now === 'when') continue;            // measured lately, but not applying now: neither
      else if (this.faulty(c)) {
        // (one held back by another fault there: the same fault in other words, told as that one)
        if (!(c.after ?? []).some(id => this.faulty(byId(id)))) pending.push(c.name);
      } else checked.push(c.name);
    }
    open.sort((a, b) => b.toldT - a.toldT);
    return { checked, open: open.map(({ toldT, ...f }) => f), pending, unseen, wrongView };
  }

  /** The hold: {checked: names of the checks measured in it and fine at its end, faults: [{fault, label, fixed,
   * told}]: every fault told in it or still there at its end}. */
  summary() {
    const checked = [], faults = [];
    for (const c of this.checks) {
      const s = this.s[c.id];
      if (s.measuredEver && !s.present && !c.bad(s.value)) checked.push(c.name);
      // (one never told and held back by another fault still there: the same fault in other words)
      if (!s.everTold && (c.after ?? []).some(id => this.s[id]?.present)) continue;
      if (s.everTold || s.present) faults.push({ fault: c.id, label: c.label, fixed: !s.present, told: s.everTold });
    }
    return { checked, faults };
  }
}
