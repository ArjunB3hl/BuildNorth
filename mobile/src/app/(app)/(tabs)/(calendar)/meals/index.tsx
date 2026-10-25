import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, TextField } from '@/components/form';
import { ActionButton } from '@/components/meals/action-button';
import { MealIcons } from '@/components/meals/icons';
import { EmptyPanel } from '@/components/meals/layout';
import { RecipeGrid, RecipeGridSkeleton, SearchField } from '@/components/meals/recipe-card';
import { plural } from '@/components/meals/recipe-parts';
import { Enter, FadeIn, SkeletonCard, Stagger } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { ErrorState, ListItem, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';

const web = Platform.OS === 'web';

export default function MealsScreen() {
  const api = useApi();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const recipes = useQuery({ queryKey: ['recipes', debounced], queryFn: () => api.recipes.list(debounced) });
  const shopping = useQuery({ queryKey: ['shopping'], queryFn: api.shopping.list });
  const toBuy = shopping.data?.items.filter((i) => !i.checked).length ?? 0;
  const addRecipe = () => router.push('/meals/import');
  const openShopping = () => router.push('/meals/shopping');

  return (
    <Screen wide refreshing={recipes.isRefetching} onRefresh={() => recipes.refetch()}>
      {web ? (
        <>
          <Enter style={styles.top}>
            <ThemedText themeColor="textSecondary" style={styles.intro}>
              Your saved recipes. Open one to cook it, plan it or add it to your shopping list.
            </ThemedText>
            <View style={styles.actions}>
              <ActionButton
                title="Shopping list"
                icon={MealIcons.cart}
                size="small"
                badge={toBuy || undefined}
                accessibilityLabel={toBuy ? `Shopping list, ${toBuy} to buy` : 'Shopping list'}
                onPress={openShopping}
              />
              <Button title="Add recipe" size="small" onPress={addRecipe} />
            </View>
          </Enter>
          <Enter index={1} style={styles.toolbar}>
            <View style={styles.search}>
              <SearchField
                value={search}
                onChangeText={setSearch}
                placeholder="Search by title or ingredient"
                accessibilityLabel="Search recipes"
              />
            </View>
            {recipes.data ? (
              <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
                {debounced ? `${plural(recipes.data.length, 'result')} for “${debounced}”` : plural(recipes.data.length, 'recipe')}
              </ThemedText>
            ) : null}
          </Enter>
        </>
      ) : (
        <>
          <Row>
            <Button title="Add recipe" onPress={addRecipe} />
            <Button title={toBuy ? `Shopping list (${toBuy})` : 'Shopping list'} variant="secondary" onPress={openShopping} />
          </Row>
          <TextField
            label="Search recipes"
            value={search}
            onChangeText={setSearch}
            placeholder="Title or ingredient"
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          <SectionHeader title={debounced ? `Results for “${debounced}”` : 'Your recipes'} />
        </>
      )}

      <StaleBanner visible={recipes.isError && !!recipes.data} />
      {recipes.isPending ? (
        web ? (
          <RecipeGridSkeleton />
        ) : (
          <View style={styles.skeletons} accessibilityLabel="Loading recipes">
            {[0, 1, 2].map((i) => <SkeletonCard key={i} lines={1} />)}
          </View>
        )
      ) : null}
      {recipes.isError && !recipes.data ? <ErrorState error={recipes.error} onRetry={() => recipes.refetch()} /> : null}
      {recipes.data && recipes.data.length === 0 ? (
        <FadeIn>
          {debounced ? (
            <EmptyPanel
              icon={MealIcons.search}
              title="No matching recipes"
              body="Try another word, or clear the search."
              actions={<Button title="Clear search" size="small" variant="secondary" onPress={() => setSearch('')} />}
            />
          ) : (
            <EmptyPanel
              icon={MealIcons.recipe}
              title="No recipes yet"
              body="Paste a recipe, an ingredient list or a cooking transcript and Rhythm turns it into a recipe you can edit."
              actions={<Button title="Add your first recipe" size="small" onPress={addRecipe} />}
            />
          )}
        </FadeIn>
      ) : null}

      {recipes.data?.length ? (
        web ? (
          <RecipeGrid recipes={recipes.data} />
        ) : (
          <Stagger>
            {recipes.data.map((r) => (
              <ListItem
                key={r.id}
                title={r.title}
                subtitle={`${plural(r.servings, 'serving')} · ${r.ingredients.length} ingredients · ${r.steps.length} steps`}
                onPress={() => router.push({ pathname: '/meals/[id]', params: { id: r.id } })}
              />
            ))}
          </Stagger>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  intro: { flexGrow: 1, flexShrink: 1, flexBasis: 320 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.one },
  search: { flexGrow: 1, flexShrink: 1, flexBasis: 280, maxWidth: 440 },
  skeletons: { gap: Spacing.two },
});
