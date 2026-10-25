import { Link } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Accent } from '@/components/form';
import { MealIcons } from '@/components/meals/icons';
import { Enter, liftStyle, Skeleton, webTransition } from '@/components/motion';
import { RecipeMeta, RecipeTags } from '@/components/meals/recipe-parts';
import { ThemedText } from '@/components/themed-text';
import { Spacing, WideContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Recipe } from '@/lib/types';

const GAP = Spacing.three;
const MIN_CARD = 280;
// The web shell shows a 240px sidebar from 900px up; pages pad 32px each side.
const SIDEBAR = 240;
const SIDEBAR_FROM = 900;
const PAGE_PADDING = Spacing.five * 2;

function useGridColumns(): number {
  const { width } = useWindowDimensions();
  const content = Math.min(WideContentWidth, width - (width >= SIDEBAR_FROM ? SIDEBAR : 0) - PAGE_PADDING);
  return Platform.OS === 'web' ? Math.max(1, Math.min(3, Math.floor((content + GAP) / (MIN_CARD + GAP)))) : 1;
}

/**
 * Recipes as a responsive grid: up to three columns on the web, one on phones. Each card rises in
 * once, staggered, when it first appears; a refetch keeps the same keys and doesn't replay it.
 */
export function RecipeGrid({ recipes }: { recipes: Recipe[] }) {
  const columns = useGridColumns();
  return (
    <View style={styles.grid}>
      {recipes.map((r, i) => (
        <Enter key={r.id} index={Math.min(i, 6)} delay={100} style={[styles.cell, { width: `${100 / columns}%` }]}>
          <RecipeCard recipe={r} />
        </Enter>
      ))}
    </View>
  );
}

/** Placeholder recipe cards in the grid's shape, two rows of them, while recipes load. */
export function RecipeGridSkeleton() {
  const theme = useTheme();
  const columns = useGridColumns();
  return (
    <View style={styles.grid} accessibilityLabel="Loading recipes">
      {Array.from({ length: columns * 2 }, (_, i) => (
        <View key={i} style={[styles.cell, { width: `${100 / columns}%` }]}>
          <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.top}>
              <Skeleton width={36} height={36} radius={10} />
              <View style={styles.titleBlock}>
                <Skeleton width="70%" height={18} />
                <Skeleton width="95%" height={12} style={styles.skeletonGap} />
                <Skeleton width="60%" height={12} />
              </View>
            </View>
            <View style={styles.bottom}>
              <Skeleton width="55%" height={12} />
              <Skeleton width="40%" height={20} radius={10} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

export function RecipeCard({ recipe }: { recipe: Recipe }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  // One flat style object: Link's asChild Slot drops style functions and rejects style arrays on the web.
  const cardStyle = StyleSheet.flatten([
    styles.card,
    { backgroundColor: theme.backgroundElement, borderColor: hovered ? Accent : theme.border },
    liftStyle(hovered),
    pressed && styles.pressed,
  ]);
  return (
    <Link href={{ pathname: '/meals/[id]', params: { id: recipe.id } }} push asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${recipe.title}, ${recipe.servings} serving${recipe.servings === 1 ? '' : 's'}, ${recipe.ingredients.length} ingredients, ${recipe.steps.length} steps`}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={cardStyle}>
        <View style={styles.top}>
          <View style={[styles.tile, { backgroundColor: theme.backgroundSelected }]}>
            <SymbolView name={MealIcons.recipe} size={18} tintColor={Accent} />
          </View>
          <View style={styles.titleBlock}>
            <ThemedText type="smallBold" style={styles.title} numberOfLines={2}>
              {recipe.title}
            </ThemedText>
            {recipe.description ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                {recipe.description}
              </ThemedText>
            ) : null}
          </View>
        </View>
        <View style={styles.bottom}>
          <RecipeMeta recipe={recipe} />
          <RecipeTags recipe={recipe} max={3} />
        </View>
      </Pressable>
    </Link>
  );
}

/** Search box with a leading icon and a clear button. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  // The whole box shows focus, so the input's own outline is turned off.
  return (
    <View style={[styles.search, searchTransition, { backgroundColor: theme.backgroundElement, borderColor: focused ? Accent : theme.border }]}>
      <SymbolView name={MealIcons.search} size={18} tintColor={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.searchInput, { color: theme.text }]}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={8}
          style={[styles.clear, { backgroundColor: theme.backgroundSelected }]}>
          <SymbolView name={MealIcons.close} size={14} tintColor={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const searchTransition = webTransition('border-color');

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -GAP / 2, marginBottom: -GAP },
  cell: { paddingHorizontal: GAP / 2, paddingBottom: GAP },
  card: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
    gap: Spacing.three,
    ...Platform.select({ web: { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.04)' } }),
  },
  pressed: { opacity: 0.85 },
  skeletonGap: { marginTop: Spacing.one },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, minWidth: 0, gap: Spacing.one },
  title: { fontSize: 16, lineHeight: 22 },
  bottom: { marginTop: 'auto', gap: Spacing.two + Spacing.half },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: Spacing.two + Spacing.one, ...Platform.select({ web: { outlineStyle: 'solid', outlineWidth: 0 } }) },
  clear: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
