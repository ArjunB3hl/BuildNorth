import { useState } from 'react';
import { captureCurrentVideo } from '../../lib/browser';
import { reactToVideo, type ReactionOutcome } from '../../lib/reactions';
import type { Reaction, RhythmApi } from '../../../mobile/src/lib/rhythm';
import { settingsUrl } from './Learning';
import { CardHead } from './ui';

/**
 * "Save to Rhythm" and "Not interested" for the YouTube video in the active tab. They're explicit, so they work with
 * learning off. The video is read only when you click, with the panel's existing access (lib/browser.ts).
 */
export function VideoReactions({ api, onSaved }: { api: RhythmApi; onSaved: () => void }) {
  const [busy, setBusy] = useState<Reaction>();
  const [outcome, setOutcome] = useState<ReactionOutcome>();

  async function react(reaction: Reaction) {
    setBusy(reaction); setOutcome(undefined);
    try {
      const result = await reactToVideo(api, captureCurrentVideo, reaction);
      setOutcome(result);
      if (result.status === 'ok') onSaved();
    } finally { setBusy(undefined); }
  }

  return <section className="card reactions" aria-labelledby="reactions-title" aria-busy={!!busy}>
    <CardHead icon="bookmark" id="reactions-title" title="More like this, or less?" description="Works with learning off." />
    <div className="row">
      <button className="primary" disabled={!!busy} onClick={() => void react('more')}>
        {busy === 'more' ? 'Saving…' : 'Save to Rhythm'}</button>
      <button disabled={!!busy} aria-label="Not interested in this video" onClick={() => void react('less')}>
        {busy === 'less' ? 'Noting…' : 'Not interested'}</button>
    </div>
    <p className="muted">Rhythm reads this tab’s video title, channel, description excerpt and length when you choose.
      Save to Rhythm also opens YouTube’s transcript, reads it and closes it again. They’re sent only for a workout,
      martial arts, health or cooking video. Your connected AI turns the transcript into useful instructions or takeaways
      in your Content library, alongside the original YouTube link.</p>
    <p><a href={new URL('/profile/videos', settingsUrl).href} target="_blank" rel="noreferrer">Open Content library ↗</a></p>
    <p className={outcome?.status === 'ok' ? 'outcome notice success' : 'outcome notice'} role="status">
      {outcome?.title && <strong>{outcome.title}</strong>}{outcome?.message}
      {outcome?.needsSettings && <> <a href={settingsUrl} target="_blank" rel="noreferrer">Rhythm settings ↗</a></>}
    </p>
  </section>;
}
