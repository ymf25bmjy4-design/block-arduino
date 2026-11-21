/* Block Arduino — renderer (UI). Talks to the main process via window.ba. */
(function () {
  const $ = (id) => document.getElementById(id);
  const api = window.ba || null;               // null when opened in a plain browser
  const BOARDS = window.BA_BOARDS;
  const BLOCKS = window.BA_BLOCKS;
  const GEN = window.BA_GENERATOR;
  const CUSTOM = window.BA_CUSTOM;

  const state = {
    boardId: 'uno', filePath: null, dirty: false, customBlocks: [], ports: [], port: null,
    last: null, serialOpen: false, busy: false, handshake: true, plot: [], series: 0,
  };

  /* ---------------- Blockly workspace ---------------- */
  const theme = Blockly.Theme.defineTheme('block-arduino', {
    base: Blockly.Themes.Classic,
    fontStyle: { family: '"Nunito", "Segoe UI", "Helvetica Neue", Arial, sans-serif', weight: '700', size: 12 },
    componentStyles: {
      workspaceBackgroundColour: '#f9fafd', toolboxBackgroundColour: '#ffffff', toolboxForegroundColour: '#3a3f5c',
      flyoutBackgroundColour: '#eef1f8', flyoutOpacity: 0.96, scrollbarColour: '#c5cad8', insertionMarkerColour: '#000',
    },
    startHats: true,
  });

  const ws = Blockly.inject('blocklyDiv', {
    toolbox: BLOCKS.toolbox([]),
    renderer: 'zelos',
    theme,
    media: '../../node_modules/blockly/media/',
    zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 2, minScale: 0.35, scaleSpeed: 1.15 },
    trashcan: true,
    move: { scrollbars: true, drag: true, wheel: true },
    grid: { spacing: 40, length: 2, colour: '#e1e5ef', snap: false },
    sounds: true,
  });

  ws.registerToolboxCategoryCallback('BA_VARIABLES', (w) => BLOCKS.variablesFlyout(w));
  ws.registerButtonCallback('BA_CREATE_VAR', (btn) => Blockly.Variables.createVariableButtonHandler(btn.getTargetWorkspace(), null, ''));
  ws.addChangeListener(Blockly.Events.disableOrphans);

  /* ---------------- board picker ---------------- */
  const boardSelect = $('boardSelect');
  for (const b of BOARDS.BOARDS) {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = b.name;
    boardSelect.appendChild(o);
  }
  boardSelect.addEventListener('change', () => setBoard(boardSelect.value, true));
  function setBoard(id, userChange) {
    state.boardId = id;
    boardSelect.value = id;
    BLOCKS.setBoard(id);
    if (userChange) { markDirty(); checkCore(); }
    regenerate();
  }

  /* ---------------- code generation ---------------- */
  let genTimer = null;
  ws.addChangeListener((e) => {
    if (e.isUiEvent) {
      if (e.type === Blockly.Events.SELECTED) highlightLinesForBlock(e.newElementId);
      return;
    }
    if (e.type === Blockly.Events.BLOCK_CREATE && !loading) autoInsertSetup(e);
    if (!loading) markDirty();
    clearTimeout(genTimer);
    genTimer = setTimeout(regenerate, 120);
  });

  function generateFor(boardId) {
    const board = BOARDS.byId(boardId);
    return GEN.workspaceToSketch(ws, { board, customBlocks: state.customBlocks, handshake: state.handshake });
  }

  function regenerate() {
    let out;
    try { out = generateFor(state.boardId); }
    catch (err) { console.error(err); $('code').textContent = '// Could not generate code: ' + err.message; return; }
    state.last = out;
    renderCode(out.code);
    const pinWarnings = checkPins();
    renderWarnings([...out.warnings, ...pinWarnings]);
  }

  /* ---------------- code panel ---------------- */
  const KW = /\b(void|int|long|float|double|bool|char|const|uint8_t|uint16_t|uint32_t|String|if|else|for|while|return|true|false|switch|case|break|static)\b/;
  function highlight(line) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const re = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(#include\s*<[^>]*>|#\w+)|\b(BA_[A-Z_]+|ba_\w+)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\s*\()|\b([A-Za-z_]\w*)\b/g;
    let out = '', last = 0, m;
    while ((m = re.exec(line))) {
      out += esc(line.slice(last, m.index));
      const t = esc(m[0]);
      if (m[1]) out += `<span class="tk-c">${t}</span>`;
      else if (m[2]) out += `<span class="tk-s">${t}</span>`;
      else if (m[3]) out += `<span class="tk-k">${t}</span>`;
      else if (m[4]) out += `<span class="tk-m">${t}</span>`;
      else if (m[5]) out += `<span class="tk-n">${t}</span>`;
      else if (m[6]) out += KW.test(m[6]) ? `<span class="tk-k">${t}</span>` : `<span class="tk-f">${t}</span>`;
      else out += KW.test(m[7]) ? `<span class="tk-k">${t}</span>` : t;
      last = re.lastIndex;
    }
    return out + esc(line.slice(last));
  }

  function renderCode(code) {
    const pre = $('code');
    const scroll = pre.scrollTop;
    pre.innerHTML = code.split('\n').map((l, i) =>
      `<span class="ln" data-line="${i + 1}"><span class="no">${i + 1}</span>${highlight(l) || ' '}</span>`).join('');
    pre.scrollTop = scroll;
  }

  $('code').addEventListener('click', (e) => {
    const ln = e.target.closest('.ln');
    if (!ln || !state.last) return;
    const id = state.last.sourceMap[ln.dataset.line];
    if (id && ws.getBlockById(id)) {
      const b = ws.getBlockById(id);
      b.select();
      ws.centerOnBlock(id);
    }
  });

  function highlightLinesForBlock(id) {
    document.querySelectorAll('#code .ln.hl').forEach((n) => n.classList.remove('hl'));
    if (!id || !state.last) return;
    let first = null;
    for (const [line, bid] of Object.entries(state.last.sourceMap)) {
      if (bid === id) {
        const n = document.querySelector(`#code .ln[data-line="${line}"]`);
        if (n) { n.classList.add('hl'); first = first || n; }
      }
    }
    if (first) first.scrollIntoView({ block: 'nearest' });
  }

  function renderWarnings(list) {
    const box = $('warnings');
    if (!list.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '';
    for (const w of list) {
      const d = document.createElement('div');
      d.textContent = w.msg;
      if (w.id) d.addEventListener('click', () => { const b = ws.getBlockById(w.id); if (b) { b.select(); ws.centerOnBlock(w.id); } });
      box.appendChild(d);
    }
  }

  /* ---------------- smart pin checks ---------------- */
  const PART = {
    ba_servo_write: 'servo', ba_servo_sweep: 'servo', ba_servo_read: 'servo', ba_servo_detach: 'servo',
    ba_button_setup: 'button', ba_button_pressed: 'button', ba_button_count: 'button', ba_button_reset: 'button', ba_when_button: 'button',
    ba_digital_write: 'output', ba_toggle_pin: 'output', ba_pwm_write: 'output', ba_pwm_percent: 'output',
    ba_neo_setup: 'NeoPixels', ba_stepper_setup_4wire: 'stepper', ba_stepper_setup_driver: 'stepper',
  };
  function pinUsage() {
    const used = new Map();
    for (const b of ws.getAllBlocks(false)) {
      if (!b.isEnabled()) continue;
      const part = PART[b.type];
      if (!part) continue;
      const pins = [];
      for (const f of ['PIN', 'P1', 'P2', 'P3', 'P4', 'STEP', 'DIR']) if (b.getField(f)) pins.push(b.getFieldValue(f));
      if (b.type === 'ba_neo_setup' && b.getFieldValue('CONN') === 'i2c') pins.length = 0;
      for (const p of pins) {
        if (!used.has(p)) used.set(p, []);
        used.get(p).push({ part, id: b.id });
      }
    }
    return used;
  }
  function checkPins() {
    const board = BOARDS.byId(state.boardId);
    const warns = [];
    for (const b of ws.getAllBlocks(false)) b.setWarningText && b.setWarningText(null);
    for (const b of ws.getAllBlocks(false)) {
      if (!b.isEnabled()) continue;
      const p = b.getField('PIN') ? b.getFieldValue('PIN') : null;
      if (p == null) continue;
      const num = isNaN(Number(p)) ? p : Number(p);
      let msg = null;
      if (['ba_pwm_write', 'ba_pwm_percent', 'ba_servo_write', 'ba_servo_sweep'].includes(b.type) && !board.pins.pwm.includes(num) && board.family !== 'esp32') {
        msg = `Pin ${p} can't do PWM on the ${board.name}. Try ${board.pins.pwm.slice(0, 4).join(', ')}.`;
      } else if (['ba_analog_read', 'ba_when_analog'].includes(b.type) && !board.pins.analog.includes(num)) {
        msg = `Pin ${p} can't read analog values on the ${board.name}.`;
      } else if (!['ba_analog_read', 'ba_when_analog'].includes(b.type) && board.pins.analogOnly.includes(num)) {
        msg = `Pin ${p} on the ${board.name} can only read analog values.`;
      }
      if (msg) { b.setWarningText(msg); warns.push({ id: b.id, msg }); }
    }
    for (const [p, uses] of pinUsage()) {
      const parts = [...new Set(uses.map((u) => u.part))];
      if (parts.length > 1) {
        const msg = `Pin ${p} is used by two parts: ${parts.join(' and ')}.`;
        for (const u of uses) { const blk = ws.getBlockById(u.id); if (blk) blk.setWarningText(msg); }
        warns.push({ id: uses[0].id, msg });
      }
    }
    return warns;
  }

  /* ---------------- auto-insert "set up" blocks ---------------- */
  function autoInsertSetup(e) {
    const blk = ws.getBlockById(e.blockId);
    if (!blk) return;
    const setupType = BLOCKS.SETUP_FOR[blk.type];
    if (!setupType) return;
    const family = (t) => t.replace(/_4wire|_driver/, '');
    if (ws.getAllBlocks(false).some((b) => family(b.type) === family(setupType))) return;
    setTimeout(() => {
      Blockly.Events.setGroup(e.group || true);
      let start = ws.getTopBlocks(false).find((b) => b.type === 'ba_when_start');
      if (!start) {
        start = ws.newBlock('ba_when_start');
        start.initSvg(); start.render();
        start.moveBy(30, 30);
      }
      const s = ws.newBlock(setupType);
      s.initSvg(); s.render();
      const first = start.nextConnection.targetBlock();
      if (first) { first.previousConnection.disconnect(); s.nextConnection.connect(first.previousConnection); }
      start.nextConnection.connect(s.previousConnection);
      Blockly.Events.setGroup(false);
      toast(`Added a "set up" block to "when board starts".`);
    }, 0);
  }

  /* ---------------- project load/save ---------------- */
  let loading = false;
  function projectData() {
    return {
      format: 'block-arduino', version: 1, name: $('projectName').value, board: state.boardId,
      workspace: Blockly.serialization.workspaces.save(ws),
      customBlocks: state.customBlocks.map(({ toolboxItem, ...d }) => d),
      settings: { handshake: state.handshake },
    };
  }
  function loadProject(data, filePath = null) {
    loading = true;
    try {
      state.customBlocks = CUSTOM.register((data.customBlocks || []).map((d) => ({ ...d })));
      ws.updateToolbox(BLOCKS.toolbox(state.customBlocks));
      ws.clear();
      setBoard(data.board || 'uno');
      Blockly.serialization.workspaces.load(data.workspace || {}, ws);
      $('projectName').value = data.name || 'My project';
      state.handshake = !(data.settings && data.settings.handshake === false);
      state.filePath = filePath;
      setTimeout(() => { ws.zoomToFit(); if (ws.scale > 0.8) ws.setScale(0.8); ws.scrollCenter(); }, 0);
    } finally {
      loading = false;
    }
    state.dirty = false;
    updateTitle();
    regenerate();
  }
  function markDirty() { if (!state.dirty) { state.dirty = true; updateTitle(); } }
  function updateTitle() {
    document.title = `${state.dirty ? '• ' : ''}${$('projectName').value} — Block Arduino`;
    if (api) api.setDirty(state.dirty);
  }
  $('projectName').addEventListener('input', () => { markDirty(); updateTitle(); });

  async function save(saveAs) {
    if (!api) return toast('Saving needs the desktop app.');
    const r = await api.saveProject({ data: projectData(), filePath: state.filePath, saveAs, name: $('projectName').value });
    if (r.ok) { state.filePath = r.filePath; state.dirty = false; updateTitle(); toast('Saved.'); }
  }
  async function open() {
    if (!api) return;
    if (state.dirty && !confirm('Discard unsaved changes?')) return;
    const r = await api.openProject();
    if (r.ok) loadProject(r.data, r.filePath);
  }
  function newProject() {
    if (state.dirty && !confirm('Discard unsaved changes?')) return;
    loadProject({ name: 'My project', board: state.boardId, workspace: {
      blocks: { languageVersion: 0, blocks: [{ type: 'ba_when_start', x: 40, y: 40 }] } } });
  }

  /* starters */
  function showStarters() {
    const grid = $('starterGrid');
    grid.innerHTML = '';
    for (const s of window.BA_STARTERS) {
      const c = document.createElement('button');
      c.className = 'card';
      c.innerHTML = `<strong></strong><span></span>`;
      c.querySelector('strong').textContent = s.name;
      c.querySelector('span').textContent = s.description;
      c.addEventListener('click', () => {
        $('dlgStarters').close();
        loadProject({ name: s.name, board: s.board, workspace: s.workspace });
      });
      grid.appendChild(c);
    }
    $('dlgStarters').showModal();
  }

  /* ---------------- tools / board support ---------------- */
  new MutationObserver(() => Blockly.svgResize(ws)).observe($('banner'), { attributes: true });
  async function checkCore() {
    if (!api) return;
    const st = await api.toolsStatus();
    const board = BOARDS.byId(state.boardId);
    const banner = $('banner');
    if (!st.ok) {
      banner.className = 'banner bad';
      banner.innerHTML = '';
      banner.append('The Arduino build tools (arduino-cli) could not start. Uploading will not work until this is fixed.');
      return;
    }
    if (!st.cores.includes(board.core)) {
      banner.className = 'banner';
      banner.innerHTML = '';
      const msg = document.createElement('span');
      msg.textContent = `Support for ${board.name} isn't installed yet. It's a one-time download (${board.family === 'esp32' ? 'about 600 MB' : 'about 150 MB'}).`;
      const btn = document.createElement('button');
      btn.className = 'mini'; btn.textContent = 'Install now';
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = 'Installing…';
        openLog();
        const r = await api.installCore(board.core);
        if (r.ok) { banner.className = 'banner hidden'; toast(`${board.name} support installed.`); }
        else { btn.disabled = false; btn.textContent = 'Try again'; }
      };
      banner.append(msg, btn);
    } else {
      banner.className = 'banner hidden';
    }
  }

  /* ---------------- ports + status light ---------------- */
  function setStatus(color, text) {
    $('status').querySelector('.light').className = 'light ' + color;
    $('statusText').textContent = text;
  }
  function onPorts(ports) {
    state.ports = ports;
    const usb = ports.filter((p) => p.vidpid);
    if (!state.busy) {
      if (!usb.length) setStatus('grey', ports.length ? 'Port found' : 'No board');
      else {
        const p = usb[usb.length - 1];
        const guess = p.guess ? BOARDS.byId(p.guess).name : (p.chip ? `${p.chip} board` : 'Board');
        setStatus('green', `${guess} on ${p.label}`);
        if (p.guess && p.guess !== state.boardId && !state.dirtyBoardPrompted) {
          state.dirtyBoardPrompted = true;
          toast(`An ${BOARDS.byId(p.guess).name} is plugged in — switched the board for you.`);
          setBoard(p.guess, true);
        }
      }
    }
    for (const sel of [$('serialPort'), $('blPort')]) {
      const cur = sel.value;
      sel.innerHTML = '';
      for (const p of ports) {
        const o = document.createElement('option');
        o.value = p.address; o.textContent = p.label + (p.chip ? ` (${p.chip})` : '');
        sel.appendChild(o);
      }
      if (cur) sel.value = cur;
    }
  }

  /* ---------------- progress footer ---------------- */
  const ORDER = ['building', 'finding', 'uploading', 'checking'];
  function setStep(step) {
    const lis = document.querySelectorAll('.steps li');
    if (step === 'reset') { lis.forEach((l) => (l.className = '')); return; }
    if (step === 'done') { lis.forEach((l) => { if (l.classList.contains('active')) l.className = 'done'; }); return; }
    if (step === 'error') { lis.forEach((l) => { if (l.classList.contains('active')) l.className = 'error'; }); return; }
    const idx = ORDER.indexOf(step);
    lis.forEach((l) => {
      const i = ORDER.indexOf(l.dataset.step);
      if (i === idx) l.className = 'active';
      else if (l.classList.contains('active')) l.className = 'done';
    });
  }
  function setMsg(text, kind) {
    const m = $('progressMsg');
    m.textContent = text;
    m.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function logLine(l) {
    const log = $('log');
    log.textContent += l + '\n';
    if (log.textContent.length > 200000) log.textContent = log.textContent.slice(-150000);
    log.scrollTop = log.scrollHeight;
  }
  function openLog() { $('logDrawer').classList.remove('hidden'); }

  /* Map compile errors back to blocks with plain-language messages */
  function plainError(msg) {
    let m;
    if ((m = /'([^']+)' was not declared in this scope/.exec(msg))) return `"${m[1]}" isn't known. Check the spelling in your C++ block.`;
    if (/expected ';'/.test(msg)) return 'A ";" is missing in a C++ block.';
    if ((m = /([\w.]+): No such file or directory/.exec(msg))) return `The library file ${m[1]} is missing. Add it to the block's libraries list.`;
    if (/jump to case label|crosses initialization/.test(msg)) return "A C++ block declares a variable before a wait. Declare it in a 'C++ at top of file' block instead.";
    return msg;
  }
  function showCompileErrors(compile) {
    document.querySelectorAll('#code .ln.err').forEach((n) => n.classList.remove('err'));
    const list = [];
    for (const e of compile.errors || []) {
      const id = state.last && state.last.sourceMap[e.line];
      const msg = plainError(e.message);
      const n = document.querySelector(`#code .ln[data-line="${e.line}"]`);
      if (n) n.classList.add('err');
      if (id && ws.getBlockById(id)) {
        const b = ws.getBlockById(id);
        b.setWarningText(msg);
        list.push({ id, msg });
      } else list.push({ msg: `Line ${e.line}: ${msg}` });
    }
    if (!list.length) list.push({ msg: 'The build failed. Open "Details" to see the compiler output.' });
    renderWarnings(list);
    if (list[0].id) { ws.getBlockById(list[0].id).select(); ws.centerOnBlock(list[0].id); }
    switchTab('code');
  }

  function showSizes(s) {
    if (!s || s.flash == null) { $('sizes').textContent = ''; return; }
    $('sizes').textContent = `Flash ${s.flashPct}% · RAM ${s.ramPct ?? '?'}%`;
    if (s.ramPct > 75) toast(`Memory is ${s.ramPct}% full — the board may behave oddly.`);
  }

  async function verify() {
    if (!api || state.busy) return;
    regenerate();
    state.busy = true; setStep('reset'); setStep('building'); setMsg('Building…'); $('log').textContent = '';
    try {
      const r = await api.verify({ boardId: state.boardId, code: state.last.code, libraries: state.last.libraries });
      if (r.ok) { setStep('done'); setMsg('Build OK — ready to upload.', 'good'); showSizes(r.sizes); }
      else {
        setStep('error');
        setMsg(r.message || (r.kind === 'too_big' ? 'The program is too big for this board.' : 'The code did not build — see the highlighted block.'), 'bad');
        if (r.compile) showCompileErrors(r.compile);
      }
    } finally { state.busy = false; }
  }

  async function upload() {
    if (!api || state.busy) return;
    regenerate();
    state.busy = true;
    $('btnUpload').disabled = true;
    setStep('reset'); setMsg('Getting ready…'); $('log').textContent = '';
    setStatus('amber', 'Uploading…');
    const avr = generateFor(state.boardId.startsWith('esp') ? 'uno' : state.boardId);
    const esp = generateFor('esp32');
    try {
      const r = await api.upload({
        boardId: state.boardId, port: state.port, handshake: state.handshake,
        codeByFamily: { avr: { code: avr.code, libraries: avr.libraries }, esp32: { code: esp.code, libraries: esp.libraries } },
      });
      if (r.ok) {
        setStatus('green', 'Running on the board');
        setMsg(r.attempts > 1 ? `Uploaded after ${r.attempts} tries — the working setting is remembered.` : 'Uploaded! Your program is running.', 'good');
        showSizes(r.sizes);
        if (r.board && r.board !== state.boardId) setBoard(r.board, true);
        if (r.warning) { setMsg(r.warning, 'bad'); toast(r.warning); }
        state.serialOpen = true; updateSerialButton();
      } else {
        setStatus('red', 'Problem');
        setMsg(r.message || 'Upload failed.', 'bad');
        if (r.compile) showCompileErrors(r.compile);
        if (r.kind === 'no_bootloader') $('dlgBootloader').showModal();
        if (r.kind === 'gave_up') openLog();
      }
    } catch (err) {
      setStatus('red', 'Problem'); setMsg(String(err), 'bad');
    } finally {
      state.busy = false;
      $('btnUpload').disabled = false;
    }
  }

  /* ---------------- serial monitor + plotter ---------------- */
  let serialBuf = '';
  function onSerialData(d) {
    const out = $('serialOut');
    out.textContent += d;
    if (out.textContent.length > 100000) out.textContent = out.textContent.slice(-80000);
    out.scrollTop = out.scrollHeight;
    serialBuf += d;
    const lines = serialBuf.split(/\r?\n/);
    serialBuf = lines.pop();
    for (const l of lines) plotLine(l);
  }
  function updateSerialButton() { $('btnSerial').textContent = state.serialOpen ? 'Disconnect' : 'Connect'; }
  $('btnSerial').addEventListener('click', async () => {
    if (!api) return;
    if (state.serialOpen) { await api.serialClose(); state.serialOpen = false; }
    else if ($('serialPort').value) { await api.serialOpen($('serialPort').value, Number($('serialBaud').value)); state.serialOpen = true; }
    updateSerialButton();
  });
  $('serialForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('serialIn').value;
    if (!t) return;
    const ok = api && (await api.serialSend(t));
    if (!ok) toast('Connect to the board first.');
    $('serialIn').value = '';
  });
  $('btnSerialClear').addEventListener('click', () => { $('serialOut').textContent = ''; });

  const PLOT_COLOURS = ['#4dabf7', '#ff922b', '#51cf66', '#f06595', '#ffd43b', '#9775fa'];
  function plotLine(l) {
    if (l.startsWith('BA:')) return;
    const nums = l.split(/[,\s\t]+/).filter(Boolean).map(Number);
    if (!nums.length || nums.some(isNaN)) return;
    state.plot.push(nums);
    state.series = Math.max(state.series, nums.length);
    if (state.plot.length > 400) state.plot.shift();
    drawPlot();
  }
  function drawPlot() {
    const c = $('plot');
    if (!c.offsetParent) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const W = c.clientWidth, H = c.clientHeight, pad = 30;
    g.clearRect(0, 0, W, H);
    if (!state.plot.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const r of state.plot) for (const v of r) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (lo === hi) { lo -= 1; hi += 1; }
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.fillStyle = '#9aa0bd'; g.font = '11px sans-serif';
    for (let i = 0; i <= 4; i++) {
      const y = pad / 2 + (H - pad) * i / 4;
      g.beginPath(); g.moveTo(pad + 10, y); g.lineTo(W - 6, y); g.stroke();
      g.fillText(String(+(hi - (hi - lo) * i / 4).toFixed(2)), 2, y + 4);
    }
    for (let s = 0; s < state.series; s++) {
      g.strokeStyle = PLOT_COLOURS[s % PLOT_COLOURS.length]; g.lineWidth = 2; g.beginPath();
      state.plot.forEach((r, i) => {
        if (r[s] === undefined) return;
        const x = pad + 10 + (W - pad - 16) * i / Math.max(1, 399);
        const y = pad / 2 + (H - pad) * (1 - (r[s] - lo) / (hi - lo));
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.stroke();
    }
    $('plotLegend').innerHTML = Array.from({ length: state.series }, (_, i) =>
      `<span style="--c:${PLOT_COLOURS[i % PLOT_COLOURS.length]}">value ${i + 1}</span>`).join('');
  }
  $('btnPlotClear').addEventListener('click', () => { state.plot = []; state.series = 0; drawPlot(); });

  /* ---------------- block search ---------------- */
  const allToolboxBlocks = () => BLOCKS.toolbox(state.customBlocks).contents.flatMap((c) => c.contents || []);
  $('blockSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const flyout = ws.getToolbox().getFlyout();
    if (!q) { flyout.hide(); return; }
    const hits = allToolboxBlocks().filter((item) => {
      if (item.kind !== 'block') return false;
      const def = Blockly.Blocks[item.type];
      if (!def) return false;
      const tmp = new Blockly.Workspace();
      try {
        const b = tmp.newBlock(item.type);
        const text = (item.type + ' ' + b.toString()).toLowerCase();
        return q.split(/\s+/).every((w) => text.includes(w));
      } catch { return false; } finally { tmp.dispose(); }
    });
    ws.getToolbox().clearSelection();
    flyout.show(hits.length ? hits : [{ kind: 'label', text: 'No blocks found' }]);
  });
  $('blockSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; ws.getToolbox().getFlyout().hide(); } });

  /* ---------------- pin map ---------------- */
  function showPins() {
    const board = BOARDS.byId(state.boardId);
    $('pinsTitle').textContent = `Pin map — ${board.name}`;
    const used = pinUsage();
    const grid = $('pinGrid');
    grid.innerHTML = '';
    const all = [...board.pins.digital, ...board.pins.analog.filter((a) => !board.pins.digital.includes(a))];
    for (const p of all) {
      const d = document.createElement('div');
      const cls = ['pin'];
      const caps = [];
      if (board.pins.pwm.includes(p)) { cls.push('pwm'); caps.push('PWM'); }
      if (board.pins.analog.includes(p)) { cls.push('analog'); caps.push('analog'); }
      if (board.pins.i2c.sda === p || board.pins.i2c.scl === p) { cls.push('i2c'); caps.push(board.pins.i2c.sda === p ? 'SDA' : 'SCL'); }
      if (board.pins.serial.includes(p)) caps.push('USB serial');
      if (board.pins.led === p) caps.push('LED');
      const u = used.get(String(p));
      if (u) { cls.push('used'); caps.unshift([...new Set(u.map((x) => x.part))].join(', ')); }
      d.className = cls.join(' ');
      d.innerHTML = `<b>${p}</b>${caps.join(' · ') || '&nbsp;'}`;
      grid.appendChild(d);
    }
    $('dlgPins').showModal();
  }

  /* ---------------- Block Maker ---------------- */
  let mkPreviewWs = null;
  function mkInputRow(name = '', inp = { type: 'number', default: 0 }) {
    const row = document.createElement('div');
    row.className = 'input-row';
    row.innerHTML = `<input class="n" placeholder="NAME"><select class="t">${CUSTOM.INPUT_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
      <input class="d" placeholder="default"><input class="x" placeholder="filter / options"><button class="mini" type="button">✕</button>`;
    row.querySelector('.n').value = name;
    row.querySelector('.t').value = inp.type;
    row.querySelector('.d').value = inp.default ?? '';
    row.querySelector('.x').value = inp.filter || (inp.options || []).join(',');
    row.querySelector('button').onclick = () => { row.remove(); mkUpdate(); };
    row.addEventListener('input', mkUpdate);
    $('mkInputs').appendChild(row);
  }
  function mkRead() {
    const inputs = {};
    for (const row of $('mkInputs').children) {
      const n = row.querySelector('.n').value.trim().toUpperCase();
      if (!n) continue;
      const t = row.querySelector('.t').value;
      const d = row.querySelector('.d').value;
      const x = row.querySelector('.x').value.trim();
      const inp = { type: t };
      if (d !== '') inp.default = t === 'number' ? Number(d) : d;
      if (t === 'pin' && x) inp.filter = x;
      if (t === 'dropdown') inp.options = x ? x.split(',').map((s) => s.trim()) : ['A', 'B'];
      inputs[n] = inp;
    }
    const libs = $('mkLibs').value.split(',').map((s) => s.trim()).filter(Boolean);
    const code = $('mkCode').value;
    return {
      id: $('mkId').value.trim(), category: 'Custom', shape: $('mkShape').value, label: $('mkLabel').value,
      inputs, include: $('mkInclude').value.trim() || undefined, global: $('mkGlobal').value || undefined,
      setup: $('mkSetup').value || undefined, code, yields: /\{\{\s*WAIT_MS/.test(code), libraries: libs.length ? libs : undefined,
    };
  }
  function mkFill(def) {
    $('mkId').value = def.id || ''; $('mkShape').value = def.shape || 'statement'; $('mkLabel').value = def.label || '';
    $('mkInclude').value = [].concat(def.include || []).join(' '); $('mkGlobal').value = def.global || '';
    $('mkSetup').value = def.setup || ''; $('mkCode').value = def.code || ''; $('mkLibs').value = (def.libraries || []).join(', ');
    $('mkInputs').innerHTML = '';
    for (const [n, inp] of Object.entries(def.inputs || {})) mkInputRow(n, inp);
    mkUpdate();
  }
  function mkUpdate() {
    const def = mkRead();
    if (!def.id && def.label) def.id = def.label.toLowerCase().replace(/%\w+/g, '').trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'my_block';
    const errs = CUSTOM.validate(def);
    $('mkErrors').innerHTML = errs.map((e) => `<div>• ${e.replace(/</g, '&lt;')}</div>`).join('');
    if (!mkPreviewWs) mkPreviewWs = Blockly.inject('mkPreview', { renderer: 'zelos', theme, readOnly: true, media: '../../node_modules/blockly/media/', zoom: { startScale: 0.8 } });
    mkPreviewWs.clear();
    try {
      const json = CUSTOM.toBlockJson({ ...def, id: '__preview' });
      Blockly.Blocks.custom___preview = { init() { this.jsonInit(json); } };
      const item = CUSTOM.toolboxItem({ ...def, id: '__preview' });
      Blockly.serialization.blocks.append({ type: 'custom___preview', x: 20, y: 30, inputs: item.inputs }, mkPreviewWs);
    } catch { /* label still being typed */ }
    return { def, errs };
  }
  function showMaker() {
    const sel = $('mkExisting');
    sel.innerHTML = '<option value="">— new block —</option>' + state.customBlocks.map((d) => `<option>${d.id}</option>`).join('');
    sel.onchange = () => mkFill(state.customBlocks.find((d) => d.id === sel.value) || CUSTOM.EXAMPLE);
    $('dlgMaker').showModal();
    mkFill(state.customBlocks.length ? { id: '', label: '', inputs: {} } : CUSTOM.EXAMPLE);
  }
  ['mkId', 'mkShape', 'mkLabel', 'mkCode', 'mkSetup', 'mkGlobal', 'mkInclude', 'mkLibs'].forEach((id) => $(id).addEventListener('input', mkUpdate));
  $('mkAddInput').onclick = () => { mkInputRow('', { type: 'number', default: 0 }); mkUpdate(); };
  $('mkSave').onclick = () => {
    const { def, errs } = mkUpdate();
    if (!def.id) def.id = $('mkLabel').value.toLowerCase().replace(/%\w+/g, '').trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'my_block';
    if (errs.length) return;
    state.customBlocks = state.customBlocks.filter((d) => d.id !== def.id).concat(CUSTOM.register([def]));
    ws.updateToolbox(BLOCKS.toolbox(state.customBlocks));
    markDirty(); regenerate();
    $('dlgMaker').close();
    toast(`Block "${def.id}" is in the Custom category.`);
  };
  $('mkDelete').onclick = () => {
    const id = $('mkExisting').value;
    if (!id) return;
    if (ws.getAllBlocks(false).some((b) => b.type === 'custom_' + id)) return toast('Remove this block from your scripts first.');
    state.customBlocks = state.customBlocks.filter((d) => d.id !== id);
    ws.updateToolbox(BLOCKS.toolbox(state.customBlocks));
    markDirty(); $('dlgMaker').close();
  };

  async function importBlocks() {
    if (!api) return;
    const r = await api.importBlocks();
    if (!r.ok) return;
    const good = r.defs.filter((d) => !CUSTOM.validate(d).length);
    const ids = new Set(good.map((d) => d.id));
    state.customBlocks = state.customBlocks.filter((d) => !ids.has(d.id)).concat(CUSTOM.register(good));
    ws.updateToolbox(BLOCKS.toolbox(state.customBlocks));
    markDirty();
    toast(`Imported ${good.length} block${good.length === 1 ? '' : 's'}${good.length < r.defs.length ? ` (${r.defs.length - good.length} skipped)` : ''}.`);
  }

  /* ---------------- C++ code editor dialog ---------------- */
  let codeCallback = null;
  window.BA_CODE_EDITOR = (value, done) => {
    codeCallback = done;
    $('codeEditor').value = value;
    $('dlgCode').showModal();
    $('codeEditor').focus();
  };
  $('codeSave').onclick = () => { if (codeCallback) codeCallback($('codeEditor').value); codeCallback = null; $('dlgCode').close(); };
  $('codeEditor').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.target, a = t.selectionStart;
      t.setRangeText('  ', a, t.selectionEnd, 'end');
    }
  });

  /* ---------------- misc UI ---------------- */
  let toastTimer;
  function toast(t) {
    const el = $('toast');
    el.textContent = t; el.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
    if (name === 'plot') drawPlot();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('btnCollapse').onclick = () => { $('main').classList.add('collapsed'); Blockly.svgResize(ws); showReopen(); };
  function showReopen() {
    const b = document.createElement('button');
    b.textContent = '‹ Code'; b.className = 'mini'; b.style.cssText = 'position:absolute;right:10px;top:50px;z-index:6';
    b.onclick = () => { $('main').classList.remove('collapsed'); b.remove(); Blockly.svgResize(ws); };
    $('workspaceWrap').appendChild(b);
  }
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  /* splitter */
  (() => {
    let drag = false;
    $('splitter').addEventListener('mousedown', () => { drag = true; document.body.style.userSelect = 'none'; });
    window.addEventListener('mouseup', () => { drag = false; document.body.style.userSelect = ''; });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const w = Math.min(Math.max(window.innerWidth - e.clientX, 280), window.innerWidth * 0.6);
      document.documentElement.style.setProperty('--side-w', w + 'px');
      Blockly.svgResize(ws);
    });
  })();
  window.addEventListener('resize', () => { Blockly.svgResize(ws); drawPlot(); });

  $('btnNew').onclick = newProject;
  $('btnOpen').onclick = open;
  $('btnSave').onclick = () => save(false);
  $('btnStarters').onclick = showStarters;
  $('btnVerify').onclick = verify;
  $('btnUpload').onclick = upload;
  $('btnUndo').onclick = () => ws.undo(false);
  $('btnRedo').onclick = () => ws.undo(true);
  $('btnCleanup').onclick = () => ws.cleanUp();
  $('btnPins').onclick = showPins;
  $('btnCopy').onclick = () => { navigator.clipboard.writeText(state.last ? state.last.code : ''); toast('Code copied.'); };
  $('btnIde').onclick = async () => {
    if (!api) return;
    const r = await api.openIde({ code: state.last.code, name: $('projectName').value });
    toast(r.ok ? 'Opened in the Arduino IDE (BlockArduino.h is next to the sketch).' : 'Saved the sketch, but no Arduino IDE was found to open it: ' + r.filePath);
  };
  $('btnLog').onclick = () => $('logDrawer').classList.toggle('hidden');
  $('btnCloseLog').onclick = () => $('logDrawer').classList.add('hidden');
  $('btnCopyLog').onclick = () => { navigator.clipboard.writeText($('log').textContent); toast('Details copied — paste them for a teacher or forum.'); };
  $('blBurn').onclick = async () => {
    if (!api) return;
    $('blBurn').disabled = true; openLog();
    const r = await api.burnBootloader({ port: $('blPort').value, boardId: state.boardId });
    $('blBurn').disabled = false;
    toast(r.ok ? 'Bootloader repaired! Try uploading again.' : 'Repair failed — check the wiring and the helper board.');
    if (r.ok) $('dlgBootloader').close();
  };

  const MENU = {
    new: newProject, open, save: () => save(false), saveAs: () => save(true), starters: showStarters,
    verify, upload, openIde: () => $('btnIde').click(),
    exportIno: () => api && api.exportIno({ code: state.last.code, name: $('projectName').value }),
    installCore: checkCore, bootloader: () => $('dlgBootloader').showModal(),
    blockMaker: showMaker, importBlocks,
    exportBlocks: () => (state.customBlocks.length ? api.exportBlocks(state.customBlocks.map(({ toolboxItem, ...d }) => d)) : toast('No custom blocks yet — make one with Block Maker.')),
    contrast: () => document.body.classList.toggle('contrast'),
    zoomIn: () => ws.zoomCenter(1), zoomOut: () => ws.zoomCenter(-1),
    about: () => $('dlgAbout').showModal(),
  };

  /* ---------------- start ---------------- */
  async function boot() {
    loadProject({ name: 'Blink', board: 'uno', workspace: window.BA_STARTERS[0].workspace });
    if (!api) { setMsg('Preview mode — open the desktop app to upload.'); return; }
    api.onMenu((c) => MENU[c] && MENU[c]());
    api.onPorts(onPorts);
    api.onLog(logLine);
    api.onStep(setStep);
    api.onNotice((t) => { setMsg(t); logLine('» ' + t); });
    api.onPort((p) => { state.port = p.port; });
    api.onSizes(showSizes);
    api.onSerialData(onSerialData);
    api.onSerialState((s) => { state.serialOpen = s.open; updateSerialButton(); });
    const info = await api.info();
    $('aboutVersion').textContent = 'v' + info.version;
    const st = await api.toolsStatus();
    $('aboutTools').textContent = st.ok ? `arduino-cli ${st.version}` : 'arduino-cli not available';
    onPorts(await api.listPorts());
    checkCore();
  }
  boot();

  window.BA_APP = { ws, state, regenerate, loadProject, projectData, generateFor, menu: MENU };
})();
