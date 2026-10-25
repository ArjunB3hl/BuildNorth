# Rhythm for Chrome

Rhythm is a Chrome side panel that helps you choose YouTube videos worth your time, using interests it learns from your
activity. You don't type them in. Once you turn learning on, the backend works them out from the fitness, health and food
videos you watch, your coach chats and your feedback, and applies them to your profile. Learned interests are stored in
the backend and aren't listed in the apps or the panel; the panel only asks you about a newly learned one. On any
YouTube video you can also choose **Save to Rhythm** or **Not interested**, with or without learning. You pick one video
page at a time. Rhythm checks it against your interests, and then you, or an AI agent you connect, can evaluate it,
search for similar videos, read its displayed transcript and keep recommendations. Kept recommendations also appear on
the phone and web dashboard.

The web companion, cookie behavior and verification limits are documented in the
[web implementation guide](../mobile/docs/web-app.md).

**Saved video notes:** **Save to Rhythm** keeps the original video title, channel and YouTube link in
**Content library → Saved videos** on the website and phone. When YouTube supplies a transcript, the backend uses
your connected Claude key or its configured AI to prepare useful notes: ingredients and cooking instructions,
exercise steps and form cues, or practical takeaways for other content. Missing details are called out. Without a
transcript it saves the link and metadata; without working AI you can retry **Generate summary** in the library.
Existing saved videos and summaries also appear there, even while recommendations are off. Migration `0012` is
required (normally applied on backend startup). The extension itself never receives the AI key.

**Status:** it builds, loads in Chrome and passes its checks. Signing in to the panel, turning on learning and the full
journey from phone to panel to agent haven't been completed with a real account yet (see *What was tested*).

| | |
|---|---|
| Folder | `extension/` in the BuildNorth repository |
| Extension | "Rhythm — your interests, your videos", version 0.1.0, Manifest V3, Chrome 116 or later |
| Stack | WXT 0.21.4, React 19.2.3, TypeScript 6.0, `@clerk/chrome-extension` 3.1.97 |
| Backend | The BuildNorth FastAPI server in `mobile/backend/`: REST routes under `/rhythm/…` (code in `app/rhythm/`), and MCP for agents at `/rhythm/mcp` |
| Sign-in | The BuildNorth website's Clerk sign-in, shared with the panel and service worker through Clerk's Sync Host. Email and password in the panel as a fallback. The same Clerk account as the phone app |
| Sites | YouTube watch pages only (`https://www.youtube.com/watch?v=…`). Learning needs an optional YouTube permission, which Chrome asks for when you turn it on |
| Tests | Playwright 1.64.1 with its own Chromium |

This README covers the extension. The backend's contracts, limits, retention rules, memory and MCP tools are in the
integration guide, [mobile/docs/rhythm.md](../mobile/docs/rhythm.md).

## How it fits together

```
Phone or web app ── Profile → Interests & sharing / Content library ──▶ backend /rhythm/*    (switches, agent approvals)
Coach chats, recommendation feedback ────────────────────────────────▶ backend              (learning evidence, with learning on)

Chrome side panel ── Clerk session token ─────────────────────────────▶ backend /rhythm/*    (learning switch, choices, reactions, page grants, tasks, …)
   │ activeTab + scripting: one tab, after a toolbar click (or the optional YouTube permission, for Save to Rhythm)
   ▼
YouTube watch page (read in Chrome's isolated world)
   ▲
   │ optional YouTube permission + alarms: a playback check every 30 s while a video is open, with learning on
Service worker ── matching videos only, after a minute played in view ─▶ backend /rhythm/signals

Your agent (Claude Code, ChatGPT, …) ── bnr_ token or OAuth ──▶ backend /rhythm/mcp
```

- **Your account is in charge, and learns.** The backend learns your interests from the activity you allow and applies
  them to your profile automatically. Nobody types them in, and neither the apps nor the panel list them. The consent
  switches and agent approvals are set in the phone or web app; the panel's switch changes only learning.
- **Learning is opt-in.** It's off until you turn it on. In this browser it also needs an optional YouTube permission
  that Chrome asks you for, and only fitness, health and food videos ever leave the browser. A video counts only once
  you've actually watched a minute of it with its tab in view. Turning learning off removes the permission and deletes
  the videos the backend kept.
- **Your own choices come first.** *Save to Rhythm*, *Not interested* and your answers to the panel's question are
  explicit, so they work with learning off, and the backend puts them ahead of anything it infers.
- **The panel grants pages.** Rhythm can read a tab for you only after you click its toolbar icon on that tab, and then
  only that video's details and, for a task you allow, its displayed transcript.
- **Agents never talk to the extension.** An agent uses Rhythm's MCP tools on the backend, with its own model and
  credentials. The panel and the agent work on the same tasks and recommendations through the backend.
- **No model runs in the extension.** Screening, and learning's check on this device, are word-list matches. When the
  backend has an AI provider configured, its learning can also ask that model to read watched titles and your coach
  messages (see *Permissions and privacy*). Explicitly saved transcripts can also use the backend AI for library notes;
  recommendation tasks use the agent you connect.

## Requirements

- **Node.js 22 or later** (23.5 used here) and npm.
- **Chrome 116 or later**, with Developer mode on to load an unpacked extension.
- **The BuildNorth backend** running with migrations `0006` (`migrations/versions/0006_rhythm.py`), `0007`
  (`0007_rhythm_learning.py`) and `0008` (`0008_rhythm_engagement.py`, for played seconds and reactions) applied.
  The backend applies migrations on startup unless `AUTO_MIGRATE=false`; see [mobile/README.md](../mobile/README.md)
  for its setup.
- **A BuildNorth account, and the website running** (`npm run web` in `mobile/`, at `WXT_WEB_APP_URL`). You sign in,
  or sign up, on the website and the panel uses that sign-in (see *Sign in to the panel*). The panel itself has no
  sign-up link.
- **The extension's origin in Clerk's `allowed_origins`**, as Clerk's Sync Host requires (see *Extension ID, Clerk and
  other backends*).
- **Learning turned on**, with the panel's switch (see *Using Rhythm*). Choosing pages and starting tasks need a profile
  Rhythm has learned: at least one topic and one purpose, with YouTube and page details allowed. Turning learning on in
  the panel allows both.
- **Optional:** `YOUTUBE_API_KEY` in `mobile/backend/.env` for *Find videos*. Evaluating the page you're on works
  without it.

## Setup

```bash
cd ~/Developer/BuildNorth/extension
npm ci
```

`npm ci` also runs `wxt prepare` (the `postinstall` script), which generates `.wxt/` with the TypeScript config the
project extends.

The extension imports two files from the rest of the repository, so it only builds inside it:
- `../mobile/src/lib/rhythm.ts`: the types and API client, shared with the phone app
- `../mobile/backend/app/rhythm/relevance-rules.json`: the screening vocabulary, shared with the backend

### Configuration

All settings are read at build time and compiled into the extension, so anyone who has the extension can see them. Put
only public values here. YouTube keys, model keys, the Clerk secret key, memory keys and `bnr_` connection tokens never
belong in the extension.

| Variable | Default | What it does |
|---|---|---|
| `WXT_API_URL` | `http://localhost:8000` | The backend. Every request goes here, and its origin is the extension's only backend host permission. Must be HTTPS unless it's `localhost` or `127.0.0.1`, and must not contain a user name or password |
| `WXT_CLERK_PUBLISHABLE_KEY` | none (required) | The Clerk publishable key, the same value as the phone's `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| `WXT_CLERK_FRONTEND_API` | none | The Clerk Frontend API origin (for example `https://casual-rabbit-7268.clerk.accounts.dev`), added to the host permissions for Clerk's SDK. `build:local` derives it from the key |
| `WXT_CRX_PUBLIC_KEY` | empty | Public key written to the manifest's `key`, which fixes the extension ID. Recommended, since Clerk's `allowed_origins` names the ID (see *Extension ID, Clerk and other backends*) |
| `WXT_PROFILE_URL` | `buildnorth://profile/interests` | Where the panel's *Open profile ↗* link goes. The default is the phone app's deep link |
| `WXT_WEB_APP_URL` | `http://localhost:8081` | Web dashboard origin; the panel links to its overview (*Open web dashboard ↗*), to `/profile/interests` (*Rhythm settings ↗*) and, when signed out, to `/sign-in`. HTTPS except on localhost. No cookies or tokens are passed in these links |
| `WXT_CLERK_SYNC_HOST` | derived | Where Clerk reads the website's sign-in (Clerk's [Sync Host](https://clerk.com/docs/guides/sessions/sync-host)), added to the host permissions. Empty means: the web app's host without its port for a development key (`http://localhost` for `http://localhost:8081`), or the Clerk Frontend API for a live key. HTTPS unless it's `localhost` or `127.0.0.1` |

For anything other than the defaults, create `extension/.env` from the template (`.env` files are git-ignored):

```bash
cp .env.example .env
```

## Build and load

### Build

```bash
npm run build:local
```

`build:local` (`scripts/build-local.mjs`) runs `npm run build` with these values, taking the first one it finds:

| Value | Taken from |
|---|---|
| Clerk publishable key | `WXT_CLERK_PUBLISHABLE_KEY` in the shell, then `extension/.env`, then `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `mobile/.env` |
| Clerk Frontend API | the shell, then `extension/.env`, then decoded from the publishable key |
| Backend URL | the shell, then `extension/.env`, then `http://localhost:8000` |
| Sync host | the shell, then `extension/.env`, then derived from the web app URL as described above |

It reads only the public key from `mobile/.env` and prints nothing from it. If no key is found, it stops with
"Configure the public Clerk key in extension/.env or mobile/.env."

The plain WXT build uses only `extension/.env` and the shell, with none of those fallbacks:

```bash
npm run build
```

Both write the unpacked extension to `.output/chrome-mv3/` (about 3 MB, mostly Clerk's sign-in UI). A build without a
publishable key still succeeds, but the panel then shows only "Finish the local setup to sign in."

### Load it in Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select `extension/.output/chrome-mv3`.
3. Pin Rhythm to the toolbar. It has no icon yet, so Chrome shows its generic placeholder.

After each rebuild, click the reload button on Rhythm's card in `chrome://extensions`. Settings are compiled in, so a
changed `.env` needs a rebuild and a reload.

### Development mode

```bash
npm run dev
```

WXT's dev mode builds a development copy, opens Chrome with it loaded by default, and rebuilds on save. It reads
`extension/.env` and the shell only, so create `.env` with the Clerk values first.

### Extension ID, Clerk and other backends

- **Extension ID.** Without `WXT_CRX_PUBLIC_KEY`, Chrome derives an unpacked extension's ID from its folder path. The ID
  changes if the folder moves or the extension is loaded on another Mac. Clerk's docs warn that a changing ID can break
  its integration ([consistent CRX ID guide](https://clerk.com/docs/guides/development/configure-consistent-crx-id)).
  Set the key to fix the ID. Any RSA key will do; only its public half goes in `extension/.env`:

  ```bash
  echo "WXT_CRX_PUBLIC_KEY=$(openssl genrsa 2048 2>/dev/null | openssl rsa -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')" >> .env
  ```

  The ID is then the first 32 hex digits of the key's SHA-256, written with the letters `a`–`p`, and Chrome shows it on
  Rhythm's card in `chrome://extensions`. Changing the key changes the ID: remove Rhythm in `chrome://extensions` and
  load it again (this resets its learning switch on this browser), and update `allowed_origins`. A Chrome Web Store
  listing has its own key, shown in the developer dashboard; use that one there.
- **Allowed origins.** Clerk's Sync Host needs `chrome-extension://<extension id>` in the Clerk instance's
  `allowed_origins`. Clerk's guide sets it through the Backend API, with the instance's secret key. Read the current list
  first, then send it back with the extension's origin added, since the update replaces the list. From the repository
  root, with `CLERK_SECRET_KEY` in `mobile/backend/.env`:

  ```bash
  SECRET=$(grep -E '^CLERK_SECRET_KEY=' mobile/backend/.env | cut -d= -f2- | tr -d "\"'")
  curl -s -H "Authorization: Bearer $SECRET" https://api.clerk.com/v1/instance
  curl -s -X PATCH -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' \
    -d '{"allowed_origins": ["<every origin already listed>", "chrome-extension://<extension id>"]}' \
    https://api.clerk.com/v1/instance
  ```

  Read the list again to check it. Repeat this whenever the extension ID changes.
- **Authorized parties.** If the backend sets `CLERK_AUTHORIZED_PARTIES`, it must list both the website's origin
  (`http://localhost:8081`) and `chrome-extension://<extension id>`. Otherwise the backend rejects one of them.
- **Sign-in methods.** On the website you can use any sign-in method the Clerk instance offers, Google included; the
  panel then uses that sign-in. Clerk doesn't support OAuth or social sign-in inside an extension's side panel, so the
  panel's own email and password form hides those buttons
  ([Clerk Chrome extension overview](https://clerk.com/docs/reference/chrome-extension/overview)).
- **Same backend as the phone.** The phone and the panel must use the same backend, or the panel won't see your
  settings or what Rhythm learned. For a backend that isn't on this Mac, set `WXT_API_URL` to its HTTPS address, rebuild, and set the phone's
  `EXPO_PUBLIC_API_URL` to match.

## Using Rhythm

> **Recommendations are turned off for now.** The panel shows only *Your interests* (learning), *Rhythm noticed* and
> *This video* (*Save to Rhythm*, *Not interested*). Choosing a page, tasks, *Worth your time* and the counters are
> hidden, and the backend refuses them. To turn them back on, set `RHYTHM_RECOMMENDATIONS=on` in
> `mobile/backend/.env` and restart the backend, set `RECOMMENDATIONS_ENABLED = true` in `mobile/src/lib/rhythm.ts`,
> then rebuild the extension (`npm run build:local`) and reload the apps. The table and steps 5 to 9 below describe the
> full panel.

### The panel, top to bottom

| Part | What it shows | What you can do |
|---|---|---|
| Header | The Rhythm name with the AI orb, and your Clerk account button. The panel follows your system's light or dark mode | Manage the account, sign out |
| *Your interests* | Whether Rhythm is learning: *Learning from your activity*, *Still learning…* until something has been learned, or an invitation to turn it on. It never lists your interests | The learning switch, *Rhythm settings ↗*, *Open profile ↗*, *Open web dashboard ↗* |
| *Rhythm noticed* (only when the backend has a question) | One newly learned interest, as a question, for example "You've watched 2 beginner boxing videos recently. Want more boxing drills and technique videos?" | *Yes*, *Not interested*, *Forget this* |
| *This video* | The result of your last choice on the video in the active tab | *Save to Rhythm*, *Not interested* |
| *One page. Your permission.* | What Rhythm reads from a page | The transcript checkbox, *Use this page*, *Pause*, *What is shared* |
| Status line | The latest message | |
| Page decision | The video title; *Matches your interests*, *Not enough information* or *Outside your interests*; the reasons; *Missing information* | |
| *Start with a question* | A question box, *Who will help?*, the transcript-analysis checkbox | *Evaluate this video*, *Find videos* |
| *Your agent is asking* (only when there are requests) | Tasks an agent proposed | *Start this task*, *Decline* |
| Current task | A task picker, its counters and candidates | *Attach this permitted page*, *Stop task*, actions on each candidate |
| *Worth your time* | Your latest 60 recommendations | *Save* or *Unsave*, *Helpful*, *Dismiss* or *Undo dismissal*, *Show saved videos only* |
| Footer | Pages screened on this device this session, and today's server counters | |

The panel refreshes its data every 8 seconds while it's open. It asks for the *Rhythm noticed* question when it opens,
and again after each *Save to Rhythm*, *Not interested* or answer.

### 1. Sign in to the panel

The panel uses the BuildNorth website's sign-in, through Clerk's
[Sync Host](https://clerk.com/docs/guides/sessions/sync-host). Its Clerk reads the website's Clerk cookie on the sync
host (`http://localhost` for the local website), so it is signed in to whichever account the website is, and the
service worker's learning uses that account too.

1. Click Rhythm's toolbar icon to open the panel.
2. Signed out, it shows **Sign in on the BuildNorth website**. That opens the website's sign-in page (`/sign-in` on
   `WXT_WEB_APP_URL`) in a new tab; if you're already signed in there, the website shows your overview instead.
3. Sign in on the website, with any method it offers.
4. Back in the panel, it signs in by itself within a second or so. If it doesn't, close the panel and open it again.

Clerk's own Sync Host doesn't refresh side panels, so the panel watches the website's Clerk cookies
(`lib/website-sign-in.ts`) and reloads itself when the website's sign-in differs from its own:

| On the website | In the panel |
|---|---|
| Sign in | Signs in to the same account |
| Sign out | Signs out |
| Switch to another account | Reloads with that account. Learning stops sending until that account turns it on in this browser |
| Nothing changes, or the website refreshes its session | Nothing; the panel doesn't reload |

The website and the panel share one sign-in, so **signing out in the panel (its account menu) signs you out of the
website too**, which notices the next time it checks with Clerk or is reloaded.

**Fallback:** *Sign in here with email and password* opens Clerk's form in the panel. That sign-in is shared with the
website as well, once the website has been opened in this browser at least once. Before that, it stays in the panel,
until the website is opened; from then on the website's sign-in wins.

### 2. Turn on learning

Rhythm doesn't ask you to type in your interests. It learns them and applies them to your profile, and the panel shows
only whether it's learning.

1. In the top card, turn on **Learn my interests from the fitness videos I watch**.
2. Chrome asks whether Rhythm may read and change your data on www.youtube.com. Choose **Allow**. If you decline,
   nothing changes and learning stays off.
3. The panel turns learning on for your account. This also allows YouTube page details, which *Use this page* needs.
   It then remembers, on this browser and for this account only, that you turned it on.

The card now says *Learning from your activity*, and *Still learning…* until Rhythm has learned something. Learning
also uses your coach chats and the recommendations you save or mark helpful. The panel's link *Rhythm settings ↗* opens
the web app's settings.

While learning is on and you're signed in, Rhythm counts how much of a YouTube video actually plays while its tab is in
view. Ads, parts you skip, a paused video and a video playing in a background tab don't count. Once a minute has played
(40% of a video shorter than two and a half minutes), Rhythm checks the video on this computer. It sends the video, with
the seconds you watched, only if it's a workout, martial arts, exercise, health or cooking video. Nothing else leaves the
browser (see *Learning from watched videos*). Learning never opens, clicks or scrolls anything on the page. If you already
opened the video's transcript, up to 60 of its lines go along with the video. When you move on from a video Rhythm sent,
it sends the total once more if you watched at least another minute, so a video you watched to the end counts for more
than one you sampled.

**Turning it off.** Turn the switch off. Rhythm stops at once in this browser, gives up its YouTube permission, and
turns learning off for your account, including learning from your coach chats and feedback. The backend then deletes
the videos it kept. What Rhythm learned so far stays in
your profile.

**When the account and the browser disagree.** The card then says what it sees:
- *Learning from videos is on for your account, but this browser isn't sharing what you watch*: for example, the
  YouTube permission was removed in Chrome, or learning was turned on from another browser or account. Turn the switch
  on, or choose *turn learning off*.
- *Learning from videos is off for your account, so nothing is sent, but Chrome still lets Rhythm see YouTube pages*:
  for example, learning was turned off on the phone. The first video Rhythm then tries to send is refused, and it stops
  learning here. Turn the switch on again, or choose *remove YouTube access*.

Transcript reading for tasks and sharing with an agent are still set on the phone or web, in Profile → **Interests &
sharing**: **Allow task-specific transcript reading** and **Share approved context with my chosen agent**.

### 3. Save a video, or pass on it

The *This video* card has two buttons for the YouTube video in the active tab:
- **Save to Rhythm**: more like this. With learning off, it also pins what the video is about (boxing, for example) to
  your interests. With learning on, it counts strongly towards them.
- **Not interested**: less like this. Rhythm won't suggest that video in tasks, and with learning on it counts against
  the video's topics.

They work with learning off. Rhythm needs to be able to read the tab, in one of two ways:
- you clicked its toolbar icon on that tab (the same access as *Use this page*), or
- learning's YouTube permission is granted. Then it reads whichever YouTube video is in the active tab, without a
  toolbar click.

When you click one, Rhythm:
1. Checks that page details are allowed for your account (*Process permitted page details* and YouTube; turning
   learning on allows both). If they aren't, it reads nothing and says "Page details are off for your account, so
   Rhythm didn't read this video." with a *Rhythm settings ↗* link.
2. Reads the video's title, channel, description excerpt and length, as *Use this page* does. For **Save to Rhythm**
   it also reads the video's transcript: it presses YouTube's **Show transcript**, reads the displayed lines (up to 400
   lines and 20,000 characters), and closes the transcript again. A transcript you already had open is read and left
   open. *Not interested* doesn't read the transcript.
3. Checks on this computer that the video is about one of Rhythm's topics (title, description excerpt and any
   transcript), with the rule the backend applies to reactions. If it isn't, nothing is sent: "Rhythm can't tell what
   this video is about, so nothing was sent."
4. Sends the details (and the transcript) with your choice and shows the backend's answer under the buttons, for
   example "Saved to Rhythm. It counts toward your interest in karate. Its transcript was saved too." For a video
   without a transcript it says only its details were saved. If the backend refuses because page details are off, the
   settings link appears too.

### 4. Answer Rhythm's question

When Rhythm has learned a new interest, the *Rhythm noticed* card asks about it, once per interest. For example: "You've
watched 2 beginner boxing videos recently. Want more boxing drills and technique videos?" This card is the only place
the panel shows anything Rhythm learned.
- **Yes** pins the interest. It stays in your profile whatever Rhythm learns later.
- **Not interested** blocks it. Rhythm won't add it to your profile again.
- **Forget this** deletes the stored videos behind it and stops counting your earlier coach chats about it. New
  activity can still teach it again.

Each answer is saved together with all your other choices (pins, blocks, answered questions, and your own level, length
and equipment), because the backend replaces every choice when it saves. If your profile changed on another screen in
the meantime, the panel loads it again and retries once. The card then shows the backend's answer, and the next
question if there is one.

### 5. Choose a page

1. Open a YouTube watch page.
2. Click **Rhythm's toolbar icon** on that tab. This opens the panel and gives Rhythm temporary access to that one tab.
   Opening the panel any other way grants nothing.
3. Optional: tick **Also permit displayed transcript reading for a task I start**. It's available only when
   transcript reading is allowed in your Rhythm settings.
4. Click **Use this page**.

Rhythm reads the video's title, channel, the description excerpt shown on the page, and its length. It screens these
on your computer first:
- **Not a match:** nothing is sent. The panel says "Screened on this device. No page details were sent and no
  transcript was requested."
- **A match:** the details go to the backend, which screens them again and records a page grant. No transcript is
  requested at this point.

Either way, the decision card shows the reasons and what information was missing.

The page grant ends when you **Pause**, when the tab moves to another page or video, when the tab closes, or about 20
seconds after the panel closes. To continue, click the toolbar icon again and choose **Use this page**. Changing the
transcript checkbox also needs **Use this page** again. Unticking it on a page granted with transcript reading revokes
that grant straight away.

### 6. Start a task

In **Start with a question**:
- **What are you looking for?** is optional for an evaluation, required for a search (at least 2 characters), and
  limited to 200 characters.
- **Who will help?** is either *I'll review the results myself* or one of your approved agents.
- **Analyze available transcripts for this task (up to three videos)** allows transcript reading in this task. It
  needs the phone setting and, for *Evaluate this video*, a page you permitted with transcript reading.

Then pick one:
- **Evaluate this video** creates a task, adds the permitted page as a candidate and shortlists it if it still
  matches. With transcript analysis on, it also starts a transcript read (see step 7).
- **Find videos** creates a recommendation task and runs one YouTube search. The backend adds your first topic to the
  query if the query names none, and uses your first preferred language. The results come back as candidates,
  screened by the server, best match first. Excluded results show as *Excluded candidate*, without their details.
  Search needs `YOUTUBE_API_KEY` on the backend.

A task you start here is active straight away, even if you assign it to an agent. Ask the agent to continue it
through Rhythm; it finds the task itself. A task an agent proposes waits under **Your agent is asking** until you
choose **Start this task** (or **Decline**), here or on the phone.

A task lasts 30 minutes. It becomes stale when your profile gets a new revision: when Rhythm applies newly learned
interests, or when a setting changes (including the learning switch).

### 7. Work through the candidates

Each candidate shows its status, title, a link to the video and the screening reasons.

- **Add to shortlist:** only for matching candidates, at most 3 per task. A slot stays used even if you change your
  mind.
- **Keep metadata recommendation:** saves a recommendation based on the video's details alone.
- **Read available transcript:** only for a shortlisted candidate in a task with transcript analysis. Rhythm presses
  YouTube's **Show transcript** on the video for you, reads it and closes it again. If you already opened the
  transcript, it's read as it is and left open.
  1. The first click reserves one read. The panel shows *Reading the displayed transcript…* with **Cancel reading**,
     and reads the open transcript within a few seconds.
  2. When the message says the transcript was recorded, click **Read available transcript** again to load the text.
  3. The panel then shows the first two segments, whether the text is complete or partial, and its language (often
     unknown). **Keep recommendation with these excerpts** saves a recommendation that quotes those two segments.
- **Supply transcript text yourself:** available for the same candidates. Use one timestamped line per segment, for
  example `0:03 Keep your hands up.`, and optionally a language code such as `en`. The text is labelled as
  user-supplied, not as a YouTube transcript.

To read the transcript of a search result:
1. Open that video and click the toolbar icon.
2. Tick the transcript checkbox and choose **Use this page**.
3. Choose **Attach this permitted page** on the task. This attaches the page to the task, which already has that video
   as a candidate, so no candidate slot is used.
4. Then use **Read available transcript**.

A read that fails, for example because the transcript panel wasn't open, isn't retried for that candidate in that
task. Supply the text yourself, keep a metadata recommendation, or start a new task.

### 8. Keep, rate or dismiss recommendations

**Worth your time** lists recommendations you kept and ones your agents saved. Each card shows:
- what it's based on: *Metadata only*, *Displayed transcript*, *Partial transcript* or *User-supplied text*
- the video link and length
- an explanation the server builds from your matching preferences, not from the agent's own wording
- quoted excerpts, which link to that moment in the video
- *What this recommendation is based on*

Cards saved under an earlier profile revision say so.

- **Save** and **Unsave**, **Helpful**, **Dismiss** and **Undo dismissal** are shared with the phone's Profile →
  **Content library** screen.
- A dismissed video is refused in later tasks.
- With memory allowed on the phone, your feedback is also saved to your private Agent Memory, if one is set up for
  your account on the backend.
- With learning on, *Save* and *Helpful* also count towards your interests.

When a card is at least 10% visible while a page is connected, the panel tells the backend. An agent is told a
recommendation was *displayed* only after that; otherwise it hears *saved_for_later*.

### 9. Pause

**Pause** revokes the current page grant on the server, cancels its pending reads, and withdraws permission to reuse
transcript text captured from that page. Earlier page grants can be revoked on the phone under Content library →
*Connections*. If the server can't be reached, the panel says revocation couldn't be confirmed; revoke the page on the
phone.

## How it works

### The service worker (`entrypoints/background.ts`)

The service worker keeps no tokens or open connections of its own.

- On startup, it limits `chrome.storage.session` and `chrome.storage.local` to trusted extension contexts, so scripts
  injected into a page can't read them.
- On a toolbar click, it opens the side panel for that tab.
  - If the tab is a valid watch URL, it stores one *invocation* in session storage: the tab ID, the canonical URL
    `https://www.youtube.com/watch?v=<id>` (other query parameters are dropped), the time and a random nonce.
  - On any other page, it clears the invocation.
- When that tab starts loading, changes URL or closes, it clears the invocation.
- With learning on, it also watches YouTube tabs (see *Learning from watched videos*).

### Reading a page (`lib/browser.ts`, `lib/youtube.ts`)

Before and after every read, the panel checks three things: the active tab is still the invoked tab, it still shows
the same video, and the nonce is unchanged. Both readers run with `chrome.scripting.executeScript` in Chrome's
*isolated* world, where the page's own scripts can't see them. They receive only a video ID, a page reference and an
expiry time, never a credential.

- **`readMetadata`** runs in the main frame. It checks the URL and the `video-id` on `ytd-watch-metadata`, then reads
  only visible elements:

  | Field | Source | Maximum |
  |---|---|---|
  | Title | the `h1` | 300 characters |
  | Channel | the channel name link | 150 characters |
  | Description excerpt | the collapsed snippet, or the expanded text if you expanded it | 1,200 characters |
  | Duration | the player's `<video>`, except while an ad plays | |

  Anything missing is sent as `null`, never guessed. The selectors were observed on youtube.com on 2026-10-21.
- **`openTranscriptPanel`** runs first, for a transcript read you asked for: if no transcript panel is open, it
  presses the **Show transcript** button in the video's description and waits up to 10 seconds for timestamped rows.
  **`closeTranscriptPanel`** closes the panel afterwards with its own **Close** button, but only if Rhythm opened it.
  Without the button (no captions, or a changed layout) nothing is pressed and the read reports *unavailable*.
- **`readDisplayedTranscript`** runs only in the same document as the metadata read, and only on an expanded
  transcript panel.
  - It reads at most 6,000 elements and keeps rows that contain exactly one timestamp.
  - Limits: 1,500 segments, 1,500 characters per segment, 100,000 characters in total.
  - The language is taken from the panel's `lang` attribute when there is one.
  - A result counts as *complete* only if every row carries ARIA position data covering the whole list. YouTube's
    current layout doesn't, so real reads are *partial*. The backend also downgrades a *complete* claim that lacks this
    evidence.

The readers don't click, scroll, make network requests, use player APIs or call captions endpoints.

### Learning from watched videos (`lib/learning.ts`, `lib/worker-session.ts`)

Learning runs in the service worker only while two things are true, and it checks both at every step:
- the flag `rhythmLearning` in `chrome.storage.local` is set for the signed-in account (the panel's switch sets it
  after the backend confirmed learning), and
- Chrome has granted the optional permission `https://www.youtube.com/*`.

Without both, no check is scheduled and nothing is injected. A leftover check that fires anyway removes all of
learning's checks and session data.

1. **Checks.** Chrome tells the extension a tab's address only for sites it may access, so the worker sees YouTube
   addresses only after the permission is granted. For a `www.youtube.com/watch?v=…` address, including YouTube's
   in-page moves to another video, it starts a repeating `chrome.alarms` check every 30 seconds, named after the tab
   and the video. Each tab has at most one. Moving to another video replaces it; leaving YouTube or closing the tab ends
   it (see step 6). Turning learning on also starts checks for the watch pages already open.
2. **Measuring.** Each check injects `readPlayback` (`lib/youtube.ts`) into the tab's main frame, in the isolated world.
   It returns only numbers and flags, and only while the page shows that video (its address and its
   `ytd-watch-metadata` agree):

   | Value | Source |
   |---|---|
   | Played | The total of the player `<video>`'s `played` ranges: the parts of the video that actually played. Skipped or seeked-over parts aren't in them, and replaying a part adds nothing |
   | Duration | The `<video>`'s duration, unknown while an ad plays |
   | Visible | `document.visibilityState` is `visible` |
   | Paused | The `<video>`'s `paused` |
   | Ad | `#movie_player` has the class `ad-showing` |

   `playedGrowth` then counts the growth in *played* since the previous check, but only if the page was visible and
   showed no ad at **both** checks, and never more than the time between them at YouTube's top speed (2×). It counts
   nothing if the page was reloaded, or if *played* went down: YouTube's player restarts its ranges when it loads a new
   source, for example for the next video or after an ad. The first check compares with the moment the video opened
   (nothing played yet, visible if the tab was the active one then). For a video that was already open when learning
   was turned on, it only sets a starting point.
3. **The threshold.** When the counted seconds reach 60, or 40% of the duration for a video shorter than 150 seconds,
   the video must not have been recorded already in this browsing session. The worker then asks Clerk for the
   signed-in user. If you're signed out, or signed in to a different account from the one that turned learning on, it
   stops checking that video.
4. **Reading and checking on this device.** It runs `readMetadata` in the isolated world, then
   `readDisplayedTranscript` in the same document. A transcript is included only if YouTube's transcript panel is
   already open: at most 60 segments and 20,000 characters. `keptVideo` (`lib/relevance.ts`) applies the backend's
   `kept_video()` rule from `app/rhythm/learn.py` to the title, description excerpt and transcript. The text must name
   one of Rhythm's topics (boxing, karate, gym, home exercise, food) and contain no spectator words (highlights,
   championship, …) or out-of-scope words (BJJ and its variants). Any other video is dropped here: its checks stop,
   nothing is sent and nothing about it is kept.
5. **Sending.** A matching video goes to `POST /rhythm/signals` with a fresh Clerk session token and
   `engagement: { playedSeconds }`, the counted seconds rounded to whole seconds. The backend checks it again, keeps
   the larger *playedSeconds* it has seen for that video, and re-learns in the background. It gives a video full weight
   once half its length has played, but at least one and at most five minutes (two minutes if the length is unknown),
   and less before that.
6. **One update.** The checks go on after sending. When the tab moves to another video or page, or closes, the
   worker sends the video once more, with the new total, if the counted seconds grew by at least 60 since the first
   send. The update reuses what was sent, with the time of the last check as its capture time. A tab that stays
   open, or Chrome closing, sends no update.

| Backend response | What the worker does |
|---|---|
| `ok` | Done |
| `irrelevant` | Nothing; the backend's check found no topic, and nothing was kept |
| `permission_required` | Learning is off for the account. The worker clears its flag, queue, measurements and checks and stops; the panel shows the mismatch |
| `budget_exceeded` | Today's 200 videos are used up. It drops this video and anything queued |
| `stale_context` | The capture is more than a day old. It drops it |
| No answer, a server error or an expired sign-in | It queues the video in `chrome.storage.session` (at most 20, newest kept) and retries with the next video it sends. An update replaces a queued copy of the same video |

Besides the retry queue, session storage holds:
- the IDs of the matching videos already recorded or queued (at most 500), so no video is sent twice in a browsing
  session, apart from its one update;
- for each tab on a watch page, its measurement: the video ID, the counted seconds, the last check's numbers and, once
  sent, what was sent (for the update). It's removed when the tab leaves the video, or when the video doesn't match.

All of it disappears when Chrome closes, when learning is turned off, and when the YouTube permission is removed.
Non-matching videos are never added to the list of recorded IDs.

**Signing in from the worker.** `lib/worker-session.ts` uses Clerk's documented background client,
`createClerkClient({ publishableKey, background: true, syncHost })` from `@clerk/chrome-extension/client`
([Clerk docs](https://clerk.com/docs/reference/chrome-extension/create-clerk-client)). The older
`@clerk/chrome-extension/background` import still exists in 3.1.97 but is deprecated. Like the panel's, the client
reads the website's Clerk cookie on the sync host (`__clerk_db_jwt` for a development instance, `__client` for a
production one) and otherwise the client token the panel's Clerk keeps in `chrome.storage.local`, so the worker is
signed in exactly when the panel is. It loads the sign-in again when that token changes or when the website's
`__client_uat` cookie does (signing in, out or into another account there), and asks Clerk for a fresh session token
for every request.

**Bundle.** clerk-js makes the worker about 890 KB. `wxt.config.ts` swaps Clerk's sign-in UI, which only its
non-background code path loads, for an empty module, and builds the worker as one classic script. Service workers
can't load code later with a dynamic import.

### Save to Rhythm, Not interested and the question (`lib/reactions.ts`)

- **Reading the video.** `captureCurrentVideo` (`lib/browser.ts`) uses the toolbar click's grant when there is one for
  the active tab, through the same checks as *Use this page*. Otherwise, if learning's YouTube permission is granted,
  it reads the active tab's address (Chrome reports it because of the permission) and runs `readMetadata` there,
  checking that the tab still shows that video afterwards. With neither, it asks you to click the toolbar icon.
- **Before sending.** `reactToVideo` reads `GET /rhythm/interests` first and reads nothing if page details or YouTube
  are off. It sends only a video `keptVideo` places, using the title and description excerpt, as the backend's
  `react()` does.
- **The question.** `GET /rhythm/learned` returns `result.learned`, whose `suggestion` (a topic and its text) is shown
  when set. `answerSuggestion` sends `PUT /rhythm/choices` with every choice from `learned.choices` (the backend resets
  any it doesn't receive), the answered topic added to `pinned` or `blocked` and to `acknowledged`, and
  `result.profileRevision` as `expectedRevision`. On `stale_context` it loads `/rhythm/learned` again and retries once.
  *Forget this* sends `POST /rhythm/forget`.

### Screening (`lib/relevance.ts`)

This is a TypeScript copy of the backend's `app/rhythm/relevance.py`, and both read `relevance-rules.json`. The panel's
check decides only whether anything is sent; the backend screens again at every step, and its decision is the one that
counts. Only the title and description excerpt are matched, not the channel name. The word lists are English.

Checks, in order:
1. No title or description text: *uncertain*.
2. Out-of-scope words (BJJ and its variants): *irrelevant*.
3. Your exclusions: *irrelevant*.
   - These have synonym lists: BJJ, weight loss, fight news, fight highlights, news, competition and reaction.
   - Any other exclusion is matched as written.
4. Spectator words (highlights, championship, press conference, fight news, …): *irrelevant*.
5. The text must match one of your topics and one of your purposes.
   - If it doesn't, the result is *uncertain*.
   - It's *irrelevant* instead if no topic of yours matches but a topic you didn't choose does.
6. Equipment you didn't list (dumbbells, kettlebell, resistance bands, heavy bag, barbell, bench): *irrelevant*.
   - Only checked if you listed some equipment.
   - Skipped if you listed *Gym access*, or if the text says "no" or "without" before the item.
7. A strict maximum length: unknown length is *uncertain*, longer is *irrelevant*.

Anything left is *relevant*. Its score is 10 for each matched topic or purpose, plus 3 for your level, 2 for being
within your preferred length and 3 for "no equipment" when that's what you have. To change the vocabulary, edit
`relevance-rules.json`. The backend picks it up on restart, the extension on its next build.

Learning's check, `keptVideo`, is a different and simpler rule that reads the same file; see *Learning from watched
videos*.

### Talking to the backend (`lib/api.ts`)

The panel and the service worker use the same API client as the phone (`createRhythmApi` in
`mobile/src/lib/rhythm.ts`).

- **Requests:** each one carries a fresh Clerk session token as a bearer token, sends no cookies, refuses redirects,
  and times out after 20 seconds.
- **CORS:** the backend's CORS settings only allow localhost web pages. The panel doesn't need them, because it has
  host permission for the backend.
- **Errors:**

  | Response | The panel says |
  |---|---|
  | `401` | "Your sign-in expired. Sign in again." |
  | `422` | "Some details need correcting. Refresh and try again." |
  | Any other error | "Rhythm couldn't reach your account. Check the server connection." |
  | A policy refusal | The refusal comes back as a normal response with a status (for example `permission_required`) and a message, shown in the status line |

| Panel action | Request |
|---|---|
| Refresh (on open, then every 8 s) | `GET /rhythm/interests`, `/rhythm/connections`, `/rhythm/tasks`, `/rhythm/recommendations`, `/rhythm/metrics` |
| The learning switch, on or off | `GET /rhythm/interests`, then `PUT /rhythm/settings` with the current `enabledSites` and consent, `learn` changed (and, when turning on, `youtube` and `metadata` added) |
| A matching watched video, and its one update (service worker) | `POST /rhythm/signals`, with `engagement: { playedSeconds }` |
| Save to Rhythm, Not interested | `GET /rhythm/interests`, then `POST /rhythm/reactions` with `reaction` `more` or `less` |
| The *Rhythm noticed* question (on open, and after a reaction or an answer) | `GET /rhythm/learned` |
| Yes, Not interested (on the question) | `PUT /rhythm/choices` with every choice and `expectedRevision`; on `stale_context`, `GET /rhythm/learned` and once more |
| Forget this | `POST /rhythm/forget` |
| Use this page | `POST /rhythm/browsers` |
| Pause, or unticking transcript permission | `DELETE /rhythm/browsers/{id}` |
| Page changed, or replaced by a new page | `POST /rhythm/browsers/{id}/disconnect` |
| Stay connected and pick up transcript reads (every 3 s) | `POST /rhythm/browsers/{id}/poll` |
| Carry out a read | `POST /rhythm/browsers/{id}/requests/{request}/claim` and `…/complete`, or `DELETE …/requests/{request}` |
| Evaluate this video, Find videos | `POST /rhythm/tasks`, then `…/selected`, `…/shortlist` and `…/candidates/{c}/transcript`, or `…/search` |
| Start this task, Decline, Stop task | `POST /rhythm/tasks/{id}/approve`, `DELETE /rhythm/tasks/{id}` |
| Attach this permitted page, Add to shortlist | `POST /rhythm/tasks/{id}/selected`, `POST /rhythm/tasks/{id}/shortlist` |
| Read available transcript | `POST /rhythm/tasks/{id}/candidates/{c}/transcript` |
| Supply transcript text yourself | `POST /rhythm/tasks/{id}/candidates/{c}/import` |
| Keep … recommendation | `POST /rhythm/tasks/{id}/recommendations` |
| Save, Helpful, Dismiss | `POST /rhythm/recommendations/{id}/feedback` |
| A card comes into view | `POST /rhythm/recommendations/{id}/displayed` |

Granting pages, starting tasks, importing text, changing settings or choices, reacting to a video, sending watched
videos and approving anything need a Clerk app session. Agents can't call these routes; they use `/rhythm/mcp`.

### Transcript reads (`lib/use-browser-bridge.ts`)

1. **The request.** The panel's button or an agent's `get_video_transcript` asks for text for a shortlisted
   candidate, in a task that allows transcript analysis.
2. **Cache or reservation.**
   - If an unexpired private copy exists and its page grant wasn't revoked, the backend returns that (a *cache hit*).
   - Otherwise it reserves one read (3 per task, 10 per day) and creates a browser request. The request lasts 90
     seconds and is tied to the page grant, the page reference, the video and the profile revision.
3. **The panel picks it up.** On its next 3-second poll, the panel checks that the request matches its page and claims
   it; a request can be claimed once. It then opens YouTube's transcript panel if it's closed, reads the transcript in
   the same document, closes the panel again if it opened it, and uploads the result. If the
   page changed, it cancels the request instead.
4. **Storage.** The backend checks the upload against the request and stores it privately for 24 hours. The result is
   marked partial unless full coverage is proven.
5. **Delivery.** The text is then delivered in pages of 40 segments by default (at most 80 segments and 12,000
   characters per page). A saved recommendation can only quote segments that were delivered to its task.

| Timer | Value | Set in |
|---|---|---|
| Poll for transcript reads (also keeps the page grant alive) | 3 s | `lib/use-browser-bridge.ts` |
| Panel data refresh | 8 s | `entrypoints/sidepanel/App.tsx` |
| Learning's check of a tab on a watch page | Every 30 s (1 min before Chrome 120, which rounds alarms up) | `lib/learning.ts`, `CHECK_MINUTES` |
| Played in view before a video is sent | 60 s, or 40% of a video shorter than 150 s | `lib/learning.ts`, `SEND_AT_SECONDS`, `SHORT_VIDEO_SHARE`, `SHORT_VIDEO_SECONDS` |
| Further growth before leaving the video sends one update | 60 s | `lib/learning.ts`, `UPDATE_AFTER_SECONDS` |
| A watched video's capture must be newer than | 1 day | backend, `learn.record` |
| Backend request timeout | 20 s | `lib/api.ts` |
| Page grant ends without a poll | 20 s | backend, `RhythmSettings.browser_lease_seconds` |
| A transcript read request expires | 90 s | backend, `RhythmSettings.request_seconds` |
| A page capture must be newer than | 2 min | backend, `browser.fresh_capture` |
| Task lifetime | 30 min | backend, `RHYTHM_TASK_MINUTES` |
| Private transcript copy | 24 h | backend, `RHYTHM_CACHE_HOURS` |

Other limits that show up in the panel:
- 5 connected pages at a time
- 10 open tasks at a time
- per task: 10 candidates, 3 shortlisted, 3 transcript reads and 2 searches
- per day: 10 transcript reads, 20 searches and 200 watched videos for learning

The full table is in the integration guide's *Policy and limits*.

## Permissions and privacy

| Permission | Why |
|---|---|
| `activeTab` | Temporary access to the tab where you clicked the toolbar icon. It ends when that tab navigates |
| `scripting` | Runs the readers in the isolated world: in the tab you chose; in the active tab when you choose *Save to Rhythm* or *Not interested*; and, with learning on, the playback check in a YouTube tab every 30 seconds, then the two readers once a minute has played |
| `sidePanel` | The panel itself |
| `storage` | The current toolbar click (session storage), the learning flag (local storage), and learning's retry queue, recorded video IDs and per-tab measurements (session storage). Clerk's SDK also requires this permission |
| `cookies` | Required by Clerk's Chrome extension SDK, which reads the website's Clerk cookie on the sync host. To notice when the website's sign-in changes, the panel also watches its `__client_uat` and `__session` cookies there, and the worker its `__client_uat`. They read no other cookies |
| `alarms` | Learning's repeating 30-second check, one per tab on a watch page and none while learning is off. A service worker can be stopped between checks, so a plain timer isn't reliable |
| Host permissions | Only the backend origin, the Clerk Frontend API origin and the sync host (`http://localhost/*` for the local website, any port). The sync host is there so Clerk can read the website's sign-in; Rhythm reads no pages there |
| Optional host permission | `https://www.youtube.com/*`, requested only when you turn learning on, and removed when you turn it off. It lets the service worker see YouTube tab addresses and run the readers in them, and lets *Save to Rhythm* and *Not interested* read the active YouTube tab without a toolbar click. Chrome shows it as "Read and change your data on www.youtube.com" |

What the manifest doesn't have:
- no YouTube host permission at install and no `<all_urls>`: YouTube appears only under `optional_host_permissions`
- no `tabs` permission and no content scripts
- no `externally_connectable` and no message listeners, so websites can't message it and other extensions have
  nothing to call
- no remote code: the content security policy is `script-src 'self'; object-src 'none'; base-uri 'none'`

The tests check the first three, that the YouTube permission isn't granted at install, that injected scripts can't
read extension storage, and that without the permission and the learning switch no check is scheduled and nothing is
injected.

What leaves the browser, and where it goes:

| When | What | Where |
|---|---|---|
| *Use this page*, and the page matches | Video ID and link, title, channel, description excerpt, length, capture time | BuildNorth backend |
| *Use this page*, and it doesn't match | Nothing; only the panel's local counter goes up | |
| Learning on, once a minute of a fitness, health or food video has played in view | Video ID and link, title, channel, description excerpt, length, capture time, up to 60 lines of a transcript you had already opened, and the seconds played in view | BuildNorth backend, 60 days |
| Learning on, leaving such a video after watching at least another minute | The same details once more, with the new seconds played | BuildNorth backend; it keeps the larger number |
| Learning on, any other video, or less than a minute played in view | Nothing, and nothing about it is kept once the tab moves on | |
| *Save to Rhythm* or *Not interested* on a fitness, health or food video | Video ID and link, title, channel, description excerpt, length, capture time, and your choice. *Save to Rhythm* also sends the video's transcript (up to 400 lines and 20,000 characters) | BuildNorth backend, with the watched videos (see below) |
| *Save to Rhythm* or *Not interested* on any other video, or with page details off | Nothing | |
| *Yes*, *Not interested* or *Forget this* on the question | Your choice for that topic, with your other choices | BuildNorth backend, in your profile |
| The backend's learning, when it has an AI provider | Titles and channels of up to 25 recent watched videos and up to 20 of your recent coach messages, to refine what was learned | BuildNorth's configured AI provider (`aiProvider` in the backend's `/health`) |
| A transcript read for a task | Timestamped segments, the language if shown, and how complete the text is | BuildNorth backend, private copy for 24 hours |
| *Supply transcript text yourself* | Your text, labelled as user-supplied | BuildNorth backend, 24 hours |
| *Save*, *Helpful*, *Dismiss* | Your feedback | BuildNorth backend; with memory allowed, also your private Agent Memory |
| An agent uses Rhythm | Whatever its tools return to it | Your agent's host, under that provider's retention policy |

How long things are kept:
- **Seven days:** tasks, their candidates and requests, old page grants, and unconfirmed memory suggestions.
- **60 days:** watched videos recorded for learning, and the videos you chose *Save to Rhythm* or *Not interested*
  on, which the backend stores the same way. Learning looks back only 45 days, and a video counts half as much every
  two weeks, so old interests fade within weeks. Turning learning off, here or on the phone, deletes them at once. While
  learning is off, the backend also deletes them whenever a setting changes, which ends a *Not interested* on a video.
  A pin from *Save to Rhythm* or *Yes* stays.
- **Until they're replaced:** the learned interests in your profile, with the evidence for them. They aren't listed;
  the panel only asks about one at a time, and `GET /rhythm/learned` returns them for an access request.
- **Until you change them:** your choices: pinned, blocked and answered interests.
- **Until you delete them:** saved recommendations, with their short quoted excerpts, and confirmed feedback.
- **Never stored:** pages that didn't match, videos learning didn't keep, and your browsing history.
- **In this browser only, until Chrome closes:** learning's retry queue (at most 20 matching videos), the IDs of the
  matching videos already recorded, and each watch page's measurement until its tab moves on.

Profile → Content library → *Memory* → **Delete Rhythm data** removes Rhythm's content. **Delete all my data** covers
Rhythm too. Details are in the integration guide's *Memory, retention, and deletion*.

`npm run zip` packages the extension as a zip in `.output/`. It isn't published to the Chrome Web Store. Publishing
needs a privacy-policy URL and Google's review.

## Connecting an agent

Agents connect to the backend, not to the extension, and the phone approves them.

**Claude, ChatGPT and Codex** connect by signing in, with no token: in **Profile → Content library → Connections**,
choose **Connect Claude** (or ChatGPT, Codex), then follow the steps shown there. You add Rhythm's address as a custom
connector in Claude or ChatGPT, or run `codex mcp add` and `codex mcp login` in Codex, and sign in with your BuildNorth
account. The backend must have its public HTTPS address running (`mobile/scripts/mcp-tunnel.sh`). For other clients:

1. On the phone, turn on **Share approved context with my chosen agent** in Interests & sharing.
2. Open Profile → **Content library** → **Connections**. It shows the agent connection address, for example
   `http://localhost:8000/rhythm/mcp`. Then either:
   - **Bearer-token clients:** name the connection, choose its permissions and choose **Create Rhythm connection
     token**. The `bnr_…` token is shown once and lasts 90 days. It only works at `/rhythm/mcp`, not at BuildNorth's
     `/mcp`.
   - **OAuth clients:** connect them to the public HTTPS `/rhythm/mcp` address. After they call `connect_rhythm`, they
     appear here for you to approve.
3. Give the agent the address and token through its own environment, never in chat or in this extension's `.env`.
   The templates in `clients/` read `RHYTHM_MCP_URL` and `RHYTHM_MCP_TOKEN`.
   - **Claude Code**, from the repository root. Its template falls back to `http://localhost:8000/rhythm/mcp` when
     `RHYTHM_MCP_URL` isn't set:

     ```bash
     claude --mcp-config extension/clients/claude.mcp.json --strict-mcp-config
     ```

Once an agent is active, it appears in the panel's **Who will help?** list.

| Phone label | Permission | Allows the agent to |
|---|---|---|
| Your interests | `interests` | Read the profile, with the interests Rhythm learned |
| Saved videos | `saved` | Read the videos you saved with **Save to Rhythm**, with their transcripts, and store a summary of each |
| Selected page | `page` | Read a permitted page's details and attach it to a task |
| Video search | `search` | Search YouTube within a task |
| Transcript reading | `transcripts` | Get transcript text for shortlisted videos |
| Recommendations | `recommend` | Propose and work on tasks, shortlist, save recommendations |
| Memory context | `memory` | See confirmed memory and suggest new context |
| Feedback suggestions | `feedback` | Suggest feedback, which you confirm on the phone |

A new token gets every permission except *Memory context* unless you change the selection. The server offers 16 tools:
- `connect_rhythm`, `get_interests`, `get_selected_page`
- `create_video_task`, `list_video_tasks`, `get_task_status`
- `add_selected_video`, `shortlist_videos`, `search_videos`, `get_video_transcript`
- `show_recommendations`, `remember_interest`, `record_feedback`, `request_forget`
- `list_saved_videos`, `save_video_summary`: with the *Saved videos* permission, your agent reads the videos you saved
  with **Save to Rhythm** (with their transcripts) and stores a summary of each. The summary stays with the video and
  helps Rhythm learn your interests; the apps don't show it.

While recommendations are off, only `connect_rhythm`, `get_interests`, `request_forget` and the two saved-video tools
are offered, and a new token starts with *Your interests* and *Saved videos*.

Their inputs and results are in the integration guide's *MCP contracts*.

## Project layout

```
entrypoints/
  background.ts             service worker: toolbar click → open the panel, remember the chosen tab; learning's events
  sidepanel/
    index.html, main.tsx    sign-in (the website's, or email and password), then the panel
    App.tsx                 page permission, status line, page decision, counters
    Learning.tsx            top card: learning status and switch (asks Chrome for YouTube access)
    Suggestion.tsx          "Rhythm noticed": the learned-interest question (Yes, Not interested, Forget this)
    Reactions.tsx           "This video": Save to Rhythm, Not interested
    Tasks.tsx               start a task, agent requests, current task and its candidates
    Recommendations.tsx     "Worth your time", feedback, display acknowledgements
    ui.tsx                  shared pieces: the AI orb, icons, card headings and section labels
    style.css               the web app's colours, type, cards, buttons and pills (light and dark)
lib/
  api.ts                    backend requests (Clerk token, timeout, errors) around the shared client
  browser.ts                chosen-tab checks, the executeScript calls, and reading the active video for reactions
  youtube.ts                the injected readers: page details, displayed transcript, and learning's playback check
  relevance.ts              screening on this device (TypeScript copy of the backend's), and learning's keptVideo
  learning.ts               learning: checks, engagement maths, reading, local check, sending, the update and the queue
  reactions.ts              the panel's reactions and answers to the question, apart from React (tested directly)
  worker-session.ts         Clerk's background client: the signed-in user and session tokens in the service worker
  website-sign-in.ts        the sync host, and noticing when the website's sign-in changes
  use-browser-bridge.ts     polls for transcript reads, claims, reads and uploads them
clients/                    MCP config template for Claude Code
scripts/build-local.mjs     build with the phone's public Clerk key
tests/youtube.test.ts       Playwright checks
wxt.config.ts               manifest, permissions, content security policy, access to the shared files, worker bundle
wxt.test.config.ts          the same build, written to .output-tests/
```

The build also uses `../mobile/src/lib/rhythm.ts` and `../mobile/backend/app/rhythm/relevance-rules.json`. The backend
code is in `../mobile/backend/app/rhythm/`.

These are generated and git-ignored:
- `.wxt/`, made by `wxt prepare`
- the build output: `.output/` and `.output-tests/`
- test results: `test-results/` and `playwright-report/`
- `.env` files, except `.env.example`

## Checks

```bash
npm run typecheck
```

Install Playwright's Chromium once:

```bash
npx playwright install chromium
```

```bash
npm test
```

`npm test` builds into `.output-tests/chrome-mv3`, so your loaded copy in `.output/` isn't touched. It then runs 15
Playwright tests on fixture pages and in-memory stand-ins, with no real account or YouTube response:

1. **Page details.** Only the visible description excerpt is read. Comments, the hidden full description and
   transcript text are ignored, no network requests are made, and a different video ID is refused.
2. **Screening.**

   | Title | Expected result |
   |---|---|
   | "Beginner boxing footwork drill" | relevant |
   | "No-equipment beginner workout" | relevant |
   | "Championship boxing fight highlights" | irrelevant |
   | "BJJ guard passing" | irrelevant |
   | "This changed everything" | uncertain |

   A strict length limit with an unknown length is also uncertain.
3. **Learning's check on this device.**

   | Title | Kept |
   |---|---|
   | "Beginner boxing footwork drill" | yes |
   | "Easy vegetarian meal prep" | yes |
   | "Top 10 movie trailers" | no |
   | "Championship boxing fight highlights" | no |
   | "BJJ guard passing" | no |

   An open transcript counts too, and at most 60 segments are taken from it.
4. **Engagement maths.** `playedGrowth` counts the growth in played time between two checks only when the page was
   visible and no ad showed at both. Skipped parts and replays add nothing, a restarted or reloaded player counts
   nothing, the first check counts from the moment the video opened, and growth is capped at 2× the time between
   checks. `sendThreshold` is 60 seconds, or 40% of a video shorter than 150 seconds (40 s for 100 s, 24 s for 60 s).
5. **Playback reader.** On a fixture player with played ranges 0:00–0:10 and 5:00–5:05, `readPlayback` reports 15
   seconds played, the duration, visibility and pause, and no page text. With `ad-showing` it reports the ad and no
   duration; with the page hidden, *not visible*. Another video, or details still showing the previous video, give
   nothing.
6. **Learning stays off without the permission or the switch.** With the YouTube permission or the learning flag
   missing, or both, opening a matching video schedules no check, and three minutes on it inject nothing, read
   nothing, ask for no sign-in, send nothing and store nothing. A leftover check removes itself. Signed out, playback
   is measured but nothing is read or sent, and the checks stop. Turning learning off mid-video stops the checks.
7. **Learning when it's on.** Leaving a video before its first check cancels it, with nothing injected. A non-matching
   video is read once after a minute, then neither sent nor remembered, and its checks stop. A matching video is sent
   at the check where a minute had played, with `playedSeconds: 60`, and not again from another tab. A video that
   fails to send waits in the queue and goes with the next one. Turning learning off clears the checks, the queue, the
   measurements and the remembered IDs.
8. **What counts as watching.** Five minutes of autoplay in a background tab count for nothing; brought to front, the
   video is sent after a further 90 seconds, with 60. A tab opened behind and brought to front 20 seconds later
   doesn't count its first 30 seconds. A paused video is never sent. After a 45-second ad, the video is sent two
   minutes after it opened, not one. A 50-second video is sent at the first check. Moving to another video after 150
   seconds sends one update (60, then 150), and closing the tab afterwards sends nothing more. Growth of 30 seconds, or
   five minutes in a hidden tab, sends no update.
9. **Save to Rhythm and Not interested.** With page details or YouTube off for the account, the video isn't read and
   the result links to the settings. A video Rhythm can't place is read but not sent ("Rhythm can't tell what this
   video is about, so nothing was sent."). A matching one is sent with `more` or `less`, with learning off, and the
   backend's message is shown, including its own `permission_required` (with the settings link) and `irrelevant`.
   Without page access, the reader's message is shown.
10. **The question.** *Yes* sends the pinned and acknowledged lists with the topic added, and the blocked list, level,
    length and equipment unchanged, against the current revision; the answered question then doesn't come back. *Not
    interested* blocks instead of pinning. A `stale_context` reloads `/rhythm/learned` and retries once with the newer
    choices (keeping another screen's pin); a second one is returned, not retried. *Forget this* calls
    `/rhythm/forget`. The summary from `/rhythm/interests` is never taken for a question.
11. **Transcript reader.** Text is marked partial with an unknown language, and other page text is ignored. A segment
    that contains instructions is kept as plain text. A hidden panel gives *unavailable*, and a different video gives
    nothing.
12. **The sync host.** With no setting it's `http://localhost` (for `http://localhost:8081` or no web app URL) or
    `http://127.0.0.1`, the website's own host for a development key elsewhere, and the Frontend API for a live key (from
    `WXT_CLERK_FRONTEND_API` or the key). `WXT_CLERK_SYNC_HOST` wins, reduced to its origin.
13. **The website's sign-in.** With a stand-in for `chrome.cookies`, signing in on the website (several cookies at once)
    is reported once, as that user; switching accounts reports the new user; signing out reports signed out. Cookies on
    another host, and Chrome's removal half of an overwrite, are ignored, and nothing is reported after unsubscribing.
    The panel reloads only when it shows something else than the website, and the worker ignores token refreshes.
14. **The unpacked extension in Chromium.**
    - The manifest has no YouTube or all-sites host access, content scripts or external messaging. YouTube is only in
      `optional_host_permissions`, and `alarms` is requested. The sync host `http://localhost/*` is a host permission.
    - The service worker can read a Clerk cookie on `localhost`, but not one on another site.
    - Before a toolbar click, the extension can't access the tab.
    - After a simulated toolbar click, it can, and the stored URL has tracking parameters removed.
    - Injected scripts can't read extension storage.
    - Navigating clears the grant.
    - Chrome reports the YouTube permission as not granted. With the learning flag set anyway, moving between YouTube
      videos schedules no check and stores nothing in session storage, and a stray repeating check removes itself
      when it fires.

Tests 6 to 8 drive `createLearningObserver` with an in-memory browser whose simulated players gain a second of played
time per second, since a test can't accept Chrome's permission prompt. Tests 9 and 10 drive `lib/reactions.ts` with a
stand-in backend that, like the real one, resets any choice a save leaves out.

The backend's Rhythm tests are `tests/test_rhythm.py`, `tests/test_rhythm_learning.py` and `tests/test_mcp.py`:

```bash
cd ../mobile/backend && .venv/bin/python -m pytest -q
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `build:local`: "Configure the public Clerk key in extension/.env or mobile/.env." | Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `mobile/.env`, or `WXT_CLERK_PUBLISHABLE_KEY` in `extension/.env` |
| Build: "Rhythm requires HTTPS except for a local development backend." | `WXT_API_URL`, `WXT_CLERK_FRONTEND_API`, `WXT_WEB_APP_URL` or `WXT_CLERK_SYNC_HOST` uses `http` on a host other than `localhost` or `127.0.0.1` |
| Build: "Do not put credentials in a service URL." | Remove the user name or password from the URL |
| Panel: "Finish the local setup to sign in." | The build had no publishable key. Use `npm run build:local`, or fill in `.env`, then rebuild and reload |
| Signed in on the website, but the panel still asks you to sign in | Close the panel and open it again. Then check: the extension was reloaded after the last build; the website runs on the sync host (`http://localhost` by default, so not `127.0.0.1`); the website uses the same Clerk instance; and `allowed_origins` includes `chrome-extension://<the ID on Rhythm's card>` |
| The panel shows another account than the website, or signs out by itself | The website's sign-in wins: the panel follows it, including a sign-out or another account there. Sign in on the website with the account you want |
| Signing out in the panel signed you out of the website | Expected: they share one sign-in |
| Build: "Invalid URL" | `WXT_CLERK_SYNC_HOST`, `WXT_WEB_APP_URL` or `WXT_CLERK_FRONTEND_API` isn't a full URL. Use, for example, `http://localhost` |
| Panel: "Sign-in could not load. Check your connection and reopen Rhythm." | Clerk couldn't be reached. Check `WXT_CLERK_FRONTEND_API` and the network |
| Requests fail with "Your sign-in expired. Sign in again." | The backend rejected the token. Sign in again; if it keeps happening, check that the backend uses the same Clerk instance and that `CLERK_AUTHORIZED_PARTIES` (if set) includes the extension's origin |
| "Rhythm couldn't reach your account. Check the server connection." or "Could not refresh Rhythm. Check your connection." | Start the backend, or fix `WXT_API_URL` and rebuild |
| *Use this page* is greyed out, or "Rhythm hasn't learned your interests yet…" | Turn on learning, then watch a few workout or recipe videos for at least a minute each, or chat with your coach. *Save to Rhythm* on a video works too. The card says *Still learning…* until then. Use the same account and backend as the phone |
| "Allow YouTube page details in your Rhythm settings first." | Turn on *Enable YouTube* and *Process permitted page details* in Interests & sharing, or turn learning on in the panel, which allows both |
| "Chrome didn't allow access to YouTube, so learning stays off." | You declined Chrome's prompt. Turn the switch on again and choose *Allow* |
| The card says "Learning from videos is on for your account, but this browser isn't sharing what you watch." | The YouTube permission was removed (in Chrome's settings, for example), or learning was turned on from another browser or account. Turn the switch on, or choose *turn learning off* |
| The card says "Learning from videos is off for your account, so nothing is sent, but Chrome still lets Rhythm see YouTube pages." | Learning was turned off on the phone or web. Turn the switch on again, or choose *remove YouTube access* |
| Learning is on but nothing seems to be learned | Only videos whose title, description excerpt or open transcript names a topic count, and not highlights or BJJ. A video is sent after a minute of it has actually played with its tab in view (ads, skipped parts and background play don't count); allow up to 30 seconds more for the next check, or a minute before Chrome 120. Each video counts once per browsing session, plus one update, at most 200 a day. Nothing is sent while you're signed out of the panel, or signed in to a different account from the one that turned learning on |
| "Stopped in this browser, but your account couldn't be updated…" | Learning stopped here, but the backend couldn't be reached. Turn learning off in the web or phone settings, or use *turn learning off* once the backend is back |
| "Open a YouTube video, then click the Rhythm toolbar icon on that page." | The panel was opened another way, the tab changed, or the page isn't a `www.youtube.com/watch?v=…` page. Click the toolbar icon on the video. With learning on, *Save to Rhythm* and *Not interested* don't need the click |
| *Save to Rhythm*: "Page details are off for your account, so Rhythm didn't read this video." | Turn on *Process permitted page details* and *Enable YouTube* with *Rhythm settings ↗*, or turn learning on, which allows both |
| *Save to Rhythm*: "Rhythm can't tell what this video is about, so nothing was sent." | The title and description excerpt don't name boxing, karate, gym, home exercise or food (or they name highlights or BJJ). Nothing left the browser |
| *Save to Rhythm*: "Open a YouTube video in this window first." | Learning's YouTube permission lets the buttons read the active tab, but it isn't a watch page. Switch to the video's tab |
| The *Rhythm noticed* card never appears | It appears only when the backend has a question: a newly learned interest you haven't pinned or answered. Each interest is asked about once |
| "This video is still loading or its page layout is unsupported…" | Wait until the title shows, then try again. If it keeps happening, YouTube's layout may have changed (see `lib/youtube.ts`) |
| "Screened on this device. No page details were sent…" | The video didn't match your interests. The decision card says why |
| "Capture this page again; its details are out of date." | The capture is more than 2 minutes older than the server's clock, or more than 10 seconds ahead of it. Check the clock on this Mac or the server |
| "The selected page changed. Use the new page to continue." or "The connection ended. Use this page again to reconnect." | The tab navigated, or the panel was closed for more than 20 seconds. Click the toolbar icon and choose *Use this page* |
| "Choose Use this page again to apply this permission." | You changed the transcript checkbox after granting the page |
| *Evaluate this video* is greyed out | No page is granted, or transcript analysis is ticked but the page was granted without transcript reading |
| *Read available transcript* is greyed out | The task was started without transcript analysis, or it's no longer active. Start a new task with analysis on |
| A read ends with "YouTube's transcript for this video couldn't be opened or read…" and then "This acquisition ended. Rhythm will not retry it automatically." | The video may have no captions, or YouTube's layout changed. For this task, supply the text yourself or keep a metadata recommendation. For another read, start a new task |
| "Open this shortlisted video and choose Use this page before reading its transcript." | Open that video, choose *Use this page* (with the transcript checkbox ticked), then *Attach this permitted page* |
| "Video search is not configured. Set YOUTUBE_API_KEY on the backend…" | Add `YOUTUBE_API_KEY` to `mobile/backend/.env` and restart the backend |
| "YouTube search is unavailable: check API access or quota…" | The YouTube Data API refused the request. Check the key and its quota in Google Cloud |
| "Your interests changed. Start a new task using the updated profile." | A new profile revision (newly learned interests, or a changed setting) stops existing tasks. Start a new one |
| "…limit has been reached." or "Finish or cancel an existing task before starting another." | A limit was reached (see *Transcript reads*). Daily limits reset at midnight in `RHYTHM_BUDGET_TIMEZONE` |
| "Pause an existing browser connection before adding another." | Five pages are connected. Pause one, or revoke old ones on the phone |
| *Open profile ↗* does nothing on a Mac | Nothing on the Mac opens the default `buildnorth://` link. Set `WXT_PROFILE_URL` to a web address, or use the phone |

## What was tested

On 2026-10-25, after switching to the website's sign-in (Sync Host):
- `npm run typecheck` passes, and `npm test`: all 15 tests pass. Making `isSignInChange` accept any host, or count the
  removal half of an overwrite, fails test 13.
- `npm run build:local`: host permissions are the backend, the development Clerk instance and `http://localhost/*`;
  YouTube is still only optional. With `WXT_CRX_PUBLIC_KEY` set in `extension/.env`, Chrome gives the extension the ID
  computed from the key.
- That build in Playwright's Chromium, next to the running website at `http://localhost:8081` (signed out, no
  credentials used):
  - The website sets `__clerk_db_jwt` (and `__client_uat`, `0` while signed out) on `localhost`, not `HttpOnly`, and the
    service worker reads the same value through the sync host. It can't read a cookie on another site.
  - Every request the panel's Clerk made to the Frontend API (`/v1/client`, `/v1/environment`) carried the website's
    `__clerk_db_jwt`, and Clerk answered 200, before the extension's origin was in `allowed_origins`.
  - The signed-out panel shows *Sign in on the BuildNorth website*, which opened `http://localhost:8081/sign-in` in a
    new tab; *Sign in here with email and password* opens Clerk's form.
  - A `__client_uat` that turned non-zero on `localhost` reloaded the signed-out panel once; the same cookie on
    `127.0.0.1` didn't.
- The development instance's `allowed_origins` was empty; it is now `["chrome-extension://pgljohlbjkangpaeclifmhfbhbcmomoe"]`
  (the update returned HTTP 204, and reading it back showed the list). The checks above gave the same results
  afterwards.

On 2026-10-22, after adding engagement, *Save to Rhythm* / *Not interested* and the question:
- `npm run typecheck` passes.
- `npm test`: all 12 tests pass. Each of these changes made at least one test fail, so the tests do guard them:
  dropping the visibility check or the ad check from `playedGrowth`; ignoring whether the tab was in front when the
  video opened; scheduling checks without the switch and permission; not removing a stray check (this also fails
  test 12, in Chromium); dropping the short-video threshold; sending the update without 60 s of growth; summing the
  played ranges' ends instead of their lengths; sending only the changed lists to `/rhythm/choices`; not retrying a
  stale save; and sending a reaction without the local check.
- The backend's `tests/test_rhythm_learning.py` and `tests/test_rhythm.py` pass (47 tests).
- `npm run build:local`: the same host permissions as before (the backend and the development Clerk instance) and
  YouTube only under `optional_host_permissions`. Its service worker (about 890 KB) starts in Playwright's Chromium with
  no errors, no checks scheduled, nothing in session storage and no YouTube access.
- The real panel (`App.tsx`) was rendered at 400 and 320 pixels wide with stand-ins for Clerk and Chrome, and the
  backend answered by fixtures. *Save to Rhythm* sent `GET /rhythm/interests` then `POST /rhythm/reactions` with
  `more`, showed the title and the message, and reloaded the question. *Yes* sent `PUT /rhythm/choices` with all six
  choices and the revision, and the card showed the backend's message. A non-matching video and page details being off
  sent nothing (and with details off, nothing was read). Without a toolbar click or the permission the buttons
  explained what to do. With the permission and no click, they read the active tab.
- `readPlayback` on a public YouTube watch page, signed out in Playwright's Chromium: the played total followed real
  playback, the duration was right, and *paused* was reported when the video ended. When YouTube moved to the next video
  in the page, the address changed before `ytd-watch-metadata` did, and the reader returned nothing until both agreed.
  Then the `<video>` had a new source and its played total started again from zero (about 2.5 seconds, although that
  stream's position was 46,790 seconds), so counting from zero when a video opens is right.

On 2026-10-22, after adding learning:
- `npm run typecheck` passes.
- `npm test`: all 7 tests then passed. Removing the permission check from the observer made the permission test fail.
- The backend suite passes (275 tests).
- `npm run build:local`: `.output/chrome-mv3` has host permissions for `http://localhost:8000` and the development Clerk
  instance only, and YouTube only under `optional_host_permissions`. Its service worker (about 880 KB, with clerk-js)
  starts in Playwright's Chromium with all its listeners and no errors.
- Clerk's background client, built the same way, loads in a real MV3 service worker and reports no session when signed
  out. No credentials were used.
- The learning card was rendered with stand-ins for Chrome and the backend: each state above, and the switch's flows.
  Turning on asks Chrome first, then sends `PUT /rhythm/settings` with `learn` and `metadata` on, `youtube` added and
  the current revision (0 without a profile), and only then sets the flag. A refused prompt changes nothing. A refused
  save gives back the permission it had just obtained. Turning off removes the flag, the permission and the session
  data before telling the backend.

On 2026-10-21:
- The production build had host permissions for `http://localhost:8000` and the development Clerk instance only.

Earlier, as recorded in the [integration guide](../mobile/docs/rhythm.md#verification-record):
- **YouTube markup.** A real watch page's details and transcript-panel markup were inspected in an isolated browser.
  *Show transcript* returned HTTP 400 on both videos tried, so the reader correctly returned *unavailable*.
- **An agent.** Claude Code 2.1.302 with `claude-sonnet-5-5` completed a metadata-only recommendation through
  `/rhythm/mcp`, against a fixture database.
- **Search.** Live YouTube Data API search and details lookups worked with the backend key.

Not done yet:
- Signing in with a real account. Earlier automated attempts in the panel stopped at email verification. For the
  website's sign-in, not yet seen: the panel and the worker signed in after signing in on the website; a real sign-out
  and account switch there; signing out in the panel ending the website's session; and Clerk and the backend accepting
  the panel's session tokens.
- Learning with a real account: Chrome's real permission prompt, the worker getting a session token from Clerk while
  signed in, a minute of real playback producing `POST /rhythm/signals` with `engagement`, the update when the tab
  leaves, and the profile then being learned.
- *Save to Rhythm*, *Not interested* and the question against the running backend with a signed-in account, and the
  question's text for real learned evidence.
- The playback check inside the extension's own isolated world on a real page (it was run in the page's main world;
  the values it reads are the same in both), the real `ad-showing` class during an ad (no ad played), and a page in a
  minimized or covered window.
- The full signed-in journey: learned interests → panel page grant → agent recommendation → saved video on the phone.
- A successful live transcript read, including long or non-English transcripts.
- A second agent with a working model. OpenCode's model provider returned HTTP 403.
- Icons, and Chrome Web Store packaging and review (a store listing has its own key and ID, which `allowed_origins`
  then needs). The panel's automatic refresh with a production Clerk instance, whose cookies live on the app's own
  domain rather than the sync host.

## Limitations

- **Pages:** only `https://www.youtube.com/watch?v=…` pages in the main frame. Shorts, embedded players, `m.youtube.com`
  and other sites aren't supported.
- **Vocabulary:** five topics, three purposes and English word lists.
- **Transcripts:** only YouTube's own transcript panel can be read (Rhythm opens it for a read you asked for), and
  real reads are labelled *partial*. Videos without captions have none. There's no audio transcription and no captions download.
- **Page grants:** they don't survive closing the panel or navigating. Each page needs a toolbar click and *Use this
  page*.
- **Learning:**
  - Visibility and ads are seen only at the checks, 30 seconds apart. An interval counts if the page was visible with
    no ad at both ends, even if you switched away and back in between. An ad that starts and ends between two checks
    counts nothing if YouTube plays it as a separate source (which restarts the played ranges), but would count if it
    were part of the video's own stream.
  - Checks are every 30 seconds (a minute before Chrome 120), so a video is sent up to one check after its minute.
  - The update is sent only when the tab moves to another video or page, or closes. A tab left open, or Chrome
    closing, sends none, and the backend keeps the first value.
  - The backend counts the update as a second view of the video (`views` goes up on every send), which gives that
    video a little more weight.
  - A tab that was already showing a video when learning was turned on starts counting from its first check.
  - Only the English word lists in `relevance-rules.json` decide what's kept, so a fitness video described only in
    another language stays in the browser.
  - A newly learned profile stops open tasks, like any new profile revision.
- **Save to Rhythm and Not interested:** a video is placed by its title and description excerpt only, as the backend
  does for reactions, so a video that names its topic only in the transcript can't be saved. With learning off, a
  *Not interested* lasts only until the next settings change (see *How long things are kept*).
- **Lists:** *Worth your time* shows the latest 60 recommendations, and every page grant is labelled "Chrome".
- **Build:** the extension builds only inside this repository, because it shares code with `mobile/`.
