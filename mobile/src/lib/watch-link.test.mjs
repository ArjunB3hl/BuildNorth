// Run: node --experimental-strip-types --test src/lib/*.test.mjs   (Node 22.6+; the flag is the default from 23.6)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isActiveToken, linkWatch, newLinkLabel } from './watch-link.ts';

const NOW = new Date('2026-10-21T14:05:00Z');
const DAY = 24 * 60 * 60 * 1000;

function token(id, { label = `Apple Watch ${id}`, revoked = false, expiresIn = 30 * DAY } = {}) {
  return {
    id,
    label,
    hint: id.slice(-4),
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + expiresIn).toISOString(),
    lastUsedAt: null,
    revoked,
  };
}

/** Fake API + WatchConnectivity that record every call in order. */
function fakeSteps({ tokens = [], sendFails = false, revokeFails = [] } = {}) {
  const calls = [];
  const steps = {
    now: () => NOW,
    listTokens: async () => {
      calls.push(['list']);
      return { tokens };
    },
    createToken: async (label) => {
      calls.push(['create', label]);
      return { ...token('new', { label }), token: 'bnw_secret' };
    },
    revokeToken: async (id) => {
      calls.push(['revoke', id]);
      if (revokeFails.includes(id)) throw new Error('offline');
    },
    sendLink: async (plaintext) => {
      calls.push(['send', plaintext]);
      if (sendFails) throw new Error('WatchContextUpdateException');
    },
  };
  return { steps, calls };
}

test('isActiveToken: revoked and expired tokens no longer sign the watch in', () => {
  assert.equal(isActiveToken(token('a'), NOW), true);
  assert.equal(isActiveToken(token('b', { revoked: true }), NOW), false);
  assert.equal(isActiveToken(token('c', { expiresIn: -1 }), NOW), false);
  assert.equal(isActiveToken(token('d', { expiresIn: 0 }), NOW), false);
});

test('newLinkLabel: dated, at most 80 characters and never one an active link already uses', () => {
  const label = newLinkLabel(NOW);
  assert.match(label, /^Apple Watch · /);
  assert.notEqual(label, 'Apple Watch');
  assert.ok(label.length <= 80);
  assert.equal(newLinkLabel(NOW, [label]), `${label} (2)`);
  assert.equal(newLinkLabel(NOW, [label, `${label} (2)`]), `${label} (3)`);
  assert.equal(newLinkLabel(NOW, ['something else']), label);
});

test('linkWatch: revokes the earlier links only after the hand-off succeeds', async () => {
  const old = token('old', { label: newLinkLabel(NOW) });
  const { steps, calls } = fakeSteps({ tokens: [old, token('gone', { revoked: true }), token('stale', { expiresIn: -DAY })] });
  const result = await linkWatch(steps);

  assert.deepEqual(result, { label: `${old.label} (2)`, notRevoked: 0 });
  // The new label differs from the working link's, so minting can't revoke it on the server.
  assert.deepEqual(calls, [
    ['list'],
    ['create', `${old.label} (2)`],
    ['send', 'bnw_secret'],
    ['revoke', 'old'],
  ]);
});

test('linkWatch: a failed hand-off revokes only the new token and keeps the working link', async () => {
  const { steps, calls } = fakeSteps({ tokens: [token('old')], sendFails: true });
  await assert.rejects(linkWatch(steps), /WatchContextUpdateException/);
  assert.deepEqual(
    calls.filter(([name]) => name === 'revoke'),
    [['revoke', 'new']],
  );
});

test('linkWatch: the hand-off error wins even when revoking the new token fails too', async () => {
  const { steps } = fakeSteps({ tokens: [token('old')], sendFails: true, revokeFails: ['new'] });
  await assert.rejects(linkWatch(steps), /WatchContextUpdateException/);
});

test('linkWatch: an earlier link that can\'t be revoked is reported, not fatal', async () => {
  const { steps, calls } = fakeSteps({ tokens: [token('a'), token('b')], revokeFails: ['a'] });
  const result = await linkWatch(steps);
  assert.equal(result.notRevoked, 1);
  assert.deepEqual(
    calls.filter(([name]) => name === 'revoke'),
    [
      ['revoke', 'a'],
      ['revoke', 'b'],
    ],
  );
});

test('linkWatch: nothing is minted when the current links can\'t be read', async () => {
  const { steps, calls } = fakeSteps();
  steps.listTokens = async () => {
    throw new Error('network');
  };
  await assert.rejects(linkWatch(steps), /network/);
  assert.deepEqual(calls, []);
});

test('linkWatch: a first link mints and sends without revoking anything', async () => {
  const { steps, calls } = fakeSteps();
  const result = await linkWatch(steps);
  assert.equal(result.notRevoked, 0);
  assert.deepEqual(
    calls.map(([name]) => name),
    ['list', 'create', 'send'],
  );
});
