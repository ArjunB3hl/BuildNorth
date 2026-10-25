import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Countdown } from '@/components/countdown';
import { Accent, Button, Notice } from '@/components/form';
import { ActionButton } from '@/components/meals/action-button';
import { MealIcons } from '@/components/meals/icons';
import { SectionCard } from '@/components/meals/layout';
import { IngredientList } from '@/components/meals/recipe-parts';
import { Collapse, FadeIn, FillBar } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, Loading, Row, Screen, errorMessage } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { newKey } from '@/lib/keys';
import { useTheme } from '@/hooks/use-theme';

const web = Platform.OS === 'web';

/** Guided cooking: one step at a time, with timers for timed steps. */
export default function CookMode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const theme = useTheme();
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => api.recipes.get(id) });
  const cache = useQueryClient();
  const [mealKey] = useState(newKey);
  const logMeal = useMutation({
    mutationFn: () => api.calendar.create({ kind: 'meal', title: recipe.data!.title, occurredAt: new Date().toISOString(), durationMinutes: null, notes: null, clientKey: mealKey }),
    onSuccess: () => { cache.invalidateQueries({ queryKey: ['calendar'] }); router.replace('/calendar'); },
  });
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);

  if (recipe.isPending) return <Loading label="Loading recipe…" />;
  if (recipe.isError && !recipe.data) return <ErrorState error={recipe.error} onRetry={() => recipe.refetch()} />;
  const r = recipe.data!;
  const step = r.steps[index];
  const next = r.steps[index + 1];
  const last = index >= r.steps.length - 1;

  return (
    <Screen
      aboveTabBar={false}
      footer={
        <>
          <Row>
            <View style={styles.fill}>
              <ActionButton title="Previous" icon={MealIcons.back} disabled={index === 0} onPress={() => setIndex((i) => i - 1)} />
            </View>
            <View style={styles.fill}>
              {last ? (
                <View style={{ gap: 8 }}><Button title="Ate this · log meal" loading={logMeal.isPending} onPress={() => logMeal.mutate()} /><Button title="Finish without logging" variant="quiet" disabled={logMeal.isPending} onPress={() => router.back()} /></View>
              ) : (
                <Button title="Next step" onPress={() => setIndex((i) => i + 1)} />
              )}
            </View>
          </Row>
        </>
      }>
      <Stack.Screen
        options={{
          title: r.title,
          headerLeft: () => <Button title="Close" size="small" variant="quiet" onPress={() => router.back()} />,
        }}
      />
      {logMeal.isError ? <Notice tone="error">{errorMessage(logMeal.error)}</Notice> : null}
      <View style={styles.progress}>
        <ThemedText type="smallBold" themeColor="textSecondary" accessibilityLiveRegion="polite">
          Step {index + 1} of {r.steps.length}
        </ThemedText>
        {r.steps.length > 1 ? (
          <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {/* Each segment fills as you reach its step. */}
            {r.steps.map((_, n) => (
              <View key={n} style={[styles.segment, { backgroundColor: theme.backgroundSelected }]}>
                <FillBar progress={n <= index ? 1 : 0} color={Accent} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {/* Keyed by step, so each new step eases in. */}
      <FadeIn key={`step-${index}`}>
        <Card style={web && styles.stepCardWeb}>
          <ThemedText type="subtitle" style={[styles.stepText, web && styles.stepTextWeb]}>
            {step?.text ?? 'This recipe has no steps yet.'}
          </ThemedText>
        </Card>
      </FadeIn>
      {step?.timerSeconds ? <Countdown key={index} seconds={step.timerSeconds} label={`Timer for step ${index + 1}`} /> : null}
      {next ? (
        <FadeIn key={`next-${index}`} delay={80} style={[styles.next, { borderColor: theme.border }]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Up next
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {next.text}
          </ThemedText>
        </FadeIn>
      ) : null}
      <View style={styles.start}>
        <ActionButton
          title={showIngredients ? 'Hide ingredients' : 'Show ingredients'}
          icon={MealIcons.ingredients}
          size="small"
          onPress={() => setShowIngredients((v) => !v)}
        />
      </View>
      <Collapse open={showIngredients}>
        <SectionCard title="Ingredients" icon={MealIcons.ingredients} count={r.ingredients.length}>
          <IngredientList ingredients={r.ingredients} compact />
        </SectionCard>
      </Collapse>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  progress: { gap: Spacing.two },
  segments: { flexDirection: 'row', gap: Spacing.one },
  segment: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  stepCardWeb: { minHeight: 180, justifyContent: 'center', paddingVertical: Spacing.five, paddingHorizontal: Spacing.five },
  stepText: { fontSize: 26, lineHeight: 34 },
  stepTextWeb: { lineHeight: 38, fontWeight: 500, letterSpacing: -0.2 },
  next: { gap: Spacing.half, borderLeftWidth: 3, paddingLeft: Spacing.three, paddingVertical: Spacing.one },
  start: { alignSelf: 'flex-start' },
});
