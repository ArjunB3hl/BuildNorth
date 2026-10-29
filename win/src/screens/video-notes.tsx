import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import {
  Button,
  Card,
  Notice,
  Pill,
  Screen,
  ThemedText,
} from '../components/ui';
import { useStore } from '../data/store';
import { describe } from '../lib/account';
import { friendlyDate } from '../lib/dates';
import {
  topicLabel,
  videoLength,
  youtubeLink,
  type RhythmResult,
  type SavedVideo,
} from '../lib/rhythm';
import { useLoad } from '../lib/use-load';
import { parseNotes, type NotesBlock } from '../lib/video-notes';
import { useNav } from '../navigation';
import { Accent, Spacing } from '../theme';

// Content library › a saved video: Rhythm's notes laid out for reading — the overview first, then each section on its
// own card with numbered steps and bullets — in the reading column, with the video's details and its YouTube link.

/** The library's last list, so a video opens at once; the page still loads the list again. */
const known = new Map<string, SavedVideo>();
export function rememberVideos(videos: SavedVideo[]) {
  videos.forEach(v => known.set(v.videoId, v));
}

function requireOk(result: RhythmResult): RhythmResult {
  if (result.status !== 'ok') {
    throw new Error(result.message || 'Rhythm couldn’t load this video.');
  }
  return result;
}

/** The overview, then one section per heading. */
function sections(blocks: NotesBlock[]) {
  const out: { heading: string | null; blocks: NotesBlock[] }[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading') {
      out.push({ heading: block.text, blocks: [] });
    } else {
      if (!out.length) {
        out.push({ heading: null, blocks: [] });
      }
      out[out.length - 1].blocks.push(block);
    }
  }
  return out;
}

export function VideoNotesScreen({ id }: { id: string }) {
  const { api } = useStore();
  const nav = useNav();
  const latest = useLoad(
    api ? async () => requireOk(await api.rhythm.savedVideos()) : null,
  );
  const fresh = latest.data?.savedVideos?.find(v => v.videoId === id);
  const video = fresh ?? known.get(id) ?? null;
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(false);

  if (!video) {
    return (
      <Screen title="Saved video">
        {latest.error ? (
          <Notice tone="error">{describe(latest.error)}</Notice>
        ) : latest.loading ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : (
          <Notice tone="info">
            This video isn’t in your library any more.
          </Notice>
        )}
        <View style={styles.start}>
          <Button
            title="← Content library"
            variant="secondary"
            onPress={nav.back}
          />
        </View>
      </Screen>
    );
  }

  const link = youtubeLink(video);
  const notes = parseNotes(video.summary);
  const ready = video.summaryState === 'ready' && !!video.summary;
  const meta = [
    video.channel,
    videoLength(video.durationSeconds),
    `saved ${friendlyDate(video.savedAt.slice(0, 10))}`,
  ]
    .filter(Boolean)
    .join(' · ');

  async function prepareNotes() {
    if (!api || !video) {
      return;
    }
    setPreparing(true);
    setMessage(null);
    try {
      const result = await api.rhythm.summarizeVideo(video.videoId);
      setMessage(result.status === 'ok' ? null : result.message);
      latest.reload();
    } catch (e) {
      setMessage(describe(e));
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Screen title={video.title || 'Untitled video'} subtitle={meta}>
      {/* (in the page, not the header: header buttons don't take mouse clicks on Windows yet) */}
      <View style={styles.row}>
        <Button title="← Content library" variant="quiet" onPress={nav.back} />
        <Button
          title="Watch on YouTube ↗"
          onPress={() => Linking.openURL(link)}
        />
      </View>
      {video.topics.length ? (
        <View style={styles.pills}>
          {video.topics.map(t => (
            <Pill key={t} label={topicLabel(t)} tone="accent" />
          ))}
        </View>
      ) : null}

      {ready ? (
        <>
          {notes.label ? (
            <ThemedText
              type="smallBold"
              themeColor="textSecondary"
              style={styles.label}
            >
              {notes.label.toUpperCase()}
            </ThemedText>
          ) : null}
          {sections(notes.blocks).map((section, i) => (
            <Card key={i} style={styles.section}>
              {section.heading ? (
                <ThemedText style={styles.heading} accessibilityRole="header">
                  {section.heading}
                </ThemedText>
              ) : null}
              {section.blocks.map((block, j) =>
                block.kind === 'step' ? (
                  <ThemedText key={j} style={styles.step} selectable>
                    <Text style={styles.marker}>
                      {block.marker === '•' ? '•  ' : `${block.marker}  `}
                    </Text>
                    {block.text}
                  </ThemedText>
                ) : (
                  <ThemedText
                    key={j}
                    style={section.heading ? styles.text : styles.overview}
                    selectable
                  >
                    {block.text}
                  </ThemedText>
                ),
              )}
            </Card>
          ))}
        </>
      ) : (
        <Card style={styles.section}>
          <ThemedText type="smallBold">Notes</ThemedText>
          {video.summaryState === 'generating' || preparing ? (
            <ThemedText themeColor="textSecondary">
              Rhythm is preparing notes from the transcript…
            </ThemedText>
          ) : video.summaryState === 'no_transcript' || !video.hasTranscript ? (
            <ThemedText themeColor="textSecondary">
              No transcript was saved with this video, so there are no notes.
              Save it again from the video page in Chrome to add one.
            </ThemedText>
          ) : (
            <>
              <ThemedText themeColor="textSecondary">
                Notes aren’t ready yet. Rhythm can write them from the saved
                transcript.
              </ThemedText>
              <View style={styles.start}>
                <Button
                  title="Prepare notes"
                  variant="secondary"
                  onPress={prepareNotes}
                  loading={preparing}
                />
              </View>
            </>
          )}
          {message ? <Notice tone="error">{message}</Notice> : null}
        </Card>
      )}

      {video.description ? (
        <Card style={styles.section}>
          <View style={styles.start}>
            <Button
              title={
                showDescription
                  ? 'Hide the video’s description'
                  : 'Show the video’s description'
              }
              size="small"
              variant="quiet"
              onPress={() => setShowDescription(s => !s)}
            />
          </View>
          {showDescription ? (
            <ThemedText type="small" themeColor="textSecondary" selectable>
              {video.description}
            </ThemedText>
          ) : null}
        </Card>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary" selectable>
        {link}
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  start: { alignItems: 'flex-start' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  label: { fontSize: 12, letterSpacing: 0.8, marginTop: Spacing.two },
  section: { gap: Spacing.two, padding: Spacing.four },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  overview: { fontSize: 17, lineHeight: 27 },
  text: { fontSize: 15, lineHeight: 24 },
  step: { fontSize: 15, lineHeight: 24, paddingLeft: Spacing.two },
  marker: { color: Accent, fontWeight: '700' },
});
