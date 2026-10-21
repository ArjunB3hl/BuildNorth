import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Countdown } from '@/components/countdown';
import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, Loading, Row, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { formatAmount } from '@/lib/drafts';

/** Guided cooking: one step at a time, with timers for timed steps. */
export default function CookMode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => api.recipes.get(id) });
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);

  if (recipe.isPending) return <Loading label="Loading recipe…" />;
  if (recipe.isError && !recipe.data) return <ErrorState error={recipe.error} onRetry={() => recipe.refetch()} />;
  const r = recipe.data!;
  const step = r.steps[index];
  const last = index === r.steps.length - 1;

  return (
    <Screen aboveTabBar={false}
      footer={
        <Row>
          <View style={styles.fill}>
            <Button title="Previous" variant="secondary" disabled={index === 0} onPress={() => setIndex((i) => i - 1)} />
          </View>
          <View style={styles.fill}>
            {last ? (
              <Button title="Finish" onPress={() => router.back()} />
            ) : (
              <Button title="Next step" onPress={() => setIndex((i) => i + 1)} />
            )}
          </View>
        </Row>
      }>
      <Stack.Screen
        options={{
          title: r.title,
          headerLeft: () => <Button title="Close" size="small" variant="quiet" onPress={() => router.back()} />,
        }}
      />
      <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
        Step {index + 1} of {r.steps.length}
      </ThemedText>
      <Card>
        <ThemedText type="subtitle" style={styles.stepText}>
          {step?.text ?? 'This recipe has no steps yet.'}
        </ThemedText>
      </Card>
      {step?.timerSeconds ? <Countdown key={index} seconds={step.timerSeconds} label={`Timer for step ${index + 1}`} /> : null}
      <Button
        title={showIngredients ? 'Hide ingredients' : 'Show ingredients'}
        size="small"
        variant="quiet"
        onPress={() => setShowIngredients((v) => !v)}
      />
      {showIngredients ? (
        <Card>
          {r.ingredients.map((i, n) => (
            <ThemedText key={n} type="small">
              • {formatAmount(i.quantity, i.unit)} {i.name}
            </ThemedText>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stepText: { fontSize: 26, lineHeight: 34 },
});
