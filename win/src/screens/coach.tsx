import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { WEB_URL } from '../config';
import { describe } from '../lib/account';
import type { AIAccess } from '../lib/api';
import { localDate } from '../lib/dates';
import { randomUUID } from '../lib/ids';

import { LocalVoiceCard } from '../components/local-voice';
import {
  Button,
  Card,
  Notice,
  PageHeader,
  Pill,
  Row,
  ThemedText,
} from '../components/ui';
import { useStore } from '../data/store';
import { useDemoClaude } from '../lib/claude-demo';
import { useNav } from '../navigation';
import type { CoachContext, CoachMessage, Suggestion } from '../data/types';
import { Accent, MaxContentWidth, Spacing, useTheme } from '../theme';

const STARTERS = [
  'What should I cook tonight?',
  'Plan a 20-minute workout I can do at home',
  'Help me plan meals for tomorrow',
];

export function CoachScreen() {
  const { state, dispatch, mode, api } = useStore();
  const claude = useDemoClaude(),
    nav = useNav();
  // Signed in, the account's Coach on the server replies (whatever AI the account or server has connected);
  // signed out, the demo Coach calls Claude directly with a key held in memory, as on the Mac.
  const account = mode === 'account' && api != null;
  const [access, setAccess] = useState<AIAccess | null>(null);
  const [accessError, setAccessError] = useState('');
  const checkAccess = useCallback(() => {
    if (!api) return;
    setAccessError('');
    api
      .access()
      .then(setAccess)
      .catch(e => setAccessError(describe(e)));
  }, [api]);
  useEffect(() => {
    if (account) checkAccess();
  }, [account, checkAccess]);
  const connected = account ? !!access?.linked : !!claude.connection;
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  // Retrying the same text reuses its key, so the server journals it to the Calendar once (as on iPhone).
  const pending = useRef<{ text: string; key: string } | null>(null);
  const messages = state.coach;

  async function send() {
    const message = draft.trim();
    if (!message || !connected || busy) return;
    setBusy(true);
    setError('');
    try {
      if (account && api) {
        if (pending.current?.text !== message)
          pending.current = { text: message, key: randomUUID() };
        const sent = await api.coach.send(
          message,
          localDate(),
          pending.current.key,
        );
        pending.current = null;
        dispatch({
          type: 'coach/append',
          messages: [sent.userMessage, sent.reply],
        });
      } else {
        const reply = await claude.reply(
          message,
          {
            source: 'Windows local demo',
            profile: state.profile,
            preferences: state.preferences.map(p => p.text),
            plan: state.plan.slice(0, 20),
            calendar: state.calendarEntries.slice(-30),
          },
          messages,
        );
        dispatch({ type: 'coach/exchange', message, reply });
      }
      setDraft('');
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'AbortError'
          ? e.message
          : 'The request timed out or was cancelled. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const clear = () =>
    Alert.alert(
      'Clear conversation?',
      'This deletes your chat history with the coach. Saved recipes, routines and preferences stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => dispatch({ type: 'coach/clear' }),
        },
      ],
    );

  if (account && !connected)
    return (
      <View style={styles.connectionGate}>
        <PageHeader
          title={
            access || accessError
              ? 'Connect your coach first'
              : 'Checking your coach…'
          }
        />
        {accessError ? <Notice tone="error">{accessError}</Notice> : null}
        {access ? (
          <ThemedText>
            Your Rhythm account has no AI connected for the Coach yet. Connect
            Claude or ElevenLabs in AI connections on the Rhythm website, then
            check again.
          </ThemedText>
        ) : null}
        <Button
          title="Open AI connections on the website"
          onPress={() => Linking.openURL(`${WEB_URL}/profile/connections`)}
        />
        <Button title="Check again" variant="secondary" onPress={checkAccess} />
        <LocalVoiceCard />
      </View>
    );

  if (!connected)
    return (
      <View style={styles.connectionGate}>
        <PageHeader title="Connect your coach first" />
        <ThemedText>
          Verify a Claude API key in AI connections to unlock this PC’s demo
          Coach, or sign in from Profile to use your Rhythm account’s Coach.
          ElevenLabs and account assistants are available through the website.
        </ThemedText>
        <Button
          title="Open AI connections"
          onPress={() => nav.go('profile', { name: 'connections' })}
        />
        <LocalVoiceCard />
      </View>
    );

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      <FlatList
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <PageHeader
              title="Coach"
              actions={
                messages.length ? (
                  <Button
                    title="Clear"
                    size="small"
                    variant="quiet"
                    onPress={clear}
                    disabled={busy}
                  />
                ) : null
              }
            />
            {account ? (
              <Button
                title="AI settings on the website"
                variant="quiet"
                onPress={() =>
                  Linking.openURL(`${WEB_URL}/profile/connections`)
                }
              />
            ) : (
              <Button
                title={
                  connected
                    ? 'Claude connected · AI settings'
                    : 'Connect Claude or ChatGPT'
                }
                variant="quiet"
                onPress={() => nav.go('profile', { name: 'connections' })}
              />
            )}
            {error ? <Notice tone="error">{error}</Notice> : null}
            {busy ? (
              <Notice tone="info">
                {account ? 'Your coach is replying…' : 'Claude is replying…'}
              </Notice>
            ) : null}
            {account ? (
              <Notice tone="info">
                Your Rhythm Coach replies with your account’s profile, saved
                preferences, long-term memory, plan and Calendar. The
                conversation is saved in your account.
              </Notice>
            ) : !connected ? (
              <Notice tone="info">
                Connect a Claude API key to try the demo Coach. The existing
                conversation is local demo data.
              </Notice>
            ) : (
              <Notice tone="info">
                Claude uses this PC’s local demo profile, preferences, plan and
                Calendar. Your conversation is saved only on this PC.
              </Notice>
            )}
            <LocalVoiceCard />
            {messages.length === 0 ? (
              <Card>
                <ThemedText type="smallBold">Your personal coach</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Ask about meals, cooking or routines. The coach uses your
                  profile, saved preferences, long-term memory and the recipes,
                  routines and plan you ask about. It can suggest recipes and
                  workouts, but nothing is saved unless you choose to. It isn’t
                  medical advice.
                </ThemedText>
                {STARTERS.map(s => (
                  <View key={s} style={styles.start}>
                    <Button
                      title={s}
                      size="small"
                      variant="secondary"
                      onPress={() => setDraft(s)}
                      disabled={!connected || busy}
                    />
                  </View>
                ))}
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <MessageBubble message={item} />}
      />
      <View
        style={[
          styles.composerBar,
          { borderTopColor: theme.backgroundSelected },
        ]}
      >
        <Row style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={
              connected ? 'Message your coach' : 'Connect Claude to chat'
            }
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={4000}
            editable={connected && !busy}
            accessibilityLabel="Message to coach"
            onSubmitEditing={send}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement },
            ]}
          />
          <Button
            title="Send"
            onPress={send}
            disabled={!connected || busy || !draft.trim()}
          />
        </Row>
      </View>
    </View>
  );
}

function Bubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const theme = useTheme();
  const mine = role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        mine ? styles.mine : styles.theirs,
        { backgroundColor: mine ? Accent : theme.backgroundElement },
      ]}
      accessibilityLabel={`${mine ? 'You' : 'Coach'}: ${text}`}
    >
      <ThemedText style={mine ? styles.mineText : undefined}>{text}</ThemedText>
    </View>
  );
}

function MessageBubble({ message }: { message: CoachMessage }) {
  return (
    <View style={styles.messageBlock}>
      <Bubble role={message.role} text={message.content} />
      {message.role === 'assistant' && message.context ? (
        <ContextLine context={message.context} />
      ) : null}
      {message.suggestions.map((s, i) => (
        <SuggestionCard key={`${message.id}-${i}`} suggestion={s} />
      ))}
    </View>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a reply was built from, as on iPhone. */
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
    context.preferences
      ? plural(context.preferences, 'saved preference') +
        (context.recalled ? ` (${context.recalled} recalled)` : '')
      : null,
    context.recipes ? plural(context.recipes, 'recipe') : null,
    context.routines ? plural(context.routines, 'routine') : null,
    context.planItems ? 'this week’s plan' : null,
  ].filter(Boolean);
  return (
    <ThemedText
      type="small"
      themeColor="textSecondary"
      style={styles.contextLine}
    >
      {`Memory checked${
        parts.length
          ? ` · used ${parts.join(' · ')}`
          : ' · nothing saved was relevant'
      }`}
    </ThemedText>
  );
}

/** Suggestions only become saved data after the user confirms them. */
function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const { state, dispatch } = useStore();
  const label = {
    recipe: 'Recipe idea',
    routine: 'Routine idea',
    preference: 'Preference',
  }[suggestion.type];
  const remembered = state.preferences.some(p => p.text === suggestion.content);

  return (
    <Card style={styles.suggestion}>
      <Pill label={label} tone="accent" />
      <ThemedText type="smallBold">{suggestion.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={6}>
        {suggestion.content}
      </ThemedText>
      {suggestion.type === 'preference' ? (
        remembered ? (
          <Notice tone="success">Saved to your preferences.</Notice>
        ) : (
          <View style={styles.start}>
            <Button
              title="Remember this"
              size="small"
              variant="secondary"
              onPress={() =>
                Alert.alert('Remember this preference?', suggestion.content, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remember',
                    onPress: () =>
                      dispatch({
                        type: 'preference/add',
                        text: suggestion.content,
                        source: 'coach',
                      }),
                  },
                ])
              }
            />
          </View>
        )
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  connectionGate: { padding: 28, gap: 16 },
  fill: { flex: 1 },
  start: { alignItems: 'flex-start' },
  list: {
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth + Spacing.five * 2,
    alignSelf: 'center',
  },
  headerBlock: { gap: Spacing.three, marginBottom: Spacing.two },
  messageBlock: { gap: Spacing.two },
  bubble: {
    maxWidth: '75%',
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  mineText: { color: '#ffffff' },
  suggestion: { marginLeft: Spacing.three, maxWidth: '75%' },
  contextLine: { marginLeft: Spacing.one, maxWidth: '75%' },
  composerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
  },
  composer: {
    alignItems: 'flex-end',
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 14,
  },
});
