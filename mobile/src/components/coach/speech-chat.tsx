import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Button, Notice } from '@/components/form';
import { ThemedText as Text } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { isPublicConnectorUrl } from '@/lib/assistant-setup';

export function SpeechChat() {
  const [error, setError] = useState('');
  const url = process.env.EXPO_PUBLIC_WEB_APP_URL;
  const usable = !!url && isPublicConnectorUrl(url);
  return <Card style={{ gap: 12 }}>
    <Text type="subtitle">Voice Coach · Demo</Text>
    <Text>Parakeet listens, Claude replies, and Kokoro speaks. Open the website with the same account to record. Native recording is not included in this demo build.</Text>
    {usable ? <Button title="Open voice Coach" onPress={() => void Linking.openURL(`${url!.replace(/\/$/, '')}/coach`).catch(() => setError('Could not open the website.'))} /> : <Notice tone="info">The public website address is not configured yet.</Notice>}
    {error ? <Notice tone="error">{error}</Notice> : null}
  </Card>;
}
