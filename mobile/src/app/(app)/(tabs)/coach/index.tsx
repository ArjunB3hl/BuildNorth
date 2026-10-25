import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Composer } from '@/components/coach/composer';
import { ChatColumnWidth } from '@/components/coach/layout';
import { ConversationSkeleton, FailedReply, MessageItem, PendingReply, UserMessage } from '@/components/coach/message';
import { ScrollToLatest } from '@/components/coach/scroll-to-latest';
import { useScreenReaderRef } from '@/components/coach/use-screen-reader';
import { CoachWelcome } from '@/components/coach/welcome';
import { Button, Notice } from '@/components/form';
import { ErrorState, errorMessage } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useBottomBarInset } from '@/hooks/use-bottom-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { newKey } from '@/lib/keys';
import { localDate } from '@/lib/dates';
import type { CoachMessage } from '@/lib/types';

const web = Platform.OS === 'web';

export default function CoachScreen() {
  const router = useRouter();
  const api = useApi();
  const theme = useTheme();
  const headerHeight = useHeaderHeight();
  const composerInset = useBottomBarInset();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<CoachMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnKey = useRef({ text: '', key: '' });
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<{ text: string; error: unknown } | null>(null);
  // Replies that arrived in this session are written out block by block; older ones just appear.
  const [freshReplies, setFreshReplies] = useState<ReadonlySet<string>>(() => new Set());
  const screenReader = useScreenReaderRef();

  // Wide web pages indent replies under the coach's name and lay out starters in two columns.
  const wide = web && width >= 720;
  const gutter = web && width >= 600 ? Spacing.four : Spacing.three;

  const status = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 60_000 });
  const claude = useQuery({ queryKey: ['claude-connection'], queryFn: api.connections.claude });
  const history = useQuery({ queryKey: ['coach'], queryFn: api.coach.history });
  const aiUnavailable = claude.data?.configured ? !claude.data.usable : !!status.data && !status.data.aiAvailable;

  const send = useMutation({
    mutationFn: (text: string) => {
      abortRef.current = new AbortController();
      if (turnKey.current.text !== text) turnKey.current = { text, key: newKey() };
      return api.coach.send(text, localDate(), abortRef.current.signal, turnKey.current.key);
    },
    onMutate: () => setFailed(null),
    onSuccess: (result) => {
      if (!screenReader.current) setFreshReplies((ids) => new Set(ids).add(result.reply.id));
      queryClient.setQueryData<{ messages: CoachMessage[] }>(['coach'], (old) => ({
        messages: [...(old?.messages ?? []), result.userMessage, result.reply],
      }));
      turnKey.current = { text: '', key: '' };
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
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
  // Only the newest reply's orb keeps turning; older ones stay still.
  const latestReplyId = messages.findLast((m) => m.role === 'assistant')?.id;
  // When the history first loads, only its last couple of messages fade in (no cascade through the rest).
  const [entering, setEntering] = useState<string[] | null>(null);
  if (entering === null && history.data) setEntering(history.data.messages.slice(-2).map((m) => m.id));
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const autoScrollAt = useRef(0);
  // Follow the end of the conversation (on first load and as replies arrive) unless the user has scrolled up to read.
  const followEnd = useRef(true);
  const scrollToEnd = (animated: boolean) => {
    autoScrollAt.current = Date.now();
    setAwayFromEnd(false);
    // The scroll view's own scrollToEnd uses the real content height; the list's version relies on
    // measured rows and lands short (or at the top) while rows are still being laid out.
    const scroller = listRef.current?.getNativeScrollRef() as { scrollToEnd?: (options: { animated: boolean }) => void } | null | undefined;
    if (scroller?.scrollToEnd) scroller.scrollToEnd({ animated });
    else listRef.current?.scrollToEnd({ animated });
  };
  useEffect(() => {
    if (!messages.length && !send.isPending && !failed) return;
    followEnd.current = true;
    setTimeout(() => scrollToEnd(true), 50);
  }, [messages.length, send.isPending, failed]);
  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    followEnd.current = distance <= 80;
    // Scrolls this screen makes itself (to follow a new reply) don't summon the "latest" button.
    if (Date.now() - autoScrollAt.current > 700) setAwayFromEnd(distance > 240);
  };
  const jumpToLatest = () => {
    followEnd.current = true;
    scrollToEnd(true);
  };

  const submit = (text = draft) => {
    const content = text.trim();
    if (content && !send.isPending) send.mutate(content);
  };

  const confirmClear = async () => {
    const confirmed = await confirmAction({
      title: 'Clear conversation?',
      message: 'This deletes your chat history with the coach. Saved recipes, routines and preferences stay.',
      confirmLabel: 'Clear',
      destructive: true,
    });
    if (confirmed) clear.mutate();
  };

  const showHeader = true;
  const showWelcome = !!history.data && messages.length === 0 && !send.isPending && !failed;
  const column = { paddingHorizontal: gutter, maxWidth: ChatColumnWidth + gutter * 2 };

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}>
      <Stack.Screen
        options={{
          headerRight: () =>
            messages.length ? <Button title="Clear" size="small" variant="quiet" loading={clear.isPending} onPress={confirmClear} /> : null,
        }}
      />
      <View style={styles.fill}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.list, column, showWelcome && styles.grow]}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            // The welcome reads from the top; only a conversation follows its end.
            if (followEnd.current && !showWelcome) scrollToEnd(false);
          }}
          ListHeaderComponent={
            showHeader ? (
              <View style={styles.headerBlock}>
                <Button title={claude.data?.usable ? 'Claude connected · AI settings' : 'Connect Claude or ChatGPT'} size="small" variant="quiet" onPress={() => router.push('/profile/connections')} />
                {aiUnavailable ? (
                  <Notice tone="error">
                    Connect a Claude API key in AI settings to use Coach. Your Calendar and saved content still work.
                  </Notice>
                ) : null}
                {clear.isError ? <Notice tone="error">{errorMessage(clear.error)}</Notice> : null}
                {history.isPending ? <ConversationSkeleton wide={wide} /> : null}
                {history.isError && !history.data ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            showWelcome ? (
              <View style={styles.welcome}>
                <CoachWelcome onSelect={submit} disabled={aiUnavailable} wide={wide} />
              </View>
            ) : null
          }
          extraData={[freshReplies, latestReplyId]}
          renderItem={({ item }) => {
            const enter = entering?.indexOf(item.id) ?? -1;
            return (
              <MessageItem message={item} wide={wide} reveal={freshReplies.has(item.id)} enter={enter >= 0 ? enter : null}
                latest={item.id === latestReplyId} />
            );
          }}
          ListFooterComponent={
            send.isPending || failed ? (
              <View style={styles.turn}>
                {send.isPending ? (
                  <>
                    <UserMessage text={send.variables ?? ''} enter={0} />
                    <PendingReply wide={wide} onCancel={() => abortRef.current?.abort()} />
                  </>
                ) : failed ? (
                  <>
                    <UserMessage text={failed.text} faded enter={0} />
                    <FailedReply error={failed.error} wide={wide} onRetry={() => submit(failed.text)} />
                  </>
                ) : null}
              </View>
            ) : null
          }
        />
        {awayFromEnd && messages.length ? <ScrollToLatest onPress={jumpToLatest} /> : null}
      </View>
      <View
        style={[
          styles.composerBar,
          { backgroundColor: theme.background, paddingHorizontal: gutter, paddingBottom: web ? Spacing.three : composerInset },
          !web && { borderTopColor: theme.backgroundSelected, borderTopWidth: StyleSheet.hairlineWidth },
        ]}>
        <View style={[styles.composerColumn, { maxWidth: ChatColumnWidth }]}>
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={() => submit()}
            unavailable={aiUnavailable}
            sending={send.isPending}
            showHint={wide}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
  grow: { flexGrow: 1 },
  headerBlock: { gap: Spacing.three },
  welcome: { flexGrow: 1, justifyContent: 'center' },
  turn: { gap: Spacing.four },
  composerBar: { paddingTop: Spacing.two },
  composerColumn: { width: '100%', alignSelf: 'center' },
});
