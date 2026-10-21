import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { useApi } from '@/hooks/use-api';

/** Shown on Today when a connected assistant has proposed changes that need the user's approval. */
export function PendingApprovalsBanner() {
  const api = useApi();
  const router = useRouter();
  const pending = useQuery({ queryKey: ['assistant-proposals', 'pending'], queryFn: api.assistant.pending, staleTime: 10_000 });
  const count = pending.data?.proposals.length ?? 0;
  if (!count) return null;
  return (
    <Card>
      <ThemedText type="smallBold">
        {count === 1 ? '1 change' : `${count} changes`} from your assistants waiting for approval
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {pending.data?.proposals[0]?.summary}
        {count > 1 ? ` and ${count - 1} more` : ''}
      </ThemedText>
      <Button title="Review" size="small" onPress={() => router.push('/approvals')} accessibilityLabel="Review assistant changes" />
    </Card>
  );
}
