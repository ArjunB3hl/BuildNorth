import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../web/js/embed.js';
import { connectAppearance } from '../web/js/embed-appearance.js';

test('host theme follows only validated parent messages; resizing never alters workout state', () => {
  const handlers = {}, sent = [], dataset = {};
  let height = 650, observerCallback, disconnected = false;
  const system = { matches: true, addEventListener: (_, fn) => { handlers.system = fn; }, removeEventListener() {} };
  const parent = { postMessage: (data, origin) => sent.push({ data, origin }) };
  const win = {
    parent, location: { search: '?theme=light' }, matchMedia: () => system,
    document: { documentElement: { dataset }, body: { getBoundingClientRect: () => ({ height }) } },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    ResizeObserver: class { constructor(fn) { observerCallback = fn; } observe() {} disconnect() { disconnected = true; } },
  };
  connectAppearance(win, connect(win, 'http://localhost:8081'));
  assert.equal(dataset.theme, 'light');
  const send = (theme, origin = 'http://localhost:8081', source = parent) => handlers.message({ data: { type: 'pose-coach/theme', theme }, origin, source });
  send('dark', 'http://localhost:9999'); send('dark', 'http://localhost:8081', {}); send('invalid');
  assert.equal(dataset.theme, 'light');
  send('dark'); assert.equal(dataset.theme, 'dark');
  system.matches = false; handlers.system(); assert.equal(dataset.theme, 'dark');
  observerCallback(); assert.equal(sent.length, 1);
  height = 820.2; observerCallback();
  assert.deepEqual(sent.map(x => x.data), [ { type: 'pose-coach/resize', height: 650 }, { type: 'pose-coach/resize', height: 821 } ]);
  assert.ok(sent.every(x => x.origin === 'http://localhost:8081'));
  handlers.pagehide(); assert.equal(disconnected, true);
});
