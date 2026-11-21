// Unit tests: Smart Upload error classification, board ranking, custom blocks.
const assert = require('assert');
const Blockly = require('blockly');
require('../src/renderer/blocks.js');
const CUSTOM = require('../src/renderer/custom-blocks.js');
const { workspaceToSketch } = require('../src/renderer/generator.js');
const SU = require('../src/main/smart-upload.js');
const B = require('../src/shared/boards.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('no-sync on Nano -> try other bootloader', () => assert.equal(SU.classifyError('stk500_getsync() attempt 10 of 10: not in sync: resp=0x00', B.byId('nano')).kind, 'no_sync'));
t('signature mismatch -> switch board', () => { const e = SU.classifyError('Device signature = 0x1e9801', B.byId('uno')); assert.equal(e.kind, 'wrong_board'); assert.equal(e.board, 'mega'); });
t('busy port', () => assert.equal(SU.classifyError('Access is denied', B.byId('uno')).kind, 'port_busy'));
t('leonardo port hop', () => assert.equal(SU.classifyError('No device found on COM7', B.byId('leonardo')).kind, 'port_hop'));
t('esp32 boot mode', () => assert.equal(SU.classifyError('Failed to connect to ESP32: Wrong boot mode', B.byId('esp32')).kind, 'esp_boot'));
t('dead bootloader', () => assert.equal(SU.classifyError('Device signature = 0x000000', B.byId('uno')).kind, 'no_bootloader'));
t('ranking: exact USB first', () => assert.deepEqual(SU.rankBoards({ vidpid: '2341:0042' }, 'uno', {}).slice(0, 2), ['mega', 'uno']));
t('ranking: clone uses project board then profile', () => assert.deepEqual(SU.rankBoards({ vidpid: '1a86:7523', serial: 'S' }, 'uno', { S: 'nano_old' }).slice(0, 2), ['uno', 'nano_old']));

t('custom block validates and generates', () => {
  const defs = CUSTOM.register([{ ...CUSTOM.EXAMPLE }, {
    id: 'slow_blink', shape: 'statement', label: 'slow blink pin %PIN', inputs: { PIN: { type: 'pin', default: 13 } },
    setup: 'pinMode({{PIN}}, OUTPUT);', code: 'digitalWrite({{PIN}}, HIGH);\n{{WAIT_MS:300}}\ndigitalWrite({{PIN}}, LOW);', yields: true,
  }]);
  for (const d of defs) assert.deepEqual(CUSTOM.validate(d), []);
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [{ type: 'ba_when_start', x: 0, y: 0,
    next: { block: { type: 'custom_buzzer_beep', inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 150 } } } },
      next: { block: { type: 'custom_slow_blink' } } } } }] } }, ws);
  const out = workspaceToSketch(ws, { board: B.byId('uno'), customBlocks: defs });
  assert.match(out.code, /tone\(8, 1000, 150\);/);
  assert.match(out.code, /pinMode\(8, OUTPUT\);/);
  assert.match(out.code, /\n\s*BA_WAIT_MS\(300\);\n/);
});
t('validation catches label/input mismatch', () => assert.ok(CUSTOM.validate({ id: 'x', label: 'go %A', inputs: {}, code: '' }).length));
t('delay() in C++ block warns', () => {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [{ type: 'ba_when_start', next: { block: { type: 'ba_cpp_code', fields: { CODE: 'delay(500);' } } } }] } }, ws);
  assert.ok(workspaceToSketch(ws, { board: B.byId('uno') }).warnings.some((w) => /delay/.test(w.msg)));
});
console.log(`${n} tests passed`);
