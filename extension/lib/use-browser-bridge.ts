import { useEffect, useRef, useState } from 'react';
import type { BrowserSession, RhythmApi } from '../../mobile/src/lib/rhythm';
import { captureTranscript, stillSelected, type PageCapture } from './browser';

export function useBrowserBridge(
  api: RhythmApi, page: PageCapture | undefined, session: BrowserSession | undefined,
  onDisconnected: (message: string) => void, onResult: (message: string) => void,
) {
  const [reading, setReading] = useState<string>();
  const handlers = useRef({ onDisconnected, onResult });
  handlers.current = { onDisconnected, onResult };
  const cancelled = useRef(new Set<string>());
  useEffect(() => {
    if (!page || !session) return;
    let alive = true, running = false;
    const tick = async () => {
      if (!alive || running) return;
      running = true;
      try {
        if (!await stillSelected(page)) {
          await api.disconnectBrowser(session.id).catch(() => undefined);
          if (alive) handlers.current.onDisconnected('The selected page changed. Use the new page to continue.');
          return;
        }
        const polled = await api.poll(session.id, session.pageRef, session.videoId);
        if (!alive) return;
        if (polled.status !== 'ok') { handlers.current.onDisconnected(polled.message); return; }
        for (const request of polled.requests ?? []) {
          if (!alive || cancelled.current.has(request.id) || !await stillSelected(page)) break;
          if (request.operation !== 'read_displayed_transcript' || request.browserSessionId !== session.id
            || request.pageRef !== session.pageRef || request.videoId !== page.metadata.videoId
            || request.profileRevision !== polled.profileRevision || Date.now() >= Date.parse(request.expiresAt)) continue;
          const claimed = await api.claim(session.id, request.id, session.pageRef, session.videoId);
          if (claimed.status !== 'ok' || !alive || cancelled.current.has(request.id)) continue;
          setReading(request.id);
          const captured = await captureTranscript(page, request);
          if (!alive || cancelled.current.has(request.id)) continue;
          if (!captured || !await stillSelected(page)) {
            await api.cancelRequest(session.id, request.id);
            handlers.current.onResult('The page changed. Transcript reading stopped.');
          } else {
            const result = await api.complete(session.id, request.id, captured);
            if (alive) handlers.current.onResult(result.message);
          }
          if (alive) setReading(undefined);
        }
      } catch {
        if (alive) {
          setReading(undefined);
          handlers.current.onDisconnected('The browser connection ended. Choose Use this page to reconnect.');
        }
      } finally { running = false; }
    };
    const timer = setInterval(() => void tick(), 3000);
    void tick();
    return () => { alive = false; clearInterval(timer); };
  }, [api, page, session]);

  const cancel = async () => {
    if (!reading || !session) return;
    cancelled.current.add(reading);
    await api.cancelRequest(session.id, reading);
    setReading(undefined);
    handlers.current.onResult('Transcript reading cancelled.');
  };
  return { reading, cancel };
}
