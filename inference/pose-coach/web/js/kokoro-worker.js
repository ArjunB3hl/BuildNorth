// Kokoro-82M, the coach's local voice, in a Worker so synthesis never stalls the pose loop: kokoro-js on WebGPU (fp32).
// Everything comes from this machine: the model (web/models/kokoro) and voices (web/vendor/kokoro-js-*/voices) that
// kokoro-js would fetch from Hugging Face are served by the dev server, and any other request leaving the machine fails.
//
// in:  {type: 'init', voice}             load and warm up    -> {type: 'ready', device, loadMs, warmMs} | {type: 'error'}
//      {type: 'say', id, text, voice}    a cue, by sentence  -> {type: 'chunk', id, i, last, samples, rate, synthMs, text}
//      {type: 'cancel'}                  drop the cue being said (a newer one replaces it)
import { KokoroTTS, env } from '/web/vendor/kokoro-js-1.2.1/kokoro.web.js';
import { sentences } from './speech-text.js';

const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
const MODEL = '/web/models/kokoro/';
const VOICES = '/web/vendor/kokoro-js-1.2.1/voices/';
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith(HF)) {
    const rest = url.slice(HF.length);
    return realFetch(rest.startsWith('voices/') ? VOICES + rest.slice('voices/'.length) : MODEL + rest, init);
  }
  if (/^https?:\/\//.test(url) && !url.startsWith(self.location.origin)) return Promise.reject(new Error(`not fetched: ${url}`));
  return realFetch(input, init);
};
env.wasmPaths = '/web/vendor/kokoro-js-1.2.1/ort/';

let tts = null;
let current = null;            // the id of the cue being said; a newer say or a cancel ends the old one between sentences
let queue = Promise.resolve(); // one synthesis at a time on the model, whatever cues overlap
const generate = (text, voice) => {
  const run = queue.then(() => tts.generate(text, { voice }));
  queue = run.catch(() => {});
  return run;
};

async function init(voice) {
  const t0 = performance.now();
  const device = (await navigator.gpu?.requestAdapter?.()) ? 'webgpu' : null;
  if (!device) throw new Error('no WebGPU adapter: Kokoro would be slower than real time here');
  tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device });
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  await generate('Ready when you are.', voice);                    // compiles the GPU shaders before the first cue
  return { device, loadMs: Math.round(loadMs), warmMs: Math.round(performance.now() - t1) };
}

async function say({ id, text, voice }) {
  current = id;
  const parts = sentences(text);
  for (const [i, part] of parts.entries()) {
    if (current !== id) return;
    const t0 = performance.now();
    const audio = await generate(part, voice);
    if (current !== id) return;
    const samples = audio.audio;
    postMessage({ type: 'chunk', id, i, last: i === parts.length - 1, samples, rate: audio.sampling_rate,
      synthMs: Math.round(performance.now() - t0), text: part }, [samples.buffer]);
  }
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') postMessage({ type: 'ready', ...(await init(data.voice)) });
    else if (data.type === 'say') await say(data);
    else if (data.type === 'cancel') current = null;
  } catch (e) {
    postMessage({ type: 'error', id: data.id ?? null, message: String(e?.message || e) });
  }
};
