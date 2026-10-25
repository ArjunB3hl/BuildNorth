import { useEffect, useRef, type ReactNode } from 'react';
import type { BrowserSession, Recommendation, RhythmApi } from '../../../mobile/src/lib/rhythm';
import { SectionLabel } from './ui';

export function Recommendations({ api, items, session, onMessage, refresh, toolbar }: {
  api: RhythmApi; items: Recommendation[]; session?: BrowserSession;
  onMessage: (text: string) => void; refresh: () => Promise<void>;
  /** Shown beside the heading (the saved-only filter). */
  toolbar?: ReactNode;
}) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!session || !items.length || !container.current) return;
    const allowed = new Set(items.map((item) => item.id));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.recommendationId;
        if (entry.isIntersecting && id && allowed.has(id)) void api.displayed(id, session.id).catch(() => undefined);
      }
    }, { threshold: 0.1 });
    container.current.querySelectorAll('[data-recommendation-id]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [api, items, session]);
  async function feedback(id: string, action: 'saved' | 'dismissed' | 'helpful' | 'clear') {
    try { const result = await api.feedback(id, action); onMessage(result.message); await refresh(); }
    catch (e) { onMessage(e instanceof Error ? e.message : 'Feedback could not be saved.'); }
  }
  return <section className="stack" ref={container}>
    <SectionLabel action={toolbar}>Worth your time <span className="badge">{items.length}</span></SectionLabel>
    {!items.length && <div className="card"><p className="muted">Recommendations you keep here, or your agent sends, also appear on your phone.</p></div>}
    {items.map((item) => <article className="card recommendation" key={item.id} data-recommendation-id={item.id}>
      <span className="badge accent">{item.analysisBasis === 'metadata' ? 'Metadata only' :
        item.analysisBasis.includes('user_text') ? `User-supplied text${item.analysisBasis.includes('partial') ? ' · partial' : ''}` :
          item.analysisBasis.includes('partial') ? 'Partial transcript' : 'Displayed transcript'}</span>
      <h3><a target="_blank" rel="noreferrer" href={item.url}>{item.title || 'Open video'} ↗</a></h3>
      <p>{item.explanation}</p>
      <p className="muted">{item.durationSeconds === null ? 'Length unknown' : `${Math.ceil(item.durationSeconds / 60)} min`}
        {item.feedback ? ` · ${item.feedback.replaceAll('_', ' ')}` : ''}</p>
      {item.stale && <p className="notice">Saved with earlier interests. Recheck it in a new task before new analysis.</p>}
      {item.excerpts.map((segment, index) => <blockquote key={index}>
        <a href={`${item.url}&t=${Math.floor(segment.startSeconds)}s`} target="_blank" rel="noreferrer">
          {Math.floor(segment.startSeconds / 60)}:{String(Math.floor(segment.startSeconds % 60)).padStart(2, '0')}
        </a> — {segment.text}
      </blockquote>)}
      <details><summary>What this recommendation is based on</summary>
        {item.limitations.map((limitation) => <p className="muted" key={limitation}>{limitation}</p>)}
        <p className="muted">Relevance is not a guarantee of accuracy or health advice.</p>
      </details>
      <div className="row">
        <button className={item.feedback === 'saved' ? 'small primary' : 'small'}
          onClick={() => void feedback(item.id, item.feedback === 'saved' ? 'clear' : 'saved')}>{item.feedback === 'saved' ? 'Unsave' : 'Save'}</button>
        <button className="small" onClick={() => void feedback(item.id, 'helpful')}>Helpful</button>
        <button className="small" onClick={() => void feedback(item.id, item.feedback === 'dismissed' ? 'clear' : 'dismissed')}>
          {item.feedback === 'dismissed' ? 'Undo dismissal' : 'Dismiss'}
        </button>
      </div>
    </article>)}
  </section>;
}
