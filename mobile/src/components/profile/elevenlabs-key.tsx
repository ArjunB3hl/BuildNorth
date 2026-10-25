import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Button, Notice, TextField } from '@/components/form';
import { ActionRow } from './controls';
import { SectionCard } from './section';
import { ThemedText as Text } from '@/components/themed-text';
import { errorMessage } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { API_URL } from '@/lib/api';
import { secretTransportAllowed } from '@/lib/assistant-setup';

export function ElevenLabsKeyConnection() {
  const api = useApi(), cache = useQueryClient();
  const status = useQuery({ queryKey: ['elevenlabs-connection'], queryFn: api.connections.elevenlabs });
  const [key, setKey] = useState(''), [agent, setAgent] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const transport = secretTransportAllowed(API_URL);
  async function save(remove = false) {
    if (!transport) return;
    setBusy(true); setError(''); const secret = key.trim(); setKey('');
    try {
      if (remove) await api.connections.disconnectElevenLabs();
      else await api.connections.connectElevenLabs(secret, agent.trim());
      setAgent('');
      await cache.invalidateQueries({ queryKey: ['elevenlabs-connection'] });
      await cache.invalidateQueries({ queryKey: ['ai-access'] });
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <SectionCard title="ElevenLabs voice agent" description="Connect your own ElevenLabs agent for browser voice conversations and camera coaching. The same connection is available when you sign in on another device.">
    <Text type="small" themeColor="textSecondary">Your API key is verified, encrypted on the server, and never sent to the camera page. Verification uses no conversation minutes. Starting a conversation uses your ElevenLabs plan; voice and transcripts are processed by ElevenLabs.</Text>
    {status.data?.configured ? <Notice tone={status.data.usable ? 'success' : 'warning'}>{status.data.agentName} · key ending {status.data.hint} · {status.data.usable ? 'Connected' : 'Reconnect required'}</Notice> : null}
    {!transport ? <Notice tone="warning">Use HTTPS or this computer’s localhost before entering a key.</Notice> : null}
    <TextField label="ElevenLabs API key" accessibilityLabel="ElevenLabs API key" value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={500} editable={transport && !busy} />
    <TextField label="ElevenLabs agent ID" accessibilityLabel="ElevenLabs agent ID" value={agent} onChangeText={setAgent} autoCapitalize="none" autoCorrect={false} maxLength={100} placeholder="agent_…" editable={!busy} />
    <Text type="small" themeColor="textSecondary">Use a key with access to this agent and Conversational AI. Set the agent’s allowed domains to your Rhythm website. To let the agent read or propose changes to Calendar, also add the Rhythm MCP connection below.</Text>
    {error || status.isError ? <Notice tone="error">{error || errorMessage(status.error)}</Notice> : null}
    <ActionRow>
      <Button title="Verify and connect ElevenLabs" size="small" loading={busy} disabled={!key.trim() || !agent.trim() || !transport || !status.data?.storageAvailable || busy} onPress={() => void save()} />
      {status.data?.configured ? <Button title="Remove ElevenLabs key" size="small" variant="secondary" disabled={busy} onPress={() => void save(true)} /> : null}
      <Button title="Open ElevenLabs agents" size="small" variant="quiet" onPress={() => void Linking.openURL('https://elevenlabs.io/app/agents').catch(() => setError('Open elevenlabs.io in your browser.'))} />
    </ActionRow>
  </SectionCard>;
}
