import type { TranscriptUpload, VideoMetadata } from '../../mobile/src/lib/rhythm';

/**
 * Injected in Chrome's ISOLATED world. Must be self-contained (executeScript serializes it).
 * Selectors observed on www.youtube.com in isolated Chrome on 2026-10-21.
 * Fail closed on an unsupported layout; never fall back to whole-page text or player internals.
 */
export function readMetadata(expectedVideoId: string): { metadata: VideoMetadata; capturedAt: string } | null {
  const url = new URL(location.href);
  if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch' || url.searchParams.get('v') !== expectedVideoId) return null;
  const root = document.querySelector<HTMLElement>('ytd-watch-metadata');
  if (!root || root.getAttribute('video-id') !== expectedVideoId) return null;
  const visible = (element: HTMLElement | null): boolean =>
    !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const text = (selector: string, maximum: number): string | null => {
    const element = root.querySelector<HTMLElement>(selector);
    return visible(element) ? element!.innerText.trim().slice(0, maximum) : null;
  };
  // The collapsed #snippet-text is YouTube's own displayed excerpt, not the hidden full description.
  const excerpt = root.hasAttribute('description-collapsed')
    ? text('#description-inline-expander #snippet-text', 1200)
    : text('#description-inline-expander #expanded', 1200) ?? text('#description-inline-expander #snippet-text', 1200);
  const player = document.querySelector<HTMLElement>('#movie_player');
  const video = player?.querySelector<HTMLVideoElement>('video');
  // During ads or before the duration is known, leave it missing.
  const duration = player && !player.classList.contains('ad-showing') && video && Number.isFinite(video.duration)
    ? video.duration : null;
  return {
    metadata: {
      videoId: expectedVideoId, canonicalUrl: `https://www.youtube.com/watch?v=${expectedVideoId}`,
      title: text('h1', 300), channelName: text('#owner #channel-name a', 150),
      descriptionExcerpt: excerpt, durationSeconds: duration,
    },
    capturedAt: new Date().toISOString(),
  };
}

/** What learning's check reads from the player: numbers and flags only, never page text. */
export type PlaybackReading = {
  /** Seconds of this video actually played: the total of the <video>'s `played` ranges, so skipped parts don't count. */
  played: number;
  /** Unknown (null) while an ad plays or before the player knows it. */
  duration: number | null;
  visible: boolean;
  paused: boolean;
  ad: boolean;
};

/**
 * Injected in Chrome's ISOLATED world at each of learning's checks (self-contained). Reads the main <video>'s
 * `played` ranges, `paused` and `duration`, whether the page is visible, and whether YouTube is showing an ad.
 * No clicks, player APIs, listeners or network requests. Null unless the page shows the expected video.
 */
export function readPlayback(expectedVideoId: string): PlaybackReading | null {
  const url = new URL(location.href);
  if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch' || url.searchParams.get('v') !== expectedVideoId) return null;
  if (document.querySelector('ytd-watch-metadata')?.getAttribute('video-id') !== expectedVideoId) return null;
  const player = document.querySelector<HTMLElement>('#movie_player');
  const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video') ?? player?.querySelector<HTMLVideoElement>('video');
  if (!player || !video) return null;
  let played = 0;
  for (let i = 0; i < video.played.length; i++) played += Math.max(0, video.played.end(i) - video.played.start(i));
  const ad = player.classList.contains('ad-showing');
  return {
    played: Number.isFinite(played) ? played : 0,
    duration: !ad && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
    visible: document.visibilityState === 'visible',
    paused: video.paused,
    ad,
  };
}

/**
 * For a transcript read you asked for, on the video you chose: presses YouTube's own "Show transcript" button (in the
 * video's description) when no transcript panel is open, then waits up to 10 s for timestamped rows. An open panel is
 * left as it is. Returns whether this call opened it, so the read can close it again, or null if the page shows
 * another video. Injected functions are serialized, so selectors are repeated here rather than shared.
 */
export async function openTranscriptPanel(expectedVideoId: string): Promise<{ opened: boolean } | null> {
  const open = () => [...document.querySelectorAll<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
  )].find((e) => e.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' && e.getClientRects().length > 0);
  if (new URL(location.href).searchParams.get('v') !== expectedVideoId
      || document.querySelector('ytd-watch-metadata')?.getAttribute('video-id') !== expectedVideoId) return null;
  if (open()) return { opened: false };
  // No button: the video has no transcript or the layout changed. The read then reports it as unavailable.
  const button = document.querySelector<HTMLButtonElement>('ytd-video-description-transcript-section-renderer button');
  if (!button) return { opened: false };
  button.click();
  const clock = /^(?:\d{1,2}:)?\d{1,3}:[0-5]\d$/m;
  for (let waited = 0; waited < 10_000; waited += 250) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (clock.test(open()?.querySelector<HTMLElement>(':scope > #content')?.innerText ?? '')) break;
  }
  return { opened: true };
}

/** Closes the transcript panel that openTranscriptPanel opened, with the panel's own Close button. */
export function closeTranscriptPanel(): void {
  for (const panel of document.querySelectorAll<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
  )) {
    if (panel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
      panel.querySelector<HTMLButtonElement>('#visibility-button button')?.click();
    }
  }
}

/**
 * Reads ONLY a displayed transcript panel (openTranscriptPanel opens it first for a read you asked for). No clicks,
 * scrolling, network requests, player APIs, cookies or cross-window messaging. The panel selectors were observed live;
 * timestamp rows use their displayed text rather than undocumented player response objects.
 * Without an independently observable row count we deliberately report partial coverage.
 */
export function readDisplayedTranscript(args: {
  videoId: string; pageRef: string; expiresAt: string;
}): TranscriptUpload | null {
  if (Date.now() >= Date.parse(args.expiresAt)) return null;
  const url = new URL(location.href);
  const metadata = document.querySelector('ytd-watch-metadata');
  if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch'
      || url.searchParams.get('v') !== args.videoId || metadata?.getAttribute('video-id') !== args.videoId) return null;
  const result: TranscriptUpload = {
    videoId: args.videoId, pageRef: args.pageRef, source: 'youtube_displayed',
    language: null, completeness: 'unavailable', capturedAt: new Date().toISOString(), segments: [],
    observedStart: false, observedEnd: false, virtualized: true, totalVisibleRows: 0,
    limitation: 'YouTube’s transcript for this video couldn’t be opened or read. It may have no captions, still be loading, or use an unsupported layout.',
  };
  const panel = [...document.querySelectorAll<HTMLElement>(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
    'ytd-engagement-panel-section-list-renderer[target-id="PAmodern_transcript_view"]',
  )].find((e) => e.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'
    && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
  const content = panel?.querySelector<HTMLElement>(':scope > #content');
  if (!content) return result;
  const clock = /^(?:\d{1,2}:)?\d{1,3}:[0-5]\d$/;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT);
  const seen = new Set<string>();
  const rowElements = new Set<HTMLElement>();
  let scanned = 0, characters = 0;
  while (walker.nextNode() && scanned++ < 6000 && result.segments.length < 1500) {
    const element = walker.currentNode as HTMLElement;
    // Inspect a small leaf with a timestamp, then at most three of its ancestors within the panel.
    if (element.children.length || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
    const timestamp = element.innerText?.trim();
    if (!timestamp || !clock.test(timestamp)) continue;
    let row: HTMLElement | null = element.parentElement;
    for (let depth = 0; row && row !== content && depth < 3; depth++, row = row.parentElement) {
      const lines = row.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.filter((line) => clock.test(line)).length !== 1) break;
      const text = lines.filter((line) => !clock.test(line)).join(' ').trim();
      if (!text) continue;
      if (text.length > 1500 || characters + text.length > 100_000) break;
      const startSeconds = timestamp.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
      const key = `${startSeconds}\0${text}`;
      if (!seen.has(key)) {
        result.segments.push({ startSeconds, text }); seen.add(key); characters += text.length; rowElements.add(row);
      }
      break;
    }
  }
  result.segments.sort((a, b) => a.startSeconds - b.startSeconds);
  if (!result.segments.length) return result;
  result.totalVisibleRows = result.segments.length;
  const declaredLanguage = content.getAttribute('lang');
  if (declaredLanguage && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(declaredLanguage)) result.language = declaredLanguage;
  // An explicit ARIA set size + every position provides coverage evidence. Typical YouTube
  // layouts don't provide it, so their rendered segments are honestly marked partial.
  const rows = [...rowElements];
  const size = Number(rows[0]?.getAttribute('aria-setsize'));
  const positions = rows.map((r) => Number(r.getAttribute('aria-posinset'))).sort((a, b) => a - b);
  const full = size > 0 && size === rows.length && rows.every((r) => Number(r.getAttribute('aria-setsize')) === size)
    && positions.every((position, i) => position === i + 1) && scanned < 6000 && characters < 100_000;
  result.observedStart = full;
  result.observedEnd = full;
  result.virtualized = !full;
  result.completeness = full ? 'complete' : 'partial';
  result.limitation = full ? '' : 'Only rendered transcript segments were read. Missing or virtualized sections cannot be ruled out.';
  if (Date.now() >= Date.parse(args.expiresAt) || new URL(location.href).searchParams.get('v') !== args.videoId) return null;
  return result;
}
