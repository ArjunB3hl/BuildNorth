import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Card, Pill, Screen, ThemedText } from '../components/ui';
import { WEB_URL } from '../config';
import {
  DEMO_RELEASE_URL,
  demoDownloadUrl,
  demoDownloads,
  downloadSize,
  type DemoDownload,
} from '../lib/downloads';
import { Spacing } from '../theme';

// Downloads: the website's page (mobile/src/components/downloads/downloads-page.web.tsx), from the same list. A
// download opens in the default browser, which saves the file; the Windows card says this is the app in use.

export function DownloadsScreen() {
  const apps = demoDownloads.filter(d => d.id !== 'ios' && d.id !== 'watchos');
  const simulators = demoDownloads.filter(
    d => d.id === 'ios' || d.id === 'watchos',
  );
  return (
    <Screen
      title="Downloads"
      subtitle="Try Rhythm on the web, Mac, Windows and Android, add the Chrome extension, or explore the iPhone and Apple Watch simulator demos."
      wide
    >
      <ThemedText type="smallBold" themeColor="textSecondary">
        APPS & BROWSER EXTENSION
      </ThemedText>
      <View style={styles.grid}>
        {apps.map(item => (
          <DownloadCard key={item.id} item={item} />
        ))}
      </View>
      <ThemedText type="smallBold" themeColor="textSecondary">
        A PREVIEW ON YOUR MAC
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        These packages run in Xcode simulators. They don’t install on a physical
        iPhone or Apple Watch.
      </ThemedText>
      <View style={styles.grid}>
        {simulators.map(item => (
          <DownloadCard key={item.id} item={item} />
        ))}
      </View>
      <Card style={styles.card}>
        <ThemedText type="smallBold">
          Prefer not to install anything?
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Rhythm works on the website in your browser, with the Chrome extension
          if you like.
        </ThemedText>
        <View style={styles.row}>
          <Button
            title="Open the Rhythm website ↗"
            size="small"
            variant="secondary"
            onPress={() => Linking.openURL(WEB_URL)}
          />
          <Button
            title="File checksums ↗"
            size="small"
            variant="quiet"
            onPress={() => Linking.openURL(`${DEMO_RELEASE_URL}/SHA256SUMS`)}
          />
        </View>
      </Card>
    </Screen>
  );
}

function DownloadCard({ item }: { item: DemoDownload }) {
  const [steps, setSteps] = useState(false);
  const current = item.id === 'windows';
  return (
    <Card style={[styles.card, styles.download]}>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold" style={styles.fill}>
          {item.title}
        </ThemedText>
        {current ? <Pill label="You’re using it" tone="accent" /> : null}
      </View>
      <ThemedText type="small">{item.description}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {`${item.compatibility} · ${item.format} · ${downloadSize(item.bytes)}`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {item.note}
      </ThemedText>
      {steps ? (
        <View style={styles.steps}>
          {item.steps.map((step, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary">
              {`${i + 1}. ${step}`}
            </ThemedText>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <Button
          title={`${item.label} ↗`}
          size="small"
          variant={current ? 'secondary' : 'primary'}
          onPress={() => Linking.openURL(demoDownloadUrl(item))}
        />
        <Button
          title={steps ? 'Hide steps' : 'How to install'}
          size="small"
          variant="quiet"
          onPress={() => setSteps(s => !s)}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  card: { gap: Spacing.two },
  download: { flexGrow: 1, flexBasis: 320, maxWidth: 540 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  steps: { gap: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
