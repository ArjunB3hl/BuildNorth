# Rhythm for Windows

A native Windows version of Rhythm (BuildNorth), built with React Native for Windows plus Expo SDK 56's tooling. It
is a port of the Mac app (`../mac`): the same sidebar sections (Today, Coach, Calendar, Profile, with the recipe and
workout libraries under Calendar), design tokens, components and data types.

**Status:** two modes, one set of screens. Opt-in and run by hand from this repository: talking with Claude by voice
in Coach (Parakeet and Kokoro on this PC, your Claude Code sign-in answering) and Camera workout (the local camera
coach in a WebView, saved as an Activity session). See [`local-voice/README.md`](local-voice/README.md).

- **Signed in (account), required in every real build:** the screens load from and save to the Rhythm API
  (`mobile/backend`), so it's the same data as the phone and the website. Signed out, the app shows only its sign-in
  screen: an emailed code by default, a password, or a new account, all inside the app. See *Signing in and the
  backend*.
- **Demo (builds without a Clerk key, for development and tests):** local sample data saved on this PC, as in the Mac
  app, labelled as not a Rhythm account. The demo Coach calls Claude directly with a key you enter in AI connections.

| | |
|---|---|
| Project | `win/` in the BuildNorth repository; the Expo phone app and backend are in `mobile/`, the Mac app in `mac/` |
| App | Packaged Win32 app `NorthAssistant` (package `NorthAssistant_mcfxj42x7gjbe` when built on this PC), shown as **Rhythm** (Start menu and window title), minimum size 900 × 600 |
| React Native | `react-native` 0.85.3 + `react-native-windows` 0.85.0 (Microsoft), Hermes, New Architecture (Fabric), Windows App SDK 1.8, prebuilt `Microsoft.ReactNative` from NuGet |
| Expo | SDK 56 (`expo` 56.0.23): Expo CLI dev server and bundler, `babel-preset-expo`. No Expo native modules (see *Expo on Windows*) |
| Native code | `windows/` from the `cpp-app` template (C++, Visual Studio solution), plus the app's own `NorthWin` module |
| Dev server | Expo CLI (Metro) on port **8091** (the phone app uses 8081, the Mac app 8090) |

## Install the test build

Test builds are on the repository's [Releases](https://github.com/ArjunB3hl/BuildNorth/releases) page, tagged
`windows-v…`. Download `Rhythm-Windows-x64-test.zip`, unzip it, then right-click `Install.ps1` › *Run with
PowerShell*. It asks to trust the test certificate (one administrator prompt; it goes into Local Machine › Trusted
People), installs the Windows App Runtime 1.8 and VC++ runtime if they're missing, then installs **Rhythm**. The zip's
`INSTALL.txt` has the same steps and how to uninstall.

The package is signed with a **self-signed test certificate** (publisher `CN=arjun`), which is why the trust step is
needed; a commercial code-signing certificate (or the Microsoft Store) would remove it. The build has the deployed API
(`https://buildnorth.onrender.com`) and the development Clerk instance built in, and needs no dev server.

## Requirements

Windows 10 or 11 and the dependencies React Native for Windows 0.85 checks for in its
[`rnw-dependencies.ps1`](https://github.com/microsoft/react-native-windows/blob/0.85-stable/vnext/Scripts/rnw-dependencies.ps1):

- **Visual Studio 2026** (18.6.1 or newer; Community is fine). The 0.85 docs page still says 2022, but the script
  requires 18.6.1. Workloads: .NET desktop development, Desktop development with C++, Windows application
  development (UWP), plus the components *MSVC x64/x86 build tools*, *C++ UWP support*, *Windows 11 SDK
  (10.0.22621.0)* and *MSBuild*. One command that installs exactly these:

  ```powershell
  winget install --id Microsoft.VisualStudio.Community --exact --source winget --override "--passive --wait --includeRecommended --add Microsoft.VisualStudio.Workload.ManagedDesktop --add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Workload.Universal --add Microsoft.Component.MSBuild --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.ComponentGroup.UWP.Support --add Microsoft.VisualStudio.ComponentGroup.UWP.VC --add Microsoft.VisualStudio.ComponentGroup.NativeDesktop.Core --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
  ```

- **.NET SDK 10** (`winget install --id Microsoft.DotNet.SDK.10`) and **Node 22.14 or newer**
  (`winget install --id OpenJS.NodeJS.22`).
- **Developer Mode** on (Settings → System → Advanced) and **long paths** enabled.
- **Disk:** Visual Studio with these parts took about 27 GB here; `node_modules`, the NuGet packages and one Debug
  build need several GB more.
- **PowerShell 7** (`pwsh.exe`): the React Native for Windows CLI won't load without it. It looks on `PATH` and in
  the NuGet cache. Restoring Microsoft's `PowerShell` 7.6.1 NuGet package into the cache is enough, with no system
  install. `tools/pwsh-restore` does that (it lands in `~/.nuget/packages/powershell/7.6.1`):

  ```powershell
  dotnet restore tools/pwsh-restore
  ```

  Without it, every
  Windows command (`init-windows`, `run-windows`, `autolink-windows`) is missing from `npx react-native`, because
  React Native for Windows' CLI config throws "Unable to find pwsh.exe".

Keep the repository **outside OneDrive** (it lives in `C:\dev\BuildNorth` here). `node_modules` and the C++ build
output are tens of thousands of files, and the native build needs short paths.

## Setup

```powershell
cd win
npm install
dotnet restore tools/pwsh-restore
```

The second command is needed once per PC (PowerShell 7 for the React Native for Windows CLI, see *Requirements*).

To sign in, copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: the same publishable key as the phone app (`mobile/.env`). For the
  development instance this repo documents (`casual-rabbit-7268.clerk.accounts.dev`) it is
  `pk_test_Y2FzdWFsLXJhYmJpdC03MjY4LmNsZXJrLmFjY291bnRzLmRldiQ`; a publishable key only encodes that public host.
- `EXPO_PUBLIC_API_URL`: `https://buildnorth.onrender.com` for the deployed API, or leave it empty for a backend
  on this PC (`http://localhost:8000`).

Without a key the app runs in demo mode only. Restart `npm start` after changing `.env`.

## Run (development)

Start the dev server, then build, deploy and launch the app. The first command keeps running; use a second terminal
for the other.

```powershell
npm start
```

```powershell
npm run windows
```

- `npm start` is `expo start --port 8091`. On this PC (8 GB RAM) it takes 2–3 minutes before it answers, and the first
  bundle about 25–45 s. The app shows a green "Loading" bar until then.
- `npm run windows` is `react-native run-windows --no-packager --arch x64`: autolinking, NuGet restore, the msbuild
  build, then it registers the package and launches it. The first full build took about 7 minutes here, and a
  rebuild after a C++ change about 6. JavaScript changes don't need a rebuild; the app reloads from the dev server.
- After the first deploy, start it from the Start menu (**NorthAssistant**). Each launch opens another window
  (the template doesn't enforce a single instance), so close old ones first.
- Visual Studio works too: open `windows\NorthAssistant.sln`, pick **Debug | x64**, and run
  **NorthAssistant.Package**.

The app loads JavaScript from `localhost:8091` (`SourceBundlePort` in `windows\NorthAssistant\NorthAssistant.cpp`).
`run-windows` gives the package a loopback exemption so a packaged app may reach `localhost`.

## Build a release package

The Release configuration bundles the JavaScript (Expo CLI's `export:embed`, set as `BundleCliCommand` in
`windows/NorthAssistant/NorthAssistant.vcxproj`, so `win/.env` is built in), compiles it to Hermes bytecode, and the
packaging project makes a signed MSIX with Visual Studio's install script.

1. **Settings:** `win/.env` with the Clerk key and the API URL the build should use, and no `.env.local`.
2. **Certificate**, once per signing PC. Its subject must equal the manifest's `Publisher` (`CN=arjun`). The test
   certificate used for the first release lives in this PC's *Current User › Personal* store (friendly name "Rhythm for
   Windows test signing", valid to 2027-10-25); later builds must be signed with the same one so they install as
   updates. To make one elsewhere:

   ```powershell
   New-SelfSignedCertificate -Type Custom -Subject 'CN=arjun' -KeyUsage DigitalSignature -FriendlyName 'Rhythm for Windows test signing' -CertStoreLocation 'Cert:\CurrentUser\My' -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -NotAfter (Get-Date).AddYears(1)
   ```

3. **Build** from `win/` (about 3 minutes here), with the certificate's thumbprint:

   ```powershell
   & 'C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\amd64\MSBuild.exe' windows\NorthAssistant.sln /restore /m /p:Configuration=Release /p:Platform=x64 /p:RestorePackagesConfig=true /p:RunAutolinkCheck=false /p:AppxBundle=Never /p:UapAppxPackageBuildMode=SideloadOnly /p:AppxPackageSigningEnabled=true /p:PackageCertificateThumbprint=<thumbprint> /p:GenerateAppxPackageOnBuild=true /p:AppxPackageDir=C:\dev\BuildNorth\win\windows\AppPackages\
   ```

   The package lands in `windows/AppPackages/NorthAssistant.Package_<version>_x64_Test/` (git-ignored). Bump
   `Version` in `Package.appxmanifest` for each release.
4. **Ship** the `.msix`, `.cer`, `Install.ps1`, `Add-AppDevPackage.ps1`, `Add-AppDevPackage.resources/` and
   `Dependencies/x64/` together. The first release left out the other CPU types, the debug symbols and Visual Studio's
   `TelemetryDependencies` folder, so its install script sends no telemetry. The website's Downloads page links the
   release's zip from its `windows` entry in `mobile/src/lib/demo-downloads.ts`; update its `releaseUrl`, `bytes` and
   steps for a new release.

To try a Release build on the development PC without trusting the certificate, register its folder instead of
installing the MSIX (Developer Mode): run `Remove-AppxPackage -PreserveApplicationData` on the Debug registration, then
`Add-AppxPackage -Register windows\NorthAssistant.Package\bin\x64\Release\AppxManifest.xml`. `npm run windows` puts the
Debug build back.

## Signing in and the backend

In every real build (one with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`) the app needs a signed-in Rhythm account: signed
out, the whole window is the sign-in screen (`src/screens/sign-in.tsx`), with no section of the app and no account's
data. Builds without a key (development, Jest) run on demo data saved on this PC and say so.

**Signing in, inside the app** (the website's and phone app's steps, `mobile/src/app/(auth)/sign-in.tsx` and
`sign-up.tsx`; there is no browser hand-off on Windows):

- **Email me a sign-in code** (the default): Clerk emails a code, you type it in. If Clerk then asks for a new-device
  check, a second code follows.
- **Use my password instead**: email and password, then an emailed code if Clerk asks for one.
- **Create an account**: email address and a password (this Clerk instance requires one), then the emailed code. An
  address with no account offers this. Only an account created here gets the **welcome** step (the website's
  onboarding: optional name, goals, diet, equipment, experience and workout times, or *Skip for now*); signing in to
  an existing account goes straight to Today.
- Wrong, expired and too-many codes, unknown addresses, an address that already has an account, and rate limits are
  said in plain words; *Send a new code* and *Start over* are always there.

**How** (`src/lib/clerk.ts`): Clerk has no SDK for React Native for Windows, so the app talks to Clerk's Frontend API
itself, the way `@clerk/expo` does on iPhone. Only the publishable key is in the app (never a secret key), and no
browser cookie is read or copied.

1. The first request gets a client token in the response's `Authorization` header; native mode (`_is_native=1`)
   sends it back in `Authorization` instead of using cookies.
2. Email code: `POST /v1/client/sign_ins` with `identifier`, then `prepare_first_factor` / `attempt_first_factor`
   with `strategy=email_code`. Password: `identifier`, `password`, `strategy=password`. On `needs_client_trust` or
   `needs_second_factor`, `prepare_second_factor` / `attempt_second_factor` with the emailed code. New account:
   `POST /v1/client/sign_ups` with `email_address` and `password`, then `prepare_verification` /
   `attempt_verification`.
3. `POST /v1/client/sessions/{id}/tokens` gives a session token for `Authorization: Bearer …`. It lasts about a minute
   and is reused until 10 s before it expires; after a 401 the API client asks for a new one and retries once, as the
   phone's `api.ts` does.
4. The client token is kept encrypted for the Windows user (DPAPI, NorthWin's `writeSecret`, in
   `LocalState\secrets`), the counterpart of the phone's `expo-secure-store` token cache, so the app stays signed in
   across restarts. Sign out (Profile › Rhythm account) removes the session and the token and returns to sign-in.

**When something goes wrong:** if Clerk can't be reached at start, the app says so and offers *Try again* and *Sign
out*, keeping the saved sign-in. If Clerk ends the session while the app runs (it expired, or you signed out
elsewhere), the app returns to sign-in and says why. If the Rhythm API can't be reached or refuses, the app explains it
with *Try again* and *Sign out*.

**One account at a time:** everything below the account (the store, navigation and every screen) is keyed by the
signed-in user, so signing in as someone else starts from nothing. Account data is only in memory; the only thing
saved on this PC is the encrypted Clerk client token. The Claude account signed in to Claude Code on this PC (local
voice, Camera workout) is separate from the Rhythm account, and the app says so.

**Which backend:** `EXPO_PUBLIC_API_URL` in `win/.env`. The sign-in screen, the sidebar and Profile › Rhythm account
name it; a backend on `localhost`/`127.0.0.1` is labelled *Local test backend: test data only, not your live Rhythm
account*.

**What syncs when signed in** (`src/data/remote.ts`). Every action still updates the screen at once; it's then sent to
the API and the parts it touched are reloaded, so server ids and rules win (recipe scaling and unit merging for the
shopping list, done meals appearing in the Calendar). A refused or failed call shows a banner and reloads, which undoes
the change.

| Screen | Reads | Writes |
|---|---|---|
| Today, Week | `GET /plan` (4 weeks back to 5 ahead), `GET /today` | `PATCH /plan/{id}` (done, skip, undo, move), `POST /plan` (with `clientKey`), `DELETE /plan/{id}`, `PUT /checkins/{date}` |
| Calendar | `GET /calendar` (last month and this one; sleep entries are left out) | `POST /calendar` (with `clientKey`), `PUT`/`DELETE /calendar/{id}` for entries the server marks editable |
| Recipes, shopping | `GET /recipes`, `GET /shopping` | `POST /recipes/{id}/shopping` (`servings`), `PATCH /shopping/{id}`, `DELETE /shopping` |
| Workouts | `GET /routines`, `GET /sessions` | – |
| Coach | `GET /coach/messages`, `GET /connections/access` | `POST /coach/messages` (`localDate`, `clientKey`, `timezone`), `DELETE /coach/messages` |
| Profile, memory | `GET /profile`, `GET /preferences`, `GET /progress` | `POST`/`PATCH`/`DELETE /preferences`, `DELETE /memory` |

Still only on the phone and website: the weekly planner and plan changes in your own words, assistant approvals,
importing or editing recipes and routines, running a workout, voice, Apple Watch, interests and the content library.
The Coach's AI (your Claude key or ElevenLabs) is connected on the website; the Windows app checks
`/connections/access` and links there. In demo builds, the demo Coach and AI connections screen work as on the Mac.

### Testing without an account: the local test backend

`tools/local-backend/serve.py` runs the **unchanged** backend (`mobile/backend`) on `127.0.0.1:8000` with a fresh
SQLite database, the way its own tests run it: only Clerk's key lookup is replaced by a local RSA key, so tokens the
script signs for a fictional user (`user_windowsLocalTest`) pass the real verifier. Every route, migration and ownership
check is the real code. `seed.py` fills that account through the API.

```powershell
cd mobile\backend
py -3.11 -m venv .venv; .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python ..\..\win\tools\local-backend\serve.py
```

```powershell
cd mobile\backend; .venv\Scripts\python ..\..\win\tools\local-backend\seed.py
```

Then put `EXPO_PUBLIC_API_URL=http://localhost:8000` and the printed `EXPO_PUBLIC_DEV_SESSION_TOKEN=…` in
`win/.env.local` and restart `npm start`. The app signs in with that token instead of Clerk (development bundles
only; `src/config.ts`). Delete `.env.local` to go back to Clerk. The token is useless against a real backend, which
only trusts Clerk's keys.

## How it was built

1. **Project.** `package.json` pins React Native 0.85.3 and `react-native-windows` 0.85, the newest React Native
   for Windows release. Expo SDK 56 was chosen because it pins React Native 0.85.3, as the Mac app took SDK 55 for
   React Native 0.83. `npx react-native init-windows --template cpp-app --name NorthAssistant` generated
   `windows/`, `NuGet.config` and a Metro config, which was replaced (below). The template's extra Jest preset
   (`@rnx-kit/jest-preset`, `jest.config.windows.js`) was removed; tests use `jest-expo` as on the Mac.
2. **Expo, partially.** `babel.config.js` uses `babel-preset-expo`, and `npm start` runs `expo start`.
   `metro.config.js` builds on `expo/metro-config` and adds what the React Native CLI would otherwise add:
   - `windows` in `resolver.platforms`, and `react-native` imports resolved to `react-native-windows` for Windows
     bundles (the same resolver the Mac app uses for `react-native-macos`);
   - the template's block list, so Metro doesn't watch msbuild output under `windows/`;
   - only React Native's `InitializeCore` before the app, because Expo's default list adds its runtime, whose native
     side doesn't exist on Windows.
3. **Screens ported from `../mac/src`**, almost unchanged. What differs:
   - Text and comments say PC/Windows instead of Mac.
   - **Moving a plan item** offers the days inline (Tomorrow / In 2 days / Next week, or each day of the week)
     instead of in an alert. Windows alerts show at most three buttons, and `Alert.alert` silently drops the rest
     (`react-native-windows/Libraries/Alert/Alert.windows.js`), which would have dropped *Cancel*. The other
     alerts have two buttons and use the native Windows dialog.
   - The sidebar draws the PNG icons (the Mac draws SF Symbols natively).
   - The Coach's macOS-only `submitKeyEvents` prop was dropped (the composer is disabled anyway).
4. **`NorthWin`**, a C++ module in the app project, replaces what the Mac app gets from `expo-sqlite`,
   `expo-crypto`, `expo-constants` and its `NorthMac` Swift module (see below). IDs come from a small JS UUID
   function (`src/lib/ids.ts`) because Hermes has no `crypto.randomUUID`.
5. **Catching up with the Mac app (25 Oct 2026).** After merging `main`, the Mac app's later commits (Calendar
   section, Rhythm branding and demo labels, AI connections, the demo Coach) were replayed onto `win/src` with
   `git apply --3way`, keeping the Windows changes; `expo-crypto` and `expo-constants` were replaced by
   `src/lib/ids.ts` and `src/config.ts`.
6. **Account mode** (`src/lib/clerk.ts`, `account.tsx`, `api.ts`, `src/data/remote.ts`): see *Signing in and the
   backend*.
7. **Window.** `NorthAssistant.cpp` sets the title, a 1200 × 800 size and the 900 × 600 minimum, scaled by the
   display's DPI (`AppWindow` sizes are physical pixels).

## Expo on Windows

Expo has no Windows target, and **Expo modules don't run on Windows at all**: `expo-modules-core` has no Windows
implementation, so unlike on macOS, even `expo-sqlite` or `expo-constants` can't be used. What does work is Expo's
tooling: the CLI dev server, Metro with `expo/metro-config` and `babel-preset-expo`. `npx expo install --check`
keeps the JS dependencies on SDK 56's versions.

Community modules need a Windows implementation that builds with React Native for Windows 0.85.
`@react-native-async-storage/async-storage` 2.2.0 was tried first and dropped: its Windows project fails against
Windows App SDK 1.8 ("No references were found for these Windows App SDK transitive dependencies"). After removing
a native module, run `npx react-native autolink-windows` and delete its `Project(...)` block from
`windows\NorthAssistant.sln`. Autolinking adds projects to the solution but doesn't remove them, and the next
restore fails with MSB3202 otherwise.

## The NorthWin module

`windows/NorthAssistant/NorthWin.h` (C++/WinRT, `REACT_MODULE`, registered by `AddAttributedModules` in
`NorthAssistant.cpp`) and its JavaScript side, `modules/north-win/index.ts`. JavaScript reaches it through
`TurboModuleRegistry.get('NorthWin')`; everything is optional, so in Jest it reports `available: false`.

| API | What it does |
|---|---|
| `readState()` / `writeState(json)` | The whole store as one JSON file, `buildnorth.json` in the package's `LocalState` folder (`%LOCALAPPDATA%\Packages\<package>\LocalState`). Read synchronously at startup, like the Mac app's expo-sqlite read; written to a temporary file and then moved over the old one |
| `readSecret(name)` / `writeSecret(name, value)` | Small secrets encrypted with DPAPI for the current Windows user, in `LocalState\secrets`: the Clerk client token that keeps you signed in. Only the names the app uses are accepted |
| `setBadge(count)` | Number badge on the taskbar button (the Mac app's Dock badge): the count of today's planned items. Needs package identity, which the packaged app has |
| `setKeepAwake(enabled)` | Keeps the display on during *Cook mode* with a power request (`PowerSetRequest`, display required), released when cook mode ends or the app quits |
| `readLocalVoiceToken()`, `randomHex(bytes)`, `hmacSha256Hex(key, message)` | For the local voice helper (`local-voice/`): its token from `LocalState\local-voice.token` (64 hex characters or nothing), random bytes from the system RNG (`BCryptGenRandom`; Hermes has no `crypto.getRandomValues`) and HMAC-SHA256 (BCrypt), to check the helper's proof before every request |
| `deviceName`, `windowsVersion`, `dataFile` | Shown on Profile › This PC. React Native's `Platform.Version` on Windows is an API contract number (19 here), not the OS version, so `windowsVersion` reads it from the registry |

## Project layout

```
win/
├── App.tsx, index.js, app.json    entry; the component is registered as "NorthAssistant"
├── src/                           screens, components, store (ported from ../mac/src)
├── src/lib/clerk.ts, account.tsx  Clerk sign-in over the Frontend API, and the signed-in state
├── src/lib/api.ts, data/remote.ts the Rhythm API client, and what each screen loads and each action sends
├── modules/north-win/             JS side of NorthWin
├── windows/                       Visual Studio solution: NorthAssistant (C++ app) and NorthAssistant.Package
│   └── NorthAssistant/NorthWin.h  the native module
├── metro.config.js                Expo's Metro config + Windows resolution
├── tools/pwsh-restore/            restores PowerShell 7 into the NuGet cache for the RNW CLI
├── tools/local-backend/           the real backend with a stand-in for Clerk, for testing (see above)
├── local-voice/                   opt-in local voice (Coach) and camera coach launcher (Camera workout): local-voice/README.md
├── Directory.Build.props          builds react-native-webview's project with this Visual Studio's C++ toolset (v145)
└── __tests__/                     Jest (jest-expo)
```

## Checks

```powershell
npx tsc --noEmit
```

```powershell
npm run lint
```

```powershell
npm test
```

```powershell
npx expo install --check
```

The Jest screen walk renders every section and pushed page, as in the Mac app.

## Troubleshooting

- **"Unable to find pwsh.exe"**, or no Windows commands in `npx react-native --help`: restore PowerShell 7 (see
  *Requirements*).
- **The app shows old JavaScript after an edit:** a dev server started with `CI=1` doesn't watch files. Restart it
  with `npm start`.
- **Green "Loading" bar that stays:** the dev server isn't up yet, or isn't on port 8091.
- **MSB3202, a missing `.vcxproj` during restore:** a removed native module is still in `NorthAssistant.sln` (see
  *Expo on Windows*).
- **Several Rhythm windows:** each launch starts another instance; close the old ones.
- **"Sign-in isn't configured in this build":** `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing from `.env`, or the dev
  server wasn't restarted after setting it.
- **"Couldn't load your Rhythm account":** the API at `EXPO_PUBLIC_API_URL` didn't answer or refused the session. A
  free Render instance can take about a minute to wake up; *Try again*, or *Sign out* to use the demo.
- **"The development token was refused":** `.env.local` still has a token from the local test backend, which isn't
  running or whose token expired (12 hours). Delete `.env.local` to sign in with Clerk.

## What was tested (this PC)

### Demo mode (21 Oct 2026)

- Debug x64 build, deploy and launch from `npm run windows` with Visual Studio 2026 18.11, Windows 11 26H2 (build
  26300).
- The app loaded its bundle from Expo CLI on 8091 (`platform=windows`, 658 modules, Fabric).
- Clicked through Today, the Week view, Coach, Meals, a recipe, Activity and Profile (before the Calendar section
  arrived from the Mac app); all rendered in dark mode.
- *Move* on a plan item showed the inline days; *Cancel* closed them.
- Marking an item done updated the sidebar count and the taskbar badge (2 → 1). After quitting and relaunching, it
  was still done (`buildnorth.json` written to `LocalState`).
- *Cook mode* toggled on and off with its notice. Whether the power request is active wasn't checked:
  `powercfg /requests` needs an administrator.
- *Reset to sample data* showed the native Windows dialog and reset the store.
- Profile › This PC showed the computer name, "Windows 11, version 26H2 (build 26300.9711)" and the data file path.
- `tsc`, ESLint, Jest (2 suites) and `expo install --check` pass.

### Account mode (25 Oct 2026, after merging main)

- **Against the real backend code**, with the local test backend (`tools/local-backend`, fictional user, seeded
  through the API): the app loaded the account (profile name, today's three plan items, the backend's demo Calendar
  week, one preference), and the sidebar showed *Synced with Rhythm*. Marking a meal done sent
  `PATCH /plan/{id}`; the server stored it as done with `completedAt`, and the app reloaded the plan, today,
  progress and Calendar (backend log). The Coach showed the account gate, because AI is off on the local backend.
  Profile showed the account and no demo reset.
- **Clerk:** the requests were checked against the live development instance without an account: a native client
  request returns a client token in `Authorization`, and a sign-in for a non-existent `example.com` address returns
  `form_identifier_not_found`. The success paths (password, emailed code, session tokens, restoring the session) are
  covered by `__tests__/clerk.test.ts` with Clerk's documented responses.
- **Jest** (5 suites, 8 tests): the demo screen walk; Clerk sign-in; and account mode against an in-memory API:
  loading, a done item sent as `PATCH`, a refused change undone with a banner, the Coach through
  `POST /coach/messages`, the shopping list sent as `servings`, a Calendar entry created with a `clientKey` at
  the local time.
- The deployed API (`https://buildnorth.onrender.com/status`) answered with Clerk and AI configured.

**Not verified, because it needs your account:** signing in with real credentials and the emailed code, and the
Windows app against the deployed API with a real session. The recipe library couldn't be clicked in the live check
(another window covered it); the Jest account test covers that flow.

### Sign-in (29 Oct 2026)

**With real accounts**, on the Debug build against the deployed API (`https://buildnorth.onrender.com`) and the
development Clerk instance. The account owners typed their own emails and codes:

- An emailed-code sign-in reached Today with the account's own data. After closing the app completely and starting
  it again, it opened signed in. The saved sign-in on disk was a DPAPI blob (standard DPAPI header, no readable
  token).
- Sign out (Profile › Rhythm account) returned to the sign-in screen and deleted the saved sign-in; nothing of the
  account was written to disk. A restart after that stayed on sign-in.
- A second account showed only its own data: its name, email and profile, 0 sessions where the first had 1, an empty
  Calendar and monthly report, and its own Coach history.
- An address with no account got *There's no Rhythm account for that email address* from the real Clerk, with the
  offer to create one.

**Automated** (Jest, against stand-ins for Clerk's Frontend API and the Rhythm API): `__tests__/clerk.test.ts`
(email code, a wrong code, an expired code, a new code, a new-device code, a new account, an existing address,
Clerk's errors in plain words, no network, a session Clerk ended) and `__tests__/sign-in.test.tsx`:

- the sign-in screen is all there is while signed out, and nothing is asked of the API until sign-in;
- a wrong code, then a new one; restart; sign-out; a second account sees none of the first's data, and its API
  calls carry only its own token;
- a new account gets the welcome step once;
- a session ended while the app runs;
- Clerk unreachable at start (*Try again* keeps the saved sign-in);
- the Rhythm API unreachable after sign-in.

**Not tried with a real account:** a wrong or expired real code, Clerk or the API going offline, a session expiring
or being revoked elsewhere, and creating a real account. These are covered only by the stand-ins above.

### Local voice and Camera workout (29 Oct 2026)

Details and numbers in [`local-voice/README.md`](local-voice/README.md). On this PC, with the Debug build:

- The Debug build with react-native-webview 15.0.0 (built with the v145 toolset through `Directory.Build.props`).
- Coach: the voice card found the running helper, checked its proof and showed that Claude Code is signed out (with
  the `claude auth login` step); with the helper stopped it said how to start it; with a stand-in program on its port
  the card refused it and the stand-in received only the nonce. (Before that fix, the app trusted a stale token's
  earlier proof and sent the stand-in an authorized `/info`: caught by this test.)
- The helper over real HTTP: Kokoro → Parakeet round trip, Kokoro on the speakers, the speakers → microphone →
  pause detection → Parakeet (which found and fixed a bug: no utterance ever came out of the VAD), 20 s of quiet
  answered "nothing heard", a second job refused while one ran, a stop within 0.5 s, every unauthorized request
  refused, a signed-out Claude Code reported and never started, and the `speak_reply` MCP server through a standard
  MCP client.
- Camera workout against the local test backend (the fictional test user): the WebView loaded the camera page, the
  page's `ready` reached the app and the app's answer reached the page (it then read `/api/connections`, which it does
  only after the app's `localClaude`). With a stand-in page at the trusted address sending the real page's messages,
  the app counted *Squat 1 × 8*, *Finish and save* sent `stop`, took the summary and saved one session, which the
  backend's Calendar lists as *Camera workout*. A page elsewhere on the same origin sending a fake workout was
  ignored: the app reloaded the camera page each time and saved nothing.

### Release package (25 Oct 2026)

- The Release build (`windows-v1.0.0-test.1`) was built and signed as in *Build a release package*. Registered from its
  folder on this PC with no dev server running, it started and rendered the app; its Hermes bundle has the Clerk key
  and the deployed API built in, and no development token.
- **Not tested:** installing the signed MSIX with `Install.ps1` (that trusts the certificate on the machine), and any
  other PC.

**Not tested:** an MSIX install on another PC, ARM64, Windows 10, light mode, and running two
instances at once (both write the same file).
