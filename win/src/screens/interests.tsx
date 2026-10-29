import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AiOrb } from '../components/sidebar';
import {
  Button,
  Card,
  Chip,
  Notice,
  Pill,
  Screen,
  ThemedText,
  ToggleRow,
} from '../components/ui';
import { useStore } from '../data/store';
import { describe } from '../lib/account';
import {
  addableTopics,
  applyChange,
  choicesOf,
  describeInterest,
  EQUIPMENT,
  hasEvidence,
  isApplied,
  isBlank,
  learnedOf,
  LENGTHS,
  levelLabel,
  LEVELS,
  minutesLabel,
  sortInterests,
  sourceText,
  TOPICS,
  topicLabel,
  type ChoiceChange,
} from '../lib/interest-choices';
import type {
  InterestsProfile,
  Level,
  RhythmConsent,
  RhythmResult,
  RhythmSettings,
  Topic,
} from '../lib/rhythm';
import { useLoad } from '../lib/use-load';
import { Spacing, useTheme } from '../theme';

// Interests & sharing: the website's (mobile/src/app/(app)/(tabs)/profile/interests.tsx and
// components/profile/learned-interests.tsx). Each switch saves as soon as it changes (PUT /rhythm/settings); the
// user's own interest choices save separately (PUT /rhythm/choices) and always win over what Rhythm learns. Like the
// website now, there is no "You've watched…" prompt.

type Switch = 'learn' | 'youtube' | 'agent' | 'memory';
type Switches = Record<Switch, boolean>;

function switchesOf(profile?: InterestsProfile): Switches {
  const consent = profile?.consent;
  return {
    learn: !!consent?.learn,
    // One switch covers both: Rhythm only works with YouTube pages while the site and page details are on.
    youtube: !!consent?.metadata && !!profile?.enabledSites.includes('youtube'),
    agent: !!consent?.agent,
    memory: !!consent?.memory,
  };
}

/** The saved settings with one switch changed; every other switch keeps its saved value. */
function withSwitch(
  profile: InterestsProfile | undefined,
  key: Switch,
  value: boolean,
): RhythmSettings {
  const saved = profile?.consent;
  const consent: RhythmConsent = {
    metadata: !!saved?.metadata,
    transcripts: !!saved?.transcripts,
    agent: !!saved?.agent,
    memory: !!saved?.memory,
    learn: !!saved?.learn,
  };
  let enabledSites = (profile?.enabledSites ?? []).filter(s => s === 'youtube');
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
      message:
        'Rhythm stops learning and deletes the video history it collected and the interests it learned from it.',
    };
  }
  if (key === 'youtube' && current.learn) {
    return {
      title: 'Turn off YouTube?',
      message:
        'Pages you permitted pause, and the video history Rhythm collected for learning is deleted.',
    };
  }
  if (key === 'memory') {
    return {
      title: 'Turn off private memory?',
      message: 'Rhythm’s copies in your private memory are erased.',
    };
  }
  return null;
}

function confirm(title: string, message: string, label: string) {
  return new Promise<boolean>(resolve =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: label, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

function requireOk(result: RhythmResult): RhythmResult {
  if (result.status !== 'ok' && result.status !== 'profile_required') {
    throw new Error(result.message || 'Rhythm couldn’t load your settings.');
  }
  return result;
}

export function InterestsScreen() {
  const { api } = useStore();
  const interests = useLoad(
    api ? async () => requireOk(await api.rhythm.interests()) : null,
  );
  const learned = useLoad(
    api ? async () => requireOk(await api.rhythm.learned()) : null,
  );
  const [saving, setSaving] = useState<{ key: Switch; value: boolean } | null>(
    null,
  );
  const [message, setMessage] = useState<{
    key: Switch;
    tone: 'error' | 'info';
    text: string;
  } | null>(null);
  const [choosing, setChoosing] = useState(false);

  if (!api) {
    return (
      <Screen title="Interests & sharing">
        <Notice tone="info">
          Personalisation and sharing settings belong to a Rhythm account; this
          build shows demo data.
        </Notice>
      </Screen>
    );
  }
  if (!interests.data) {
    return (
      <Screen title="Interests & sharing">
        {interests.error ? (
          <>
            <Notice tone="error">{describe(interests.error)}</Notice>
            <View style={styles.start}>
              <Button
                title="Try again"
                variant="secondary"
                onPress={interests.reload}
              />
            </View>
          </>
        ) : (
          <ThemedText themeColor="textSecondary">
            Loading your settings…
          </ThemedText>
        )}
      </Screen>
    );
  }

  const profile = interests.data.profile;
  const saved = switchesOf(profile);
  // While a change saves, its switch already shows the new position.
  const shown: Switches = saving
    ? { ...saved, [saving.key]: saving.value }
    : saved;

  async function change(key: Switch, value: boolean) {
    const warning = value ? null : withdrawal(key, saved);
    if (
      warning &&
      !(await confirm(warning.title, warning.message, 'Turn off'))
    ) {
      return;
    }
    setSaving({ key, value });
    setMessage(null);
    try {
      let base = profile;
      // A stale revision is often learning itself updating the profile: refetch, then apply this one switch on the
      // latest settings, so a change made elsewhere is never overwritten.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await api!.rhythm.saveSettings(
          withSwitch(base, key, value),
          base?.profileRevision ?? 0,
        );
        if (result.status === 'ok') {
          interests.setData(old =>
            old ? { ...old, profile: result.profile } : result,
          );
          interests.reload();
          learned.reload();
          return;
        }
        if (result.status !== 'stale_context') {
          setMessage({
            key,
            tone: 'error',
            text:
              result.message || 'Your settings could not be saved. Try again.',
          });
          return;
        }
        const fresh = requireOk(await api!.rhythm.interests());
        interests.setData(fresh);
        base = fresh.profile;
        if (switchesOf(base)[key] === value) {
          return;
        }
      }
      setMessage({
        key,
        tone: 'info',
        text: 'Your settings changed on another screen. This page now shows the latest; switch it again if you still want to.',
      });
    } catch (e) {
      setMessage({ key, tone: 'error', text: describe(e) });
    } finally {
      setSaving(null);
    }
  }

  const busy = !!saving;
  const row = (key: Switch, label: string, description: string) => (
    <>
      <ToggleRow
        label={label}
        description={description}
        value={shown[key]}
        onChange={value => change(key, value)}
        disabled={busy}
      />
      {message?.key === key ? (
        <Notice tone={message.tone}>{message.text}</Notice>
      ) : null}
    </>
  );

  return (
    <Screen
      title="Interests & sharing"
      subtitle={`Rhythm finds workout, martial arts and cooking videos for you. Choose whether it learns what suits you, and what it may share. ${
        busy || choosing ? 'Saving…' : 'Changes save as soon as you make them.'
      }`}
    >
      <Card style={styles.card}>
        <View style={styles.heading}>
          <AiOrb size={28} />
          <View style={styles.fill}>
            <ThemedText type="smallBold">Personalised by AI</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Nothing to fill in: Rhythm works out which videos suit you from
              what you do, and you can correct it.
            </ThemedText>
          </View>
        </View>
        {row(
          'learn',
          'Learn my interests automatically',
          'Rhythm learns which workouts, martial arts, exercise and cooking videos suit you from what you ask your coach and the fitness and food videos you watch with the Chrome extension.',
        )}
        {saved.learn && !profile?.confirmed ? (
          <Notice tone="info">
            Still learning — chat with your coach or watch a few workout or
            recipe videos.
          </Notice>
        ) : null}
        {saved.learn && !saved.youtube ? (
          <ThemedText type="small" themeColor="textSecondary">
            Videos you watch count only while YouTube is on under Sharing
            permissions.
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Other videos never leave your browser. Interests that change are
          picked up within weeks. Turn it off any time: what it collected and
          learned is deleted.
        </ThemedText>
      </Card>

      <LearnedInterests
        result={learned.data}
        loading={learned.loading && !learned.data}
        error={learned.error}
        onRetry={learned.reload}
        onSaved={result => {
          learned.setData(result);
          interests.reload();
        }}
        onBusy={setChoosing}
      />

      <Card style={styles.card}>
        <ThemedText type="smallBold">Sharing permissions</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          You choose what is shared.
        </ThemedText>
        {row(
          'youtube',
          'YouTube with page details',
          'Rhythm can use the link, title, channel, description excerpt and length of YouTube videos you permit.',
        )}
        {row(
          'agent',
          'Share with my chosen agent',
          'Your connected agent can read your interests, and with the Saved videos permission the videos you saved with their transcripts, so it can summarise them.',
        )}
        {row(
          'memory',
          'Private long-term memory',
          'Confirmed context and feedback are also kept in your private SurrealDB memory until you remove them.',
        )}
        <Disclosure label="What is shared and how long it’s kept">
          <ThemedText type="small" themeColor="textSecondary">
            With learning on, the Chrome extension sends the fitness, health and
            food videos you watch, and Rhythm reads your messages to the coach
            and the recommendations you save or mark helpful. Collected video
            signals are kept 60 days. Learning looks back 45 days, and older
            activity counts less.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Save to Rhythm in the Chrome extension also opens the video’s
            YouTube transcript, reads it and closes it again, and keeps the
            transcript with that video.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Turning learning off deletes the collected video signals and the
            interests learned from them. Turning YouTube off deletes the
            collected video signals.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Your chosen external agent receives your interests and approved
            video content when it uses Rhythm’s tools. Its own host’s retention
            policy applies. Connecting does not transfer a model subscription.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            With private memory on, confirmed preferences and feedback are also
            sent to SurrealDB Agent Memory, configured separately for your
            account, and kept until you remove them.
          </ThemedText>
        </Disclosure>
      </Card>
    </Screen>
  );
}

function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.gap}>
      <View style={styles.start}>
        <Button
          title={`${open ? '▾' : '▸'} ${label}`}
          size="small"
          variant="quiet"
          onPress={() => setOpen(o => !o)}
        />
      </View>
      {open ? <View style={styles.gap}>{children}</View> : null}
    </View>
  );
}

/** "What Rhythm learned" / "Your interests": the topics in use, the user's own picks and blocks, and level, length
 * and equipment, each editable. With nothing learned or chosen yet, quick picks instead. */
function LearnedInterests({
  result,
  loading,
  error,
  onRetry,
  onSaved,
  onBusy,
}: {
  result: RhythmResult | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSaved: (result: RhythmResult) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { api } = useStore();
  const theme = useTheme();
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: 'error' | 'info';
    text: string;
  } | null>(null);
  const [editing, setEditing] = useState<
    'level' | 'minutes' | 'equipment' | null
  >(null);
  const [picks, setPicks] = useState<Topic[]>([]);
  const [pickLevel, setPickLevel] = useState<Level | null>(null);
  const view = learnedOf(result);

  if (loading) {
    return (
      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Loading what Rhythm learned…
        </ThemedText>
      </Card>
    );
  }
  if (error && !result) {
    return (
      <Card style={styles.card}>
        <ThemedText type="smallBold">What Rhythm learned</ThemedText>
        <Notice tone="error">{describe(error)}</Notice>
        <View style={styles.start}>
          <Button title="Try again" variant="secondary" onPress={onRetry} />
        </View>
      </Card>
    );
  }

  async function run(key: string, change: ChoiceChange | { forget: Topic }) {
    if (!api) {
      return;
    }
    setWorking(key);
    onBusy(true);
    setMessage(null);
    try {
      if ('forget' in change) {
        const r = await api.rhythm.forgetTopic(change.forget);
        if (r.status !== 'ok') {
          setMessage({
            tone: 'error',
            text: r.message || 'Rhythm couldn’t forget this. Try again.',
          });
          return;
        }
        onSaved(r);
        return;
      }
      let current = result;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // Every list goes whole: the server replaces each one with what it's sent.
        const choices = applyChange(choicesOf(learnedOf(current)), change);
        const r = await api.rhythm.saveChoices(
          choices,
          current?.profileRevision ?? 0,
        );
        if (r.status === 'ok') {
          onSaved(r);
          return;
        }
        if (r.status !== 'stale_context') {
          setMessage({
            tone: 'error',
            text: r.message || 'Your choice couldn’t be saved. Try again.',
          });
          return;
        }
        current = requireOk(await api.rhythm.learned());
        if (isApplied(choicesOf(learnedOf(current)), change)) {
          onSaved(current);
          return;
        }
      }
      setMessage({
        tone: 'info',
        text: 'Your interests changed on another screen. This page now shows the latest; try again if you still want to.',
      });
    } catch (e) {
      setMessage({ tone: 'error', text: describe(e) });
    } finally {
      setWorking(null);
      onBusy(false);
    }
  }

  const busy = working != null;

  if (isBlank(view)) {
    return (
      <Card style={styles.card}>
        <ThemedText type="smallBold">Get started quickly</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Nothing learned or chosen yet. Pick what you’re into and Rhythm starts
          from there; it works whether or not learning is on.
        </ThemedText>
        <View style={styles.chips}>
          {TOPICS.map(t => (
            <Chip
              key={t}
              label={topicLabel(t)}
              selected={picks.includes(t)}
              onPress={() =>
                setPicks(p =>
                  p.includes(t) ? p.filter(x => x !== t) : [...p, t],
                )
              }
            />
          ))}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Your level (optional)
        </ThemedText>
        <View style={styles.chips}>
          {LEVELS.map(l => (
            <Chip
              key={l}
              label={levelLabel(l)}
              selected={pickLevel === l}
              onPress={() => setPickLevel(pickLevel === l ? null : l)}
            />
          ))}
        </View>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <View style={styles.start}>
          <Button
            title="Save my interests"
            onPress={() =>
              run('start', { kind: 'start', topics: picks, level: pickLevel })
            }
            disabled={!picks.length}
            loading={working === 'start'}
          />
        </View>
      </Card>
    );
  }

  const v = view!;
  const interests = sortInterests(v.interests);
  const addable = addableTopics(v.interests);
  const pinned = new Set(v.choices.pinned);
  const equipment = v.availableEquipment.value ?? [];

  async function forget(topic: Topic) {
    const ok = await confirm(
      `Forget ${topic}?`,
      `Rhythm deletes the videos it kept about ${topic} and stops counting your earlier chats about it.${
        pinned.has(topic) ? ' It’s also unpinned.' : ''
      } Your other interests stay.`,
      'Forget',
    );
    if (ok) {
      run(`forget:${topic}`, { forget: topic });
    }
  }

  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold">
        {v.learning ? 'What Rhythm learned' : 'Your interests'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {v.learning
          ? 'Keep what fits and remove what doesn’t. Your choices always come before what Rhythm learns.'
          : 'Learning is off, so these change only when you change them.'}
      </ThemedText>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {interests.map(interest => {
        const { label, why } = describeInterest(interest);
        const t = interest.topic;
        return (
          <View
            key={t}
            style={[styles.topicRow, { borderTopColor: theme.border }]}
          >
            <View style={styles.fill}>
              <View style={styles.topicTitle}>
                <ThemedText type="smallBold">{topicLabel(t)}</ThemedText>
                <Pill
                  label={label}
                  tone={
                    interest.state === 'pinned'
                      ? 'accent'
                      : interest.state === 'learned'
                      ? 'success'
                      : 'muted'
                  }
                />
              </View>
              {why ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {why}
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.actions}>
              {interest.state === 'pinned' ? (
                <Button
                  title="Unpin"
                  size="small"
                  variant="quiet"
                  disabled={busy}
                  loading={working === `unpin:${t}`}
                  onPress={() => run(`unpin:${t}`, { kind: 'unpin', topic: t })}
                />
              ) : interest.state === 'blocked' ? (
                <Button
                  title="Undo"
                  size="small"
                  variant="quiet"
                  disabled={busy}
                  loading={working === `unblock:${t}`}
                  onPress={() =>
                    run(`unblock:${t}`, { kind: 'unblock', topic: t })
                  }
                />
              ) : (
                <>
                  <Button
                    title="Keep"
                    size="small"
                    variant="secondary"
                    disabled={busy}
                    loading={working === `pin:${t}`}
                    onPress={() => run(`pin:${t}`, { kind: 'pin', topic: t })}
                  />
                  <Button
                    title="Not interested"
                    size="small"
                    variant="quiet"
                    disabled={busy}
                    loading={working === `block:${t}`}
                    onPress={() =>
                      run(`block:${t}`, { kind: 'block', topic: t })
                    }
                  />
                </>
              )}
              {hasEvidence(interest) ? (
                <Button
                  title="Forget"
                  size="small"
                  variant="quiet"
                  disabled={busy}
                  loading={working === `forget:${t}`}
                  onPress={() => forget(t)}
                />
              ) : null}
            </View>
          </View>
        );
      })}

      {addable.length ? (
        <View style={[styles.topicRow, { borderTopColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Add
          </ThemedText>
          <View style={styles.chips}>
            {addable.map(t => (
              <Chip
                key={t}
                label={`+ ${topicLabel(t)}`}
                selected={false}
                onPress={() => run(`pin:${t}`, { kind: 'pin', topic: t })}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Setting
        label="Level"
        value={
          v.experienceLevel.value
            ? levelLabel(v.experienceLevel.value)
            : 'Any level'
        }
        source={sourceText(
          v.experienceLevel.source,
          !!v.experienceLevel.value,
          v.learning,
        )}
        open={editing === 'level'}
        onToggle={() => setEditing(e => (e === 'level' ? null : 'level'))}
      >
        <View style={styles.chips}>
          {LEVELS.map(l => (
            <Chip
              key={l}
              label={levelLabel(l)}
              selected={v.choices.experience_level === l}
              onPress={() => run(`level:${l}`, { kind: 'level', value: l })}
            />
          ))}
          <Chip
            label={v.learning ? 'Let Rhythm learn it' : 'Not set'}
            selected={v.choices.experience_level == null}
            onPress={() => run('level:null', { kind: 'level', value: null })}
          />
        </View>
      </Setting>
      <Setting
        label="Video length"
        value={minutesLabel(v.preferredDurationMinutes.value)}
        source={sourceText(
          v.preferredDurationMinutes.source,
          !!v.preferredDurationMinutes.value,
          v.learning,
        )}
        open={editing === 'minutes'}
        onToggle={() => setEditing(e => (e === 'minutes' ? null : 'minutes'))}
      >
        <View style={styles.chips}>
          {LENGTHS.map(m => (
            <Chip
              key={m}
              label={minutesLabel(m)}
              selected={v.choices.preferred_duration_minutes === m}
              onPress={() => run(`minutes:${m}`, { kind: 'minutes', value: m })}
            />
          ))}
          <Chip
            label={v.learning ? 'Let Rhythm learn it' : 'Any length'}
            selected={v.choices.preferred_duration_minutes == null}
            onPress={() =>
              run('minutes:null', { kind: 'minutes', value: null })
            }
          />
        </View>
      </Setting>
      <Setting
        label="Equipment"
        value={equipment.length ? equipment.join(', ') : 'Not set'}
        source={sourceText(
          v.availableEquipment.source,
          equipment.length > 0,
          v.learning,
        )}
        open={editing === 'equipment'}
        onToggle={() =>
          setEditing(e => (e === 'equipment' ? null : 'equipment'))
        }
      >
        <View style={styles.chips}>
          {EQUIPMENT.map(item => {
            const chosen = v.choices.available_equipment ?? equipment;
            const on = chosen.includes(item);
            return (
              <Chip
                key={item}
                label={item}
                selected={on}
                onPress={() =>
                  run(`equipment:${item}`, {
                    kind: 'equipment',
                    value: on
                      ? chosen.filter(x => x !== item)
                      : [...chosen, item],
                  })
                }
              />
            );
          })}
          <Chip
            label={v.learning ? 'Let Rhythm learn it' : 'Clear'}
            selected={v.choices.available_equipment == null}
            onPress={() =>
              run('equipment:null', { kind: 'equipment', value: null })
            }
          />
        </View>
      </Setting>
    </Card>
  );
}

function Setting({
  label,
  value,
  source,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  source: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.setting, { borderTopColor: theme.border }]}>
      <View style={styles.topicTitle}>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.settingLabel}
        >
          {label}
        </ThemedText>
        <View style={styles.fill}>
          <ThemedText type="smallBold">{value}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {source}
          </ThemedText>
        </View>
        <Button
          title={open ? 'Done' : 'Change'}
          size="small"
          variant="quiet"
          onPress={onToggle}
        />
      </View>
      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: Spacing.two },
  start: { alignItems: 'flex-start' },
  card: { gap: Spacing.three },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
  },
  topicTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  setting: { gap: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1 },
  settingLabel: { width: 96 },
});
