/* Block Arduino — Electron main process.
 * The renderer never touches USB or the compiler directly; it asks here over IPC. */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { ArduinoCli } = require('./arduino');
const { smartUpload } = require('./smart-upload');
const BOARDS = require('../shared/boards.js');

let win;
let cli;
let monitor = null;            // running arduino-cli monitor process
let monitorPort = null;
let uploading = false;
let lastPorts = [];
let dirty = false;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return { profiles: {}, recent: [] }; }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}
let settings;

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    title: 'Block Arduino',
    backgroundColor: '#f4f6fb',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Keep editing', 'Quit without saving'], defaultId: 0, cancelId: 0,
      message: 'You have unsaved changes.', detail: 'Use File → Save to keep your project.',
    });
    if (choice === 0) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  buildMenu();
  if (process.env.BA_SMOKE_TEST) smokeTest(process.env.BA_SMOKE_TEST);
}

/* CI smoke test: BA_SMOKE_TEST=out.png captures the window, prints renderer
 * errors and exits non-zero if any happened. */
function smokeTest(out) {
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
    console.log('[renderer]', message);
  });
  win.webContents.on('did-finish-load', () => setTimeout(async () => {
    const steps = (process.env.BA_SMOKE_JS || '').split(';;').filter(Boolean);
    for (const js of steps) {
      try { console.log('[smoke]', await win.webContents.executeJavaScript(js)); } catch (e) { errors.push(String(e)); }
      await new Promise((r) => setTimeout(r, 900));
    }
    const img = await win.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    console.log(errors.length ? 'SMOKE FAIL\n' + errors.join('\n') : 'SMOKE OK');
    app.exit(errors.length ? 1 : 0);
  }, 3500));
}

function buildMenu() {
  const cmd = (c) => () => send('menu', c);
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: cmd('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
      { label: 'Starter Projects', click: cmd('starters') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('saveAs') },
      { type: 'separator' },
      { label: 'Open in Arduino IDE', click: cmd('openIde') },
      { label: 'Export .ino…', click: cmd('exportIno') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Board', submenu: [
      { label: 'Verify (build only)', accelerator: 'CmdOrCtrl+R', click: cmd('verify') },
      { label: 'Upload', accelerator: 'CmdOrCtrl+U', click: cmd('upload') },
      { type: 'separator' },
      { label: 'Install Board Support…', click: cmd('installCore') },
      { label: 'Repair Bootloader…', click: cmd('bootloader') },
    ] },
    { label: 'Blocks', submenu: [
      { label: 'Block Maker…', click: cmd('blockMaker') },
      { label: 'Import Custom Blocks…', click: cmd('importBlocks') },
      { label: 'Export Custom Blocks…', click: cmd('exportBlocks') },
    ] },
    { label: 'View', submenu: [
      { label: 'High Contrast', type: 'checkbox', click: cmd('contrast') },
      { label: 'Bigger Blocks', accelerator: 'CmdOrCtrl+=', click: cmd('zoomIn') },
      { label: 'Smaller Blocks', accelerator: 'CmdOrCtrl+-', click: cmd('zoomOut') },
      { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
    ] },
    { label: 'Help', submenu: [
      { label: 'About Block Arduino', click: cmd('about') },
      { label: 'Website and Downloads', click: () => shell.openExternal(app.homepageUrl || 'https://github.com') },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- port watching ---------------- */
async function pollPorts() {
  if (!uploading && win && !win.isDestroyed()) {
    const ports = await cli.listPorts();
    const sig = JSON.stringify(ports.map((p) => p.address + p.vidpid));
    if (sig !== JSON.stringify(lastPorts.map((p) => p.address + p.vidpid))) {
      lastPorts = ports;
      send('ports', ports.map((p) => ({ ...p, guess: p.vidpid && BOARDS.byUsb(p.vidpid) ? BOARDS.byUsb(p.vidpid).id : null,
        chip: p.vidpid && BOARDS.CLONE_CHIPS[p.vidpid] ? BOARDS.CLONE_CHIPS[p.vidpid].chip : null })));
    }
  }
  setTimeout(pollPorts, 2500);
}

/* ---------------- serial monitor ---------------- */
function stopMonitor() {
  return new Promise((resolve) => {
    if (!monitor) return resolve();
    const m = monitor;
    monitor = null; monitorPort = null;
    m.once('close', () => setTimeout(resolve, 300));
    m.kill();
    setTimeout(resolve, 1500);
    send('serial:state', { open: false });
  });
}

function startMonitor(port, baud = 115200) {
  monitorPort = port;
  monitor = cli.monitor({
    port, baud,
    onData: (d) => send('serial:data', d),
    onExit: () => { if (monitorPort === port) { monitor = null; monitorPort = null; send('serial:state', { open: false }); } },
  });
  send('serial:state', { open: true, port, baud });
  return monitor;
}

/* After upload, wait for the BA:READY line from the runtime (3 s, longer
 * for boards that re-enumerate). The monitor stays open for the Serial tab. */
async function checkHandshake(port, boardId, enabled) {
  if (!enabled) return true;
  const board = BOARDS.byId(boardId);
  await new Promise((r) => setTimeout(r, board.portHops ? 2000 : 300));
  let target = port;
  if (board.portHops) {
    const ports = await cli.listPorts();
    const p = ports.find((x) => x.vidpid && BOARDS.byUsb(x.vidpid)) || ports[0];
    if (p) target = p.address;
  }
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const m = startMonitor(target);
    m.stdout.on('data', (d) => {
      buf += d.toString();
      if (!done && buf.includes('BA:READY')) { done = true; resolve(true); }
    });
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 3000 + (board.family === 'esp32' ? 2000 : 0));
  });
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  ipcMain.on('app:dirty', (_e, d) => { dirty = d; });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), platform: process.platform, arch: process.arch,
    boards: BOARDS.BOARDS.map((b) => ({ id: b.id, name: b.name, family: b.family })),
  }));

  ipcMain.handle('tools:status', async () => {
    const a = await cli.available();
    const cores = a.ok ? await cli.installedCores() : [];
    return { ...a, cores, bin: cli.bin };
  });

  ipcMain.handle('tools:installCore', async (_e, core) => {
    const r = await cli.ensureCore(core, (l) => send('build:log', l));
    return r;
  });

  ipcMain.handle('ports:list', async () => { lastPorts = await cli.listPorts(); return lastPorts; });

  ipcMain.handle('build:verify', async (_e, { boardId, code, libraries }) => {
    const board = BOARDS.byId(boardId);
    const log = (l) => send('build:log', l);
    send('build:step', 'building');
    const core = await cli.ensureCore(board.core, log);
    if (!core.ok) return { ok: false, kind: 'core', message: `Couldn't install ${board.name} support. Is the internet on?`, detail: core.error };
    const libs = await cli.ensureLibraries(libraries, log);
    if (!libs.ok) return { ok: false, kind: 'libs', message: "Couldn't install a library this project needs.", detail: libs.error };
    const c = await cli.compile({ code, fqbn: board.fqbn, onLine: log });
    send('build:step', c.ok ? 'done' : 'error');
    return { ok: c.ok, compile: c, sizes: c.sizes, kind: c.ok ? null : (c.tooBig ? 'too_big' : 'compile') };
  });

  ipcMain.handle('build:upload', async (_e, { boardId, port, codeByFamily, handshake }) => {
    if (uploading) return { ok: false, message: 'An upload is already running.' };
    uploading = true;
    try {
      const r = await smartUpload({
        cli,
        emit: (kind, data) => send('build:' + kind, data),
        getCode: (board) => codeByFamily[board.family] || codeByFamily.avr,
        profiles: settings.profiles,
        saveProfiles: (p) => { settings.profiles = p; saveSettings(settings); },
        stopMonitor,
        checkHandshake: (p) => checkHandshake(p, boardId, handshake !== false),
      }, { boardId, preferredPort: port, knownPorts: lastPorts.map((p) => p.address) });
      return r;
    } finally {
      uploading = false;
    }
  });

  ipcMain.handle('serial:open', async (_e, { port, baud }) => { await stopMonitor(); startMonitor(port, baud); return true; });
  ipcMain.handle('serial:close', async () => { await stopMonitor(); return true; });
  ipcMain.handle('serial:send', (_e, text) => {
    if (monitor && monitor.stdin.writable) { monitor.stdin.write(text + '\n'); return true; }
    return false;
  });

  ipcMain.handle('project:save', async (_e, { data, filePath, saveAs, name }) => {
    let target = filePath;
    if (!target || saveAs) {
      const r = await dialog.showSaveDialog(win, {
        title: 'Save project', defaultPath: (name || 'my-project') + '.bard',
        filters: [{ name: 'Block Arduino project', extensions: ['bard'] }],
      });
      if (r.canceled) return { ok: false };
      target = r.filePath;
    }
    fs.writeFileSync(target, zlib.gzipSync(Buffer.from(JSON.stringify(data))));
    return { ok: true, filePath: target };
  });

  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Open project', properties: ['openFile'],
      filters: [{ name: 'Block Arduino project', extensions: ['bard', 'json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const buf = fs.readFileSync(r.filePaths[0]);
    let text;
    try { text = zlib.gunzipSync(buf).toString(); } catch { text = buf.toString(); }
    return { ok: true, filePath: r.filePaths[0], data: JSON.parse(text) };
  });

  ipcMain.handle('file:exportIno', async (_e, { code, name }) => {
    const r = await dialog.showSaveDialog(win, { title: 'Export sketch', defaultPath: (name || 'sketch') + '.ino',
      filters: [{ name: 'Arduino sketch', extensions: ['ino'] }] });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, code);
    copyRuntime(path.dirname(r.filePath));
    return { ok: true, filePath: r.filePath };
  });

  ipcMain.handle('file:openIde', async (_e, { code, name }) => {
    const safe = (name || 'sketch').replace(/[^A-Za-z0-9_]/g, '_');
    const dir = path.join(app.getPath('documents'), 'Block Arduino', safe);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, safe + '.ino');
    fs.writeFileSync(f, code);
    copyRuntime(dir);
    const err = await shell.openPath(f);
    return { ok: !err, filePath: f, error: err };
  });

  ipcMain.handle('blocks:export', async (_e, { defs }) => {
    const r = await dialog.showSaveDialog(win, { title: 'Export custom blocks', defaultPath: 'my-blocks.bablock',
      filters: [{ name: 'Block Arduino blocks', extensions: ['bablock'] }] });
    if (r.canceled) return { ok: false };
    fs.writeFileSync(r.filePath, JSON.stringify(defs, null, 2));
    return { ok: true };
  });

  ipcMain.handle('blocks:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import custom blocks', properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Block Arduino blocks', extensions: ['bablock', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const p = r.filePaths[0];
    const defs = [];
    if (fs.statSync(p).isDirectory()) {   // extension pack folder: extension.json + blocks/*.json
      const dir = path.join(p, 'blocks');
      let ext = {};
      try { ext = JSON.parse(fs.readFileSync(path.join(p, 'extension.json'), 'utf8')); } catch { /* optional */ }
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        d.libraries = [...(d.libraries || []), ...(ext.libraries || [])];
        defs.push(d);
      }
    } else {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      defs.push(...(Array.isArray(j) ? j : [j]));
    }
    return { ok: true, defs };
  });

  ipcMain.handle('bootloader:burn', async (_e, { port, boardId }) => {
    await stopMonitor();
    const board = BOARDS.byId(boardId);
    const r = await cli.burnBootloader({ port, fqbn: board.fqbn, onLine: (l) => send('build:log', l) });
    return { ok: r.code === 0, output: r.stdout + r.stderr };
  });

  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
}

/* Exported sketches need BlockArduino.h next to them for the Arduino IDE. */
function copyRuntime(dir) {
  const src = path.join(cli.libraryDir, 'BlockArduino', 'src', 'BlockArduino.h');
  try { fs.copyFileSync(src, path.join(dir, 'BlockArduino.h')); } catch { /* ignore */ }
}

app.whenReady().then(() => {
  settings = loadSettings();
  cli = new ArduinoCli({
    userData: app.getPath('userData'),
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
  });
  cli.log = (l) => send('build:log', l);
  registerIpc();
  createWindow();
  setTimeout(pollPorts, 1500);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => {
  await stopMonitor();
  if (process.platform !== 'darwin') app.quit();
});
