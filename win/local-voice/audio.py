"""The microphone and the speaker for the Windows voice helper. React Native for Windows has no audio capture or playback,
so the helper does both: it records one utterance at a time with Silero VAD deciding when the user has finished, and
plays the coach's reply. Half-duplex: the microphone is closed while the reply plays, so the coach never hears itself.

Nothing here is written to disk or logged: audio stays in memory until it is transcribed or played.

    listen(cancel, wait_s, max_s)   one utterance as PCM16 at 16 kHz, or None after wait_s without speech
    play(chunks, cancel)            plays (pcm16, rate) chunks in order; False when cancelled
    microphone()                    the default input device's name, or an error
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "inference" / "pose-coach" / "server"))
import onnx_speech  # noqa: E402

RATE = onnx_speech.RATE
WINDOW = 512                    # Silero's window at 16 kHz (32 ms)
PAUSE_S = 0.85                  # quiet after speech that ends an utterance (the Mac page used 850 ms too)
MIN_SPEECH_S = 0.25             # shorter sounds are not speech (a cough, a click)
BLOCKED_AFTER_S = 1.5           # this long of exact digital silence: Windows is blocking the microphone
MAX_UTTERANCE_S = 15.0


class Cancelled(Exception):
    """Stopped by /cancel (the user pressed Stop)."""


class MicrophoneError(Exception):
    """No usable microphone. `code` is "no_microphone" (none, or it could not be opened) or "microphone_blocked" (it
    opened but only gives digital silence: Windows' privacy setting for desktop apps, or a hardware mute switch)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _sd():
    import sounddevice
    return sounddevice


def microphone() -> dict:
    try:
        sd = _sd()
        device = sd.query_devices(kind="input")
        return {"ok": True, "name": str(device.get("name", ""))[:120]}
    except Exception as e:  # noqa: BLE001 - PortAudio reports a missing device in several ways
        return {"ok": False, "error": f"No microphone was found ({type(e).__name__})."}


def blocked(frames_seen: int, loud_frames: int) -> bool:
    """A real microphone always has some noise; a blocked one gives exact zeros."""
    return loud_frames == 0 and frames_seen >= int(BLOCKED_AFTER_S * RATE)


class Utterance:
    """Feeds windows of float32 audio to the VAD and says when an utterance is complete. Separate from the device so the
    pause rules can be tested with synthetic audio."""

    def __init__(self, detector, wait_s: float, max_s: float):
        self.detector = detector
        self.wait_s = wait_s
        self.max_s = max_s
        self.frames = 0
        self.nonzero = 0
        self.speech_since: float | None = None      # when the speech going on now started (None: no speech now)

    def feed(self, window) -> bytes | None:
        """One window; the utterance's PCM16 once the VAD has seen it end, else None."""
        import numpy as np
        self.frames += len(window)
        if np.any(window):
            self.nonzero += 1
        self.detector.accept_waveform(window)
        # (a blip the VAD drops as too short ends here too, so the quiet stretch goes on counting)
        if not self.detector.is_speech_detected():
            self.speech_since = None
        elif self.speech_since is None:
            self.speech_since = self.frames / RATE
        if not self.detector.empty():
            return self._take()
        return None

    def _take(self) -> bytes:
        # (`front` is a view of the queue's first segment: its samples must be copied before pop() frees them)
        import numpy as np
        samples = np.array(self.detector.front.samples, dtype=np.float32)
        self.detector.pop()
        return onnx_speech.to_pcm16(samples)

    @property
    def seconds(self) -> float:
        return self.frames / RATE

    def gave_up(self) -> bool:
        """wait_s passed with no utterance and nobody speaking now: the caller answers "nothing heard" and the app
        listens again."""
        return self.speech_since is None and self.seconds >= self.wait_s

    def too_long(self) -> bool:
        return self.speech_since is not None and self.seconds - self.speech_since >= self.max_s + 1

    def flush(self) -> bytes | None:
        self.detector.flush()
        return None if self.detector.empty() else self._take()


def listen(cancel: threading.Event, wait_s: float = 20.0, max_s: float = MAX_UTTERANCE_S) -> bytes | None:
    sd = _sd()
    detector = onnx_speech.vad(min_silence_s=PAUSE_S, min_speech_s=MIN_SPEECH_S, max_speech_s=max_s)
    utterance = Utterance(detector, wait_s, max_s)
    try:
        stream = sd.InputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=WINDOW)
    except Exception as e:  # noqa: BLE001
        raise MicrophoneError("no_microphone", f"The microphone could not be opened ({type(e).__name__}).") from None
    with stream:
        while True:
            if cancel.is_set():
                raise Cancelled()
            data, _overflow = stream.read(WINDOW)
            pcm = utterance.feed(data[:, 0].copy())
            if pcm:
                return pcm
            if blocked(utterance.frames, utterance.nonzero):
                raise MicrophoneError(
                    "microphone_blocked",
                    "Windows is giving this app silence instead of microphone audio. Turn on Settings > Privacy & "
                    "security > Microphone > Let desktop apps access your microphone, and check any mute switch.")
            if utterance.gave_up():
                return None
            if utterance.too_long():
                return utterance.flush()


def play(chunks, cancel: threading.Event) -> bool:
    """Plays (pcm16 bytes, rate) chunks as they come (the first sentence is heard while the next is made)."""
    import numpy as np
    sd = _sd()
    stream = None
    try:
        for pcm, rate in chunks:
            if cancel.is_set():
                return False
            if stream is None or stream.samplerate != rate:
                if stream is not None:
                    stream.stop(); stream.close()
                stream = sd.OutputStream(samplerate=rate, channels=1, dtype="int16")
                stream.start()
            audio = np.frombuffer(pcm, dtype="<i2")
            for start in range(0, len(audio), 2048):          # small blocks, so Stop is heard within ~0.1 s
                if cancel.is_set():
                    return False
                stream.write(audio[start:start + 2048].reshape(-1, 1))
        if stream is not None:
            time.sleep(stream.latency or 0.05)                # let the last block reach the speaker
        return True
    finally:
        if stream is not None:
            stream.stop(); stream.close()
