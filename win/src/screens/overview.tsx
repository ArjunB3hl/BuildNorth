import { Linking, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AiOrb } from '../components/sidebar';
import { Button, Card, Notice, Pill, ThemedText } from '../components/ui';
import { WEB_URL } from '../config';
import { useStore } from '../data/store';
import { describe } from '../lib/account';
import { learnedOf, topicLabel, topicsInUse } from '../lib/interest-choices';
import type { RhythmResult } from '../lib/rhythm';
import { useLoad } from '../lib/use-load';
import { useNav } from '../navigation';
import { AiColors, Spacing, useIsDark } from '../theme';
import { TodayScreen } from './today';

// Overview: the website's (mobile/src/app/(app)/(tabs)/(today)/index.web.tsx, with recommendations off) — Ask your
// coach, the Learning / Interests / YouTube sharing figures, Personalisation, Rhythm in Chrome and Your data — and,
// below, today's plan and check-in, which the Windows app has always had on its first page.

export function OverviewScreen() {
  return <TodayScreen intro={<OverviewCards />} />;
}

function requireOk(result: RhythmResult): RhythmResult {
  if (result.status !== 'ok' && result.status !== 'profile_required') {
    throw new Error(result.message || 'Rhythm couldn’t load this.');
  }
  return result;
}

function OverviewCards() {
  const { api } = useStore();
  const nav = useNav();
  const wide = useWindowDimensions().width >= 1100;
  const interests = useLoad(
    api ? async () => requireOk(await api.rhythm.interests()) : null,
  );
  const learned = useLoad(
    api ? async () => requireOk(await api.rhythm.learned()) : null,
  );

  if (!api) {
    return (
      <Notice tone="info">
        Personalisation, the content library and sharing settings need a Rhythm
        account; this build shows demo data.
      </Notice>
    );
  }

  const profile = interests.data?.profile;
  const learning = !!profile?.consent.learn;
  const sharing =
    !!profile?.consent.metadata && !!profile.enabledSites.includes('youtube');
  const topics = topicsInUse(learnedOf(learned.data));
  const pending = interests.loading && !interests.data;

  const main = (
    <View style={styles.main}>
      <AskCoachCard onOpen={() => nav.go('coach')} />
      <View style={styles.stats}>
        <Stat
          label="Learning"
          value={pending ? null : learning ? 'On' : 'Off'}
        />
        <Stat
          label="Interests"
          value={
            learned.loading && !learned.data ? null : String(topics.length)
          }
        />
        <Stat
          label="YouTube sharing"
          value={pending ? null : sharing ? 'On' : 'Off'}
        />
      </View>
      <Card>
        <View style={styles.heading}>
          <AiOrb size={24} />
          <ThemedText type="smallBold" style={styles.fill}>
            Personalisation
          </ThemedText>
          {pending || interests.error ? null : (
            <Pill
              label={learning ? 'On' : 'Off'}
              tone={learning ? 'success' : 'muted'}
            />
          )}
        </View>
        {interests.error ? (
          <ErrorLine error={interests.error} onRetry={interests.reload} />
        ) : pending ? (
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {!learning
              ? topics.length
                ? 'Learning is off. Rhythm goes by the interests you chose.'
                : 'Turn on learning and Rhythm picks up which videos suit you from your coach chats and the videos you watch.'
              : profile?.confirmed
              ? 'Rhythm learns from your coach chats and the videos you watch, and picks videos to match.'
              : 'Still learning — chat with your coach or watch a few workout or recipe videos.'}
          </ThemedText>
        )}
        {topics.length ? (
          <View style={styles.pills}>
            {topics.map(({ topic, pinned }) => (
              <Pill
                key={topic}
                label={topicLabel(topic)}
                tone={pinned ? 'accent' : 'neutral'}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.start}>
          <Button
            title={
              topics.length
                ? 'Edit interests'
                : learning
                ? 'Personalisation settings'
                : 'Turn on learning'
            }
            size="small"
            variant="quiet"
            onPress={() => nav.go('interests')}
          />
        </View>
      </Card>
    </View>
  );

  const aside = (
    <View style={styles.aside}>
      <Card>
        <ThemedText type="smallBold">Rhythm in Chrome</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Sign in to the extension with this account. With learning on, it
          notices the workout, martial arts, health and cooking videos you
          watch. Save to Rhythm and Not interested work any time.
        </ThemedText>
        <View style={styles.links}>
          <Button
            title="Personalisation settings"
            size="small"
            variant="quiet"
            onPress={() => nav.go('interests')}
          />
          <Button
            title="Get the extension"
            size="small"
            variant="quiet"
            onPress={() => nav.go('downloads')}
          />
        </View>
      </Card>
      <Card>
        <ThemedText type="smallBold">Your data</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Review permissions, or delete what you’ve shared. Deleting your data
          is on the website.
        </ThemedText>
        <View style={styles.links}>
          <Button
            title="Sharing permissions"
            size="small"
            variant="quiet"
            onPress={() => nav.go('interests')}
          />
          <Button
            title="Manage your data on the website ↗"
            size="small"
            variant="quiet"
            onPress={() => Linking.openURL(`${WEB_URL}/profile/data`)}
          />
        </View>
      </Card>
    </View>
  );

  return wide ? (
    <View style={styles.columns}>
      <View style={styles.mainColumn}>{main}</View>
      <View style={styles.asideColumn}>{aside}</View>
    </View>
  ) : (
    <View style={styles.stacked}>
      {main}
      {aside}
    </View>
  );
}

/** The way into the coach: its orb, a coloured title and one action, framed in the AI's colour. */
function AskCoachCard({ onOpen }: { onOpen: () => void }) {
  const dark = useIsDark();
  return (
    <Card
      style={[styles.askCard, dark ? styles.askCardDark : styles.askCardLight]}
    >
      <AiOrb size={40} />
      <View style={styles.fill}>
        <ThemedText
          type="smallBold"
          style={[
            styles.askTitle,
            { color: dark ? AiColors.cyan : AiColors.violet },
          ]}
          accessibilityRole="header"
        >
          Ask your coach
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Plan meals, build a workout or find a recipe; your coach uses your
          saved preferences.
        </ThemedText>
      </View>
      <Button title="Open coach →" onPress={onOpen} />
    </Card>
  );
}

/** A headline figure; null while it loads. */
function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <Card style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={styles.statValue}>{value ?? '…'}</ThemedText>
    </Card>
  );
}

function ErrorLine({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <View style={styles.errorLine}>
      <Notice tone="error">{describe(error)}</Notice>
      <View style={styles.start}>
        <Button
          title="Try again"
          size="small"
          variant="secondary"
          onPress={onRetry}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  columns: {
    flexDirection: 'row',
    gap: Spacing.four,
    alignItems: 'flex-start',
  },
  mainColumn: { flex: 2, minWidth: 0 },
  asideColumn: { flex: 1, minWidth: 260 },
  stacked: { gap: Spacing.three },
  main: { gap: Spacing.three },
  aside: { gap: Spacing.three },
  askCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    flexWrap: 'wrap',
  },
  askCardLight: { borderColor: AiColors.violet, backgroundColor: '#F7F4FF' },
  askCardDark: { borderColor: AiColors.violet, backgroundColor: '#1A1530' },
  askTitle: { fontSize: 18, lineHeight: 24 },
  stats: { flexDirection: 'row', gap: Spacing.three, flexWrap: 'wrap' },
  stat: { flex: 1, minWidth: 140, gap: Spacing.one },
  statValue: { fontSize: 26, lineHeight: 32, fontWeight: '600' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  start: { alignItems: 'flex-start' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  errorLine: { gap: Spacing.two },
});
