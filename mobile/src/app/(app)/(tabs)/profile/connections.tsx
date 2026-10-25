import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, Share } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { AssistantSetup } from '@/components/profile/assistant-setup';
import { ElevenLabsKeyConnection } from '@/components/profile/elevenlabs-key';
import { ClaudeKeyConnection } from '@/components/profile/claude-key';
import { ActionRow, DestructiveButton, FormActions } from '@/components/profile/controls';
import { Enter, SkeletonCard } from '@/components/motion';
import { CodeBox, SectionCard } from '@/components/profile/section';
import { SettingsGroup, SettingsRow } from '@/components/profile/settings-list';
import { ErrorState, errorMessage, Screen } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { confirmAction } from '@/lib/confirm';
import { friendlyDate } from '@/lib/dates';

const KEY_ICON = { ios: 'key', android: 'key', web: 'key' } as const;
// Browsers without the Web Share API would reject Share.share, so the web only offers it where it exists.
const canShare = Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

/** Connect AI assistants (OpenCode, ChatGPT, Claude) to Rhythm over MCP. */
export default function ConnectionsScreen() {
  const api = useApi();
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ['connections'], queryFn: api.connections.info });
  const [label, setLabel] = useState('My assistant');
  const [advanced, setAdvanced] = useState(false);
  const [created, setCreated] = useState<{ token: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => api.connections.createToken(label.trim() || 'AI assistant'),
    onSuccess: (t) => {
      setCreated({ token: t.token, label: t.label });
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.connections.revokeToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  async function confirmRevoke(id: string, name: string) {
    const ok = await confirmAction({
      title: 'Revoke token?',
      message: `Assistants using “${name}” lose access immediately.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (ok) revoke.mutate(id);
  }

  const active = (info.data?.tokens ?? []).filter((t) => !t.revoked);

  return (
    <Screen aboveTabBar={false} refreshing={info.isRefetching} onRefresh={() => info.refetch()}>
      <ClaudeKeyConnection />
      <ElevenLabsKeyConnection />

      {info.isPending ? <SkeletonCard lines={2} /> : null}
      {info.isError ? <ErrorState error={info.error} onRetry={() => info.refetch()} /> : null}
      {info.data ? (
        <Enter index={1}>
          <AssistantSetup url={info.data.mcpUrl} />
        </Enter>
      ) : null}

      <Button title={advanced ? 'Hide connection tokens' : 'Advanced: connection tokens'} variant="quiet" onPress={() => setAdvanced(!advanced)} />
      {advanced && (created ? (
        <Enter>
          <SectionCard title={`Token for “${created.label}” — copy it now`} icon={KEY_ICON}>
            <CodeBox value={created.token} accessibilityLabel="New connection token" />
            <Notice tone="warning">It won&apos;t be shown again. Keep it private: anyone with it can read your data and propose changes.</Notice>
            <ActionRow>
              <Button
                title={copied ? 'Copied' : 'Copy'}
                size="small"
                onPress={async () => {
                  await Clipboard.setStringAsync(created.token);
                  setCopied(true);
                }}
              />
              {canShare ? (
                <Button title="Share" size="small" variant="secondary" onPress={() => Share.share({ message: created.token })} />
              ) : null}
              <Button title="Done" size="small" variant="quiet" onPress={() => setCreated(null)} />
            </ActionRow>
          </SectionCard>
        </Enter>
      ) : (
        <Enter index={2}>
          <SectionCard
            title="Create a connection token"
            description="Tokens expire after 90 days. Revoke one here at any time."
            icon={KEY_ICON}>
            <TextField label="Name this connection" value={label} onChangeText={setLabel} maxLength={80} placeholder="e.g. OpenCode on my laptop" />
            {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
            <FormActions>
              <Button title="Create token" onPress={() => create.mutate()} loading={create.isPending} disabled={create.isPending} />
            </FormActions>
          </SectionCard>
        </Enter>
      ))}

      {active.length ? (
        <SettingsGroup title="Active tokens" index={3}>
          {active.map((t) => (
            <SettingsRow
              key={t.id}
              icon={KEY_ICON}
              title={t.label}
              subtitle={`…${t.hint} · created ${friendlyDate(t.createdAt.slice(0, 10))} · expires ${friendlyDate(t.expiresAt.slice(0, 10))}`}
              trailing={
                <DestructiveButton
                  title="Revoke"
                  accessibilityLabel={`Revoke ${t.label}`}
                  loading={revoke.isPending && revoke.variables === t.id}
                  onPress={() => void confirmRevoke(t.id, t.label)}
                />
              }
            />
          ))}
        </SettingsGroup>
      ) : null}
      {revoke.isError ? <Notice tone="error">{errorMessage(revoke.error)}</Notice> : null}
    </Screen>
  );
}
