import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, Row, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';
import { putDraft, type RecipeDraftHandoff } from '@/lib/drafts';

export default function ImportRecipe() {
  const api = useApi();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string; source?: string }>();
  const [text, setText] = useState(params.text ?? '');
  const abortRef = useRef<AbortController | null>(null);
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 60_000 });
  const aiUnavailable = status.data && !status.data.aiAvailable;

  const extract = useMutation({
    mutationFn: () => {
      abortRef.current = new AbortController();
      return api.recipes.extract(text.trim(), abortRef.current.signal);
    },
    onSuccess: ({ draft, warnings }) => {
      const id = putDraft<RecipeDraftHandoff>({ draft, warnings, source: params.source === 'coach' ? 'coach' : 'pasted' });
      router.replace({ pathname: '/meals/edit', params: { draftId: id } });
    },
  });
  const cancelled = extract.error instanceof ApiError && extract.error.kind === 'cancelled';

  return (
    <Screen>
      <ThemedText themeColor="textSecondary">
        Paste a recipe, an ingredient list or a cooking transcript. You&apos;ll review and edit everything before it&apos;s saved.
      </ThemedText>
      <TextField
        label="Recipe text"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={20000}
        placeholder={'e.g. Lentil soup (serves 4)\n1 cup red lentils, 1 onion…\nSoften the onion, add lentils…'}
        style={styles.textArea}
        editable={!extract.isPending}
      />
      {aiUnavailable ? (
        <Notice tone="info">Automatic recipe reading is unavailable right now. You can still write the recipe yourself.</Notice>
      ) : null}
      {extract.isPending ? (
        <Card>
          <Row>
            <ActivityIndicator />
            <ThemedText type="small" style={styles.fill}>
              Reading your recipe… this can take up to a minute.
            </ThemedText>
          </Row>
          <Button title="Cancel" size="small" variant="quiet" onPress={() => abortRef.current?.abort()} />
        </Card>
      ) : null}
      {extract.isError && !cancelled ? <Notice tone="error">{errorMessage(extract.error)}</Notice> : null}
      <Button
        title="Read recipe"
        onPress={() => extract.mutate()}
        loading={extract.isPending}
        disabled={text.trim().length < 10 || !!aiUnavailable}
        accessibilityHint="Turns the pasted text into an editable recipe"
      />
      <Button
        title="Write it myself"
        variant="secondary"
        disabled={extract.isPending}
        onPress={() => {
          // Keep anything already pasted as notes so it isn't lost.
          const id = putDraft<RecipeDraftHandoff>({
            draft: { title: '', servings: 2, ingredients: [], steps: [] },
            warnings: [],
            source: 'manual',
            notes: text.trim() || null,
          });
          router.replace({ pathname: '/meals/edit', params: { draftId: id } });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  textArea: { minHeight: 220, textAlignVertical: 'top' },
});
