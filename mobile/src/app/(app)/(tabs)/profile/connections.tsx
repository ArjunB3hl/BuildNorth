import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';

import { Button, Notice, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorState, errorMessage, Loading, Row, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { friendlyDate } from '@/lib/dates';

/** Connect AI assistants (OpenCode, ChatGPT, Claude) to BuildNorth over MCP. */
export default function ConnectionsScreen() {
  const api = useApi();
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ['connections'], queryFn: api.connections.info });
  const [label, setLabel] = useState('OpenCode');
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

  function confirmRevoke(id: string, name: string) {
    Alert.alert('Revoke token?', `Assistants using “${name}” lose access immediately.`, [
      { text: 'Revoke', style: 'destructive', onPress: () => revoke.mutate(id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const active = (info.data?.tokens ?? []).filter((t) => !t.revoked);

  return (
    <Screen aboveTabBar={false} refreshing={info.isRefetching} onRefresh={() => info.refetch()}>
      <ThemedText type="small" themeColor="textSecondary">
        Assistants connect to your BuildNorth data with their own AI models. They can read your profile, recipes, routines
        and plan (and Apple Watch health summaries, only if you turn on health sharing in Profile → Apple Watch), and propose
        changes — which are applied only after you approve them (Today → Waiting for your approval). This doesn&apos;t change
        the Coach tab.
      </ThemedText>

      {info.isPending ? <Loading /> : null}
      {info.isError ? <ErrorState error={info.error} onRetry={() => info.refetch()} /> : null}
      {info.data ? (
        <Card>
          <ThemedText type="smallBold">MCP server address</ThemedText>
          <ThemedText type="small" selectable>
            {info.data.mcpUrl}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ChatGPT and Claude sign in with your BuildNorth account (OAuth) and need a public HTTPS address. Assistants that
            use a fixed key, like OpenCode, use a connection token.
          </ThemedText>
        </Card>
      ) : null}

      <SectionHeader title="Connection tokens" />
      {created ? (
        <Card>
          <ThemedText type="smallBold">Token for “{created.label}” — copy it now</ThemedText>
          <ThemedText type="small" selectable style={styles.token}>
            {created.token}
          </ThemedText>
          <Notice tone="warning">It won&apos;t be shown again. Keep it private: anyone with it can read your data and propose changes.</Notice>
          <Row>
            <Button
              title={copied ? 'Copied' : 'Copy'}
              size="small"
              onPress={async () => {
                await Clipboard.setStringAsync(created.token);
                setCopied(true);
              }}
            />
            <Button title="Share" size="small" variant="secondary" onPress={() => Share.share({ message: created.token })} />
            <Button title="Done" size="small" variant="quiet" onPress={() => setCreated(null)} />
          </Row>
        </Card>
      ) : (
        <Card>
          <TextField label="Name this connection" value={label} onChangeText={setLabel} maxLength={80} placeholder="e.g. OpenCode on my laptop" />
          {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
          <Button title="Create token" onPress={() => create.mutate()} loading={create.isPending} disabled={create.isPending} />
          <ThemedText type="small" themeColor="textSecondary">
            Tokens expire after 90 days. Revoke one here at any time.
          </ThemedText>
        </Card>
      )}

      {active.map((t) => (
        <Card key={t.id}>
          <Row>
            <View style={styles.fill}>
              <ThemedText type="smallBold">{t.label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                …{t.hint} · created {friendlyDate(t.createdAt.slice(0, 10))} · expires {friendlyDate(t.expiresAt.slice(0, 10))}
              </ThemedText>
            </View>
            <Button title="Revoke" size="small" variant="quiet" onPress={() => confirmRevoke(t.id, t.label)} />
          </Row>
        </Card>
      ))}
      {revoke.isError ? <Notice tone="error">{errorMessage(revoke.error)}</Notice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  token: { fontFamily: 'Menlo', fontSize: 13, paddingVertical: Spacing.one },
});
