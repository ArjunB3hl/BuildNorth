import { useState } from 'react';
import type {
  AgentConnection, BrowserSession, Candidate, RhythmApi, RhythmResult, Transcript, TranscriptSegment, VideoTask,
} from '../../../mobile/src/lib/rhythm';
import { CardHead, relevanceBadge } from './ui';

export function Tasks({ api, session, tasks, agents, transcriptsAllowed, onMessage, refresh }: {
  api: RhythmApi; session?: BrowserSession; tasks: VideoTask[]; agents: AgentConnection[];
  transcriptsAllowed: boolean;
  onMessage: (message: string) => void; refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [agentId, setAgentId] = useState('');
  const [analyze, setAnalyze] = useState(false);
  const useTranscripts = analyze && transcriptsAllowed;
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [previews, setPreviews] = useState<Record<string, Transcript>>({});
  const selected = tasks.find((t) => t.id === selectedId) ?? tasks.find((t) => t.status === 'active') ?? tasks[0];

  async function perform(action: () => Promise<RhythmResult>) {
    setBusy(true);
    try {
      const result = await action();
      onMessage(result.message || (result.status === 'ok' ? 'Done.' : result.status.replaceAll('_', ' ')));
      if (result.task) setSelectedId(result.task.id);
      await refresh();
      return result;
    } catch (e) { onMessage(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  async function start(action: 'evaluate' | 'recommend') {
    await perform(async () => {
      const result = await api.createTask({
        action, request: query.trim() || 'Evaluate this selected tutorial against my confirmed interests.',
        analyzeTranscripts: useTranscripts, browserSessionId: action === 'evaluate' ? session?.id : undefined, agentId: agentId || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.status !== 'ok' || !result.task) return result;
      setSelectedId(result.task.id);
      if (action === 'recommend') return api.search(result.task.id, query.trim());
      if (!session) return result;
      const added = await api.addSelected(result.task.id, session.id);
      const candidate = added.candidates?.[0];
      if (!candidate || candidate.relevance.status !== 'relevant') return added;
      const shortlisted = await api.shortlist(result.task.id, [candidate.id]);
      if (shortlisted.status !== 'ok' || !useTranscripts) return shortlisted;
      return api.transcript(result.task.id, candidate.id);
    });
  }

  return <>
    <section className="card" aria-labelledby="start-title">
      <CardHead icon="search" id="start-title" title="Start with a question"
        description="Evaluate the page you chose, or find videos that fit your interests." />
      <label>What are you looking for?
        <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200}
          placeholder="Beginner boxing footwork tutorials" />
      </label>
      <label>Who will help?
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">I’ll review the results myself</option>
          {agents.filter((a) => a.status === 'active').map((agent) =>
            <option key={agent.id} value={agent.id}>{agent.label}</option>)}
        </select>
      </label>
      <label><input type="checkbox" checked={useTranscripts} disabled={!transcriptsAllowed}
        onChange={(e) => setAnalyze(e.target.checked)} />
        Analyze available transcripts for this task (up to three videos)
      </label>
      {useTranscripts && <p className="muted">Rhythm opens YouTube’s transcript on the video you chose, reads the displayed
        text and closes it again. If the video has no transcript, you can supply text yourself or use metadata only.</p>}
      <div className="row">
        <button className="primary" disabled={busy || !session || (useTranscripts && !session.allowTranscripts)}
          onClick={() => void start('evaluate')}>Evaluate this video</button>
        <button disabled={busy || query.trim().length < 2} onClick={() => void start('recommend')}>Find videos</button>
      </div>
      {agentId && <p className="muted">Then ask your agent to continue this task through Rhythm. It runs in your agent app; connecting does not start it here.</p>}
    </section>

    {tasks.some((t) => t.status === 'pending') && <section className="card" aria-labelledby="asking-title">
      <CardHead icon="agent" id="asking-title" title="Your agent is asking" />
      {tasks.filter((t) => t.status === 'pending').map((task) => <div className="request" key={task.id}>
        <p>{task.request}</p>
        <p className="muted">From {agents.find((agent) => agent.id === task.agentId)?.label || 'your connected agent'}.</p>
        {task.browserSessionId === session?.id && <p>{session?.metadata?.title || 'Video title unavailable'}</p>}
        <p className="muted">{task.analyzeTranscripts ? 'Includes reading available transcripts from up to three shortlisted videos.' : 'Metadata only; no transcript reading.'}</p>
        <div className="row">
          <button disabled={busy} onClick={() => void perform(() => api.approveTask(task.id))}>Start this task</button>
          <button disabled={busy} onClick={() => void perform(() => api.cancelTask(task.id))}>Decline</button>
        </div>
      </div>)}
    </section>}

    {selected && <section className="card" aria-labelledby="task-title">
      <CardHead icon="task" id="task-title" title="Current task" />
      <label>Task
        <select value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>
          {tasks.map((task) => <option key={task.id} value={task.id}>{task.request.slice(0, 55)} · {task.status}</option>)}
        </select>
      </label>
      <p className="muted">{selected.candidateChecks} candidates · {selected.transcriptAttempts} acquisition attempts · {selected.cacheHits} cache hits</p>
      {selected.status === 'active' ? <div className="row">
        {session ? <button disabled={busy} onClick={() => void perform(() => api.addSelected(selected.id, session.id))}>
          Attach this permitted page
        </button> : null}
        <button disabled={busy} onClick={() => void perform(() => api.cancelTask(selected.id))}>Stop task</button>
      </div> : <p className="notice">This task is {selected.status}. Start a new task if your interests changed.</p>}
      {selected.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} task={selected}
        preview={previews[candidate.id]} busy={busy} onMessage={onMessage}
        shortlist={() => void perform(() => api.shortlist(selected.id, [candidate.id]))}
        read={() => void perform(async () => {
          const result = await api.transcript(selected.id, candidate.id);
          if (result.transcript) setPreviews((old) => ({ ...old, [candidate.id]: result.transcript! }));
          return result;
        })}
        publish={(useText) => void perform(() => {
          const preview = previews[candidate.id];
          return api.publish(selected.id, [{
            candidateId: candidate.id,
            analysisBasis: useText && preview ? (preview.source === 'user_supplied' ? 'user_text' : 'transcript') : 'metadata',
            citations: useText && preview ? preview.segments.slice(0, 2).map((segment, i) => ({
              segmentIndex: preview.offset + i, quote: segment.text.slice(0, 500),
            })) : [],
          }]);
        })}
        importText={(segments, language) => void perform(() => api.importTranscript(selected.id, candidate.id, segments, language))}
      />)}
    </section>}
  </>;
}

function CandidateCard({ candidate, task, preview, busy, shortlist, read, publish, importText, onMessage }: {
  candidate: Candidate; task: VideoTask; preview?: Transcript; busy: boolean; shortlist: () => void;
  read: () => void; publish: (useText: boolean) => void;
  importText: (segments: TranscriptSegment[], language: string | null) => void; onMessage: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('');
  const allowed = task.status === 'active' && candidate.relevance.status === 'relevant';
  function submitText() {
    const segments = text.split('\n').filter((line) => line.trim()).map((line) => {
      const match = line.match(/^((?:\d{1,2}:)?\d{1,3}:[0-5]\d)\s+(.+)$/);
      return match ? { startSeconds: match[1]!.split(':').reduce((n, v) => n * 60 + Number(v), 0), text: match[2]! } : null;
    });
    if (!segments.length || segments.some((segment) => !segment)) {
      onMessage('Use one timestamped segment per line, for example: 0:03 Keep your hands up.'); return;
    }
    if (language && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(language)) {
      onMessage('Use a language code such as en, fr or es, or leave it blank.'); return;
    }
    importText(segments as TranscriptSegment[], language || null);
    setText('');
  }
  return <article className="candidate">
    <span className={`badge ${candidate.shortlisted ? 'accent' : relevanceBadge[candidate.relevance.status].tone}`}>
      {candidate.shortlisted ? 'Shortlisted' : relevanceBadge[candidate.relevance.status].label}</span>
    <h3>{candidate.metadata?.title || 'Excluded candidate'}</h3>
    {candidate.metadata && <a target="_blank" rel="noreferrer" href={candidate.metadata.canonicalUrl}>Open video ↗</a>}
    {candidate.relevance.reasons.map((reason) => <p key={reason}>{reason}</p>)}
    <div className="row">
      {!candidate.shortlisted && <button className="small" disabled={!allowed || busy} onClick={shortlist}>Add to shortlist</button>}
      {candidate.shortlisted && <>
        <button className="small" disabled={!allowed || busy || !task.analyzeTranscripts} onClick={read}>Read available transcript</button>
        <button className="small" disabled={!allowed || busy} onClick={() => publish(false)}>Keep metadata recommendation</button>
      </>}
    </div>
    {preview && <>
      <p className="muted">{preview.source === 'user_supplied' ? 'Your text' : 'Displayed text'} · {preview.completeness} · {preview.language || 'Language unknown'}</p>
      {preview.segments.slice(0, 2).map((segment, i) => <blockquote key={i}>{segment.startSeconds}s — {segment.text}</blockquote>)}
      <p className="muted">{preview.limitation}</p>
      <button className="small" disabled={!allowed || busy || !preview.segments.length} onClick={() => publish(true)}>Keep recommendation with these excerpts</button>
    </>}
    {allowed && candidate.shortlisted && task.analyzeTranscripts && <details>
      <summary>Supply transcript text yourself</summary>
      <p className="muted">Only include text you are permitted to share. It will be labelled as user-supplied, not as a YouTube transcript.</p>
      <label>Timestamped text<textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={100000}
        placeholder={'0:03 Keep your hands up.\n0:08 Step forward with your lead foot.'} /></label>
      <label>Language (optional)<input value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={15} placeholder="en" /></label>
      <button className="small" disabled={busy || !text.trim()} onClick={submitText}>Use this text</button>
    </details>}
  </article>;
}
