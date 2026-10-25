// Exercise the page's real voice/session callbacks with an in-memory agent and voices. No microphone, network or credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
const section = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
const source = [
  section('async function ensureVoice()', '\n/**\n * A cue on screen'),
  section('function speak(', '\nconst ECHO_MS'),
  section('async function stopEleven()', '\n/**\n * Events still waiting'),
  section('async function startEleven()', "\n// The agent's prompt"),
].join('\n');

function page(t, { textOnly = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const voices = [], sessions = [], chat = [], elements = new Map();
  class Voice {
    kind = 'kokoro'; said = []; cancelled = 0; closed = 0;
    constructor() { voices.push(this); }
    say(text) { this.said.push(text); }
    cancel() { this.cancelled++; }
    close() { this.closed++; this.cancel(); }
  }
  class Agent {
    connected = true; waiting = []; released = []; stopped = false;
    constructor(options) { Object.assign(this, options); sessions.push(this); }
    get mic() { return this.listen ? 'on' : 'off'; }
    async start(callbacks) { this.callbacks = callbacks; }
    async stop() { this.stopped = true; this.callbacks.onDisconnect({ reason: 'user' }); }
    release(marks) { this.released.push(marks); }
    echo() {}
  }
  const S = { running: true, plan: { voice: textOnly ? 'kokoro' : 'eleven' },
    conns: { eleven: { agentId: 'agent_0123456789abcdefghijklmnopqr' } },
    elevenPending: new Map(), elevenFallback: new WeakMap(), elevenFinal: new WeakSet(),
    spoken: [], voiceOut: new Voice() };
  const noop = () => {};
  const deps = { S, ElevenCoach: Agent, MacVoice: Voice, createVoice: async () => new Voice(),
    voiceChoice: () => S.plan.voice, brain: () => 'eleven', elevenListen: () => !textOnly,
    brainLabel: () => 'Test coach', log: noop, renderMic: noop, armIdle: noop, armTalkIdle: noop,
    standIn: noop, failBrain: noop, endTalk: noop, chooseExercise: noop, answerSetEnd: noop,
    chooseMovement: noop, onItsOwn: noop, words: text => text.split(/\s+/),
    chat: (who, text) => chat.push({ who, text }),
    $: id => { if (!elements.has(id)) elements.set(id, { style: {} }); return elements.get(id); },
    FALLBACK: { praise: () => 'Keep going.' }, FALLBACK_MS: 3000, CAP_MS: 10000, CLOSE_MS: 5000,
    END_MS: 25000, IDLE_MS: 300000, ECHO_MS: 6000, ECHO_WORD_MS: 450 };
  const api = new Function(...Object.keys(deps), `${source}\nreturn { ensureVoice, speak, startEleven, stopEleven };`)(...Object.values(deps));
  t.after(() => api.stopEleven());
  const dispatch = (summary = 'Keep your knees out.') => {
    const coach = S.eleven, marks = { t0: performance.now() }, event = { summary };
    S.elevenFallback.set(event, { text: summary, at: marks.t0, ev: {} });
    coach.callbacks.onDispatch(marks, [event]);
    return marks;
  };
  return { ...api, S, voices, sessions, chat, dispatch, Voice };
}

test('the agent voice owns playback: switching to it closes both local voices without starting another', async t => {
  const p = page(t), old = p.S.voiceOut;
  p.S.voiceOld = new p.Voice();
  const standIn = p.S.voiceOld;
  await p.ensureVoice();
  assert.equal(p.S.voiceOut, null);
  assert.equal(old.closed, 1);
  assert.equal(standIn.closed, 1);
  assert.equal(p.voices.length, 2, 'no backup synthesizer starts alongside the voice agent');
});

test('a fallback cue stays visible but cannot speak over an active voice agent', async t => {
  const p = page(t);
  await p.startEleven();
  p.speak('Step back.', 'engine');
  assert.deepEqual(p.voices.flatMap(v => v.said), []);
  assert.equal(p.chat.at(-1).text, 'Step back.');
});

test('an interrupted reply cancels its fallback instead of starting a second dialogue later', async t => {
  const p = page(t, { textOnly: true });
  await p.startEleven();
  const marks = p.dispatch();
  p.S.eleven.callbacks.onDone(marks, 'cut');
  t.mock.timers.tick(3500);
  assert.deepEqual(p.chat, []);
  assert.deepEqual(p.voices[0].said, []);
});

test('stopping a session clears pending speech and ignores its delayed callbacks', async t => {
  const p = page(t, { textOnly: true });
  const coach = await p.startEleven();
  p.dispatch();
  await p.stopEleven();
  coach.callbacks.onSaid({ text: 'An old answer.', user: null });
  t.mock.timers.tick(3500);
  assert.deepEqual(p.chat, []);
  assert.deepEqual(p.voices[0].said, []);
});

test('disconnecting clears an unanswered fallback even after the agent already greeted the user', async t => {
  const p = page(t, { textOnly: true });
  const coach = await p.startEleven();
  coach.callbacks.onSaid({ text: 'Hello.', user: null });
  p.dispatch();
  coach.callbacks.onDisconnect({ reason: 'error' });
  t.mock.timers.tick(3500);
  assert.deepEqual(p.chat.map(x => x.text), ['Hello.']);
  assert.equal(p.S.elevenPending.size, 0);
});

test('a slow voice reply can still speak after its on-screen fallback, without a backup voice or duplicate turn', async t => {
  const p = page(t);
  const coach = await p.startEleven();
  const marks = p.dispatch();
  t.mock.timers.tick(3500);
  assert.deepEqual(coach.released, [], 'on-screen fallback does not silence the eventual spoken reply');
  marks.audio = performance.now();
  coach.callbacks.onReply(marks);
  coach.callbacks.onCue({ text: 'Keep your knees over your toes.', marks, user: null });
  assert.deepEqual(p.voices.flatMap(v => v.said), []);
  assert.equal(p.chat.at(-1).text, 'Keep your knees over your toes.');
});

test('a text-only agent still uses the chosen local voice and suppresses a reply after its spoken fallback', async t => {
  const p = page(t, { textOnly: true });
  const coach = await p.startEleven();
  const marks = p.dispatch();
  t.mock.timers.tick(3500);
  assert.deepEqual(p.voices[0].said, ['Keep your knees out.']);
  assert.deepEqual(coach.released, [marks]);
  coach.callbacks.onCue({ text: 'A late duplicate.', marks, user: null });
  assert.deepEqual(p.voices[0].said, ['Keep your knees out.']);
});
