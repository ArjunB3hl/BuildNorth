# Rhythm implementation and verification

Rhythm adds video interests to BuildNorth, learned from the user's own activity
once they turn learning on. It uses the existing
Expo SDK 57 app, FastAPI service, SQLAlchemy database and Clerk account. The Mac
app remains a separate application. This document distinguishes implementation
from observed integration checks; a configured endpoint is not evidence of a
successful external connection.

The React Native web app shows the same learning switch, learned interests and
sharing switches, and displays saved recommendations and page grants. See [web implementation and
verification](web-app.md) for this later addition and its separate verification
limits. References to phone setup below also apply to the web profile screens.

## Recommendations are turned off

Video recommendations are switched off for now, along with what exists to produce them: video tasks (*Evaluate this
video*, *Find videos*, agent tasks), page grants (*Use this page*), YouTube search and transcript reading. What stays:
learning, *Rhythm noticed*, *Save to Rhythm* / *Not interested*, the editable interest profile, agent connections that
read interests (`connect_rhythm`, `get_interests`, `request_forget`) and summarise saved videos (`list_saved_videos`,
`save_video_summary`), memory and data deletion.

- **Server:** `RHYTHM_RECOMMENDATIONS` (off unless `on`). While off, the task, browser, search, transcript,
  recommendation and metrics routes answer 404 "Video recommendations are turned off.", and the Rhythm MCP resource
  lists only the three interest tools, with shorter instructions.
- **Apps and extension:** `RECOMMENDATIONS_ENABLED` in `mobile/src/lib/rhythm.ts`. While false, the side panel shows
  only learning, the question and the reactions; the web Overview shows learning, interests and YouTube sharing
  instead of recommendations; the Content library keeps only *Connections* (agents, with the *Your interests* and
  *Memory context* permissions) and *Memory*; the transcript-reading switch is hidden.

Both switches must agree: set `RHYTHM_RECOMMENDATIONS=on` in `mobile/backend/.env` and restart the backend, set
`RECOMMENDATIONS_ENABLED = true` in `mobile/src/lib/rhythm.ts`, then rebuild the extension (`npm run build:local`) and
reload the apps. The rest of this document describes the full feature.

## Integration inventory

| Component | Existing when work began | Rhythm integration |
| --- | --- | --- |
| Phone | Expo 57.0.30, Expo Router, React Native 0.86.3, Clerk Expo 4.x | Profile → Interests & sharing: an opt-in learning switch, an editable **What Rhythm learned** list (keep, remove, forget; level, length, equipment) with quick picks to start from, and the sharing switches, each saved when changed |
| App records | SQLAlchemy + Alembic; SQLite locally, PostgreSQL supported | Separate versioned `rhythm_profiles`; migration `0006`; ownership from verified authentication |
| App sign-in | Clerk session JWT verification | Reused by phone and extension; no owner ID supplied by clients |
| MCP | Python MCP 2.3.0, Streamable HTTP, Clerk OAuth and revocable bearer connections | Dedicated `/rhythm/mcp` resource, 16 tools, separate OAuth audience and `bnr_` credentials |
| Memory | SurrealDB Agent Memory, one configured Context with user scopes | Explicit per-user bindings; the existing Context can serve its declared owner across both features |
| Browser | No extension toolchain | WXT + React + TypeScript, Manifest V3, side panel |
| Video search | Absent | Backend YouTube Data API adapter; API key must be configured |
| Transcript access | Absent | Only an explicitly authorized selected page, or user-provided text |

The saved account profile is authoritative, and its interests are learned, not
typed in. Learning is opt-in: **Learn my interests automatically**
(`consent.learn`) is off by default. While it is on, `backend/app/rhythm/learn.py`
works out topics, purposes, experience level, typical video length, equipment and
things to avoid from:

- fitness, health and food videos the user's own extension saw them watch
  (`POST /rhythm/signals`); other videos are not kept;
- the user's own messages to the coach;
- recommendations they saved or marked helpful;
- their **Save to Rhythm** and **Not interested** buttons in the side panel
  (`POST /rhythm/reactions`).

Each piece of evidence has a weight. A watched video counts 1.0 at most, scaled by
how much of it was actually played while the tab was visible (`engagement.playedSeconds`;
skips and background play don't count): it counts fully once half of it has played
(at least one minute, at most five), and a brief look counts as little as 0.2. Older extension
versions that send no playback time count 1.0. Watching the same video again adds a
quarter each time, up to five views. A coach message counts 1.5 (saying it is stronger
than watching it), a saved or helpful recommendation 2.0, and **Save to Rhythm** 3.0,
the strongest positive signal. **Not interested** counts 2.0 *against* that video's
topics, never against a level or equipment. Reactions work with learning off too:
there, **Save to Rhythm** pins the video's topics as the user's own choice.

Evidence halves in weight every 14 days and is ignored after 45 days, so changed
interests replace old ones within weeks. Learned values use the screening vocabulary
in `relevance-rules.json` and are validated like any profile. When an AI provider is
configured, a model pass (at most every 10 minutes per user) reads the same
evidence. Its topics strengthen what the vocabulary found but cannot establish a
topic alone; an avoidance is kept only if the user wrote those words; and the model
is not asked about health conditions, weight or body image. Without a model, the
vocabulary pass works alone.

The profile counts as confirmed once it has at least one topic and one purpose,
learned or picked by the user. Until then `GET /rhythm/interests` returns
`profile_required` with "Rhythm hasn't learned your interests yet…", and page grants,
tasks and agents wait. Videos matching the user's own exclusions are not kept. Turning
learning off stops learning and deletes the collected video signals, the interests
learned from them and the evidence summary; the user's own choices are kept. Interests
typed into the earlier form stay (shown as "In use") until learning replaces them.

### What Rhythm learned, and the user's own choices

The phone and web apps show what was learned under **Interests & sharing → What
Rhythm learned** (`GET /rhythm/learned`) and let the user correct it. The user's
own choices are stored separately from what was inferred, so learning never
overwrites them, and they always win:

- **Pinned** topics ("You chose it", from **Keep**, **Add an interest** or quick
  picks) always come first. **Blocked** topics ("You said not interested", from
  **Remove** or **Not interested**) are never used, whatever the evidence says.
  **Unpin** and **Undo** hand a topic back to learning. A topic can't be both.
- Every other topic is **learned** (strong enough to be used, shown with its
  evidence, such as "5 videos · 2 chats") or **noticed** (some evidence, not enough
  yet).
- **Level**, **video length** and **equipment** each show the value in use and whether
  the user set it or Rhythm learned it. The user can set their own or switch back to
  "Learn it" (`null`).
- With nothing learned or chosen yet, **Start with a few picks** pins a few topics
  (and optionally a level) in one save, so Rhythm works before learning has evidence,
  with or without learning on.

`PUT /rhythm/choices` takes `pinned`, `blocked`, `acknowledged`, `experienceLevel`,
`preferredDurationMinutes`, `availableEquipment` and `expectedRevision`. Only the
fields sent change: a list replaces the stored one, `null` hands a value back to
learning, and an omitted field keeps its stored value (`src/lib/interest-choices.ts`
builds the request from one change). On `stale_context`, often learning itself updating the profile,
the app refetches and re-applies only the user's one change.

**Prompts.** When a topic is newly learned and the user hasn't pinned it or answered
about it, the view carries a gentle `suggestion`, for example "You've watched 4
beginner boxing videos recently. Want more boxing drills and technique videos?". The
side panel and the app show it with **Yes** (pin), **Not interested** (block) and
**Forget this**. Pinning or blocking a topic anywhere also marks it `acknowledged`, so
it isn't asked about again.

**Forgetting.** **Forget the evidence** (in the list) and **Forget this** (in the
prompt) call `POST /rhythm/forget`: the stored videos behind that interest are
deleted, chats and feedback about it from before that moment stop counting, and the
topic is unpinned and acknowledged. A block stays. The app confirms first.

A learned change, a switch change, or a choice that changes the interests bumps the
profile revision and invalidates pending tasks. Learning never applies a change while
the user has an open task: it waits and applies after the task finishes or expires,
and the view's `deferred` flag makes the apps say "Updates will apply once your open
video task finishes." The user's own choices apply at once.

## Start the application

Use Node 22+ for the extension. The existing phone and backend setup is in
`mobile/README.md`; this change adds no Python or phone dependencies.

From the repository root, in separate terminals:

```sh
cd mobile/backend
.venv/bin/python -m alembic upgrade head
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```sh
cd mobile
npx expo start
```

```sh
cd extension
npm ci
npm run build:local
```

`build:local` reuses **only the public Clerk key** from `mobile/.env`, unless the
extension's own configuration overrides it. It defaults to `http://localhost:8000`.
Alternatively, create `extension/.env` from `.env.example`, fill in its public
settings, and run `npm run build`.

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
select `extension/.output/chrome-mv3`. Pin Rhythm's toolbar icon. Rebuild and reload
the extension after changing build configuration. `npm run dev` provides WXT's
development workflow.

The phone and extension must use the **same backend**. A physical phone needs a
reachable LAN or HTTPS URL; its `localhost` is not this Mac. Set
`EXPO_PUBLIC_API_URL` on the phone and `WXT_API_URL` in the extension accordingly,
then restart Metro and rebuild the extension.

MCP runs in the same backend process:

- Rhythm: `http://localhost:8000/rhythm/mcp`.
- Existing BuildNorth assistant: `/mcp`, with its existing tools and credentials.
- Rhythm protected-resource discovery:
  `/.well-known/oauth-protected-resource/rhythm/mcp`.

For public clients, serve the API over HTTPS. `RHYTHM_MCP_PUBLIC_URL` must be the
exact public URL ending in `/rhythm/mcp`. Its default is `MCP_PUBLIC_URL`'s origin
plus `/rhythm/mcp`; the legacy endpoint keeps its own resource audience.

## Required external setup

All examples contain names and placeholders. Configure secrets locally or in the
server's secret manager; do not put them into chat, extension source, or a client bundle.

1. **Clerk:** use the existing phone application and enable its Native API.
   The extension uses the web app's sign-in through Clerk's Sync Host, with
   email/password in the panel as a fallback. Set a stable public CRX key as
   `WXT_CRX_PUBLIC_KEY` and add the extension's `chrome-extension://<id>` origin
   to the instance's `allowed_origins` (see the extension README, *Extension ID,
   Clerk and other backends*). If `CLERK_AUTHORIZED_PARTIES` is configured,
   include the web app's origin and the extension's origin along with the existing
   authorized origins. Complete account verification normally.
2. **YouTube search:** enable YouTube Data API v3 in your Google project and set
   `YOUTUBE_API_KEY` in `mobile/backend/.env`. It is never sent to the extension or
   agent. Missing configuration returns `provider_error`, with no invented results.
   Selected-page metadata and user-supplied text work independently of this key.
3. **Memory in the existing Build_north Context:** set these on the backend:

   ```dotenv
   SPECTRON_URL=https://your-context-host
   SPECTRON_CONTEXT_ID=your-existing-context-id
   SPECTRON_API_KEY=your-context-key
   SPECTRON_OWNER_USER_ID=
   ```

   An empty or unset `SPECTRON_OWNER_USER_ID` enables the existing Context for
   **all authenticated Clerk users**. No Contexts, API keys or accounts are created.
   A nonempty owner ID restricts this default Context to that one account. Keep
   `RHYTHM_MEMORY_CONTEXTS_JSON` unset for the shared-Context deployment.

   The server verifies the Clerk session (or an explicitly authorized assistant /
   Watch token) and derives the user scope itself. Request-body IDs, scopes, lenses
   and Context IDs cannot select another account. Every recall has a user lens;
   writes and erases target only that user's subtree. Case-sensitive Clerk IDs
   have collision-free scope encoding. Rhythm's returned memory service is bound
   to the verified account and rejects operations for another ID before SDK access.

   Scopes alone are not credentials or permissions. The Context key remains on the
   backend; users never receive direct SurrealDB access. Shared-Context writes use
   `infer="none"`; no Context-wide persona or chat endpoint is used. Recalled text
   must also match the authenticated account's current SQL preferences, permitted
   health summaries, or confirmed interests before being returned or used by AI.
   Unattributed historical / generated notes are withheld, not deleted. Operators
   holding the Context key remain privileged; keep it out of apps and extensions.

   Optional `RHYTHM_MEMORY_CONTEXTS_JSON` bindings still support manually assigned,
   distinct private Contexts for selected accounts. Repeated Context IDs and
   conflicting owner assignments are rejected. These explicit bindings override
   the shared default. Changing a Context ID with outstanding copies requires
   restoring the original binding to finish erasure. Keys need scoped
   remember/recall/forget and scope-registration permissions.
4. **Your model:** configure it in the chosen agent host. Rhythm supplies tools,
   data, and policy; connecting an agent does not transfer a subscription or API key.

The server environment template is `mobile/backend/.env.example`. The extension
template is `extension/.env.example`. The extension never needs a YouTube key,
Clerk secret key, model key, or SurrealDB key.

## Phone and browser journey

1. On the phone or web app, open **Profile → Interests & sharing**. Turn on
   **Learn my interests automatically** and **YouTube with page details**, and
   choose the other sharing permissions. Each switch saves when it changes;
   switching off learning, YouTube (while learning is on) or private memory asks
   first, because it deletes data. Then chat with the coach, or watch a few workout
   or recipe videos with the extension signed in, or start with a few quick picks.
   Until something is learned or picked the page says Rhythm is still learning, and
   page grants and tasks return `profile_required`. Learned interests are applied
   automatically and listed under **What Rhythm learned**, where you can keep,
   remove or forget each one and set your own level, length and equipment.
2. Open **Profile → Content library → Connections**. Choose a named agent and its
   capabilities. Create a Rhythm connection token for a bearer-header client,
   or approve the request from an OAuth client. The token is shown once.
3. Sign in on the web app; the extension's panel uses the same sign-in (reopen
   the panel if it still asks you to sign in). Open a YouTube `/watch?v=…`
   page and click the **Rhythm toolbar icon**, which supplies Chrome's temporary
   `activeTab` grant. Then choose **Use this page**. A side-panel button alone
   cannot grant Chrome access to a newly selected tab.
4. Screening happens locally first. Irrelevant and uncertain observations stay
   local. An eligible page is screened again by the backend. Granting a page
   does not request a transcript.
5. Choose an agent or review results yourself. **Evaluate this video** and
   **Find videos** create explicit tasks. Transcript analysis is a separate task
   choice. Rhythm opens YouTube's transcript panel on the chosen video when it reads it.
6. Ask the selected agent to use Rhythm. It discovers its tasks, selects a
   shortlist, requests eligible text if authorized, and publishes recommendations.
   Agent-created tasks remain pending until you start them on the phone or panel.
7. Save, dismiss, or mark a recommendation helpful. Saved results and feedback
   use the same API on the phone and panel. The list currently shows the latest
   60 recommendations. Agent-suggested feedback waits for phone confirmation.
8. A learned change, a switch change or a change to your choices invalidates existing tasks. Pause/revoke page
   access, revoke an agent, review memory suggestions, or delete Rhythm content from the phone.

The service worker stores only the current toolbar invocation in Chrome's
session storage. It has no jobs, model, polling connection, or token proxy.
The open side panel polls the backend every three seconds for narrow requests.
Jobs, reservations, grants, and counters live in SQL.

## Policy and limits

Every API/MCP operation uses the same policy functions in `backend/app/rhythm/`.
The user comes from verified authentication. Input schemas reject unknown
authorization fields. Neither `relevant=true`, a supplied owner ID, nor a claimed
confirmation authorizes work.

Defaults (product choices, not measured optimums):

| Limit | Default | Server setting |
| --- | --- | --- |
| Unique task candidates | 10 | `RHYTHM_CANDIDATES_PER_TASK` |
| Unique shortlisted videos, including previous selections | 3 | `RHYTHM_SHORTLIST_PER_TASK` |
| New acquisition reservations per task | 3 | `RHYTHM_ATTEMPTS_PER_TASK` |
| Acquisition reservations per user/day | 10 | `RHYTHM_ATTEMPTS_PER_DAY` |
| Searches per user/day | 20 | `RHYTHM_SEARCHES_PER_DAY` |
| Active task lifetime | 30 minutes | `RHYTHM_TASK_MINUTES` |
| Private transcript cache | 24 hours | `RHYTHM_CACHE_HOURS` |
| Budget day | America/Toronto | `RHYTHM_BUDGET_TIMEZONE` |
| Learning signals per user/day | 200 | Fixed in `learn.py` |
| Learning window | 45 days; evidence halves every 14 days | Fixed in `learn.py` |
| Collected video signals | Kept 60 days | Fixed in the `policy.py` cleanup |
| Model refinement of learned interests | At most every 10 minutes per user | Fixed in `learn.py` |

Candidate, shortlist and per-task acquisition settings can tighten the MVP
ceilings of 10/3/3. Daily acquisition/search settings are capped at 100; task
lifetime at 120 minutes; transcript retention at 24 hours. There are at most ten
active/pending tasks and two searches per task.

A database row lock serializes reservations across requests and server workers.
IO occurs after commit. Profile/grant/task ownership is checked again after IO,
before claiming a browser operation, before accepting a capture, before every
cache delivery, and before publishing source claims.

Shortlist slots cannot be recycled to analyze a fourth video. Repeated requests
for a task/candidate reuse one acquisition, including failures. Cancellation does
not refund a reservation. Search retries reuse their result or bounded failure.
Reconnecting does not reset quotas.

`get_video_transcript` returns at most 80 segments and 12,000 text characters per
page (40 segments by default). Captures/imports are limited to 1,500 segments and
100,000 characters. Returned indices are recorded so a saved citation must point
to text delivered for that task.

The metadata vocabulary is shared in `relevance-rules.json`. Screening is
deterministic and primarily English. Unknown language/equipment/level information
is stated; missing strict duration produces uncertainty. Soft duration preference
does not become a hidden maximum; a learned length is always a preference. Hard
exclusions, unsupported BJJ content, prior dismissals and spectator content cannot
authorize analysis. Learned exclusions come only from the user's own coach messages.

## Transcript, cache, and delivery semantics

The adapter reads a displayed transcript panel in an isolated content-script world. For a transcript read
the user asked for, on the page they chose, it first presses YouTube's own **Show transcript** button if no
transcript panel is open, waits up to 10 seconds for the rows, and closes the panel again afterwards if it
opened it (`openTranscriptPanel` and `closeTranscriptPanel` in `extension/lib/youtube.ts`). A panel the user
opened is left open. It does not scroll to force loading, read player internals, call unofficial captions
endpoints, capture audio, or open tabs for an agent. Learning never opens the panel; it only includes a
transcript that is already open.

Full coverage requires positive start/end and row-count evidence. Otherwise the
capture is `partial`; a missing panel, unsupported layout, or no readable
timestamped rows is `unavailable`. Language stays unknown unless observed.
Source, video ID, capture time, timestamps and completeness accompany every result.
The upload is checked against the request, page reference, task, profile revision,
expiry, consent and grant.

Search uses one Data API search plus one details lookup for returned IDs and
durations, with bounded responses, no pagination loop, and no automatic retries
after provider errors. Search does not supply captions. YouTube's official
`captions.download` requires permission to edit the video and is not used here.
An agent can ask the user to open a shortlisted video or supply timestamped text.
Imported text is always identified as user-supplied and independently unverified.

Caches are private to the user. A cache hit still needs a current task, relevance,
shortlist slot, processing consent and agent permission. Stored text can be used
after a page disconnects if its original grant has not been revoked; that is
permission for the stored copy, not for new live access. **Pause** revokes the
current page, including its cached-text permission. Earlier page grants can be
revoked on the phone.

Navigation ends live access; a document ID and video ID are checked before and
after extraction. The backend side-panel lease lasts 20 seconds, browser requests
90 seconds. Claimed requests are not silently replayed after interruption. A
reopened panel requires an explicit page grant.

Published explanations are built from checked matching preferences. The agent
chooses candidates and exact citations; unsupported prose cannot become a source
claim. Metadata-only, partial transcript and user-supplied-text bases stay distinct.
The initial delivery result is `saved_for_later`. Only a live panel acknowledgement
for a visible card can produce `displayed`; it does not mean the user read it.

## Memory, retention, and deletion

SQL holds the authoritative versioned profile (learned interests and switches),
confirmed context, explicit feedback, tasks and results. Only confirmed
context/feedback is mirrored into user-scoped Agent Memory, using `infer="none"`.
Recall annotates exact still-confirmed SQL facts; unmatched recall notes and
historical claims never replace the saved profile.

The existing Context can serve every signed-in user and both features. BuildNorth retains its
`buildnorth/user/<user>/…` scopes; Rhythm uses
`buildnorth/rhythm/user/<user>/…`. This keeps their recall and feature-specific
erase controls independent. The server derives scopes from authenticated identities,
checks SQL ownership, and never accepts a client-selected memory namespace.

Agent suggestions are pending until a trusted phone action. Profile changes mark
pending interest suggestions stale. `request_forget` requests confirmation and
does not perform deletion itself. The UI shows the actual context and source video
where available.

Rhythm uses **scoped permanent erasure** (`scopes.forget`) for its copies. It does
not call the query-based soft `forget` operation and label that as a purge.
Failed/in-flight erasures retain a retry marker with the scope and owner, but no
saved text. A late in-flight write is checked and erased before its marker is
removed. No SQL write lock is held during memory IO.

Retention:

- Raw transcripts expire within 24 hours and cannot be delivered after expiry.
- Tasks, their candidates/requests, old browser grants, and unconfirmed/stale
  interest suggestions are removed after seven days.
- Collected video signals for learning are kept 60 days, and are deleted at once
  when learning or YouTube is turned off. Learning reads only the last 45 days.
- Profiles (including learned interests and the learning evidence summary), saved
  recommendations (including short cited excerpts), explicit feedback and
  confirmed context remain until deletion.
- Only the current budget day's non-content counters survive content deletion.
  They prevent deletion/reconnection from resetting the daily quota.
- Neither irrelevant page contents nor a general browsing log is stored.
- Rhythm queries are excluded from the phone's persisted offline query cache.

Expiry is enforced when serving data. Physical cleanup runs on foreground
requests and through this maintenance command; schedule it in a deployment:

```sh
cd mobile/backend
.venv/bin/python -m scripts.rhythm_maintenance
```

Maintenance only removes expired content and retries bounded memory operations;
it does not run recommendations. **Delete Rhythm data** revokes Rhythm tokens
and removes its content. **Delete all my data** also covers Rhythm and reports
pending private-memory erasure accurately. Deleting from Rhythm cannot delete
copies already received by an external agent host.

## MCP contracts

Transport: Streamable HTTP at `/rhythm/mcp`. JSON results use **camelCase**;
top-level tool argument names below use **snake_case**. Nested input models accept
the camelCase schema names. Errors from policy are typed results with `status` and
`message`; invalid schemas are validation errors; authentication failures are HTTP
401/403.

| Tool | Input | Result / permission |
| --- | --- | --- |
| `connect_rhythm` | none | This verified client identity's pending/active grant; no private profile before approval |
| `get_interests` | none | Learned (confirmed) profile/revision, approved feedback, permitted confirmed memory, limits; `interests` capability |
| `get_selected_page` | `browser_session_id` | Permitted metadata, `capturedAt`, `pageRef`, availability; `page` |
| `create_video_task` | `task: {action, request, analyzeTranscripts, browserSessionId?, idempotencyKey}` | Pending task assigned to the authenticated agent; `recommend` |
| `list_video_tasks` | none | Up to ten tasks assigned to this agent; `recommend` |
| `get_task_status` | `task_id` | Task state, candidate references and counters; `recommend` |
| `add_selected_video` | `task_id, browser_session_id` | Add the permitted selected page to the active task; `recommend` + `page` |
| `shortlist_videos` | `task_id, candidate_ids` | Monotonic shortlist, maximum three total; `recommend` |
| `search_videos` | `task_id, query, limit=10, language?` | Bounded real Data API candidates and screening reasons; `search` |
| `get_video_transcript` | `task_id, candidate_id, language?, range?: {offset, limit}` | Authorized segments or typed status; `transcripts` |
| `show_recommendations` | `task_id, items` | Validated saved results and actual delivery state; `recommend` |
| `remember_interest` | `proposal, evidence_ref` | Pending context with an owned candidate/recommendation source; `memory` |
| `record_feedback` | `recommendation_id, feedback: {feedback, reason?}` | Pending phone-confirmed feedback; `feedback` |
| `request_forget` | `memory_ref` | Pending deletion request; `memory` |
| `list_saved_videos` | `unsummarized_only=false, limit=5` (1–10) | The videos saved with **Save to Rhythm**, newest first: link, title, channel, length, topics, description excerpt, the transcript Rhythm read, and any stored summary; `saved` |
| `save_video_summary` | `video_id, summary` (1–6,000 characters) | Stores useful notes with that saved video (replacing an earlier summary), adds any topics it names, and re-runs learning's vocabulary pass; `saved` |

**Saved-video summaries.** With the **Saved videos** permission and *Share with my chosen agent* on, the user's agent
can read what they saved with **Save to Rhythm**, including the transcript, and store a summary of each
(`rhythm_signals.summary`, `summarized_at`, `summary_by`; migration `0009`). The summary is part of that video's
evidence for learning (vocabulary and model passes) and is deleted with the video. The website and phone show these
notes in **Content library → Saved videos**, alongside the original title, channel, duration and YouTube link. Both
tools work whether recommendations are on or off.

An explicit **Save to Rhythm** also starts automatic summarization on the backend when a transcript was captured.
It uses the account's connected Claude API key when present, otherwise the configured server AI provider. Cooking
videos produce ingredients and ordered instructions; exercise tutorials produce setup, movements, stated reps/timing
and form cues; other videos produce practical takeaways. Source text is untrusted input; the model is instructed to
mark missing details and never invent quantities or steps. Generated output is schema-validated and capped at 6,000
characters. Titles and URLs come from stored metadata, never the model. HTTPS YouTube links open through the phone's
OS, which routes to YouTube when configured and otherwise to the browser.

No transcript means metadata and link only. Missing AI, invalid output or a provider failure leaves the video saved
with a **Generate summary** retry button. This also works on older saved videos. Existing summaries are kept without
another model call. Migration `0012` adds a per-video generation claim; concurrent requests reuse it, claims expire
after ten minutes, and in-flight output cannot overwrite an agent's newer summary or resurrect a deleted video.
The library is account-scoped and works with agent sharing and recommendations off. Full transcripts are omitted
from its REST response; approved MCP clients still receive them under the existing saved-video permission.

Recommendation items are `{candidateId, analysisBasis, citations?}`.
Input bases: `metadata`, `transcript`, `user_text`. Citations are
`{segmentIndex, quote}` and must match delivered text. Output bases also include
`transcript_partial` and `user_text_partial`. Output cards contain a real stored
video ID/link, title, duration or null, matching preferences, explanation, source
references, timestamped excerpts where applicable, limitations and profile revision.

Application statuses: `ok`, `irrelevant`, `uncertain`, `profile_required`,
`permission_required`, `browser_unavailable`, `transcript_unavailable`,
`transcript_partial`, `stale_context`, `budget_exceeded`, `provider_error`,
`pending`, `cancelled`, `not_found`, `task_required`.

Task states: `pending`, `active`, `cancelled`, `stale` (including expired views).
Memory/feedback proposals have their own review states. A model-supplied
`confirmed` field cannot approve anything.

The schemas actually registered with MCP are available through authenticated
`tools/list`. Export them offline, without starting a server or reading a database:

```sh
cd mobile/backend
.venv/bin/python -m scripts.rhythm_contracts --output /tmp/rhythm-tools.json
```

REST schemas are also published at `/openapi.json`. UI routes under `/rhythm`
use Clerk session authentication. Agents use the MCP resource and cannot call
UI approval, profile-writing, token-minting or transcript-upload routes.

Profile and learning routes:

| Route | Purpose |
| --- | --- |
| `GET /rhythm/interests` | The profile with `consent` (including `learn`), `enabledSites`, `profileRevision` and `confirmed`. `profile_required` and a "hasn't learned yet" message until something is learned |
| `PUT /rhythm/settings` | `{expectedRevision, enabledSites: ["youtube"], consent: {metadata, transcripts, agent, memory, learn}}`. Changes switches only and never learned interests; creates the profile when missing (`expectedRevision` 0). A stale revision returns `stale_context` |
| `POST /rhythm/signals` | One watched video from the user's own extension, accepted only while learning and YouTube are on. Videos outside fitness, health and food return `irrelevant` and are not kept |
| `POST /rhythm/reactions` | `{metadata, capturedAt, reaction: "more" \| "less", transcript?}` from the side panel's **Save to Rhythm** / **Not interested**. **Save to Rhythm** opens, reads and closes YouTube's transcript panel and sends up to 400 segments and 20,000 characters, which are stored with the video and also used to place it. Needs YouTube page details on, not learning; with learning off, "more" pins the video's topics |
| `GET /rhythm/saved` | Latest 100 explicitly saved videos for the signed-in account, including notes, canonical YouTube links and summary state; no transcript payload |
| `POST /rhythm/saved/{video_id}/summary` | Generate missing notes or retry a failed/expired generation for an owned saved video; existing notes are preserved |
| `GET /rhythm/learned` | `learned`: each interest with its `state` (`pinned`, `learned`, `noticed`, `blocked`) and evidence counts (`videos`, `saved`, `chats`, `feedback`, `notInterested`); `experienceLevel`, `preferredDurationMinutes`, `availableEquipment` as `{value, source: "you" \| "learned" \| null}`; `avoid`; the stored `choices`; `suggestion` (`{topic, text}` or null); `learning`, `confirmed`, `deferred`. `profile_required` without a profile. Shown in Interests & sharing and the web Overview |
| `PUT /rhythm/choices` | `{expectedRevision, pinned, blocked, acknowledged, experienceLevel, preferredDurationMinutes, availableEquipment}`. The user's own choices, which win over inference; `null` means "learn it". Every list replaces the stored one and omitted fields reset, so send them all. Creates the profile when missing (`expectedRevision` 0). Returns the new `learned` view; a stale revision returns `stale_context` |
| `POST /rhythm/forget` | `{topic}`. Deletes the stored videos behind one interest, stops counting earlier chats and feedback about it, unpins it and answers its prompt. Returns the new `learned` view |
| `PUT /rhythm/interests` | The earlier typed-in profile save. The phone and web apps no longer call it |

Withdrawing a permission takes effect at once: turning learning off deletes the
collected video signals and what was learned from them, turning YouTube off deletes
the collected video signals, turning YouTube or page details off pauses
permitted pages, turning transcripts off deletes cached transcripts, and turning
memory off erases Rhythm's private memory copies.

## Connecting clients

**Claude, ChatGPT and Codex (sign-in, no token).** *Content library → Connections → Connect Claude, ChatGPT or Codex*
works like a website's "Connect" button. Choosing **Connect Claude** (or ChatGPT, Codex) approves that assistant with
the chosen permissions (`PUT /rhythm/assistants/{claude|chatgpt|codex}`, stored as a grant with client ID
`assistant:<name>`), then shows the steps: add Rhythm's address as a custom connector in Claude or ChatGPT (or
`codex mcp add rhythm --url …` and `codex mcp login rhythm` in Codex), and sign in with the BuildNorth account. The
assistant's OAuth token is matched to that approval by its Client ID Metadata Document address (`claude.ai` /
`claude.com`; `chatgpt.com/oauth/codex/` for Codex; other `chatgpt.com` for ChatGPT), so its first request works
without `connect_rhythm` and a second approval. **Disconnect** revokes it at once. The address must be the public HTTPS
one (`mobile/scripts/mcp-tunnel.sh` and `MCP_PUBLIC_URL`, see `mobile/README.md`): these assistants connect from the
internet, and the card warns when the address is `localhost`. Claude and ChatGPT use Clerk's CIMD support (already
configured for `/mcp`); Codex uses CIMD too when Clerk advertises it, which it does.

For a bearer client, create a token in **Profile → Content library → Connections**.
Set `RHYTHM_MCP_TOKEN` privately in the agent host and
`RHYTHM_MCP_URL=http://localhost:8000/rhythm/mcp` (or the public HTTPS equivalent).
Tokens begin `bnr_`, are stored as hashes, expire after 90 days and are revocable.
They cannot authenticate to legacy `/mcp`; legacy `bnc_` tokens cannot authenticate
to `/rhythm/mcp`.

Templates are in `extension/clients/`:

```sh
claude --mcp-config extension/clients/claude.mcp.json --strict-mcp-config
```

For OAuth clients, connect the public `/rhythm/mcp` URL without a bearer header.
The existing Clerk issuer verifies JWT access tokens, scopes `email profile`,
allowed client identity, and the **Rhythm resource audience**. Clerk session
tokens and tokens naming the legacy resource are rejected. Configure Clerk's
CIMD/PKCE/JWT/Include Audience options following its current guide. After the
client calls `connect_rhythm`, approve its capabilities on the phone.

User-facing capabilities are interests, selected page, search, transcript
reading, recommendations, memory, and feedback. Browser grants are separate.
Revoking an agent stops pending work and is rechecked on every tool.

## Verification record

The automated acceptance checks are in `backend/tests/test_rhythm.py`,
`backend/tests/test_mcp.py`, and `extension/tests/youtube.test.ts`.

- Full backend suite: **264 passed** after adding the existing-Context owner binding.
- Phone TypeScript and Expo lint pass. The existing **17 Node tests** passed.
- Extension TypeScript and production build pass; **4 browser checks pass**, covering metadata-only access,
  relevance examples, partial/unavailable extraction, source text containing
  instructions, and native MV3 permission isolation/navigation.
- Tests use migrated SQL, real HTTP/MCP transport, fixture Clerk signing keys,
  explicitly labelled search/transcript fixtures, and private-memory test doubles.
  They cover cross-user access, task/shortlist gates, concurrent reservations,
  retries, profile changes, revocation, cache authorization, expiry, source claims,
  pending approvals, deletion and memory/write races.
- A real watch-page inspection observed YouTube's metadata and transcript-panel
  markup. “Show transcript” returned HTTP 400 on both inspected videos in isolated browsers,
  and the real adapter returned `unavailable` with zero segments. A successful
  live transcript capture is **not** claimed. The conservative row reader is
  exercised with labelled DOM fixtures.
- A real Claude Code **2.1.302** host using **claude-sonnet-5-5** completed the
  metadata-only MCP tool flow against `/rhythm/mcp` and an isolated fixture database. It read a
  labelled fixture profile, shortlisted observed metadata for video
  `w-9e8gnQvx4`, saved a recommendation, and correctly reported `saved_for_later`.
  This does not claim a live signed-in phone-to-panel journey.
- OpenCode **2.0.31** was attempted with `opencode/big-pickle`; the model provider
  returned HTTP 403, so an OpenCode model-completed flow is **not verified**.
- The official Python MCP **2.3.0** client verifies transport, schemas, resource
  isolation and application policy. ChatGPT, Claude Desktop and other OAuth
  clients have not been verified for this new endpoint.
- Live YouTube Data API search and details are verified with the backend key:
  `search.list` and `videos.list` both returned HTTP 200 for
  `beginner boxing footwork tutorial`, bounded to three results. The normal
  policy service used an isolated profile fixture: one candidate was relevant,
  one was excluded for heavy-bag equipment, and one was uncertain. It recorded
  three candidate checks, one search, zero transcript attempts and zero provider
  failures. The relevant result was FightCamp's
  [beginner boxing footwork tutorial](https://www.youtube.com/watch?v=dg2Jp3F30Lw),
  with an API-reported duration of 412 seconds. The key is stored only in the
  ignored backend environment file, with owner-only file permissions.
- The existing SurrealDB Context is now bound to the local app account through
  `SPECTRON_OWNER_USER_ID`. A live, non-personal verification marker was written
  with `infer="none"`, recalled, and erased. Recall afterwards found no marker;
  BuildNorth's separate recall lens did not return it; another user ID was
  rejected before SDK access. The original five-second timeout was too short
  for some live recall requests, so bound clients now use a bounded 20-second
  timeout without automatic retries.

The integration run's measured counters were one candidate admission check, zero
transcript acquisitions, zero cache hits and one saved metadata-only recommendation.
Local page checks appear separately in the panel. Server counters distinguish
first admission checks, acquisition reservations, cache attachment hits, policy
refusals, searches and video-provider failures. Revalidations do not consume new
candidate slots; pagination does not consume acquisitions.

Reproduce checks:

```sh
cd mobile/backend
.venv/bin/python -m pytest -q
```

To check a configured memory binding against the live service:

```sh
cd mobile/backend
.venv/bin/python -m scripts.shared_memory_check
# Owner-only deployment (or one existing account in shared mode):
.venv/bin/python -m scripts.rhythm_memory_check --user user_YOUR_CLERK_ID
```

The shared check uses two unique fixture identities, tests save/recall, rejects
foreign identities on bound services, and proves erasing one leaves the other
intact. It removes only its own temporary marker scopes. It does not create Clerk
accounts or change profiles or consent, and prints no credentials or existing
memory content. Use `--shared-preview` to test before clearing an owner setting.
Clerk authentication, forged tokens, payload overrides and MCP isolation are
covered separately by the backend suite. The single-account check creates and
removes one unique marker. The older
multi-user `scripts.live_check` refuses to place fictional users in a Context
that has an explicit owner; run it only against a separate test Context.

```sh
cd mobile
npm run typecheck
npm run lint
node --experimental-strip-types --test src/lib/*.test.mjs
```

```sh
cd extension
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build:local
```

Browser tests build into `.output-tests`, separate from the user's unpacked
extension. They use Chrome for Testing and labelled fixtures, including a private
storage canary, with no personal browsing profile.

For an isolated real-client check when account setup is blocked,
`python -m scripts.rhythm_demo --directory <new-scratch-directory> --metadata <capture.json>`
creates a **labelled fixture profile/task**, a new database and a private token file.
It refuses an existing database. The metadata file is
`{"metadata": <VideoMetadata>, "capturedAt": "<observed ISO timestamp>"}`.
Run the normal backend with that database URL, memory and AI off, and point the
client at its `/rhythm/mcp` endpoint. This is a fixture-assisted protocol check,
not a substitute for the phone/browser sign-in demonstration.

## Remaining live checks

- Complete Clerk sign-in on the phone and extension. Automated attempts reached
  email verification / request verification and were not completed.
- Run the signed-in learning switch → watched videos → learned profile →
  side-panel refresh → chosen-agent recommendation → phone saved-video journey with
  the user's account.
- Verify displayed-transcript extraction on a real page where YouTube makes the
  transcript available, including language and long/virtualized layouts.
- Exercise the signed-in search-to-three-recommendations journey. Live API search
  and details are verified; quota-error handling is covered with automated fixtures.
- Automatic Context creation is intentionally out of scope. The configured shared
  Context supports authenticated users without Cloud organisation/admin credentials.
- Exercise a second agent host with a working model. Forced native worker
  suspension is not claimed as a live manual check; lease expiry/recovery is
  covered at the service boundary.

There is no automatic background recommender, remote arbitrary-video transcript
provider, audio transcription, additional site adapter, 3D/motion generation,
camera coaching or BJJ support in this implementation.

## Documentation consulted

- [MCP architecture](https://modelcontextprotocol.io/docs/2025-06-18/learn/architecture)
  and [HTTP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
- SurrealDB [MCP installation](https://surrealdb.com/docs/agent-memory/integrations/mcp-server/install),
  [tool contracts](https://surrealdb.com/docs/agent-memory/reference/mcp-tools),
  [Contexts/scopes](https://surrealdb.com/docs/agent-memory/mental-model/contexts-and-scope).
- Chrome [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
  [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab),
  [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts),
  [side panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel),
  [permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions),
  [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use),
  [data disclosure](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
- YouTube [search](https://developers.google.com/youtube/data/reference/rest/v3/search/list),
  [details](https://developers.google.com/youtube/data/reference/rest/v3/videos/list),
  [displayed transcript](https://support.google.com/youtube/answer/15930243?hl=en),
  [captions authorization](https://developers.google.com/youtube/data/reference/rest/v3/captions/download).
- [WXT React](https://wxt.dev/guide/essentials/frontend-frameworks),
  [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/),
  [Clerk extension SDK](https://clerk.com/docs/reference/chrome-extension/overview),
  [Clerk MCP server](https://clerk.com/docs/guides/ai/mcp/build-mcp-server),
  [Clerk clients](https://clerk.com/docs/guides/ai/mcp/connect-mcp-client).
