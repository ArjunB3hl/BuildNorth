import { hostAgent, accountConnections, describeHostedEvent } from './host-agent.js';
import { connectAppearance } from './embed-appearance.js';
// Live coach page: camera (or a test clip in real time) -> MediaPipe pose -> exercise engines -> events.
// web/js/auto.js counts sets per exercise: "Auto" lets it decide what is being done; an exercise named (in the picker,
// or by the user when the coach asks at the start) has it count that one alone. Coaching events go to the coach that
// web/js/connections.js picks from what is connected: the ElevenLabs coach agent (its own voice; the user talks to it
// through the microphone), or Claude or ChatGPT in a coach session over MCP (server/coach.py), whose cues this page
// speaks (Kokoro, or the Mac's voice). If no cue arrives within FALLBACK_MS, the engine's own sentence is spoken instead.
// With Claude, ChatGPT or the engine's own coach the page listens itself (web/js/listen.js: Parakeet on this Mac writes
// down what the user says): words that name an exercise or answer a question are applied here (web/js/intents.js), and
// the coach gets the words with what was done (user_said). "Talk to coach" opens the conversation without a workout.
// The camera view shows only the video and the skeleton: the count, what the camera sees, the coach's questions, its
// last line and the form check are in the side panel (the 3D view covers the video only while the user has it open).
// Besides the 13 exercises, the user can name any movement of the movement library (/moves/library.json, built by
// tools/build_moves.mjs): tapped in the Movements card or said. The page never recognises one by itself: it keeps track
// of the one named with what the camera measures (web/js/moves.js: a hold timer, the time moving, an approximate
// rhythm), and counts no reps meanwhile. A gym exercise of the library is counted as its exercise.
import { EXERCISES, features } from './engine.js';
import { AutoTracker } from './auto.js';
import { createPose, detect, drawPose } from './pose.js';
import { RepReplay, bonesFor, describeFault, mirrorImage } from './formcheck.js';
import { mirrorSide } from './retarget.js';
import { connect, connectWindowsApp, embedded, parentOrigin, windowsApp, WINDOWS_APP, workoutOf } from './embed.js';
import { MacVoice, createVoice } from './voice.js';
import { CAP_MS, ElevenCoach } from './eleven-coach.js';
import { AGENT_ID, ORDER, SessionCues, brainLabel, describe, describeStt, fallback, listens, resolve } from './connections.js';
import { Listener, sttStatus, transcribe } from './listen.js';
import { restartRequested, recordMovingIntervals, beginAttempt, anchorAttempt, endAttempt, freshTracker, loadMovementModule, recordTrackingUpdate, trackerRunning } from './movement-review.js';
import { afterEcho, chatter, intentOf, movementNames, words } from './intents.js';
import { SESSION_INTRO_TEXT, sessionIntroEvent, waitForCountdown } from './session-start.js';
import { MistakeList, clock, framesIn, fromRecord, mistakesOf, recordOf, rowOf, savedName, seenWindow }
  from './mistakes.js';

const FALLBACK_MS = 3000;
const $ = id => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), octx = overlay.getContext('2d');
const S = { running: false, pose: null, sid: null, said: 0, cues: new SessionCues(FALLBACK_MS),
  lastTs: 0, frames: 0, fpsT: performance.now(), stream: null, exercise: null, poll: null, gen: 0,
  rec: null, auto: null, ended: [], workout: null, demos: {}, demoTimer: null, demoFor: null, trail: [], aspect: 16 / 9, form: null, replayRec: null };
const r4 = x => Math.round(x * 1e4) / 1e4;

$('exercise').add(new Option('Auto: detect exercises', 'auto'));
for (const [key, ex] of Object.entries(EXERCISES)) $('exercise').add(new Option(ex.label, key));
$('exercise').value = 'auto';
// inside the BuildNorth app (?embed=1, web/js/embed.js): the app is told about each set and saves the workout itself
const QS = new URLSearchParams(location.search);
const HOSTED = document.documentElement.dataset.hosted === 'true';
// (?parent=windows-app: the Rhythm Windows app shows this page in its own WebView2 and talks through chrome.webview)
const IN_WINDOWS_APP = embedded(location.search) && windowsApp(window, location.search);
const PARENT = IN_WINDOWS_APP ? WINDOWS_APP : embedded(location.search) ? parentOrigin(location.search) : null;
const app = IN_WINDOWS_APP ? connectWindowsApp(window.chrome.webview) : PARENT ? connect(window, PARENT) : null;
const REVIEW = !HOSTED && !app && QS.get('review') === '1';
// Only this explicitly opened local session; no persistent preference or remote agent configuration changes.
S.startIntroPending = REVIEW && QS.get('session_intro') === '1';
let hostAuthorized = !HOSTED;
if (HOSTED) {
  $('start').disabled = true;
  $('record').checked = false;
  $('record').disabled = true;
  $('record').closest('label').hidden = true;
  // Public hosting contains no personal recordings, licensed reference assets or local speech workers.
  $('demo3d').hidden = true;
  $('library').hidden = true;
  $('connections').hidden = true;
  for (const option of $('voiceKind').options) if (option.value === 'kokoro') option.disabled = true;
  for (const option of $('voiceKind').options) if (option.value === 'mac') option.textContent = 'Browser voice';
  if (!app || window.parent === window) {
    document.body.textContent = 'Open Camera workout from the signed-in Rhythm website.';
    throw new Error('Hosted camera requires its authorized website parent.');
  }
}
const accountSession = app ? hostAgent(app) : null;
let accountElevenLabs = false;
let accountLocalClaude = false;
if (embedded(location.search) && !PARENT) console.warn('pose coach: ?parent= must be a page on this machine (http://localhost:<port>); not embedded');
if (app) {
  $('record').checked = false; // Landmark debugging is opt-in in the embedded app workout.
  document.body.classList.add('embed');
  connectAppearance(window, app);
  app.on('ai-connection', message => {
    hostAuthorized = true;
    S.appConnection = true;
    if (!S.running && !S.starting) $('start').disabled = false;
    accountElevenLabs = message.elevenlabs === true;
    // Claude Code on this computer (the server's own sign-in check decides whether it is usable): the app offers it
    // only where this page runs on the user's own computer
    accountLocalClaude = !HOSTED && message.localClaude === true;
    const claude = [...$('coachKind').options].find(option => option.value === 'claude');
    if (claude) claude.disabled = !accountLocalClaude;
    void loadConnections();
  });
  for (const option of $('coachKind').options) {
    if (['claude', 'chatgpt'].includes(option.value)) { option.disabled = true; if (HOSTED) option.hidden = true; }
  }
  $('coachKind').value = 'auto';
  app.on('start', m => {
    if (S.running || S.starting) return;
    if (m.exercise === 'auto' || EXERCISES[m.exercise]) $('exercise').value = m.exercise;
    start();
  });
  // a stop while the page is still starting (model, camera prompt): it starts nothing and sends an empty workout
  app.on('stop', () => {
    if (S.running) stop();
    else if (S.starting) { S.cancelStart = true; S.startDelay?.abort(); }
    else if (S.workout) app.send('summary', S.workout);
  });
}
const optionalJSON = (path, empty) => HOSTED ? Promise.resolve(empty)
  : fetch(path).then(r => r.ok ? r.json() : empty).catch(() => empty);
optionalJSON('/api/demos', {}).then(d => { S.demos = d; });
// the code this page was loaded with: a tab left open over a change says it needs a reload (live: a test ran old code)
const codeVersion = () => HOSTED ? Promise.resolve(document.documentElement.dataset.version)
  : fetch('/api/version', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).then(v => v.version).catch(() => null);
codeVersion().then(v => { S.code = v; app?.send('ready', { version: v }); });
optionalJSON('/api/eval-set', []).then(set => {
  for (const c of set) if (c.exercise) $('source').add(new Option(`Clip: ${c.name || c.id}`, JSON.stringify(c)));
}).catch(() => {});
// saved sets (landmarks only), replayed through the page as if live: for checking what the page did with a session
// (and in the Workout card, to review a saved workout's mistakes: savedWorkouts())
optionalJSON('/api/recordings', []).then(list => {
  for (const x of list) $('source').add(new Option(`Recording: ${x.id}`, `rec:${x.id}`));
  savedWorkouts(list);
  // ?source=rec:<id>: start with a saved set instead of the camera (for checking the page, also inside the app)
  if ([...$('source').options].some(o => o.value === QS.get('source'))) $('source').value = QS.get('source');
}).catch(() => {});
$('source').addEventListener('change', () => {
  const v = $('source').value;
  if (v !== 'camera' && !v.startsWith('rec:')) $('exercise').value = JSON.parse(v).exercise;
});

const log = (msg, cls = '') => {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  if (cls) line.className = cls;
  $('log').prepend(line);
};
/** The conversation, in the Coach chat card: what the user said ('you') and what the coach or the engine said. */
function chat(who, text) {
  $('chatEmpty')?.remove();
  const box = $('chat'), line = document.createElement('div'), name = document.createElement('b');
  line.className = `line ${who}`;
  name.textContent = who === 'you' ? 'You:' : 'Coach:';
  line.append(name, text);
  box.append(line);
  while (box.children.length > 200) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
const post = async (path, body) => {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

// --- the coach: who writes the cues and who speaks them, from what is connected (web/js/connections.js): the ElevenLabs
// agent with its own voice, else Claude, else ChatGPT (both in a coach session over MCP), else the engine's own cues,
// spoken by Kokoro on this Mac (the Mac's voice as its fallback). The pickers can choose either by hand ------------------
const coachChoice = () => $('coachKind').value;         // auto | eleven | claude | chatgpt | off
const voiceChoice = () => $('voiceKind').value;         // auto | kokoro | eleven | mac | off
const brain = () => S.plan?.brain ?? 'none';            // the plan's: eleven | claude | chatgpt | none
const cliBrain = b => b === 'claude' || b === 'chatgpt';   // a coach session on the server (a CLI over MCP)
const elevenVoice = () => brain() === 'eleven' && S.plan.voice === 'eleven';   // (and so duplex: S.plan.duplex)
// an agent session that hears the user: the agent with its own voice, or a conversation without a workout (Talk to
// coach), which is duplex whatever voice speaks the workout's cues
const elevenListen = () => elevenVoice() || (brain() === 'eleven' && S.talking && !S.running && !S.starting);
const remember = (k, v) => { try { localStorage.setItem(`pose-coach-${k}`, v); } catch { /* private window */ } };
// (new names: a choice made before Auto existed is not kept, so Auto is everyone's default once)
for (const [id, k] of [['coachKind', 'coach'], ['voiceKind', 'voice']]) {
  // Each embedded workout starts on Auto; people can still choose another coach for this visit.
  if (app) continue;
  try { const v = localStorage.getItem(`pose-coach-${k}`); if (v && [...$(id).options].some(o => o.value === v)) $(id).value = v; } catch { /* */ }
}
// Explicit local review mode records tracked pose landmarks and engine events, not camera video.
// It does not start a remote AI session; the user may choose a coach after reviewing.
if (REVIEW) {
  $('coachKind').value = S.startIntroPending ? 'auto' : 'off';
  $('voiceKind').value = S.startIntroPending ? 'auto' : 'off';
  $('record').checked = true;
  $('useDemos').checked = true;
  $('start').textContent = 'Start recording';
  $('stop').textContent = 'Stop and save';
  const info = document.createElement('aside');
  info.id = 'sessionStartNote';
  info.setAttribute('role', 'note');
  info.style.cssText = 'margin:12px 16px;padding:14px 18px;border:1px solid #3496eb;border-radius:12px;background:#102334;color:#e6edf8;line-height:1.5';
  info.textContent = S.startIntroPending
    ? 'For your next Start only: a visible five-second countdown, then the voice coach introduces movement tracking and 3D review and asks what you would like to do today. Keep your whole body and feet in view. Only pose landmarks are saved; Stop and save keeps your recording. Tracking status depends on actual pose updates.'
    : 'Review saved movement below without starting the camera or coach. To record a new attempt, choose a movement, stand where your whole body is visible, then Start recording and Stop and save. Only pose landmarks are saved, not camera video or audio. Restart movement begins a separate attempt. AI coach and voice stay off unless you select them.';
  document.querySelector('header').after(info);
}
S.conns = undefined;     // GET /api/connections (null: the server did not say)
S.failed = {};           // brains that failed to start ({brain: why}): skipped until the coach picker changes or Check again
                         // (the agent's is tried again at each Start: see start())
S.plan = null;           // connections.js resolve(): {brain, voice, why, label}
const choice = () => ({ coach: coachChoice(), voice: voiceChoice(), failed: S.failed });

/**
 * The voice that speaks on this page (Kokoro or the Mac's). With the agent's own voice there is no second speaker:
 * fallback cues are shown on screen while the agent answers. If the agent fails, the fallback plan restores Kokoro.
 * Until Kokoro is ready (a few seconds on the server, about 10 s in the browser) the Mac's voice stands in, so no cue
 * goes unspoken. A voice replaced, or one that arrives after the picker moved on, is closed (its audio and its worker).
 */
async function ensureVoice() {
  const v0 = S.plan?.voice ?? voiceChoice();
  const kind = v0 === 'eleven' ? 'off' : HOSTED && ['auto', 'kokoro'].includes(v0) ? 'mac' : v0 === 'auto' ? 'kokoro' : v0;
  if (S.voiceFor === kind) return S.voiceOut;
  const load = S.voiceLoad = {};                        // this load: a later one makes it moot
  S.voiceFor = kind;
  S.voiceOut?.close(); S.voiceOld?.close(); S.voiceOld = null;
  S.voiceOut = kind === 'off' ? null : new MacVoice();
  if (kind !== 'kokoro') return S.voiceOut;
  S.voiceOut.standIn = true;
  const v = await createVoice(kind, { voice: 'af_heart' });
  if (S.voiceLoad !== load) { v.close(); return S.voiceOut; }    // changed again while it loaded
  S.voiceOld = S.voiceOut;                              // the stand-in finishes what it is saying; the next cue cuts it
  S.voiceOut = v;
  if (v.fallbackReason) log(`voice: ${v.kind === 'mac' ? 'the Mac\'s voice' : v.kind} (${v.fallbackReason})`, 'err');
  return v;
}

/**
 * A cue on screen, in the log and the chat, and spoken: by this page's voice, unless it was `heard` already (the agent's
 * voice). `t0`: when what it answers happened (the cue delay counts from there: `label` says from what); `onAudible`:
 * when it was heard.
 */
function speak(text, who, t0 = null, heard = false, { label = 'event to voice', onAudible } = {}) {
  if (S.trackingBlocked) return; // includes already queued CLI replies and engine fallback timers
  if (text == null) return;
  if (who === 'engine' && !/[\p{L}\p{N}]/u.test(text)) return;   // (the engine has nothing to say: a short hold ended)
  text = text.replace(/\[[a-z ]{2,24}\]\s*/gi, '');    // an ElevenLabs voice's expressive tags ("[excited]"): heard, not shown
  $('say').style.display = 'block';
  $('say').textContent = text;
  log(`${who === 'coach' ? 'Coach' : 'Engine'}: ${text}`, who === 'coach' ? 'coach' : 'cue');
  if (/[\p{L}\p{N}]/u.test(text)) chat(who, text);
  // Cover the transition too: a local cue may still be synthesizing when a voice agent connects. Cancel it before
  // it can arrive over the agent. A text-only agent still uses the selected local voice.
  if (S.eleven && !S.eleven.textOnly) {
    S.voiceOut?.cancel(); S.voiceOld?.close(); S.voiceOld = null;
    return;
  }
  if (heard) return;
  if (!/[\p{L}\p{N}]/u.test(text)) return;            // nothing to say ("..."): leave the cue that is playing alone
  S.voiceOld?.close(); S.voiceOld = null;
  if (S.voiceOut?.standIn && !S.voiceOut.told) { S.voiceOut.told = true; log("voice: the Mac's voice until Kokoro is ready"); }
  // listening here: what the Mac's voice says comes back through the microphone (it plays outside the page, where echo
  // cancellation cannot take it out), and an utterance heard while it spoke has its words taken out (heard()). Only a
  // cue a voice plays (none with the voice off)
  if (S.voiceOut) {
    S.spoken = S.spoken.filter(x => x.until > performance.now());
    S.spoken.push({ text, until: performance.now() + ECHO_MS + ECHO_WORD_MS * words(text).length });
  }
  S.voiceOut?.say(text, {
    onAudible: t => { if (t0 != null) $('cueDelay').textContent = `${((t - t0) / 1000).toFixed(1)} s (${label})`; onAudible?.(t); },
    onError: m => log(`voice failed (${m}); the next cue tries again`, 'err'),
  });
}
const ECHO_MS = 6000, ECHO_WORD_MS = 450;      // a cue can come back while it plays (about 0.4 s a word) and a little after
S.spoken = [];                                 // what the page's voice said lately {text, until}, newest last
$('voiceKind').addEventListener('change', () => { remember('voice', voiceChoice()); replan(); applyPlan(); });
// picking a coach again tries again what failed to start
$('coachKind').addEventListener('change', () => { remember('coach', coachChoice()); S.failed = {}; replan(); applyPlan(); if (REVIEW) void loadStt(); });
ensureVoice();                       // Kokoro loads with the page (on the server: ready in a few seconds)

/** The plan from what is connected and the pickers (connections.js); a change of it is logged with why. */
function replan() {
  const before = S.plan;
  S.plan = resolve(S.conns ?? null, choice());
  if (HOSTED && S.plan.voice === 'kokoro') {
    S.plan.voice = 'mac';
    S.plan.why = S.plan.why.replaceAll('Kokoro', 'browser speech');
    S.plan.label = S.plan.label.replaceAll('Kokoro', 'browser speech');
  }
  if (!before || before.brain !== S.plan.brain || before.voice !== S.plan.voice) log(`coach: ${S.plan.why}`);
  $('coachState').title = S.plan.why;
  renderConnections();
  return S.plan;
}
/** What the coach line says while no session is up. */
function idleState() {
  $('coachState').textContent = !S.plan ? 'checking connections...' : brain() === 'none' ? "off (the engine's own cues)"
    : brain() === 'eleven' ? 'starts with the workout' : 'starting...';
}
/**
 * The plan changed (a picker, the connections, a failure): end the sessions it no longer wants and start its own. An
 * agent session is either text-only (this page speaks) or with its voice: one the other way, or of another agent, ends,
 * and while a workout runs or starts the new one connects (start() goes on with it).
 */
async function applyPlan() {
  ensureVoice();
  const e = S.eleven;
  if (brain() !== 'eleven' || (e && (e.agentId !== S.conns?.eleven?.agentId || e.textOnly === elevenListen()))) await stopEleven();
  if ((S.sid ? S.sidBrain : S.cliStart?.brain) !== brain()) stopCli();    // (a session, or one starting, of another)
  if (!S.eleven && !S.sid) idleState();
  syncListening();                                      // (the page listens for every coach but the agent)
  return ensureCoach();
}
/**
 * The coach the plan chose could not start (the agent refused the session, a CLI session did not connect in time): it
 * is skipped from now on, until the coach picker changes or Connections is checked again (the agent: until the next
 * Start), and the plan moves on to the next usable one (connections.js fallback). Events already sent to it get the
 * engine's cue (their fallback timers: S.cues keeps them by session, so the next session starting does not drop them).
 */
function failBrain(b, reason) {
  if (brain() !== b) return null;                       // (the plan has moved on already)
  if (cliBrain(b)) stopCli();
  reason = String(reason || '').replace(/\s+/g, ' ');   // (a client's message can carry a whole JSON reply)
  if (reason.length > 120) reason = `${reason.slice(0, 117)}...`;
  const { failed, plan } = fallback(S.conns ?? null, choice(), b, reason);
  S.failed = failed;
  log(`${brainLabel(S.conns, b)} could not start (${reason}); ${plan.brain === 'none' ? "speaking the engine's cues"
    : `moving on to ${brainLabel(S.conns, plan.brain)}`}`, 'err');
  replan();
  return applyPlan();
}

const FALLBACK = {
  start: ex => `Let's go. ${ex}, I'm watching your form.`,
  fixed: () => "Nice, that's fixed. Keep it there.",
  praise: () => 'Great form, keep it up.',
  visibility: () => 'Step back so I can see your whole body.',
  set_summary: (ex, n) => `Set done: ${n} reps of ${ex}.`,
  ask_exercise: () => "Let's go. Which exercise or movement are you doing? Tap it, or just start and I'll recognise the exercise.",
  exercise_auto: () => "No problem: I'll recognise the exercise as you go.",
  exercise_set: (key, label) => (key === 'auto' ? "OK, I'll recognise the exercise as you go." : `${label}, got it. I'm counting.`),
  confirm_set_end: e => `That's ${e.reps} ${e.reps === 1 ? 'rep' : 'reps'} of ${e.label}. Done with this set?`,
  set_goes_on: () => 'Okay, keep going.',
  // the user's words, with no coach to answer them (the engine applies an exercise named, or an answer, itself)
  user_said: () => 'I can count and coach your reps; for questions, connect Claude or ChatGPT.',
  set_start: e => (e.previous ? `${e.previous.label}: ${e.previous.reps} reps. Now ${e.label}, I'm counting.` : `${e.label}. I'm counting.`),
  // (and the movements of the library the user named, with their times or rough counts: movesDone())
  workout_summary: (e, moves = []) => {
    const done = [...Object.values(e.totals).map(x => `${x.reps} ${x.label.toLowerCase()} reps in ${x.sets} ${x.sets === 1 ? 'set' : 'sets'}`),
      ...moves.filter(m => m.reviewed || m.seconds > 0 || m.count > 0).map(m => m.track === 'technique'
        ? `${m.display.toLowerCase()}: technique reviewed` : `${m.display.toLowerCase()} ${m.count > 0
        ? `about ${m.count}` : `${m.track === 'hold' ? 'held ' : ''}${spokenTime(m.seconds)}`}`)];
    return done.length ? `Workout done: ${done.join(', ')}.` : 'Workout stopped. I did not see a full set of any exercise.';
  },
  // a movement of the library named, after the set it ended (`ended`: its set_end, or the set in progress the user's
  // words ended), and its tracker's events
  movement_set: (m, ended = null) => `${ended ? `${ended.label}: ${ended.reps} ${ended.reps === 1 ? 'rep' : 'reps'}. ` : ''}${({
    hold: `${m.display}: settle into it and hold still, I'll time it.`, moving: `${m.display}: I'll time how long you keep moving.`,
    technique: `${m.display}: jab, cross, then guard. I'll check each attempt without counting.`,
    rhythm: `${m.display}: I'll keep a rough count.` })[m.track]}`,
  // a hold's form (web/js/holdform.js, for the movements it has checks for, in `form`): the fault measured as the user
  // settled, then a fault measured later and a fault the user fixed. A hold is called good only if its form was
  // measured and found nothing (formFine); else the hold alone: no form check, a check out of view or seen from a view
  // that cannot judge it, or a fault measured and waiting its turn (told a second or two later: never "Good" first)
  hold_start: e => (e.form?.open?.length ? e.form.open[0].cue
    : formFine(e.form) ? 'Good, hold it there.' : 'Hold it there.'),
  hold_fault: e => e.cue ?? '',
  hold_fix: () => "That's it. Keep it there.",
  hold_progress: e => `${spokenTime(e.seconds)}. Keep holding, keep breathing.`,
  hold_end: e => (e.seconds >= 5 ? `You held it for ${spokenTime(e.seconds)}.` : ''),   // (a pause of a few seconds: nothing said)
  moving_progress: e => e.kind === 'dance' || e.movementKind === 'dance' ? 'Keep exploring the movement at your own pace.' : `${spokenTime(e.seconds)} of moving. Keep it up.`,
  technique_result: e => e.cue || '',
  rhythm_progress: e => `About ${e.count} so far. Keep going.`,
  // a moving or rhythm movement's guard rails (web/js/moveform.js): a clear mistake measured while the user moves, and
  // its fix. Never "good form" as a whole: its checks look for a few mistakes only (coach.py says the same), and the
  // user is still moving, so not "keep it there"
  form_fault: e => e.cue ?? '',
  form_fix: () => "That's it. Keep it up.",
  // every check of the movement out of the frame (or seen from a view that cannot judge it) a while: what to do about
  // it (moves.js form_unseen: the user's side crunch had its feet out of the picture for 46 s, its form never
  // checked, and nobody said so). Not a fault: nothing is called wrong
  form_unseen: e => e.cue || unseenWords(e),
};
/** A hold's form (HoldForm state()) measured and found nothing: some checks measured and fine, and none open (told,
 * still there), pending (a fault waiting its turn), unseen (its parts out of the frame) or wrongView (measurable only
 * from another view). The engine's "Good, hold it there." and the Now card's "Form checked" go by it, as coach.py's
 * "measured and fine so far" does. */
const formFine = form => !!form?.checked?.length
  && !['open', 'pending', 'unseen', 'wrongView'].some(k => form[k]?.length);
/** A form_unseen without a cue of its own, in words: turn to the camera (`why` 'view'), else step back (its
 * `parts`). */
const unseenWords = e => (e?.why === 'view' ? 'Turn to face the camera so I can check your form.'
  : `Step back so I can see your ${Array.isArray(e?.parts) && e.parts.length ? e.parts.join(' and ') : 'whole body'}.`);
/** A form_unseen `e` still holds in the form `form` (MoveForm or HoldForm state()): every check it named (`missing`)
 * out of the frame or seen from the wrong view now (without names: nothing measured, something unseen). */
function unseenLasts(e, form) {
  if (!form) return false;
  const off = new Set([...(form.unseen ?? []), ...(form.wrongView ?? [])]);
  if (Array.isArray(e?.missing) && e.missing.length) return e.missing.every(n => off.has(n));
  return off.size > 0 && !['checked', 'open', 'pending'].some(k => form[k]?.length);
}
/** Seconds as said: "45 seconds", "1 minute 5 seconds"; and as shown: "1:05". */
function spokenTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0)), m = Math.floor(s / 60), r = s % 60;
  return [m && `${m} minute${m === 1 ? '' : 's'}`, (r || !m) && `${r} second${r === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}
const mmss = sec => { const s = Math.max(0, Math.floor(Number(sec) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Claude or ChatGPT: one coach session per page, started as soon as the plan names it (a CLI takes several seconds to
// start) and kept across sets; one that has not connected CONNECT_MS after it started is given up on (failBrain). An
// ElevenLabs agent: a session per workout, from Start to just after the workout summary (it bills by the minute);
// during a workout it also ends when nothing happens (no event for IDLE_MS, or the page hidden for HIDDEN_MS), and the
// next event brings it back.
const END_MS = 25000;          // the longest an agent session stays up after the workout summary went to it
const STOP_END_MS = 15000;     // ... and after Stop, if no summary went (it waits about CAP_MS at most for a reply in flight)
const IDLE_MS = 5 * 60000, HIDDEN_MS = 60000;
const CONNECT_MS = 30000;      // a CLI session's first wait_for_event (measured: Claude Sonnet 2.7 s, ChatGPT 4.8 s)
const CLOSE_MS = 5000;         // the longest a new agent session waits for the last one to close
async function ensureCoach() {
  if (S.startGate || (S.startIntroPending && !S.running && !S.talking && !S.starting)) return null;
  const b = brain();
  if (b === 'none') { idleState(); return null; }
  if (app && !S.appConnection) return null;      // (in the app: no coach starts before the app says what is connected)
  if (b === 'eleven') return S.running || S.starting || S.talking ? startEleven() : null;
  if (S.sid && S.sidBrain === b) return S.sid;
  if (S.cliStart?.brain === b) return S.cliStart.promise;    // (asked again while it starts: one session)
  const start = S.cliStart = { brain: b };
  start.promise = (async () => {
    try {
      const sid = (await post('/api/coach/start', { exercise: 'workout', brain: b })).session;
      if (S.cliStart !== start) {                       // the plan moved on while it started
        navigator.sendBeacon('/api/coach/stop', JSON.stringify({ session: sid }));
        return null;
      }
      S.sid = sid; S.sidBrain = b; S.sidAt = performance.now();
      S.said = 0; S.cues.use(sid);                      // its cues are read from now on (what went to the last still falls back)
      $('coachState').textContent = 'starting...';
      clearInterval(S.poll);
      S.poll = setInterval(pollSaid, 300);
      return sid;
    } catch (e) {
      if (S.cliStart === start) { S.cliStart = null; await failBrain(b, e.message); }
      return null;
    } finally {
      if (S.cliStart === start) S.cliStart = null;
    }
  })();
  return start.promise;
}
function stopCli() {
  S.cliStart = null;                                    // (one still starting stops once it is up)
  if (!S.sid) return;
  navigator.sendBeacon('/api/coach/stop', JSON.stringify({ session: S.sid }));
  S.sid = null; S.sidBrain = null; clearInterval(S.poll);
}
async function stopEleven() {
  clearTimeout(S.elevenEnd);
  S.elevenEnding = false;
  const coach = S.eleven;
  S.eleven = null;
  clearElevenPending();
  if (coach) {
    // (one still connecting ends as soon as it is up). The next session waits for this one to close: the agent takes
    // one at a time, and refuses a second
    const closing = S.elevenClosing = coach.stop().catch(() => {});
    standIn(coach, coach.waiting.slice());              // only after the old agent's audio has been silenced
    await closing;
    if (S.elevenClosing === closing) S.elevenClosing = null;
  }
  if (coach && !S.eleven && brain() === 'eleven') $('coachState').textContent = 'starts with the workout';
  renderMic();
}
/** A retired or disconnected session must not speak from a fallback timer after its replacement starts. */
function clearElevenPending() {
  for (const p of S.elevenPending.values()) clearTimeout(p.timer);
  S.elevenPending.clear();
}
/**
 * Events still waiting to go to an agent that will not take them in time (it is still connecting after FALLBACK_MS, it
 * failed to, or it is going away): they no longer go, and the engine speaks the newest one's own cue in their place (one
 * cue, as for a message of several). Once the workout has stopped, only a summary's. Returns the newest one.
 */
function standIn(coach, events) {
  const left = events.filter(e => coach.withdraw(e));
  for (const e of left) clearTimeout(S.elevenFallback.get(e)?.timer);
  const last = left.at(-1), fb = last && S.elevenFallback.get(last);
  if (last && !fb?.ev?.withdrawn && (S.running || S.elevenFinal.has(last))) speak(fb?.text ?? FALLBACK.praise(), 'engine');
  return last;
}
/** An agent session with nothing to do ends; while a workout runs, the next event brings it back (coachEvent). */
function sleepEleven(why) {
  if (!S.eleven) return;
  S.elevenAsleep = S.running || S.starting;
  log(`ElevenLabs: ${why}, so the session ends${S.elevenAsleep ? ' (the next event reconnects it)' : ''}`);
  stopEleven().then(() => { if (S.elevenAsleep && !S.eleven) $('coachState').textContent = 'paused (back with the next event)'; });
}
function armIdle() {
  clearTimeout(S.elevenIdle);
  S.elevenIdle = setTimeout(() => sleepEleven('no event for 5 minutes'), IDLE_MS);
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(S.elevenHidden);
  if (document.hidden) S.elevenHidden = setTimeout(() => sleepEleven('the page was hidden for a minute'), HIDDEN_MS);
});
window.addEventListener('pagehide', () => { stopCli(); S.eleven?.stop(); });

S.elevenPending = new Map();       // ElevenLabs: messages on their way, by their marks (with the fallback timer)
S.elevenFallback = new WeakMap();  // ... each event's own engine cue, for when no reply comes in time, and when it happened
                                   //     (and while it waits for the session to connect, its own fallback timer)
S.elevenFinal = new WeakSet();     // ... the workout summaries: the session ends once one has been answered
S.elevenLast = 0;
async function startEleven() {
  if (S.trackingBlocked || S.startGate) return null;
  if (S.eleven && S.eleven.agentId === S.conns?.eleven?.agentId && S.eleven.textOnly === !elevenListen()) return S.eleven;
  await stopEleven();
  // a session ended just before (asleep, or the last workout's) closes first; one whose close hangs is not waited for long
  await Promise.race([S.elevenClosing, new Promise(r => setTimeout(r, CLOSE_MS))]);
  // the plan moved on while the last session ended, or no workout (nor a conversation) wants a coach any more
  if (brain() !== 'eleven' || !(S.running || S.starting || S.talking)) return S.eleven;
  if (S.eleven) return S.eleven;                  // another start (two events in one frame) made one meanwhile
  const agentId = S.conns?.eleven?.agentId;
  if (!agentId) { await failBrain('eleven', 'no agent is set up'); return null; }
  // the agent's own LLM and voice: it refuses any client override but text_only, so none is sent (no llm). With its
  // voice the session is duplex: the user talks to it through the microphone (text only, the page speaks: no microphone).
  // Talk to coach is always duplex. The user's Mute stands for the next session: it starts without opening the microphone
  const listen = elevenListen();
  const localSession = !app && S.conns?.eleven?.signedSessions
    ? async () => (await post('/api/elevenlabs/session', {})).signedUrl : null;
  const coach = new ElevenCoach({ agentId, signedUrl: accountSession || localSession, textOnly: !listen, listen, muted: !!S.micMuted });
  // talking with the coach is activity too: the session is not ended for want of events in the middle of it
  const awake = () => { if (S.eleven === coach) { S.elevenLast = performance.now(); armIdle(); armTalkIdle(); } };
  if (S.elevenAsleep) log('ElevenLabs: reconnecting');
  S.eleven = coach; S.elevenAsleep = false;
  if (!coach.textOnly) { S.voiceOut?.cancel(); S.voiceOld?.close(); S.voiceOld = null; }
  $('coachState').textContent = 'connecting...';
  renderMic();
  armIdle();
  let answered = false;                           // a session that closes before its first reply failed to start
  try {
    await coach.start({
      // the reply started (with the agent's voice, its sound comes before its text): no fallback needed
      onReply: marks => {
        if (S.eleven !== coach) return;
        answered = true;
        const p = S.elevenPending.get(marks);
        if (!p || p.late) return;
        clearTimeout(p.timer);
        p.started = true;
        if (marks.audio) $('cueDelay').textContent = `${((marks.audio - p.t0) / 1000).toFixed(1)} s (event to voice)`;
      },
      onCue: ({ text, marks, user }) => {
        if (S.eleven !== coach) return;
        if (S.trackingBlocked) return;
        answered = true;
        const p = S.elevenPending.get(marks);
        // (a late reply that also answers the user's words is theirs: it is heard, see eleven-coach.js)
        if ((!p || (p.late && !p.started)) && !user) { log(`(late coach cue skipped: ${text})`); return; }
        // a question the user answered while it was on its way (a tap, or a rep that withdrew it)
        if (!user && p?.events?.length && p.events.every(e => S.elevenFallback.get(e)?.ev?.withdrawn)) {
          log(`(already answered, skipped: ${text})`);
          if (p) clearTimeout(p.timer);
          return;
        }
        if (p) clearTimeout(p.timer);
        speak(text, 'coach', p?.t0 ?? null, !coach.textOnly);   // (with the agent's voice: shown and logged, already heard)
      },
      // duplex: the user's words, and what the agent said to them (or on its own): no message of the page's
      // (the agent speaking up on its own is no activity: it would keep the session up for ever)
      onUser: text => { if (S.eleven !== coach) return; answered = true; awake(); log(`You: ${text}`, 'you'); chat('you', text); if (restartRequested(text)) restartMovement(); },
      onSaid: ({ text, user }) => { if (S.eleven !== coach || S.trackingBlocked) return; answered = true; if (user) awake(); speak(text, 'coach', null, !coach.textOnly); },
      // ... and what the agent does with the user's words: the page applies it, and the agent says a few words with what
      // the tool returns (a voice answer is confirmed by the agent itself: the coach is not sent exercise_set or set_end).
      // Only in a reply to the user's own words: live, the agent read "Set 1 finished (the user said they are done)" as
      // an answer and ended the next set, one rep in
      tools: {
        set_exercise: ({ exercise } = {}, { byUser } = {}) => (byUser ? chooseExercise(String(exercise ?? ''), 'voice')
          : onItsOwn('set_exercise')),
        answer_set_end: ({ done } = {}, { byUser } = {}) => (byUser ? answerSetEnd(done === true || done === 'true', 'voice')
          : onItsOwn('answer_set_end')),
        // a movement of the library the user named (not one of the 13 exercises): tracked, never recognised
        set_movement: ({ movement } = {}, { byUser } = {}) => (byUser ? chooseMovement(String(movement ?? ''), 'voice')
          : onItsOwn('set_movement')),
      },
      // a message went to the agent (an event, or the ones that came while it answered): the engine speaks the latest
      // event's own cue if no reply comes in time. With the agent's voice that fallback is on screen only; with a local
      // voice it is spoken and the late reply is suppressed (release). The next
      // message waits for that reply all the same (up to the coach's cap): two messages out at once get one reply
      onDispatch: (marks, events) => {
        if (S.eleven !== coach) return;
        for (const e of events) clearTimeout(S.elevenFallback.get(e)?.timer);    // (one that waited for the connect)
        const final = S.elevenEnding && events.some(e => S.elevenFinal.has(e));
        // (while the user is talking with the agent, its answer is coming, likely for this message too: the engine's cue
        // would talk over it, so it waits, up to the coach's cap)
        const fire = () => {
          if (S.eleven !== coach || S.elevenPending.get(marks) !== p) return;
          if (coach.userBusy && performance.now() - marks.t0 < CAP_MS) { p.timer = setTimeout(fire, 500); return; }
          p.late = coach.textOnly;                  // a visible cue must not mute the agent's only spoken answer
          // the latest event's cue, but not a question the user has answered meanwhile
          const fb = events.map(e => S.elevenFallback.get(e)).reverse().find(f => !f?.ev?.withdrawn);
          if (fb !== undefined || !events.length) speak(fb?.text ?? FALLBACK.praise(), 'engine');
          if (coach.textOnly) coach.release(marks);
          if (p.final && coach.textOnly && S.elevenEnding && S.eleven === coach) stopEleven(); // the summary was spoken
        };
        const p = {
          final, events,
          t0: Math.min(...events.map(e => S.elevenFallback.get(e)?.at ?? marks.t0)),   // when the earliest event happened
          timer: setTimeout(fire, FALLBACK_MS),
        };
        S.elevenPending.set(marks, p);
        if (final) { clearTimeout(S.elevenEnd); S.elevenEnd = setTimeout(stopEleven, END_MS); }
      },
      // that message is finished with (its reply heard and played out, cut off, or none came): after the workout
      // summary's, the session ends
      onDone: (marks, how) => {
        if (S.eleven !== coach) return;
        const p = S.elevenPending.get(marks);
        clearTimeout(p?.timer);
        S.elevenPending.delete(marks);
        if (how === 'cap') log('(no reply from the agent in time: the next message goes once it has gone quiet)');
        if (p?.final && S.elevenEnding && S.eleven === coach) stopEleven();
      },
      onError: m => log(`ElevenLabs: ${m}`, 'err'),
      // closed by the agent's side (this page's own ends come with S.eleven already cleared): before its first reply, in
      // a workout, the session failed to start, and the next connection takes over
      onDisconnect: details => {
        if (S.eleven !== coach) return;
        S.eleven = null;
        clearElevenPending();
        $('coachState').textContent = 'stopped';
        renderMic();
        if (!answered && (S.running || S.starting || S.talking)) {
          standIn(coach, coach.waiting.slice());
          failBrain('eleven', details?.message || details?.closeReason || `the session closed (${details?.reason || 'no reason given'})`);
        } else if (S.talking && !S.running) endTalk('the agent ended the session');
      },
      // the agent is kept from speaking up on its own only while it has work: a workout with recent events, its summary,
      // or a conversation the user opened
      keepAlive: () => (S.running && performance.now() - S.elevenLast < IDLE_MS) || S.elevenEnding || S.talking,
    });
    if (S.eleven === coach) {
      $('coachState').textContent = `connected: ${brainLabel(S.conns, 'eleven')}${coach.textOnly ? ', text only' : ', its voice'}`;
      if (coach.mic === 'refused') log(`microphone: ${coach.micWhy}, so the coach cannot hear you: answer with the buttons`, 'err');
      else if (coach.mic === 'on' && !S.micTold) { S.micTold = true; log('microphone on: talk to the coach (Mute is in the side panel)'); }
      renderMic();
    }
  } catch (e) {
    if (S.eleven === coach) {
      S.eleven = null;
      clearElevenPending();
      standIn(coach, coach.waiting.slice());       // events sent while it connected: their own cue now
      await failBrain('eleven', e.message);        // (the agent refused the session, or could not be reached)
    }
  }
  return S.eleven;
}

// The agent's prompt is written for a user it hears: a session that cannot hear them (its text only, or the microphone
// muted or refused) is told so with each question, so that it does not ask them to say the answer.
const ASKS = new Set(['ask_exercise', 'confirm_set_end']);
const UNHEARD = 'The user cannot talk to you right now (no microphone): they answer by tapping on screen, so do not ask them to say it.';
const hears = coach => coach.listen && coach.mic !== 'muted' && coach.mic !== 'refused';
S.described = new WeakMap();       // an event -> what was sent to the agent for it (to withdraw it while it still waits)
S.askIds = new Map();              // "<session>/<event id>" -> a question sent to Claude or ChatGPT (to skip a late answer)
S.heardIds = new Map();            // ... -> the user's words sent to them (when the answer came, and was heard)

/** An event for the coach that no longer holds (the user answered meanwhile): if it has not gone to the agent yet, it
 * does not. (Claude and ChatGPT have it at once: there is nothing to withdraw.) */
function withdrawEvent(ev) {
  ev.withdrawn = true;                              // (still being described: it is not sent)
  const d = S.described.get(ev);
  if (d && S.eleven?.withdraw(d)) clearTimeout(S.elevenFallback.get(d)?.timer);
}

/**
 * An event for the coach; `fallbackText`: the engine's sentence, spoken if no cue comes in time (null: none, for the
 * user's words that only the coach can answer). `t0`: when it happened, if earlier (the user stopped talking); `wait`:
 * how long its cue may take (an answer to the user, longer than a cue).
 */
async function coachEvent(ev, fallbackText, { t0 = null, wait = FALLBACK_MS } = {}) {
  if (S.trackingBlocked) return; // no stale success fallback or remote reply after an unavailable tracker
  const at = t0 ?? performance.now();               // when it happened (the cue delay counts from here)
  const standInFor = () => {
    if (fallbackText != null) speak(fallbackText, 'engine');
    else log(`(no answer from the coach to: ${ev.text})`, 'err');
  };
  // the event names its own exercise and set (there is none before the first set); `auto`: no exercise was named.
  // (`heard`: the page's own record of the user's words, for timing them; not the coach's)
  const { heard: _heard, ...own } = ev;
  // (while a movement of the library is named, every event says which: no reps are counted meanwhile)
  const naming = S.move ? { movement: S.move.entry.key, movementDisplay: S.move.entry.display } : {};
  const event = { exercise: 'workout', exerciseLabel: 'workout', auto: !S.auto?.only, ...naming, ...own };
  // an agent session ended for want of events (idle, or the page hidden) comes back for this workout's next one
  const waking = !S.eleven && S.elevenAsleep && S.running && brain() === 'eleven';
  if (waking) startEleven();
  if (S.eleven || waking) {
    S.elevenLast = at; armIdle();
    try {
      const { event_id: _, ...described } = HOSTED ? describeHostedEvent(event, fallbackText)
        : await post('/api/coach/describe', { event });   // what Claude would read
      if (ev.withdrawn) return;                                                       // (answered meanwhile)
      const coach = S.eleven;
      if (!coach) { standInFor(); return; }                                           // (it ended, or did not start)
      if (ASKS.has(ev.kind) && !hears(coach)) described.summary = `${described.summary} ${UNHEARD}`;
      S.described.set(ev, described);
      const fallback = { text: fallbackText, at, ev };   // (ev: a question the user may answer before it is spoken)
      S.elevenFallback.set(described, fallback);
      const summary = ev.kind === 'workout_summary';
      if (summary) S.elevenFinal.add(described);
      // its fallback timer starts when it actually goes (onDispatch). One that waits for the session to connect, which
      // can take long or never happen, gets its own: still waiting then, it stays back and the engine's cue is spoken
      if (!coach.send(described) && !coach.connected) {
        fallback.timer = setTimeout(() => {
          // (a summary spoken so: the session has nothing left to do)
          if (standIn(coach, [described]) && summary && S.elevenEnding && S.eleven === coach) stopEleven();
        }, FALLBACK_MS);
      }
    } catch (e) {
      log(`coach unavailable (${e.message}); using the engine's cue`, 'err');
      standInFor();
    }
    return;
  }
  const sid = S.sid;
  if (!cliBrain(brain()) || !sid) {
    if (fallbackText == null && cliBrain(brain())) log(`(the coach is not connected yet, so it did not hear: ${ev.text})`, 'err');
    else standInFor();
    return;
  }
  try {
    // a question while the page cannot hear the user: describe() tells Claude or ChatGPT they will tap their answer
    const sent = ASKS.has(ev.kind) ? { ...event, listening: S.listener?.state === 'on' } : event;
    const { queued } = await post('/api/coach/event', { session: sid, event: sent });
    if (ASKS.has(ev.kind)) S.askIds.set(`${sid}/${queued}`, ev);
    if (ev.heard) S.heardIds.set(`${sid}/${queued}`, ev.heard);     // (the user's words: when its answer came, measured)
    // (also if that session fails; a question the user answered meanwhile is not asked)
    S.cues.sent(sid, queued, t0 ?? performance.now(), () => { if (!ev.withdrawn) standInFor(); }, wait);
  } catch (e) {
    log(`coach unavailable (${e.message}); using the engine's cue`, 'err');
    standInFor();
  }
}

async function pollSaid() {
  const sid = S.sid;
  if (!sid || S.polling) return;          // one poll at a time: two with the same `since` would speak a cue twice
  S.polling = true;
  try {
    const res = await fetch(`/api/coach/said?session=${sid}&since=${S.said}`);
    const r = await res.json();
    if (sid !== S.sid) return;             // a poll for a session that has since been replaced
    // one that never connected (its CLI exited: not signed in, say; or it is not coming in time), or one the server gave
    // up on (r.error: a ChatGPT session whose codex runs kept ending): the next connection takes over
    const failed = res.ok && (r.connected ? !r.alive && r.error
      : !r.alive ? r.error || 'its CLI exited before it connected'
        : performance.now() - S.sidAt > CONNECT_MS && `no connection ${CONNECT_MS / 1000} s after it started`);
    const via = r.transport === 'api' ? 'through the API' : 'over MCP';     // (an older server sends no transport)
    $('coachState').textContent = r.alive ? (r.connected ? `connected: ${brainLabel(S.conns, S.sidBrain)} ${via}`
      : 'starting...') : 'stopped';
    if (!r.alive) { S.sid = null; clearInterval(S.poll); }
    if (r.connected && S.sidLogged !== sid) {
      S.sidLogged = sid;
      log(`coach: ${brainLabel(S.conns, S.sidBrain)} connected${r.connect_ms != null ? ` in ${(r.connect_ms / 1000).toFixed(1)} s` : ''}`);
    }
    for (const item of r.said || []) {
      S.said += 1;
      const { late, t0 } = S.cues.cue(sid, item.event_id);
      if (late) { log(`(late coach cue skipped: ${item.text})`); continue; }
      if (S.askIds.get(`${sid}/${item.event_id}`)?.withdrawn) { log(`(already answered, skipped: ${item.text})`); continue; }
      const heard = S.heardIds.get(`${sid}/${item.event_id}`);
      // the user's words that were not meant for the coach (counting, talking to someone else): it says nothing
      if (!/[\p{L}\p{N}]/u.test(item.text || '')) { log(`(the coach let that pass${heard ? `: "${heard.text}"` : ''})`); continue; }
      if (heard) {
        heard.replyAt = performance.now(); heard.reply = item.text; heard.replyServerMs = item.latency_ms;
        log(`(the coach answered ${((heard.replyAt - heard.speechEnd) / 1000).toFixed(1)} s after you stopped talking; ` +
          `${item.latency_ms} ms on the server)`);
      }
      speak(item.text, 'coach', t0, false, heard ? { label: 'you to voice', onAudible: t => { heard.audibleAt = t; } } : {});
    }
    if (failed) failBrain(S.sidBrain, failed);
  } catch (_) { /* next poll */ } finally { S.polling = false; }
}

// --- the Connections panel: each connection's state, which one Auto uses, and the ElevenLabs agent to use (its id is
// not a secret: the agent answers only pages on this machine, POST/DELETE /api/connections/elevenlabs) ------------------
const SHORT = { eleven: 'ElevenLabs', claude: 'Claude', chatgpt: 'ChatGPT', none: 'engine cues' };
/**
 * What is connected, or null if the server did not say (GET /api/connections: the server checks the CLIs with a short
 * timeout and keeps the answers about a minute; `fresh`, from Check again, asks it to check them again now).
 */
async function readConnections(fresh = false) {
  if (app && !accountLocalClaude) return accountConnections(accountElevenLabs);
  try {
    const r = await fetch(`/api/connections${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const local = await r.json();
    if (!app) return local;
    // the account's ElevenLabs agent, and Claude Code signed in on this computer
    return { ...accountConnections(accountElevenLabs), claude: local.claude };
  } catch { return null; }
}
/** What is connected, shown and planned for. */
async function loadConnections(fresh = false) {
  $('connCheck').disabled = true;
  S.conns = await readConnections(fresh);
  $('connCheck').disabled = false;
  if (!S.conns) log('the server did not say what is connected (/api/connections): Auto tries Claude', 'err');
  // (a server that keeps its answers for a minute whatever it is asked shows a sign-in from just now only after that)
  else if (fresh && ['claude', 'chatgpt'].some(b => S.conns[b]?.available && !S.conns[b]?.loggedIn)) {
    connNote('Checked. A sign-in from the last minute can take up to a minute to show here.');
  }
  fillAgentForm();
  replan();
  return applyPlan();
}
function renderConnections() {
  const d = describe(S.conns ?? null);
  for (const b of ORDER) {
    const el = $(`conn-${b}`);
    el.replaceChildren(d[b].text);
    if (d[b].cmd) { const c = document.createElement('code'); c.textContent = d[b].cmd; el.append(' ', c); }
    if (S.failed[b]) {
      const f = document.createElement('span');
      f.className = 'err'; f.textContent = ` Failed to start: ${S.failed[b]}.`;
      el.append(f);
    }
    el.classList.toggle('live', brain() === b);       // the one coaching now
  }
  // the page's own listening (Parakeet), highlighted while it listens
  const st = describeStt(S.stt), sttEl = $('conn-stt');
  sttEl.replaceChildren(st.text);
  if (st.cmd) { const c = document.createElement('code'); c.textContent = st.cmd; sttEl.append(' ', c); }
  sttEl.classList.toggle('live', !!S.listener && S.listener.state !== 'refused');
  const auto = resolve(S.conns ?? null, { ...choice(), coach: 'auto' });
  $('connAuto').textContent = auto.label + (listens(auto, S.stt) === 'page' ? ', listening on this Mac (Parakeet)' : '');
  // the pickers say what Auto would use, and which Claude and ChatGPT models run
  const opt = Object.fromEntries([...$('coachKind').options].map(o => [o.value, o]));
  opt.auto.text = `Auto (${SHORT[auto.brain]})`;
  opt.claude.text = brainLabel(S.conns, 'claude');
  opt.chatgpt.text = brainLabel(S.conns, 'chatgpt');
  const agentVoice = resolve(S.conns ?? null, { ...choice(), voice: 'auto' }).voice === 'eleven';
  $('voiceKind').options[0].text = `Auto (${agentVoice ? "the agent's" : HOSTED ? 'browser voice' : 'Kokoro'})`;
}
/** The agent form shows the agent set up now (not while it is being edited). */
function fillAgentForm() {
  const e = S.conns?.eleven, plan = $('elevenPlan');
  if (document.activeElement !== $('elevenAgent')) $('elevenAgent').value = e?.agentId || '';
  if (e?.plan && ![...plan.options].some(o => o.value === e.plan)) plan.add(new Option(e.plan, e.plan));
  if (document.activeElement !== plan) plan.value = e?.plan || '';
  $('elevenForget').disabled = !e?.connected;
}
function connNote(text, cls = 'muted') { $('connMsg').textContent = text; $('connMsg').className = cls; }
/** Save or forget the agent; the server answers with what is connected now. A new agent (or none) is tried again. */
async function setAgent(method, body, done) {
  try {
    const r = await fetch('/api/connections/elevenlabs', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    S.conns = j;
    const { eleven: _, ...failed } = S.failed;
    S.failed = failed;
    fillAgentForm();
    connNote(done);
    replan();
    await applyPlan();
  } catch (e) { connNote(`Could not ${method === 'DELETE' ? 'forget' : 'save'} it (${e.message})`, 'err'); }
}
$('elevenForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const agentId = $('elevenAgent').value.trim();
  if (!AGENT_ID.test(agentId)) { connNote('An agent id is agent_ and 20-40 lowercase letters and digits (on the agent\'s page in ElevenLabs)', 'err'); return; }
  setAgent('POST', { agentId, plan: $('elevenPlan').value || null }, 'Saved.');
});
$('elevenForget').addEventListener('click', () => setAgent('DELETE', {}, 'Forgotten.'));
// checking again also tries again what failed to start
$('connCheck').addEventListener('click', () => { S.failed = {}; connNote(''); S.connsLoad = loadConnections(true); });
idleState();
renderConnections();
S.connsLoad = loadConnections();

// --- the coach asks: which exercise (at the start), and whether a set is done -------------------------------------
// Answered by voice (duplex: the agent's client tools), by the chips and buttons in the side panel, or not at all. The
// workout counts from the start meanwhile (auto mode), so no rep is lost while the user is being asked.
const ASK_EXERCISE_MS = 12000;     // no answer to "which exercise?" in this long: auto mode goes on (exercise_auto)
const ASK_MORE_MS = 1000;          // ... unless the user is talking with the coach just then: looked at again (up to CAP_MS)
const exLabel = key => (key === 'auto' ? 'Detect for me' : EXERCISES[key]?.label ?? key);
for (const key of [...Object.keys(EXERCISES), 'auto']) {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.key = key; b.textContent = exLabel(key);
  b.addEventListener('click', () => chooseExercise(key, 'tap'));
  $('exChips').append(b);
}
{ // ... and any other movement: the movement library (the Movements card)
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'otherMove'; b.textContent = 'Other movement...';
  b.title = 'A gym move, a stretch, a dance, a flow...: pick it in the Movements card';
  b.addEventListener('click', () => openLibrary());
  $('exChips').append(b);
}
/** The exercise chips, with the one counted now marked; `asking`: the coach's question (else "Change exercise"). */
function showExercises(asking) {
  const now = S.move ? null : S.auto?.only ?? 'auto';      // (a movement named: no exercise is counted)
  for (const b of $('exChips').children) b.classList.toggle('on', !asking && b.dataset.key === now);
  $('askExText').textContent = asking ? 'Which exercise or movement are you doing? Or just start.' : 'Which exercise now? (Or another movement)';
  $('askEx').hidden = false;
  $('changeEx').textContent = 'Close';
}
function hideExercises() {
  clearTimeout(S.askTimer); S.asking = false;
  if (S.askEx) { withdrawEvent(S.askEx); S.askEx = null; }       // answered (or no answer in time): not asked again
  $('askEx').hidden = true;
  $('changeEx').textContent = 'Change exercise';
}
/** At Start, in auto mode: the coach asks, the chips show, and with no answer in ASK_EXERCISE_MS auto mode goes on. */
function askExercise(intro = false) {
  S.asking = true;
  showExercises(true);
  S.askEx = intro ? sessionIntroEvent() : { kind: 'ask_exercise' };
  if (intro) $('askExText').textContent = 'What would you like to do today?';
  coachEvent(S.askEx, intro ? SESSION_INTRO_TEXT : FALLBACK.ask_exercise());
  // Leave room for the introduction and the user's answer; a timeout must not cut it off with an auto-mode cue.
  if (intro) { clearTimeout(S.askTimer); return; }
  const until = performance.now() + ASK_EXERCISE_MS + CAP_MS;
  const check = () => {
    if (!S.asking) return;
    // the user is talking with the agent just now (their answer, most likely): its set_exercise call is still coming;
    // or the page is hearing them, or writing their words down
    if ((S.eleven?.userBusy || S.hearing || S.writing) && performance.now() < until) { S.askTimer = setTimeout(check, ASK_MORE_MS); return; }
    noAnswer();
  };
  clearTimeout(S.askTimer);
  S.askTimer = setTimeout(check, ASK_EXERCISE_MS);
}
/** No answer to "which exercise?" (none in time, or the question closed): auto mode goes on, and the coach is told so,
 * unless a set was recognised meanwhile (its set_start named the exercise already: nothing more to say). */
function noAnswer() {
  hideExercises();
  if (!S.running || !S.auto || S.auto.only || S.auto.sets.length || S.move) return;
  log('no answer: the exercise is recognised as you go');
  S.autoTold = { kind: 'exercise_auto' };          // (withdrawn if an answer comes while it still waits: chooseExercise)
  coachEvent(S.autoTold, FALLBACK.exercise_auto());
}
// closing the start question is no answer; closing "Change exercise" later says nothing
$('changeEx').addEventListener('click', () => {
  if ($('askEx').hidden) { if (S.running) showExercises(false); } else if (S.asking) noAnswer(); else hideExercises();
});

/**
 * The user named the exercise (`key`, or 'auto' to detect it): only it is counted from now on (a set of another one in
 * progress ends). By a chip the coach is told; by voice (the agent's set_exercise) the agent confirms it itself. What
 * it returns is the tool's answer to the agent. `entry`: the movement of the library named, a gym exercise the engine
 * counts as `key` (its animation is the reference: Show in 3D). A movement of the library named before ends: its time
 * or count is kept, and reps are counted again.
 */
function chooseExercise(key, how, entry = null) {
  if (!S.running || !S.auto) return 'No workout is running.';
  if (key !== 'auto' && !EXERCISES[key]) return `There is no exercise "${key}": use one of ${Object.keys(EXERCISES).join(', ')}, or auto.`;
  const was = S.auto.only ?? 'auto';
  hideExercises();
  // an answer after all: "no answer, I'll recognise it" must not follow it to the coach, if it has not gone yet
  if (S.autoTold) { withdrawEvent(S.autoTold); S.autoTold = null; }
  const left = finishMovement();
  if (left) resumeReps();
  S.reference = entry;
  let ended = null;
  if (key !== was) {
    // what auto mode was holding back no longer applies (setExercise drops it): its grey first rep and notes go too
    clearTentative(false); S.lapse = null;
    const evs = S.auto.setExercise(key, S.auto.lastT);
    if (S.rec) S.rec.events.push(...evs);
    ended = evs.find(e => e.type === 'set_end');
    handleAuto(evs);
  }
  const a = S.auto.active, name = entry?.display ?? exLabel(key);
  if (!a) {
    $('reps').textContent = '-'; $('reps').classList.remove('tentative');
    $('repsLabel').textContent = key === 'auto' ? 'start any exercise' : `${name}: start your set`;
  } else if (key !== was) { $('reps').textContent = a.count; $('repsLabel').textContent = setLabel(a); }
  renderWorkout(); showFraming(); renderMove(); markLibrary();
  log(`${how === 'voice' ? 'You told the coach' : 'You picked'}: ${key === 'auto' ? 'detect the exercise' : name}${entry ? ` (counted as ${exLabel(key)})` : ''}` +
    `${left ? ` (${left.display} ended: reps are counted again)` : key === was ? ' (already so)' : ''}`, 'you');
  if (how === 'tap') coachEvent({ kind: 'exercise_set', exercise: key, label: exLabel(key), ...(entry ? { movement: entry.key, display: entry.display } : {}) },
    FALLBACK.exercise_set(key, name));
  const before = (ended ? `${ended.label} set ${ended.set} ended at ${ended.reps} reps. ` : '') + (left ? `${left.display} ended (${doneText(left)}). ` : '');
  return before + (key === 'auto' ? 'Recognising the exercise from their movement.' : `Counting ${exLabel(key)} only now${entry ? ` (${entry.display})` : ''}.`);
}

/** The tracker thinks a set is over (auto.js set_end_pending): the coach asks, and Done / Not yet show. */
function askSetEnd(e) {
  S.pendingEnd = e;
  $('askEndText').textContent = `${e.label} set ${e.set}: ${e.reps} ${e.reps === 1 ? 'rep' : 'reps'}. Done with this set?`;
  $('askEnd').hidden = false;
}
function hideSetEnd() {
  S.pendingEnd = null; $('askEnd').hidden = true;
  if (S.askEnd) { withdrawEvent(S.askEnd); S.askEnd = null; }   // answered or moot: it is not asked after all
}
/**
 * The user's answer: done ends the set (confirmed), not yet keeps it going. By the buttons the coach is told of the
 * set's end as after a rest; by voice (the agent's answer_set_end) the agent has the reps from what this returns.
 * `reason`: why the set ends, if not the user's answer ('movement': a movement of the library was named, which pauses
 * the reps; the coach must not hear that they tapped Done).
 */
function answerSetEnd(done, how, reason = 'confirmed') {
  if (!S.running || !S.auto) return 'No workout is running.';
  const asked = S.pendingEnd;
  S.endByVoice = how === 'voice';
  const evs = S.auto.answerSetEnd(done, S.auto.lastT);
  for (const e of evs) if (e.type === 'set_end') e.reason = reason;
  if (S.rec) S.rec.events.push(...evs);
  try { handleAuto(evs); } finally { S.endByVoice = false; }
  hideSetEnd();
  const ended = evs.find(e => e.type === 'set_end');
  if (!done) log(`${how === 'voice' ? 'You told the coach' : 'You picked'}: not done yet${asked ? `, ${asked.label} set ${asked.set} goes on` : ''}`, 'you');
  if (ended) return `${ended.label} set ${ended.set} done: ${ended.reps} reps.`;
  // (the agent may answer for the user after they tapped Done: say what is so)
  const a = S.auto.active, last = S.ended.at(-1);
  if (!a) return last ? `${last.label} set ${last.set} had already ended, at ${last.reps} reps.` : 'No set is in progress.';
  return `${a.label} set ${a.set} goes on (${a.count} reps so far).`;
}
/** The agent called a tool with no words of the user's to act on: nothing changes, and it is told what is so. */
function onItsOwn(tool) {
  log(`(the coach called ${tool} on its own: ignored)`);
  const a = S.auto?.active, last = S.ended.at(-1);
  const now = !S.running || !S.auto ? 'No workout is running.'
    : S.move && tool !== 'answer_set_end' ? `Tracking ${S.move.entry.display} (${trackLabel(S.move.entry)}); no reps are counted.`
    : tool !== 'answer_set_end' ? (S.auto.only ? `Counting ${exLabel(S.auto.only)} only.` : 'Recognising the exercise as they go.')
      : a ? `${a.label} set ${a.set} is in progress (${a.count} reps).`
        : last ? `${last.label} set ${last.set} has ended, at ${last.reps} reps.` : 'No set is in progress.';
  return `Nothing changed: this tool is only for the user's own spoken answer. ${now}`;
}
$('endDone').addEventListener('click', () => answerSetEnd(true, 'tap'));
$('endNot').addEventListener('click', () => answerSetEnd(false, 'tap'));

// --- the movement library: any movement the user names (/moves/library.json, built by tools/build_moves.mjs; git-
// ignored), tapped in the Movements card or said (intents.js knows its spoken names; the agent has set_movement). The
// page never recognises one: web/js/moves.js keeps track of the one named with what the camera measures reliably (a
// hold timer, the time moving, an approximate rhythm). A gym exercise of the library goes the exercise's own way
// (chooseExercise: the engine counts its reps), with its animation as the reference; while any other one is named, reps
// are not counted (the AutoTracker gets no frames) until the user names an exercise or "detect it". The coach hears of
// it (movement_set, or the user's words with what was applied) and of its tracker's events (hold_start, hold_progress,
// hold_end, moving_progress, rhythm_progress; a hold's form, for a movement web/js/holdform.js checks: hold_fault,
// hold_fix, and `form` on the hold's own events; a moving or rhythm movement's, for one web/js/moveform.js checks:
// form_fault, form_fix, and `form` on its progress) -------------------------------------------------------------------
S.library = [];               // library.json's movements
S.libByKey = new Map();
S.moveNames = [];             // intents.js movementNames(): what the user can say
S.move = null;                // the movement named now, one the engine does not count: {entry, tracker}
S.reference = null;           // the library's movement named now, counted or not (its animation: Show in 3D)
S.moves = [];                 // this workout's movements, done: {movement, display, movementKind, track, seconds | count}
S.nextMove = null;            // one picked before Start
S.Tracker = null;             // web/js/moves.js MovementTracker and statusText, once loaded
const movesJs = loadMovementModule()
  .then(m => { S.Tracker = m.MovementTracker; S.statusText = m.statusText; return m; })
  .catch(e => { log(`movement tracking is not available (web/js/moves.js: ${e.message})`, 'err'); return null; });
// (and a held pose's measures, for its form check's reference pose: the user's working side, workingSide())
const holdformReady = import('./holdform.js').then(h => { S.poseMetrics = h.poseMetrics; }).catch(() => {});
const TRACK_EVENTS = new Set(['hold_start', 'hold_progress', 'hold_end', 'hold_fault', 'hold_fix', 'moving_progress',
  'rhythm_progress', 'form_fault', 'form_fix', 'form_unseen', 'technique_result']);
const isCounted = m => m?.track === 'reps' && !!EXERCISES[m.engine];
const TRACK_LABEL = { reps: m => `reps counted (as ${exLabel(m.engine)})`, hold: () => 'hold timer', moving: () => 'time moving',
  rhythm: () => 'rough count, by its rhythm', technique: () => 'technique check, no count' };
const trackLabel = m => TRACK_LABEL[m.track](m);
// the card's groups, by the library's kinds (a kind not listed goes with the gym moves)
const GROUPS = [['Gym exercises', ['gym_counted']], ['Gym moves', ['gym_reps', 'transition', 'technique']], ['Holds', ['hold']],
  ['Flows and dance', ['flow', 'dance']]];
const groupOf = m => (GROUPS.find(([, kinds]) => kinds.includes(isCounted(m) ? 'gym_counted' : m.kind)) ?? GROUPS[1])[0];
/** A movement done, as the Workout card and the log say it: "held 0:45", "1:42 moving", "about 12"; with nothing to show
 * (named by mistake, or not done), "not held", "no time moving", "nothing counted". */
const doneText = d => d.track === 'technique' ? (d.reviewed ? 'technique reviewed' : 'no measurable attempt') : (d.count > 0 ? `about ${d.count}` : d.seconds > 0 ? (d.track === 'hold' ? `held ${mmss(d.seconds)}` : `${mmss(d.seconds)} moving`)
  : { hold: 'not held', moving: 'no time moving', rhythm: 'nothing counted' }[d.track]);
/** This workout's movements, one entry each (named several times: its times or counts added up), in the order first
 * named; `shown`: with the ones that have nothing to show too (the Workout card), else without (the summary). */
function movesDone(shown = false) {
  const by = new Map();
  for (const d of S.moves) {
    const x = by.get(d.movement);
    if (!x) { by.set(d.movement, { ...d }); continue; }
    if (d.reviewed) x.reviewed = true;
    for (const k of ['seconds', 'count']) if (d[k] != null) x[k] = (x[k] ?? 0) + d[k];
  }
  return [...by.values()].filter(d => shown || d.reviewed || d.seconds > 0 || d.count > 0);
}

// The library is fetched again on a failure: fetched once, a page loaded while the dev server restarted, or reading the
// file as a build rewrote it, had none and said the server had none ("No movement library on this server"), though it
// had. Tried LIB_TRIES times, LIB_WAIT_MS apart (about 10 s in all); a 404 is the server having none, said at once;
// any other failure says why, with Try again, and is tried again when the page is shown again.
const LIB_TRIES = 6, LIB_WAIT_MS = [500, 1000, 2000, 3000, 4000];
S.libState = { status: 'loading', why: '' };   // loading | ok | none (404) | failed (why)
async function fetchLibrary() {
  if (HOSTED) return { status: 'none', lib: null };
  for (let i = 0; ; i++) {
    try {
      const r = await fetch('/moves/library.json', { cache: 'no-store' });
      if (r.status === 404) return { status: 'none', lib: null };
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
      return { status: 'ok', lib: await r.json() };              // (a file read half written: not JSON, tried again)
    } catch (e) {
      if (i >= LIB_TRIES - 1) return { status: 'failed', lib: null, why: e.message };
      S.libState = { status: 'loading', why: e.message };
      renderLibrary();
      await new Promise(res => setTimeout(res, LIB_WAIT_MS[Math.min(i, LIB_WAIT_MS.length - 1)]));
    }
  }
}
// the movements of the kinds moves.js offers, each with its kind's track (TRACK_OF_KIND, what the build puts in; without
// moves.js, those of the tracks the page has words for): an entry of another kind or track, from a library.json built
// before, is left out, and a gym exercise is kept only if the engine counts it
function loadLibrary() {
  S.libState = { status: 'loading', why: '' };
  renderLibrary();
  return Promise.all([fetchLibrary(), movesJs]).then(([got, mod]) => {
    const offered = mod?.TRACK_OF_KIND ? m => mod.TRACK_OF_KIND[m.kind] === m.track
      : m => Object.keys(TRACK_LABEL).includes(m.track);
    const list = (Array.isArray(got.lib?.movements) ? got.lib.movements : []).filter(m => m && typeof m.key === 'string'
      && m.display && offered(m) && (m.track !== 'reps' || isCounted(m)));
    S.library = list; S.libByKey = new Map(list.map(m => [m.key, m])); S.moveNames = movementNames(list);
    S.libState = { status: got.status, why: got.why ?? '' };
    renderLibrary();
  }).catch(e => { S.libState = { status: 'failed', why: e.message }; renderLibrary(); });
}
// (a saved workout reviewed waits for it: its held poses' reference poses)
const libraryReady = loadLibrary();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.libState.status === 'failed' && !S.library.length) loadLibrary();
});

/** The Movements card: the library by group, each movement with what is tracked, to name it (a tap) or see it in 3D. */
function renderLibrary() {
  const box = $('libGroups');
  box.replaceChildren();
  $('libCount').textContent = S.library.length ? `${S.library.length}` : '';
  if (!S.library.length) {
    const { status, why } = S.libState ?? {};
    box.textContent = status === 'loading' ? `Loading the movement library...${why ? ` (trying again: ${why})` : ''}`
      : status === 'none' ? 'No movement library on this server (node tools/build_moves.mjs builds it).'
        : status === 'failed' ? `Could not load the movement library (${why || 'no answer'}). `
          : 'The movement library has no movement this page offers.';
    if (status === 'failed') {
      const again = document.createElement('button');
      again.type = 'button'; again.className = 'mini'; again.textContent = 'Try again';
      again.addEventListener('click', () => loadLibrary());
      box.append(again);
    }
    return;
  }
  const groups = new Map(GROUPS.map(([g]) => [g, []]));
  for (const m of S.library) groups.get(groupOf(m)).push(m);
  for (const [g, list] of groups) {
    if (!list.length) continue;
    const d = document.createElement('details'), head = document.createElement('summary'), n = document.createElement('span');
    d.dataset.group = g; n.className = 'muted'; n.textContent = `(${list.length})`;
    head.append(`${g} `, n); d.append(head);
    for (const m of list) {
      const row = document.createElement('div'), pick = document.createElement('button'), show = document.createElement('button');
      const name = document.createElement('span'), track = document.createElement('span');
      row.className = 'lib-item'; row.dataset.key = m.key;
      pick.type = 'button'; pick.className = 'lib-pick'; pick.title = `I'm doing this: ${m.display}`;
      name.className = 'lib-name'; name.textContent = m.display;
      track.className = 'lib-track'; track.textContent = trackLabel(m);
      pick.append(name, track);
      pick.addEventListener('click', () => chooseMovement(m.key, 'tap'));
      show.type = 'button'; show.className = 'mini'; show.textContent = 'Show in 3D'; show.disabled = !m.glb;
      show.addEventListener('click', () => showMovement3D(m));
      row.append(pick, show);
      d.append(row);
    }
    box.append(d);
  }
  markLibrary();
}
/** The movement named now marked in the card (before Start: the one picked for the workout). */
function markLibrary() {
  for (const row of $('libGroups').querySelectorAll('.lib-item')) {
    row.classList.toggle('on', !!S.running && row.dataset.key === S.reference?.key);
    row.classList.toggle('next', !S.running && row.dataset.key === S.nextMove?.key);
  }
}
/** "Other movement...": the card's groups open (but the exercises, which the chips have), in view. The start question
 * waits a little longer for the answer meanwhile. */
function openLibrary() {
  for (const d of $('libGroups').querySelectorAll('details')) d.open = d.dataset.group !== 'Gym exercises';
  $('library').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (S.asking) { clearTimeout(S.askTimer); S.askTimer = setTimeout(() => { if (S.asking) noAnswer(); }, 3 * ASK_EXERCISE_MS); }
}

/**
 * The user named a movement of the library (`key`): a tap, their words, or the agent's set_movement. A gym exercise of
 * it is counted as its exercise (chooseExercise); any other one is tracked by web/js/moves.js, and reps are not counted
 * until the user names an exercise or "detect it": the set in progress ends (its reps count). By a tap the coach is told
 * (set_end with reason 'movement', if a set ended, then movement_set); by voice the coach has the words with what was
 * applied (and the set they ended), or the agent confirms its own tool. Before
 * Start, a tap picks it for the workout. What it returns is the tool's answer to the agent.
 */
function chooseMovement(key, how, preparedTracker = null) {
  const m = S.libByKey.get(String(key ?? ''));
  if (!m) return S.library.length ? `There is no movement "${key}" in the library: use one of ${[...S.libByKey.keys()].join(', ')}.`
    : 'The movement library is not loaded on this page.';
  if (!S.running || !S.auto) {
    if (how !== 'tap' || S.starting) return 'No workout is running.';
    S.nextMove = S.nextMove?.key === m.key ? null : m;          // (tapped again: not picked)
    $('exercise').value = S.nextMove && isCounted(m) ? m.engine : 'auto';
    log(S.nextMove ? `picked for the workout: ${m.display} (${trackLabel(m)}). Press Start` : `not picked any more: ${m.display}`);
    markLibrary();
    return '';
  }
  if (isCounted(m)) return chooseExercise(m.engine, how, m);
  if (!S.Tracker) {
    return trackingUnavailable('Movement tracking is unavailable. Selection was not applied. Stop, reload the page, and try again.');
  }
  const who = how === 'voice' ? 'You told the coach' : how === 'start' ? 'Picked before Start' : 'You picked';
  if (S.move?.entry.key === m.key) {
    if (!S.move.tracker || S.trackingBlocked) return trackingUnavailable('Movement tracking is unavailable. Selection was not applied.');
    hideExercises();
    log(`${who}: ${m.display} (already so)`, 'you');
    return trackerRunning(S,performance.now()) ? `Already tracking ${m.display} (${trackLabel(m)}).` : `${m.display} is selected. Waiting for a successfully tracked visible pose.`;
  }
  let tracker;
  try { tracker = preparedTracker ?? freshTracker(S.Tracker, m); }
  catch (e) { return trackingUnavailable(`${m.display} could not start: ${e.message} Selection was not applied.`); }
  hideExercises();
  if (S.autoTold) { withdrawEvent(S.autoTold); S.autoTold = null; }
  let before = '', ended = null;
  if (!S.move) {
    // reps pause: what was waiting is decided first (those reps were done before), then the set in progress ends, for
    // this reason (a tap: the coach hears of it as set_end, reason 'movement'; by voice, the agent from this tool's
    // answer and Claude or ChatGPT from the user's words, tagged with that set)
    pauseReps();
    const n = S.ended.length;
    if (S.auto.active) before = `${answerSetEnd(true, how === 'voice' ? 'voice' : 'tap', 'movement')} `;
    if (S.ended.length > n) ended = S.ended.at(-1);
  }
  const left = finishMovement();
  if (left) before += `${left.display} ended (${doneText(left)}). `;
  const attempt = beginAttempt(S.rec, m, S.lastFrameT) ?? ++S.attemptSerial;
  tracker.lastT = S.lastFrameT ?? null;
  S.move = { entry: m, tracker, attempt };
  S.trackingBlocked = false;
  S.reference = m;
  $('reps').classList.remove('tentative');
  renderMove(); markLibrary(); renderWorkout(); showFraming();
  log(`${who}: ${m.display} (${trackLabel(m)}); no reps are counted meanwhile`, 'you');
  if (how === 'tap' || how === 'start') {
    coachEvent({ kind: 'movement_set', movement: m.key, display: m.display, movementKind: m.kind, track: m.track, coach: m.coach ?? '' },
      FALLBACK.movement_set(m, ended));
  }
  return `${before}${m.display} tracker is ready (${trackLabel(m)}). ${performance.now() - (S.lastPoseAt ?? -Infinity) < 1000 ? 'A recent pose is available.' : 'Waiting for a visible pose; tracking has not been observed yet.'} No reps are counted until they name an exercise or ask you to detect it.`;
}
// A failed control action is authoritative. Stop streamed agent audio as well as suppressing its transcript:
// filtering onSaid alone is too late, because the ElevenLabs audio can precede that callback.
function trackingUnavailable(message) {
  S.trackingBlocked = true;
  if (S.rec) S.rec.events.push({ type: 'tracking_unavailable', t: S.lastFrameT ?? null, attempt: S.move?.attempt ?? null, message });
  S.eleven?.setVolume(0);
  void stopEleven();
  S.voiceOut?.cancel();
  log(message, 'err'); chat('coach', message);
  $('say').textContent = message; $('say').style.display = 'block';
  $('coachState').textContent = 'paused: tracking unavailable';
  $('reps').textContent = '—'; $('repsLabel').textContent = message;
  return message;
}
function restartMovement() {
  if (!S.running || !S.Tracker || !trackerRunning(S,performance.now())) {
    trackingUnavailable('Restart was not applied: movement tracking or a recent visible pose is unavailable. Stop and start again when tracking is available.'); return false;
  }
  const entry = S.move.entry;
  let tracker;
  try { tracker = freshTracker(S.Tracker, entry); }
  catch { trackingUnavailable('Could not restart movement tracking. The current attempt was retained.'); return false; }
  try { finishMovement('restart'); }
  catch { trackingUnavailable('Restart was not applied: the current tracker could not finish. Stop and reload before trying again.'); return false; }
  const attempt = beginAttempt(S.rec, entry, S.lastFrameT, 'restart') ?? ++S.attemptSerial;
  tracker.lastT = S.lastFrameT; // the new tracker cannot count any time before this boundary
  S.move = { entry, tracker, attempt };
  S.moveVis = null;
  renderMove(); renderWorkout(); showFraming();
  log(`${entry.display}: fresh attempt ${attempt} created at zero; waiting for its first tracked pose.`, 'you');
  chat('coach', `${entry.display}: new attempt ready at zero. Waiting for its first tracked pose.`);
  S.eleven?.context?.(`The reset was applied for ${entry.display}: fresh attempt ${attempt}, counters zero. The new tracker has not processed a pose yet. Do not claim tracking is running until the page sends tracking_started.`);
  return true;
}
$('restartMove').addEventListener('click', restartMovement);
// A stalled camera may stop delivering callbacks entirely. Refresh status without fabricating pose samples.
setInterval(() => { if (S.running && S.move && performance.now() - (S.lastPoseAt ?? -Infinity) >= 1000) renderMove(); }, 1000);
/** Reps pause while a movement is named: the AutoTracker gets no frames. It is told the person was lost (its rep
 * detectors start over) at both ends, so that nothing from before joins anything after. */
function pauseReps() {
  clearTentative(false); S.lapse = null; hideForm(); hideSetEnd();
  const evs = S.auto.lost(S.lastFrameT ?? S.auto.lastT);
  if (S.rec) S.rec.events.push(...evs);
  handleAuto(evs);
}
function resumeReps() {
  const evs = S.auto.lost(Math.max(S.lastFrameT ?? 0, S.auto.lastT));
  if (S.rec) S.rec.events.push(...evs);
  handleAuto(evs);
}
/** The movement named now ends (another one, an exercise or "detect it" was named, or the workout stopped): its time
 * or count joins the workout's. Returns it, or null. */
function finishMovement(reason = 'ended') {
  const x = S.move;
  if (!x) return null;
  // (an open hold ends where it is: logged and recorded, not sent; the next movement's or exercise's news is the
  // coach's to say)
  const ending = S.trackingBlocked ? [] : x.tracker?.finish(S.lastFrameT) ?? [];
  if (S.rec) S.rec.events.push(...ending);
  if(!S.trackingBlocked)recordMovingIntervals(S.rec, x.entry, x.tracker, x.attempt);
  endAttempt(S.rec, x.attempt, S.lastFrameT, reason);
  if (x.entry.track === 'technique') moveEvents(ending, S.lastFrameT);
  for (const e of ending) {
    log(`${x.entry.display}: ${e.type.replace(/_/g, ' ')}${e.seconds != null ? ` ${mmss(e.seconds)}` : ''}`);
  }
  S.move = null;
  // (its form check, if shown as it happened: the hold or the movement is over. One the user opened from the Mistakes
  // list stays: hideForm)
  if (S.form?.library) hideForm();
  // (a count of 0 or 0 seconds is no result: none is kept, and the summary leaves it out)
  const sum = S.trackingBlocked ? {} : x.tracker?.summary() ?? {}, seconds = Math.round(sum.seconds ?? 0);
  const done = { movement: x.entry.key, display: x.entry.display, movementKind: x.entry.kind, track: x.entry.track,
    ...(x.attempt != null ? { attempt: x.attempt } : {}),
    ...(x.entry.track === 'technique' ? { reviewed: !!sum.reviewed } : {}),
    ...(sum.count > 0 ? { count: sum.count } : seconds > 0 ? { seconds } : {}) };
  S.moves.push(done);
  log(`${done.display}: ${doneText(done)}`);
  return done;
}
// A hold goes to the coach (hold_start) once it has lasted SHORT_HOLD_MS, the length the engine's hold_end sentence and
// coach.py SHORT_HOLD_S take for a hold: shorter, the user was settling in or adjusting, and each one cost the coach two
// turns (live: hold_start, hold_end after 2 s and hold_start again within 7 s, three replies, the next ones late). It is
// held back that long and HOLD_SURE_MS more, the time the tracker takes to end a hold once the movement starts: a hold
// that ends before is dropped (it still counts towards the time held), never told and ended in one breath.
const SHORT_HOLD_MS = 5000, HOLD_SURE_MS = 1500;
// A hold's form (a movement web/js/holdform.js checks): its faults and fixes (hold_fault, hold_fix) come after its
// start. One measured while the start is held back waits for it, and is dropped with it if the hold is. The start, when
// it goes, carries the hold's form as it is then (the tracker's current(), not as it was when the tracker told it,
// HOLD_TOLD_MS into the hold): a fault or a fix that waited is in it, so neither is said again (a fault takes about
// 1.5 s of the hold to be measured, so most are measured while the start waits), and a fault measured but not told
// yet is in its `pending`, so the coach never hears "measured and fine so far" and then that fault in one breath. A
// tracker without current().form: what waited goes right after it. The start told, the form's next correction is
// timed from then (MovementTracker settle()): the tracker settled it at HOLD_TOLD_MS, 3.5 s before anyone heard the
// start, and the user's recording had the second correction 4.5 s after the first one spoken, not NEXT_MS (8 s).
// What the coach heard of the hold's faults (`heard`: those open in a start or a progress sent, and each hold_fault
// sent) sets hold_end's `told`: a fault told and fixed while the start waited was never said, so it is not praised
// as fixed (it is left out), and one still there but never said is told: false.
const FORM_EVENTS = new Set(['hold_fault', 'hold_fix']);
// A moving or rhythm movement's form (a movement web/js/moveform.js checks): its faults and fixes (form_fault,
// form_fix) go to the coach as they come, each shown aside as a hold's. Those tracks have no start to hold back, and
// none of the hold's 6.5 s: the tracker judges nothing in a run of movement's first WARM_MS, and tells a fault once it
// lasts or comes back cycle after cycle
const MOVE_FORM_EVENTS = new Set(['form_fault', 'form_fix']);
// The form unchecked a while (form_unseen: every check out of the frame, or seen side-on, for about 6 s of a moving or
// rhythm movement, 4 s of a hold; then at most every 30 s): its cue to the coach as it comes, and on the Now card while
// it lasts (unseenLine). Not a mistake: no form check aside, nothing in the Mistakes list. In a hold whose start is
// held back it waits for it, as the hold's own events (a hold too short to tell drops it), and goes right after it if
// it still holds then (the start says "hold it there", not why its form could not be checked)
/** Its tracker's events (at frame time `t`): logged, and to the coach (with the engine's sentence if no cue comes). */
function moveEvents(evs, t) {
  const x = S.move, m = x?.entry;
  if (!m) return;
  const tell = e => {
    const { type, kind: _kind, key: _key, display: _display, t: _t, ...rest } = e;
    const heard = (x.heard ??= new Set());
    if (type === 'hold_fault') heard.add(e.fault);
    for (const f of rest.form?.open ?? []) heard.add(f.fault);
    if (type === 'hold_end' && Array.isArray(rest.form?.faults)) {
      rest.form = { ...rest.form, faults: rest.form.faults.filter(f => heard.has(f.fault) || !f.fixed)
        .map(f => ({ ...f, told: heard.has(f.fault) })) };
    }
    coachEvent({ kind: type, ...rest, movement: m.key, display: m.display, movementKind: m.kind, track: m.track },
      FALLBACK[type](e, m));
    holdCheck(type, rest, m, t);             // (a fault told: shown aside, with its reference; a fix or the end: away)
  };
  const tellStart = () => {
    const e = x.heldBack, waiting = x.waiting ?? [];
    tell(x.heldFresh ? { ...e, form: x.heldForm } : e);
    const unseen = w => w.type === 'form_unseen';
    if (!x.heldFresh) for (const w of waiting) tell(w);
    else {
      const folded = waiting.filter(w => !unseen(w));
      if (folded.length) log(`(${folded.map(w => w.type.replace(/_/g, ' ')).join(', ')}: in the hold's start)`);
      for (const w of waiting) if (unseen(w) && unseenLasts(w, x.heldForm)) tell(w);
    }
    x.heldBack = null; x.waiting = []; x.told = true;
    x.tracker?.settle?.(t);                  // (its open fault is told now: the next one NEXT_MS from here)
  };
  // the hold's form now (null: no form check; undefined: none, or not holding): the held-back start's from now on
  const c = x.tracker?.current?.(t), form = c?.holding ? c.form : undefined;
  if (x.heldBack && form !== undefined) { x.heldForm = form; x.heldFresh = true; }
  for (const e of evs || []) {
    if (!TRACK_EVENTS.has(e.type)) continue;
    log(`${m.display}: ${e.type.replace(/_/g, ' ')}${e.seconds != null ? ` ${mmss(e.seconds)}` : ''}`
      + `${e.count != null ? `, about ${e.count}` : ''}`
      + `${e.label ? `: ${e.label}${e.measured ? ` (${e.measured})` : ''}` : ''}`    // (a fault or a fix: which)
      + `${e.type === 'form_unseen' ? `: ${(e.missing ?? []).join(', ')} (${e.why ?? '?'})` : ''}`);
    if (e.type === 'technique_result') {
      tell(e);                              // an empty cue keeps the coach informed without repeating the correction
      continue;
    }
    if (e.type === 'form_unseen') {
      x.unseen = { ...e, endSince: null };   // (the Now card's cue, while it lasts)
      if (x.heldBack) x.waiting.push(e);
      else tell(e);
      continue;
    }
    if (MOVE_FORM_EVENTS.has(e.type)) {
      if (e.type === 'form_fix' && x.line?.fault === e.fault) x.line.fixed = true;   // (its Now card line goes now)
      tell(e);
      continue;
    }
    if (e.type === 'hold_start') {
      x.heldBack = e; x.waiting = []; x.told = false; x.heard = new Set();
      x.heldFresh = form !== undefined; x.heldForm = x.heldFresh ? form : e.form;
      continue;
    }
    if (FORM_EVENTS.has(e.type)) {
      if (x.heldBack) x.waiting.push(e);     // (after its start, or never)
      else if (x.told) tell(e);
      continue;
    }
    if (e.type === 'hold_end' && x.heldBack) {
      // its start never went: a short one goes no further, a longer one alone (its form: the hold's summary). What
      // waited goes with the start
      x.heldBack = null; x.waiting = [];
      if (!(e.seconds >= SHORT_HOLD_MS / 1000)) { log(`(a hold of ${e.seconds} s: too short to tell the coach)`); continue; }
    }
    if (x.heldBack) tellStart();             // (its start first)
    if (e.type === 'hold_end') x.told = false;
    tell(e);
  }
  if (x.heldBack && t - x.heldBack.t >= SHORT_HOLD_MS + HOLD_SURE_MS) tellStart();
}
/** What the tracker has now (moves.js current()): the big number and the line ("Hold 0:23", "Moving 1:42", "About 12"),
 * and the form (null: none measured): of the hold under way once the coach was told its start (the tracker's timer
 * runs from HOLD_START_MS into the stillness, the start goes 6.5 s in: before, the card showed faults nobody had said,
 * the user's recording: "Form: feet too close together" 5 s before the voice said it, and a fault in a 3 s pause never
 * told at all, and "Form checked" flashed in pauses); of a moving or rhythm movement, as it is (moveform.js state():
 * its open faults are the ones told, and each went to the coach as it came). */
function moveStatus(x) {
  if (S.trackingBlocked || !x.tracker) return { big: '—', text: 'Movement tracking unavailable', form: null, state: null };
  const c = x.tracker?.current(S.lastFrameT), text = (c && S.statusText?.(c)) || 'nothing to time or count';
  if (!c || c.track === 'reps') return { big: '-', text, form: null, state: null };
  // (`state`: the form as the tracker has it now, told or not: whether a form_unseen still holds)
  if (c.track === 'hold') {
    const state = (c.holding && c.form) || null;
    return { big: mmss(c.holding ? c.seconds : c.last ?? 0), text, form: (x.told && state) || null, state };
  }
  if (c.track === 'technique') return { big: 'Technique', text, form: c.form, state: c.form };
  if (c.track === 'rhythm') return { big: `~${c.count ?? 0}`, text, form: c.form ?? null, state: c.form ?? null };
  const state = (c.track === 'moving' && c.form) || null;
  if (x.entry?.kind === 'dance') return { big: '●', text: trackerRunning(S,performance.now()) ? S.moveVis?.legs===false?'Tracking pose · legs unclear':'Tracking movement' : 'Waiting for a tracked visible pose', form: state, state };
  return { big: mmss(c.seconds), text, form: state, state };
}
/** A movement's form on the Now card (moveStatus: a hold's once the coach was told its start, a moving or rhythm
 * movement's as it is): the fault the user was told of (the coach's correction is spoken); "Form: checking..." while a
 * fault measured waits its turn to be told (not shown before it is said); "Form checked" only when the form is fine
 * (formFine: some checks measured, nothing open, waiting, out of the frame or seen from the wrong view); else what
 * could not be checked and why (named on hover): "step back so I can see all of you" for parts out of the frame, "turn
 * to face the camera" for checks the view cannot judge (stepping back does not change the view: the triangle's checks
 * all need the front, the figure-four's ankle and the shoulder rotation's elbows too). Nothing for a movement without
 * a form check, between holds, or in a moving one's warm-up and pauses (nothing judged then). */
function formLine(form) {
  if (!form) return null;
  const f = form.open?.[0];
  if (f) {
    return { cls: 'fault', text: `Form: ${f.label ?? f.fault}`,
      title: f.measured ? `${f.measured} (aim for ${f.target})` : '' };
  }
  const checked = form.checked ?? [], unseen = form.unseen ?? [], wrong = form.wrongView ?? [];
  if (form.unmeasured?.length && !form.open?.length) return { cls: 'unseen', text: 'Only the measured checks are assessed', title: form.unmeasured.join(' ') };
  const not = [...unseen.map(n => `${n} (out of the frame)`), ...wrong.map(n => `${n} (needs the camera in front)`)];
  const title = [checked.length && `Checked for: ${checked.join(', ')}`, not.length && `Not checked: ${not.join(', ')}`]
    .filter(Boolean).join('. ');
  const why = [wrong.length && 'turn to face the camera', unseen.length && 'step back so I can see all of you']
    .filter(Boolean).join(' and ');
  if (form.pending?.length) return { cls: 'pending', text: `Form: checking...${why ? ` (${why})` : ''}`, title };
  if (formFine(form)) return { cls: 'ok', text: 'Form checked', title };
  if (!why) return null;
  return { cls: 'unseen', text: `Form ${checked.length ? 'partly checked' : 'not checked'}: ${why}`, title };
}
/** The Now card: the movement named now and what is tracked (no reps meanwhile), or a counted one's name; Show in 3D. */
function renderMove() {
  const ref = S.running ? S.reference : null, x = S.move;
  $('restartMove').hidden = !S.running || !x;
  $('restartMove').disabled = !x?.tracker || !!S.trackingBlocked;
  $('now').classList.toggle('technique', !!ref && x?.entry.track === 'technique');
  $('moveRow').hidden = !ref;
  if (!ref || !x) { $('moveForm').hidden = true; $('holdAgain').hidden = true; }
  if (!ref) return;
  const says = x ? ': no reps counted (name an exercise to count again)' : `: ${trackLabel(ref)}`;
  if ($('moveNote').textContent !== ref.display + says) {
    const b = document.createElement('b');
    b.textContent = ref.display;
    $('moveNote').replaceChildren(b, says);
  }
  $('move3d').disabled = !ref.glb;
  if (!x) return;
  const st = moveStatus(x), label = `${ref.display} · ${st.text}`;
  if ($('reps').textContent !== st.big) $('reps').textContent = st.big;
  if ($('repsLabel').textContent !== label) $('repsLabel').textContent = label;
  // (in the side panel: the camera view shows the skeleton only). A form_unseen's cue first, while it lasts
  // (unseenLine); a moving or rhythm movement's line steadied (steadyLine), a hold's while its cue is up or going
  const t = S.lastFrameT, cue = unseenLine(x, st.state, t), raw = cue ?? formLine(st.form), el = $('moveForm');
  const steady = x.entry.track === 'moving' || x.entry.track === 'rhythm' || !!cue || x.line?.shown?.cls === 'alert';
  const fl = steady ? steadyLine(x.line ??= {}, raw, t, cue ? null : st.form?.open?.[0]?.fault) : raw;
  el.hidden = !fl;
  if (fl && el.textContent !== fl.text) el.textContent = fl.text;
  if (fl && el.className !== fl.cls) el.className = fl.cls;
  if (fl && el.title !== fl.title) el.title = fl.title;
  // the fault told, while it is still there and its panel was put away (FORM_MS): its form check again (showHold)
  const f = st.form?.open?.[0];
  const showing = S.form?.library && !S.form.pinned && S.form.code === f?.fault;
  $('holdAgain').hidden = !(f && $('useDemos').checked && !showing);
}
// A moving or rhythm movement's form line on the Now card, steadied. Its form is judged frame by frame (a check's parts
// out of the frame on one frame, seen side-on on the next, nothing judged in a pause), and the line followed it: on a
// replay of the user's recording it flipped between "step back...", "turn to face the camera" and nothing several
// times a second. A line now shows once it has been the same for LINE_STEADY_MS (nothing shown too), "Form checked"
// once the form has been fully clear for LINE_CHECKED_MS (it says the most); an open fault at once (it was just told)
// and until its fix (form_fix, moveEvents: it goes at once, and the line after it waits its turn), or until the line
// after it is due (a tracker that dropped it unsaid: no blank between them); a form_unseen's cue (.alert) at once too
// (it took seconds to be said), until it no longer holds and the line after it is due. A hold's line needs none of
// this but its cue's: it shows only once the hold's start was told, the pose steady by then.
const LINE_STEADY_MS = 1000, LINE_CHECKED_MS = 1500;
/** The line to show at frame time `t` (null: none) for this frame's `fl` (formLine; `fault`: the id of its open fault),
 * with `s` the line's state, kept on the movement named: {key and since (the raw line, and since when it has been
 * that), shown, fault (the id of the fault shown), fixed (its form_fix came)}. */
function steadyLine(s, fl, t, fault = null) {
  const key = fl ? `${fl.cls}|${fl.text}` : '', urgent = l => l?.cls === 'fault' || l?.cls === 'alert';
  if (key !== s.key || !Number.isFinite(s.since)) { s.key = key; s.since = t; }
  if (urgent(fl)) {                                     // (told: at once; another one told replaces it)
    if (s.fault !== fault) s.fixed = false;
    s.shown = fl; s.fault = fault;
    return fl;
  }
  const due = t - s.since >= (fl?.cls === 'ok' ? LINE_CHECKED_MS : LINE_STEADY_MS);
  if (urgent(s.shown)) {
    if (!s.fixed && !due) return s.shown;
    s.shown = null; s.fault = null; s.fixed = false;
  }
  const same = s.shown && fl && s.shown.cls === fl.cls && s.shown.text === fl.text;    // (its hover text kept fresh)
  if (same || due) s.shown = fl;
  return s.shown ?? null;
}
/** The Now card's line for the form_unseen of movement `x` (x.unseen, kept from its event) while it holds in `form`
 * (the tracker's form now: unseenLasts), or null: none, or not holding now (once it has not held for LINE_STEADY_MS,
 * it is over: the user stepped back or turned, and a later one is the tracker's to say). */
function unseenLine(x, form, t) {
  const u = x.unseen;
  if (!u) return null;
  if (!unseenLasts(u, form)) {
    u.endSince ??= t;
    if (t - u.endSince >= LINE_STEADY_MS) x.unseen = null;
    return null;
  }
  u.endSince = null;
  const off = u.why === 'view' ? 'needs the camera in front' : 'out of the frame';
  const missing = Array.isArray(u.missing) ? u.missing : [];
  return { cls: 'alert', text: u.cue || unseenWords(u),
    title: missing.length ? `Not checked: ${missing.map(n => `${n} (${off})`).join(', ')}` : '' };
}
$('move3d').addEventListener('click', () => showMovement3D(S.reference));
$('holdAgain').addEventListener('click', () => {
  const f = S.move && moveStatus(S.move).form?.open?.[0];
  // (the same fault, still there: not a new mistake)
  if (f && showHold(S.move.entry, f, S.lastFrameT, { again: true })) {
    $('demo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  renderMove();
});
$('exercise').addEventListener('change', () => { if (S.nextMove) { S.nextMove = null; markLibrary(); } });

/**
 * The microphone: the agent's in duplex, else the page's own listener. On (the user talks to the coach), muted by the
 * user, or refused (the buttons answer); the page's own also says when it hears the user and writes their words down.
 */
function renderMic() {
  const l = S.listener, c = S.eleven, m = l ? l.state : c?.mic ?? 'off', why = l ? l.why : c?.micWhy;
  $('micRow').hidden = m === 'off';
  $('micRow').className = `${m}${l && m === 'on' && S.hearing ? ' hearing' : ''}`;
  $('micState').textContent = { connecting: 'Microphone: connecting...',
    on: !l ? 'Microphone on: talk to the coach' : S.hearing ? 'Hearing you...' : S.writing ? 'Writing it down...'
      : 'Listening: talk to the coach',
    muted: l ? 'Microphone muted (Hold to talk still works)' : 'Microphone muted',
    refused: `Microphone off (${why}): use the buttons` }[m] ?? '';
  $('micToggle').hidden = m !== 'on' && m !== 'muted';
  $('micToggle').textContent = m === 'muted' ? 'Unmute' : 'Mute';
  $('ptt').hidden = !(l && (m === 'on' || m === 'muted'));
}
// (the choice stands for the next sessions too: muted, they start without opening the microphone)
$('micToggle').addEventListener('click', async () => {
  const l = S.listener;
  if (l) {                                        // the page's own: the detector stops; the microphone stays open
    S.micMuted = l.muted = !l.muted;
    log(S.micMuted ? 'microphone muted: the coach does not hear you (Hold to talk still works)' : 'microphone on: talk to the coach');
    renderMic();
    return;
  }
  const c = S.eleven;
  if (!c) return;
  const mute = c.mic !== 'muted';
  S.micMuted = mute;
  $('micToggle').disabled = true;                 // (unmuting may open the microphone, and the browser may ask)
  const m = await c.setMicMuted(mute);
  $('micToggle').disabled = false;
  if (S.eleven === c) {
    if (m === 'refused') log(`microphone: ${c.micWhy}, so the coach cannot hear you: answer with the buttons`, 'err');
    else log(mute ? 'microphone muted: the coach does not hear you' : 'microphone on: talk to the coach');
  }
  renderMic();
});

// --- the page listens itself, for Claude, ChatGPT and the engine's own coach (web/js/listen.js): Parakeet on this Mac
// writes down what the user says, during a workout or in a conversation without one (Talk to coach). Words that name an
// exercise or answer the page's question are applied here, as a chip or a button would be, and the coach gets the words
// with what was done (one user_said, which it confirms in its own words); other words it answers. The audio stays on
// this Mac: the coach gets the words only. A refused microphone leaves the chips and buttons. --------------------------
const TALK_IDLE_MS = 2 * 60000;    // Talk to coach closes after this long without a word from the user
const REPLY_MS = 10000;            // an answer to the user's words (up to a few sentences) may take this long
const SR = 16000;                  // (the utterances' rate)
S.stt = null;                      // GET /api/stt/status: {available, ready, error, load_ms} (null: not known)
S.listener = null;                 // the page's microphone and detector, while it listens
S.heardChain = Promise.resolve();  // what was said is handled in the order it was said
S.listenStats = [];                // each utterance: when the user stopped, when it was written down, answered and heard

/** Is Parakeet set up and ready? Asked at load and at Start, then every second while it loads (about 10 s). */
async function loadStt() {
  if (HOSTED || (REVIEW && coachChoice() === 'off')) { S.stt = { available: false, ready: false }; syncListening(); return S.stt; }
  if (S.sttLoading) return S.sttLoading;
  S.sttLoading = (async () => {
    for (let i = 0; i < 180; i++) {
      const st = await sttStatus();
      if (REVIEW && coachChoice() === 'off') { S.stt = { available: false, ready: false }; syncListening(); return S.stt; }
      const changed = JSON.stringify(st) !== JSON.stringify(S.stt);
      S.stt = st;
      if (changed) { renderConnections(); syncListening(); }
      if (!st?.available || st.ready || st.error) return st;
      await new Promise(r => setTimeout(r, 1000));
    }
    return S.stt;
  })();
  try { return await S.sttLoading; } finally { S.sttLoading = null; }
}

/** The page listens while a workout runs or starts, or in a conversation (Talk to coach), unless the agent hears the user
 * itself (duplex) or nobody can (a text-only agent, no Parakeet). */
function syncListening() {
  const want = !S.startGate && listens(S.plan, S.stt) === 'page' && !!S.stt?.ready && (S.running || S.starting || S.talking);
  if (want && !S.listener) openListener();
  else if (!want && S.listener) closeListener();
  renderMic(); renderTalk();
}
async function openListener() {
  // strict: the page's voice talks (it takes a louder sound to be the user); echo: it is the Mac's, which the microphone
  // hears as it is (no echo cancellation for a voice that plays outside the page)
  const l = S.listener = new Listener({ onEvent: e => onListen(l, e), muted: !!S.micMuted,
    strict: () => !!(S.voiceOut?.speaking || S.voiceOld?.speaking),
    echo: () => [S.voiceOut, S.voiceOld].some(v => v?.kind === 'mac' && v.speaking) });
  renderMic();
  const state = await l.open();
  if (S.listener !== l) return;
  if (state === 'refused') log(`microphone: ${l.why}, so the coach cannot hear you: answer with the buttons`, 'err');
  else if (!S.listenTold) {
    S.listenTold = true;
    log('microphone on: talk to the coach. What you say is written down on this Mac (Parakeet) and only the words go to ' +
      'the coach. Mute and Hold to talk (or hold the Space bar) are in the side panel');
  }
  renderMic(); renderConnections();
}
function closeListener() {
  S.listener?.close();
  S.listener = null; S.hearing = false;
  $('ptt').classList.remove('held'); $('ptt').textContent = 'Hold to talk';
  renderConnections();
}

/** The detector's events: an utterance opened, it is speech (the page's voice gives way), it ended (to Parakeet). */
function onListen(l, e) {
  if (S.listener !== l) return;
  if (e.type === 'start') { S.hearing = true; renderMic(); return; }
  if (e.type === 'speech') { bargeIn(); armTalkIdle(); return; }
  S.hearing = false;
  if (e.type === 'end') {
    const rec = { endedAt: e.t, t0: e.t0, speechEnd: e.speechEnd, reason: e.reason, seconds: e.audio.length / SR,
      echo: e.echo };
    S.listenStats.push(rec);
    S.writing = (S.writing || 0) + 1;
    const job = transcribe(e.audio).catch(err => ({ error: err }));
    S.heardChain = S.heardChain.then(async () => {
      const r = await job;
      S.writing -= 1;
      rec.textAt = performance.now();
      if (r.error) {
        log(`(what you said could not be written down: ${r.error.message})`, 'err');
        if (r.error.status === 503) { S.stt = { ...S.stt, ready: false }; syncListening(); loadStt(); }   // (loading again)
      } else {
        rec.text = r.text; rec.sttMs = r.ms;
        heard(r.text, rec);
      }
      renderMic();
    });
  }
  renderMic();
}

/** The user started talking while the page's voice speaks: that cue is cut. (Not the Mac's voice: it plays outside the
 * page, where echo cancellation cannot take it out of the microphone, so it would cut itself.) */
function bargeIn() {
  for (const v of [S.voiceOut, S.voiceOld]) {
    if (v?.speaking && v.kind !== 'mac') { v.cancel(); log('(you started talking: the coach stopped)'); }
  }
}

/**
 * What the user said, written down. Not the page's own voice come back through the microphone (the echo guard), nor no
 * words at all. In a workout, words that name an exercise or answer the page's open question are applied (intents.js);
 * then, or otherwise, the coach gets them. With no coach, the engine confirms what was applied, and says what it can do.
 */
function heard(text, rec) {
  text = String(text || '').trim();
  if (!/[\p{L}\p{N}]/u.test(text)) { log('(heard a sound, no words)'); return; }
  // the echo guard: only for an utterance that overlapped the Mac's voice (Kokoro plays in the page and is echo-
  // cancelled; and words said after a cue are the user's, though they repeat it: "Done with this set" to "... Done with
  // this set?"). The cues it may hold, newest first, are taken out; what is left is the user's
  if (rec.echo) {
    const heardAll = text;
    for (const x of S.spoken.filter(c => c.until > rec.t0).reverse()) text = afterEcho(text, x.text);
    if (!/[\p{L}\p{N}]/u.test(text)) { log(`(the coach's own voice, heard back: "${heardAll}", ignored)`); return; }
    if (text !== heardAll) log(`(the coach's own voice, heard back, taken out of: "${heardAll}")`);
  }
  rec.heard = true;
  log(`You: ${text}`, 'you');
  chat('you', text);
  if (restartRequested(text)) {
    if (restartMovement()) said(text, { type: 'restart', applied: true, tracking: 'waiting' }, 'New attempt created at zero; waiting for its first tracked pose.', rec);
    return; // a rejected restart must not fall through to an unconstrained coach response
  }
  log(`(written down ${((rec.textAt - rec.speechEnd) / 1000).toFixed(2)} s after you stopped talking: Parakeet ` +
    `${rec.sttMs} ms for ${rec.seconds.toFixed(1)} s of audio)`);
  armTalkIdle();
  // (current: the exercise being counted, which named again is no switch: "one more squat" in a set of squats; none
  // while a movement of the library is named. movement: the library's movement named now, likewise)
  const intent = S.running && S.auto ? intentOf(text, { exercise: !$('askEx').hidden, setEnd: !!S.pendingEnd,
    current: S.move ? null : S.auto.active?.key ?? S.auto.only, movement: S.reference?.key ?? null, movements: S.moveNames }) : null;
  if (intent?.type === 'movement' && S.libByKey.has(intent.movement)) {
    // a movement of the library: one user_said with what was applied (a gym exercise of it is counted as its exercise).
    // The words go first, tagged with the set in progress (said()): naming a movement the engine does not count ends
    // that set, and no set_end goes for it (the coach reads the tags: coach.py heard())
    const m = S.libByKey.get(intent.movement), counted = isCounted(m);
    if (!counted) {
      const result = chooseMovement(m.key, 'voice');
      if (S.move?.entry.key === m.key && S.move.tracker && !S.trackingBlocked) said(text,
        { type: 'movement', movement: m.key, display: m.display, movementKind: m.kind, track: m.track }, result, rec);
      return;
    }
    const a = !counted && !S.move ? S.auto.active : null;
    said(text, counted ? { type: 'exercise', exercise: m.engine, label: exLabel(m.engine), movement: m.key, display: m.display }
      : { type: 'movement', movement: m.key, display: m.display, movementKind: m.kind, track: m.track },
    counted ? FALLBACK.exercise_set(m.engine, m.display) : FALLBACK.movement_set(m, a && { label: a.label, reps: a.count }), rec);
    chooseMovement(m.key, 'voice');
    return;
  }
  if (intent?.type === 'exercise' || intent?.type === 'auto') {
    // (the words go first: the coach then hears of the set the switch starts, if it starts one)
    const key = intent.type === 'auto' ? 'auto' : intent.exercise;
    said(text, key === 'auto' ? { type: 'auto' } : { type: 'exercise', exercise: key, label: exLabel(key) },
      FALLBACK.exercise_set(key, exLabel(key)), rec);
    chooseExercise(key, 'voice');
    return;
  }
  if (intent?.type === 'set_end') {
    const asked = S.pendingEnd, n = S.ended.length;
    answerSetEnd(intent.done, 'voice');
    const ended = S.ended.length > n ? S.ended.at(-1) : null, set = ended ?? S.auto.active ?? asked;
    const applied = { type: 'set_end', done: intent.done, label: set?.label, set: set?.set,
      reps: ended ? ended.reps : S.auto.active?.count ?? asked?.reps };
    return said(text, applied, intent.done ? FALLBACK.set_summary(applied.label, applied.reps) : FALLBACK.set_goes_on(), rec);
  }
  // counting out loud and fillers are not for the coach: they would cost a coach turn each and queue ahead of the cues
  if (chatter(text)) { log('(counting or a filler: nothing to answer)'); return; }
  if (brain() === 'none') { speak(FALLBACK.user_said(), 'engine'); return; }
  said(text, null, null, rec);
}
/** The user's words to the coach, with what the page did with them (`applied`) and where the workout is. */
function said(text, applied, fallbackText, rec) {
  const a = S.running ? S.auto?.active : null;
  rec.applied = applied?.type ?? null;
  coachEvent({ kind: 'user_said', text, ...(applied ? { applied } : {}), workout: !!S.running,
    ...(a ? { exercise: a.key, exerciseLabel: a.label, set: a.set, reps: a.count } : {}), heard: rec },
  fallbackText, { t0: rec.speechEnd, wait: applied ? FALLBACK_MS : REPLY_MS });
}

/** Talk to coach: a conversation without a workout. The page listens (or the agent does, in a duplex session: it bills
 * by the minute); it closes on a second tap, on Start (the workout carries the conversation on) or after TALK_IDLE_MS
 * without a word. */
async function openTalk() {
  if (S.running || S.starting || S.talking) return;
  S.talking = true;
  S.voiceOut?.unlock();                           // (in the click: the coach's answers can be heard)
  armTalkIdle();
  if (brain() === 'eleven') {
    log("Talk to coach: the agent hears you (its own voice, billed by the minute); it closes after 2 minutes without a word");
    renderTalk();
    await startEleven();
  } else {
    const who = brain() === 'none' ? "the engine's own coach (for questions, connect Claude or ChatGPT)" : brainLabel(S.conns, brain());
    log(`Talk to coach: listening, for ${who}; it closes after 2 minutes without a word`);
    ensureCoach();
    if (!S.stt?.ready) log('(the speech to text is still loading: listening once it is ready)');
    syncListening();
  }
}
function endTalk(why) {
  if (!S.talking) return;
  S.talking = false;
  clearTimeout(S.talkIdle);
  log(`Talk to coach: closed (${why})`);
  if (!S.running && !S.starting && S.eleven) stopEleven();
  syncListening();
}
function armTalkIdle() {
  clearTimeout(S.talkIdle);
  if (S.talking) S.talkIdle = setTimeout(() => endTalk('2 minutes without a word'), TALK_IDLE_MS);
}
function renderTalk() {
  const b = $('talk'), can = brain() === 'eleven' || !!S.stt?.available;
  b.hidden = !!(S.running || S.starting);
  b.classList.toggle('on', !!S.talking);
  b.textContent = S.talking ? 'End chat' : 'Talk to coach';
  b.disabled = !can && !S.talking;
  b.title = can ? 'Talk to the coach without a workout (it closes after 2 minutes without a word)'
    : 'Talking to Claude, ChatGPT or the engine needs speech to text on this Mac (bash tools/setup_stt.sh)';
}
$('talk').addEventListener('click', () => (S.talking ? endTalk('you closed it') : openTalk()));

// push-to-talk, for a noisy room: hold the button, or the Space bar (not while typing in a field), and talk. Exactly
// one utterance is recorded, without the detector (muted too)
function hold(down) {
  const l = S.listener;
  if (!l || (l.state !== 'on' && l.state !== 'muted') || l.heldDown === down) return;
  l.hold(down);
  $('ptt').classList.toggle('held', down);
  $('ptt').textContent = down ? 'Talking: let go to send' : 'Hold to talk';
}
$('ptt').addEventListener('pointerdown', e => { $('ptt').setPointerCapture?.(e.pointerId); hold(true); });
for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) $('ptt').addEventListener(t, () => hold(false));
const typing = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || typing(e.target) || $('ptt').hidden) return;
  e.preventDefault();                             // (not a press of the focused button, nor a scroll)
  if (!e.repeat) hold(true);
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && S.listener?.heldDown) { e.preventDefault(); hold(false); } });
window.addEventListener('blur', () => hold(false));
loadStt();

// --- form check: a rep that went wrong, replayed (faulty part in red) next to a 3D demo of the right form -------------
// Shown in the side panel (not over the video) on the first rep with a fault, even a slight one (the spoken cue waits
// for a fault on 2 of 3 reps); put away after a clean rep, at the end of the set or after FORM_MS. Each one shown is
// kept in the Workout card's Mistakes list (keepMistake), to be shown again once the panel has gone.
const FORM_MS = 10000;
const replay = new RepReplay($('youCanvas'));
function formCheck(exercise, e) {
  if (!S.running || !$('useDemos').checked || !e.faults?.length || !EXERCISES[exercise]) return false;
  const fault = e.faults.find(f => usableDemo(exercise, f)) || e.faults[0];
  const now = performance.now();
  // (the same fault within 3 s of its showing: the panel stays as it is, that showing still up or a mistake the user
  // opened from the list since. A mistake the user opened is not that showing)
  const last = S.shown, same = last && last.exercise === exercise && last.code === fault.code;
  if (same && now - last.at < 3000) return last.demo;
  const w = e.window || { start: e.t - 1500, end: e.t + 800 };
  const m = { kind: 'exercise', exercise, what: EXERCISES[exercise].label, fault, side: e.side ?? null, turn: e.t,
    frames: S.trail.filter(x => x.t >= w.start - 150 && x.t <= w.end + 150), aspect: S.aspect,
    mirror: $('stage').classList.contains('mirror'), demo: usableDemo(exercise, fault) ? S.demos[exercise] : null };
  showForm(m);
  S.shown = { exercise, code: fault.code, at: now, demo: !!m.demo };
  clearTimeout(S.demoTimer);
  S.demoTimer = setTimeout(hideForm, FORM_MS);
  keepMistake(m);
  log(`form check: ${EXERCISES[exercise].label}, ${fault.code}${m.demo ? ' (3D demo shown)'
    : ' (no 3D demo for this fault)'}`);
  return !!m.demo;
}
/** The exercise's demo can show the right form for `fault`: never a demo whose own motion has the fault. */
const usableDemo = (exercise, fault) => {
  const d = S.demos[exercise];
  return !!d && !(d.avoidFor || []).includes(fault.code);
};
/** The panel put away (its fault fixed, the set's or the hold's end, FORM_MS, Stop), but not a mistake the user opened
 * from the Mistakes list: that one stays until they close it or open another (`force`: Close, and the next workout).
 * One shown as it happened over it goes, and the one the user opened is back. */
function hideForm(force = false) {
  if (S.form?.pinned && force !== true) return;
  const was = S.form, back = force === true ? null : S.under;
  clearTimeout(S.demoTimer);
  $('demo').classList.remove('show', 'pinned');
  $('demoVideo').pause();
  replay.stop(); likeReplay.stop();
  S.form = null; S.under = null;
  if (was && !was.pinned) S.shown = null;               // (gone: the same fault again is shown again)
  if (back) { showForm(back, true); renderMistakes(); } // (its row marked again)
  else if (was?.pinned) renderMistakes();               // (its row no longer marked as shown)
}
/** A clean rep of the exercise being corrected, once the panel has been up a moment: the fix worked, put it away. */
function cleanRep(exercise) {
  if (S.form && S.form.exercise === exercise && performance.now() - S.form.at > 2500) hideForm();
}

// --- a library movement's form check: the same panel for a fault of a hold (web/js/holdform.js, through moves.js),
// once the coach is told it (moveEvents: the hold's start carrying it in form.open, or a hold_fault), and for one of a
// moving or rhythm movement (web/js/moveform.js: a form_fault, told as it comes). "You": the user's landmarks replayed,
// the fault's part in red (its `part`, on the user's own `side`): a moving one's, the frames its verdict was based on
// (its `seen`, mistakes.js seenWindow: a cycle check's fault is told when the turn is confirmed, which can be seconds
// after the moment it measured), a hold's the last HOLD_REPLAY_MS before it was told; "Like this": the movement's
// reference pose drawn the same way and still, its matching part in red: a hold's, library.json `pose` (the library
// animation's held pose as the camera would see it), turned to the user's working side; a moving one's, the
// pose its check was made for (library.json `refPoses`, by check id: refPoseOf), turned to the side of the user's
// fault. The fault's label and measurement over them, its cue and target under. Put away HOLD_FIXED_MS after that
// fault's fix (once it has been up 2.5 s, as cleanRep), at the hold's end, when the movement ends (finishMovement) or
// after FORM_MS; a later fault replaces it, and the Now card offers "See it again" while the fault is still there. "See
// it in 3D": the same frames on the Y Bot next to the library's GLB, playing a hold's held part (library.json `held`),
// a moving one's reference moment (around its refPoses `t`). A library built without them: "You" alone with the cue
// (and nothing tracked to replay: "Like this" alone with it, or with neither the cue alone), the whole clip in 3D.
const HOLD_REPLAY_MS = 2000, HOLD_FIXED_MS = 1500;
// a moving movement's reference moment in 3D: its GLB's animation this long either side of it (the shoulder rotation's
// reference takes 7 s out and back: its hands going out and coming in again)
const AROUND_S = 1.5;
const likeReplay = new RepReplay($('likeCanvas'));
const cap = s => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : '');
/** A library movement's fault (hold_fault, form_fault, or an entry of a form's open) as the panel and the 3D view say
 * it: its label and measurement ("Feet too close together: feet 0.48 leg lengths apart"), and its cue with what to aim
 * for. */
const holdCaption = f => [cap(f.label ?? f.fault), f.measured].filter(Boolean).join(': ');
const holdDetail = f => [f.cue, f.target && `Aim for ${f.target}.`].filter(Boolean).join(' ');
// the working side a pose's reference is on (library.json pose.side, as tools/build_moves.mjs finds it) and the user's,
// the same way (holdform.js poseMetrics): the triangle's front leg, else the lifted leg (the quad stretch's bent one,
// the figure-four's crossed one)
const WORKING = { triangle_pose: 'front' };
/** The user's working side over `frames` ('left' / 'right': what most of them say), or null (none measured);
 * `aspect`: the frames' (a saved workout's, reviewed). */
function workingSide(key, frames, aspect = S.aspect) {
  if (!S.poseMetrics) return null;
  const by = WORKING[key] ?? 'lift', n = { L: 0, R: 0 };
  for (const f of frames) {
    const m = f.world && f.image ? S.poseMetrics(f.world, f.image, aspect) : null;
    if (m && n[m[by]] != null) n[m[by]] += 1;
  }
  return n.L + n.R ? (n.L >= n.R ? 'left' : 'right') : null;
}
/** Reference landmarks as library.json has them ([[x, y], ...], 33, normalised to a 16:9 picture) to draw
 * ([{x, y, visibility}]), or null (anything else). */
function refImage(im) {
  if (!Array.isArray(im) || im.length < 33 || !im.every(p => Array.isArray(p) && p.length >= 2
    && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null;
  return im.map(([x, y]) => ({ x, y, visibility: 1 }));
}
/** A held pose's reference pose (library.json `pose.image`) as landmarks to draw, or null (none built). */
const refPose = m => refImage(m?.pose?.image);
/** The held part of its GLB animation ({start, end} s), or null (none built: the whole clip). */
const heldOf = m => (Number.isFinite(m?.held?.start) && Number.isFinite(m?.held?.end) && m.held.end > m.held.start
  ? { start: m.held.start, end: m.held.end } : null);
const sideOrNull = s => (s === 'left' || s === 'right' ? s : null);
/** A moving or rhythm movement's reference pose for its check `id` (library.json refPoses[id] = {image: [[x, y]] x 33,
 * side, t?, mirrored?}, built by tools/build_moves.mjs; read defensively, as a library built before has none): {image
 * (to draw), side (the reference's side the check's part is on there, 'left' | 'right'; null: both, never turned), t
 * (seconds into its GLB animation, or null), mirrored (true: the pose is the reference's mirror image, for a one-sided
 * check its clip does on the other side only, as the standing side crunch's swept_knee_left: its image and side are
 * the mirror's, and the clip at `t` shows the other side)}, or null (none for that check, or not of that shape). */
function refPoseOf(m, id) {
  const all = m?.refPoses, r = typeof id === 'string' && all && typeof all === 'object' && Object.hasOwn(all, id)
    ? all[id] : null;
  const image = refImage(r?.image);
  if (!image) return null;
  return { image, side: sideOrNull(r.side), t: Number.isFinite(r.t) && r.t >= 0 ? r.t : null,
    mirrored: r.mirrored === true };
}
/** A movement's reference moment `t` (s) as a part of its GLB animation to play ({start, end}, AROUND_S either side,
 * within the clip's `durationSec`), or null (none: the whole clip). */
function aroundOf(m, t) {
  if (!Number.isFinite(t)) return null;
  const len = Number.isFinite(m?.durationSec) && m.durationSec > 0 ? m.durationSec : Infinity;
  if (t > len) return null;                             // (not a moment of this clip)
  return { start: Math.max(0, t - AROUND_S), end: Math.min(len, t + AROUND_S) };
}
/** A mistake of a movement of the library (kind 'hold': a held pose's fault; 'move': a moving or rhythm movement's),
 * not an exercise's rep. */
const ofLibrary = m => m?.kind === 'hold' || m?.kind === 'move';
/** "Like this" of a library movement's mistake `m`: the reference pose to draw (null: none built), the side it is on
 * and the user's to turn it to (a hold: the pose's working side and the user's, workingSide; a moving one: the side of
 * its check's part, the reference's and the fault's, both as moveform.js finds them), and for the 3D view the part of
 * its GLB's animation (null: the whole clip) and the side the clip itself is on there (`clipSide`: the pose's, but
 * the other one for a pose taken from the reference's mirror image, refPoseOf `mirrored`, as the clip is not). */
function likeOf(m) {
  const e = m.entry;
  if (m.kind === 'hold') {
    const side = sideOrNull(e?.pose?.side);
    return { image: refPose(e), side, clipSide: side, user: sideOrNull(m.workSide), segment: heldOf(e) };
  }
  const r = refPoseOf(e, m.fault?.fault), side = r?.side ?? null;
  return { image: r?.image ?? null, side, clipSide: r?.mirrored ? mirrorSide(side) : side, user: sideOrNull(m.side),
    segment: aroundOf(e, r?.t) };
}

/** The coach was told an event of movement `m` at frame time `t` (moveEvents): a fault shows aside (a hold's start
 * carrying one, a hold_fault, a form_fault); the fix of the one shown (hold_fix, form_fix) or the hold's end puts it
 * away, a moment after (a mistake the user opened from the Mistakes list stays: it is back once this one goes). */
function holdCheck(type, e, m, t) {
  const fix = type === 'hold_fix' || type === 'form_fix', shown = S.form?.library && !S.form.pinned;
  if (type === 'hold_start' && e.form?.open?.length) showHold(m, e.form.open[0], t);
  else if (type === 'hold_fault' || type === 'form_fault') showHold(m, e, t);
  else if (shown && fix && e.fault === S.form.code) {
    clearTimeout(S.demoTimer);
    S.demoTimer = setTimeout(hideForm, Math.max(HOLD_FIXED_MS, 2500 - (performance.now() - S.form.at)));
  } else if (shown && type === 'hold_end') hideForm();
}
/** The panel for the fault `f` of movement `m` (a hold's, or a moving or rhythm movement's), from the user's frames up
 * to `t`; kept in the Mistakes list, but not when shown `again` (the Now card's "See it again": the same fault, still
 * there). */
function showHold(m, f, t, { again = false } = {}) {
  if (!S.running || !$('useDemos').checked || !m || !f) return false;
  // "You": the frames the fault's verdict was based on (its `seen`), else the last HOLD_REPLAY_MS before it was told
  // (a hold's fault, an event from before `seen`, or those frames no longer kept: "See it again" 12 s on)
  const w = seenWindow(f.seen, t), seen = w ? S.trail.filter(x => x.t >= w.start && x.t <= w.end) : [];
  const frames = seen.filter(x => x.image).length >= 2 ? seen
    : S.trail.filter(x => x.t > t - HOLD_REPLAY_MS && x.t <= t);
  const hold = m.track === 'hold';
  const x = { kind: hold ? 'hold' : 'move', movement: m.key, what: m.display, entry: m, fault: f, side: f.side ?? null,
    frames, aspect: S.aspect, mirror: $('stage').classList.contains('mirror'),
    workSide: hold ? workingSide(m.key, frames) : null };
  const shown = showForm(x);                            // (nobody tracked: its words, without "You")
  clearTimeout(S.demoTimer);
  S.demoTimer = setTimeout(hideForm, FORM_MS);
  if (!again) keepMistake(x);
  const how = shown.ref ? ` (its reference pose${shown.flip ? ', turned to your side' : ''})`
    : hold ? ' (no reference pose in the library)' : ' (no reference pose of this check in the library)';
  log(`form check: ${m.display}, ${f.label ?? f.fault}${how}${shown.you ? '' : ' (nothing tracked to replay)'}`);
  return true;
}

/**
 * The side panel's form check for a mistake `m` (formCheck and showHold as it happens; the Mistakes list's Show,
 * `pinned`: no timer, and a fix, the hold's or the movement's end leaves it). "You": its frames replayed, looped, the
 * faulty part in red. "Like this": an exercise's demo of the right form; a library movement's reference pose (likeOf:
 * a held pose's `pose`, a moving one's `refPoses` for the check), still, its matching part in red, on the user's side
 * (done on the other side, it is mirrored: its left and right swapped, so the part on the user's side is the one in
 * red; with the camera view mirrored, both are). The fault's words over and under them. Nothing tracked to replay
 * (under 2 frames with landmarks: a hold's fault told as the user stepped out of view, a saved mistake whose window
 * has no frames): "You" left out and the rest shown, as "Like this" is without a reference or demo (with neither, the
 * cue alone). Returns {ref, flip, you}.
 */
function showForm(m, pinned = false) {
  const f = m.fault, library = ofLibrary(m), panel = $('demo'), v = $('demoVideo'), bones = bonesFor(f.part, m.side);
  // (found out first: RepReplay.play stops and clears the canvas before it finds nothing to replay, and the panel up,
  // a pinned one too, would be left blank)
  const you = (m.frames || []).filter(x => x.image).length >= 2
    && replay.play(m.frames, { aspect: m.aspect, mirror: m.mirror, bones });
  if (!you) replay.stop();                              // (the one before: out of sight, until it is shown again)
  $('youCanvas').parentElement.hidden = !you;
  let ref = null, flip = false;
  if (library) {
    const like = likeOf(m);
    ref = like.image;
    flip = !!(ref && like.user && like.side && like.side !== like.user);
    panel.classList.remove('nodemo'); panel.classList.toggle('pose', !!ref); panel.classList.toggle('alone', !ref);
    v.pause();
    if (ref) likeReplay.show(flip ? mirrorImage(ref) : ref, { aspect: 16 / 9, mirror: m.mirror, bones });
    else likeReplay.stop();
    $('youLabel').textContent = 'You';
    $('demoCaption').textContent = holdCaption(f);
    $('demoDetail').textContent = holdDetail(f);
    $('demoCredit').textContent = m.entry?.credit?.short || '';
  } else {
    $('demoCaption').textContent = f.message;
    $('demoDetail').textContent = describeFault(m.exercise, f);
    panel.classList.remove('pose'); likeReplay.stop();                // (a held pose's panel before: its reference)
    panel.classList.toggle('alone', !you && !m.demo);  // (nothing to replay, no demo: the words, not "no demo" alone)
    $('youLabel').textContent = 'Your rep';
    const d = m.demo;
    if (d) {
      panel.classList.remove('nodemo');
      const seg = d.segment;
      const begin = () => { v.currentTime = seg.start; v.playbackRate = 0.75; v.play().catch(() => {}); };
      if (S.demoFor !== m.exercise) {
        v.src = d.url; v.addEventListener('loadedmetadata', begin, { once: true });
      } else begin();
      v.ontimeupdate = () => { if (v.currentTime >= seg.end) v.currentTime = seg.start; };
      S.demoFor = m.exercise;
      $('demoCredit').textContent = d.credit?.short || '';
    } else {
      panel.classList.add('nodemo'); v.pause();
      $('demoCredit').textContent = '';
    }
  }
  // (pinned: which mistake it is, and Close)
  $('demoWhen').textContent = pinned ? `Mistake at ${clock(m.at)}${m.saved ? ' of the saved workout' : ''} · ${m.what}`
    : '';
  panel.classList.toggle('pinned', pinned);
  panel.classList.add('show');
  // its 3D view (open3D), built only if asked
  const three = threeOf(m), was = S.form;
  $('demo3d').style.display = three ? '' : 'none';
  // (library: a library movement's fault, held or moving: its fix, the hold's or the movement's end put it away)
  S.form = { pinned, mistake: m, library, exercise: m.exercise, key: m.movement, code: library ? f.fault : f.code,
    at: performance.now(), demo: library ? !!ref : !!m.demo, three };
  // the mistake the user opened: another one opened replaces it, one shown as it happens covers it until that one goes
  // (hideForm: it is back)
  if (pinned) S.under = null;
  else {
    if (was?.pinned) S.under = was.mistake;
    S.shown = null;                                     // (formCheck's 3 s run from this one, if it is its own)
  }
  if (was?.pinned && !pinned) renderMistakes();         // (one opened from the list was covered: its row unmarked)
  return { ref, flip, you };
}

/**
 * A mistake in the 3D view (open3D), or null: under 2 of its frames tracked in 3D, or no character to pose them on.
 * A rep's fault: the exercise's demo of the right form, synced to the rep. A library movement's: its clip over a held
 * pose's held part, or around a moving one's reference moment (likeOf; neither built: the whole clip, at its own
 * pace), turned to face as the user does and mirrored if done on the other side than the user's as the 3D view shows
 * them (mirrored like the camera view: their side then shows as the other one); the user's character is an exercise
 * demo's, else the movement's own clip (the same Y Bot rig: a server with the library and no exercise demos still has
 * one).
 */
function threeOf(m) {
  const frames = (m.frames || []).filter(x => x.world);
  if (frames.length < 2) return null;
  if (!ofLibrary(m)) {
    return modelFor(m.exercise) ? { exercise: m.exercise, fault: m.fault, side: m.side, frames, turn: m.turn,
      demo: m.demo, mirror: m.mirror } : null;
  }
  const e = m.entry, model = modelFor() || (e?.glb ? `/moves/${e.glb}` : null);
  if (!model) return null;
  // (the clip mirrored when its own side there is not the user's as the 3D view shows them)
  const like = likeOf(m), shown = m.mirror ? mirrorSide(like.user) : like.user;
  const other = !!(shown && like.clipSide && like.clipSide !== shown);
  return { library: true, key: m.movement, display: m.what, fault: m.fault, side: m.fault.side, frames, model,
    turn: frames[frames.length >> 1].t, mirror: m.mirror,
    demo: e?.glb ? { model: `/moves/${e.glb}`, segment: like.segment, face: true, mirror: other } : null };
}

// --- the Mistakes list (the Workout card): every mistake the form check showed in the workout, newest first, to see
// again once its panel has gone (its fix, the hold's or the movement's end, FORM_MS, Stop). Show opens one in the side
// panel, pinned until the user closes it or shows another, its replay looping; 3D opens it in the 3D view. Kept until
// the next workout starts, and in the recording (S.rec.mistakes, by frame times: its frames are the recording's). A
// saved workout picked in the card shows its own instead (derived from its events if saved before they were kept) ----
S.mistakes = new MistakeList();    // this workout's (or the last one's, once stopped)
S.review = null;                   // a saved workout's, shown instead: {id, list, loading, derived, error}
S.under = null;                    // the mistake the user opened, while one shown as it happens covers it (showForm)
S.shown = null;                    // the last exercise fault shown as it happened: {exercise, code, at, demo} (formCheck)
/** A mistake the form check just showed (formCheck, showHold): kept, with when (the frame's time, and seconds into
 * the workout) and its frames' window. */
function keepMistake(m) {
  if (!S.running) return;
  const t = S.lastFrameT ?? m.frames.at(-1)?.t ?? 0;
  m.t = t; m.at = Math.max(0, (t - (S.t0 ?? t)) / 1000);
  m.window = m.frames.length ? { start: m.frames[0].t, end: m.frames.at(-1).t } : { start: t, end: t };
  S.mistakes.add(m);
  S.rec?.mistakes?.push(recordOf(m));
  if (!S.review) renderMistakes();
}
/** The next workout starts: the list is its own from now on (the last workout's and a saved one's go, pinned too). */
function resetMistakes() {
  S.mistakes.clear(); S.review = null; S.t0 = undefined;
  $('reviewPick').value = '';
  hideForm(true);
  renderMistakes();
}
const mini = (text, title, onClick) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'mini'; b.textContent = text; b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
/** The list: which workout it is of, a row per mistake (when, what, the fault and its measurement; Show, 3D), and how
 * many earlier ones a long workout left out. The saved-workout picker waits while a workout runs or starts. */
function renderMistakes() {
  const r = S.review, list = r ? r.list : S.mistakes, box = $('mistakeList');
  const how = !r ? '' : r.loading ? ': loading...' : r.error ? `: could not load it (${r.error})`
    : r.derived ? ', from its events (saved before mistakes were kept)' : '';
  $('mistakesOf').textContent = r ? `Saved workout of ${savedName(r.id)}${how}`
    : S.running ? 'This workout' : S.startedAt ? 'The last workout' : 'No workout yet';
  $('mistakesOf').title = r ? r.id : '';
  box.replaceChildren();
  for (const m of list.newestFirst()) {
    const [row, when, text, what, label, acts] = ['div', 'span', 'span', 'b', 'span', 'span']
      .map(tag => document.createElement(tag));
    const w = rowOf(m), three = threeOf(m);
    row.className = `mistake${S.form?.pinned && S.form.mistake === m ? ' on' : ''}`;    // (the one opened, shown)
    when.className = 'm-when'; when.textContent = w.when;
    what.textContent = w.what; label.className = 'm-label'; label.textContent = w.label;
    text.className = 'm-text'; text.append(what, label);
    if (w.measured) { const x = document.createElement('small'); x.textContent = w.measured; text.append(x); }
    const show = mini('Show', 'Your frames next to the right form, in the side panel, until you close it',
      () => pinMistake(m));
    const d3 = mini('3D', three ? 'On a 3D character next to the right form' : 'Not tracked in 3D',
      () => open3D(threeOf(m)));
    d3.disabled = HOSTED || !three;
    if (HOSTED) d3.hidden = true;
    acts.className = 'm-acts'; acts.append(show, d3);
    row.append(when, text, acts);
    box.append(row);
  }
  if (!list.size) {
    box.textContent = r ? (r.loading || r.error ? '' : 'No mistakes were shown in it.') : S.startedAt
      ? 'No mistakes shown so far.' : 'The mistakes the form check shows stay here, to see again after the workout.';
  }
  const left = `${list.left} earlier ${list.left === 1 ? 'mistake is' : 'mistakes are'} not listed`;
  $('mistakesLeft').textContent = list.left ? `${left} (the list keeps the last ${list.max})` : '';
  $('reviewPick').disabled = !!(S.running || S.starting);
}
/** Show: the mistake in the side panel, pinned (its replay looping) until the user closes it or shows another; with
 * nothing of it tracked to replay, without "You" (showForm). */
function pinMistake(m) {
  if (!showForm(m, true).you) log(`(nothing of that mistake was tracked to replay: ${rowOf(m).label})`);
  clearTimeout(S.demoTimer);
  $('demo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  renderMistakes();
}
$('demoClose').addEventListener('click', () => hideForm(true));
/** The saved workouts (GET /api/recordings, or one just saved) in the list's picker, newest first. */
function savedWorkouts(list) {
  const pick = $('reviewPick'), have = new Set([...pick.options].map(o => o.value));
  for (const x of list) {
    if (!x?.id || have.has(x.id)) continue;
    const o = new Option(`Saved: ${savedName(x.id)}`, x.id);
    o.title = x.id;
    pick.add(o, 1);                                     // (after "This workout": the newest first)
    have.add(x.id);
  }
}
/**
 * A saved workout picked (`id`, its recording; '' for this one): its mistakes in the list, their frames from the
 * recording by each one's window, without replaying it. One saved before mistakes were kept has them derived from its
 * events (mistakes.js). Its held poses' references are the current library's, its exercises' demos the current ones.
 */
async function reviewSaved(id) {
  if (!id || S.running || S.starting) { S.review = null; renderMistakes(); return; }
  const r = S.review = { id, list: new MistakeList(), loading: true };
  renderMistakes();
  try {
    const res = await fetch(`/api/recording?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rec = await res.json();
    await Promise.all([libraryReady, holdformReady]);  // (the reference poses, and the user's working side)
    if (S.review !== r) return;                         // (another picked meanwhile, or a workout started)
    const { records, derived } = mistakesOf(rec, { known: k => !!EXERCISES[k], label: k => EXERCISES[k]?.label,
      pick: (k, faults) => faults.find(f => usableDemo(k, f)) });
    const aspect = rec.width > 0 && rec.height > 0 ? rec.width / rec.height : 16 / 9, mirror = rec.source === 'camera';
    for (const x of records) {
      if (x.kind === 'exercise' && !EXERCISES[x.exercise]) continue;     // (one this page no longer has)
      const m = { ...fromRecord(x), at: x.at, frames: framesIn(rec.frames, x.window), aspect, mirror, saved: id };
      if (ofLibrary(m)) {                                // (a held pose's or a moving one's: its reference, its clip)
        m.entry = S.libByKey.get(m.movement) ?? null;
        if (m.kind === 'hold') m.workSide = workingSide(m.movement, m.frames, aspect);
      } else m.demo = usableDemo(m.exercise, m.fault) ? S.demos[m.exercise] : null;
      r.list.add(m);
    }
    r.derived = derived;
    log(`reviewing ${id}: ${records.length} ${records.length === 1 ? 'mistake' : 'mistakes'}`
      + `${derived ? ' (from its events)' : ''}`);
  } catch (e) {
    r.error = e.message;
    if (S.review === r) log(`could not load ${id} to review it: ${e.message}`, 'err');
  } finally {
    r.loading = false;
  }
  if (S.review === r) renderMistakes();
}
$('reviewPick').addEventListener('change', () => reviewSaved($('reviewPick').value));
renderMistakes();

/** Form events from the engine (both modes). `who` names the exercise and set in auto mode. */
function coaching(e, who, repsLabel) {
  const ex = who.exercise || S.exercise;
  if (e.type === 'cue') {
    const demo = !!(S.form && !S.form.pinned && S.form.exercise === ex && S.form.demo);
    coachEvent({ kind: 'cue', code: e.code, part: e.part, message: e.message, value: e.value, reason: e.reason, demo, ...who }, e.message);
  } else if (e.type === 'fixed') {
    if (S.form?.exercise === ex) hideForm();
    coachEvent({ kind: 'fixed', code: e.code, message: e.message, side: e.side, ...who }, FALLBACK.fixed());
  } else if (e.type === 'praise') {
    coachEvent({ kind: 'praise', ...who }, FALLBACK.praise());
  } else if (e.type === 'partial') {     // the right movement, not deep enough to count (coached via cues)
    formCheck(ex, e);
    $('repsLabel').textContent = 'not counted: go a bit deeper';
    setTimeout(() => { if ($('repsLabel').textContent.startsWith('not counted')) $('repsLabel').textContent = repsLabel; }, 2000);
    log(`partial rep (not counted): legs folded to ${(e.fold * 100).toFixed(0)}% of standing height`);
  } else if (e.type === 'visibility') {
    coachEvent({ kind: 'visibility', parts: e.parts, ...who }, FALLBACK.visibility());
  }
}

// --- auto mode (and an exercise named: auto.js counts that one alone) ----------------------------------------------
// (a named exercise's events between its sets name no set)
const setLabel = e => (e.set != null ? `${e.label} · set ${e.set}` : e.label);
/** `final`: the events finish() returns when the workout is stopped: shown and logged, but only the workout summary
 * goes to the coach (not a set recognised only now, nor cues about its reps). */
// A rep of an exercise without a set yet (auto.js `tentative`), shown at once in grey until its set starts or the run
// lapses (auto.js GAP_MS: reps more than 6 s apart are not one set). Live: one rep, then nothing on screen until the next.
const TENTATIVE_MS = 7000;
function showTentative(e) {
  // what to go back to (not a "not counted" note on a partial rep: its own 2 s reset would no longer find it)
  const label = $('repsLabel').textContent, a = S.auto?.active;
  S.tentative ??= { reps: $('reps').textContent, label: label.startsWith('not counted') && a ? setLabel(a) : label };
  clearTimeout(S.tentative.timer);
  if (!e.switching) { $('reps').textContent = e.count; $('reps').classList.add('tentative'); }
  $('repsLabel').textContent = `${e.switching ? 'Switching to ' : ''}${e.label}? ${Math.max(1, e.need - e.count)} more to start counting`;
  S.tentative.text = `${e.label}? Do ${Math.max(1, e.need - e.count)} more to start counting`;    // the banner (showFraming)
  S.lapse = null;
  S.tentative.timer = setTimeout(() => {
    clearTentative(true);
    // no rep followed in time (live: single reps 8-25 s apart never started a set): say how sets are counted
    S.lapse = { text: `${e.label}: do the reps one after another (a pause over 6 s starts over)`, until: performance.now() + 5000 };
  }, TENTATIVE_MS);
  log(`looks like ${e.label}: ${e.count} of the ${e.need} reps in a row that start a set`);
}
function clearTentative(restore) {
  const x = S.tentative;
  if (!x) return;
  clearTimeout(x.timer); S.tentative = null;
  $('reps').classList.remove('tentative');
  if (restore) { $('reps').textContent = x.reps; $('repsLabel').textContent = x.label; }
}

function handleAuto(events, { final = false } = {}) {
  let earlier = null;                    // a fault on one of the reps a new set counts back (it was not shown then)
  for (const e of events) {
    // (a named exercise's cues between its sets name no set, and no rep of one has been counted)
    const who = e.exercise ? { exercise: e.exercise, exerciseLabel: e.label, set: e.set, reps: e.reps ?? e.count ?? 0 } : {};
    if (['set_start', 'set_end'].includes(e.type) || (e.type === 'rep' && !e.backfill)) clearTentative(false);
    if (e.type === 'set_start') {
      $('reps').textContent = e.count; $('repsLabel').textContent = setLabel(e);
      log(`${e.previous ? `${e.previous.label} set ${e.previous.set} done: ${e.previous.reps} reps. ` : ''}${S.auto.only ? 'Counting' : 'Detected'} ${e.label} (set ${e.set}): ${e.count} ${e.count === 1 ? 'rep' : 'reps'} so far`, 'coach');
      if (!final) coachEvent({ kind: 'set_start', ...who, reps: e.count, previous: e.previous }, FALLBACK.set_start(e));
    } else if (e.type === 'rep') {
      if (e.backfill) { if (e.faults.length && !final) earlier = e; continue; }
      $('reps').textContent = e.count;
      const sides = Object.entries(S.auto.active?.perSide || {}).map(([k, v]) => `${k} ${v}`).join(', ');
      $('repsLabel').textContent = setLabel(e) + (sides ? ` (${sides})` : '');
      $('lastRep').textContent = `${e.label}: ${e.metrics.extreme.toFixed(2)} at the turning point${e.faults.length ? '; ' + e.faults.map(f => f.code).join(', ') : ''}`;
      if (e.faults.length) formCheck(e.exercise, e); else if (earlier) formCheck(earlier.exercise, earlier); else cleanRep(e.exercise);
      earlier = null;
      log(`${e.label} rep ${e.count}${e.side ? ` (${e.side})` : ''}${e.faults.length ? ': ' + e.faults.map(f => f.message).join('; ') : ': clean'}`);
    } else if (e.type === 'set_end') {
      if (S.form?.exercise === e.exercise) hideForm();
      if (S.pendingEnd) hideSetEnd();     // (the question was about this set: the set in progress is the only one)
      S.ended.push(e);
      app?.send('set', { exercise: e.exercise, label: e.label, set: e.set, reps: e.reps, partials: e.partials,
        faults: e.faults, perSide: e.perSide });
      log(`${e.label} set ${e.set} done: ${e.reps} ${e.reps === 1 ? 'rep' : 'reps'}${{ rest: ' (rest)', confirmed: ' (you said so)',
        movement: ' (a movement named: reps pause)' }[e.reason] ?? ''}`);
      // a switch is announced with the next set; the end of the workout with the summary. The end the user confirmed
      // by voice the agent has from its tool already (eleven-coach.js), and Claude or ChatGPT from the user's words
      // (user_said, tagged with the set). A set ended by a movement named with a tap: the movement's own sentence says
      // its reps (the voice speaks one cue at a time: two in a row, only the second is heard)
      if (e.reason === 'rest' || e.reason === 'confirmed' || e.reason === 'movement') {
        $('repsLabel').textContent = `${setLabel(e)} done · resting`;
        if (!(e.reason !== 'rest' && S.endByVoice)) coachEvent({ kind: 'set_end', ...who, reps: e.reps, reason: e.reason,
          faultsByRep: e.faults, perSide: e.perSide }, e.reason === 'movement' ? '' : FALLBACK.set_summary(e.label, e.reps));
      }
    } else if (e.type === 'set_end_pending') {    // no rep for a while: the set stays open, and the user is asked
      if (final) continue;
      askSetEnd(e);
      log(`${e.label} set ${e.set}: no rep for a while (${e.reps} ${e.reps === 1 ? 'rep' : 'reps'}): is the set done?`);
      S.askEnd = { kind: 'confirm_set_end', ...who, label: e.label, reps: e.reps };
      coachEvent(S.askEnd, FALLBACK.confirm_set_end(e));
    } else if (e.type === 'set_end_cancelled') {  // a rep of it came: the question is moot
      hideSetEnd();
      log(`${e.label} set ${e.set} goes on`);
    } else if (e.type === 'workout_summary') {
      // (and the movements of the library the user named, with their times or rough counts: one entry each, and none
      // that has nothing to show)
      const movements = movesDone().map(({ movement, display, movementKind, track, seconds, count }) =>
        ({ movement, display, movementKind, track, ...(count > 0 ? { count } : { seconds }) }));
      coachEvent({ kind: 'workout_summary', sets: e.sets.map(x => ({ exercise: x.label, set: x.set, reps: x.reps })), totals: e.totals,
        ...(movements.length ? { movements } : {}) }, FALLBACK.workout_summary(e, movements));
    } else if (e.type === 'tentative') {
      if (!final) showTentative(e);
    } else if (final) {
      if (['cue', 'fixed'].includes(e.type)) log(`(after stop) ${e.message || e.code}`);
    } else coaching(e, who, e.label ? setLabel(e) : 'reps');
  }
  if (events.some(e => ['set_start', 'rep', 'set_end', 'workout_summary'].includes(e.type))) renderWorkout();
  // the app keeps the set in progress too, so a run cut short (Back, a reload) loses no counted rep
  const a = S.auto?.active;
  if (a && !final && events.some(e => e.type === 'set_start' || (e.type === 'rep' && !e.backfill)))
    app?.send('progress', { exercise: a.key, label: a.label, set: a.set, reps: a.count, partials: a.partials,
      faults: { ...a.faults }, perSide: { ...a.perSide } });
}

function renderWorkout() {
  const box = $('workout');
  box.replaceChildren();
  const sets = S.auto ? S.auto.sets : [];
  // the movements of the library named in it, done (with their times or rough counts) and the one now
  const moves = [...movesDone(true).map(d => [d.display, doneText(d)]), ...(S.move ? [[S.move.entry.display, 'now']] : [])];
  if (!sets.length && !moves.length) {
    box.textContent = S.auto?.only ? `No sets yet: start your ${exLabel(S.auto.only).toLowerCase()} set.` : 'No sets yet: start any exercise.';
    return;
  }
  const row = (x, y) => { const a = document.createElement('span'), b = document.createElement('span'); a.textContent = x; b.textContent = y; box.append(a, b); };
  for (const s of sets) row(`${s.label} · set ${s.set}`, `${s.count} reps${s === S.auto.active ? ' (now)' : ''}`);
  for (const [x, y] of moves) row(x, y);
}

// What the camera must see before reps count (the engine waits for 0.5 s of a steady view and never counts guesses).
const PART_HINT = { legs: 'your legs: knees and feet', arms: 'your arms: elbows and hands', elbows: 'your shoulders and elbows',
  torso: 'your shoulders and hips' };
// A movement of the library named: what its tracker needs (the whole body in view), and how it keeps track.
const MOVE_HINT = { hold: 'Hold it still: the timer runs while you hold', moving: 'Keep moving: the time counts while you move',
  rhythm: 'Keep going: a rough count by its rhythm' };
function showFraming() {
  const b = $('banner');
  // the set's engine, or the named exercise's between its sets (it says what it needs to see)
  const key = S.auto?.active?.key ?? S.auto?.only, eng = key && S.auto.engines[key];
  if (S.stale) { b.className = 'stale'; b.textContent = 'This page is out of date: reload it (Cmd+Shift+R)'; return; }
  if (S.move) {
    const v = S.moveVis;
    if (v && !v.torso) { b.className = 'wait'; b.textContent = `I can't see ${PART_HINT.torso}. Step back.`; return; }
    b.className = 'ready'; b.textContent = S.move.entry.kind === 'dance' ? 'Move at your own pace; pauses and variations are welcome.' : MOVE_HINT[S.move.entry.track];
    return;
  }
  const note = S.tentative?.text ?? (S.lapse && performance.now() < S.lapse.until ? S.lapse.text : null);
  if (S.auto && !eng) {                 // auto mode, between sets: is enough of the body in view to recognise anything?
    const v = S.auto.vis;
    if (!v.torso && !v.arms && !v.legs) { b.className = 'wait'; b.textContent = 'I can only see your head and shoulders. Stand up and step back until I can see you from head to feet.'; }
    else if (v.torso && v.elbows && !v.arms) { b.className = 'ready'; b.textContent = 'Watching (hands just out of view: fine for push-ups)'; }
    else if (!v.torso || !v.arms) { b.className = 'wait'; b.textContent = `I can't see ${[!v.torso && PART_HINT.torso, !v.arms && PART_HINT.arms].filter(Boolean).join(' and ')}. Step back.`; }
    else if (!v.legs) { b.className = 'wait'; b.textContent = 'Arm exercises only: step back so I can see your legs and feet.'; }
    else if (note) { b.className = 'tentative'; b.textContent = note; }
    else { b.className = 'ready'; b.textContent = 'Watching: start any exercise'; }
    return;
  }
  if (!eng) return;
  if (eng.inView && note) { b.className = 'tentative'; b.textContent = note; return; }   // (switching)
  if (eng.inView) { b.className = 'ready'; b.textContent = S.auto.active ? 'In view: counting' : `In view: start your ${EXERCISES[key].label.toLowerCase()} set`; return; }
  const parts = (eng.missing || []).map(p => PART_HINT[p] || p);
  b.className = 'wait';
  b.textContent = parts.length ? `I can't see ${parts.join(' and ')}. Step back or lower the camera.` : 'Hold still for a moment...';
}

/** One frame's pose (from the tracker or a recording) through the overlay, the engine or auto mode, and the UI. */
function processPose(r, t, w, h) {
  if (overlay.width !== w) { overlay.width = w; overlay.height = h; }
  octx.clearRect(0, 0, overlay.width, overlay.height);
  drawPose(octx, r.image);
  S.aspect = w / h;
  S.trail.push({ t, image: r.image, world: r.world });         // the last seconds, to replay a rep that went wrong
  while (S.trail.length && S.trail[0].t < t - 12000) S.trail.shift();
  if (S.rec) S.rec.frames.push({ t, image: r.image ? r.image.map(p => [r4(p.x), r4(p.y), r4(p.z), r4(p.visibility ?? 0)]) : null,
    world: r.world ? r.world.map(p => [r4(p.x), r4(p.y), r4(p.z)]) : null });
  S.lastFrameT = t;
  S.t0 ??= t;                                   // (the workout's first frame: its mistakes are timed from it)
  if (S.move) anchorAttempt(S.rec, S.move.attempt, t);
  if (r.image && r.world) {
    const f = features(r.world, r.image, w / h);
    if (f.visTorso >= .6 && (f.visArms >= .6 || f.visLegs >= .6)) S.lastPoseAt = performance.now();
    if (S.move) {
      // a movement of the library named: its tracker has the frames, and no reps are counted (the AutoTracker gets
      // none). With the landmarks too: a hold's form is measured from them (web/js/holdform.js), and a moving or
      // rhythm movement's (web/js/moveform.js). Its events are recorded
      if(S.trackingBlocked){renderMove();return;}
      S.moveVis = { torso: f.visTorso >= 0.6, legs: f.visLegs >= 0.6, arms: f.visArms >= 0.6 };
      let evs = [];
      try { if (!S.trackingBlocked&&S.move.tracker) {
        evs = S.move.tracker.update(f, t, { world: r.world, image: r.image, aspect: w / h }) ?? [];
        if(recordTrackingUpdate(S.rec,S.move,t,performance.now()))S.eleven?.context?.(`tracking_started: attempt ${S.move.attempt} processed its first pose successfully. Visibility still determines which body parts can be reviewed.`);
      } }
      catch (e) { trackingUnavailable(`Movement tracking stopped: ${e.message}. No restart was applied.`); return; }
      if (S.rec) S.rec.events.push(...evs);
      moveEvents(evs, t);
      recordMovingIntervals(S.rec, S.move.entry, S.move.tracker, S.move.attempt);
      renderMove(); showFraming();
      $('signal').textContent = '-'; $('view').textContent = f.view;
    } else {
      const evs = S.auto.update(f, t);
      if (S.rec) for (const e of evs) S.rec.events.push(e);
      handleAuto(evs);
      showFraming();
      const ex = EXERCISES[S.auto.active?.key ?? S.auto.only];
      const v = !ex ? '-' : ex.perArm ? `${ex.signalArm(f, 'L').toFixed(2)} / ${ex.signalArm(f, 'R').toFixed(2)}` : ex.signal(f).toFixed(ex.prominence < 2 ? 2 : 0);
      $('signal').textContent = v; $('view').textContent = f.view;
    }
  } else {
    if (S.move) {
      if(S.trackingBlocked){renderMove();return;}
      let evs=[];
      try { evs = S.move.tracker?.lost(t) ?? []; }
      catch(e){trackingUnavailable(`Movement tracking stopped: ${e.message}.`);return;}
      if (S.rec) S.rec.events.push(...evs);
      moveEvents(evs, t); renderMove();
    } else {
      const evs = S.auto.lost(t);
      if (S.rec) S.rec.events.push(...evs);
      handleAuto(evs);
    }
    $('banner').className = 'wait'; $('banner').textContent = "I can't see you. Step into the picture.";
  }
  S.frames += 1;
  const now = performance.now();
  if (now - S.fpsT > 1000) {
    $('fps').textContent = `${Math.round((S.frames * 1000) / (now - S.fpsT))} fps (${S.replayRec ? 'recording' : S.pose.delegate})`;
    S.frames = 0; S.fpsT = now;
  }
}

function onFrame(gen) {
  if (!S.running || gen !== S.gen) return;
  if (video.readyState >= 2) {
    const ts = Math.max(S.lastTs + 1, Math.round(performance.now()));
    S.lastTs = ts;
    let r;
    try { r = detect(S.pose.landmarker, video, ts); S.trackErr = false; } catch (e) {
      // a failed frame must not stop the loop. MediaPipe needs increasing timestamps: if it has seen a later one (a
      // stray call from outside the loop), continue from there
      const m = /minimum expected timestamp is (\d+)/.exec(String(e));
      if (m) S.lastTs = Math.ceil(Number(m[1]) / 1000) + 1;
      if (!S.trackErr) { S.trackErr = true; log(`tracking error (recovering): ${String(e).split('\n')[0].slice(0, 120)}`, 'err'); }
      r = { image: null, world: null };
    }
    // the engine's clock: real time for the camera (not the tracker's timestamp, which may have been pushed ahead)
    const t = $('source').value === 'camera' ? Math.round(performance.now()) : Math.round(video.currentTime * 1000);
    processPose(r, t, video.videoWidth, video.videoHeight);
  }
  if ($('source').value !== 'camera' && video.ended) { stop(); return; }
  const next = () => onFrame(gen);
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(next); else requestAnimationFrame(next);
}

/** A saved set replayed at its own timing (?replay_speed=N speeds it up; the engine runs on the recorded clock). */
const asPoints = a => a && a.map(p => ({ x: p[0], y: p[1], z: p[2], visibility: p[3] ?? 1 }));
function replayLoop(gen) {
  const R = S.replayRec;
  if (!S.running || gen !== S.gen || !R) return;
  const until = R.t0 + (performance.now() - R.wall0) * R.speed;
  while (R.i < R.frames.length && R.frames[R.i].t <= until) {
    const fr = R.frames[R.i++];
    processPose({ image: asPoints(fr.image), world: asPoints(fr.world) }, fr.t, R.width, R.height);
  }
  if (R.i >= R.frames.length) { stop(); return; }
  requestAnimationFrame(() => replayLoop(gen));
}

async function start() {
  if (!hostAuthorized) return;
  if (S.running || S.starting) return;            // one start at a time (the button, or the app's start message)
  S.starting = true; S.cancelStart = false;
  const intro = S.startIntroPending;
  S.startGate = intro;
  const stopLabel = $('stop').textContent;
  $('start').disabled = true;
  S.voiceOut?.unlock();                           // in the click: browsers only start audio after the user did something
  // a conversation without a workout (Talk to coach) goes on in the workout: the page keeps listening, and an agent
  // session that hears the user is kept if the workout's plan is one too
  if (S.talking) { S.talking = false; clearTimeout(S.talkIdle); log('Talk to coach: the workout carries on the conversation'); }
  renderTalk(); renderMistakes();                 // (no saved workout is picked meanwhile)
  loadStt();                                      // (Parakeet may have been set up, or started again, since)
  // what is connected now (a sign-in since the page opened counts), asked while the model and camera load: the server
  // answers from its cache at once, or checks the CLIs (about a second) if its answers are a minute old
  const connsRead = readConnections();
  // the last workout's agent session ends after its summary as planned, unless this workout gets going and keeps it
  const was = S.eleven;
  S.lapse = null;
  codeVersion().then(v => {
    if (!v || !S.code || v === S.code || S.stale) return;
    S.stale = true;
    log('this page is out of date (the code changed after it was loaded): reload it with Cmd+Shift+R', 'err');
  });
  S.exercise = $('exercise').value;              // 'auto', or an exercise named in the picker (a clip names its own)
  S.ended = []; S.workout = null; S.startedAt = new Date().toISOString();
  // a movement of the library picked before Start (a counted one set the Exercise picker): named once the workout runs
  const pre = S.nextMove && (!isCounted(S.nextMove) || S.nextMove.engine === S.exercise) ? S.nextMove : null;
  S.nextMove = null; S.move = null; S.moves = []; S.reference = null; S.moveVis = null; S.lastFrameT = undefined;
  S.lastPoseAt = undefined; S.attemptSerial = 0; S.trackingBlocked = false;
  renderMove(); markLibrary();
  const auto = S.exercise === 'auto';
  $('reps').textContent = '-'; $('repsLabel').textContent = auto ? 'start any exercise' : `${exLabel(S.exercise)}: start your set`;
  $('say').style.display = 'none';
  hideExercises(); hideSetEnd(); S.autoTold = null;
  try {
    if (intro) {
      S.startDelay = new AbortController();
      $('stop').disabled = false; $('stop').textContent = 'Cancel start';
      $('startCountdown').hidden = false;
      $('cancelCountdown').focus();
      const ready = await waitForCountdown({ signal: S.startDelay.signal, onTick: n => {
        $('countdownNumber').textContent = String(n);
        $('countdownText').textContent = 'Starting in…';
      } });
      S.startDelay = null;
      if (!ready || S.cancelStart) { cancelStart(was); return; }
      $('countdownNumber').textContent = '';
      $('countdownText').textContent = 'Preparing camera and tracker…';
    }
    if (!S.Tracker) {
      try {
        const moves = await loadMovementModule();
        S.Tracker = moves.MovementTracker; S.statusText = moves.statusText;
      } catch { log('Movement tracking could not load. Reload and try again.', 'err'); }
    }
    if (intro && !S.Tracker) throw new Error('Movement tracker unavailable. Reload and try again; the coach has not started.');
    if (S.cancelStart) { cancelStart(was); return; }
    const pendingTracker = pre && !isCounted(pre) ? freshTracker(S.Tracker, pre) : null; // validate before camera/coach startup
    const src = $('source').value, recording = src.startsWith('rec:');
    S.replayRec = null; S.trail = []; hideForm(); clearTentative(false);
    if (recording) {
      const rec = await (await fetch(`/api/recording?id=${encodeURIComponent(src.slice(4))}`)).json();
      S.replayRec = { frames: rec.frames, i: 0, t0: rec.frames[0].t, wall0: performance.now(), width: rec.width, height: rec.height,
        speed: Number(new URLSearchParams(location.search).get('replay_speed') || 1) };
      video.pause(); video.srcObject = null; video.removeAttribute('src');
      $('stage').classList.toggle('mirror', rec.source === 'camera');
    } else if (!S.pose || S.pose.model !== $('model').value) { log('loading the pose model...'); S.pose = await createPose({ model: $('model').value }); }
    if (S.cancelStart) { cancelStart(was); return; }
    if (recording) { /* nothing to open */ } else if (src === 'camera') {
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = S.stream; video.removeAttribute('src');
      $('stage').classList.add('mirror');
    } else {
      const clip = JSON.parse(src);
      video.srcObject = null; video.src = clip.url;
      $('stage').classList.remove('mirror');
    }
    if (!recording) await video.play();
    // one exercise named: it alone is counted, from its first rep (the user said what they are doing)
    S.auto = new AutoTracker(auto ? {} : { only: S.exercise });
    renderWorkout();
    if (S.cancelStart) { cancelStart(was); return; }      // (before an agent session is opened for nothing)
    // what is connected picks the coach, asked again at each Start (above). A slow or failed answer is not waited for
    // long: the last one stands (none yet: Auto tries Claude)
    const conns = await Promise.race([connsRead, new Promise(r => setTimeout(r, 3000))]);
    if (conns) { S.conns = conns; fillAgentForm(); }
    else log(`(no answer from /api/connections at Start: ${S.conns ? 'the last one stands' : 'Auto tries Claude'})`);
    // the agent is opened per workout, and takes one session at a time: one that refused the last workout (another tab
    // had it, or the last session was still closing) is tried again
    if (S.failed.eleven) { const { eleven: _, ...failed } = S.failed; S.failed = failed; }
    if (S.cancelStart) { cancelStart(was); return; }
    S.startGate = false;
    $('startCountdown').hidden = true;
    replan();
    // the coach connects meanwhile (an ElevenLabs agent per workout, or the next connection if it fails to); never wait
    // for it long: the engine's cues stand in
    await Promise.race([applyPlan(), new Promise(r => setTimeout(r, 5000))]);
    if (S.cancelStart) { cancelStart(was); return; }
    // the coach asks which exercise (the chips show, and auto mode counts meanwhile), unless one was named already (a
    // movement of the library picked before Start: named below, and the coach hears of it then)
    if (intro || (pre && !isCounted(pre))) { /* welcome / chooseMovement, once running */ } else if (auto) askExercise();
    else {
      coachEvent({ kind: 'start', exercise: S.exercise, exerciseLabel: exLabel(S.exercise), ...(pre ? { movement: pre.key, display: pre.display } : {}) },
        FALLBACK.start(pre?.display ?? exLabel(S.exercise)));
    }
    if (intro) S.startedAt = new Date().toISOString();
    resetMistakes();                                // (the last workout's, or a saved one's: this one's from now on)
    S.running = true; S.lastTs = 0; S.gen += 1; S.trackErr = false;
    S.rec = $('record').checked && !recording ? { started: new Date().toISOString(), code: S.code, source: src === 'camera' ? 'camera' : JSON.parse(src).id,
      exercise: S.exercise, model: S.pose.model, delegate: S.pose.delegate, frames: [], events: [], mistakes: [], attempts: [], movementIntervals: [],
      coordinateSystem: { world: 'mediapipe metres; x right, y down, z away; hip origin', image: 'unmirrored normalized camera', displayMirrored: src === 'camera' },
      timestampUnit: 'milliseconds', timestampOrigin: src === 'camera' ? 'performance.now' : 'video.currentTime' } : null;
    if (pre && isCounted(pre)) { S.reference = pre; renderMove(); markLibrary(); } else if (pre) chooseMovement(pre.key, 'start', pendingTracker);
    if (intro) {
      S.startIntroPending = false;
      const url = new URL(location.href); url.searchParams.delete('session_intro');
      history.replaceState(null, '', url);
      $('sessionStartNote').textContent = 'This session’s countdown and introduction are complete. Tracking status depends on actual pose updates. Stop and save keeps the pose recording; Restart movement begins a separate attempt.';
      askExercise(true);
    }
    $('changeEx').disabled = false;
    clearTimeout(S.elevenEnd); S.elevenEnding = false;   // the last workout's agent session (if kept) goes on in this one
    $('stop').disabled = false;
    app?.send('state', { running: true, startedAt: S.startedAt });
    log(`${auto ? 'workout started: detecting exercises automatically' : `workout started: ${exLabel(S.exercise)} only`} (${recording ? 'recording' : src === 'camera' ? 'camera' : 'clip'})`);
    if (recording) { S.replayRec.wall0 = performance.now(); replayLoop(S.gen); } else onFrame(S.gen);
  } catch (e) {
    log(`could not start: ${e.message}`, 'err');
    if (intro) { $('banner').className = 'wait'; $('banner').textContent = `Could not start: ${e.message}`; }
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }   // a camera opened before the failure
    app?.send('error', { message: `Could not start: ${e.message}` });
    $('start').disabled = false;
    if (S.cancelStart) cancelStart(was);
    else if (S.eleven && S.eleven !== was) stopEleven();  // an agent session this start opened
  } finally {
    S.startDelay?.abort(); S.startDelay = null; S.startGate = false;
    if (intro && !S.running) { S.nextMove = pre; renderMove(); markLibrary(); }
    $('startCountdown').hidden = true;
    $('stop').textContent = stopLabel; $('stop').disabled = !S.running;
    if (intro) (S.running ? $('stop') : $('start')).focus();
    S.starting = false;
    syncListening();                              // (listening from the start, or not at all if it failed)
    renderMistakes();                             // (the saved-workout picker again, if it did not start)
  }
}
/** The app asked to stop while the page was starting: close what was opened and send an empty workout. */
function cancelStart(was) {
  S.cancelStart = false;
  video.pause();
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  if (S.eleven && S.eleven !== was) stopEleven();      // an agent session this start opened (the last one ends as planned)
  $('start').disabled = false;
  log('start cancelled');
  S.workout = workoutOf([], [], S.startedAt, new Date().toISOString());
  app?.send('state', { running: false, startedAt: S.startedAt });
  app?.send('summary', S.workout);
}

async function stop() {
  if (!S.running) return;
  S.running = false; S.gen += 1;
  hideForm(); clearTentative(true);       // an uncounted rep must not stay on the counter
  hideExercises(); hideSetEnd(); $('changeEx').disabled = true;
  $('banner').className = '';
  $('stop').disabled = true;
  video.pause();
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  finishMovement('stop');                  // keep the final attempt boundary even when no movement was counted
  const ending = S.auto.finish();
  if (S.rec) S.rec.events.push(...ending);
  const n = S.auto.sets.reduce((k, s) => k + s.count, 0);
  log(`workout stopped: ${S.auto.sets.length} sets, ${n} reps`);
  if (S.rec && S.rec.frames.length) {        // landmarks + events only, to the local data folder
    const rec = S.rec; S.rec = null;
    const id = `live-${rec.started.replace(/[^0-9]/g, '').slice(0, 14)}-${rec.exercise}`;
    post('/api/results?model=live', { id, ...rec, width: video.videoWidth, height: video.videoHeight, reps: n,
      sets: S.auto.summary().sets, ...(S.moves.length ? { movements: S.moves } : {}), duration: (rec.frames.at(-1).t - rec.frames[0].t) / 1000 })
      .then(() => {
        log(`saved for debugging: ${id} (${rec.frames.length} frames, landmarks only)`);
        savedWorkouts([{ id }]);                  // (its mistakes can be reviewed later, after the next workout too)
        window.dispatchEvent(new CustomEvent('rhythm-recording-saved',{detail:{id}}));
        const src = `rec:${id}`;
        if (![...$('source').options].some(o => o.value === src)) $('source').add(new Option(`Recording: ${id}`, src));
      })
      .catch(e => log(`could not save the set: ${e.message}`, 'err'));
  }
  // an agent session bills by the minute: it ends once the summary's reply has been heard or its fallback spoken (onDone),
  // at most END_MS after the summary went to it, and STOP_END_MS from now if none went
  S.elevenAsleep = false;
  if (S.eleven) { S.elevenEnding = true; clearTimeout(S.elevenEnd); S.elevenEnd = setTimeout(stopEleven, STOP_END_MS); }
  handleAuto(ending, { final: true });     // closes the open set and sends the workout summary to the coach
  renderMove(); markLibrary(); renderWorkout();
  renderMistakes();                        // (they stay, after the summary too, until the next workout starts)
  // the workout for the app (embedded): the sets, each sent at its set_end too
  S.workout = workoutOf(S.auto.summary().sets, S.ended, S.startedAt, new Date().toISOString());
  app?.send('state', { running: false, startedAt: S.startedAt });
  app?.send('summary', S.workout);
  $('start').disabled = false;             // the coach session stays up for the next set
  syncListening();                         // (the microphone closes with the workout: Talk to coach opens it again)
}

video.addEventListener('ended', () => { if ($('source').value !== 'camera' && !S.replayRec) stop(); });
$('start').addEventListener('click', start);
$('stop').addEventListener('click', () => {
  if (S.starting && !S.running) { S.cancelStart = true; S.startDelay?.abort(); }
  else stop();
});
$('cancelCountdown').addEventListener('click', () => { S.cancelStart = true; S.startDelay?.abort(); });
window.POSE_COACH = S;
S.formCheck = formCheck; S.hideForm = hideForm;     // (for checking the form check from the console)
S.pinMistake = pinMistake; S.reviewSaved = reviewSaved;   // (... and the Mistakes list)
S.chooseMovement = chooseMovement;                  // (... and a movement named as the agent's set_movement names it)

// --- the form check in 3D, only when asked: three.js, the character and view3d.js load on the first press ----------
/** The character to pose the person on: the exercise's demo character, else any (all are the same Y Bot). */
const modelFor = exercise => S.demos[exercise]?.modelUrl || Object.values(S.demos).find(x => x.modelUrl)?.modelUrl;
// (closed, or a movement of the library shown in it, while the form check's view loaded: S.v3dGen moved on, and that
// view is dropped. Not the box's class alone: Show in 3D puts it back)
S.v3dGen = 0;
async function open3D(form) {
  if (!form || S.opening3d) return;          // (a second click while it loads: one view)
  S.opening3d = true;
  closeClip();                               // (a movement of the library shown in it: put away)
  const gen = S.v3dGen;
  if (S.view3d?.renderer) S.view3d.renderer.domElement.style.display = '';
  const box = $('view3d'), status = $('v3dStatus'), library = !!form.library, f = form.fault;
  // a rep's fault: the exercise's demo of the right form (synced to the rep); a library movement's: its clip over a
  // held pose's held part, or around a moving one's reference moment (threeOf)
  const demo = library ? form.demo
    : form.demo?.modelUrl ? { model: form.demo.modelUrl, segment: form.demo.segment } : null;
  $('v3dTitle').textContent = library ? holdCaption(f) : f.message;
  $('v3dFoot').textContent = library ? holdDetail(f) : describeFault(form.exercise, f);
  $('v3dPart').textContent = library ? [f.side, f.part].filter(Boolean).join(' ') || 'the fault' : f.part;
  $('v3dRight').textContent = demo ? 'Like this' : 'No 3D demo of the right form for this one';
  status.textContent = 'Building the 3D view...'; status.style.display = '';
  box.classList.add('show');
  try {
    const { View3D } = await import('./view3d.js');
    if (gen !== S.v3dGen || !box.classList.contains('show')) return;   // closed, or a clip shown, while it loaded
    S.view3d ??= new View3D($('v3dCanvas'));
    S.view3d.progress = p => { $('v3dProgress').style.width = `${(p * 100).toFixed(1)}%`; };
    const info = await S.view3d.open({ frames: form.frames, turn: form.turn, part: f.part, side: form.side,
      model: form.model ?? modelFor(form.exercise), mirror: form.mirror, demo });
    if (gen !== S.v3dGen) { S.view3d.close(); return; }
    if (!info) return;                                             // closed while it was being built
    S.view3dInfo = info;
    // (a library movement's fault has no turning point to sync to: its clip plays on its own)
    $('v3dRight').textContent = !info.demo ? 'No 3D demo of the right form for this one'
      : info.synced || library ? 'Like this' : 'Like this (at its own pace)';
    status.style.display = 'none';
    log(`3D view: ${library ? `${form.display}, ${f.fault}` : `${EXERCISES[form.exercise].label}, ${f.code}`}`);
  } catch (err) {
    if (gen !== S.v3dGen) return;                                  // (dropped: not over what shows now)
    status.textContent = `Could not build the 3D view: ${err.message}`;
    log(`3D view failed: ${err.message}`, 'err');
  } finally {
    S.opening3d = false;
  }
}
function close3D() { S.v3dGen += 1; $('view3d').classList.remove('show'); S.view3d?.close(); closeClip(); }

// --- a movement of the library in 3D, on request (Show in 3D): its animation (the Y Bot, from /moves/glb/<key>.glb)
// looped in the same 3D view over the video, until the user closes it. three.js and the file load on the first press --
const clip3d = { gen: 0, raf: 0, renderer: null, parts: null };
async function showMovement3D(m) {
  if (!m?.glb) return;
  close3D();
  const gen = clip3d.gen, box = $('view3d'), status = $('v3dStatus'), el = $('v3dCanvas');
  box.classList.add('show', 'clip');
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });  // (pressed far down the Movements card: in view)
  $('v3dTitle').textContent = m.display;
  $('v3dFoot').textContent = [`${trackLabel(m)[0].toUpperCase()}${trackLabel(m).slice(1)}.`, m.coach, m.credit?.short].filter(Boolean).join(' ');
  $('v3dProgress').style.width = '0';
  status.textContent = 'Loading its animation...'; status.style.display = '';
  try {
    const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([import('three'),
      import('three/addons/loaders/GLTFLoader.js'), import('three/addons/controls/OrbitControls.js')]);
    const gltf = await new GLTFLoader().loadAsync(`/moves/${m.glb}`);
    if (gen !== clip3d.gen) return;                                 // closed, or another shown, while it loaded
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e2124);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f47, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1.5, 3, 2.5); scene.add(sun);
    scene.add(new THREE.GridHelper(8, 16, 0x4a515c, 0x2c3138));
    const body = gltf.scene; scene.add(body);
    const clip = gltf.animations?.[0], len = clip?.duration || 0;
    const mixer = new THREE.AnimationMixer(body), action = clip ? mixer.clipAction(clip) : null;
    action?.play();
    // turned to face the camera, a little to one side (the clips face wherever the footage's camera was): its facing
    // over the clip, from the hips (up x the hips' left-to-right)
    const legL = body.getObjectByName('mixamorigLeftUpLeg'), legR = body.getObjectByName('mixamorigRightUpLeg');
    const pose = k => { if (action) { action.time = (k / 12) * len; mixer.update(0); } body.updateMatrixWorld(true); };
    if (legL && legR) {
      const facing = new THREE.Vector3(), l = new THREE.Vector3(), r = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (let k = 0; k <= 12; k += 1) {
        pose(k);
        facing.add(new THREE.Vector3().crossVectors(up, r.copy(legR.getWorldPosition(r)).sub(legL.getWorldPosition(l))).setY(0).normalize());
      }
      if (facing.lengthSq() > 1e-6) body.rotation.y = 0.35 - Math.atan2(facing.x, facing.z);
    }
    // its extent over the clip, to frame it (the skinned mesh as posed)
    const all = new THREE.Box3(), one = new THREE.Box3();
    for (let k = 0; k <= 12; k += 1) { pose(k); all.union(one.setFromObject(body, true)); }
    if (action) { action.time = 0; mixer.update(0); }
    const size = all.getSize(new THREE.Vector3()), mid = all.getCenter(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    const controls = new OrbitControls(camera, el);
    controls.target.copy(mid); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.55;
    let moved = false;
    controls.addEventListener('start', () => { moved = true; });
    const frameView = () => {                                       // until the user turns it
      if (moved) return;
      const tall = Math.max(size.y, 0.8) + 0.3, wide = Math.max(size.x, 0.8) + 0.3;
      const d = (1.1 * Math.max(tall, wide / camera.aspect)) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) + size.z / 2;
      camera.position.set(mid.x, mid.y + 0.1 + 0.14 * d, mid.z + d); controls.update();   // (from a little above: a push-up, a fold)
    };
    // its own renderer, made once (the form check's 3D view has its own: one is hidden while the other shows)
    if (!clip3d.renderer) {
      clip3d.renderer = new THREE.WebGLRenderer({ antialias: true });
      clip3d.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      el.appendChild(clip3d.renderer.domElement);
    }
    const renderer = clip3d.renderer;
    renderer.domElement.style.display = '';
    if (S.view3d?.renderer) S.view3d.renderer.domElement.style.display = 'none';
    const fit = () => {
      const w = el.clientWidth || 640, h = el.clientHeight || 360;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      frameView();
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    const clock = new THREE.Clock();
    const frame = () => {
      if (gen !== clip3d.gen) return;
      if (action) {
        mixer.update(clock.getDelta());
        $('v3dProgress').style.width = `${len ? ((action.time % len) / len * 100).toFixed(1) : 0}%`;
      }
      controls.update();
      renderer.render(scene, camera);
      clip3d.raf = requestAnimationFrame(frame);
    };
    clip3d.parts = { controls, ro, mixer, body, scene };
    status.style.display = 'none';
    clip3d.raf = requestAnimationFrame(frame);
    S.clip3d = { key: m.key, clip: clip?.name ?? null, seconds: len, size: size.toArray().map(x => Math.round(x * 100) / 100) };
    log(`3D: ${m.display} (its animation from the movement library${clip ? `, ${len.toFixed(1)} s` : ', no animation in the file'})`);
  } catch (err) {
    if (gen !== clip3d.gen) return;
    status.textContent = `Could not show it in 3D: ${err.message}`;
    log(`3D view of ${m.display} failed: ${err.message}`, 'err');
  }
}
function closeClip() {
  clip3d.gen += 1;
  cancelAnimationFrame(clip3d.raf); clip3d.raf = 0;
  const p = clip3d.parts;
  clip3d.parts = null;
  if (p) {
    p.ro.disconnect(); p.controls.dispose();
    p.mixer.stopAllAction(); p.mixer.uncacheRoot(p.body);
    p.body.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const mat of [].concat(o.material)) {
        for (const v of Object.values(mat)) if (v?.isTexture) v.dispose();
        mat.dispose();
      }
    });
    p.scene.clear();
    clip3d.renderer?.renderLists?.dispose();
  }
  if (clip3d.renderer) clip3d.renderer.domElement.style.display = 'none';
  $('view3d').classList.remove('clip');
}
$('demo3d').addEventListener('click', () => open3D(S.form?.three));      // (the mistake the panel shows)
$('v3dClose').addEventListener('click', close3D);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && $('view3d').classList.contains('show')) close3D(); });
