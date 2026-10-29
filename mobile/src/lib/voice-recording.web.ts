/** Short browser recordings, converted to Parakeet's mono 16 kHz PCM16 format. */
export async function recordVoice(signal: AbortSignal, onSilence?: () => void) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Recording needs a supported browser on HTTPS or localhost.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
  let detector: AudioContext | undefined, frame = 0, heardSpeech = false, sampled = false;
  const close = () => { cancelAnimationFrame(frame); if (detector) void detector.close(); detector = undefined; stream.getTracks().forEach(track => track.stop()); };
  if (signal.aborted) { close(); throw new Error('Recording cancelled.'); }
  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 }); } catch (error) { close(); throw error; }
  let resolve!: (value: Blob) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<Blob>((yes, no) => { resolve = yes; reject = no; });
  // A cancellation can occur before the caller awaits stop().
  void done.catch(() => undefined);
  const cancel = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    close(); reject(new Error('Recording cancelled.'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => { close(); reject(new Error('Microphone recording failed.')); };
  recorder.onstop = () => {
    close(); signal.removeEventListener('abort', cancel);
    resolve(new Blob(chunks, { type: recorder.mimeType }));
  };
  if (onSilence) {
    try {
      detector = new AudioContext();
      const analyser = detector.createAnalyser(); analyser.fftSize = 1024;
      detector.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let lastSpeech = 0, started = 0;
      const detect = () => {
        sampled = true;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        const now = performance.now();
        if (rms > 0.018) { heardSpeech = true; if (!started) started = now; lastSpeech = now; }
        if (started && now - started > 250 && now - lastSpeech > 850) { onSilence(); return; }
        frame = requestAnimationFrame(detect);
      };
      frame = requestAnimationFrame(detect);
    } catch { if (detector) void detector.close(); detector = undefined; }
  }
  try { recorder.start(); } catch (error) { close(); signal.removeEventListener('abort', cancel); throw error; }
  return {
    cancel,
    hasSpeech: () => detector?.state === 'running' && sampled ? heardSpeech : null,
    stop: async () => {
      if (recorder.state !== 'inactive') recorder.stop();
      const blob = await done;
      if (signal.aborted) throw new Error('Recording cancelled.');
      const decoder = new AudioContext();
      let audio: AudioBuffer;
      try { audio = await decoder.decodeAudioData(await blob.arrayBuffer()); } finally { await decoder.close(); }
      const length = Math.min(320000, Math.floor(audio.duration * 16000));
      if (length < 1600) throw new Error('Record at least a short sentence.');
      const context = new OfflineAudioContext(1, length, 16000);
      const source = context.createBufferSource(); source.buffer = audio; source.connect(context.destination); source.start();
      const samples = (await context.startRendering()).getChannelData(0);
      if (signal.aborted) throw new Error('Recording cancelled.');
      const wav = new ArrayBuffer(44 + samples.length * 2), view = new DataView(wav);
      const label = (offset: number, value: string) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
      label(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); label(8, 'WAVE'); label(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      label(36, 'data'); view.setUint32(40, samples.length * 2, true);
      samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
      let binary = '';
      const bytes = new Uint8Array(wav);
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    },
  };
}
