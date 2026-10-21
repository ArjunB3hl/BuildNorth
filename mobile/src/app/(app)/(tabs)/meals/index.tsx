import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, TextField } from '@/components/form';
import { EmptyState, ErrorState, ListItem, Loading, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { useApi } from '@/hooks/use-api';

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

  return (
    <Screen refreshing={recipes.isRefetching} onRefresh={() => recipes.refetch()}>
      <Row>
        <Button title="Add a recipe" onPress={() => router.push('/meals/import')} />
        <Button
          title={toBuy ? `Shopping list (${toBuy})` : 'Shopping list'}
          variant="secondary"
          onPress={() => router.push('/meals/shopping')}
        />
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
      <StaleBanner visible={recipes.isError && !!recipes.data} />
      {recipes.isPending ? <Loading label="Loading recipes…" /> : null}
      {recipes.isError && !recipes.data ? <ErrorState error={recipes.error} onRetry={() => recipes.refetch()} /> : null}
      {recipes.data && recipes.data.length === 0 ? (
        debounced ? (
          <EmptyState title="No matching recipes" body="Try another word, or clear the search." />
        ) : (
          <EmptyState
            title="No recipes yet"
            body="Paste a recipe, an ingredient list or a cooking transcript and BuildNorth turns it into a recipe you can edit."
            action={<Button title="Add your first recipe" size="small" onPress={() => router.push('/meals/import')} />}
          />
        )
      ) : null}
      {recipes.data?.map((r) => (
        <ListItem
          key={r.id}
          title={r.title}
          subtitle={`${r.servings} serving${r.servings === 1 ? '' : 's'} · ${r.ingredients.length} ingredients · ${r.steps.length} steps`}
          onPress={() => router.push({ pathname: '/meals/[id]', params: { id: r.id } })}
        />
      ))}
    </Screen>
  );
}
