This repository holds three apps and a Chrome companion; see README.md for the layout.

- `mobile/`: the Expo app (iPhone, Android, Apple Watch) and the FastAPI backend in `mobile/backend/`. Its rules:
  @mobile/AGENTS.md
- `mac/`: the macOS app (React Native for macOS + parts of Expo SDK 55). Read `mac/README.md` before changing its
  native setup: Expo has no macOS target there, and only some Expo modules compile for macOS.
- `win/`: the Windows app (React Native for Windows 0.85 + Expo SDK 56 tooling, ported from `mac/`). Read
  `win/README.md` before changing its native setup: Expo modules don't run on Windows at all, `win/windows/` is
  committed source (no prebuild), and Windows alerts show at most three buttons. Signed in, its screens use the
  backend through `win/src/data/remote.ts`; test that with `win/tools/local-backend`, not a real account. Local voice
  (Coach) and Camera workout use helpers started by hand: read `win/local-voice/README.md` before changing them.
- `extension/`: Rhythm (WXT, React, TypeScript, Manifest V3). Read `extension/README.md` and
  `mobile/docs/rhythm.md`. Its backend lives in `mobile/backend/app/rhythm/`.

- `inference/pose-coach/`: local browser camera coach. Read its `docs/HANDOFF.md` and `mobile/docs/pose-coach.md`.
  Private assets and recordings stay in ignored `.data/`; the website alone saves counted sets.

Run commands from the app's own folder (`cd mobile`, `cd mac`, `cd win`, or `cd extension`);
each has its own `package.json` and `node_modules`.
