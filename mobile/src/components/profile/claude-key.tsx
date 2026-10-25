import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, Notice, TextField } from '@/components/form';
import { ActionRow } from '@/components/profile/controls';
import { SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { errorMessage } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { API_URL } from '@/lib/api';
import { secretTransportAllowed } from '@/lib/assistant-setup';

export function ClaudeKeyConnection() {
  const api = useApi(), queries = useQueryClient(), router = useRouter();
  const status = useQuery({ queryKey: ['claude-connection'], queryFn: api.connections.claude });
  const [key, setKey] = useState(''), [model, setModel] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const transport = secretTransportAllowed(API_URL);
  // The secret stays only in this input until submitted; never put it in query/mutation variables or persistence.
  async function save() {
    if (!transport) return;
    setBusy(true); setError(''); setMessage('');
    const secret = key.trim(); setKey('');
    try {
      await api.connections.connectClaude(secret, model.trim() || status.data?.model || 'claude-opus-5-5');
      await queries.invalidateQueries({ queryKey: ['claude-connection'] });
      setMessage('Key verified. Claude will answer your next Coach message.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(''); setKey(''); setMessage('');
    try {
      await api.connections.disconnectClaude();
      await queries.invalidateQueries({ queryKey: ['claude-connection'] });
      setMessage('Your key was removed. Coach will use the server’s default provider, if available.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <SectionCard title="Claude for the built-in Coach" description="For the demo, bring an Anthropic API key. This powers Coach inside BuildNorth; it does not connect a Claude subscription. API usage is billed to the key’s account.">
    <ThemedText type="small" themeColor="textSecondary">The key is verified without generating a message, encrypted on the BuildNorth server, and shared only across your signed-in web and phone sessions. Remove it when you finish the demo.</ThemedText>
    {status.data?.configured ? <Notice tone={status.data.usable ? 'success' : 'warning'}>Claude key ending in {status.data.hint} · {status.data.model}{status.data.usable ? ' · Ready for Coach' : ' · Reconnect required'}</Notice> : null}
    {!transport ? <Notice tone="warning">Use an HTTPS backend before entering an API key on this device. Localhost on this computer is also supported.</Notice> : null}
    {status.data && !status.data.storageAvailable ? <Notice tone="warning">The server’s secure key storage needs setup before you can attach a key.</Notice> : null}
    <TextField label={status.data?.configured ? 'Replace Claude API key' : 'Claude API key'} value={key} onChangeText={setKey} secureTextEntry
      autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" accessibilityLabel="Claude API key" placeholder="sk-ant-…" maxLength={500} editable={!busy && transport} />
    <TextField label="Claude model" value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false}
      accessibilityLabel="Claude model" placeholder={status.data?.model || 'claude-opus-5-5'} maxLength={100} editable={!busy} />
    {error || status.isError ? <Notice tone="error">{error || errorMessage(status.error)}</Notice> : null}
    {message ? <Notice tone="success">{message}</Notice> : null}
    <ActionRow>
      <Button title="Verify and connect Claude" size="small" onPress={() => void save()} loading={busy} disabled={busy || !key.trim() || !transport || !status.data?.storageAvailable} />
      {status.data?.configured ? <Button title="Remove key" size="small" variant="secondary" onPress={() => void remove()} disabled={busy} /> : null}
      <Button title="Open Coach" size="small" variant="secondary" onPress={() => router.push('/coach')} />
      <Button title="Get an API key" size="small" variant="quiet" onPress={() => void Linking.openURL('https://platform.claude.com/settings/keys').catch(() => setError('Open the Anthropic Console to create a key.'))} />
    </ActionRow>
  </SectionCard>;
}
