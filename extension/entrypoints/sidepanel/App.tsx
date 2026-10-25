import { useAuth } from '@clerk/chrome-extension';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFor } from '../../lib/api';
import { captureMetadata, type PageCapture } from '../../lib/browser';
import { screen } from '../../lib/relevance';
import { useBrowserBridge } from '../../lib/use-browser-bridge';
import { RECOMMENDATIONS_ENABLED, type BrowserSession, type Relevance, type RhythmResult } from '../../../mobile/src/lib/rhythm';
import { Tasks } from './Tasks';
import { Recommendations } from './Recommendations';
import { Learning } from './Learning';
import { VideoReactions } from './Reactions';
import { InterestPrompt, useLearned } from './Suggestion';
import { Brand, CardHead, SectionLabel, relevanceBadge } from './ui';

export function App({ account }: { account: ReactNode }) {
  const { getToken, userId } = useAuth();
  const api = useMemo(() => apiFor(() => getToken()), [getToken]);
  return <Panel key={userId} api={api} account={account} userId={userId ?? ''} />;
}

function Panel({ api, account, userId }: { api: ReturnType<typeof apiFor>; account: ReactNode; userId: string }) {
  const [interests, setInterests] = useState<RhythmResult>();
  const [dashboard, setDashboard] = useState<{ connections: RhythmResult; tasks: RhythmResult; recommendations: RhythmResult; metrics: RhythmResult }>();
  const [message, setMessage] = useState('');
  const [page, setPage] = useState<PageCapture>();
  const [decision, setDecision] = useState<Relevance>();
  const [session, setSession] = useState<BrowserSession>();
  const [busy, setBusy] = useState(false);
  const [allowTranscripts, setAllowTranscripts] = useState(false);
  const [localChecks, setLocalChecks] = useState(0);
  const [savedOnly, setSavedOnly] = useState(false);

  const refresh = useCallback(async () => {
    // With recommendations off the server has no tasks, pages or recommendations to list.
    if (!RECOMMENDATIONS_ENABLED) { setInterests(await api.interests()); return; }
    const [profile, connections, tasks, recommendations, metrics] = await Promise.all([
      api.interests(), api.connections(), api.tasks(), api.recommendations(), api.metrics(),
    ]);
    setInterests(profile); setDashboard({ connections, tasks, recommendations, metrics });
  }, [api]);

  useEffect(() => {
    let alive = true, running = false;
    async function update() {
      if (running) return; running = true;
      try { await refresh(); } catch { if (alive) setMessage('Could not refresh Rhythm. Check your connection.'); }
      finally { running = false; }
    }
    void update();
    const timer = setInterval(() => void update(), 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [refresh]);

  const learned = useLearned(api);

  const bridge = useBrowserBridge(api, page, session,
    (text) => { setSession(undefined); setMessage(text); },
    (text) => { setMessage(text); void refresh().catch(() => undefined); });

  // Display the latest decision; execution is independently rechecked by the backend.
  const currentDecision = page && interests?.profile?.confirmed ? screen(interests.profile, page.metadata) : decision;

  async function usePage() {
    setBusy(true); setMessage('');
    try {
      const current = await api.interests(); setInterests(current);
      if (!current.profile?.confirmed) { setMessage(current.message || 'Rhythm hasn’t learned your interests yet.'); return; }
      if (!current.profile.consent.metadata || !current.profile.enabledSites.includes('youtube')) {
        setMessage('Allow YouTube page details in your Rhythm settings first.'); return;
      }
      if (session) await api.disconnectBrowser(session.id);
      setSession(undefined);
      const capture = await captureMetadata();
      const relevance = screen(current.profile, capture.metadata);
      setPage(capture); setDecision(relevance); setLocalChecks((n) => n + 1);
      if (relevance.status !== 'relevant') {
        setMessage('Screened on this device. No page details were sent and no transcript was requested.'); return;
      }
      const permitted = await api.permitPage(capture.metadata, capture.capturedAt, allowTranscripts, current.profile.profileRevision);
      setSession(permitted.browser); setMessage(permitted.message);
      await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'The page could not be read.'); }
    finally { setBusy(false); }
  }

  async function pause() {
    const current = session;
    setSession(undefined); setPage(undefined); setDecision(undefined);
    await chrome.storage.session.remove('invocation');
    try {
      if (current) {
        const result = await api.pauseBrowser(current.id);
        if (result.status !== 'ok') throw new Error(result.message);
      }
      setMessage('Rhythm is paused. Click its toolbar icon when you want to use a page again.');
    } catch {
      setMessage('Stopped on this browser. Server revocation could not be confirmed; reconnect or revoke the page on your phone.');
    }
    await refresh().catch(() => undefined);
  }
  async function changeTranscriptPermission(enabled: boolean) {
    setAllowTranscripts(enabled);
    if (!enabled && session?.allowTranscripts) {
      const current = session;
      setSession(undefined); // immediately stops polling and discards any in-flight capture
      try {
        const result = await api.pauseBrowser(current.id);
        setMessage(result.status === 'ok'
          ? 'Transcript permission withdrawn for this page. Choose Use this page to continue with metadata.'
          : result.message);
      } catch {
        setMessage('Stopped here. Server revocation could not be confirmed; reconnect or revoke this page on your phone.');
      }
    } else if (session && enabled !== session.allowTranscripts) {
      setMessage('Choose Use this page again to apply this permission.');
    }
  }
  const metrics = dashboard?.metrics.metrics;
  const recommendations = (dashboard?.recommendations.recommendations ?? []).filter((item) => !savedOnly || item.feedback === 'saved');
  const badge = currentDecision && relevanceBadge[currentDecision.status];
  return <main>
    <header className="top"><Brand />{account}</header>
    <SectionLabel>Your interests</SectionLabel>
    <Learning api={api} userId={userId} interests={interests} refresh={refresh} onMessage={setMessage} />
    <InterestPrompt api={api} view={learned.view} revision={learned.revision} reload={learned.reload} refresh={refresh} />
    <SectionLabel>This video</SectionLabel>
    <VideoReactions api={api} onSaved={() => { void learned.reload(); void refresh().catch(() => undefined); }} />
    {RECOMMENDATIONS_ENABLED && <section className="card" aria-labelledby="page-title">
      <CardHead icon="shield" id="page-title" title="One page. Your permission."
        description="Rhythm reads this video’s title, channel, visible description excerpt and length after you choose it. A matching page never starts transcript reading by itself." />
      <label><input type="checkbox" checked={allowTranscripts && !!interests?.profile?.consent.transcripts}
        disabled={!interests?.profile?.consent.transcripts}
        onChange={(e) => void changeTranscriptPermission(e.target.checked)} />
        Also permit displayed transcript reading for a task I start</label>
      {!interests?.profile?.consent.transcripts && <p className="muted">Allow transcript reading in your Rhythm settings to use this option.</p>}
      <div className="row">
        <button className="primary" onClick={() => void usePage()} disabled={busy || !interests?.profile?.confirmed}>
          {busy ? 'Checking page…' : 'Use this page'}
        </button>
        <button onClick={() => void pause()}>Pause</button>
      </div>
      <details><summary>What is shared</summary>
        <p className="muted">When you choose a page, eligible page details go to your BuildNorth server. Private transcript copies expire within 24 hours.
          Temporary task details expire after seven days; saved recommendations and their short quoted excerpts remain until deleted.
          Navigating ends live access. Pause revokes the current page’s cached-text permission; manage earlier page grants on your phone.</p>
        <p className="muted">Your chosen external agent receives approved content when it uses Rhythm’s tools, under its host’s retention policy.
          No browsing profile is sold or used for advertising.</p>
      </details>
    </section>}
    <p className="notice" role="status" aria-live="polite">
      {message || interests?.message || (RECOMMENDATIONS_ENABLED ? 'Choose a page or start with your interests.' : '')}</p>
    {bridge.reading && <div className="row"><p className="grow">Reading the displayed transcript…</p>
      <button className="small" onClick={() => void bridge.cancel()}>Cancel reading</button></div>}
    {page && currentDecision && badge && <section className="card" aria-labelledby="decision-title">
      <span className={`badge ${badge.tone}`}>{badge.label}</span>
      <h2 id="decision-title">{page.metadata.title || 'Title unavailable'}</h2>
      {currentDecision.reasons.map((reason) => <p key={reason}>{reason}</p>)}
      <details><summary>Missing information</summary>
        {currentDecision.limitations.map((reason) => <p className="muted" key={reason}>{reason}</p>)}</details>
    </section>}
    {RECOMMENDATIONS_ENABLED && interests?.profile?.confirmed && <>
      <SectionLabel>Tasks</SectionLabel>
      <Tasks api={api} session={session} tasks={dashboard?.tasks.tasks ?? []}
        agents={dashboard?.connections.agents ?? []} transcriptsAllowed={interests.profile.consent.transcripts}
        onMessage={setMessage} refresh={refresh} />
    </>}
    {RECOMMENDATIONS_ENABLED && <Recommendations api={api} items={recommendations} session={session} onMessage={setMessage} refresh={refresh}
      toolbar={<label className="toggle"><input type="checkbox" checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} />Show saved videos only</label>} />}
    {RECOMMENDATIONS_ENABLED && <footer className="counter">
      <p>Screened locally this session: {localChecks}</p>
      {metrics ? <p>Today: {metrics.candidateChecks} server checks · {metrics.transcriptAttempts}/{dashboard?.metrics.limits?.attemptsPerDay} transcript attempts
        · {metrics.cacheHits} cache hits · {metrics.blockedRequests} blocked · {metrics.providerFailures} provider failures</p> : null}
    </footer>}
  </main>;
}
