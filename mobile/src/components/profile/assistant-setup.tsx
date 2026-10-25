import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useState } from 'react';

import { Button, Notice } from '@/components/form';
import { ActionRow } from '@/components/profile/controls';
import { CodeBox, SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { ASSISTANT_SETUP, isPublicConnectorUrl } from '@/lib/assistant-setup';

export function AssistantSetup({ url }: { url: string }) {
  const [message, setMessage] = useState('');
  const publicAddress = isPublicConnectorUrl(url);
  return <>
    <SectionCard title="Your assistants, your Rhythm" description="Use your own ChatGPT or Claude account to work with your profile, Calendar, meals and workouts. Review proposed changes in Rhythm before they are applied.">
      {!publicAddress ? <Notice tone="info">This preview runs locally. ChatGPT and Claude can connect once Rhythm has a public HTTPS address. You can use the Claude API-key demo on this page now.</Notice> :
        <Notice tone="info">A public address is configured. Complete the connection in your assistant to verify it works; opening settings alone does not connect it.</Notice>}
      <CodeBox value={url} accessibilityLabel="Rhythm connector address" />
      <ActionRow><Button title="Copy connector address" size="small" variant="secondary" onPress={() => {
        void Clipboard.setStringAsync(url).then(() => setMessage('Address copied.')).catch(() => setMessage('Could not copy. Select the address above.'));
      }} /></ActionRow>
      {message ? <ThemedText type="small">{message}</ThemedText> : null}
    </SectionCard>
    {ASSISTANT_SETUP.map((assistant) => <SectionCard key={assistant.name} title={`Connect ${assistant.name}`} description={assistant.steps}>
      <ThemedText type="small" themeColor="textSecondary">Set up in the assistant’s browser or desktop settings. Availability on phone depends on your assistant account and app; Rhythm permissions belong to the same account on every device.</ThemedText>
      <ActionRow><Button title={assistant.action} size="small" variant="secondary" onPress={() => {
        void Linking.openURL(assistant.url).catch(() => setMessage('Could not open the assistant. Try its website.'));
      }} /></ActionRow>
      <ThemedText type="small" themeColor="textSecondary">Try: “Look at my Rhythm Calendar for today and suggest a simple dinner.”</ThemedText>
    </SectionCard>)}
  </>;
}
