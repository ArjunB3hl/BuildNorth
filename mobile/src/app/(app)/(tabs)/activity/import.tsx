import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { FormActions } from '@/components/activity/layout';
import { Button, Notice, TextField } from '@/components/form';
import { Enter, FadeIn } from '@/components/motion';
import { ReadingCard } from '@/components/reading-card';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { putDraft, type RoutineDraftHandoff } from '@/lib/drafts';

export default function ImportRoutine() {
  const api = useApi();
  const theme = useTheme();
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
  // Phones put the field on a white surface inside the grey card; the web keeps the shared field style.
  const onCard = Platform.OS === 'web' ? undefined : { backgroundColor: theme.background, borderColor: theme.backgroundSelected };

  return (
    <Screen>
      <Enter>
        <ThemedText themeColor="textSecondary">
          Describe a workout in your own words. You&apos;ll review the exercises before anything is saved.
        </ThemedText>
      </Enter>
      {aiUnavailable ? <Notice tone="info">Automatic reading is unavailable right now. You can still build the routine yourself.</Notice> : null}

      <Enter index={1}>
        <Card style={styles.card}>
          <TextField
            label="Workout"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={20000}
            placeholder="e.g. 3 sets of 12 squats, 3 x 10 push-ups, then a 45 second plank"
            style={[styles.textArea, onCard]}
            editable={!extract.isPending}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Mention sets, reps, time, weight and rest where you know them. Anything missing can be filled in on the next step.
          </ThemedText>
        </Card>
      </Enter>

      {extract.isPending ? (
        <FadeIn>
          <ReadingCard label="Reading your workout… this can take up to a minute." onCancel={() => abortRef.current?.abort()} />
        </FadeIn>
      ) : null}
      {extract.isError && !cancelled ? <Notice tone="error">{errorMessage(extract.error)}</Notice> : null}

      <Enter index={2}>
        <FormActions
          primary={
            <Button title="Create routine" onPress={() => extract.mutate()} loading={extract.isPending} disabled={text.trim().length < 10 || !!aiUnavailable} />
          }
          secondary={<Button title="Build it myself" variant="secondary" disabled={extract.isPending} onPress={() => router.replace('/activity/edit')} />}
        />
      </Enter>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  textArea: { minHeight: 160, textAlignVertical: 'top' },
});
