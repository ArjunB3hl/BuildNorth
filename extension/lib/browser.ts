import { closeTranscriptPanel, openTranscriptPanel, readDisplayedTranscript, readMetadata } from './youtube';
import type { BrowserRequest, TranscriptSegment, TranscriptUpload, VideoMetadata } from '../../mobile/src/lib/rhythm';

export type Invocation = { tabId: number; url: string; invokedAt: number; nonce: string };
export type PageCapture = {
  invocation: Invocation; documentId: string; metadata: VideoMetadata; capturedAt: string;
};
/** The optional host permission that learning asks for (and that "Save to Rhythm" can also use). */
export const YOUTUBE_ACCESS = { origins: ['https://www.youtube.com/*'] };
const OPEN_A_VIDEO = 'Open a YouTube video, then click the Rhythm toolbar icon on that page.';

export function videoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get('v');
    return parsed.origin === 'https://www.youtube.com' && parsed.pathname === '/watch' && /^[\w-]{11}$/.test(id ?? '') ? id : null;
  } catch { return null; }
}

export async function currentInvocation(): Promise<Invocation> {
  const { invocation } = await chrome.storage.session.get<{ invocation?: Invocation }>('invocation');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!invocation || tab?.id !== invocation.tabId || !videoId(invocation.url)
      || videoId(tab.url ?? '') !== videoId(invocation.url)) {
    throw new Error(OPEN_A_VIDEO);
  }
  return invocation;
}

export async function stillSelected(capture: PageCapture): Promise<boolean> {
  try {
    const current = await currentInvocation();
    return current.nonce === capture.invocation.nonce && current.url === capture.invocation.url;
  } catch { return false; }
}

export async function captureMetadata(): Promise<PageCapture> {
  const invocation = await currentInvocation();
  const id = videoId(invocation.url)!;
  const result = await chrome.scripting.executeScript({
    target: { tabId: invocation.tabId, frameIds: [0] }, world: 'ISOLATED', func: readMetadata, args: [id],
  });
  const capture = result[0];
  if (!capture?.result || !capture.documentId) throw new Error('This video is still loading or its page layout is unsupported. Try again when its title is visible.');
  const page = { invocation, documentId: capture.documentId, ...capture.result };
  if (!await stillSelected(page)) throw new Error('The page changed during capture. Use the new page explicitly.');
  return page;
}

export type VideoCapture = { metadata: VideoMetadata; capturedAt: string; transcript?: TranscriptSegment[] };

/**
 * YouTube's transcript for the video in this document: opens the panel if it's closed (the Show transcript button a
 * person would press), reads the displayed rows, and closes it again if it opened it. Empty when there is none.
 */
async function readTranscriptOf(tabId: number, documentId: string, id: string): Promise<TranscriptSegment[]> {
  const target = { tabId, documentIds: [documentId] };
  const [opened] = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: openTranscriptPanel, args: [id] });
  try {
    const [read] = await chrome.scripting.executeScript({
      target, world: 'ISOLATED', func: readDisplayedTranscript,
      args: [{ videoId: id, pageRef: 'reaction', expiresAt: new Date(Date.now() + 15_000).toISOString() }],
    });
    return read?.documentId === documentId ? read.result?.segments ?? [] : [];
  } finally {
    if (opened?.result?.opened) await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: closeTranscriptPanel }).catch(() => undefined);
  }
}

/**
 * The video in the active tab, for "Save to Rhythm" and "Not interested". It uses the access the panel already has:
 * the toolbar click's activeTab grant (as "Use this page" does) or, when learning holds it, the optional YouTube
 * permission. It reads the same visible details as "Use this page", and with `withTranscript` (Save to Rhythm) also
 * the video's transcript.
 */
export async function captureCurrentVideo(withTranscript = false): Promise<VideoCapture> {
  const invoked = await currentInvocation().then(() => true, () => false);
  if (invoked) {
    const { metadata, capturedAt, invocation, documentId } = await captureMetadata();
    const transcript = withTranscript ? await readTranscriptOf(invocation.tabId, documentId, metadata.videoId) : undefined;
    if (withTranscript && !await currentInvocation().then((now) => now.nonce === invocation.nonce, () => false)) {
      throw new Error('The page changed while Rhythm read it. Try again.');
    }
    return { metadata, capturedAt, transcript };
  }
  if (!await chrome.permissions.contains(YOUTUBE_ACCESS)) throw new Error(OPEN_A_VIDEO);
  // With the permission, Chrome reports YouTube tab addresses; no `tabs` permission is involved.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = videoId(tab?.url ?? '');
  if (tab?.id === undefined || !id) throw new Error('Open a YouTube video in this window first.');
  const [read] = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', func: readMetadata, args: [id],
  });
  if (!read?.result) throw new Error('This video is still loading or its page layout is unsupported. Try again when its title is visible.');
  const transcript = withTranscript && read.documentId ? await readTranscriptOf(tab.id, read.documentId, id) : undefined;
  const [after] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (after?.id !== tab.id || videoId(after.url ?? '') !== id) throw new Error('The page changed while Rhythm read it. Try again.');
  return { ...read.result, transcript };
}

export async function captureTranscript(page: PageCapture, request: BrowserRequest): Promise<TranscriptUpload | null> {
  if (!await stillSelected(page) || page.metadata.videoId !== request.videoId || Date.now() >= Date.parse(request.expiresAt)) return null;
  const target = { tabId: page.invocation.tabId, documentIds: [page.documentId] };
  // Opens YouTube's transcript panel if it's closed (the button a person would press), reads it, and closes it again.
  const [opened] = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: openTranscriptPanel, args: [request.videoId] });
  try {
    const results = await chrome.scripting.executeScript({
      target, world: 'ISOLATED', func: readDisplayedTranscript,
      args: [{ videoId: request.videoId, pageRef: request.pageRef, expiresAt: request.expiresAt }],
    });
    if (!await stillSelected(page) || results[0]?.documentId !== page.documentId) return null;
    return results[0]?.result ?? null;
  } finally {
    if (opened?.result?.opened) await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: closeTranscriptPanel }).catch(() => undefined);
  }
}
