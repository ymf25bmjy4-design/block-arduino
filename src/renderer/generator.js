/* Block Arduino code generator: workspace -> one .ino sketch + source map.
 *
 * Layout (fixed so output is predictable):
 *   includes, declarations, task prototypes/objects, helpers,
 *   one task function per hat block, setup(), loop()
 */
(function () {
  const isNode = typeof window === 'undefined';
  const Blockly = isNode ? require('blockly') : window.Blockly;
  const BA = isNode ? require('./blocks.js') : window.BA_BLOCKS;

  const O = { ATOMIC: 0, UNARY: 2, MUL: 5, ADD: 6, REL: 8, EQ: 9, AND: 13, OR: 14, NONE: 99 };
  const MARK_S = '\u0001', MARK_E = '\u0002';

  const LIBS = {
    Servo: 'Servo', ESP32Servo: 'ESP32Servo', AccelStepper: 'AccelStepper',
    NeoPixel: 'Adafruit NeoPixel', Seesaw: 'Adafruit seesaw Library', LCD: 'LiquidCrystal I2C',
  };

  const HATS = ['ba_when_start', 'ba_forever_hat', 'ba_every', 'ba_when_button', 'ba_when_pin', 'ba_when_analog',
    'ba_when_receive', 'ba_when_serial', 'ba_when_stepper_done'];

  const gen = new Blockly.CodeGenerator('Arduino');
  gen.INDENT = '  ';
  gen.addReservedWords('setup,loop,int,long,float,double,char,bool,boolean,byte,String,void,if,else,for,while,do,' +
    'switch,case,break,continue,return,true,false,HIGH,LOW,INPUT,OUTPUT,millis,delay,Serial,lcd,strip,new,delete,class,struct');

  gen.init = function (ws) {
    if (!this.nameDB_) this.nameDB_ = new Blockly.Names(this.RESERVED_WORDS_);
    else this.nameDB_.reset();
    this.nameDB_.setVariableMap(ws.getVariableMap());
    this.nameDB_.populateVariables(ws);
    this.isInitialized = true;
  };

  /* ---------------- per-run state ---------------- */
  let S;
  function reset(ws, opts) {
    S = {
      ws, opts,
      family: (opts.board && opts.board.family) || 'avr',
      includes: new Set(), globals: new Map(), helpers: new Map(), setups: new Map(),
      polls: [], triggers: [], background: new Map(), startTasks: [], tasks: [],
      messages: new Map(), receivers: new Map(), libraries: new Set(), warnings: [],
      repeatN: 0, buttons: new Map(), steppers: new Map(), servos: new Set(),
      neo: null, lcd: null, serialLine: false, stopHooks: new Map(), varTypes: new Map(),
      customDefs: new Map((opts.customBlocks || []).map((d) => [d.id, d])),
    };
  }
  const inc = (h) => S.includes.add(h);
  const glob = (k, c) => { if (!S.globals.has(k)) S.globals.set(k, c); };
  const helper = (k, c) => { if (!S.helpers.has(k)) S.helpers.set(k, c); };
  const setup = (k, c) => { if (!S.setups.has(k)) S.setups.set(k, c); };
  const bg = (k, c) => { if (!S.background.has(k)) S.background.set(k, c); };
  const pinC = (p) => (/^\d+$/.test(String(p)) ? String(p) : String(p)); // A0 etc. are valid C identifiers
  const ident = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_');
  const v = (b, name, order = O.NONE, dflt = '0') => gen.valueToCode(b, name, order) || dflt;
  const str = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

  /* ---------------- hardware helpers ---------------- */
  function button(pin, wiring) {
    const name = 'btn_' + ident(pin);
    if (!S.buttons.has(name) || wiring) S.buttons.set(name, { pin, wiring: wiring || (S.buttons.get(name) || {}).wiring || 'BA_ACTIVE_LOW' });
    return name;
  }

  function servo(pin) {
    const name = 'servo_' + ident(pin);
    const cls = S.family === 'esp32' ? 'Servo' : 'Servo';
    if (S.family === 'esp32') { inc('<ESP32Servo.h>'); S.libraries.add(LIBS.ESP32Servo); }
    else { inc('<Servo.h>'); S.libraries.add(LIBS.Servo); }
    glob('servo_' + pin, `${cls} ${name};`);
    glob('sweep_' + pin, `BaSweep<${cls}> sweep_${ident(pin)}(${name});`);
    setup('servo_' + pin, `${name}.attach(${pinC(pin)});\n${name}.write(90);`);
    bg('sweep_' + pin, `sweep_${ident(pin)}.update();`);
    S.stopHooks.set('servo_' + pin, `${name}.detach();`);
    S.servos.add(pin);
    return name;
  }

  function stepper(id) {
    const name = 'stepper' + id;
    if (!S.steppers.has(id)) {
      S.warnings.push({ msg: `Stepper ${id} has no "set up stepper" block — using 28BYJ-48 on pins 8, 9, 10, 11.` });
      S.steppers.set(id, { kind: '4wire', pins: ['8', '9', '10', '11'], speed: 500 });
    }
    return name;
  }

  function neo() {
    if (!S.neo) {
      S.warnings.push({ msg: 'NeoPixel blocks used without "set up NeoPixels" — using 8 pixels on pin 6.' });
      S.neo = { count: 8, conn: 'pin', pin: '6' };
    }
    return 'strip';
  }

  function lcd() {
    if (!S.lcd) S.lcd = { cols: 16, rows: 2, addr: 'auto' };
    return 'lcd';
  }

  function message(name) {
    const key = String(name).trim() || 'message1';
    if (!S.messages.has(key)) S.messages.set(key, S.messages.size);
    return 'MSG_' + ident(key);
  }

  function hexToRgb(hex) {
    const n = parseInt(String(hex).replace('#', ''), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ---------------- pre-pass: set-up blocks are declarations ---------------- */
  function collectSetups(ws) {
    for (const blk of ws.getAllBlocks(true)) {
      if (!blk.isEnabled()) continue;
      switch (blk.type) {
        case 'ba_button_setup': button(blk.getFieldValue('PIN'), blk.getFieldValue('WIRING')); break;
        case 'ba_stepper_setup_4wire':
          S.steppers.set(blk.getFieldValue('ID'), { kind: '4wire', speed: 500,
            pins: ['P1', 'P2', 'P3', 'P4'].map((p) => blk.getFieldValue(p)) });
          break;
        case 'ba_stepper_setup_driver':
          S.steppers.set(blk.getFieldValue('ID'), { kind: 'driver', speed: 1000,
            pins: [blk.getFieldValue('STEP'), blk.getFieldValue('DIR')] });
          break;
        case 'ba_neo_setup':
          S.neo = { count: blk.getFieldValue('COUNT'), conn: blk.getFieldValue('CONN'), pin: blk.getFieldValue('PIN') };
          break;
        case 'ba_lcd_setup': {
          const [cols, rows] = blk.getFieldValue('SIZE').split('x').map(Number);
          S.lcd = { cols, rows, addr: blk.getFieldValue('ADDR') };
          break;
        }
        case 'variables_set': {
          const tgt = blk.getInputTargetBlock('VALUE');
          if (tgt && tgt.outputConnection && (tgt.outputConnection.getCheck() || []).includes('String')) {
            S.varTypes.set(blk.getFieldValue('VAR'), 'String');
          }
          break;
        }
      }
    }
  }

  /* ---------------- statements: source-map markers ---------------- */
  gen.scrub_ = function (block, code, thisOnly) {
    let out = code;
    if (block.previousConnection || HATS.includes(block.type) || !block.outputConnection) {
      if (typeof code === 'string' && code.length) out = MARK_S + block.id + MARK_E + code;
    }
    const next = block.nextConnection && block.nextConnection.targetBlock();
    return thisOnly ? out : out + (next ? gen.blockToCode(next) : '');
  };

  const F = gen.forBlock;
  const noop = () => '';
  const yieldLine = 'BA_YIELD();\n';

  /* Events */
  F.ba_broadcast = (b) => {
    const m = message(b.getFieldValue('MSG'));
    if (b.getFieldValue('WAIT') === 'wait') {
      return `ba_broadcast(${m});\nBA_YIELD();\nBA_WAIT_UNTIL(@@RECV_${m}@@);\n`;
    }
    return `ba_broadcast(${m});\n`;
  };
  F.ba_stop = (b) => (b.getFieldValue('WHAT') === 'all' ? 'ba_stop_all();\nBA_EXIT();\n' : 'BA_EXIT();\n');

  /* Pins */
  F.ba_digital_read = (b) => [`digitalRead(${pinC(b.getFieldValue('PIN'))})`, O.ATOMIC];
  F.ba_analog_read = (b) => [`analogRead(${pinC(b.getFieldValue('PIN'))})`, O.ATOMIC];
  F.ba_digital_write = (b) => {
    const p = pinC(b.getFieldValue('PIN'));
    setup('out_' + p, `pinMode(${p}, OUTPUT);`);
    return `digitalWrite(${p}, ${b.getFieldValue('STATE')});\n`;
  };
  F.ba_toggle_pin = (b) => {
    const p = pinC(b.getFieldValue('PIN'));
    setup('out_' + p, `pinMode(${p}, OUTPUT);`);
    return `digitalWrite(${p}, !digitalRead(${p}));\n`;
  };
  F.ba_pwm_write = (b) => {
    const p = pinC(b.getFieldValue('PIN'));
    setup('out_' + p, `pinMode(${p}, OUTPUT);`);
    return `analogWrite(${p}, constrain(${v(b, 'VALUE')}, 0, 255));\n`;
  };
  F.ba_pwm_percent = (b) => {
    const p = pinC(b.getFieldValue('PIN'));
    setup('out_' + p, `pinMode(${p}, OUTPUT);`);
    return `analogWrite(${p}, map(constrain(${v(b, 'VALUE')}, 0, 100), 0, 100, 0, 255));\n`;
  };
  F.ba_pin_mode = (b) => `pinMode(${pinC(b.getFieldValue('PIN'))}, ${b.getFieldValue('MODE')});\n`;

  /* Switches */
  F.ba_button_setup = noop;
  F.ba_button_pressed = (b) => [`${button(b.getFieldValue('PIN'))}.isDown()`, O.ATOMIC];
  F.ba_button_count = (b) => [`${button(b.getFieldValue('PIN'))}.count()`, O.ATOMIC];
  F.ba_button_reset = (b) => `${button(b.getFieldValue('PIN'))}.resetCount();\n`;

  /* Servos */
  F.ba_servo_write = (b) => {
    const s = servo(b.getFieldValue('PIN'));
    return `${s}.write(constrain(${v(b, 'ANGLE')}, 0, 180));\n`;
  };
  F.ba_servo_sweep = (b) => {
    const p = b.getFieldValue('PIN'); servo(p);
    return `sweep_${ident(p)}.go(${v(b, 'ANGLE')}, (${v(b, 'SECS', O.MUL)}) * 1000);\n`;
  };
  F.ba_servo_read = (b) => [`${servo(b.getFieldValue('PIN'))}.read()`, O.ATOMIC];
  F.ba_servo_detach = (b) => `${servo(b.getFieldValue('PIN'))}.detach();\n`;

  /* Steppers */
  F.ba_stepper_setup_4wire = noop;
  F.ba_stepper_setup_driver = noop;
  const waitStepper = (s, b) => (b.getFieldValue('WAIT') === 'wait' ? `BA_WAIT_UNTIL(${s}.distanceToGo() == 0);\n` : '');
  F.ba_stepper_speed = (b) => {
    const s = stepper(b.getFieldValue('ID'));
    const sp = v(b, 'SPEED');
    return `${s}.setMaxSpeed(${sp});\n${s}.setAcceleration(${sp});\n`;
  };
  F.ba_stepper_move = (b) => { const s = stepper(b.getFieldValue('ID')); return `${s}.move(${v(b, 'STEPS')});\n` + waitStepper(s, b); };
  F.ba_stepper_moveto = (b) => { const s = stepper(b.getFieldValue('ID')); return `${s}.moveTo(${v(b, 'POS')});\n` + waitStepper(s, b); };
  F.ba_stepper_stop = (b) => `${stepper(b.getFieldValue('ID'))}.stop();\n`;
  F.ba_stepper_position = (b) => [`${stepper(b.getFieldValue('ID'))}.currentPosition()`, O.ATOMIC];

  /* NeoPixels */
  F.ba_neo_setup = noop;
  const dirty = 'ba_strip_dirty = true;\n';
  F.ba_neo_pixel = (b) => { neo(); const [r, g, bl] = hexToRgb(b.getFieldValue('COLOUR'));
    return `strip.setPixelColor(${v(b, 'INDEX')}, ${r}, ${g}, ${bl});\n` + dirty; };
  F.ba_neo_pixel_rgb = (b) => { neo();
    return `strip.setPixelColor(${v(b, 'INDEX')}, ${v(b, 'R')}, ${v(b, 'G')}, ${v(b, 'B')});\n` + dirty; };
  F.ba_neo_fill = (b) => { neo(); const [r, g, bl] = hexToRgb(b.getFieldValue('COLOUR')); return `ba_neo_fill(${r}, ${g}, ${bl});\n` + dirty; };
  F.ba_neo_rainbow = (b) => { neo(); return `ba_neo_rainbow(${v(b, 'SHIFT')});\n` + dirty; };
  F.ba_neo_brightness = (b) => { neo(); return `strip.setBrightness(constrain(${v(b, 'LEVEL')}, 0, 255));\n` + dirty; };
  F.ba_neo_clear = () => { neo(); return 'strip.clear();\n' + dirty; };
  F.ba_neo_show = () => { neo(); return 'strip.show();\nba_strip_dirty = false;\n'; };

  /* LCD */
  F.ba_lcd_setup = noop;
  F.ba_lcd_print_at = (b) => { lcd();
    return `lcd->setCursor((${v(b, 'COL', O.ADD, '1')}) - 1, (${v(b, 'ROW', O.ADD, '1')}) - 1);\nlcd->print(ba_str(${v(b, 'TEXT', O.NONE, '""')}));\n`; };
  F.ba_lcd_print_line = (b) => { lcd();
    return `ba_lcd_line(*lcd, (${v(b, 'ROW', O.ADD, '1')}) - 1, ba_str(${v(b, 'TEXT', O.NONE, '""')}), ${S.lcd.cols});\n`; };
  F.ba_lcd_clear = () => { lcd(); return 'lcd->clear();\n'; };
  F.ba_lcd_backlight = (b) => { lcd(); return b.getFieldValue('STATE') === 'on' ? 'lcd->backlight();\n' : 'lcd->noBacklight();\n'; };
  F.ba_lcd_scroll = (b) => { lcd(); return `lcd->scrollDisplay${b.getFieldValue('DIR')}();\n`; };

  /* Control: every wait/loop yields so nothing blocks */
  F.ba_wait = (b) => `BA_WAIT_MS((${v(b, 'SECS', O.MUL, '1')}) * 1000);\n`;
  F.ba_wait_ms = (b) => `BA_WAIT_MS(${v(b, 'MS', O.NONE, '100')});\n`;
  F.ba_wait_until = (b) => `BA_WAIT_UNTIL(${v(b, 'COND', O.NONE, 'false')});\n`;
  F.ba_repeat = (b) => {
    const n = 'ba_rep' + ++S.repeatN;
    glob(n, `long ${n};`);
    return `for (${n} = 0; ${n} < ${v(b, 'TIMES', O.REL, '10')}; ${n}++) {\n${gen.statementToCode(b, 'DO')}${gen.INDENT}${yieldLine}}\n`;
  };
  F.ba_repeat_until = (b) =>
    `while (!(${v(b, 'COND', O.NONE, 'false')})) {\n${gen.statementToCode(b, 'DO')}${gen.INDENT}${yieldLine}}\n`;
  F.ba_forever = (b) => `while (true) {\n${gen.statementToCode(b, 'DO')}${gen.INDENT}${yieldLine}}\n`;
  F.ba_if = (b) => `if (${v(b, 'COND', O.NONE, 'false')}) {\n${gen.statementToCode(b, 'DO')}}\n`;
  F.ba_if_else = (b) =>
    `if (${v(b, 'COND', O.NONE, 'false')}) {\n${gen.statementToCode(b, 'DO')}} else {\n${gen.statementToCode(b, 'ELSE')}}\n`;

  /* Operators */
  F.math_number = (b) => { const n = Number(b.getFieldValue('NUM')); return [String(n), n < 0 ? O.UNARY : O.ATOMIC]; };
  F.text = (b) => [str(b.getFieldValue('TEXT')), O.ATOMIC];
  F.ba_arith = (b) => {
    const op = b.getFieldValue('OP');
    const ord = op === '+' || op === '-' ? O.ADD : O.MUL;
    const a = v(b, 'A', ord), c = v(b, 'B', ord + 0.1);
    if (op === '%') return [`((long)(${a}) % (long)(${c}))`, O.ATOMIC];
    if (op === '/') return [`((float)(${a}) / (${c}))`, O.ATOMIC];
    return [`${a} ${op} ${c}`, ord];
  };
  F.ba_compare = (b) => {
    const op = b.getFieldValue('OP');
    const a = gen.valueToCode(b, 'A', O.REL) || '0', c = gen.valueToCode(b, 'B', O.REL) || '0';
    const isStr = (x) => /^"/.test(x);
    if ((op === '==' || op === '!=') && (isStr(a) || isStr(c))) {
      return [`${op === '!=' ? '!' : ''}String(${a}).equals(String(${c}))`, O.UNARY];
    }
    return [`${a} ${op} ${c}`, op === '==' || op === '!=' ? O.EQ : O.REL];
  };
  F.ba_and_or = (b) => { const op = b.getFieldValue('OP'); const ord = op === '&&' ? O.AND : O.OR;
    return [`${v(b, 'A', ord, 'false')} ${op} ${v(b, 'B', ord, 'false')}`, ord]; };
  F.ba_not = (b) => [`!${v(b, 'A', O.UNARY, 'false')}`, O.UNARY];
  F.ba_bool = (b) => [b.getFieldValue('V'), O.ATOMIC];
  F.ba_random = (b) => [`random(${v(b, 'FROM')}, (${v(b, 'TO', O.ADD)}) + 1)`, O.ATOMIC];
  F.ba_map = (b) => [`map(${v(b, 'V')}, ${v(b, 'FL')}, ${v(b, 'FH')}, ${v(b, 'TL')}, ${v(b, 'TH')})`, O.ATOMIC];
  F.ba_constrain = (b) => [`constrain(${v(b, 'V')}, ${v(b, 'LO')}, ${v(b, 'HI')})`, O.ATOMIC];
  F.ba_math_fn = (b) => [`${b.getFieldValue('FN')}(${v(b, 'V')})`, O.ATOMIC];
  F.ba_millis = () => ['millis()', O.ATOMIC];
  F.ba_join = (b) => [`ba_str(${v(b, 'A', O.NONE, '""')}) + ba_str(${v(b, 'B', O.NONE, '""')})`, O.ADD];

  /* Variables (global, like Scratch) */
  const varName = (b) => gen.getVariableName(b.getFieldValue('VAR'));
  F.variables_get = (b) => [varName(b), O.ATOMIC];
  F.variables_set = (b) => `${varName(b)} = ${v(b, 'VALUE')};\n`;
  F.ba_change_var = (b) => `${varName(b)} += ${v(b, 'DELTA', O.NONE, '1')};\n`;

  /* Serial */
  F.ba_serial_print = (b) => `ba_print(${v(b, 'V', O.NONE, '""')});\n`;
  F.ba_serial_line = () => { S.serialLine = true; return ['ba_line', O.ATOMIC]; };

  /* Custom C++ */
  const lintDelay = (b, code) => {
    if (/\bdelay\s*\(/.test(code)) {
      S.warnings.push({ id: b.id, msg: 'delay() freezes every other script. Use a "wait" block instead.' });
    }
  };
  F.ba_cpp_code = (b) => { const c = b.getFieldValue('CODE'); lintDelay(b, c); return c.replace(/\s*$/, '') + '\n'; };
  F.ba_cpp_value = (b) => [`(${b.getFieldValue('CODE')})`, O.ATOMIC];
  F.ba_cpp_condition = (b) => [`(${b.getFieldValue('CODE')})`, O.ATOMIC];
  F.ba_cpp_top = noop;
  F.ba_cpp_setup = noop;

  /* JSON custom blocks (Block Maker / extension packs) */
  function customBlockCode(b) {
    const def = S.customDefs.get(b.type.slice('custom_'.length));
    if (!def) return '';
    const fill = (tpl) => String(tpl || '').replace(/\{\{\s*([A-Za-z0-9_]+)(?::([^}]+))?\s*\}\}/g, (m, name, arg) => {
      if (name === 'WAIT_MS') return `\nBA_WAIT_MS(${arg || 0});\n`;
      const inp = (def.inputs || {})[name];
      if (!inp) return m;
      if (inp.type === 'statements') return '\n' + gen.statementToCode(b, name);
      if (['number', 'text', 'boolean'].includes(inp.type)) return gen.valueToCode(b, name, O.NONE) || String(inp.default ?? 0);
      if (inp.type === 'colour') { const [r, g, bl] = hexToRgb(b.getFieldValue(name)); return `${r}, ${g}, ${bl}`; }
      return String(b.getFieldValue(name));
    });
    for (const l of def.libraries || []) S.libraries.add(l);
    for (const i of [].concat(def.include || [])) if (i) glob('cinc_' + i, i.startsWith('#') ? i : `#include ${i}`);
    if (def.global) glob('cglob_' + def.id + fill(def.global), fill(def.global));
    if (def.setup) setup('csetup_' + def.id + fill(def.setup), fill(def.setup));
    const code = fill(def.code);
    lintDelay(b, code);
    if (def.shape === 'value' || def.shape === 'boolean') return [`(${code})`, O.ATOMIC];
    return code.split('\n').map((l) => l.trim()).filter(Boolean).join('\n') + '\n';
  }
  function ensureCustomGenerators(defs) {
    for (const d of defs) F['custom_' + d.id] = customBlockCode;
  }

  /* ---------------- hat blocks -> tasks ---------------- */
  function buildTask(hatBlock, idx) {
    const name = 'task' + idx;
    const label = hatLabel(hatBlock);
    let body = gen.blockToCode(hatBlock.nextConnection.targetBlock() ? hatBlock.nextConnection.targetBlock() : null) || '';
    if (Array.isArray(body)) body = body[0];
    if (hatBlock.type === 'ba_forever_hat') body = `while (true) {\n${gen.prefixLines(body, gen.INDENT)}${gen.INDENT}${yieldLine}}\n`;
    let ignore = 0;
    switch (hatBlock.type) {
      case 'ba_when_start': S.startTasks.push(name); break;
      case 'ba_forever_hat': S.startTasks.push(name); break;
      case 'ba_every': {
        glob('every' + idx, `BaEvery every${idx}(${Number(hatBlock.getFieldValue('MS')) || 500});`);
        S.triggers.push(`if (every${idx}.fire()) ba_trigger(${name});`);
        ignore = 1;
        break;
      }
      case 'ba_when_button': {
        const btn = button(hatBlock.getFieldValue('PIN'));
        const ev = { pressed: 'pressed', released: 'released', held: 'held' }[hatBlock.getFieldValue('EVENT')];
        S.triggers.push(`if (${btn}.${ev}()) ba_trigger(${name});`);
        break;
      }
      case 'ba_when_pin': {
        const p = hatBlock.getFieldValue('PIN');
        glob('edge_' + p, `BaEdge edge_${ident(p)}(${pinC(p)});`);
        S.triggers.push(`if (edge_${ident(p)}.${hatBlock.getFieldValue('EDGE')}()) ba_trigger(${name});`);
        break;
      }
      case 'ba_when_analog': {
        const p = hatBlock.getFieldValue('PIN');
        const lvl = Number(hatBlock.getFieldValue('LEVEL')) || 0;
        glob('thr' + idx, `BaThreshold thr${idx}(${pinC(p)}, ${lvl});`);
        S.triggers.push(`if (thr${idx}.${hatBlock.getFieldValue('DIR') === 'above' ? 'wentAbove' : 'wentBelow'}()) ba_trigger(${name});`);
        break;
      }
      case 'ba_when_receive': {
        const m = message(hatBlock.getFieldValue('MSG'));
        if (!S.receivers.has(m)) S.receivers.set(m, []);
        S.receivers.get(m).push(name);
        S.triggers.push(`if (ba_got(${m})) ba_trigger(${name});`);
        break;
      }
      case 'ba_when_serial':
        S.serialLine = true;
        S.triggers.push(`if (ba_serial_got) ba_trigger(${name});`);
        break;
      case 'ba_when_stepper_done': {
        const s = stepper(hatBlock.getFieldValue('ID'));
        glob(s + '_was', `bool ${s}_was_moving = false;`);
        S.triggers.push(`{ bool m = ${s}.distanceToGo() != 0; if (${s}_was_moving && !m) ba_trigger(${name}); ${s}_was_moving = m; }`);
        break;
      }
    }
    if (hatBlock.data === 'ignore') ignore = 1;
    S.tasks.push({ name, label, ignore,
      code: `void ${name}_fn(BaTask *_ba) {  // ${label}\n${MARK_S}${hatBlock.id}${MARK_E}${gen.INDENT}BA_BEGIN();\n${gen.prefixLines(body, gen.INDENT)}${gen.INDENT}BA_END();\n}\n` });
  }

  function hatLabel(b) {
    return b.inputList.map((i) => i.fieldRow.map((f) => f.getText()).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
  }

  /* ---------------- assemble ---------------- */
  function workspaceToSketch(ws, opts = {}) {
    reset(ws, opts);
    gen.init(ws);
    ensureCustomGenerators(opts.customBlocks || []);
    collectSetups(ws);

    const tops = ws.getTopBlocks(true).filter((b) => b.isEnabled());
    const topCode = [], setupCode = [];
    let idx = 0;
    for (const t of tops) {
      if (HATS.includes(t.type)) buildTask(t, ++idx);
      else if (t.type === 'ba_cpp_top') topCode.push(MARK_S + t.id + MARK_E + t.getFieldValue('CODE'));
      else if (t.type === 'ba_cpp_setup') setupCode.push(MARK_S + t.id + MARK_E + t.getFieldValue('CODE'));
    }

    /* hardware objects */
    for (const [name, bt] of S.buttons) glob(name, `BaButton ${name}(${pinC(bt.pin)}, ${bt.wiring});`);
    if (S.steppers.size) {
      inc('<AccelStepper.h>'); S.libraries.add(LIBS.AccelStepper);
      for (const [id, st] of S.steppers) {
        const p = st.pins.map(pinC);
        glob('stepper' + id, st.kind === 'driver'
          ? `AccelStepper stepper${id}(AccelStepper::DRIVER, ${p[0]}, ${p[1]});`
          : `AccelStepper stepper${id}(AccelStepper::HALF4WIRE, ${p[0]}, ${p[2]}, ${p[1]}, ${p[3]});  // IN1, IN3, IN2, IN4`);
        setup('stepper' + id, `stepper${id}.setMaxSpeed(${st.speed});\nstepper${id}.setAcceleration(${st.speed});`);
        bg('stepper' + id, `stepper${id}.run();`);
      }
    }
    if (S.neo) {
      const n = S.neo;
      if (n.conn === 'i2c') {
        inc('<seesaw_neopixel.h>'); S.libraries.add(LIBS.Seesaw);
        glob('strip', `seesaw_NeoPixel strip(${n.count}, 15, NEO_GRB + NEO_KHZ800);  // NeoDriver: data on seesaw pin 15`);
        setup('strip', 'strip.begin(0x60);\nstrip.setBrightness(50);\nstrip.show();');
      } else {
        inc('<Adafruit_NeoPixel.h>'); S.libraries.add(LIBS.NeoPixel);
        glob('strip', `Adafruit_NeoPixel strip(${n.count}, ${pinC(n.pin)}, NEO_GRB + NEO_KHZ800);`);
        setup('strip', 'strip.begin();\nstrip.setBrightness(50);\nstrip.show();');
      }
      glob('strip_dirty', 'bool ba_strip_dirty = false;');
      helper('neo_fill', 'void ba_neo_fill(uint8_t r, uint8_t g, uint8_t b) {\n  for (uint16_t i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, r, g, b);\n}');
      helper('neo_rainbow', [
        'uint16_t ba_hue = 0;',
        'void ba_neo_rainbow(int shift) {',
        '  ba_hue += shift * 256;',
        '  uint16_t n = strip.numPixels();',
        '  for (uint16_t i = 0; i < n; i++) {',
        '    uint16_t h = ba_hue + (uint32_t)i * 65536UL / n;',
        '    uint8_t region = h / 10923, rem = (h - region * 10923) * 255UL / 10923;',
        '    uint8_t up = rem, down = 255 - rem, r, g, b;',
        '    switch (region) {',
        '      case 0: r = 255; g = up; b = 0; break;   case 1: r = down; g = 255; b = 0; break;',
        '      case 2: r = 0; g = 255; b = up; break;   case 3: r = 0; g = down; b = 255; break;',
        '      case 4: r = up; g = 0; b = 255; break;   default: r = 255; g = 0; b = down; break;',
        '    }',
        '    strip.setPixelColor(i, r, g, b);',
        '  }',
        '}'].join('\n'));
      bg('strip', 'if (ba_strip_dirty) { ba_strip_dirty = false; strip.show(); }  // auto show at the end of each step');
      S.stopHooks.set('strip', 'strip.clear();\n  strip.show();');
    }
    if (S.lcd) {
      const l = S.lcd;
      inc('<Wire.h>'); inc('<LiquidCrystal_I2C.h>'); S.libraries.add(LIBS.LCD);
      if (l.addr === 'auto') {
        glob('lcd', `LiquidCrystal_I2C lcd_27(0x27, ${l.cols}, ${l.rows});\nLiquidCrystal_I2C lcd_3f(0x3F, ${l.cols}, ${l.rows});\nLiquidCrystal_I2C *lcd = &lcd_27;`);
        helper('find_lcd', 'LiquidCrystal_I2C *ba_find_lcd() {  // auto-detect the LCD address\n  Wire.begin();\n  Wire.beginTransmission(0x3F);\n  if (Wire.endTransmission() == 0) return &lcd_3f;\n  return &lcd_27;\n}');
        setup('lcd', 'lcd = ba_find_lcd();\nlcd->init();\nlcd->backlight();');
      } else {
        glob('lcd', `LiquidCrystal_I2C lcd_obj(${l.addr}, ${l.cols}, ${l.rows});\nLiquidCrystal_I2C *lcd = &lcd_obj;`);
        setup('lcd', 'lcd->init();\nlcd->backlight();');
      }
    }

    /* variables */
    const varDecls = [];
    for (const vm of ws.getAllVariables()) {
      const nm = gen.getVariableName(vm.getId());
      varDecls.push(S.varTypes.get(vm.getId()) === 'String' ? `String ${nm} = "";` : `float ${nm} = 0;`);
    }

    /* messages */
    const msgDecls = [...S.messages.entries()].map(([k, i]) => `const uint8_t MSG_${ident(k)} = ${i};  // "${k}"`);

    /* assemble */
    const L = [];
    L.push('// Generated by Block Arduino — edit the blocks, not this file.');
    L.push(`// Board: ${opts.board ? opts.board.name : 'Arduino Uno'}`);
    L.push('#include <BlockArduino.h>');
    for (const i of S.includes) L.push(`#include ${i}`);
    for (const [k, g] of S.globals) if (k.startsWith('cinc_')) L.push(g);
    L.push('');
    if (topCode.length) { L.push(...topCode); L.push(''); }
    const decls = [...msgDecls, ...varDecls, ...[...S.globals].filter(([k]) => !k.startsWith('cinc_')).map(([, g]) => g)];
    if (decls.length) { L.push(...decls); L.push(''); }
    for (const t of S.tasks) L.push(`void ${t.name}_fn(BaTask *_ba);`);
    for (const t of S.tasks) L.push(`BaTask ${t.name}(${t.name}_fn${t.ignore ? ', 1' : ''});`);
    if (S.tasks.length) L.push('');
    for (const h of S.helpers.values()) { L.push(h); L.push(''); }
    if (S.stopHooks.size) {
      L.push('void ba_on_stop_all() {  // "stop all" releases servos and turns off pixels');
      for (const h of S.stopHooks.values()) L.push('  ' + h);
      L.push('}');
      L.push('');
    }
    for (const t of S.tasks) { L.push(t.code); }

    L.push('void setup() {');
    L.push(`  ba_begin(${opts.handshake === false ? 'false' : 'true'});`);
    for (const s of S.setups.values()) L.push(gen.prefixLines(s, '  ').replace(/\n$/, ''));
    for (const s of setupCode) L.push(gen.prefixLines(s, '  ').replace(/\n$/, ''));
    for (const t of S.startTasks) L.push(`  ba_start(${t});`);
    L.push('}');
    L.push('');
    L.push('void loop() {');
    L.push('  ba_poll();');
    if (S.serialLine) L.push('  bool ba_serial_got = ba_serial_poll();');
    for (const t of S.triggers) L.push('  ' + t);
    L.push('  ba_step_all();');
    for (const b of S.background.values()) L.push('  ' + b);
    if (!S.serialLine) L.push('  (void)0;');
    L.push('}');

    let code = L.join('\n') + '\n';
    code = code.replace(/@@RECV_(MSG_[A-Za-z0-9_]+)@@/g, (m, msg) => {
      const r = S.receivers.get(msg) || [];
      return r.length ? r.map((t) => `!${t}.running`).join(' && ') : 'true';
    });
    code = code.replace(/^\s*\(void\)0;\n/m, '');

    /* strip markers -> source map (line number -> block id) */
    const lines = code.split('\n');
    const sourceMap = {};
    const re = new RegExp(MARK_S + '([^' + MARK_E + ']*)' + MARK_E, 'g');
    let current = null;
    const clean = lines.map((ln, i) => {
      let m; let found = null;
      while ((m = re.exec(ln))) found = m[1];
      if (found) current = found;
      const stripped = ln.replace(re, '');
      if (found || (current && /\S/.test(stripped) && !/^\s*[}]/.test(stripped))) sourceMap[i + 1] = found || current;
      if (/^}/.test(stripped) || /^void (setup|loop)\(/.test(stripped)) current = null;
      return stripped;
    });
    code = clean.join('\n');

    /* RAM / task count warnings */
    if (S.tasks.length > 24) S.warnings.push({ msg: `This project has ${S.tasks.length} scripts. More than 24 may run out of memory on an Uno.` });
    if (S.neo && opts.board && opts.board.ramBytes <= 2560 && S.neo.count * 3 > opts.board.ramBytes * 0.5) {
      S.warnings.push({ msg: `${S.neo.count} NeoPixels use ${S.neo.count * 3} bytes — over half of this board's RAM.` });
    }

    return { code, sourceMap, libraries: [...S.libraries], warnings: S.warnings, taskCount: S.tasks.length };
  }

  /* Variable names: prefix to avoid clashing with Arduino names. */
  const origGetVariableName = gen.getVariableName.bind(gen);
  gen.getVariableName = function (id) { return 'v_' + origGetVariableName(id); };

  const api = { workspaceToSketch, HATS, generator: gen };
  if (isNode) module.exports = api; else window.BA_GENERATOR = api;
})();
