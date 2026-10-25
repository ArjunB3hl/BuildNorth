import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ActionButton } from '@/components/meals/action-button';
import { MealIcons } from '@/components/meals/icons';
import { Enter, FadeIn } from '@/components/motion';
import { ReadingCard } from '@/components/reading-card';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';
import { putDraft, type RecipeDraftHandoff } from '@/lib/drafts';

const web = Platform.OS === 'web';
const MAX_LENGTH = 20000;

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

  const writeMyself = () => {
    // Keep anything already pasted as notes so it isn't lost.
    const id = putDraft<RecipeDraftHandoff>({
      draft: { title: '', servings: 2, ingredients: [], steps: [] },
      warnings: [],
      source: 'manual',
      notes: text.trim() || null,
    });
    router.replace({ pathname: '/meals/edit', params: { draftId: id } });
  };

  const field = (
    <>
      <TextField
        label="Recipe text"
        value={text}
        onChangeText={setText}
        multiline
        maxLength={MAX_LENGTH}
        placeholder={'e.g. Lentil soup (serves 4)\n1 cup red lentils, 1 onion…\nSoften the onion, add lentils…'}
        style={[styles.textArea, web && styles.textAreaWeb]}
        editable={!extract.isPending}
      />
      <View style={styles.hintRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.fill}>
          Recipes, ingredient lists and cooking transcripts all work.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
          {text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
        </ThemedText>
      </View>
    </>
  );

  return (
    <Screen>
      <Enter>
        <ThemedText themeColor="textSecondary">
          Paste a recipe, an ingredient list or a cooking transcript. You&apos;ll review and edit everything before it&apos;s saved.
        </ThemedText>
      </Enter>
      <Enter index={1} style={!web && styles.nativeField}>{web ? <Card style={styles.card}>{field}</Card> : field}</Enter>
      {aiUnavailable ? (
        <Notice tone="info">Automatic recipe reading is unavailable right now. You can still write the recipe yourself.</Notice>
      ) : null}
      {extract.isPending ? (
        <FadeIn>
          <ReadingCard label="Reading your recipe… this can take up to a minute." onCancel={() => abortRef.current?.abort()} />
        </FadeIn>
      ) : null}
      {extract.isError && !cancelled ? <Notice tone="error">{errorMessage(extract.error)}</Notice> : null}
      {web ? (
        <Enter index={2} style={styles.actions}>
          <ActionButton title="Write it myself" icon={MealIcons.write} disabled={extract.isPending} onPress={writeMyself} />
          <Button
            title="Read recipe"
            onPress={() => extract.mutate()}
            loading={extract.isPending}
            disabled={text.trim().length < 10 || !!aiUnavailable}
            accessibilityHint="Turns the pasted text into an editable recipe"
          />
        </Enter>
      ) : (
        <>
          <Button
            title="Read recipe"
            onPress={() => extract.mutate()}
            loading={extract.isPending}
            disabled={text.trim().length < 10 || !!aiUnavailable}
            accessibilityHint="Turns the pasted text into an editable recipe"
          />
          <Button title="Write it myself" variant="secondary" disabled={extract.isPending} onPress={writeMyself} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { gap: Spacing.two },
  // On phones the field and its hint sit apart like the rest of the page.
  nativeField: { gap: Spacing.three },
  textArea: { minHeight: 220, textAlignVertical: 'top' },
  textAreaWeb: { minHeight: 280 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  count: { fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.two },
});
