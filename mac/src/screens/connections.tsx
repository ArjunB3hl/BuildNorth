import Constants from 'expo-constants';
import { useState } from 'react';
import { Linking } from 'react-native';

import { Button, Card, Notice, Row, Screen, SectionHeader, TextField, ThemedText } from '../components/ui';
import { useDemoClaude } from '../lib/claude-demo';
import { useNav } from '../navigation';

export function ConnectionsScreen() {
  const claude = useDemoClaude(), nav = useNav();
  const [key, setKey] = useState(''), [model, setModel] = useState('claude-opus-5-5');
  const [website, setWebsite] = useState<string>(Constants.expoConfig?.extra?.buildNorthWebUrl || 'http://localhost:8081');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function open(url: string) {
    try { await Linking.openURL(url); }
    catch { setError('The page could not be opened. Try opening it in your browser.'); }
  }
  async function connect() {
    setBusy(true); setError('');
    const secret = key.trim(); setKey('');
    try { await claude.connect(secret, model.trim()); }
    catch (e) { setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Verification timed out or was cancelled. Try again.'); }
    finally { setBusy(false); }
  }
  function setupAccount() {
    try {
      const origin = website.trim().replace(/\/+$/, '');
      if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1|\[::1\]))(:\d{1,5})?$/i.test(origin)) throw new Error();
      open(`${origin}/profile/connections`);
    } catch { setError('Enter an HTTPS Rhythm website address, or localhost for this demo.'); }
  }
  return <Screen title="AI connections" subtitle="Your assistants, on every device">
    {error ? <Notice tone="error">{error}</Notice> : null}
    <SectionHeader title="Claude for the Mac demo Coach" />
    <Card>
      <ThemedText>Attach an Anthropic API key to chat with Claude using this Mac’s demo profile, Calendar and preferences.</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">Your key is held in memory until you disconnect or quit. It is sent only to Anthropic, never saved in the Mac database. API usage is billed to the key’s account; a Claude subscription is separate.</ThemedText>
      {claude.connection ? <Notice tone="success">Claude ready · key ending {claude.connection.hint} · {claude.connection.model}</Notice> : null}
      <TextField label="Claude API key" value={key} onChangeText={setKey} secureTextEntry autoCorrect={false} autoCapitalize="none" autoComplete="off" placeholder="sk-ant-…" maxLength={500} editable={!busy} />
      <TextField label="Claude model" value={model} onChangeText={setModel} autoCorrect={false} autoCapitalize="none" maxLength={100} editable={!busy} />
      <Row>
        <Button title={busy ? 'Verifying…' : 'Verify and connect Claude'} onPress={connect} disabled={busy || !key.trim()} />
        {claude.connection ? <Button title="Disconnect Claude" variant="secondary" onPress={() => { claude.disconnect(); setKey(''); setError(''); }} /> : null}
        <Button title="Open Coach" variant="secondary" onPress={() => nav.go('coach')} />
      </Row>
      <Button title="Get an API key" variant="quiet" onPress={() => open('https://platform.claude.com/settings/keys')} />
    </Card>
    <SectionHeader title="Connect your ChatGPT or Claude account" />
    <Card>
      <ThemedText>Set up Rhythm in your assistant to use your signed-in web and phone data. Complete setup in your browser, then use that account in the assistant’s supported apps.</ThemedText>
      <Notice tone="info">This Mac keeps its Calendar in local demo mode. Account connectors read your web account’s data, not this Mac’s sample data. The Claude demo Coach above uses this Mac’s data directly.</Notice>
      <TextField label="Rhythm website" value={website} onChangeText={setWebsite} autoCapitalize="none" autoCorrect={false} placeholder="https://your-buildnorth-website" />
      <Button title="Set up account connections" onPress={setupAccount} />
      <ThemedText type="small" themeColor="textSecondary">On the website, copy the Rhythm connector address. If it is local, external assistants will become available after deployment to public HTTPS.</ThemedText>
    </Card>
    <Card>
      <ThemedText type="subtitle">ChatGPT</ThemedText>
      <ThemedText>Open Plugins → + → Add custom MCP server. Paste Rhythm’s public connector address, select OAuth, install it, and sign in with your Rhythm account.</ThemedText>
      <Button title="Open ChatGPT setup" variant="secondary" onPress={() => open('https://chatgpt.com/plugins')} />
    </Card>
    <Card>
      <ThemedText type="subtitle">Claude</ThemedText>
      <ThemedText>Open Customize → Connectors → Add → Custom → Web. Paste Rhythm’s public connector address, choose Sign in now and Claude’s published identity, then sign in with Rhythm.</ThemedText>
      <Button title="Open Claude connectors" variant="secondary" onPress={() => open('https://claude.ai/customize/connectors')} />
    </Card>
  </Screen>;
}
