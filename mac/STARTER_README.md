# North Assistant - React Native macOS starter

Prepared 19 October 2026. This is an initial native UI and a Mac setup script, not a compiled application or an AI integration.

## What you get

- Today, Coach, Memory and Devices screens built with React Native components.
- Working navigation and a preference editor using temporary in-process state.
- A setup script that creates a NEW project using the official generators.
- No backend keys, accounts, camera capture, model inference or persistent memory.

## Requirements

- A Mac with full Xcode installed, opened once, and its required components installed. Command Line Tools alone cannot compile this app.
- Node.js >=20.19.4 and npm. A maintained compatible LTS release is preferable.
- Ruby and Bundler compatible with the generated project's Gemfile. The script runs `bundle install` and `bundle exec pod install`.
- Internet access and space for dependencies and Xcode build output.

If a requirement is missing, the script stops and reports it. It does not install system software, run sudo, change your Xcode selection or delete existing projects.

## First run

Extract the ZIP. In Terminal, navigate to the extracted `NorthAssistantMacStarter` folder. If you extracted it into Downloads:

```bash
cd ~/Downloads/NorthAssistantMacStarter
bash setup.sh --check
bash setup.sh
```

The default new-project path is `~/Developer/NorthAssistant`. To choose a different NEW destination:

```bash
NORTH_ASSISTANT_DIR="$HOME/Developer/NorthAssistantTrial" bash setup.sh
```

Once setup finishes, start Metro in Terminal 1:

```bash
cd ~/Developer/NorthAssistant
npm start
```

Then build and launch in Terminal 2:

```bash
cd ~/Developer/NorthAssistant
npm run macos
```

The second command invokes `react-native run-macos --no-packager`. Keep Metro running. Expect the initial native build to take longer than subsequent launches.

## Version selection

Verified against npm metadata and Microsoft's release notes on 19 October 2026:

- React Native macOS: 0.83.0
- React Native: 0.83.10 (the exact peer version declared by macOS 0.83.0)
- React Native community initialization CLI: 20.2.0
- react-native-macos-init: 2.1.3

The official getting-started page still illustrates an older 0.81 release. This script pins the newer matching pair. Generated package-lock and Gemfile.lock files should be kept with your eventual project.

## Expo and Windows

First establish that this native Mac window compiles and runs. Expo's macOS module integration is experimental and requires native configuration. Add only modules whose macOS support and React Native version compatibility you have verified; this starter does not install Expo yet. A Windows target is a separate setup.

## If setup fails

Paste the first error and the preceding command into the chat. The script intentionally refuses to overwrite an existing target directory. If failure happened after project creation, preserve that directory and resume the failed installation step there rather than rerunning initialization over it. Alternatively, choose a new destination with NORTH_ASSISTANT_DIR.

For Xcode errors, inspect `xcode-select -p` and `xcodebuild -version`. For Bundler/Ruby errors, inspect `ruby --version` and `bundle --version`. Do not solve package compatibility failures by adding `--force` or `--legacy-peer-deps` without investigating the conflict.

## Verification performed

The shell script's syntax and the App.tsx syntax were checked in a Linux environment. The non-macOS preflight was checked to fail before initialization. Xcode compilation, CocoaPods installation and native UI rendering cannot be verified in that environment and remain to be tested on your Mac.

## Official references

- https://microsoft.github.io/react-native-macos/docs/getting-started
- https://github.com/microsoft/react-native-macos/releases
- https://microsoft.github.io/react-native-macos/docs/cli-commands
- https://microsoft.github.io/react-native-macos/docs/guides/installing-expo-modules
- https://docs.expo.dev/modules/additional-platform-support/
