// Opt-in local session welcome. This describes capabilities, never proof of a running tracker.
export const SESSION_INTRO_TEXT = "Hi, I'm your movement coach. With a clear camera view, I can track visible body landmarks. After recording, you can replay your movement in 3D and compare your legs and knees with a reference. I'll flag anything I can't see clearly. What would you like to do today?";

export function sessionIntroEvent() {
  return {
    kind: 'ask_exercise', sessionIntro: true, trackingStatus: 'awaiting_pose',
    summary: `Give this brief introduction, then wait for the user's answer: ${SESSION_INTRO_TEXT} ` +
      'This is a description of capabilities. No successful tracking update or restart is confirmed by this event. ' +
      'Do not claim you are already tracking, infer a movement, or call a movement tool until the user chooses. ' +
      'For dance, do not announce a movement timer.',
  };
}

/** An abortable five-second delay on a monotonic clock; no camera, recording or coach side effects. */
export function waitForCountdown({ signal, onTick, now = () => performance.now(), duration = 5000 } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(false); return; }
    const end = now() + duration;
    let timer, last;
    const finish = result => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish(false);
    const tick = () => {
      const remaining = end - now();
      if (remaining <= 0) { finish(true); return; }
      const seconds = Math.ceil(remaining / 1000);
      if (seconds !== last) { last = seconds; onTick?.(seconds); }
      timer = setTimeout(tick, Math.min(100, remaining));
    };
    signal?.addEventListener('abort', abort, { once: true });
    tick();
  });
}
