import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Accent, Button, Danger, Notice, TextField } from '@/components/form';
import { ActionButton } from '@/components/meals/action-button';
import { MealIcons } from '@/components/meals/icons';
import { EmptyPanel, SectionCard } from '@/components/meals/layout';
import { Enter, FadeIn, Pop, Skeleton, webTransition } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { formatAmount } from '@/lib/drafts';
import type { ShoppingItem } from '@/lib/types';

const web = Platform.OS === 'web';
/** From this window width the web puts item, quantity and unit on one line. */
const INLINE_FROM = 640;

export default function ShoppingList() {
  const api = useApi();
  const queryClient = useQueryClient();
  const inline = useInlineFields();
  const list = useQuery({ queryKey: ['shopping'], queryFn: api.shopping.list });
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  // The item just ticked off: its row moves to the basket, where its check mark pops once.
  const [justChecked, setJustChecked] = useState<string | null>(null);

  const setItems = (items: ShoppingItem[]) => queryClient.setQueryData(['shopping'], { items });
  const add = useMutation({
    mutationFn: () => {
      const q = quantity.trim() ? Number(quantity.replace(',', '.')) : null;
      if (q !== null && (!Number.isFinite(q) || q < 0)) throw new Error('Quantity must be a number.');
      return api.shopping.add({ name: name.trim(), quantity: q, unit: unit.trim() || null });
    },
    onSuccess: (result) => {
      setItems(result.items);
      setName('');
      setQuantity('');
      setUnit('');
    },
  });
  const clearChecked = useMutation({ mutationFn: api.shopping.clearChecked, onSuccess: (r) => setItems(r.items) });

  const items = list.data?.items ?? [];
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const submit = () => {
    if (name.trim() && !add.isPending) add.mutate();
  };
  const confirmClear = async () => {
    const ok = await confirmAction({
      title: 'Remove checked items?',
      message: `The ${done.length === 1 ? 'item' : `${done.length} items`} in your basket will be removed from the list.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) clearChecked.mutate();
  };

  const nameField = (
    <TextField label="Item" value={name} onChangeText={setName} placeholder="e.g. Oat milk" maxLength={200} onSubmitEditing={submit} />
  );
  const quantityField = (
    <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="Optional" />
  );
  const unitField = <TextField label="Unit" value={unit} onChangeText={setUnit} autoCapitalize="none" placeholder="e.g. l" maxLength={20} />;
  const unitsNote = 'Amounts from recipes are combined only when their units match up (for example grams with kilograms).';

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      {web ? (
        <Enter>
          <ThemedText themeColor="textSecondary">
            Tick items off as you shop. Recipe amounts are combined when their units match, like grams with kilograms.
          </ThemedText>
        </Enter>
      ) : null}
      <Enter index={1}>
        <SectionCard title="Add an item" icon={MealIcons.add}>
          {inline ? (
            <View style={styles.fields}>
              <View style={styles.nameField}>{nameField}</View>
              <View style={styles.quantityField}>{quantityField}</View>
              <View style={styles.unitField}>{unitField}</View>
            </View>
          ) : (
            <>
              {nameField}
              <Row>
                <View style={styles.fill}>{quantityField}</View>
                <View style={styles.fill}>{unitField}</View>
              </Row>
            </>
          )}
          {add.isError ? (
            <Notice tone="error">
              {add.error instanceof Error && add.error.message === 'Quantity must be a number.' ? add.error.message : errorMessage(add.error)}
            </Notice>
          ) : null}
          <View style={web && styles.endActions}>
            <Button title="Add to list" size="small" onPress={() => add.mutate()} loading={add.isPending} disabled={!name.trim()} />
          </View>
        </SectionCard>
      </Enter>

      <StaleBanner visible={list.isError && !!list.data} />
      {list.isPending ? <ListSkeleton /> : null}
      {list.isError && !list.data ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && items.length === 0 ? (
        <FadeIn>
          <EmptyPanel
            icon={MealIcons.cart}
            title="Your list is empty"
            body="Add items above, or open a recipe and choose “Add to shopping list”."
          />
        </FadeIn>
      ) : null}

      {open.length ? (
        <Enter index={2} style={styles.group}>
          <SectionHeader title={`To buy (${open.length})`} />
          <Card style={styles.list}>
            {open.map((item, index) => (
              <ShoppingRow key={item.id} item={item} first={index === 0} onChecked={setJustChecked} />
            ))}
          </Card>
        </Enter>
      ) : null}
      {done.length ? (
        <Enter index={3} style={styles.group}>
          <SectionHeader
            title={`In the basket (${done.length})`}
            action={
              <Button
                title="Clear"
                size="small"
                variant="quiet"
                loading={clearChecked.isPending}
                accessibilityLabel="Remove checked items"
                onPress={confirmClear}
              />
            }
          />
          {clearChecked.isError ? <Notice tone="error">{errorMessage(clearChecked.error)}</Notice> : null}
          <Card style={styles.list}>
            {done.map((item, index) => (
              <ShoppingRow key={item.id} item={item} first={index === 0} pop={item.id === justChecked} onChecked={setJustChecked} />
            ))}
          </Card>
        </Enter>
      ) : null}
      {web ? null : (
        <ThemedText type="small" themeColor="textSecondary">
          {unitsNote}
        </ThemedText>
      )}
    </Screen>
  );
}

function useInlineFields() {
  const { width } = useWindowDimensions();
  return web && width >= INLINE_FROM;
}

/** Placeholder rows, shaped like the list, while it loads. */
function ListSkeleton() {
  const theme = useTheme();
  return (
    <View style={styles.group} accessibilityLabel="Loading your list">
      <Skeleton width={110} height={12} style={styles.skeletonHeader} />
      <Card style={styles.list}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
            <View style={styles.checkArea}>
              <Skeleton width={24} height={24} radius={7} />
              <Skeleton width={`${60 - i * 8}%`} height={14} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

function ShoppingRow({ item, first, pop = false, onChecked }: {
  item: ShoppingItem;
  first: boolean;
  /** Pop the check mark as the row appears (it was just ticked). */
  pop?: boolean;
  onChecked: (id: string) => void;
}) {
  const api = useApi();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const inline = useInlineFields();
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity == null ? '' : String(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? '');

  const replace = (updated: ShoppingItem) =>
    queryClient.setQueryData<{ items: ShoppingItem[] }>(['shopping'], (old) =>
      old ? { items: old.items.map((i) => (i.id === updated.id ? updated : i)) } : old,
    );
  const toggle = useMutation({
    mutationFn: () => api.shopping.update(item.id, { checked: !item.checked }),
    onSuccess: (updated) => {
      if (updated.checked) onChecked(updated.id);
      replace(updated);
    },
  });
  const save = useMutation({
    mutationFn: () => {
      const q = quantity.trim() ? Number(quantity.replace(',', '.')) : null;
      return api.shopping.update(item.id, {
        name: name.trim(),
        ...(q === null ? { clearQuantity: true } : { quantity: q, unit: unit.trim() }),
      });
    },
    onSuccess: (updated) => {
      replace(updated);
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.shopping.remove(item.id),
    onSuccess: () =>
      queryClient.setQueryData<{ items: ShoppingItem[] }>(['shopping'], (old) =>
        old ? { items: old.items.filter((i) => i.id !== item.id) } : old,
      ),
  });

  const divider = !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border };

  if (editing) {
    const nameField = <TextField label="Item" value={name} onChangeText={setName} maxLength={200} />;
    const quantityField = <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />;
    const unitField = <TextField label="Unit" value={unit} onChangeText={setUnit} autoCapitalize="none" maxLength={20} />;
    return (
      <View style={[styles.editRow, divider, { backgroundColor: theme.backgroundSelected }]}>
        {inline ? (
          <View style={styles.fields}>
            <View style={styles.nameField}>{nameField}</View>
            <View style={styles.quantityField}>{quantityField}</View>
            <View style={styles.unitField}>{unitField}</View>
          </View>
        ) : (
          <>
            {nameField}
            <Row>
              <View style={styles.fill}>{quantityField}</View>
              <View style={styles.fill}>{unitField}</View>
            </Row>
          </>
        )}
        {save.isError || remove.isError ? <Notice tone="error">{errorMessage(save.error ?? remove.error)}</Notice> : null}
        <Row>
          <Button title="Save" size="small" onPress={() => save.mutate()} loading={save.isPending} disabled={!name.trim()} />
          <Button title="Cancel" size="small" variant="secondary" onPress={() => setEditing(false)} />
          <View style={styles.fill} />
          <ActionButton
            title="Delete"
            icon={MealIcons.delete}
            tone="danger"
            size="small"
            onPress={() => remove.mutate()}
            loading={remove.isPending}
            accessibilityLabel={`Delete ${item.name}`}
          />
        </Row>
      </View>
    );
  }

  const amount = formatAmount(item.quantity, item.unit);
  return (
    <View style={[styles.row, rowTransition, divider, hovered && { backgroundColor: theme.backgroundSelected }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked, busy: toggle.isPending }}
        accessibilityLabel={`${amount} ${item.name}`.trim()}
        onPress={() => toggle.mutate()}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        hitSlop={8}
        style={styles.checkArea}>
        <Pop
          count={pop && item.checked ? 1 : 0}
          style={[styles.box, { borderColor: item.checked ? Accent : theme.textSecondary, backgroundColor: item.checked ? Accent : 'transparent' }]}>
          {item.checked ? <SymbolView name={MealIcons.check} size={16} tintColor="#ffffff" /> : null}
        </Pop>
        <ThemedText style={[styles.fill, item.checked && styles.checked]}>{item.name}</ThemedText>
        {amount ? (
          <ThemedText type="small" themeColor="textSecondary" style={[styles.amount, item.checked && styles.checked]}>
            {amount}
          </ThemedText>
        ) : null}
      </Pressable>
      {toggle.isError ? (
        <ThemedText type="small" style={styles.error}>
          Not saved
        </ThemedText>
      ) : null}
      <ActionButton
        title="Edit"
        icon={MealIcons.edit}
        iconOnly
        bare
        size="small"
        onPress={() => setEditing(true)}
        accessibilityLabel={`Edit ${item.name}`}
      />
    </View>
  );
}

const rowTransition = webTransition('background-color');

const styles = StyleSheet.create({
  fill: { flex: 1 },
  group: { gap: Spacing.two },
  skeletonHeader: { marginTop: Spacing.two + Spacing.one, marginBottom: Spacing.one },
  fields: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  nameField: { flex: 1, minWidth: 0 },
  quantityField: { width: 120 },
  unitField: { width: 110 },
  endActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  // Rows run edge to edge inside one card, split by hairlines.
  list: { padding: 0, gap: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingLeft: Spacing.three, paddingRight: Spacing.two, minHeight: 56 },
  checkArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  amount: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  checked: { textDecorationLine: 'line-through', opacity: 0.6 },
  error: { color: Danger },
  editRow: { padding: Spacing.three, gap: Spacing.three },
});
