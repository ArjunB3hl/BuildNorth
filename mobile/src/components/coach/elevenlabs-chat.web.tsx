import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Conversation as Session } from '@elevenlabs/client';
import { Button, Notice, TextField } from '@/components/form';
import { ThemedText as Text } from '@/components/themed-text';
import { Card, errorMessage } from '@/components/ui';
import { useApi } from '@/hooks/use-api';

export function ElevenLabsChat() {
  const api = useApi();
  const session = useRef<Session | null>(null), epoch = useRef(0), pending = useRef(false), closing = useRef(false);
  const release = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState('Disconnected'), [error, setError] = useState(''), [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<{ source: string; message: string }[]>([]), [draft, setDraft] = useState('');
  async function stop() {
    epoch.current++; setConnected(false); setStatus('Ending…');
    if (closing.current) return;
    closing.current = true;
    const current = session.current; session.current = null;
    const releaseThisSession = release.current; release.current = null;
    try { await current?.endSession(); } catch { /* Release even after a network disconnect. */ }
    finally {
      releaseThisSession?.(); closing.current = false;
      if (!pending.current) setStatus('Disconnected');
    }
  }
  useEffect(() => {
    const close = () => { void stop(); };
    window.addEventListener('pagehide', close);
    return () => { window.removeEventListener('pagehide', close); void stop(); };
  }, []);
  async function start(textOnly: boolean) {
    if (pending.current || closing.current || session.current) return;
    pending.current = true;
    const ticket = ++epoch.current;
    setError(''); setStatus('Connecting…');
    try {
      if (navigator.locks) {
        const held = await new Promise<boolean>((resolve, reject) => {
          void navigator.locks.request('buildnorth-camera-workout', { ifAvailable: true }, async lock => {
            if (!lock) { resolve(false); return; }
            await new Promise<void>(done => { release.current = done; resolve(true); });
          }).catch(reject);
        });
        if (!held) throw new Error('A camera workout or voice conversation is open in another tab. End it first.');
      }
      if (ticket !== epoch.current) { release.current?.(); release.current = null; return; }
      const { signedUrl } = await api.connections.elevenLabsSession();
      if (ticket !== epoch.current) return;
      const { Conversation } = await import('@elevenlabs/client');
      if (ticket !== epoch.current) return;
      const created = await Conversation.startSession({ signedUrl, textOnly, connectionType: 'websocket',
        onMessage: ({ source, message }) => { if (ticket === epoch.current) setMessages(m => [...m.slice(-39), { source, message }]); },
        onModeChange: ({ mode }) => { if (ticket === epoch.current) setStatus(mode === 'speaking' ? 'Speaking' : textOnly ? 'Connected · text' : 'Listening'); },
        onError: () => { if (ticket === epoch.current) { setError('The agent connection failed. Check its permissions, quota and allowed domains.'); void stop(); } },
        onDisconnect: () => { if (ticket === epoch.current) void stop(); },
      });
      if (ticket !== epoch.current) { await created.endSession(); return; }
      session.current = created; setConnected(true); setStatus(textOnly ? 'Connected · text' : 'Listening');
    } catch (e) {
      if (ticket === epoch.current) { setError(errorMessage(e)); await stop(); }
    } finally {
      pending.current = false;
      if (ticket !== epoch.current && !closing.current) setStatus('Disconnected');
    }
  }
  return <Card style={{ gap: 12 }}>
    <Text type="subtitle">Your ElevenLabs agent</Text>
    <Text type="small" themeColor="textSecondary">{status}. Voice uses your microphone and ElevenLabs minutes. Text also uses your agent plan. The conversation stays with ElevenLabs; Calendar changes require the agent’s Rhythm MCP connection.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button title="Start voice" size="small" disabled={status !== 'Disconnected'} onPress={() => void start(false)} />
      <Button title="Start text" size="small" variant="secondary" disabled={status !== 'Disconnected'} onPress={() => void start(true)} />
      {status !== 'Disconnected' ? <Button title="End conversation" size="small" variant="secondary" onPress={() => void stop()} /> : null}
    </View>
    {error ? <Notice tone="error">{error}</Notice> : null}
    {messages.map((m, i) => <Text key={i} type="small">{m.source === 'ai' ? 'Coach' : 'You'}: {m.message}</Text>)}
    {connected ? <View style={{ gap: 8 }}>
      <TextField label="Message your agent" value={draft} onChangeText={setDraft} maxLength={2000} />
      <Button title="Send to ElevenLabs" size="small" disabled={!draft.trim()} onPress={() => { session.current?.sendUserMessage(draft.trim()); setDraft(''); }} />
    </View> : null}
  </Card>;
}
