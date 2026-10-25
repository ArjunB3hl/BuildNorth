// The page's voices: Kokoro on the server names its cues (so the server cuts only this voice's older ones, and a cue cut
// that way ends quietly), and a voice that is done with releases its audio context and worker. With fakes for fetch,
// Web Audio and the worker.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
const contexts = [];
globalThis.AudioContext = class {
  currentTime = 0; baseLatency = 0; state = 'running'; destination = {}; closed = false;
  constructor() { contexts.push(this); }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  createBuffer(_, length, rate) { return { duration: length / rate, copyToChannel() {} }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
  resume() {}
  async close() { this.closed = true; }
};
const requests = [];
let answer = () => [];                     // the lines /api/tts streams for a request
globalThis.fetch = async (url) => {
  if (url.startsWith('/api/tts/status')) return Response.json({ available: true, ready: true });
  requests.push(new URL(url, 'http://localhost'));
  const lines = answer(requests.at(-1)).map(l => JSON.stringify(l) + '\n').join('');
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines)); c.close(); } }));
};
const workers = [];
globalThis.Worker = class {
  posted = []; terminated = false;
  constructor() { workers.push(this); }
  postMessage(m) {
    this.posted.push(m);
    if (m.type === 'init') setTimeout(() => this.onmessage({ data: { type: 'ready' } }));
  }
  terminate() { this.terminated = true; }
};
// the page's speech synthesis, one for every Mac voice
const synth = { pending: false, speaking: false, said: [], cancels: 0, getVoices: () => [],
  speak(u) { this.said.push(u.text); this.speaking = true; this.current = u; },
  cancel() { this.cancels += 1; this.speaking = false; const u = this.current; this.current = null; u?.onerror?.({ error: 'interrupted' }); },
};
window.speechSynthesis = globalThis.speechSynthesis = synth;
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const { KokoroVoice, KokoroWebVoice, MacVoice, createVoice } = await import('../web/js/voice.js');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r)); };
const pcm = Buffer.from(new Int16Array([0, 8000, -8000, 4000]).buffer).toString('base64');

test('Kokoro on the server: each cue names this voice and the cue, and a newer cue counts up', async () => {
  const v = await createVoice('kokoro', { voice: 'af_heart' });
  assert.ok(v instanceof KokoroVoice);
  const other = new KokoroVoice('af_heart');
  answer = () => [{ i: 0, pcm, rate: 24000, synth_ms: 5, text: 'Nice.' }];
  const heard = [];
  v.say('Nice.', { onAudible: t => heard.push(t) });
  await settle();
  v.say('Keep going.');
  other.say('Hello.');
  await settle();
  const [a, b, c] = requests.splice(0).map(u => u.searchParams);
  assert.match(a.get('page'), /^[0-9a-f]{16}$/);
  assert.equal(a.get('page'), b.get('page'));
  assert.notEqual(a.get('page'), c.get('page'));                      // another voice (another page): its own cues
  assert.deepEqual([a.get('seq'), b.get('seq')], ['1', '2']);
  assert.equal(heard.length, 1);
  v.close(); other.close();
});

test('a cue the server says was superseded ends quietly; an error is still reported', async () => {
  const v = new KokoroVoice('af_heart');
  await v.ready;
  const errors = [], heard = [];
  answer = () => [{ superseded: true }];
  v.say('Old cue.', { onAudible: t => heard.push(t), onError: m => errors.push(m) });
  await settle();
  assert.deepEqual(errors, []);
  assert.deepEqual(heard, []);
  answer = () => [{ error: 'the worker failed' }];
  v.say('Another.', { onError: m => errors.push(m) });
  await settle();
  assert.deepEqual(errors, ['the worker failed']);
  requests.length = 0;
  v.close();
});

test('a voice that is done with releases its audio and its worker, and says nothing more', async () => {
  const v = new KokoroWebVoice('af_heart');
  await v.ready;
  v.say('One.');                                                        // (its audio context starts with the first cue)
  const ctx = v.ctx;
  v.close();
  assert.equal(workers.at(-1).terminated, true);
  assert.equal(ctx.closed, true);
  assert.equal(workers.at(-1).posted.at(-1).type, 'cancel');            // the cue it was saying is dropped
  const posted = workers.at(-1).posted.length;
  v.say('Two.');
  v.unlock();
  assert.equal(workers.at(-1).posted.length, posted);
  assert.equal(v.ctx, null);

  const k = new KokoroVoice('af_heart');
  await k.ready;
  answer = () => [{ i: 0, pcm, rate: 24000, synth_ms: 5, text: 'Hi.' }];
  k.say('Hi.');
  await settle();
  const kctx = k.ctx;
  k.close();
  assert.equal(kctx.closed, true);
  k.say('Again.');
  await settle();
  assert.equal(requests.length, 1);
  requests.length = 0;
});

test("a Mac voice that is done with stops only its own cue: speech is one for the page, and another voice may be talking", () => {
  const chosen = new MacVoice(), late = new MacVoice();                 // (a late one: what an older load came back with)
  chosen.say("Let's go.");
  late.close();
  assert.equal(synth.speaking, true);                                   // the chosen voice goes on
  assert.equal(synth.cancels, 0);
  late.say('Not this.');
  assert.deepEqual(synth.said, ["Let's go."]);                          // a closed voice says nothing more
  const standIn = new MacVoice();
  standIn.say('One.');                                                  // (cuts the chosen voice's cue, as any new cue does)
  chosen.close();                                                       // its cue was cut already: nothing more to stop
  assert.equal(synth.cancels, 1);
  assert.equal(synth.speaking, true);
  standIn.close();                                                      // its own cue: stopped
  assert.equal(synth.cancels, 2);
  assert.equal(synth.speaking, false);
});

test('speaking: a cue still being made or played, until its audio has played or it is cut (barge-in)', async () => {
  const v = new KokoroVoice('af_heart');
  await v.ready;
  assert.equal(v.speaking, false);
  let release;
  const gate = new Promise(r => { release = r; });
  // the cue's stream: its first sentence, then (later) its last
  globalThis.fetch = async url => {
    if (url.startsWith('/api/tts/status')) return Response.json({ available: true, ready: true });
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ async start(c) {
      c.enqueue(enc.encode(JSON.stringify({ i: 0, pcm, rate: 4, synth_ms: 5, text: 'One.' }) + '\n'));   // (1 s at 4 Hz)
      await gate;
      c.enqueue(enc.encode(JSON.stringify({ i: 1, last: true, pcm, rate: 4, synth_ms: 5, text: 'Two.' }) + '\n'));
      c.close();
    } }));
  };
  v.say('One. Two.');
  assert.equal(v.speaking, true);                                       // being made: nothing heard yet
  await settle();
  v.ctx.currentTime = 5;                                                // its first sentence has played
  assert.equal(v.speaking, true);                                       // ... but the next is still coming
  release();
  await settle();
  assert.equal(v.speaking, true);                                       // the last sentence plays until 6 s
  v.ctx.currentTime = 7;
  assert.equal(v.speaking, false);
  v.say('Three.');
  assert.equal(v.speaking, true);
  v.cancel();
  assert.equal(v.speaking, false);
  v.close();
  // a Mac voice: while its own cue is spoken
  const mac = new MacVoice(), other = new MacVoice();
  mac.say('Hello.');
  assert.equal(mac.speaking, true);
  other.say('Another.');                                                // (cuts it: speech is one for the page)
  assert.equal(mac.speaking, false);
  assert.equal(other.speaking, true);
  other.cancel();
  assert.equal(other.speaking, false);
});
