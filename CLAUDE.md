This repository holds two apps; see README.md for the layout.

- `mobile/`: the Expo app (iPhone, Android, Apple Watch) and the FastAPI backend in `mobile/backend/`. Its rules:
  @mobile/AGENTS.md
- `mac/`: the macOS app (React Native for macOS + parts of Expo SDK 55). Read `mac/README.md` before changing its
  native setup: Expo has no macOS target there, and only some Expo modules compile for macOS.

Run commands from the app's own folder (`cd mobile` or `cd mac`); each has its own `package.json` and `node_modules`.
