import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Notice, TextField } from '@/components/form';
import { ThemedText as Text } from '@/components/themed-text';
import { errorMessage } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import { entryInstant } from '@/lib/calendar';
import { newKey } from '@/lib/keys';
import type { CalendarEntry, CalendarInput } from '@/lib/types';

export function CalendarEditor({ entry, day, onClose }: { entry?: CalendarEntry; day: string; onClose: () => void }) {
  const theme = useTheme();
  const api = useApi();
  const cache = useQueryClient();
  const [key] = useState(newKey);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [kind, setKind] = useState<'meal' | 'activity'>(entry?.kind ?? 'meal');
  const [date, setDate] = useState(entry?.localDate ?? day);
  const [time, setTime] = useState(
    entry?.localTime ??
      `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
  );
  const [duration, setDuration] = useState(entry?.durationMinutes?.toString() ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [error, setError] = useState('');
  const readonly = entry && !entry.editable;
  const done = () => {
    cache.invalidateQueries({ queryKey: ['calendar'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (body: CalendarInput) =>
      entry ? api.calendar.update(entry.id, body) : api.calendar.create({ ...body, clientKey: key }),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.calendar.remove(entry!.id), onSuccess: done });
  const submit = () => {
    try {
      if (!title.trim()) throw new Error('Give this entry a name.');
      const minutes = duration ? Number(duration) : null;
      if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440))
        throw new Error('Use a duration between 1 and 1440 whole minutes.');
      const occurredAt = entry && date === entry.localDate && time === entry.localTime ? entry.occurredAt : entryInstant(date, time);
      setError('');
      save.mutate({ title: title.trim(), kind, occurredAt, durationMinutes: minutes, notes: notes.trim() || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check your entry.');
    }
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={s.backdrop}>
        <View style={[s.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            <View style={s.row}>
              <Text type="subtitle">
                {readonly ? 'Calendar entry' : entry ? 'Edit your entry' : 'A moment in your day'}
              </Text>
              <Button title="Close" variant="quiet" size="small" onPress={onClose} />
            </View>
            <Text themeColor="textSecondary">
              {entry?.source === 'demo'
                ? 'Demo entry · sample data for this account.'
                : readonly
                ? entry.source === 'watch'
                  ? 'This workout was recorded by Apple Watch.'
                  : 'This entry comes from a completed meal in your plan.'
                : 'Log a completed meal or workout. You can adjust it anytime.'}
            </Text>
            <View style={s.row}>
              {(['meal', 'activity'] as const).map((k) => (
                <Pressable
                  key={k}
                  disabled={!!readonly}
                  accessibilityRole="button"
                  accessibilityState={{ selected: kind === k }}
                  onPress={() => setKind(k)}
                  style={[
                    s.kind,
                    {
                      backgroundColor: kind === k ? '#208AEF25' : theme.background,
                      borderColor: kind === k ? '#208AEF' : theme.border,
                    },
                  ]}
                >
                  <Text>{k === 'meal' ? 'Meal' : 'Movement'}</Text>
                </Pressable>
              ))}
            </View>
            <TextField
              label="What did you have or do?"
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              autoFocus={!readonly}
              accessibilityLabel="Entry title"
              editable={!readonly}
              placeholder="e.g. Chicken wrap, morning run"
            />
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Date · YYYY-MM-DD"
                  accessibilityLabel="Entry date"
                  value={date}
                  onChangeText={setDate}
                  editable={!readonly}
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Time · HH:mm"
                  accessibilityLabel="Entry time"
                  value={time}
                  onChangeText={setTime}
                  editable={!readonly}
                  autoCapitalize="none"
                />
              </View>
            </View>
            {entry?.timeEstimated ? (
              <Text type="small" themeColor="textSecondary">
                No exact time was provided. Set the actual time here if you remember; otherwise it stays marked as approximate.
              </Text>
            ) : null}
            {kind === 'activity' ? (
              <TextField
                label="Minutes (optional)"
                value={duration}
                onChangeText={setDuration}
                keyboardType="number-pad"
                editable={!readonly}
              />
            ) : null}
            <TextField
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={2000}
              editable={!readonly}
            />
            {error || save.isError || remove.isError ? (
              <Notice tone="error">{error || errorMessage(save.error || remove.error)}</Notice>
            ) : null}
            {!readonly ? (
              <View style={s.row}>
                {entry ? (
                  <Button
                    title="Delete entry"
                    variant="quiet"
                    disabled={save.isPending}
                    loading={remove.isPending}
                    onPress={() => remove.mutate()}
                  />
                ) : null}
                <View style={{ flex: 1 }} />
                <Button
                  title="Save to Calendar"
                  loading={save.isPending}
                  disabled={remove.isPending}
                  onPress={submit}
                />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 540, maxHeight: '90%', borderRadius: 24, borderWidth: 1, overflow: 'hidden' },
  content: { padding: 24, gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  kind: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center' },
});
