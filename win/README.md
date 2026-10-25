# BuildNorth for Windows

A native Windows version of the BuildNorth app, built with React Native for Windows plus Expo SDK 56's tooling. It
is a port of the Mac app (`../mac`), so it has the same five sections (Today, Coach, Meals, Activity, Profile),
design tokens, components and data types, with the same sidebar.

**Status:** runs on sample data saved on this PC. Like the Mac app, it is **not connected to the BuildNorth
backend** yet (no Clerk sign-in), so the Coach can't reply and its message box is disabled.

| | |
|---|---|
| Project | `win/` in the BuildNorth repository; the Expo phone app and backend are in `mobile/`, the Mac app in `mac/` |
| App | Packaged Win32 app `NorthAssistant` (package `NorthAssistant_mcfxj42x7gjbe` when built on this PC), window title "BuildNorth", minimum size 900 × 600 |
| React Native | `react-native` 0.85.3 + `react-native-windows` 0.85.0 (Microsoft), Hermes, New Architecture (Fabric), Windows App SDK 1.8, prebuilt `Microsoft.ReactNative` from NuGet |
| Expo | SDK 56 (`expo` 56.0.23): Expo CLI dev server and bundler, `babel-preset-expo`. No Expo native modules (see *Expo on Windows*) |
| Native code | `windows/` from the `cpp-app` template (C++, Visual Studio solution), plus the app's own `NorthWin` module |
| Dev server | Expo CLI (Metro) on port **8091** (the phone app uses 8081, the Mac app 8090) |

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
No `.env` file is needed: the app doesn't talk to the backend or Clerk yet.

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
5. **Window.** `NorthAssistant.cpp` sets the title, a 1200 × 800 size and the 900 × 600 minimum, scaled by the
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
| `setBadge(count)` | Number badge on the taskbar button (the Mac app's Dock badge): the count of today's planned items. Needs package identity, which the packaged app has |
| `setKeepAwake(enabled)` | Keeps the display on during *Cook mode* with a power request (`PowerSetRequest`, display required), released when cook mode ends or the app quits |
| `deviceName`, `windowsVersion`, `dataFile` | Shown on Profile › This PC. React Native's `Platform.Version` on Windows is an API contract number (19 here), not the OS version, so `windowsVersion` reads it from the registry |

## Project layout

```
win/
├── App.tsx, index.js, app.json    entry; the component is registered as "NorthAssistant"
├── src/                           screens, components, store (ported from ../mac/src)
├── modules/north-win/             JS side of NorthWin
├── windows/                       Visual Studio solution: NorthAssistant (C++ app) and NorthAssistant.Package
│   └── NorthAssistant/NorthWin.h  the native module
├── metro.config.js                Expo's Metro config + Windows resolution
├── tools/pwsh-restore/            restores PowerShell 7 into the NuGet cache for the RNW CLI
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
- **Several BuildNorth windows:** each launch starts another instance; close the old ones.

## What was tested (21 Oct 2026, this PC)

- Debug x64 build, deploy and launch from `npm run windows` with Visual Studio 2026 18.11, Windows 11 26H2 (build
  26300).
- The app loaded its bundle from Expo CLI on 8091 (`platform=windows`, 658 modules, Fabric).
- Clicked through Today, the Week view, Coach, Meals, a recipe, Activity and Profile; all rendered in dark mode.
- *Move* on a plan item showed the inline days; *Cancel* closed them.
- Marking an item done updated the sidebar count and the taskbar badge (2 → 1). After quitting and relaunching, it
  was still done (`buildnorth.json` written to `LocalState`).
- *Cook mode* toggled on and off with its notice. Whether the power request is active wasn't checked:
  `powercfg /requests` needs an administrator.
- *Reset to sample data* showed the native Windows dialog and reset the store.
- Profile › This PC showed the computer name, "Windows 11, version 26H2 (build 26300.9711)" and the data file path.
- `tsc`, ESLint, Jest (2 suites) and `expo install --check` pass.

**Not tested:** a Release build or MSIX package for another PC, ARM64, Windows 10, light mode, and running two
instances at once (both write the same file).
