// Generates every starter project to test/out/<id>/<id>.ino (used by the C++ simulation test).
const fs = require('fs'), path = require('path');
const Blockly = require('blockly');
require('../src/renderer/blocks.js');
const { workspaceToSketch } = require('../src/renderer/generator.js');
const STARTERS = require('../src/renderer/starters.js');
const BOARDS = require('../src/shared/boards.js');
let fail = 0;
for (const s of STARTERS) {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load(s.workspace, ws);
  const out = workspaceToSketch(ws, { board: BOARDS.byId(s.board) });
  const dir = path.join(__dirname, 'out', s.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, s.id + '.ino'), out.code);
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(out.sourceMap));
  const mapped = Object.keys(out.sourceMap).length;
  console.log(`${s.id.padEnd(14)} tasks=${out.taskCount} libs=[${out.libraries.join(', ')}] mappedLines=${mapped} warnings=${out.warnings.length}`);
  if (!out.taskCount || !mapped) fail++;
}
process.exit(fail);
