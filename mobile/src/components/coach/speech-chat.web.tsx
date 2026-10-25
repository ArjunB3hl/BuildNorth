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

export function SpeechChat() {
  const api = useApi(), queries = useQueryClient();
  const [phase, setPhase] = useState('Ready'), [error, setError] = useState('');
  const [transcript, setTranscript] = useState(''), [reply, setReply] = useState(''), [clipped, setClipped] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const epoch = useRef(0), busy = useRef(false), controller = useRef<AbortController | null>(null);
  const recorder = useRef<Awaited<ReturnType<typeof recordVoice>> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), release = useRef<(() => void) | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null), savedUrl = useRef('');

  const releaseTurn = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null; release.current?.(); release.current = null; busy.current = false;
  }, []);
  const stop = useCallback(() => {
    epoch.current++; controller.current?.abort(); recorder.current?.cancel(); recorder.current = null;
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
  async function play(url: string, ticket: number) {
    const player = new Audio(url); audio.current = player; setPhase('Speaking');
    player.onended = () => { if (ticket === epoch.current) { releaseTurn(); setPhase('Ready'); } };
    player.onerror = () => { if (ticket === epoch.current) { releaseTurn(); setPhase('Ready'); setError('Audio playback failed. Your reply is saved in text chat.'); } };
    try { await player.play(); } catch {
      if (ticket === epoch.current) { releaseTurn(); setPhase('Ready'); setError('Tap Play reply to allow audio in this browser.'); }
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
      const { text } = await api.voice.transcribe(recording, signal);
      if (ticket !== epoch.current) return;
      if (!text) throw new Error('No speech was detected. Try a little closer to the microphone.');
      setTranscript(text); setPhase('Thinking');
      const result = await api.coach.send(text, localDate(), signal, newKey());
      void queries.invalidateQueries({ queryKey: ['coach'] });
      void queries.invalidateQueries({ queryKey: ['calendar'] });
      if (ticket !== epoch.current) return;
      setReply(result.reply.content); setPhase('Preparing voice');
      const speech = await api.voice.speech(result.reply.id, signal);
      if (ticket !== epoch.current) return;
      const bytes = Uint8Array.from(atob(speech.audioBase64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      savedUrl.current = url; setAudioUrl(url); setClipped(speech.clipped);
      await play(url, ticket);
    } catch (failure) {
      if (ticket === epoch.current) { setError(errorMessage(failure)); setPhase('Ready'); releaseTurn(); }
    }
  }
  async function start() {
    if (busy.current) return;
    busy.current = true;
    const ticket = ++epoch.current, abort = new AbortController(); controller.current = abort;
    setError(''); setPhase('Starting'); setTranscript(''); setReply(''); setClipped(false);
    if (savedUrl.current) URL.revokeObjectURL(savedUrl.current);
    savedUrl.current = ''; setAudioUrl('');
    try {
      await acquire(ticket);
      if (ticket !== epoch.current) return;
      const capture = await recordVoice(abort.signal);
      if (ticket !== epoch.current) { capture.cancel(); return; }
      recorder.current = capture; setPhase('Recording');
      timer.current = setTimeout(() => void finish(ticket, abort.signal), 20_000);
    } catch (failure) {
      if (ticket === epoch.current) { setError(errorMessage(failure)); releaseTurn(); setPhase('Ready'); }
    }
  }
  async function replay() {
    if (busy.current) return;
    busy.current = true; const ticket = ++epoch.current; setError('');
    try { await acquire(ticket); if (ticket === epoch.current) await play(audioUrl, ticket); }
    catch (failure) { if (ticket === epoch.current) { setError(errorMessage(failure)); releaseTurn(); } }
  }
  return <Card style={{ gap: 12 }}>
    <Text type="subtitle">Voice Coach · Demo</Text>
    <Text type="small" themeColor="textSecondary">Parakeet → Claude → Kokoro · {phase}</Text>
    <Text>Record up to 20 seconds, then send. Your recording is processed by Rhythm’s speech service; the transcript and Coach reply are saved in your chat.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button title="Record message" disabled={phase !== 'Ready'} onPress={() => void start()} />
      {phase === 'Recording' ? <Button title="Send recording" onPress={() => controller.current && void finish(epoch.current, controller.current.signal)} /> : null}
      {phase !== 'Ready' ? <Button title="Stop" variant="secondary" onPress={stop} /> : null}
      {audioUrl && phase === 'Ready' ? <Button title="Play reply" variant="secondary" onPress={() => void replay()} /> : null}
    </View>
    {error ? <Notice tone="error">{error}</Notice> : null}
    {transcript ? <Text>You: {transcript}</Text> : null}
    {reply ? <Text>Coach: {reply}</Text> : null}
    {clipped ? <Notice tone="info">The first part is spoken. The full reply is shown above and saved in text chat.</Notice> : null}
  </Card>;
}
