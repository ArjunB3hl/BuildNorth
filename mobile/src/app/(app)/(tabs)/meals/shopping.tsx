import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Accent, Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, errorMessage, Loading, Row, Screen, SectionHeader, StaleBanner } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { formatAmount } from '@/lib/drafts';
import type { ShoppingItem } from '@/lib/types';

export default function ShoppingList() {
  const api = useApi();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['shopping'], queryFn: api.shopping.list });
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');

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

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      <Card>
        <ThemedText type="smallBold">Add an item</ThemedText>
        <TextField label="Item" value={name} onChangeText={setName} placeholder="e.g. Oat milk" maxLength={200} />
        <Row>
          <View style={styles.fill}>
            <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="Optional" />
          </View>
          <View style={styles.fill}>
            <TextField label="Unit" value={unit} onChangeText={setUnit} autoCapitalize="none" placeholder="e.g. l" maxLength={20} />
          </View>
        </Row>
        {add.isError ? <Notice tone="error">{add.error instanceof Error && add.error.message === 'Quantity must be a number.' ? add.error.message : errorMessage(add.error)}</Notice> : null}
        <Button title="Add to list" size="small" onPress={() => add.mutate()} loading={add.isPending} disabled={!name.trim()} />
      </Card>

      <StaleBanner visible={list.isError && !!list.data} />
      {list.isPending ? <Loading label="Loading your list…" /> : null}
      {list.isError && !list.data ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState title="Your list is empty" body="Add items above, or open a recipe and choose “Add to shopping list”." />
      ) : null}

      {open.length ? <SectionHeader title={`To buy (${open.length})`} /> : null}
      {open.map((item) => (
        <ShoppingRow key={item.id} item={item} />
      ))}
      {done.length ? (
        <SectionHeader
          title={`In the basket (${done.length})`}
          action={
            <Button
              title="Clear"
              size="small"
              variant="quiet"
              loading={clearChecked.isPending}
              accessibilityLabel="Remove checked items"
              onPress={() =>
                Alert.alert('Remove checked items?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => clearChecked.mutate() },
                ])
              }
            />
          }
        />
      ) : null}
      {done.map((item) => (
        <ShoppingRow key={item.id} item={item} />
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        Amounts from recipes are combined only when their units match up (for example grams with kilograms).
      </ThemedText>
    </Screen>
  );
}

function ShoppingRow({ item }: { item: ShoppingItem }) {
  const api = useApi();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity == null ? '' : String(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? '');

  const replace = (updated: ShoppingItem) =>
    queryClient.setQueryData<{ items: ShoppingItem[] }>(['shopping'], (old) =>
      old ? { items: old.items.map((i) => (i.id === updated.id ? updated : i)) } : old,
    );
  const toggle = useMutation({ mutationFn: () => api.shopping.update(item.id, { checked: !item.checked }), onSuccess: replace });
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

  if (editing) {
    return (
      <Card>
        <TextField label="Item" value={name} onChangeText={setName} maxLength={200} />
        <Row>
          <View style={styles.fill}>
            <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
          </View>
          <View style={styles.fill}>
            <TextField label="Unit" value={unit} onChangeText={setUnit} autoCapitalize="none" maxLength={20} />
          </View>
        </Row>
        {save.isError || remove.isError ? <Notice tone="error">{errorMessage(save.error ?? remove.error)}</Notice> : null}
        <Row>
          <Button title="Save" size="small" onPress={() => save.mutate()} loading={save.isPending} disabled={!name.trim()} />
          <Button title="Cancel" size="small" variant="secondary" onPress={() => setEditing(false)} />
          <View style={styles.fill} />
          <Button title="Delete" size="small" variant="quiet" onPress={() => remove.mutate()} loading={remove.isPending} />
        </Row>
      </Card>
    );
  }

  const amount = formatAmount(item.quantity, item.unit);
  return (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked, busy: toggle.isPending }}
        accessibilityLabel={`${amount} ${item.name}`.trim()}
        onPress={() => toggle.mutate()}
        hitSlop={8}
        style={styles.checkArea}>
        <View style={[styles.box, { borderColor: item.checked ? Accent : theme.textSecondary, backgroundColor: item.checked ? Accent : 'transparent' }]}>
          {item.checked ? <ThemedText style={styles.tick}>✓</ThemedText> : null}
        </View>
        <View style={styles.fill}>
          <ThemedText style={item.checked && styles.checked}>{item.name}</ThemedText>
          {amount ? (
            <ThemedText type="small" themeColor="textSecondary">
              {amount}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      <Button title="Edit" size="small" variant="quiet" onPress={() => setEditing(true)} accessibilityLabel={`Edit ${item.name}`} />
      {toggle.isError ? <ThemedText type="small" style={styles.error}>Not saved</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: Spacing.three, minHeight: 56 },
  checkArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { color: '#ffffff', fontSize: 16, lineHeight: 20 },
  checked: { textDecorationLine: 'line-through', opacity: 0.6 },
  error: { color: '#D93025' },
});
