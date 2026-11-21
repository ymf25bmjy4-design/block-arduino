/* Smart Upload: pick the port and board settings automatically; when an
 * upload fails, read the error, change one setting and retry (max 4 tries).
 * The setting that worked is remembered per board serial number. */
const BOARDS = require('../shared/boards.js');

const MAX_ATTEMPTS = 4;

/* Classify an upload error into a kind the retry loop knows how to fix. */
function classifyError(output, board) {
  const o = String(output);
  const sig = /Device signature = (0x[0-9a-fA-F]{6})/.exec(o);
  if (sig) {
    const found = sig[1].toLowerCase();
    if (found === '0x000000' || found === '0xffffff') {
      return { kind: 'no_bootloader', message: "The chip isn't answering properly — its bootloader may be missing." };
    }
    const match = BOARDS.SIGNATURES[found];
    if (match && match !== board.id) {
      return { kind: 'wrong_board', board: match, message: `This looks like a ${BOARDS.byId(match).name} — switching.` };
    }
  }
  if (/not in sync|programmer is not responding|resp=0x[0-9a-f]{2}|attempt \d+ of \d+: not in sync/i.test(o)) {
    return { kind: 'no_sync', message: board.alternatives.length
      ? 'The board isn\'t answering — trying the other Nano bootloader…'
      : "The board isn't answering." };
  }
  if (/Access is denied|Resource busy|Permission denied|could not open port|Port monitor error|port is busy/i.test(o)) {
    return { kind: 'port_busy', message: 'The port is busy — closing the serial monitor to free it.',
      linux: /Permission denied/i.test(o) && process.platform === 'linux' };
  }
  if (/No device found on|cannot find|can't open device|port not found|no such file or directory.*tty/i.test(o) && board.portHops) {
    return { kind: 'port_hop', message: 'Board restarted on a new port — following it.' };
  }
  if (/Failed to connect to ESP32|Wrong boot mode|Timed out waiting for packet header|serial port.*not.*download mode/i.test(o)) {
    return { kind: 'esp_boot', message: 'The ESP32 did not enter download mode.' };
  }
  if (/Sketch too big|text section exceeds|overflowed/i.test(o)) {
    return { kind: 'too_big', message: 'The program is too big for this board.' };
  }
  if (/No such file|disconnected|device reports readiness to read but returned no data|ser_recv/i.test(o)) {
    return { kind: 'disconnected', message: 'The board disconnected — check the USB cable.' };
  }
  return { kind: 'unknown', message: 'Upload failed.' };
}

/* Rank candidate boards for a port: exact USB match, then the project's
 * board, then the last profile that worked on this serial number, then
 * common boards for the clone USB chip. */
function rankBoards(port, projectBoardId, profiles) {
  const out = [];
  const add = (id) => { if (id && !out.includes(id)) out.push(id); };
  const exact = port.vidpid && BOARDS.byUsb(port.vidpid);
  if (exact) add(exact.id);
  add(projectBoardId);
  if (port.serial && profiles[port.serial]) add(profiles[port.serial]);
  const chip = port.vidpid && BOARDS.CLONE_CHIPS[port.vidpid];
  if (chip) for (const id of chip.likely) add(id);
  return out;
}

/* Pick a port: one board -> use it; several -> the newest one (last in list
 * that was not present before), else the first USB serial device. */
function pickPort(ports, knownBefore = []) {
  const usb = ports.filter((p) => p.vidpid);
  if (!usb.length) return ports[0] || null;
  if (usb.length === 1) return usb[0];
  const fresh = usb.filter((p) => !knownBefore.includes(p.address));
  return fresh[fresh.length - 1] || usb[usb.length - 1];
}

/**
 * Run the full Smart Upload flow.
 * deps: { cli, getCode(board) -> {code}, emit(step, text), profiles, saveProfiles, stopMonitor, checkHandshake, askUser }
 */
async function smartUpload(deps, { boardId, preferredPort, knownPorts }) {
  const { cli, emit } = deps;
  let board = BOARDS.byId(boardId);
  const log = (t) => emit('log', t);

  /* Step 1: find the board */
  emit('step', 'finding');
  let ports = await cli.listPorts();
  if (!ports.length) {
    emit('step', 'error');
    return { ok: false, kind: 'no_port',
      message: 'No board found. Check the USB cable carries data (some are charge-only). Clone boards with a CH340 or CP210x chip may need a driver.' };
  }
  let port = (preferredPort && ports.find((p) => p.address === preferredPort)) || pickPort(ports, knownPorts);
  const candidates = rankBoards(port, board.id, deps.profiles);
  if (port.vidpid && BOARDS.byUsb(port.vidpid) && BOARDS.byUsb(port.vidpid).id !== board.id) {
    board = BOARDS.byUsb(port.vidpid);
    emit('notice', `Found an ${board.name} on ${port.label} — using it.`);
  }
  emit('port', { port: port.address, label: port.label, board: board.id });
  log(`Port ${port.address} (${port.vidpid || 'unknown USB id'}), candidates: ${candidates.join(', ')}`);

  /* Board support installed? */
  const core = await cli.ensureCore(board.core, log);
  if (!core.ok) return { ok: false, kind: 'core', message: `Couldn't install ${board.name} support. Is the internet on?`, detail: core.error };

  let fqbn = board.fqbn;
  const triedFqbn = new Set();
  let altIdx = 0;
  let compiled = null;
  const fullLog = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    /* (Re)compile for the current board */
    if (!compiled || compiled.fqbn !== fqbn) {
      emit('step', 'building');
      const { code, libraries } = deps.getCode(board);
      const libs = await cli.ensureLibraries(libraries, log);
      if (!libs.ok) return { ok: false, kind: 'libs', message: "Couldn't install a library this project needs.", detail: libs.error };
      const c = await cli.compile({ code, fqbn, onLine: log });
      fullLog.push(c.output);
      if (!c.ok) return { ok: false, kind: c.tooBig ? 'too_big' : 'compile', compile: c,
        message: c.tooBig ? 'The program is too big for this board.' : 'The code did not build.' };
      compiled = { ...c, fqbn };
      emit('sizes', c.sizes);
    }

    emit('step', 'uploading');
    if (deps.stopMonitor) await deps.stopMonitor();
    triedFqbn.add(fqbn);
    const r = await cli.upload({ port: port.address, fqbn, buildPath: compiled.buildPath, onLine: log });
    const out = r.stdout + '\n' + r.stderr;
    fullLog.push(out);

    if (r.code === 0) {
      if (port.serial) { deps.profiles[port.serial] = board.id; deps.saveProfiles(deps.profiles); }
      emit('step', 'checking');
      let ready = true;
      if (deps.checkHandshake) ready = await deps.checkHandshake(port.address);
      emit('step', 'done');
      return { ok: true, port: port.address, board: board.id, fqbn, attempts: attempt, sizes: compiled.sizes,
        warning: ready ? null : "The board didn't say it started. It may be resetting in a loop — often a power problem from servos or a long NeoPixel strip. Try an external power supply." };
    }

    /* Read the error, change one setting, retry */
    const err = classifyError(out, board);
    emit('notice', err.message);
    log(`Attempt ${attempt} failed: ${err.kind}`);

    switch (err.kind) {
      case 'no_sync': {
        const next = board.alternatives.find((a) => !triedFqbn.has(a));
        if (next) { fqbn = next; break; }
        const nextBoard = candidates.find((id, i) => i > altIdx && BOARDS.byId(id).family === board.family && id !== board.id);
        if (nextBoard) { altIdx = candidates.indexOf(nextBoard); board = BOARDS.byId(nextBoard); fqbn = board.fqbn; emit('notice', `Trying ${board.name}…`); break; }
        attempt = MAX_ATTEMPTS;
        break;
      }
      case 'wrong_board':
        board = BOARDS.byId(err.board); fqbn = board.fqbn; emit('port', { port: port.address, board: board.id });
        break;
      case 'port_busy':
        if (err.linux) emit('notice', 'On Linux, add yourself to the "dialout" group: sudo usermod -a -G dialout $USER, then log out and in.');
        await sleep(800);
        break;
      case 'port_hop': {
        const before = ports.map((p) => p.address);
        const deadline = Date.now() + 8000;
        let found = null;
        while (Date.now() < deadline && !found) {
          await sleep(500);
          const now = await cli.listPorts();
          found = now.find((p) => !before.includes(p.address)) || now.find((p) => p.vidpid && BOARDS.byUsb(p.vidpid));
        }
        if (found) { port = found; emit('port', { port: port.address, label: port.label, board: board.id }); }
        break;
      }
      case 'esp_boot':
        if (fqbn === board.fqbn && board.alternatives[0]) { fqbn = board.alternatives[0]; }
        else emit('notice', 'Hold the BOOT button on the board while it uploads…');
        await sleep(1500);
        break;
      case 'disconnected': {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          await sleep(500);
          ports = await cli.listPorts();
          const back = ports.find((p) => p.address === port.address) || pickPort(ports);
          if (back) { port = back; break; }
        }
        break;
      }
      case 'too_big':
      case 'no_bootloader':
        emit('step', 'error');
        return { ok: false, kind: err.kind, message: err.message, log: fullLog.join('\n') };
      default:
        if (attempt >= 2) attempt = MAX_ATTEMPTS;
    }
  }

  emit('step', 'error');
  return { ok: false, kind: 'gave_up', log: fullLog.join('\n'),
    message: 'Upload failed after several tries. Check: the cable carries data, the board has power, and the right board family is chosen.' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { smartUpload, classifyError, rankBoards, pickPort, MAX_ATTEMPTS };
