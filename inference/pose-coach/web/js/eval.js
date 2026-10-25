// Offline evaluation: run the pose tracker over every clip of the eval set frame by frame (seeking, so the result does
// not depend on how fast this machine is), and post the full landmark series + 1-per-second overlay snapshots to the
// dev server. The engine is tuned afterwards on the saved series (tools/run_engine.mjs), without re-running this.
import { createPose, detect, drawPose } from './pose.js';

const q = new URLSearchParams(location.search);
const model = q.get('model') || 'full';
const fps = Number(q.get('fps') || 30);
const only = q.get('only') ? q.get('only').split(',') : null;
const video = document.getElementById('v');
const overlay = document.getElementById('c');
const logEl = document.getElementById('log');
const log = m => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; };
window.EVAL = { status: 'starting', model, fps, done: 0, total: 0, errors: [], summary: [] };

const r4 = x => Math.round(x * 1e4) / 1e4;
const seek = t => new Promise(resolve => {
  video.addEventListener('seeked', resolve, { once: true });
  video.currentTime = t;
});

async function runClip(clip) {
  video.src = clip.url;
  await new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error(`cannot load ${clip.url}`)), { once: true });
  });
  const w = video.videoWidth, h = video.videoHeight;
  overlay.width = w; overlay.height = h;
  const pose = await createPose({ model });
  const n = Math.floor(video.duration * fps);
  const frames = [], snapshots = [];
  const snap = document.createElement('canvas');
  snap.width = 320; snap.height = Math.round((320 * h) / w);
  const sctx = snap.getContext('2d'), octx = overlay.getContext('2d');
  let found = 0, ms = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fps + 0.001;
    await seek(t);
    const t0 = performance.now();
    const r = detect(pose.landmarker, video, Math.round(t * 1000));
    ms += performance.now() - t0;
    if (r.image) found += 1;
    frames.push({
      t: Math.round(t * 1000),
      image: r.image ? r.image.map(p => [r4(p.x), r4(p.y), r4(p.z), r4(p.visibility ?? 0)]) : null,
      world: r.world ? r.world.map(p => [r4(p.x), r4(p.y), r4(p.z)]) : null,
    });
    if (i % 5 === 0) { octx.clearRect(0, 0, w, h); drawPose(octx, r.image); }
    if (i % fps === 0) {
      sctx.drawImage(video, 0, 0, snap.width, snap.height);
      drawPose(sctx, r.image);
      snapshots.push({ t: Math.round(t * 1000), jpeg: snap.toDataURL('image/jpeg', 0.75) });
    }
  }
  pose.landmarker.close();
  const result = { id: clip.id, exercise: clip.exercise, model, delegate: pose.delegate, fps, width: w, height: h,
    duration: video.duration, frames, snapshots, detectRate: found / n, msPerFrame: ms / n };
  const resp = await fetch(`/api/results?model=${model}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result) });
  if (!resp.ok) throw new Error(`saving results: HTTP ${resp.status}`);
  return { id: clip.id, frames: n, detectRate: +(found / n).toFixed(3), msPerFrame: +(ms / n).toFixed(1), delegate: pose.delegate };
}

const set = await (await fetch('/api/eval-set')).json();
const clips = only ? set.filter(c => only.includes(c.id)) : set;
window.EVAL.total = clips.length;
window.EVAL.status = 'running';
log(`model=${model} fps=${fps}: ${clips.length} clips`);
for (const clip of clips) {
  try {
    const s = await runClip(clip);
    window.EVAL.summary.push(s);
    log(`${s.id}: ${s.frames} frames, pose found in ${(s.detectRate * 100).toFixed(1)}%, ${s.msPerFrame} ms/frame (${s.delegate})`);
  } catch (e) {
    window.EVAL.errors.push({ id: clip.id, error: String(e) });
    log(`${clip.id}: ERROR ${e}`);
  }
  window.EVAL.done += 1;
}
window.EVAL.status = 'done';
log('done');
