import { useEffect, useState } from 'react';
import { EMPTY_INTERESTS, type RhythmApi, type RhythmResult } from '../../../mobile/src/lib/rhythm';
import { LEARN_KEY, YOUTUBE_ACCESS, stopLearningHere, type LearningFlag } from '../../lib/learning';
import { CardHead, Orb } from './ui';

const webApp = (import.meta.env.WXT_WEB_APP_URL || 'http://localhost:8081').replace(/\/+$/, '');
/** The web app's Rhythm settings (consent switches); no cookies or tokens are passed. */
export const settingsUrl = `${webApp}/profile/interests`;

/**
 * The top card: whether Rhythm is learning, and the switch for learning from watched videos. Learned interests
 * are never listed here. The switch is on only when the account has learning on (with YouTube allowed) AND this
 * browser has Chrome's YouTube permission and the local flag for this account; anything else is shown as it is.
 */
export function Learning({ api, userId, interests, refresh, onMessage }: {
  api: RhythmApi; userId: string; interests?: RhythmResult;
  refresh: () => Promise<void>; onMessage: (message: string) => void;
}) {
  const [access, setAccess] = useState<boolean>();
  const [flag, setFlag] = useState<LearningFlag | null>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const [granted, stored] = await Promise.all([
        chrome.permissions.contains(YOUTUBE_ACCESS), chrome.storage.local.get<Record<string, LearningFlag>>(LEARN_KEY),
      ]);
      if (alive) { setAccess(granted); setFlag(stored[LEARN_KEY] ?? null); }
    };
    const onStorage = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && LEARN_KEY in changes) void check();
    };
    void check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
      alive = false;
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
      chrome.storage.onChanged.removeListener(onStorage);
    };
  }, []);

  const profile = interests?.profile ?? undefined;
  const accountLearning = !!profile?.consent.learn;
  const videosAllowed = accountLearning && !!profile?.enabledSites.includes('youtube');
  const here = !!access && flag?.userId === userId;
  const on = videosAllowed && here;
  const ready = interests !== undefined && access !== undefined && flag !== undefined;

  /** Saves the switches against the latest revision, once more if another screen saved in between. */
  async function saveLearn(learn: boolean): Promise<RhythmResult> {
    let result: RhythmResult | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = (await api.interests()).profile ?? undefined;
      if (!learn && !current?.consent.learn) return { status: 'ok', message: '' } as RhythmResult;
      result = await api.saveSettings({
        enabledSites: learn ? [...new Set([...(current?.enabledSites ?? []), 'youtube'])] : current?.enabledSites ?? [],
        consent: { ...EMPTY_INTERESTS.consent, ...current?.consent, ...(learn ? { learn: true, metadata: true } : { learn: false }) },
      }, current?.profileRevision ?? 0);
      if (result.status !== 'stale_context') break;
    }
    return result!;
  }

  function turnOn() {
    // Chrome shows its permission prompt only during a click, so ask before anything else is awaited.
    const hadAccess = !!access;
    const granted = chrome.permissions.request(YOUTUBE_ACCESS);
    setBusy(true);
    void (async () => {
      try {
        if (!await granted) { onMessage('Chrome didn’t allow access to YouTube, so learning stays off.'); return; }
        const result = await saveLearn(true);
        if (result.status !== 'ok') {
          if (!hadAccess) await chrome.permissions.remove(YOUTUBE_ACCESS);
          onMessage(result.message || 'Learning couldn’t be turned on. Try again.');
          return;
        }
        await chrome.storage.local.set({ [LEARN_KEY]: { userId, since: new Date().toISOString() } satisfies LearningFlag });
        onMessage('Learning is on. Rhythm will notice the workout, martial arts, health and cooking videos you watch here.');
      } catch (e) {
        if (!hadAccess) await chrome.permissions.remove(YOUTUBE_ACCESS).catch(() => false);
        onMessage(e instanceof Error ? e.message : 'Learning couldn’t be turned on. Try again.');
      } finally {
        setBusy(false);
        await refresh().catch(() => undefined);
      }
    })();
  }

  async function turnOff() {
    setBusy(true);
    try {
      await stopLearningHere(); // Stop collecting at once, even if the server can't be reached.
      const result = await saveLearn(false);
      onMessage(result.status === 'ok'
        ? 'Learning is off. The videos Rhythm collected were deleted, and it no longer has access to YouTube pages.'
        : result.message);
    } catch {
      onMessage('Stopped in this browser, but your account couldn’t be updated. Turn learning off in your Rhythm settings.');
    } finally {
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  }

  return <section className="card" aria-busy={busy} aria-labelledby="learning-title">
    <CardHead id="learning-title" leading={<Orb still={!on} />}
      title={accountLearning ? 'Learning from your activity' : 'Let Rhythm learn what you like'}
      description={accountLearning
        ? profile && !profile.confirmed && 'Still learning… Watch a few workout or recipe videos, or chat with your coach.'
        : 'No typing needed: with learning on, Rhythm works out your interests from the fitness videos you watch, your coach chats and your feedback, and keeps your profile up to date.'} />
    <label className="switch">
      <input type="checkbox" role="switch" checked={on} disabled={busy || !ready}
        onChange={(e) => { if (e.target.checked) turnOn(); else void turnOff(); }} />
      Learn my interests from the fitness videos I watch
    </label>
    <p className="muted">Only workout, martial arts, exercise, health and cooking videos count; everything else stays in
      this browser. Off by default. Turn it off anytime and what was collected is deleted.</p>
    {ready && !on && videosAllowed && !here && <p className="muted">
      Learning from videos is on for your account, but this browser isn’t sharing what you watch. Turn the switch on to
      include it, or <button className="link" disabled={busy} onClick={() => void turnOff()}>turn learning off</button>.</p>}
    {ready && !on && !videosAllowed && !!access && <p className="muted">
      Learning from videos is off for your account, so nothing is sent, but Chrome still lets Rhythm see YouTube pages.
      Turn the switch on, or <button className="link" disabled={busy} onClick={() => void turnOff()}>remove YouTube access</button>.</p>}
    <details><summary>What is shared</summary>
      <p className="muted">With learning on, Rhythm counts how much of a YouTube video actually plays while its tab is in view
        (ads, skipped parts and background play don’t count). After a minute of that, it checks the video on this device,
        using its title, visible description excerpt and any transcript you already opened. Only workout, martial arts,
        exercise, health and cooking videos go to your Rhythm server: the link, title, channel, description excerpt,
        length, up to 60 transcript lines and the seconds you watched. Other videos never leave this browser, and no
        browsing history is kept.
        Your server keeps those videos for 60 days, learns only from the last 45 days and gives recent ones more weight.
        Turning learning off deletes them. What Rhythm learns updates your profile and isn’t shown here.</p>
      <p className="muted">No browsing profile is sold or used for advertising.</p>
    </details>
    <nav className="links" aria-label="Rhythm">
      <a href={settingsUrl} target="_blank" rel="noreferrer">Rhythm settings ↗</a>
      <a href={import.meta.env.WXT_PROFILE_URL || 'buildnorth://profile/interests'}>Open profile ↗</a>
      <a href={webApp} target="_blank" rel="noreferrer">Open web dashboard ↗</a>
    </nav>
  </section>;
}
