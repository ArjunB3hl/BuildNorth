import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type StyleProp, type TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { AiOrb } from '@/components/ai-orb';
import { Accent, Button, Notice } from '@/components/form';
import { gradientStyle, GradientView } from '@/components/gradient';
import { Collapse, Enter, FadeIn, Skeleton, Stagger, useHover, webTransition } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, Pill, SectionHeader } from '@/components/ui';
import { WebCookieSettings } from '@/components/web-cookie-settings';
import { AiColors, Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { fetchLearned, LEARNED_KEY, learnedOf, topicLabel, topicsInUse } from '@/lib/interest-choices';
import { RECOMMENDATIONS_ENABLED, type BrowserSession, type Recommendation, type RhythmResult, type Topic } from '@/lib/rhythm';

function requireSuccess(result: RhythmResult) {
  if (result.status !== 'ok') throw new Error(result.message);
  return result;
}

function basisLabel(basis: string) {
  if (basis === 'metadata') return 'Metadata only';
  if (basis.includes('user_text')) return `Your text${basis.includes('partial') ? ' · partial' : ''}`;
  return basis.includes('partial') ? 'Partial transcript' : 'Displayed transcript';
}

export default function WebOverview() {
  const api = useApi();
  const cache = useQueryClient();
  const wide = useWindowDimensions().width >= 1100;
  const interests = useQuery({ queryKey: ['rhythm-interests'], queryFn: api.rhythm.interests });
  const learned = useQuery({ queryKey: LEARNED_KEY, queryFn: () => fetchLearned(api.rhythm) });
  // With recommendations off there are no recommendations or permitted pages to list.
  const recommendations = useQuery({ queryKey: ['rhythm', 'recommendations'], queryFn: async () => requireSuccess(await api.rhythm.recommendations()),
    refetchInterval: 15000, enabled: RECOMMENDATIONS_ENABLED });
  const connections = useQuery({ queryKey: ['rhythm', 'connections'], queryFn: async () => requireSuccess(await api.rhythm.connections()),
    refetchInterval: 15000, enabled: RECOMMENDATIONS_ENABLED });
  const feedback = useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) => api.rhythm.feedback(id, saved ? 'clear' : 'saved').then(requireSuccess),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['rhythm'] }),
  });
  const pause = useMutation({ mutationFn: (id: string) => api.rhythm.pauseBrowser(id).then(requireSuccess),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['rhythm'] }) });
  const items = (recommendations.data?.recommendations ?? []).filter((item) => item.feedback !== 'dismissed');
  const browsers = connections.data?.browsers ?? [];
  const profile = interests.data?.profile;
  const sharing = !!profile?.confirmed && profile.consent.metadata && profile.enabledSites.includes('youtube');
  const count = (n: number) => (recommendations.isPending ? null : n);
  const topics = topicsInUse(learnedOf(learned.data));
  const personalisation = (
    <PersonalisationCard
      pending={interests.isPending}
      error={interests.isError ? interests.error : null}
      onRetry={() => void interests.refetch()}
      learning={!!profile?.consent.learn}
      learned={!!profile?.confirmed}
      topics={topics}
    />
  );

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
      <Stack.Screen options={{ title: 'Overview' }} />
      <View style={styles.page}>

        <View style={[styles.columns, !wide && styles.stacked]}>
          <View style={styles.main}>
            <Enter>
              <AskCoachCard />
            </Enter>

            {RECOMMENDATIONS_ENABLED ? (
              <View style={styles.stats}>
                <Enter index={1} style={styles.stat}>
                  <Stat label="Recommendations" value={count(items.length)} />
                </Enter>
                <Enter index={2} style={styles.stat}>
                  <Stat label="Saved" value={count(items.filter((x) => x.feedback === 'saved').length)} />
                </Enter>
                <Enter index={3} style={styles.stat}>
                  <Stat label="Page sharing" value={interests.isPending ? null : sharing ? 'On' : 'Off'} />
                </Enter>
              </View>
            ) : (
              <View style={styles.stats}>
                <Enter index={1} style={styles.stat}>
                  <Stat label="Learning" value={interests.isPending ? null : profile?.consent.learn ? 'On' : 'Off'} />
                </Enter>
                <Enter index={2} style={styles.stat}>
                  <Stat label="Interests" value={learned.isPending ? null : topics.length} />
                </Enter>
                <Enter index={3} style={styles.stat}>
                  <Stat label="YouTube sharing" value={interests.isPending ? null : sharing ? 'On' : 'Off'} />
                </Enter>
              </View>
            )}

            {RECOMMENDATIONS_ENABLED ? null : <Enter index={4}>{personalisation}</Enter>}
            {RECOMMENDATIONS_ENABLED ? <>
              <Enter index={3} style={styles.section}>
                <SectionHeader title="Worth your time" action={
                  <Link href="/profile/videos"><ThemedText type="linkPrimary">View all</ThemedText></Link>} />
                <ThemedText type="small" themeColor="textSecondary">
                  From pages you permit and agents you connect. A shared page isn&apos;t proof you watched it.
                </ThemedText>
              </Enter>
              {recommendations.isPending ? (
                <View style={styles.skeletonList} accessibilityLabel="Loading your recommendations">
                  {[0, 1, 2].map((i) => <VideoCardSkeleton key={i} />)}
                </View>
              ) : null}
              {recommendations.isError ? <ErrorState error={recommendations.error} onRetry={() => void recommendations.refetch()} /> : null}
              {!recommendations.isPending && !recommendations.isError && !items.length ? (
                <FadeIn index={4}>
                  <EmptyState
                    title="No recommendations yet"
                    body="Turn on learning and Rhythm picks up what suits you. Then open a YouTube video, click Rhythm's toolbar icon and choose Use this page. Videos you keep appear here."
                    action={profile?.confirmed
                      ? <Link href="/profile/videos"><ThemedText type="linkPrimary">Manage Rhythm</ThemedText></Link>
                      : <Link href="/profile/interests">
                        <ThemedText type="linkPrimary">{profile?.consent.learn ? 'Personalisation' : 'Turn on learning'}</ThemedText>
                      </Link>}
                  />
                </FadeIn>
              ) : null}
              {items.slice(0, 6).map((item, i) => (
                <Enter key={item.id} index={Math.min(i, 5)} delay={180}>
                  <VideoCard item={item} busy={feedback.isPending} saving={feedback.isPending && feedback.variables?.id === item.id}
                    onToggleSave={() => feedback.mutate({ id: item.id, saved: item.feedback === 'saved' })} />
                </Enter>
              ))}
              {feedback.isError ? <Notice tone="error">Could not update this video. Please try again.</Notice> : null}
            </> : null}
          </View>

          <View style={[styles.aside, !wide && styles.asideStacked]}>
            {/* The side column enters a step after the main column starts. */}
            <Stagger delay={60}>
              {RECOMMENDATIONS_ENABLED ? personalisation : null}

              {RECOMMENDATIONS_ENABLED ? <Card>
                <ThemedText type="smallBold">Rhythm in Chrome</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Sign in to the extension with this account. A page you permit shares its title, channel, description
                  excerpt and length; transcripts need a separate permission.
                </ThemedText>
                {connections.isError ? <ErrorState error={connections.error} onRetry={() => void connections.refetch()} /> : null}
                {browsers.map((browser) => (
                  <PageRow key={browser.id} browser={browser} busy={pause.isPending} onRevoke={() => pause.mutate(browser.id)} />
                ))}
                {!connections.isPending && !connections.isError && !browsers.length ? (
                  <ThemedText type="small" themeColor="textSecondary">No permitted pages yet.</ThemedText>
                ) : null}
                {pause.isError ? <Notice tone="error">Could not revoke access. Please try again.</Notice> : null}
                <Link href="/profile/videos"><ThemedText type="linkPrimary">Manage pages and agents</ThemedText></Link>
              </Card> : <Card>
                <ThemedText type="smallBold">Rhythm in Chrome</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Sign in to the extension with this account. With learning on, it notices the workout, martial arts,
                  health and cooking videos you watch. Save to Rhythm and Not interested work any time.
                </ThemedText>
                <Link href="/profile/interests"><ThemedText type="linkPrimary">Personalisation settings</ThemedText></Link>
              </Card>}

              <Card>
                <ThemedText type="smallBold">Your data</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Revoke page access at any time, review permissions, or delete what you&apos;ve shared.
                </ThemedText>
                <Link href="/profile/data"><ThemedText type="linkPrimary">Manage your data</ThemedText></Link>
              </Card>

              <WebCookieSettings />
            </Stagger>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Whether Rhythm is learning the user's interests, the topics in use as small pills (the user's own
 * picks highlighted), and a way to edit them.
 */
function PersonalisationCard({ pending, error, onRetry, learning, learned, topics }: {
  pending: boolean; error: unknown; onRetry: () => void; learning: boolean; learned: boolean;
  topics: { topic: Topic; pinned: boolean }[];
}) {
  const status = !learning
    ? topics.length
      ? { pill: 'Off', tone: 'muted' as const, line: 'Learning is off. Rhythm goes by the interests you chose.' }
      : { pill: 'Off', tone: 'muted' as const, line: 'Turn on learning and Rhythm picks up which videos suit you from your coach chats and the videos you watch.' }
    : learned
      ? { pill: 'On', tone: 'success' as const, line: 'Rhythm learns from your coach chats and the videos you watch, and picks videos to match.' }
      : { pill: 'On', tone: 'success' as const, line: 'Still learning — chat with your coach or watch a few workout or recipe videos.' };
  return (
    <Card>
      <View style={styles.personalHeading}>
        <AiOrb size={24} still={!learning} />
        <ThemedText type="smallBold" style={styles.fill}>Personalisation</ThemedText>
        {pending || error ? null : <Pill label={status.pill} tone={status.tone} />}
      </View>
      {pending ? (
        <View style={styles.skeletonLines} accessibilityLabel="Loading personalisation">
          <Skeleton width="95%" />
          <Skeleton width="60%" />
        </View>
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">{status.line}</ThemedText>
      )}
      {!pending && !error && topics.length ? (
        <FadeIn style={styles.topicPills}>
          {topics.map(({ topic, pinned }) => (
            <View key={topic} accessible accessibilityLabel={pinned ? `${topic}, chosen by you` : `${topic}, learned`}>
              <Pill label={topicLabel(topic)} tone={pinned ? 'accent' : 'neutral'} />
            </View>
          ))}
        </FadeIn>
      ) : null}
      <Link href="/profile/interests">
        <ThemedText type="linkPrimary">{topics.length ? 'Edit interests' : learning ? 'Personalisation settings' : 'Turn on learning'}</ThemedText>
      </Link>
    </Card>
  );
}

const coachLine = 'Plan meals, build a workout or find a recipe; your coach uses your saved preferences.';

/** The way into the coach: its orb, a gradient title and one action, framed by a hairline of the AI gradient. */
function AskCoachCard() {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  // Below this the action moves under the text instead of sitting at the end of the row.
  const compact = useWindowDimensions().width < 640;
  return (
    <GradientView style={[styles.aiFrame, dark && styles.aiFrameDark]}>
      <View style={[styles.aiCard, compact && styles.aiCardCompact, { backgroundColor: theme.backgroundElement }, gradientStyle(dark ? aiTintDark : aiTintLight)]}>
        <AiOrb size={40} />
        <View style={styles.aiText}>
          <ThemedText type="smallBold" style={[styles.aiTitle, titleGradient(dark)]} accessibilityRole="header">
            Ask your coach
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{coachLine}</ThemedText>
          {compact ? <View style={styles.aiCompactAction}><OpenCoachLink /></View> : null}
        </View>
        {compact ? null : <OpenCoachLink />}
      </View>
    </GradientView>
  );
}

const aiTintLight = 'radial-gradient(120% 160% at 0% 0%, rgba(139, 92, 246, 0.07), transparent 55%)';
const aiTintDark = 'radial-gradient(120% 160% at 0% 0%, rgba(139, 92, 246, 0.16), transparent 55%)';

/** Gradient-filled title text (the web clips the background to the glyphs). Light mode skips cyan, which is too pale on white. */
function titleGradient(dark: boolean): StyleProp<TextStyle> {
  const stops = dark ? `${AiColors.violet}, ${AiColors.blue}, ${AiColors.cyan}` : `${AiColors.violet}, ${AiColors.blue}`;
  return { backgroundImage: `linear-gradient(90deg, ${stops})`, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' } as TextStyle;
}

function OpenCoachLink() {
  const { hovered, hoverProps } = useHover();
  const reduced = useReducedMotion();
  // One flat style object: Link's asChild Slot drops style functions and rejects style arrays.
  const style = StyleSheet.flatten([styles.aiButton, buttonTransition, hovered && styles.aiButtonHover]);
  return (
    <Link href="/coach" asChild>
      <Pressable accessibilityRole="link" accessibilityLabel="Open coach" {...hoverProps} style={style}>
        <ThemedText type="smallBold" style={styles.aiButtonLabel}>Open coach</ThemedText>
        <View style={[arrowTransition, hovered && !reduced && styles.arrowHover]}>
          <SymbolView name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={16} tintColor="#ffffff" />
        </View>
      </Pressable>
    </Link>
  );
}

const buttonTransition = webTransition('opacity, box-shadow', 180);
const arrowTransition = webTransition('transform', 180);

/** Counts up from zero the first time it shows a number; later changes (after a refetch) show directly. */
function useCountUp(value: number): number {
  const reduced = useReducedMotion();
  const [target] = useState(value);
  const [current, setCurrent] = useState<number | null>(reduced || target === 0 ? null : 0);
  const counting = current !== null;
  useEffect(() => {
    if (!counting) return;
    const begin = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - begin) / 700);
      if (t < 1) {
        setCurrent(Math.round(target * (1 - (1 - t) ** 3)));
        frame = requestAnimationFrame(step);
      } else {
        setCurrent(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [counting, target]);
  return current ?? value;
}

function CountUp({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <ThemedText style={[styles.statValue, styles.tabular]} accessibilityLabel={String(value)}>{shown}</ThemedText>;
}

/** A headline number; `null` while it loads. */
function Stat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <Card style={styles.statCard}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      {value === null ? (
        <Skeleton width={56} height={28} style={styles.statSkeleton} />
      ) : typeof value === 'number' ? (
        <CountUp value={value} />
      ) : (
        <ThemedText style={styles.statValue}>{value}</ThemedText>
      )}
    </Card>
  );
}

/** A placeholder shaped like a recommendation while they load. */
function VideoCardSkeleton() {
  return (
    <Card style={styles.video}>
      <Skeleton width={48} height={48} radius={12} />
      <View style={styles.videoBody}>
        <Skeleton width={120} height={18} radius={9} />
        <Skeleton width="65%" height={18} />
        <Skeleton width="95%" />
        <Skeleton width="55%" />
      </View>
    </Card>
  );
}

function VideoCard({ item, busy, saving, onToggleSave }: {
  item: Recommendation; busy: boolean; saving: boolean; onToggleSave: () => void;
}) {
  const theme = useTheme();
  const [details, setDetails] = useState(false);
  const saved = item.feedback === 'saved';
  return (
    <Card style={styles.video}>
      <View style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]}>
        <SymbolView name={{ ios: 'play.rectangle', android: 'play_circle', web: 'play_circle' }} size={26} tintColor={Accent} />
      </View>
      <View style={styles.videoBody}>
        <View style={styles.meta}>
          <Pill label={basisLabel(item.analysisBasis)} tone="muted" />
          <ThemedText type="small" themeColor="textSecondary">
            {item.durationSeconds ? `${Math.ceil(item.durationSeconds / 60)} min` : 'Length unknown'}
          </ThemedText>
        </View>
        <Link href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`} target="_blank" rel="noreferrer">
          <ThemedText type="smallBold" style={styles.videoTitle}>{item.title || 'Untitled video'}</ThemedText>
        </Link>
        <ThemedText type="small" themeColor="textSecondary">{item.explanation}</ThemedText>
        {item.stale ? <Notice tone="warning">Saved under earlier interests. Start a new task to check it again.</Notice> : null}
        <View style={styles.actions}>
          <Button size="small" variant={saved ? 'secondary' : 'primary'} title={saved ? 'Unsave' : 'Save'}
            loading={saving} disabled={busy} onPress={onToggleSave} />
          {item.limitations.length ? (
            <Button size="small" variant="quiet" title={details ? 'Hide details' : 'Details'} onPress={() => setDetails(!details)} />
          ) : null}
        </View>
        <Collapse open={details} style={styles.details}>
          {item.limitations.map((line) => (
            <ThemedText key={line} type="small" themeColor="textSecondary">• {line}</ThemedText>
          ))}
        </Collapse>
      </View>
    </Card>
  );
}

function PageRow({ browser, busy, onRevoke }: { browser: BrowserSession; busy: boolean; onRevoke: () => void }) {
  const theme = useTheme();
  const revoked = browser.status === 'paused';
  return (
    <View style={[styles.pageRow, { borderColor: theme.backgroundSelected }]}>
      <ThemedText type="small" numberOfLines={2}>{browser.metadata?.title || browser.label}</ThemedText>
      <View style={styles.meta}>
        <Pill label={browser.available ? 'Connected' : revoked ? 'Permission revoked' : 'Not connected'}
          tone={browser.available ? 'success' : 'muted'} />
        {!revoked ? <Button size="small" variant="quiet" title="Revoke" disabled={busy} onPress={onRevoke} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { padding: Spacing.four, paddingBottom: Spacing.six },
  page: { width: '100%', maxWidth: 1120, alignSelf: 'center', gap: Spacing.four },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  main: { flex: 1, minWidth: 0, gap: Spacing.three },
  aside: { width: 320, gap: Spacing.three },
  asideStacked: { width: '100%' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  stat: { flex: 1, minWidth: 140 },
  statCard: { flexGrow: 1, gap: Spacing.one },
  statValue: { fontSize: 28, lineHeight: 34, fontWeight: 700 },
  // Matches the number's line height, so the card doesn't change size when it loads.
  statSkeleton: { marginVertical: 3 },
  tabular: { fontVariant: ['tabular-nums'] },
  skeletonLines: { gap: Spacing.two },
  skeletonList: { gap: Spacing.three },
  details: { gap: Spacing.two },
  aiFrame: { borderRadius: 17, padding: 1, boxShadow: '0 6px 24px rgba(124, 92, 255, 0.10)' },
  aiFrameDark: { boxShadow: '0 6px 28px rgba(124, 92, 255, 0.22)' },
  aiCard: {
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  // When the text wraps to several lines, the orb lines up with the title.
  aiCardCompact: { alignItems: 'flex-start' },
  aiText: { flex: 1, minWidth: 0, gap: Spacing.one },
  aiTitle: { fontSize: 17, lineHeight: 22, alignSelf: 'flex-start' },
  aiCompactAction: { alignSelf: 'flex-start', marginTop: Spacing.two },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    minHeight: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    backgroundColor: Accent,
  },
  aiButtonHover: { opacity: 0.92, boxShadow: '0 6px 16px rgba(32, 138, 239, 0.28)' },
  aiButtonLabel: { color: '#ffffff' },
  arrowHover: { transform: [{ translateX: 2 }] },
  section: { gap: Spacing.one, marginTop: Spacing.two },
  video: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  thumb: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  videoBody: { flex: 1, minWidth: 0, gap: Spacing.two },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  videoTitle: { fontSize: 16, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  personalHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  topicPills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + Spacing.half },
  pageRow: { gap: Spacing.one, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
});
