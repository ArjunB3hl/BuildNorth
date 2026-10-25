import { YOUTUBE_ACCESS, videoId } from './browser';
import { keptVideo } from './relevance';
import { readDisplayedTranscript, readMetadata, readPlayback, type PlaybackReading } from './youtube';
import type { RhythmResult, TranscriptSegment, WatchSignal } from '../../mobile/src/lib/rhythm';

/**
 * Passive interest learning. While a YouTube tab shows a video, the service worker checks it about every 30 seconds
 * and counts only the seconds of the video that actually PLAYED while the page was VISIBLE and no ad was showing.
 * Once that reaches a minute (40% of a video shorter than 150 s), it reads the same visible details as "Use this
 * page" (plus an already-open transcript), screens them on this device and sends only fitness, health and food
 * videos, with those seconds, to the backend, which learns your interests from them. When the tab later leaves the
 * video it sends the total once more, if it grew by at least another minute (the backend keeps the larger value).
 *
 * It runs only while BOTH hold: you turned learning on in the panel (LEARN_KEY, tied to your account), and Chrome
 * granted the optional YouTube host permission. Nothing about other videos is sent or kept.
 */
export { YOUTUBE_ACCESS };
/** chrome.storage.local: set by the panel's switch after the account confirmed learning. */
export const LEARN_KEY = 'rhythmLearning';
/** chrome.storage.session: matching videos waiting to be sent again after a failure. */
export const QUEUE_KEY = 'rhythmLearningQueue';
/** chrome.storage.session: IDs of the matching videos already recorded or queued in this browsing session. */
export const SEEN_KEY = 'rhythmLearningSeen';
/** chrome.storage.session: per tab, the video being measured (see Watch). */
export const WATCH_KEY = 'rhythmLearningWatch';
/** chrome.alarms names: `rhythm-learn:<tabId>:<videoId>`, one repeating check per tab, replaced when the tab changes video. */
export const ALARM_PREFIX = 'rhythm-learn:';
/** chrome.alarms' shortest period: 30 s from Chrome 120 (1 min before). MV3 workers sleep, so timeouts aren't reliable. */
export const CHECK_MINUTES = 0.5;
export const CHECK_MS = CHECK_MINUTES * 60_000;
/** Visible played seconds before a video is sent... */
export const SEND_AT_SECONDS = 60;
/** ...or this share of a video shorter than SHORT_VIDEO_SECONDS. */
export const SHORT_VIDEO_SHARE = 0.4;
export const SHORT_VIDEO_SECONDS = 150;
/** Leaving the video sends the total once more only if it grew by this much since it was sent. */
export const UPDATE_AFTER_SECONDS = 60;
/** YouTube's fastest speed: between two checks, played time can't honestly grow faster than this. */
export const MAX_PLAYBACK_RATE = 2;
export const MAX_QUEUE = 20;
export const MAX_SEGMENTS = 60;
const MAX_SEEN = 500;
const MAX_TRANSCRIPT_CHARACTERS = 20_000; // the backend's limit for a signal's transcript
const MAX_QUEUED_AGE_MS = 23 * 3600_000; // the backend refuses captures more than a day old
const MAX_SECONDS = 86_400; // the backend's limit for a duration, a segment's start or played seconds

export type LearningFlag = { userId: string; since: string };
/** One check of the player: what readPlayback saw, when, and in which document. */
export type PlaybackSample = PlaybackReading & { at: number; documentId: string };
/** What the next check is compared with. `documentId: null` is the moment a video opened, before any check. */
export type PlaybackPoint = { at: number; documentId: string | null; played: number; visible: boolean; ad: boolean };
/** One tab's video while it's measured. Removed when the tab leaves the video, or when the video isn't kept. */
export type Watch = {
  videoId: string;
  /** The previous check, or the moment the video opened; null when unknown (learning turned on mid-video). */
  last: PlaybackPoint | null;
  /** Seconds played while the page was visible and no ad showed. */
  played: number;
  duration: number | null;
  /** The played seconds already sent, or null before the first send. */
  sent: number | null;
  /** What was sent, kept for the one update when the tab leaves the video. */
  signal?: WatchSignal;
};
type Queued = { userId: string; signal: WatchSignal };
type KeyValue = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(keys: string[]): Promise<void>;
};
export type LearningAccount = { userId: string; recordSignal(signal: WatchSignal): Promise<RhythmResult> };
export type LearningEnv = {
  now(): number;
  local: KeyValue;
  session: KeyValue;
  hasYouTubeAccess(): Promise<boolean>;
  alarms: {
    names(): Promise<string[]>;
    create(name: string, when: number, periodMinutes: number): Promise<void>;
    clear(name: string): Promise<void>;
  };
  tabUrl(tabId: number): Promise<string | undefined>;
  /** Runs readPlayback in the tab; null when the page doesn't (yet) show that video or can't be read. */
  sample(tabId: number, videoId: string): Promise<PlaybackSample | null>;
  read(tabId: number, videoId: string): Promise<WatchSignal | null>;
  /** The signed-in Clerk user, or null when signed out. */
  account(): Promise<LearningAccount | null>;
};

/** Everything the local check and the server's check look at. */
export const signalText = (signal: WatchSignal) => [
  signal.metadata.title, signal.metadata.descriptionExcerpt, ...(signal.transcript?.segments ?? []).map((s) => s.text),
].filter(Boolean).join(' ');

/**
 * At most `max` displayed segments (60 for learning), in order, within the backend's limits (so a send can't be
 * refused as invalid).
 */
export function transcriptExcerpt(segments: TranscriptSegment[], max = MAX_SEGMENTS): TranscriptSegment[] {
  const kept: TranscriptSegment[] = [];
  let characters = 0;
  for (const segment of [...segments].sort((a, b) => a.startSeconds - b.startSeconds)) {
    const text = segment.text.trim().slice(0, 1500);
    if (!text || !(segment.startSeconds >= 0 && segment.startSeconds <= MAX_SECONDS)) continue;
    if (kept.length >= max || characters + text.length > MAX_TRANSCRIPT_CHARACTERS) break;
    kept.push({ startSeconds: segment.startSeconds, text });
    characters += text.length;
  }
  return kept;
}

/**
 * The played seconds that count between two checks: the growth of the video's `played` ranges, and only if the page
 * was visible and no ad was showing at both checks. Played ranges don't grow when you skip, seek or replay, and they
 * restart when the player loads a new source (for example after an ad), which counts as no growth.
 */
export function playedGrowth(previous: PlaybackPoint | null, current: PlaybackPoint): number {
  if (!previous) return 0; // No baseline yet: this check becomes one.
  if (previous.documentId !== null && previous.documentId !== current.documentId) return 0; // Reloaded: start again.
  if (!previous.visible || !current.visible || previous.ad || current.ad) return 0;
  const growth = current.played - previous.played;
  if (!(growth > 0)) return 0;
  return Math.min(growth, Math.max(0, current.at - previous.at) / 1000 * MAX_PLAYBACK_RATE);
}

/** Visible played seconds before a video is sent: a minute, or 40% of a video shorter than 150 s. */
export function sendThreshold(durationSeconds: number | null): number {
  return durationSeconds && durationSeconds > 0 && durationSeconds < SHORT_VIDEO_SECONDS
    ? durationSeconds * SHORT_VIDEO_SHARE : SEND_AT_SECONDS;
}

const point = (sample: PlaybackSample): PlaybackPoint =>
  ({ at: sample.at, documentId: sample.documentId, played: sample.played, visible: sample.visible, ad: sample.ad });
const engagement = (played: number) => ({ playedSeconds: Math.min(MAX_SECONDS, Math.round(played)) });

export function createLearningObserver(env: LearningEnv) {
  // One step at a time, so two tabs on the same video can't both send it.
  let chain = Promise.resolve();
  const serial = (task: () => Promise<void>): Promise<void> => (chain = chain.then(task).catch(() => undefined));

  async function enabled(): Promise<LearningFlag | null> {
    const flag = await env.local.get<LearningFlag>(LEARN_KEY);
    if (!flag?.userId) return null;
    return await env.hasYouTubeAccess() ? flag : null;
  }
  const seen = async () => await env.session.get<string[]>(SEEN_KEY) ?? [];
  const watches = async () => await env.session.get<Record<string, Watch>>(WATCH_KEY) ?? {};
  async function saveWatch(tabId: number, watch: Watch | null) {
    const all = await watches();
    if (!watch && !(tabId in all)) return;
    if (watch) all[tabId] = watch; else delete all[tabId];
    if (Object.keys(all).length) await env.session.set(WATCH_KEY, all);
    else await env.session.remove([WATCH_KEY]);
  }
  async function tabAlarms(tabId: number) {
    return (await env.alarms.names()).filter((name) => name.startsWith(`${ALARM_PREFIX}${tabId}:`));
  }
  async function stopWatching(tabId: number) {
    for (const name of await tabAlarms(tabId)) await env.alarms.clear(name);
    await saveWatch(tabId, null);
  }
  async function reset(forgetFlag: boolean) {
    if (forgetFlag) await env.local.remove([LEARN_KEY]);
    for (const name of await env.alarms.names()) if (name.startsWith(ALARM_PREFIX)) await env.alarms.clear(name);
    await env.session.remove([QUEUE_KEY, SEEN_KEY, WATCH_KEY]);
  }

  /** Sends the new video and anything queued for this account; keeps failures (at most 20) for the next send. */
  async function deliver(account: LearningAccount, signal: WatchSignal) {
    const now = env.now();
    const queued = (await env.session.get<Queued[]>(QUEUE_KEY) ?? []).filter((item) =>
      item.userId === account.userId && now - Date.parse(item.signal.capturedAt) < MAX_QUEUED_AGE_MS
      // A newer measurement of the same video replaces a queued one, so the video is sent once.
      && item.signal.metadata.videoId !== signal.metadata.videoId);
    const keep: Queued[] = [];
    let offline = false;
    for (const item of [...queued, { userId: account.userId, signal }]) {
      if (offline) { keep.push(item); continue; }
      let result: RhythmResult;
      try {
        result = await account.recordSignal(item.signal);
      } catch {
        keep.push(item); // Offline, signed out mid-way or a server error: try again with the next send.
        offline = true;
        continue;
      }
      if (result.status === 'permission_required') {
        // Learning was turned off for this account elsewhere, e.g. on the phone. Stop here; the panel shows it.
        await reset(true);
        return;
      }
      if (result.status === 'budget_exceeded') break; // Today's limit: drop the rest rather than retry all day.
      // ok, irrelevant (the server's own check) and stale_context are final.
    }
    await env.session.set(QUEUE_KEY, keep.slice(-MAX_QUEUE));
  }

  /** The tab left its video: stop checking it and, if it was sent and grew by a minute since, send the total once more. */
  async function leave(tabId: number) {
    const watch = (await watches())[tabId];
    await stopWatching(tabId);
    if (!watch || watch.sent === null || !watch.signal || !watch.last) return;
    if (watch.played - watch.sent < UPDATE_AFTER_SECONDS) return;
    const flag = await enabled();
    if (!flag) return;
    const account = await env.account();
    if (!account || account.userId !== flag.userId) return;
    // capturedAt: the last check, when the tab still showed this video and its played time was measured.
    await deliver(account, {
      ...watch.signal, capturedAt: new Date(watch.last.at).toISOString(), engagement: engagement(watch.played),
    });
  }

  return {
    /**
     * A tab's URL or loading state changed. Leaving a video ends its checks (see leave). A new watch page starts a
     * repeating check. `active` is whether the tab was in front when the video opened; undefined when unknown
     * (a video already open when learning was turned on), in which case the first check is only a baseline.
     */
    tabChanged: (tabId: number, url: string | undefined, active?: boolean) => serial(async () => {
      const id = url ? videoId(url) : null;
      if (id && (await watches())[tabId]?.videoId === id) return; // Same video: keep measuring it.
      await leave(tabId);
      if (!id || !await enabled() || (await seen()).includes(id)) return;
      const now = env.now();
      // A video that just opened has played nothing yet. Whether the first 30 s count depends on the tab being in front.
      const last = active === undefined ? null : { at: now, documentId: null, played: 0, visible: active, ad: false };
      await saveWatch(tabId, { videoId: id, last, played: 0, duration: null, sent: null });
      await env.alarms.create(`${ALARM_PREFIX}${tabId}:${id}`, now + CHECK_MS, CHECK_MINUTES);
    }),

    tabClosed: (tabId: number) => serial(() => leave(tabId)),

    /** A check: measure visible playback; at the threshold, read, screen locally and send only a matching video. */
    alarm: (name: string) => serial(async () => {
      if (!name.startsWith(ALARM_PREFIX)) return;
      const [tab, id] = name.slice(ALARM_PREFIX.length).split(':');
      const tabId = Number(tab);
      if (!Number.isInteger(tabId) || !id) { await env.alarms.clear(name); return; }
      const flag = await enabled();
      if (!flag) { await reset(false); return; } // Learning is off in this browser: no checks may remain.
      const watch = (await watches())[tabId];
      if (watch?.videoId !== id) { await env.alarms.clear(name); return; }
      if (videoId(await env.tabUrl(tabId) ?? '') !== id) { await leave(tabId); return; } // Moved on unnoticed.
      const sample = await env.sample(tabId, id);
      if (!sample) return; // Still loading or between videos: try again at the next check.
      const played = watch.played + playedGrowth(watch.last, point(sample));
      const next: Watch = { ...watch, played, last: point(sample), duration: sample.duration ?? watch.duration };
      if (next.sent !== null || played < sendThreshold(next.duration)) { await saveWatch(tabId, next); return; }
      const account = await env.account();
      if (!account || account.userId !== flag.userId) { await stopWatching(tabId); return; } // Signed out, or another account.
      const signal = await env.read(tabId, id);
      if (!signal || signal.metadata.videoId !== id || !keptVideo(signalText(signal))) {
        await stopWatching(tabId); // Stays in the browser, and nothing about it is kept.
        return;
      }
      if ((await enabled())?.userId !== flag.userId) return; // Turned off while reading.
      await env.session.set(SEEN_KEY, [...(await seen()), id].slice(-MAX_SEEN));
      await saveWatch(tabId, { ...next, sent: played, signal });
      await deliver(account, { ...signal, engagement: engagement(played) });
    }),

    /** Learning was turned off here, the permission was removed, or the account changed. */
    stop: (forgetFlag = false) => serial(() => reset(forgetFlag)),
  };
}
export type LearningObserver = ReturnType<typeof createLearningObserver>;

/** The real browser, for the service worker. */
export function chromeLearningEnv(account: () => Promise<LearningAccount | null>): LearningEnv {
  const area = (storage: chrome.storage.StorageArea): KeyValue => ({
    get: async <T>(key: string) => (await storage.get(key))[key] as T | undefined,
    set: (key, value) => storage.set({ [key]: value }),
    remove: (keys) => storage.remove(keys),
  });
  return {
    now: () => Date.now(),
    local: area(chrome.storage.local),
    session: area(chrome.storage.session),
    hasYouTubeAccess: () => chrome.permissions.contains(YOUTUBE_ACCESS),
    alarms: {
      names: async () => (await chrome.alarms.getAll()).map((alarm) => alarm.name),
      create: (name, when, periodInMinutes) => chrome.alarms.create(name, { when, periodInMinutes }),
      clear: async (name) => { await chrome.alarms.clear(name); },
    },
    tabUrl: async (tabId) => (await chrome.tabs.get(tabId).catch(() => undefined))?.url,
    sample: samplePlayback,
    read: readWatchedVideo,
    account,
  };
}

/** One check: readPlayback in the isolated world. Numbers and flags only; no page text. */
async function samplePlayback(tabId: number, id: string): Promise<PlaybackSample | null> {
  const [shown] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: readPlayback, args: [id],
  }).catch(() => []);
  return shown?.result && shown.documentId ? { ...shown.result, at: Date.now(), documentId: shown.documentId } : null;
}

/** The same readers as "Use this page", in the isolated world. They never click, scroll or open the transcript. */
async function readWatchedVideo(tabId: number, id: string): Promise<WatchSignal | null> {
  const [page] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: readMetadata, args: [id],
  }).catch(() => []);
  if (!page?.result || !page.documentId) return null;
  const [shown] = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [page.documentId] }, world: 'ISOLATED', func: readDisplayedTranscript,
    args: [{ videoId: id, pageRef: 'learning', expiresAt: new Date(Date.now() + 15_000).toISOString() }],
  }).catch(() => []);
  const segments = shown?.documentId === page.documentId ? transcriptExcerpt(shown.result?.segments ?? []) : [];
  const { metadata } = page.result;
  const duration = metadata.durationSeconds;
  return {
    metadata: { ...metadata, durationSeconds: duration !== null && duration <= MAX_SECONDS ? duration : null },
    capturedAt: page.result.capturedAt,
    ...(segments.length ? { transcript: { segments } } : {}),
  };
}

/** Turning learning off in this browser: no flag, no YouTube access, nothing queued, measured or remembered. */
export async function stopLearningHere() {
  await chrome.storage.local.remove(LEARN_KEY);
  await chrome.permissions.remove(YOUTUBE_ACCESS).catch(() => false);
  await chrome.storage.session.remove([QUEUE_KEY, SEEN_KEY, WATCH_KEY]);
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name.startsWith(ALARM_PREFIX)) await chrome.alarms.clear(alarm.name);
  }
}
