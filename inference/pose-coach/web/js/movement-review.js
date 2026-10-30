// Keep spoken reset commands deliberately narrow: questions and negated requests must not erase an attempt.
// Share a single loader between the live page and offline review. A transient failed dynamic import can otherwise
// remain rejected for the rest of a browser page's life. Retry distinct URLs, boundedly, and never cache failure.
export function movementLoader(importer = url => import(url), wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let loaded = null, pending = null;
  return function load() {
    if (loaded) return Promise.resolve(loaded);
    if (pending) return pending;
    pending = (async () => {
      let error;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const module = await importer(attempt ? `./moves.js?retry=${Date.now()}-${attempt}` : './moves.js');
          if (typeof module.MovementTracker !== 'function') throw new Error('Movement tracker export is missing.');
          loaded = module;
          return module;
        } catch (e) { error = e; if (attempt < 2) await wait(150 * (attempt + 1)); }
      }
      throw error;
    })().finally(() => { pending = null; });
    return pending;
  };
}
export const loadMovementModule = movementLoader();

export function restartRequested(text) {
  const s = String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(?:dont|do not|not|should|why|whether|if)\b/.test(s)) return false;
  return /^(?:(?:okay|ok|please|can you|could you|would you|will you|lets) )*(?:restart|reset|start over|start again|try again)(?: (?:it|this|tracking|the (?:movement|dance|timer|tracking)|my (?:movement|dance|timer)|from (?:the beginning|zero|0)|again|please))*$/.test(s);
}

// The tracker keeps a short rolling log and marks samples only once their motion is sustained.
// Save those actual counted intervals so a later review can locate them in the landmarks.
export function recordMovingIntervals(recording, movement, tracker, attempt = 0) {
  if (!recording || movement.track !== 'moving' || !tracker?.moveLog) return;
  const intervals = recording.movementIntervals ??= [];
  const boundary=recording.attempts?.find(a=>a.id===attempt&&a.movement===movement.key);
  for (const sample of tracker.moveLog) {
    if (!sample.counted || sample.recordedForReview) continue;
    sample.recordedForReview = true;
    if(!Number.isFinite(sample.t)||!Number.isFinite(sample.dt)||sample.dt<=0)continue;
    const start = Math.max(0, boundary?.start??0, sample.t - sample.dt), end = Math.min(sample.t,boundary?.end??Infinity);
    if(end<=start)continue;
    const last = intervals.at(-1);
    if (last && last.movement === movement.key && last.attempt === attempt && start <= last.end + 2) last.end = Math.max(last.end, end);
    else intervals.push({ movement: movement.key, attempt, start, end });
  }
}

export function beginAttempt(recording, movement, t, reason = 'selected') {
  if (!recording) return null;
  const id = recording.movementAttempt = (recording.movementAttempt ?? 0) + 1;
  (recording.attempts ??= []).push({ id, movement: movement.key, start: Number.isFinite(t) ? t : null, end: null, reason });
  recording.events.push({ type: reason === 'restart' ? 'movement_restart' : 'movement_selected', movement: movement.key, attempt: id, t: Number.isFinite(t) ? t : null });
  return id;
}
export function anchorAttempt(recording, id, t) {
  const a = recording?.attempts?.find(a => a.id === id);
  if (a && a.start == null) {
    a.start = t;
    const e = recording.events.find(e => e.attempt === id && e.t == null); if (e) e.t = t;
  }
}
export function endAttempt(recording, id, t, reason = 'ended') {
  const a = recording?.attempts?.find(a => a.id === id);
  if (!a || a.end != null) return;
  a.end = Math.max(a.start ?? t, t); a.endReason = reason;
  recording.events.push({ type: 'movement_attempt_end', movement: a.movement, attempt: id, t: a.end, reason });
}
export function freshTracker(Tracker, movement) {
  if (!Tracker) throw new Error('Movement tracker is unavailable.');
  const tracker = new Tracker({ movement });
  if (typeof tracker?.update !== 'function' || typeof tracker?.current !== 'function') throw new Error('Movement tracker did not initialize.');
  const initial=tracker.current();
  if((initial?.seconds??0)!==0||(initial?.count??0)!==0)throw new Error('Fresh tracker did not start at zero.');
  return tracker;
}

// Only call after update returns successfully. Construction and a visible camera frame alone are not proof.
export function recordTrackingUpdate(recording, move, t, now) {
  if(!move?.tracker||!Number.isFinite(t)||!Number.isFinite(now))return false;
  const first=move.lastUpdateAt==null;
  move.lastUpdateAt=now;move.lastUpdateT=t;
  const a=recording?.attempts?.find(a=>a.id===move.attempt);
  if(a){a.tracking??={updates:0,firstT:t,lastT:t};a.tracking.updates++;a.tracking.lastT=t;}
  if(first&&recording)(recording.events??=[]).push({type:'tracking_started',movement:move.entry.key,attempt:move.attempt,t});
  return first;
}
export function trackerRunning(state, now) {
  return !!state.move?.tracker&&!state.trackingBlocked&&!state.trackErr
    &&now-(state.move.lastUpdateAt??-Infinity)<1000&&now-(state.lastPoseAt??-Infinity)<1000;
}

// Offline recovery is an explicit estimate of generic activity, never a restart reconstruction or dance detection.
// Only a new scratch record and a new tracker are mutated.
export function recoverIntervals(recording, movement, Tracker, features) {
  const tracker = freshTracker(Tracker, movement), scratch = {}, points = a => a?.map(p => ({ x:p[0],y:p[1],z:p[2],visibility:p[3]??0 }));
  const selected = recording.events?.find(e => e.type === 'movement_selected' && e.movement === movement.key)?.t;
  for (const f of recording.frames ?? []) {
    if (selected != null && f.t < selected) continue;
    const image=points(f.image), world=points(f.world);
    if (image && world) tracker.update(features(world,image,(recording.width||1280)/(recording.height||720)), f.t, {image,world});
    else tracker.lost(f.t);
    recordMovingIntervals(scratch,movement,tracker,null);
  }
  const intervals=scratch.movementIntervals??[],windows=[];
  for (const x of intervals) {
    const prev=windows.at(-1);
    if (prev && x.start-prev.end<600) prev.end=x.end;
    else windows.push({...x});
  }
  return {intervals,windows,seconds:intervals.reduce((s,x)=>s+(x.end-x.start)/1000,0)};
}
