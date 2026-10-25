// The page's own listening: the voice-activity detector as a pure function over made-up frames (silence, a room's
// noise, "speech": a tone whose level comes and goes like syllables), with push-to-talk and the mute in the same frame
// loop; and what goes to POST /api/stt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Detector, VAD, level, resampler, toPcm16, transcribe } from '../web/js/listen.js';

const N = VAD.rate * VAD.frameMs / 1000;          // samples in a frame
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
/** A frame at about `db` dB: noise, or a 200 Hz tone (`tone`) for speech. */
function frame(db, tone = false, k = 0) {
  const a = 10 ** (db / 20) * Math.SQRT2, f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = tone ? a * Math.sin(2 * Math.PI * 200 * (k * N + i) / VAD.rate) : (a / Math.SQRT2) * rand() * Math.sqrt(3);
  return f;
}
const silence = () => new Float32Array(N);
/** Feeds `ms` of frames from `make(k)` at a time from `t`; returns the events with the time they came. */
function feed(d, ms, make, state, opts = {}) {
  const out = [];
  for (let k = 0; k < ms / VAD.frameMs; k++) {
    state.t += VAD.frameMs;
    for (const e of d.push(make(k), state.t, typeof opts === 'function' ? opts(state.t) : opts)) out.push(e);
  }
  return out;
}
// speech: syllables of 160 ms at -20 dB with 40 ms dips to -38 dB (a pause inside a word is not its end)
const speech = k => ((k % 10) < 8 ? frame(-20, true, k) : frame(-38, true, k));
const types = evs => evs.map(e => e.type);

test('levels: a frame of a known level reads as it', () => {
  assert.ok(Math.abs(level(frame(-30)) + 30) < 0.5);
  assert.ok(Math.abs(level(frame(-20, true)) + 20) < 0.5);
  assert.ok(level(silence()) < -100);
});

test('an utterance: opened when the level rises, kept with its pre-roll, ended after 700 ms of quiet', () => {
  const d = new Detector(), s = { t: 0 };
  assert.deepEqual(feed(d, 1000, () => frame(-60), s), []);            // a quiet room: nothing
  const t0 = s.t;
  const during = feed(d, 1200, speech, s);
  assert.deepEqual(types(during), ['start', 'speech']);
  assert.equal(during[0].t, t0 + 3 * VAD.frameMs);                      // after 3 frames above the threshold
  // 250 ms of speech (the 3 frames that opened it count): the user is talking
  assert.equal(during[1].t, during[0].t + Math.ceil((VAD.confirmMs - 3 * VAD.frameMs) / VAD.frameMs) * VAD.frameMs);
  const spoke = s.t;
  const after = feed(d, 1000, () => frame(-60), s);
  assert.deepEqual(types(after), ['end']);
  const e = after[0];
  assert.equal(e.reason, 'quiet');
  assert.equal(e.t, spoke + VAD.endMs);                                 // 700 ms of quiet
  assert.equal(e.speechEnd, spoke);                                     // when the user stopped talking
  // its audio: the pre-roll (300 ms before the level rose), the speech, and 200 ms of the quiet after it
  assert.equal(e.t0, t0 + 3 * VAD.frameMs - VAD.preRollMs);
  assert.equal(e.audio.length, ((VAD.preRollMs - 3 * VAD.frameMs) + 1200 + VAD.tailMs) / 1000 * VAD.rate);
  assert.ok(e.voicedMs >= 1000);
});

test('a pause shorter than 700 ms keeps the utterance; words that trail off stay in it (hysteresis)', () => {
  const d = new Detector(), s = { t: 0 };
  feed(d, 1000, () => frame(-60), s);
  const evs = [...feed(d, 600, speech, s), ...feed(d, 600, () => frame(-60), s), ...feed(d, 600, speech, s),
    // trailing off: below the opening threshold (floor + 10 dB) but above the one that keeps it (floor + 5)
    ...feed(d, 600, () => frame(-53), s), ...feed(d, 1000, () => frame(-60), s)];
  assert.deepEqual(types(evs), ['start', 'speech', 'end']);
  assert.ok(evs[2].audio.length / VAD.rate > 2.4);
  // the same level never opens one from the quiet
  const q = new Detector(), sq = { t: 0 };
  feed(q, 1000, () => frame(-60), sq);
  assert.deepEqual(feed(q, 2000, () => frame(-53), sq), []);
});

test('the room\'s level is learnt: a fan coming on opens at most one utterance, and speech over it is heard', () => {
  const d = new Detector(), s = { t: 0 };
  feed(d, 1000, () => frame(-65), s);
  const fan = feed(d, 6000, () => frame(-42), s);                        // steady noise, 23 dB louder
  assert.ok(fan.filter(e => e.type === 'start').length <= 1, JSON.stringify(types(fan)));
  assert.equal(d.open, false);                                          // ... and it has ended: the fan is the room now
  assert.ok(d.floor > -45 && d.floor < -40);
  const over = feed(d, 800, k => frame(-20, true, k), s);
  assert.deepEqual(types(over), ['start', 'speech']);
  assert.deepEqual(types(feed(d, 1000, () => frame(-42), s)), ['end']);
  // a digitally silent input: the floor stops at -90 dB, and only a sound above -52 dB opens one
  const z = new Detector(), sz = { t: 0 };
  assert.deepEqual(feed(z, 1000, silence, sz), []);
  assert.deepEqual(feed(z, 500, () => frame(-58), sz), []);
  assert.deepEqual(types(feed(z, 500, () => frame(-45), sz)), ['start', 'speech']);
});

test('15 s at most; a knock is dropped; a click opens nothing', () => {
  const d = new Detector(), s = { t: 0 };
  feed(d, 1000, () => frame(-60), s);
  const long = feed(d, 20000, speech, s);
  const ended = long.filter(e => e.type === 'end');
  assert.equal(ended[0].reason, 'max');
  assert.ok(Math.abs(ended[0].audio.length / VAD.rate - VAD.maxMs / 1000) < 0.05);
  assert.equal(types(long).filter(x => x === 'start').length, 2);          // talking on: the next one opens
  feed(d, 1000, () => frame(-60), s);
  const knock = feed(d, 100, () => frame(-15), s).concat(feed(d, 1000, () => frame(-60), s));
  assert.deepEqual(types(knock), ['start', 'drop']);
  const click = feed(d, 40, () => frame(-10), s).concat(feed(d, 1000, () => frame(-60), s));
  assert.deepEqual(click, []);
});

test("while the page's voice talks it takes a louder sound to open one, and the room is not learnt from it", () => {
  const d = new Detector(), s = { t: 0 };
  feed(d, 1000, () => frame(-60), s);
  // what is left of the page's voice after echo cancellation, 15 dB over the room: not the user
  assert.deepEqual(feed(d, 3000, k => frame(-45, true, k), s, { strict: true }), []);
  assert.ok(d.floor < -55);
  // the user talking over it, louder: barge-in
  assert.deepEqual(types(feed(d, 600, speech, s, { strict: true })), ['start', 'speech']);
  // the page's voice talking from the very first frame (the question at Start): no room level learnt yet, and the user
  // is still heard (live: a digitally silent fake microphone, and the question spoken over its first seconds)
  const f = new Detector(), sf = { t: 0 };
  assert.deepEqual(feed(f, 1000, silence, sf, { strict: true }), []);
  assert.deepEqual(types(feed(f, 600, speech, sf, { strict: true })), ['start', 'speech']);
});

test("over the page's voice a thump is not the user: only speech as loud as an opening cuts the cue (barge-in)", () => {
  // the room at -60 dB; what is left of Kokoro after echo cancellation at -48 (12 dB over the room: below the strict
  // threshold to open, above the usual one to keep an utterance open); one 60 ms thump at -20 (a jump landing)
  const d = new Detector(), s = { t: 0 };
  feed(d, 2000, () => frame(-60), s);
  const evs = [...feed(d, 1000, k => frame(-48, true, k), s, { strict: true }),
    ...feed(d, 60, () => frame(-20), s, { strict: true }),
    ...feed(d, 2000, k => frame(-48, true, k), s, { strict: true }),
    ...feed(d, 1000, () => frame(-60), s)];
  assert.deepEqual(types(evs), ['start', 'drop']);                      // opened, never speech, dropped: the cue plays on
  // the user talking over it is still heard as speech, and cuts it
  const u = feed(d, 600, speech, s, { strict: true });
  assert.deepEqual(types(u), ['start', 'speech']);
  assert.ok(u[1].t - u[0].t <= 300, `${u[1].t - u[0].t} ms`);
});

test('muting while an utterance is open drops it: the words cut off are not sent once the user unmutes', () => {
  const d = new Detector(), s = { t: 0 };
  feed(d, 1000, () => frame(-60), s);
  assert.deepEqual(types(feed(d, 500, speech, s)), ['start', 'speech']);
  const muted = feed(d, 10000, () => frame(-60), s, { muted: true });
  assert.deepEqual(muted.map(e => e.reason ?? e.type), ['muted']);
  assert.equal(muted[0].type, 'drop');
  assert.equal(d.open, false);
  assert.deepEqual(feed(d, 2000, () => frame(-60), s), []);              // unmuted: nothing of before comes
  // (a push-to-talk utterance is not the detector's: the mute leaves it alone)
  const p = feed(d, 400, speech, s, { muted: true, held: true }).concat(feed(d, 20, () => frame(-60), s, { muted: true }));
  assert.deepEqual(types(p), ['start', 'speech', 'end']);
});

test("the Mac's voice (no echo cancellation): its utterance ends when it stops, the answer after it is the user's own", () => {
  // the room at -60; the Mac's voice heard at -25 for 3 s, a 300 ms gap, "yes" at -30, quiet
  const d = new Detector(), s = { t: 0 };
  feed(d, 2000, () => frame(-60), s);
  const mac = { strict: true, echo: true };
  const cue = feed(d, 3000, k => frame(-25, true, k), s, mac);
  assert.deepEqual(types(cue), ['start', 'speech']);
  const stopped = s.t;
  const gap = feed(d, 300, () => frame(-60), s);
  // at the first quiet frame after it stopped, and what may trail after it (echoTailMs)
  assert.deepEqual(gap.map(e => e.reason ?? e.type), ['voice']);
  assert.equal(gap[0].t, stopped + (Math.floor(VAD.echoTailMs / VAD.frameMs) + 1) * VAD.frameMs);
  assert.equal(gap[0].echo, true);                                      // (the page takes the cue's words out)
  assert.ok(gap[0].audio.length / VAD.rate > 3);
  const yes = [...feed(d, 300, k => frame(-30, true, k), s), ...feed(d, 1000, () => frame(-60), s)];
  assert.deepEqual(types(yes), ['start', 'speech', 'end']);
  assert.equal(yes[2].echo, false);                                     // opened after the voice: all the user's
  assert.ok(yes[2].audio.length / VAD.rate < 1);
  // an answer said over the cue's end is not cut in the middle: the utterance ends at its own quiet, with the echo flag
  const o = new Detector(), so = { t: 0 };
  feed(o, 2000, () => frame(-60), so);
  feed(o, 2000, k => frame(-25, true, k), so, mac);
  const over = [...feed(o, 600, k => frame(-30, true, k), so), ...feed(o, 1000, () => frame(-60), so)];
  assert.deepEqual(over.map(e => e.reason ?? e.type), ['voice']);
  assert.ok(over[0].audio.length / VAD.rate > 2.5 && over[0].echo);
  // the user talking first, and the Mac's voice starting meanwhile: flagged, not cut when it stops
  const u = new Detector(), su = { t: 0 };
  feed(u, 2000, () => frame(-60), su);
  const both = [...feed(u, 500, speech, su), ...feed(u, 500, speech, su, mac), ...feed(u, 300, speech, su),
    ...feed(u, 1000, () => frame(-60), su)];
  assert.deepEqual(both.map(e => e.reason ?? e.type), ['start', 'speech', 'quiet']);
  assert.equal(both[2].echo, true);
  // with Kokoro (echo-cancelled: strict only) nothing is flagged
  const k = new Detector(), sk = { t: 0 };
  feed(k, 2000, () => frame(-60), sk);
  const kk = [...feed(k, 600, speech, sk, { strict: true }), ...feed(k, 1000, () => frame(-60), sk)];
  assert.equal(kk.at(-1).echo, false);
});

test('push-to-talk: from the press to the release one utterance, whatever its level, with the pre-roll', () => {
  const d = new Detector(), s = { t: 0 };
  feed(d, 1000, () => frame(-60), s);
  const press = s.t;
  const held = feed(d, 1500, k => (k < 20 ? frame(-60) : frame(-48)), s, { held: true });   // quiet, then soft words
  assert.deepEqual(types(held), ['start', 'speech']);                     // (the page's voice gives way at the press)
  const rel = feed(d, 20, () => frame(-60), s);
  assert.equal(rel[0].type, 'end');
  assert.equal(rel[0].reason, 'ptt');
  assert.equal(rel[0].speechEnd, press + 1500 + VAD.frameMs);
  assert.ok(Math.abs(rel[0].audio.length / VAD.rate - (1.5 + VAD.preRollMs / 1000)) < 0.03);
  // a press too short to hold words; a hold past 15 s is one utterance, and the rest of the hold none
  assert.equal(feed(d, 60, () => frame(-60), s, { held: true }).concat(feed(d, 20, () => frame(-60), s)).at(-1).type, 'drop');
  const long = feed(d, 18000, () => frame(-30), s, { held: true });
  assert.deepEqual(long.map(e => e.reason ?? e.type), ['start', 'speech', 'max']);
  assert.deepEqual(feed(d, 20, () => frame(-60), s), []);
  // muted: the detector opens nothing, but a push-to-talk still works (with the pre-roll kept meanwhile)
  assert.deepEqual(feed(d, 2000, speech, s, { muted: true }), []);
  feed(d, 300, k => frame(-30, true, k), s, { muted: true });
  const m = feed(d, 400, speech, s, { muted: true, held: true }).concat(feed(d, 20, () => frame(-60), s, { muted: true }));
  assert.deepEqual(types(m), ['start', 'speech', 'end']);
  assert.ok(Math.abs(m[2].audio.length / VAD.rate - 0.7) < 0.03);
  // a press while an utterance is open takes it over: one utterance, ended at the release
  const d2 = new Detector(), s2 = { t: 0 };
  feed(d2, 1000, () => frame(-60), s2);
  const both = feed(d2, 500, speech, s2).concat(feed(d2, 500, speech, s2, { held: true }), feed(d2, 20, () => frame(-60), s2));
  assert.deepEqual(types(both), ['start', 'speech', 'start', 'speech', 'end']);
  assert.ok(both[4].audio.length / VAD.rate > 1.2);
});

test('to 16 kHz and PCM16, as POST /api/stt takes it', async () => {
  const r = resampler(48000, 16000);
  const out = [...r(new Float32Array(4800).fill(0.5)), ...r(new Float32Array(4800).fill(0.5))];
  assert.equal(out.length, 3200);
  assert.ok(out.every(x => Math.abs(x - 0.5) < 1e-6));
  assert.ok(Math.abs(resampler(44100, 16000)(new Float32Array(44100)).length - 16000) <= 1);
  const pcm = new DataView(toPcm16(Float32Array.from([0, 1, -1, 0.5, 2])));
  assert.deepEqual([0, 1, 2, 3, 4].map(i => pcm.getInt16(i * 2, true)), [0, 32767, -32768, 16383, 32767]);
  // the request: raw bytes, the server's reason when it refuses (503: not set up or not ready)
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return sent.length === 1 ? Response.json({ text: 'Now lunges.', ms: 80, seconds: 1.2 })
      : Response.json({ error: 'Parakeet is loading' }, { status: 503 });
  };
  assert.deepEqual(await transcribe(new Float32Array(16000)), { text: 'Now lunges.', ms: 80, seconds: 1.2 });
  assert.equal(sent[0].url, '/api/stt');
  assert.equal(sent[0].init.headers['content-type'], 'application/octet-stream');
  assert.equal(sent[0].init.body.byteLength, 32000);
  await assert.rejects(transcribe(new Float32Array(160)), e => e.status === 503 && /loading/.test(e.message));
});
