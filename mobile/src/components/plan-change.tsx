import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, errorMessage, Row } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';
import { localDate } from '@/lib/dates';
import type { ChangePreview, ChangeRequest, PlanChange } from '@/lib/types';

type Props = {
  scope: 'plan' | 'proposal';
  startDate: string;
  days: number;
  draftItems?: ChangeRequest['draftItems'];
  /** The item the user pointed at ("replace this meal"). */
  focus?: { key: string; title: string } | null;
  onClearFocus?: () => void;
  /** Applies the confirmed changes (saved plan: server; draft: locally). */
  onConfirm: (preview: ChangePreview) => Promise<void>;
  confirmLabel: string;
};

const EXAMPLES = "e.g. “I only have 15 minutes tomorrow”, “Move Thursday's workout to Saturday”, “Vegetarian tonight”";

/**
 * Ask for a change in plain words, see exactly what would change, then confirm.
 * Nothing is changed before confirmation, and nothing is remembered unless the user says so.
 */
export function PlanChangeComposer({ scope, startDate, days, draftItems, focus, onClearFocus, onConfirm, confirmLabel }: Props) {
  const api = useApi();
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [applied, setApplied] = useState<ChangePreview | null>(null);
  const abort = useRef<AbortController | null>(null);

  const ask = useMutation({
    mutationFn: () => {
      abort.current = new AbortController();
      return api.planner.previewChanges(
        { message: message.trim(), today: localDate(), startDate, days, scope, draftItems, focusKey: focus?.key ?? null },
        abort.current.signal,
      );
    },
    onMutate: () => {
      setPreview(null);
      setApplied(null);
    },
    onSuccess: setPreview,
  });

  const confirm = useMutation({
    mutationFn: (p: ChangePreview) => onConfirm(p),
    onSuccess: (_, p) => {
      setApplied(p);
      setPreview(null);
      setMessage('');
      onClearFocus?.();
    },
  });

  const cancelled = ask.error instanceof ApiError && ask.error.kind === 'cancelled';

  return (
    <Card>
      <ThemedText type="smallBold">{scope === 'plan' ? 'Change your plan' : 'Ask for changes to this draft'}</ThemedText>
      {focus ? (
        <Row>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fill}>
            About: “{focus.title}”
          </ThemedText>
          <Button title="Clear" size="small" variant="quiet" onPress={() => onClearFocus?.()} accessibilityLabel="Stop pointing at this item" />
        </Row>
      ) : null}
      <TextField
        label="What should change?"
        value={message}
        onChangeText={(text) => {
          setMessage(text);
          setApplied(null); // a new request: the previous "updated" note no longer applies
        }}
        placeholder={focus ? 'e.g. Replace this with a vegetarian option' : EXAMPLES}
        maxLength={500}
        multiline
      />
      {ask.isPending ? (
        <Row>
          <View style={styles.fill}>
            <Button title="Working out the changes…" loading disabled onPress={() => undefined} />
          </View>
          <Button title="Cancel" variant="quiet" onPress={() => abort.current?.abort()} />
        </Row>
      ) : (
        <Button title="Show me the changes" variant="secondary" onPress={() => ask.mutate()} disabled={message.trim().length < 2} />
      )}
      {ask.isError && !cancelled ? <Notice tone="error">{errorMessage(ask.error)}</Notice> : null}

      {preview ? (
        <PreviewCard
          preview={preview}
          confirmLabel={confirmLabel}
          confirming={confirm.isPending}
          error={confirm.isError ? errorMessage(confirm.error) : null}
          onConfirm={() => confirm.mutate(preview)}
          onDiscard={() => setPreview(null)}
        />
      ) : null}

      {applied ? <AppliedNote preview={applied} scope={scope} onDone={() => setApplied(null)} /> : null}
    </Card>
  );
}

function PreviewCard({
  preview,
  confirmLabel,
  confirming,
  error,
  onConfirm,
  onDiscard,
}: {
  preview: ChangePreview;
  confirmLabel: string;
  confirming: boolean;
  error: string | null;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <View style={styles.preview} accessibilityLabel="Proposed changes">
      <ThemedText type="small">{preview.summary}</ThemedText>
      {preview.changes.map((change, i) => (
        <ChangeRow key={`${change.targetKey ?? 'new'}-${i}`} change={change} />
      ))}
      {preview.rejected.length ? (
        <Notice tone="info">{`Left as it is:\n${preview.rejected.map((r) => `• ${r}`).join('\n')}`}</Notice>
      ) : null}
      {preview.changes.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          {preview.temporary
            ? 'Just for this plan — this request won’t be remembered.'
            : 'Only these items change. Everything else, including completed items, stays as it is.'}
        </ThemedText>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {/* Nothing to change in the plan, but the user stated something lasting: offer to remember it. */}
      {preview.changes.length === 0 && preview.preferenceSuggestion ? (
        <RememberOffer suggestion={preview.preferenceSuggestion} onDone={onDiscard} />
      ) : null}
      <Row>
        {preview.changes.length ? (
          <View style={styles.fill}>
            <Button title={confirmLabel} onPress={onConfirm} loading={confirming} disabled={confirming} />
          </View>
        ) : null}
        <Button title={preview.changes.length ? 'Discard' : 'OK'} variant="quiet" onPress={onDiscard} disabled={confirming} />
      </Row>
    </View>
  );
}

function ChangeRow({ change }: { change: PlanChange }) {
  const detail = change.after?.note && change.op !== 'move' ? change.after.note : null;
  return (
    <View style={styles.change}>
      <ThemedText type="smallBold">• {change.description}</ThemedText>
      {detail ? (
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      ) : null}
      {change.warnings.map((w) => (
        <Notice key={w} tone="warning">
          {w}
        </Notice>
      ))}
    </View>
  );
}

/** After applying: a lasting preference can be remembered, but only if the user confirms. */
function AppliedNote({ preview, scope, onDone }: { preview: ChangePreview; scope: 'plan' | 'proposal'; onDone: () => void }) {
  return (
    <View style={styles.preview}>
      <Notice tone="success">{scope === 'plan' ? 'Your plan was updated.' : 'The draft was updated. Nothing is saved until you accept it.'}</Notice>
      {preview.preferenceSuggestion ? <RememberOffer suggestion={preview.preferenceSuggestion} onDone={onDone} /> : null}
    </View>
  );
}

/** Saving a preference to memory happens only here, after an explicit tap. */
function RememberOffer({ suggestion, onDone }: { suggestion: string; onDone: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const remember = useMutation({
    mutationFn: (text: string) => api.preferences.add(text, 'planner'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['preferences'] }),
  });
  if (remember.isSuccess) {
    return <Notice tone="success">Saved to your preferences. You can change or remove it in Profile → What BuildNorth remembers.</Notice>;
  }
  return (
    <View style={styles.preview}>
      <ThemedText type="small">Remember this for future plans?</ThemedText>
      <ThemedText type="smallBold">“{suggestion}”</ThemedText>
      {remember.isError ? <Notice tone="error">{errorMessage(remember.error)}</Notice> : null}
      <Row>
        <Button title="Remember" size="small" onPress={() => remember.mutate(suggestion)} loading={remember.isPending} disabled={remember.isPending} />
        <Button title="Not now" size="small" variant="quiet" onPress={onDone} disabled={remember.isPending} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  preview: { gap: Spacing.two, marginTop: Spacing.one },
  change: { gap: Spacing.one },
});
