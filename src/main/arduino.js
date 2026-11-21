/* Build service + board manager: wraps the bundled arduino-cli.
 * Everything arduino-cli downloads (cores, libraries) lives in the app's own
 * data folder so it never touches a user's Arduino IDE setup. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const BOARDS = require('../shared/boards.js');

const PLATFORM_DIR = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
const EXE = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';

class ArduinoCli {
  constructor({ userData, resourcesPath, appPath, isPackaged }) {
    this.userData = userData;
    this.dataDir = path.join(userData, 'arduino');
    this.configFile = path.join(this.dataDir, 'arduino-cli.yaml');
    this.libraryDir = isPackaged
      ? path.join(resourcesPath, 'libraries')
      : path.join(appPath, 'resources', 'libraries');
    this.bin = this.findBinary({ resourcesPath, appPath, isPackaged });
    this.log = () => {};
  }

  findBinary({ resourcesPath, appPath, isPackaged }) {
    const candidates = [];
    if (isPackaged) candidates.push(path.join(resourcesPath, 'bin', EXE));
    candidates.push(path.join(appPath, 'vendor', 'arduino-cli', `${PLATFORM_DIR}-${process.arch}`, EXE));
    if (PLATFORM_DIR === 'mac') candidates.push(path.join(appPath, 'vendor', 'arduino-cli', 'mac-x64', EXE));
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return EXE; // fall back to PATH
  }

  ensureConfig() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const esp = BOARDS.byId('esp32').coreUrl;
    const yaml = [
      'board_manager:',
      '  additional_urls:',
      `    - ${esp}`,
      'directories:',
      `  data: ${JSON.stringify(path.join(this.dataDir, 'data'))}`,
      `  downloads: ${JSON.stringify(path.join(this.dataDir, 'staging'))}`,
      `  user: ${JSON.stringify(path.join(this.dataDir, 'user'))}`,
      'library:',
      '  enable_unsafe_install: false',
      'metrics:',
      '  enabled: false',
      'updater:',
      '  enable_notification: false',
      '',
    ].join('\n');
    if (!fs.existsSync(this.configFile) || fs.readFileSync(this.configFile, 'utf8') !== yaml) {
      fs.writeFileSync(this.configFile, yaml);
    }
  }

  /* Run arduino-cli; resolves { code, stdout, stderr }. onLine streams output. */
  run(args, { onLine, timeoutMs = 0 } = {}) {
    this.ensureConfig();
    const full = ['--config-file', this.configFile, ...args];
    this.log('$ arduino-cli ' + args.join(' '));
    return new Promise((resolve) => {
      let stdout = '', stderr = '';
      let child;
      try {
        child = spawn(this.bin, full, { windowsHide: true });
      } catch (e) {
        resolve({ code: -1, stdout: '', stderr: String(e) });
        return;
      }
      const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : null;
      const pipe = (stream, isErr) => {
        let buf = '';
        stream.on('data', (d) => {
          const s = d.toString();
          if (isErr) stderr += s; else stdout += s;
          buf += s;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop();
          for (const l of lines) if (onLine) onLine(l, isErr);
        });
      };
      pipe(child.stdout, false);
      pipe(child.stderr, true);
      child.on('error', (e) => { stderr += String(e); });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  async available() {
    const r = await this.run(['version', '--format', 'json']);
    if (r.code !== 0) return { ok: false, error: r.stderr || 'arduino-cli not found' };
    try { return { ok: true, version: JSON.parse(r.stdout).VersionString }; } catch { return { ok: true, version: r.stdout.trim() }; }
  }

  async installedCores() {
    const r = await this.run(['core', 'list', '--format', 'json']);
    try {
      const j = JSON.parse(r.stdout);
      const list = Array.isArray(j) ? j : j.platforms || [];
      return list.map((p) => p.id);
    } catch { return []; }
  }

  async ensureCore(core, onLine) {
    if ((await this.installedCores()).includes(core)) return { ok: true, already: true };
    onLine && onLine(`Installing ${core} board support (one time)…`);
    const idx = await this.run(['core', 'update-index'], { onLine });
    if (idx.code !== 0) return { ok: false, error: idx.stderr };
    const r = await this.run(['core', 'install', core], { onLine });
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr };
  }

  async installedLibraries() {
    const r = await this.run(['lib', 'list', '--format', 'json']);
    try {
      const j = JSON.parse(r.stdout);
      const list = Array.isArray(j) ? j : j.installed_libraries || [];
      return list.map((l) => (l.library && l.library.name) || l.name);
    } catch { return []; }
  }

  async ensureLibraries(libs, onLine) {
    if (!libs || !libs.length) return { ok: true };
    const have = await this.installedLibraries();
    const missing = libs.filter((l) => !have.includes(l.split('@')[0]));
    if (!missing.length) return { ok: true };
    onLine && onLine(`Installing libraries: ${missing.join(', ')}`);
    await this.run(['lib', 'update-index'], { onLine });
    const r = await this.run(['lib', 'install', ...missing], { onLine });
    return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr };
  }

  /* Board list with VID/PID, used for automatic detection. */
  async listPorts() {
    const r = await this.run(['board', 'list', '--format', 'json'], { timeoutMs: 15000 });
    let items = [];
    try {
      const j = JSON.parse(r.stdout || '[]');
      items = Array.isArray(j) ? j : j.detected_ports || [];
    } catch { return []; }
    return items.map((d) => {
      const port = d.port || d;
      const props = port.properties || {};
      const vid = (props.vid || '').replace(/^0x/i, '').toLowerCase().padStart(4, '0');
      const pid = (props.pid || '').replace(/^0x/i, '').toLowerCase().padStart(4, '0');
      const matching = (d.matching_boards || []).map((m) => m.fqbn);
      return {
        address: port.address, label: port.label || port.address, protocol: port.protocol,
        vidpid: props.vid ? `${vid}:${pid}` : null, serial: props.serialNumber || null, matching,
      };
    }).filter((p) => p.protocol === 'serial' || !p.protocol);
  }

  /* Write sketch and compile. Returns { ok, buildPath, output, errors, sizes }. */
  async compile({ code, fqbn, sketchName = 'sketch', onLine }) {
    const base = path.join(os.tmpdir(), 'block-arduino');
    const sketchDir = path.join(base, sketchName);
    const buildPath = path.join(base, 'build', fqbn.replace(/[^A-Za-z0-9]/g, '_'));
    fs.mkdirSync(sketchDir, { recursive: true });
    fs.mkdirSync(buildPath, { recursive: true });
    fs.writeFileSync(path.join(sketchDir, sketchName + '.ino'), code);
    const r = await this.run(['compile', '--fqbn', fqbn, '--libraries', this.libraryDir,
      '--build-path', buildPath, '--warnings', 'none', sketchDir], { onLine });
    const output = r.stdout + '\n' + r.stderr;
    const errors = [];
    const re = new RegExp(sketchName + '\\.ino:(\\d+):(\\d+):\\s*(?:fatal )?error:\\s*(.*)', 'g');
    let m;
    while ((m = re.exec(output))) errors.push({ line: Number(m[1]), col: Number(m[2]), message: m[3].trim() });
    const flash = /uses (\d+) bytes \((\d+)%\) of program storage/.exec(output);
    const ram = /Global variables use (\d+) bytes \((\d+)%\)/.exec(output);
    return {
      ok: r.code === 0, buildPath, sketchDir, output, errors,
      tooBig: /Sketch too big|text section exceeds|region `text' overflowed/i.test(output),
      sizes: { flash: flash ? Number(flash[1]) : null, flashPct: flash ? Number(flash[2]) : null,
               ram: ram ? Number(ram[1]) : null, ramPct: ram ? Number(ram[2]) : null },
    };
  }

  upload({ port, fqbn, buildPath, onLine }) {
    return this.run(['upload', '-p', port, '--fqbn', fqbn, '--input-dir', buildPath], { onLine, timeoutMs: 180000 });
  }

  /* Serial monitor process via arduino-cli (no native modules needed). */
  monitor({ port, baud = 115200, onData, onExit }) {
    this.ensureConfig();
    const child = spawn(this.bin, ['--config-file', this.configFile, 'monitor', '-p', port,
      '--config', `baudrate=${baud}`, '--quiet', '--raw'], { windowsHide: true });
    child.stdout.on('data', (d) => onData(d.toString()));
    child.stderr.on('data', (d) => onData(d.toString()));
    child.on('close', (code) => onExit && onExit(code));
    child.on('error', (e) => { onData(String(e)); });
    return child;
  }

  burnBootloader({ port, fqbn, onLine }) {
    return this.run(['burn-bootloader', '-b', fqbn, '-p', port, '-P', 'arduinoasisp'], { onLine, timeoutMs: 120000 });
  }
}

module.exports = { ArduinoCli };
