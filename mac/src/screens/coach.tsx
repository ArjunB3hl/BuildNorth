import { useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, View } from 'react-native';

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
import type { CoachContext, CoachMessage, Suggestion } from '../data/types';
import { Accent, MaxContentWidth, Spacing, useTheme } from '../theme';

const STARTERS = [
  'What should I cook tonight?',
  'Plan a 20-minute workout I can do at home',
  'Help me plan meals for tomorrow',
];

// Until the Mac app talks to the BuildNorth backend the coach can't reply, so it behaves
// like the iPhone app does when the AI service is unavailable.
const COACH_CONNECTED = false;

export function CoachScreen() {
  const { state, dispatch } = useStore();
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const messages = state.coach;

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
                  />
                ) : null
              }
            />
            {!COACH_CONNECTED ? (
              <Notice tone="info">
                The coach isn’t connected on Mac yet. The conversation below is
                sample data; replies will come from the BuildNorth backend, as
                on iPhone.
              </Notice>
            ) : null}
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
                      disabled={!COACH_CONNECTED}
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
              COACH_CONNECTED ? 'Message your coach' : 'Coach unavailable'
            }
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={4000}
            editable={COACH_CONNECTED}
            accessibilityLabel="Message to coach"
            // macOS: Return sends, Shift-Return adds a new line.
            {...({ submitKeyEvents: [{ key: 'Enter' }] } as object)}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement },
            ]}
          />
          <Button
            title="Send"
            onPress={() => {}}
            disabled={!COACH_CONNECTED || !draft.trim()}
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
