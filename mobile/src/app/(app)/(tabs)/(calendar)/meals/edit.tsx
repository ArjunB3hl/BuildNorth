import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, useWindowDimensions, View, type StyleProp, type TextStyle } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ActionButton } from '@/components/meals/action-button';
import { MealIcons } from '@/components/meals/icons';
import { SectionCard } from '@/components/meals/layout';
import { nutritionParts, StepNumber } from '@/components/meals/recipe-parts';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Screen, SectionHeader, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { dropDraft, getDraft, type RecipeDraftHandoff } from '@/lib/drafts';
import type { Nutrition, Recipe, RecipeInput } from '@/lib/types';
import { Enter } from '@/components/motion';

const web = Platform.OS === 'web';
/** Below this window width the web stacks each ingredient's fields like the phone layout. */
const INLINE_FROM = 640;

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
  const { width } = useWindowDimensions();
  const inline = web && width >= INLINE_FROM;
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

  // Phones put white fields on grey row cards; the web uses white fields with a hairline, like TextField.
  const inputStyle = [
    styles.input,
    web
      ? { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }
      : { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected },
  ];

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

  /**
   * On the web, rows share their section's card (split by hairlines when `divided`); phones keep one card per row.
   */
  const rowWrap = (k: string, index: number, divided: boolean, children: ReactNode) =>
    web ? (
      <View
        key={k}
        style={[styles.webRow, divided && index > 0 && [styles.divided, { borderTopColor: theme.border }]]}>
        {children}
      </View>
    ) : (
      <Card key={k} style={styles.rowCard}>
        {children}
      </Card>
    );

  return (
    <Screen
      footer={
        <>
          {validation ? <Notice tone="error">{validation}</Notice> : null}
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          <View style={web && styles.footerActions}>
            <Button title={recipe ? 'Save changes' : 'Save recipe'} onPress={submit} loading={save.isPending} />
          </View>
        </>
      }>
      <Stack.Screen options={{ title: recipe ? 'Edit recipe' : handoff?.source === 'manual' ? 'New recipe' : 'Review recipe' }} />
      {handoff?.warnings.length ? (
        <Notice tone="info">{['Please review:', ...handoff.warnings.map((w) => `• ${w}`)].join('\n')}</Notice>
      ) : null}

      <FormSection title="Details">
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Lentil soup" maxLength={200} />
        <View style={web && styles.stepper}>
          <Stepper label="Servings" value={servings} onChange={setServings} min={1} max={100} />
        </View>
        <TextField label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={2000} />
      </FormSection>

      <FormSection title="Ingredients" icon={MealIcons.ingredients} count={ingredients.length} index={1}>
        {inline && ingredients.length ? (
          <View style={styles.inlineRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <ColumnLabel style={styles.qty}>Qty</ColumnLabel>
            <ColumnLabel style={styles.unit}>Unit</ColumnLabel>
            <ColumnLabel style={styles.name}>Ingredient</ColumnLabel>
            <ColumnLabel style={styles.note}>Note</ColumnLabel>
            <View style={styles.iconSpacer} />
          </View>
        ) : null}
        {ingredients.map((row, index) => {
          const nameInput = (
            <TextInput
              value={row.name}
              onChangeText={(t) => updateIngredient(row.key, { name: t })}
              placeholder="Ingredient"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Ingredient name"
              style={[inputStyle, inline && styles.name]}
              maxLength={200}
            />
          );
          const amountInputs = (
            <>
              <TextInput
                value={row.quantity}
                onChangeText={(t) => updateIngredient(row.key, { quantity: t })}
                placeholder="Qty"
                keyboardType="decimal-pad"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel={`Quantity for ${row.name || 'ingredient'}`}
                style={[inputStyle, styles.qty]}
              />
              <TextInput
                value={row.unit}
                onChangeText={(t) => updateIngredient(row.key, { unit: t })}
                placeholder="Unit"
                autoCapitalize="none"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel={`Unit for ${row.name || 'ingredient'}`}
                style={[inputStyle, styles.unit]}
                maxLength={20}
              />
            </>
          );
          const noteInput = (
            <TextInput
              value={row.note}
              onChangeText={(t) => updateIngredient(row.key, { note: t })}
              placeholder="Note"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={`Note for ${row.name || 'ingredient'}`}
              style={[inputStyle, inline ? styles.note : styles.noteStacked]}
              maxLength={200}
            />
          );
          const removeButton = (
            <ActionButton
              title="Remove"
              icon={MealIcons.close}
              iconOnly
              size="small"
              accessibilityLabel={`Remove ${row.name || 'ingredient'}`}
              onPress={() => setIngredients((rows) => rows.filter((r) => r.key !== row.key))}
            />
          );
          return rowWrap(
            row.key,
            index,
            !inline,
            inline ? (
              <View style={styles.inlineRow}>
                {amountInputs}
                {nameInput}
                {noteInput}
                {removeButton}
              </View>
            ) : (
              <>
                {nameInput}
                <View style={styles.inlineRow}>
                  {amountInputs}
                  {noteInput}
                  {removeButton}
                </View>
              </>
            ),
          );
        })}
        <View style={styles.start}>
          <ActionButton
            title="Add ingredient"
            icon={MealIcons.add}
            size="small"
            onPress={() => setIngredients((rows) => [...rows, { key: key(), name: '', quantity: '', unit: '', note: '' }])}
          />
        </View>
      </FormSection>

      <FormSection title="Steps" icon={MealIcons.steps} count={steps.length} index={2}>
        {steps.map((row, index) =>
          rowWrap(
            row.key,
            index,
            true,
            <>
              <View style={styles.inlineRow}>
                <StepNumber n={index + 1} />
                <ThemedText type="smallBold" style={styles.fill}>
                  Step {index + 1}
                </ThemedText>
                <ActionButton
                  title="Move up"
                  icon={MealIcons.up}
                  iconOnly
                  size="small"
                  disabled={index === 0}
                  onPress={() => moveStep(index, -1)}
                  accessibilityLabel={`Move step ${index + 1} up`}
                />
                <ActionButton
                  title="Move down"
                  icon={MealIcons.down}
                  iconOnly
                  size="small"
                  disabled={index === steps.length - 1}
                  onPress={() => moveStep(index, 1)}
                  accessibilityLabel={`Move step ${index + 1} down`}
                />
                <ActionButton
                  title="Remove"
                  icon={MealIcons.close}
                  iconOnly
                  size="small"
                  onPress={() => setSteps((rows) => rows.filter((r) => r.key !== row.key))}
                  accessibilityLabel={`Remove step ${index + 1}`}
                />
              </View>
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
              <View style={styles.inlineRow}>
                <SymbolView name={MealIcons.timer} size={18} tintColor={theme.textSecondary} />
                <TextInput
                  value={row.minutes}
                  onChangeText={(t) => updateStep(row.key, { minutes: t })}
                  placeholder="Timer (min)"
                  keyboardType="decimal-pad"
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={`Timer in minutes for step ${index + 1}`}
                  style={[inputStyle, styles.timer]}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  minutes
                </ThemedText>
              </View>
            </>,
          ),
        )}
        <View style={styles.start}>
          <ActionButton
            title="Add step"
            icon={MealIcons.add}
            size="small"
            onPress={() => setSteps((rows) => [...rows, { key: key(), text: '', minutes: '' }])}
          />
        </View>
      </FormSection>

      {nutrition ? (
        <SectionCard
          title="Nutrition per serving"
          icon={MealIcons.nutrition}
          action={<Button title="Remove estimate" size="small" variant="quiet" onPress={() => setNutrition(null)} />}>
          <ThemedText type="small">{nutritionParts(nutrition).join(' · ')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            A rough AI estimate, not a measurement.
          </ThemedText>
        </SectionCard>
      ) : null}

      <FormSection index={3}>
        <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={4000} style={styles.multiline} />
      </FormSection>
    </Screen>
  );
}

/** A titled card on the web; on phones the fields sit on the page under a section header, as before. */
function FormSection({
  title,
  icon,
  count,
  index = 0,
  children,
}: {
  title?: string;
  icon?: SymbolViewProps['name'];
  count?: number;
  /** Its place in the page's entrance stagger. */
  index?: number;
  children: ReactNode;
}) {
  if (web) {
    return (
      <Enter index={index}>
        {title ? (
          <SectionCard title={title} icon={icon} count={count}>
            {children}
          </SectionCard>
        ) : (
          <Card style={styles.section}>{children}</Card>
        )}
      </Enter>
    );
  }
  return (
    <Enter index={index} style={styles.section}>
      {title ? <SectionHeader title={title} /> : null}
      {children}
    </Enter>
  );
}

function ColumnLabel({ children, style }: { children: string; style: StyleProp<TextStyle> }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={[styles.columnLabel, style]}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  section: { gap: Spacing.three },
  rowCard: { gap: Spacing.two },
  webRow: { gap: Spacing.two },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, marginTop: Spacing.one },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two + Spacing.one, minHeight: 44, fontSize: 16 },
  qty: { width: 72 },
  unit: { width: web ? 84 : 72 },
  name: { flex: 2, minWidth: 0 },
  note: { flex: 1.5, minWidth: 0 },
  // minWidth 0: web inputs otherwise keep their intrinsic width and overflow narrow rows.
  noteStacked: { flex: 1, minWidth: 0 },
  // Matches the 36pt icon-only remove button so the column labels line up.
  iconSpacer: { width: 36 },
  columnLabel: { fontSize: 12, lineHeight: 16 },
  timer: { width: 120 },
  multiline: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  start: { alignSelf: 'flex-start' },
  stepper: { maxWidth: 320 },
  footerActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
