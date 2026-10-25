import React from 'react';
import { Text, TextInput } from 'react-native';
import Renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import App from '../src/App';

const key = 'sk-ant-api03-MADE-UP-DEMO-ONLY-0001';

function text(app: ReactTestRenderer) {
  return app.root.findAllByType(Text).map(n => [n.props.children].flat(Infinity).join('')).join('\n');
}
async function press(app: ReactTestRenderer, label: string) {
  const target = app.root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  if (!target) throw new Error(`Missing button: ${label}`);
  await act(async () => target.props.onPress());
}

test('Mac demo key verifies, powers Coach and is forgotten on disconnect or a fresh app session', async () => {
  const previous = globalThis.fetch;
  const fetcher = jest.fn().mockImplementation(async (url: string) => ({
    ok: true, status: 200,
    json: async () => url.includes('/models/') ? { id: 'claude-opus-5-5' } : { content: [{ type: 'text', text: 'Try a simple lentil soup.' }] },
  }));
  globalThis.fetch = fetcher;
  let app!: ReactTestRenderer;
  try {
    await act(async () => { app = Renderer.create(<App />); });
    await press(app, 'Coach');
    await press(app, 'Connect Claude or ChatGPT');
    expect(text(app).toLowerCase()).toContain('connect your chatgpt or claude account');
    await act(async () => {
      app.root.findAllByType(TextInput).find(n => n.props.placeholder === 'sk-ant-…')!.props.onChangeText(key);
    });
    await press(app, 'Verify and connect Claude');
    expect(text(app)).toContain('Claude ready');
    expect(app.root.findAllByType(TextInput).find(n => n.props.placeholder === 'sk-ant-…')!.props.value).toBe('');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models/claude-opus-5-5');
    expect(fetcher.mock.calls[0][1].headers['x-api-key']).toBe(key);
    await press(app, 'Open Coach');
    await act(async () => app.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Message to coach')!.props.onChangeText('Suggest dinner.'));
    await press(app, 'Send');
    expect(text(app)).toContain('Try a simple lentil soup.');
    expect(fetcher.mock.calls[1][1].body).not.toContain(key);
    expect(fetcher.mock.calls[1][1].body).toContain('Mac local demo');
    await press(app, 'Claude connected · AI settings');
    await press(app, 'Disconnect Claude');
    expect(text(app)).not.toContain('Claude ready');
    await press(app, 'Open Coach');
    expect(app.root.findAllByType(TextInput).find(n => n.props.accessibilityLabel === 'Message to coach')!.props.editable).toBe(false);
    await act(async () => app.unmount());
    await act(async () => { app = Renderer.create(<App />); });
    await press(app, 'Coach');
    expect(text(app)).toContain('Connect Claude or ChatGPT');
  } finally {
    await act(async () => app?.unmount());
    globalThis.fetch = previous;
  }
});
