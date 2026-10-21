import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, errorMessage, Loading, Pill, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { assistantName } from '@/lib/assistants';
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

  const list = prefs.data?.preferences ?? [];
  return (
    <Screen refreshing={prefs.isRefetching} onRefresh={() => prefs.refetch()}>
      <ThemedText themeColor="textSecondary">
        Preferences you save or confirm are used by the Coach and by AI assistants you connect (they read them through BuildNorth,
        and changes they suggest need your approval). If you turn on health sharing (Profile → Apple Watch), daily Apple Watch
        health summaries are remembered too. Your profile, recipes and routines are stored separately and aren&apos;t affected
        here.
      </ThemedText>

      <Card>
        <TextField
          label="Add a preference"
          value={text}
          onChangeText={setText}
          placeholder="e.g. I prefer vegetarian recipes."
          maxLength={500}
          multiline
        />
        {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
        <Button title="Save preference" size="small" onPress={() => add.mutate()} loading={add.isPending} disabled={!text.trim()} />
      </Card>

      <SectionHeader title="Saved preferences" />
      {prefs.data && !prefs.data.memoryAvailable ? (
        <Notice tone="info">Long-term memory is temporarily unavailable. Your preferences are saved and will sync automatically.</Notice>
      ) : null}
      <StaleBanner visible={prefs.isError && !!prefs.data} />
      {prefs.isPending ? <Loading /> : null}
      {prefs.isError && !prefs.data ? <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} /> : null}
      {prefs.data && list.length === 0 ? <EmptyState title="No saved preferences yet" body="Add one above, or confirm one the coach suggests." /> : null}
      {list.map((p) => (
        <PreferenceRow key={p.id} preference={p} />
      ))}

      <SectionHeader title="Search memory" />
      <ThemedText type="small" themeColor="textSecondary">
        See what long-term memory recalls about you, including anything remembered before saved preferences existed.
      </ThemedText>
      <Row>
        <TextField
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="e.g. food"
          returnKeyType="search"
          onSubmitEditing={() => setSubmittedQuery(query.trim())}
          style={styles.search}
        />
      </Row>
      <Button title="Search" size="small" variant="secondary" onPress={() => setSubmittedQuery(query.trim())} disabled={!query.trim()} loading={search.isFetching} />
      {search.isError ? <Notice tone="error">{errorMessage(search.error)}</Notice> : null}
      {search.data ? (
        search.data.hits.length ? (
          <Card>
            {search.data.hits.map((h, i) => (
              <ThemedText key={i} type="small">
                • {h.text}
              </ThemedText>
            ))}
          </Card>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing found.
          </ThemedText>
        )
      ) : null}

      <SectionHeader title="Erase memory" />
      {erase.isSuccess ? <Notice tone="success">Memory erased ({erase.data.forgotten} records). Saved preferences were removed too.</Notice> : null}
      {erase.isError ? <Notice tone="error">{errorMessage(erase.error)}</Notice> : null}
      <Button
        title="Erase everything BuildNorth remembers"
        variant="danger"
        loading={erase.isPending}
        onPress={() =>
          Alert.alert(
            'Erase all memory?',
            'This permanently removes your saved preferences and everything long-term memory holds about you, including Apple Watch health summaries shared with it. Recipes, routines, check-ins, your plan and the health summaries stored in BuildNorth stay.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Erase', style: 'destructive', onPress: () => erase.mutate() },
            ],
          )
        }
      />
    </Screen>
  );
}

function PreferenceRow({ preference }: { preference: Preference }) {
  const api = useApi();
  const queryClient = useQueryClient();
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

  return (
    <Card>
      {editing ? (
        <>
          <TextField label="Correct this preference" value={text} onChangeText={setText} maxLength={500} multiline />
          {correct.isError ? <Notice tone="error">{errorMessage(correct.error)}</Notice> : null}
          <Row>
            <Button title="Save correction" size="small" onPress={() => correct.mutate()} loading={correct.isPending} disabled={!text.trim() || text.trim() === preference.text} />
            <Button title="Cancel" size="small" variant="secondary" onPress={() => { setEditing(false); setText(preference.text); }} />
          </Row>
        </>
      ) : (
        <>
          <ThemedText>{preference.text}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {sourceLabel(preference)} · updated {friendlyDate(preference.updatedAt.slice(0, 10))}
          </ThemedText>
          <Pill label={preference.memoryStatus === 'synced' ? 'In memory' : 'Memory sync pending'} tone={preference.memoryStatus === 'synced' ? 'success' : 'muted'} />
          {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
          <Row>
            <Button title="Correct" size="small" variant="secondary" onPress={() => setEditing(true)} accessibilityLabel={`Correct: ${preference.text}`} />
            <Button
              title="Delete"
              size="small"
              variant="quiet"
              loading={remove.isPending}
              accessibilityLabel={`Delete: ${preference.text}`}
              onPress={() =>
                Alert.alert('Delete this preference?', preference.text, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
                ])
              }
            />
          </Row>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({ search: { minWidth: 260, marginBottom: Spacing.one } });
