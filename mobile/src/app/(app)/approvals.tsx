import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, errorMessage, Loading, Pill, Row, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { friendlyDate } from '@/lib/dates';
import { assistantName } from '@/lib/assistants';
import { invalidatePlan } from '@/lib/plan-cache';
import type { AssistantProposal } from '@/lib/types';

const KIND_LABEL = {
  plan_changes: 'Plan changes',
  recipe: 'Recipe',
  preference: 'Remember preference',
  preference_update: 'Correct preference',
  preference_delete: 'Forget preference',
} as const;
const STALE_NOTE = {
  plan_changes: 'Not applied: your plan changed after this was proposed.',
  recipe: 'Not applied: this changed after it was proposed.',
  preference: 'Not applied: this changed after it was proposed.',
  preference_update: 'Not applied: this preference was changed or deleted after it was proposed.',
  preference_delete: 'Not applied: this preference was changed or deleted after it was proposed.',
} as const;
const STATUS_LABEL = {
  pending: 'Waiting',
  applied: 'Applied',
  rejected: 'Rejected',
  stale: 'Out of date',
  expired: 'Expired',
} as const;

/** Changes proposed by connected AI assistants. Nothing is applied until approved here (or in the assistant's prompt). */
export default function ApprovalsScreen() {
  const api = useApi();
  const pending = useQuery({ queryKey: ['assistant-proposals', 'pending'], queryFn: api.assistant.pending });
  const recent = useQuery({ queryKey: ['assistant-proposals', 'recent'], queryFn: api.assistant.recent });
  const decided = (recent.data?.proposals ?? []).filter((p) => p.status !== 'pending').slice(0, 10);

  return (
    <Screen aboveTabBar={false} refreshing={pending.isRefetching} onRefresh={() => {
        pending.refetch();
        recent.refetch();
      }}>
      <ThemedText type="small" themeColor="textSecondary">
        Connected assistants (OpenCode, ChatGPT, Claude) can propose changes. They are applied only when you approve the
        exact changes below.
      </ThemedText>
      {pending.isPending ? <Loading label="Loading requests…" /> : null}
      {pending.isError ? <ErrorState error={pending.error} onRetry={() => pending.refetch()} /> : null}
      {pending.data && pending.data.proposals.length === 0 ? (
        <EmptyState title="Nothing waiting" body="When an assistant proposes a change, it appears here for your approval." />
      ) : null}
      {pending.data?.proposals.map((p) => <ProposalCard key={p.id} proposal={p} />)}

      {decided.length ? <SectionHeader title="Recently decided" /> : null}
      {decided.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
    </Screen>
  );
}

function ProposalCard({ proposal }: { proposal: AssistantProposal }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (approve: boolean) => (approve ? api.assistant.approve(proposal.id) : api.assistant.reject(proposal.id)),
    onSuccess: async () => {
      await invalidatePlan(queryClient);
      // Refetch even screens that aren't open, so they never show the pre-approval copy from the offline cache.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recipes'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['preferences'], refetchType: 'all' }),
      ]);
    },
  });
  const steps = Array.isArray(proposal.details?.steps) ? (proposal.details.steps as string[]) : [];
  const ingredients = Array.isArray(proposal.details?.ingredients) ? (proposal.details.ingredients as string[]) : [];
  const pending = proposal.status === 'pending';

  return (
    <Card>
      <Row style={styles.wrap}>
        <Pill label={KIND_LABEL[proposal.kind]} tone="accent" />
        <Pill label={STATUS_LABEL[proposal.status]} tone={proposal.status === 'applied' ? 'success' : 'muted'} />
      </Row>
      <ThemedText type="small" themeColor="textSecondary">
        From {assistantName(proposal.client)} · {friendlyDate(proposal.createdAt.slice(0, 10))}
      </ThemedText>
      {proposal.changes.map((c) => (
        <View key={c.description} style={styles.change}>
          <ThemedText type="smallBold">• {c.description}</ThemedText>
          {c.warnings.map((w) => (
            <Notice key={w} tone="warning">
              {w}
            </Notice>
          ))}
        </View>
      ))}
      {ingredients.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          Ingredients: {ingredients.join(', ')}
        </ThemedText>
      ) : null}
      {steps.length ? (
        <ThemedText type="small" themeColor="textSecondary">
          {steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
        </ThemedText>
      ) : null}
      {proposal.rejected.length ? (
        <Notice tone="info">{`Left out by Rhythm's checks:\n${proposal.rejected.map((r) => `• ${r}`).join('\n')}`}</Notice>
      ) : null}
      {proposal.status === 'stale' ? <Notice tone="info">{STALE_NOTE[proposal.kind]}</Notice> : null}
      {decide.isError ? <Notice tone="error">{errorMessage(decide.error)}</Notice> : null}
      {decide.data && decide.data.status === 'stale' ? (
        <Notice tone="info">{`${STALE_NOTE[proposal.kind]} Ask the assistant again.`}</Notice>
      ) : null}
      {pending ? (
        <Row>
          <View style={styles.fill}>
            <Button
              title="Approve"
              onPress={() => decide.mutate(true)}
              loading={decide.isPending && decide.variables === true}
              disabled={decide.isPending}
              accessibilityHint="Applies exactly these changes"
            />
          </View>
          <Button title="Reject" variant="quiet" onPress={() => decide.mutate(false)} disabled={decide.isPending} />
        </Row>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  change: { gap: Spacing.one },
});
