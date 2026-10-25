#!/usr/bin/env node
// Index locally packaged release builds. Does not upload or publish anything.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.argv[2] || join(root, 'artifacts/releases', new Date().toISOString().slice(0, 10)));
const platforms = [
  { id: 'ios', name: 'iPhone', target: 'Xcode Simulator', instructions: 'Unzip the simulator archive, then drag Rhythm.app onto a booted iPhone simulator. This build does not install on a physical iPhone.' },
  { id: 'watchos', name: 'Apple Watch', target: 'Xcode Simulator', instructions: 'Use the paired Watch simulator. The iPhone simulator archive also contains the Watch app. Physical HealthKit sensor readings require real hardware.' },
  { id: 'android', name: 'Android', target: 'Android emulator · ARM64', instructions: 'Drag the APK onto a running ARM64 Android emulator to install it. The AAB is an archive for future packaging, not a directly installable app.' },
  { id: 'macos', name: 'Mac', target: 'Apple silicon Mac', instructions: 'Unzip the archive and open Rhythm.app. This is an ad-hoc signed local demo, without notarization. Its JavaScript is bundled; Metro is not required.' },
  { id: 'extension', name: 'Chrome extension', target: 'Chrome · Load unpacked', instructions: 'Unzip the production build and load its folder from chrome://extensions with Developer mode enabled. It uses the live website and API and keeps the existing Rhythm extension identity. Review the <a href="extension/SETUP.txt">account setup notes</a> before replacing your local development copy.' },
];
const checksumLines = [];
for (const platform of platforms) {
  let names = [];
  try { names = await readdir(join(directory, platform.id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  platform.files = [];
  for (const name of names.filter(name => /\.(apk|aab|zip)$/.test(name)).sort()) {
    const path = `${platform.id}/${name}`;
    let size = 0;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(directory, path))) { hash.update(chunk); size += chunk.length; }
    const sha256 = hash.digest('hex');
    platform.files.push({ name, path, bytes: size, sha256 });
    checksumLines.push(`${sha256}  ${path}`);
  }
  if (names.includes('build-result.json')) platform.verification = JSON.parse(await readFile(join(directory, platform.id, 'build-result.json'), 'utf8'));
}
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const trackedChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim() !== '';
const manifest = { name: 'Rhythm', edition: 'Demo version', configuration: 'Release', distribution: 'Local computer testing only', generatedAt: new Date().toISOString(), sourceCommit, trackedChanges, website: 'https://rhythm-buildnorth.expo.app', api: 'https://buildnorth.onrender.com', platforms };
try {
  manifest.verification = JSON.parse(await readFile(join(directory, 'verification/web-and-code-checks.json'), 'utf8'));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(directory, 'SHA256SUMS'), checksumLines.join('\n') + '\n');
await copyFile(join(root, 'scripts/launch-local-demo.sh'), join(directory, 'launch-demo.sh'));
await copyFile(join(root, 'scripts/start-android-demo-emulator.py'), join(directory, 'start-android-demo-emulator.py'));
await writeFile(join(directory, 'Open demo.command'), '#!/usr/bin/env bash\ncd "$(dirname "$0")"\nexec bash ./launch-demo.sh "$@"\n');
await chmod(join(directory, 'Open demo.command'), 0o755);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cards = platforms.map(platform => `<article><span class="tag">${platform.files.length ? 'RELEASE BUILD' : 'PENDING'}</span><h2>${platform.name}</h2><p class="target">${platform.target}</p><p>${platform.instructions}</p><ul>${platform.files.map(file => `<li><a href="${file.path.split('/').map(encodeURIComponent).join('/')}">${escape(file.name)}</a><span>${(file.bytes / 1024 / 1024).toFixed(1)} MB</span></li>`).join('')}</ul>${platform.verification ? `<details><summary>Verification details</summary><pre>${escape(JSON.stringify(platform.verification, null, 2))}</pre></details>` : ''}</article>`).join('');
await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rhythm · Local demo builds</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0c1016;color:#e9edf5}*{box-sizing:border-box}body{max-width:1120px;padding:48px 24px;margin:auto}header{margin:0 0 32px}.eyebrow,.tag{font-size:11px;letter-spacing:.14em;color:#70e3bc;font-weight:700}h1{font-size:48px;letter-spacing:-.05em;margin:12px 0}h2{font-size:27px;margin:16px 0 4px}p{color:#aab5c7;line-height:1.6}.target{color:#e9edf5;font-weight:600;margin-top:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}article{background:#151d28;border:1px solid #2c384a;border-radius:20px;padding:28px}ul{list-style:none;padding:0;margin:24px 0 0}li{padding:12px 0;border-top:1px solid #2c384a}a{color:#77baff;text-decoration:none;overflow-wrap:anywhere}a:hover{text-decoration:underline}li span{display:block;color:#8492a8;font-size:12px;margin-top:5px}details{margin-top:18px;color:#aab5c7;font-size:13px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}footer{margin:28px 0;font-size:13px;color:#8492a8}footer a{margin-right:20px}@media(max-width:650px){.grid{grid-template-columns:1fr}h1{font-size:36px}body{padding:28px 18px}}
</style><header><div class="eyebrow">RHYTHM · DEMO VERSION</div><h1>Your local builds.</h1><p>Standalone Release builds for testing on this computer. No TestFlight, store submission, or public distribution.</p><p>In Finder, double-click <strong>Open demo.command</strong> to install and launch a build on a running simulator or open the Mac app.</p><a href="https://rhythm-buildnorth.expo.app">Open the live website ↗</a></header><main class="grid">${cards}</main><footer><a href="manifest.json">Build manifest</a><a href="SHA256SUMS">SHA-256 checksums</a>${manifest.verification ? '<a href="verification/web-and-code-checks.json">Website verification</a>' : ''}<p>Source ${escape(sourceCommit.slice(0, 12))}${trackedChanges ? ' + local changes' : ''} · Generated ${escape(manifest.generatedAt)}<br>Keep signing credentials separate from these artifacts.</p></footer></html>\n`);
console.log(`Catalog and checksums saved to ${directory}`);
