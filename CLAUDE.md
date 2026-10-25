This repository holds two apps; see README.md for the layout.

- `mobile/`: the Expo app (iPhone, Android, Apple Watch) and the FastAPI backend in `mobile/backend/`. Its rules:
  @mobile/AGENTS.md
- `mac/`: the macOS app (React Native for macOS + parts of Expo SDK 55). Read `mac/README.md` before changing its
  native setup: Expo has no macOS target there, and only some Expo modules compile for macOS.

- `win/`: the Windows app (React Native for Windows 0.85 + Expo SDK 56 tooling, ported from `mac/`). Read
  `win/README.md` before changing its native setup: Expo modules don't run on Windows at all, `win/windows/` is
  committed source (no prebuild), and Windows alerts show at most three buttons.

Run commands from the app's own folder (`cd mobile`, `cd mac` or `cd win`); each has its own `package.json` and
`node_modules`.
