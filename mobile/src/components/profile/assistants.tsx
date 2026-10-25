import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AiOrb } from '@/components/ai-orb';
import { Button, Notice } from '@/components/form';
import { ActionRow, DestructiveButton } from '@/components/profile/controls';
import { CodeBox, Divider, SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup, Pill } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { AgentConnection, Assistant, Capability } from '@/lib/rhythm';

type Step = { text: string; command?: string };
const ASSISTANTS: { id: Assistant; name: string; where: string; open?: { label: string; url: string }; steps: (url: string) => Step[] }[] = [
  {
    id: 'claude', name: 'Claude', where: 'claude.ai and the Claude desktop and mobile apps',
    open: { label: 'Open Claude connectors', url: 'https://claude.ai/customize/connectors' },
    steps: () => [
      { text: 'In Claude, open Customize → Connectors and choose Add custom connector.' },
      { text: 'Name it Rhythm and paste the address above.' },
      { text: 'For authentication choose Sign in now, and Use Claude’s published identity. Choose Add.' },
      { text: 'Choose Connect and sign in with your Rhythm account.' },
    ],
  },
  {
    id: 'chatgpt', name: 'ChatGPT', where: 'ChatGPT on the web and desktop',
    open: { label: 'Open ChatGPT', url: 'https://chatgpt.com/plugins' },
    steps: () => [
      { text: 'In ChatGPT, open Plugins, choose +, then Add custom MCP server.' },
      { text: 'Paste the address above and choose OAuth for authentication. Create it.' },
      { text: 'Sign in with your Rhythm account when ChatGPT asks.' },
    ],
  },
  {
    id: 'codex', name: 'Codex', where: 'the Codex app, CLI and IDE extension (they share one setup)',
    steps: (url) => [
      { text: 'Add Rhythm to Codex:', command: `codex mcp add rhythm --url ${url}` },
      { text: 'Sign in. A browser window opens for your Rhythm account; no token to copy.', command: 'codex mcp login rhythm' },
    ],
  },
];

const local = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);

/**
 * "Connect Claude, ChatGPT or Codex", like a website's "Connect" button: approve the assistant here, then add Rhythm in
 * that assistant and sign in with this account (OAuth). Its first request then works with no further approval.
 */
export function AssistantConnections({ mcpUrl, agents, options, labels, busy, onApprove, onDisconnect, onMessage }: {
  mcpUrl: string | undefined; agents: AgentConnection[]; options: readonly Capability[]; labels: Record<Capability, string>;
  busy: boolean; onApprove: (assistant: Assistant, capabilities: Capability[]) => Promise<boolean>;
  onDisconnect: (agentId: string) => void; onMessage: (message: string) => void;
}) {
  const [capabilities, setCapabilities] = useState<Capability[]>(options.filter((c) => c !== 'memory'));
  const [open, setOpen] = useState<Assistant>();
  const approval = (id: Assistant) => agents.find((a) => a.clientId === `assistant:${id}` && a.status === 'active');
  const copy = async (text: string, what: string) => { await Clipboard.setStringAsync(text); onMessage(`${what} copied.`); };
  const url = mcpUrl ?? '';
  return (
    <SectionCard
      title="Connect Claude, ChatGPT or Codex"
      description="Add Rhythm in your assistant and sign in with your Rhythm account. There’s no token to copy."
      leading={<AiOrb size={32} still />}>
      {url && local(url) ? (
        <Notice tone="warning">
          These assistants reach Rhythm over the internet, but this server’s address only works on this computer. Start the
          tunnel (mobile/scripts/mcp-tunnel.sh), set MCP_PUBLIC_URL in backend/.env to its address, and restart the backend.
        </Notice>
      ) : null}
      <View style={styles.field}>
        <ThemedText type="smallBold">Rhythm’s address for assistants</ThemedText>
        <CodeBox value={url || 'Loading…'} accessibilityLabel="Rhythm connector address" />
        <ActionRow><Button title="Copy address" size="small" variant="secondary" disabled={!url} onPress={() => void copy(url, 'Address')} /></ActionRow>
      </View>
      <View style={styles.field}>
        <ThemedText type="smallBold">What they can use</ThemedText>
        <ChipGroup options={options.map((value) => ({ value, label: labels[value] }))} selected={capabilities}
          onChange={(v) => setCapabilities(v as Capability[])} />
      </View>
      {ASSISTANTS.map((assistant) => {
        const approved = approval(assistant.id);
        const showing = open === assistant.id;
        return (
          <View key={assistant.id} style={styles.assistant}>
            <Divider />
            <View style={styles.row}>
              <View style={styles.fill}>
                <ThemedText type="smallBold">{assistant.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{assistant.where}</ThemedText>
              </View>
              {approved ? <Pill label="Approved" tone="success" /> : null}
            </View>
            {approved ? (
              <ThemedText type="small" themeColor="textSecondary">
                Can use: {approved.capabilities.map((c) => labels[c]).join(', ')}.
              </ThemedText>
            ) : null}
            <ActionRow>
              {approved ? <>
                <Button title={showing ? 'Hide steps' : 'Show steps'} size="small" variant="secondary" onPress={() => setOpen(showing ? undefined : assistant.id)} />
                <Button title="Update permissions" size="small" variant="secondary" disabled={busy || !capabilities.length}
                  onPress={() => void onApprove(assistant.id, capabilities)} />
                <DestructiveButton title="Disconnect" disabled={busy} onPress={() => onDisconnect(approved.id)} />
              </> : (
                <Button title={`Connect ${assistant.name}`} size="small" disabled={busy || !capabilities.length || !url}
                  onPress={() => void onApprove(assistant.id, capabilities).then((ok) => { if (ok) setOpen(assistant.id); })} />
              )}
            </ActionRow>
            {showing && approved ? (
              <View style={styles.steps}>
                {assistant.steps(url).map((step, i) => (
                  <View key={i} style={styles.step}>
                    <ThemedText type="small">{i + 1}. {step.text}</ThemedText>
                    {step.command ? <>
                      <CodeBox value={step.command} />
                      <ActionRow><Button title="Copy command" size="small" variant="secondary" onPress={() => void copy(step.command!, 'Command')} /></ActionRow>
                    </> : null}
                  </View>
                ))}
                {assistant.open ? (
                  <ActionRow>
                    <Button title={assistant.open.label} size="small"
                      onPress={() => { void Linking.openURL(assistant.open!.url).catch(() => onMessage('That page could not be opened.')); }} />
                  </ActionRow>
                ) : null}
                <ThemedText type="small" themeColor="textSecondary">
                  Then ask {assistant.name}, for example, to summarise your saved Rhythm videos.
                </ThemedText>
              </View>
            ) : null}
          </View>
        );
      })}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  field: { gap: Spacing.two },
  assistant: { gap: Spacing.two + Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  steps: { gap: Spacing.two + Spacing.one },
  step: { gap: Spacing.two },
});
