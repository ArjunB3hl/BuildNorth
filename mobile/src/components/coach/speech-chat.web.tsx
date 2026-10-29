import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import { Button, Notice } from '@/components/form';
import { ThemedText as Text } from '@/components/themed-text';
import { Card, errorMessage } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { localDate } from '@/lib/dates';
import { newKey } from '@/lib/keys';
import { recordVoice } from '@/lib/voice-recording.web';
import { askLocalCoach, synthesizeLocal, transcribeLocal } from '@/lib/local-voice.web';

function voiceError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone access was denied. Allow microphone access for Rhythm in macOS settings.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone was found. Connect one and try again.';
  if (error instanceof Error && /^(No speech|Record at least|Recording needs|Microphone recording|Local voice|Local transcription|Local speech|Claude could not|Voice reply|End the camera)/.test(error.message)) return error.message;
  return errorMessage(error);
}

export function SpeechChat({ local = false }: { local?: boolean }) {
  const api = useApi(), queries = useQueryClient();
  const [phase, setPhase] = useState('Ready'), [error, setError] = useState('');
  const [transcript, setTranscript] = useState(''), [reply, setReply] = useState(''), [clipped, setClipped] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const epoch = useRef(0), busy = useRef(false), controller = useRef<AbortController | null>(null);
  const recorder = useRef<Awaited<ReturnType<typeof recordVoice>> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), release = useRef<(() => void) | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), savedUrl = useRef('');
  const localHistory = useRef<{ user: string; coach: string }[]>([]);
  const continuous = useRef(false), startNext = useRef<() => void>(() => {});

  const releaseTurn = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; release.current?.(); release.current = null; busy.current = false;
  }, []);
  const stop = useCallback(() => {
    continuous.current = false; epoch.current++; controller.current?.abort(); recorder.current?.cancel(); recorder.current = null;
    audio.current?.pause(); audio.current = null; releaseTurn(); setPhase('Ready');
  }, [releaseTurn]);
  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); if (savedUrl.current) URL.revokeObjectURL(savedUrl.current); };
  }, [stop]);
  async function acquire(ticket: number) {
    if (!navigator.locks) return;
    const held = await new Promise<boolean>((resolve, reject) => {
      void navigator.locks.request('buildnorth-camera-workout', { ifAvailable: true }, async lock => {
        if (!lock || ticket !== epoch.current) { resolve(false); return; }
        await new Promise<void>(done => { release.current = done; resolve(true); });
      }).catch(reject);
    });
    if (!held) throw new Error('End the camera workout or voice conversation in the other tab first.');
  }
  function listenAgain(ticket: number) {
    releaseTurn(); setPhase('Ready');
    // Let Web Locks finish releasing before asking for the next turn.
    setTimeout(() => { if (ticket === epoch.current && continuous.current) startNext.current(); }, 0);
  }
  async function play(url: string, ticket: number) {
    const player = new Audio(url); audio.current = player; setPhase('Speaking');
    player.onended = () => { if (ticket === epoch.current) listenAgain(ticket); };
    player.onerror = () => { if (ticket === epoch.current) { continuous.current = false; releaseTurn(); setPhase('Ready'); setError('Audio playback failed. Your reply is shown above.'); } };
    try { await player.play(); } catch {
      if (ticket === epoch.current) { continuous.current = false; releaseTurn(); setPhase('Ready'); setError('Tap Play reply to allow audio in this browser.'); }
    }
  }
  async function finish(ticket: number, signal: AbortSignal) {
    const capture = recorder.current;
    if (!capture || ticket !== epoch.current) return;
    recorder.current = null;
    if (timer.current) clearTimeout(timer.current);
    try {
      setPhase('Transcribing');
      const recording = await capture.stop();
      if (ticket !== epoch.current) return;
      const { text } = await (local ? transcribeLocal(recording, signal) : api.voice.transcribe(recording, signal));
      if (ticket !== epoch.current) return;
      if (!text.trim()) {
        if (local && continuous.current) { listenAgain(ticket); return; }
        throw new Error('No speech was detected. Try a little closer to the microphone.');
      }
      setTranscript(text); setPhase('Thinking');
      let replyText: string, speech: { audioBase64: string; clipped: boolean } | undefined;
      if (local) {
        const previous = localHistory.current.slice(-4).map(turn => `User: ${turn.user}\nCoach: ${turn.coach}`).join('\n');
        replyText = await askLocalCoach(`${previous}\nUser: ${text}`.slice(-4000), signal);
        localHistory.current = [...localHistory.current, { user: text, coach: replyText }].slice(-4);
      } else {
        const result = await api.coach.send(text, localDate(), signal, newKey());
        void queries.invalidateQueries({ queryKey: ['coach'] });
        void queries.invalidateQueries({ queryKey: ['calendar'] });
        if (ticket !== epoch.current) return;
        replyText = result.reply.content;
        speech = await api.voice.speech(result.reply.id, signal);
      }
      if (ticket !== epoch.current) return;
      setReply(replyText); setPhase('Preparing voice');
      if (local) speech = await synthesizeLocal(replyText, signal);
      if (!speech) throw new Error('Voice reply is unavailable.');
      if (ticket !== epoch.current) return;
      const bytes = Uint8Array.from(atob(speech.audioBase64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      if (savedUrl.current) URL.revokeObjectURL(savedUrl.current);
      savedUrl.current = url; setAudioUrl(url); setClipped(speech.clipped);
      await play(url, ticket);
    } catch (failure) {
      if (ticket === epoch.current) { continuous.current = false; setError(voiceError(failure)); setPhase('Ready'); releaseTurn(); }
    }
  }
  async function start() {
    if (busy.current) return;
    busy.current = true;
    const ticket = ++epoch.current, abort = new AbortController(); controller.current = abort;
    setError(''); setPhase('Starting');
    try {
      await acquire(ticket);
      if (ticket !== epoch.current) return;
      const capture = await recordVoice(abort.signal, local && continuous.current ? () => void finish(ticket, abort.signal) : undefined);
      if (ticket !== epoch.current) { capture.cancel(); return; }
      recorder.current = capture; setPhase('Recording');
      timer.current = setTimeout(() => {
        if (local && continuous.current && capture.hasSpeech() === false && ticket === epoch.current) {
          recorder.current = null; capture.cancel(); listenAgain(ticket);
        } else void finish(ticket, abort.signal);
      }, 20_000);
    } catch (failure) {
      if (ticket === epoch.current) { continuous.current = false; setError(voiceError(failure)); releaseTurn(); setPhase('Ready'); }
    }
  }
  useEffect(() => { startNext.current = () => void start(); });
  async function replay() {
    if (busy.current) return;
    busy.current = true; const ticket = ++epoch.current; setError('');
    try { await acquire(ticket); if (ticket === epoch.current) await play(audioUrl, ticket); }
    catch (failure) { if (ticket === epoch.current) { setError(voiceError(failure)); releaseTurn(); } }
  }
  return <Card style={{ gap: 12 }}>
    <Text type="subtitle">Voice Coach · Demo</Text>
    <Text type="small" themeColor="textSecondary">{local ? 'Local Parakeet → Claude Code via MCP → local Kokoro' : 'Parakeet → Claude → Kokoro'} · {local && phase === 'Recording' ? 'Listening' : phase}</Text>
    <Text>{local ? 'Speak naturally; the coach replies after a pause. Speech is processed on this Mac. Your transcript goes to the Claude account signed into Claude Code on this Mac. This conversation is not saved to your Rhythm chat.' : 'Record up to 20 seconds, then send. Your recording is processed by Rhythm’s speech service; the transcript and Coach reply are saved in your chat.'}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {local ? <Button title="Start conversation" disabled={phase !== 'Ready'} onPress={() => { continuous.current = true; void start(); }} /> : <Button title="Record message" disabled={phase !== 'Ready'} onPress={() => void start()} />}
      {phase === 'Recording' ? <Button title="Send recording" onPress={() => controller.current && void finish(epoch.current, controller.current.signal)} /> : null}
      {phase !== 'Ready' ? <Button title={local ? 'End conversation' : 'Stop'} variant="secondary" onPress={stop} /> : null}
      {audioUrl && phase === 'Ready' ? <Button title="Play reply" variant="secondary" onPress={() => void replay()} /> : null}
    </View>
    {error ? <Notice tone="error">{error}</Notice> : null}
    {transcript ? <Text>You: {transcript}</Text> : null}
    {reply ? <Text>Coach: {reply}</Text> : null}
    {clipped ? <Notice tone="info">The first part is spoken. The full reply is shown above.</Notice> : null}
  </Card>;
}
