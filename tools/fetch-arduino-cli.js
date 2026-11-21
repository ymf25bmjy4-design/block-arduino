#!/usr/bin/env node
/* Downloads arduino-cli into vendor/arduino-cli/<os>-<arch>/ for packaging.
 * Usage: node tools/fetch-arduino-cli.js [linux-x64 win-x64 mac-x64 mac-arm64]
 * With no arguments it fetches what the current OS needs (both archs on macOS). */
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const VERSION = process.env.ARDUINO_CLI_VERSION || '1.1.1';
const ASSETS = {
  'linux-x64': `arduino-cli_${VERSION}_Linux_64bit.tar.gz`,
  'linux-arm64': `arduino-cli_${VERSION}_Linux_ARM64.tar.gz`,
  'win-x64': `arduino-cli_${VERSION}_Windows_64bit.zip`,
  'mac-x64': `arduino-cli_${VERSION}_macOS_64bit.tar.gz`,
  'mac-arm64': `arduino-cli_${VERSION}_macOS_ARM64.tar.gz`,
};

function defaults() {
  if (process.platform === 'darwin') return ['mac-x64', 'mac-arm64'];
  if (process.platform === 'win32') return ['win-x64'];
  return ['linux-x64'];
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'block-arduino-build' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 8) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> ${res.statusCode}`));
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : defaults();
  for (const t of targets) {
    const asset = ASSETS[t];
    if (!asset) throw new Error('Unknown target ' + t);
    const dir = path.join(__dirname, '..', 'vendor', 'arduino-cli', t);
    const exe = path.join(dir, t.startsWith('win') ? 'arduino-cli.exe' : 'arduino-cli');
    if (fs.existsSync(exe)) { console.log(`${t}: already present`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acli-')), asset);
    const url = `https://github.com/arduino/arduino-cli/releases/download/v${VERSION}/${asset}`;
    console.log(`${t}: downloading ${url}`);
    await download(url, tmp);
    // tar handles .tar.gz everywhere and .zip on Windows 10+ (bsdtar)
    if (asset.endsWith('.zip') && process.platform !== 'win32') execFileSync('unzip', ['-o', '-q', tmp, '-d', dir]);
    else execFileSync('tar', ['-xf', tmp, '-C', dir]);
    for (const f of fs.readdirSync(dir)) if (!/^arduino-cli(\.exe)?$/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    if (!t.startsWith('win')) fs.chmodSync(exe, 0o755);
    console.log(`${t}: ok`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
