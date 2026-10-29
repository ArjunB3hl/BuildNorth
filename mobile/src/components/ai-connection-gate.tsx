import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Button } from '@/components/form';
import { ThemedText as Text } from '@/components/themed-text';
import { Card, ErrorState, Loading, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import type { AIAccess } from '@/lib/types';
import { hasLocalVoice } from '@/lib/local-voice';

/** Mount only after a fresh server check of a personal connection or shared demo provider. */
export function AIConnectionGate({ children, fallback }: { children: (access: AIAccess) => ReactNode; fallback?: ReactNode }) {
  const api = useApi(), router = useRouter();
  const query = useQuery({ queryKey: ['ai-access'], queryFn: api.connections.access, staleTime: 0, refetchOnMount: 'always', refetchInterval: 15_000 });
  if (query.isPending || (query.isFetching && !query.isFetchedAfterMount)) return <Screen><Loading label="Checking AI availability…" /></Screen>;
  if (query.isError && fallback) return <>{fallback}</>;
  if (query.isError) return <Screen><ErrorState error={query.error} onRetry={() => query.refetch()} /></Screen>;
  if (!query.data?.linked && fallback) return <>{fallback}</>;
  if (!query.data?.linked) return <Screen><Card style={{ gap: 16 }}>
    <Text type="title">Connect your coach first.</Text>
    <Text>{hasLocalVoice() ? 'Camera workouts need a connected ElevenLabs agent or Claude API key. The local Claude Code voice option is available under Coach when its local helper is running.' : 'Link Claude with an API key or verify an ElevenLabs agent to unlock Coach and camera workouts.'}</Text>
    <Text type="small" themeColor="textSecondary">ChatGPT and Claude MCP connectors let you use Rhythm from those assistants. They do not supply an API for this app’s built-in chat. Calendar and your saved content remain available.</Text>
    {hasLocalVoice() ? <Button title="Open local voice Coach" variant="secondary" onPress={() => router.push('/coach')} /> : null}
    <Button title="Open AI connections" onPress={() => router.push('/profile/connections')} />
  </Card></Screen>;
  return <>{children(query.data)}</>;
}
