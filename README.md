# BuildNorth

A personal assistant for meals, activity and the week's plan, with an AI Coach, shared long-term memory
(SurrealDB Agent Memory) and access for AI assistants over MCP. One repository, three apps:

| Folder | What | Guide |
|---|---|---|
| [`mobile/`](mobile/) | The Expo app (iPhone, Android, and an Apple Watch app in SwiftUI) plus the FastAPI backend in `mobile/backend/` | [mobile/README.md](mobile/README.md) |
| [`mac/`](mac/) | The native macOS app: React Native for macOS with parts of Expo SDK 55 (project name `NorthAssistant`) | [mac/README.md](mac/README.md) |
| [`win/`](win/) | The native Windows app: React Native for Windows with Expo SDK 56's tooling, ported from the Mac app (project name `NorthAssistant`) | [win/README.md](win/README.md) |

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

Setup for each app (env files, installs, native builds) is in its own README. Use Node 20.19 or newer (22.14 or
newer for the Windows app).

## Repository notes

- The apps don't share code or packages yet. Each has its own `package.json`, `node_modules` and native projects.
  The Mac app mirrors the mobile app's screens and API types, and the Windows app is ported from the Mac app;
  neither is connected to the backend yet.
- Secrets stay out of git: every `.env` file is ignored, and only `.env.example` templates are committed. The
  backend's local SQLite database (`mobile/backend/var/`) is ignored too.
- Generated native folders are ignored: `mobile/ios`, `mobile/android`, the Pods and build output under `mac/`, and
  the msbuild output under `win/windows/`. Unlike the Expo phone app, `win/windows/` itself is committed: React
  Native for Windows has no prebuild, so its Visual Studio projects are source.
