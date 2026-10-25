// Signed conversation URLs are short-lived and stay in memory. No account ID or API key crosses the frame boundary.
export function hostAgent(app, timeout = 20000) {
  let pending = null, serial = 0;
  app.on('elevenlabs-session', message => {
    if (!pending || message.requestId !== pending.id) return;
    const { resolve, reject, timer } = pending; pending = null; clearTimeout(timer);
    try {
      const url = new URL(message.signedUrl);
      if (url.protocol !== 'wss:' || url.hostname !== 'api.elevenlabs.io' || url.username || url.password) throw new Error();
      resolve(url.href);
    } catch { reject(new Error('Reconnect ElevenLabs in Rhythm AI connections.')); }
  });
  return () => {
    if (pending) return pending.promise;
    const id = String(++serial);
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => { pending = null; reject(new Error('Rhythm did not authorize the voice session.')); }, timeout);
    pending = { id, promise, resolve, reject, timer };
    app.send('elevenlabs-session-request', { requestId: id });
    return promise;
  };
}

export function accountConnections(elevenlabs) {
  return { eleven: { connected: elevenlabs, agentId: elevenlabs ? 'rhythm-account' : null, name: 'Your Rhythm agent' },
    claude: { available: false, loggedIn: false }, chatgpt: { available: false, loggedIn: false } };
}
