# Pose coach: the voice coach and its connections

The engine measures every rep; when something is worth saying, a coach turns the event into one or two short spoken
sentences. The coach is the first connected of the Rhythm coach agent on ElevenLabs (its own LLM and voice), Claude
and ChatGPT (Codex). Claude goes through the Anthropic API on the user's own key when they saved one (billed per token
on their Anthropic Console account), else through Claude Code on their Claude login; ChatGPT runs on the user's ChatGPT
login, and the agent is reached by its id. The user's Anthropic key is the only key this project reads, and it is
never shown, logged or sent back ([below](#claude-through-the-anthropic-api-your-own-key)). Kokoro on
this Mac speaks Claude's and ChatGPT's cues and the engine's own sentences.

The coach also asks two things: at the start, which exercise the user is about to do, and when a set seems over,
whether it is ([The coach asks](#the-coach-asks-which-exercise-and-is-the-set-done)). The user can answer, and talk to
the coach, by voice. With the agent and its own voice the conversation is duplex: the microphone streams to the agent.
With Claude, ChatGPT or the engine's own sentences the page listens itself: Parakeet TDT 0.6B v3 writes down what the
user says on this Mac, and the coach gets the words only ([The page listens](#talking-to-the-coach-the-page-listens)).
The chips and buttons in the side panel answer too, with any coach.

Besides the 13 exercises, the user can name a movement of the motion library (a stretch, a dance, a gym move, ...): by
voice to the agent (its `set_movement` tool) or to the page, or with a tap in the Movements card. The coach is told
which one, and then what the page measures for it (a hold, the time moving, an approximate rhythm; for three held
poses the form of the hold too, and for ten moving and rhythm movements a few guard rails, clear mistakes only). It
never hears of a movement the user did not name, its prompt says never to recognise one by itself, and never to call a
movement's form good unless an event measured it (a moving one's never as a whole)
([Named movements](#named-movements-what-the-coach-is-told)).

```
engine event (web/js/engine.js, web/js/auto.js) -> web/js/app.js, with the plan from web/js/connections.js
  eleven   POST /api/coach/describe -> web/js/eleven-coach.js -> the agent over WebSocket -> its text and its voice
           duplex: the microphone -> the agent -> its client tools set_exercise, set_movement, answer_set_end
           -> web/js/app.js
  claude   POST /api/coach/event -> server/coach.py queue <-MCP (server/pose_mcp.py)-> claude -p   -> GET /api/coach/said
           with the user's API key saved: the queue -> a worker thread -> the Anthropic API -> its reply said
  chatgpt  the same as Claude Code, with codex exec
  none     the engine's own sentence
  voice    the agent's own, or web/js/voice.js: Kokoro (GET /api/tts, MLX) -> Kokoro in the browser (WebGPU) -> the Mac's
           (no cue within 3 s: the engine's own sentence is spoken instead)
  listen   eleven: the agent itself (duplex). claude, chatgpt, none: the microphone -> web/js/listen.js (the detector)
           -> POST /api/stt (server/stt.py -> stt_worker.py: Parakeet on MLX) -> the words -> web/js/intents.js
           -> applied here, and POST /api/coach/event {kind: "user_said"} (none: the engine's own sentence)
  answers  the agent's client tools, the user's words (intents.js), or the side panel's chips and buttons
           -> AutoTracker (web/js/auto.js)
  moves    a movement of the library named (the same three ways, or a tap in Movements; GET /moves/library.json)
           -> web/js/moves.js MovementTracker -> movement_set, hold_*, moving_progress, rhythm_progress, as events above
           a held pose's form: the landmarks -> web/js/holdform.js -> hold_fault, hold_fix, and `form` on hold_*
           a moving or rhythm movement's: the landmarks -> web/js/moveform.js -> form_fault, form_fix, and `form`
              on moving_progress and rhythm_progress
           either, a check's parts out of the picture (standing in it) or every check side-on a while: form_unseen
              (step back, or turn: no fault)
           -> each fault told also shown in the side panel's form check (the user's last 2 s, its reference pose),
              and kept in the Workout card's Mistakes list (web/js/mistakes.js) to see again after Stop
```

## Quick start

From `inference/pose-coach`, on a Mac:

```bash
bash tools/fetch_assets.sh            # once: also kokoro-js 1.2.1 + Kokoro-82M (browser) and @elevenlabs/client 1.27.0
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python "mcp>=2.3" "anthropic>=2.1"
                                      # once: the pose MCP server, and the Anthropic SDK (2.1.0 here) for Claude's API
bash tools/setup_kokoro.sh            # once: Kokoro-82M on MLX (Apple Silicon, uv)
bash tools/setup_stt.sh               # once: Parakeet TDT 0.6B v3 on MLX (2.5 GB): talk to Claude, ChatGPT, the engine
mkdir -p .data/connections && (umask 077; pbpaste > .data/connections/anthropic-key) && chmod 600 .data/connections/anthropic-key
                                      # Claude through the API: your key, copied from the Console
claude auth login                     # or Claude through Claude Code, signed in with your Claude account
codex login                           # ChatGPT: Codex signed in with ChatGPT (a Codex on an API key is never used)
bash tools/serve.sh                   # the dev server on .data/: http://localhost:8765/
```

Open http://localhost:8765/ and look at the **Connections** panel: it says what is signed in or set up and which one
Auto uses. Every connection is optional. With none, the engine's own sentences are spoken. After a sign-in, or after
saving or replacing an Anthropic key, press **Check again** (or reload the page: a key saved or removed since the last
check is checked again at once). After `tools/setup_kokoro.sh` or `tools/setup_stt.sh`, restart the dev
server: it starts the voice when `.venv-kokoro` exists, and the speech to text when the venv and Parakeet's snapshot are
there. After installing the anthropic package, restart it too: the server checks for it with its own Python.

```bash
curl -s http://127.0.0.1:8765/api/connections    # each connection's state and "auto"
curl -s http://127.0.0.1:8765/api/tts/status     # {"available": true, "ready": true, ...} once Kokoro is loaded
curl -s http://127.0.0.1:8765/api/stt/status     # {"available": true, "ready": true, ...} once Parakeet is loaded
```

### The ElevenLabs agent: by id, no API key

The agent lives in the ElevenLabs workspace, on a paid ElevenLabs plan. Its prompt, LLM and voice are set on the agent,
not in this repo. The code relies on this setup:

- **Public.** No authentication: the page starts a session with the agent's id alone.
- **An origin allowlist.** It names the hosts the page is opened from (localhost and 127.0.0.1, any port). They are the
  same on every computer, so the allowlist keeps other websites out, not other people (see
  [Security and privacy](#security-and-privacy)).
- **One session at a time, and a daily cap on sessions.**
- **No client overrides except text-only.** The page sends none, and asks for text only when the page's own voice
  speaks.
- **Its own LLM and voice.** The saved record says DeepSeek V4.1 Flash.
- **A turn timeout of at most 30 s.** The page keeps it from speaking up in a rest (see [below](#elevenlabs-agent)).
- **Three client tools**, which the page registers when a session starts (see [Duplex](#elevenlabs-agent)):
  `set_exercise({exercise})`, one of the 13 exercise keys or `"auto"`; `set_movement({movement})`, one of the 17 keys of
  the library's movements the engine does not count (an enum on the tool; `.data/moves/slugs.json` holds the stable
  keys of all 30 cleared movements the engine does not count, and the build uses those of the movements it builds); and
  `answer_set_end({done})`, a boolean. All wait for the page's answer (up to 10 s, a setting of the tool).
- **A prompt for the tracker's questions, the named movements and the user's words.** It asks what the user is about
  to do for `ask_exercise` (an exercise, or a stretch, a pose, a dance, ...), says it will recognise the exercise for
  `exercise_auto`, says the reps and asks for `confirm_set_end`, confirms a `movement_set` with what it will keep track
  of, coaches the hold, moving and rhythm events ([below](#named-movements-what-the-coach-is-told)), calls the tools
  when the user answers, and ignores what is not meant for it (counting out loud, breathing, music, other people). It
  never recognises a movement on its own, and counts reps only for the counted exercises. Its speech recognition has
  the exercise names, "done" and "not yet" as keywords (not the movements' names).
- **The client events the page reads.** Besides `audio`, `interruption` and `agent_response`, the agent must send
  `user_transcript` (the user's words: shown as "You: ...", and the next message waits while they are answered),
  `client_tool_call` (the three tools) and `agent_chat_response_part` (a reply's text as it is written). Without the
  first two, duplex breaks with no error on the page: the user's words go unseen and the tools never run.

Then tell the server which agent to use, in one of three ways:

1. **The Connections panel** (standalone page only; inside the app the form is hidden). Paste the id (`agent_...`, on
   the agent's page in ElevenLabs), pick the plan (blank: not known), and press **Save**. **Forget** removes it.
2. **From the command line** (curl sends no Origin header, so the guard lets it through):
   ```bash
   curl -X POST -H 'Content-Type: application/json' \
     -d '{"agentId": "agent_...", "plan": null}' http://127.0.0.1:8765/api/connections/elevenlabs
   ```
   `plan` is the plan's name in lower case, or `null` if not known.
3. **An environment variable:** `POSE_ELEVEN_AGENT=agent_... bash tools/serve.sh`. It overrides the saved record.

The server never contacts ElevenLabs to check the agent: "set up" means only that an id is configured. The id stays
out of the repo, test fixtures included (see [Security and privacy](#security-and-privacy)).

### Claude through the Anthropic API: your own key

Claude goes through the Anthropic API when a key is saved, and through Claude Code on the user's login otherwise
([Claude](#claude)). The key goes in one file, from the command line: the page has no form for it. Copy the key from
the Anthropic Console, then, from `inference/pose-coach`:

```bash
mkdir -p .data/connections && (umask 077; pbpaste > .data/connections/anthropic-key) && chmod 600 .data/connections/anthropic-key
```

- **The file.** `.data/connections/anthropic-key` (`KEY_FILE` in `server/coach.py`; `POSE_ANTHROPIC_KEY_FILE` names
  another): the key alone (whitespace around it is trimmed), git-ignored with the rest of `.data/`. `mkdir -p` makes
  the folder, which is there only once an agent was saved from the Connections panel (without it, writing the file
  fails). `umask 077` makes a new file readable by the user alone (mode 0600), and the parentheses keep that umask out
  of the rest of the shell; but a umask applies only when a file is created, so a key file already there keeps its
  mode (0644 stays 0644), and `chmod 600` sets it. The server never sets the mode: the connection check warns when the
  file's mode lets other users of the Mac open it (`claude.api.warning` in `/api/connections`: "the key file is mode
  644, open to other users of this machine: chmod 600 .data/connections/anthropic-key"; from the mode alone, the key
  is not read for it). The key still works; the Connections panel does not show the warning yet.
- **When it is read.** Afresh by the connection check and at each session start: a session keeps the key it started
  with, and a key saved later is the next session's. The check is kept for a minute, but a key saved or removed since
  it was made is checked again at the next ask (`status()` in `server/connections.py` compares the key file's presence
  with the check's `configured`): before, just after a key was saved the transport read "api" from the file while the
  kept check said no key, and Claude counted as unusable either way for up to a minute, though Claude Code was signed
  in. A key replaced by another is seen at once with **Check again**, else within the minute.
- **Going back to Claude Code.** Move the file away: the next session goes through Claude Code.
  `POSE_CLAUDE_TRANSPORT=cli` on the server does the same with the file in place.
- **Billing.** Each request bills the Anthropic Console account the key belongs to, per token: its input (the
  instructions and the session's whole conversation so far, most of it read from the prompt cache; a rest long enough
  for the cache to expire writes it again) and its output (the cue). A session is one per page, kept across sets and
  workouts, so its conversation grows with every event. Through Claude Code the coach ran on the user's Claude
  subscription instead.
- **Never export `ANTHROPIC_API_KEY`** in the shell, in `$HOME/.zshrc` or anywhere Claude Code is started from: Claude
  Code would then use that key, and bill it, for all of the user's own sessions, not only the coach's. The coach never
  needs it: the server gives the key to the SDK's client itself, and removes `ANTHROPIC_API_KEY` from the Claude Code
  CLI's environment.
- **The key goes to the API and nowhere else.** The client is pinned to `https://api.anthropic.com` (`API_URL` in
  `server/coach.py`): the SDK would otherwise send the key to the host in `ANTHROPIC_BASE_URL`, which Claude Code and
  gateways set and a server started from such a shell inherits, and it would add the headers in
  `ANTHROPIC_CUSTOM_HEADERS` to every request, so those are dropped. It is never printed, logged, put into an error, a
  status or the environment, nor returned by any endpoint: `/api/connections` and `/api/health` say only whether one
  is saved and whether the API took it ([Security and privacy](#security-and-privacy)). The tests use a made-up key
  and a stand-in client: they never read the user's key or call the API.

## How Auto picks

| Order | Connection | Usable for Auto when | Writes the cues | Voice "Auto" |
|---|---|---|---|---|
| 1 | `eleven` | an agent id is set up, and its plan is not known to be free (no plan counts as paid) | the agent's LLM | the agent's own |
| 2 | `claude` | through the API: a key is saved and the API has not refused it (one it took, or one its check got no answer about); through Claude Code: `claude auth status` says signed in | Claude Sonnet 5.5 (the Anthropic API, else `claude -p`) | Kokoro |
| 3 | `chatgpt` | `codex login status` says "Logged in using ChatGPT" | GPT-6 Luna (`codex exec`) | Kokoro |
| - | `none` | none of these | the engine's own sentences | Kokoro |

The order is `ORDER` in `server/connections.py` and in `web/js/connections.js`. The server's `auto` is the first usable
one; the page plans with `resolve()` in `web/js/connections.js`.

- **Picked by hand.** The *AI coach* picker takes Auto, one of the three, or Off (the engine's own sentences). A brain
  picked by hand that cannot be used, or failed, moves on to the next usable one after it in the order, never back:
  picking Claude is not a request for the agent, which bills by the minute.
- **What a hand pick tries anyway.** An agent on the Free plan (the agent refuses the session if its plan cannot run
  it), and Claude when its check itself failed (it timed out, could not run, or gave an answer the server could not
  read). ChatGPT is never tried unless Codex says it is signed in with ChatGPT.
- **No answer from the server** (`/api/connections` failed): Claude is tried; the agent and ChatGPT are not.
- **At Start.** The page asks `/api/connections` again and waits at most 3 s (with no answer, the last one stands). It
  clears an earlier failure of the agent (the agent is tried again at every Start), plans, and waits at most 5 s for
  the coach to connect. The engine's cues stand in meanwhile.
- **A coach that fails to start** is skipped from then on, and the plan moves to the next usable one. The log says
  "`<coach> could not start (<why>); moving on to <next>`", or "...; speaking the engine's cues". Failures are cleared
  when the coach picker changes and on Check again; the agent's also at each Start and on Save or Forget.
  - The agent fails when it refuses the session or cannot be reached, when its side closes the session before its
    first reply during a workout, or when no agent is set up.
  - Claude or ChatGPT fails when `POST /api/coach/start` fails, when the CLI exits before it connects, when it has not
    connected 30 s after it started, or when the server ends the session with an error (a ChatGPT session whose
    `codex exec` runs keep failing; a Claude API session whose key the API refused, whose request it rejected, or
    whose requests failed, after their one retry, for three events in a row). A Claude API session that failed hands
    over to the next connection, not to Claude Code: once the connection check finds the key refused (Check again),
    Claude goes through Claude Code.
- **Cues already owed.** Every event sent to a Claude or ChatGPT session waits 3 s (`FALLBACK_MS`) for its cue. After
  that the engine's sentence is spoken, and a cue that comes later is skipped ("(late coach cue skipped: ...)"). This
  holds across a failover too. If `/api/coach/event` or `/api/coach/describe` fails, the engine's sentence is spoken.

**The voice rules** (the *Voice* picker: Auto, Kokoro, the agent's own, Mac voice, Off):

- Auto is the agent's own voice when the agent is the coach, and Kokoro otherwise.
- The agent's own voice picked by hand with another coach becomes Kokoro ("The agent's own voice needs the ElevenLabs
  coach").
- With the agent as the coach and another voice, the agent's session is text-only and the page speaks its text. A
  text-only session has no microphone: the user answers the coach's questions with the chips and buttons.
- Kokoro means Kokoro on the server, else Kokoro in the browser, else the Mac's voice. The Mac's voice stands in until
  Kokoro is ready. Kokoro is loaded with the agent's voice too, for the engine's fallback sentences.
- Changing the voice ends an agent session of the other mode; the new one connects with the workout.

Both pickers are remembered per browser in `localStorage` (`pose-coach-coach`, `pose-coach-voice`).

## The Connections panel

| Row | Shows |
|---|---|
| ElevenLabs | the agent's name, its LLM and plan ("plan not known" if blank), "(Auto needs a paid plan)" on Free; or "not set up" |
| Claude | through the API: "Claude Sonnet 5.5 through the API (your key), effort high", with "(could not check: `<why>`)" when the API did not answer the check (the key file's mode warning, `api.warning`, is not shown). Through Claude Code: "signed in (`<plan>` plan): Claude Sonnet 5.5 through Claude Code (your Claude login), effort high" (", fast mode" when on), with "(your API key is not used (`<why>`))" when a saved key was refused; or why not, with `claude auth login`. An older server, which sends no `transport`: "signed in (`<plan>` plan): Claude Sonnet 5.5, effort high" |
| ChatGPT | "signed in with ChatGPT: GPT-6 Luna"; or why not ("signed in with an API key, not ChatGPT", ...), with `codex login` |
| Auto uses | the coach and voice Auto would use now |
| Speech to text | "Parakeet on this Mac: ready (loaded in 9.1 s)", "loading...", its error; or "not set up", with `bash tools/setup_stt.sh` |

- The connection coaching now is highlighted. One that failed to start shows "Failed to start: `<why>`".
- **Check again** asks the server to run the CLI checks and the API key's check again at once (`?fresh=1`; only a
  check that ended in the last 2 s is reused) and tries again what failed to start. When a CLI is installed but still
  not signed in, the page adds that a sign-in from the last minute can take up to a minute to show; that holds only
  for an older server, which kept its answers for a minute whatever it was asked.
- **The agent form**: the id, the plan, Save and Forget. The page checks the id's form first
  (`agent_` and 20-40 lower-case letters or digits). Inside the app (`?embed=1`) the form is hidden and the panel shows
  the state only.
- The pickers say what Auto would use ("Auto (ElevenLabs)", "Auto (Kokoro)"), and name the Claude and ChatGPT models
  the server runs.
- The *Coach* line under Live says what is up: "connected: Rhythm coach agent (ElevenLabs), its voice", "connected:
  Claude Sonnet 5.5 through the API", "connected: Claude Sonnet 5.5 over MCP" (Claude Code, and ChatGPT's line too),
  "paused (back with the next event)", "off (the engine's own cues)".
- Claude picked by hand that cannot be used says why ("Picked Claude, but Claude has no API key: using ..."): "has no
  API key" or "cannot use its API key (`<why>`)" through the API; through Claude Code, as before (not installed, not
  signed in, could not be checked).

## The coach asks: which exercise, and is the set done

What the page has to tell the user is in the side panel, not on the video: the rep count, the exercise and set, a
first rep's tentative "1 of 2", the framing and visibility warnings, the coach's last line, and the two questions
below with their chips and buttons. Over the video there is only the skeleton, and the 3D view while the user has it open; the form check of a faulty
rep (the user's rep next to the right form), or of a held pose's or a moving movement's fault the coach was told of
(the user's last 2 s next to the movement's reference pose), sits in the side panel under the rep count. Each one
shown stays in the Workout card's Mistakes list until the next workout starts, to show again (pinned until closed) or
in 3D after Stop ([README](../README.md#mistakes-kept-to-see-again-after-the-workout)).

**Which exercise.** Start begins the workout in auto mode at once, so no rep is lost while the user answers. The page
sends the coach `{kind: "ask_exercise"}` and shows chips in the side panel: the 13 exercises, "Detect for me" and
"Other movement..." (it opens the Movements card: [Named movements](#named-movements-what-the-coach-is-told)).
An exercise chosen in the page's Exercise picker before Start is not asked about: it is counted alone from the start
(`new AutoTracker({ only: key })`, as for an answer below) and the coach gets `{kind: "start"}` with it.

- **An answer** comes from the agent's `set_exercise` tool (the user said it to the agent), from the user's words when
  the page listens ([what the page does with them](#what-the-page-does-with-the-words)), from a chip, or never.
- **An exercise named**: `AutoTracker.setExercise(key)`. Only that exercise's engine counts from then on, and a set
  starts on its first counted rep: the user said what they are doing, so there is no wait for K reps in a row and no
  rival exercise. Its reps seen just before the answer start that set, so none is lost while the question was open.
  "Detect for me" (`"auto"`) leaves the tracker detecting.
- **A chip** tells the coach `{kind: "exercise_set", exercise, label}`, and the coach confirms in a few words. After the
  voice tool nothing is sent: the agent confirms by itself. Words the page applied go to the coach as one `user_said`
  with what was done (`applied`), and it confirms in its own words.
- **No answer** within `ASK_EXERCISE_MS` (12 s): the page stays in auto mode, hides the chips and tells the coach
  `{kind: "exercise_auto"}`, unless a set was recognised meanwhile (its `set_start` already named the exercise).
- **Later**, the user changes the exercise the same ways: by voice at any time (to the page, a short switch such as
  "now lunges"), or with the chips, which "Change exercise" in the side panel brings back. Another exercise ends the
  open set at once (reason `switch`); "Detect for me" goes back to detecting.

**Is the set done.** The tracker no longer ends a set by itself after a short rest: it asks first.

- After `ASK_REST_MS` (8 s) with no rep of the set's exercise (and none under way) it emits `set_end_pending {exercise,
  label, set, reps, t}`, once, and the set stays open. The page tells the coach `{kind: "confirm_set_end", exercise,
  label, set, reps}` and shows "Done with this set?" with **Done** and **Not yet** in the side panel.
- **Done** (the button, `answer_set_end({done: true})`, or "yes, done" to the page): the set ends, reason `confirmed`;
  its reps still being decided count.
- **Not yet** (only while the question is open; one that comes after a rep withdrew it changes nothing): the set goes
  on and is not asked about again before its next rep. A rest still ends it 20 s (+3 s) after the later of its last
  rep and the answer, so a forgotten or misheard "not yet" never merges the next set into it. A second **Done** within
  6 s of the first (a tap and a spoken answer together) is ignored.
- **A rep** of the set's exercise while the question is open: `set_end_cancelled`, and the question is withdrawn.
- **No answer**: the set ends as before, 20 s after its last rep (`REST_MS`, plus up to 3 s for a rep to be reported;
  reason `rest`).
- A switch to another exercise still ends a set at once (reason `switch`).

**Who asks, and how the user answers:**

| Coach | Voice | The questions are spoken by | The user answers with |
|---|---|---|---|
| ElevenLabs agent | its own (duplex) | the agent | their voice (the agent's client tools), or the chips and buttons |
| ElevenLabs agent | Kokoro, the Mac's (text-only) | the page's voice, in the agent's words | the chips and buttons |
| Claude, ChatGPT | Kokoro, the Mac's | the page's voice, in their words | their voice (the page listens), or the chips and buttons |
| none (the engine's sentences) | Kokoro, the Mac's | the page's voice, in the engine's words | their voice (the page listens and applies it), or the chips and buttons |

With the voice off nothing is spoken; the chips and buttons still ask. The agent with its own voice opens the
microphone itself ([Duplex](#elevenlabs-agent)); with Claude, ChatGPT or the engine's sentences the page does, when
Parakeet is set up ([The page listens](#talking-to-the-coach-the-page-listens)). A text-only agent session listens to
nobody, and neither does the page without Parakeet: the chips and buttons answer.

What the coaches read: each event's one-line reading from `describe()` in `server/coach.py`, the agent's messages
included. The readings of the questions say what to ask ("No rep for a few seconds: set 2 of Squat may be over, 8 reps
counted. Say the reps and ask if they are done with this set, in one short sentence."), not how the user answers:
each coach's own prompt says that (the agent's is set on the agent; Claude's and ChatGPT's is
[`SYSTEM`](#what-claude-and-chatgpt-are-told), which has them ask without saying how to answer, since the page is not
always listening). A question the page tags `listening: false` gets "The user cannot talk to you right now: they answer
by tapping on screen, so do not ask them to say it." added to its reading (`UNHEARD` in `server/coach.py`). The page
adds the same sentence itself to an agent session that cannot hear (text only, or its microphone muted or refused); it
does not tag Claude's and ChatGPT's questions yet.

## Named movements: what the coach is told

The user can name any of the 29 movements the motion library offers
([README](../README.md#movements-from-the-library-named-not-recognised)): with a tap in the Movements card, in words to
the page (`web/js/intents.js` knows each movement's spoken names from `/moves/library.json`), or in words to the agent
(its `set_movement` tool). Nothing recognises a library movement by itself: on other people's footage that was right
7% of the time ([the study](../README.md#why-the-user-names-it-the-recognition-study)), so the coach hears only of the
movement the user named.

- **A gym exercise of the library** (an overhead kettlebell squat, a tuck jump, ...) goes as its exercise: the coach
  hears `exercise_set` after a tap, the user's words with `applied: {type: "exercise", exercise, label, movement,
  display}`, or nothing more after the agent's own `set_exercise`. Both readings name it as the user did, with the
  exercise it is counted as: `The user chose Overhead kettlebell squat (counted as Squat): only Squat is counted now.
  Confirm in a few words.`; `... The page switched to Overhead kettlebell squat (counted as Squat): confirm in a few
  words.`
- **Any other movement** runs a `MovementTracker` (`web/js/moves.js`), and no reps are counted until the user names an
  exercise or "detect it". A tap sends `movement_set`; words to the page send one `user_said` with `applied: {type:
  "movement", movement, display, movementKind, track}`; after the agent's `set_movement` nothing is sent (it confirms
  its own tool). The tracker's events then go to the coach as below, each with the engine's sentence spoken if no cue
  comes in 3 s.
- **While a movement is named** every event the page sends carries `movement` and `movementDisplay`. Words the page did
  not apply then read "The page changed nothing: it still tracks Quad stretch, a movement they named, and counts no
  reps. Answer them."

| Event | When | Fields (besides `kind`) | Reading (`describe()` in `server/coach.py`) | The engine's sentence |
|---|---|---|---|---|
| `movement_set` | a tap (or the movement picked before Start) | `movement` (its key), `display`, `movementKind`, `track`, `coach` | `The user named Quad stretch (a stretch, pose or balance), from the movement library: the page times the hold, and no reps are counted meanwhile. Confirm it in a few words, with what you will keep track of.` | "Quad stretch: settle into it and hold still, I'll time it." After a set it ended, that set's reps first ("Squat: 8 reps. ...") |
| `technique_result` | each completed, incomplete or timed-out one-two attempt; no warm-up or count | `movement`, `track: technique`, `sequence` (`jab_cross`, `same_hand`, `jab_only`), `verdict` (`partial`, `incomplete`, `fault`), `checked`, `unmeasured`, `faults`, `seen`, `cue` | Only the measured checks may be praised; repeated jabs are not a complete one-two. Full extension and hip/shoulder rotation remain unmeasured. No punch or attempt totals. | its cue; empty after a fault already corrected |
| `hold_start` | a hold that has lasted 5 s: sent 6.5 s after the stillness began (below) | `movement`, `display`, `movementKind`, `track`, `form` (the hold's form as it is when the start goes: `{open, checked, pending, unseen, wrongView}`, each of `open` `{fault, label, measured, target, cue, part, side}`; null for a movement without a form check) | A fault measured: `Triangle pose: the user has settled into the hold. Measured: feet 0.45 leg lengths apart (aim for about one leg length apart). Your cue is this correction: Step your feet wider, about a leg's length apart.` A fault measured and not told yet (`pending`): `Triangle pose: the user has settled into the hold. A fault is measured, its correction to come next on its own (trunk tilt): do not call the form good. One short cue to keep holding.` Measured and fine (every check made): `Triangle pose: the user has settled into the hold, measured and fine so far (checked for stance width, long legs, top arm: none found). One short cue on what to keep.` Some checks not made: `Triangle pose: the user has settled into the hold. Checked for top arm, trunk tilt: none found, but not all of its form. Out of view, so not checked: stance width, long legs (they would step back to be seen whole). One short cue on what to keep; never call its form good as a whole.` (seen from the side: `Not checked from this side: ankle above the knee (it is measured facing the camera: they would turn towards it).`) Not measured (no form check, no landmarks, or no check made): `Quad stretch: the user has settled into the hold. Its form is not measured: never say it looks right or wrong. One short cue on what to keep. Form notes: <the form cues of its coaching line>.` | the fault's cue; "Good, hold it there." only when the form is fine (something checked; nothing open, pending, out of the frame or seen from the wrong view); "Hold it there." otherwise |
| `hold_progress` | at 10, 20 and 30 s held, then every 15 s | the same, `seconds`, `form` | A fault still open: `Triangle pose: held for 20 seconds so far. Its measured fault is still open: top arm 48 degrees from straight up (aim for straight up, over the shoulder). Say the time held, with the correction still to make in a few words.` Pending: `... held for 20 seconds so far. A fault is measured, its correction to come next on its own (stance width): do not call the form good. Say the time held, with a few words to keep it going.` Fine: `... held for 20 seconds so far. Its form, measured: fine so far. Say the time held, with a few words to keep it going.` Some checks not made: `... Its form, measured where it could be: no fault found (checked for top arm). Out of view, so not checked: stance width (they would step back to be seen whole). Say the time held, ...` Not measured: `... Its form is not measured: never say it looks right or wrong. Say the time held, ...` | "20 seconds. Keep holding, keep breathing." |
| `hold_end` | 1 s of clear movement within 1.5 s, 1.5 s out of view, or, for a pose with a form check, the user clearly out of the pose (its loose in-the-pose test, `IN_POSE` in `web/js/holdform.js`; timed to when they left it); only for a hold whose start was sent | the same, `seconds`, `form` (the hold's summary as of its end: `{checked, faults: [{fault, label, fixed, told}]}`, `told` set by the page from what the coach heard, and a fault never heard and fixed by then left out) | `Triangle pose: the hold ended after 25 seconds. Faults the user was told of in it: feet too close together (not fixed); top arm not straight up (fixed). Say how long they held it and the fault to work on next time, in a few words.` (every fault told fixed: "with a word of praise for the fix"; with a fault still there that the user was never told of, "; never call its form good."); only such a fault: `... A fault was still measured at its end. Say how long they held it, in a few words; never call its form good.`; no fault: `... Its form, measured: no fault found (checked for ...). Say how long they held it, in a few words.`; not measured: `Quad stretch: the hold ended after 45 seconds. Its form was not measured: never say it looked right or wrong. Say how long they held it, in a few words.` Under 5 s (`SHORT_HOLD_S`), should one come: `Quad stretch: a short hold of 3 seconds ended. A hold this short needs no cue: say nothing.` (Claude Code and ChatGPT call `say` with an empty text; Claude through the API replies with a hyphen) | "You held it for 45 seconds." (nothing under 5 s) |
| `hold_fault` | a fault of the hold's form, measured after its start: one at a time, 8 s after the last one told (one the start carried counts from when the page sent it) or 2.5 s after its fix ([when](../README.md#a-held-poses-form-measured-never-assumed)); sent only after its hold's start, and only once the hold can no longer end before the frames it was measured on | the same, `fault` (the check's id), `label`, `measured`, `target`, `cue`, `part` (the body part the page shows in red), `side` (the user's own side of it, `left` or `right`, or null for a part of both sides); the reading leaves `part` and `side` out | `Triangle pose: measured fault: top arm 48 degrees from straight up (aim for straight up, over the shoulder). Correct it in a few words: Reach your top arm straight up, stacked over your shoulder.` | its cue |
| `hold_fix` | a fault told is fixed (its value back inside the line for 1.5 s) | the same, `fault`, `label` | `Triangle pose: the user fixed it (top arm not straight up). Praise that fix in a few words.` | "That's it. Keep it there." |
| `moving_progress` | every 30 s of movement, added up | the same, `seconds`, `form` (a movement with guard rails, `web/js/moveform.js`: its form as it is, `{open, checked, pending, unseen, wrongView}` as a hold's; null for a movement without a check, or frames without landmarks) | No form (a dance): `Hip-hop dance: 1 minute of moving so far. A few words of encouragement, with the time. Form notes: ...` Checks made, none found: `Forward fold roll-up: 1 minute of moving so far. Checked for arms overhead at the top: none found so far; these checks look for a few clear mistakes only, so never call its form good as a whole. A few words of encouragement, with the time.` A fault still open: `... Its measured fault is still open: arms raised 95 degrees at the top (straight up is 180) (aim for arms reaching up overhead, 140 degrees or more). A few words of encouragement, with the time and the correction still to make.` Pending, out of view, the wrong view and nothing measured yet (the warm-up) read as a hold's progress (`A fault is measured, its correction to come next on its own (...): do not call the form good.`, `Out of view, so not checked: ...`, `Not checked from this side: ...`, `Its form is not measured: never say it looks right or wrong.`) | "1 minute of moving. Keep it up." |
| `rhythm_progress` | every 5 cycles of the movement's rhythm signal (or of its fallback while the signal's parts are out of view: the feet's spread falls back to the more lifted thigh, `rhythm.fallback`) | the same, `count`, `approximate: true`, `form` (as `moving_progress`'s) | `Y-to-W raise: about 10 reps so far, by its rhythm: an approximate count (there is no rep counter for this move). Say it with 'about', never as an exact count.` With a form, its clause before the last sentence, as `moving_progress`'s: `Shoulder external rotation: about 10 reps so far, by its rhythm: ... (there is no rep counter for this move). Checked for elbows at your sides, forearms turning out: none found so far; these checks look for a few clear mistakes only, so never call its form good as a whole. Say it with 'about', never as an exact count.`; a fault still open: `... Its measured fault is still open: <measured> (aim for <target>). Say it with 'about', never as an exact count, with the correction still to make in a few words.` | "About 10 so far. Keep going." |
| `form_fault` | a guard rail of a moving or rhythm movement measured as a fault (a frame check past its line for 1.5 s; a cycle check bad on 2 of its last 3 cycles), never in a run's first 3 s or while still or paused; one at a time, 8 s after the last one told or 2.5 s after the last fix; sent as it comes ([when](../README.md#a-moving-movements-form-guard-rails-clear-mistakes-only)) | the same, `fault` (the check's id), `label`, `measured`, `target`, `cue`, `part`, `side`, as `hold_fault`'s, and `seen: {from, to}` (the frame times its verdict rests on: the page replays them as "You"); the reading leaves `part`, `side` and `seen` out | `Shoulder external rotation: measured fault: elbow 52 degrees out from your side as your hands turn out (aim for elbows tucked in at your sides, within about 30 degrees). Correct it in a few words: Keep your elbows pinned to your sides as you turn your hands out.` | its cue |
| `form_fix` | a fault told is fixed (a frame check back inside its line for 1.5 s; a cycle check ok on its last 2 cycles) | the same, `fault`, `label` | `Shoulder external rotation: the user fixed it (elbows drifting off the sides). Praise that fix in a few words.` | "That's it. Keep it up." |
| `form_unseen` | a moving or rhythm movement's (`UNSEEN_TUNING` in `web/js/moveform.js`): `frame`, the person standing in the picture (shoulders, hips and knees in it, the straighter hip at 140° or more) with a check out of view and its parts out of the picture, for 5 s of such frames, moving or not, never sooner than 5 s after the movement was named (none with nobody there or the person sitting; cropped hips/knees may retain visible standing evidence for at most 10 s, only while shoulders remain visible, trunk upright, hips near the lower edge); `view`, every check seen side-on, for 6 s of the movement past its warm-up (or 3 turns of its rhythm). A hold's: every check out of view or side-on, 4 s after `hold_start`. Then at most every 30 s while it lasts, or again once everything has been seen 1 s and lost. A hold's that comes while the page holds the start back goes right after it, if it still holds | the same, `missing` (the checks' names: for `frame` only those the frame blocks, none judged in the last 5 s; a form checked in part gets the prompt for the rest), `parts` (the body parts out of the picture, as the user is asked to show them: `feet`, `legs`, `hands`, `arms`, `hips`, `shoulders`, `head`), `why` (`frame`: out of the picture; `view`: side-on), `cue` | `Standing side crunch: the tracker can't see their feet, so their form isn't being checked (standing leg long, left sweeping leg straight, right sweeping leg straight). Ask them in a few words to step back so you can see their feet; never call their form right or wrong meanwhile.` Side-on: `Triangle pose: the tracker sees them side-on, so their form isn't being checked (stance width, long legs, top arm, trunk tilt, arms in one line, open chest). Ask them in a few words to turn to face the camera; never call their form right or wrong meanwhile.` | its cue: "Step back so I can see your feet: I can't check your form." or "Turn to face the camera so I can check your form." |
| `workout_summary` | Stop | `sets`, `totals`, and `movements: [{movement, display, movementKind, track, seconds or count}]` (neither when zero: such a movement is left out of the reading) | `Workout finished. Squat: 2 sets, 16 reps. Movements: Quad stretch: held 45 seconds; Y-to-W raise: about 20 reps (an approximate count).` (no exercise set: `No set of a counted exercise.`) | "Workout done: 16 squat reps in 2 sets, quad stretch held 45 seconds, y-to-w raise about 20." |

- **The one-two technique track.** `movement_set` confirms a jab, cross and return without counting; the summary
  says "technique reviewed". Old numeric fields on a technique event are ignored. `form_fault` is emitted on the
  first measured bad punch and uses the existing comparison/3D/Mistakes path, without the moving/rhythm warm-up or
  correction gaps in the table above. Its `form_unseen` uses the event's camera instruction (sideways for a frontal
  punch), not the held-pose instruction to face the camera. The live ElevenLabs prompt was updated and verified to
  handle `technique_result`, stay silent on its empty cue, and never count or praise unmeasured technique. No other
  agent setting changed. See [measurement limits](../README.md#a-one-two-technique-check-no-count).

- **What the readings take from the library.** An event's own fields come first; what it leaves out (the name, the
  kind, the track, the coaching line) is read from `library.json` in `POSE_MOVES_DIR` (`coach.LIBRARY`, read again when
  the file changes). Without the library a reading names the key ("Quad stretch" from `quad_stretch`) and says no
  reps are counted.
- **Form notes** are the form cues of the library's coaching line for the movement (`form_notes()`), on `hold_start`
  and `moving_progress` only. The catalog's lines mix form cues with what their author meant to be counted or timed
  ("count ..." for a move the page only times, "track hold time per leg" where the page times the hold as a whole, "no
  reps", "not counted by the engine"): those parts (split at `;` and `.`) never reach the coach, in the reading or in
  the event's own `coach` field, which `describe()` returns filtered too. A line with no form cue gives no notes.
  `SYSTEM` adds that notes never make a count or a time the events did not give, and that the coach never offers to
  count or time anything the events do not (each side or leg of a hold, say).
- **Short holds.** A user shifting in and out of a pose makes holds of a few seconds, every few seconds (live:
  `hold_start`, `hold_end` after 2 s and `hold_start` again within 7 s, three coach turns). So the tracker
  (`web/js/moves.js`) shows a hold's timer after 1.5 s still but tells it (`hold_start`) and counts it only once it
  has lasted 3 s (`HOLD_TOLD_MS`): a shorter one is neither told nor counted. The page then holds `hold_start` back
  until the hold has lasted 5 s (`SHORT_HOLD_MS` in `web/js/app.js`, the engine's and `SHORT_HOLD_S`'s threshold) and
  1.5 s more (the time the tracker takes to end a hold once the movement starts): a hold of 3-5 s reaches the coach
  neither as a start nor as an end, but its seconds count towards the time held in the workout summary. Should
  a `hold_end` under 5 s still come, its reading says to say nothing (the engine says nothing either), and calls it a
  short hold, which the summary counts, not something else.
- **A held pose's form** (the library's three holds: triangle pose, quad stretch, figure-four balance; the checks, their
  lines and when a correction is told are in the
  [README](../README.md#a-held-poses-form-measured-never-assumed) and `web/js/holdform.js`). Built because the coach
  told the user their triangle pose was good when nothing measured it (their feet were half a leg length apart, their
  top arm far from straight up). The page sends a hold's start with the form as it is when the start goes, 6.5 s in,
  so a fault or a fix measured while the start waited goes with it and is not sent again (`moveEvents` in
  `web/js/app.js`); a fault measured but not told yet is in the start's `pending`, so the coach never hears "measured
  and fine so far" and that fault in one breath (before, a fault waiting its turn was in no list, and the start said
  "Good, hold it there." a second or two before it). When the start goes the page settles the tracker
  (`MovementTracker.settle()`): a fault the start carries counts as told then, and the next correction comes 8 s after
  it (the tracker had timed it from its own start, 3 s into the hold: 4.5 s after the first correction was spoken, on
  the user's recording). `hold_fault` and `hold_fix` go only after their hold's start; a hold that ends before its
  start went is told by its end alone (5 s or more), with the hold's summary. At `hold_end` the page sets each fault's
  `told` from what the coach heard (the faults open in a start or progress it sent, and each `hold_fault` it sent),
  and leaves out a fault never heard and fixed by then: a fault told and fixed while the start waited had been praised
  as fixed at the end ("with a word of praise for the fix"), though the coach never mentioned it. The readings of the
  end list only the faults the user was told of, and praise a fix only for those. A reading's cue is the first open
  fault's correction, else that a fault is measured and its correction comes next ("do not call the form good"), else
  that the form was measured and fine (only when every check was made), else which checks were made and which not, and
  why ("they would step back to be seen whole", or "they would turn towards" the camera for a check seen side-on),
  else that it is not measured, with "never say it looks right or wrong". The agent reads the same lines; its own
  prompt was not changed, so the rule reaches it through them alone.
- **A moving or rhythm movement's form** (10 of the 13 movements done in motion: the 7 gym moves with no counter, the 2
  transitions and the forward fold; the dances have no check, `form: null`). A few guard rails, clear mistakes only
  (`web/js/moveform.js` and its group files in `web/js/moveforms/`; the checks, their lines, and when a fault is told
  are in the [README](../README.md#a-moving-movements-form-guard-rails-clear-mistakes-only)). Its `form_fault` and
  `form_fix` go to the coach as they come, each with the engine's sentence if no cue comes in 3 s: there is no start
  to hold back, as a hold's, since nothing is judged in a run of movement's first 3 s and a fault is told only once it
  lasts or comes back cycle after cycle (`MOVE_FORM_EVENTS` in `web/js/app.js`). Its progress events carry its `form`
  as it is, and their readings add a clause for it (`move_form()` in `server/coach.py`): the open fault's correction
  still to make, a fault measured whose correction comes next ("do not call the form good"), the checks made with "none
  found so far; these checks look for a few clear mistakes only, so never call its form good as a whole", which checks
  could not be made and why, or that its form is not measured. Fine is never said of such a movement, as its checks
  cover a few mistakes alone. With no form (no check, no landmarks, or a page from before the checks) the readings are
  as they were. The engine's sentence for a fix is "That's it. Keep it up." (the user is still moving). The agent reads
  the same lines, and its own prompt was updated for `form_fault` and `form_fix` (on the agent, outside the repo).
- **The form not checked at all** (`form_unseen`, for a moving, rhythm or held movement with a form check). Built
  because the user did a 46 s set of the standing side crunch with the feet below the picture: its one check then was
  unseen throughout, the Now card's small "step back" line went unnoticed, and nothing was said. On their second set,
  the feet cut off again, "moving" could not be judged (the stillness measure read the sweeps still, its leg channels
  needing the legs in view; the feet's spread never turned) and a check saw the lifted leg at the top of each sweep,
  so a prompt for every check out of view while moving never came: the `frame` prompt now goes by the person standing
  in the picture and the checks the frame blocks. Once it lasts (the table above), the coach is told what to ask
  (step back to show the parts named, or turn to face the camera) and that the form is not being checked meanwhile,
  so never right or wrong (`unseen_reading()` in `server/coach.py`); `SYSTEM` and `API_SYSTEM` have the rule. On the
  user's first two side crunches it came at 54.8 and 84.8 s, and at 44.7 s; the third asks for hips and legs at 54.0 s.
  On their nine other recordings, with the side crunch named over each, it came 3 times, each while they stood with
  the feet cut off, and never while they sat at the
  laptop. The engine's sentence is
  the event's cue, and the Now card shows the cue in large type while it holds (steadied). It is not a mistake:
  nothing goes to the side panel's form check or the Mistakes list. The live agent's prompt was updated for it too
  (outside the repo).
- **Side-crunch range and phase.** The user confirmed low and excessively high leg lifts as intended mistakes.
  On the latest real-page replay (engine cues, 4×), the coach asks for hips and legs at 54.0 s, says
  "Lift your straight leg higher, toward hip height" at 66.6 s (43°), "Keep the lift controlled, no higher than hip
  height" at 82.3 s (126°), and "Keep your sweeping leg straight as you lift it out to the side" at 90.5 s (124° knee).
  The low-lift fix is also emitted at 82.3 s; it must not suppress the new excessive-lift fault on that same cycle.
  All three faults appear in Mistakes with replay frames. The first two workouts still catch their bent knees
  (69.7 s left, 50.7 s right); the second also catches low lifts at 76.7 s and fixes the knee at 87.4 s.
  Counts during the measured sweep intervals are 18/18, 16/17 and 17/18; the latest total is 18 including a setup
  motion. The cropped 51–59 s interval supplies no counts or verdicts. These use existing `form_fault`, `form_fix`
  and `form_unseen` events, so no live agent prompt update is needed. These are named-movement guard rails, not
  exercise recognition. Full measurements and limitations are in the README's replay table.
- **What the user sees of a fault the coach is told.** Live (2026-10-24) the coach corrected the user's pose and the
  page showed nothing of what was wrong. Now the page shows each fault it tells (the start carrying one in
  `form.open`, a `hold_fault`; `holdCheck` in `web/js/app.js`, on the same events `moveEvents` sends) in the side
  panel's form check, as an exercise's faulty rep is: "You", the user's last 2 s replayed with the fault's `part` in
  red on their `side`, next to "Like this", the movement's reference pose (`library.json` `pose`) turned to their
  working side, the fault's label and measurement over them and its cue and target under; "See it in 3D" puts the
  same frames on the Y Bot next to the library's clip over its held part (`held`). It goes a moment after that fault's
  `hold_fix`, at `hold_end` or after 10 s, and a later fault replaces it
  ([README](../README.md#form-check-what-went-wrong-and-the-right-form-in-3d)). A moving movement's `form_fault` shows
  the same way, its "You" the frames its verdict rests on (its `seen`, padded by 0.3 s, at most 3 s; else the 2 s
  before it: a cycle check is told when its turn is confirmed, seconds after what it measured), its "Like this" the
  reference pose of that check (`library.json` `refPoses`, turned to the fault's side), in 3D its clip around that
  pose's moment; it goes a moment after the `form_fix`, when the movement ends or after 10 s. Live (2026-10-24) the
  user stopped the workout to look at what was wrong with a quad stretch and it was gone; now each fault shown stays
  in the Workout card's Mistakes list after the hold (or the movement) and after Stop, until the next Start, shown
  again pinned (no timer, until closed) or in 3D, and in the saved set's `mistakes`
  ([README](../README.md#mistakes-kept-to-see-again-after-the-workout)). The readings say nothing of it, and leave
  `part`, `side` and `seen` out.
- **What the user said, with a movement applied** (`heard()`): `The user said: "quad stretch". The page switched to
  Quad stretch, a movement they named: the page times the hold, and no reps are counted meanwhile. Confirm it in a few
  words, with what you will keep track of.` Said mid-set, the words carry the set in progress, which naming the
  movement ends (no `set_end` is sent for it): `... The page ended set 2 of Squat at 8 reps and switched to Quad
  stretch, a movement they named: ... Confirm it in a few words, with the reps of the set that ended and what you will
  keep track of.` Named with a tap, the set's own `set_end` goes first, with `reason: "movement"`, and the `movement_set`
  right after: `Set 2 of Squat finished (the user named a movement of the library, so no reps are counted meanwhile): 8
  reps. Say nothing now: give these reps when you confirm the movement they named, which comes next.` Two cues in a
  row would have the second cut the first off (a new cue cuts the one playing), so the reps go with the movement's
  confirmation, as the engine's own sentences do (nothing for that `set_end`; "Squat: 8 reps. Quad stretch: ...").
- **The agent** reads the same lines (`POST /api/coach/describe`), and its own prompt has the same movement rules as
  `SYSTEM` ([below](#what-claude-and-chatgpt-are-told)) but three, which it does not have (read 2026-10-24; the agent
  was not changed): nothing at the end of a short hold (its prompt says "at the end, how long they held it"), notes as
  form cues only, never timing each side. Those reach it through the readings and the filtered `coach` field alone;
  the first rarely matters, since the page sends no start or end of a hold under 5 s. Since then its prompt was
  updated for a moving movement's `form_fault` and `form_fix`, and for `form_unseen` (outside the repo).

**Measured** (2026-10-24, M3, through a dev server of its own with no voice loaded; Claude Sonnet 5.5 at effort high;
a scratch library of the 29 movements the engine does not count, so their names were in the instructions). Two
sessions of the same 14 events as the page sends them: the start question, a hold named by a tap with its start, 20 s
and end (34 s), a dance named by voice and its first minute, a rhythm move named by a tap and its count of 10, a
question while it was named ("How many have I done?"), "Let's do burpees.", an idle pose, "Can you tell what I'm doing
right now?", and the summary. Every cue kept the rules: "Twenty seconds, keep breathing."; "About ten so far." and, to
the question, "About ten, last time I checked. It's an approximate count, not exact."; "I can't count or track burpees,
sorry."; for the idle pose a few words ("Standing still, got it. Take your rest."); to the last question "I only know
what you've named: standing still, as the last thing you picked. I can't recognise movements from the library by
myself."; the summary gave the hold's time, the dance's time and "about 12" of the rhythm move. Event to cue: 1.0-1.7 s
(median 1.2 s) in one session, 1.3-3.5 s (median 2.7 s) in the other, where 4 of 14 cues came after the page's 3 s and
the engine's sentence would have been spoken. On 8 exercise events (start, a set, a fault, its fix, the set-end
question, the set's end, a question, the summary), sessions in the same hour: the code before this change 1.34 and
1.37 s median per cue; the new `SYSTEM` without the library 1.25 and 1.21 s; with the library's names 1.80, 1.44 and
1.40 s (one cue 11.6 s). So the new rules cost nothing visible, and the names perhaps 0.1-0.2 s, within the spread of
these few sessions. The agent and ChatGPT were not run on these events. This run predates leaving out the sport,
walking, gesture and idle movements: its `SYSTEM` still named those kinds and had the rule for an idle pose or a
gesture, and its library held all 29; today's shorter `SYSTEM` and 16 non-counted names have not been timed.

## Talking to the coach: the page listens

With Claude, ChatGPT or the engine's own sentences as the coach, the page listens to the user itself, as the agent does
in duplex, but the audio stays on this Mac: `web/js/listen.js` cuts what the user says into utterances, Parakeet TDT
0.6B v3 on the Mac's GPU writes each one down (`POST /api/stt`, [Speech to text](#speech-to-text-parakeet-on-mlx)),
and the coach gets the words only.

```
microphone (echo cancellation, noise suppression, gain control) -> AudioWorklet, 16 kHz -> Detector (listen.js)
  -> an utterance -> POST /api/stt -> the words -> the echo guard -> intents.js
       applied (an exercise, "detect it", "done" / "not yet"): chooseExercise / answerSetEnd (how 'voice'), and the
         coach gets one user_said {text, applied}, which it confirms in its own words
       anything else: one user_said {text}, which the coach answers (none: the engine says what it can do)
```

- **When.** During a workout (from Start) and in Talk to coach, once Parakeet is ready (`GET /api/stt/status`, asked
  every second while it loads), with Claude, ChatGPT or the engine as the coach (`listens()` in
  `web/js/connections.js`: the agent hears the user itself, and a text-only agent session nobody hears). The microphone
  closes when the workout ends or Talk to coach closes. A refused or missing microphone leaves the chips and buttons,
  and the log says why.
- **The microphone row** in the side panel (`micRow`, as in duplex): "Listening: talk to the coach", "Hearing you...",
  "Writing it down...". **Mute** stops the detector, so nothing is written down; the microphone stays open (the browser
  still shows it in use) so that Hold to talk still works.
- **The detector** (`Detector` and its settings `VAD` in `web/js/listen.js`; pure, tested on made-up frames): 20 ms
  frames. The room's level is the quietest frame of the last 2 s (followed quickly down, slowly up). An utterance opens
  10 dB above it (3 frames in a row, never below -52 dB), stays open while the level is 5 dB above it (hysteresis),
  keeps the 300 ms before it opened (pre-roll), and ends after 700 ms of quiet (200 ms of it kept) or at 15 s. Less than
  150 ms of speech is a click or a knock, and is dropped. An utterance the Mac's voice opened ends at the first quiet
  moment after that voice stops, so the user's answer right after a cue is an utterance of its own.
- **Barge-in.** After 250 ms of the user's speech, the page's voice (Kokoro, on the server or in the browser) stops the
  cue it is speaking. Not the Mac's voice: it plays outside the page, where echo cancellation cannot take it out of the
  microphone, so it would cut itself. While the page's voice talks, an utterance needs 10 dB more to open and its
  frames 10 dB more to count as speech (what is left of the voice after echo cancellation, or a thump, cuts nothing),
  and the room's level is not learnt meanwhile.
- **The echo guard**, for an utterance that overlapped the Mac's voice (Kokoro plays in the page and is
  echo-cancelled): the cues the page's voice said lately (in the last 6 s, plus 0.45 s per word of the cue) are taken
  out of the transcript, newest first, as the cue's words in order with a word missed or misheard here and there
  (`afterEcho()` in `web/js/intents.js`). What is left is the user's; nothing left is the coach's own voice heard back,
  dropped ("(the coach's own voice, heard back: ...)"). The user's own "Done with this set" said after the question is
  theirs, since that utterance did not overlap the voice.
- **Push-to-talk**, for a noisy room: hold **Hold to talk** in the side panel, or the Space bar (not while typing in a
  field), and talk. Exactly one utterance is recorded, from the press to the release, without the detector (muted
  too).
- **Talk to coach**, a button in the side panel: a conversation without a workout. With Claude or ChatGPT the page
  listens, with the coach session it keeps (one per page); with the agent it opens a duplex session, which bills by the
  minute. It closes on a second tap ("End chat"), on Start (the workout carries the conversation on), or after 2
  minutes without a word.
- **The Coach chat card** in the side panel shows the conversation, "You: ..." and "Coach: ...", for every coach, the
  agent's duplex included, apart from the technical log.

### What the page does with the words

`web/js/intents.js` (pure, `tests/intents.test.mjs`) reads in the words what is the page's to do:

- **An exercise**, by its names and the forms people say: squats, squat pulses, push-ups and press-ups, lunges, lateral
  or side raises, front raises, biceps curls or curls, triceps kickbacks, overhead or shoulder press, hip hinges and
  deadlifts, jumps, jumping jacks and star jumps, knee raises and high knees. It is applied while "which exercise?" is
  open (any mention that is not a question), and at any time as a short switch ("now lunges", "switch to curls", "let's
  do push-ups", "I'm doing squats"); never from a question ("how was my squat depth?") nor from words about pain ("my
  knee hurts when I squat": the coach answers those). The exercise being counted, named again, is no switch ("one more
  squat" in a set of squats).
- **A movement of the library**, by the spoken names the library gives it (`synonyms` in `library.json`, compiled by
  `movementNames()`): "I'm doing a quad stretch", "now a hip-hop dance". The same rule as for an exercise: any mention
  while "which exercise?" is open, else a short switch, never a question. A movement's name wins over an exercise's it
  contains ("overhead kettlebell squats" is the library's, "squats" the engine's); the movement named now, named again,
  is no switch. A gym exercise of the library is applied as its exercise. Its names are everyday words, so less is taken
  as naming one: with an exercise named too, the exercise is meant unless the words bring the movement in ("roll up into
  a squat" is about squats); and a longer answer names one only with an answer's words around it ("let me roll up my
  sleeves" names nothing).
- **"Detect it"**: "you figure it out", "detect it", "go back to auto"; with the question open, also "not sure" or "I
  don't know".
- **An answer to "Done with this set?"**, while it is open: yes, done, finished, that's it; or no, not yet, keep going,
  one more.
- **Counting and fillers** ("seven, eight", "um"; `chatter()`): never sent, whichever coach: they would cost a Claude
  or ChatGPT turn each (1.2 s measured) in the same queue as the workout's cues. The log notes them.

An applied intent takes the path of a chip or a button (`chooseExercise`, `answerSetEnd`, how `'voice'`), and the
coach gets one `user_said` with `applied`, which it confirms in its own words; a set ended so is not sent again as a
`set_end`. Other words go as a plain `user_said`, which the coach answers. With no brain (the engine's sentences), the
engine's sentence confirms an applied intent, counting is let pass, and other words get "I can count and coach your
reps; for questions, connect Claude or ChatGPT." A `user_said` never goes to the agent: it hears the user itself.

### The user_said event

| Field | What |
|---|---|
| `text` | the words, as Parakeet wrote them |
| `applied` | what the page did: `{type: "exercise", exercise, label}` (with `movement`, `display` for a gym exercise of the library), `{type: "movement", movement, display, movementKind, track}` (any other movement of the library), `{type: "auto"}` or `{type: "set_end", done, label?, set?, reps?}`; absent when it did nothing |
| `workout` | whether a workout runs (false in Talk to coach) |
| `exercise`, `exerciseLabel`, `set`, `reps` | the set in progress, if one is, as a set's own events are tagged |
| `auto` | as on every event the page sends: true while the tracker detects the exercise, false once one is named |
| `movement`, `movementDisplay` | as on every event the page sends while a movement of the library is named (no reps are counted meanwhile) |

Its reading (`heard()` in `server/coach.py`):

| The event | The reading |
|---|---|
| an exercise applied | `The user said: "now lunges". The page switched to counting Lunge: confirm in a few words.` |
| detecting applied | `... The page recognises the exercise as they go now: confirm in a few words.` |
| done applied | `... The page ended set 2 of Squat at 8 reps: confirm in a few words, with the reps.` |
| not yet applied | `... The page keeps set 2 of Squat going (8 reps so far): confirm in a few words.` |
| an exercise of the movement library applied (`display`) | `... The page switched to Overhead kettlebell squat (counted as Squat): confirm in a few words.` |
| a movement applied | `... The page switched to Quad stretch, a movement they named: the page times the hold, and no reps are counted meanwhile. Confirm it in a few words, with what you will keep track of.` (mid-set: `... The page ended set 2 of Squat at 8 reps and switched to Quad stretch, ... with the reps of the set that ended and what you will keep track of.`) |
| nothing applied, mid-set | `... The page changed nothing: it still counts Squat, and they are mid-set (set 2, 5 reps so far): answer in a few words.` |
| nothing applied, a movement named | `... The page changed nothing: it still tracks Quad stretch, a movement they named, and counts no reps. Answer them.` |
| nothing applied, no set, detecting | `The user said: "Let's do burpees.". The page changed nothing: it still recognises the exercise as they go. Answer them.` |
| nothing applied, no set, an exercise chosen (`auto`: false) | `... The page changed nothing: it still counts the exercise they chose. Answer them.` |
| nothing applied, no workout | `... No workout is running, so nothing is counted: answer them.` |
| nothing applied, no `workout` field | `The user said: "how was my squat depth?". Answer them.` |

In a workout, words the page did not apply are read as "the page changed nothing", with what it counts still, so that
the coach never confirms a switch that did not happen: a name the tracker cannot count ("burpees"), a wish rather than
a short switch, or a name Parakeet garbled. `SYSTEM` lists the 13 exercises the tracker counts (and, when the library
is built, its movements) and tells the coach never to confirm a choice, a switch or the end of a set unless the event
says the page did it: for an exercise it does not count and no movement of the library it says it cannot count or
track that one; for one it counts or a movement of the library, it tells the user to tap it or say it again as a short
switch.

The words are put on one line, cut to 500 characters, with double quotes made single. The page waits 3 s for the
confirmation of an applied intent (then the engine's sentence is spoken) and 10 s for an answer (`REPLY_MS`; then the
log says none came). A coach that lets the words pass (they were not meant for it) says an empty text: nothing is
spoken, and the log says "(the coach let that pass)".

**Measured** (2026-10-24, M3, through a dev server of its own; Claude Sonnet 5.5 at effort high): the session
connected in 3.3 s; "Now lunges." with the exercise applied was confirmed in 1.2 s ("Lunges, got it. Let's go."); the
question "How deep should my lunges be?" was answered in 3.0 s, in 30 words ("... Aim to lower until your front thigh
is about parallel to the floor and your back knee hovers just above it. Keep your chest tall."); "Seven, eight, nine,
ten." got an empty text in 1.2 s. (The server's time from the event to the cue; the page adds up to 0.3 s of polling.)
From the end of the user's words, the parts add up to about 0.7 s of quiet for the detector, 0.1-0.2 s for Parakeet,
1.2-3 s for Claude and 0.5 s for Kokoro's first sentence: 2.5-4.5 s to the coach's voice. That sum is an estimate: the
whole chain was not timed live here.

Before the readings said "the page changed nothing", Claude confirmed words the page had not applied: "Let's do
burpees." got "Burpees, great choice.", and "Now mountain climbers." mid-set "Mountain climbers, got it." (the page
still counted Squat). With them (2026-10-24, the same setup, one session, connected in 2.8 s): `ask_exercise` tagged
`listening: false` got "Hi, let's get moving! Which exercise are you starting with?" (1.1 s); "Let's do burpees." got
"I can't count burpees. I can count jumps, squats, push-ups and a few others, so pick one of those, or just start."
(1.2 s); "Now lunges." applied got "Lunges, got it. Whenever you're ready." (1.1 s); mid-set in Lunge, "Now mountain
climbers." got "I can't count mountain climbers, so we're staying with lunges. Keep going!" (2.4 s) and "How deep
should my lunges be?" got "Lower until both knees are around ninety degrees, back knee just above the floor." (2.2 s,
14 words).

## Each connection

### ElevenLabs agent

- **What runs.** The page itself: `web/js/eleven-coach.js` with the vendored `@elevenlabs/client` 1.27.0, loaded on
  first use. It always connects over WebSocket, voice too: a WebRTC connection carries no Origin header, and the
  allowlist needs it. The dev server gives the agent's id (`/api/connections`) and each event's one-line reading
  (`POST /api/coach/describe`), nothing more.
- **Model.** The agent's own LLM and voice. The page sends no override. The record's `llm` is shown in the panel only.
- **What it is sent.** Each event as a user message: the same JSON Claude reads from `wait_for_event`, without its
  `event_id`. In duplex, the user's own words as well, as speech.
- **One message in flight.** Events that arrive while a reply is on its way go together as one message ("N things
  happened while you were answering. Give one short cue for the most important one, ..."). The next message goes when
  the reply's text arrives, when an interruption cuts it off, or after 10 s (`CAP_MS`). Replies are told apart by the
  agent's event ids. If nothing of a reply has come by the cap, the next message waits until the agent has said nothing
  for 3 s (`GRACE_MS`). With its voice, a reply has played out after 1.5 s back in listening mode (`QUIET_MS`).
- **Late replies.** The page's 3 s fallback starts when a message actually goes. A reply that comes after it is not
  heard: its voice is turned down, and what is left of it is cut when the next reply starts.
- **One session per workout** (it bills by the minute). It connects at Start, and ends once the workout summary's
  reply has been heard or its fallback spoken: at most 25 s after the summary went (`END_MS`), or 15 s after Stop if
  no summary went (`STOP_END_MS`). With no event for 5 minutes, or the page hidden for a minute, it ends early, and the
  next event reconnects it ("ElevenLabs: reconnecting"). A new session waits up to 5 s for the last one to close,
  since the agent takes one at a time.
- **Rests.** `sendUserActivity` goes every 15 s, only while there is work (a workout with an event in the last 5
  minutes, or the session ending), so the agent does not speak up in a rest. The user can still talk to it.
- **Duplex.** With its own voice the session uses the real microphone, unmuted, with echo cancellation, noise
  suppression and automatic gain control on (so the agent does not hear its own voice from the speaker as the user's).
  The user talks to the agent: answers to its questions, a change of exercise, a short question about the workout.
  - The browser asks for the microphone at the first Start with the agent's voice. Inside the app the frame must allow
    it: `host/`'s iframe says `allow="camera; microphone; autoplay"`.
  - What the user said shows in the log ("You: ..."). A microphone toggle in the side panel mutes it: the client then
    sends ElevenLabs silence, but the microphone stays open until the session ends. A session started muted never
    opens it.
  - The agent answers the user's words on its own, with no message of the page's to answer. That answer is never
    taken for a tracker message's reply, and while the user talks or is being answered the next message waits
    (`USER_MS` for an answer to begin, then until its text), so a cue neither cuts the answer off nor takes it.
  - A microphone refused or missing: the session goes on muted, the log says why, and the user answers with the chips
    and buttons.
  - A text-only session (the agent with another voice) never asks for the microphone.
  - The conversation shows in the Coach chat card too, and Talk to coach opens a duplex session without a workout
    ([The page listens](#talking-to-the-coach-the-page-listens)).
- **Client tools.** The page registers the agent's two tools when the session starts
  (`Conversation.startSession({clientTools})`). `set_exercise({exercise})` applies the answer as a chip would (the
  exercise, or detecting for `"auto"`) and returns a short sentence ("Counting squats now."); `answer_set_end({done})`
  ends the open set or lets it go on, and returns a short sentence too. The agent then confirms in its own words.
- **Latency.** Live: 0.15-0.62 s per reply, 0.5 s from event to voice on the page. Benchmark: text 268 ms p50; first
  audio 0.35 s p50 with its voice; 0.84 s event to voice live with its text and Kokoro.
- **Cost.** ElevenLabs bills the session minutes on the user's plan. Auto skips an agent whose plan is saved as Free
  (a plan not given counts as paid).

### Claude

One session per page: started as soon as the plan names Claude, kept across sets and workouts, and stopped
(`sendBeacon('/api/coach/stop')`) when the plan changes or the page closes. It goes one of two ways, its transport
(`POSE_CLAUDE_TRANSPORT`): `auto`, the default, takes `api` when a key is saved
([your own key](#claude-through-the-anthropic-api-your-own-key)), the anthropic package is installed for the
server's Python (`tools/serve.sh` runs it on `.venv`'s) and the connection check has not found the key unusable
(refused, or the coach's model unknown to the API); else `cli`. `api` or `cli` forces one. A session takes its
transport when it starts, from the last connection check (never waited for), and keeps it.

- **Model.** `POSE_COACH_MODEL`, default `sonnet` (shown as Claude Sonnet 5.5, `claude-sonnet-5-5` to the API; `opus`
  and `haiku` work too), at effort `POSE_COACH_EFFORT`, default `high`. The same instructions for both, but for how
  the cue is given ([What Claude and ChatGPT are told](#what-claude-and-chatgpt-are-told)).

#### Through the Anthropic API (the user's key)

- **What runs.** No process: a worker thread in the dev server (`Session._api_loop`) takes the events from the same
  queue `wait_for_event` reads (so a cue's latency is measured the same way), sends each one as one user message (the
  event's JSON with its one-line `summary`, as `wait_for_event` gives it) and says the reply. No tools: the reply is
  the cue. The conversation is append-only for the session: each request carries every earlier event and reply, and
  the response's own blocks go back into it unchanged. It connects at once (no CLI to start). Once the session has
  ended (stopped, the page's plan changed, or 300 s with no poll from the page), nothing still queued is sent: before,
  the worker sent, and billed, every queued event after a stop, with nobody to hear the cues.
- **The request** (`client.beta.messages.create`, one per event, not streamed), the same for every request of the
  session, so the prompt cache holds:
  - `model` and `max_tokens` by the thinking setting (`max_tokens()` in `server/coach.py`): 400 with `between_tools`
    (a cue is at most 50 words, about 70 tokens, and none of it goes to thinking), 8,000 with adaptive thinking, which
    counts toward `max_tokens` too (from effort medium up the model thinks before almost every reply: at 400 most
    replies ended at `max_tokens` with no text). The 50-word rule in the instructions still bounds the cue;
  - `thinking: {type: "between_tools"}`, the lowest setting: no extended thinking, since a cue must come fast. Only
    Claude Sonnet 5.5 takes it, at effort `high` or below; another model, effort `xhigh` or `max`, or
    `POSE_CLAUDE_THINKING=adaptive` sends `{type: "adaptive"}`;
  - `output_config: {effort: <POSE_COACH_EFFORT>}`;
  - the instructions as one cached system block (about 2,500 tokens, frozen for the session), and automatic caching
    (`cache_control` on the request) for the conversation: each request reads what the one before it wrote;
  - `fallbacks: "default"` with the beta `server-side-fallback-2026-07-01`: a request the model declines (a refusal)
    is run again, in the same call, on the model Anthropic names for the refusal's category. Not sent for a Haiku
    model, which has no server-side fallback.
  `POSE_COACH_FAST` is for Claude Code only: the API request has no fast mode.
- **The client** (`api_client()`): `https://api.anthropic.com` alone, whatever `ANTHROPIC_BASE_URL` says
  ([the key](#claude-through-the-anthropic-api-your-own-key)); 10 s per attempt and 3 s to connect (`API_TIMEOUT_S`,
  `API_CONNECT_S`; the SDK's default is 10 minutes); and none of the SDK's retries (`max_retries` 0). The SDK follows
  any `retry-after`, however long (SDK 2.1.0: one 429 with `retry-after: 60` held the worker a minute), and its
  retries of 20 s attempts could hold it for minutes, while the page, which fails over only on a session that ended
  with an error, kept showing a connected coach that said nothing, and every event queued meanwhile was then sent one
  by one, too late to be spoken.
- **Its own retry.** One, for a connection error or a timeout, 408, 409, 429 or 5xx (529 overloaded too), unless the
  API answers `x-should-retry: false`: after 0.5 s, or the API's `retry-after` (`retry-after-ms`) cut to 2 s at most
  (`API_RETRY_S`, `API_RETRY_MAX_S`), and only while the event is still fresh: its cue could still come within the
  page's wait, counted from when the event was queued (3 s, `PAGE_WAIT_S`; 10 s, `ANSWER_WAIT_S`, for the user's words
  the page did nothing with, which it waits that long to have answered). A stop during that wait ends it at once.
- **Events the page stopped waiting for.** An event that waited in the queue past the page's wait (the page has
  spoken the engine's sentence, and would skip a late cue) is not sent: no request, and the log says `skipped:
  "late"`. The model hears of it with the next message, which starts with one line, "Earlier, handled on screen
  without you: (hold_progress) <its reading> | ..." (the last 6, `MISSED_MAX`), and `API_SYSTEM` says those are past:
  reply to the event after that line alone. So the conversation stays true at the cost of no request. An event whose
  request failed, or whose reply was cut short, goes into that line too.
- **The reply** is spoken as it is (cut to 400 characters). A reply of only a hyphen (words not meant for the coach, a
  short hold's end) or a refusal says nothing, and the event counts as answered. A reply cut at `max_tokens` is spoken
  only if it still ends as a sentence does; one cut mid-sentence says nothing and is left to the page, which speaks the
  engine's sentence after its wait, and counts as a failed request. A refusal stays out of the conversation (so the
  next request does not carry it again), as does a reply with no text.
- **When it fails.** A key the API refuses (401, 403) ends the session with "the Anthropic API refused the key (check
  .data/connections/anthropic-key)", and a request it rejects (400, 404 for the model, 402 billing, 413) with the
  API's own message, any key taken out; the page then moves on to its next connection
  ([How Auto picks](#how-auto-picks)). A request that still fails after its one retry (a connection error, a timeout,
  408, 409, 429, 5xx, 529 overloaded), or a reply cut short, is left to the page, which speaks the engine's sentence
  after its 3 s; three events in a row of those (`API_FAILURES`) end the session ("the Anthropic API failed 3 times in
  a row (last: ...)"), and the page moves on. Events skipped as late count neither way. Anything unexpected in the
  worker ends the session with its error, never unseen.
- **The session log** (`$POSE_DATA_DIR/coach/session-<id>.jsonl`), one line per request: `{"type": "pose_coach.api",
  event_id, kind, api_ms, latency_ms, usage: {input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
  output_tokens}, stop_reason, model, request_id, text, t}`, with `refusal` (its category), `fallback` (one
  `"<model> -> <model>"` per model that declined), `served_by` (the model that answered after a fallback) and
  `retried: true` (it went through on its retry) when there are. A request that failed: `{..., api_ms, failure:
  "refused" | "transient" | "fatal" | "cut", error}`, with `retry_in_ms` when it is tried again; an event not sent:
  `{..., skipped: "late", waited_ms}`; a session that ended on an error: `{"type": "pose_coach.gave_up", error}`.
  `text` is the reply; the event itself (and the user's words in it) is not logged, and the key never is.
- **Cost.** Per token, on the Anthropic Console account the key belongs to
  ([Billing](#claude-through-the-anthropic-api-your-own-key)).
- **Not measured here yet:** its latency per cue live, its cost per workout, and test set A
  ([Benchmarks](#benchmarks) are `claude -p`'s).

#### Through Claude Code (the user's login): the fallback

Used when no key is saved, when the server's Python has no anthropic package, when the connection check found the
key refused (or the model unknown), and with `POSE_CLAUDE_TRANSPORT=cli`.

- **What runs.** Claude Code, headless (a CLI takes a few seconds to start). `server/coach.py` runs:
  ```
  claude -p --model <POSE_COACH_MODEL> --effort <POSE_COACH_EFFORT> [--settings '{"fastMode": true}']
    --strict-mcp-config --mcp-config <coach/mcp-<id>.json> --tools "" --allowedTools mcp__pose__wait_for_event,mcp__pose__say
    --output-format stream-json --verbose --no-session-persistence --system-prompt <SYSTEM>
    "Coach the user's workout: call wait_for_event now."
  ```
  `--tools ""` turns off Claude Code's built-in tools (no shell, no files). It runs in an empty folder outside any checkout
  (`pose-coach-coach` in the system's temporary folder) with `--setting-sources ""` and `--disable-slash-commands`.
  Claude Code reads the CLAUDE.md files of every folder above its working directory and keys its auto memory by it, so
  a folder inside this repo would load the repo's CLAUDE.md and that project's memory; this way it loads neither, nor
  the user's settings, plugins or skills. Measured: the first cue's prompt fell from about 1,560 to 940 input tokens.
  A session's init line lists only the two pose tools.
- **Fast mode.** Only with `POSE_COACH_FAST=1` and an Opus model: the CLI has fast mode for Opus alone, and it needs
  extra usage on the plan. Anywhere else the flag is not passed.
- **Latency.** Live: about 1.4 s per cue, connects in about 3 s. Benchmark: text 1.55 s p50.
- **Cost.** Meant to be the user's Claude subscription, through the Claude Code login. `ANTHROPIC_API_KEY` is removed
  from its environment, so that key in the shell is never used by the coach (the user's own Claude Code sessions
  would use it: [never export it](#claude-through-the-anthropic-api-your-own-key)). Nothing else is checked: Auto
  counts any Claude Code sign-in (`loggedIn`, a Console account too), and `ANTHROPIC_AUTH_TOKEN`, Bedrock or Vertex
  (`CLAUDE_CODE_USE_*`) in the shell, or an `apiKeyHelper` in the user's settings, would still be used and billed per
  token.

### ChatGPT

- **What runs.** Codex, headless, with the same MCP server and the same instructions (`SYSTEM`, written to
  `coach/codex-<id>.md` and given as `model_instructions_file`, in place of Codex's own coding-agent instructions):
  ```
  codex exec --ignore-user-config --ignore-rules --skip-git-repo-check --ephemeral --json -m <POSE_CHATGPT_MODEL>
    -s read-only -C <coach/cwd> -c approval_policy="never" -c web_search="disabled" -c model_instructions_file=...
    -c mcp_servers.pose.{command, args, env, enabled_tools=["wait_for_event", "say"], default_tools_approval_mode="approve",
       startup_timeout_sec=60, tool_timeout_sec=600}
    --disable <15 Codex features: shell_tool, unified_exec, view_image, ...> <prompt>
  ```
  (Shortened: each `mcp_servers.pose.*` setting is its own `-c`, and each feature its own `--disable`; see
  `codex_cmd()` and `CODEX_OFF` in `server/coach.py`.)
  `--ignore-user-config` leaves out the user's own MCP servers, plugins and settings (the login stays). The read-only
  sandbox refuses `apply_patch`. With approvals off a tool that needs approval is refused, so the two pose tools are set
  to approve. `tool_timeout_sec=600` because `wait_for_event` waits up to 300 s.
- **Restarts.** `codex exec` ends when the model ends its turn. While the session is open (the page keeps it across
  sets, rests and workouts) the server starts it again, with a recap of the last 6 cues and "do not greet again". Every
  prompt says to keep calling `wait_for_event` until it returns done, because GPT-6 Luna was measured ending its turn
  after a workout summary. A run fails when it has not asked for an event within 60 s (20 s for a restart), ends before
  it connected, ends having taken events but said nothing, or takes a single event and ends its turn after that cue; a
  run given no event counts neither way. After 3 failed runs in a row the session ends
  with an error and the page moves on. The page gives up sooner on a first connect: at 30 s.
- **Model.** `POSE_CHATGPT_MODEL`, default `gpt-6-luna` (GPT-6 Luna). No effort or fast setting is passed, and the
  user's own Codex settings are left out, so Codex's defaults apply.
- **Latency.** Live: 1.1 s median per cue (0.9-2.8 s), connects in 5-7 s. Not run on the benchmark's test set through
  `codex exec` (GPT-6 Luna through the agent was: see [Benchmarks](#benchmarks)).
- **Cost.** The user's ChatGPT subscription, through the Codex ChatGPT login. A session starts only when Codex says
  "Logged in using ChatGPT": `codex exec` on an API key login would bill that key. `OPENAI_API_KEY` and `CODEX_API_KEY`
  are removed from its environment.

### The engine's own sentences

With no coach, or with AI coach Off, the page speaks the template sentences in `FALLBACK` (`web/js/app.js`). The same
sentences stand in for any cue that does not come within 3 s.

### What Claude and ChatGPT are told

`SYSTEM` in `server/coach.py`: call `wait_for_event` in a loop and `say` once per event; one or two short spoken
sentences, at most 25 words (40 for a workout summary, 50 for an answer to the user); coach the measured thing; never
invent a fault or a correction; name the exercise when a set starts; never write text outside tool calls.
`describe()` adds a one-line reading to each event ("Form fault on Squat, rep 3: ..."). The agent gets the same JSON;
its own prompt is set on the agent.

Both texts come from one, `SYSTEM_TEMPLATE`: `SYSTEM` for the MCP tools (Claude Code and Codex) and `API_SYSTEM` for
Claude through the API, which differ only in how the cue is given. Through the API each message is one event (its
JSON with the reading) or the user's words with what the page did, and the reply is read aloud as it is: "Reply with
only the words to speak"; where `SYSTEM` says to call `say` with an empty text, `API_SYSTEM` says to reply with only a
hyphen (-), and nothing is spoken. A message may start with a line on earlier events the page handled without the
model ([events the page stopped waiting for](#through-the-anthropic-api-the-users-key)): `API_SYSTEM` says they are
past, so it replies to the event after that line alone. Everything below holds for both.

The form rule (every coach; built because the coach called a triangle pose good that nothing had measured): the coach
does not see the user. It never says their form is good, correct or that nothing needs fixing, and never names
something they do right, unless an event measured it (a hold's form with nothing open, a clean set). Asked whether a
held pose is right, it answers from the last form reading; when the pose's form is not measured, it says it can time
it but cannot check its form, and gives the pose's key points as things to check themselves. `SYSTEM` says "nothing
open"; the readings narrow it: a hold's form is called fine only when every check was made and none is open or
pending, and otherwise its reading says so ("do not call the form good", "never call its form good as a whole", "never
say it looks right or wrong"; [Named movements](#named-movements-what-the-coach-is-told)). A moving or rhythm
movement's form is never called fine at all: `SYSTEM` says its checks look for a few clear mistakes only, never to call
such a movement's form good as a whole, and its progress readings say the same.

`SYSTEM` names the 13 exercises the tracker counts, and no other. They hear the user through the page, and `SYSTEM`
says so: while the page listens, what the user says comes as a `user_said` event (written down on this Mac; a
transcript can have small slips), the user's voice reaches them only that way, and the page is not always listening;
the user can always answer with the buttons on screen. For `ask_exercise` they greet (if they have not yet) and ask
which exercise, for `confirm_set_end` they give the reps and ask if the set is done, in both cases without telling the
user how to answer, and never asking them to say it when the event says they cannot talk now (`listening: false`). For
`exercise_set` (a chip) they confirm the choice in a few words, for `exercise_auto` they say they will spot the
exercise as they go. For `ask_exercise` they may ask about another movement too. They ask nothing else of their own
accord. A `set_end`
reading says how the set ended when the page passes its `reason`: "(after a rest)" (also when none is passed, as
before), "(the user tapped Done)", or, for `movement`, "(the user named a movement of the library, so no reps are
counted meanwhile)" with "say nothing now" (the reps go with the `movement_set` that follows): a set the user ends by
voice is not sent, since the agent heard it, or the page sent the user's
words with it (`user_said`, `applied`).

The rules for the movements of the library, the same as the agent's own prompt has
([Named movements](#named-movements-what-the-coach-is-told)), and three more (a short hold's end, never per side, notes
as form cues) that reach the agent through the readings only:
- the tracker never recognises one by itself, and neither do they: they keep track only of the movement the user named,
  with what the tracker reports;
- reps are counted only for the 13 exercises; while another movement is named, none are counted;
- `movement_set`: confirm it in a few words, with what will be kept track of (the hold time, the time moving, or an
  approximate rhythm); `hold_start`: the correction of a fault the event measured, else one short cue on what to keep,
  from the event's notes; `hold_fault`: its correction in a few words; `hold_fix`: praise for that fix in a few words;
  `hold_progress`: the time held; `hold_end`: how long it was held, and nothing for a hold of a few seconds (an empty
  `say`, or a hyphen through the API); the hold is timed as a whole, never per side or leg; `moving_progress`: a few
  words of encouragement with the time;
- `form_fault` (a clear mistake measured while they move, in a flow, a dance, a transition or a gym move with no rep
  counter): its correction in a few words; `form_fix`: praise for that fix in a few words; these checks look for a few
  clear mistakes only, so such a movement's form is never called good as a whole (the agent's own prompt was updated
  for these two events outside the repo);
- `form_unseen` (while they do a movement or hold a pose, every part its form is checked by is out of the picture, or
  they are side-on to the camera): ask them in a few words to step back, or to turn to face the camera, as the event
  says; their form is not being checked meanwhile, so it is never called right or wrong (the agent's prompt was
  updated for it outside the repo too);
- `rhythm_progress`: approximate, always said with "about", never as an exact count of reps;
- the notes are form cues: they never make a count or a time the events did not give, and the coach never offers to
  count or time anything the events do not; a movement that is neither an exercise nor in the library: "I can't track
  that one";
- the workout summary gives the holds and other movements with their times (a rhythm count with "about"); during a hold,
  as during a set, an answer is a few words.

When the library is built, a session's instructions are `SYSTEM` (or `API_SYSTEM`) plus its movements' names by what
is kept track of
(`system_prompt()`: "a hold timer: ...; the time moving: ...; an approximate rhythm count: ...; counted as the exercise
in brackets: ..."), read when the session starts. The names come from the private library at run time, so `SYSTEM` in
the repo names none; the agent knows them from its `set_movement` tool's enum.

The conversation rules for `user_said`, the same as the agent's own prompt allows:
- what the page did with the words (`applied`) is confirmed in a few words, and not asked again;
- a choice or a switch of exercise or movement, or the end of a set, is never confirmed unless the event says the page
  did it; when the page changed nothing, an exercise the tracker does not count (and no movement of the library) gets
  "it cannot count or track that one", and one it counts or a movement of the library gets "tap it, or say it again as
  a short switch"; with no workout running, nothing is counted;
- anything else is answered in two or three short spoken sentences, at most 50 words; mid-set, in a few words;
- from general fitness knowledge (technique, breathing, tempo, rest, warm-up, sets and reps), and about this workout
  only what the events said: never an invented measurement, count or fault ("if you were not told, say so");
- pain, dizziness or an injury: stop that exercise, general advice only, see a doctor or a physiotherapist if it goes
  on; never a diagnosis;
- words not meant for the coach (counting out loud, breathing, someone else, music, a fragment): an empty `say` (a
  hyphen through the API), so nothing is spoken;
- the same before a workout and between workouts (Talk to coach).

The `say` tool's own description (`server/pose_mcp.py`) still reads "one or two sentences, at most 25 words" and does
not mention an empty text; `SYSTEM` allows 50 words for an answer and asks for the empty text. Claude follows `SYSTEM`
(measured: 26-30 word answers, and empty texts); ChatGPT was not run with `user_said` events.

## Voices

| Voice | Runs | Set up by | First sentence, p50 (M3) |
|---|---|---|---|
| Kokoro-82M on MLX (default) | a worker of the dev server on the Mac's GPU (`server/tts.py`, `server/kokoro_worker.py`) | `tools/setup_kokoro.sh` | 0.48-0.53 s |
| Kokoro-82M in the browser | a Worker: kokoro-js 1.2.1 on WebGPU, fp32 (`web/js/kokoro-worker.js`) | `tools/fetch_assets.sh` | 1.75 s (about 10 s to load) |
| The Mac's voice | `speechSynthesis` | nothing | not measured |
| The agent's own | ElevenLabs, with the agent's LLM | the agent | 0.35 s event to first audio |

- **Kokoro on MLX.** `mlx-community/Kokoro-82M-bf16` at a pinned revision (`kokoro_worker.py`), voice `af_heart`. The
  54 voices are loaded by path from the same snapshot (a bare name would make mlx-audio fetch another repo's latest).
  The worker says "Ready when you are." once at start-up to load the G2P and compile the GPU kernels. The dev server
  starts it in the background when `.venv-kokoro` exists. A worker that exits is started again, up to 3 times in a row
  with no sentence made in between; then the status says to restart the dev server. Its stderr goes to
  `.data/kokoro-worker.log`.
- **Setup.** `tools/setup_kokoro.sh` needs Apple Silicon and uv. It makes `.venv-kokoro` (Python 3.12) with mlx-audio
  0.5.8, mlx 0.32.3 and misaki[en] 0.9.4, none newer than `POSE_PIN_DATE` (default 2026-10-09), downloads the pinned
  snapshot into the Hugging Face cache (`HF_HOME`), and says one sentence. Measured: the venv is about 1.1 GB and the
  snapshot about 370 MB (the script's comment says about 1 GB). On first use misaki also downloads spaCy's
  `en_core_web_sm` (not pinned by the script).
- **Kokoro in the browser.** The fallback when the server's voice is not set up: about 3x slower to the first
  sentence. It needs a WebGPU adapter. The model (`onnx-community/Kokoro-82M-v1.0-ONNX` at a pinned revision,
  checked against `web/models/kokoro/SHA256SUMS`) and the 28 English voices are served by the dev server, and the
  worker refuses any other request that would leave the machine.
- **The Mac's voice.** An en-US or en-GB system voice (Samantha, Daniel, or a Premium or Enhanced one), at rate 1.05.
  `speechSynthesis` is one per page, so a Mac voice stops only its own utterance.
- **The agent's own.** ElevenLabs expressive tags ("[excited]") are taken out of the text on screen. A reply already
  heard in the agent's voice is shown and logged, not spoken again.
- **Every page voice** (Kokoro on the server or in the browser, the Mac's) speaks one cue at a time and never falls
  behind: a new cue cuts the one still playing. The agent's own voice gets one message at a time instead (see
  [One message in flight](#elevenlabs-agent)): a newer reply cuts only a late, hushed one. Audio is unlocked in the
  Start click. Each voice reports when a cue became audible (the *Cue delay* line: event to voice).
- **Cue splitting** (`web/js/speech-text.js`, the same rule in `kokoro_worker.py`). By sentence (not inside "1.5", not
  after "e.g." going on in lower case); a first sentence under 25 characters joins the next; then the first chunk is
  cut at its first comma, semicolon or colon if that leaves 12 characters or more on each side. Measured on an M3, this
  took the first sentence's median from 527 to 476 ms and its p90 from 1210 to 874 ms.
- **Licences.** Kokoro-82M and mlx-audio are Apache-2.0/MIT. misaki's espeak-ng fallback (phonemizer-fork) and the
  phonemizer inside kokoro-js are GPL-3.0: fine on this Mac, a question before the voice is served to other people.

### The /api/tts protocol

```
GET /api/tts?text=<cue>&voice=af_heart&page=<id>&seq=<n>
200 application/x-ndjson, one line per sentence as it is made (HTTP/1.0: the stream ends at close):
  {"id", "i", "last", "rate": 24000, "text", "synth_ms", "pcm": <base64 int16 little-endian>}
  ... ending with "last": true, {"superseded": true} or {"error": "..."}
```

- **Input.** `text` is cut to 600 characters. 400 for text with no letter or digit ("nothing to say"), for a voice
  that is not like `af_heart` (`[a-z]{2}_[a-z]{2,12}`; the first letter is the accent: `a` American, `b` British), or
  for `page` and `seq` not given together (`page`: 1-40 of `A-Za-z0-9_-`, `seq`: digits). 503 "Kokoro is not set up
  (bash tools/setup_kokoro.sh)" without the venv.
- **page and seq.** `page` is one random id per page voice (16 hex characters); `seq` rises with each cue. A cue whose
  seq is above its page's latest ends that page's older cues: their streams get `{"superseded": true}`, and the worker
  drops their remaining sentences (the one in progress finishes). A cue whose seq is not above its page's latest gets
  only `{"superseded": true}`. Cues of other pages, or with no page, are made in turn. The latest seq is kept for the
  100 most recent pages.
- **Errors after the start** arrive as lines, not status codes: "Kokoro is not ready" (not ready within 60 s), "Kokoro
  took too long" (20 s for a sentence), "the Kokoro worker stopped".
- **Closing early.** A page that stops listening (it aborts a cue a newer one cut) frees the worker: the rest of that
  cue is dropped.
- `GET /api/tts/status` gives `{available, ready, error}`, plus `load_ms` and `warm_ms` once Kokoro is ready. The
  page polls it every 500 ms for up to a minute before falling back.
- **The worker** reads `{"id", "text", "voice"}` and `{"cancel": n}` on stdin, and writes the ready line, then the
  sentence lines, on stdout (`server/kokoro_worker.py`).

## Speech to text: Parakeet on MLX

What the user says to Claude, ChatGPT or the engine is written down on this Mac, never sent anywhere as audio.

- **The model.** `mlx-community/parakeet-tdt-0.6b-v3` at a pinned revision (`ed2b7e8c...`, in `server/stt.py` and
  `server/stt_worker.py`): NVIDIA's Parakeet TDT 0.6B v3 converted to MLX, 25 European languages, CC-BY-4.0. 2.5 GB in
  the Hugging Face cache.
- **The worker.** `server/stt_worker.py` in Kokoro's venv (`.venv-kokoro`: mlx-audio 0.5.8 has both models), built as
  Kokoro's is: JSON lines on stdin and stdout, loaded once and warmed up on a second of quiet noise (it compiles the GPU
  kernels), started with the dev server when the venv and the model's snapshot are there (a model set up while the
  server runs is loaded at the page's next `GET /api/stt/status`), and started again if it stops, up to 3 times in a
  row with no utterance written down in between (then the status says to restart the dev server). Its stderr goes to `.data/stt-worker.log`. It reads the model offline (`HF_HUB_OFFLINE=1`,
  `local_files_only`): a missing model is an error that names the setup script, never a 2.5 GB download in the
  background.
- **Setup.** `tools/setup_stt.sh` (Apple Silicon): runs `tools/setup_kokoro.sh` first if the venv is not there,
  downloads the pinned snapshot, and checks it end to end: Kokoro says "Switch to lunges now.", resampled to 16 kHz,
  and Parakeet must hear "lunges". Measured: loaded in 9.5 s, heard "Switch to lunges now.".
- **Each dev server loads its own**, as it does Kokoro: a second server (`serve.sh m3d` on 8766) restarted after this
  change loads a second Parakeet. On a 16 GB Mac under memory pressure the worker's memory was paged out after a
  minute idle (resident 870 MB after loading, 12 MB later), and the next utterance took 0.65-0.9 s instead of 0.1-0.2 s.
  `POSE_STT=0` turns it off on a server that needs no listening: nothing is loaded, the status says "turned off on
  this server (POSE_STT=0)" and `/api/stt` answers 503. `tools/serve.sh m3d` does not set it yet.

**Measured** (2026-10-24, MacBook Air M3 16 GB, through a dev server of its own, while three other dev servers ran, one
loading its own Parakeet):

| What | Result | Parakeet's time (`ms`) |
|---|---|---|
| Start | ready 13 s after the server started (load 9.1 s, warm-up 3.0 s, Kokoro loading at the same time) | |
| 60 phrases in Kokoro's voices (20 phrases: exercise names, switches, "yes, I'm done", "not yet, one more", questions; af_heart, bf_emma, am_michael), from `/api/tts` at 24 kHz resampled to 16 kHz, 1.5-3.7 s of speech with 0.3 s of quiet before and 0.7 s after | 54 of 60 word for word (case and punctuation aside): af_heart 19/20, am_michael 20/20, bf_emma 15/20 | p50 156 ms, p90 237 ms, max 888 ms (the first after the warm-up); round trip p50 163 ms, p90 243 ms |
| The misses | "My knee hurts" -> "Mine hurts" (af_heart); bf_emma: a filler added at the end ("squats, eh", "hinges uh", "pulse eh"), "Jumping Jackson", "Front razors are" | |
| The same 10 phrases in white noise at 10 dB SNR | 10 of 10 word for word | 106-170 ms |
| Silence (2 s, 15 s), white noise (2 s at RMS 0.01, 0.05, 0.2), brown noise, clicks, a 100 Hz hum | no words ("") every time | 160-206 ms; 576 ms for 15 s |
| A bare "No." in Kokoro's voice | "Now" (also with the pre-roll and quiet around it) | |
| Less than 0.2 s of audio, down to 1 sample | no words | 43-217 ms |
| 15 s of speech (the page's longest utterance) | | 601-691 ms |
| 30 s of speech (phrases one after another), the server's maximum | 38 of 39 words (the last cut by the 30 s) | 1.13-1.30 s; round trip 1.15-1.35 s |
| 30 s and 1 sample | 400 | |
| The first utterance after a minute idle | (memory paged out, see above) | 0.65-0.9 s, four times; then 0.1-0.2 s |
| Outliers | around the time another dev server here started its own Kokoro and Parakeet (GPU and memory contention) | 2.4 s once, 13.7 s once |

"Jumping Jackson" reads as a jump in `web/js/intents.js` ("jumping" is one of a jump's names), and a bare "no" can come
back as "now", which is no answer: say "not yet", or tap. Kokoro's voices are clean speech; a real voice in a real room
was not measured here.

### The /api/stt protocol

```
POST /api/stt   Content-Type: application/octet-stream, body: PCM16 little-endian, mono, 16000 Hz, at most 30 s
200 {"text": "Now lunges.", "ms": 156, "seconds": 2.65}      text "" for no words; ms: Parakeet's time
400 {"error"}   an empty body, an odd number of bytes, or more than 30 s (960000 bytes)
415 {"error"}   another Content-Type (text/plain, a form, JSON, audio/wav, none)
403 {"error"}   an Origin that is not a page on this machine
503 {"error"}   "Parakeet is not set up (bash tools/setup_stt.sh)", "Parakeet is turned off on this server
                (POSE_STT=0)", "Parakeet is loading", "the Parakeet worker stopped", or "... stopped 4 times in a
                row (see stt-worker.log); restart the dev server": the page closes its microphone until the
                status says ready
504 {"error"}   "Parakeet took over 20 s for this utterance" (the GPU busy elsewhere): that utterance only, the
                worker is up and the page goes on listening; the next utterance waits behind it
500 {"error"}   the model failed on this audio (the page goes on listening)
GET /api/stt/status  {available, ready, error}, plus load_ms and warm_ms once ready; a model set up since the
                server started is loaded now (the page asks every second while it loads)
```

- **Why raw audio.** A page elsewhere can send a form or plain text to 127.0.0.1 without the browser asking first, but
  not `application/octet-stream`: that needs a preflight this server never answers. With the Origin check, only this
  machine's pages (any port) and local processes (curl sends no Origin) can use the Mac's GPU for it.
- **What is kept.** Not the audio: the page, the server and the worker keep none (the server logs only failed
  requests' status lines). The words are kept where the coach's other events are: in the coach session's log on this
  Mac (`$POSE_DATA_DIR/coach/session-<id>.jsonl`, the CLI's output; through the API it keeps the replies, not the
  events) and by the coach's provider ([Security and privacy](#security-and-privacy)).
- Utterances are written down in turn, one at a time (0.1-0.2 s each), and never cancelled.
- **The worker** reads `{"id", "pcm": <base64>}` on stdin, and writes the ready line, then `{"id", "text", "ms",
  "seconds"}` or `{"id", "error"}`, on stdout (`server/stt_worker.py`).

## Server API

`server/dev_server.py` binds 127.0.0.1 only (`--port`, default 8765). Its docstring describes the routes (without
`/api/health`, and the coach's as one entry); the table below lists the coach, connection, voice and movement-library
ones.

**Guards** (the first three on every request):

- **Host check.** The `Host` header must be `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`; anything else
  gets 421. A page whose name was made to resolve to 127.0.0.1 (DNS rebinding) sends its own name, so it is turned away.
- **Framing.** Every response says `Content-Security-Policy: frame-ancestors 'self' http://localhost:* http://127.0.0.1:*`.
- **No CORS headers**, so a page elsewhere cannot read any answer.
- **Write guard** on the requests that change a connection or start a coach session (a CLI on the user's login, or
  API calls on their key): `POST`/`DELETE /api/connections/elevenlabs` and `POST /api/coach/start`. The body must
  be `Content-Type: application/json` (else 415), and an `Origin` header, when present, must be a page on this
  machine (`http://127.0.0.1`, `localhost` or `[::1]`, any port; else 403). A page elsewhere can send a form or plain
  text without the browser asking first, but not JSON. `POST /api/stt` is guarded
  the same way, with `Content-Type: application/octet-stream`.
- The other `/api/coach/*` calls, except `describe` (which only reads an event back), need a 12-hex session id, which
  a page elsewhere cannot read. JSON bodies are capped at 200 MiB.
- **Not guarded:** `POST /api/results` (`web/eval.html`'s landmark series and snapshots) and `POST /api/bench/result`
  check neither the Content-Type nor the Origin. A page elsewhere can send them plain text with no CORS preflight
  (addressed to 127.0.0.1, so the Host check passes) and overwrite files under `$POSE_DATA_DIR/results/<model>/` (JSON,
  and decoded bytes as `.jpg` snapshots) or the private benchmark's `results/`, up to the body cap.

| Endpoint | Body or query | Answer |
|---|---|---|
| `GET /api/connections[?fresh=1]` | | `{eleven: {connected, agentId, name, plan, paid, llm}, claude: {available, loggedIn, plan, model, effort, fast, error, transport, api: {configured, ok, error, warning}}, chatgpt: {available, loggedIn, model, error}, order, auto}` |
| `POST /api/connections/elevenlabs` | `{"agentId": "agent_...", "plan": "<name>" \| null}` | as `GET /api/connections`; 400 for a bad id, a bad plan or a body that is not an object |
| `DELETE /api/connections/elevenlabs` | `{}` | as `GET /api/connections` |
| `GET /api/config` | | `{"elevenAgentId": <id or null>}` (the page now reads the id from `/api/connections`) |
| `POST /api/coach/start` | `{"exercise", "brain": "claude" (default) \| "chatgpt"}` | `{"session": <12 hex>, "brain", "transport": "api" \| "cli"}`; 400 for another brain or ChatGPT not signed in; 500 `"<Type>: <message>"` otherwise (with `POSE_CLAUDE_TRANSPORT=api`: no key saved, or no anthropic package) |
| `POST /api/coach/event` | `{"session", "event"}` | `{"queued": <event id>}` |
| `POST /api/coach/describe` | `{"event"}` | the event with its one-line `summary` (no session needed; the agent's messages) |
| `GET /api/coach/said?session=&since=N` | polled by the page every 300 ms | `{said: [{text, t, event_id, kind, latency_ms}], total, alive, connected, brain, transport, error, connect_ms}` |
| `POST /api/coach/stop` | `{"session"}` (the page sends it with `sendBeacon`) | `{"stopped": <id>}` |
| `GET /api/coach/next?session=&timeout=&run=` | the MCP server's long poll (timeout 30 s, 60 at most) | the event with its `event_id`, `{"idle": true}` or `{"done": true}` |
| `POST /api/coach/say` | `{"session", "text"}` (cut to 400 characters), from the MCP server | `{"ok": true}` |
| `GET /api/tts`, `GET /api/tts/status` | see [above](#the-apitts-protocol) | |
| `POST /api/stt`, `GET /api/stt/status` | see [above](#the-apistt-protocol) | |
| `GET /api/health` | | `{ok, clips, moves, coach: {mode, claude_cli, model, effort, fast, transport, thinking, codex_cli, chatgpt_model, mcp_python, sessions}}` (`transport`: what a Claude session would take now, as `POST /api/coach/start` takes it: from the key file and the last connection check, so a key the check found refused reads `cli`; `thinking`: `between_tools` or `adaptive`) (`moves`: whether `library.json` is built) |
| `GET /moves/library.json` | | the movement library, from `POSE_MOVES_DIR` (default `.data/moves`): `{built, movements: [{key, id, display, kind, track, engine?, coach, glb, durationSec, synonyms, rhythm?, held?, pose?}]}` (`held` and `pose`, for a hold: the held part of its GLB's animation in seconds, and its reference pose, `{image: [[x, y], ...], side}`, for the form check); 404 until `tools/build_moves.mjs` has built it |
| `GET /moves/glb/<key>.glb` | | a movement's animation (Mixamo Y Bot, `model/gltf-binary`, byte ranges), for Show in 3D. The key is lower-case letters, digits, `_` and `-`. Nothing else of `POSE_MOVES_DIR` is served (the catalog, the study's reports, the skeletons: 404), only by GET, and a file there that links outside the folder is refused |
| `/bench/<file>`, `POST /api/bench/result?name=` | | the private benchmark's pages and results (`POSE_BENCH_DIR`) |

- **Details.** `paid` is null when the plan is not known, else whether it is not "free". The panel's `name`, `plan`
  and `llm` come from the record only when it names the agent in use (not one set by `POSE_ELEVEN_AGENT` alone). An
  unknown session gets 404. `/api/coach/next` answers done when the session ended, when the poll is from an earlier
  codex run, or when the page has not polled for 300 s.
- **Claude's `transport` and `api`.** `transport` is the way a Claude session would go now (`coach.claude_transport`).
  `api.configured`: a key is saved; `api.ok`: true when the API read the coach's model with the key (`GET
  /v1/models/<id>`, which spends no tokens), false when it refused the key or the request (a refused key, the model
  unknown), null when no key is saved or the check got no answer (`error` "the Anthropic API did not answer (...)",
  checked again after 10 s); `api.warning`: the key file's mode lets other users open it ("... chmod 600 ...", from
  the mode alone; the key still works), else null. The check is kept for a minute, but run again at once when a key
  was saved or removed since (the key file's presence and `api.configured` disagree), so `transport` (read from the
  file now) and `api` agree on whether a key is saved. The key itself is in no answer: only whether there is one.
- **The MCP server** (`server/pose_mcp.py`, stdio, the tools `mcp__pose__wait_for_event` and `mcp__pose__say`).
  `wait_for_event(timeout_s=300)` waits out rests on the server, in polls of 30 s at most, so a rest costs no model
  turn; it returns an event, `{"idle": true}` after 300 s, or `{"done": true}`. `say(text)` posts the cue.
- **A quirk.** Malformed JSON on `/api/coach/*` gets no JSON error answer: it is parsed outside the error handling.
- **The movement library** is read-only and has no write route. Like the page and the demos it is behind the Host
  check alone; with no CORS headers, a page elsewhere cannot read it.

## Configuration

| Variable | Default | What |
|---|---|---|
| `POSE_COACH_MODEL` | `sonnet` | Claude's model (an alias or a model id) |
| `POSE_COACH_EFFORT` | `high` | Claude's effort |
| `POSE_COACH_FAST` | unset | `1` turns fast mode on, with an Opus model only, through Claude Code only |
| `POSE_CLAUDE_TRANSPORT` | `auto` | how Claude goes: `auto` (the API when a key is saved and not refused, else Claude Code), `api` or `cli` |
| `POSE_ANTHROPIC_KEY_FILE` | `.data/connections/anthropic-key` | the file the user's Anthropic API key is read from (never the key itself) |
| `POSE_CLAUDE_THINKING` | `between_tools` | Claude's thinking through the API: `between_tools` (no extended thinking; Claude Sonnet 5.5 at effort `high` or below, else adaptive) or `adaptive` |
| `POSE_CHATGPT_MODEL` | `gpt-6-luna` | the Codex model |
| `POSE_ELEVEN_AGENT` | unset | the agent id, over the saved record (it must look like `agent_...`) |
| `POSE_DATA_DIR` | `.data` (`tools/serve.sh`: `.data/posedata`) | data, results and the coach's session files |
| `POSE_MOVES_DIR` | `.data/moves` | the movement library: `library.json` and `glb/` (served at `/moves/`), read by the coach's readings and instructions too |
| `POSE_BENCH_DIR` | `.data/dev/bench` | the private benchmark |
| `POSE_KOKORO_PY` | `.venv-kokoro/bin/python` | the Kokoro worker's Python |
| `POSE_KOKORO_REPO`, `POSE_KOKORO_REVISION` | `mlx-community/Kokoro-82M-bf16` at a pinned revision | the MLX model snapshot, read by `kokoro_worker.py` only: `tools/setup_kokoro.sh` always fetches and checks the default, so another snapshot is downloaded on the worker's first start |
| `POSE_PIN_DATE` | `2026-10-09` | `tools/setup_kokoro.sh`: no package newer than this |
| `POSE_STT` | unset (on) | `0` (or `off`) turns the speech to text off on this server: no Parakeet is loaded (2.5 GB on disk, about 0.9 GB in memory), and the page does not listen |
| `POSE_STT_PY` | `POSE_KOKORO_PY`, else `.venv-kokoro/bin/python` | the Parakeet worker's Python |
| `POSE_STT_REPO`, `POSE_STT_REVISION` | `mlx-community/parakeet-tdt-0.6b-v3` at a pinned revision | the model snapshot, read by `stt.py` (is it there?) and `stt_worker.py`; `tools/setup_stt.sh` always fetches the default |
| `PORT` | 8765 (8766 for `serve.sh m3d`) | `tools/serve.sh` only; otherwise `--port` |
| `NVM_DIR`, `NVM_BIN` | `NVM_DIR`: `$HOME/.nvm`; `NVM_BIN`: unset (nvm sets it when loaded) | where the server looks for an npm install of `codex` |

The coach passes `POSE_SERVER`, `POSE_COACH_SESSION` and (for Codex) `POSE_COACH_RUN` to the MCP server. The CLIs are
looked up on `PATH`, then where their installers put them (`$HOME/.local/bin`; for Codex also Homebrew and nvm's nodes).

**Files** (all under `.data/`, git-ignored):

| Path | What |
|---|---|
| `.data/connections/elevenlabs.json` | the agent record `{setUp, agentId, plan, name, llm}`: mode 0600, written whole or not at all. Always under the repo's own `.data/`. No secret |
| `.data/connections/elevenlabs.json.forgotten` | the record after Forget (the agent itself stays in the ElevenLabs workspace). Saving the same agent again keeps its name and LLM |
| `.data/eleven-agent-id` | the older file with the id alone, read last; Forget moves it aside too |
| `.data/connections/anthropic-key` | the user's Anthropic API key, alone (`POSE_ANTHROPIC_KEY_FILE` elsewhere): written by the user with `mkdir -p .data/connections && (umask 077; pbpaste > .data/connections/anthropic-key) && chmod 600 .data/connections/anthropic-key`, mode 0600, never by the server (which only warns when the mode lets other users open it). A secret: never read, printed, copied or committed by anyone working on the repo |
| `$POSE_DATA_DIR/coach/cwd/` | the CLIs' empty working directory |
| `$POSE_DATA_DIR/coach/mcp-<id>.json`, `codex-<id>.md` | a Claude session's MCP config; a Codex session's instructions |
| `$POSE_DATA_DIR/coach/session-<id>.jsonl` | the CLI's stream output (for Codex, one log across its runs, with restart lines); through the API, a line per request ([what it holds](#through-the-anthropic-api-the-users-key)) |
| `.data/kokoro-worker.log` | the Kokoro worker's stderr |
| `.data/stt-worker.log` | the Parakeet worker's stderr |
| `.data/moves/library.json`, `.data/moves/glb/<key>.glb` | the movement library and its animations (`tools/build_moves.mjs`, from the private motion library; licensed) |
| `.data/dev/bench/` | the voice-coach benchmark (private) |

## Security and privacy

- **One key: the user's own Anthropic API key, for Claude through the API.** Nothing else in this project takes a
  key: Claude Code runs on the user's Claude login, ChatGPT on Codex's ChatGPT login, and the agent is reached by its
  id. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `CODEX_API_KEY` are removed from the CLIs' environments, and a Codex
  signed in with an API key is never started. Claude Code's check is looser: any Claude Code sign-in counts, and its
  other credential routes are not ruled out (see [Claude](#claude)).
- **The key's rules.** It lives in `.data/connections/anthropic-key` (git-ignored, mode 0600 from the user's `umask
  077` and `chmod 600`; the server only reads it, and its connection check warns when the mode lets other users open
  the file), and goes to the SDK's client alone, which sends it to `https://api.anthropic.com` only, whatever
  `ANTHROPIC_BASE_URL` says: never into a log, a status, an error, an answer or the environment. Errors pass through
  `scrub()`, which takes out the key and anything shaped like one (`sk-ant-...`). The API's check and the session log
  hold none of it. Never export `ANTHROPIC_API_KEY` in the shell: Claude Code would use that key and bill it for the
  user's own sessions. An agent working on this repo never reads, prints, copies or logs the file, and the tests never
  read it or call the API (a made-up key path, a stand-in client).
- **The no-key agent.** The agent is public, so the page needs no secret. What limits it:
  - its allowlist answers only pages served from localhost or 127.0.0.1 (any port), on any machine: it keeps other websites out,
    not other people. The page always connects over WebSocket, so the browser sends the Origin;
  - it takes one session at a time and a capped number a day;
  - it refuses every client override except text-only, so a caller cannot change its LLM or prompt;
  - its id stays out of the repo (the environment or the git-ignored record). The server gives it to any request that
    passes the Host check, with no CORS: this machine's pages, and any local process (curl sends no Origin).
- **The trade-off.** The id is an identifier, not a secret: every page load receives it, and it shows in the browser's
  developer tools, in HAR files and on a shared screen. Anyone who has it can serve a page from localhost on
  their own machine, or use a client outside a browser that sends any Origin, and start sessions on the user's plan. So
  keep the id private, but count on the agent's own limits for spend: at most the daily session cap times the agent's
  maximum conversation duration (a setting on the agent in ElevenLabs, which this repo neither sets nor checks). The
  other way is a private agent with an API key kept on this machine: the server would ask ElevenLabs for a signed URL
  per session, and only this server could start one. That puts a secret on the machine and a call to ElevenLabs before
  each workout; this prototype chose no secret.
- **Writes.** Only JSON from this machine's pages (or a request with no Origin, such as curl) can set or forget the
  agent or start a coach session (a CLI on the user's login, or API calls billed to their key): a page elsewhere
  cannot spend either. `POST /api/results` and `POST /api/bench/result` have no such guard (see
  [Server API](#server-api)).
- **Nothing secret comes back.** `/api/connections` says only whether each CLI is signed in and, for Claude, the plan's
  name, the transport, whether an API key is saved and whether the API took it (with the API's error, any key taken
  out). What the CLIs print (an email, an organisation, part of a key) never leaves `server/connections.py`.
- **The coach sessions are boxed in.** Claude through the API has no tools at all: its reply is spoken, and nothing
  else is done with it. Claude Code has no built-in tools; Codex has its own tools disabled, a read-only sandbox, no web
  search and none of the user's settings. Claude Code gets only the two pose tools; Codex gets them (through its
  code-mode host, which stays on) plus `apply_patch`, which its read-only sandbox refuses. Both CLIs run in an empty
  folder outside any checkout, and Claude Code without the user's settings, plugins or skills (see [Claude](#claude)).
- **What leaves the machine.** Small text events: to ElevenLabs for the agent, to Anthropic through the API (each
  request carries the session's conversation so far) or Claude Code, or to OpenAI through Codex. A movement's measured
  form (a held pose's, a moving movement's) goes as measured numbers and labels, never landmarks. With a movement of
  the library named, its name and coaching line go with them (and the library's names in Claude's and ChatGPT's
  instructions); its animations, its reference poses, the catalog and the study stay on this Mac. In duplex, the
  user's voice too (below). When the page listens, only the user's words, as text (below). Video never does. Kokoro
  and Parakeet run here; the browser Kokoro fetches nothing from outside.
- **The user's voice (duplex).** With the agent and its own voice the agent's session opens the microphone. What it
  hears (the user, and whatever else is in the room) streams to ElevenLabs for transcription, and the transcript of
  what the user said is kept in the agent's conversation history in the ElevenLabs workspace, next to the events and
  the agent's replies.
  What else is kept, and for how long, is set on the agent in ElevenLabs, not in this repo. Since 2026-10-24 the
  agent records no audio (and stored audio is deleted) and keeps transcripts for 30 days; change those privacy
  settings on the agent to keep more or less. **Mute** in the side panel sends ElevenLabs only
  silence, but the microphone stays open (the browser still shows it in use) until the session ends. To keep it off,
  pick another voice: a text-only session never opens it. A microphone refused in the browser stays off too.
- **The user's voice (the page listening).** With Claude, ChatGPT or the engine's sentences, and Parakeet set up, the
  page opens the microphone during a workout and in Talk to coach, and closes it when they end. The audio goes only to
  this machine's dev server (`POST /api/stt`: 127.0.0.1, this machine's pages only) and is written down by Parakeet on
  the Mac's GPU; it never leaves the Mac, and nothing keeps it. The words go to the coach as text, like the other
  events: to Anthropic through the API or Claude Code, or to OpenAI through Codex (with the engine's sentences,
  nowhere), and they are kept in the coach session's log on this Mac (`$POSE_DATA_DIR/coach/session-<id>.jsonl`; the
  API transport's log keeps the replies, not the events). The microphone hears the
  room too: the coach is told to let pass what is not meant for it (it then says nothing), but other people's words in
  the room are written down and sent like the user's. **Mute** stops the detector, so nothing is written down, but the
  microphone stays open (the browser still shows it in use) until the workout ends or Talk to coach closes; Hold to
  talk still records while it is held. With the agent as the coach the page never listens: the agent does (above).

## Benchmarks

Method: the 20 events of **test set A** (curated from 249 logged event-to-cue pairs: every kind, 6 faults on 5
exercises, a set switch) through each coach, in order, text only, on this M3 (Chrome, WebSocket to ElevenLabs).
Judged by a **panel** of 8 blind judge agents: two independent fact-checkers, a coaching-rules judge and a delivery
judge, each on half the events. Panel score = (2 x faithful + coaching + delivery) / 4. The two fact-checkers agreed
within one point on 100% of 320 cues (correlation 0.95). A second, independent **Opus judge** (Claude Opus via
`claude -p`, one call per event, all cues shuffled and relabelled) agrees on the top. "Agent" rows are the ElevenLabs
agent with that LLM.

| Coach | Cues | Text p50 / p90 (ms) | Words (median) | Panel score | Faithful | Coaching | Delivery | Factual errors (mean of 2 checkers) | Opus mean rank (1 = best of 16) | Opus faithful | Opus errors |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Sonnet 5.5 (`claude -p`) | 20/20 | 1550 / 2112 | 18.0 | 4.46 | 4.75 | 4.55 | 3.80 | 4.5 | 6.80 | 4.40 | 8 |
| Claude Haiku 5.5 (`claude -p`) | 20/20 | 1502 / 2189 | 20.5 | 3.96 | 4.15 | 4.40 | 3.15 | 10.5 | 9.00 | 3.70 | 15 |
| Agent: Claude Haiku 5.5 | 20/20 | 614 / 1158 | 22.0 | 3.91 | 4.47 | 3.90 | 2.80 | 7.5 | 11.25 | 3.90 | 22 |
| Agent: Claude Opus 5.5 | 20/20 | 1122 / 1488 | 20.0 | 4.41 | 4.38 | 4.80 | 4.10 | 10.0 | 7.65 | 4.05 | 8 |
| Agent: Claude Sonnet 5.5 | 20/20 | 995 / 1466 | 21.0 | 4.41 | 4.65 | 4.60 | 3.75 | 6.0 | 6.30 | 4.40 | 7 |
| **Agent: DeepSeek V4.1 Flash** (the coach agent) | 20/20 | **268 / 361** | 17.0 | 4.72 | 4.78 | 4.75 | **4.60** | 4.0 | 6.90 | 4.60 | 4 |
| Agent: Gemini 2.5 Flash | 20/20 | 859 / 1024 | 13.5 | 4.64 | 5.00 | 4.65 | 3.90 | 0.0 | 9.20 | 4.90 | 2 |
| Agent: Gemini 3.5 Flash Lite | 20/20 | 603 / 748 | 15.5 | 4.35 | 4.70 | 4.55 | 3.45 | 5.5 | 10.50 | 4.65 | 9 |
| Agent: Gemini 3.8 Flash | 20/20 | 1187 / 1741 | 16.5 | 4.64 | 4.95 | 4.65 | 4.00 | 1.0 | 8.75 | 4.65 | 6 |
| Agent: Gemini 4 Argon | 11/20 | 4184 / 7603 | 15.0 | 2.89 | 3.05 | 3.15 | 2.30 | 12.0 | 10.45 | 2.95 | 13 |
| Agent: `glm-52` | 20/20 | 340 / 418 | 19.5 | 4.20 | 4.40 | 4.25 | 3.75 | 8.5 | 10.00 | 3.80 | 15 |
| Agent: GPT-5.4 Mini | 20/20 | 790 / 901 | 12.5 | 4.39 | 4.67 | 4.20 | 4.00 | 3.5 | 10.85 | 4.25 | 11 |
| Agent: GPT-6 Astra | 20/20 | 1892 / 2962 | 15.5 | 4.74 | 5.00 | 4.95 | 4.00 | 0.0 | 5.45 | 4.90 | 1 |
| Agent: GPT-6 Luna | 20/20 | 1041 / 1246 | 13.0 | 4.62 | 4.85 | 4.80 | 4.00 | 1.0 | 7.45 | 4.75 | 3 |
| Agent: GPT-6.1 Sol | 20/20 | 1710 / 3218 | 15.0 | **4.76** | 5.00 | 4.90 | 4.15 | 0.0 | **5.30** | 4.85 | 3 |
| Agent: `qwen36-35b-a3b` | 20/20 | 330 / 397 | 17.0 | 4.30 | 4.67 | 4.25 | 3.60 | 5.5 | 10.15 | 4.20 | 10 |

- **The top.** Both judges put GPT-6.1 Sol and GPT-6 Astra first. The panel puts DeepSeek V4.1 Flash next; the Opus
  judge puts the Claude Sonnets next, then DeepSeek V4.1 Flash.
- **DeepSeek V4.1 Flash** (the coach agent's LLM) is within 0.04 of the best panel score, with the lowest text latency
  (268 ms p50) and the best delivery. Its slips were mild (over-praise such as "eight solid reps" when depth faults were
  measured, an unmeasured detail); none was a wrong count or an invented correction. GPT-6 Luna's one slip was an
  invented hip correction on an arms-only event.
- **Claude Sonnet** (now Claude's default) **over Haiku**: panel 4.46 against 3.96, factual errors 4.5 against 10.5, at
  the same speed.
- **Gemini 4 Argon** stopped answering after event A12 (11/20 cues); its missing cues count as 1.
- **ChatGPT through `codex exec`** was not run on test set A; only its live numbers exist (1.1 s median per cue).

**Voice timings** (event to first audio of the cue, 20 events):

| Coach + voice | p50 | p90 |
|---|---|---|
| Agent, DeepSeek V4.1 Flash, its voice | 0.35 s | 0.40 s |
| Agent, Gemini 2.5 Flash, its voice (the earlier pilot) | 0.96 s | 1.15 s |
| Agent, DeepSeek V4.1 Flash text + Kokoro (live, through the page, after the review fixes) | 0.84 s | |
| Claude Haiku 5.5 (`claude -p`) + Kokoro (the same live run) | 2.17 s | |
| Claude CLI + Kokoro (the earlier pilot) | 2.03 s | |

Live, measured on the page when the connections were built: the agent replies in 0.15-0.62 s (0.5 s event to voice);
Claude Sonnet 5.5 at effort high about 1.4 s per cue, connecting in about 3 s; ChatGPT GPT-6 Luna through `codex exec`
1.1 s median per cue (0.9-2.8 s), connecting in 5-7 s. Kokoro-82M's first sentence on this M3 (p50): MLX on the GPU
0.48-0.53 s (real-time factor 0.18); in the browser on WebGPU 1.75 s; ONNX on the CPU 1.76 s (Core ML 2.16, int8 2.47).
Voices `af_heart` (fastest, best rated) and `bf_emma`.

**MCP tools on Era** (Salesforce only). Era provides a synthetic company with read-only systems as MCP servers. Six
questions (S1-S6), 3 repeats each, a fresh session per question, the same instructions for both sides: a separate
ElevenLabs bench agent with only the Era Salesforce MCP server attached, and Claude via `claude -p` with only that
server. Accuracy, by a deterministic scorer confirmed by a blind re-grade of all 216 answers:

| Configuration | Text | Voice |
|---|---|---|
| Claude Haiku 5.5, Claude Sonnet 5.5 (`claude -p`) | 18/18 | |
| Agent: Claude Haiku 5.5, DeepSeek V4.1 Flash, GPT-6 Luna | 18/18 | 18/18 |
| Agent: Gemini 3.8 Flash | 17/18 | 14/18 |
| Agent: Gemini 2.5 Flash | 15/18 (S2 wrong in all 3) | 12/18 (S3 no answer 3/3; S5 said the query tool was unavailable 3/3) |

- Every configuration connected to the MCP server on every question, and no tool call failed.
- Gemini 2.5 Flash's text misses were wrong answers (S2, 3 of 3). A text-mode failure was confirmed in ElevenLabs'
  log as "All LLMs have failed: LLM Cascade Error: TimeoutError" (the backup LLM was off for the test). The voice
  no-answers: the question was received, but no LLM run or reply was recorded; the cause is not confirmed.
- **Text latency**, like for like (from the session being ready with the MCP server connected to the answer text,
  p50 / p90): Claude Haiku 5.5 (`claude -p`) 2.46 / 3.81 s, Claude Sonnet 5.5 (`claude -p`) 2.72 / 3.12 s; agent with
  Claude Haiku 5.5 1.93 / 2.84 s, DeepSeek V4.1 Flash 0.72 / 2.19 s, GPT-6 Luna 2.54 / 3.67 s, Gemini 2.5 Flash
  2.90 / 5.17 s, Gemini 3.8 Flash 3.01 / 4.09 s. The CLI adds about 0.9 s of start-up per question (Haiku 3.39 s from
  launch); ElevenLabs connects in about 0.25 s plus 0.4-0.5 s for the MCP server.
- **Voice**, ElevenLabs only (the question sent once the MCP server is connected; the three models interleaved
  question by question; 18 each; p50 / p90, at the client's audio output, before the device's own latency):
  DeepSeek V4.1 Flash first sound 0.45 s (a filler, "I'll look that up for you"), spoken answer 2.01 / 3.55 s; Claude
  Haiku 5.5 first sound is the answer, 2.17 / 2.70 s; GPT-6 Luna first sound is the answer, 3.99 / 6.52 s. All 18/18,
  all tool calls succeeded.

**Corrections made during verification.** The first voice numbers counted DeepSeek's filler as its answer, and
charged ElevenLabs its per-conversation MCP connect. Both are fixed in the numbers above.

**Speech to text and conversation** (2026-10-24): Parakeet on Kokoro-spoken phrases, noise, silence and the 30 s
maximum in [Speech to text](#speech-to-text-parakeet-on-mlx); Claude Sonnet 5.5 answering the user's words in
[The user_said event](#the-user_said-event).

**Limits of the sample.** Small samples: test set A is 20 events, on one machine, scored by model judges; the Era
comparison is 6 simple aggregate questions on one system (Salesforce). Claude Sonnet's and ChatGPT's event-to-voice
times on test set A were not measured.

The raw benchmark (its pages, scripts, test sets, logs and results) is private, in the git-ignored `.data/dev/bench/`.
The page modules it reuses are in the repo: `web/js/eleven-coach.js` (it takes an `llm` override for the bench agents),
`web/js/voice.js`, `web/js/speech-text.js`, and the server's `/bench/`, `POST /api/bench/result` and
`/api/coach/describe`.

## Tests

From `inference/pose-coach`:

```bash
npm test                                                   # 486 node tests (node --test tests/*.test.mjs)
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'   # 124 server tests (the .venv: the anthropic SDK)
(cd host && node --experimental-strip-types --test src/lib/*.test.mjs)   # 20: the app's camera workout screen
```

| File | Tests | What |
|---|---|---|
| `tests/connections.test.mjs` | 14 | Auto and hand picks, failover forward only, the voice rules, the panel's words, cues owed across a failover; who hears the user (the agent, the page with Parakeet, nobody), an answer to the user's words waiting longer than a cue; Claude through the API on the user's key (usable, refused, not checked) else through Claude Code, in Auto and in the panel's words |
| `tests/eleven-coach.test.mjs` | 20 | one message in flight, the cap and the grace wait, reply ids, late replies hushed and cut, a reply played out before the next message, stop while connecting, the keep-alive, the silent input without duplex; duplex: the user's words answered apart from the tracker's messages, the client tools, words the agent left unanswered expiring, the real microphone, a muted start, and the session going on muted when it is refused |
| `tests/voice.test.mjs` | 5 | Kokoro's page and seq, a superseded cue ends quietly, close() releases everything, a Mac voice stops only its own cue, when a voice is speaking (for barge-in) |
| `tests/listen.test.mjs` | 11 | the page's detector on made-up frames: an utterance with its pre-roll ended after 700 ms of quiet, short pauses and trailing words kept (hysteresis), the room's level learnt (a fan), 15 s at most, knocks and clicks dropped, a louder sound needed while the page's voice talks, push-to-talk, 16 kHz PCM16 |
| `tests/intents.test.mjs` | 15 | every exercise's names and the forms people say, the more specific name and the one meant, answers to "which exercise?", short switches but never a question, done against not yet, counting and fillers; a movement of the library by its spoken names and key, its longer name over the exercise in it, as a short switch or an answer but never a question or about pain, the library's everyday words neither taking an exercise named with them nor making a longer answer, and each name of the built library finding its own movement (skipped without `.data/moves/library.json`) |
| `tests/technique.test.mjs` | 10 | independent jab–cross attempts with no counts; upward first punch, repeated jabs, guard drop and missing return; frontal/cropped/gapped input; private reference at varied pace and mirrored with jitter, actual source footage, the annotated user recording, other recorded exercises and built reference poses |
| `tests/moves.test.mjs` | 58 | the named movements' tracker on made-up frames with MediaPipe-sized jitter: a hold's start (its timer at 1.5 s still, told at 3 s; a shorter pause neither told nor counted), progress and end (jitter, a glitch, one hand adjusting and a short time out of view do not end it), the same at 6 fps with uneven frames, time moving (a fidget is not moving), an approximate rhythm count (jitter and small swings count nothing); a hold's form (none without landmarks or a form check; the fault measured by its start carried by `hold_start`, faults and fixes after it, each hold measured afresh; frames the stillness measure cannot judge never reaching it; a fault or a fix held back while the hold may still end before it, and dropped if it does; `settle()` when the start is said later, the next correction `NEXT_MS` after that; a fault waiting its turn pending at the page's start, never fine; a fault told and fixed before the hold was told left out of `hold_end`); in the pose at all (standing up out of the pose ends the hold where it was left, a wobble out of it keeps the hold, standing still before getting into it starts none); a moving or rhythm movement's form through the tracker (none without landmarks or a check: moving and rhythm as before, `form: null`; a rhythm's peak check checked while right, its fault, then its fix; each turn handed over once, on the frame that confirms it, none on a frame out of view; a moving movement's frame check judged on the frames counted as moving, after the warm-up; the signal's recent swing kept for a form check only, and only its window's) and `CycleCounter`'s turn (which extreme, when, its half cycle, the far end, counted or a wobble); the library build on made-up motions: the skeleton reader, a rhythm from the reference skeleton, keys and spoken names, one entry per cleared motion of the kinds offered (a kind left out skipped and counted, an unknown kind refused), the policy and `cleared.json` refusals, idempotent writes; a hold's held part and reference pose (`heldOf`: on made-up skeletons the stillest second in the pose with every check passing, grown while still, not a stiller part with a fault, none when no second is right; the pose the held part's middle frame, its working side the triangle's front leg or the quad stretch's bent leg, mirrored the other side; written by the build), and on the library's three reference skeletons a held part right and still with one working side all through (private, skipped when not here); a hold's `form_unseen` (every check out of view: `HOLD_WAIT_MS` after `hold_start`, then once every `EVERY_MS`); `CycleCounter.retune()` (another signal counted, the zigzag afresh, the count and its last time kept); a rhythm's fallback (the feet out of view, the sweeps counted on the thigh, none counted twice at a switch); the build giving a signal with a fallback its parameters from the reference, as the signal's own; combined thigh/feet attempts counted once, none from cropped thighs; stale turns cleared on lost frames |
| `tests/holdform.test.mjs` | 40 | a held pose's form: `poseMetrics` on made-up landmarks (either side, a part out of view, from the side), every check with what the coach and the page need, each triangle fault caught alone and told with its cue and the part to show, every check's part one the page colours in the replay and on the Y Bot (a sided part with its side), the quad stretch's and figure-four's faults on the bent or the standing leg on either side, a fault's side the one on the frame it is told on (fixed and told again on the other side, that side), the top arm and the arms' line told once, persistence, one fault at a time, `pending` (a fault measured and not told yet, waiting its turn or to last: never checked), a check's `when` on the smoothed values and a fault told never hidden by it, `wrongView` (the figure-four's ankle from the side: turn, not step back), the chest judged only tipped into the pose; `IN_POSE` and `InPose` (standing up is out, a shallow or wobbly pose stays in, no decision with its parts out of view); the reference skeletons and MediaPipe on the library's footage passing, and faults put into the skeletons caught, and the references and footage staying in the pose (private, skipped when not here); the user's recorded triangle holds through the tracker: the stance and the top arm told in each long hold, nothing told of frames out of the pose or after a hold's end, a fault waiting its turn pending, and the page's start settling the next correction (skipped when not here); a hold seen side-on, every check judged facing the camera: `form_unseen` asks to turn to it |
| `tests/moveform.test.mjs` | 43 | a moving or rhythm movement's form (`web/js/moveform.js`): `bodyMetrics` on made-up landmarks (a person standing as built, the joints, limbs and heights each on its own side, the trunk's lean and the tilts signed, the stance and the knees caving in, mirrored, turned to the side, a part seen only whole and in the frame); a frame check (a fault once bad `FAULT_MS` after the warm-up, said with its measure, fixed after `FIX_MS`; never in the warm-up, still or paused, a pause starting the warm-up again; one correction at a time, `NEXT_MS` after the last or `AFTER_FIX_MS` after its fix; out of view, the wrong view and its phase not judged, and `state()` saying why; a phase that stopped holding, neither pending nor checked); a peak check (2 of the last 3 cycles, told on a bad one, fixed on the last 2; not judged in the warm-up, in or before a pause, without frames near it or on a wobble; `take` max over the half cycle and `at`, its side from its frame; `state()` before its first cycle); one correction at a time across both; the floor (a hop; not known nearer or further from the camera; the arms raised); a `still` check (judged at rest too, once moved; `SETTLE_MS`); a check's own `smoothMs` and `faultMs` (a gesture held about a second told, not with the defaults; each a time over 0, a frame check's); `side(m, lm)` given the landmarks; a cycle check over the whole cycle; the verdicts expiring; a `form_fault`'s `seen`, the span its verdict rests on though told on a later frame; the pause rule (a rhythm's slow reps: a hold at the far end shorter than the period its turns show no pause, a rest one; turns far apart showing no period longer than `PAUSE_BOUND_PERIODS` of the rhythm's own); the floor at each distance (drifting nearer and further, the feet stay on it; a hop at the far end caught); every check of `MOVE_FORMS` of the shape with a part the page shows, no movement in two groups, `checkProblems`; and, private (skipped when not here): each guarded movement in the library on the track its checks are for, the floor through the step touch's reference, the shoulder rotation and the Y-to-W at half and 0.6 of their pace (judged, and a rest after them a pause), and the shoulder rotation's reference through the tracker (its elbows at its sides at every peak, at its own pace and twice it, mirrored; elbows put out caught at the second bad peak, both sides or one); `outOfView` (the body parts to show, as the user is asked: feet, legs, hands, arms, hips, shoulders, head); `form_unseen` (standing in the picture with a part the checks need out of it: `FRAME_WAIT_MS`, moving or not; never sitting, nor close with the hips out of the picture, nor with nobody; only the checks the frame blocks; again sooner once seen); and, private, the user's standing side crunches with the feet below the picture (asked to step back in the set, the sweeps counted) and their other recordings with the side crunch named (never asked to step back at the laptop); recent-standing framing continuity with cropped knees, its expiry and seated reset; a new cycle fault told alongside a fix after the correction gap |
| `tests/moveforms-arms.test.mjs` | 21 | shoulder external rotation, the Y-to-W raise and the step touch (`web/js/moveforms/arms.js`): the group's checks of the shape, sided where one-sided, judged only in the movement's shape; each measure, its side and the movement's shape on made-up landmarks; private (skipped when not here), through the tracker with landmarks: each reference passing every check on every cycle at its own pace and twice it, mirrored, with jitter, and MediaPipe on the library's footage of it passing at both paces; each fault put into the reference caught by its own check alone, on its side, mirrored too; a fault put in, then the reference: told, then fixed; standing still in the movement's own pose, and a pause, judging nothing; the references through a pinhole camera, turned -45 to 45° and 0.5-1.5 m up, pitched or level (the step touch at every one of those, the other two at a few): nothing told, and judged; the step touch through it: a 12 cm hop caught facing it, high or low, and drifting 0.2 m nearer and further nothing told; each movement named over the user's recordings: nothing judged walking up to the camera, nothing bad without moving, nothing told (what each check did printed as diagnostics), and the step touch over their sets of jumping jacks: nothing told |
| `tests/moveforms-legs.test.mjs` | 26 | the side kick, the side crunch, the wall leg raise and the boxing combo (`legs.js`): the checks' shape; what each phase lets through on made-up landmarks (a knee drive on the driving leg, not a stride, a skip or a squat; a kick straight and out to the side; the lean on a kick well up, signed by side; a sweep's top, not a jumping jack or a small step; the combo's squat, not a knee drive or the feet together); private (skipped when not here): each reference telling nothing at its own pace, half and twice it, mirrored, with jitter, every check judged; each fault put in caught by its own check alone, on the right side, a milder one by none; each fault, then the movement done right: told, then its fix noticed; MediaPipe on the library's footage, looped out and back, telling nothing; the sweeping knee judged by its own side's check with the leg well out (a knee raise or a low sweep not); the user's recordings with each movement named: nothing told but in the movement named (a recording of it), each fault there with its part and side; the live side crunches: bent sweeping knees plus measured low/high lifts, cropped parts asked for; synthetic low/high faults caught and then fixed |
| `tests/side-crunch-recordings.test.mjs` | 4 | private runtime annotations: expected fault windows, measured counts within one, framing with hips/knees cropped, and strong bends below 100° still eligible; skipped when recordings or annotations are absent |
| `tests/moveforms-transitions.test.mjs` | 13 | kneel and stand, half-kneel to stand (`transitions.js`): the checks' shape; on a made-up person, kneeling (one knee down, the other foot planted ahead; standing or a squat not), a torso fold told once it lasts and fixed, the front knee caving in told on its side (mirrored the other, not from the side), a kneel held still judged once the person has moved, through a pause; private (skipped when not here): the references raising nothing at their own pace or twice it, mirrored, with jitter, once or round after round, through the tracker or with every frame judged; a 60° fold and the front knee 20 cm in each told alone, on its side, at both paces, and fixed; MediaPipe on the library's footage raising nothing; footage of a fold while kneeling: the torso told, nothing else; the user's recordings: nothing told |
| `tests/moveforms-flow.test.mjs` | 16 | the forward fold's reach and the Bharatanatyam's hands (`flow.js`), and no check for the dances; the reach's phase, its lower arm in view and side on made-up landmarks, and through `MoveForm` (judged held still once moved, told after `SETTLE_MS` and `FAULT_MS`); private (skipped when not here): the reference at half its pace, its own, 1.5 and 2 times it, mirrored, with jitter, telling nothing; its arms put 70% as high caught at the first reach (the second at 1.5 times the pace, the third at 2), on the side put in, and the fix at the first good reach (the second at 1.5 and 2 times); MediaPipe on its footage from the side telling nothing, the near arm judged; the Bharatanatyam's hand raised by the face on made-up landmarks (its phase: the other forearm across the chest, the hand at the upper chest or higher, upright; the forearm's direction in the picture), through `MoveForm` (told on its side after `SETTLE_MS` and its own 0.8 s, the chest gestures lower down never fixing it, the hand brought in level fixing it), its reference (nothing told at half to twice its pace, mirrored, with jitter; a forearm put up in its last gesture told on that side by the second turn, then fixed), its footage (nothing), and the user's own recordings of it (the raised hand told on its side, nothing else); the dances' references with no form; the user's recordings with each of the four named: nothing told (the Bharatanatyam's verdicts, but over the user's own of it) |
| `tests/refposes.test.mjs` | 18 | the guard rails' reference poses (`tools/build_moves.mjs` `refPosesOf`) on made-up skeletons with made-up checks: `okMargin`; the reference's frames as a check sees them, the floor known from the first frame; a trough check's pose (the most clearly ok frame at the rhythm's troughs, its phase holding); a frame check's (the stillest ok on its value and its smoothed value; none judged, none); a peak check's side, and mirrored the same moment on the other side; a clip's end a turn only where it dwells, a frame out of the picture never shown; private (skipped when not here): each guarded movement's reference, every pose its check done right on its frame, in the picture, on its side, the other side mirrored (a pair of one-sided checks whose sides move at different moments, the Bharatanatyam's hands, each finding the other's moment); a check of the side the reference never moves found on it mirrored (`mirrored: true`), its side and its clip time |
| `tests/page.test.mjs` | 37 | every element `app.js` looks up by id is in the page; the Movements card, the Now card's movement line with Show in 3D and "Other movement..." among the chips; a movement named said with the set it ended; the workout summary leaving out a movement with nothing to show; a hold's form: the engine's words never calling an unmeasured hold good, a fault measured while the start is held back going with it once, a fault going no further than its hold's start, the landmarks to the tracker, its events recorded and the fault on the Now card; the Now card's form only once the coach was told the start, the fault told, "Form checked" only when fine, and why a check was not made (step back, or turn to face the camera); a fix folded into the start not praised at the end (`told`), a fault waiting its turn never called fine; the correction after the start's `NEXT_MS` after the page told the start; a held pose's form check: shown aside when the coach is told the fault (the start carrying it, a `hold_fault` with its part and side; never for a hold whose start never went), in the side panel with "See it again" on the Now card, the fault's words, the library's reference pose and held part (none built: none), the reference turned to the user's working side as the library finds its own, put away a moment after its fault's fix (not before 2.5 s up) or at the hold's end, a later fault replacing it; the Mistakes list (app.js's form check on a stand-in page): every mistake the form check shows kept with a copy of its frames, when, what and its "Like this" (the same fault within 3 s, or "See it again", not a new one; told again after its fix, a new one; none with no workout running), its row (newest first, the fault's label and measurement) and 3D from the stored frames; a long workout's latest kept and how many were left out said; Show pinned (no `FORM_MS` timer, left by a fix, a clean rep, the hold's end and Stop, replaced by another Show, gone on Close; while a workout runs a new fault shows over it as before, and when that one goes, after `FORM_MS`, its fix, the hold's end or Stop, the pinned one is back; the 3 s repeat check the last showing's, so a Show does not make a repeat a new mistake; only a pinned one's row marked); cleared only when the next workout starts (not at Stop, a pinned one too), the recording's `mistakes`, the Workout card's elements in place of "See the last mistake in 3D"; a saved workout reviewed (the picker newest first, its mistakes from the recording's frames by window, or derived from an older one's events, its reference pose, camera mirroring and aspect, said in the list; none while a workout runs; a recording that cannot be read said so); an older recording's held-pose mistakes derived as the page's own `moveEvents()` showed them (a fault fixed before the hold was told, the latest one still there, a later one, a hold whose end came first); a moving movement's form: its faults and fixes going to the coach as they come, with the engine's own words; on the Now card the fault told, "Form checked" only when fine, in the side panel, and the line steady however the form flips from frame to frame; its form check shown aside as a hold's, kept, put away on its fix or the movement's end, "Like this" the check's reference pose if the library has one, "You" the frames its verdict was based on (`seen`), and with a mistake the user opened from the list exactly as a hold's; an older recording's moving-movement mistakes derived from its events as the page showed them; a reference pose taken from the clip's mirror image (`mirrored`: drawn as it is, the 3D clip mirrored); the form unchecked a while (`form_unseen`): its cue to the coach as it comes and said by the engine, not a mistake; in a hold after its start, if it still holds, and dropped with a hold too short to tell; on the Now card in large type at once and steady while it lasts; the movement library fetched again when it fails (no answer, a 500, a file read half written), "No movement library on this server" only for a 404, and a lasting failure saying why with Try again |
| `tests/mistakes.test.mjs` | 12 | `web/js/mistakes.js` on synthetic events and frames: the list keeps the latest `MAX_MISTAKES` (40), newest first, counting the ones left out; a mistake as a recording keeps it (no frames, the fault's fields spread, its window; plain JSON) and back, and what is not one; an older recording's held-pose mistakes derived from its events (the start's fault when the page told it, 6.5 s in; the same fault once until its fix; none for a hold too short to be told; a fault measured as the hold ended; a hold still open at the end; the hold as the page told it, with its form then: a fault fixed by then not shown, of those still there the latest told only, none for a hold whose end came first unless an event of it from 6.5 s on says otherwise, a hold still open at the end told if its frames go on to 6.5 s), and its exercise mistakes (faulty and partial reps, the same fault within 3 s once, the rep's window padded or one about the rep, the fault the page shows; a faulty rep a new set counts back shown when the rep counted with it is clean, its own frames); a recording's own mistakes used over its events, seconds into the workout, its frames by window as the page has them; a row's words, the clock and a saved workout's name; a moving movement's mistake (kind `move`) as a recording keeps it and back, and its row; an older recording's moving-movement mistakes from its events, each when it was told (a fix takes none back); a moving movement's fault replaying the frames its verdict was based on (`seenWindow` of its `seen`), not the 2 s before it was told |
| `tests/speech-text.test.mjs` | 4 | the cue split, the same in the page and in `kokoro_worker.py` (runs `python3`) |
| `tests/test_connections.py` | 21 | the CLI checks with stand-in CLIs (signed in, the plan; never an email or a key), how long they are kept, the agent record; Claude's transport with a made-up key and a stand-in client: the API when the key is taken, Claude Code when it is refused or when asked for, a check that failed tried and checked again sooner, a key saved or removed since the check checked again (the transport and Auto agree), a key file other users can open a warning, not an error |
| `tests/test_coach.py` | 62 | the `claude` and `codex` command lines; a stand-in codex kept going, restarted with a recap and given up on; nvm lookup; each event's reading (the questions, with `listening: false` too; the answers, how a set ended, what the user said and what the page did with it, or that it changed nothing and what it still counts) and what `SYSTEM` says of them (the conversation rules, never confirming what the page did not do, the 13 exercises of `web/js/engine.js` and no other); a named movement of a made-up library: `movement_set` for each track, the hold, moving and rhythm events (nothing for a hold under 5 s), the coaching lines' form cues alone as notes (not what to count or time), the library filling in what an event leaves out (read again when rebuilt), a movement applied by voice (and mid-set: the set it ends, with its reps), a gym exercise of the library by its own name, a set ended by naming a movement, words while one is named, the workout summary's movements, the agent's movement rules in `SYSTEM`, and the library's names in a session's instructions (none in `SYSTEM`); a hold's measured form in its readings (its fault as the cue, its fix praised, fine only when measured, the checks out of view named, checks the view cannot judge asking the user to turn rather than step back, a fault waiting its turn never called fine, the end naming only the faults the user was told of, a hold with no form check never called right or wrong) and the rule in `SYSTEM`; a moving or rhythm movement's guard rails in its readings (a `form_fault`'s measured fault as the cue and its `form_fix` praised, a dance's sparse event read too; the progress's form clause: the correction still to make with the count or the time, checks made and none found but never good as a whole, a fault waiting its turn never fine, the checks out of view or the view, not measured, and the reading as before with no form) and its rule in `SYSTEM` and `API_SYSTEM`; Claude through the API with a stand-in client: each event one message and the reply said, a reply cut short, a fallback logged, a refused key and a rejected request ending the session (never with the key), failures retried once (after at most 2 s, only for what may pass, not once the page has stopped waiting), then left to the page, and three in a row ending it, events the page stopped waiting for not sent but told with the next, nothing queued sent after a stop, when Auto takes the API (and `/api/health` says so), the thinking setting and `max_tokens` with room for it, the real SDK client reaching `api.anthropic.com` alone whatever `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS` say (nothing sent), `API_SYSTEM`; a form not checked at all (`form_unseen`) read with what to show or to turn, never right or wrong, and its rule in `SYSTEM` |
| `tests/test_server.py` | 22 | `/api/tts` with a fake worker (supersede, cancel, restarts, errors), the Host check, the write guards, the connections endpoints, `/api/coach/describe` (a `user_said` and the movement events too); `/moves/library.json` and `/moves/glb/<key>.glb` served (types, byte ranges) and nothing else of the folder (the catalog, the study, the skeletons, `..`, encoded paths, a link out, other methods: 404), not built (404, `/api/health`); `/api/version`'s hash of the page's code on a stand-in `web/` (a change under `web/js` at any depth changes it, and back as it was gives the version it had; a file moved between folders changes it, files other than `.js` and `index.html` do not; the real page has one) |
| `tests/test_stt.py` | 19 | `/api/stt` with a fake Parakeet worker: the words, `ms` and `seconds`; utterances sent together; not set up, turned off (`POSE_STT=0`) and loading (503, at once); an utterance that took too long (504, the worker kept and the next one heard); a model set up after the server started, loaded at the status ask; a model error (500) and the next utterance; a worker that dies started again, one that keeps dying given up on; raw audio only, from this machine's pages, never empty, odd or over 30 s; the Host check; the Hugging Face cache path; PCM16 read as the model reads it (in Kokoro's venv) |

The Python tests use stand-in CLIs, temporary folders and fake Kokoro and Parakeet workers (no MLX: the workers' real
job loops with a fake model); their servers bind 127.0.0.1:0. They touch no real CLI, no ElevenLabs agent and no
running server, and never the Anthropic API or the user's key: a stand-in client and a made-up key file (in
`tests/test_server.py` a key path that is not there and a client that fails the test if reached). Each file's
docstring gives its own command. Not covered by a test: `app.js`'s session timers and voice stand-in,
`web/js/kokoro-worker.js`, `server/pose_mcp.py` (the stand-in codex calls `/api/coach/next` and
`/api/coach/say` itself), the real MLX workers (Parakeet's PCM reading is, in Kokoro's venv when it is there),
`tools/setup_kokoro.sh`, `tools/setup_stt.sh` and `tools/fetch_assets.sh`. The fixtures use a made-up agent id and
made-up plans.

## Files

```
web/js/connections.js     which coach and voice to use (resolve, fallback), the panel's words, the cues owed per session
web/js/eleven-coach.js    the ElevenLabs agent as the coach: one message in flight, late replies, mic and client tools
web/js/voice.js           the page's voices: Kokoro (server, then browser), the Mac's, with when each cue was heard
web/js/kokoro-worker.js   Kokoro-82M in the browser (kokoro-js, WebGPU)
web/js/speech-text.js     how a cue is cut for synthesis (the first clause first)
web/js/app.js             the pickers, the Connections panel, the side panel's questions, session lifetimes, fallbacks
server/connections.py     the connections: the agent record, the CLI checks, the API key check, Claude's transport,
                          the order and Auto
server/coach.py           coach sessions: Claude through the Anthropic API (a worker thread, the user's key) or
                          claude -p, codex exec, the event queue, restarts, SYSTEM and API_SYSTEM, event readings
                          (the named movements' too, with the library's names and notes, and their measured form)
server/pose_mcp.py        the MCP server (stdio): wait_for_event, say
server/tts.py             Kokoro on MLX for GET /api/tts: the worker, supersede and cancel, restarts
server/kokoro_worker.py   the worker process (its own venv)
server/stt.py             Parakeet on MLX for POST /api/stt: the worker, restarts, offline
server/stt_worker.py      the worker process (Kokoro's venv)
server/dev_server.py      the routes and the guards (and /moves/: the movement library and its animations)
web/js/moves.js           a movement of the library the user named: hold timer, time moving, approximate rhythm, and
                          the form of a hold or a moving one
web/js/holdform.js        a held pose's form: its measures, the checks of three poses, faults told one at a time
web/js/technique.js       a named one-two: independent sequence and direction/guard checks, no count
web/js/moveform.js        a moving or rhythm movement's form: its measures, frame and cycle checks, one at a time
web/js/moveforms/         the guard rails of ten movements by group (arms, legs, transitions, flow), with their numbers
web/js/listen.js          the page listening: the microphone, the detector, push-to-talk, POST /api/stt
web/js/intents.js         what the user's words ask of the page: an exercise, "detect it", done or not yet
tools/setup_kokoro.sh     builds .venv-kokoro and fetches the model
tools/setup_stt.sh        fetches Parakeet into the same venv's cache, with a smoke test (Kokoro speaks, Parakeet hears)
tools/fetch_assets.sh     kokoro-js and its model, @elevenlabs/client (with MediaPipe and three.js)
```
