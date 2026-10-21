# Work log: Mac app, Apple Watch, the move off iCloud and one repository (19–21 Oct 2026)

What was built with Claude Code from 19 to 21 October 2026, where it lives, how it was checked, and what is still
open. The detailed guides are elsewhere and this page links to them:

- the Mac app: [mac/README.md](../../mac/README.md)
- the watch: the *Apple Watch* section of the main [README](../README.md#apple-watch)

**Nothing has been committed.** Since 21 Oct 2026 both apps live in one git repository at `~/Developer/BuildNorth`
(`mobile/` and `mac/`), with no commits yet.

## Summary

| # | Request | Result |
|---|---|---|
| 1 | Implement `NorthAssistantMacStarter.zip` | React Native macOS app (`NorthAssistant`), now in `mac/` |
| 2 | Make it look like the iPhone app | Mac UI rebuilt to mirror BuildNorth: sidebar with Today, Coach, Meals, Activity, Profile |
| 3 | Run it on another port | Metro moved from 8081 to **8090** |
| 4 | Use Expo for it, partially | Expo SDK 55 for the dev server, bundling, macOS-capable modules, and a local Swift Expo module (`north-mac`) |
| 5 | Try EAS Build | Custom EAS build that produces an ad-hoc signed `.app` in the cloud |
| 6 | Document the Mac build | Full guide in the Mac project's README, checked claim by claim |
| 7 | Rebuild on EAS with the database fix | Build `6e7adbc2`, downloaded to `~/Downloads/NorthAssistant-EAS` |
| 8 | What can an Apple Watch do? | Briefing on what the watch can do, plus build options |
| 9 | Option A, with SurrealDB agents able to use watch data | SwiftUI watch app inside the Expo iPhone app; health data reaches Agent Memory, the Coach and MCP assistants |
| 10 | Stop iCloud syncing the project | Moved from the iCloud Desktop to `~/Developer`; the three build workarounds and the `*.nosync` setup were removed |
| 11 | Put both apps in one folder and one git repo | `~/Developer/BuildNorth/` with `mobile/` and `mac/`, a fresh git repository at the top, no commits yet |

## 1. Mac app (`mac/`)

A separate project, now in the same repository as the mobile app (see section 4). It mirrors the iPhone app's screens, design tokens, components and
API types, and uses a Mac sidebar.

- **Stack:**
  - `react-native` 0.83.10 + `react-native-macos` 0.83.0, Hermes, New Architecture.
  - Expo SDK 55 provides `expo start` (Metro on 8090), `babel-preset-expo`, `expo/metro-config` (maps `react-native` → `react-native-macos`), `expo-sqlite`, `expo-crypto`, `expo-constants` and `expo-asset`.
  - Xcode still builds the app (`npm run macos`); Expo has no macOS target.
- **`modules/north-mac`:** a local Expo module in Swift that adds:
  - keep-awake (`expo-keep-awake` does nothing on macOS)
  - a Dock badge
  - an SF Symbol view
  - the Application Support folder where `expo-sqlite` stores `buildnorth.db`
- **EAS:**
  - EAS has no macOS platform, so this is an iOS-platform custom build: `eas.json` profile `macos` plus `.eas/build/macos-app.yml`. The output is a Release `.app` and a zip.
  - Run it with `EAS_NO_VCS=1 npx eas-cli@latest build -p ios -e macos`.
- **Fixes needed:**
  - Homebrew Ruby for CocoaPods, and `gem 'nkf'`.
  - A `patch-package` patch for expo-modules-core (duplicate `UIApplication` alias).
  - Pods' deployment target raised to macOS 14.
  - The Release bundle phase resolves `@expo/cli` from the `expo` package.
  - The database location moved off iCloud `~/Documents` (fixing a `%20` folder bug on the way).
- **Status:**
  - It runs on sample data saved on the Mac. It is **not connected to the BuildNorth backend** (no Clerk sign-in yet), and the Coach box is disabled.
  - A follow-up session to connect it was proposed, and is waiting for you to start it.

## 2. Apple Watch (option A)

A native SwiftUI watch app (watchOS 11+) built into the iPhone development build through `@bacons/apple-targets`.
React Native doesn't run on watchOS. The watch talks to the backend directly with its own token.

### On the watch (`targets/watch/`)

- **Today:** plan items with Done, Skip and Undo, the day's check-in, and the last health sync.
- **Check-in:** energy and mood from 1 to 5. Sleep is pre-filled from Apple Health while sharing is on.
- **Health:** Apple Health permission, *Sync now* and upload status. A sync reads the following:
  - sleep (18:00 to 12:00), resting heart rate, HRV, steps, active energy and workouts
  - today so far, plus missed finished days, capped at the newest 7
- **Not linked:** how to link from the phone.
- **Storage:** the token is kept in the watch Keychain, and requests time out after 15 s (30 s for uploads).

### On the iPhone

- **`modules/watch-connectivity/`:** a local Expo module (Swift, WatchConnectivity) that sends the link to the watch, unlinks it, and reports its state.
- **Profile → Apple Watch:** link or unlink, turn health sharing on or off (with a consent prompt), revoke individual links, and see 7 days of summaries.
  - A new link gets its own label.
  - Old links are revoked only once iOS has accepted the new link for delivery.
- **Sign-out and *Delete all my data*:** both revoke the watch links too.

### Backend (`backend/`)

- **Tables (migration `0005_apple_watch`):**
  - `watch_tokens` stores a hash only, with a `bnw_` prefix, a 90-day lifetime and at most 5 per user.
  - `health_days` holds one row per user per day; it is the authoritative copy.
  - `profiles.share_health` is opt-in and off by default.
- **Routes:** `/watch/*` (`routers/watch.py`). A `bnw_` token works only on the watch data routes. Everywhere else, including `/mcp`, it gets 401.

### What agents can use

You asked that SurrealDB agents be able to use the watch data. This is how they get it:

- **Agent Memory:** with sharing on, each finished day becomes one sentence in SurrealDB Agent Memory under `<user>/health/<revision>`.
  - Every change gets a new revision, and the old one is erased.
  - Turning sharing off erases the whole subtree.
  - An outage leaves the day `pending`, with retries.
- **Shared user context:** gains a `health` topic. Requests about health, workouts or the plan get 7 days of summaries from SQL, used by both the Coach (`<health_summary>`) and MCP `get_user_context`.
- **New MCP tool:** `get_health_summary` returns the days plus `missing_days`, so assistants such as Claude, ChatGPT and OpenCode can read it.

## 3. Moving off iCloud (21 Oct 2026)

The project used to live at `~/Desktop/Desktop - Arjun’s MacBook Air/hackathon/BuildNorth`, on an iCloud-synced
Desktop. That location caused three iOS build workarounds and extra steps:

| Workaround (now removed) | Why it was needed |
|---|---|
| `patches/react-native+0.86.3.patch` | The curly apostrophe in the path made the Hermes podspec fail `pod install` ("incompatible character encodings") |
| `patches/expo-modules-jsi+57.1.2.patch` | iCloud adds Finder info to files, and codesign rejected it ("detritus") |
| `plugins/with-quoted-bundle-script.js` | The bundle build phase split the path at the spaces |
| `*.nosync` folders and `npm run icloud:nosync` | Kept `node_modules`, `ios`, `android`, `backend/.venv` and the database out of iCloud |

How the move was done:
- The project was copied to `~/Developer/BuildNorth`, without dependencies or generated folders. Every copied file
  was checked byte for byte against the original.
- Dependencies were reinstalled fresh: `npm ci` with the same lockfile minus `patch-package`, and a new Python venv
  pinned to exactly the old package versions.
- The workarounds were deleted. `postinstall` and `icloud:nosync` were removed from `package.json`, and the plugin
  from `app.json`.
- The backend database moved from `backend/var.nosync/` to `backend/var/`, which is git-ignored.
- `android/` and `ios/` were not copied, since both are generated. A fresh `android/` from prebuild was identical
  to the old one, apart from build output and IDE state. `local.properties` (the SDK path) was copied over.
  `./gradlew assembleDebug` then built successfully, and the iOS build and watch end-to-end checks passed again.

iCloud had already offloaded some files to the cloud and couldn't download them, which showed the risk:
- 4 git objects. All 4 were rebuilt exactly from the current files, and `git fsck` is clean.
- The stock git hook samples, which `git init` restored.
- `.env.opencode` (the OpenCode MCP token). It is lost: create a new connection token in the app.

The Desktop copy is unchanged and can be deleted once you're happy with the new one.

## 4. One repository (21 Oct 2026)

Both apps now live in one folder and one git repository:

```
~/Developer/BuildNorth/        git repository (branch main, no commits yet)
├── README.md, CLAUDE.md       layout, quick start, notes for AI agents
├── .gitignore                 secrets and editor files, repo-wide
├── mobile/                    the Expo app (iPhone, Android, watch) + backend/ (was ~/Developer/BuildNorth)
└── mac/                       the Mac app, project name NorthAssistant (was ~/Developer/NorthAssistant)
```

- The old repository (the create-expo-app initial commit, repaired after iCloud) was moved to the Trash as
  `BuildNorth-mobile-old.git`, and a fresh one was created at the top. Each app keeps its own `.gitignore`.
- Both folders were moved by renaming, so nothing was copied. What stored absolute paths was regenerated:
  the backend venv (same package versions), the iOS Pods of both apps, and the build output.
- `EAS_NO_VCS=1` is still used for the Mac app's EAS builds, so only `mac/` is uploaded.

## How to run

- **Mac app:** `cd ~/Developer/BuildNorth/mac && npm start`, then `npm run macos`.
- **iPhone and watch:** follow the build steps in the README (prebuild, `pod install`, `run:ios`; no extra steps). After building:
  - Start Metro with `npx expo start` from this folder.
  - If the simulator shows **"No script URL provided"**, that is a debug build with no Metro running. Start Metro, then press ⌘R.
- **Watch on the simulator:** the watch app is not installed automatically. Install it with `xcrun simctl install <watch> …/Debug-watchsimulator/watch.app`.

## How it was checked (latest run 21 Oct 2026)

- **Backend:** 234 tests pass, 54 of them in `tests/test_watch.py`.
- **Watch:** 156 model checks pass, and the app typechecks for watchOS 11 (`bash scripts/check-watch-models.sh`).
- **Phone:** `tsc` and `expo lint` pass, and 17 Node tests pass (the plugin's 7 tests went with the plugin). Use Node 20.19+.
- **iOS build:** after a clean prebuild, the iPhone app with the embedded watch app built with 0 errors. It ran on paired iPhone 17 and Apple Watch Series 12 simulators.
- **End to end on a scratch backend** (its own SQLite file, memory and AI off, a fictional user):
  - The rebuilt watch app fetched `/watch/today` (200).
  - The watch token was refused at `/profile` and `/mcp`.
  - Plan done, check-in merge, and complete and partial health days all worked.
  - An MCP assistant read the days through `get_health_summary` and `get_user_context`.
- **Reviews:** several rounds of multi-agent review. Each finding was verified before it was fixed, covering token isolation, sharing and erase ordering, write races, consent text, timeouts and backfill.
  - The last round found that health sync could hold the SQLite write lock while it waited on Agent Memory. This is fixed, with a regression test.

### Not verified yet

- Looking at or tapping the watch UI (simulator screen access wasn't granted).
- Linking from the phone over WatchConnectivity (needs a Clerk sign-in in the simulator).
- Real Apple Health data on a physical watch. The watch's own Health upload also hasn't run in the simulator yet, because Health permission needs a tap.
- `scripts/live_check.py` against the real SurrealDB Agent Memory.

## Open items

- **Preference code holds the database lock.** The older preference code (`preferences.py`, `assistant_proposals.py`) has the same lock bug that was fixed in health sync. A concurrent write, including a watch upload, can fail with "database is locked" while memory is slow. A follow-up session to fix it was proposed.
- **No complication yet.** The watch complication (a watch-face widget) was planned for the first version but not built. It needs a separate `watch-widget` target.
- **Unexpected `packageManager` field.** `package.json` has `"packageManager": "yarn@4.6.0…"` but the project uses npm (`package-lock.json`). This was not changed here.
- **OpenCode token.** Create a new connection token for OpenCode in the app, and put it in `.env.opencode`.
- **Mac app not connected.** It still needs to be connected to the backend and Clerk (see the proposed session).
