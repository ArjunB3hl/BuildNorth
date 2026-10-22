# MiniCPM-o 4.5 inference for Rhythm (Runpod)

Real-time video + audio coaching model for Rhythm: **MiniCPM-o 4.5, full-duplex streaming, served by the official
PyTorch backend of OpenBMB/MiniCPM-o-Demo, one worker on one 48 GB NVIDIA GPU, on a Runpod Pod**, behind an
authenticated HTTPS/WSS endpoint.

> **Status (22 Oct 2026): prepared, not deployed.** Everything below that needs no GPU and no paid resource is
> implemented and checked on CPU. The image has **not been built yet** (it is built by GitHub Actions, which needs this
> folder pushed), so there is **no image digest yet**. The model is **not staged** (needs a Runpod network volume and S3
> key). **Nothing has run on a GPU**, so start-up time, VRAM, latency and real-time behaviour are **unmeasured**: do not
> treat the deployment as working until the GPU test in section 8 has been run.

## 1. How it runs

```
Rhythm app ──HTTPS / WSS──> Runpod proxy (TLS) ──HTTP──> Caddy :8000   token check; the only public port
  https://<POD_ID>-8000.proxy.runpod.net                    │
                                                            └─> gateway   127.0.0.1:8006  (+ registry 127.0.0.1:8007)
                                                                  └─> worker    127.0.0.1:22400   (exactly one)
                                                                        └─> backend 127.0.0.1:22500  MiniCPM-o on GPU 0
admin: ssh root@<public IP> -p <mapped port>  (Runpod TCP 22, key only)
model: Runpod network volume at /workspace (staged once; never downloaded at start-up)
```

One container, started by `runtime/entrypoint.sh` under `tini` (Runpod Pods run no Docker Compose):

0. sshd (only if Runpod injects `PUBLIC_KEY`), first, so SSH works even when a later step fails.
1. **Preflight** (`runtime/preflight.py`): access token, Hugging Face offline mode, model directory and its manifest
   (revision, every file present with the right size; `MODEL_VERIFY=sha256` hashes them all), JSON configs, writable
   state/log/cache dirs, free disk, free local ports, GPU (driver ≥ R570, ≥ 40 GB VRAM, CUDA usable from PyTorch,
   compute capability ≥ 8.0). Any failure stops the container with an actionable message.
2. Caddy (`/healthz` 200, `/readyz` 503 until ready), after preflight because it needs a validated token.
3. Backend: loads the model; the entrypoint waits for its `/health` to say `ready` (`BACKEND_READY_TIMEOUT_S`: 900 s,
   2700 s when `TORCH_COMPILE=1`).
4. One worker and the gateway; both must answer `/health`, then the worker is registered with the gateway, which must
   list it as `idle`.
5. **Warm-up** (`runtime/warmup.py --no-queue`) through the full chain: a text turn and a 3-second video-duplex
   session, each closed and acknowledged with the reason the warm-up sent; a session the server closes or answers
   with another reason (e.g. `backend_error`, also during cleanup) fails it. Then the worker must report `idle` and
   the backend must hold no session (the warm-up session's cleanup is finished). Only then does the entrypoint write
   `/run/rhythm/ready`: `/readyz` turns 200, realtime traffic is accepted, and the log prints `READY`.
6. Supervision: if any process dies, everything is stopped and the container exits 1. With `RHYTHM_ON_FAILURE=hold`
   the model processes are stopped, `/readyz` drops to 503, and sshd (plus Caddy, if it had started) stays up for
   debugging. On SIGTERM (Runpod stop) tini signals every process at once; the entrypoint then waits for Caddy,
   gateway, worker and backend in turn and kills any that hang. The log pipes ignore the signal, so shutdown output is
   kept.

Each start writes `/workspace/rhythm/logs/<UTC time>-<pod id>/`: `startup.json` (seconds from container start to each
step), `preflight.json`, `warmup.json`, `config.json`, `gpu.csv` (nvidia-smi every second: VRAM, utilisation, power),
one log per process, and `FAILED` with the reason when start-up fails.

## 2. Backend choice

| | **PyTorch backend (selected)** | llama.cpp-omni (GGUF) |
|---|---|---|
| Source | OpenBMB/MiniCPM-o-Demo `py_backend` at a pinned commit | tc-mb/llama.cpp-omni + `openbmb/MiniCPM-o-4_5-gguf` |
| Weights | bf16 safetensors, lossless reference | Q4_K_M / Q8_0 / F16 quantised |
| Video in duplex | every frame of each 1 s chunk | first frame per chunk only |
| VRAM | ~21.5 GB after load; upstream asks for > 28 GB | ~9 GB (Q4_K_M), ~13 GB (Q8_0), ~20 GB (F16) |
| Fits | one 48 GB GPU (default target) | 24 GB GPUs (RTX 3090/4090), see section 12 |
| Upstream build | Python only, no CUDA compilation | compiled from unpinned `master` upstream |

The PyTorch backend is the official reference implementation of full-duplex streaming and uses all video frames, which
matters for exercise form. It is the only backend in this image. The demo's flash-attention and `torch.compile` paths
are optional upstream; this image uses PyTorch SDPA and leaves compile off (section 11).

## 3. Pinned versions

All pins live in `versions.env` (the CI build reads its build arguments from it) and the hash-locked requirement files.

| Item | Pin |
|---|---|
| Model | `openbmb/MiniCPM-o-4_5` @ `d59117d19ddb8a28a62f1b5f4e3b34ac48d510a4` (Apache-2.0, not gated; 54 files, 20.05 GB incl. `assets/token2wav` for speech output) |
| Serving code | `OpenBMB/MiniCPM-o-Demo` @ `47709a9210dfd71afa76c058e017fc8c4db5c8d2` (2026-09-15); **no license file upstream, so keep the image private** |
| Base image | `python:3.12.15-slim-bookworm@sha256:6a0e06f5ba0b373d051aabd3fffb9b873f27f9a2a3a14bcbe37dee6f0e3bbc70` (linux/amd64) |
| PyTorch | torch 2.8.0 + torchaudio 2.8.0, CUDA 12.8 wheels from PyPI; **host driver R570+** |
| Python packages | `requirements/requirements.lock`: 98 packages with sha256 hashes, resolved by uv 0.12.17 as of the demo commit date (transformers 4.51.0, accelerate 1.12.0, minicpmo-utils 1.0.6, librosa 0.11.0, numpy 2.5.3, onnxruntime 1.21.0, …) |
| Build tools | uv 0.12.17 wheel (sha256-pinned), setuptools 84.0.0 / wheel 0.48.0 / packaging 26.3 (hash-pinned build constraints) |
| Proxy | Caddy 2.11.7 linux_amd64 (sha512-checked) |
| CI actions | pinned by commit sha in `.github/workflows/minicpm-o-*.yml` |
| Image tag | `ghcr.io/arjunb3hl/rhythm-minicpm-o:0.1.0` (bump `IMAGE_VERSION` for every change; the workflow refuses to overwrite a published version). Deploy **by digest**. |

`docs/research-2026-10-22.json` records the sources behind these choices.

## 4. Files

```
versions.env                 every pin (model, demo commit, base image, torch/CUDA, image name/version)
docker/Dockerfile            the image (no weights, no secrets, no SSH host keys, no demo TLS key)
docker/patch_demo.py         build-time patch of the demo: more camera frames per second, coaching defaults, KV window
requirements/                requirements.in + overrides.txt -> requirements.lock (lock.sh), build constraints
runtime/entrypoint.sh        start order, readiness, supervision, shutdown
runtime/preflight.py         start-up checks with exit codes 2 config, 3 model, 4 GPU, 5 disk/ports
runtime/warmup.py            warm-up and the latency probe (same WebSocket protocol as the app)
runtime/write_config.py      the demo's config.json and the page's rhythm-config.js from environment variables
runtime/clip_eval.py         runs a staged test-clip set through the model (chat + duplex), writes results/summary
runtime/Caddyfile            token check, /healthz, /readyz, proxy to the gateway
scripts/stage_model.py       model staging to the network volume via Runpod's S3 API (+ requirements-stage.txt)
scripts/stage_clips.py       builds and stages a private test-clip set (policy, metadata stripping, checksums)
runpod/template.json         Runpod template (REST TemplateCreateInput)
runpod/pod.json              GPU Pod request (REST PodCreateInput)
runpod/rp.sh                 template / create / status / wait-ready / stop / start / set-image / verify-stopped / terminate / running
tests/                       CPU tests (section 13) and the stubs they use (demo processes, Runpod REST API)
.env.example                 every setting, placeholders only
../../.github/workflows/minicpm-o-image.yml        CPU validation + image build/push (GitHub-hosted runner)
../../.github/workflows/minicpm-o-stage-model.yml  model staging job (GitHub-hosted runner)
```

## 5. Inputs you provide (nothing here exists yet)

| # | Input | Where it goes | Paid? |
|---|---|---|---|
| 1 | Permission to push this folder and the two workflows to `ArjunB3hl/BuildNorth` (**public repo**: the files become public; no secrets are in them) | git push | no |
| 2 | (recommended) Repository secret `GHCR_TOKEN`: a classic PAT with only `write:packages`. The workflow pushes with it (GitHub's docs disagree on whether a package first pushed with `GITHUB_TOKEN` from a public repo starts public). Either way, the workflow first pushes a code-free placeholder and refuses to push the real image unless an anonymous pull of it is denied (the package must stay private: the demo code has no license, and public cannot be undone) | GitHub → Settings → Secrets → Actions | no (GHCR storage/bandwidth currently free) |
| 3 | A GitHub classic PAT with only `read:packages`, saved in Runpod → Credentials → Container Registry Auth (registry `ghcr.io`, username `ArjunB3hl`). Put its id into `.env` as `RUNPOD_REGISTRY_AUTH_ID` (`runpod/rp.sh registry-auths` lists ids); the template made by `rp.sh template` attaches it | Runpod | no |
| 4 | Runpod network volume: **30 GB in US-WA-1** (S3 API; RTX 6000 Ada offered there). A Pod can only use a volume in its own data centre | Runpod → Storage | **yes: 30 × $0.07 = $2.10/month**, billed until deleted |
| 5 | Runpod S3 API key (`user_…` + `rps_…`) as repository secrets `RUNPOD_S3_ACCESS_KEY_ID` / `RUNPOD_S3_SECRET_ACCESS_KEY`, and the same values in your local `.env` (clip staging, section 8a, runs on the Mac; the secret is shown only once, so save it when you create the key) | GitHub → Settings → Secrets → Actions; local `.env` | no |
| 6 | Runpod secret holding the output of `openssl rand -hex 32` (keep a copy in your password manager). Runpod's docs describe two naming conventions, and both work: a secret named `rhythm_api_token` (the template maps `{{ RUNPOD_SECRET_rhythm_api_token }}` into `RHYTHM_API_TOKEN`), or, where the console requires keys to start with `RUNPOD_SECRET_`, a secret named `RUNPOD_SECRET_RHYTHM_API_TOKEN` (the container reads it directly). A reference that does not resolve stops start-up with a clear message. For a published app, keep this token on Rhythm's backend rather than in the app bundle | Runpod → Credentials → Secrets | no |
| 7 | Runpod API key in `.env` as `RUNPOD_API_KEY` for `runpod/rp.sh`. A restricted key works if it allows read/write on Pods (create, get, list, stop, start, delete), Templates (create, get) and read on Container Registry Auth; a read-only key cannot create or stop Pods | your machine, never committed | no |
| 8 | (optional) Your SSH public key in Runpod → Settings → SSH Public Keys, for SSH administration | Runpod | no |
| 9 | Approval of the first GPU test (section 8) | — | **yes: about $1.25 on an RTX 6000 Ada, capped at $5** |
| 10 | (optional) Confirmation to include the 10 'confirm' clips in the test set (section 8a) | — | no |

## 6. Build the image (GitHub Actions, CPU runner)

The laptop never builds the image. After the folder is pushed (input 1):

1. GitHub → Actions → **minicpm-o image** → Run workflow (`push: true`).
   - `validate` job: shellcheck, Python syntax, the three locks re-resolve identically, Caddy config, demo config
     generation, preflight failure cases, Caddy auth matrix, entrypoint lifecycle, Hub listing of the pinned revision.
   - `image` job: first makes sure the package is private (pushes the placeholder tag `visibility-probe`, holding
     only a text file, and requires an anonymous pull of it to be refused; if the package is public it stops with
     instructions and nothing else is pushed). Then it frees runner disk, builds `linux/amd64` from
     `docker/Dockerfile` with the `versions.env` build args,
     runs `tests/image_smoke.sh` on the built image (architecture, pinned versions, the demo modules import on CPU,
     no weights/keys/TLS key/HF cache in the image, no secret-looking values in the layer history, the entrypoint's
     no-token and no-volume failures), and only then pushes `ghcr.io/arjunb3hl/rhythm-minicpm-o:<IMAGE_VERSION>`.
2. Copy the **pull-by-digest reference** from the job summary: `ghcr.io/arjunb3hl/rhythm-minicpm-o@sha256:…` → `IMAGE_REF`.
3. Optionally open the package settings link in the summary: it shows **Private** (already checked by the job).

Every push or PR that touches `inference/minicpm-o/` runs `validate` only. Expected image size: roughly 9–11 GB
unpacked (PyTorch + CUDA 12.8 libraries); the real size is printed by the workflow.

## 7. Stage the model (GitHub Actions, CPU runner, no Pod)

With the network volume (input 4) and the S3 secrets (input 5):

1. Actions → **minicpm-o stage model** → `volume_id`, `datacenter`, `mode: dry-run`: lists the 54 files to upload.
2. Same with `mode: stage`. Per file: download at the pinned revision, verify sha256 (LFS) or git blob id against the
   Hub listing, multipart upload (64 MiB parts: Runpod documents 500 MB, but its gateway refuses 256 MiB requests
   with HTTP 413), compare the uploaded size, delete the local
   copy. The runner needs free disk for one file (~5 GB). Files already on the volume at the right size are skipped,
   so after any failure just run it again. `.rhythm/manifest.json` (every file's size and hash) and, last,
   `.rhythm/COMPLETE.json` are written next to the model. Expected: ~20 GB, tens of minutes.
3. `mode: verify`: every object present at the expected size, manifest and completion marker present.

Result on the volume (and in the Pod): `/workspace/models/openbmb/MiniCPM-o-4_5/d59117d19ddb8a28a62f1b5f4e3b34ac48d510a4/`,
the image's default `MODEL_DIR`. The image sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`, so start-up can never
download; a missing or partial model stops start-up with exit code 3 and says to re-run staging.

The same script runs on any Linux CPU machine (`--target s3`, credentials from the environment, see `.env.example`),
or inside a Pod with `--target local --dest /workspace/models/...`.

## 8. First GPU test (proposed; NOT run; needs approval)

**Goal:** measure, on one 48 GB GPU, start-to-ready, model load, warm-up, peak VRAM, one-session streaming speed and
end-to-end latency, WebSocket behaviour through Runpod's proxy, and restart behaviour. Then stop and verify stopped.

| | |
|---|---|
| Image | `IMAGE_REF` (digest from section 6) |
| GPU | `NVIDIA RTX 6000 Ada Generation` (48 GB, Ada, about $0.99/h Secure Cloud). The cheaper RTX A6000 ($0.59/h) also meets every requirement; if the 6000 Ada keeps real-time pace with margin (measurement 4), an A6000 run of measurements 4–7 shows whether the cheaper GPU is enough for production |
| Location | Secure Cloud, US-WA-1 (the volume's data centre), network volume attached at `/workspace` (must be chosen at creation) |
| Start command | none (image entrypoint: `tini -g -- /opt/rhythm/runtime/entrypoint.sh`) |
| Ports | `8000/http` (public, via Runpod proxy), `22/tcp` (SSH) |
| Secrets | `RHYTHM_API_TOKEN={{ RUNPOD_SECRET_rhythm_api_token }}` (template env); registry auth id |
| Disk | container disk 50 GB (wiped on stop), pod volume 0 GB, network volume 30 GB |
| Settings | defaults (`TORCH_COMPILE=0`, `MODEL_VERIFY=size`, `WARMUP=1`) |
| Budget | expected ~1.25 h of GPU incl. the clip run ≈ **$1.25** on an RTX 6000 Ada; hard stop at 2 h; **cap $5** including retries |

Stop immediately (`rp.sh stop`) if: not ready after 40 min (with compile off, as in this test), the same step fails
twice, or the budget is reached.

```bash
cd inference/minicpm-o && set -a && . ./.env && set +a      # IMAGE_REF, RUNPOD_* (never committed)
runpod/rp.sh running                                         # expect: 0 pod(s) not stopped
# before any Pod exists: model staged (section 7: verify) and test clips staged (section 8a: --verify-only -> VERIFY OK)
runpod/rp.sh template                                        # once per image digest -> runpod/.template-id
RUNPOD_GPU_TYPES="NVIDIA RTX 6000 Ada Generation" runpod/rp.sh create   # asks to confirm; paid from here
runpod/rp.sh wait-ready                                      # (1) start-to-ready, as seen by a client
```

**Deploying from the Runpod console instead of `rp.sh create`.** Use exactly these settings; anything else in the
form stays at its default:

| Setting | Value |
|---|---|
| Cloud | Secure Cloud, On-Demand (not spot) |
| Network volume | the volume with the staged model (pick it first: it limits the choice to its data centre) |
| GPU | 1 × RTX 6000 Ada (48 GB); CUDA version filter 12.8 or newer (driver R570+; older drivers fail preflight) |
| Container image | `IMAGE_REF` from `.env`, the full `ghcr.io/arjunb3hl/rhythm-minicpm-o@sha256:…` reference |
| Registry credentials | the ghcr.io credential (`rhythm-ghcr`) |
| Container start command | empty (the image's entrypoint runs) |
| Container disk | 50 GB |
| Volume disk | 0 GB (the network volume is used instead) |
| Volume mount path | `/workspace` |
| Expose HTTP ports | `8000` |
| Expose TCP ports | `22` |
| Environment variables | only `RHYTHM_API_TOKEN` = the secret, chosen with the console's secret picker (e.g. `{{ RUNPOD_SECRET_rhythm_api_token }}`); a secret named `RUNPOD_SECRET_RHYTHM_API_TOKEN` also works without any variable |

Then give the Pod ID to `runpod/rp.sh wait-ready POD_ID`, `status POD_ID` and `stop POD_ID`. A Pod made in the
console is not in `runpod/.pod-id`, so pass its ID explicitly.

Measurements (SSH: `ssh root@<publicIp> -p <portMappings[22]>` from `rp.sh status`):

| # | Metric | How |
|---|---|---|
| 1 | Start-to-ready | `rp.sh wait-ready` (Pod created → `/readyz` 200, includes image pull); `startup.json` `marks_s.ready` (container start → ready) |
| 2 | Model load / warm-up | `startup.json`: `model_loaded − caddy_up` (load), `warmup_done − gateway_up` (warm-up); `warmup.json` |
| 3 | Peak VRAM | `python3 -c "import csv,sys; print(max(float(r[1]) for r in csv.reader(open(sys.argv[1]))), 'MiB')" /workspace/rhythm/logs/<run>/gpu.csv` after step 4 (covers load, warm-up and the session) |
| 4 | One-session speed (in the Pod) | `python /opt/rhythm/runtime/warmup.py --skip-chat --chunks 60 --frame-mode grid4 --json /workspace/rhythm/logs/probe-local.json` (what the page sends; `--frame-mode 1` for upstream's load): `backend_wall_clock_ms` mean/max (< 1000 ms per 1 s unit = keeps up with real time), `lag_after_last_chunk_s` |
| 5 | End-to-end latency (from the laptop, through the proxy) | `python runtime/warmup.py --url wss://<POD_ID>-8000.proxy.runpod.net/v1/realtime --token "$RHYTHM_API_TOKEN" --skip-chat --chunks 60 --json probe-proxy.json` (venv from `tests/requirements-tests.txt`); compare `first_event_s` and `lag_after_last_chunk_s` with #4; network baseline: `for i in 1 2 3 4 5; do curl -so /dev/null -w '%{time_total}\n' https://<POD_ID>-8000.proxy.runpod.net/healthz; done` |
| 6 | WebSocket through the proxy, session cap | #5 succeeding answers it; then `--chunks 130` (a session longer than Cloudflare's 100 s request limit must not be cut); then `--chunks 310 --timeout 60`: the gateway's 300 s cap must end it with `closed by the server: reason=timeout` (exit 1 is the expected result); then immediately run #5 again with `--chunks 5` and record whether the first attempt gets `session_failed` (the reconnect window in section 10) |
| 7 | Test clips (section 8a) | `python /opt/rhythm/runtime/clip_eval.py --clips /workspace/rhythm/test-clips/ready-2026-10-22 --out /workspace/rhythm/logs/clip-eval-1`: per clip, the chat answer (exercise, reps, form cue) and what the coach says unprompted in a streamed session, with per-chunk latency; `summary.md` for review. About 15 min of GPU for 46 clips (5.7 min of video, streamed in real time, plus the chat pass) |
| 8 | Restart | (a) `rp.sh stop` → `rp.sh start` → `rp.sh wait-ready`: second start-to-ready; `preflight.json` shows the staged files were reused (no download is possible offline). Runpod may have no GPU free on that host after a stop ("zero GPUs"); then `rp.sh terminate` and `rp.sh create` again: the network volume keeps the model. (b) Crash: `pkill -f py_backend.server` over SSH → the container logs `FATAL: backend exited` and exits 1; record whether Runpod restarts the container and how long until `/readyz` is 200 again |
| 9 | Stop and verify | `runpod/rp.sh stop` → must print `VERIFIED: … EXITED`; `runpod/rp.sh running` → `0 pod(s) not stopped`; Runpod console → Pods shows Exited. After the test, `runpod/rp.sh terminate` (the network volume and model stay) |

`create` refuses to start a Pod whose template runs a different image than `IMAGE_REF`, and shows the template and
image in its confirmation prompt.

Record per run: GPU type, data centre, image digest, the results above, and the cost from the Runpod billing page.

## 8a. Test clips (the animation libraries' Ready source videos)

The Ready clips' source footage (real people doing the movements the animations were made from) is the closest thing
to Rhythm's camera input available today, so the first GPU test also runs them through the model. They are staged to
the same private network volume, at `/workspace/rhythm/test-clips/<set>/`. They never go into the image or this
repository.

- **Set `ready-2026-10-22`: 46 clips, 104.6 MB, 343 s.** That is 41 of the 60 GameForge Ready clips plus the 5
  installed motion-library Ready clips. None has an audio track.
- **Policy** (`~/Documents/Aigame/motion/rhythm_test_clip_policy.json`, kept with the private library; `build`
  refuses to run without one, and `clips.json` records which policy file and hash were used):
  - Always left out: the 8 Mixkit clips (rule: any licence/origin mentioning Mixkit or Envato, whose recorded terms
    forbid AI/ML development use) and 1 clip that may show a minor.
  - Left out until the owner confirms (10): two XLH physical-therapy study clips, 7 research-participant clips, and
    one clip of a person with prosthetic legs. Rule: footage from study sources (figshare, Zenodo, Mendeley, MM-Fit,
    PLOS) is used only when that clip id is listed as confirmed and `--include-confirm` is given (56 clips then).
  - Only clips in the policy's `reviewed` list can be staged: a clip promoted to Ready later stops the build until
    someone reviews it.
- **Privacy and provenance:** container metadata is stripped on build, which removes a GPS tag found on one clip.
  `clips.json` keeps each clip's licence and attribution, so results can be traced back to their source. An upload
  deletes clips that are no longer in the set, and `--verify-only` flags extra clips or a changed manifest.
- **Not in the set:** the 8 clips that are Ready only in improved, uninstalled versions. Their footage would be the
  same; add them (after review) if wanted.

Stage the clips **before** creating the Pod (they go straight to the volume through the S3 API, no Pod needed):

```bash
cd inference/minicpm-o && set -a && . ./.env && set +a       # RUNPOD_S3_*, RUNPOD_VOLUME_ID, RUNPOD_DATACENTER
python3 -m venv "$TMPDIR/stage-venv" && "$TMPDIR/stage-venv/bin/pip" install -q --require-hashes -r scripts/requirements-stage.txt
# the 5 motion-library clips (about 28 MB) from your private dataset (MOTION_LIBRARY_REPO in .env; hf CLI logged in)
hf download "$MOTION_LIBRARY_REPO" --repo-type dataset --local-dir "$TMPDIR/motionlib" \
  --include gym/gym_curl_001.mp4 --include gym/gym_lateral_raise_001.mp4 --include gym/gym_reverse_lunge_dumbbell_001.mp4 \
  --include mobility/mobility_arm_circles_001.mp4 --include mobility/mobility_arm_swings_001.mp4
# build (needs ffmpeg; about 105 MB; the motion-library files are checked against the dataset manifest's sha256)
"$TMPDIR/stage-venv/bin/python" scripts/stage_clips.py build --out "$TMPDIR/rhythm-clips" \
  --policy ~/Documents/Aigame/motion/rhythm_test_clip_policy.json \
  --library ~/Documents/Aigame/ForgeData/library/animations \
  --motionlib-manifest ~/Documents/Aigame/motion-library/manifest.csv --motionlib-dir "$TMPDIR/motionlib" \
  --motionlib-id gym_curl_001 --motionlib-id gym_lateral_raise_001 --motionlib-id gym_reverse_lunge_dumbbell_001 \
  --motionlib-id mobility_arm_circles_001 --motionlib-id mobility_arm_swings_001
# upload (resumable, checksummed) and verify
"$TMPDIR/stage-venv/bin/python" scripts/stage_clips.py upload --src "$TMPDIR/rhythm-clips" --target s3 --set ready-2026-10-22
"$TMPDIR/stage-venv/bin/python" scripts/stage_clips.py upload --src "$TMPDIR/rhythm-clips" --target s3 --set ready-2026-10-22 --verify-only
```

`runtime/clip_eval.py` runs inside the Pod against the local gateway (measurement 7). It makes two passes per clip:
- **chat:** the whole mp4 plus a question; the answer is text only.
- **duplex:** the clip is streamed like the camera, one second of silence per second plus the clip's frames for that
  second as the page sends them (`--frame-mode`, default `grid4`, see section 10a; `1` = upstream's one frame; a
  last partial second repeats its last sample), then
  4 silent chunks, with the English voice (`--voice`). The model is forced to listen for the first 3 steps of a session.

It writes `results.jsonl`, `summary.json` and `summary.md`. `label_match` is only a keyword check against the
library name; read `summary.md` to judge the answers.

## 9. Stopping, and what keeps billing

**Closing SSH, closing the app, or stopping Python does not stop billing. Only stopping or terminating the Pod releases
the paid GPU.** A Pod in an error state may still incur charges: stop it.

```bash
runpod/rp.sh stop [POD_ID]            # POST https://rest.runpod.io/v1/pods/$POD_ID/stop, then verifies
runpod/rp.sh verify-stopped [POD_ID]  # exit 0 only when the Pod is EXITED/TERMINATED, or it is gone AND no Pod on the
                                      # account is running (a 404 can also mean a wrong or stale id)
runpod/rp.sh running                  # every Pod on the account that is not stopped; must be empty
runpod/rp.sh terminate [POD_ID]       # DELETE https://rest.runpod.io/v1/pods/$POD_ID (asks first)
```

Equivalents (from your machine, with your API key): console → Pods → ⋮ → Stop / Terminate; `runpodctl pod stop <id>`,
`runpodctl pod get <id> --output json` (`desiredStatus` must be `EXITED`). An SSH session in the Pod has neither
`runpodctl` nor the Pod's API key, so stop the Pod from outside it.

| Resource | After stop | After terminate | Billed while stopped |
|---|---|---|---|
| GPU | released | released | no |
| Container disk (50 GB: image layer, `/tmp`, `/run`) | wiped | deleted | no ($0.10/GB-month only while running) |
| Pod volume disk | none in this template (`volumeInGb: 0`) | — | — (would be $0.20/GB-month stopped) |
| Network volume (model, logs, caches, SSH host key) | kept | kept | **yes: $0.07/GB-month (30 GB ≈ $2.10/month) until you delete the volume** |
| Template, secrets, registry auth | kept | kept | no |
| GHCR image | kept | kept | no (currently free; GitHub gives notice before changes) |

Nothing in this folder deletes a network volume or any other resource. Delete the volume yourself in Runpod → Storage
when the model is no longer needed.

**Switching a running Pod to a new image** (keeps its GPU host, volume and URL; no new template needed):

```bash
runpod/rp.sh set-image POD_ID         # PATCH /pods/POD_ID with imageName=IMAGE_REF; asks first ('switch image')
runpod/rp.sh wait-ready POD_ID        # the Pod restarts: image pull + model load, about 5 min
```

The PATCH resets the Pod, and Runpod does not say whether settings left out of it are kept, so `set-image` sends every
setting back as it is (env, ports, disks, registry auth) with only the image changed, then reads the Pod again and
fails if anything else changed. Env values are compared by hash and never printed. The Pod keeps the template id it
was created from; run `rp.sh template` as well so new Pods get the same image.

## 10. Access

- REST/WebSocket base: `https://<POD_ID>-8000.proxy.runpod.net`; realtime: `wss://<POD_ID>-8000.proxy.runpod.net/v1/realtime?mode=video|audio|chat`
  (the demo's protocol: JSON frames; audio in 16 kHz float32 base64 ~1 s per chunk, frames base64 JPEG; audio out 24 kHz).
- Token (`RHYTHM_API_TOKEN`): `Authorization: Bearer <token>` (app/scripts); browsers open `/?access_token=<token>` once,
  which sets a `__Host-rhythm_token` cookie (`HttpOnly; Secure; SameSite=Strict`) and is then removed from the URL the
  gateway sees. Every `<pod>-<port>.proxy.runpod.net` host, including other people's Pods, is the same *site*, so the
  cookie is accepted only from this Pod's own origin (requests with another `Origin` or `Sec-Fetch-Site: same-site` /
  `cross-site` get 401). The token is stripped from headers, query and cookie before the gateway. Wrong/missing
  token: 401; before ready: 503.
- What the token opens: the realtime WebSocket and the demo's read-only pages and APIs (GET/HEAD only). Every other
  method gets 405 at Caddy, which blocks the demo's write endpoints (recording uploads to the volume, reference-voice
  uploads, queue/ETA edits, debug traces). The demo's `/api/admin/*` routes answer 404 (`ENABLE_PUBLIC_ADMIN` unset).
  The token is a single shared secret on every client: rotate it by changing the Runpod secret and restarting the Pod.
- `GET /healthz` (liveness) and `GET /readyz` (200 only after the warm-up) need no token and reveal nothing else.
- Language: the duplex model speaks in the language of its reference voice. The demo's default voice is Chinese, so
  this deployment makes the demo's English voice (`assets/ref_audio/ref_en_dlc_1.wav`) the default for sessions that
  send none (`RHYTHM_REF_AUDIO`); the app should also say "Always speak English." in its system prompt. A session can
  send its own voice as `voice.ref_audio_path` (a file in the image) or `voice.ref_audio_base64` (float32 16 kHz).
- Session limits (upstream gateway): one session at a time (others wait in a queue of `RHYTHM_MAX_QUEUE`, default 4);
  `mode=video` sessions end after **300 s** and `mode=audio` after 600 s with `{"type":"session.closed","reason":"timeout"}`.
  The model's conversation context ends with the session, so to continue a longer workout the app should end its own
  session first, at about 290 s: stop sending, wait for the answers to its last `input_id`, send `session.close`, wait
  for `session.closed`, then open a new session (re-sending its system prompt and duplex `config`). After a timeout or
  a dropped connection the worker needs about 0.2-2 s to clean up, and a session opened in that window gets
  `{"type":"error","error":{"code":"session_failed"}}`: reconnect with backoff (0.5, 1, 2, 4 s, up to about 15 s) on
  `session_failed` / `worker_busy`. Send the full duplex `config` in every `session.init`: the backend otherwise keeps
  the previous session's sampling settings. `RHYTHM_REQUEST_TIMEOUT_S` is an internal request timeout, not a
  session length.
- Internal ports 8006/8007/22400/22500 listen on 127.0.0.1 only; only 8000 (HTTP) and 22 (SSH, key only) are exposed.
- Session recording is off (`RHYTHM_RECORD_SESSIONS=0`).
- **Unverified:** Runpod documents its HTTP proxy (Cloudflare, 100 s limit on HTTP requests) but does not state
  WebSocket support. Measurement 6 checks it. If WebSockets fail or are cut, the fallback is a TCP port with TLS
  terminated in the container (Caddy `tls internal` with the client pinning the certificate) or a tunnel; that is
  not implemented here.

## 10a. Camera frames per second and coaching (the demo page)

Upstream's page sends **one camera frame per 1-second step**, which is too little to judge form during a movement.
`docker/patch_demo.py` patches the page at build time (each edit asserts the upstream text, so a changed upstream fails
the build): the page samples the camera every 1000/N ms and sends, per step, `RHYTHM_FRAME_MODE`:

| `RHYTHM_FRAME_MODE` | images per step | moments per second | model time per listening step (RTX 6000 Ada) |
|---|---|---|---|
| `1` (upstream) | 1 full frame | 1 | ~260 ms |
| `grid4` (default) | the current full frame + one 2x2 grid of the second's 4 samples (640 px each) | 5 | ~420 ms |
| `2` / `3` / `4` | N frames (640 px) | N | ~400 / not measured / ~790 ms |
| 8 (not offered) | | | ~1500 ms: no longer real time |

Each image costs about 150-190 ms of model time; a step must finish within 1 s, and a spoken answer needs headroom.
`grid4` gives five moments per second for the cost of two images, the way MiniCPM-o's own examples combine frames.
The app's own client can send the same thing: `frame_base64_list` takes several JPEGs per step. The page's "HD"
toggle (2 slices per image) is used only in mode `1`: with `grid4` it would be 6 slices per step, not real time.

**Session length and the KV window.** Every second adds to the model's KV cache: about 79 tokens with one image, about
145 with two (`grid4`, `2`), about 277 with four, plus a few dozen when the coach speaks. Upstream never prunes the
duplex cache in this demo, and the page stops a session when it reaches 8192 tokens, so a `grid4` session would end
after about 55 s (upstream's one frame: about 100 s). `docker/patch_demo.py` therefore turns on the model's own
**basic sliding window** in the backend: the system prompt and reference voice are kept, and when the cache passes
`RHYTHM_KV_WINDOW_HIGH` (6000) tokens the oldest seconds are dropped down to `RHYTHM_KV_WINDOW_LOW` (4500). With
`grid4` the coach then always sees the last ~30-40 s, and a page session runs until the gateway's 300 s cap (the page
logs "KV pruned" when it slides). `RHYTHM_KV_WINDOW=off` restores upstream; `context` is the model's other mode (it
carries a summary of dropped text). **Not yet measured on the GPU:** per-step time and answers after the window
slides.

Coaching defaults on the page: the "English Call" preset carries the Rhythm form-coaching prompt (greet briefly, watch
the body position, say if it is right or give one short correction, otherwise stay quiet), and the length-penalty
slider starts at 0.8 with a "Coach" preset button (upstream 1.1; lower = shorter turns). The page keeps its settings
under its own browser key (`omni_settings_rhythm1`), so values the unpatched page saved on the same Pod URL (1.1, HD,
an old prompt) are not restored. Pages and scripts are served with `Cache-Control: no-cache`, so a browser picks up a
new image or a changed `RHYTHM_FRAME_MODE` on the next reload. `/mobile-omni/` loads the same settings; `/omni` is the
page that was tested. Overrides, written at start-up by `write_config.py` (a bad value stops start-up with a message):
- `RHYTHM_COACH_PROMPT`: replaces the preset's prompt.
- `RHYTHM_DUPLEX_CONFIG`: JSON object of duplex settings sent with every session (keys: `temperature`, `top_k`,
  `top_p`, `listen_prob_scale` (> 1 = speaks less), `listen_top_k`, `length_penalty`, `decode_mode`,
  `text_repetition_penalty`, `text_repetition_window_size`), checked against the backend's ranges; the page's
  length-penalty slider wins over `length_penalty`. Example: `{"listen_prob_scale": 1.2}`.
- `RHYTHM_KV_WINDOW` (`basic` | `context` | `off`), `RHYTHM_KV_WINDOW_HIGH` / `RHYTHM_KV_WINDOW_LOW` (6000 / 4500;
  HIGH at most 7192, so one more second always fits under the page's 8192).

## 11. Start-up time vs `torch.compile`

`TORCH_COMPILE=0` (default): fastest, predictable start (load + warm-up). `TORCH_COMPILE=1`: upstream reports about
15 min of compilation on the first start (about 5 min warm), cached in `TORCHINDUCTOR_CACHE_DIR` on the network volume,
in exchange for faster per-unit inference. The compile runs inside the model load, so with `TORCH_COMPILE=1` the
default `BACKEND_READY_TIMEOUT_S` becomes 2700 s; set it higher if the first compile is slower than that, and poll
with `READY_TIMEOUT_S=3600 runpod/rp.sh wait-ready` (its default of 2400 s is meant for compile off). Measure the first GPU test without compile; try compile only if measurement 4 shows the
model cannot keep pace with real time.

## 12. 24 GB GPUs (RTX 3090)

Not supported by this image: preflight stops on GPUs under 40 GB with a message pointing here. The PyTorch stack
needs about 21.5 GB after load plus session peaks, so 24 GB is not assumed to fit. A 24 GB profile would be a
**separate image and a separate verification**: llama.cpp-omni pinned to `tc-mb/llama.cpp-omni@a64932ec615e1463158129feaf2f0752d0c07a2e`,
GGUF weights `openbmb/MiniCPM-o-4_5-gguf@db25077c33951fe163b42986fba0132e279872a2` (Q8_0 ~13 GB or Q4_K_M ~9 GB VRAM),
built with `CMAKE_CUDA_ARCHITECTURES=86` for the 3090 (upstream's Dockerfile builds `master` for 80/120 only), and
accepting first-frame-per-chunk video. Not built, not tested.

## 13. CPU validation (what has been checked without a GPU)

Run from this folder; the GitHub `validate` job runs the same.

```bash
bash tests/preflight_cases.sh                       # 28 cases: exit codes + messages, incl. stub 24 GB GPU / old driver
PATH="<venv>/bin:<caddy dir>:$PATH" bash tests/auth_matrix.sh        # 46 checks: real Caddyfile, HTTP + WebSocket,
                                                                     # cross-Pod cookie use, write methods
PATH="<venv>/bin:<caddy dir>:$PATH" bash tests/entrypoint_cases.sh   # 43 checks: real entrypoint + stub demo
PATH="<venv>/bin:$PATH" bash tests/probe_cases.sh                    # 15 checks: warm-up/probe client
PATH="<venv>/bin:$PATH" bash tests/clips_cases.sh                    # 28 checks: clip policy/build/upload/verify/eval
bash tests/image_smoke.sh <image ref>               # on a built image (CI)
```

Needs a GPU (not checkable here): model load on CUDA, VRAM, real-time factor, audio output quality, the image pull
on Runpod, the proxy's WebSocket behaviour, and restart behaviour on Runpod.

## 14. Troubleshooting

| Exit / message | Meaning |
|---|---|
| preflight exit 2 | token missing/invalid, offline flags overridden, bad setting |
| preflight exit 3 | model directory missing (volume not attached?), not staged, partial, wrong revision |
| preflight exit 4 | no GPU, driver older than R570, < 40 GB VRAM, CUDA unusable |
| preflight exit 5 | state dir not writable, disk full, port busy |
| `backend was not ready after …s` | model load slower than `BACKEND_READY_TIMEOUT_S` (or stuck): see `backend.log` |
| `the warm-up request failed` | model loaded but did not answer: see `warmup.json`, `backend.log` |
| `<proc> exited (status N) after startup` | a process died while serving: container exits 1 |

Set `RHYTHM_ON_FAILURE=hold` in the Pod's environment to keep the container alive after a failure, with SSH up (sshd
starts before everything else) and Caddy up if it had started (the GPU is still billed). Logs: Runpod console → Pod → Logs, and `/workspace/rhythm/logs/`.
