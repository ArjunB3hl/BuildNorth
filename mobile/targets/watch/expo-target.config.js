// Apple Watch companion app, generated into ios/ by @bacons/apple-targets on `npx expo prebuild -p ios --clean`.
// System frameworks (SwiftUI, HealthKit, WatchConnectivity, Security, WatchKit) link through `import`, so there is
// no `frameworks` key. Info.plist next to this file is hand-maintained.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: 'watch',
  displayName: 'Rhythm',
  // Appended to the iOS bundle identifier: com.arjun273773.buildnorth.watch
  bundleIdentifier: '.watch',
  deploymentTarget: '11.0',
  icon: '../../assets/images/icon.png',
  colors: { $accent: '#208AEF' },
  entitlements: {
    'com.apple.developer.healthkit': true,
    'com.apple.developer.healthkit.access': [],
  },
});
