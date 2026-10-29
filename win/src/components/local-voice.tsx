import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  blocker,
  converse,
  loading,
  localVoiceClient,
  LocalVoiceError,
  type LocalVoiceInfo,
  type Phase,
  type Turn,
} from '../lib/local-voice';
import { Button, Card, Notice, Row, ThemedText } from './ui';
import { Spacing } from '../theme';

const client = localVoiceClient();

const PHASES: Record<Phase, string> = {
  listening: 'Listening… speak naturally; the coach answers after a pause.',
  thinking: 'Claude is answering…',
  speaking: 'Speaking…',
};

/**
 * Talk with the coach by voice on this PC: the local voice helper (win/local-voice) hears with Parakeet and speaks
 * with Kokoro, and the Claude account signed in to Claude Code on this PC answers. Works signed in or not; the
 * conversation stays on screen only.
 */
export function LocalVoiceCard() {
  const [info, setInfo] = useState<LocalVoiceInfo | null>(null);
  const [problem, setProblem] = useState('');
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [heard, setHeard] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState('');
  const conversation = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setProblem('');
    try {
      setInfo(await client.info());
    } catch (e) {
      setInfo(null);
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  const stop = useCallback(() => {
    const running = conversation.current;
    conversation.current = null;
    if (running) {
      running.abort();
      client.cancel();
    }
    setPhase(null);
  }, []);

  useEffect(() => {
    check();
    return () => stop();
  }, [check, stop]);

  // Models load for about a minute after the helper starts: check again until they are ready.
  useEffect(() => {
    if (!info || !loading(info) || blocker(info)) return;
    const timer = setTimeout(() => check(), 4000);
    return () => clearTimeout(timer);
  }, [info, check]);

  async function start() {
    if (conversation.current) return;
    const abort = new AbortController();
    conversation.current = abort;
    setError('');
    setHeard('');
    try {
      await converse(client, abort.signal, {
        phase: setPhase,
        heard: setHeard,
        replied: turn => setTurns(previous => [...previous, turn].slice(-4)),
      });
    } catch (e) {
      if (conversation.current === abort) setError(describe(e));
      if (e instanceof LocalVoiceError && e.code !== 'microphone_blocked') check();
    } finally {
      if (conversation.current === abort) {
        conversation.current = null;
        setPhase(null);
      }
    }
  }

  const missing = info ? blocker(info) : null;
  const ready = info != null && !missing && !loading(info);
  const claude = info?.claude;

  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold">Talk with Claude on this PC</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Local Parakeet → Claude Code through MCP → local Kokoro
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your voice is heard and spoken on this PC; no audio leaves it. Only the
        text of what you say, with the last few turns, goes to Claude through
        Claude Code. This voice conversation isn’t saved to Rhythm or your
        chat history, and it uses none of your Rhythm data.
      </ThemedText>
      {claude?.loggedIn ? (
        <Notice tone="info">
          {`Claude answers as ${claude.account ?? 'your Claude account'}${
            claude.plan ? ` (${claude.plan})` : ''
          }, the account signed in to Claude Code on this PC. No API key is used.`}
        </Notice>
      ) : null}
      {problem ? <Notice tone="warning">{problem}</Notice> : null}
      {missing ? <Notice tone="warning">{missing}</Notice> : null}
      {info && !missing && loading(info) ? (
        <Notice tone="info">Loading the speech models (about a minute)…</Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {phase ? <Notice tone="info">{PHASES[phase]}</Notice> : null}
      {turns.map((turn, i) => (
        <View key={i} style={styles.turn}>
          <ThemedText type="small">{`You: ${turn.user}`}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {`Coach: ${turn.coach}`}
          </ThemedText>
        </View>
      ))}
      {phase === 'thinking' && heard ? (
        <ThemedText type="small">{`You: ${heard}`}</ThemedText>
      ) : null}
      <Row style={styles.actions}>
        {phase ? (
          <Button title="End conversation" variant="secondary" onPress={stop} />
        ) : (
          <Button
            title="Start conversation"
            onPress={() => start()}
            disabled={!ready}
          />
        )}
        {!phase ? (
          <Button
            title="Check again"
            variant="quiet"
            loading={checking}
            onPress={() => check()}
          />
        ) : null}
      </Row>
    </Card>
  );
}

function describe(e: unknown) {
  if (e instanceof LocalVoiceError) {
    if (e.code === 'microphone_blocked')
      return 'Windows is blocking the microphone. Turn on Settings > Privacy & security > Microphone > Let desktop apps access your microphone, then start again.';
    if (e.code === 'no_microphone')
      return 'No microphone was found. Connect one and start again.';
    if (e.code === 'claude_unavailable')
      return `${e.message} Check that Claude Code is signed in (claude auth status in a terminal).`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  turn: { gap: 2 },
  actions: { flexWrap: 'wrap', gap: Spacing.two },
});
