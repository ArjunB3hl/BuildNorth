#!/usr/bin/env node
// Run with EAS production variables: eas env:exec production 'node scripts/build-android-release.mjs'.
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageExisting = process.argv.includes('--package-existing');
const env = { ...process.env, EXPO_NO_DOTENV: '1', NODE_ENV: 'production', CI: '1', CMAKE_BUILD_PARALLEL_LEVEL: '2' };
for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WEB_APP_URL']) {
  const value = new URL(env[name] || 'http://localhost');
  if (value.protocol !== 'https:' || /^(localhost|127\.|\[::1\])/.test(value.hostname) || value.username || value.password) {
    throw new Error(`${name} must be a public HTTPS URL; load EAS production variables first.`);
  }
}
if (!env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_')) {
  throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required.');
}
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || join(homedir(), 'Library/Android/sdk');
env.ANDROID_HOME = sdk;
env.ANDROID_SDK_ROOT = sdk;
const signingFile = resolve(env.RHYTHM_ANDROID_SIGNING_FILE || join(homedir(), '.codex/private/rhythm-android-signing.json'));
mkdirSync(dirname(signingFile), { recursive: true, mode: 0o700 });
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
  return result.stdout;
}
if (!existsSync(signingFile)) {
  if (packageExisting) throw new Error('The signing configuration for the existing APK is required.');
  const signing = {
    keystore: join(dirname(signingFile), 'rhythm-android-release.p12'),
    alias: 'rhythm-release',
    password: randomBytes(32).toString('base64url'),
  };
  if (existsSync(signing.keystore)) throw new Error('A keystore exists without its signing configuration; preserve it and restore the configuration.');
  env.RHYTHM_ANDROID_STORE_PASSWORD = signing.password;
  run('keytool', ['-genkeypair', '-noprompt', '-storetype', 'PKCS12', '-keystore', signing.keystore,
    '-alias', signing.alias, '-storepass:env', 'RHYTHM_ANDROID_STORE_PASSWORD',
    '-keypass:env', 'RHYTHM_ANDROID_STORE_PASSWORD', '-keyalg', 'RSA', '-keysize', '3072',
    '-validity', '10000', '-dname', 'CN=Rhythm Demo Release, O=Rhythm, C=CA']);
  chmodSync(signing.keystore, 0o600);
  writeFileSync(signingFile, `${JSON.stringify(signing, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
const signing = JSON.parse(readFileSync(signingFile, 'utf8'));
if (!existsSync(signing.keystore) || !signing.alias || !signing.password) throw new Error('Invalid private Android signing configuration.');
Object.assign(env, {
  RHYTHM_ANDROID_KEYSTORE: signing.keystore,
  RHYTHM_ANDROID_KEY_ALIAS: signing.alias,
  RHYTHM_ANDROID_STORE_PASSWORD: signing.password,
  RHYTHM_ANDROID_KEY_PASSWORD: signing.password,
});
const architectures = env.RHYTHM_ANDROID_ARCHITECTURES || 'arm64-v8a';
if (!packageExisting) {
  run(process.execPath, ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install']);
  run('./gradlew', ['--no-daemon', '--max-workers=2', '--console=plain',
    '-I', join(root, 'scripts/android-release-signing.gradle'),
    `-PreactNativeArchitectures=${architectures}`, ':app:assembleRelease', ':app:bundleRelease'],
  { cwd: join(root, 'android') });
}

const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const output = resolve(env.RHYTHM_RELEASE_OUTPUT_DIR || join(root, '../artifacts/releases', new Date().toISOString().slice(0, 10), 'android'));
mkdirSync(output, { recursive: true });
const files = [
  ['apk', 'app/build/outputs/apk/release/app-release.apk'],
  ['aab', 'app/build/outputs/bundle/release/app-release.aab'],
].map(([extension, relative]) => {
  const name = `Rhythm-${config.version}-android-release.${extension}`;
  copyFileSync(join(root, 'android', relative), join(output, name));
  const bytes = readFileSync(join(output, name));
  return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const buildTools = readdirSync(join(sdk, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
const signer = buildTools.map(version => join(sdk, 'build-tools', version, 'apksigner')).find(existsSync);
if (!signer) throw new Error('Android apksigner is missing.');
const verification = run(signer, ['verify', '--verbose', '--print-certs', join(output, files[0].name)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const entries = run('unzip', ['-Z1', join(output, files[0].name)], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
const packagedArchitectures = [...new Set(entries.split('\n').filter(name => /^lib\/[^/]+\/[^/]+\.so$/.test(name)).map(name => name.split('/')[1]))].sort();
if (packagedArchitectures.join(',') !== architectures.split(',').sort().join(',')) throw new Error('Packaged APK architectures differ from the requested build.');
const certificate = run('keytool', ['-exportcert', '-keystore', signing.keystore, '-alias', signing.alias,
  '-storepass:env', 'RHYTHM_ANDROID_STORE_PASSWORD'], { stdio: ['ignore', 'pipe', 'inherit'] });
const certificateDigest = createHash('sha256').update(certificate).digest('hex');
if (!verification.toLowerCase().includes(certificateDigest)) throw new Error('APK is not signed with the dedicated Rhythm release certificate.');
writeFileSync(join(output, 'signing-verification.txt'), verification);
run('jarsigner', ['-verify', join(output, files[1].name)]);
const bundle = run('unzip', ['-p', join(output, files[0].name), 'assets/index.android.bundle'], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 32 * 1024 * 1024 });
for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WEB_APP_URL']) {
  if (!bundle.includes(Buffer.from(env[name]))) throw new Error(`APK bundle is missing ${name}.`);
}
if (bundle.includes(Buffer.from('unintrusive-timika-unshadily.ngrok-free.dev'))) throw new Error('APK contains the obsolete development API.');
writeFileSync(join(output, 'build-info.json'), `${JSON.stringify({
  name: config.name, version: config.version, versionCode: config.android.versionCode || 1,
  package: config.android.package, configuration: 'Release', architectures: architectures.split(','),
  builtAt: new Date().toISOString(), apiUrl: env.EXPO_PUBLIC_API_URL, webUrl: env.EXPO_PUBLIC_WEB_APP_URL,
  signing: 'Dedicated local Rhythm release key (not the Android debug key)',
  certificateSha256: certificateDigest,
  distribution: 'Local build only; not submitted to a store', files,
}, null, 2)}\n`);
console.log(`Verified signed Android Release APK and AAB saved to ${output}`);
