# Local voice and camera coach for the Windows app

Two opt-in, developer-run features of the Rhythm Windows app (`win/`), the Windows counterpart of the Mac prototype on
`codex/mac-local-voice-camera` (6ea3c40):

- **Coach → Talk with Claude on this PC.** Parakeet hears you, the Claude account signed in to **Claude Code** on this
  PC answers through one MCP tool, and Kokoro speaks the answer. It takes turns by itself: listen, notice the pause,
  answer, listen again. A quiet stretch just keeps listening (nothing is sent to Claude); *End conversation* stops it.
- **Calendar → Camera workout.** The local camera coach (`inference/pose-coach`) runs in the app's WebView2, counts
  your reps, and the app saves the workout as an Activity session, as the website does. The page's *Auto* coach
  prefers your Rhythm account's ElevenLabs agent when one is connected, then Claude Code on this PC, then the
  engine's own cues; the picker in the page can choose one by hand.

Neither needs an API key, and neither uses one: Claude Code is started with every `ANTHROPIC_*`/`CLAUDE*` variable
removed, and only a Claude account sign-in (`authMethod` `claude.ai`) counts as signed in.

## What runs where, and what is kept

| | Coach voice | Camera workout |
|---|---|---|
| Microphone audio | Recorded and transcribed on this PC (Parakeet). Never leaves it, never saved | The page's microphone audio goes to the camera server on this PC for Parakeet. Never saved |
| Camera | – | Pose detection in the WebView (MediaPipe). No images leave the PC or are saved |
| Sent to Claude (as text, through Claude Code) | What you said and the last four turns (≤ 4,000 characters) | Measured workout events, and your spoken questions |
| Spoken by | Kokoro on this PC | Kokoro on this PC, or the ElevenLabs agent's own voice |
| Saved to Rhythm | Nothing: the conversation is shown on screen only and isn't in your chat history | The finished workout (exercises, sets, reps), as an Activity session |
| Logs | None: the helper logs no requests, audio or text | None with `camera.ps1` (`POSE_COACH_LOG=0`). *Save set for debugging* (off by default) keeps body landmarks, no images, in `inference/pose-coach/.data/windows-app/`; delete that folder to remove them |

Your Rhythm data isn't given to Claude by either feature: the voice coach has no Rhythm tools, and the camera page
gets no sign-in (only the app talks to the Rhythm API, as the signed-in user, with its usual authorization).

## Setup (once)

In Git Bash, from the repository root:

```bash
cd inference/pose-coach && bash tools/setup_voice_windows.sh
```

It makes `inference/pose-coach/.venv` with Python 3.11 (`py -3.11`) and downloads the models into
`inference/pose-coach/.data/sherpa` (git-ignored), each checked against GitHub's SHA-256, then has Kokoro say a
phrase that Parakeet must hear back. About 840 MB of downloads and 1.2 GB on disk, plus 210 MB of Python packages;
`KOKORO_INT8=1` takes the int8 Kokoro instead (132 MB, but three times slower on CPUs without VNNI).

For Camera workout, also fetch the page's assets (MediaPipe, pose models, three.js, the ElevenLabs client; `WEB_KOKORO=0`
skips the 330 MB in-browser Kokoro, which the server's own Kokoro replaces):

```bash
cd inference/pose-coach && WEB_KOKORO=0 bash tools/fetch_assets.sh
```

Then, on your side:

1. **Sign in to Claude Code** in a terminal: `claude auth login`, with your Claude account (Pro/Max). Never paste a
   password or code anywhere else. `claude auth status` shows which account is signed in; the app shows it too. The
   helper finds `claude` on `PATH`, in `~/.local/bin`, or the copy the Claude desktop app keeps.
2. **Windows privacy settings:** Settings › Privacy & security › Microphone › *Let desktop apps access your
   microphone* (the helper records through PortAudio, a desktop app), and Camera › *Let desktop apps access your
   camera* for Camera workout. WebView2 also asks once for the camera and microphone in the camera page.
3. Build and install the app (`npm run windows` in `win/`, see `win/README.md`).

## Use

Start one of these in PowerShell from the repository root and keep its window open (on an 8 GB PC run one at a time:
each loads its own Parakeet and Kokoro):

```powershell
powershell -ExecutionPolicy Bypass -File win\local-voice\start.ps1
```

for Coach, or

```powershell
powershell -ExecutionPolicy Bypass -File win\local-voice\camera.ps1
```

for Camera workout. Ctrl+C stops either. Models load in about 10 to 20 seconds.

## How the app and the helpers trust each other

**Voice helper** (`service.py`, `127.0.0.1:39765`):

- It writes a fresh random token to the app's own data folder
  (`%LOCALAPPDATA%\Packages\<app>\LocalState\local-voice.token`), which the app reads through its NorthWin module.
  Web pages, the camera WebView included, can't read it.
- Before **every** request the app sends `POST /status` with a fresh 256-bit nonce from the system RNG and checks the
  answer is HMAC-SHA256(token, nonce) (NorthWin's `hmacSha256Hex`, BCrypt). Only then does it send the request, with
  the token. A helper that was killed leaves its token file behind; anything that takes its port then gets only the
  nonce (tested: see below).
- Every request but `/status` needs `Authorization: Bearer <token>`. The `Host` must be exactly `127.0.0.1:39765`
  (no DNS rebinding), and requests with an `Origin` or any `Sec-Fetch-*` header are refused: browsers always send them
  on these requests, React Native's fetch on Windows sends neither. No CORS is offered, so no web page or iframe can
  use the helper even if it guessed the token.
- JSON bodies only, at most 1 MB; text limits (4,000 characters to Claude, 600 to speak); one job at a time (`429`
  otherwise, so replies never overlap); `/cancel` stops the current one within about 0.1 s.
- Not covered: another program running as the same Windows user can read the token file (as on the Mac).

**Claude Code** (`claude_mcp.py`, `reply_mcp.py`): one `claude -p` per turn, in an empty temporary folder, with
`--tools ""` (no built-in tools), `--strict-mcp-config` with one stdio MCP server whose only tool is `speak_reply`,
`--allowedTools mcp__rhythm_voice__speak_reply`, no settings files, no slash commands, no saved session, model
`haiku`, 100 s limit. The reply counts only if Claude called `speak_reply` and the call succeeded. A signed-out
Claude Code is never started: the helper checks `claude auth status` first (cached 30 s).

**Camera page in the WebView** (`win/src/screens/camera.tsx`, `src/lib/pose-coach.ts`):

- The WebView loads only `http://127.0.0.1:8765/web/index.html?embed=1&parent=windows-app`. Messages count only when
  the WebView's page is exactly that origin and path; WebView2 gives `chrome.webview` to the top document only, so
  iframes can't send any. If the page goes anywhere else, the app shows why and loads the camera page again; new
  windows are never opened.
- What the page can ask the app for: the theme, its AI connection (whether the account's ElevenLabs agent may coach,
  and that Claude Code on this PC may), and a short-lived ElevenLabs conversation address for the account's own agent
  (`POST /connections/elevenlabs/session`, checked by the page to be `wss://api.elevenlabs.io`). Saving uses the app's
  own sign-in (`POST /sessions`); the page never gets it.
- The camera server binds `127.0.0.1` only, checks `Host`, takes posts only from pages on this machine and lets only
  local pages frame it (its existing checks). `camera.ps1` runs it with `POSE_CLAUDE_TRANSPORT=cli` (Claude Code,
  never a saved API key) and no session logs.

The window shows whether a camera workout goes to the **local test backend** (when `EXPO_PUBLIC_API_URL` is
`localhost`/`127.0.0.1`, with the fictional test user of `win/tools/local-backend`) or to **your Rhythm account**.

## Tests

```powershell
cd win\local-voice; ..\..\inference\pose-coach\.venv\Scripts\python.exe -m unittest test_service
```

26 tests: who may call the helper (token, Origin, Fetch Metadata, Host, sizes, paths), quiet periods, a blip too
short to be speech, the utterance copied out of the VAD before it frees it, cancellation, a blocked or missing microphone, missing model files, signed-out Claude (never
started), an API-key Claude Code login not counted, no API key or parent-session variable reaching Claude Code, the
reply counted only from a successful `speak_reply`, and the stale token file.

`test_live.py` (same folder) drives the real models, microphone, speaker and Claude Code over real HTTP and prints a
JSON report; it speaks two short test sentences aloud.

In `win/`: `npx jest` (the client's proof check before every request, an impostor on the port, turn-taking through
quiet stretches, several turns, cancellation, the camera bridge's message filter, where a workout is saved). In
`inference/pose-coach`: `npm test` (the page's Windows channel in `tests/embed.test.mjs`).

## Measured on this PC (29 Oct 2026)

Intel Core i5-8250U (4 cores, 8 threads, 2017, no GPU used), 7.9 GB RAM, Realtek microphone array and speakers,
Windows 11 Home build 26300, sherpa-onnx 2.0.1 on 4 threads.

This PC has little memory to spare (about 1 to 2 GB free with the Claude desktop app and a browser open), so the
numbers depend on what else runs: the first column is with nothing else heavy running, the second with Metro, the
Debug app and its WebView open.

| | Quiet | Busy |
|---|---|---|
| Helper start to both models ready | 8 s (Parakeet 5.7 s, Kokoro 5.4 s) | 47 to 116 s |
| Memory | Parakeet worker 740 MB, Kokoro worker 550 MB, helper 110 MB | the same, partly paged out |
| Parakeet, 2 s of speech | 0.4 to 0.6 s | 2.7 to 6 s |
| Kokoro (full precision) | 0.9× real time: 1.7 s for 1.4 s of speech | 3 to 6× real time |
| Kokoro int8, for comparison | 2.7 to 3.5× real time (14 s for the same sentence) | – |
| End of speech noticed | 0.85 s of silence | |
| Stop | the listen ends 0.06 to 0.5 s after *End conversation* | |
| Disk | models 1.03 GB, `.venv` 211 MB, camera assets 82 MB | |

A turn is therefore about 0.85 s (pause) + 0.5 s (Parakeet) + Claude Code + the first sentence's synthesis on a quiet
8 GB PC; with the development tools open it is several seconds slower. A Release build (no Metro) and 16 GB would help.

## Not verified here, and known limits

- **Claude's actual answers.** Claude Code on this PC is signed out, so the real `claude -p` → `speak_reply` turn
  (and the camera page's Claude coach) wasn't run end to end. What was run: the MCP server through a standard MCP
  client (`speak_reply` listed, called, an over-long reply refused) and a signed-out Claude Code answered with a clear
  message. After `claude auth login`, run `test_live.py` again: its `claude_coach` entry should show a reply.
- **ElevenLabs** wasn't exercised: the test account has no agent. The app passes `elevenlabs: true` to the page only
  when the account's `/connections/access` says one is usable; the page's Auto then picks it first (its existing
  order, tested in `tests/connections.test.mjs`).
- **A real camera workout.** Counting was tested with a stand-in page at the trusted address sending the real page's
  messages; a person exercising in front of the camera wasn't.
- **react-native-webview 15.0.0 on Windows** (Fabric, XAML island): it drops the first page address (the app gives it
  again until it loads, which can take up to a minute on this PC), it covers the window until its first layout, and
  at 150% display scaling it draws the page at two thirds of its area.
- **Page header buttons** (the ones beside a page title) don't take mouse clicks in this app on Windows; keyboard
  works. The new buttons are in the page body instead. *Log an entry* on Calendar has the same problem.
- Half duplex: you can't interrupt the coach while it speaks, and the microphone hears the speakers, so it listens
  again only after it has finished.
- Developer setup only: it needs this repository, the Python environment and a helper started by hand. Nothing here is
  in the published test build.
