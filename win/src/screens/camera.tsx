import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Button, Notice, PageHeader, Row, ThemedText } from '../components/ui';
import { useStore } from '../data/store';
import { describe } from '../lib/account';
import { localDate } from '../lib/dates';
import { randomUUID } from '../lib/ids';
import {
  countedSets,
  countedWorkout,
  countMessage,
  freeze,
  NOTHING_COUNTED,
  poseMessage,
  poseUrl,
  saveTarget,
  sessionFromWorkout,
  trustedPoseUrl,
  workoutLine,
  type Counted,
} from '../lib/pose-coach';
import { MaxContentWidth, Spacing, useIsDark, useTheme } from '../theme';

/**
 * Camera workout: the local camera coach (inference/pose-coach, started with win\local-voice\camera.ps1) counts reps
 * in this app's WebView2, and the app saves what it counted as an Activity session, as the website does. The page
 * gets no sign-in; the only things it can ask the app for are the theme, its AI connection (whether the account's
 * ElevenLabs agent may coach, and that Claude Code on this PC may) and a short-lived ElevenLabs conversation address.
 */
export function CameraScreen() {
  const { mode, api, dispatch, reload } = useStore();
  const dark = useIsDark();
  const theme = useTheme();
  // (react-native-webview 15.0.0 types its default props parameter as `undefined`, which makes every prop `never`)
  const web = useRef<WebView<object>>(null);
  const [counted, setCounted] = useState<Counted>(NOTHING_COUNTED);
  const latest = useRef(counted);
  latest.current = counted;
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // react-native-webview 15.0.0 on Windows applies `source` only in a props update after its XAML island exists, and
  // the first update comes before that: the page address is given a moment after the view mounts, and again (with a
  // new #fragment, so the prop changes) until the page starts loading. The view is kept for the life of the screen
  // (a new one covers the window for a while before it is laid out); Reload gives the same view a new address.
  const [uri, setUri] = useState('about:blank');
  const loading = useRef(false);
  const firstTheme = useRef<'light' | 'dark'>(dark ? 'dark' : 'light');
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      if (loading.current || tries >= 60) return clearInterval(timer); // (up to 90 s: it can take that long here)
      tries += 1;
      setUri(`${poseUrl(firstTheme.current)}#${tries}`);
    }, 1500);
    return () => clearInterval(timer);
  }, []);
  const loads = useRef(0);
  const loadAgain = useCallback(() => {
    setReady(false);
    loads.current += 1;
    setUri(`${poseUrl(firstTheme.current)}&load=${loads.current}`); // (a new query, so the page loads again)
  }, []);
  const [elevenlabs, setElevenlabs] = useState(false);
  const elevenRef = useRef(false);
  elevenRef.current = elevenlabs;

  // Signed in: the account's ElevenLabs agent, if one is connected and usable, coaches first (the page's Auto).
  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .access()
      .then(a => alive && setElevenlabs(a.elevenlabs === true))
      .catch(() => alive && setElevenlabs(false));
    return () => {
      alive = false;
    };
  }, [api]);

  const post = useCallback((name: string, fields: object = {}) => {
    web.current?.postMessage(
      JSON.stringify({ ...fields, type: `pose-coach/${name}` }),
    );
  }, []);

  useEffect(() => {
    if (!ready) return;
    post('theme', { theme: dark ? 'dark' : 'light' });
    post('ai-connection', { elevenlabs, localClaude: true });
  }, [ready, dark, elevenlabs, post]);

  // One save at a time: what was counted is handed over (frozen) first, so a late summary can't save it twice.
  const saveNow = useRef(false);
  const save = useCallback(async () => {
    const workout = countedWorkout(latest.current, new Date().toISOString());
    setFinishing(false);
    if (!workout || saveNow.current) return;
    saveNow.current = true;
    setSaving(true);
    setSaved('');
    const session = sessionFromWorkout(workout, { localDate: localDate() });
    const kept = latest.current;
    latest.current = freeze(kept);
    setCounted(latest.current);
    try {
      if (api) {
        await api.sessions.create(session);
        await reload(['sessions', 'calendar', 'today', 'progress']);
      } else {
        dispatch({ type: 'session/save', session, id: randomUUID() });
      }
      setSaved(`Saved: ${workoutLine(workout.sets)}`);
    } catch (e) {
      // not saved: count it again, so Finish and save can try again
      latest.current = kept;
      setCounted(kept);
      setProblem(`Couldn’t save the workout: ${describe(e)}`);
    } finally {
      saveNow.current = false;
      setSaving(false);
    }
  }, [api, dispatch, reload]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const m = poseMessage(event.nativeEvent);
      if (!m) return;
      if (m.type === 'pose-coach/elevenlabs-session-request') {
        const requestId = String(m.requestId).slice(0, 40);
        if (!api || !elevenRef.current) {
          post('elevenlabs-session', {
            requestId,
            error: 'Connect ElevenLabs in Rhythm AI connections.',
          });
          return;
        }
        api
          .elevenLabsSession()
          .then(s =>
            post('elevenlabs-session', { requestId, signedUrl: s.signedUrl }),
          )
          .catch(() =>
            post('elevenlabs-session', {
              requestId,
              error: 'Reconnect required',
            }),
          );
        return;
      }
      if (m.type === 'pose-coach/error') {
        setProblem(String(m.message).slice(0, 300));
        return;
      }
      if (m.type === 'pose-coach/state') setRunning(m.running);
      const next = countMessage(latest.current, m, new Date().toISOString());
      latest.current = next.counted;
      setCounted(next.counted);
      if (m.type === 'pose-coach/ready') {
        setReady(true);
        setProblem('');
        post('theme', { theme: dark ? 'dark' : 'light' });
        post('ai-connection', {
          elevenlabs: elevenRef.current,
          localClaude: true,
        });
      }
      if (next.ended && finishing) save();
    },
    [api, dark, finishing, post, save],
  );

  // Anything other than the camera page (a link, a redirect) is not shown: the app loads the camera page again.
  const guard = useCallback(
    (url: string | undefined) => {
      if (trustedPoseUrl(url)) loading.current = true;
      if (url && url !== 'about:blank' && !trustedPoseUrl(url)) {
        setProblem(
          'The camera view tried to open another page, so it was reloaded. Only the local camera coach can run here.',
        );
        loadAgain();
      }
    },
    [loadAgain],
  );

  function finish() {
    if (running) {
      setFinishing(true);
      post('stop');
      // the page answers a stop with its summary; if it doesn't in time, what was counted is saved anyway
      setTimeout(() => {
        if (latest.current.run) save();
      }, 5000);
    } else save();
  }

  const sets = countedSets(counted);

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <PageHeader title="Camera workout" />
        <ThemedText type="small" themeColor="textSecondary">
          {`The camera coach runs on this PC and counts your reps; no camera images leave it. ${saveTarget(
            mode,
          )} Coach: Auto prefers ${
            elevenlabs ? 'your Rhythm account’s ElevenLabs agent, then ' : ''
          }Claude Code signed in on this PC (measured events and your spoken questions go to Claude as text), then the engine’s own cues.`}
        </ThemedText>
        {sets.length ? (
          <Notice tone="info">{`Counted so far: ${workoutLine(sets)}`}</Notice>
        ) : null}
        {saved ? <Notice tone="success">{saved}</Notice> : null}
        {problem ? <Notice tone="warning">{problem}</Notice> : null}
        {/* (in the page, not the header: header actions don't take mouse clicks on Windows yet) */}
        <Row style={styles.actions}>
          <Button
            title="Finish and save"
            onPress={finish}
            disabled={!sets.length || saving || finishing}
            loading={saving || finishing}
          />
          <Button title="Reload" variant="secondary" onPress={loadAgain} />
        </Row>
      </View>
      <WebView<object>
        ref={web}
        source={{ uri }}
        style={styles.web}
        onMessage={onMessage}
        onLoadStart={e => guard(e.nativeEvent.url)}
        onLoadEnd={e => guard(e.nativeEvent.url)}
        onOpenWindow={() => {
          // new windows are never opened from the camera page
        }}
        onError={() =>
          setProblem(
            'The camera coach isn’t running. In PowerShell, run win\\local-voice\\camera.ps1 from the BuildNorth folder, then Reload.',
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth + Spacing.five * 2,
    alignSelf: 'center',
  },
  actions: { gap: Spacing.two },
  web: { flex: 1 },
});
