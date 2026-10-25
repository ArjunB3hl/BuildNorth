// The page listens to the user itself, for Claude, ChatGPT and the engine's own coach: the microphone (echo
// cancellation, noise suppression and gain control on), a voice-activity detector that cuts what they say into
// utterances, push-to-talk for noisy rooms, and POST /api/stt, where Parakeet on this Mac writes the words down. The
// audio never leaves the machine: the coach gets the words only. (The ElevenLabs agent hears the user itself: duplex,
// web/js/eleven-coach.js.)
//
//   const l = new Listener({ onEvent: e => ..., strict: () => voice.speaking, echo: () => macVoice.speaking })
//   await l.open()           // -> l.state: 'on', 'muted' or 'refused' (l.why says why: the page keeps its taps)
//   l.muted = true           // the detector stops (the microphone stays open: push-to-talk still works)
//   l.hold(true) ... l.hold(false)   // push-to-talk: exactly one utterance, without the detector
//   l.close()
//   const { text, ms, seconds } = await transcribe(audio)   // Float32Array at 16 kHz -> the words (POST /api/stt)
//   await sttStatus()        // GET /api/stt/status: {available, ready, error, load_ms}
//
// Events (onEvent, and Detector.push): {type: 'start', t} an utterance opened (the level rose above the room's);
// {type: 'speech', t} it is speech, not a click (the page's voice is cut: barge-in); {type: 'end', audio, reason:
// 'quiet' | 'max' | 'ptt' | 'voice', t0, speechEnd, voicedMs, echo} it ended (speechEnd: when the user stopped talking;
// echo: it overlapped the Mac's voice, so it may hold that voice's words); {type: 'drop', reason} it was too short to be
// words, or the user muted it. `strict` says the page's own voice is talking: then it takes a louder sound to open an
// utterance and to count as speech (what is left of the voice after echo cancellation must not, nor a thump with it),
// and the room's level is not learnt. `echo` says that voice is the Mac's, which plays outside the page where echo
// cancellation cannot take it out: the microphone hears it as loud as the user. An utterance it opened ends at the
// first quiet moment after it stops ('voice'), so the user's answer right after the cue is an utterance of its own.
import { VOICE_INPUT, micWhy } from './eleven-coach.js';

/** The detector's settings: 20 ms frames at 16 kHz. */
export const VAD = {
  rate: 16000,
  frameMs: 20,
  preRollMs: 300,      // kept from before the level rose: the first syllable starts quieter than the threshold
  endMs: 700,          // this long below the threshold ends an utterance (a pause between words is shorter)
  maxMs: 15000,        // the longest utterance (the server takes 30 s)
  tailMs: 200,         // ... of the quiet at its end kept (Parakeet needs no more)
  minSpeechMs: 150,    // less speech than this is a click or a knock, not words ("no" is about 200 ms)
  confirmMs: 250,      // this much speech before it counts as the user talking (barge-in)
  startDb: 10,         // above the room's level to open an utterance
  stopDb: 5,           // ... and to keep it open (hysteresis: words trail off quieter than they start)
  minDb: -52,          // never open below this, however quiet the room (a digitally silent input)
  bargeDb: 10,         // more, while the page's own voice is talking (to open one, and for its frames to count as speech)
  echoTailMs: 150,     // an utterance opened this soon after the Mac's voice stopped may still hold the end of it
  startFrames: 3,      // frames in a row above the threshold to open one (60 ms)
  floorMs: 2000,       // the room's level: the quietest frame of the last 2 s, followed quickly down, slowly up
};

const FLOOR_DB = -90;          // the quietest room level taken (a digitally silent input reads -120 dB)

/** A frame's level in dB (RMS against full scale). */
export function level(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return 10 * Math.log10(sum / Math.max(1, frame.length) + 1e-12);
}

const concat = frames => {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) { out.set(f, at); at += f.length; }
  return out;
};

/**
 * The voice-activity detector, as a pure function over frames (the tests feed it made-up ones): an energy threshold
 * over the room's own level (an adaptive noise floor) with hysteresis, a pre-roll, an end after a quiet spell, and a
 * longest utterance. It also takes push-to-talk (`held`: the frames from the press to the release are one utterance,
 * whatever their level) and the mute (`muted`: no utterance is opened, only the pre-roll is kept, for a push-to-talk).
 */
export class Detector {
  constructor(opts = {}) {
    this.o = { ...VAD, ...opts };
    this.pre = [];          // the last preRollMs of frames
    this.levels = [];       // the last floorMs of levels (not while the page's voice talks)
    this.floor = null;      // the room's level, dB
    this.above = 0;         // frames in a row above the threshold to open
    // the utterance open: {frames, t0, voicedMs, loudMs (as loud as an opening: speech), quietMs, lastVoiced, confirmed,
    // ptt, echo (it overlapped the Mac's voice), echoOpen (that voice opened it)}
    this.utt = null;
    this.pttDone = false;   // a push-to-talk that reached the longest: the rest of the hold is not another one
    this.echoT = null;      // the last frame the Mac's voice was heard in
  }

  get open() { return !!this.utt; }

  /** One frame (o.frameMs of samples at o.rate) at time t (ms, its end). Returns the events it caused. */
  push(frame, t, { strict = false, echo = false, held = false, muted = false } = {}) {
    const o = this.o, db = level(frame), out = [];
    if (!strict) this.learn(db);
    if (echo) this.echoT = t;
    const nearEcho = echo || (this.echoT != null && t - this.echoT <= o.echoTailMs);
    // (none learnt yet, the page's voice talking from the first frame: the quietest room, so a loud voice still opens)
    const floor = this.floor ?? FLOOR_DB;
    // push-to-talk: from the press (with the pre-roll, or what was already open) to the release, one utterance
    if (held) {
      if (this.pttDone) return out;
      if (!this.utt?.ptt) {
        const frames = this.utt ? this.utt.frames : this.pre;
        this.utt = { frames: [...frames], t0: t - frames.length * o.frameMs, voicedMs: 0, loudMs: 0, quietMs: 0,
          lastVoiced: t, confirmed: true, ptt: true, echo: nearEcho || !!this.utt?.echo, echoOpen: false };
        this.pre = [];
        out.push({ type: 'start', t }, { type: 'speech', t });   // (pressed to talk: the page's voice gives way)
      }
      this.utt.frames.push(frame);
      this.utt.voicedMs += o.frameMs;
      this.utt.lastVoiced = t;
      if (echo) this.utt.echo = true;
      if (this.utt.frames.length * o.frameMs >= o.maxMs) { out.push(this.end('max', t)); this.pttDone = true; }
      return out;
    }
    this.pttDone = false;
    if (this.utt?.ptt) { out.push(this.end('ptt', t)); }        // released
    if (muted) {
      // muted while an utterance was open: the words the user cut off are not sent, now nor once they unmute
      if (this.utt) { this.utt = null; out.push({ type: 'drop', reason: 'muted', t }); }
      this.keep(frame); this.above = 0;
      return out;
    }
    const boost = strict ? o.bargeDb : 0;
    if (!this.utt) {
      const start = Math.max(floor + o.startDb, o.minDb) + boost;
      this.above = db > start ? this.above + 1 : 0;
      this.keep(frame);
      if (this.above >= o.startFrames) {
        this.utt = { frames: this.pre, t0: t - this.pre.length * o.frameMs, voicedMs: this.above * o.frameMs,
          loudMs: this.above * o.frameMs, quietMs: 0, lastVoiced: t, confirmed: false, ptt: false, echo: nearEcho,
          echoOpen: echo };
        this.pre = []; this.above = 0;
        out.push({ type: 'start', t });
      }
      return out;
    }
    const u = this.utt;
    u.frames.push(frame);
    if (echo) u.echo = true;
    // while the page's voice talks, only a sound as loud as one that opens an utterance is the user talking (so a thump,
    // a jump landing or a dumbbell set down, over what is left of the voice is not taken for the user cutting it off)
    const keep = Math.max(floor + o.stopDb, o.minDb - o.stopDb) + boost;
    const loud = strict ? Math.max(floor + o.startDb, o.minDb) + boost : keep;
    const voiced = db > keep;
    if (voiced) { u.voicedMs += o.frameMs; u.quietMs = 0; u.lastVoiced = t; } else u.quietMs += o.frameMs;
    if (db > loud) u.loudMs += o.frameMs;
    if (!u.confirmed && u.loudMs >= o.confirmMs) { u.confirmed = true; out.push({ type: 'speech', t }); }
    // the Mac's voice opened it and has stopped (and what trails after it, echoTailMs): it ends at the first quiet moment,
    // so that the user's answer right after the cue is not joined to the cue heard back (which the page then takes out)
    if (u.echoOpen && !nearEcho && !voiced) out.push(this.end('voice', t));
    else if (u.quietMs >= o.endMs) out.push(this.end('quiet', t));
    else if (u.frames.length * o.frameMs >= o.maxMs) out.push(this.end('max', t));
    return out;
  }

  /** The room's level: the quietest of the last floorMs, which it follows at once going down and slowly going up (a
   * level that stays up for seconds is the room, a fan say, not someone talking: their words have gaps). */
  learn(db) {
    const o = this.o;
    this.levels.push(db);
    while (this.levels.length * o.frameMs > o.floorMs) this.levels.shift();
    const quietest = Math.max(FLOOR_DB, Math.min(...this.levels));
    this.floor = this.floor == null || quietest < this.floor ? quietest : this.floor + (quietest - this.floor) * 0.05;
  }

  keep(frame) {
    this.pre.push(frame);
    while (this.pre.length * this.o.frameMs > this.o.preRollMs) this.pre.shift();
  }

  /** The utterance open ends: its audio (without most of the quiet at its end), or a drop if it held too little speech. */
  end(reason, t) {
    const o = this.o, u = this.utt;
    this.utt = null;
    if (u.voicedMs < o.minSpeechMs) return { type: 'drop', reason: u.ptt ? 'too short a press' : 'too short', t };
    const quiet = reason === 'quiet' ? Math.max(0, Math.round((u.quietMs - o.tailMs) / o.frameMs)) : 0;
    return { type: 'end', reason, t, t0: u.t0, audio: concat(u.frames.slice(0, u.frames.length - quiet)),
      speechEnd: u.ptt ? t : u.lastVoiced, voicedMs: u.voicedMs, echo: !!u.echo };
  }
}

/** Samples at one rate to another (an average over each output sample's span: enough for speech at 16 kHz), across
 * calls. Used when the browser will not run the audio at 16 kHz itself. */
export function resampler(from, to) {
  const step = from / to;
  let acc = 0, n = 0, pos = 0;
  return input => {
    const out = [];
    for (let i = 0; i < input.length; i++) {
      acc += input[i]; n += 1; pos += 1;
      if (pos >= step) { out.push(acc / n); acc = 0; n = 0; pos -= step; }
    }
    return Float32Array.from(out);
  };
}

/** Float samples (-1..1) to PCM16 little-endian, as POST /api/stt takes them. */
export function toPcm16(samples) {
  const buf = new ArrayBuffer(samples.length * 2), view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}

/** The words in an utterance (16 kHz), from Parakeet on the server. Throws with the server's reason (503: not set up
 * or not ready: `e.status`). */
export async function transcribe(audio, { signal } = {}) {
  const r = await fetch('/api/stt', { method: 'POST', headers: { 'content-type': 'application/octet-stream' },
    body: toPcm16(audio), signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j;
}

/** Whether the server can transcribe: {available, ready, error, load_ms}; null if it did not say (an older server). */
export async function sttStatus() {
  try {
    const r = await fetch('/api/stt/status', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// The audio thread's part: blocks of samples, about 20 ms at a time, to the page.
const TAP = `class PoseCoachTap extends AudioWorkletProcessor {
  constructor(o) { super(); this.size = o.processorOptions.size; this.buf = new Float32Array(this.size); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) { this.port.postMessage(this.buf); this.buf = new Float32Array(this.size); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pose-coach-tap', PoseCoachTap);`;

/**
 * The microphone through the detector. The real getUserMedia is used (the ElevenLabs client's start patches it for
 * the agent's own microphone, and a listener opened meanwhile must not get its silent stand-in).
 */
export class Listener {
  state = 'off';           // 'connecting', 'on', 'muted', 'refused'
  why = null;              // why it is refused
  heldDown = false;
  #muted = false;

  constructor({ onEvent = () => {}, strict = () => false, echo = () => false, muted = false, detector = {} } = {}) {
    this.onEvent = onEvent;
    this.strict = strict;
    this.echo = echo;
    this.#muted = !!muted;
    this.detector = new Detector(detector);
  }

  get muted() { return this.#muted; }
  set muted(m) {
    this.#muted = !!m;
    if (this.state === 'on' || this.state === 'muted') this.state = this.#muted ? 'muted' : 'on';
  }

  /** Push-to-talk: pressed (true) or released (false). */
  hold(down) { this.heldDown = !!down; }

  async open() {
    if (this.state !== 'off') return this.opening ?? this.state;
    this.state = 'connecting';
    this.opening = (async () => {
      const md = navigator.mediaDevices;
      const gum = globalThis.MediaDevices?.prototype?.getUserMedia ?? md?.getUserMedia;
      let stream;
      try {
        if (!gum) throw Object.assign(new Error('this browser has no microphone access'), { name: 'NotSupportedError' });
        stream = await gum.call(md, { audio: { ...VOICE_INPUT, channelCount: 1 }, video: false });
      } catch (e) {
        if (this.state === 'off') return 'off';            // (closed meanwhile)
        this.state = 'refused'; this.why = micWhy(e);
        return this.state;
      }
      if (this.state === 'off') { stream.getTracks().forEach(tr => tr.stop()); return 'off'; }
      this.stream = stream;
      try { await this.wire(stream); } catch (e) {
        this.close();
        this.state = 'refused'; this.why = `the microphone could not be read (${e.message})`;
        return this.state;
      }
      if (this.state === 'off') return 'off';
      this.state = this.#muted ? 'muted' : 'on';
      return this.state;
    })();
    try { return await this.opening; } finally { this.opening = null; }
  }

  /** The stream at 16 kHz, in frames, into the detector. The browser resamples when it can run the audio at 16 kHz;
   * otherwise (a browser that will not mix rates) it is resampled here. */
  async wire(stream) {
    let ctx = new AudioContext({ sampleRate: VAD.rate, latencyHint: 'interactive' });
    let source;
    try { source = ctx.createMediaStreamSource(stream); } catch {
      ctx.close().catch(() => {});
      ctx = new AudioContext({ latencyHint: 'interactive' });
      source = ctx.createMediaStreamSource(stream);
    }
    this.ctx = ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const size = Math.round(ctx.sampleRate * VAD.frameMs / 1000);
    const node = new AudioWorkletNode(ctx, 'pose-coach-tap', { numberOfOutputs: 1, processorOptions: { size } });
    const sink = ctx.createGain();
    sink.gain.value = 0;                                  // (pulled by the graph, never heard)
    source.connect(node); node.connect(sink); sink.connect(ctx.destination);
    this.node = node; this.source = source; this.sink = sink;
    const resample = ctx.sampleRate === VAD.rate ? null : resampler(ctx.sampleRate, VAD.rate);
    const frameLen = VAD.rate * VAD.frameMs / 1000;
    let pending = new Float32Array(0);
    node.port.onmessage = ({ data }) => {
      const now = performance.now();
      const fresh = resample ? resample(data) : data;
      const all = new Float32Array(pending.length + fresh.length);
      all.set(pending); all.set(fresh, pending.length);
      let at = 0;
      for (; at + frameLen <= all.length; at += frameLen) {
        const t = now - ((all.length - at - frameLen) / VAD.rate) * 1000;
        const echo = !!this.echo();
        const events = this.detector.push(all.slice(at, at + frameLen), t,
          { strict: echo || !!this.strict(), echo, held: this.heldDown, muted: this.#muted });
        for (const e of events) this.onEvent(e);
      }
      pending = all.slice(at);
    };
  }

  close() {
    this.state = 'off';
    this.heldDown = false;
    if (this.node) this.node.port.onmessage = null;
    try { this.source?.disconnect(); this.node?.disconnect(); this.sink?.disconnect(); } catch { /* */ }
    this.ctx?.close().catch(() => {});
    this.stream?.getTracks().forEach(tr => tr.stop());
    this.ctx = this.stream = this.node = this.source = this.sink = null;
    this.detector = new Detector(this.detector.o);
  }
}
