type VoiceBridge = { postMessage: (message: Record<string, unknown>) => Promise<Record<string, unknown>> };
function bridge(): VoiceBridge | undefined {
  return (window as unknown as { webkit?: { messageHandlers?: { rhythmVoice?: VoiceBridge } } }).webkit?.messageHandlers?.rhythmVoice;
}
export function hasLocalVoice() { return typeof window !== 'undefined' && !!bridge(); }
async function request(action: string, payload: Record<string, unknown>, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Voice conversation stopped.');
  const native = bridge();
  if (!native) throw new Error('Local voice is only available in the Rhythm Mac app.');
  try {
    const response = await native.postMessage({ action, ...payload });
    if (signal.aborted) throw new Error('Voice conversation stopped.');
    return response;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Local voice is unavailable. Start the local voice service on this Mac and try again.');
  }
}
export async function transcribeLocal(audioBase64: string, signal: AbortSignal) {
  const result = await request('transcribe', { audioBase64 }, signal);
  if (typeof result.text !== 'string') throw new Error('Local transcription failed.');
  return { text: result.text };
}
export async function synthesizeLocal(text: string, signal: AbortSignal) {
  const result = await request('synthesize', { text: text.slice(0, 600) }, signal);
  if (typeof result.audioBase64 !== 'string') throw new Error('Local speech failed.');
  return { audioBase64: result.audioBase64, clipped: text.length > 600 };
}

export async function askLocalCoach(text: string, signal: AbortSignal) {
  const result = await request('coach', { text }, signal);
  if (typeof result.text !== 'string' || !result.text) throw new Error('Claude could not answer. Check your Claude Code sign-in.');
  return result.text;
}

export async function localClaudeReady(): Promise<boolean> {
  if (!hasLocalVoice()) return false;
  try {
    const result = await bridge()!.postMessage({ action: 'status' });
    return result.claudeLoggedIn === true;
  } catch { return false; }
}
