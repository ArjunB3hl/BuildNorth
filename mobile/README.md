# BuildNorth

A personal health companion for meals, cooking, exercise routines, daily check-ins and progress.
Expo (SDK 57, Expo Router, TypeScript) app + FastAPI backend.

## Web app

Detailed change record, source map and verification limits: [Web app implementation](docs/web-app.md).

Run the backend as described below, then `npm run web` in `mobile/` and open
`http://localhost:8081`. Sign in with the same Clerk account used by the phone and Rhythm.
The web app uses React Native Web and Expo Router, with a responsive sidebar and a web overview.
Coach, meals, activity, profile, Rhythm settings and video management use the existing authenticated APIs.
Browser sign-out clears this browser's account cache without revoking Apple Watch tokens.

The overview refreshes recommendations and browser connections every 15 seconds while mounted.
It shows permitted pages and recommendations, not verified watch history. To share content:

1. Open **Interests & sharing** and turn on **Learn my interests automatically** and **YouTube with page details**.
   Switches save as they change. Rhythm learns from your coach chats and the workout and recipe videos you watch;
   pages can be permitted once it has learned something. The overview's Personalisation card shows whether it's on.
2. Build/load `extension/` and sign in with the same account. The panel's **Open web interests** and
   **Open web dashboard** links default to `http://localhost:8081`; configure `WXT_WEB_APP_URL` for another origin.
3. Open a YouTube watch page, click Rhythm's toolbar icon and select **Use this page**.
   Transcript reading requires its separate consent and a task. Recommendations need a connected agent
   or the existing manual workflow; merely selecting a page does not generate one.
4. Review saved recommendations in the overview or **Content library**. Revoke page grants from the overview;
   manage agents, memory and deletion in the profile screens.

Clerk manages essential authentication storage. The overview offers an optional, host-only
`buildnorth_display=compact` cookie for compact display of the cookie panel. It expires after 30 days,
uses `SameSite=Lax` and `Secure` on HTTPS, and can be removed with **Use essential only**.
It contains no health information, tokens or browsing activity. This choice never enables content sharing.
The extension's cookies permission is used by Clerk, with host access limited to Clerk and the backend;
it does not harvest cookies from fitness sites. Saved app records also use the existing per-account offline cache.

`npm run build:web` writes a static export to `dist/`. This is a local implementation, not a hosted deployment.
A deployed frontend also needs its HTTPS origin allowed by backend CORS and Clerk's authorized parties,
plus the correct public API URL; the backend currently allows localhost web origins only.

```
Expo app ── Clerk session token ──▶ FastAPI backend ──▶ SQL database (authoritative app records)
  (Clerk sign-in,                    verifies token via    ├─▶ SurrealDB Agent Memory (confirmed preferences and
   SecureStore session,              Clerk JWKS; user =    │     shared Apple Watch summaries, one subtree per user)
   offline cache)                    verified `sub`        └─▶ AI provider adapter (coach, extraction, planner drafts)
   │ WatchConnectivity (link)               ▲
   ▼                                        │ watch link token (bnw_), /watch/* routes only
Apple Watch app (SwiftUI) ──────────────────┘
```

- **Today**: planned meals/activities (done / skip / move), daily check-in (energy, mood, optional sleep), quick actions,
  and a **Week** view — see *Weekly planner* below.
- **Coach**: persistent chat built on the shared user context (see *Shared memory* below): profile, saved preferences,
  what long-term memory recalls for the message, and the recipes, routines and week plan it's about. Each reply says what
  it used, or warns when long-term memory couldn't be checked. Suggests recipes, routines and preferences that only
  become saved data after you review/confirm them. Never changes your plan on its own.
- **Meals**: paste text → editable recipe (servings, quantities, ordered steps, timers) → save/edit/delete/search,
  servings scaling, shopping list (combines only compatible units), guided cooking mode with timers.
- **Activity**: routines (sets, reps, duration, weight, rest), run a session, log sets, finish → saved history.
- **Profile**: edit preferences & goals, progress from real sessions/check-ins/plan items, view/correct/delete remembered
  preferences, erase memory, delete all data (reports exactly what was deleted), sign out.
- **Apple Watch** (iPhone development build): sleep patterns and live workout heart rate, with sign-in on the phone.
  Daily summaries can reach the Coach and connected assistants when you enable sharing — see *Apple Watch*.

The app never sends a user ID. The backend takes the user from the verified Clerk token and scopes every query and
every Agent Memory read/write to that user. Nothing the coach says is medical advice; generated recipes aren't checked
for allergens and nutrition values are labelled as estimates.

## Rhythm video companion

The current video-companion phase is **Rhythm**: interests learned from the user's
own activity (opt-in, off by default), selective YouTube analysis, and the user's
chosen MCP agent. While learning is on, the backend learns from coach chats, the
fitness, health and food videos the extension sees the user watch, and saved or
helpful recommendations. The apps show only the learning and sharing switches;
learned interests stay in the backend. Its phone screens are
under **Profile → Interests & sharing / Content library**, its Chrome app is in
`../extension/`, and its dedicated MCP endpoint is `/rhythm/mcp`.
See [the implementation, setup and verification guide](docs/rhythm.md).
The 3D, motion and live-coaching ideas under Later phases are outside this phase.

## Weekly planner

Connects Meals, Activity, Coach preferences and Today. Everything below lives in the Today tab's **Week** view.

- **Manual planning** (always works, AI or not): seven days, add saved recipes/routines or free text per day, move
  between days, done / skipped / undo, remove. Adds carry an idempotency key, so a double tap saves once.
- **Help plan my week** (`/planner`): pick the days, meals, activity days, time per activity and which saved
  recipes/routines to use, plus an optional note *for this plan only*. Equipment is asked for only if your profile has
  none. The result is a **draft** (`/planner-review`) — nothing is saved until you accept it.
  - Grounding: the server builds numbered facts from your profile, confirmed preferences and this request; the model
    can only cite fact IDs, and every "Why:" line and the summary are written by the server from those facts. Items
    are labelled *saved recipe/routine*, *new idea* or *from the recipes you selected*.
  - Checks on every item: diet conflicts (warning), equipment you don't have (warning), activities over your time
    limit (left out, with a note), food mislabelled as exercise (dropped), days outside the range (dropped). Open
    slots are filled from your selected recipes/routines; anything still open is listed.
  - Edit any item (name, day, meal slot or minutes), remove (with undo), or ask for changes in words. Accept one item
    or all; accepting is one transaction and idempotent (`proposalId` + item key), so retries never duplicate.
    New-idea meals/activities can be turned into a recipe/routine through the usual import → review → save flow.
  - The draft is kept on the device per user (cleared on sign-out and data deletion), so it survives a restart.
- **Change your plan** in words, on the saved week or on a draft: e.g. "Move Thursday's workout to Saturday",
  "I only have 15 minutes tomorrow", "Replace this meal with a vegetarian option" (after tapping *Change…* on it),
  "Drop Wednesday's workout", "Make every dinner vegetarian". You see the exact changes first and confirm them.
  Common requests are handled by rules (instant, and they work without AI); anything else goes to the model and is
  validated: completed/skipped items are never changed, edits must stay on the days and the kind of item you named,
  a time limit or "with lentils" you mention is checked, and replacing an item with itself is ignored. Applying is
  all-or-nothing and a retried confirmation is a no-op.
- **Temporary vs lasting**: whether a request is lasting is decided only from your own words ("from now on", "I'm
  vegetarian now", "I don't eat …"); "tonight"/"this week" requests stay temporary. For a lasting one the app *offers*
  to remember it (not if your profile or memory already says so); it is saved only when you tap *Remember*.
- **Weekly review** (`/review`): last 7 days or last week, computed only from records — sessions and minutes, planned
  items done/skipped/not marked, check-ins. Days with no records are reported as missing data, not as zero activity.
  Optional adjustments (fewer activity days, shorter sessions, dinners only) prefill the next plan; no health outcomes
  or reasons are inferred.
- **Without AI** (`AI_PROVIDER=none`, a timeout or a model error): drafts use only your selected recipes/routines and
  say so; rule-based changes still work; other requests explain what is possible. With nothing selected and no AI, the
  planner asks you to select items or plan manually.

API: `GET /plan`, `POST /planner/proposals`, `POST /planner/accept`, `POST /planner/changes` (preview),
`POST /plan/changes` (apply), `GET /review/week`. Logic: `backend/app/planner.py`; migration `0002_weekly_planner`.

## AI assistants over MCP (OpenCode, ChatGPT, Claude)

The backend also serves an MCP server at **`/mcp`** (Streamable HTTP, official Python MCP SDK `mcp==2.3.0`).
Assistants bring their **own** models; no model runs in the app or the MCP server, and Ollama is not needed for
any MCP tool. The mobile app keeps talking to the backend directly, and both work on the same records. Connecting
ChatGPT or Claude here does **not** change the Coach tab, which still uses `AI_PROVIDER`.

| Tool | What it does |
|---|---|
| `get_user_context` | **Call before personalized help.** Saved preferences (source, last update, recalled-for-this-request), long-term memory status and notes, profile, and the recipes/routines/week plan the request needs |
| `get_profile` | Goals, diet, equipment, experience and saved preferences (database only, no memory recall) |
| `list_recipes`, `get_recipe`, `list_routines`, `get_routine` | Saved recipes and routines |
| `get_week_plan`, `get_activity_summary` | Plan items (with IDs) and 7 days of recorded activity |
| `get_health_summary` | Apple Watch daily summaries (sleep, resting heart rate, HRV, steps, active energy, workouts) for 1–31 days, with `missing_days`; empty with a note while health sharing is off |
| `list_proposals`, `get_proposal` | Proposals and whether they were approved |
| `propose_plan_changes`, `propose_recipe`, `propose_preference`, `propose_preference_correction`, `propose_preference_removal` | Validated, stored for approval; **nothing is saved** |
| `apply_proposal` | Applies a proposal only with the user's approval (see below) |

- **Identity** comes only from the verified credential (never from tool arguments): Clerk **OAuth access tokens**
  (ChatGPT, Claude) or **connection tokens** the user creates in the app (Profile → *Connect AI assistants*). Clerk
  *session* tokens from the mobile app are refused at `/mcp`.
- **OAuth token rules** (`backend/app/mcp_auth.py`): an RFC 9068 JWT (`typ: at+jwt`) signed by this Clerk instance's
  JWKS with the right `iss`, unexpired, `sub` a Clerk user; `client_id` an HTTPS CIMD URL on an allowed host
  (`MCP_OAUTH_CLIENT_HOSTS`, default `chatgpt.com,claude.ai,claude.com`) or listed exactly in `MCP_OAUTH_CLIENT_IDS`;
  `aud` must contain `MCP_PUBLIC_URL` and nothing else except the token's own client ID; scopes `email profile`.
  `MCP_REQUIRE_RESOURCE_AUDIENCE=false` drops only the "must contain this resource" part, for an authorization server
  that can't bind `aud`. Every refusal is logged with the reason and the non-secret claims (`client_id`, `aud`, `scope`).
  Opaque Clerk tokens are refused unless `CLERK_SECRET_KEY` is set; no supported client has needed it so far. Unauthenticated requests get `401` with
  `WWW-Authenticate: Bearer resource_metadata=…`; metadata is at `/.well-known/oauth-protected-resource/mcp`
  (and the root path) and names this app's Clerk instance as the authorization server. Unknown `Host` headers get
  `421` (DNS-rebinding protection).
- **Preview vs apply**: proposals are checked with the app's own rules (ownership of every recipe/routine/item, done
  or skipped items can't change, diet and equipment warnings, recipe validation) and returned as exact changes.
  A proposal is applied only when the user approves it **in the app** (Today → *Waiting for your approval*) or in
  the assistant's **own approval prompt** (MCP elicitation, if the client supports it; set
  `MCP_CLIENT_APPROVAL=false` to allow app approval only). A model-supplied `confirmed: true` isn't accepted.
  Applying is one transaction, happens at most once (retries and double taps return the same result), and a
  proposal whose items changed in the meantime is marked *stale* without touching anything. Proposals expire after 48 h.
- Code: `backend/app/mcp_server.py` (tools), `assistant_proposals.py` (validate/approve/apply),
  `mcp_auth.py` (credentials), `plan_changes.py` (shared with the app's `/plan/changes`), migration `0003`.

### Shared memory (Coach, Claude, OpenCode)

One service, `backend/app/user_context.py`, gathers what BuildNorth knows about the signed-in user for a request. The
Coach calls it on every message; assistants get the same result from the MCP tool `get_user_context`.

- **Sources, all scoped to the verified user**: profile and saved preferences from the app database (authoritative;
  corrections and deletions apply immediately), SurrealDB Agent Memory recall for the request (lens `<user>/*`), and
  the saved recipes, routines and week plan the request is about (topics *meals*, *workouts*, *plan* are detected from
  the request or passed explicitly).
- **Each preference** comes back with its `source` (`app`, `coach`, `planner`, or `assistant` plus which connection),
  `saved_at`, `updated_at`, whether it is mirrored into memory, and whether memory recalled it for this request.
  Recalled text that matches no saved preference is passed on as a *memory note*, except while an earlier deletion is
  still being erased (then it's withheld, so a corrected or deleted preference can't come back).
- **Outages are explicit**: `memory.status` is `ok`, `unavailable` or `not_configured`. When it isn't `ok`, the Coach
  prompt says so, the reply in the app carries a warning instead of the usual "Memory checked · used …" line, and the
  MCP result tells the assistant to say long-term memory couldn't be checked.
- **Data, not instructions**: the Coach wraps it in `<context>`; MCP results carry a `notice` saying so.
- **Durable changes need confirmation**: adding (typed in the app, or a Coach/planner suggestion you confirm),
  correcting and deleting (in the app, with a confirmation for deletes) or, from an assistant, `propose_preference`,
  `propose_preference_correction` and `propose_preference_removal`, which wait for your approval. A correction or
  removal goes *stale* if the preference changed after it was proposed. One-off requests ("tonight", "this week",
  "for now") are refused as preferences, and the Coach never offers them as preferences to save.
- Migration `0004` adds `source`/`source_detail` to saved preferences and the per-reply context summary to Coach messages.
- The weekly planner (*Help plan my week*) also checks memory first: recalled notes become facts labelled
  *(long-term memory)*, and a draft made without memory says so at the top.
- MCP `get_profile` checks memory too (`memory`, `memory_notes`, `recalled` per preference), so assistants whose
  tool list predates `get_user_context` still get recall and an explicit status.
- **Apple Watch health** (topic *health*, detected from words like sleep, HRV, resting, steps, recovery, tired):
  when you share health data, requests about health, workouts or the plan get 7 days of watch summaries from SQL
  in `get_user_context` and the Coach (`<health_summary>`), ending at the end of the requested week or today,
  whichever is earlier. Finished days are also mirrored into Agent Memory under `<user>/health/<revision>` so recall
  finds them. A recalled health sentence marks its day `recalled` instead of becoming a generic memory note. Details in
  *Apple Watch → What agents can use*.

### OpenCode

`opencode.json` in the project root adds one remote server, `buildnorth`; OpenCode merges it with your global config,
so other servers and your selected model are unchanged. The token comes from an environment variable:

```json
{ "mcp": { "buildnorth": { "type": "remote", "url": "http://localhost:8000/mcp", "oauth": false,
  "headers": { "Authorization": "Bearer {env:BUILDNORTH_MCP_TOKEN}" }, "timeout": 15000 } } }
```

1. In the app: Profile → *Connect AI assistants* → *Create token*, copy it.
2. Put it in the git-ignored `.env.opencode` (`BUILDNORTH_MCP_TOKEN=bnc_…`, mode 600), or export it in your shell.
3. Start OpenCode with the variable set (OpenCode 2 runs a background service, so restart it once):

   ```bash
   set -a; source .env.opencode; set +a; opencode service restart; opencode
   ```

4. `opencode mcp list` should show `✓ buildnorth connected`.

OpenCode's *model* is configured separately (`opencode models`, `/models`); the MCP entry doesn't select one.

### ChatGPT and Claude (remote)

Both connect from their own cloud, so the server needs a **public HTTPS URL**, and each user signs in with their
BuildNorth (Clerk) account. Both identify themselves to Clerk with a **Client ID Metadata Document (CIMD)**: their
`client_id` is an HTTPS URL that Clerk fetches (ChatGPT: `https://chatgpt.com/oauth/client.json`, redirect
`https://chatgpt.com/connector_platform_oauth_redirect`; Claude: `https://claude.ai/oauth/mcp-oauth-client-metadata`, redirect
`https://claude.ai/api/mcp/auth_callback`). No client registration is stored, and Dynamic Client Registration stays off.

1. **Clerk Dashboard** (account step), instance **Development** (`ins_3KlYX5hnIVtYVilYVFthCTKeBxy`,
   `casual-rabbit-7268`): *Configure → Developers → OAuth applications → Settings*. This instance uses Clerk's
   current OAuth implementation (no legacy notice). Set and save:
   - **Publish CIMD support**: on. **Client admission** (appears once it's on): *Any compatible CIMD client*.
   - **Publish DCR support**: off (deprecated). **Require PKCE**: on.
   - **Access token format**: **JWT access tokens** (verified with the public JWKS; no `CLERK_SECRET_KEY` needed).
   - **Include Audience**: on. Clerk then copies the `resource` that ChatGPT/Claude request into `aud`, which the
     backend requires (`MCP_REQUIRE_RESOURCE_AUDIENCE=true`).

   Then check discovery — both values below are what ChatGPT and Claude look for before choosing CIMD:

   ```bash
   curl -s https://casual-rabbit-7268.clerk.accounts.dev/.well-known/oauth-authorization-server | python3 -m json.tool | grep -E "client_id_metadata_document_supported|token_endpoint_auth_methods"
   ```

   It must show `"client_id_metadata_document_supported": true` and `"none"` among the auth methods.
2. **After a first sign-in**, the backend log shows each refused token with its reason and non-secret claims, so a
   wrong format or audience is visible immediately.
3. **Public URL** (development): with ngrok signed in (`ngrok config add-authtoken …`), run
   `scripts/mcp-tunnel.sh <your-static-domain>.ngrok-free.app` (claim the free static domain in the ngrok dashboard
   under *Domains*), or `scripts/mcp-tunnel.sh` for a temporary random URL. Set
   `MCP_PUBLIC_URL=https://<host>/mcp` in `backend/.env` and restart the backend. The URL entered in ChatGPT/Claude
   must equal `MCP_PUBLIC_URL` exactly, so a random URL means updating both each time. For production, deploy
   behind HTTPS and use that URL.
4. **Check the endpoint**: `curl -i -X POST https://<host>/mcp` returns `401` with
   `WWW-Authenticate: Bearer … resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"`, and that
   document lists `"resource": "https://<host>/mcp"` and your Clerk issuer.
5. **ChatGPT**: chatgpt.com/plugins → **+** → *Add custom MCP server* → URL `https://<host>/mcp`, authentication
   **OAuth** (ChatGPT uses its CIMD client automatically) → create → sign in with your BuildNorth account and approve
   the consent screen. Account and workspace policies decide availability.
6. **Claude** (claude.ai / Desktop): *Customize → Connectors → Add custom connector* → URL `https://<host>/mcp`,
   *Sign in now*, OAuth client **Use Claude's published identity** (CIMD) → *Add* → *Connect* → sign in with your
   BuildNorth account and approve the consent screen. Free plans allow one custom connector; Team/Enterprise owners
   add it under Organization settings.
7. **Verify** in each assistant: ask it to read your week plan (`get_week_plan`), then to propose a change
   (`propose_plan_changes`). The change must appear in the app under Today → *Waiting for your approval* and stay
   unapplied until you approve it there (or in the assistant's own approval prompt).

### What was tested

**With a connection token** (Bearer `bnc_…`, created in the app):

| Client | Result |
|---|---|
| Official MCP Python SDK client (pytest, real HTTP server) | 401/403, isolation between users, read-only reads, preview vs apply, approval in the app and in a client prompt (both protocol versions), stale/expired, retries and concurrent approvals, no AI provider |
| OpenCode 2.0.31 (`opencode run`, free model) | Connected; real reads; a proposal stored without changing the plan; approved in the app; read back as applied |
| Official MCP client over `https://unintrusive-timika-unshadily.ngrok-free.dev/mcp` | `401` + resource metadata without credentials; tool listing, a read and a pending proposal with the token |

**With Clerk OAuth** (real tokens from Clerk instance `casual-rabbit-7268`):

| Check | Result |
|---|---|
| Clerk discovery | `client_id_metadata_document_supported: true`, `none` auth method, no DCR endpoint |
| Claude connector (claude.ai, *Use Claude's published identity*) | You signed in with Clerk; Claude's requests (from `160.79.106.x`, Anthropic's egress range, user agent `Claude-User`) were accepted with `client_id=https://claude.ai/oauth/mcp-oauth-client-metadata`, `aud=https://unintrusive-timika-unshadily.ngrok-free.dev/mcp`, `scope=offline_access email profile`, `sub` = your app user |
| Tool listing over OAuth | All 13 tools exposed through the connector |
| Read over OAuth | `get_week_plan` for 2026-10-19 returned the 9 saved items |
| Proposal over OAuth | `propose_plan_changes` (add "Dumbbell 15" on Thu 22 Oct) stored as **pending**, attributed to the Claude OAuth client; plan unchanged; shown in the app under *Waiting for your approval* |
| Token rules (pytest, simulated `at+jwt` tokens) | Pass: blocked clients, foreign/missing audiences, wrong typ/issuer, expiry, scopes |
| Not tested | Approving that proposal (your decision in the app), `apply_proposal` via Claude's own approval prompt, ChatGPT |

**Shared memory flow** (fictional preference, 16 Oct 2026, live backend + real SurrealDB + Ollama):

| Step | Through | Result |
|---|---|---|
| Save "Fictional test: I can't stand coriander…" | App (simulator), Profile → *What BuildNorth remembers* | Saved, synced to its own memory scope, source *Added in the app* |
| Use it | Mobile Coach ("Suggest a curry recipe…") | Reply line "Memory checked · used 2 saved preferences (2 recalled) · 5 recipes"; curry without coriander |
| Use it | OpenCode (`opencode run`, free model, connection token) | Without being told to, it called `get_user_context` (following the server instructions), listed the preference with its source, and picked a coriander-free saved recipe |
| Read it | Claude connector (Clerk OAuth) | `get_profile` returned it with `source` and `updated_at` |
| Correct it (to mushrooms) | OpenCode `propose_preference_correction` → approved in the app | Pending until approved; then a new row credited to OpenCode, old memory scope erased; SurrealDB recall for "coriander" no longer returns it |
| Use the correction | OpenCode, Claude `get_profile` | Only the mushroom version; no coriander |
| Delete it | App, with confirmation | Row and memory scope erased (no pending tombstone) |
| After deletion | SurrealDB recall, Claude `get_profile`, OpenCode `get_user_context` | Neither version returned; OpenCode suggested a mushroom risotto |
| Another user | Fictional user with its own token and preference, over `/mcp` + real SurrealDB | Saw only its own preference; every correct/remove of the owner's preference IDs (current and deleted) → "not found"; recall isolated both ways; cleaned up afterwards |
| Memory outage | Second backend with SurrealDB unreachable, OpenCode | `memory=unavailable`; OpenCode said memory couldn't be reached and the answer used only the profile and saved data |

Also live: the Coach's outage warning in the app (backend run with SurrealDB unreachable), and Claude's `get_profile`
over OAuth returning `memory.status: "ok"` with recalled preferences.

Automated only (`tests/test_user_context.py`, `tests/test_mcp.py`): topic detection, withholding unattributed memory
while an erase is pending, one-off requests refused/never suggested, stale corrections, the planner's memory facts and
outage note (the MCP tests authenticate with connection tokens). **Not verified**: Claude calling `get_user_context` or
the preference-change proposals. The Claude connector here still lists the 13 tools it fetched when it connected; it
needs a refresh (a new chat, or reconnecting BuildNorth in claude.ai's connector settings) before Claude can see the
new tools, and whether Claude calls them unprompted hasn't been observed. OpenCode called `get_user_context` in each of
5 runs here, which doesn't guarantee it always will.

OpenCode declares MCP approval prompts, but `opencode run` (non-interactive) can't answer them, so `apply_proposal`
times out there and nothing is applied; approve in the app instead. Whether the interactive OpenCode UI shows the
prompt wasn't tested.

## Apple Watch

A native SwiftUI watch app (watchOS 11+) inside the iPhone app. React Native and Expo don't run on watchOS, so the
watch UI is Swift; it shares only the backend API with the phone. It needs the iPhone **development build**: Expo Go
can't include a watch app or the WatchConnectivity module (the Profile screen says so and everything else keeps working).

How this and the Mac app were built, what was checked and what is still open: [docs/work-log.md](docs/work-log.md).

- **On the watch**: exactly two home options, **Sleep** and **Workout**. Plans, check-ins and general health
  settings are no longer part of the watch UI. Monitoring works locally after sign-in, including without internet.
  - **Sleep** shows the last night's asleep duration, first/last sleep times, available Core/Deep/REM/Awake
    durations, and a seven-night chart. Missing nights stay blank. Stage durations merge duplicates independently;
    different sources can overlap, so these aren't shown as parts of a single stacked total. Sleep is read from
    Apple Health after it is recorded; enable *Track Sleep with Apple Watch* on the phone and wear the watch to bed.
  - **Workout** starts a general (*Other*) HealthKit workout, showing live BPM, recent trend, average, peak and
    elapsed time. Pause/resume and end/save are inside this screen. It uses `workout-processing` background mode
    and continues when the wrist is lowered or the user returns home. An ended workout is saved to Apple Health;
    only its summary is uploaded. Stale readings show a dash after 30 seconds. Start a workout in BuildNorth to
    use live monitoring; it doesn't attach to another app's active workout. Force-quitting isn't supported for
    workout recovery. Signing out discards a workout still in progress.
- **On the phone**: sign in to BuildNorth, then Profile → **Apple Watch** → **Sign in Apple Watch**. The watch
  signs in when the hand-off arrives. Sharing, linked watches and uploaded summaries remain on the phone.
- **Health sync**: launch, foreground (at most every 10 minutes), Sleep → *Refresh*, and workout completion upload
  sleep minutes and workout summaries. The watch no longer requests resting HR, HRV, steps, distance or calories.
  Existing backend fields stay compatible and missing values are null. Detailed sleep stages and live heart-rate
  samples stay in Apple Health/on the watch; they aren't uploaded to BuildNorth.
  - Today is sent as `complete: false` (so far). The finished days since the last complete upload are sent as
    complete, capped at the newest 7, so recent days the app wasn't opened are filled in; older missed days are
    not sent. Yesterday is always sent again, so samples that reach Apple Health late still land. The first sync,
    and the first after the link changes, sends only yesterday and today.
  - Missing values are sent as `null`, never 0; sleep with no record for the night is `null`, not 0 minutes. Days
    with no data at all aren't sent.

### Linking and the watch token

1. Sign in on iPhone → Profile → *Apple Watch* → *Sign in Apple Watch*: the phone asks the backend for a **watch link token** (`bnw_…`,
   `POST /watch/tokens`, Clerk session required) and hands it, with the API URL, to the watch over WatchConnectivity
   (`updateApplicationContext`, delivered even if the watch app isn't running). The plaintext is never cached or
   stored by the app; iOS keeps the last hand-off until the next link or unlink.
2. The watch keeps the token in its own Keychain and calls the backend directly over HTTPS (no phone needed once
   linked). It works on the `/watch/*` data routes only; everywhere else, including `/mcp`, token management,
   settings and account deletion, it gets `401`. A `bnw_` token is refused at `/mcp` before any database or Clerk call.
3. Tokens last 90 days; up to 5 active per user. Each link gets its own label (e.g. *Apple Watch · Oct 21, 2:05 PM*),
   and the phone revokes the earlier links only once iOS has accepted the new one for delivery, so a hand-off that
   fails on the phone leaves the old link working. iOS doesn't confirm delivery: a watch out of range may be
   unlinked until the new link arrives. (The API also revokes an active token whose label a new one reuses.)
   *Unlink*, sign-out and *Delete all my data* revoke them; the watch clears its link when the backend answers
   `401` for its current token.
4. Only a SHA-256 hash and the last 4 characters are stored (`watch_tokens`), like assistant connection tokens.

| Route | Who | What |
|---|---|---|
| `POST/GET /watch/tokens`, `DELETE /watch/tokens[/{id}]` | phone (Clerk session) | mint (shown once), list, revoke one / all |
| `GET/PUT /watch/settings` | phone | `{"shareHealth": bool}` (off by default) |
| `GET /watch/today?date=` | watch or phone | plan items, check-in, that day's health summary, `shareHealth` |
| `PATCH /watch/plan/{id}` | watch or phone | `{"status": "planned"\|"done"\|"skipped"}` |
| `PATCH /watch/checkins/{date}` | watch or phone | merge: only the fields sent change (a new day needs energy and mood) |
| `PUT /watch/health/{date}` | watch | upsert the day's summary (idempotent) |
| `GET /watch/health?end=&days=` | watch or phone | stored summaries, oldest first (1–31 days) |

### What agents can use (SurrealDB Agent Memory, Coach, MCP)

- **Sharing is opt-in** (`profiles.share_health`, off by default; the phone screen explains what it shares). Turned
  off: summaries are still stored and shown to you and the watch, but nothing reaches memory, the Coach or assistants.
- **SQL is authoritative**: `health_days` (one row per user and local date, migration `0005`). Agents read the numbers
  from SQL: `get_user_context` (`health`: the 7 days `health_start`..`health_end`, ending at the end of `week_of`'s
  week or on `local_date`, whichever is earlier), the Coach's `<health_summary>` block, and the MCP tool
  `get_health_summary`. Days without a summary are reported as missing, not zero. Everything is framed as
  device-measured context, never medical advice.
- **Agent Memory mirror**: when sharing is on and a day is complete, one deterministic sentence (≤ 500 characters) is
  written under `<user>/health/<revision>`, e.g. *"Apple Watch daily summary for 2026-10-20 (device-measured): slept
  6 h 52 min; resting heart rate 58 bpm; HRV 42 ms; 8,412 steps; 510 kcal active energy; workouts: 32 min running."*
  - Every changed sentence gets a new revision scope, and the old one is erased first, so recall never sees two
    versions of a day.
  - Memory work happens after the SQL commit and never fails a watch request. On an outage the day stays `pending`
    and is retried wherever preferences are retried (Coach messages, the planner, *Saved preferences*); a watch
    upload retries only the day it uploads.
  - The existing `<user>/*` lens recalls it, so any agent that recalls memory sees it without new code.
- **Turning sharing off** erases the whole `<user>/health` subtree in one call (registered first, so it never targets
  an unknown scope), or leaves one tombstone that is retried before anything new is written. Nothing is called when
  nothing was ever mirrored.
- **Erasing**: *Erase memory* (`DELETE /memory`) removes the mirror and marks every day not mirrored; *Delete all my
  data* removes `health_days` and `watch_tokens` as well (they're in `USER_TABLES`).
- Code: `backend/app/routers/watch.py`, `health.py` (summaries, memory sentence, mirror), `deps.py` (`watch_user`),
  `mcp_auth.py` (token prefix), `memory.py` (`health_scope`, `forget_health`), `user_context.py`, `mcp_server.py`;
  tests in `backend/tests/test_watch.py` (plus `test_mcp.py`, `test_units.py`). `scripts/live_check.py` has a health
  step against the real Agent Memory.

### Building and running

The iOS project is generated (`ios/`, git-ignored); the watch target comes from `targets/watch/` through
`@bacons/apple-targets` (bundle ID `com.arjun273773.buildnorth.watch`, HealthKit entitlement), and the phone module
from `modules/watch-connectivity/`.

```bash
EXPO_NO_GIT_STATUS=1 npx expo prebuild -p ios --clean --no-install
```

```bash
cd ios && pod install
```

```bash
npx expo start
```

```bash
npx expo run:ios --device "iPhone 17" --no-bundler
```

1. Prebuild regenerates `ios/`; then install the Pods (CocoaPods needs a UTF-8 locale: macOS Terminal sets one, other
   shells may need `export LANG=en_US.UTF-8`). Rerun both after changing `app.json`, a config plugin or
   `targets/watch/expo-target.config.js`; Swift changes in `targets/watch/` need only `run:ios` (the target is a
   synchronized folder).
2. `run:ios` builds the iPhone app with the watch app embedded and opens it on the simulator, using the Metro you
   started. Without Metro running, the Debug app shows "No script URL provided".

Until 21 Oct 2026 the project lived on an iCloud-synced Desktop, in a path with spaces and a curly apostrophe, and
needed two `patch-package` patches, a config plugin and `*.nosync` folders to build. Here, in `~/Developer`, none of
that is needed (see [docs/work-log.md](docs/work-log.md)).

**Simulators**
1. Pair a watch with an iPhone once: `xcrun simctl pair <watch-udid> <iphone-udid>`.
2. Installing the iPhone app doesn't install the watch app on a simulator, so install it from the build output:
   `xcrun simctl install <watch-udid> ~/Library/Developer/Xcode/DerivedData/BuildNorth-*/Build/Products/Debug-watchsimulator/watch.app`.
3. In Debug builds, the watch can be linked without the phone. Launch it with
   `SIMCTL_CHILD_BN_API_URL=http://127.0.0.1:8000 SIMCTL_CHILD_BN_WATCH_TOKEN=<bnw_ token> xcrun simctl launch <watch-udid> com.arjun273773.buildnorth.watch`.
4. The watch simulator has no sensors and no Health app. In Debug, *Sleep → Add sample sleep* can save sample nights. Live heart-rate sensors require a real watch.

Keep simulator signing enabled when building the watch separately. An unsigned build can launch but fail to
save the phone link in Keychain (`-34018`). See the [signed build command and recovery notes](docs/watch-ui-validation-2026-10-25.md#supplied-simulator-binary-could-not-save-the-link).

**A real watch and iPhone** need:
- `ios.appleTeamId` in `app.json` (Expo picked team `TJ6V35S7GQ` automatically for the simulator build)
- HealthKit enabled on both App IDs
- the backend on public HTTPS (`EXPO_PUBLIC_API_URL`; the link sends that URL to the watch)
- for TestFlight or the App Store, matching version and build numbers on the watch target

Real watches block WebSockets, so the watch uses plain HTTPS requests only.

**Checks**: `cd backend && .venv/bin/python -m pytest -q`, `bash scripts/check-watch-models.sh` (encodes and decodes
the watch's JSON against the contract and typechecks `targets/watch` for watchOS), `npx tsc --noEmit && npx expo lint`.

### UI validation (2026-10-25)

Computer Use on the paired iPhone 17 / Apple Watch Series 12 simulators verified phone-to-watch sign-in,
the two-option home, sleep permissions and empty state, fictional sleep duration/stages/seven-night history,
workout timing and pause/resume, navigation persistence, end/save, and phone summary sync. AI health sharing
stayed off, and the watch was left home with no active workout. Lint, typecheck and 174 watch model checks
passed, including watchOS typechecking. The supplied watch binary's signing issue and a simulator service
stall were resolved before completing the run.

See the [dated validation report and screenshots](docs/watch-ui-validation-2026-10-25.md) for observed values,
reproduction commands, recovery details and the distinction between simulator readings and physical sensors.
The UI evidence is for `d843a88`, before the later Rhythm branding integration.

### Earlier automated and API verification (2026-10-21)

- **Automated checks:**
  - Backend: 234 tests pass, 54 of them in `test_watch.py`. They cover the token rules, cross-user isolation, the
    check-in merge, idempotent uploads, the mirror only when sharing is on and the day is complete, revision erase,
    outages becoming pending then synced, writes landing while sharing is turned off, sharing off and on, no database
    write lock held while waiting on memory, the MCP tool and deletion.
  - Watch: 156 JSON/model checks pass (including the sleep window, the backfill of missed days and the request
    timeouts), and it typechecks for watchOS 11.
  - Phone: typecheck and lint pass; 17 Node tests pass (linking, consent text, the on-device cache policy).
- **iOS build:** from a clean prebuild in `~/Developer/BuildNorth/mobile` (the steps above, no workarounds), the iPhone
  development build with the embedded watch app built for the simulator (0 errors, 0 warnings) and opened on an
  iPhone 17 simulator paired with an Apple Watch Series 12 simulator.
- **The watch app against a scratch backend** (its own SQLite file, memory and AI off, a fictional user):
  - Launched with a test link, it called `GET /watch/today` (200, today's local date).
  - Over HTTP with the same `bnw_` token:
    - The token was refused at `/profile` and `/mcp` (401).
    - A plan item was marked done.
    - A check-in, then a sleep-only update, kept energy and mood.
    - A complete health day with a workout was stored (`pending` for memory, which was off), and a partial day
      for today was stored and not mirrored.
  - As an MCP client with an assistant token, `get_health_summary` returned both days (with 5 missing days), and
    `get_user_context` ("How did I sleep and recover this week?") detected the *health* topic and included them.
  - Rerun after the final fixes and again after the move to `~/Developer`, each time from a clean prebuild and a
    fresh scratch database: same results.
- **Not covered in that run:** the watch UI and phone-to-watch linking (subsequently exercised on 25 October,
  above). Real Apple Health data and a physical watch remain unverified.
  - Running `scripts/live_check.py` against the real SurrealDB Agent Memory.

## Setup

1. **Clerk** (application `app_3KlYX36WOns22NyXoLe1Xz9ZRcC`): enable the Native API under *Native applications* and
   email + password sign-in.
2. **App env**: `.env` (see `.env.example`) — only `EXPO_PUBLIC_*` values, which are public and bundled:
   - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (required)
   - `EXPO_PUBLIC_API_URL` (optional; default: the machine running Metro, port 8000)
3. **Backend env**: `backend/.env` (see `backend/.env.example`) — server-only, never commit:
   - `SPECTRON_URL`, `SPECTRON_CONTEXT_ID`, `SPECTRON_API_KEY` — SurrealDB Agent Memory (context *ID*, not its display name)
   - `SPECTRON_OWNER_USER_ID` — explicitly binds that Context to one Clerk account, including Rhythm;
     other accounts need their own configured Context bindings (see [Rhythm setup](docs/rhythm.md))
   - `CLERK_PUBLISHABLE_KEY` — same public key; locates Clerk's JWKS for token verification
   - `AI_PROVIDER` = `ollama` | `openai` | `anthropic` | `none`, plus `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_TIMEOUT_SECONDS`
   - `DATABASE_URL` (default: SQLite in `backend/var/`, git-ignored), `AUTO_MIGRATE` (default `true`)
4. **AI (local, free)**: install [Ollama](https://ollama.com) and `ollama pull gemma3:4b`; then `AI_PROVIDER=ollama`,
   `AI_MODEL=gemma3:4b`. Expect 40–60 s per reply on an M3/16 GB Mac. For faster replies use `AI_PROVIDER=anthropic`
   with an API key (default model `claude-opus-5-5`) or any OpenAI-compatible endpoint.
5. Install:

   ```bash
   npm install
   ```

   ```bash
   cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   ```

   Use Node 20.19 or newer (tested with 23.5); Node 16 breaks `expo lint` and the Node tests.

## Run

```bash
cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```bash
npx expo start
```

Open in Expo Go (scan the QR code; phone on the same Wi-Fi) or press `i` for the iOS Simulator. Everything except the
Apple Watch runs in Expo Go; the watch needs the iPhone development build (see *Apple Watch → Building and running*).
The backend applies database migrations on startup.

### Android (Android Studio)

Android uses the same app code, backend and sign-in as iOS. What's different:

| | Android | iOS |
|---|---|---|
| App ID | `android.package` = `com.arjun273773.buildnorth` in `app.json` | `ios.bundleIdentifier`, same value |
| Native project | `android/`, generated by `npx expo prebuild -p android`; git-ignored | `ios/`, the same way |
| Build tools | Gradle, with Android Studio's SDK (`~/Library/Android/sdk`) and bundled JDK | Xcode + CocoaPods (`pod install`) |
| Apple Watch | Not available: no watch target; the `watch-connectivity` module is iOS-only (`platforms: ["ios"]`) and reports *unavailable*; Profile hides the Apple Watch entry | Watch target in `targets/watch/` (`@bacons/apple-targets`) |
| Health data | Not collected on Android (no Health Connect integration yet) | HealthKit, through the watch |
| `expo-build-properties` | Not used | Enables iOS scene support |

**Build**

```bash
npx expo prebuild --platform android --no-install
```

Then open `android/` in Android Studio (File → Open) and press Run, or from the terminal (Android Studio's SDK and JDK
aren't on the PATH by default):

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk" JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npx expo run:android --no-bundler
```

The first Gradle build takes about 15 minutes. The debug build loads its JavaScript from Metro (`npx expo start`) and
reaches the backend at `EXPO_PUBLIC_API_URL`, exactly like iOS. Rebuild with Gradle only after native changes (new
native packages, `app.json` or plugins); JavaScript changes just need Metro.

**Verified on Android:** a Gradle debug build of `com.arjun273773.buildnorth` installs and opens the sign-in screen
(Android 17 / API 37). Not yet verified on Android: signing in and the screens after it, a release build, a physical
Android phone.

### On a physical iPhone (any network)

The simulator reaches the backend at `localhost`; a phone can't. Expose both halves publicly:

1. Backend: the ngrok agent endpoint, `ngrok http 8000 --url https://<your-domain>.ngrok-free.dev`, and in the app's
   `.env` set `EXPO_PUBLIC_API_URL=https://<your-domain>.ngrok-free.dev` (it's bundled into the app, so restart Metro
   after changing it).
2. App bundle: `npm i -g @expo/ngrok` once, then `npx expo start --tunnel` (Expo's own tunnel, `*.exp.direct`).
3. On the iPhone: install **Expo Go** from the App Store, sign in to Expo Go with the same Expo account as
   `npx expo whoami` (required for physical iOS devices), then scan the QR code with the Camera app.

Tested in the simulator over both public tunnels: sign-in persisted, preference saved, Coach reply checked memory
("Memory checked · used 2 saved preferences (2 recalled)"), an assistant's plan change approved and a second one
rejected (plan unchanged), app relaunched and the approved lunch was still there. Not yet run on a physical iPhone.

### Mac app (separate project)

A native macOS version lives next to this app, in `../mac/` (`~/Developer/BuildNorth/mac`). Its README
(`mac/README.md`) has the full setup, build, EAS and troubleshooting notes.

- **Stack:** React Native for macOS 0.83 (`react-native-macos`) with parts of Expo SDK 55. That means Expo CLI for
  the dev server and bundling, `expo-sqlite`, `expo-crypto`, `expo-constants`, and a local Swift Expo module for the
  Dock badge, keep-awake and SF Symbols. Xcode does the build.
- **UI:** mirrors this app: same sections, design tokens, components and API types, with a sidebar instead of tabs.
- **Status:** runs on sample data saved on the Mac. It isn't connected to this backend yet (no Clerk sign-in on
  macOS). So the Coach can't reply (its message box is disabled), and features that need the backend aren't
  there: "Help plan my week", plan changes in your own words, and approving assistants' plan changes.
- **Apart from this section, nothing in this repo was changed for it.** Its code is ported from here, not shared, so
  changes to the iPhone app don't reach the Mac app.

Run it with the dev server on port 8090, so it doesn't clash with this app's Metro:

```bash
cd ~/Developer/BuildNorth/mac && npm start
```

```bash
cd ~/Developer/BuildNorth/mac && npm run macos
```

Build it in the cloud with an EAS Build custom build. EAS has no macOS platform, so it runs as an iOS-platform job
without credentials, on project `@arjun273773/northassistant`. Then download the `.app`:

```bash
cd ~/Developer/BuildNorth/mac && EAS_NO_VCS=1 npx eas-cli@latest build -p ios -e macos
```

```bash
cd ~/Developer/BuildNorth/mac && EAS_NO_VCS=1 npx eas-cli@latest build:download --build-id <id> --all-artifacts
```

Each EAS build most likely uses one of the Free plan's 15 monthly iOS builds. Apps are signed ad hoc and not
notarized, so a copy downloaded in a browser or sent by AirDrop is blocked until you choose *Open Anyway* in Privacy
& Security.

## Checks

```bash
npx tsc --noEmit && npx expo lint
```

```bash
node --experimental-strip-types --test src/lib/*.test.mjs
```

```bash
bash scripts/check-watch-models.sh
```

```bash
cd backend && .venv/bin/python -m pytest -q
```

```bash
cd backend && .venv/bin/python -m scripts.live_check
```

- `pytest`: real migrated SQLite per test, mocked Clerk keys, fake Agent Memory and fake AI. Covers token
  rejection, cross-user isolation (404 on another user's records), server-derived scopes, preference correction and
  erase, memory outages, AI failures, shopping-list unit rules, sessions/plan/progress, data deletion, and the planner
  (grounding, validation, fill, idempotent accept/apply, rule-based and model changes, temporary vs lasting,
  unavailable AI, weekly review), `tests/test_mcp.py`: the MCP endpoint over real HTTP with the official MCP client,
  and `tests/test_user_context.py`: the shared user context (Coach prompt contents, outages, isolation, one-off vs lasting).
- `live_check`: real Clerk JWKS, real Agent Memory (fictional users save → recall → isolation → correction → erase) and
  the configured AI provider (recipe extraction with an injection attempt, a preference-aware coach reply).

## Production notes

- Database: set `DATABASE_URL` to Postgres (install its driver, e.g. `psycopg[binary]`), run
  `cd backend && .venv/bin/alembic upgrade head` on deploy and set `AUTO_MIGRATE=false`.
- Use a Clerk production instance (`pk_live_…`) and register the app's bundle identifier/package.
- Mint a SurrealDB Agent Memory key limited to `memory:read`, `memory:write`, `memory:forget` and `scope:create` on
  `buildnorth/*` instead of an admin key.
- Serve the API over HTTPS and set `EXPO_PUBLIC_API_URL`.

## Camera workouts on the website

The website's **Camera workout** navigation item embeds the local pose coach. Finish and save records counted
sets in Activity with the signed-in account. Named movements, holds, technique results and Mistakes stay in the
pose page. Native applications have no camera-coach entry point. See [the integration guide](docs/pose-coach.md).

## Later phases (not built yet — no placeholder buttons in the app)

Integration boundaries already in place: all model calls go through `backend/app/ai.py` (`AIProvider.generate_json`),
memory through `backend/app/memory.py`, and app records through REST endpoints, so new capabilities plug in on the
backend without changing core screens.

| Capability | Boundary / approach | What's needed |
|---|---|---|
| Voice input & spoken replies | New `/coach/voice` endpoint: speech-to-text → existing coach → text-to-speech | `expo-audio` (works in Expo Go) + an STT/TTS provider (none configured) |
| Recorded exercise analysis | Upload clip → backend job → results saved alongside an activity session | `expo-camera`/`expo-image-picker`; a pose-estimation model for *measured* joint angles/reps, kept separate from any language-model *interpretation*; confidence + "poor camera view" handling |
| Live coaching (real-time A/V) | Separate streaming service; core screens don't depend on it | A low-latency model endpoint (none available; MiniCPM isn't installed locally) and a WebRTC transport. No live-performance claims until measured |
| SMPL-X bodies / Blender characters | Export from Blender 5.2.2 (installed) as glTF; render with `expo-gl` + three.js (a development build is likely needed) | SMPL-X requires registering for its research licence (non-commercial terms); no SMPL-X or character assets exist in this repo yet |

Local hardware checked: Apple M3, 16 GB RAM. Local models available through Ollama: gemma3:4b (vision-capable),
gemma3n, qwen3 (0.6b–4b), mistral. No paid GPU services are provisioned.
