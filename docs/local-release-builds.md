# Rhythm local Release builds

These Release builds are for demo testing. Prepared packages are also available from the website's
[downloads page](https://rhythm-buildnorth.expo.app/downloads), backed by the repository's
[demo release assets](https://github.com/ArjunB3hl/BuildNorth/releases/tag/rhythm-demo-2026-10-25).
No TestFlight or app store submission is involved. Download controls appear only on the website.
The phone apps use the deployed API and Clerk account. The Mac app keeps its existing local demo database.

| Target | Artifact | Test on this computer |
| --- | --- | --- |
| iPhone | `Rhythm-iOS-Simulator-Release.zip` | Unzip and drag `Rhythm.app` onto the iPhone simulator. |
| Apple Watch | `Rhythm-watchOS-Simulator-Release.zip` | Install `watch.app` on the paired Watch simulator with `xcrun simctl install <watch-UDID> <path-to-watch.app>`. The iPhone archive also embeds the Watch app. |
| Android | `Rhythm-1.0.0-android-release.apk` | Drag the APK onto a running ARM64 Android emulator. |
| Android archive | `Rhythm-1.0.0-android-release.aab` | Retained for future packaging; use the APK for direct installation. |
| Mac | `Rhythm.app` and its ZIP | Open the app on an Apple silicon Mac. |
| Chrome extension | Production extension ZIP | Unzip, open `chrome://extensions`, enable Developer mode, and load its unpacked folder. |

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
The Mac option starts the packaged Release as a separate instance, so an open development copy cannot intercept it.
Both Mac copies use the same local demo database; close the one you are not testing before making edits.
Verify the packaged files with `shasum -a 256 -c SHA256SUMS` from the release directory.
The public website links to five versioned release assets: the Chrome ZIP, Mac ZIP, Android APK,
iPhone simulator ZIP and Watch simulator ZIP. The Android AAB remains in the local artifact library;
it is not directly installable. Windows has no build and remains unavailable.
The extension's verification record includes its stable ID and required Clerk/Render origin setup. The separate
production package does not replace the user's installed development extension automatically.

## Website downloads

The public `/downloads` route does not require sign-in. The website's sign-in page and navigation link to it;
the old `/profile/downloads` link remains supported. Native routes redirect without displaying download controls.
Downloading a package does not install it automatically or publish it to an app store.

- **Chrome:** unzip, open `chrome://extensions`, enable Developer mode, then **Load unpacked** and select the
  directory containing `manifest.json`. Pin Rhythm and use its website sign-in button. The packaged `SETUP.txt`
  describes the Clerk/Render origin prerequisites; signed-in extension synchronization still needs verification.
- **Mac:** Apple silicon, macOS 14 or later. Unzip and open `Rhythm.app`. This demo uses local data and is ad-hoc
  signed, without notarization. macOS may require explicit approval in System Settings > Privacy & Security.
  See [Apple's guidance](https://support.apple.com/en-us/102445); do not disable Gatekeeper globally.
- **Android:** ARM64, Android 7 or later. Download the APK on a compatible device and approve installation from
  the browser if prompted, or drag it onto an ARM64 emulator. Emulator launch is verified; physical-device and
  authenticated account testing remain outstanding.
- **iPhone / Watch:** Apple silicon Xcode Simulator builds only. They cannot install on a physical iPhone or
  Watch. Use the website on a physical iPhone for this demo. Physical Apple builds require separate signing and
  provisioning. Watch sensors and HealthKit readings require real hardware.

Only the five reviewed packages and `SHA256SUMS` are uploaded as release assets. Logs, screenshots, signing keys,
account state and local verification records stay in the local artifact library. Packages are hosted on GitHub
Releases rather than committed to Git or bundled into the Expo website. The release is marked as a demo prerelease.
For a future package refresh, publish a new versioned release, verify its anonymous download URLs and checksums,
update the web download catalog, then export and deploy the website. Do not replace files under existing links.

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

On this Mac, start the preserved test emulator from the repository root with
`python3 scripts/start-android-demo-emulator.py`. A copy is included in the artifact folder. Add `--headless` for
unattended testing or `--avd NAME` for another existing ARM64 AVD. The helper uses SwiftShader with guest Vulkan
disabled, waits up to two minutes for boot, and never resets data or downloads a system image.

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
Run the credential-free public check from the repository root:

```sh
python3 scripts/check-deployment.py --output artifacts/releases/YYYY-MM-DD/verification/deployment-latest.json
```

It checks readiness, protected API routes, allowed/rejected CORS origins, and both MCP discovery/authentication
challenges. It makes no account writes or paid model requests. `--api` and `--website` accept another pair of origins.
Each artifact's verification record distinguishes build checks, process startup, and interactive tests. A successful
build alone does not confirm sign-in or navigation. Hardware camera/microphone permissions, physical Watch readings
and real HealthKit syncing require device testing.

The current public website supports signed-in Calendar and shared Claude Coach. The camera coach remains a
localhost-only integration. Long-term memory and the separate Parakeet/Kokoro worker are not configured on the live
backend. Those services need their own deployment and end-to-end tests.
