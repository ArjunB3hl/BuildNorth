// Coach connections: which brain and voice the page uses from what is connected (GET /api/connections), picked by hand
// or by Auto, and where it goes when the one chosen fails to start; and each connection in plain words for the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_ID, COACHES, ORDER, SessionCues, VOICES, describe, describeStt, fallback, listens, modelName, resolve } from '../web/js/connections.js';

const AGENT = 'agent_0123456789abcdefghijklmnopqr';   // made up (the real id stays out of the repo)
/** /api/connections as the server answers it, with every connection usable unless changed. */
function conns({ eleven = {}, claude = {}, chatgpt = {} } = {}) {
  return {
    eleven: { connected: true, agentId: AGENT, name: 'Rhythm coach (pose-coach)', plan: 'starter', paid: true,
      llm: 'deepseek-v41-flash', ...eleven },
    claude: { available: true, loggedIn: true, plan: 'pro', model: 'claude-sonnet-5-5', effort: 'high', fast: false, error: null, ...claude },
    chatgpt: { available: true, loggedIn: true, model: 'gpt-6-luna', error: null, ...chatgpt },
    order: ['eleven', 'claude', 'chatgpt'],
    auto: 'eleven',
  };
}
const NO_AGENT = { connected: false, agentId: null, name: null, plan: null, paid: null, llm: null };
// signed out, as the server answers it (server/connections.py): a definite answer, though it comes as `error`
const CLAUDE_OUT = { loggedIn: false, plan: null, error: 'not signed in: sign in with claude auth login' };
const GPT_OUT = { loggedIn: false, error: 'not signed in with ChatGPT: run codex login' };
const GPT_KEY = { loggedIn: false, error: 'signed in with an API key, not ChatGPT: run codex login' };
// ... and a check that itself failed
const CLAUDE_UNSURE = { loggedIn: false, plan: null, error: 'claude auth status --json did not answer in 5 s' };
const GPT_UNSURE = { loggedIn: false, error: 'codex could not run (PermissionError)' };
// Claude through the Anthropic API on the user's key (the server's transport "api"), as server/connections.py gives it:
// the key taken, or not answered about (tried); and Claude Code while the API refuses the key saved
const REFUSED = 'the Anthropic API refused the key (check .data/connections/anthropic-key)';
const API_OK = { transport: 'api', api: { configured: true, ok: true, error: null } };
const UNANSWERED = 'the Anthropic API did not answer (APIConnectionError)';
const API_UNSURE = { transport: 'api', api: { configured: true, ok: null, error: UNANSWERED } };
const API_REFUSED = { transport: 'api', api: { configured: true, ok: false, error: REFUSED } };   // (the API asked for)
const API_NONE = { transport: 'api', api: { configured: false, ok: null, error: null } };
const CLI_KEY_REFUSED = { transport: 'cli', api: { configured: true, ok: false, error: REFUSED } };

test('Auto: the agent when it is set up on a plan that is not free, else Claude, else ChatGPT, else the engine', () => {
  assert.equal(ORDER.join(), 'eleven,claude,chatgpt');
  const all = resolve(conns(), {});
  assert.deepEqual([all.brain, all.voice], ['eleven', 'eleven']);           // with the agent's own voice
  assert.match(all.why, /^Auto: Rhythm coach agent \(ElevenLabs\)\. Voice: the agent's own voice/);
  assert.equal(all.duplex, true);                                       // the agent with its own voice: the user talks to it
  assert.match(all.why, /You can talk to the coach: the microphone is on during a workout\.$/);
  assert.equal(all.label, "Rhythm coach agent (ElevenLabs), the agent's own voice, with the microphone");
  assert.equal(resolve(conns({ eleven: { plan: null, paid: null } }), {}).brain, 'eleven');   // a plan not known counts as paid
  const free = resolve(conns({ eleven: { plan: 'free', paid: false } }), {});
  assert.deepEqual([free.brain, free.voice], ['claude', 'kokoro']);
  assert.match(free.why, /ElevenLabs is on the Free plan \(Auto needs a paid one\)/);
  const claude = resolve(conns({ eleven: NO_AGENT }), {});
  assert.deepEqual([claude.brain, claude.voice], ['claude', 'kokoro']);
  assert.equal(claude.why, 'Auto: Claude Sonnet 5.5 (ElevenLabs is not set up). Voice: Kokoro (auto).');
  assert.equal(claude.label, 'Claude Sonnet 5.5, Kokoro');
  assert.equal(claude.duplex, false);                                   // no microphone: the buttons answer its questions
  const gpt = resolve(conns({ eleven: NO_AGENT, claude: CLAUDE_OUT }), {});
  assert.deepEqual([gpt.brain, gpt.voice], ['chatgpt', 'kokoro']);
  assert.match(gpt.why, /^Auto: ChatGPT \(GPT-6 Luna\) \(ElevenLabs is not set up; Claude is not signed in\)/);
  const none = resolve(conns({ eleven: NO_AGENT, claude: CLAUDE_OUT, chatgpt: { available: false, loggedIn: false, error: 'the codex CLI was not found' } }), {});
  assert.deepEqual([none.brain, none.voice], ['none', 'kokoro']);
  assert.match(none.why, /no coach is usable \(ElevenLabs is not set up; Claude is not signed in; ChatGPT is not installed \(the Codex CLI\)\), so the engine's own cues/);
  assert.equal(none.label, "The engine's own cues, Kokoro");
  // an id without "connected" (or the reverse) is not an agent to connect to
  assert.equal(resolve(conns({ eleven: { agentId: null } }), {}).brain, 'claude');
  // a CLI check that failed is not a sign-in: Auto takes only what is known to work
  const unsure = resolve(conns({ eleven: NO_AGENT, claude: CLAUDE_UNSURE }), {});
  assert.equal(unsure.brain, 'chatgpt');
  assert.match(unsure.why, /Claude could not be checked \(claude auth status --json did not answer in 5 s\)/);
  // Codex signed in with an API key is not ChatGPT
  const key = resolve(conns({ eleven: NO_AGENT, claude: CLAUDE_OUT, chatgpt: GPT_KEY }), {});
  assert.equal(key.brain, 'none');
  assert.match(key.why, /ChatGPT is not signed in \(Codex is on an API key\)\)/);
});

test('picked by hand: that brain, even over a usable one before it; one that cannot be used moves on, never back', () => {
  for (const b of ORDER) {
    const p = resolve(conns(), { coach: b });
    assert.equal(p.brain, b);
    assert.match(p.why, /picked by hand/);
  }
  // the agent on the free plan is tried when picked (the agent refuses the session if the plan cannot run it)
  assert.equal(resolve(conns({ eleven: { plan: 'free', paid: false } }), { coach: 'eleven' }).brain, 'eleven');
  // and so is Claude when its check failed (it may well be signed in)
  assert.equal(resolve(conns({ claude: CLAUDE_UNSURE }), { coach: 'claude' }).brain, 'claude');
  // but a definite answer is one: signed out is signed out, whatever the server put in `error`
  for (const out of [CLAUDE_OUT, { loggedIn: false, error: null }]) {
    assert.equal(resolve(conns({ claude: out }), { coach: 'claude' }).brain, 'chatgpt');
  }
  // ChatGPT is never tried without a ChatGPT sign-in, picked or not: codex would run on a stored API key
  for (const out of [GPT_OUT, GPT_KEY, GPT_UNSURE]) assert.equal(resolve(conns({ chatgpt: out }), { coach: 'chatgpt' }).brain, 'none');
  assert.match(resolve(conns({ chatgpt: GPT_KEY }), { coach: 'chatgpt' }).why,
    /^Picked ChatGPT, but ChatGPT is not signed in \(Codex is on an API key\): the engine's own cues/);
  assert.match(resolve(conns({ chatgpt: GPT_UNSURE }), { coach: 'chatgpt' }).why, /ChatGPT could not be checked \(codex could not run/);
  // Claude picked but signed out: ChatGPT, not the agent before it (which bills by the minute)
  const p = resolve(conns({ claude: CLAUDE_OUT }), { coach: 'claude' });
  assert.equal(p.brain, 'chatgpt');
  assert.match(p.why, /^Picked Claude, but Claude is not signed in: using ChatGPT \(GPT-6 Luna\)/);
  const q = resolve(conns({ chatgpt: GPT_OUT }), { coach: 'chatgpt' });
  assert.equal(q.brain, 'none');
  assert.match(q.why, /^Picked ChatGPT, but ChatGPT is not signed in: the engine's own cues/);
  assert.equal(resolve(conns({ eleven: NO_AGENT }), { coach: 'eleven' }).brain, 'claude');
  const off = resolve(conns(), { coach: 'off' });
  assert.deepEqual([off.brain, off.voice], ['none', 'kokoro']);
  assert.match(off.why, /^Coach off: the engine's own cues/);
});

test("the voice: auto is the agent's own with the agent, Kokoro with the others; one picked by hand stays", () => {
  assert.equal(resolve(conns(), { voice: 'kokoro' }).voice, 'kokoro');           // the agent text-only, Kokoro speaks
  assert.equal(resolve(conns(), { voice: 'mac' }).voice, 'mac');
  assert.equal(resolve(conns(), { voice: 'off' }).voice, 'off');
  for (const voice of ['kokoro', 'mac', 'off']) assert.equal(resolve(conns(), { voice }).duplex, false);   // text only: no microphone
  assert.equal(resolve(conns(), { voice: 'eleven' }).voice, 'eleven');
  assert.equal(resolve(conns(), { coach: 'claude', voice: 'auto' }).voice, 'kokoro');
  assert.equal(resolve(conns(), { coach: 'claude', voice: 'mac' }).voice, 'mac');
  // the agent's voice needs the agent: with another brain, Kokoro, and the why says so
  const p = resolve(conns(), { coach: 'chatgpt', voice: 'eleven' });
  assert.equal(p.voice, 'kokoro');
  assert.match(p.why, /The agent's own voice needs the ElevenLabs coach\. Voice: Kokoro\.$/);
  assert.equal(resolve(conns(), { coach: 'off', voice: 'auto' }).voice, 'kokoro');   // the engine's cues are spoken
});

test('a brain that fails to start is skipped from then on: the next usable one in order', () => {
  const c = conns();
  const choice = { coach: 'auto', voice: 'auto', failed: {} };
  const one = fallback(c, choice, 'eleven', 'Too many concurrent conversations');
  assert.deepEqual(one.failed, { eleven: 'Too many concurrent conversations' });
  assert.deepEqual(choice.failed, {});                                            // (a new object)
  assert.deepEqual([one.plan.brain, one.plan.voice], ['claude', 'kokoro']);      // and the page's voice for it
  assert.match(one.plan.why, /^Auto: Claude Sonnet 5\.5 \(ElevenLabs failed to start: Too many concurrent conversations\)/);
  const two = fallback(c, { ...choice, failed: one.failed }, 'claude', 'its CLI exited before it connected');
  assert.equal(two.plan.brain, 'chatgpt');
  assert.deepEqual(Object.keys(two.failed), ['eleven', 'claude']);
  const three = fallback(c, { ...choice, failed: two.failed }, 'chatgpt', 'no connection 30 s after it started');
  assert.equal(three.plan.brain, 'none');
  // ... and skipped ones that fail are skipped too: the agent failing with Claude signed out goes to ChatGPT
  assert.equal(fallback(conns({ claude: CLAUDE_OUT }), choice, 'eleven', 'refused').plan.brain, 'chatgpt');
  // picked by hand: on to the next after it, not back to the agent
  const hand = fallback(c, { coach: 'claude', voice: 'auto', failed: {} }, 'claude', 'exited');
  assert.equal(hand.plan.brain, 'chatgpt');
  assert.match(hand.plan.why, /^Picked Claude, but Claude failed to start: exited: using ChatGPT/);
  assert.equal(fallback(c, { coach: 'chatgpt', voice: 'auto', failed: {} }, 'chatgpt', 'exited').plan.brain, 'none');
  // the agent picked by hand fails: Claude, with the page's voice in place of the agent's
  const agent = fallback(c, { coach: 'eleven', voice: 'eleven', failed: {} }, 'eleven', 'refused');
  assert.deepEqual([agent.plan.brain, agent.plan.voice], ['claude', 'kokoro']);
  assert.equal(fallback(c, choice, 'eleven', '').failed.eleven, 'no reason given');
});

test('the server did not say what is connected: Claude is tried (as before connections), the agent needs its id', () => {
  for (const conns of [null, undefined]) {
    const p = resolve(conns, {});
    assert.deepEqual([p.brain, p.voice], ['claude', 'kokoro']);
    assert.equal(resolve(conns, { coach: 'eleven' }).brain, 'claude');
    // ... and ChatGPT its ChatGPT sign-in (not known: it might be an API key's)
    assert.equal(resolve(conns, { coach: 'chatgpt' }).brain, 'none');
    assert.equal(fallback(conns, { coach: 'auto', voice: 'auto', failed: {} }, 'claude', 'exited').plan.brain, 'none');
  }
  const d = describe(null);
  for (const b of ORDER) assert.match(d[b].text, /not known/);
});

test("Auto agrees with the server's own pick (the `auto` field) on the rule both implement", () => {
  const cases = [
    [conns(), 'eleven'],
    [conns({ eleven: { paid: null } }), 'eleven'],
    [conns({ eleven: { paid: false, plan: 'free' } }), 'claude'],
    [conns({ eleven: NO_AGENT }), 'claude'],
    [conns({ eleven: NO_AGENT, claude: CLAUDE_OUT }), 'chatgpt'],
    [conns({ eleven: { paid: false }, claude: CLAUDE_OUT, chatgpt: GPT_OUT }), 'none'],
    [conns({ eleven: NO_AGENT, claude: CLAUDE_UNSURE, chatgpt: GPT_KEY }), 'none'],
    [conns({ eleven: NO_AGENT, claude: CLAUDE_OUT, chatgpt: GPT_UNSURE }), 'none'],
    [conns({ eleven: NO_AGENT, claude: { ...CLAUDE_OUT, ...API_OK } }), 'claude'],
    [conns({ eleven: NO_AGENT, claude: { ...CLAUDE_OUT, ...API_UNSURE } }), 'claude'],
    [conns({ eleven: NO_AGENT, claude: API_REFUSED }), 'chatgpt'],
    [conns({ eleven: NO_AGENT, claude: API_NONE }), 'chatgpt'],
    [conns({ eleven: NO_AGENT, claude: CLI_KEY_REFUSED }), 'claude'],
    [conns({ eleven: NO_AGENT, claude: { ...CLAUDE_OUT, ...CLI_KEY_REFUSED } }), 'chatgpt'],
  ];
  for (const [c, auto] of cases) assert.equal(resolve(c, {}).brain, auto);
});

test('each connection in plain words, with the command that signs it in; nothing else from the server is shown', () => {
  const d = describe(conns());
  assert.deepEqual(d.eleven, { text: 'Rhythm coach agent, DeepSeek V4.1 Flash, Starter plan' });
  assert.deepEqual(d.claude, { text: 'signed in (Pro plan): Claude Sonnet 5.5, effort high' });
  assert.deepEqual(d.chatgpt, { text: 'signed in with ChatGPT: GPT-6 Luna' });
  assert.equal(describe(conns({ eleven: NO_AGENT })).eleven.text, 'not set up');
  assert.equal(describe(conns({ eleven: { name: null, llm: null, plan: null, paid: null } })).eleven.text, 'an agent, plan not known');
  assert.equal(describe(conns({ eleven: { name: 'Coach agent', plan: 'free', paid: false } })).eleven.text,
    'Coach agent, DeepSeek V4.1 Flash, Free plan (Auto needs a paid plan)');
  assert.equal(describe(conns({ claude: { plan: null, fast: true, model: 'claude-opus-5-5' } })).claude.text,
    'signed in: Claude Opus 5.5, effort high, fast mode');
  // signed out: the page's own command to sign in, not the server's note (and not "could not check")
  assert.deepEqual(describe(conns({ claude: CLAUDE_OUT })).claude, { text: 'not signed in; sign in with', cmd: 'claude auth login' });
  assert.deepEqual(describe(conns({ chatgpt: GPT_OUT })).chatgpt, { text: 'not signed in; sign in with', cmd: 'codex login' });
  assert.deepEqual(describe(conns({ chatgpt: GPT_KEY })).chatgpt,
    { text: 'signed in with an API key, not ChatGPT; sign in with', cmd: 'codex login' });
  assert.deepEqual(describe(conns({ claude: { loggedIn: false, error: null } })).claude, { text: 'not signed in; sign in with', cmd: 'claude auth login' });
  assert.deepEqual(describe(conns({ chatgpt: { available: false, loggedIn: false, error: 'the codex CLI was not found' } })).chatgpt,
    { text: 'the Codex CLI not found; once installed, sign in with', cmd: 'codex login' });
  assert.deepEqual(describe(conns({ claude: CLAUDE_UNSURE })).claude,
    { text: 'could not check (claude auth status --json did not answer in 5 s); sign in with', cmd: 'claude auth login' });
  assert.match(describe(conns({ claude: { loggedIn: false, error: 'claude auth status gave an answer it could not read' } })).claude.text,
    /^could not check/);
  assert.match(describe(conns({ chatgpt: GPT_UNSURE })).chatgpt.text, /^could not check \(codex could not run/);
  // fields the panel does not know (should a server ever send one) never reach the page
  const leaky = conns({ claude: { email: 'private-email-placeholder', accountId: 'acct_123' } });
  assert.doesNotMatch(JSON.stringify(describe(leaky)), /example\.com|acct_/);
  assert.doesNotMatch(JSON.stringify(resolve(leaky, {})), /example\.com|acct_/);
});

test('Claude through the API on the user\'s key, else through Claude Code on their login', () => {
  // the API: usable with the CLI signed out, and so is a key whose check got no answer (tried, as the server tries it)
  for (const api of [API_OK, API_UNSURE]) {
    const c = conns({ eleven: NO_AGENT, claude: { ...CLAUDE_OUT, ...api } });
    assert.equal(resolve(c, {}).brain, 'claude');
    assert.equal(resolve(c, { coach: 'claude' }).brain, 'claude');
  }
  assert.deepEqual(describe(conns({ claude: API_OK })).claude,
    { text: 'Claude Sonnet 5.5 through the API (your key), effort high' });
  assert.deepEqual(describe(conns({ claude: { ...CLAUDE_OUT, ...API_UNSURE } })).claude,
    { text: `Claude Sonnet 5.5 through the API (your key), effort high (could not check: ${UNANSWERED})` });
  // the API asked for, with a key refused or none: not usable, whatever the CLI says (the session would take the API)
  const refused = resolve(conns({ eleven: NO_AGENT, claude: API_REFUSED }), {});
  assert.equal(refused.brain, 'chatgpt');
  assert.match(refused.why, /Claude cannot use its API key \(the Anthropic API refused the key/);
  assert.equal(resolve(conns({ claude: API_REFUSED }), { coach: 'claude' }).brain, 'chatgpt');
  assert.equal(describe(conns({ claude: API_REFUSED })).claude.text,
    `Claude Sonnet 5.5 through the API (your key), effort high: ${REFUSED}`);
  assert.match(resolve(conns({ eleven: NO_AGENT, claude: API_NONE }), {}).why, /Claude has no API key/);
  assert.equal(describe(conns({ claude: API_NONE })).claude.text,
    'Claude Sonnet 5.5 through the API (your key), effort high: no key saved');
  // Claude Code: its sign-in, as before, in words that say so; a key the API refused is said not to be used
  const cli = { transport: 'cli', api: { configured: false, ok: null, error: null } };
  assert.equal(describe(conns({ claude: cli })).claude.text,
    'signed in (Pro plan): Claude Sonnet 5.5 through Claude Code (your Claude login), effort high');
  assert.equal(describe(conns({ claude: CLI_KEY_REFUSED })).claude.text, 'signed in (Pro plan): Claude Sonnet 5.5 '
    + `through Claude Code (your Claude login), effort high (your API key is not used (${REFUSED}))`);
  assert.deepEqual(describe(conns({ claude: { ...CLAUDE_OUT, ...CLI_KEY_REFUSED } })).claude,
    { text: `your API key is not used (${REFUSED}); not signed in; sign in with`, cmd: 'claude auth login' });
  assert.equal(resolve(conns({ eleven: NO_AGENT, claude: CLI_KEY_REFUSED }), {}).brain, 'claude');
  const signedOut = { ...CLAUDE_OUT, ...CLI_KEY_REFUSED };
  assert.equal(resolve(conns({ eleven: NO_AGENT, claude: signedOut }), {}).brain, 'chatgpt');
  // the brain's label stays the model's name
  assert.equal(resolve(conns({ eleven: NO_AGENT, claude: API_OK }), {}).label, 'Claude Sonnet 5.5, Kokoro');
  // no key reaches the page's words (the server sends none: should a field ever carry one, it is not shown)
  const leaky = conns({ claude: { ...API_OK, key: 'sk-ant-made-up', api: { ...API_OK.api, key: 'sk-ant-made-up' } } });
  assert.doesNotMatch(JSON.stringify([describe(leaky), resolve(leaky, {})]), /sk-ant/);
});

test("the server's words the page reads a CLI check by are still the server's (server/connections.py)", () => {
  const py = readFileSync(new URL('../server/connections.py', import.meta.url), 'utf8');
  // a check that failed: these mean "try it if picked by hand" (Claude) and "could not check" on the panel; the API
  // check's own failure says "did not answer" too
  for (const failed of ['did not answer in', 'could not run (', 'gave an answer it could not read',
    'the Anthropic API did not answer (']) assert.ok(py.includes(failed), failed);
  // definite answers: signed out, or Codex on an API key
  for (const said of ['not signed in: sign in with claude', 'not signed in with ChatGPT', 'signed in with an API key, not ChatGPT'])
    assert.ok(py.includes(said), said);
});

test("cues owed by session: a failover keeps the engine's cue for what went to the old one, and its ids never stand for the next's", t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cues = new SessionCues(3000), spoken = [];
  cues.use('a');
  cues.sent('a', 1, 0, () => spoken.push('a1'));
  t.mock.timers.tick(1000);
  // session a fails 1 s after its event #1 went; the page moves on to b, whose first event is #1 too
  cues.use('b');
  cues.sent('b', 1, 1000, () => spoken.push('b1'));
  t.mock.timers.tick(2000);
  assert.deepEqual(spoken, ['a1']);                                    // a's event still got the engine's cue, once
  assert.deepEqual(cues.cue('b', 1), { late: false, t0: 1000 });       // and b's reply to its own #1 is spoken, in time
  t.mock.timers.tick(5000);
  assert.deepEqual(spoken, ['a1']);                                    // (so its fallback no longer runs)
  // a cue after its fallback is late, however often it comes; one for an event not known here is spoken
  cues.sent('b', 2, 8000, () => spoken.push('b2'));
  t.mock.timers.tick(3000);
  assert.deepEqual(spoken, ['a1', 'b2']);
  for (let i = 0; i < 2; i++) assert.deepEqual(cues.cue('b', 2), { late: true, t0: null });
  assert.deepEqual(cues.cue('b', 7), { late: false, t0: null });
  assert.deepEqual(cues.cue('b', null), { late: false, t0: null });   // (a cue the coach gave unasked)
  assert.equal(cues.cue('a', 1).late, true);
  // the session read from now on: the others' late cues are forgotten (they will never come)
  cues.use('c');
  assert.equal(cues.late.size, 0);
  assert.equal(cues.waits.size, 0);
});

test('model names as people say them, and what an agent id looks like', () => {
  assert.equal(modelName('claude-sonnet-5-5'), 'Claude Sonnet 5.5');
  assert.equal(modelName('claude-haiku-5-5'), 'Claude Haiku 5.5');
  assert.equal(modelName('claude-opus-5'), 'Claude Opus 5');
  assert.equal(modelName('sonnet'), 'Claude Sonnet');
  assert.equal(modelName('deepseek-v41-flash'), 'DeepSeek V4.1 Flash');
  assert.equal(modelName('gpt-6-luna'), 'GPT-6 Luna');
  assert.equal(modelName('some-new-model'), 'some-new-model');
  assert.equal(modelName(null), null);
  assert.ok(AGENT_ID.test(AGENT));
  for (const bad of ['invalid-agent', `Agent_${AGENT.slice(6)}`, `agent_${AGENT.slice(6).toUpperCase()}`, ` ${AGENT}`,
    `${AGENT}\n`, 'agent_' + 'a'.repeat(41), `sk_${AGENT.slice(6)}`, `${AGENT}/../x`])
    assert.equal(AGENT_ID.test(bad), false, bad);
});

test('the page offers the choices resolve() knows, Auto first, and never asks the agent for another LLM', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const options = id => [...html.match(new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`))[1].matchAll(/value="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(options('coachKind'), COACHES);
  assert.deepEqual(options('voiceKind'), VOICES);
  // the agent refuses every client override but text_only: the page's agent coach is made without an llm
  const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
  const made = [...app.matchAll(/new ElevenCoach\(\{([^}]*)\}\)/g)].map(m => m[1]);
  assert.equal(made.length, 1);
  assert.doesNotMatch(made[0], /llm/);
});

test('who hears the user: the agent in duplex, else the page when Parakeet is set up, else nobody (the buttons)', () => {
  const stt = { available: true, ready: true, error: null, load_ms: 8300 };
  assert.equal(listens(resolve(conns(), {}), stt), 'agent');                              // its own voice: duplex
  assert.equal(listens(resolve(conns(), { voice: 'kokoro' }), stt), null);                // text only: no microphone
  assert.equal(listens(resolve(conns(), { coach: 'claude' }), stt), 'page');
  assert.equal(listens(resolve(conns(), { coach: 'chatgpt' }), stt), 'page');
  assert.equal(listens(resolve(conns(), { coach: 'off' }), stt), 'page');                 // the engine's own coach too
  assert.equal(listens(resolve(conns(), { coach: 'claude' }), { available: false }), null);
  assert.equal(listens(resolve(conns(), { coach: 'claude' }), null), null);               // (an older server: no /api/stt)
  assert.equal(listens(resolve(conns(), { coach: 'claude' }), { available: true, ready: false }), 'page');   // (loading)
  // in the panel's words
  assert.equal(describeStt(stt).text, 'Parakeet on this Mac: ready (loaded in 8.3 s)');
  assert.equal(describeStt({ available: true, ready: false, error: null }).text, 'Parakeet on this Mac: loading...');
  assert.match(describeStt({ available: true, ready: false, error: 'the Parakeet worker stopped' }).text, /worker stopped/);
  assert.deepEqual(describeStt({ available: false, ready: false }).cmd, 'bash tools/setup_stt.sh');
  assert.match(describeStt(null).text, /not known/);
});

test("an answer to the user's words waits longer than a cue, and has its own fallback", t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cues = new SessionCues(3000), spoken = [];
  cues.use('a');
  cues.sent('a', 1, 0, () => spoken.push('cue'));
  cues.sent('a', 2, 0, () => spoken.push('no answer'), 10000);
  t.mock.timers.tick(3000);
  assert.deepEqual(spoken, ['cue']);
  assert.deepEqual(cues.cue('a', 2), { late: false, t0: 0 });                           // its answer, 3 s on: in time
  cues.sent('a', 3, 3000, () => spoken.push('no answer'), 10000);
  t.mock.timers.tick(10000);
  assert.deepEqual(spoken, ['cue', 'no answer']);
});
