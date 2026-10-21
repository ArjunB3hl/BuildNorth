// Linking the Apple Watch without breaking the link it already has. Kept free of React Native imports
// (types only) so src/lib/watch-link.test.mjs can run it under plain Node.
import type { CreatedWatchToken, WatchToken } from '@/lib/types';

const LABEL_MAX = 80; // watch_tokens.label is String(80)

/** Unrevoked and unexpired: the token still signs the watch in. */
export function isActiveToken(token: WatchToken, now: Date = new Date()): boolean {
  return !token.revoked && Date.parse(token.expiresAt) > now.getTime();
}

/**
 * A label for a new link, e.g. "Apple Watch · Oct 21, 2:05 PM", unique among `taken`. The server revokes active
 * links with the same label as soon as it mints a new one, so a fixed label would cut off the watch's working
 * link before the new one has reached it.
 */
export function newLinkLabel(now: Date, taken: Iterable<string> = []): string {
  const when = now.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const base = `Apple Watch · ${when}`.slice(0, LABEL_MAX - 5);
  const used = new Set(taken);
  let label = base;
  for (let n = 2; used.has(label); n++) label = `${base} (${n})`;
  return label;
}

export type LinkSteps = {
  listTokens: () => Promise<{ tokens: WatchToken[] }>;
  createToken: (label: string) => Promise<CreatedWatchToken>;
  revokeToken: (id: string) => Promise<void>;
  /** Hands the plaintext token to the watch. */
  sendLink: (token: string) => Promise<void>;
  now?: () => Date;
};

export type LinkResult = {
  label: string;
  /** Earlier links that are still active because revoking them failed; the list shows them, with Revoke. */
  notRevoked: number;
};

/**
 * Mints a new link, hands it to the watch and only then revokes the links that were active before, so the watch
 * never ends up with nothing that works. If the hand-off fails, only the new token is revoked and the old link
 * keeps working. The plaintext token never leaves this function except to `sendLink`.
 */
export async function linkWatch(steps: LinkSteps): Promise<LinkResult> {
  const now = steps.now?.() ?? new Date();
  const previous = (await steps.listTokens()).tokens.filter((t) => isActiveToken(t, now));
  const created = await steps.createToken(newLinkLabel(now, previous.map((t) => t.label)));
  try {
    await steps.sendLink(created.token);
  } catch (error) {
    // The watch never got it; don't leave a working token behind.
    await steps.revokeToken(created.id).catch(() => undefined);
    throw error;
  }
  const revoked = await Promise.allSettled(previous.map((t) => steps.revokeToken(t.id)));
  return { label: created.label, notRevoked: revoked.filter((r) => r.status === 'rejected').length };
}
