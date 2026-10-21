import { useAuth } from '@clerk/expo';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { PlanChangeComposer } from '@/components/plan-change';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, EmptyState, errorMessage, Loading, Pill, Row, Screen, SectionHeader, Stepper } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { addDays, weekdayShort } from '@/lib/dates';
import { newKey } from '@/lib/keys';
import { invalidatePlan } from '@/lib/plan-cache';
import { clearPlanDraft, loadPlanDraft, savePlanDraft, type PlanDraft } from '@/lib/plan-draft';
import type { ChangePreview, PlanFact, ProposalItem, TimeSlot } from '@/lib/types';

const SLOT_LABEL = { morning: 'Breakfast', midday: 'Lunch', evening: 'Dinner' } as const;
const SLOT_ORDER = { morning: 0, midday: 1, evening: 2 } as const;

function sortItems(items: ProposalItem[]): ProposalItem[] {
  return [...items].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.timeSlot ? SLOT_ORDER[a.timeSlot] : 3) - (b.timeSlot ? SLOT_ORDER[b.timeSlot] : 3) ||
      a.kind.localeCompare(b.kind),
  );
}

/** What the server needs to save an item: no explanations, just the item as edited. */
function toAccept({ reasons: _reasons, warnings: _warnings, ...item }: ProposalItem) {
  return item;
}

/** Review a drafted week: edit, remove, ask for changes, then accept items one by one or all at once. */
const FACT_SOURCE: Record<PlanFact['source'], string> = {
  profile: ' (profile)',
  preference: ' (remembered)',
  memory: ' (long-term memory)',
  request: '',
  recipe: '',
  routine: '',
};

export default function PlannerReview() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  const [draft, setDraft] = useState<PlanDraft | null | undefined>(undefined);
  const [removed, setRemoved] = useState<ProposalItem | null>(null);
  const latest = useRef<PlanDraft | null>(null);

  useEffect(() => {
    let alive = true;
    if (userId)
      loadPlanDraft(userId).then((d) => {
        if (!alive) return;
        latest.current = d;
        setDraft(d);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  function commit(next: PlanDraft) {
    latest.current = next;
    setDraft(next);
    if (userId) savePlanDraft(userId, next);
  }

  // The same proposal id + item keys are sent on every try, so double taps and retries never duplicate items.
  const accept = useMutation({
    mutationFn: (items: ProposalItem[]) => api.planner.accept(latest.current!.proposal.proposalId, items.map(toAccept)),
    onSuccess: async (_result, items) => {
      const current = latest.current!;
      const accepted = [...new Set([...current.accepted, ...items.map((i) => i.key)])];
      await invalidatePlan(queryClient);
      if (accepted.length >= current.items.length) {
        if (userId) await clearPlanDraft(userId);
        router.navigate({ pathname: '/', params: { view: 'week', week: current.proposal.startDate } });
        return;
      }
      commit({ ...current, accepted });
    },
  });

  if (draft === undefined) return <Screen aboveTabBar={false}><Loading label="Opening your draft…" /></Screen>;
  if (draft === null) {
    return (
      <Screen aboveTabBar={false}>
        <EmptyState
          title="No draft to review"
          body="Start a new weekly plan, or look at your saved plan in the week view."
          action={<Button title="Help plan my week" onPress={() => router.replace('/planner')} />}
        />
      </Screen>
    );
  }

  const { proposal } = draft;
  const dates = Array.from({ length: proposal.days }, (_, i) => addDays(proposal.startDate, i));
  const open = draft.items.filter((i) => !draft.accepted.includes(i.key));
  const usedFacts = proposal.facts.filter((f) => draft.items.some((i) => i.reasons.includes(f.label)));

  function updateItem(key: string, next: ProposalItem | null) {
    const current = latest.current!;
    const items = next ? current.items.map((i) => (i.key === key ? next : i)) : current.items.filter((i) => i.key !== key);
    commit({ ...current, items: sortItems(items) });
  }

  async function applyToDraft(preview: ChangePreview) {
    const current = latest.current!;
    let items = [...current.items];
    for (const change of preview.changes) {
      const after = change.after;
      if (change.op === 'remove') {
        items = items.filter((i) => i.key !== change.targetKey);
      } else if (change.op === 'add' && after) {
        items.push({
          key: `n${newKey(12)}`,
          date: after.date,
          kind: after.kind,
          title: after.title,
          timeSlot: after.timeSlot,
          recipeId: after.recipeId,
          routineId: after.routineId,
          minutes: after.minutes,
          idea: after.note,
          reasons: ['Added at your request'],
          warnings: change.warnings,
        });
      } else if (after) {
        items = items.map((i) =>
          i.key !== change.targetKey
            ? i
            : change.op === 'move'
              ? { ...i, date: after.date, timeSlot: after.timeSlot }
              : {
                  ...i,
                  title: after.title,
                  recipeId: after.recipeId,
                  routineId: after.routineId,
                  minutes: after.minutes,
                  idea: after.note,
                  reasons: ['Changed at your request'],
                  warnings: change.warnings,
                },
        );
      }
    }
    commit({ ...current, items: sortItems(items) });
  }

  return (
    <Screen
      aboveTabBar={false}
      footer={
        <>
          {removed ? (
            <Row>
              <ThemedText type="small" style={styles.fill} numberOfLines={2}>
                Removed “{removed.title}” from the draft.
              </ThemedText>
              <Button
                title="Undo"
                size="small"
                variant="secondary"
                onPress={() => {
                  const current = latest.current!;
                  commit({ ...current, items: sortItems([...current.items, removed]) });
                  setRemoved(null);
                }}
              />
            </Row>
          ) : null}
          {accept.isError ? <Notice tone="error">{errorMessage(accept.error)}</Notice> : null}
          <Button
            title={open.length === draft.items.length ? `Accept all ${open.length} items` : `Accept the remaining ${open.length}`}
            onPress={() => accept.mutate(open)}
            loading={accept.isPending && accept.variables?.length === open.length}
            disabled={accept.isPending || open.length === 0}
          />
        </>
      }>
      <Card>
        <ThemedText type="smallBold">
          {weekdayShort(dates[0])} – {weekdayShort(dates[dates.length - 1])}
        </ThemedText>
        <ThemedText type="small">{proposal.summary}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This is a draft. Nothing is in your plan until you accept it.
        </ThemedText>
      </Card>
      {proposal.notes.map((n) => (
        <Notice key={n} tone="info">
          {n}
        </Notice>
      ))}
      {usedFacts.length ? (
        <Card>
          <ThemedText type="smallBold">Based on</ThemedText>
          {usedFacts.map((f) => (
            <ThemedText key={f.id} type="small" themeColor="textSecondary">
              • {f.label}
              {FACT_SOURCE[f.source]}
            </ThemedText>
          ))}
        </Card>
      ) : null}

      {dates.map((day) => {
        const items = draft.items.filter((i) => i.date === day);
        return (
          <View key={day} style={styles.day}>
            <SectionHeader title={weekdayShort(day)} />
            {items.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing planned.
              </ThemedText>
            ) : (
              items.map((item) => (
                <DraftItemCard
                  key={item.key}
                  item={item}
                  dates={dates}
                  accepted={draft.accepted.includes(item.key)}
                  accepting={accept.isPending && !!accept.variables?.some((i) => i.key === item.key)}
                  onAccept={() => accept.mutate([item])}
                  onChange={(next) => updateItem(item.key, next)}
                  onRemove={() => {
                    updateItem(item.key, null);
                    setRemoved(item);
                  }}
                />
              ))
            )}
          </View>
        );
      })}

      {open.length ? (
        <PlanChangeComposer
          scope="proposal"
          startDate={proposal.startDate}
          days={proposal.days}
          draftItems={open.map(({ key, date, kind, title, timeSlot, recipeId, routineId, minutes, idea }) => ({
            key,
            date,
            kind,
            title,
            timeSlot,
            recipeId,
            routineId,
            minutes,
            idea,
          }))}
          onConfirm={applyToDraft}
          confirmLabel="Apply to draft"
        />
      ) : null}

      <Button
        title="Discard this draft"
        variant="quiet"
        onPress={async () => {
          if (userId) await clearPlanDraft(userId);
          router.back();
        }}
      />
    </Screen>
  );
}

function DraftItemCard({
  item,
  dates,
  accepted,
  accepting,
  onAccept,
  onChange,
  onRemove,
}: {
  item: ProposalItem;
  dates: string[];
  accepted: boolean;
  accepting: boolean;
  onAccept: () => void;
  onChange: (next: ProposalItem) => void;
  onRemove: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const linked = item.recipeId || item.routineId;

  return (
    <Card>
      <ThemedText type="smallBold">{item.title}</ThemedText>
      <Row style={styles.wrap}>
        <Pill label={item.kind === 'meal' ? 'Meal' : 'Activity'} tone="accent" />
        {item.kind === 'meal' && item.timeSlot ? <Pill label={SLOT_LABEL[item.timeSlot]} tone="muted" /> : null}
        {item.minutes ? <Pill label={`${item.minutes} min`} tone="muted" /> : null}
        <Pill label={linked ? (item.kind === 'meal' ? 'Saved recipe' : 'Saved routine') : 'New idea'} tone={linked ? 'neutral' : 'muted'} />
        {accepted ? <Pill label="In your plan" tone="success" /> : null}
      </Row>
      {item.idea ? <ThemedText type="small">{item.idea}</ThemedText> : null}
      {item.reasons.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          Why: {item.reasons.join(' · ')}
        </ThemedText>
      ) : null}
      {item.warnings.map((w) => (
        <Notice key={w} tone="warning">
          {w}
        </Notice>
      ))}

      {editing && !accepted ? (
        <ItemEditor
          item={item}
          dates={dates}
          onDone={(next) => {
            if (next) onChange(next);
            setEditing(false);
          }}
        />
      ) : null}

      {!accepted && !editing ? (
        <Row style={styles.wrap}>
          <Button title="Accept" size="small" onPress={onAccept} loading={accepting} disabled={accepting} accessibilityLabel={`Accept ${item.title}`} />
          <Button title="Edit" size="small" variant="secondary" onPress={() => setEditing(true)} accessibilityLabel={`Edit ${item.title}`} />
          <Button title="Remove" size="small" variant="quiet" onPress={onRemove} accessibilityLabel={`Remove ${item.title} from the draft`} />
          {!linked ? (
            <Button
              title={item.kind === 'meal' ? 'Save as recipe…' : 'Save as routine…'}
              size="small"
              variant="quiet"
              onPress={() =>
                router.push({
                  pathname: item.kind === 'meal' ? '/meals/import' : '/activity/import',
                  params: { text: [item.title, item.idea].filter(Boolean).join('\n'), source: 'coach' },
                })
              }
              accessibilityHint="Opens the usual review screen before anything is saved"
            />
          ) : null}
        </Row>
      ) : null}
    </Card>
  );
}

function ItemEditor({ item, dates, onDone }: { item: ProposalItem; dates: string[]; onDone: (next: ProposalItem | null) => void }) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(item.date);
  const [slot, setSlot] = useState<TimeSlot | null>(item.timeSlot);
  const [minutes, setMinutes] = useState(item.minutes ?? 20);

  function save() {
    const renamed = title.trim() !== item.title;
    onDone({
      ...item,
      title: title.trim(),
      date,
      timeSlot: item.kind === 'meal' ? (slot ?? 'evening') : null,
      minutes: item.kind === 'activity' ? minutes : null,
      // A renamed item is no longer that saved recipe/routine, and earlier checks no longer apply to it.
      recipeId: renamed ? null : item.recipeId,
      routineId: renamed ? null : item.routineId,
      warnings: renamed ? [] : item.warnings,
      reasons: renamed ? ['Edited by you'] : item.reasons,
    });
  }

  return (
    <View style={styles.editor}>
      <TextField label="Name" value={title} onChangeText={setTitle} maxLength={200} />
      <ThemedText type="small">Day</ThemedText>
      <ChipGroup options={dates.map((d) => ({ value: d, label: weekdayShort(d) }))} multiple={false} selected={[date]} onChange={(v) => v[0] && setDate(v[0])} />
      {item.kind === 'meal' ? (
        <ChipGroup
          options={[
            { value: 'morning', label: 'Breakfast' },
            { value: 'midday', label: 'Lunch' },
            { value: 'evening', label: 'Dinner' },
          ]}
          multiple={false}
          selected={slot ? [slot] : []}
          onChange={(v) => v[0] && setSlot(v[0] as TimeSlot)}
        />
      ) : (
        <Stepper label="Minutes" value={minutes} onChange={setMinutes} min={5} max={240} step={5} suffix="min" />
      )}
      <Row>
        <Button title="Save changes" size="small" onPress={save} disabled={!title.trim()} />
        <Button title="Cancel" size="small" variant="quiet" onPress={() => onDone(null)} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  day: { gap: Spacing.two },
  wrap: { flexWrap: 'wrap' },
  editor: { gap: Spacing.two, marginTop: Spacing.one },
});
