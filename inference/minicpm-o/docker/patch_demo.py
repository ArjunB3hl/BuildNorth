"""Build-time patch of the upstream demo's browser client (OpenBMB/MiniCPM-o-Demo @47709a9) for Rhythm.

    python patch_demo.py /app

1. More video per second (static/omni/omni-app.js, live camera). Upstream sends ONE camera frame per 1-second step,
   too little to judge form during a movement. The page now samples the camera every 1000/N ms and sends, per step,
   either N frames or (default "grid4") the current full frame plus one 2x2 grid of the second's 4 samples: 5 moments
   per second for the cost of 2 images. Measured on an RTX 6000 Ada: ~260 ms model time per listening step with 1
   frame, ~420 ms with grid4 or 2 frames, ~790 ms with 4 frames, ~1500 ms with 8 (no longer real time).
2. Settings from the deployment (static/rhythm-config.js, written by the entrypoint from the environment): the frame
   mode, and duplex settings (e.g. listen_prob_scale) merged under the page's own length-penalty slider.
3. Coaching defaults: the "English Call" preset gets the Rhythm form-coaching prompt, and the length-penalty slider
   starts at 1.0 (upstream 1.1 was too chatty for coaching; 0.8 made replies too short: tried on the GPU). The page
   saves its settings under its own localStorage key, so values saved by the unpatched page (length penalty 1.1, HD, an old prompt) on the same origin do not come back.
   HD (2 slices per image) is used only with one frame per step: with grid4 it would be 6 slices per step.
4. A bounded duplex KV cache (core/processors/unified.py). Upstream never prunes it in this demo, and the page stops a
   session when it reaches 8192 tokens: each listening second costs ~79 tokens with one image and ~145 with two, so a
   grid4 session would end after ~55 s. The backend now uses the model's "basic" sliding window (the system prompt and
   reference voice are kept; the oldest seconds are dropped when the cache passes RHYTHM_KV_WINDOW_HIGH tokens, down
   to RHYTHM_KV_WINDOW_LOW). RHYTHM_KV_WINDOW=off restores upstream; "context" is the model's other mode.
5. /mobile-omni/ loads the same rhythm-config.js and starts at 1.0 (it runs the same patched omni-app.js).

Every edit asserts that the upstream text is exactly as expected, so a changed upstream fails the build instead of
being patched wrongly.
"""
import json
import pathlib
import sys

APP = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/app")

COACH_PROMPT = ("You are Rhythm, a personal fitness coach watching me through the camera. Always speak English. Greet me "
                "briefly when we start. Your job is to coach my form: watch my body position and movement. When you "
                "speak, use one or two short sentences: say what you see and give one concrete cue that names the body "
                "part and what to change or keep doing, for example \"Nice plank, keep your hips level with your "
                "shoulders and squeeze your glutes\" or \"Your knees are drifting in; push them out over your toes.\" "
                "If something is wrong, correct it, then watch whether I fix it before the next cue. When my form is "
                "good, say so with a specific reason now and then, not every rep. Don't just name the exercise or "
                "describe the room, don't lecture, and don't repeat a cue I've already fixed. If I ask a question, "
                "answer in one or two sentences.")


def edit(rel: str, pairs: list[tuple[str, str]]) -> None:
    p = APP / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f"patch_demo: {rel}: expected exactly one match, found {n}: {old[:80]!r}")
        s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")
    print(f"patch_demo: patched {rel}")


SAMPLER = r'''
    // --- Rhythm: several camera samples per 1-second step (see docker/patch_demo.py) ---
    _rhythmMode() {
        const m = String(((window.RHYTHM_CONFIG || {}).frameMode) || 'grid4');
        return /^(grid4|[1-4])$/.test(m) ? m : 'grid4';
    }

    _rhythmStartSampling() {
        const mode = this._rhythmMode();
        const n = mode === 'grid4' ? 4 : parseInt(mode, 10);
        this._rhythmBuf = [];
        this._rhythmN = n;
        if (this._rhythmTimer) clearInterval(this._rhythmTimer);
        this._rhythmTimer = n > 1 ? setInterval(() => this._rhythmSample(), Math.round(1000 / n)) : null;
    }

    _rhythmStopSampling() {
        if (this._rhythmTimer) clearInterval(this._rhythmTimer);
        this._rhythmTimer = null;
        this._rhythmBuf = [];
    }

    _rhythmSample() {
        const v = this._videoEl;
        if (!v || !v.videoWidth) return;
        const w = Math.min(640, v.videoWidth);
        const h = Math.round(v.videoHeight * w / v.videoWidth);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (_globalMirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        ctx.drawImage(v, 0, 0, w, h);
        this._rhythmBuf.push(c);
        while (this._rhythmBuf.length > this._rhythmN) this._rhythmBuf.shift();
    }

    _rhythmFrames(mainB64) {
        const mode = this._rhythmMode();
        const buf = (this._rhythmBuf || []).slice();
        this._rhythmBuf = [];
        if (mode === '1' || buf.length === 0) return mainB64 ? [mainB64] : [];
        if (mode !== 'grid4') {
            const want = parseInt(mode, 10);
            const out = buf.slice(-want).map(c => c.toDataURL('image/jpeg', 0.7).split(',')[1]);
            return out.length ? out : (mainB64 ? [mainB64] : []);
        }
        // grid4: the current full frame + one 2x2 grid of this second's samples (oldest top-left)
        while (buf.length < 4) buf.unshift(buf[0]);
        const cw = buf[0].width, ch = buf[0].height;
        const g = document.createElement('canvas');
        g.width = cw * 2; g.height = ch * 2;
        const gctx = g.getContext('2d');
        buf.slice(-4).forEach((c, k) => gctx.drawImage(c, (k % 2) * cw, Math.floor(k / 2) * ch, cw, ch));
        const grid = g.toDataURL('image/jpeg', 0.7).split(',')[1];
        return mainB64 ? [mainB64, grid] : [grid];
    }
'''


def main() -> None:
    # 1. multi-frame capture in the live camera provider
    edit("static/omni/omni-app.js", [
        ("""                if (!this.running) return;
                const frameB64 = this._captureFrame();
                if (this.onChunk) this.onChunk({ audio: e.data.audio, frameBase64: frameB64 });""",
         """                if (!this.running) return;
                const frameB64 = this._captureFrame();
                const frameList = this._rhythmFrames(frameB64);
                if (this.onChunk) this.onChunk({ audio: e.data.audio, frameBase64: frameB64, frameBase64List: frameList });"""),
        ("""        this._connectAudioPipeline();
        this.running = true;
        this._previewing = false;""",
         """        this._connectAudioPipeline();
        this.running = true;
        this._rhythmStartSampling();
        this._previewing = false;"""),
        ("""    stop() {
        this.running = false;
        _omniStopWaveform();""",
         """    stop() {
        this.running = false;
        this._rhythmStopSampling();
        _omniStopWaveform();"""),
        ("""    getVideoElement() { return this._videoEl; }
}

const FILE_MAX_DURATION = 120; // 2 minutes""",
         """    getVideoElement() { return this._videoEl; }
""" + SAMPLER + """}

const FILE_MAX_DURATION = 120; // 2 minutes"""),
        # send the whole list (file playback keeps sending its single frame)
        ("""                    if (chunk.frameBase64) msg.frame_base64_list = [chunk.frameBase64];""",
         """                    if (chunk.frameBase64List && chunk.frameBase64List.length) msg.frame_base64_list = chunk.frameBase64List;
                    else if (chunk.frameBase64) msg.frame_base64_list = [chunk.frameBase64];"""),
        # 3. own settings key: the unpatched page saved 1.1 etc. under 'omni_settings' on this origin
        ("""const settingsPersistence = new SettingsPersistence('omni_settings', [""",
         """const settingsPersistence = new SettingsPersistence('omni_settings_rhythm2', [  // Rhythm: see docker/patch_demo.py"""),
        # 3. HD only with one image per step (camera frame mode 1, or file playback); the hint says so
        ("""    if (hint) hint.textContent = active ? '192 tok' : '64 tok';
}

function getEffectiveMaxSliceNums() {
    return _hdToggleActive ? 2 : 1;
}""",
         """    if (hint) hint.textContent = active ? (_rhythmHdAllowed() ? '192 tok' : 'HD: frame mode 1 only') : '64 tok';
}

// Rhythm: HD = 2 slices per image; with several camera images per step that is no longer real time (docker/patch_demo.py)
function _rhythmHdAllowed() {
    return currentMode === 'file' || String(((window.RHYTHM_CONFIG || {}).frameMode) || 'grid4') === '1';
}

function getEffectiveMaxSliceNums() {
    return _hdToggleActive && _rhythmHdAllowed() ? 2 : 1;
}"""),
        # 2. deployment duplex settings under the page's slider
        ("""        config: { length_penalty: parseFloat(document.getElementById('omniLengthPenalty').value) || 1.0 },""",
         """        config: Object.assign({}, ((window.RHYTHM_CONFIG || {}).duplexConfig) || {},
                              { length_penalty: parseFloat(document.getElementById('omniLengthPenalty').value) || 1.0 }),"""),
    ])
    # 2. load the deployment config before the app
    edit("static/omni/omni.html", [
        ("""<script src="/static/ref-audio-player.js"></script>""",
         """<script src="/static/rhythm-config.js"></script>
<script src="/static/ref-audio-player.js"></script>"""),
        # 3. shorter turns by default, with a preset button for it
        ("""id="omniLengthPenalty" value="1.1\"""", """id="omniLengthPenalty" value="1\""""),
        ("""<button type="button" class="lp-preset-btn active" data-lp="1.1" title""",
         """<button type="button" class="lp-preset-btn" data-lp="1.1" title"""),
        ("""                        <div style="display:flex;align-items:center;gap:6px;">
                            <button type="button" class="lp-preset-btn" data-lp="1.2" title""",
         """                        <div style="display:flex;align-items:center;gap:6px;">
                            <button type="button" class="lp-preset-btn active" data-lp="1" title="Coach — one or two short sentences with a cue">Coach</button>
                            <span style="font-size:10px;color:#999;">One or two sentences with a cue (Rhythm default)</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;">
                            <button type="button" class="lp-preset-btn" data-lp="1.2" title"""),
    ])
    # 5. the mobile page runs the same omni-app.js
    edit("static/mobile-omni/index.html", [
        ("""<script src="/static/ref-audio-player.js"></script>""",
         """<script src="/static/rhythm-config.js"></script>
<script src="/static/ref-audio-player.js"></script>"""),
        ("""id="omniLengthPenalty" value="1.1\"""", """id="omniLengthPenalty" value="1\""""),
        ("""class="lp-preset-btn active" data-lp="1.1">""", """class="lp-preset-btn" data-lp="1.1">"""),
    ])
    # 4. bounded duplex KV cache (the backend process inherits the container environment; write_config.py validates it)
    edit("core/processors/unified.py", [
        ("""                "force_listen_count": self.duplex_config.force_listen_count,
            },
            device=self.device,
            chat_vocoder=self.chat_vocoder,""",
         """                "force_listen_count": self.duplex_config.force_listen_count,
                # Rhythm (docker/patch_demo.py): bound the duplex KV cache
                "sliding_window_mode": os.environ.get("RHYTHM_KV_WINDOW") or "basic",
                "basic_window_high_tokens": int(os.environ.get("RHYTHM_KV_WINDOW_HIGH") or "6000"),
                "basic_window_low_tokens": int(os.environ.get("RHYTHM_KV_WINDOW_LOW") or "4500"),
            },
            device=self.device,
            chat_vocoder=self.chat_vocoder,"""),
    ])
    # 3. English preset carries the coaching prompt (a JSON string is a valid YAML double-quoted scalar)
    edit("assets/presets/omni/english_call.yaml", [
        ('system_prompt: "Streaming Omni Conversation."', "system_prompt: " + json.dumps(COACH_PROMPT)),
    ])
    # default config; the entrypoint rewrites it from the environment at start-up
    (APP / "static" / "rhythm-config.js").write_text(
        "window.RHYTHM_CONFIG = " + json.dumps({"frameMode": "grid4", "duplexConfig": {}}) + ";\n", encoding="utf-8")
    print("patch_demo: wrote static/rhythm-config.js (defaults)")


if __name__ == "__main__":
    main()
