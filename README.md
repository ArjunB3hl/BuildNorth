# Rhythm — Demo version

A demo version of a personal assistant for meals, activity and the week's plan, with an AI Coach, shared long-term memory
(SurrealDB Agent Memory) and access for AI assistants over MCP. One repository, three apps and a Chrome companion:

| Folder | What | Guide |
|---|---|---|
| [`mobile/`](mobile/) | The Expo app (iPhone, Android, and an Apple Watch app in SwiftUI) plus the FastAPI backend in `mobile/backend/` | [mobile/README.md](mobile/README.md) |
| [`mac/`](mac/) | The native macOS app: React Native for macOS with parts of Expo SDK 55 (project name `NorthAssistant`) | [mac/README.md](mac/README.md) |
| [`win/`](win/) | The native Windows app: React Native for Windows with Expo SDK 56's tooling, ported from the Mac app (project name `NorthAssistant`) | [win/README.md](win/README.md) |
| [`extension/`](extension/) | Rhythm, a Chrome side panel for phone-controlled video interests and user-chosen MCP agents | [extension/README.md](extension/README.md) (backend side: [Rhythm guide](mobile/docs/rhythm.md)) |
| [`inference/pose-coach/`](inference/pose-coach/) | Browser camera coach, embedded in the website; counted sets save to Activity | [Website integration](mobile/docs/pose-coach.md) |

How the mobile and Mac apps were built, what was checked and what is still open:
[mobile/docs/work-log.md](mobile/docs/work-log.md). The Windows app's equivalent is in [win/README.md](win/README.md).

## Quick start

Backend:

```bash
cd mobile/backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

iPhone, Android and watch (Metro on 8081):

```bash
cd mobile && npx expo start
```

React Native web app (same backend and Clerk account):

```bash
cd mobile && npm run web
```

Open `http://localhost:8081`. The web overview brings together fitness video recommendations,
saved content, interests and per-page sharing controls. Build a static export with `npm run build:web`.
See [web setup](mobile/README.md#web-app) for the extension link and cookie behavior.

Mac app (Metro on 8090, then build and open the app):

```bash
cd mac && npm start
```

```bash
cd mac && npm run macos
```

Windows app (Expo CLI on 8091, then build, deploy and open the app; needs Visual Studio 2026, see its README):

```powershell
cd win; npm start
```

```powershell
cd win; npm run windows
```

Rhythm's unpacked Chrome extension:

```bash
cd extension && npm ci && npm run build:local
```

Load `extension/.output/chrome-mv3` at `chrome://extensions`. The phone's **Profile →
Interests & sharing** screen supplies its profile; **Content library** manages results,
agents, browsers and memory. The existing backend also serves Rhythm at
`/rhythm/mcp`, separately from the original `/mcp` endpoint.

Setup for each app (env files, installs, native builds) is in its own README. Use Node 20.19 or newer
for the existing apps and Node 22+ for the extension (22.14+ for the Windows app). The [Rhythm guide](mobile/docs/rhythm.md)
distinguishes verified behavior, labelled fixtures, required credentials and remaining live checks.

## Repository notes

- The apps don't share code or packages yet. Each has its own `package.json`, `node_modules` and native projects.
  The Mac app mirrors the mobile app's screens and API types, but isn't connected to the backend yet. The Windows
  app is ported from the Mac app.
- Rhythm shares the phone's pure TypeScript API contract and the backend's metadata vocabulary, with its own extension dependencies.
- Secrets stay out of git: every `.env` file is ignored, and only `.env.example` templates are committed. The
  backend's local SQLite database (`mobile/backend/var/`) is ignored too.
- Generated native folders are ignored: `mobile/ios`, `mobile/android`, the Pods and build output under `mac/`, and
  the msbuild output under `win/windows/`. Unlike the Expo phone app, `win/windows/` itself is committed: React
  Native for Windows has no prebuild, so its Visual Studio projects are source.
