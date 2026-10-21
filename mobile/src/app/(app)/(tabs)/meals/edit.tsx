import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Row, Screen, SectionHeader, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { dropDraft, getDraft, type RecipeDraftHandoff } from '@/lib/drafts';
import type { Nutrition, Recipe, RecipeInput } from '@/lib/types';

type IngredientRow = { key: string; name: string; quantity: string; unit: string; note: string };
type StepRow = { key: string; text: string; minutes: string };

let counter = 0;
const key = () => `row${++counter}`;

function toRows(recipe: Pick<RecipeInput, 'ingredients' | 'steps'>) {
  return {
    ingredients: recipe.ingredients.map((i) => ({
      key: key(),
      name: i.name,
      quantity: i.quantity == null ? '' : String(i.quantity),
      unit: i.unit ?? '',
      note: i.note ?? '',
    })),
    steps: recipe.steps.map((s) => ({ key: key(), text: s.text, minutes: s.timerSeconds ? String(Math.round(s.timerSeconds / 6) / 10) : '' })),
  };
}

export default function EditRecipe() {
  const api = useApi();
  const params = useLocalSearchParams<{ id?: string; draftId?: string }>();
  const existing = useQuery({
    queryKey: ['recipe', params.id],
    queryFn: () => api.recipes.get(params.id!),
    enabled: !!params.id,
  });
  const handoff = getDraft<RecipeDraftHandoff>(params.draftId);

  if (params.id) {
    if (existing.isPending) return <Loading label="Loading recipe…" />;
    if (existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
    return <RecipeEditor recipe={existing.data} />;
  }
  return <RecipeEditor handoff={handoff} draftId={params.draftId} />;
}

function RecipeEditor({ recipe, handoff, draftId }: { recipe?: Recipe; handoff?: RecipeDraftHandoff; draftId?: string }) {
  const api = useApi();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const base = recipe ?? handoff?.draft;
  const initialRows = toRows(base ?? { ingredients: [], steps: [] });

  const [title, setTitle] = useState(base?.title ?? '');
  const [servings, setServings] = useState(base?.servings ?? 2);
  const [description, setDescription] = useState(base?.description ?? '');
  const [notes, setNotes] = useState(recipe?.notes ?? handoff?.notes ?? '');
  const [ingredients, setIngredients] = useState<IngredientRow[]>(initialRows.ingredients);
  const [steps, setSteps] = useState<StepRow[]>(initialRows.steps);
  const [nutrition, setNutrition] = useState<Nutrition | null>(base?.nutrition ?? null);
  const [validation, setValidation] = useState<string | null>(null);

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }];

  const save = useMutation({
    mutationFn: (body: RecipeInput) => (recipe ? api.recipes.update(recipe.id, body) : api.recipes.create(body)),
    onSuccess: (saved) => {
      dropDraft(draftId);
      queryClient.setQueryData(['recipe', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      if (recipe) router.back();
      else router.replace({ pathname: '/meals/[id]', params: { id: saved.id } });
    },
  });

  function submit() {
    setValidation(null);
    const cleanIngredients = ingredients
      .filter((i) => i.name.trim())
      .map((i) => {
        const quantity = i.quantity.trim() ? Number(i.quantity.replace(',', '.')) : null;
        return { name: i.name.trim(), quantity, unit: i.unit.trim() || null, note: i.note.trim() || null };
      });
    if (cleanIngredients.some((i) => i.quantity !== null && (!Number.isFinite(i.quantity) || i.quantity < 0))) {
      setValidation('Quantities must be numbers, like 2 or 0.5.');
      return;
    }
    const cleanSteps = steps
      .filter((s) => s.text.trim())
      .map((s) => {
        const minutes = Number(s.minutes.replace(',', '.'));
        return { text: s.text.trim(), timerSeconds: s.minutes.trim() && minutes > 0 ? Math.round(minutes * 60) : null };
      });
    if (!title.trim()) {
      setValidation('Give the recipe a title.');
      return;
    }
    save.mutate({
      title: title.trim(),
      servings,
      description: description.trim() || null,
      ingredients: cleanIngredients,
      steps: cleanSteps,
      notes: notes.trim() || null,
      tags: recipe?.tags ?? [],
      source: (recipe?.source as RecipeInput['source']) ?? handoff?.source ?? 'manual',
      nutrition,
    });
  }

  const updateIngredient = (k: string, patch: Partial<IngredientRow>) =>
    setIngredients((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const updateStep = (k: string, patch: Partial<StepRow>) => setSteps((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const moveStep = (index: number, delta: number) =>
    setSteps((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row);
      return next;
    });

  return (
    <Screen
      footer={
        <>
          {validation ? <Notice tone="error">{validation}</Notice> : null}
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          <Button title={recipe ? 'Save changes' : 'Save recipe'} onPress={submit} loading={save.isPending} />
        </>
      }>
      <Stack.Screen options={{ title: recipe ? 'Edit recipe' : handoff?.source === 'manual' ? 'New recipe' : 'Review recipe' }} />
      {handoff?.warnings.length ? (
        <Notice tone="info">{['Please review:', ...handoff.warnings.map((w) => `• ${w}`)].join('\n')}</Notice>
      ) : null}

      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Lentil soup" maxLength={200} />
      <Stepper label="Servings" value={servings} onChange={setServings} min={1} max={100} />
      <TextField label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={2000} />

      <SectionHeader title="Ingredients" />
      {ingredients.map((row) => (
        <Card key={row.key} style={styles.rowCard}>
          <TextInput
            value={row.name}
            onChangeText={(t) => updateIngredient(row.key, { name: t })}
            placeholder="Ingredient"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Ingredient name"
            style={inputStyle}
            maxLength={200}
          />
          <Row>
            <TextInput
              value={row.quantity}
              onChangeText={(t) => updateIngredient(row.key, { quantity: t })}
              placeholder="Qty"
              keyboardType="decimal-pad"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={`Quantity for ${row.name || 'ingredient'}`}
              style={[inputStyle, styles.small]}
            />
            <TextInput
              value={row.unit}
              onChangeText={(t) => updateIngredient(row.key, { unit: t })}
              placeholder="Unit"
              autoCapitalize="none"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={`Unit for ${row.name || 'ingredient'}`}
              style={[inputStyle, styles.small]}
              maxLength={20}
            />
            <TextInput
              value={row.note}
              onChangeText={(t) => updateIngredient(row.key, { note: t })}
              placeholder="Note"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={`Note for ${row.name || 'ingredient'}`}
              style={[inputStyle, styles.fill]}
              maxLength={200}
            />
            <RemoveButton label={`Remove ${row.name || 'ingredient'}`} onPress={() => setIngredients((rows) => rows.filter((r) => r.key !== row.key))} />
          </Row>
        </Card>
      ))}
      <Button
        title="Add ingredient"
        size="small"
        variant="secondary"
        onPress={() => setIngredients((rows) => [...rows, { key: key(), name: '', quantity: '', unit: '', note: '' }])}
      />

      <SectionHeader title="Steps" />
      {steps.map((row, index) => (
        <Card key={row.key} style={styles.rowCard}>
          <ThemedText type="smallBold">Step {index + 1}</ThemedText>
          <TextInput
            value={row.text}
            onChangeText={(t) => updateStep(row.key, { text: t })}
            placeholder="What to do"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={`Step ${index + 1} instructions`}
            multiline
            style={[inputStyle, styles.multiline]}
            maxLength={2000}
          />
          <Row>
            <TextInput
              value={row.minutes}
              onChangeText={(t) => updateStep(row.key, { minutes: t })}
              placeholder="Timer (min)"
              keyboardType="decimal-pad"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={`Timer in minutes for step ${index + 1}`}
              style={[inputStyle, styles.timer]}
            />
            <View style={styles.fill} />
            <Button title="↑" size="small" variant="secondary" disabled={index === 0} onPress={() => moveStep(index, -1)} accessibilityLabel={`Move step ${index + 1} up`} />
            <Button title="↓" size="small" variant="secondary" disabled={index === steps.length - 1} onPress={() => moveStep(index, 1)} accessibilityLabel={`Move step ${index + 1} down`} />
            <RemoveButton label={`Remove step ${index + 1}`} onPress={() => setSteps((rows) => rows.filter((r) => r.key !== row.key))} />
          </Row>
        </Card>
      ))}
      <Button title="Add step" size="small" variant="secondary" onPress={() => setSteps((rows) => [...rows, { key: key(), text: '', minutes: '' }])} />

      {nutrition ? (
        <Card>
          <ThemedText type="smallBold">Estimated nutrition per serving</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[
              nutrition.calories != null && `~${Math.round(nutrition.calories)} kcal`,
              nutrition.proteinG != null && `~${Math.round(nutrition.proteinG)} g protein`,
              nutrition.carbsG != null && `~${Math.round(nutrition.carbsG)} g carbs`,
              nutrition.fatG != null && `~${Math.round(nutrition.fatG)} g fat`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            A rough AI estimate, not a measurement.
          </ThemedText>
          <Button title="Remove estimate" size="small" variant="quiet" onPress={() => setNutrition(null)} />
        </Card>
      ) : null}

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={4000} style={styles.multiline} />
    </Screen>
  );
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={[styles.remove, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">✕</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  rowCard: { gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two + Spacing.one, minHeight: 44, fontSize: 16 },
  small: { width: 72 },
  timer: { width: 120 },
  multiline: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  remove: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
