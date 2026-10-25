import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Notice } from '@/components/form';
import { ThemedText as Text } from '@/components/themed-text';
import { Card, Screen } from '@/components/ui';
import { useDownloadDevice } from '@/hooks/use-download-device';
import { buildUrls, deviceNames, downloadUrl, type DownloadDevice } from '@/lib/device-download';

export default function Downloads() {
  const detected = useDownloadDevice(), [choice, setChoice] = useState<DownloadDevice | null>(null), [message, setMessage] = useState('');
  const device = choice || detected, url = downloadUrl(buildUrls[device]);
  const instructions = device === 'iphone' ? 'Open Rhythm in Safari, tap Share, then Add to Home Screen. If offered, turn on Open as Web App.'
    : device === 'android' ? 'In Chrome, open the ⋮ menu and choose Add to Home screen. If Install is offered, you can use it; otherwise create a shortcut.'
    : device === 'mac' ? 'In Safari, choose File → Add to Dock. In Chrome, look under ⋮ → Cast, save and share → Create shortcut or Install page as app, if offered.'
    : 'In Edge or Chrome, open the browser menu and look for Apps / Install this site as an app. If unavailable, bookmark this page for quick access.';
  return <Screen><Text type="title">Rhythm, on your device.</Text><Text themeColor="textSecondary">Demo version · Use the website now. Native downloads will appear here when builds are published.</Text>
    <Card style={{ gap: 16 }}>
      <Text type="subtitle">{detected === 'other' ? 'Choose your device' : `Detected ${deviceNames[detected]}`}</Text>
      <Text type="small" themeColor="textSecondary">Detection stays in your browser. Choose a different platform below if needed.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['mac', 'windows', 'android', 'iphone'] as const).map(d =>
        <Button key={d} title={deviceNames[d]} size="small" variant={device === d ? 'primary' : 'secondary'} onPress={() => { setChoice(d); setMessage(''); }} />)}</View>
      {url ? <Button title={`Download for ${deviceNames[device]}`} onPress={() => void Linking.openURL(url).catch(() => setMessage('Could not open the download. Please try again.'))} />
        : <Notice tone="info">The {deviceNames[device]} build isn’t available yet. You can keep using all website demo features.</Notice>}
      <Text type="smallBold">Keep Rhythm one tap away</Text><Text>{instructions}</Text>
      {Platform.OS === 'web' ? <Button title="Copy website link" variant="secondary" onPress={() => void Clipboard.setStringAsync(window.location.origin).then(() => setMessage('Website link copied.')).catch(() => setMessage('Copy the address from your browser.'))} /> : null}
      {device === 'iphone' ? <Text type="small" themeColor="textSecondary">Apple Watch pairing requires the native iPhone companion build. A website shortcut cannot sync HealthKit.</Text> : null}
      {message ? <Notice tone="info">{message}</Notice> : null}
    </Card>
  </Screen>;
}
