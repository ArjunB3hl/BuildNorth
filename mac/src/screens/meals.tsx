import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  available as northMacAvailable,
  setKeepAwake,
} from '../../modules/north-mac';
import {
  Button,
  Card,
  EmptyState,
  ListItem,
  Notice,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stepper,
  TextField,
  ThemedText,
  useHover,
} from '../components/ui';
import { formatQuantity, useStore } from '../data/store';
import type { ShoppingItem } from '../data/types';
import { localDate } from '../lib/dates';
import { useNav } from '../navigation';
import { Accent, Spacing, useTheme } from '../theme';

export function MealsScreen() {
  const { state } = useStore();
  const nav = useNav();
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const toBuy = state.shopping.filter(i => !i.checked).length;
  const recipes = state.recipes.filter(
    r =>
      !query ||
      r.title.toLowerCase().includes(query) ||
      r.ingredients.some(i => i.name.toLowerCase().includes(query)),
  );

  return (
    <Screen
      title="Meals"
      actions={
        <Button
          title={toBuy ? `Shopping list (${toBuy})` : 'Shopping list'}
          variant="secondary"
          onPress={() => nav.push({ name: 'shopping' })}
        />
      }
    >
      <TextField
        label="Search recipes"
        value={search}
        onChangeText={setSearch}
        placeholder="Title or ingredient"
        autoCapitalize="none"
      />
      <SectionHeader
        title={query ? `Results for “${search.trim()}”` : 'Your recipes'}
      />
      {recipes.length === 0 ? (
        query ? (
          <EmptyState
            title="No matching recipes"
            body="Try another word, or clear the search."
          />
        ) : (
          <EmptyState
            title="No recipes yet"
            body="Recipes you save on iPhone or from the coach show up here."
          />
        )
      ) : null}
      {recipes.map(r => (
        <ListItem
          key={r.id}
          title={r.title}
          subtitle={`${r.servings} serving${r.servings === 1 ? '' : 's'} · ${
            r.ingredients.length
          } ingredients · ${r.steps.length} steps`}
          onPress={() => nav.push({ name: 'recipe', id: r.id })}
        />
      ))}
    </Screen>
  );
}

export function RecipeScreen({ id }: { id: string }) {
  const { state, dispatch } = useStore();
  const recipe = state.recipes.find(r => r.id === id);
  const [servings, setServings] = useState(recipe?.servings ?? 1);
  const [added, setAdded] = useState<string | null>(null);
  const [cooking, setCooking] = useState(false);

  // Cook mode keeps the display on until it's turned off or the page closes.
  useEffect(() => {
    if (!cooking) {
      return;
    }
    setKeepAwake(true, 'Rhythm cook mode');
    return () => setKeepAwake(false);
  }, [cooking]);

  if (!recipe) {
    return (
      <Screen title="Recipe">
        <EmptyState title="This recipe was deleted" />
      </Screen>
    );
  }

  const scale = servings / recipe.servings;
  const scaled = recipe.ingredients.map(i => ({
    ...i,
    quantity: i.quantity == null ? null : i.quantity * scale,
  }));
  const plannedToday = state.plan.some(
    i => i.recipeId === recipe.id && i.date === localDate(),
  );

  return (
    <Screen
      title={recipe.title}
      subtitle={recipe.description ?? undefined}
      actions={
        northMacAvailable ? (
          <Button
            title={cooking ? 'Stop cook mode' : 'Cook mode'}
            variant={cooking ? 'primary' : 'secondary'}
            onPress={() => setCooking(c => !c)}
          />
        ) : null
      }
    >
      {cooking ? (
        <Notice tone="info">
          Cook mode is on: your Mac’s display stays awake while this recipe is
          open.
        </Notice>
      ) : null}
      {recipe.tags.length ? (
        <Row style={styles.wrap}>
          {recipe.tags.map(t => (
            <Pill key={t} label={t} tone="accent" />
          ))}
        </Row>
      ) : null}

      <Card>
        <Stepper
          label="Servings"
          value={servings}
          onChange={setServings}
          min={1}
          max={24}
        />
      </Card>

      <SectionHeader title="Ingredients" />
      <Card>
        {scaled.map((ing, i) => (
          <Row key={i} style={styles.ingredient}>
            <ThemedText type="smallBold" style={styles.quantity}>
              {formatQuantity(ing.quantity, ing.unit)}
            </ThemedText>
            <ThemedText type="small" style={styles.fill}>
              {ing.name}
            </ThemedText>
          </Row>
        ))}
      </Card>

      <SectionHeader title="Steps" />
      {recipe.steps.map((step, i) => (
        <Card key={i}>
          <Row style={styles.top}>
            <ThemedText type="smallBold" style={styles.stepNumber}>
              {i + 1}
            </ThemedText>
            <ThemedText type="small" style={styles.fill}>
              {step.text}
            </ThemedText>
            {step.timerSeconds ? (
              <Pill
                label={`${Math.round(step.timerSeconds / 60)} min`}
                tone="muted"
              />
            ) : null}
          </Row>
        </Card>
      ))}

      {added ? <Notice tone="success">{added}</Notice> : null}
      <Row style={styles.wrap}>
        <Button
          title="Add to shopping list"
          onPress={() => {
            dispatch({
              type: 'shopping/add',
              recipeId: recipe.id,
              ingredients: scaled,
            });
            setAdded(
              `Added ${scaled.length} ingredients for ${servings} serving${
                servings === 1 ? '' : 's'
              } to your shopping list.`,
            );
          }}
        />
        <Button
          title={plannedToday ? 'Planned for today' : 'Plan for tonight'}
          variant="secondary"
          disabled={plannedToday}
          onPress={() =>
            dispatch({
              type: 'plan/add',
              item: {
                date: localDate(),
                kind: 'meal',
                title: recipe.title,
                timeSlot: 'evening',
                recipeId: recipe.id,
                routineId: null,
                minutes: null,
                note: null,
              },
            })
          }
        />
      </Row>
    </Screen>
  );
}

export function ShoppingScreen() {
  const { state, dispatch } = useStore();
  const toBuy = state.shopping.filter(i => !i.checked);
  const checked = state.shopping.filter(i => i.checked);

  return (
    <Screen
      title="Shopping list"
      subtitle={
        toBuy.length
          ? `${toBuy.length} item${toBuy.length === 1 ? '' : 's'} to buy`
          : undefined
      }
      actions={
        checked.length ? (
          <Button
            title="Clear checked"
            variant="secondary"
            onPress={() => dispatch({ type: 'shopping/clearChecked' })}
          />
        ) : null
      }
    >
      {state.shopping.length === 0 ? (
        <EmptyState
          title="Your list is empty"
          body="Open a recipe and choose “Add to shopping list”."
        />
      ) : null}
      {toBuy.length ? <SectionHeader title="To buy" /> : null}
      {toBuy.length ? (
        <Card style={styles.list}>
          {toBuy.map(item => (
            <ShoppingRow key={item.id} item={item} />
          ))}
        </Card>
      ) : null}
      {checked.length ? <SectionHeader title="Checked" /> : null}
      {checked.length ? (
        <Card style={styles.list}>
          {checked.map(item => (
            <ShoppingRow key={item.id} item={item} />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function ShoppingRow({ item }: { item: ShoppingItem }) {
  const { state, dispatch } = useStore();
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const recipe = state.recipes.find(r => r.id === item.recipeId);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.checked }}
      accessibilityLabel={item.name}
      onPress={() => dispatch({ type: 'shopping/toggle', id: item.id })}
      {...hoverProps}
      style={[
        styles.shoppingRow,
        hovered && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <View
        style={[
          styles.checkbox,
          item.checked
            ? { backgroundColor: Accent, borderColor: Accent }
            : { borderColor: theme.textSecondary },
        ]}
      >
        {item.checked ? (
          <ThemedText type="smallBold" style={styles.checkmark}>
            ✓
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.fill}>
        <ThemedText type="small" style={item.checked && styles.struck}>
          {item.name}
        </ThemedText>
        {recipe ? (
          <ThemedText type="small" themeColor="textSecondary">
            For {recipe.title}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatQuantity(item.quantity, item.unit)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  top: { alignItems: 'flex-start' },
  ingredient: { paddingVertical: 2 },
  quantity: { width: 90 },
  stepNumber: { width: 20, color: Accent },
  list: { padding: Spacing.one, gap: 0 },
  shoppingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: 10,
    cursor: 'pointer',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#ffffff', fontSize: 11, lineHeight: 14 },
  struck: { opacity: 0.6, textDecorationLine: 'line-through' },
});
