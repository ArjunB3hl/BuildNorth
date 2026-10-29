import { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Notice,
  Pill,
  Screen,
  ThemedText,
} from '../components/ui';
import { WEB_URL } from '../config';
import { useStore } from '../data/store';
import { describe } from '../lib/account';
import { friendlyDate } from '../lib/dates';
import {
  shownConnection,
  topicLabel,
  videoLength,
  youtubeLink,
  type AgentConnection,
  type Capability,
  type RhythmResult,
  type SavedVideo,
} from '../lib/rhythm';
import { useLoad } from '../lib/use-load';
import { notesPreview, notesSize } from '../lib/video-notes';
import { useNav } from '../navigation';
import { Spacing } from '../theme';
import { rememberVideos } from './video-notes';

// Content library: the website's (mobile/src/app/(app)/(tabs)/profile/videos.tsx, with recommendations off). Saved
// videos — saved with Save to Rhythm in the Chrome extension — with Rhythm's notes and their YouTube links; and the
// assistants connected to this account. The website's Memory tab and its Codex connection aren't shown.

type Section = 'saved' | 'connections';

const CAPABILITY_LABELS: Record<Capability, string> = {
  interests: 'Your interests',
  saved: 'Saved videos',
  page: 'Selected page',
  search: 'Video search',
  transcripts: 'Transcript reading',
  recommend: 'Recommendations',
  memory: 'Memory context',
  feedback: 'Feedback suggestions',
};

function requireOk(result: RhythmResult): RhythmResult {
  if (result.status !== 'ok') {
    throw new Error(result.message || 'Rhythm couldn’t load your library.');
  }
  return result;
}

export function LibraryScreen() {
  const { api } = useStore();
  const [section, setSection] = useState<Section>('saved');
  // Notes being prepared on the server: look again every few seconds until they're ready.
  const [preparing, setPreparing] = useState(false);
  const saved = useLoad(
    api ? async () => requireOk(await api.rhythm.savedVideos()) : null,
    { everyMs: 5000, poll: preparing },
  );
  const videos = saved.data?.savedVideos ?? [];
  rememberVideos(videos);
  const generating = videos.some(v => v.summaryState === 'generating');
  useEffect(() => setPreparing(generating), [generating]);

  if (!api) {
    return (
      <Screen title="Content library">
        <Notice tone="info">
          The content library needs a Rhythm account; this build shows demo
          data.
        </Notice>
      </Screen>
    );
  }

  return (
    <Screen
      title="Content library"
      subtitle="Videos you saved with Save to Rhythm in the Chrome extension, with Rhythm’s notes, and the assistants connected to your account."
      wide
    >
      <ChipGroup
        options={[
          {
            value: 'saved',
            label: `Saved videos${videos.length ? ` · ${videos.length}` : ''}`,
          },
          { value: 'connections', label: 'Connections' },
        ]}
        multiple={false}
        selected={[section]}
        onChange={v => v[0] && setSection(v[0])}
      />
      {section === 'saved' ? (
        <SavedVideos
          videos={videos}
          loading={saved.loading && !saved.data}
          error={saved.error}
          onRetry={saved.reload}
          onChanged={saved.reload}
        />
      ) : (
        <Connections />
      )}
    </Screen>
  );
}

function SavedVideos({
  videos,
  loading,
  error,
  onRetry,
  onChanged,
}: {
  videos: SavedVideo[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onChanged: () => void;
}) {
  const nav = useNav();
  if (loading) {
    return (
      <ThemedText themeColor="textSecondary">
        Loading your saved videos…
      </ThemedText>
    );
  }
  if (error && !videos.length) {
    return (
      <View style={styles.gap}>
        <Notice tone="error">{describe(error)}</Notice>
        <View style={styles.start}>
          <Button title="Try again" variant="secondary" onPress={onRetry} />
        </View>
      </View>
    );
  }
  if (!videos.length) {
    return (
      <EmptyState
        title="No saved videos yet"
        body="In Chrome, open a workout, martial arts or recipe video on YouTube and choose Save to Rhythm in the Rhythm extension. It appears here with Rhythm’s notes."
        action={
          <Button
            title="Get the Chrome extension"
            size="small"
            onPress={() => nav.go('downloads')}
          />
        }
      />
    );
  }
  return (
    <View style={styles.grid}>
      {videos.map(video => (
        <VideoCard key={video.videoId} video={video} onChanged={onChanged} />
      ))}
    </View>
  );
}

function VideoCard({
  video,
  onChanged,
}: {
  video: SavedVideo;
  onChanged: () => void;
}) {
  const { api } = useStore();
  const [preparing, setPreparing] = useState(false);
  const nav = useNav();
  const [message, setMessage] = useState<string | null>(null);
  const link = youtubeLink(video);
  const meta = [
    video.channel,
    videoLength(video.durationSeconds),
    `saved ${friendlyDate(video.savedAt.slice(0, 10))}`,
  ]
    .filter(Boolean)
    .join(' · ');

  async function prepareNotes() {
    if (!api) {
      return;
    }
    setPreparing(true);
    setMessage(null);
    try {
      const result = await api.rhythm.summarizeVideo(video.videoId);
      setMessage(result.status === 'ok' ? null : result.message);
      onChanged();
    } catch (e) {
      setMessage(describe(e));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Card style={styles.video}>
      <ThemedText type="smallBold" numberOfLines={2}>
        {video.title || 'Untitled video'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {meta}
      </ThemedText>
      {video.topics.length ? (
        <View style={styles.pills}>
          {video.topics.map(t => (
            <Pill key={t} label={topicLabel(t)} tone="accent" />
          ))}
        </View>
      ) : null}

      <View style={styles.notes}>
        <ThemedText type="smallBold">Notes</ThemedText>
        {video.summaryState === 'ready' && video.summary ? (
          <>
            <ThemedText type="small">
              {notesPreview(video.summary) ?? 'Notes are ready.'}
            </ThemedText>
            {notesSize(video.summary) ? (
              <ThemedText type="small" themeColor="textSecondary">
                {notesSize(video.summary)}
              </ThemedText>
            ) : null}
          </>
        ) : video.summaryState === 'generating' || preparing ? (
          <ThemedText type="small" themeColor="textSecondary">
            Rhythm is preparing notes from the transcript…
          </ThemedText>
        ) : video.summaryState === 'no_transcript' || !video.hasTranscript ? (
          <ThemedText type="small" themeColor="textSecondary">
            No transcript was saved with this video, so there are no notes. Save
            it again from the video page in Chrome to add one.
          </ThemedText>
        ) : (
          <View style={styles.gap}>
            <ThemedText type="small" themeColor="textSecondary">
              Notes aren’t ready yet. Rhythm can write them from the saved
              transcript.
            </ThemedText>
            <View style={styles.start}>
              <Button
                title="Prepare notes"
                size="small"
                variant="secondary"
                onPress={prepareNotes}
                loading={preparing}
              />
            </View>
          </View>
        )}
        {message ? <Notice tone="error">{message}</Notice> : null}
      </View>

      <View style={styles.row}>
        {video.summaryState === 'ready' && video.summary ? (
          <Button
            title="Read notes"
            size="small"
            onPress={() => nav.push({ name: 'video', id: video.videoId })}
          />
        ) : null}
        <Button
          title="Watch on YouTube ↗"
          size="small"
          variant="secondary"
          onPress={() => Linking.openURL(link)}
        />
      </View>
    </Card>
  );
}

function Connections() {
  const { api } = useStore();
  const connections = useLoad(
    api ? async () => requireOk(await api.rhythm.connections()) : null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const agents = (connections.data?.agents ?? []).filter(shownConnection);

  function disconnect(agent: AgentConnection) {
    Alert.alert(
      `Disconnect ${agent.label}?`,
      'It can no longer use Rhythm’s tools with your account. You can connect it again on the website.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await api!.rhythm.revokeAgent(agent.id);
              setMessage(result.message || 'Disconnected.');
              connections.reload();
            } catch (e) {
              setMessage(describe(e));
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.gap}>
      <ThemedText type="small" themeColor="textSecondary">
        Assistants you connected (Claude, ChatGPT or your own agent) can read
        what you allowed through Rhythm’s tools; that provider’s own retention
        policy applies. Connect a new one on the website.
      </ThemedText>
      {message ? <Notice tone="info">{message}</Notice> : null}
      {connections.error ? (
        <View style={styles.gap}>
          <Notice tone="error">{describe(connections.error)}</Notice>
          <View style={styles.start}>
            <Button
              title="Try again"
              variant="secondary"
              onPress={connections.reload}
            />
          </View>
        </View>
      ) : connections.loading && !connections.data ? (
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      ) : agents.length === 0 ? (
        <EmptyState
          title="No assistants connected"
          body="Connect Claude or ChatGPT to your Rhythm account on the website, under Content library › Connections."
        />
      ) : (
        agents.map(agent => (
          <Card key={agent.id} style={styles.gap}>
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold" style={styles.fill}>
                {agent.label}
              </ThemedText>
              <Pill
                label={
                  agent.status.charAt(0).toUpperCase() + agent.status.slice(1)
                }
                tone={agent.status === 'active' ? 'success' : 'muted'}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {agent.capabilities.length
                ? `Can use: ${agent.capabilities
                    .map(c => CAPABILITY_LABELS[c] ?? c)
                    .join(', ')}`
                : 'No permissions granted yet.'}
            </ThemedText>
            <View style={styles.start}>
              <Button
                title="Disconnect"
                size="small"
                variant="secondary"
                onPress={() => disconnect(agent)}
              />
            </View>
          </Card>
        ))
      )}
      <View style={styles.start}>
        <Button
          title="Connect an assistant on the website ↗"
          size="small"
          variant="quiet"
          onPress={() => Linking.openURL(`${WEB_URL}/profile/videos`)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { gap: Spacing.two },
  start: { alignItems: 'flex-start' },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  video: { flexGrow: 1, flexBasis: 360, maxWidth: 560, gap: Spacing.two },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  notes: { gap: Spacing.one },
});
