// Real Start UI with saved-pose input and a simulated voice transport. No camera, microphone, paid agent or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.RHYTHM_PLAYWRIGHT || 'playwright');
const base = process.env.RHYTHM_REVIEW_URL || 'http://127.0.0.1:8765';
const id = process.env.RHYTHM_START_RECORDING || 'live-20261029163035-auto';
const browser = await chromium.launch({ headless: true, ...(process.env.RHYTHM_CHROMIUM ? { executablePath: process.env.RHYTHM_CHROMIUM } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let failTracker = false;
const writes = [], errors = [];
await context.addInitScript(() => {
  localStorage.setItem('pose-coach-coach', 'off'); localStorage.setItem('pose-coach-voice', 'off');
  window.__voice = { starts: [], messages: [], media: [], ticks: [] };
  navigator.mediaDevices.getUserMedia = async constraints => {
    window.__voice.media.push({ constraints, at: performance.now() });
    throw new DOMException('Test-only permission refusal', 'NotAllowedError');
  };
  window.ElevenLabsClient = { Conversation: { startSession: async opts => {
    window.__voice.starts.push(performance.now()); let serial = 0;
    opts.onConnect?.({ conversationId: 'simulated-session' });
    return {
      sendUserMessage(text) {
        const event = JSON.parse(text); window.__voice.messages.push(event);
        const intro = event.sessionIntro ? event : event.events?.find(e => e.sessionIntro);
        const answer = intro ? "Hi, I'm your movement coach. With a clear view I can track visible landmarks and help you review leg movement in 3D. What would you like to do today?" : 'Test reply.';
        const event_id = ++serial;
        setTimeout(() => {
          opts.onIncomingEvent?.({ type: 'agent_response', agent_response_event: { agent_response: answer, event_id } });
          opts.onMessage?.({ source: 'ai', message: answer, event_id });
        }, 30);
      },
      sendUserActivity() {}, sendContextualUpdate() {}, setMicMuted() {}, setVolume() {},
      endSession: async () => opts.onDisconnect?.({ reason: 'user' }), output: { interrupt() {} },
    };
  } } };
  addEventListener('DOMContentLoaded', () => {
    const number = document.getElementById('countdownNumber');
    new MutationObserver(() => window.__voice.ticks.push({ text: number.textContent, at: performance.now() }))
      .observe(number, { childList: true, characterData: true, subtree: true });
  });
});
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/web/js/review-page.js') return route.fulfill({ contentType: 'text/javascript', body: '// Comparison is tested separately.' });
  if (url.pathname === '/api/connections') return route.fulfill({ json: {
    eleven: { connected: true, signedSessions: true, agentId: 'agent_0123456789abcdefghijklmnopqr', name: 'Simulated coach' },
    claude: { available: false }, chatgpt: { available: false },
  } });
  if (url.pathname === '/api/stt/status') return route.fulfill({ json: { available: false, ready: false } });
  if (url.pathname === '/api/elevenlabs/session') return route.fulfill({ json: { signedUrl: 'wss://api.elevenlabs.io/test-only-no-connection' } });
  if (url.pathname === '/api/coach/describe') return route.fulfill({ json: req.postDataJSON().event });
  if (url.pathname === '/web/js/moves.js' && failTracker) return route.fulfill({ status: 503, contentType: 'text/javascript', body: 'Test-only unavailable tracker' });
  if (!['GET', 'HEAD'].includes(req.method())) { writes.push(url.pathname); return route.abort(); }
  return route.continue();
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const open = async (intro = true) => {
  await page.goto(`${base}/web/index.html?review=1${intro ? '&session_intro=1' : ''}`);
  await page.waitForFunction(() => window.POSE_COACH?.plan);
  await page.waitForFunction(id => [...document.getElementById('source').options].some(o => o.value === `rec:${id}`), id);
  await page.locator('#source').selectOption(`rec:${id}`);
};
const start = () => page.locator('#start').click();
const idle = () => page.waitForFunction(() => !window.POSE_COACH.starting && !window.POSE_COACH.running);
const snapshot = () => page.evaluate(() => ({ ...window.__voice, running: window.POSE_COACH.running, pending: window.POSE_COACH.startIntroPending, rec: window.POSE_COACH.rec }));
try {
  await open(false);
  assert.equal(await page.locator('#coachKind').inputValue(), 'off');
  assert.equal(await page.locator('#voiceKind').inputValue(), 'off');
  await start(); await page.waitForFunction(() => window.POSE_COACH.running);
  assert.equal(await page.locator('#startCountdown').isVisible(), false);
  await page.locator('#stop').click(); await idle();

  await open();
  assert.equal(await page.locator('#coachKind').inputValue(), 'auto');
  assert.equal((await snapshot()).starts.length, 0);
  await page.evaluate(() => window.POSE_COACH.chooseMovement('freestyle_dance', 'tap'));
  await start();
  await page.waitForFunction(() => document.getElementById('countdownNumber').textContent === '4');
  let state = await snapshot(); assert.equal(state.running, false); assert.equal(state.starts.length, 0); assert.equal(state.media.length, 0); assert.ok(!state.rec);
  await fs.mkdir('.data/review-artifacts', { recursive: true });
  await page.screenshot({ path: '.data/review-artifacts/session-start-countdown.png' });
  await page.locator('#cancelCountdown').click(); await idle();
  assert.equal((await snapshot()).pending, true);
  assert.equal(await page.evaluate(() => window.POSE_COACH.nextMove.key), 'freestyle_dance');
  assert.equal((await snapshot()).starts.length, 0);
  // Clear the preselection for the introductory question; cancellation above must preserve it.
  await page.locator('#exercise').selectOption('auto');
  await page.evaluate(() => { window.__voice.ticks = []; window.__clicked = performance.now(); });
  await start();
  await page.waitForFunction(() => document.getElementById('countdownNumber').textContent === '1');
  state = await snapshot(); assert.equal(state.running, false); assert.equal(state.starts.length, 0); assert.equal(state.media.length, 0);
  await page.waitForFunction(() => window.POSE_COACH.running && window.__voice.messages.some(e => e.sessionIntro));
  state = await snapshot();
  assert.ok(state.starts[0] - await page.evaluate(() => window.__clicked) >= 4990);
  assert.deepEqual(state.ticks.filter(t => t.text).map(t => t.text), ['5', '4', '3', '2', '1']);
  assert.equal(state.messages.filter(e => e.sessionIntro).length, 1);
  assert.match(state.messages.find(e => e.sessionIntro).summary, /No successful tracking update or restart is confirmed/);
  assert.equal(state.pending, false); assert.ok(!state.rec);
  assert.equal(await page.locator('#startCountdown').isVisible(), false);
  assert.match(await page.locator('#askExText').innerText(), /What would you like to do today/);
  await page.waitForFunction(() => document.getElementById('chat').textContent.includes('Hi, I'));
  assert.ok(!page.url().includes('session_intro'));
  assert.deepEqual(await page.evaluate(() => ['coach', 'voice'].map(k => localStorage.getItem('pose-coach-' + k))), ['off', 'off']);
  assert.ok(await page.evaluate(() => window.POSE_COACH.replayRec.i < 40), 'replay starts at frame zero after setup');
  const firstVoiceDelay = state.starts[0] - await page.evaluate(() => window.__clicked);
  await page.locator('#stop').click(); await idle();
  await page.locator('#coachKind').selectOption('off'); await page.locator('#voiceKind').selectOption('off');
  const before = state.ticks.length;
  await start(); await page.waitForFunction(() => window.POSE_COACH.running);
  assert.equal(await page.locator('#startCountdown').isVisible(), false);
  assert.equal((await snapshot()).ticks.length, before);
  await page.locator('#stop').click(); await idle();

  // Tracker failure must fail before any voice or media session is opened.
  failTracker = true; await open(); await start(); await idle();
  assert.match(await page.locator('#banner').innerText(), /tracker unavailable/i);
  state = await snapshot(); assert.equal(state.pending, true); assert.equal(state.starts.length, 0); assert.equal(state.media.length, 0);
  failTracker = false;
  // Camera refusal after the countdown must not welcome the user as though tracking succeeded.
  await open(); await page.locator('#source').selectOption('camera');
  await page.evaluate(() => { window.POSE_COACH.pose = { model: document.getElementById('model').value }; });
  await start(); await idle();
  state = await snapshot(); assert.equal(state.starts.length, 0); assert.equal(state.media.length, 1); assert.equal(state.pending, true);
  assert.match(await page.locator('#banner').innerText(), /Could not start/);
  assert.equal(await page.locator('#startCountdown').isVisible(), false);
  assert.equal(await page.locator('#start').isEnabled(), true);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log(JSON.stringify({ passed: true, countdown: [5,4,3,2,1], firstVoiceDelayMs: Math.round(firstVoiceDelay), cancelPreservesSelection: true, introductionOnce: true, normalReviewUnchanged: true, noPersistentPreferenceChange: true, trackerFailure: true, cameraRefusal: true, replayStartsAtZero: true, realMediaOrPaidAgentOpened: false, pageErrors: errors, actualWrites: writes }, null, 2));
} finally { await browser.close(); }
