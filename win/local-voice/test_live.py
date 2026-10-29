"""Live checks of the Windows local voice helper on this PC: the real Parakeet, Kokoro, microphone, speaker and Claude
Code, over real HTTP. Prints a JSON report (timings, memory, results). It speaks two short test sentences aloud.
Nothing it hears is printed except the test sentences it played itself.

    inference\\pose-coach\\.venv\\Scripts\\python.exe win\\local-voice\\test_live.py

Needs the models (tools/setup_voice_windows.sh). Takes about three minutes, most of it loading models and a 20-second
quiet period.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import io
import json
import secrets
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import service  # noqa: E402  (puts the pose-coach server folder on the path)
import onnx_speech  # noqa: E402

PHRASE = "Plan a short walk after lunch."
REPORT: dict = {}


def memory_mb(pid: int | None) -> int | None:
    """Working set of the process and its children (a venv's python.exe on Windows is a launcher that starts the real
    interpreter as its child)."""
    if not pid:
        return None
    ps = (f"$p = Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -eq {pid} -or $_.ParentProcessId -eq {pid} }}; "
          "[int](($p | Measure-Object WorkingSetSize -Sum).Sum / 1MB)")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout.strip()
    return int(out) if out.isdigit() else None


def memory() -> dict:
    import os
    return {"helper": memory_mb(os.getpid()), "parakeet_worker": memory_mb(getattr(service.stt._proc, "pid", None)),
            "kokoro_worker": memory_mb(getattr(service.tts._proc, "pid", None))}


class Client:
    def __init__(self, port: int, token: str):
        self.port, self.token = port, token

    def post(self, path: str, data: dict | None = None, headers: dict | None = None, auth: bool = True,
             timeout: float = 120, body: str | None = None) -> tuple[int, dict]:
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        h = {"Content-Type": "application/json", **({"Authorization": f"Bearer {self.token}"} if auth else {}),
             **(headers or {})}
        c.request("POST", path, body if body is not None else json.dumps(data or {}), h)
        r = c.getresponse()
        try:
            return r.status, json.loads(r.read() or b"{}")
        finally:
            c.close()


def timed(fn):
    t = time.monotonic()
    result = fn()
    return result, round(time.monotonic() - t, 2)


def wav16k(pcm: bytes) -> str:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm)
    return base64.b64encode(out.getvalue()).decode()


def words(text: str) -> set[str]:
    return {w.strip(".,!?").lower() for w in text.split()}


def security(c: Client) -> dict:
    nonce = secrets.token_hex(32)
    status, proof = c.post("/status", {"nonce": nonce}, auth=False)
    results = {"proof_matches": status == 200 and proof.get("proof") == hmac.new(
        c.token.encode(), nonce.encode(), hashlib.sha256).hexdigest()}
    cases = {
        "no_token": c.post("/info", auth=False),
        "wrong_token": c.post("/info", headers={"Authorization": "Bearer " + "b" * 64}, auth=False),
        "web_page_origin": c.post("/info", headers={"Origin": "http://127.0.0.1:8765"}),
        "evil_site_origin": c.post("/info", headers={"Origin": "https://example.com"}),
        "fetch_metadata": c.post("/info", headers={"Sec-Fetch-Site": "cross-site"}),
        "null_origin_iframe": c.post("/info", headers={"Origin": "null"}),
        "unknown_path": c.post("/token"),
        "oversized": c.post("/coach", body=json.dumps({"text": "x" * 1_100_000})),
    }
    hc = http.client.HTTPConnection("127.0.0.1", c.port, timeout=10)
    hc.putrequest("POST", "/info", skip_host=True)
    hc.putheader("Host", "rebind.example.com:%d" % c.port)
    hc.putheader("Authorization", f"Bearer {c.token}")
    hc.putheader("Content-Type", "application/json")
    hc.putheader("Content-Length", "2")
    hc.endheaders(b"{}")
    cases["dns_rebinding_host"] = (hc.getresponse().status, {})
    results.update({k: v[0] for k, v in cases.items()})
    results["all_refused"] = all(v[0] in (400, 403) for v in cases.values())
    return results


def main() -> None:
    token = secrets.token_hex(32)
    server = service.make_server(token, 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    c = Client(server.server_port, token)
    t0 = time.monotonic()
    service.stt.start()
    service.tts.start()
    while time.monotonic() - t0 < 300:
        if service.stt.status().get("ready") and service.tts.status().get("ready"):
            break
        time.sleep(1)
    s, k = service.stt.status(), service.tts.status()
    REPORT["startup"] = {"both_ready_s": round(time.monotonic() - t0, 1), "parakeet": s, "kokoro": k}
    REPORT["memory_mb_after_load"] = memory()
    REPORT["security"] = security(c)

    status, info = c.post("/info")
    REPORT["info"] = {"status": status, "transcription": info.get("transcription"), "speech": info.get("speech"),
                      "microphone_ok": info.get("microphone", {}).get("ok"), "claude": info.get("claude")}

    # Kokoro makes the sentence, Parakeet hears it back (no speaker or microphone)
    make = onnx_speech.speaker()
    (pcm, rate), kokoro_s = timed(lambda: make(PHRASE, "af_heart"))
    audio16 = onnx_speech.resample(pcm, rate, 16000)
    (status, heard), stt_s = timed(lambda: c.post("/transcribe", {"audioBase64": wav16k(audio16)}))
    REPORT["round_trip_files"] = {"kokoro_s": kokoro_s, "audio_s": round(len(pcm) / 2 / rate, 2),
                                  "transcribe_status": status, "transcribe_s": stt_s, "heard": heard.get("text"),
                                  "ok": {"short", "walk", "lunch"} <= words(heard.get("text", ""))}

    # Kokoro through the helper, on the speaker
    (status, spoke), speak_s = timed(lambda: c.post("/speak", {"text": "This is Rhythm, speaking on this PC."}))
    REPORT["speak"] = {"status": status, "seconds": speak_s, "result": spoke}

    # Acoustic: the speaker plays the sentence while the helper listens through the microphone
    def play_later():                                   # (through the helper's own player)
        time.sleep(1.5)
        service.audio.play([(pcm, rate)], threading.Event())
    player = threading.Thread(target=play_later)
    player.start()
    (status, heard), listen_s = timed(lambda: c.post("/listen", {"waitS": 12}))
    player.join()
    text = heard.get("text", "") if status == 200 else ""
    REPORT["round_trip_acoustic"] = {"status": status, "code": heard.get("code"), "seconds": listen_s,
                                     "heard_anything": heard.get("heard"), "word_count": len(text.split()),
                                     "heard_test_sentence": {"walk", "lunch"} & words(text) != set(),
                                     **({"heard": text} if {"walk", "lunch"} & words(text) else {})}

    # A quiet stretch: nothing heard after waitS, and nothing sent to Claude
    (status, heard), quiet_s = timed(lambda: c.post("/listen", {"waitS": 20}))
    REPORT["silence_20s"] = {"status": status, "code": heard.get("code"), "seconds": quiet_s,
                             "heard": heard.get("heard")}

    # Overlap and cancellation: a second job is refused while one runs; /cancel ends it
    results: dict = {}
    listening = threading.Thread(target=lambda: results.update(listen=timed(lambda: c.post("/listen", {"waitS": 30}))))
    listening.start()
    time.sleep(2)
    results["overlap"] = c.post("/coach", {"text": "hello"})
    t = time.monotonic()
    results["cancel"] = c.post("/cancel")
    listening.join()
    cancel_took = round(time.monotonic() - t, 2)
    (status, again), again_s = timed(lambda: c.post("/listen", {"waitS": 3}))
    (lstatus, lbody), lsec = results["listen"]
    REPORT["overlap_and_cancel"] = {"second_job": results["overlap"][0], "second_job_code": results["overlap"][1].get("code"),
                                    "cancel": results["cancel"], "listen_status": lstatus, "listen_code": lbody.get("code"),
                                    "stopped_within_s": cancel_took, "next_listen_status": status, "next_listen_s": again_s}

    # Claude Code as the helper runs it (clean environment): signed out here, so it must say so, quickly
    (status, answer), coach_s = timed(lambda: c.post("/coach", {"text": "How much water should I drink today?"}))
    REPORT["claude_coach"] = {"status": status, "code": answer.get("code"), "error": answer.get("error"),
                              "seconds": coach_s, **({"reply": answer.get("text")} if status == 200 else {})}

    # The MCP tool server, through a standard MCP client
    REPORT["mcp_tool"] = mcp_check()
    REPORT["memory_mb_after_use"] = memory()

    service.stt.stop()
    service.tts.stop()
    server.shutdown()
    print(json.dumps(REPORT, indent=2))


def mcp_check() -> dict:
    import asyncio
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    async def run():
        params = StdioServerParameters(command=sys.executable, args=[str(HERE / "reply_mcp.py")])
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                ok = await session.call_tool("speak_reply", {"text": "Drink a glass of water now."})
                bad = await session.call_tool("speak_reply", {"text": "x" * 700})
                return {"tools": [t.name for t in tools.tools], "call": ok.content[0].text, "call_error": ok.is_error,
                        "too_long_refused": bad.is_error}
    try:
        return asyncio.run(run())
    except Exception as e:  # noqa: BLE001 - reported, not raised
        return {"error": f"{type(e).__name__}: {e}"}


if __name__ == "__main__":
    main()
