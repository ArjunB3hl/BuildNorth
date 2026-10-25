import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AiOrb } from '@/components/ai-orb';
import { Notice } from '@/components/form';
import { ToggleRow } from '@/components/profile/controls';
import { CHOICES_MUTATION, LearnedInterests } from '@/components/profile/learned-interests';
import { Enter, FadeIn, SkeletonCard, Stagger } from '@/components/motion';
import { PageIntro } from '@/components/profile/layout';
import { Disclosure, Divider, FactList, SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { ErrorState, Screen, errorMessage } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { confirmAction } from '@/lib/confirm';
import { RECOMMENDATIONS_ENABLED, type InterestsProfile, type RhythmConsent, type RhythmResult, type RhythmSettings } from '@/lib/rhythm';

/**
 * Rhythm's switches, and what it learned. Each switch saves as soon as it changes (`PUT /rhythm/settings`).
 * "What Rhythm learned" (components/profile/learned-interests.tsx) shows the inferred interests next to the
 * user's own choices, which are saved separately and always win over inference.
 */
type Switch = 'learn' | 'youtube' | 'transcripts' | 'agent' | 'memory';
type Switches = Record<Switch, boolean>;

const QUERY_KEY = ['rhythm-interests'];

function switchesOf(profile?: InterestsProfile): Switches {
  const consent = profile?.consent;
  return {
    learn: !!consent?.learn,
    // One switch covers both: Rhythm only works with YouTube pages while the site and page details are on.
    youtube: !!consent?.metadata && !!profile?.enabledSites.includes('youtube'),
    transcripts: !!consent?.transcripts,
    agent: !!consent?.agent,
    memory: !!consent?.memory,
  };
}

/** The saved settings with one switch changed. Every other switch keeps its saved value. */
function withSwitch(profile: InterestsProfile | undefined, key: Switch, value: boolean): RhythmSettings {
  const saved = profile?.consent;
  const consent: RhythmConsent = {
    metadata: !!saved?.metadata, transcripts: !!saved?.transcripts, agent: !!saved?.agent,
    memory: !!saved?.memory, learn: !!saved?.learn,
  };
  let enabledSites = (profile?.enabledSites ?? []).filter((site) => site === 'youtube');
  if (key === 'youtube') {
    enabledSites = value ? ['youtube'] : [];
    consent.metadata = value;
  } else {
    consent[key] = value;
  }
  return { enabledSites, consent };
}

/** Switching these off deletes something, so it's confirmed first. */
function withdrawal(key: Switch, current: Switches) {
  if (key === 'learn') {
    return {
      title: 'Turn off learning?',
      message: 'Rhythm stops learning and deletes the video history it collected and the interests it learned from it.',
    };
  }
  if (key === 'youtube' && current.learn) {
    return {
      title: 'Turn off YouTube?',
      message: 'Pages you permitted pause, and the video history Rhythm collected for learning is deleted.',
    };
  }
  if (key === 'memory') {
    return { title: 'Turn off private memory?', message: 'Rhythm’s copies in your private memory are erased.' };
  }
  return null;
}

export default function InterestsScreen() {
  const api = useApi();
  const cache = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: api.rhythm.interests });
  const [saving, setSaving] = useState<{ key: Switch; value: boolean } | null>(null);
  // Shown under the switch it's about, so it's in view on a long page.
  const [message, setMessage] = useState<{ key: Switch; tone: 'error' | 'info'; text: string } | null>(null);
  const savingChoices = useIsMutating({ mutationKey: CHOICES_MUTATION }) > 0;

  if (query.isPending) {
    return (
      <Screen>
        <View style={styles.skeletons} accessibilityLabel="Loading your settings">
          {[4, 5].map((lines, i) => <SkeletonCard key={i} lines={lines} />)}
        </View>
      </Screen>
    );
  }
  if (!query.data) return <Screen><ErrorState error={query.error} onRetry={() => query.refetch()} /></Screen>;

  const profile = query.data.profile;
  const saved = switchesOf(profile);
  // While a change saves, its switch already shows the new position.
  const shown: Switches = saving ? { ...saved, [saving.key]: saving.value } : saved;

  async function change(key: Switch, value: boolean) {
    const warning = value ? null : withdrawal(key, saved);
    if (warning && !(await confirmAction({ ...warning, confirmLabel: 'Turn off', destructive: true }))) return;
    setSaving({ key, value });
    setMessage(null);
    try {
      let base = profile;
      // A stale revision is often learning itself updating the profile in the background. Refetch, then
      // apply this one switch on top of the latest settings, so a change made elsewhere is never overwritten.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await api.rhythm.saveSettings(withSwitch(base, key, value), base?.profileRevision ?? 0);
        if (result.status === 'ok') {
          cache.setQueryData<RhythmResult>(QUERY_KEY, (old) =>
            old ? { ...old, profile: result.profile, profileRevision: result.profileRevision } : result);
          void cache.invalidateQueries({ queryKey: QUERY_KEY });
          // Pages pause and memory changes when permissions are withdrawn; the library and overview refetch.
          void cache.invalidateQueries({ queryKey: ['rhythm'] });
          return;
        }
        if (result.status !== 'stale_context') {
          setMessage({ key, tone: 'error', text: result.message || 'Your settings could not be saved. Please try again.' });
          return;
        }
        const fresh = await cache.fetchQuery({ queryKey: QUERY_KEY, queryFn: api.rhythm.interests, staleTime: 0 });
        base = fresh.profile;
        if (switchesOf(base)[key] === value) return;
      }
      setMessage({ key, tone: 'info', text: 'Your settings changed on another screen. This page now shows the latest; switch it again if you still want to.' });
    } catch (e) {
      setMessage({ key, tone: 'error', text: errorMessage(e) });
    } finally {
      setSaving(null);
    }
  }

  const busy = !!saving;
  /** One switch and, after a failed save, what went wrong. */
  const row = (key: Switch, label: string, description: string) => (
    <>
      <ToggleRow label={label} description={description} value={shown[key]} onChange={(value) => void change(key, value)} disabled={busy} />
      {message?.key === key ? <FadeIn><Notice tone={message.tone}>{message.text}</Notice></FadeIn> : null}
    </>
  );

  return (
    <Screen>
      <Enter>
        <PageIntro
          body="Rhythm finds workout, martial arts and cooking videos for you. Choose whether it learns what suits you, and what it may share."
          meta={busy || savingChoices ? 'Saving…' : 'Changes save as soon as you make them.'}
        />
      </Enter>

      <Stagger delay={60}>
        <SectionCard
          key="learning"
          title="Personalised by AI"
          description="Nothing to fill in: Rhythm works out which videos suit you from what you do, and you can correct it."
          leading={<AiOrb size={32} still={!shown.learn} />}>
          {row(
            'learn',
            'Learn my interests automatically',
            'Rhythm learns which workouts, martial arts, exercise and cooking videos suit you from what you ask your coach and the fitness and food videos you watch with the Chrome extension.',
          )}
          {saved.learn && !profile?.confirmed ? (
            <FadeIn>
              <Notice tone="info">Still learning — chat with your coach or watch a few workout or recipe videos.</Notice>
            </FadeIn>
          ) : null}
          {saved.learn && !saved.youtube ? (
            <ThemedText type="small" themeColor="textSecondary">
              Videos you watch count only while YouTube is on under Sharing permissions.
            </ThemedText>
          ) : null}
          <Divider />
          <FactList
            items={[
              { icon: { ios: 'lock', android: 'lock', web: 'lock' }, text: 'Other videos never leave your browser.' },
              { icon: { ios: 'arrow.triangle.2.circlepath', android: 'autorenew', web: 'autorenew' }, text: 'Interests that change are picked up within weeks.' },
              { icon: { ios: 'trash', android: 'delete', web: 'delete' }, text: 'Turn it off anytime: what it collected and learned is deleted.' },
            ]}
          />
        </SectionCard>

        <LearnedInterests key="learned" />

        <SectionCard
          key="sharing"
          title="Sharing permissions"
          description="You choose what is shared."
          icon={{ ios: 'lock.shield', android: 'shield', web: 'shield' }}>
          {row(
            'youtube',
            'YouTube with page details',
            'Rhythm can use the link, title, channel, description excerpt and length of YouTube videos you permit.',
          )}
          <Divider />
          {RECOMMENDATIONS_ENABLED ? <>
            {row(
              'transcripts',
              'Task transcript reading',
              'Only for a task you start, for at most three shortlisted videos. Copies expire within 24 hours.',
            )}
            <Divider />
          </> : null}
          {row(
            'agent',
            'Share with my chosen agent',
            RECOMMENDATIONS_ENABLED
              ? 'Your connected agent receives your interests and the video content you approve when it uses Rhythm’s tools.'
              : 'Your connected agent can read your interests, and with the Saved videos permission the videos you saved with their transcripts, so it can summarise them.',
          )}
          <Divider />
          {row(
            'memory',
            'Private long-term memory',
            'Confirmed context and feedback are also kept in your private SurrealDB memory until you remove them.',
          )}
          <Divider />
          <Disclosure label="What is shared and how long it’s kept">
            {RECOMMENDATIONS_ENABLED ? (
              <ThemedText type="small" themeColor="textSecondary">
                After you permit a video, Rhythm can send its link, title, channel, visible description excerpt and duration to your Rhythm server.
                Transcript reading only happens for a task you start, for at most three shortlisted videos.
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              With learning on, the Chrome extension sends the fitness, health and food videos you watch, and Rhythm reads your
              messages to the coach and the recommendations you save or mark helpful. Collected video signals are kept 60 days.
              Learning looks back 45 days, and older activity counts less.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Save to Rhythm in the Chrome extension also opens the video’s YouTube transcript, reads it and closes it again,
              and keeps the transcript with that video.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Turning learning off deletes the collected video signals and the interests learned from them. Turning YouTube
              off deletes the collected video signals.
            </ThemedText>
            {RECOMMENDATIONS_ENABLED ? (
              <ThemedText type="small" themeColor="textSecondary">
                Private transcript copies expire within 24 hours; temporary task details are removed after seven days.
                Saved recommendations, their short quoted excerpts and confirmed preferences stay until you delete them.
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              Your chosen external agent receives your interests and approved video content when it uses Rhythm’s tools.
              Its own host’s retention policy applies. Connecting does not transfer a model subscription.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              With private memory enabled, confirmed preferences and feedback are also sent to SurrealDB Agent Memory,
              configured separately for your account, and retained until you remove them.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Delete content library data removes saved videos, video history, and learned interests. Your meals, workouts and Coach conversation stay.
            </ThemedText>
          </Disclosure>
        </SectionCard>
      </Stagger>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: Spacing.three },
});
