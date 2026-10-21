import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, Row, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';
import { putDraft, type RoutineDraftHandoff } from '@/lib/drafts';

export default function ImportRoutine() {
  const api = useApi();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string }>();
  const [text, setText] = useState(params.text ?? '');
  const abortRef = useRef<AbortController | null>(null);
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 60_000 });
  const aiUnavailable = status.data && !status.data.aiAvailable;

  const extract = useMutation({
    mutationFn: () => {
      abortRef.current = new AbortController();
      return api.routines.extract(text.trim(), abortRef.current.signal);
    },
    onSuccess: (result) => {
      const id = putDraft<RoutineDraftHandoff>(result);
      router.replace({ pathname: '/activity/edit', params: { draftId: id } });
    },
  });
  const cancelled = extract.error instanceof ApiError && extract.error.kind === 'cancelled';

  return (
    <Screen>
      <ThemedText themeColor="textSecondary">
        Describe a workout in your own words. You&apos;ll review the exercises before anything is saved.
      </ThemedText>
      <TextField
        label="Workout"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={20000}
        placeholder="e.g. 3 sets of 12 squats, 3 x 10 push-ups, then a 45 second plank"
        style={styles.textArea}
        editable={!extract.isPending}
      />
      {aiUnavailable ? <Notice tone="info">Automatic reading is unavailable right now. You can still build the routine yourself.</Notice> : null}
      {extract.isPending ? (
        <Card>
          <Row>
            <ActivityIndicator />
            <ThemedText type="small" style={styles.fill}>
              Reading your workout… this can take up to a minute.
            </ThemedText>
          </Row>
          <Button title="Cancel" size="small" variant="quiet" onPress={() => abortRef.current?.abort()} />
        </Card>
      ) : null}
      {extract.isError && !cancelled ? <Notice tone="error">{errorMessage(extract.error)}</Notice> : null}
      <Button title="Create routine" onPress={() => extract.mutate()} loading={extract.isPending} disabled={text.trim().length < 10 || !!aiUnavailable} />
      <Button title="Build it myself" variant="secondary" disabled={extract.isPending} onPress={() => router.replace('/activity/edit')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  textArea: { minHeight: 160, textAlignVertical: 'top' },
});
