# Rhythm local Release builds

These builds are for demo testing on a computer. No TestFlight, store submission, or public binary hosting is involved.
The phone apps use the deployed API and Clerk account. The Mac app keeps its existing local demo database.

| Target | Artifact | Test on this computer |
| --- | --- | --- |
| iPhone | `Rhythm-iOS-Simulator-Release.zip` | Unzip and drag `Rhythm.app` onto the iPhone simulator. |
| Apple Watch | `Rhythm-watchOS-Simulator-Release.zip` | Install `watch.app` on the paired Watch simulator with `xcrun simctl install <watch-UDID> <path-to-watch.app>`. The iPhone archive also embeds the Watch app. |
| Android | `Rhythm-1.0.0-android-release.apk` | Drag the APK onto a running ARM64 Android emulator. |
| Android archive | `Rhythm-1.0.0-android-release.aab` | Retained for future packaging; use the APK for direct installation. |
| Mac | `Rhythm.app` and its ZIP | Open the app on an Apple silicon Mac. |

The applications bundle their JavaScript and run without Metro. iPhone and Watch simulator apps target Apple silicon;
physical Apple devices require their own signing/provisioning. Mac is ad-hoc signed and has not been notarized.
The Android APK uses a dedicated local release key rather than the generated Android debug key.

## Artifact library

Artifacts are stored under `artifacts/releases/YYYY-MM-DD/`, outside Git. After all builds finish, generate the
local HTML catalog, manifest, and SHA-256 checksums from the repository root:

```sh
node scripts/catalog-demo-builds.mjs artifacts/releases/YYYY-MM-DD
open artifacts/releases/YYYY-MM-DD/index.html
```

Each platform's `build-result.json` records its verification results and limitations. The catalog links to the
actual ZIP/APK/AAB files. Optional website checks and screenshots are saved under `verification/`.
Double-click `Open demo.command` in Finder to choose and launch a platform. Start the relevant iPhone/Watch simulator
or Android emulator first; the helper preserves existing app data and never uninstalls a conflicting Android package.
Verify the packaged files with `shasum -a 256 -c SHA256SUMS` from the release directory.
The website's download URLs remain empty until there is an actual HTTPS distribution destination.

## Rebuild iPhone and Watch

Requirements: Xcode with iOS/watchOS simulator runtimes, Node 24, installed `mobile/` dependencies, and CocoaPods.
The existing EAS account supplies only public app configuration. No backend API secret belongs in a native bundle.

From `mobile/`, generate the current native project and install Pods using the project's normal CocoaPods setup:

```sh
EXPO_NO_DOTENV=1 npx eas-cli@latest env:exec production 'npx expo prebuild --platform ios' --non-interactive
EXPO_NO_DOTENV=1 npx eas-cli@latest env:exec production 'bash scripts/build-ios-release.sh simulator' --non-interactive
```

`RHYTHM_RELEASE_DIR` overrides the output directory; `RHYTHM_IOS_DERIVED_DATA` overrides the build cache.
The script limits native and Metro workers to two by default. Its optional `archive` mode makes an unsigned device
archive for later signing; this mode is separate from the simulator builds and does not produce an installable IPA.
Simulator builds use local ad-hoc signing so Clerk can access the keychain through SecureStore. Disabling all
code signing can let the app launch while leaving sign-in stuck waiting for keychain access.

`mobile/eas.json` also defines a `demo-simulator` Release profile using the EAS production environment. Cloud builds
are optional and subject to the account's available quota; the local workflow above does not submit a cloud build.

## Rebuild Android

Requirements: Java 17, Android SDK/build tools, Node 24, and installed `mobile/` dependencies. From `mobile/`:

```sh
EXPO_NO_DOTENV=1 npx eas-cli@latest env:exec production 'node scripts/build-android-release.mjs' --non-interactive
```

The runner regenerates the Android project, signs Release with a separate Gradle initializer, builds APK/AAB,
and checks the signing certificate and embedded production URLs. `RHYTHM_RELEASE_OUTPUT_DIR` overrides the output;
`RHYTHM_ANDROID_ARCHITECTURES` defaults to `arm64-v8a` for this computer's emulator; use `arm64-v8a,x86_64` if an
Intel emulator is also needed.

Keep `~/.codex/private/rhythm-android-signing.json` and its referenced keystore private and backed up.
The script reuses this key for subsequent builds, which allows app updates without uninstalling and losing data.
Do not place signing material in the artifact library. `RHYTHM_ANDROID_SIGNING_FILE` supports another private location.

The `demo-android` EAS profile is available for a future cloud build; local signing credentials are not automatically
uploaded to EAS. The local runner above is the verified packaging path for this demo.

## Rebuild Mac

See [mac/README.md](../mac/README.md) for CocoaPods/Ruby prerequisites. From `mac/macos/`:

```sh
EXPO_NO_DOTENV=1 EXTRA_PACKAGER_ARGS='--max-workers 2' xcodebuild \
  -workspace NorthAssistant.xcworkspace -scheme NorthAssistant-macOS \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/DerivedData -jobs 2 \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGN_IDENTITY=- build
```

The app is at `build/DerivedData/Build/Products/Release/Rhythm.app`. Copy it into the `macos/` release folder and
use `ditto -c -k --sequesterRsrc --keepParent` to create a ZIP. Website handoffs open the deployed Expo website.

## Deployment checks and limits

The deployed services are <https://rhythm-buildnorth.expo.app> and <https://buildnorth.onrender.com>.
Each artifact's verification record distinguishes build checks, process startup, and interactive tests. A successful
build alone does not confirm sign-in or navigation. Hardware camera/microphone permissions, physical Watch readings
and real HealthKit syncing require device testing.

The current public website supports signed-in Calendar and shared Claude Coach. The camera coach remains a
localhost-only integration. Long-term memory and the separate Parakeet/Kokoro worker are not configured on the live
backend. Those services need their own deployment and end-to-end tests.
