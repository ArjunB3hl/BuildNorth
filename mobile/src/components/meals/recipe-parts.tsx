import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Pill } from '@/components/ui';
import { MealIcons } from '@/components/meals/icons';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatAmount } from '@/lib/drafts';
import type { Ingredient, Nutrition, Recipe, Step } from '@/lib/types';

const web = Platform.OS === 'web';

export const plural = (n: number, word: string, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;

/** Minutes of timed steps. Recipes carry no total time, so this is labelled as timed, not as cooking time. */
export function timedMinutes(steps: Step[]): number {
  return Math.round(steps.reduce((total, s) => total + (s.timerSeconds ?? 0), 0) / 60);
}

export function nutritionParts(n: Nutrition): string[] {
  return [
    n.calories != null && `~${Math.round(n.calories)} kcal`,
    n.proteinG != null && `~${Math.round(n.proteinG)} g protein`,
    n.carbsG != null && `~${Math.round(n.carbsG)} g carbs`,
    n.fatG != null && `~${Math.round(n.fatG)} g fat`,
  ].filter((p): p is string => !!p);
}

export function MetaItem({ icon, label, accessibilityLabel }: { icon: SymbolViewProps['name']; label: string; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.metaItem} accessible accessibilityLabel={accessibilityLabel ?? label}>
      <SymbolView name={icon} size={16} tintColor={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

/** Servings, ingredient and step counts and timed minutes for a recipe. */
export function RecipeMeta({ recipe, servings }: { recipe: Pick<Recipe, 'servings' | 'ingredients' | 'steps'>; servings?: number }) {
  const minutes = timedMinutes(recipe.steps);
  return (
    <View style={styles.meta}>
      <MetaItem icon={MealIcons.servings} label={plural(servings ?? recipe.servings, 'serving')} />
      <MetaItem icon={MealIcons.ingredients} label={plural(recipe.ingredients.length, 'ingredient')} />
      <MetaItem icon={MealIcons.steps} label={plural(recipe.steps.length, 'step')} />
      {minutes > 0 ? (
        <MetaItem icon={MealIcons.timer} label={`${minutes} min timed`} accessibilityLabel={`${plural(minutes, 'minute')} of timed steps`} />
      ) : null}
    </View>
  );
}

/** Source and tag pills, capped so cards stay one line tall. */
export function RecipeTags({ recipe, max }: { recipe: Pick<Recipe, 'source' | 'tags'>; max?: number }) {
  const tags = recipe.tags ?? [];
  const shown = max == null ? tags : tags.slice(0, max);
  if (recipe.source !== 'coach' && !tags.length) return null;
  return (
    <View style={styles.tags}>
      {recipe.source === 'coach' ? <Pill label="Suggested by coach" tone="accent" /> : null}
      {shown.map((tag) => (
        <Pill key={tag} label={tag} />
      ))}
      {tags.length > shown.length ? <Pill label={`+${tags.length - shown.length}`} tone="muted" /> : null}
    </View>
  );
}

/** Ingredients as a two-column list: amount, then name and note. `factor` scales amounts for servings. */
export function IngredientList({ ingredients, factor = 1, compact = false }: { ingredients: Ingredient[]; factor?: number; compact?: boolean }) {
  const theme = useTheme();
  if (!ingredients.length) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No ingredients listed.
      </ThemedText>
    );
  }
  return (
    <View>
      {ingredients.map((i, index) => {
        const amount = formatAmount(i.quantity == null ? null : i.quantity * factor, i.unit);
        return (
          <View
            key={`${i.name}-${index}`}
            accessible
            accessibilityLabel={`${amount} ${i.name}${i.note ? `, ${i.note}` : ''}`.trim()}
            style={[styles.ingredient, compact && styles.ingredientCompact, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
            <ThemedText type="smallBold" style={styles.amount}>
              {amount}
            </ThemedText>
            <ThemedText type={compact ? 'small' : 'default'} style={styles.ingredientName}>
              {i.name}
              {i.note ? <ThemedText type={compact ? 'small' : 'default'} themeColor="textSecondary">, {i.note}</ThemedText> : null}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

/** Numbered steps with their timers. */
export function StepList({ steps }: { steps: Step[] }) {
  const theme = useTheme();
  if (!steps.length) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No steps yet. Edit the recipe to add them.
      </ThemedText>
    );
  }
  return (
    <View style={styles.steps}>
      {steps.map((s, index) => (
        <View key={index} style={styles.step}>
          <StepNumber n={index + 1} />
          <View style={styles.stepBody}>
            <ThemedText accessibilityLabel={`Step ${index + 1}. ${s.text}`}>{s.text}</ThemedText>
            {s.timerSeconds ? (
              <View style={[styles.timer, { backgroundColor: theme.backgroundSelected }]}>
                <SymbolView name={MealIcons.timer} size={14} tintColor={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.timerText}>
                  Timer {Math.round(s.timerSeconds / 60)} min
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function StepNumber({ n }: { n: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.stepNumber, { backgroundColor: theme.backgroundSelected }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <ThemedText type="smallBold" style={styles.stepNumberText}>
        {n}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three, rowGap: Spacing.one },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + Spacing.half },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + Spacing.half },
  ingredient: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.three, paddingVertical: Spacing.two + Spacing.half },
  ingredientCompact: { paddingVertical: Spacing.two },
  amount: { width: web ? 88 : 80, fontVariant: ['tabular-nums'] },
  ingredientName: { flex: 1 },
  steps: { gap: Spacing.three + Spacing.one },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  stepBody: { flex: 1, gap: Spacing.two },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.half },
  stepNumberText: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  timerText: { fontSize: 12, lineHeight: 16 },
});
