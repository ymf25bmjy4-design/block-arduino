/* Custom block definitions (Level 2): JSON -> Blockly block + toolbox entry.
 * Format (same as the design doc / Custom Blocks Guide):
 * { id, category, shape: statement|value|boolean, label: "beep on pin %PIN for %MS ms",
 *   inputs: { PIN: {type:'pin', default:8, filter:'digital'}, MS: {type:'number', default:200} },
 *   include, global, setup, code, yields, libraries: [] } */
(function () {
  const isNode = typeof window === 'undefined';
  const Blockly = isNode ? require('blockly') : window.Blockly;
  const BA = isNode ? require('./blocks.js') : window.BA_BLOCKS;

  const INPUT_TYPES = ['number', 'text', 'pin', 'dropdown', 'colour', 'boolean', 'statements'];

  function validate(def) {
    const errs = [];
    if (!def.id || !/^[a-z][a-z0-9_]*$/i.test(def.id)) errs.push('Block id must start with a letter and use letters, numbers or _.');
    if (!def.label || !def.label.trim()) errs.push('The block needs a label.');
    const tokens = [...String(def.label || '').matchAll(/%([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    for (const t of tokens) if (!(def.inputs || {})[t]) errs.push(`The label uses %${t} but there is no input called ${t}.`);
    for (const [name, inp] of Object.entries(def.inputs || {})) {
      if (!INPUT_TYPES.includes(inp.type)) errs.push(`Input ${name} has an unknown type "${inp.type}".`);
      if (!tokens.includes(name)) errs.push(`Input ${name} is not used in the label (add %${name}).`);
    }
    if (!def.code && def.shape !== 'statement') errs.push('Value blocks need a code template.');
    return errs;
  }

  function toBlockJson(def) {
    const args = [];
    let i = 0;
    const message = String(def.label).replace(/%([A-Za-z0-9_]+)/g, (m, name) => {
      const inp = def.inputs[name];
      if (!inp) return m;
      i++;
      switch (inp.type) {
        case 'pin': args.push({ type: 'field_ba_pin', name, kind: inp.filter || 'digital', value: String(inp.default ?? '2') }); break;
        case 'dropdown': args.push({ type: 'field_dropdown', name,
          options: (inp.options || ['A']).map((o) => (Array.isArray(o) ? o : [String(o), String(o)])) }); break;
        case 'colour': args.push({ type: 'field_ba_colour', name, colour: inp.default || '#ff0000' }); break;
        case 'boolean': args.push({ type: 'input_value', name, check: 'Boolean' }); break;
        case 'statements': args.push({ type: 'input_statement', name }); break;
        case 'text': args.push({ type: 'input_value', name }); break;
        default: args.push({ type: 'input_value', name, check: 'Number' });
      }
      return '%' + i;
    });
    const json = {
      type: 'custom_' + def.id, message0: message, args0: args,
      colour: def.colour || BA.COLOURS.custom, tooltip: def.tooltip || 'Custom block', inputsInline: true,
    };
    if (def.shape === 'value') json.output = def.output || null;
    else if (def.shape === 'boolean') json.output = 'Boolean';
    else { json.previousStatement = null; json.nextStatement = null; }
    return json;
  }

  function toolboxItem(def) {
    const inputs = {};
    for (const [name, inp] of Object.entries(def.inputs || {})) {
      if (inp.type === 'number') inputs[name] = { shadow: { type: 'math_number', fields: { NUM: Number(inp.default ?? 0) } } };
      if (inp.type === 'text') inputs[name] = { shadow: { type: 'text', fields: { TEXT: String(inp.default ?? '') } } };
    }
    return { kind: 'block', type: 'custom_' + def.id, inputs };
  }

  function register(defs) {
    for (const def of defs) {
      const json = toBlockJson(def);
      Blockly.Blocks[json.type] = { init() { this.jsonInit(json); } };
      def.toolboxItem = toolboxItem(def);
    }
    return defs;
  }

  const EXAMPLE = {
    id: 'buzzer_beep', category: 'Custom', shape: 'statement',
    label: 'beep buzzer on pin %PIN for %MS ms',
    inputs: { PIN: { type: 'pin', default: 8, filter: 'digital' }, MS: { type: 'number', default: 200, min: 1 } },
    setup: 'pinMode({{PIN}}, OUTPUT);', code: 'tone({{PIN}}, 1000, {{MS}});', yields: false,
  };

  const api = { validate, toBlockJson, toolboxItem, register, INPUT_TYPES, EXAMPLE };
  if (isNode) module.exports = api; else window.BA_CUSTOM = api;
})();
