// The coach's voice: Kokoro-82M made on this Mac's GPU by the dev server (MLX, server/tts.py), or the Mac's own speech
// (speechSynthesis). Kokoro in the browser (WebGPU, web/js/kokoro-worker.js) is a fallback when the server's voice is not
// set up: about 3x slower to the first sentence on an M3. Every voice speaks one cue at a time and never falls behind
// (a new cue cuts the one still playing), and reports when each cue became audible on the page's clock.
//
//   const v = await createVoice('kokoro', { voice: 'af_heart' })   // or 'mac'; falls back to kokoro-web, then mac
//   v.unlock()                    // in a click handler: browsers start audio only after the user did something
//   v.say(text, { onAudible: t => ..., onChunk: info => ..., onError: message => ... })
//   v.speaking                    // a cue is still being made or played (the user talking over it cuts it: barge-in)
//   v.cancel()
//   v.close()                     // done with it: its audio context and worker are released (a replaced voice)

/** speechSynthesis is one for the whole page: the utterance a Mac voice gave it last, until it has ended. */
let current = null;

/** The Mac's voice: a US/UK English system voice (Samantha, Daniel or a Premium one), slightly fast. */
export class MacVoice {
  kind = 'mac';
  volume = 1;
  utterance = null;    // this voice's last cue
  unlock() {}
  say(text, marks = {}) {
    if (this.closed || !('speechSynthesis' in window)) return;
    if (speechSynthesis.pending || speechSynthesis.speaking) speechSynthesis.cancel();   // never more than one cue behind
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /Samantha|Daniel|Google|Natural|Premium|Enhanced/i.test(v.name))
      || voices.find(v => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.volume = this.volume;
    u.onstart = () => marks.onAudible?.(performance.now());
    u.onend = u.onerror = () => { if (current === u) current = null; };
    this.utterance = current = u;
    speechSynthesis.speak(u);
  }
  /** This voice's own cue is being spoken (not another Mac voice's: speechSynthesis is one for the page). */
  get speaking() {
    return !!this.utterance && current === this.utterance && 'speechSynthesis' in window && speechSynthesis.speaking;
  }
  /** Only this voice's own cue: another Mac voice (a stand-in, or one that arrived late) may be the one talking. */
  cancel() {
    if (current && current === this.utterance && 'speechSynthesis' in window) speechSynthesis.cancel();
  }
  close() { this.cancel(); this.closed = true; }
}

/** Leading samples quieter than this are silence: trimmed, so a cue starts at its first sound. */
const SILENT = 0.01;

/** A voice whose sentences arrive as audio samples and play back to back through Web Audio. */
class SampledVoice {
  cue = null;          // {id, marks, sources, next: when the next sentence starts, audible: reported, finished: its
                       // last sentence has come (or none will)}
  ctx = null;
  seq = 0;
  volume = 1;

  unlock() {
    if (this.closed) return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    this.out.gain.value = this.volume;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  begin(marks) {
    this.cancel();
    this.unlock();
    this.cue = { id: ++this.seq, marks, sources: [], next: 0, audible: false };
    return this.cue;
  }

  /** The cue is still being made, or its audio is still playing. */
  get speaking() {
    const c = this.cue;
    return !!c && !!this.ctx && (!c.finished || this.ctx.currentTime < c.next);
  }

  cancel() {
    if (!this.cue) return;
    for (const s of this.cue.sources) { try { s.stop(); } catch { /* not started */ } }
    this.cue = null;
  }

  /** An AudioContext runs until it is closed: a voice no longer used closes its own. */
  close() {
    this.cancel();
    this.closed = true;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** One sentence of the current cue: schedule it after the one before, and report when the cue became audible. */
  play(cue, { samples, rate, i, synthMs, text }) {
    if (cue !== this.cue) return;                                   // a sentence of a cue already cut
    const tChunk = performance.now();
    let start = 0;
    if (i === 0) while (start < samples.length && Math.abs(samples[start]) < SILENT) start++;
    const body = samples.subarray(start);
    if (!body.length) return;
    const buf = this.ctx.createBuffer(1, body.length, rate);
    buf.copyToChannel(body, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out);
    const when = Math.max(this.ctx.currentTime, cue.next);
    src.start(when);
    cue.next = when + buf.duration;
    cue.sources.push(src);
    cue.marks.onChunk?.({ i, synthMs, audioMs: Math.round(buf.duration * 1000), at: tChunk, text });
    if (cue.audible) return;
    cue.audible = true;
    // when the first sample leaves the speakers, on the page's clock: the output timestamp says which audio time is
    // being heard at which page time (output latency included); without it, the context's own latency estimates
    const ts = this.ctx.getOutputTimestamp?.();
    cue.marks.onAudible?.(ts && ts.performanceTime ? ts.performanceTime + (when - ts.contextTime) * 1000
      : tChunk + ((when - this.ctx.currentTime) + this.ctx.baseLatency + (this.ctx.outputLatency || 0)) * 1000);
  }
}

/** PCM16 little-endian, base64, as the server sends it, to Web Audio samples. */
export function pcm16ToFloat(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ints = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
  const out = new Float32Array(ints.length);
  for (let k = 0; k < ints.length; k++) out[k] = ints[k] / 32768;
  return out;
}

/**
 * Kokoro-82M made by the dev server on the Mac's GPU (MLX), streamed one sentence at a time (GET /api/tts). Each request
 * names this voice (`page`, random) and its cue (`seq`): the server cuts only this voice's older cues, and answers a cue
 * that a newer one of this voice already replaced with {"superseded": true}, which ends it quietly.
 */
export class KokoroVoice extends SampledVoice {
  kind = 'kokoro';
  constructor(voice = 'af_heart') {
    super();
    this.voice = voice;
    this.page = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
    this.ready = (async () => {
      for (let i = 0; i < 120; i++) {                               // the server loads and warms it up at start
        const s = await (await fetch('/api/tts/status', { cache: 'no-store' })).json();
        if (!s.available) throw new Error('Kokoro is not set up on the server (bash tools/setup_kokoro.sh)');
        if (s.ready) return s;
        if (s.error) throw new Error(s.error);
        await new Promise(r => setTimeout(r, 500));
      }
      throw new Error('Kokoro did not get ready within a minute');
    })();
  }

  say(text, marks = {}) {
    if (this.closed) return;
    const cue = this.begin(marks);
    const abort = new AbortController();
    cue.abort = abort;
    (async () => {
      const res = await fetch(`/api/tts?voice=${encodeURIComponent(this.voice)}&text=${encodeURIComponent(text)}` +
        `&page=${this.page}&seq=${cue.id}`, { signal: abort.signal });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const msg = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (msg.error) throw new Error(msg.error);
          if (msg.superseded) { reader.cancel().catch(() => {}); return; }   // a newer cue took over: not an error
          this.play(cue, { samples: pcm16ToFloat(msg.pcm), rate: msg.rate, i: msg.i, synthMs: msg.synth_ms, text: msg.text });
        }
      }
    })().catch(e => { if (e.name !== 'AbortError' && cue === this.cue) marks.onError?.(e.message); })
      .finally(() => { cue.finished = true; });
  }

  cancel() {
    this.cue?.abort?.abort();
    super.cancel();
  }
}

/** Kokoro-82M in the browser: a Worker on WebGPU (web/js/kokoro-worker.js), when the server's voice is not set up. */
export class KokoroWebVoice extends SampledVoice {
  kind = 'kokoro-web';
  constructor(voice = 'af_heart') {
    super();
    this.voice = voice;
    this.worker = new Worker('/web/js/kokoro-worker.js', { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }) => {
        if (data.type === 'ready') resolve(data);
        else if (data.type === 'error' && data.id == null) reject(new Error(data.message));
        else if (data.type === 'error') {
          if (this.cue?.workerId === data.id) { this.cue.finished = true; this.cue.marks.onError?.(data.message); }
        } else if (data.type === 'chunk' && this.cue?.workerId === data.id) {
          this.play(this.cue, { samples: data.samples, rate: data.rate, i: data.i, synthMs: data.synthMs, text: data.text });
          if (data.last) this.cue.finished = true;
        }
      };
      this.worker.onerror = e => reject(new Error(e.message || 'the Kokoro worker failed'));
    });
    this.worker.postMessage({ type: 'init', voice });
  }

  say(text, marks = {}) {
    if (this.closed) return;
    const cue = this.begin(marks);
    cue.workerId = cue.id;
    this.worker.postMessage({ type: 'say', id: cue.id, text, voice: this.voice });
  }

  cancel() {
    if (this.cue) this.worker.postMessage({ type: 'cancel' });
    super.cancel();
  }

  /** The worker holds the whole model (on the GPU): it goes with the voice. */
  close() {
    super.close();
    this.worker.terminate();
  }
}

/** The voice of a kind: Kokoro on the server, else Kokoro in the browser, else the Mac's voice (with the reason). */
export async function createVoice(kind, { voice, volume = 1 } = {}) {
  const v = await pick(kind, voice);
  v.volume = volume;                                   // (0 for benchmarks: timing works the same, nothing is heard)
  return v;
}

async function pick(kind, voice) {
  if (kind !== 'kokoro' && kind !== 'kokoro-web') return new MacVoice();
  const reasons = [];
  for (const Voice of kind === 'kokoro' ? [KokoroVoice, KokoroWebVoice] : [KokoroWebVoice]) {
    const v = new Voice(voice);
    try {
      await v.ready;
      if (reasons.length) v.fallbackReason = reasons.join('; ');
      return v;
    } catch (e) {
      v.close();
      reasons.push(e.message);
    }
  }
  const mac = new MacVoice();
  mac.fallbackReason = reasons.join('; ');
  return mac;
}
