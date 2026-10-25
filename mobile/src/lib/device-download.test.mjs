import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice, downloadUrl } from './device-download.ts';

test('platform detection covers desktop, phone and iPad desktop mode, with an honest unknown', () => {
  assert.equal(detectDevice('Mozilla Windows NT 10.0', 'Win32'), 'windows');
  assert.equal(detectDevice('Mozilla Macintosh', 'MacIntel', 0), 'mac');
  assert.equal(detectDevice('Mozilla Macintosh', 'MacIntel', 5), 'iphone');
  assert.equal(detectDevice('Mozilla iPhone', 'iPhone'), 'iphone');
  assert.equal(detectDevice('Mozilla Linux Android', 'Linux'), 'android');
  assert.equal(detectDevice('', 'Android'), 'android');
  assert.equal(detectDevice('Linux x86_64', 'Linux'), 'other');
  assert.equal(detectDevice(), 'other');
});
test('downloads are unavailable until a valid HTTPS release link is configured', () => {
  for (const value of [undefined, '', '/fake.dmg', 'http://example.com/app', 'javascript:alert(1)', 'https://key@example.com/app']) assert.equal(downloadUrl(value), null);
  assert.equal(downloadUrl('https://example.com/rhythm.dmg'), 'https://example.com/rhythm.dmg');
});
