import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Accent, Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Pill, Row } from '@/components/ui';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useBottomBarInset } from '@/hooks/use-bottom-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { localDate } from '@/lib/dates';
import type { CoachContext, CoachMessage, Suggestion } from '@/lib/types';

const STARTERS = ['What should I cook tonight?', 'Plan a 20-minute workout I can do at home', 'Help me plan meals for tomorrow'];

export default function CoachScreen() {
  const api = useApi();
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const composerInset = useBottomBarInset();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<CoachMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<{ text: string; error: unknown } | null>(null);

  const status = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 60_000 });
  const history = useQuery({ queryKey: ['coach'], queryFn: api.coach.history });
  const aiUnavailable = status.data && !status.data.aiAvailable;

  const send = useMutation({
    mutationFn: (text: string) => {
      abortRef.current = new AbortController();
      return api.coach.send(text, localDate(), abortRef.current.signal);
    },
    onMutate: () => setFailed(null),
    onSuccess: (result) => {
      queryClient.setQueryData<{ messages: CoachMessage[] }>(['coach'], (old) => ({
        messages: [...(old?.messages ?? []), result.userMessage, result.reply],
      }));
      setDraft(''); // cleared only once the reply is safely stored
    },
    onError: (error, text) => {
      if (error instanceof ApiError && error.kind === 'cancelled') return;
      setFailed({ text, error });
      // The service may have gone away since the status was cached; refresh it so the banner shows.
      if (error instanceof ApiError && error.status === 503) queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });

  const clear = useMutation({
    mutationFn: api.coach.clear,
    onSuccess: () => queryClient.setQueryData(['coach'], { messages: [] }),
  });

  const messages = history.data?.messages ?? [];
  useEffect(() => {
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length, send.isPending]);

  const submit = (text = draft) => {
    const content = text.trim();
    if (content && !send.isPending) send.mutate(content);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      <Stack.Screen
        options={{
          headerRight: () =>
            messages.length ? (
              <Button
                title="Clear"
                size="small"
                variant="quiet"
                onPress={() =>
                  Alert.alert('Clear conversation?', 'This deletes your chat history with the coach. Saved recipes, routines and preferences stay.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear', style: 'destructive', onPress: () => clear.mutate() },
                  ])
                }
              />
            ) : null,
        }}
      />
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {aiUnavailable ? (
              <Notice tone="error">
                The coach is unavailable right now. Meals, activity and your plan still work.
                {__DEV__ && status.data?.aiUnavailableReason ? `\n(dev: ${status.data.aiUnavailableReason})` : ''}
              </Notice>
            ) : null}
            {history.isPending ? <Loading label="Loading conversation…" /> : null}
            {history.isError && !history.data ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : null}
            {history.data && messages.length === 0 ? (
              <Card>
                <ThemedText type="smallBold">Your personal coach</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Ask about meals, cooking or routines. The coach uses your profile, saved preferences, long-term memory and
                  the recipes, routines and plan you ask about. It can suggest recipes and workouts, but nothing is saved
                  unless you choose to. It isn&apos;t medical advice.
                </ThemedText>
                {STARTERS.map((s) => (
                  <Button key={s} title={s} size="small" variant="secondary" onPress={() => submit(s)} disabled={!!aiUnavailable || send.isPending} />
                ))}
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <MessageBubble message={item} />}
        ListFooterComponent={
          <View style={styles.footerBlock}>
            {send.isPending ? (
              <>
                <Bubble role="user" text={send.variables ?? ''} />
                <Row style={styles.thinking}>
                  <ActivityIndicator />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fill}>
                    Coach is thinking… this can take up to a minute.
                  </ThemedText>
                  <Button title="Cancel" size="small" variant="quiet" onPress={() => abortRef.current?.abort()} />
                </Row>
              </>
            ) : null}
            {failed ? (
              <View style={styles.failed}>
                <Notice tone="error">{errorMessage(failed.error)}</Notice>
                <Button title="Retry" size="small" variant="secondary" onPress={() => submit(failed.text)} />
              </View>
            ) : null}
          </View>
        }
      />
      <View
        style={[
          styles.composer,
          { borderTopColor: theme.backgroundSelected, backgroundColor: theme.background, paddingBottom: composerInset },
        ]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={aiUnavailable ? 'Coach unavailable' : 'Message your coach'}
          placeholderTextColor={theme.textSecondary}
          multiline
          maxLength={4000}
          editable={!aiUnavailable}
          accessibilityLabel="Message to coach"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Button title="Send" onPress={() => submit()} disabled={!draft.trim() || !!aiUnavailable} loading={send.isPending} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const theme = useTheme();
  const mine = role === 'user';
  return (
    <View
      style={[styles.bubble, mine ? styles.mine : styles.theirs, { backgroundColor: mine ? Accent : theme.backgroundElement }]}
      accessibilityLabel={`${mine ? 'You' : 'Coach'}: ${text}`}>
      <ThemedText style={mine ? styles.mineText : undefined}>{text}</ThemedText>
    </View>
  );
}

function MessageBubble({ message }: { message: CoachMessage }) {
  return (
    <View style={styles.messageBlock}>
      <Bubble role={message.role} text={message.content} />
      {message.role === 'assistant' && message.context ? <ContextLine context={message.context} /> : null}
      {message.suggestions.map((s, i) => (
        <SuggestionCard key={`${message.id}-${i}`} suggestion={s} />
      ))}
    </View>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a reply was built from. A reply made without long-term memory says so instead of passing as fully personalized. */
function ContextLine({ context }: { context: CoachContext }) {
  if (context.memory !== 'ok') {
    return (
      <View style={styles.contextLine}>
        <Notice tone="warning">
          {context.memory === 'unavailable'
            ? 'Long-term memory couldn’t be checked for this reply. It used only your profile and the preferences saved in the app.'
            : 'Long-term memory isn’t set up, so this reply used only your profile and the preferences saved in the app.'}
        </Notice>
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
    <ThemedText type="small" themeColor="textSecondary" style={styles.contextLine}>
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
  return (
    <Card style={styles.suggestion}>
      <Pill label={label} tone="accent" />
      <ThemedText type="smallBold">{suggestion.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={6}>
        {suggestion.content}
      </ThemedText>
      {suggestion.type === 'recipe' ? (
        <Button
          title="Review and save recipe"
          size="small"
          variant="secondary"
          onPress={() => router.push({ pathname: '/meals/import', params: { text: `${suggestion.title}\n${suggestion.content}`, source: 'coach' } })}
        />
      ) : null}
      {suggestion.type === 'routine' ? (
        <Button
          title="Review and save routine"
          size="small"
          variant="secondary"
          onPress={() => router.push({ pathname: '/activity/import', params: { text: `${suggestion.title}\n${suggestion.content}` } })}
        />
      ) : null}
      {suggestion.type === 'preference' ? (
        remember.isSuccess ? (
          <Notice tone="success">Saved to your preferences.</Notice>
        ) : (
          <>
            {remember.isError ? <Notice tone="error">{errorMessage(remember.error)}</Notice> : null}
            <Button
              title="Remember this"
              size="small"
              variant="secondary"
              loading={remember.isPending}
              onPress={() =>
                Alert.alert('Remember this preference?', suggestion.content, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remember', onPress: () => remember.mutate() },
                ])
              }
            />
          </>
        )
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  headerBlock: { gap: Spacing.three, marginBottom: Spacing.two },
  footerBlock: { gap: Spacing.two, marginTop: Spacing.two },
  messageBlock: { gap: Spacing.two },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  mineText: { color: '#ffffff' },
  suggestion: { marginLeft: Spacing.three },
  contextLine: { marginLeft: Spacing.one, maxWidth: '85%' },
  thinking: { paddingHorizontal: Spacing.one },
  failed: { gap: Spacing.two },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, minHeight: 48, maxHeight: 140, borderRadius: 12, paddingHorizontal: Spacing.three, paddingTop: 12, paddingBottom: 12, fontSize: 16 },
});
