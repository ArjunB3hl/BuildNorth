import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Notice } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { PageIntro } from '@/components/activity/layout';
import { errorMessage, Row, Screen, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useApi } from '@/hooks/use-api';
import { useCameraWorkout } from '@/hooks/use-camera-workout';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { confirmAction } from '@/lib/confirm';
import { localDate } from '@/lib/dates';
import {
  countedSets,
  countedWorkout,
  countMessage,
  endRun,
  freeze,
  NOTHING_COUNTED,
  POSE_URL,
  poseFrameUrl,
  poseMessage,
  holdScreen,
  restoreWorkouts,
  serverHas,
  sessionFromWorkout,
  workoutLine,
  type Counted,
  type PoseWorkout,
  type StoredWorkout,
} from '@/lib/pose-coach';

// The pose page says it is ready once it has loaded; without that, its local server is not running.
const READY_TIMEOUT_MS = 10000;
// "Finish and save" stops the page, which sends the workout at once. Without it in this time, save what was counted.
const STOP_TIMEOUT_MS = 8000;

type Exit = { to: 'back' } | { to: 'session'; id: string };
const now = () => new Date().toISOString();
const when = (w: PoseWorkout) => new Date(w.startedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
// Camera workout screens in other tabs share what is kept on the device: one at a time (lib/pose-coach.ts holdScreen).
const LOCK = 'buildnorth-camera-workout';
const subscribeOrigin = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => '';

/**
 * A camera workout: the pose coach counts reps and sets in the frame below, and this screen saves them as a session.
 * What is counted is kept on the device as reps arrive (useCameraWorkout), so leaving the screen, the browser's Back or
 * a reload loses nothing: the screen offers it again. Stop, then Start again in the frame adds to the same workout.
 * Workouts kept from an earlier visit (not the last few minutes) are saved as sessions of their own.
 */
export default function CameraWorkout() {
  const focused = useIsFocused();
  // Web stack routes remain mounted after navigation. Release the frame and its Web Lock while off-screen;
  // the inner screen restores persisted counts on the next visit.
  return focused ? <CameraWorkoutSession /> : null;
}

function CameraWorkoutSession() {
  const params = useLocalSearchParams<{ routineId?: string; routineName?: string; planItemId?: string }>();
  const api = useApi();
  // useApi gives a new client on every render (Clerk's getToken is new each time): effects read it from a ref
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [frameHeight, setFrameHeight] = useState(960);
  const { load, save: keep, clear } = useCameraWorkout();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const parentOrigin = useSyncExternalStore(subscribeOrigin, browserOrigin, serverOrigin);
  const frameConfig = useMemo(() => {
    if (!parentOrigin) return { src: '', origin: '', error: '' };
    try {
      const src = poseFrameUrl(POSE_URL, parentOrigin);
      return { src, origin: new URL(src).origin, error: '' };
    } catch {
      return { src: '', origin: '', error: 'The camera coach connection is unavailable. Open the website on localhost and check its local coach address.' };
    }
  }, [parentOrigin]);
  const { src, origin: poseOrigin } = frameConfig;
  const [ready, setReady] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);              // the frame is loaded again on Try again (no reload)
  const [loaded, setLoaded] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [ranOnce, setRanOnce] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [exit, setExit] = useState<Exit | null>(null);
  // this screen holds the camera workout (a browser without Web Locks can't tell: it goes ahead)
  const [claimed, setClaimed] = useState(() => typeof navigator === 'undefined' || !navigator.locks);
  const [elsewhere, setElsewhere] = useState(false);       // another tab holds it: this one waits, then takes over
  // This visit's counting (lib/pose-coach.ts countMessage), and unsaved workouts from earlier visits. Refs too, so
  // message handlers and the save see the latest.
  const [counted, setCounted] = useState<Counted>(NOTHING_COUNTED);
  const [earlier, setEarlier] = useState<StoredWorkout[]>([]);
  const countedRef = useRef<Counted>(NOTHING_COUNTED);
  const earlierRef = useRef<StoredWorkout[]>([]);
  const finishingRef = useRef(false);
  const savingRef = useRef(false);
  const restoredRef = useRef(false);
  const mounted = useRef(true);
  // start times of the workouts a save went out for without a success seen: marked `sent` on the device, and checked
  // with the server before they are saved again
  const sent = useRef(new Set<string>());
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = counted.run !== null;

  const update = useCallback((next: Counted) => {
    countedRef.current = next;
    setCounted(next);
  }, []);
  const updateEarlier = useCallback((next: StoredWorkout[]) => {
    earlierRef.current = next;
    setEarlier(next);
  }, []);
  /** Everything not saved, oldest first: the earlier workouts, then this visit's. */
  const unsaved = useCallback((): StoredWorkout[] => {
    const current = countedWorkout(countedRef.current, now());
    return [...earlierRef.current, ...(current ? [current] : [])].map((w) => (sent.current.has(w.startedAt) ? { ...w, sent: true } : w));
  }, []);
  /** Keep what is not saved on the device. */
  const persist = useCallback(async () => {
    const list = unsaved();
    if (list.length) await keep(list);
    else await clear();
  }, [unsaved, keep, clear]);

  const save = useMutation({
    mutationFn: async () => {
      // this visit's workout is handed over: it never grows now (a later run starts another workout), so a save whose
      // answer never came can be recognised on the server exactly
      const current = countedWorkout(countedRef.current, now());
      if (current) {
        const { routineId, routineName, planItemId } = params;
        updateEarlier([...earlierRef.current, { ...current, handedOver: true, routine: { routineId, routineName, planItemId } }]);
        update(freeze(countedRef.current));
      }
      let last: string | null = null;
      let unsure = 0;
      for (const w of [...earlierRef.current]) {
        if (!mounted.current) break;              // left mid-save: the rest stay kept, marked, for the next visit
        const has = sent.current.has(w.startedAt) ? serverHas(w, await apiRef.current.sessions.list()) : false;
        if (has === null) {                       // too old for the server's list: never risk saving it twice
          unsure += 1;
          continue;
        }
        sent.current.add(w.startedAt);
        await persist();                          // marked as sent before the request goes out
        if (!has) {
          const saved = await apiRef.current.sessions.create(
            sessionFromWorkout(w, { localDate: localDate(new Date(w.startedAt)), ...w.routine }),
          );
          last = saved.id;
        }
        if (!mounted.current) break;              // (still marked: the next visit checks the server)
        sent.current.delete(w.startedAt);
        updateEarlier(earlierRef.current.filter((e) => e.startedAt !== w.startedAt));
        await persist();
      }
      return { last, unsure };
    },
    onSuccess: ({ last, unsure }) => {
      for (const key of ['calendar', 'sessions', 'progress', 'today']) queryClient.invalidateQueries({ queryKey: [key] });
      if (!mounted.current) return;
      if (unsure) {
        setNotice(
          `${unsure === 1 ? 'A workout' : `${unsure} workouts`} kept here may already be saved (no answer came when it was sent), ` +
            'so it was not saved again. Check Activity: Discard removes what is kept here.',
        );
      } else setExit(last ? { to: 'session', id: last } : { to: 'back' });
    },
    onError: () => {
      if (mounted.current) persist();             // the `sent` marks stay: the server may have the workout
    },
    onSettled: () => {
      savingRef.current = false;
    },
  });
  const { mutate, reset } = save;
  const saveAll = useCallback(() => {
    if (!restoredRef.current || savingRef.current || !unsaved().length) return;
    savingRef.current = true;
    mutate();
  }, [mutate, unsaved]);
  const post = useCallback((name: string, fields: Record<string, unknown> = {}) => frame.current?.contentWindow?.postMessage({ ...fields, type: `pose-coach/${name}` }, poseOrigin), [poseOrigin]);
  /** "Finish and save" was waiting for the run to end: save now. */
  const finished = useCallback(() => {
    if (!finishingRef.current) return;
    finishingRef.current = false;
    clearTimeout(stopTimer.current);
    setFinishing(false);
    saveAll();
  }, [saveAll]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One camera workout screen at a time across tabs: a later one waits, and takes over when the other closes.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.locks) return;
    return holdScreen(navigator.locks, LOCK, {
      held: () => {
        setElsewhere(false);
        setClaimed(true);
      },
      waiting: () => setElsewhere(true),
      // the browser dropped the lock (Safari, going into its back/forward cache): start over, so this tab claims
      // again before it shows or saves anything
      lost: () => window.location.reload(),
    });
  }, []);
  // back from the back/forward cache: what this page holds may be stale (the lock, what another tab saved meanwhile)
  useEffect(() => {
    const back = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  // What an earlier visit kept on the device: continue it if it was a moment ago, else offer it to save apart. Once,
  // from the device alone (no network), so what this visit counts is kept from the start.
  useEffect(() => {
    if (!claimed || elsewhere) return;
    let live = true;
    load().then((stored) => {
      if (!live || restoredRef.current) return;
      restoredRef.current = true;
      const { earlier: before, resume } = restoreWorkouts(stored, new Date());
      for (const w of before) if (w.sent) sent.current.add(w.startedAt);
      updateEarlier(before.map(({ sent: _, ...w }) => w));
      if (resume) {
        const c = countedRef.current;
        update({ ...c, runs: [{ startedAt: resume.startedAt, finishedAt: resume.finishedAt, sets: resume.sets, final: true }, ...c.runs] });
        setResumed(true);
      }
      setLoaded(true);
      // then, in the background: drop the workouts whose save the server has after all (a save checks again anyway)
      if (before.some((w) => w.sent)) {
        apiRef.current.sessions
          .list()
          .then((sessions) => {
            if (!mounted.current || savingRef.current) return;
            const saved = earlierRef.current.filter((w) => sent.current.has(w.startedAt) && serverHas(w, sessions) === true);
            for (const w of saved) sent.current.delete(w.startedAt);
            if (saved.length) updateEarlier(earlierRef.current.filter((w) => !saved.includes(w)));
          })
          .catch(() => {});
      }
    });
    return () => {
      live = false;
    };
  }, [claimed, elsewhere, load, update, updateEarlier]);

  // Keep what is counted on the device, as it arrives.
  useEffect(() => {
    if (loaded && !exit) persist();
  }, [loaded, exit, counted, earlier, persist]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = poseMessage(event, frame.current?.contentWindow, poseOrigin);
      if (!m) return;
      if (m.type === 'pose-coach/resize') {
        if (Number.isFinite(m.height)) setFrameHeight(Math.max(320, Math.min(12000, Math.ceil(m.height))));
        return;
      }
      if (m.type === 'pose-coach/state' && m.running && savingRef.current) {
        post('stop');                               // the workout is being saved and this screen is about to close
        return;
      }
      const next = countMessage(countedRef.current, m, now());
      update(next.counted);
      if (m.type === 'pose-coach/ready') {
        post('theme', { theme: scheme });
        setReady(true);
        setUnreachable(false);
      } else if (m.type === 'pose-coach/error') {
        setNotice(m.message);
      }
      if (next.started) {
        setRanOnce(true);
        setNotice(null);
        reset();
      }
      if (next.ended) finished();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [poseOrigin, update, finished, post, reset, scheme]);

  useEffect(() => {
    if (ready) post('theme', { theme: scheme });
  }, [ready, scheme, post]);

  useEffect(() => {
    if (ready || !claimed || elsewhere || !src) return;
    const t = setTimeout(() => {
      // A local frame can stall during its first module load. Retry once before asking for help, but never
      // reload a frame that has begun a workout or delivered counts.
      if (countedRef.current.run || countedSets(countedRef.current).length) return;
      if (attempt === 0) setAttempt(1);
      else setUnreachable(true);
    }, READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready, claimed, elsewhere, attempt, src]);
  // (not a reload: that would hand this screen to a camera workout waiting in another tab)
  const tryAgain = () => {
    setUnreachable(false);
    setAttempt((n) => n + 1);
  };
  useEffect(() => () => clearTimeout(stopTimer.current), []);

  useEffect(() => {
    if (!exit) return;
    if (exit.to === 'session') router.replace({ pathname: '/activity/session/[id]', params: { id: exit.id, justFinished: '1' } });
    else if (router.canGoBack()) router.back();
    else router.replace('/activity');
  }, [exit, router]);

  // Leaving while the camera counts stops it; leaving mid-save leaves the rest for the next visit. What was counted
  // is kept either way. (On the web, expo-router does not ask this for the browser's Back button.)
  const busy = save.isPending || finishing;
  usePreventRemove(!exit && (running || busy), ({ data }) => {
    confirmAction({
      title: running ? 'Leave the camera workout?' : 'Leave while saving?',
      message: running
        ? 'Counting stops. The reps counted so far are kept: open Camera workout again to save them.'
        : 'What is not saved yet is kept, and checked with the server before it is saved again.',
      confirmLabel: 'Leave',
      cancelLabel: running ? 'Keep going' : 'Stay',
    }).then((ok) => {
      if (ok) navigation.dispatch(data.action);
    });
  });
  useEffect(() => {
    if (!running && !busy) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();      // reloading or closing the tab mid-run or mid-save
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [running, busy]);

  const sets = countedSets(counted);
  const total = earlier.length + (sets.length ? 1 : 0);
  const finish = () => {
    if (!loaded) return;
    if (!running) return saveAll();
    finishingRef.current = true;
    setFinishing(true);
    post('stop');
    stopTimer.current = setTimeout(() => {
      if (!finishingRef.current) return;
      finishingRef.current = false;
      setFinishing(false);
      update(endRun(countedRef.current, now()));
      setNotice("The camera coach didn't answer. The reps counted so far are kept: press Save workout to save them.");
    }, STOP_TIMEOUT_MS);
  };
  const discard = async () => {
    if (!loaded) return;                         // (what is kept on the device is not known yet)
    if (running || total) {
      const confirmed = await confirmAction({
        title: total > 1 ? `Discard ${total} camera workouts?` : 'Discard this camera workout?',
        message: 'Nothing from it will be saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep going',
        destructive: true,
      });
      if (!confirmed) return;
    }
    await clear();
    updateEarlier([]);
    update(NOTHING_COUNTED);
    setExit({ to: 'back' });
  };

  const thisVisit = sets.length ? workoutLine(sets) : null;
  const status = elsewhere || unreachable
    ? null
    : !ready
      ? 'Loading the camera coach…'
      : running
        ? `Counting. ${thisVisit ?? 'Start any exercise: sets are found automatically.'}`
        : earlier.length
          ? `Not saved yet: ${[...earlier.map((w) => `${when(w)}: ${workoutLine(w.sets)}`), ...(thisVisit ? [`now: ${thisVisit}`] : [])].join(' · ')}`
          : thisVisit
            ? `${resumed && !ranOnce ? 'Kept from a moment ago' : 'Ready to save'}: ${thisVisit}`
            : ranOnce
              ? 'No full set was counted. Press Start in the camera view to try again.'
              : 'Press Start in the camera view, then exercise. Reps and sets are counted automatically.';

  return (
    <Screen wide footer={
      <View style={styles.footer}>
        {frameConfig.error ? <Notice tone="error">{frameConfig.error}</Notice> : null}
        {elsewhere ? (
          <Notice tone="warning">
            Camera workout is open in another tab. This one starts by itself when that one is closed.
          </Notice>
        ) : null}
        {unreachable ? (
          <>
            <Notice tone="error">
              The camera coach isn&apos;t available on this computer. Start your local camera coach, then try again.
            </Notice>
            <Button title="Try again" variant="secondary" size="small" onPress={tryAgain} />
          </>
        ) : null}
        {notice ? <Notice tone="error">{notice}</Notice> : null}
        {save.isError ? <Notice tone="error">{`${errorMessage(save.error)} Nothing is lost, so you can try again.`}</Notice> : null}
        <Row style={styles.row}>
          {status ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.fill}>
              {status}
            </ThemedText>
          ) : (
            <View style={styles.fill} />
          )}
          <Button
            title={running ? 'Finish and save' : total > 1 ? `Save ${total} workouts` : 'Save workout'}
            onPress={finish}
            loading={busy}
            disabled={!loaded || (!running && !total)}
          />
        </Row>
      </View>
    }>
      <Stack.Screen options={{ title: 'Camera workout' }} />
      <PageIntro
        text="Exercise with the camera coach, then save counted sets to Activity. Movement and form reviews stay in this view."
        primary={<Button title="Discard" size="small" variant="quiet" disabled={busy || !loaded} onPress={() => void discard()} />}
      />
      <Card style={styles.cameraCard}>
        {claimed && !elsewhere && src ? (
          <iframe
            key={attempt}
            ref={frame}
            src={src}
            title="Camera coach"
            allow="camera; microphone; autoplay"
            style={{ border: 0, width: '100%', height: frameHeight, display: 'block', background: theme.background }}
          />
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 180 },
  cameraCard: { padding: 0, overflow: 'hidden' },
  footer: { gap: Spacing.two },
  row: { alignItems: 'center', flexWrap: 'wrap', gap: Spacing.three },
});
