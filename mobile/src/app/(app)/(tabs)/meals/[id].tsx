import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Pill, Row, Screen, SectionHeader, StaleBanner, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { formatAmount } from '@/lib/drafts';

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => api.recipes.get(id) });
  const [servings, setServings] = useState<number | null>(null);

  const addToShopping = useMutation({
    mutationFn: () => api.recipes.addToShopping(id, servings ?? recipe.data?.servings),
    onSuccess: (result) => queryClient.setQueryData(['shopping'], { items: result.items }),
  });
  const remove = useMutation({
    mutationFn: () => api.recipes.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.removeQueries({ queryKey: ['recipe', id] });
      router.back();
    },
  });

  if (recipe.isPending) return <Loading label="Loading recipe…" />;
  if (recipe.isError && !recipe.data) return <ErrorState error={recipe.error} onRetry={() => recipe.refetch()} />;
  const r = recipe.data!;
  const shown = servings ?? r.servings;
  const factor = shown / r.servings;

  return (
    <Screen refreshing={recipe.isRefetching} onRefresh={() => recipe.refetch()}>
      <Stack.Screen options={{ title: r.title }} />
      <StaleBanner visible={recipe.isError} />
      <View style={styles.header}>
        <ThemedText type="subtitle">{r.title}</ThemedText>
        {r.description ? <ThemedText themeColor="textSecondary">{r.description}</ThemedText> : null}
        {r.source === 'coach' ? <Pill label="Suggested by coach" tone="accent" /> : null}
      </View>

      <Row style={styles.wrap}>
        <Button title="Start cooking" onPress={() => router.push({ pathname: '/meals/cook', params: { id: r.id } })} disabled={!r.steps.length} />
        <Button
          title="Plan it"
          variant="secondary"
          onPress={() => router.push({ pathname: '/plan-add', params: { kind: 'meal', recipeId: r.id, title: r.title } })}
        />
      </Row>

      <Card>
        <Stepper label="Servings" value={shown} onChange={setServings} min={1} max={100} />
        <SectionHeader title="Ingredients" />
        {r.ingredients.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No ingredients listed.
          </ThemedText>
        ) : (
          r.ingredients.map((i, index) => (
            <ThemedText key={`${i.name}-${index}`} accessibilityLabel={`${formatAmount(i.quantity == null ? null : i.quantity * factor, i.unit)} ${i.name}`}>
              • {formatAmount(i.quantity == null ? null : i.quantity * factor, i.unit)} {i.name}
              {i.note ? <ThemedText themeColor="textSecondary">, {i.note}</ThemedText> : null}
            </ThemedText>
          ))
        )}
        {addToShopping.isSuccess ? (
          <Notice tone="success">{shoppingSummary(addToShopping.data.added, addToShopping.data.combined)}</Notice>
        ) : null}
        {addToShopping.isError ? <Notice tone="error">{errorMessage(addToShopping.error)}</Notice> : null}
        <Button
          title={`Add to shopping list (${shown} serving${shown === 1 ? '' : 's'})`}
          size="small"
          variant="secondary"
          onPress={() => addToShopping.mutate()}
          loading={addToShopping.isPending}
          disabled={!r.ingredients.length}
        />
      </Card>

      <SectionHeader title="Steps" />
      {r.steps.map((s, index) => (
        <Card key={index}>
          <ThemedText type="smallBold">Step {index + 1}</ThemedText>
          <ThemedText>{s.text}</ThemedText>
          {s.timerSeconds ? <Pill label={`Timer ${Math.round(s.timerSeconds / 60)} min`} tone="muted" /> : null}
        </Card>
      ))}

      {r.nutrition ? (
        <Card>
          <ThemedText type="smallBold">Estimated nutrition per serving</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[
              r.nutrition.calories != null && `~${Math.round(r.nutrition.calories)} kcal`,
              r.nutrition.proteinG != null && `~${Math.round(r.nutrition.proteinG)} g protein`,
              r.nutrition.carbsG != null && `~${Math.round(r.nutrition.carbsG)} g carbs`,
              r.nutrition.fatG != null && `~${Math.round(r.nutrition.fatG)} g fat`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {'\n'}A rough estimate, not a measurement.
          </ThemedText>
        </Card>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        Check ingredients against your own allergies and dietary needs.
      </ThemedText>
      {r.notes ? (
        <Card>
          <ThemedText type="smallBold">Notes</ThemedText>
          <ThemedText type="small">{r.notes}</ThemedText>
        </Card>
      ) : null}

      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
      <Row style={styles.wrap}>
        <Button title="Edit" variant="secondary" onPress={() => router.push({ pathname: '/meals/edit', params: { id: r.id } })} />
        <Button
          title="Delete"
          variant="quiet"
          loading={remove.isPending}
          onPress={() =>
            Alert.alert('Delete this recipe?', r.title, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
            ])
          }
        />
      </Row>
    </Screen>
  );
}

function shoppingSummary(added: number, combined: number): string {
  const parts = [];
  if (added) parts.push(`Added ${added} item${added === 1 ? '' : 's'}`);
  if (combined) parts.push(`${added ? 'updated' : 'Updated'} ${combined} already on your list`);
  return parts.length ? `${parts.join(', ')}.` : 'Nothing to add.';
}

const styles = StyleSheet.create({
  header: { gap: Spacing.two },
  wrap: { flexWrap: 'wrap' },
});
