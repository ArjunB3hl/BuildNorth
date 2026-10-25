// Expo's Metro config, with `react-native` resolved to `react-native-windows` for Windows
// bundles. The React Native CLI adds this mapping itself; `expo start` doesn't, so it's done
// here, as in the Mac app's metro.config.js. The block list comes from the
// react-native-windows template: Metro must not watch the msbuild output under windows/.
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// Metro's file lookup is case-sensitive, so use the drive letter case of the cwd.
function normalizePathDrive(p) {
  if (process.platform === 'win32' && p.length >= 2 && p[1] === ':') {
    return process.cwd()[0] + p.slice(1);
  }
  return p;
}

const rnwPath = normalizePathDrive(
  fs.realpathSync(
    path.resolve(require.resolve('react-native-windows/package.json'), '..'),
  ),
).replace(/[/\\]/g, '/');

config.resolver.platforms = [
  ...new Set([...(config.resolver.platforms ?? []), 'windows']),
];

config.resolver.blockList = [
  ...[config.resolver.blockList ?? []].flat(),
  new RegExp(`${path.resolve(__dirname, 'windows').replace(/[/\\]/g, '/')}.*`),
  new RegExp(`${rnwPath}/build/.*`),
  new RegExp(`${rnwPath}/target/.*`),
  /.*\.ProjectImports\.zip/,
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'windows' &&
    (moduleName === 'react-native' || moduleName.startsWith('react-native/'))
  ) {
    return context.resolveRequest(
      context,
      moduleName.replace('react-native', 'react-native-windows'),
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Run only React Native's own InitializeCore before the app. Expo's default list adds Expo's
// runtime, whose native side doesn't exist on Windows.
const originalGetModulesRunBeforeMainModule =
  config.serializer.getModulesRunBeforeMainModule;
config.serializer.getModulesRunBeforeMainModule = () => {
  try {
    return [
      require.resolve('react-native/Libraries/Core/InitializeCore'),
      require.resolve('react-native-windows/Libraries/Core/InitializeCore'),
    ];
  } catch {}
  return originalGetModulesRunBeforeMainModule();
};

module.exports = config;
