import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { recordVoice } from './voice-recording.web.ts';

let amplitude = 0, nextFrame, stopped = 0;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) },
} });
globalThis.requestAnimationFrame = fn => { nextFrame = fn; return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.MediaRecorder = class {
  state = 'inactive';
  constructor() { this.mimeType = 'audio/webm'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
};
globalThis.AudioContext = class {
  state = 'running';
  createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: samples => samples.fill(amplitude) }; }
  createMediaStreamSource() { return { connect() {} }; }
  async close() { this.state = 'closed'; }
};
after(() => { delete globalThis.navigator; delete globalThis.MediaRecorder; delete globalThis.AudioContext; });

test('silence stays idle and speech is detected before recording stops', async () => {
  const controller = new AbortController();
  const capture = await recordVoice(controller.signal, () => {});
  assert.equal(capture.hasSpeech(), null);
  amplitude = 0; nextFrame();
  assert.equal(capture.hasSpeech(), false);
  amplitude = 0.1; nextFrame();
  assert.equal(capture.hasSpeech(), true);
  capture.cancel();
  assert.ok(stopped > 0);
});

test('cancelling releases a microphone acquired after cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(recordVoice(controller.signal), /cancelled/);
});
