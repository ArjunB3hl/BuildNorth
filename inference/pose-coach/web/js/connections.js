// Coach connections: which brain writes the cues and which voice speaks them, from what is connected
// (GET /api/connections). In order: the ElevenLabs coach agent (its LLM and its own voice) when an agent is set up and
// the plan is paid, else Claude (through the Anthropic API when the user saved a key the API has not refused: the
// server's `transport` "api"; else when the Claude Code CLI is signed in), else ChatGPT when the Codex CLI is signed in
// with ChatGPT; with none of them the engine's own cues are spoken. Claude, ChatGPT and the engine's cues are spoken by
// the page's voice (Kokoro, the Mac's as its fallback). The user can still pick a brain or a voice by hand.
//
// Pure: no DOM and no fetch, so the page and the tests share it.
//
//   const plan = resolve(conns, { coach: 'auto', voice: 'auto', failed: {} })
//                                  // -> {brain: eleven|claude|chatgpt|none, voice: eleven|kokoro|mac|off, duplex, why, label}
//                                  // duplex: the agent with its own voice, which the user talks to through the microphone
//   const { failed, plan } = fallback(conns, { coach, voice, failed }, 'eleven', 'the agent refused the session')
//                                  // the brain that failed to start is skipped from now on: the next usable one
//   describe(conns)                // each connection's state in plain words, for the Connections panel
//   describeStt(stt)               // ... and the page's own listening (GET /api/stt/status: Parakeet on this Mac)
//   listens(plan, stt)             // who hears the user: 'agent' (duplex), 'page' (Parakeet, for the other coaches) or null
//   const cues = new SessionCues(3000)   // the cues Claude's or ChatGPT's sessions owe, by session (across a failover)

export const ORDER = ['eleven', 'claude', 'chatgpt'];
export const COACHES = ['auto', ...ORDER, 'off'];
export const VOICES = ['auto', 'kokoro', 'eleven', 'mac', 'off'];
/** An ElevenLabs agent id (not a secret: the agent is public, and answers only pages on this machine). */
export const AGENT_ID = /^agent_[a-z0-9]{20,40}$/;
/** What to run to sign a CLI in. */
export const SIGN_IN = { claude: 'claude auth login', chatgpt: 'codex login' };

const DEFAULT_MODEL = { claude: 'claude-sonnet-5-5', chatgpt: 'gpt-6-luna' };
const NAMES = { 'deepseek-v41-flash': 'DeepSeek V4.1 Flash', 'gpt-6-luna': 'GPT-6 Luna', 'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gpt-5.4-mini': 'GPT-5.4 Mini' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** A model id as people say it: claude-sonnet-5-5 -> Claude Sonnet 5.5, deepseek-v41-flash -> DeepSeek V4.1 Flash. */
export function modelName(id) {
  if (!id) return null;
  if (NAMES[id]) return NAMES[id];
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (m) return `Claude ${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  if (/^(sonnet|opus|haiku)$/.test(id)) return `Claude ${cap(id)}`;     // a CLI alias (POSE_COACH_MODEL=opus)
  return id;
}

/** "Rhythm coach (pose-coach)" -> "Rhythm coach agent": the agent's name without the workspace's note on it. */
const agentName = name => {
  const base = (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  return !base ? null : /\bagent$/i.test(base) ? base : `${base} agent`;
};

/** A brain in a few words (the log, the pickers, the panel). */
export function brainLabel(conns, brain) {
  if (brain === 'eleven') {
    const name = agentName(conns?.eleven?.name);
    return name ? `${name} (ElevenLabs)` : 'the ElevenLabs agent';
  }
  if (brain === 'claude') return modelName(conns?.claude?.model || DEFAULT_MODEL.claude);
  if (brain === 'chatgpt') return `ChatGPT (${modelName(conns?.chatgpt?.model || DEFAULT_MODEL.chatgpt)})`;
  return "the engine's own cues";
}
const SHORT = { eleven: 'ElevenLabs', claude: 'Claude', chatgpt: 'ChatGPT' };
const VOICE_LABEL = { eleven: "the agent's own voice", kokoro: 'Kokoro', mac: "the Mac's voice", off: 'no voice' };

/**
 * A CLI check that itself failed: it timed out, could not run, or gave an answer the server could not read (in
 * server/connections.py's words). The server gives `error` for a definite answer too (not signed in; for Codex, signed
 * in with an API key), and that one is no reason to try the CLI anyway.
 */
const checkFailed = c => typeof c.error === 'string' && /did not answer|could not (run|read)/.test(c.error);
/** Codex signed in with an API key: `codex exec` would bill that key, and ChatGPT is used only through a ChatGPT login. */
const apiKey = c => typeof c.error === 'string' && /API key/.test(c.error);
/**
 * Claude through the Anthropic API on the user's own key (the server's `transport`; an older server sends none: the
 * CLI). Usable with a key saved that the API has not refused: one it took, or one its check got no answer about
 * (`api.ok` null), which is tried as the server tries it.
 */
const viaApi = c => c.transport === 'api';
const apiUsable = c => !!c.api?.configured && c.api?.ok !== false;

/**
 * Why a brain cannot be used, or null if it can. Auto takes only what is known to work: an agent on a plan that is not
 * free (an unknown plan counts as paid), a CLI that says it is signed in. Picked by hand, an agent on the free plan is
 * tried (the agent refuses the session if the plan cannot run it), and so is Claude when its check failed (it may well
 * be signed in). ChatGPT never is unless Codex says it is signed in with ChatGPT: on a stored API key login, `codex exec`
 * would run on that key. Not known at all (the server did not say): Claude is tried, as before connections existed;
 * the agent needs its id and ChatGPT its ChatGPT sign-in. Claude through the API needs its key (viaApi), and then
 * the CLI's sign-in does not count: the server's session takes the API.
 */
function unusable(conns, brain, picked) {
  if (!conns) return brain === 'claude' ? null : brain === 'eleven' ? 'is not set up' : 'is not known to be signed in';
  const c = conns[brain] || {};
  if (brain === 'eleven') {
    if (!c.connected || !c.agentId) return 'is not set up';
    if (c.paid === false && !picked) return `is on the ${c.plan ? cap(c.plan) : 'Free'} plan (Auto needs a paid one)`;
    return null;
  }
  if (brain === 'claude' && viaApi(c)) {
    if (apiUsable(c)) return null;
    return c.api?.configured ? `cannot use its API key (${c.api.error || 'refused'})` : 'has no API key';
  }
  if (c.loggedIn) return null;
  if (c.available === false) return `is not installed (${brain === 'claude' ? 'Claude Code' : 'the Codex CLI'})`;
  if (checkFailed(c)) return picked && brain === 'claude' ? null : `could not be checked (${c.error})`;
  if (brain === 'chatgpt' && apiKey(c)) return 'is not signed in (Codex is on an API key)';
  return 'is not signed in';
}

/**
 * The brain and voice for a workout. `coach`: auto, or a brain picked by hand (eleven, claude, chatgpt), or off;
 * `voice`: auto, or one picked by hand; `failed`: the brains that failed to start ({brain: reason}), skipped.
 * Auto takes the first usable brain in ORDER. A brain picked by hand that cannot be used, or failed, moves on to the
 * next usable one after it in ORDER (never back to one before it: picking Claude over the agent is not a request for
 * the agent, which bills by the minute). The voice: auto is the agent's own with the agent, Kokoro otherwise; the
 * agent's voice picked by hand needs the agent as the brain (else Kokoro). The agent with its own voice is duplex: the
 * user talks to it. Any other coach or voice has no microphone: the user answers its questions with the buttons.
 */
export function resolve(conns, { coach = 'auto', voice = 'auto', failed = {} } = {}) {
  const skipped = [];
  let brain = 'none';
  if (coach !== 'off') {
    const from = ORDER.indexOf(coach);
    for (const b of ORDER.slice(Math.max(0, from))) {
      const no = failed[b] ? `failed to start: ${failed[b]}` : unusable(conns, b, b === coach);
      if (!no) { brain = b; break; }
      skipped.push(`${SHORT[b]} ${no}`);
    }
  }
  const label = brainLabel(conns, brain);
  let why;
  if (coach === 'off') why = "Coach off: the engine's own cues";
  else if (coach === 'auto') why = brain === 'none' ? `Auto: no coach is usable (${skipped.join('; ')}), so the engine's own cues`
    : `Auto: ${label}${skipped.length ? ` (${skipped.join('; ')})` : ''}`;
  else if (brain === coach) why = `${label}, picked by hand`;
  else why = `Picked ${SHORT[coach]}, but ${skipped.join('; ')}: ${brain === 'none' ? "the engine's own cues" : `using ${label}`}`;

  let v = voice;
  if (voice === 'auto') v = brain === 'eleven' ? 'eleven' : 'kokoro';
  else if (voice === 'eleven' && brain !== 'eleven') { v = 'kokoro'; why += ". The agent's own voice needs the ElevenLabs coach"; }
  why += `. Voice: ${VOICE_LABEL[v]}${voice === 'auto' ? ' (auto)' : ''}.`;
  const duplex = brain === 'eleven' && v === 'eleven';
  if (duplex) why += ' You can talk to the coach: the microphone is on during a workout.';
  return { brain, voice: v, duplex, why,
    label: `${brain === 'none' ? "The engine's own cues" : label}, ${VOICE_LABEL[v]}${duplex ? ', with the microphone' : ''}` };
}

/** After a brain failed to start: it is skipped from now on (until the caller clears `failed`), and the plan moves on. */
export function fallback(conns, choice, brain, reason) {
  const failed = { ...(choice.failed || {}), [brain]: reason || 'no reason given' };
  return { failed, plan: resolve(conns, { ...choice, failed }) };
}

/**
 * Each connection's state in plain words, for the Connections panel: {eleven, claude, chatgpt}, each {text, cmd?}
 * (cmd: a command that signs it in, shown as code). Nothing here is secret: the server returns no emails, tokens or
 * keys. Claude says which way it goes: through the API on the user's key, or through Claude Code on their login (an
 * older server, which sends no `transport`, gets the words it always had), with the API check's error if any.
 */
export function describe(conns) {
  if (!conns) {
    const unknown = { text: 'not known (the server did not say)' };
    return { eleven: unknown, claude: unknown, chatgpt: unknown };
  }
  const e = conns.eleven || {}, out = {};
  out.eleven = !e.connected ? { text: 'not set up' } : {
    text: [agentName(e.name) || 'an agent', modelName(e.llm), e.plan ? `${cap(e.plan)} plan` : 'plan not known'].filter(Boolean).join(', ')
      + (e.paid === false ? ' (Auto needs a paid plan)' : ''),
  };
  out.claude = describeClaude(conns.claude || {});
  const g = conns.chatgpt || {};
  out.chatgpt = g.loggedIn ? { text: `signed in with ChatGPT: ${modelName(g.model || DEFAULT_MODEL.chatgpt)}` }
    : signIn('chatgpt', g);
  return out;
}

/**
 * Claude in plain words: through the API on the user's key (and the API check's error, if any), or through Claude
 * Code on their login, which says why a key saved is not used (the API refused it). An older server sends no
 * `transport`: the words it always had.
 */
function describeClaude(c) {
  const model = modelName(c.model || DEFAULT_MODEL.claude), effort = `effort ${c.effort || 'high'}`, a = c.api || {};
  if (viaApi(c)) {
    return { text: `${model} through the API (your key), ${effort}` + (!a.configured ? ': no key saved'
      : a.ok === false ? `: ${a.error || 'the key was refused'}` : a.error ? ` (could not check: ${a.error})` : '') };
  }
  const cli = c.transport === 'cli', unused = cli && a.error ? `your API key is not used (${a.error})` : '';
  if (!c.loggedIn) {
    const d = signIn('claude', c);
    return unused ? { ...d, text: `${unused}; ${d.text}` } : d;
  }
  return { text: `signed in${c.plan ? ` (${cap(c.plan)} plan)` : ''}: ${model}`
    + `${cli ? ' through Claude Code (your Claude login)' : ''}, ${effort}${c.fast ? ', fast mode' : ''}`
    + (unused ? ` (${unused})` : '') };
}

/** A CLI that is not signed in, in plain words, with the command that signs it in. */
function signIn(b, c) {
  const cmd = SIGN_IN[b];
  if (c.available === false) {
    return { text: `${b === 'claude' ? 'Claude Code' : 'the Codex CLI'} not found; once installed, sign in with`, cmd };
  }
  if (checkFailed(c)) return { text: `could not check (${c.error}); sign in with`, cmd };
  if (b === 'chatgpt' && apiKey(c)) return { text: 'signed in with an API key, not ChatGPT; sign in with', cmd };
  return { text: 'not signed in; sign in with', cmd };
}

/**
 * Who hears the user in this plan: the agent itself with its own voice (duplex: the microphone streams to ElevenLabs),
 * else the page, when Parakeet is set up on this Mac (it writes down what the user says, and Claude, ChatGPT or the
 * engine's own coach get the words); null when nobody does (a text-only agent, or no Parakeet: the chips and buttons).
 */
export function listens(plan, stt) {
  if (plan?.brain === 'eleven') return plan.duplex ? 'agent' : null;
  return stt?.available ? 'page' : null;
}

/** The page's own listening in plain words, for the Connections panel ({text, cmd?}, as describe). */
export function describeStt(stt) {
  if (!stt) return { text: 'not known (the server did not say)' };
  if (!stt.available && stt.error) return { text: `off: ${stt.error}` };   // (e.g. POSE_STT=0 on this server)
  if (!stt.available) return { text: 'not set up (talk to Claude, ChatGPT or the engine by voice); set up with', cmd: 'bash tools/setup_stt.sh' };
  if (stt.ready) return { text: `Parakeet on this Mac: ready${stt.load_ms != null ? ` (loaded in ${(stt.load_ms / 1000).toFixed(1)} s)` : ''}` };
  if (stt.error) return { text: `Parakeet on this Mac: ${stt.error}` };
  return { text: 'Parakeet on this Mac: loading...' };
}

/**
 * The cues the coach sessions on the server (Claude, ChatGPT) owe the page. Each event sent waits `ms` for its cue; then
 * its own fallback runs (the page speaks the engine's cue) and that cue, should it still come, is late (not spoken).
 * Kept by session, since the server numbers each session's events from 1: when the page moves on from a session that
 * failed, what was sent to it still gets its fallback, and no wait of the old session stands for an event of the next.
 */
export class SessionCues {
  constructor(ms) { this.ms = ms; this.waits = new Map(); this.late = new Set(); }   // both by `${session}:${event id}`

  /** Event `id` went to session `sid` (at `t0`): `fallback` runs once if its cue has not come within `ms` (the
   * session's own wait unless given: an answer to the user's words takes longer than a cue). */
  sent(sid, id, t0, fallback, ms = this.ms) {
    const key = `${sid}:${id}`;
    this.waits.set(key, { t0, timer: setTimeout(() => { this.waits.delete(key); this.late.add(key); fallback(); }, ms) });
  }

  /** A cue from session `sid` for event `id`: {late: true} if its fallback ran (skip it), else {t0} (null if not known). */
  cue(sid, id) {
    const key = `${sid}:${id}`;
    if (this.late.has(key)) return { late: true, t0: null };
    const w = this.waits.get(key);
    if (w) { clearTimeout(w.timer); this.waits.delete(key); }
    return { late: false, t0: w ? w.t0 : null };
  }

  /** Session `sid` is the one read from now on: the late cues of the others will never come. (Their waits still run.) */
  use(sid) {
    for (const key of this.late) if (!key.startsWith(`${sid}:`)) this.late.delete(key);
  }
}
