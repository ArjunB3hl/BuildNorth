import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Accent, Button, Notice, TextField } from '@/components/form';
import { AssistantConnections } from '@/components/profile/assistants';
import { ActionRow, DestructiveButton, FormActions, SegmentedControl } from '@/components/profile/controls';
import { Enter, FadeIn, Skeleton, SkeletonCard } from '@/components/motion';
import { Grid, PageIntro, useColumns, useContentWidth } from '@/components/profile/layout';
import { BulletList, CodeBox, DetailRow, Divider, IconTile, SectionCard } from '@/components/profile/section';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, EmptyState, ErrorState, Pill, Row, Screen, SectionHeader } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useTheme } from '@/hooks/use-theme';
import {
  AGENT_CAPABILITIES,
  RECOMMENDATIONS_ENABLED,
  type AgentConnection,
  type Assistant,
  type BrowserSession,
  type Capability,
  type MemorySuggestion,
  type Recommendation,
  type RhythmResult,
  type VideoTask,
} from '@/lib/rhythm';

const LABELS: Record<Capability, string> = {
  interests: 'Your interests', saved: 'Saved videos', page: 'Selected page', search: 'Video search', transcripts: 'Transcript reading',
  recommend: 'Recommendations', memory: 'Memory context', feedback: 'Feedback suggestions',
};

// While recommendations are off there are no videos or tasks to show: only agents and memory.
const SECTIONS = (RECOMMENDATIONS_ENABLED ? ['Videos', 'Connections', 'Memory', 'Tasks'] : ['Connections', 'Memory'])
  .map((value) => ({ value, label: value }));
const FILTERS = [{ value: 'all', label: 'All recommendations' }, { value: 'saved', label: 'Saved videos' }];

type PillTone = 'neutral' | 'success' | 'muted' | 'accent';

/** "not_for_me" → "Not for me". */
function humanize(value: string): string {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusTone(status: string): PillTone {
  if (status === 'active' || status === 'done' || status === 'completed') return 'success';
  if (status === 'pending') return 'accent';
  return 'muted';
}

export default function RhythmVideos() {
  const api = useApi();
  const router = useRouter();
  const [section, setSection] = useState(SECTIONS[0].value);
  const [savedOnly, setSavedOnly] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('My chosen agent');
  const [capabilities, setCapabilities] = useState<Capability[]>(
    RECOMMENDATIONS_ENABLED ? ['interests', 'page', 'search', 'transcripts', 'recommend', 'feedback'] : ['interests', 'saved']);
  const [token, setToken] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [deleteData, setDeleteData] = useState(false);
  const videoColumns = useColumns(420);
  const cardColumns = useColumns(360);
  const roomy = useContentWidth() >= 600;
  const query = useQuery({
    queryKey: ['rhythm', 'dashboard'],
    queryFn: async () => {
      if (!RECOMMENDATIONS_ENABLED) {
        const [connections, memories] = await Promise.all([api.rhythm.connections(), api.rhythm.memories()]);
        return { connections, memories, recommendations: undefined, tasks: undefined, metrics: undefined };
      }
      const [recommendations, connections, memories, tasks, metrics] = await Promise.all([
        api.rhythm.recommendations(), api.rhythm.connections(), api.rhythm.memories(), api.rhythm.tasks(),
        api.rhythm.metrics(),
      ]);
      return { recommendations, connections, memories, tasks, metrics };
    },
    refetchInterval: 10_000,
  });

  async function act(action: () => Promise<RhythmResult>) {
    setBusy(true);
    try {
      const result = await action();
      setMessage(result.message || (result.status === 'ok' ? 'Saved.' : result.status.replaceAll('_', ' ')));
      await query.refetch();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  async function createToken() {
    setBusy(true);
    try {
      const created = await api.rhythm.createAgentToken(label.trim() || 'My chosen agent', capabilities);
      setToken(created.token);
      await query.refetch();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'The connection could not be created.'); }
    finally { setBusy(false); }
  }

  async function approveAssistant(assistant: Assistant, chosen: Capability[]): Promise<boolean> {
    setBusy(true);
    try {
      const result = await api.rhythm.approveAssistant(assistant, chosen);
      setMessage(result.message || (result.status === 'ok' ? 'Approved.' : result.status.replaceAll('_', ' ')));
      await query.refetch();
      return result.status === 'ok';
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That couldn’t be approved. Try again.');
      return false;
    } finally { setBusy(false); }
  }

  const data = query.data;
  const videos = (data?.recommendations?.recommendations ?? []).filter((r) => !savedOnly || r.feedback === 'saved');
  const allAgents = data?.connections.agents ?? [];
  // Claude, ChatGPT and Codex approvals live in their own card.
  const agents = allAgents.filter((agent) => !agent.clientId.startsWith('assistant:'));
  const browsers = data?.connections.browsers ?? [];
  const memories = data?.memories.memories ?? [];
  const tasks = data?.tasks?.tasks ?? [];
  const selectedPermissions = capabilities.map((c) => LABELS[c]).join(', ');

  const assistantCard = (
    <AssistantConnections mcpUrl={data?.connections.mcpUrl ?? undefined} agents={allAgents} options={AGENT_CAPABILITIES}
      labels={LABELS} busy={busy} onApprove={approveAssistant} onMessage={setMessage}
      onDisconnect={(id) => void act(() => api.rhythm.revokeAgent(id))} />
  );

  const connectCard = (
    <SectionCard
      title="Other agents"
      icon={{ ios: 'cpu', android: 'smart_toy', web: 'smart_toy' }}>
      <Field label="Agent connection address">
        <CodeBox value={data?.connections.mcpUrl || 'Loading…'} />
        <Muted>
          For other MCP clients. OAuth clients sign in with this account, call connect_rhythm, then appear under Agents
          for approval. For a client that uses a private connection token, choose its permissions here and copy the token once.
        </Muted>
      </Field>
      <Divider />
      <TextField label="Connection name" value={label} onChangeText={setLabel} maxLength={80} />
      <Field label="Permissions" hint="Used for a new token and when you allow a waiting agent.">
        <ChipGroup options={AGENT_CAPABILITIES.map((value) => ({ value, label: LABELS[value] }))} selected={capabilities}
          onChange={(v) => setCapabilities(v as Capability[])} />
      </Field>
      <FormActions>
        <Button title="Create Rhythm connection token" onPress={createToken} disabled={!capabilities.length} loading={busy} />
      </FormActions>
      {token ? (
        <TokenReveal
          token={token}
          onCopy={async () => { await Clipboard.setStringAsync(token); setMessage('Token copied.'); }}
          onHide={() => setToken(undefined)}
        />
      ) : null}
    </SectionCard>
  );

  const connectionLists = (
    <View style={styles.stack}>
      <View style={styles.group}>
        <SectionHeader title="Agents" />
        {data && !agents.length ? <Muted>No agents connected yet.</Muted> : null}
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} busy={busy} canAllow={!!capabilities.length} permissions={selectedPermissions}
            onAllow={() => void act(() => api.rhythm.approveAgent(agent.id, capabilities))}
            onRevoke={() => void act(() => api.rhythm.revokeAgent(agent.id))} />
        ))}
      </View>
      {RECOMMENDATIONS_ENABLED ? <View style={styles.group}>
        <SectionHeader title="Browsers" />
        {data && !browsers.length ? <Muted>No permitted pages yet.</Muted> : null}
        {browsers.map((browser) => (
          <BrowserCard key={browser.id} browser={browser} busy={busy}
            onRevoke={() => void act(() => api.rhythm.pauseBrowser(browser.id))} />
        ))}
      </View> : null}
    </View>
  );

  return (
    <Screen wide refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <Enter>
        <PageIntro
          body={RECOMMENDATIONS_ENABLED ? 'Videos chosen to suit your interests.' : 'Agents that can read your interests, and what Rhythm remembers.'}
          action={<Button title="Personalisation" variant="secondary" onPress={() => router.push('/profile/interests')} />}
        />
      </Enter>
      <Enter index={1}>
        <SegmentedControl accessibilityLabel="Content library sections" options={SECTIONS} value={section} onChange={setSection} />
      </Enter>
      {query.isPending ? (
        <View accessibilityLabel="Loading the content library">
          {section === 'Videos' ? (
            <Grid columns={videoColumns}>
              {[0, 1, 2, 3].slice(0, Math.max(2, videoColumns * 2)).map((i) => <VideoCardSkeleton key={i} />)}
            </Grid>
          ) : (
            <Grid columns={cardColumns}>
              {[0, 1].map((i) => <SkeletonCard key={i} lines={3} style={styles.gridCard} />)}
            </Grid>
          )}
        </View>
      ) : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {message ? <FadeIn><Notice tone="info">{message}</Notice></FadeIn> : null}

      {section === 'Videos' && <>
        <Enter index={2}>
          <Row style={styles.toolbar}>
            {roomy ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.fill}>
                {data ? `${videos.length} ${savedOnly ? 'saved ' : ''}video${videos.length === 1 ? '' : 's'}` : ''}
              </ThemedText>
            ) : null}
            <View style={roomy ? undefined : styles.fill}>
              <SegmentedControl accessibilityLabel="Show" options={FILTERS}
                value={savedOnly ? 'saved' : 'all'} onChange={(v) => setSavedOnly(v === 'saved')} />
            </View>
          </Row>
        </Enter>
        {data && videos.length === 0 ? (
          <FadeIn index={3}>
            <EmptyState title={savedOnly ? 'No saved videos yet' : 'Your next useful video starts with your interests'}
              body="Open Rhythm in Chrome, permit a video, and start a task for yourself or your chosen agent." />
          </FadeIn>
        ) : null}
        <Grid columns={videoColumns} delay={120}>
          {videos.map((video) => <VideoCard key={video.id} video={video} busy={busy}
            onFeedback={(feedback) => void act(() => api.rhythm.feedback(video.id, feedback))}
            onError={setMessage} />)}
        </Grid>
      </>}

      {section === 'Connections' && <>
        <Enter index={2}>
          <Notice tone="info">
            {RECOMMENDATIONS_ENABLED
              ? 'Your agent runs in the app you choose. It receives approved interests and video content when it uses Rhythm’s tools; that provider’s retention policy applies. Browser permission is a separate choice for each page.'
              : 'Your agent runs in the app you choose. It can read your approved interests through Rhythm’s tools; that provider’s retention policy applies.'}
          </Notice>
        </Enter>
        <Enter index={3}>{assistantCard}</Enter>
        {cardColumns > 1 ? (
          <View style={styles.columns}>
            <Enter index={4} style={styles.column}>{connectCard}</Enter>
            <Enter index={5} style={styles.column}>{connectionLists}</Enter>
          </View>
        ) : <>
          <Enter index={4}>{connectCard}</Enter>
          <Enter index={5}>{connectionLists}</Enter>
        </>}
      </>}

      {section === 'Memory' && <>
        <Enter index={2}>
          <Notice tone="info">
            Only context you confirm is remembered. Your current interests always take precedence.
            Deleting here removes the saved context and permanently erases its private memory copy; an outage leaves erasure queued.
            Copies already received by an external agent follow that provider’s policy.
          </Notice>
        </Enter>
        {data?.memories.memoryStatus && data.memories.memoryStatus !== 'ok' ? <Notice tone="warning">
          Private memory: {data.memories.memoryStatus.replaceAll('_', ' ')}. Confirmed context is still saved in your app.
        </Notice> : null}
        {data && !memories.length ? (
          <FadeIn index={3}>
            <EmptyState title="Nothing remembered yet" body="Suggestions from Rhythm wait here until you confirm or dismiss them." />
          </FadeIn>
        ) : null}
        <Grid columns={cardColumns} delay={120}>
          {memories.map((memory) => <MemoryCard key={memory.id} memory={memory} busy={busy} confirming={deleting === memory.id}
            onApprove={() => void act(() => api.rhythm.approveMemory(memory.id))}
            onRemove={() => {
              if (deleting !== memory.id) { setDeleting(memory.id); return; }
              setDeleting(undefined); void act(() => api.rhythm.deleteMemory(memory.id));
            }}
            onCancelRemove={() => setDeleting(undefined)}
            onError={setMessage} />)}
        </Grid>
        <Enter index={4}>
          <SectionCard
            title="Delete Rhythm data"
            tone="danger"
            icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
            description="Removes learned interests, collected video history, tasks, transcripts, recommendations and connections. Today’s acquisition counter remains until the daily limit resets. Other BuildNorth features keep their data.">
            {deleteData ? <>
              <Notice tone="warning">This removes the saved Rhythm content from your account. Private memory erasure may need to retry if unavailable.</Notice>
              <FormActions>
                <Button title="Cancel" variant="secondary" onPress={() => setDeleteData(false)} />
                <Button title="Confirm deletion" variant="danger" loading={busy}
                  onPress={() => { setDeleteData(false); void act(api.rhythm.deleteData); }} />
              </FormActions>
            </> : (
              <FormActions>
                <DestructiveButton title="Delete Rhythm data…" size="regular" onPress={() => setDeleteData(true)} />
              </FormActions>
            )}
          </SectionCard>
        </Enter>
      </>}

      {section === 'Tasks' && <>
        {data && !tasks.length ? (
          <FadeIn index={2}>
            <EmptyState title="No tasks yet"
              body="Tasks you or your chosen agent start in Rhythm appear here. A task your agent creates waits until you start it." />
          </FadeIn>
        ) : null}
        <Grid columns={cardColumns} delay={120}>
          {tasks.map((task) => <TaskCard key={task.id} task={task} busy={busy}
            agentLabel={task.agentId
              ? agents.find((agent) => agent.id === task.agentId)?.label || 'Previously connected agent'
              : 'You are reviewing this yourself'}
            videoTitle={task.browserSessionId
              ? browsers.find((browser) => browser.id === task.browserSessionId)?.metadata?.title || 'Open the permitted page in Rhythm to review it'
              : undefined}
            onStart={() => void act(() => api.rhythm.approveTask(task.id))}
            onCancel={() => void act(() => api.rhythm.cancelTask(task.id))} />)}
        </Grid>
      </>}

      {data?.metrics?.metrics ? (
        <Enter index={4}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.metrics}>
            Today: {data.metrics.metrics.candidateChecks} checks · {data.metrics.metrics.transcriptAttempts} transcript attempts ·{' '}
            {data.metrics.metrics.cacheHits} cache hits · {data.metrics.metrics.blockedRequests} blocked · {data.metrics.metrics.providerFailures} unavailable responses
          </ThemedText>
        </Enter>
      ) : null}
    </Screen>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <ThemedText type="small" themeColor="textSecondary">{children}</ThemedText>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {hint ? <Muted>{hint}</Muted> : null}
      {children}
    </View>
  );
}

/** The one-time token: shown in full, with the warning right beside the copy button. */
function TokenReveal({ token, onCopy, onHide }: { token: string; onCopy: () => Promise<void>; onHide: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.token, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">Your new connection token</ThemedText>
      <CodeBox value={token} accessibilityLabel="New Rhythm connection token" />
      <Notice tone="warning">Keep this private. It is shown once and only authorizes Rhythm tools with the permissions you chose.</Notice>
      <ActionRow>
        <Button title="Copy token" size="small" onPress={onCopy} />
        <Button title="Hide token" size="small" variant="secondary" onPress={onHide} />
      </ActionRow>
    </View>
  );
}

function AgentCard({ agent, busy, canAllow, permissions, onAllow, onRevoke }: {
  agent: AgentConnection; busy: boolean; canAllow: boolean; permissions: string; onAllow: () => void; onRevoke: () => void;
}) {
  const pending = agent.status === 'pending';
  return (
    <Card>
      <Row>
        <IconTile name={{ ios: 'cpu', android: 'smart_toy', web: 'smart_toy' }} />
        <View style={styles.fill}>
          <ThemedText type="smallBold" numberOfLines={1}>{agent.label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable numberOfLines={1}>{agent.clientId}</ThemedText>
        </View>
        <Pill label={humanize(agent.status)} tone={statusTone(agent.status)} />
      </Row>
      <DetailRow label="Access" value={agent.capabilities.map((c) => LABELS[c]).join(', ') || 'No access yet'} />
      {pending ? <Muted>Allowing grants: {permissions || 'nothing selected'}.</Muted> : null}
      {pending || agent.status !== 'revoked' ? (
        <ActionRow style={styles.cardActions}>
          {pending ? <Button title="Allow with the selected permissions" size="small" disabled={!canAllow || busy} onPress={onAllow} /> : null}
          {agent.status !== 'revoked' ? <DestructiveButton title="Revoke agent access" disabled={busy} onPress={onRevoke} /> : null}
        </ActionRow>
      ) : null}
    </Card>
  );
}

function BrowserCard({ browser, busy, onRevoke }: { browser: BrowserSession; busy: boolean; onRevoke: () => void }) {
  const paused = browser.status === 'paused';
  return (
    <Card>
      <Row>
        <IconTile name={{ ios: 'globe', android: 'web', web: 'web' }} />
        <ThemedText type="smallBold" style={styles.fill} numberOfLines={1}>{browser.label}</ThemedText>
        <Pill label={browser.available ? 'Connected' : paused ? 'Permission revoked' : 'Not connected'}
          tone={browser.available ? 'success' : 'muted'} />
      </Row>
      <ThemedText>{browser.metadata?.title || browser.videoId}</ThemedText>
      <DetailRow label="Transcript permission" value={browser.allowTranscripts ? 'Allowed for a task' : 'Off'} />
      {!paused ? (
        <ActionRow style={styles.cardActions}>
          <DestructiveButton title="Revoke page and cached-text access" disabled={busy} onPress={onRevoke} />
        </ActionRow>
      ) : null}
    </Card>
  );
}

function memoryKind(memory: MemorySuggestion): { label: string; tone: PillTone } {
  if (memory.status.startsWith('feedback_')) return { label: 'Suggested feedback', tone: 'accent' };
  if (memory.status === 'forget_requested') return { label: 'Suggested removal', tone: 'accent' };
  if (memory.status === 'pending') return { label: 'Suggested context', tone: 'accent' };
  if (memory.status === 'stale') return { label: 'Outdated suggestion', tone: 'muted' };
  return { label: 'Confirmed context', tone: 'success' };
}

function MemoryCard({ memory, busy, confirming, onApprove, onRemove, onCancelRemove, onError }: {
  memory: MemorySuggestion; busy: boolean; confirming: boolean; onApprove: () => void; onRemove: () => void;
  onCancelRemove: () => void; onError: (message: string) => void;
}) {
  const kind = memoryKind(memory);
  const canConfirm = memory.status === 'pending' || memory.status.startsWith('feedback_');
  return (
    <Card style={styles.gridCard}>
      <Row>
        <Pill label={kind.label} tone={kind.tone} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.end}>{memory.memoryStatus.replaceAll('_', ' ')}</ThemedText>
      </Row>
      <ThemedText>{memory.text}</ThemedText>
      {memory.evidenceUrl ? (
        <Row style={styles.source}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fill} numberOfLines={2}>
            Source: {memory.evidenceTitle || 'Video title unavailable'}
          </ThemedText>
          <Button title="Review source video" size="small" variant="quiet"
            onPress={() => { void Linking.openURL(memory.evidenceUrl!).catch(() => onError('The source link could not be opened.')); }} />
        </Row>
      ) : null}
      {confirming ? <Notice tone="warning">
        Remove this context from Rhythm and permanently erase any private memory copy?
      </Notice> : null}
      <ActionRow style={styles.cardActions}>
        {canConfirm && !confirming ? <Button title="Confirm" size="small" disabled={busy} onPress={onApprove} /> : null}
        {confirming ? <>
          <Button title="Confirm removal" size="small" variant="danger" disabled={busy} onPress={onRemove} />
          <Button title="Cancel" size="small" variant="secondary" onPress={onCancelRemove} />
        </> : (
          <DestructiveButton title={memory.status === 'pending' ? 'Dismiss suggestion' : 'Remove'} disabled={busy} onPress={onRemove} />
        )}
      </ActionRow>
    </Card>
  );
}

function TaskCard({ task, busy, agentLabel, videoTitle, onStart, onCancel }: {
  task: VideoTask; busy: boolean; agentLabel: string; videoTitle?: string; onStart: () => void; onCancel: () => void;
}) {
  const canCancel = ['pending', 'active'].includes(task.status);
  return (
    <Card style={styles.gridCard}>
      <Row>
        <ThemedText type="smallBold" style={[styles.fill, styles.cardTitle]}>
          {task.action === 'evaluate' ? 'Evaluate a video' : 'Find recommendations'}
        </ThemedText>
        <Pill label={humanize(task.status)} tone={statusTone(task.status)} />
      </Row>
      <ThemedText>{task.request}</ThemedText>
      <View style={styles.details}>
        <DetailRow label="Agent" value={agentLabel} />
        {videoTitle ? <DetailRow label="Selected video" value={videoTitle} /> : null}
        <DetailRow label="Transcript reading" value={task.analyzeTranscripts ? 'Requested, up to three shortlisted videos' : 'Off; metadata only'} />
      </View>
      <Muted>{task.candidateChecks} candidates checked · {task.transcriptAttempts} transcript attempts · {task.cacheHits} cached results</Muted>
      {task.status === 'pending' || canCancel ? (
        <ActionRow style={styles.cardActions}>
          {task.status === 'pending' ? <Button title="Start this task" size="small" disabled={busy} onPress={onStart} /> : null}
          {canCancel ? <DestructiveButton title="Cancel task" disabled={busy} onPress={onCancel} /> : null}
        </ActionRow>
      ) : null}
    </Card>
  );
}

function basisLabel(basis: string): string {
  if (basis === 'metadata') return 'Metadata only';
  if (basis.includes('user_text')) return `Your supplied text${basis.includes('partial') ? ' · partial' : ''}`;
  return basis.includes('partial') ? 'Partial transcript' : 'Displayed transcript';
}

function timestamp(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function VideoCard({ video, busy, onFeedback, onError }: {
  video: Recommendation; busy: boolean; onFeedback: (feedback: 'saved' | 'dismissed' | 'helpful' | 'clear') => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.gridCard}>
      <View style={styles.meta}>
        <Pill label={basisLabel(video.analysisBasis)} tone="muted" />
        <ThemedText type="small" themeColor="textSecondary">
          {video.durationSeconds != null ? `${Math.ceil(video.durationSeconds / 60)} min` : 'Length unknown'}
        </ThemedText>
        {video.feedback ? (
          <Pill label={humanize(video.feedback)}
            tone={video.feedback === 'saved' ? 'accent' : video.feedback === 'helpful' ? 'success' : 'muted'} />
        ) : null}
      </View>
      <ThemedText type="smallBold" style={styles.cardTitle}>{video.title || 'Untitled video'}</ThemedText>
      <ThemedText type="small">{video.explanation}</ThemedText>
      {video.stale ? <Notice tone="warning">Saved under earlier interests. Start a new task to check it against your current profile.</Notice> : null}
      {video.excerpts.length ? (
        <View style={[styles.excerpts, { borderColor: theme.border }]}>
          {video.excerpts.map((segment, i) => (
            <View key={i} style={styles.excerpt}>
              <ThemedText type="smallBold" style={[styles.time, { color: Accent }]}>{timestamp(segment.startSeconds)}</ThemedText>
              <ThemedText type="small" style={styles.fill}>{segment.text}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}
      {video.limitations.length ? <BulletList secondary items={video.limitations} /> : null}
      <View style={styles.cardActions}>
        <Divider />
        <ActionRow>
          <Button title={video.feedback === 'saved' ? 'Unsave' : 'Save'} size="small" disabled={busy}
            onPress={() => onFeedback(video.feedback === 'saved' ? 'clear' : 'saved')} />
          <Button title="Helpful" size="small" variant="secondary" disabled={busy} onPress={() => onFeedback('helpful')} />
          <Button title={video.feedback === 'dismissed' ? 'Undo dismissal' : 'Dismiss'} size="small" variant="quiet" disabled={busy}
            onPress={() => onFeedback(video.feedback === 'dismissed' ? 'clear' : 'dismissed')} />
          <View style={styles.spacer} />
          <Button title="Open video" size="small" variant="secondary" onPress={() => {
            void Linking.openURL(video.url).catch(() => onError('The video link could not be opened.'));
          }} />
        </ActionRow>
      </View>
    </Card>
  );
}

/** A placeholder shaped like a video card while the library loads. */
function VideoCardSkeleton() {
  return (
    <Card style={styles.gridCard}>
      <View style={styles.meta}>
        <Skeleton width={110} height={20} radius={10} />
        <Skeleton width={44} height={12} />
      </View>
      <Skeleton width="70%" height={18} />
      <Skeleton width="95%" />
      <Skeleton width="80%" />
      <View style={styles.cardActions}>
        <Divider />
        <View style={styles.meta}>
          <Skeleton width={64} height={36} radius={10} />
          <Skeleton width={80} height={36} radius={10} />
          <Skeleton width={72} height={36} radius={10} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  end: { marginLeft: 'auto' },
  stack: { gap: Spacing.four },
  group: { gap: Spacing.two },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four },
  column: { flex: 1, minWidth: 0, gap: Spacing.three },
  toolbar: { justifyContent: 'space-between' },
  field: { gap: Spacing.two },
  token: { gap: Spacing.two + Spacing.one, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
  gridCard: { flexGrow: 1 },
  cardTitle: { fontSize: 16, lineHeight: 22 },
  cardActions: { marginTop: 'auto', gap: Spacing.two + Spacing.one, paddingTop: Spacing.one },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  excerpts: { gap: Spacing.one + Spacing.half, borderLeftWidth: 2, paddingLeft: Spacing.two + Spacing.one },
  excerpt: { flexDirection: 'row', gap: Spacing.two },
  time: { minWidth: 36 },
  details: { gap: Spacing.one + Spacing.half },
  source: { alignItems: 'center' },
  spacer: { flexGrow: 1 },
  metrics: { textAlign: 'center', marginTop: Spacing.two },
});
