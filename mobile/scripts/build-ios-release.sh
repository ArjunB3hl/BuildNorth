#!/usr/bin/env bash
set -euo pipefail

# Run from mobile/ through `eas env:exec production` so native releases use
# the deployed API and never inherit a developer's .env.local overrides.
cd "$(dirname "$0")/.."
export EXPO_NO_DOTENV=1
export NODE_ENV=production
export NODE_BINARY="${NODE_BINARY:-$(command -v node)}"
export EXTRA_PACKAGER_ARGS="${EXTRA_PACKAGER_ARGS:---max-workers 2}"

node - <<'JS'
for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WEB_APP_URL']) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; use EAS production environment.`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || /localhost|127\.0\.0\.1|ngrok/i.test(url.hostname)) {
    throw new Error(`${name} must use the deployed HTTPS service.`);
  }
}
if (!process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required.');
}
JS

mode="${1:-simulator}"
release_dir="${RHYTHM_RELEASE_DIR:-$PWD/../artifacts/releases/$(date +%F)}"
derived_data="${RHYTHM_IOS_DERIVED_DATA:-$PWD/ios/build/ReleaseDerivedData}"
mkdir -p "$release_dir/ios" "$release_dir/watchos"

args=(-workspace ios/Rhythm.xcworkspace -scheme Rhythm -configuration Release
  -derivedDataPath "$derived_data" -jobs "${RHYTHM_BUILD_JOBS:-2}")

verify_bundle() {
  node - "$1" <<'JS'
const fs = require('node:fs');
const bundle = fs.readFileSync(process.argv[2]);
for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WEB_APP_URL']) {
  if (!bundle.includes(Buffer.from(process.env[name]))) {
    throw new Error(`Release bundle does not contain configured ${name}.`);
  }
}
for (const obsolete of ['unintrusive-timika-unshadily.ngrok-free.dev', 'localhost:8001']) {
  if (bundle.includes(Buffer.from(obsolete))) {
    throw new Error('Release bundle contains an obsolete development endpoint.');
  }
}
console.log('Embedded release bundle uses the configured deployed API and website.');
JS
}

case "$mode" in
  simulator)
    # Simulator SecureStore still needs an application-identifier entitlement.
    # Local ad-hoc signing supplies it without a distribution certificate/login.
    xcodebuild "${args[@]}" -destination 'generic/platform=iOS Simulator' \
      ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGN_IDENTITY=- \
      CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES build
    app="$derived_data/Build/Products/Release-iphonesimulator/Rhythm.app"
    watch="$app/Watch/watch.app"
    test -f "$app/main.jsbundle"
    test -d "$watch"
    verify_bundle "$app/main.jsbundle"
    python3 scripts/verify-ios-simulator-bundle.py "$app"
    ditto -c -k --sequesterRsrc --keepParent "$app" "$release_dir/ios/Rhythm-iOS-Simulator-Release.zip"
    ditto -c -k --sequesterRsrc --keepParent "$watch" "$release_dir/watchos/Rhythm-watchOS-Simulator-Release.zip"
    ;;
  archive)
    # This is a device archive for later signing, not an installable IPA.
    archive="$release_dir/ios/Rhythm-iOS-Unsigned.xcarchive"
    xcodebuild "${args[@]}" -destination 'generic/platform=iOS' \
      -archivePath "$archive" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO archive
    test -f "$archive/Products/Applications/Rhythm.app/main.jsbundle"
    test -d "$archive/Products/Applications/Rhythm.app/Watch/watch.app"
    verify_bundle "$archive/Products/Applications/Rhythm.app/main.jsbundle"
    ditto -c -k --sequesterRsrc --keepParent "$archive" "$release_dir/ios/Rhythm-iOS-Unsigned.xcarchive.zip"
    ;;
  *)
    echo 'Usage: build-ios-release.sh [simulator|archive]' >&2
    exit 2
    ;;
esac
