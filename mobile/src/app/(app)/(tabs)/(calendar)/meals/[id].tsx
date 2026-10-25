import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, Notice } from '@/components/form';
import { ActionButton } from '@/components/meals/action-button';
import { MealIcons } from '@/components/meals/icons';
import { SectionCard } from '@/components/meals/layout';
import { IngredientList, nutritionParts, RecipeMeta, RecipeTags, StepList } from '@/components/meals/recipe-parts';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, ErrorState, Loading, Row, Screen, StaleBanner, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { Enter, Stagger } from '@/components/motion';

const web = Platform.OS === 'web';
/** Window width from which ingredients sit beside the steps (sidebar + page padding + two columns). */
const TWO_COLUMNS_FROM = 1100;

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
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
  const twoColumns = web && width >= TWO_COLUMNS_FROM;

  const startCooking = () => router.push({ pathname: '/meals/cook', params: { id: r.id } });
  const planIt = () => router.push({ pathname: '/plan-add', params: { kind: 'meal', recipeId: r.id, title: r.title } });
  const edit = () => router.push({ pathname: '/meals/edit', params: { id: r.id } });
  const confirmDelete = async () => {
    const ok = await confirmAction({ title: 'Delete this recipe?', message: r.title, confirmLabel: 'Delete', destructive: true });
    if (ok) remove.mutate();
  };

  const servingsStepper = <Stepper label="Servings" value={shown} onChange={setServings} min={1} max={100} />;
  const addToShoppingButton = (
    <ActionButton
      title={`Add to shopping list (${shown} serving${shown === 1 ? '' : 's'})`}
      icon={MealIcons.addToCart}
      size="small"
      onPress={() => addToShopping.mutate()}
      loading={addToShopping.isPending}
      disabled={!r.ingredients.length}
    />
  );
  const shoppingNotices = (
    <>
      {addToShopping.isSuccess ? (
        <Notice tone="success">{shoppingSummary(addToShopping.data.added, addToShopping.data.combined)}</Notice>
      ) : null}
      {addToShopping.isError ? <Notice tone="error">{errorMessage(addToShopping.error)}</Notice> : null}
    </>
  );

  const ingredients = (
    <SectionCard title="Ingredients" icon={MealIcons.ingredients} count={r.ingredients.length}>
      {web ? (
        factor !== 1 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Scaled for {shown} servings. The recipe makes {r.servings}.
          </ThemedText>
        ) : null
      ) : (
        servingsStepper
      )}
      <IngredientList ingredients={r.ingredients} factor={factor} />
      {web ? null : (
        <>
          {shoppingNotices}
          {addToShoppingButton}
        </>
      )}
    </SectionCard>
  );
  const allergyNote = (
    <ThemedText type="small" themeColor="textSecondary">
      Check ingredients against your own allergies and dietary needs.
    </ThemedText>
  );
  const steps = (
    <SectionCard title="Steps" icon={MealIcons.steps} count={r.steps.length}>
      <StepList steps={r.steps} />
    </SectionCard>
  );
  const nutrition = r.nutrition ? (
    <SectionCard title="Nutrition per serving" icon={MealIcons.nutrition}>
      <ThemedText type="small">{nutritionParts(r.nutrition).join(' · ')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        A rough estimate, not a measurement.
      </ThemedText>
    </SectionCard>
  ) : null;
  const notes = r.notes ? (
    <SectionCard title="Notes" icon={MealIcons.notes}>
      <ThemedText type="small">{r.notes}</ThemedText>
    </SectionCard>
  ) : null;
  const deleteError = remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null;

  return (
    <Screen wide refreshing={recipe.isRefetching} onRefresh={() => recipe.refetch()}>
      <Stack.Screen options={{ title: r.title }} />
      <StaleBanner visible={recipe.isError} />

      {web ? (
        <>
          <Enter>
            <Card style={styles.headerCard}>
              <View style={styles.headerTop}>
                <View style={styles.headerText}>
                  <ThemedText type="subtitle">{r.title}</ThemedText>
                  {r.description ? <ThemedText themeColor="textSecondary">{r.description}</ThemedText> : null}
                  <RecipeMeta recipe={r} />
                  <RecipeTags recipe={r} />
                </View>
                <View style={styles.group}>
                  <ActionButton title="Edit" icon={MealIcons.edit} size="small" onPress={edit} />
                  <ActionButton title="Delete" icon={MealIcons.delete} tone="danger" size="small" loading={remove.isPending} onPress={confirmDelete} />
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <View style={styles.toolbar}>
                <View style={styles.group}>
                  <Button title="Start cooking" size="small" onPress={startCooking} disabled={!r.steps.length} />
                  <ActionButton title="Plan it" icon={MealIcons.plan} size="small" onPress={planIt} />
                  {addToShoppingButton}
                </View>
                <View style={styles.stepper}>{servingsStepper}</View>
              </View>
            </Card>
          </Enter>
          {shoppingNotices}
          {deleteError}
        </>
      ) : (
        <>
          <Enter style={styles.header}>
            <ThemedText type="subtitle">{r.title}</ThemedText>
            {r.description ? <ThemedText themeColor="textSecondary">{r.description}</ThemedText> : null}
            <RecipeMeta recipe={r} />
            <RecipeTags recipe={r} />
          </Enter>
          <Enter index={1}>
            <Row style={styles.wrap}>
              <Button title="Start cooking" onPress={startCooking} disabled={!r.steps.length} />
              <Button title="Plan it" variant="secondary" onPress={planIt} />
            </Row>
          </Enter>
        </>
      )}

      {twoColumns ? (
        <View style={styles.columns}>
          <Enter index={1} style={styles.side}>
            {ingredients}
            {allergyNote}
            {nutrition}
          </Enter>
          <Enter index={2} style={styles.main}>
            {steps}
            {notes}
          </Enter>
        </View>
      ) : (
        <Stagger delay={60}>
          {ingredients}
          {steps}
          {nutrition}
          {allergyNote}
          {notes}
        </Stagger>
      )}

      {web ? null : (
        <>
          {deleteError}
          <Row style={styles.wrap}>
            <Button title="Edit" variant="secondary" onPress={edit} />
            <Button title="Delete" variant="quiet" loading={remove.isPending} onPress={confirmDelete} />
          </Row>
        </>
      )}
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
  headerCard: { gap: Spacing.three },
  headerTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  headerText: { flexGrow: 1, flexShrink: 1, flexBasis: 360, gap: Spacing.two },
  // flexShrink lets a group narrower than its buttons wrap them instead of overflowing.
  group: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  divider: { height: 1 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  // Stepper's label stretches, so it needs a fixed box to sit in a wrapping row.
  stepper: { width: 240 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  side: { width: 380, gap: Spacing.three },
  main: { flex: 1, minWidth: 0, gap: Spacing.three },
});
