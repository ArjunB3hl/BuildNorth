import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_RELEASE_URL, demoDownloads, demoDownloadUrl } from './demo-downloads.ts';

const byId = id => demoDownloads.find(item => item.id === id);

test('each download links into its own GitHub release, the demo release by default', () => {
  assert.equal(demoDownloadUrl(byId('mac')), `${DEMO_RELEASE_URL}/Rhythm-macOS-arm64.zip`);
  assert.equal(demoDownloadUrl(byId('windows')), 'https://github.com/ArjunB3hl/BuildNorth/releases/download/windows-v1.0.0-test.1/Rhythm-Windows-x64-test.zip');
  for (const item of demoDownloads) assert.match(demoDownloadUrl(item), /^https:\/\/github\.com\/ArjunB3hl\/BuildNorth\/releases\/download\/[^/]+\/[^/]+$/);
});
test('the Windows test build matches the published asset and says how to trust it', () => {
  const windows = byId('windows');
  assert.equal(windows.bytes, 72635544);
  assert.equal(windows.format, 'ZIP');
  assert.match(windows.note, /self-signed/);
  assert.ok(windows.steps.some(step => step.includes('Install.ps1')));
  assert.equal(new Set(demoDownloads.map(item => item.id)).size, demoDownloads.length);
});
