# React Native web app: implementation and verification

Implemented on 21 October 2026 in the existing Expo SDK 57 application. This extends
BuildNorth's phone app and Rhythm companion; it does not introduce a separate web
project, backend, database or authentication system.

## What changed

- Video recommendations are turned off for now (`RECOMMENDATIONS_ENABLED` in `src/lib/rhythm.ts`, with
  `RHYTHM_RECOMMENDATIONS` on the server; see [Rhythm](rhythm.md#recommendations-are-turned-off)). The Overview shows
  *Ask your coach*, learning / interests / YouTube sharing figures and the Personalisation card instead of
  recommendations, and the Content library keeps only *Connections* and *Memory*. The items below describe the full app.
- Added a responsive web navigation layout with Overview, Coach, Meals,
  Activity, Content library, Interests & sharing, and Profile. It uses the app's
  light and dark theme and the same Material Symbols icons as the Android tabs
  (`expo-symbols`). Below 900 px wide it becomes a scrolling top bar.
- Added a web overview with saved video recommendations, a Personalisation card,
  sharing status, permitted browser pages, and controls to save/unsave videos or
  revoke page access.
- Added a web sign-in/sign-up layout using the existing Clerk authentication screens.
- Kept the existing authenticated screens and API client for coach, meals, activity,
  profile, interests, agents, memory and data management.
- Added optional display-cookie controls, separate from content-sharing consent.
- Added browser-specific sign-out: clear the current account's browser cache and
  Clerk session without revoking Apple Watch links.
- Added extension links to the web overview and interests editor, plus build-time
  validation of the configured web URL. Updated panel wording to mention both apps.
- Added `npm run build:web` for the Expo static export.

### Learned interests (22 October 2026)

Rhythm's interests are now learned by the backend instead of typed in (see the
[Rhythm guide](rhythm.md)). On the web and phone:

- **Interests & sharing** (`profile/interests.tsx`) is a short settings page. **Personalised by AI**
  has one switch, **Learn my interests automatically** (off by default), with the AI orb beside it,
  and says "Still learning…" until something has been learned. **Sharing permissions** keeps the
  YouTube, transcript, agent and memory switches and the retention disclosure. Each switch saves
  through `PUT /rhythm/settings` as it changes; switching off learning, YouTube (while learning is on)
  or private memory asks first. A stale revision refetches and applies the one change again.
- The Overview's "Your interests" card is now **Personalisation**: learning on or off (or still
  learning) and a link to the settings. Learned topics, goal text and the `/rhythm/learned`
  evidence were not shown at first; the next change shows and edits them.

### Editable learned interests (22 October 2026)

What Rhythm learned is now shown and editable, and the user's own choices are kept apart from
what was inferred and always win (see [the Rhythm guide](rhythm.md#what-rhythm-learned-and-the-users-own-choices)).

- **Interests & sharing** has three cards. **Personalised by AI** keeps the learning switch.
  **What Rhythm learned** (`components/profile/learned-interests.tsx`; titled **Your interests**
  while learning is off) lists each topic with its state: **You chose it** (pinned),
  **Learned** with a short why ("5 videos · 2 chats"), **Noticed** (not enough yet) or
  **You said not interested** (blocked). Learned and noticed topics have **Keep** and
  **Remove**, pinned ones **Unpin**, blocked ones **Undo**, and any topic with evidence a
  bin button, **Forget the evidence**, which asks first. **Add an interest** pins one of
  the remaining topics. A "You've watched…" prompt, when there is one, sits at the top with
  **Yes**, **Not interested** and **Forget this**, like the extension's. Below, **Level**,
  **Video length** and **Equipment** show the value in use and "You set it" or "Rhythm learned
  it"; **Change** opens chips (level; 10/20/30/45/60 min; each with **Learn it**) or the
  equipment tag picker with **Save**, **Learn it** and **Cancel**. While an open video task
  holds back a learned update, one muted line says so. **Sharing permissions** is unchanged.
- With nothing learned or chosen yet, the middle card is **Start with a few picks**: topic
  chips and an optional level, saved together with **Use my picks**. It works with learning
  on or off.
- Every change saves at once through `PUT /rhythm/choices` with the full set of choices,
  built by `lib/interest-choices.ts` (tested in `interest-choices.test.mjs`). A stale revision
  refetches and re-applies only that one change; a second conflict says the interests changed
  on another screen. The page intro says "Saving…" while a choice or a switch saves. Messages
  appear under the control that made the change.
- On phones and narrow pages each topic's actions sit under its name; wider pages keep them
  on the same row and indent the editors under their values.
- The Overview's **Personalisation** card shows the pinned and learned topics as small pills
  (your own picks in the accent colour) and links to **Edit interests**.

### Web design pass (22 October 2026)

The web build has its own look. The phone app keeps its current one: every change
below is limited to the web with `Platform.OS === 'web'` or a `.web.ts(x)` file,
except where noted.

- **Theme:** `constants/theme.ts` has a web palette (tinted page, white or raised dark
  surfaces, a `border` token). Cards get a hairline border and a faint shadow. Body
  text is regular weight, page titles are slim and left-aligned
  (`hooks/use-stack-options.web.ts`), and text fields show an accent focus border.
- **Shared pieces:**
  - `Screen` takes `wide` (a 1,120 px column for grids), keeps footers in line with
    the page column, and uses 16 px side padding under 600 px.
  - `Pill` has dark-mode colours, and the `ListItem` chevron is an icon on every
    platform.
  - Secondary buttons and unselected chips have a visible outline on the web.
- **Confirmations:** `Alert.alert` does nothing on react-native-web. Every confirmation
  now goes through `lib/confirm.ts` (`confirmAction`): the browser's dialog on the
  web, `Alert` on phones. Before this, Delete, Clear and similar buttons silently did
  nothing on the web.
- **Coach:** coach replies render Markdown (`lib/markdown.ts`, with tests), in a
  centred 760 px conversation with a rounded message box. Enter sends and Shift+Enter
  adds a line. The empty state offers starter prompts.
- **Meals, Activity, Profile and Rhythm:** recipe and routine card grids, two-column
  recipe and connection pages, grouped settings with icons, and titled form cards.
  Their components live in `components/{meals,activity,profile,coach}/`.

### Motion and AI look (22 October 2026)

- **Shared motion** (`components/motion.tsx`, Reanimated 4 CSS animations):
  - `FadeIn`/`Enter` and `Stagger` for entrances; each item's delay is fixed when it
    mounts, so refetches every 10–15 s never replay them.
  - `Skeleton`/`SkeletonCard` for loading, `Pop` for check marks, `FillBar` for progress,
    `Collapse` for disclosures.
  - `useHover` + `liftStyle` for clickable cards on the web.
  - Everything stops when the system asks for reduced motion (checked in a browser with
    `prefers-reduced-motion: reduce`: no animations run, everything renders).
- **AI identity:** `AiColors` (violet → blue → cyan) in `constants/theme.ts`, `components/gradient.tsx`
  (web `backgroundImage`, phone `experimental_backgroundImage`), and `components/ai-orb.tsx`. The orb
  turns slowly, breathes while thinking, and can be `still`: in a long chat only the newest reply's orb
  moves, to save battery. It appears in the sidebar, the sign-in page, the Overview's "Ask your coach"
  card, every coach reply, and `components/reading-card.tsx` while the AI reads a pasted recipe or workout.
- **Coach:** a thinking indicator with an elapsed timer, replies that reveal block by block (screen
  readers get the whole reply at once), a welcome hero with a gradient headline, a gradient ring on the
  message box, and a scroll-to-latest button.
- A hidden browser tab or pane only advances animations when it paints, so entrances can look stuck
  there; they finish in about 0.6 s in a visible window.

Expo Router's hot reload can change the address bar to `/approvals` while the page
stays the same, after a change to a module many routes import (for example
`components/ui.tsx`). It only happens with the development server; reload the page.

The overview refreshes recommendations and browser connections every 15 seconds
while mounted, using the existing `rhythm` query keys. It shows up to six
recommendations, excluding dismissed entries, and links to the complete content
management screen. Rhythm queries are excluded from the existing persisted cache.
The dashboard's library counts describe returned recommendations, not watch time
or a complete browsing history.

## Source map

Paths below are relative to the repository root.

| File | Responsibility |
| --- | --- |
| `mobile/src/app/(app)/(tabs)/_layout.web.tsx` | Responsive web sidebar/navigation; native tabs remain in the existing layout |
| `mobile/src/app/(app)/(tabs)/(today)/index.web.tsx` | Web overview, recommendations, personalisation status and page-access controls |
| `mobile/src/app/(auth)/_layout.web.tsx` | Web authentication layout around the existing sign-in/sign-up routes |
| `mobile/src/components/web-cookie-settings.tsx` | Optional cookie controls, withdrawal and browser-storage feedback |
| `mobile/src/components/wordmark.tsx` | The "BuildNorth" text logo shared by the web layouts |
| `mobile/src/hooks/use-stack-options.web.ts` | Slim, left-aligned page titles on the web |
| `mobile/src/lib/confirm.ts` | Confirmation dialogs that work on the web and on phones |
| `mobile/src/lib/markdown.ts`, `markdown.test.mjs` | Safe Markdown parsing for coach replies, with tests |
| `mobile/src/components/coach/` | Coach messages, Markdown rendering, message box and welcome |
| `mobile/src/components/meals/`, `activity/`, `profile/` | Cards, grids and sections for those screens |
| `mobile/src/lib/browser-preferences.ts` | Cookie parsing and serialization |
| `mobile/src/lib/browser-preferences.test.mjs` | Cookie acceptance, expiry, scope and removal checks |
| `mobile/src/hooks/use-sign-out.web.ts` | Browser-only sign-out behavior |
| `mobile/package.json` | `build:web` script |
| `extension/entrypoints/sidepanel/App.tsx` | Web links and updated setup wording |
| `extension/wxt.config.ts` | Web URL validation; no new host permission |
| `extension/.env.example` | `WXT_WEB_APP_URL` example |

The existing Rhythm API, database migration, relevance screening, transcript
reader, MCP tools and retention behavior were reused. They were already present
when this web work began; see the [Rhythm guide](rhythm.md).

## Run locally

From the repository root, use separate terminals:

```sh
cd mobile/backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```sh
cd mobile
npm run web -- --port 8081
```

Open [the web app](http://localhost:8081) and sign in with the same Clerk account as
the phone and extension. Existing onboarding still applies to new accounts.
Use `EXPO_PUBLIC_API_URL` for the backend address and the existing
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` for Clerk. Keep secrets out of the web bundle.

For the Chrome companion:

```sh
cd extension
npm run build:local
```

Load `extension/.output/chrome-mv3` through Chrome's **Load unpacked** control, or
reload an already loaded copy after rebuilding. `WXT_WEB_APP_URL` defaults to
`http://localhost:8081`; set it to the web app's origin when using another address.
The existing **Open profile** phone deep link is retained. The new **Open web
interests** and **Open web dashboard** links carry no cookies or session tokens.

## Content sharing and cookies

The web app cannot use its cookies to read what a person consumes on other sites.
Content access uses the existing, explicit Rhythm page-grant flow:

1. In **Interests & sharing**, turn on **Learn my interests automatically** and
   **YouTube with page details**. Each switch saves as it changes. Pages can be
   permitted once Rhythm has learned something from coach chats or watched
   workout and recipe videos, or once you've chosen a few quick picks.
2. Sign into Rhythm using the same account and backend.
3. Open a supported YouTube watch page, click Rhythm's toolbar icon, and choose
   **Use this page**. Eligible metadata includes its title, channel, link, visible
   description excerpt and duration.
4. A transcript requires separate profile and page consent plus a task. A page
   grant alone does not automatically generate a recommendation.
5. Review recommendations in the web app or extension. Revoke page access in the
   web overview; manage other sharing, memory and deletion controls in Profile.

This records permitted content and recommendations, not verified consumption or
watch completion. Only the existing YouTube adapter is supported. No background
browsing collector or other health-site adapter was added.

| Storage | Behavior |
| --- | --- |
| Essential authentication | Managed by Clerk; reused across the existing account flow |
| Optional display cookie | `buildnorth_display=compact`, written only when chosen; reduces padding in the cookie-settings panel |
| Cookie lifetime and scope | 30 days, host-only, `Path=/`, `SameSite=Lax`, `Secure` on HTTPS |
| Cookie withdrawal | **Use essential only** expires the optional cookie; browser failures are reported in the panel |
| Cookie contents | Display preference only; no health data, browsing history, identity or tokens |
| Extension cookies permission | Existing Clerk SDK requirement, with host access limited to the configured backend and Clerk origin |
| Saved app records | Existing per-account offline cache; this is separate from the optional cookie |

Accepting the optional cookie does not enable metadata sharing, transcripts,
external-agent access or memory. Those remain separately controlled by the
existing consent model. Retention and deletion rules are documented in the
[Rhythm guide](rhythm.md).

## Verification performed

These checks passed during implementation:

| Check | Result |
| --- | --- |
| `mobile`: `npm run typecheck` | Passed |
| `mobile`: `npm run lint` | Passed |
| `mobile`: `node --experimental-strip-types --test src/lib/browser-preferences.test.mjs` | 2 tests passed |
| `mobile`: `npm run build:web` | Static export completed in `mobile/dist/` |
| `extension`: `npm run typecheck` | Passed |
| `extension`: `npm test` | All 4 existing Playwright tests passed |
| `extension`: `npm run build:local` | Chrome MV3 build completed in `.output/chrome-mv3` |
| `git diff --check` | Passed |
| Local frontend HTTP check | `http://localhost:8081` returned 200 |
| Local backend HTTP check | `http://localhost:8000/openapi.json` returned 200 after startup |
| Browser inspection | Clerk initialized and the web sign-in layout and form rendered at `/sign-in` |

The extension tests cover bounded metadata capture, relevance screening,
partial-transcript behavior, and unpacked MV3 page permissions/storage/navigation.
They use fixtures and are not evidence of signed-in web synchronization. The
backend test suite was not rerun for this web-only implementation.

The export reported the existing missing `ios.appleTeamId` warning. It did not
prevent the web build; no native signing configuration was changed.

## Remaining verification and deployment

- Complete a real-account journey: web learning switch → watched videos → learned
  profile → extension refresh → page grant → recommendation → saved video visible
  in the web app.
- Exercise dashboard mutations, cookie choice/reload/withdrawal, browser sign-out
  and responsive layouts in a signed-in browser. These were implemented and checked
  statically but not verified end to end with a live account.
- Existing live transcript, agent and extension account checks remain as recorded
  in the [Rhythm guide](rhythm.md#remaining-live-checks).
- The web app is local and has not been deployed. A hosted version needs an HTTPS
  frontend/backend, the correct public API URL, and its frontend origin allowed by
  backend CORS and Clerk's authorized parties when configured. The current backend
  CORS configuration allows localhost web origins.

The frontend and backend were started locally during implementation. Those processes
are session-dependent; use the commands above if they are no longer running.
