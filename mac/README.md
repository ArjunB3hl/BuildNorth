# Rhythm for Mac — Demo version

A native macOS version of the Rhythm iPhone app, built with React Native for macOS plus parts of Expo SDK 55.
The UI uses Today, Coach, Calendar and Profile, shared design tokens, components and API data types, with a Mac
sidebar instead of a tab bar.

**Status:** demo version using data saved on this Mac. Live account syncing is not connected. Coach can use a
judge-provided Claude API key from Profile → AI connections; the key stays in memory until disconnect or quit.

| | |
|---|---|
| Project | `mac/` in the BuildNorth repository (`~/Developer/BuildNorth/mac`); the Expo iPhone app and backend are in `mobile/` |
| App | `Rhythm.app`, bundle ID `org.reactjs.native.NorthAssistant`, window title "Rhythm · Demo version", macOS 14+ |
| React Native | `react-native` 0.83.10 + `react-native-macos` 0.83.0 (Microsoft), Hermes, New Architecture (Fabric) |
| Expo | SDK 55 (`expo` 55.0.31): Expo CLI dev server and bundler, `expo-sqlite`, `expo-crypto`, `expo-constants`, `expo-asset`, and a local Expo module (`modules/north-mac`) |
| Native toolchain | Xcode 27.1, CocoaPods 1.15.2 through Bundler on Homebrew Ruby 3.4 |
| Dev server | Expo CLI (Metro) on port **8090** |
| Cloud builds | EAS Build custom build, project `@arjun273773/northassistant` |

Expo has no macOS target: there is no `expo run:macos`, no prebuild for `macos/`, and EAS Build officially builds
only Android and iOS. Xcode builds the app; Expo provides the dev server, the JavaScript bundling, the native modules
that support macOS, the module API for our own Swift code, and the EAS cloud machines.

## Requirements

- **Full Xcode** (27.1 used), opened once with its components installed, and selected as the active developer
  directory. Command Line Tools alone can't build it.
  - Check with `xcode-select -p`, which must print `/Applications/Xcode.app/Contents/Developer`.
  - If it prints `/Library/Developer/CommandLineTools`, which is common when Homebrew installed them first, run
    `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- **Node.js** 20.19.4 or later (23.5 locally; EAS builds use 22.23.3) and npm.
- **Ruby 3.4 from [Homebrew](https://brew.sh).** Bundler comes with it and switches to the 2.6.9 recorded in
  `Gemfile.lock`.
  - On this Mac it's `/opt/homebrew/opt/ruby` (3.4.4, installed in 2025).
  - On a new Mac, install `brew install ruby@3.4` and use `/opt/homebrew/opt/ruby@3.4/bin` wherever this README
    says `/opt/homebrew/opt/ruby/bin`. Homebrew's plain `ruby` formula is now Ruby 4.0, which this setup hasn't
    been tested with.
  - **Don't use the system Ruby 2.6.** It has Bundler 1.17, so `bundle` stops with "Could not find 'bundler'
    (2.6.9)", and the locked gems need Ruby 3.1 or later. Don't fix that by installing Bundler into the system
    Ruby.
- **An Expo account with access to the `arjun273773` account**, for EAS builds only (see *Build in the cloud with
  EAS*).

## Setup

```bash
cd ~/Developer/BuildNorth/mac
npm install
```

`npm install` also runs `patch-package` (the `postinstall` script), which reapplies the fix in `patches/`.

```bash
export PATH="/opt/homebrew/opt/ruby/bin:$PATH" LANG=en_US.UTF-8
bundle install
bundle exec pod install --project-directory=macos
```

Gems install into `vendor/bundle` (see `.bundle/config`).

Re-run `pod install` after any of these:
- adding or removing a package with native code
- adding or removing files in `modules/north-mac`
- changing its podspec or `expo-module.config.json`

Edits to its existing Swift files only need a rebuild.

### Copying the project to another Mac

Clone the BuildNorth repository; git leaves out `node_modules`, Pods, `vendor/bundle`, build output and
`macos/.xcode.env.local` (this Mac's Node path, which `pod install` creates when it's missing). Then follow *Setup*
from `mac/`.

## Run (development)

Terminal 1, the dev server (Expo CLI, port 8090):

```bash
npm start
```

Terminal 2, build and open the app:

```bash
npm run macos
```

`npm run macos` is `react-native run-macos --no-packager`: it runs `xcodebuild` on `macos/NorthAssistant.xcworkspace`
(scheme `NorthAssistant-macOS`, Debug) and opens the app. The first build takes several minutes; later builds are
incremental. You can also open the workspace in Xcode and press Run (open the `.xcworkspace`, not the `.xcodeproj`):

```bash
open macos/NorthAssistant.xcworkspace
```

The Debug app loads its JavaScript from the dev server, so keep `npm start` running; edits appear through Fast
Refresh. Port 8090 keeps it clear of the BuildNorth Expo dev server. The port is set in two places that must match:
the `start` script in `package.json` and `metroPort` in `macos/NorthAssistant-macOS/AppDelegate.swift` (which sets
React Native's `jsLocation`). `run-macos --port` doesn't work here, because it is ignored together with
`--no-packager`.

After installing JavaScript packages, restart the dev server with a clear cache, or its workers won't see them:

```bash
npm start -- --clear
```

## Build a Release app on this Mac

```bash
cd macos
xcodebuild -workspace NorthAssistant.xcworkspace -scheme NorthAssistant-macOS -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath build/DerivedData ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGN_IDENTITY=- build
```

The app is written to `macos/build/DerivedData/Build/Products/Release/Rhythm.app`. A Release build embeds
the JavaScript as Hermes bytecode (`Contents/Resources/main.jsbundle`), bundled by Expo CLI's `export:embed`, so it
runs without the dev server.

`ARCHS=arm64` builds for Apple silicon only. Dropping `ARCHS` and `ONLY_ACTIVE_ARCH` should give a universal app,
since the macOS Hermes framework includes x86_64, but that hasn't been built or tested.

`CODE_SIGN_IDENTITY=-` signs it ad hoc (no Apple certificate); see *Opening the app on another Mac*.

## Build in the cloud with EAS

EAS has no macOS platform, so the Mac app is built as an **EAS Build custom build**. EAS starts an iOS-platform job
that skips Apple credentials (`withoutCredentials`) and runs only the steps in `.eas/build/macos-app.yml` on an EAS
macOS machine:

1. `eas/checkout`, then `eas/install_node_modules` (`npm ci`; the `postinstall` patch runs here).
2. A toolchain check: prints the Xcode, macOS SDK, Node, Ruby and Bundler versions.
3. `bundle install`, then `bundle exec pod install` in `macos/`.
4. The Release `xcodebuild` above, for arm64, signed ad hoc.
5. The app is zipped with `ditto`. Two artifacts are uploaded: the `.app` as the build's application archive,
   and `Rhythm-macOS.zip` as a build artifact.

The `macos` profile in `eas.json` pins the image `macos-tahoe-26.6-xcode-27.1` (the same Xcode build as this Mac,
27A9275), Node 22.23.3, Bundler 2.6.9 and the `medium` resource class.

Three more things make it work:

- **`.gitignore` ends with `!.eas/build/`.** The Xcode rule `build/` would otherwise hide `.eas/build/`, and
  eas-cli refuses to start with "Custom build configuration file … is ignored". With `EAS_NO_VCS=1`, eas-cli
  uses `.gitignore` to decide what to upload. Don't add an `.easignore`: it would replace `.gitignore`
  completely.
- **Keep the leftover `ios/` folder** from the React Native template. eas-cli reads a scheme and bundle ID from it
  before uploading, even though the custom build never builds it.
- **Set `EAS_NO_VCS=1` on every eas command.** This is how every build so far was made: it uploads just `mac/`
  from the working folder. Without it, eas-cli uses git and works from the repository root, which also holds the
  mobile app (not tried).

Before the first build, log in with an Expo account that has access to the `arjun273773` account. `app.json`'s
`owner` and `extra.eas.projectId` point at `@arjun273773/northassistant`.

```bash
EAS_NO_VCS=1 npx eas-cli@latest login
```

```bash
EAS_NO_VCS=1 npx eas-cli@latest whoami
```

To build under your own account instead, remove `owner` and `extra.eas` from `app.json`, then link a new project
with `EAS_NO_VCS=1 npx eas-cli@latest init`.

Start a build:

```bash
cd ~/Developer/BuildNorth/mac
EAS_NO_VCS=1 npx eas-cli@latest build -p ios -e macos
```

It uploads a compressed archive of about 330 KB, made from about 1 MB of source. It leaves out `node_modules`, Pods,
`vendor/bundle`, build output and `.xcode.env.local`.
The command prints a build page link (`https://expo.dev/accounts/arjun273773/projects/northassistant/builds/<id>`);
add `--no-wait` to return straight away. Builds have taken about 4½ minutes on EAS's Apple M4 Pro machines, plus a
short queue. To preview exactly what would be uploaded, without uploading:

```bash
EAS_NO_VCS=1 npx eas-cli@latest build:inspect -p ios -s archive -e macos -o /tmp/na-eas-archive --force
```

Download a finished build:

```bash
EAS_NO_VCS=1 npx eas-cli@latest build:download --build-id <id> --all-artifacts
```

It prints both paths in eas-cli's temporary cache:
- the extracted app, named `<project id>_<build id>.app`
- the zip, named `artifacts-<build id>.zip`, which is the uploaded `Rhythm-macOS.zip`

Copy the app somewhere permanent with `ditto`, giving it its real name, for example:

```bash
ditto "<printed .app path>" ~/Downloads/NorthAssistant-EAS/Rhythm.app
```

On expo.dev these builds appear as iOS builds (store distribution) under the template's iOS bundle ID; that is
only a label. Each build most likely uses one of the Free plan's 15 iOS builds per month (Expo's docs don't state
this for custom builds). The Free plan has a 45-minute build timeout and no overage charges.

### Opening the app on another Mac

Builds are signed ad hoc and not notarized. Gatekeeper only blocks a copy that carries the quarantine flag.

- **No flag:** apps fetched by eas-cli, built locally, or copied by USB disk, `scp` or `rsync`. These open
  normally.
- **Flagged:** copies downloaded in a browser, or sent by AirDrop, Mail or Messages. These are blocked until you
  allow them in System Settings › Privacy & Security › *Open Anyway*, or run
  `xattr -dr com.apple.quarantine Rhythm.app`.

Moving a copy to another Mac hasn't been tested. Distributing it properly needs an Apple Developer ID
certificate and notarization, which aren't set up.

## How it was built

1. **Starter.** `setup.sh` from `NorthAssistantMacStarter.zip` (kept in the BuildNorth folder; its README is
   `STARTER_README.md`) created the project with `@react-native-community/cli` 20.2.0 (React Native 0.83.10) and
   `react-native-macos-init` 2.1.3, which added `react-native-macos` 0.83.0 and the `macos/` Xcode project. Two
   fixes were needed:
   - **Ruby and CocoaPods.** The system Ruby 2.6 can't install the locked gems, so Homebrew Ruby 3.4 is used. The
     Gemfile's `xcodeproj < 1.26` pin keeps CocoaPods at 1.15.2. Through xcodeproj, CocoaPods loads
     CFPropertyList 3.0.8, which requires `kconv`. Ruby 3.4 ships that library only as the bundled `nkf` gem, and
     Bundler won't load it unless the Gemfile lists it, so `gem 'nkf'` was added.
   - **AppDelegate.** The generated `AppDelegate.swift` called `super.init()` before setting its `let` properties,
     which Swift doesn't allow. `super.init()` now comes last.
2. **UI rebuilt to mirror the iPhone app** (`src/`). Colours, spacing, tones and the component set (cards, pills,
   chips, ratings, steppers, list rows, notices, buttons) are ported from BuildNorth's `src/constants/theme.ts`,
   `src/components/ui.tsx` and `form.tsx`, with hover states and pointer cursors added. Navigation is a sidebar with
   a back stack per section (`src/navigation.tsx`). Types and date helpers are copied from BuildNorth's
   `src/lib/types.ts` and `src/lib/dates.ts`. The window title and minimum size (900 × 600) are set in
   `AppDelegate.swift`.
3. **Dev server moved to port 8090** (see *Run*).
4. **Expo added partially**, following Microsoft's guide
   (https://microsoft.github.io/react-native-macos/docs/guides/installing-expo-modules). Expo SDK 55 was chosen
   because it pins React Native 0.83.10, the same version as `react-native-macos` 0.83.
   - **Bundling:** `babel.config.js` uses `babel-preset-expo`. `metro.config.js` builds on `expo/metro-config` and
     maps `react-native` imports to `react-native-macos` for macOS bundles. `npm start` runs `expo start`, and the
     Debug bundle URL is Expo's `.expo/.virtual-metro-entry` (`AppDelegate.swift`).
   - **Native linking:** `macos/Podfile` calls `use_expo_modules!` and gets the community-module config from
     `expo-modules-autolinking`.
   - **Release bundling:** the Xcode phase "Bundle React Native code and images" runs Expo CLI's `export:embed`
     through `react-native-macos/scripts/react-native-xcode.sh`. `@expo/cli` is resolved from the `expo` package,
     because it isn't hoisted to the top-level `node_modules`. The lookup in Microsoft's guide,
     `require.resolve('@expo/cli')`, fails here without stopping the build. The log shows `Cannot find module
     '@expo/cli'` and the phase falls back to React Native's bundler. The first EAS build showed this.
   - **Expo modules used:** `expo-sqlite` saves the app's data, `expo-crypto` generates IDs, and `expo-constants`
     fills the Profile › This Mac card.
   - Fixes needed along the way are listed under *Expo on macOS*.
5. **`NorthMac`, a local Expo module in Swift** (`modules/north-mac`), written with the Expo Modules API, for Mac
   features Expo doesn't cover (see below).
6. **EAS Build** set up as a custom build (see above).
   - **Before the first build:** a template typo was fixed. The Xcode project pointed at
     `NorthAssistant-macos/Info.plist` while the folder is `NorthAssistant-macOS`, which only works on a
     case-insensitive disk.
   - **The first build** exposed the `@expo/cli` lookup problem, now fixed.
7. **Database location fixed.** Checking these docs showed that `expo-sqlite` had been writing to a folder literally
   named `~/Library/Application%20Support` (see *Expo on macOS*). `NorthMac` now passes a `file://` URL, and the
   stray folder was moved to the Trash. Its data matched the real folder's copy, so nothing was lost.

## Expo on macOS

Only some Expo modules compile for macOS. Check a module's podspec for `:osx` before adding it: an iOS-only module
breaks `pod install` for the whole app.

| SDK 55 module | macOS |
|---|---|
| `expo-modules-core`, `expo-constants`, `expo-file-system`, `expo-asset`, `expo-font`, `expo-crypto`, `expo-sqlite`, `expo-web-browser`, `expo-linking` | Yes (declares `:osx`) |
| `expo-keep-awake` | Compiles, but does nothing on macOS. `NorthMac.setKeepAwake` is used instead |
| `expo-clipboard`, `expo-secure-store`, `expo-image`, `expo-symbols`, `expo-haptics`, `expo-notifications`, `expo-localization`, `expo-application`, `expo-device`, `expo-system-ui`, `expo-sharing`, `expo-speech` | No (iOS/tvOS only) |
| `@expo/dom-webview` (pulled in by `expo`) | No: excluded in `package.json` › `expo.autolinking.exclude` |
| `@expo/log-box` (pulled in by `expo`) | Declares `:osx`, but its native code is UIKit-only and only compiles in when `EXPO_UNSTABLE_LOG_BOX` is set. It also brings in the iOS-only `@expo/dom-webview`. Excluded the same way |

To add a module:

```bash
npx expo install <module>
```

Then do four things:

1. Remove any `plugins` entry `expo install` adds to `app.json`. Config plugins only run in `expo prebuild`, which
   macOS doesn't use.
2. Make sure the module is a direct dependency. Copies nested inside `node_modules/expo` can't be imported by app
   code or by other modules (`expo-asset` and `expo-constants` had to be added for this reason).
3. Run `bundle exec pod install --project-directory=macos`.
4. Restart the dev server with `npm start -- --clear`.

These changes make Expo build on this setup:

- **Patch:** `patches/expo-modules-core+55.0.26.patch`, applied by `patch-package`. React Native macOS 0.83
  declares `@compatibility_alias UIApplication NSApplication` in `RCTUIKitCompat.h`. `expo-modules-core`'s
  `Platform.h` declares it again, which is a compile error ("conflicting types for alias 'UIApplication'"). The
  patch skips Expo's copy when React Native's header exists. This is still unfixed in `expo-modules-core` 55 and 56.
- **Podfile `post_install`:** lifts every pod's `MACOSX_DEPLOYMENT_TARGET` to 14.0. Expo podspecs declare macOS
  11.0, which Xcode 27 rejects (its minimum is 12.0).
- **Jest:** uses the `jest-expo` preset. `jest.setup.js` gives tests a real `randomUUID`, because jest-expo's
  stubbed `expo-crypto` returns `undefined`.
- **`expo-sqlite` and paths with spaces:** expo-sqlite runs the database directory through Swift's `URL(string:)`.
  - A plain path containing a space comes back percent-encoded, so a database in "Application Support" lands in a
    new folder literally named `Application%20Support`.
  - Pass a `file://` URL instead, as `NorthMac.appDataDirectoryUri` does. expo-sqlite's own default folder
    (`~/Documents/SQLite`) has no spaces, so it's unaffected.

## The NorthMac module

`modules/north-mac/ios/NorthMacModule.swift` and its JavaScript side, `modules/north-mac/index.ts`. Expo autolinks
it from `modules/`, and its podspec is macOS-only. Everything is optional in JavaScript, so it reports
`available: false` in Jest.

| API | What it does |
|---|---|
| `appDataDirectoryUri` | `file://` URL of `~/Library/Application Support/<bundle ID>`, created if needed. The app keeps its database here because `expo-sqlite`'s default folder is `~/Documents` for this unsandboxed app, and that folder is often iCloud-synced. It's a URL, not a path, so expo-sqlite keeps the space in "Application Support" (see *Expo on macOS*) |
| `setDockBadge(label)` | Text on the Dock icon. The sidebar sets it to the number of items still planned today |
| `setKeepAwake(enabled, reason?)` | Keeps the display awake with a `ProcessInfo` activity. Used by *Cook mode* on recipe pages |
| `SymbolView` | Native SF Symbol view (AppKit). Draws the sidebar icons with the same symbol names as the iPhone tab bar. PNG copies in `src/assets/icons` are used where the module isn't available |

## Data

`src/data/store.tsx` holds the data in the same shapes as the BuildNorth API. Every change except *Reset to sample
data* (Mac-only) matches one API call in the iPhone app, so the store can later be swapped for real requests.

- **Seed data:** `src/data/sample.ts`, with dates relative to the day it was created: first launch, or the last
  *Reset to sample data*.
- **Where it's saved:** `src/lib/persist.ts` saves the whole state as JSON in
  `~/Library/Application Support/org.reactjs.native.NorthAssistant/buildnorth.db`, table `kv`, key `state/v1`.
- **Starting over:** Profile › *Reset to sample data* replaces it.
- **Inspecting it:**

```bash
sqlite3 ~/Library/Application\ Support/org.reactjs.native.NorthAssistant/buildnorth.db "select key, length(value) from kv"
```

## Project layout

```
App.tsx                      re-exports src/App
index.js                     registers "NorthAssistant" (the name the native app loads)
src/
  App.tsx                    sidebar + current page
  navigation.tsx             sections, per-section back stacks
  theme.ts                   BuildNorth design tokens (light and dark)
  components/ui.tsx          shared components ported from the iPhone app
  components/sidebar.tsx     sidebar, SF Symbols, Dock badge
  screens/                   today, coach, meals, activity, profile (+ memory)
  data/                      types, sample data, store
  lib/                       dates, persist (expo-sqlite)
modules/north-mac/           local Expo module (Swift + TypeScript)
macos/                       Xcode project, Podfile, AppDelegate.swift
patches/                     patch-package fix for expo-modules-core
eas.json, .eas/build/        EAS custom build
__tests__/                   App render test, full screen walk
ios/, android/               unused React Native template folders (keep ios/ for EAS)
```

## Checks

```bash
npx tsc --noEmit
```

```bash
npx eslint App.tsx src modules __tests__
```

```bash
npx jest
```

`__tests__/screens.test.tsx` opens every section and pushed page and exercises the main interactions:
- marking an item done
- saving a check-in
- the week view
- recipe servings scaling
- adding to the shopping list
- routine and session pages
- the progress card
- the memory page

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bundle install`: `Could not find 'bundler' (2.6.9) required by your Gemfile.lock` | You're on the system Ruby 2.6: put Homebrew's Ruby 3.4 `bin` first in `PATH` (see *Requirements*). Don't `gem install bundler` into the system Ruby |
| `xcodebuild` refuses to run, or reports that it requires Xcode | The Command Line Tools are selected: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` |
| `pod install`: `cannot load such file -- kconv` | Missing `gem 'nkf'` in the Gemfile (CocoaPods 1.15 on Ruby 3.4) |
| `pod install`: a pod isn't compatible with macOS | An iOS-only Expo module was added; remove it or exclude it in `expo.autolinking.exclude` |
| Build error `conflicting types for alias 'UIApplication'` | The patch isn't applied: run `npm install` (or `npx patch-package`) |
| Build error `MACOSX_DEPLOYMENT_TARGET … 11.0` | The Podfile `post_install` block is missing; re-run `pod install` |
| Dev server: `Cannot find module 'babel-preset-expo'` or `Unable to resolve "<module>"` | Make the package a direct dependency, then `npm start -- --clear` |
| Release build log: `Cannot find module '@expo/cli'` | The bundle phase is using the old lookup and fell back to React Native's bundler; resolve `@expo/cli` from `expo/package.json` |
| Debug app shows a red screen "No script URL provided. Make sure the packager is running…", or loads another project's app from port 8081 | Start the dev server (`npm start`, port 8090) before opening a Debug build |
| A folder named `~/Library/Application%20Support` appears | An older build (before the `appDataDirectoryUri` fix) ran: it saves there. Rebuild, then move that folder to the Trash after copying anything you need from it |
| eas-cli: "ignored by your version control system" | `!.eas/build/` is missing from `.gitignore` |
| eas-cli asks about git or uploads the whole repository | Set `EAS_NO_VCS=1` |

## What was tested

### Calendar and connections, 2026-10-25

- Inspected the native Mac UI: Today, recipe details, Calendar month grid, Movement filter, monthly report,
  AI connections and the disconnected Coach screen.
- Fixed Calendar's editor opening below the month grid and report. Opening an entry now shows a dedicated
  editor; cancel and save return to the calendar at the top. Verified empty-title validation and saving an
  existing demo entry unchanged in the native UI.
- The ElevenLabs website button opened the configured local website's AI connections page in Chrome,
  with Claude and ElevenLabs setup forms visible.
- TypeScript and ESLint passed. All three Jest suites passed, including mocked Claude verification, chat,
  disconnect and fresh-session gating, plus Calendar editing and library navigation.
- No real provider key or paid AI conversation was used. Mac remains a local demo: live Watch workout,
  heart-rate and sleep syncing is available through the signed-in website and phone, not this Mac calendar.
  Native ElevenLabs voice is a website handoff.

### Earlier native and release validation

Tested on 2026-10-19 and 20 on an Apple M3 MacBook Air (macOS 27, Xcode 27.1):
- **Debug builds:** built and launched after each change. JavaScript came from `expo start` on port 8090 ("macos
  Bundled … Running NorthAssistant", Fabric on).
- **Expo `export:embed`:** a local run produced a 640-module macOS bundle containing React Native macOS's
  `Platform` module.
- **Local Release build:** succeeded before the `@expo/cli` fix, so its JavaScript was bundled by React Native's
  bundler. It hasn't been repeated locally since the fix; the second EAS build covers it.
- **EAS builds** (`eas.json` profile `macos`):
  - `c4e05706-6383-431b-a527-6c9093a7def5` succeeded, also bundled by React Native's bundler.
  - `1fd31753-200c-4509-afb9-725a1555e592` succeeded, bundled by Expo ("macos Bundled … (640 modules)"). It
    predates the `appDataDirectoryUri` fix.
  - `6e7adbc2-3344-4da4-a8a1-353dd0f0bc85` succeeded with the fix, bundled by Expo (640 modules). This is the copy
    in `~/Downloads/NorthAssistant-EAS/`.
- **The downloaded EAS app (build `6e7adbc2…`):**
  - Its signature is valid (ad hoc, arm64), and it has no quarantine flag.
  - It ran from its embedded Hermes bundle and never contacted the dev server. The dev server was running on 8090
    at the time; Release builds don't load JavaScript from it.
  - It opened the existing `~/Library/Application Support/org.reactjs.native.NorthAssistant/buildnorth.db`, left the
    saved data unchanged (same checksum before and after), and created no `Application%20Support` folder.
  - No JavaScript or React Native errors appeared in the system log. For build `1fd31753…`, the only error and
    fault entries came from macOS frameworks (App Intents connection errors and a CoreUI asset-catalog fault).
- **Saved data, after the fix (Debug build):**
  - The app keeps `~/Library/Application Support/org.reactjs.native.NorthAssistant/buildnorth.db` open.
  - With that file moved aside, a launch created a new one and wrote `state/v1` to it.
  - No `Application%20Support` folder was created.
- **Dock badge:** JavaScript called `setDockBadge("2")` and the native call completed.
- **Code checks:** TypeScript, ESLint and both Jest suites pass.

Not checked by looking at the screen:
- how the screens, the SF Symbol icons and the Dock badge look
- whether Cook mode actually keeps the display awake

Not done:
- connecting to the backend and Clerk sign-in
- Developer ID signing and notarization
- an Intel (x86_64) build
