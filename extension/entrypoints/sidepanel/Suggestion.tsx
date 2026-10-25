import { useCallback, useEffect, useState } from 'react';
import { answerSuggestion, learnedView, type Answer } from '../../lib/reactions';
import type { LearnedView, RhythmApi } from '../../../mobile/src/lib/rhythm';
import { CardHead, Orb } from './ui';

/** GET /rhythm/learned, when the panel opens and whenever `reload` is called (after reactions and answers). */
export function useLearned(api: RhythmApi) {
  const [state, setState] = useState<{ view: LearnedView | null; revision: number }>({ view: null, revision: 0 });
  const reload = useCallback(async () => {
    try {
      const result = await api.learned();
      setState({ view: learnedView(result), revision: result.profileRevision ?? 0 });
    } catch { /* Keep what's shown; the panel's own refresh reports connection problems. */ }
  }, [api]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}

/**
 * The learned-interest prompt ("You've watched 2 beginner boxing videos recently…"). It's the one place the panel
 * shows anything Rhythm learned, and only when the backend has a suggestion.
 */
export function InterestPrompt({ api, view, revision, reload, refresh }: {
  api: RhythmApi; view: LearnedView | null; revision: number;
  reload: () => Promise<void>; refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const suggestion = view?.suggestion;

  async function answer(kind: Answer) {
    if (!view) return;
    setBusy(true); setNote('');
    try {
      const result = await answerSuggestion(api, view, revision, kind);
      setNote(result.message || (result.status === 'ok' ? 'Saved.' : result.status.replaceAll('_', ' ')));
      await Promise.all([reload(), refresh().catch(() => undefined)]);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    } finally { setBusy(false); }
  }

  if (!suggestion && !note) return null;
  return <section className="card ai" aria-label="Rhythm noticed" aria-busy={busy}>
    <CardHead leading={<Orb />} title="Rhythm noticed" />
    {suggestion && <>
      <p className="prompt-text">{suggestion.text}</p>
      <div className="row">
        <button className="primary" disabled={busy} aria-label={`Yes, more ${suggestion.topic}`}
          onClick={() => void answer('yes')}>Yes</button>
        <button disabled={busy} aria-label={`Not interested in ${suggestion.topic}`}
          onClick={() => void answer('no')}>Not interested</button>
        <button className="quiet" disabled={busy} aria-label={`Forget this: ${suggestion.topic}`}
          onClick={() => void answer('forget')}>Forget this</button>
      </div>
      <p className="muted">Forget this deletes the videos behind it and stops counting earlier coach chats about it.</p>
    </>}
    <p className="muted" role="status">{note}</p>
  </section>;
}
