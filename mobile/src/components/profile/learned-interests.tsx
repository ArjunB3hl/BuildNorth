import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Fragment, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AiOrb } from '@/components/ai-orb';
import { Button, Notice } from '@/components/form';
import { Collapse, FadeIn, SkeletonCard } from '@/components/motion';
import { ActionRow } from '@/components/profile/controls';
import { useContentWidth } from '@/components/profile/layout';
import { Divider, SectionCard } from '@/components/profile/section';
import { TagPicker } from '@/components/profile-form';
import { ThemedText } from '@/components/themed-text';
import { Chip, ErrorState, Pill, errorMessage } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import {
  EQUIPMENT, LEARNED_KEY, LENGTHS, LEVELS, TOPICS, addableTopics, applyChange, choicesOf, cleanEquipment,
  describeInterest, fetchLearned, hasEvidence, isApplied, isBlank, learnedOf, levelLabel, minutesLabel,
  sortInterests, sourceText, topicLabel, type ChoiceChange,
} from '@/lib/interest-choices';
import type { LearnedInterest, LearnedView, Level, RhythmResult, Topic } from '@/lib/rhythm';

/*
 * "What Rhythm learned": the interests Rhythm inferred, the user's own picks and blocks, and the level,
 * length and equipment in use, each editable. The user's choices are saved separately from what was
 * inferred (`PUT /rhythm/choices`) and always win over it. With nothing learned or chosen yet, it offers
 * quick picks instead, which work whether or not learning is on.
 */

/** The page shows "Saving…" while any of these is in flight. */
export const CHOICES_MUTATION = ['rhythm-choices'];

/** Where a save's message is shown: next to the control that made it. */
type Where = 'suggestion' | 'topics' | 'picks' | 'level' | 'minutes' | 'equipment';
type Action = ({ type: 'choose'; change: ChoiceChange } | { type: 'forget'; topic: Topic }) & { where: Where };
type Outcome = { tone: 'error' | 'info'; text: string } | null;
type Pending = Action | null;

const LABEL_WIDTH = 96;
const STATE_TONE = { pinned: 'accent', learned: 'success', noticed: 'muted', blocked: 'muted' } as const;
const ICONS = {
  learned: { ios: 'brain', android: 'psychology', web: 'psychology' },
  picks: { ios: 'plus.circle', android: 'add_circle', web: 'add_circle' },
  forget: { ios: 'trash', android: 'delete', web: 'delete' },
  add: { ios: 'plus', android: 'add', web: 'add' },
} as const;

/** A key for the button an action came from, so only that button shows it's working. */
function keyOf(action: Pending): string | null {
  if (!action) return null;
  if (action.type === 'forget') return `forget:${action.topic}`;
  const c = action.change;
  if ('topic' in c) return `${c.kind}:${c.topic}`;
  if (c.kind === 'start') return 'start';
  return `${c.kind}:${JSON.stringify(c.value)}`;
}

function useInterestChoices() {
  const api = useApi();
  const cache = useQueryClient();
  const learned = () => fetchLearned(api.rhythm);
  const query = useQuery({ queryKey: LEARNED_KEY, queryFn: learned });
  const [message, setMessage] = useState<({ where: Where } & NonNullable<Outcome>) | null>(null);

  /** A save's result is the new view; the switches above and the library pick up the new revision. */
  function store(result: RhythmResult) {
    cache.setQueryData<RhythmResult>(LEARNED_KEY, result);
    if (result.profile) {
      cache.setQueryData<RhythmResult>(['rhythm-interests'], (old) =>
        old ? { ...old, profile: result.profile, profileRevision: result.profileRevision } : old);
    }
    void cache.invalidateQueries({ queryKey: ['rhythm-interests'] });
    void cache.invalidateQueries({ queryKey: ['rhythm'], predicate: (q) => q.queryKey[1] !== 'learned' });
  }

  async function perform(action: Action): Promise<Outcome> {
    if (action.type === 'forget') {
      const result = await api.rhythm.forgetTopic(action.topic);
      if (result.status !== 'ok') return { tone: 'error', text: result.message || 'Rhythm couldn’t forget this. Please try again.' };
      store(result);
      return null;
    }
    let current = cache.getQueryData<RhythmResult>(LEARNED_KEY);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Every list goes whole: the server replaces each one with what it's sent.
      const choices = applyChange(choicesOf(learnedOf(current)), action.change);
      const result = await api.rhythm.saveChoices(choices, current?.profileRevision ?? 0);
      if (result.status === 'ok') {
        store(result);
        return null;
      }
      if (result.status !== 'stale_context') {
        return { tone: 'error', text: result.message || 'Your choice couldn’t be saved. Please try again.' };
      }
      // Often learning itself updated the profile in the background. Refetch, then apply only this one
      // change on top of the latest choices, so a change made elsewhere is never overwritten.
      current = await cache.fetchQuery({ queryKey: LEARNED_KEY, queryFn: learned, staleTime: 0 });
      if (isApplied(choicesOf(learnedOf(current)), action.change)) return null;
    }
    return { tone: 'info', text: 'Your interests changed on another screen. This page now shows the latest; try again if you still want to.' };
  }

  const mutation = useMutation({
    mutationKey: CHOICES_MUTATION,
    mutationFn: perform,
    onMutate: () => setMessage(null),
    onSuccess: (outcome, action) => setMessage(outcome ? { where: action.where, ...outcome } : null),
    onError: (error, action) => setMessage({ where: action.where, tone: 'error', text: errorMessage(error) }),
  });

  return {
    query,
    message,
    pending: (mutation.isPending ? mutation.variables : null) as Pending,
    run: (action: Action, onDone?: () => void) =>
      mutation.mutate(action, { onSuccess: (outcome) => { if (!outcome) onDone?.(); } }),
  };
}

type Controls = ReturnType<typeof useInterestChoices>;

/** Forgetting deletes stored videos, so it's confirmed first. */
async function confirmForget(topic: Topic, pinned: boolean) {
  return confirmAction({
    title: `Forget ${topic}?`,
    message: `Rhythm deletes the videos it kept about ${topic} and stops counting your earlier chats about it.`
      + (pinned ? ' It’s also unpinned.' : '') + ' Your other interests stay.',
    confirmLabel: 'Forget',
    destructive: true,
  });
}

export function LearnedInterests() {
  const controls = useInterestChoices();
  const { query } = controls;
  if (query.isPending) return <SkeletonCard lines={4} />;
  if (!query.data) {
    return (
      <SectionCard title="What Rhythm learned" icon={ICONS.learned}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </SectionCard>
    );
  }
  const view = learnedOf(query.data);
  return isBlank(view) || !view
    ? <QuickPicks view={view} controls={controls} />
    : <Learned view={view} controls={controls} />;
}

function Message({ controls, where }: { controls: Controls; where: Where }) {
  const m = controls.message;
  return m?.where === where ? <FadeIn><Notice tone={m.tone}>{m.text}</Notice></FadeIn> : null;
}

function Learned({ view, controls }: { view: LearnedView; controls: Controls }) {
  const { run, pending } = controls;
  const busy = !!pending;
  const working = keyOf(pending);
  const [editing, setEditing] = useState<'level' | 'minutes' | 'equipment' | null>(null);
  const interests = sortInterests(view.interests);
  const addable = addableTopics(view.interests);
  const pinned = new Set(view.choices.pinned);
  const suggestion = view.suggestion;
  // Phones and narrow pages put each topic's actions under its name, so every row has the same shape.
  const stacked = useContentWidth() < 480;
  const equipment = view.availableEquipment.value ?? [];

  const choose = (change: ChoiceChange, where: Where, onDone?: () => void) => run({ type: 'choose', change, where }, onDone);
  const forget = async (topic: Topic, where: Where) => {
    if (await confirmForget(topic, pinned.has(topic))) run({ type: 'forget', topic, where });
  };
  const toggle = (which: 'level' | 'minutes' | 'equipment') => setEditing((open) => (open === which ? null : which));

  return (
    <SectionCard
      // With learning off nothing new is learned, so the list is simply the user's own.
      title={view.learning ? 'What Rhythm learned' : 'Your interests'}
      description={view.learning
        ? 'Keep what fits and remove what doesn’t. Your choices always come before what Rhythm learns.'
        : 'Learning is off, so these change only when you change them.'}
      icon={ICONS.learned}>
      {suggestion ? (
        <FadeIn key={suggestion.topic}>
          <Suggestion
            text={suggestion.text}
            topic={suggestion.topic}
            busy={busy}
            working={working}
            onYes={() => choose({ kind: 'pin', topic: suggestion.topic }, 'suggestion')}
            onNo={() => choose({ kind: 'block', topic: suggestion.topic }, 'suggestion')}
            onForget={() => void forget(suggestion.topic, 'suggestion')}
          />
        </FadeIn>
      ) : null}
      <Message controls={controls} where="suggestion" />

      {interests.length ? (
        <View style={stacked ? styles.topicsStacked : styles.topics}>
          {interests.map((interest, i) => (
            <Fragment key={interest.topic}>
              {stacked && i > 0 ? <Divider /> : null}
              <TopicRow
                interest={interest}
                stacked={stacked}
                busy={busy}
                working={working}
                onChange={(change) => choose(change, 'topics')}
                onForget={() => void forget(interest.topic, 'topics')}
              />
            </Fragment>
          ))}
        </View>
      ) : null}
      {addable.length ? (
        <View style={styles.add}>
          <ThemedText type="small" themeColor="textSecondary">Add an interest</ThemedText>
          <View style={styles.chips}>
            {addable.map((topic) => (
              <AddChip key={topic} topic={topic} disabled={busy} loading={working === `pin:${topic}`}
                onPress={() => choose({ kind: 'pin', topic }, 'topics')} />
            ))}
          </View>
        </View>
      ) : null}
      <Message controls={controls} where="topics" />

      <Divider />
      <Preference
        label="Level"
        value={view.experienceLevel.value ? levelLabel(view.experienceLevel.value) : 'Not known yet'}
        source={sourceText(view.experienceLevel.source, !!view.experienceLevel.value, view.learning)}
        open={editing === 'level'}
        onToggle={() => toggle('level')}>
        <ChoiceChips
          options={[{ key: null, label: 'Learn it' }, ...LEVELS.map((l) => ({ key: l, label: levelLabel(l) }))]}
          selected={pending?.type === 'choose' && pending.change.kind === 'level'
            ? pending.change.value : view.choices.experience_level}
          disabled={busy}
          onSelect={(value) => choose({ kind: 'level', value: value as Level | null }, 'level', () => setEditing(null))}
        />
      </Preference>
      <Message controls={controls} where="level" />
      <Preference
        label="Video length"
        value={minutesLabel(view.preferredDurationMinutes.value)}
        source={sourceText(view.preferredDurationMinutes.source, !!view.preferredDurationMinutes.value, view.learning)}
        open={editing === 'minutes'}
        onToggle={() => toggle('minutes')}>
        <ChoiceChips
          options={[{ key: null, label: 'Learn it' }, ...lengthsWith(view.choices.preferred_duration_minutes).map((m) => ({ key: m, label: `${m} min` }))]}
          selected={pending?.type === 'choose' && pending.change.kind === 'minutes'
            ? pending.change.value : view.choices.preferred_duration_minutes}
          disabled={busy}
          onSelect={(value) => choose({ kind: 'minutes', value: value as number | null }, 'minutes', () => setEditing(null))}
        />
      </Preference>
      <Message controls={controls} where="minutes" />
      <Preference
        label="Equipment"
        value={equipment.length ? equipment.join(', ') : 'None listed'}
        source={sourceText(view.availableEquipment.source, equipment.length > 0, view.learning)}
        open={editing === 'equipment'}
        onToggle={() => toggle('equipment')}>
        <EquipmentEditor
          view={view}
          busy={busy}
          working={working}
          onSave={(value) => choose({ kind: 'equipment', value }, 'equipment', () => setEditing(null))}
          onCancel={() => setEditing(null)}
        />
      </Preference>
      <Message controls={controls} where="equipment" />

      {view.deferred ? (
        <ThemedText type="small" themeColor="textSecondary">Updates will apply once your open video task finishes.</ThemedText>
      ) : null}
    </SectionCard>
  );
}

/** The "You've watched…" check on something newly learned, as in the Chrome extension. */
function Suggestion({ text, topic, busy, working, onYes, onNo, onForget }: {
  text: string; topic: Topic; busy: boolean; working: string | null;
  onYes: () => void; onNo: () => void; onForget: () => void;
}) {
  const dark = useColorScheme() === 'dark';
  return (
    <View style={[styles.suggestion, { backgroundColor: dark ? '#17263A' : '#E8F1FE' }]} accessibilityRole="summary">
      <View style={styles.suggestionText}>
        <AiOrb size={20} still />
        <ThemedText type="small" style={styles.fill}>{text}</ThemedText>
      </View>
      <ActionRow>
        <Button title="Yes" size="small" onPress={onYes} disabled={busy} loading={working === `pin:${topic}`}
          accessibilityLabel={`Yes, more ${topic}`} />
        <Button title="Not interested" size="small" variant="secondary" onPress={onNo} disabled={busy}
          loading={working === `block:${topic}`} accessibilityLabel={`Not interested in ${topic}`} />
        <Button title="Forget this" size="small" variant="quiet" onPress={onForget} disabled={busy}
          loading={working === `forget:${topic}`} accessibilityLabel={`Forget what led Rhythm to ${topic}`} />
      </ActionRow>
    </View>
  );
}

function TopicRow({ interest, stacked, busy, working, onChange, onForget }: {
  interest: LearnedInterest; stacked: boolean; busy: boolean; working: string | null;
  onChange: (change: ChoiceChange) => void; onForget: () => void;
}) {
  const { topic, state } = interest;
  const { label, why } = describeInterest(interest);
  const name = topicLabel(topic);
  const button = (title: string, change: ChoiceChange, variant: 'secondary' | 'quiet', a11y: string) => (
    <Button title={title} size="small" variant={variant} onPress={() => onChange(change)} disabled={busy}
      loading={working === keyOf({ type: 'choose', change, where: 'topics' })} accessibilityLabel={a11y} />
  );
  return (
    <View style={stacked ? styles.topicStacked : styles.topic}>
      <View style={stacked ? styles.topicTextStacked : styles.topicText}>
        <View style={styles.topicTitle}>
          <ThemedText type="smallBold" themeColor={state === 'blocked' ? 'textSecondary' : 'text'}>{name}</ThemedText>
          <Pill label={label} tone={STATE_TONE[state]} />
        </View>
        {why ? <ThemedText type="small" themeColor="textSecondary">{why}</ThemedText> : null}
      </View>
      <View style={styles.topicActions}>
        {state === 'pinned' ? button('Unpin', { kind: 'unpin', topic }, 'secondary', `Unpin ${topic}`) : null}
        {state === 'learned' || state === 'noticed' ? (
          <>
            {button('Keep', { kind: 'pin', topic }, 'secondary', `Keep ${topic}`)}
            {button('Remove', { kind: 'block', topic }, 'quiet', `Remove ${topic}: not interested`)}
          </>
        ) : null}
        {state === 'blocked' ? button('Undo', { kind: 'unblock', topic }, 'secondary', `Undo not interested in ${topic}`) : null}
        {hasEvidence(interest) ? (
          <IconButton label={`Forget the evidence for ${topic}`} disabled={busy} loading={working === `forget:${topic}`} onPress={onForget} />
        ) : null}
      </View>
    </View>
  );
}

/** A small square button holding only an icon, for "Forget the evidence". */
function IconButton({ label, disabled, loading, onPress }: { label: string; disabled: boolean; loading: boolean; onPress: () => void }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        hovered && !disabled && { backgroundColor: theme.backgroundSelected },
        (disabled || pressed) && styles.dim,
      ]}>
      {loading ? <ActivityIndicator color={theme.textSecondary} /> : <SymbolView name={ICONS.forget} size={18} tintColor={theme.textSecondary} />}
    </Pressable>
  );
}

function AddChip({ topic, disabled, loading, onPress }: { topic: Topic; disabled: boolean; loading: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${topic}`}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.addChip, { borderColor: theme.border }, (disabled || pressed) && styles.dim]}>
      {loading ? <ActivityIndicator size="small" color={theme.textSecondary} /> : <SymbolView name={ICONS.add} size={16} tintColor={theme.textSecondary} />}
      <ThemedText type="small">{topicLabel(topic)}</ThemedText>
    </Pressable>
  );
}

/** One of level, length or equipment: the value in use, who decided it, and a way to change it. */
function Preference({ label, value, source, open, onToggle, children }: {
  label: string; value: string; source: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  // On wider pages the editor lines up under the value; phones give it the full width.
  const indent = useContentWidth() >= 560;
  return (
    <View style={styles.preference}>
      <View style={styles.preferenceRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.preferenceLabel}>{label}</ThemedText>
        <View style={styles.fill} accessible accessibilityLabel={`${label}: ${value}. ${source}`}>
          <ThemedText type="small" numberOfLines={2}>{value}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.source}>{source}</ThemedText>
        </View>
        <Button title={open ? 'Close' : 'Change'} size="small" variant="quiet" onPress={onToggle}
          accessibilityLabel={open ? `Close ${label.toLowerCase()}` : `Change ${label.toLowerCase()}`} />
      </View>
      <Collapse open={open} style={indent ? styles.editorIndent : undefined}>{children}</Collapse>
    </View>
  );
}

/** Single-choice chips where `null` is "Learn it". */
function ChoiceChips<T extends string | number>({ options, selected, disabled, onSelect }: {
  options: { key: T | null; label: string }[]; selected: T | null; disabled: boolean; onSelect: (value: T | null) => void;
}) {
  return (
    <View style={[styles.chips, disabled && styles.dim]}>
      {options.map((option) => (
        <Chip
          key={String(option.key)}
          label={option.label}
          selected={option.key === selected}
          onPress={() => { if (!disabled && option.key !== selected) onSelect(option.key); }}
        />
      ))}
    </View>
  );
}

/** The offered lengths, plus the user's own if it's something else. */
function lengthsWith(minutes: number | null): number[] {
  return minutes && !LENGTHS.includes(minutes) ? [...LENGTHS, minutes].sort((a, b) => a - b) : [...LENGTHS];
}

function EquipmentEditor({ view, busy, working, onSave, onCancel }: {
  view: LearnedView; busy: boolean; working: string | null;
  onSave: (value: string[] | null) => void; onCancel: () => void;
}) {
  // Starts from what's in use, so a learned list can be corrected rather than retyped.
  const [draft, setDraft] = useState<string[]>(view.availableEquipment.value ?? []);
  const yours = view.availableEquipment.source === 'you';
  const cleaned = cleanEquipment(draft);
  const unchanged = yours && cleaned.join('\n') === (view.choices.available_equipment ?? []).join('\n');
  return (
    <View style={styles.editorBody}>
      <TagPicker label="Equipment" hideLabel suggestions={[...EQUIPMENT]} selected={draft} onChange={setDraft} />
      <ActionRow>
        <Button title="Save" size="small" onPress={() => onSave(cleaned)} disabled={busy || unchanged}
          loading={!!working?.startsWith('equipment:[')} accessibilityLabel="Save equipment" />
        {yours ? (
          <Button title="Learn it" size="small" variant="secondary" onPress={() => onSave(null)} disabled={busy}
            loading={working === 'equipment:null'} accessibilityLabel="Let Rhythm learn your equipment" />
        ) : null}
        <Button title="Cancel" size="small" variant="quiet" onPress={onCancel} disabled={busy} />
      </ActionRow>
    </View>
  );
}

/** With nothing learned or chosen yet: a few taps so Rhythm works before learning has evidence. */
function QuickPicks({ view, controls }: { view: LearnedView | null; controls: Controls }) {
  const { run, pending } = controls;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [level, setLevel] = useState<Level | null>(view?.choices.experience_level ?? null);
  const learning = !!view?.learning;
  return (
    <SectionCard
      title="Start with a few picks"
      description={learning
        ? 'Rhythm uses your picks straight away, and adds what it learns as you go.'
        : 'Rhythm uses your picks straight away, even with learning off.'}
      icon={ICONS.picks}>
      <View style={styles.chips}>
        {TOPICS.map((topic) => {
          const selected = topics.includes(topic);
          return (
            <Chip key={topic} label={topicLabel(topic)} selected={selected}
              onPress={() => setTopics(selected ? topics.filter((t) => t !== topic) : [...topics, topic])} />
          );
        })}
      </View>
      <View style={styles.add}>
        <ThemedText type="small" themeColor="textSecondary">Your level (optional)</ThemedText>
        <View style={styles.chips}>
          {LEVELS.map((l) => (
            <Chip key={l} label={levelLabel(l)} selected={level === l} onPress={() => setLevel(level === l ? null : l)} />
          ))}
        </View>
      </View>
      <Message controls={controls} where="picks" />
      <ActionRow>
        <Button
          title="Use my picks"
          size="small"
          disabled={!topics.length || !!pending}
          loading={keyOf(pending) === 'start'}
          onPress={() => run({ type: 'choose', change: { kind: 'start', topics, level }, where: 'picks' })}
        />
      </ActionRow>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.6 },
  suggestion: { borderRadius: 12, padding: Spacing.three, gap: Spacing.three - Spacing.one },
  suggestionText: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.half },
  topics: { gap: Spacing.three },
  topicsStacked: { gap: Spacing.three - Spacing.one },
  topicStacked: { gap: Spacing.two },
  topicTextStacked: { gap: Spacing.half },
  // The actions sit beside the name, and drop under it when the row is too narrow for both.
  topic: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.two },
  topicText: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0, gap: Spacing.half },
  topicTitle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  topicActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  iconButton: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  add: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  addChip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 32, borderRadius: 16, borderWidth: 1,
    borderStyle: 'dashed', paddingLeft: Spacing.two, paddingRight: Spacing.three,
  },
  preference: { gap: Spacing.two },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  preferenceLabel: { width: LABEL_WIDTH },
  source: { fontSize: 12, lineHeight: 16 },
  editorIndent: { paddingLeft: LABEL_WIDTH + Spacing.three },
  editorBody: { gap: Spacing.three },
});
