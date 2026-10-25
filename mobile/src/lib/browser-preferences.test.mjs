import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayCookie, readDisplayPreference } from './browser-preferences.ts';

test('unknown, missing and similarly named cookies never opt a browser in', () => {
  for (const input of ['', 'other=compact', 'buildnorth_display=tracking', 'xbuildnorth_display=compact']) {
    assert.equal(readDisplayPreference(input), null);
  }
  assert.equal(readDisplayPreference('session=opaque; buildnorth_display=compact; other=value'), 'compact');
});

test('preference cookie expires, stays host-only, and can be withdrawn', () => {
  assert.equal(displayCookie('compact', true), 'buildnorth_display=compact; Path=/; Max-Age=2592000; SameSite=Lax; Secure');
  assert.equal(displayCookie(null, false), 'buildnorth_display=; Path=/; Max-Age=0; SameSite=Lax');
});
