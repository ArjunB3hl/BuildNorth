"""Private, bounded, single-inference Parakeet/Kokoro worker. No account data or LLM keys."""
import asyncio
import base64
from contextlib import asynccontextmanager
import hmac
import io
import json
import os
import threading
import wave

from fastapi import Depends, FastAPI, Header, HTTPException, Request

MAX_RECORDING = 900_000


def decode_wav(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
        with wave.open(io.BytesIO(raw), "rb") as wav:
            frames = wav.getnframes()
            if wav.getparams()[:3] != (1, 2, 16000) or not 1600 <= frames <= 320_000:
                raise ValueError()
            samples = wav.readframes(frames)
            if len(samples) != frames * 2:
                raise ValueError()
            return samples
    except (ValueError, TypeError, wave.Error, EOFError):
        raise HTTPException(422, "Expected 0.1–20 seconds of mono 16 kHz PCM16 WAV.") from None


class Models:
    def __init__(self):
        # Heavy dependencies belong only in this service, never the main API.
        import torch
        from nemo.collections.asr.models import ASRModel
        from kokoro import KPipeline

        self.torch = torch
        device = os.getenv("SPEECH_DEVICE", "cpu")
        if device not in {"cpu", "cuda"}:
            raise ValueError("SPEECH_DEVICE must be cpu or cuda")
        torch.set_num_threads(max(1, int(os.getenv("SPEECH_CPU_THREADS", "4"))))
        self.asr = ASRModel.from_pretrained(model_name="nvidia/parakeet-tdt-0.6b-v3", map_location=device).to(device).eval()
        self.tts = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device=device)
        # Download/warm the default voice before advertising readiness.
        list(self.tts("Ready.", voice="af_heart"))

    def transcribe(self, pcm):
        import numpy as np
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        with self.torch.inference_mode():
            output = self.asr.transcribe([audio], batch_size=1, verbose=False)
        first = output[0]
        return first.text if hasattr(first, "text") else str(first)

    def synthesize(self, text):
        import numpy as np
        pieces, count = [], 0
        with self.torch.inference_mode():
            for _, _, audio in self.tts(text, voice="af_heart"):
                samples = audio.detach().cpu().numpy()
                count += len(samples)
                if count > 24_000 * 90:
                    raise HTTPException(422, "Spoken reply exceeded 90 seconds.")
                pieces.append(samples)
        if not pieces:
            raise HTTPException(422, "No speech could be generated.")
        pcm = (np.clip(np.concatenate(pieces), -1, 1) * 32767).astype("<i2").tobytes()
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(pcm)
        return buffer.getvalue()


def create_app(model_factory=Models):
    lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        token = os.getenv("SPEECH_WORKER_TOKEN", "")
        if len(token) < 32:
            raise RuntimeError("Set SPEECH_WORKER_TOKEN to at least 32 random characters.")
        app.state.token = token
        app.state.models = await asyncio.to_thread(model_factory)
        yield
        app.state.models = None

    app = FastAPI(title="Rhythm private speech worker", lifespan=lifespan)

    def authorize(authorization: str = Header(default="")):
        if not hmac.compare_digest(authorization.encode(), f"Bearer {app.state.token}".encode()):
            raise HTTPException(401, "Unauthorized")

    async def body(request, limit):
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > limit:
                raise HTTPException(413, "Request too large")
        try:
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except ValueError:
            raise HTTPException(422, "Expected JSON") from None

    def infer(fn, value):
        # No unbounded queue: extra sessions get a retryable response.
        if not lock.acquire(blocking=False):
            raise HTTPException(429, "Speech worker busy")
        try:
            return fn(value)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Speech inference failed") from None
        finally:
            lock.release()

    @app.get("/health")
    def health():
        return {"ready": app.state.models is not None, "stt": "parakeet-tdt-0.6b-v3", "tts": "Kokoro-82M"}

    @app.post("/transcribe", dependencies=[Depends(authorize)])
    async def transcribe(request: Request):
        data = await body(request, MAX_RECORDING)
        pcm = decode_wav(data.get("audioBase64"))
        text = await asyncio.to_thread(infer, app.state.models.transcribe, pcm)
        return {"text": text}

    @app.post("/synthesize", dependencies=[Depends(authorize)])
    async def synthesize(request: Request):
        data = await body(request, 4096)
        text = data.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 600:
            raise HTTPException(422, "Provide 1–600 characters.")
        wav = await asyncio.to_thread(infer, app.state.models.synthesize, text)
        return {"audioBase64": base64.b64encode(wav).decode(), "mimeType": "audio/wav"}

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    return app


app = create_app()
