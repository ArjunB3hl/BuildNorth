export const DEMO_RELEASE_URL = 'https://github.com/ArjunB3hl/BuildNorth/releases/download/rhythm-demo-2026-10-25';

export type DemoDownloadId = 'chrome' | 'mac' | 'android' | 'ios' | 'watchos';
export type DemoDownload = {
  id: DemoDownloadId;
  title: string;
  description: string;
  compatibility: string;
  filename: string;
  bytes: number;
  format: 'ZIP' | 'APK';
  label: string;
  note: string;
  steps: string[];
};

export const demoDownloads: DemoDownload[] = [
  {
    id: 'chrome', title: 'The Chrome extension',
    description: 'Bring the videos you choose into Rhythm. Keep useful recipes, workouts and ideas close to your day.',
    compatibility: 'Desktop Chrome · Manual installation',
    filename: 'Rhythm-Chrome-Production.zip', bytes: 1307312, format: 'ZIP', label: 'Download Chrome extension',
    note: 'An unpacked demo extension, not a Chrome Web Store listing. Sign in through the Rhythm website after installing.',
    steps: [
      'Download and unzip the archive. Keep the extracted folder on your computer.',
      'In Chrome, open chrome://extensions and turn on Developer mode.',
      'Choose Load unpacked, then select the extracted folder containing manifest.json.',
      'Pin Rhythm from the extensions menu. Open it and choose Sign in to connect through the Rhythm website.',
    ],
  },
  {
    id: 'mac', title: 'Rhythm for Mac',
    description: 'A native space for your Calendar, meals and movement, with a local demo Coach.',
    compatibility: 'Apple silicon · macOS 14 or later',
    filename: 'Rhythm-macOS-arm64.zip', bytes: 6774340, format: 'ZIP', label: 'Download for Mac',
    note: 'Local demo data, without live account sync. This build is ad-hoc signed and not notarized; macOS may ask you to approve opening it.',
    steps: [
      'Download and unzip the archive to find Rhythm.app. You can move it to Applications.',
      'Open Rhythm. If macOS blocks it, review System Settings → Privacy & Security → Open Anyway. Approve only if you trust this download.',
      'Explore the local demo. To use Coach with your own Claude API key, open Profile → AI connections.',
    ],
  },
  {
    id: 'android', title: 'Rhythm for Android',
    description: 'Take your signed-in Calendar, saved content and Coach with you.',
    compatibility: 'ARM64 devices · Android 7 or later',
    filename: 'Rhythm-1.0.0-android-release.apk', bytes: 46082413, format: 'APK', label: 'Download Android APK',
    note: 'A signed demo APK installed outside Google Play. Launch tested on an ARM64 emulator; physical-device behavior is not yet verified.',
    steps: [
      'Download the APK on an ARM64 Android device, then open it from Downloads.',
      'If prompted, allow your chosen browser or file manager to install this app, then follow the installer.',
      'Open Rhythm and sign in with your website account. For an ARM64 emulator, drag the APK onto its window to install.',
    ],
  },
  {
    id: 'ios', title: 'iPhone Simulator',
    description: 'Explore the iPhone demo in Xcode Simulator on your Mac.',
    compatibility: 'Apple silicon Mac · Xcode · iPhone Simulator',
    filename: 'Rhythm-iOS-Simulator-Release.zip', bytes: 22072099, format: 'ZIP', label: 'Download iPhone simulator build',
    note: 'Simulator only: this does not install on a physical iPhone or iPad. Use the Rhythm website on your phone.',
    steps: [
      'On an Apple silicon Mac with Xcode installed, download and unzip the archive.',
      'Open an iPhone in Xcode Simulator, then drag Rhythm.app onto the simulator to install it.',
      'Open Rhythm and sign in. This archive also includes the Watch companion.',
    ],
  },
  {
    id: 'watchos', title: 'Apple Watch Simulator',
    description: 'Preview the workout and sleep experience alongside the iPhone simulator.',
    compatibility: 'Apple silicon Mac · Xcode · Paired simulators',
    filename: 'Rhythm-watchOS-Simulator-Release.zip', bytes: 1202115, format: 'ZIP', label: 'Download Watch simulator build',
    note: 'Simulator only: this does not install on a physical Apple Watch. Real heart rate, sleep and workout sensors require hardware; live uploads are not yet verified.',
    steps: [
      'Start paired iPhone and Apple Watch simulators in Xcode. Install the iPhone demo above.',
      'Download and unzip this archive. Find the paired Watch device ID in Xcode’s Devices and Simulators window, then run: xcrun simctl install <watch-UDID> <path-to-watch.app>.',
      'In the iPhone app, go to Profile → Apple Watch → Sign in Apple Watch to link your account. Re-link if you used an older local demo.',
    ],
  },
];

export function demoDownloadUrl(download: DemoDownload) {
  return `${DEMO_RELEASE_URL}/${download.filename}`;
}

export function downloadSize(bytes: number) {
  return `${(bytes / 1000000).toFixed(1)} MB`;
}
