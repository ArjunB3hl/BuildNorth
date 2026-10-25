This repository holds two apps and a Chrome companion; see README.md for the layout.

- `mobile/`: the Expo app (iPhone, Android, Apple Watch) and the FastAPI backend in `mobile/backend/`. Its rules:
  @mobile/AGENTS.md
- `mac/`: the macOS app (React Native for macOS + parts of Expo SDK 55). Read `mac/README.md` before changing its
  native setup: Expo has no macOS target there, and only some Expo modules compile for macOS.
- `extension/`: Rhythm (WXT, React, TypeScript, Manifest V3). Read `extension/README.md` and
  `mobile/docs/rhythm.md`. Its backend lives in `mobile/backend/app/rhythm/`.

- `inference/pose-coach/`: local browser camera coach. Read its `docs/HANDOFF.md` and `mobile/docs/pose-coach.md`.
  Private assets and recordings stay in ignored `.data/`; the website alone saves counted sets.

Run commands from the app's own folder (`cd mobile`, `cd mac`, or `cd extension`);
each has its own `package.json` and `node_modules`.
