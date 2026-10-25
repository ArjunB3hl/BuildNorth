import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ActionRow, DestructiveButton, FormActions } from '@/components/profile/controls';
import { Skeleton, Stagger } from '@/components/motion';
import { useContentWidth } from '@/components/profile/layout';
import { Divider, SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, errorMessage, Pill, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { assistantName } from '@/lib/assistants';
import { confirmAction } from '@/lib/confirm';
import { friendlyDate } from '@/lib/dates';
import type { Preference } from '@/lib/types';

function sourceLabel(p: Preference): string {
  switch (p.source) {
    case 'coach':
      return 'Saved from Coach';
    case 'planner':
      return 'Saved from the planner';
    case 'assistant':
      return `Approved from ${assistantName(p.sourceDetail)}`;
    default:
      return 'Added in the app';
  }
}

export default function MemoryScreen() {
  const api = useApi();
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: api.preferences.list });
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const add = useMutation({
    mutationFn: () => api.preferences.add(text.trim()),
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
  const search = useQuery({
    queryKey: ['memory-search', submittedQuery],
    queryFn: () => api.memory.search(submittedQuery),
    enabled: !!submittedQuery,
    retry: false,
  });
  const erase = useMutation({
    mutationFn: api.memory.erase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
      queryClient.invalidateQueries({ queryKey: ['watch-health'] });
      queryClient.removeQueries({ queryKey: ['memory-search'] });
    },
  });

  async function confirmErase() {
    const ok = await confirmAction({
      title: 'Erase all memory?',
      message:
        'This permanently removes your saved preferences and everything long-term memory holds about you, including Apple Watch health summaries shared with it. Recipes, routines, check-ins, your plan and the health summaries stored in Rhythm stay.',
      confirmLabel: 'Erase',
      destructive: true,
    });
    if (ok) erase.mutate();
  }

  const list = prefs.data?.preferences ?? [];
  return (
    <Screen refreshing={prefs.isRefetching} onRefresh={() => prefs.refetch()}>
      <Stagger>
        <ThemedText type="small" themeColor="textSecondary">
          Preferences you save or confirm are used by the Coach and by AI assistants you connect (they read them through Rhythm,
          and changes they suggest need your approval). If you turn on health sharing (Profile → Apple Watch), daily Apple Watch
          health summaries are remembered too. Your profile, recipes and routines are stored separately and aren&apos;t affected
          here.
        </ThemedText>

        <SectionCard title="Add a preference" icon={{ ios: 'plus.circle', android: 'add_circle', web: 'add_circle' }}>
          <TextField
            label="Preference"
            value={text}
            onChangeText={setText}
            placeholder="e.g. I prefer vegetarian recipes."
            maxLength={500}
            multiline
          />
          {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
          <FormActions>
            <Button title="Save preference" size="small" onPress={() => add.mutate()} loading={add.isPending} disabled={!text.trim()} />
          </FormActions>
        </SectionCard>

        <View style={styles.group}>
          <SectionHeader title="Saved preferences" />
          {prefs.data && !prefs.data.memoryAvailable ? (
            <Notice tone="info">Long-term memory is temporarily unavailable. Your preferences are saved and will sync automatically.</Notice>
          ) : null}
          <StaleBanner visible={prefs.isError && !!prefs.data} />
          {prefs.isPending ? (
          <Card style={styles.list}>
            <View style={styles.skeletons} accessibilityLabel="Loading your preferences">
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.rowText}>
                  <Skeleton width={`${85 - i * 15}%`} height={16} />
                  <Skeleton width={180} height={12} />
                </View>
              ))}
            </View>
          </Card>
        ) : null}
          {prefs.isError && !prefs.data ? <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} /> : null}
          {prefs.data && list.length === 0 ? <EmptyState title="No saved preferences yet" body="Add one above, or confirm one the coach suggests." /> : null}
          {list.length ? (
            <Card style={styles.list}>
              {list.map((p, i) => (
                <Fragment key={p.id}>
                  {i > 0 ? <Divider /> : null}
                  <PreferenceRow preference={p} />
                </Fragment>
              ))}
            </Card>
          ) : null}
        </View>

        <SectionCard
          title="Search memory"
          icon={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          description="See what long-term memory recalls about you, including anything remembered before saved preferences existed.">
          <Row style={styles.searchRow}>
            <View style={styles.fill}>
              <TextField
                label="Search"
                value={query}
                onChangeText={setQuery}
                placeholder="e.g. food"
                returnKeyType="search"
                onSubmitEditing={() => setSubmittedQuery(query.trim())}
              />
            </View>
            <View style={styles.searchButton}>
              <Button
                title="Search"
                size="small"
                variant="secondary"
                onPress={() => setSubmittedQuery(query.trim())}
                disabled={!query.trim()}
                loading={search.isFetching}
              />
            </View>
          </Row>
          {search.isError ? <Notice tone="error">{errorMessage(search.error)}</Notice> : null}
          {search.data ? (
            search.data.hits.length ? (
              <View style={styles.hits}>
                {search.data.hits.map((h, i) => (
                  <Fragment key={i}>
                    {i > 0 ? <Divider /> : null}
                    <ThemedText type="small">{h.text}</ThemedText>
                  </Fragment>
                ))}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing found.
              </ThemedText>
            )
          ) : null}
        </SectionCard>

        <SectionCard
          title="Erase memory"
          tone="danger"
          icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
          description="Permanently removes your saved preferences and everything long-term memory holds about you. You'll be asked to confirm.">
          {erase.isSuccess ? <Notice tone="success">Memory erased ({erase.data.forgotten} records). Saved preferences were removed too.</Notice> : null}
          {erase.isError ? <Notice tone="error">{errorMessage(erase.error)}</Notice> : null}
          <FormActions>
            <Button title="Erase everything Rhythm remembers" variant="danger" loading={erase.isPending} onPress={() => void confirmErase()} />
          </FormActions>
        </SectionCard>
      </Stagger>
    </Screen>
  );
}

function PreferenceRow({ preference }: { preference: Preference }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const inline = useContentWidth() >= 560;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(preference.text);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['preferences'] });
  const correct = useMutation({
    mutationFn: () => api.preferences.correct(preference.id, text.trim()),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api.preferences.remove(preference.id), onSuccess: refresh });

  async function confirmRemove() {
    const ok = await confirmAction({ title: 'Delete this preference?', message: preference.text, confirmLabel: 'Delete', destructive: true });
    if (ok) remove.mutate();
  }

  if (editing) {
    return (
      <View style={styles.row}>
        <TextField label="Correct this preference" value={text} onChangeText={setText} maxLength={500} multiline />
        {correct.isError ? <Notice tone="error">{errorMessage(correct.error)}</Notice> : null}
        <ActionRow>
          <Button
            title="Save correction"
            size="small"
            onPress={() => correct.mutate()}
            loading={correct.isPending}
            disabled={!text.trim() || text.trim() === preference.text}
          />
          <Button title="Cancel" size="small" variant="secondary" onPress={() => { setEditing(false); setText(preference.text); }} />
        </ActionRow>
      </View>
    );
  }

  const actions = (
    <ActionRow>
      <Button title="Correct" size="small" variant="secondary" onPress={() => setEditing(true)} accessibilityLabel={`Correct: ${preference.text}`} />
      <DestructiveButton title="Delete" loading={remove.isPending} accessibilityLabel={`Delete: ${preference.text}`} onPress={() => void confirmRemove()} />
    </ActionRow>
  );
  return (
    <View style={styles.row}>
      <View style={[styles.rowMain, inline && styles.rowInline]}>
        <View style={styles.rowText}>
          <ThemedText>{preference.text}</ThemedText>
          <View style={styles.meta}>
            <Pill
              label={preference.memoryStatus === 'synced' ? 'In memory' : 'Memory sync pending'}
              tone={preference.memoryStatus === 'synced' ? 'success' : 'muted'}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {sourceLabel(preference)} · updated {friendlyDate(preference.updatedAt.slice(0, 10))}
            </ThemedText>
          </View>
        </View>
        {actions}
      </View>
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  group: { gap: Spacing.two },
  list: { gap: Spacing.three },
  row: { gap: Spacing.two },
  rowMain: { gap: Spacing.two },
  rowInline: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  rowText: { flex: 1, minWidth: 0, gap: Spacing.one + Spacing.half },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  searchRow: { alignItems: 'flex-end' },
  searchButton: { marginBottom: Spacing.two },
  hits: { gap: Spacing.two },
  skeletons: { gap: Spacing.four },
});
