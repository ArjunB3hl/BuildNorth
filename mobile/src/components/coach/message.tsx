import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { AiOrb } from '@/components/ai-orb';
import { Appear } from '@/components/coach/appear';
import { Markdown, revealPlan, useMarkdownBlocks } from '@/components/coach/markdown';
import { ThinkingStatus } from '@/components/coach/thinking';
import { Accent, Button, Notice, Success } from '@/components/form';
import { GradientView } from '@/components/gradient';
import { FadeIn, Skeleton } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, Pill, Row } from '@/components/ui';
import { AiColors, Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { toPlainText } from '@/lib/markdown';
import type { CoachContext, CoachMessage, Suggestion } from '@/lib/types';

const AVATAR = 28;
/** On wide screens the reply lines up under the "Coach" label, past the avatar. */
const INDENT = AVATAR + Spacing.two;

/** The coach's name beside its orb, which turns faster and breathes while it's thinking. */
function CoachLabel({ thinking = false, still = false }: { thinking?: boolean; still?: boolean }) {
  return (
    <Row style={styles.label}>
      <AiOrb size={AVATAR} thinking={thinking} still={still} />
      <ThemedText type="smallBold">Coach</ThemedText>
    </Row>
  );
}

/**
 * One message in the conversation.
 * - `reveal`: a reply that just arrived in this session; its blocks fade up one after another.
 * - `enter`: the message fades in once as a whole (the last couple when the history loads); the
 *   number staggers them.
 */
export function MessageItem({ message, wide, reveal = false, enter = null, latest = false }: {
  message: CoachMessage;
  wide: boolean;
  reveal?: boolean;
  enter?: number | null;
  /** The newest reply: only its orb keeps turning. */
  latest?: boolean;
}) {
  return message.role === 'user' ? (
    <UserMessage text={message.content} enter={enter} />
  ) : (
    <AssistantMessage message={message} wide={wide} reveal={reveal} enter={enter} latest={latest} />
  );
}

/** What the user wrote, as plain text in an accent bubble on the right. */
export function UserMessage({ text, faded = false, enter = null }: { text: string; faded?: boolean; enter?: number | null }) {
  return (
    <Appear when={enter !== null} index={enter ?? 0} style={styles.userRow}>
      <View style={[styles.userBubble, faded && styles.faded]} accessibilityLabel={`You: ${text}`}>
        <ThemedText selectable style={styles.userText}>
          {text}
        </ThemedText>
      </View>
    </Appear>
  );
}

function AssistantMessage({ message, wide, reveal, enter, latest }: {
  message: CoachMessage;
  wide: boolean;
  reveal: boolean;
  enter: number | null;
  latest: boolean;
}) {
  const blocks = useMarkdownBlocks(message.content);
  const plan = reveal ? revealPlan(blocks) : null;
  // What the reply was built from, and its suggestions, follow once the text has been written out.
  const after = plan ? Math.max(0, plan.end - 180) : 0;
  return (
    <Appear when={enter !== null} index={enter ?? 0} style={styles.assistant}>
      <CoachLabel still={!latest} />
      <View style={[styles.assistantBody, wide && styles.indented]}>
        <Markdown blocks={blocks} reveal={plan} />
        {message.context ? (
          <Appear when={!!plan} delay={after}>
            <ContextLine context={message.context} />
          </Appear>
        ) : null}
        {message.suggestions.length ? (
          <View style={styles.suggestions}>
            {message.suggestions.map((s, i) => (
              <Appear key={`${message.id}-${i}`} when={!!plan} delay={after + 120} index={i}>
                <SuggestionCard suggestion={s} />
              </Appear>
            ))}
          </View>
        ) : null}
      </View>
    </Appear>
  );
}

/** Stands in for the reply while the coach works on it. */
export function PendingReply({ wide, onCancel }: { wide: boolean; onCancel: () => void }) {
  return (
    <FadeIn delay={120} style={styles.assistant}>
      <CoachLabel thinking />
      <View style={[styles.pendingBody, wide && styles.indented]}>
        <Row style={styles.thinking}>
          <ThinkingStatus />
          <View style={styles.fill} />
          <Button title="Cancel" size="small" variant="quiet" onPress={onCancel} />
        </Row>
        <ThemedText type="small" themeColor="textSecondary" style={[styles.caption, styles.quiet]}>
          Replies can take up to a minute.
        </ThemedText>
      </View>
    </FadeIn>
  );
}

/** A message that didn't get a reply, with the reason and a way to send it again. */
export function FailedReply({ error, onRetry, wide }: { error: unknown; onRetry: () => void; wide: boolean }) {
  return (
    <FadeIn style={[styles.assistantBody, wide && styles.indented]}>
      <Notice tone="error">{errorMessage(error)}</Notice>
      <SecondaryAction title="Retry" onPress={onRetry} />
    </FadeIn>
  );
}

/** Placeholder bubbles while the conversation loads. */
export function ConversationSkeleton({ wide }: { wide: boolean }) {
  return (
    <View style={styles.skeleton} accessibilityRole="progressbar" accessibilityLabel="Loading conversation">
      <View style={styles.userRow}>
        <Skeleton width="45%" height={40} radius={20} />
      </View>
      <View style={styles.assistant}>
        <Row style={styles.label}>
          <Skeleton width={AVATAR} height={AVATAR} radius={AVATAR / 2} />
          <Skeleton width={56} height={12} />
        </Row>
        <View style={[styles.assistantBody, wide && styles.indented]}>
          <Skeleton width="92%" />
          <Skeleton width="84%" />
          <Skeleton width="60%" />
        </View>
      </View>
    </View>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a reply was built from. A reply made without long-term memory says so instead of passing as fully personalized. */
function ContextLine({ context }: { context: CoachContext }) {
  const theme = useTheme();
  if (context.memory !== 'ok') {
    return (
      <View style={[styles.memoryNote, { backgroundColor: theme.backgroundSelected }]} accessibilityRole="text">
        <SymbolView name={{ ios: 'info.circle', android: 'info', web: 'info' }} size={16} tintColor={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={[styles.caption, styles.fill]}>
          {context.memory === 'unavailable'
            ? 'Long-term memory couldn’t be checked, so this reply used only your profile and the preferences saved in the app.'
            : 'Long-term memory isn’t set up, so this reply used only your profile and the preferences saved in the app.'}
        </ThemedText>
      </View>
    );
  }
  const parts = [
    context.preferences ? plural(context.preferences, 'saved preference') + (context.recalled ? ` (${context.recalled} recalled)` : '') : null,
    context.recipes ? plural(context.recipes, 'recipe') : null,
    context.routines ? plural(context.routines, 'routine') : null,
    context.planItems ? 'this week’s plan' : null,
  ].filter(Boolean);
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
      {`Memory checked${parts.length ? ` · used ${parts.join(' · ')}` : ' · nothing saved was relevant'}`}
    </ThemedText>
  );
}

/** Suggestions only turn into saved data after the user reviews or confirms them. */
function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const remember = useMutation({
    mutationFn: () => api.preferences.add(suggestion.content, 'coach'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['preferences'] }),
  });

  const label = { recipe: 'Recipe idea', routine: 'Routine idea', preference: 'Preference' }[suggestion.type];
  const confirmRemember = async () => {
    const confirmed = await confirmAction({ title: 'Remember this preference?', message: suggestion.content, confirmLabel: 'Remember' });
    if (confirmed) remember.mutate();
  };

  return (
    <Card style={styles.suggestion}>
      <GradientView style={styles.suggestionEdge} />
      <Row style={styles.suggestionHeader}>
        <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={14} tintColor={AiColors.violet} />
        <ThemedText type="small" themeColor="textSecondary" style={[styles.caption, styles.fill]} numberOfLines={1}>
          Suggested by Coach
        </ThemedText>
        <Pill label={label} tone="accent" />
      </Row>
      <ThemedText type="smallBold" numberOfLines={2}>
        {suggestion.title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
        {toPlainText(suggestion.content)}
      </ThemedText>
      {suggestion.type === 'recipe' ? (
        <SecondaryAction
          title="Review and save recipe"
          onPress={() => router.push({ pathname: '/meals/import', params: { text: `${suggestion.title}\n${suggestion.content}`, source: 'coach' } })}
        />
      ) : null}
      {suggestion.type === 'routine' ? (
        <SecondaryAction
          title="Review and save routine"
          onPress={() => router.push({ pathname: '/activity/import', params: { text: `${suggestion.title}\n${suggestion.content}` } })}
        />
      ) : null}
      {suggestion.type === 'preference' ? (
        remember.isSuccess ? (
          <Row style={styles.saved}>
            <SymbolView name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }} size={18} tintColor={Success} />
            <ThemedText type="small">Saved to your preferences.</ThemedText>
          </Row>
        ) : (
          <>
            {remember.isError ? <Notice tone="error">{errorMessage(remember.error)}</Notice> : null}
            <SecondaryAction title="Remember this" loading={remember.isPending} onPress={confirmRemember} />
          </>
        )
      ) : null}
    </Card>
  );
}

/** A small secondary button at its natural width rather than stretched across the card. */
function SecondaryAction({ title, onPress, loading }: { title: string; onPress: () => void; loading?: boolean }) {
  return (
    <View style={styles.action}>
      <Button title={title} size="small" variant="secondary" loading={loading} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  label: { gap: Spacing.two },
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '80%',
    backgroundColor: Accent,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
  },
  userText: { color: '#ffffff' },
  faded: { opacity: 0.6 },
  assistant: { gap: Spacing.two },
  assistantBody: { gap: Spacing.three - Spacing.one },
  pendingBody: { gap: Spacing.half },
  indented: { paddingLeft: INDENT },
  thinking: { minHeight: 36 },
  caption: { fontSize: 12, lineHeight: 16 },
  quiet: { opacity: 0.8 },
  memoryNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.one + Spacing.half,
  },
  suggestions: { gap: Spacing.two, marginTop: Spacing.one },
  // The thin gradient edge along the top marks the card as the coach's; the card clips it to its corners.
  suggestion: { padding: Spacing.three, paddingTop: Spacing.three + Spacing.half, gap: Spacing.one + Spacing.half, overflow: 'hidden' },
  suggestionEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  suggestionHeader: { gap: Spacing.one + Spacing.half, marginBottom: Spacing.half },
  saved: { marginTop: Spacing.one },
  action: { alignSelf: 'flex-start', marginTop: Spacing.one },
  skeleton: { gap: Spacing.four },
});
