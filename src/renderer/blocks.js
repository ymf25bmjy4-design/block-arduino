/* Block definitions and toolbox for Block Arduino.
 * Loaded as a plain script in the renderer (globals Blockly, BA_BOARDS) and
 * via require() in tests. */
(function () {
  const isNode = typeof window === 'undefined';
  const Blockly = isNode ? require('blockly') : window.Blockly;
  const BOARDS = isNode ? require('../shared/boards.js') : window.BA_BOARDS;

  /* ---------------- current board (drives pin dropdowns) ---------------- */
  const state = { board: BOARDS.byId('uno') };
  function setBoard(id) { state.board = BOARDS.byId(id); }
  function getBoard() { return state.board; }

  function pinOptions(kind) {
    const p = state.board.pins;
    let list;
    switch (kind) {
      case 'analog': list = p.analog; break;
      case 'pwm': list = p.pwm; break;
      case 'any': list = [...p.digital, ...p.analog.filter((a) => !p.digital.includes(a))]; break;
      default: list = [...p.digital, ...p.analog.filter((a) => typeof a === 'string' && !p.analogOnly.includes(a))];
    }
    return list.map((v) => [String(v), String(v)]);
  }

  /* A dropdown whose options follow the selected board, but which accepts
   * any saved value so projects load even after switching boards. */
  class FieldBaPin extends Blockly.FieldDropdown {
    constructor(kind, value) {
      /* Blockly calls the generator with `this` bound to the field. */
      super(function () {
        const opts = pinOptions(kind);
        const cur = this && this.value_ != null ? String(this.value_) : null;
        if (cur && !opts.some((o) => o[1] === cur)) opts.unshift([cur + ' ⚠', cur]);
        return opts;
      });
      this.pinKind = kind;
      if (value !== undefined) this.setValue(String(value));
    }
    doClassValidation_(v) { return v === null || v === undefined ? null : String(v); }
    getText_() { return String(this.getValue()); }
    static fromJson(o) { return new FieldBaPin(o.kind || 'digital', o.value); }
  }
  if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, 'field_ba_pin')) {
    Blockly.fieldRegistry.register('field_ba_pin', FieldBaPin);
  }

  /* Colour picker as a dropdown of swatches (Blockly 11 moved field_colour
   * to a plugin). Accepts any saved hex value. */
  const SWATCHES = [
    ['red', '#ff0000'], ['orange', '#ff8000'], ['yellow', '#ffff00'], ['green', '#00ff00'],
    ['cyan', '#00ffff'], ['blue', '#0000ff'], ['purple', '#8000ff'], ['pink', '#ff40a0'],
    ['warm white', '#ffb347'], ['white', '#ffffff'], ['off', '#000000'],
  ];
  const swatch = (hex, alt) => ({
    src: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="9" fill="${hex}" stroke="#555" stroke-width="1.5"/></svg>`),
    width: 22, height: 22, alt: alt || hex,
  });
  class FieldBaColour extends Blockly.FieldDropdown {
    constructor(value) {
      super(function () {
        const opts = SWATCHES.map(([n, h]) => [swatch(h, n), h]);
        const cur = this && this.value_ != null ? String(this.value_).toLowerCase() : null;
        if (cur && !opts.some((o) => o[1] === cur)) opts.unshift([swatch(cur), cur]);
        return opts;
      });
      if (value) this.setValue(String(value).toLowerCase());
    }
    doClassValidation_(v) { return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : null; }
    static fromJson(o) { return new FieldBaColour(o.colour || '#ff0000'); }
  }
  if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, 'field_ba_colour')) {
    Blockly.fieldRegistry.register('field_ba_colour', FieldBaColour);
  }

  /* C++ code field: shows a one-line summary on the block and opens a
   * full code editor dialog (window.BA_CODE_EDITOR) when clicked. */
  class FieldBaCode extends Blockly.FieldTextInput {
    getText_() {
      const lines = String(this.getValue() || '').split('\n');
      let t = lines[0];
      if (lines.length > 1) t += `  …(+${lines.length - 1} lines)`;
      return t.length > 52 ? t.slice(0, 51) + '…' : t;
    }
    showEditor_(e, quiet) {
      if (!isNode && window.BA_CODE_EDITOR) window.BA_CODE_EDITOR(String(this.getValue() || ''), (v) => this.setValue(v));
      else super.showEditor_(e, quiet);
    }
    static fromJson(o) { return new FieldBaCode(o.text || ''); }
  }
  if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, 'field_ba_code')) {
    Blockly.fieldRegistry.register('field_ba_code', FieldBaCode);
  }

  /* Hat blocks get the Scratch-style rounded cap. */
  if (!Blockly.Extensions.isRegistered('ba_hat')) {
    Blockly.Extensions.register('ba_hat', function () { this.hat = 'cap'; });
  }

  const C = {
    events: '#FFBF00', pins: '#4C97FF', switches: '#0FBDA8', servos: '#FF8C1A',
    steppers: '#D65C1A', neopixels: '#FF6699', lcd: '#2E9E5B', control: '#FFAB19',
    operators: '#59C059', variables: '#FF5C5C', serial: '#8C8C99', custom: '#B8B8C8',
  };

  const pin = (name, kind, value) => ({ type: 'field_ba_pin', name, kind, value });
  const num = (name) => ({ type: 'input_value', name, check: 'Number' });
  const txt = (name) => ({ type: 'input_value', name });
  const bool = (name) => ({ type: 'input_value', name, check: 'Boolean' });
  const dd = (name, options) => ({ type: 'field_dropdown', name, options });
  const stmt = (name) => ({ type: 'input_statement', name });
  const stepperId = dd('ID', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]);

  const hat = (o) => ({ ...o, nextStatement: null, extensions: ['ba_hat'] });
  const cmd = (o) => ({ previousStatement: null, nextStatement: null, ...o });
  const rep = (o) => ({ output: 'Number', ...o });
  const pred = (o) => ({ output: 'Boolean', ...o });

  const DEFS = [
    /* ---------------- Events ---------------- */
    hat({ type: 'ba_when_start', message0: 'when board starts', colour: C.events,
      tooltip: 'Runs once after power-on or reset.' }),
    hat({ type: 'ba_forever_hat', message0: 'forever', colour: C.events,
      tooltip: 'Repeats the blocks below as fast as possible. Waits inside never freeze other scripts.' }),
    hat({ type: 'ba_every', message0: 'every %1 ms', colour: C.events,
      args0: [{ type: 'field_number', name: 'MS', value: 500, min: 1 }],
      tooltip: 'Runs on a fixed timer. Skips a tick if the script is still running.' }),
    hat({ type: 'ba_when_button', message0: 'when button %1 is %2', colour: C.events,
      args0: [pin('PIN', 'digital', '2'), dd('EVENT', [['pressed', 'pressed'], ['released', 'released'], ['held 1 s', 'held']])],
      tooltip: 'Debounced switch event (20 ms). Uses the internal pull-up by default.' }),
    hat({ type: 'ba_when_pin', message0: 'when pin %1 goes %2', colour: C.events,
      args0: [pin('PIN', 'digital', '3'), dd('EDGE', [['HIGH', 'rose'], ['LOW', 'fell'], ['changes', 'changed']])],
      tooltip: 'Digital edge on a pin.' }),
    hat({ type: 'ba_when_analog', message0: 'when analog %1 goes %2 %3', colour: C.events,
      args0: [pin('PIN', 'analog', 'A0'), dd('DIR', [['above', 'above'], ['below', 'below']]),
        { type: 'field_number', name: 'LEVEL', value: 512, min: 0, max: 4095 }],
      tooltip: 'Threshold crossed, with 10 counts of hysteresis to stop flicker.' }),
    hat({ type: 'ba_when_receive', message0: 'when I receive %1', colour: C.events,
      args0: [{ type: 'field_input', name: 'MSG', text: 'message1' }],
      tooltip: 'Runs when another script broadcasts this message.' }),
    hat({ type: 'ba_when_serial', message0: 'when serial receives a line', colour: C.events,
      tooltip: 'Runs when a full line arrives over USB. Use the "serial line" block to read it.' }),
    hat({ type: 'ba_when_stepper_done', message0: 'when stepper %1 finishes moving', colour: C.events,
      args0: [stepperId], tooltip: 'Runs when a stepper reaches its target.' }),
    cmd({ type: 'ba_broadcast', message0: 'broadcast %1 %2', colour: C.events,
      args0: [{ type: 'field_input', name: 'MSG', text: 'message1' }, dd('WAIT', [['', 'no'], ['and wait', 'wait']])],
      tooltip: 'Starts every "when I receive" script for this message.' }),
    { type: 'ba_stop', message0: 'stop %1', colour: C.events, previousStatement: null,
      args0: [dd('WHAT', [['all scripts', 'all'], ['this script', 'this']])],
      tooltip: '"All" halts every script, releases servos and turns off NeoPixels.' },

    /* ---------------- Pins ---------------- */
    pred({ type: 'ba_digital_read', message0: 'digital read pin %1', colour: C.pins,
      args0: [pin('PIN', 'digital', '2')], tooltip: 'True if the pin is HIGH.' }),
    rep({ type: 'ba_analog_read', message0: 'analog read pin %1', colour: C.pins,
      args0: [pin('PIN', 'analog', 'A0')], tooltip: 'A number from 0 to 1023 (0 to 4095 on ESP32).' }),
    cmd({ type: 'ba_digital_write', message0: 'set pin %1 to %2', colour: C.pins,
      args0: [pin('PIN', 'digital', '13'), dd('STATE', [['ON', 'HIGH'], ['OFF', 'LOW']])] }),
    cmd({ type: 'ba_toggle_pin', message0: 'toggle pin %1', colour: C.pins, args0: [pin('PIN', 'digital', '13')] }),
    cmd({ type: 'ba_pwm_write', message0: 'set PWM pin %1 to %2', colour: C.pins, inputsInline: true,
      args0: [pin('PIN', 'pwm', '9'), num('VALUE')], tooltip: 'Dim an LED or set motor speed (0–255).' }),
    cmd({ type: 'ba_pwm_percent', message0: 'set PWM pin %1 to %2 %%', colour: C.pins, inputsInline: true,
      args0: [pin('PIN', 'pwm', '9'), num('VALUE')], tooltip: 'Same as PWM write, as a percentage.' }),
    cmd({ type: 'ba_pin_mode', message0: 'set pin %1 mode %2', colour: C.pins,
      args0: [pin('PIN', 'digital', '2'), dd('MODE', [['input pull-up', 'INPUT_PULLUP'], ['input', 'INPUT'], ['output', 'OUTPUT']])],
      tooltip: 'Rarely needed: pin modes are set automatically.' }),

    /* ---------------- Switches ---------------- */
    cmd({ type: 'ba_button_setup', message0: 'set up switch on %1 wired to %2', colour: C.switches,
      args0: [pin('PIN', 'digital', '2'), dd('WIRING', [['GND', 'BA_ACTIVE_LOW'], ['5V', 'BA_ACTIVE_HIGH']])],
      tooltip: 'GND uses the internal pull-up (pressed = LOW). 5V needs a pull-down resistor.' }),
    pred({ type: 'ba_button_pressed', message0: 'button %1 is pressed?', colour: C.switches,
      args0: [pin('PIN', 'digital', '2')], tooltip: 'True while the button is held down.' }),
    rep({ type: 'ba_button_count', message0: 'button %1 press count', colour: C.switches,
      args0: [pin('PIN', 'digital', '2')] }),
    cmd({ type: 'ba_button_reset', message0: 'reset button %1 count', colour: C.switches,
      args0: [pin('PIN', 'digital', '2')] }),

    /* ---------------- Servos ---------------- */
    cmd({ type: 'ba_servo_write', message0: 'set servo %1 to %2 °', colour: C.servos, inputsInline: true,
      args0: [pin('PIN', 'pwm', '9'), num('ANGLE')], tooltip: 'Move now (0–180°). Servos start at 90°.' }),
    cmd({ type: 'ba_servo_sweep', message0: 'sweep servo %1 to %2 ° over %3 s', colour: C.servos, inputsInline: true,
      args0: [pin('PIN', 'pwm', '9'), num('ANGLE'), num('SECS')], tooltip: 'Smooth move that runs in the background.' }),
    rep({ type: 'ba_servo_read', message0: 'servo %1 angle', colour: C.servos, args0: [pin('PIN', 'pwm', '9')] }),
    cmd({ type: 'ba_servo_detach', message0: 'release servo %1', colour: C.servos, args0: [pin('PIN', 'pwm', '9')],
      tooltip: 'Stops holding position.' }),

    /* ---------------- Stepper motors ---------------- */
    cmd({ type: 'ba_stepper_setup_4wire', message0: 'set up stepper %1 as 28BYJ-48 on pins %2 %3 %4 %5', colour: C.steppers,
      args0: [stepperId, pin('P1', 'digital', '8'), pin('P2', 'digital', '9'), pin('P3', 'digital', '10'), pin('P4', 'digital', '11')],
      tooltip: '28BYJ-48 motor with a ULN2003 board (IN1–IN4). 4096 half-steps per turn.' }),
    cmd({ type: 'ba_stepper_setup_driver', message0: 'set up stepper %1 as step/dir step %2 dir %3', colour: C.steppers,
      args0: [stepperId, pin('STEP', 'digital', '3'), pin('DIR', 'digital', '4')], tooltip: 'For A4988 / DRV8825 drivers.' }),
    cmd({ type: 'ba_stepper_speed', message0: 'set stepper %1 speed %2 steps/s', colour: C.steppers, inputsInline: true,
      args0: [stepperId, num('SPEED')], tooltip: 'Maximum speed; acceleration is set to match.' }),
    cmd({ type: 'ba_stepper_move', message0: 'move stepper %1 by %2 steps %3', colour: C.steppers, inputsInline: true,
      args0: [stepperId, num('STEPS'), dd('WAIT', [['', 'no'], ['and wait', 'wait']])],
      tooltip: 'Relative move. "and wait" pauses this script only.' }),
    cmd({ type: 'ba_stepper_moveto', message0: 'move stepper %1 to position %2 %3', colour: C.steppers, inputsInline: true,
      args0: [stepperId, num('POS'), dd('WAIT', [['', 'no'], ['and wait', 'wait']])] }),
    cmd({ type: 'ba_stepper_stop', message0: 'stop stepper %1', colour: C.steppers, args0: [stepperId],
      tooltip: 'Decelerate to a stop.' }),
    rep({ type: 'ba_stepper_position', message0: 'stepper %1 position', colour: C.steppers, args0: [stepperId] }),

    /* ---------------- NeoPixels ---------------- */
    cmd({ type: 'ba_neo_setup', message0: 'set up %1 NeoPixels on %2 pin %3', colour: C.neopixels,
      args0: [{ type: 'field_number', name: 'COUNT', value: 8, min: 1, max: 500 },
        dd('CONN', [['data pin', 'pin'], ['I2C driver 0x60', 'i2c']]), pin('PIN', 'digital', '6')],
      tooltip: 'Data pin: ordinary WS2812B strips. I2C driver: Adafruit NeoDriver (seesaw) at 0x60; its pin is ignored.' }),
    cmd({ type: 'ba_neo_pixel', message0: 'set pixel %1 to %2', colour: C.neopixels, inputsInline: true,
      args0: [num('INDEX'), { type: 'field_ba_colour', name: 'COLOUR', colour: '#ff0000' }] }),
    cmd({ type: 'ba_neo_pixel_rgb', message0: 'set pixel %1 to red %2 green %3 blue %4', colour: C.neopixels, inputsInline: true,
      args0: [num('INDEX'), num('R'), num('G'), num('B')] }),
    cmd({ type: 'ba_neo_fill', message0: 'fill all pixels with %1', colour: C.neopixels,
      args0: [{ type: 'field_ba_colour', name: 'COLOUR', colour: '#0000ff' }] }),
    cmd({ type: 'ba_neo_rainbow', message0: 'rainbow, shift by %1', colour: C.neopixels, inputsInline: true, args0: [num('SHIFT')] }),
    cmd({ type: 'ba_neo_brightness', message0: 'set brightness %1', colour: C.neopixels, inputsInline: true,
      args0: [num('LEVEL')], tooltip: '0–255' }),
    cmd({ type: 'ba_neo_clear', message0: 'clear pixels', colour: C.neopixels }),
    cmd({ type: 'ba_neo_show', message0: 'show pixels now', colour: C.neopixels,
      tooltip: 'Pixels update automatically at the end of each step; use this to push changes immediately.' }),

    /* ---------------- LCD ---------------- */
    cmd({ type: 'ba_lcd_setup', message0: 'set up LCD %1 at %2 address', colour: C.lcd,
      args0: [dd('SIZE', [['16×2', '16x2'], ['20×4', '20x4']]), dd('ADDR', [['auto', 'auto'], ['0x27', '0x27'], ['0x3F', '0x3F']])],
      tooltip: 'I2C LCD (LiquidCrystal_I2C). "auto" scans 0x27 and 0x3F.' }),
    cmd({ type: 'ba_lcd_print_at', message0: 'LCD print %1 at row %2 column %3', colour: C.lcd, inputsInline: true,
      args0: [txt('TEXT'), num('ROW'), num('COL')], tooltip: 'Rows and columns start at 1.' }),
    cmd({ type: 'ba_lcd_print_line', message0: 'LCD print line %1 %2', colour: C.lcd, inputsInline: true,
      args0: [num('ROW'), txt('TEXT')], tooltip: 'Replaces a whole row, padding with spaces.' }),
    cmd({ type: 'ba_lcd_clear', message0: 'clear LCD', colour: C.lcd }),
    cmd({ type: 'ba_lcd_backlight', message0: 'LCD backlight %1', colour: C.lcd, args0: [dd('STATE', [['on', 'on'], ['off', 'off']])] }),
    cmd({ type: 'ba_lcd_scroll', message0: 'scroll LCD %1', colour: C.lcd, args0: [dd('DIR', [['left', 'Left'], ['right', 'Right']])] }),

    /* ---------------- Control ---------------- */
    cmd({ type: 'ba_wait', message0: 'wait %1 seconds', colour: C.control, inputsInline: true, args0: [num('SECS')],
      tooltip: 'Pauses this script only. Other scripts keep running.' }),
    cmd({ type: 'ba_wait_ms', message0: 'wait %1 ms', colour: C.control, inputsInline: true, args0: [num('MS')] }),
    cmd({ type: 'ba_wait_until', message0: 'wait until %1', colour: C.control, args0: [bool('COND')] }),
    cmd({ type: 'ba_repeat', message0: 'repeat %1', message1: '%1', colour: C.control, inputsInline: true,
      args0: [num('TIMES')], args1: [stmt('DO')] }),
    cmd({ type: 'ba_repeat_until', message0: 'repeat until %1', message1: '%1', colour: C.control,
      args0: [bool('COND')], args1: [stmt('DO')] }),
    { type: 'ba_forever', message0: 'forever', message1: '%1', colour: C.control, previousStatement: null,
      args1: [stmt('DO')] },
    cmd({ type: 'ba_if', message0: 'if %1 then', message1: '%1', colour: C.control, args0: [bool('COND')], args1: [stmt('DO')] }),
    cmd({ type: 'ba_if_else', message0: 'if %1 then', message1: '%1', message2: 'else', message3: '%1', colour: C.control,
      args0: [bool('COND')], args1: [stmt('DO')], args3: [stmt('ELSE')] }),

    /* ---------------- Operators ---------------- */
    rep({ type: 'ba_arith', message0: '%1 %2 %3', colour: C.operators, inputsInline: true,
      args0: [num('A'), dd('OP', [['+', '+'], ['−', '-'], ['×', '*'], ['÷', '/'], ['mod', '%']]), num('B')] }),
    pred({ type: 'ba_compare', message0: '%1 %2 %3', colour: C.operators, inputsInline: true,
      args0: [txt('A'), dd('OP', [['<', '<'], ['=', '=='], ['>', '>'], ['≤', '<='], ['≥', '>='], ['≠', '!=']]), txt('B')] }),
    pred({ type: 'ba_and_or', message0: '%1 %2 %3', colour: C.operators, inputsInline: true,
      args0: [bool('A'), dd('OP', [['and', '&&'], ['or', '||']]), bool('B')] }),
    pred({ type: 'ba_not', message0: 'not %1', colour: C.operators, args0: [bool('A')] }),
    pred({ type: 'ba_bool', message0: '%1', colour: C.operators, args0: [dd('V', [['true', 'true'], ['false', 'false']])] }),
    rep({ type: 'ba_random', message0: 'random %1 to %2', colour: C.operators, inputsInline: true, args0: [num('FROM'), num('TO')] }),
    rep({ type: 'ba_map', message0: 'map %1 from %2 – %3 to %4 – %5', colour: C.operators, inputsInline: true,
      args0: [num('V'), num('FL'), num('FH'), num('TL'), num('TH')], tooltip: 'Rescale a number from one range to another.' }),
    rep({ type: 'ba_constrain', message0: 'constrain %1 between %2 and %3', colour: C.operators, inputsInline: true,
      args0: [num('V'), num('LO'), num('HI')] }),
    rep({ type: 'ba_math_fn', message0: '%1 of %2', colour: C.operators, inputsInline: true,
      args0: [dd('FN', [['abs', 'abs'], ['round', 'round'], ['floor', 'floor'], ['ceiling', 'ceil'], ['sqrt', 'sqrt'], ['sin', 'sin'], ['cos', 'cos']]), num('V')] }),
    rep({ type: 'ba_millis', message0: 'milliseconds since start', colour: C.operators }),
    { type: 'ba_join', message0: 'join %1 %2', output: 'String', colour: C.operators, inputsInline: true, args0: [txt('A'), txt('B')] },

    /* ---------------- Variables / serial ---------------- */
    cmd({ type: 'ba_serial_print', message0: 'print %1 to serial', colour: C.serial, args0: [txt('V')],
      tooltip: 'Shows in the Serial tab. Numbers also appear in the Plot tab.' }),
    { type: 'ba_serial_line', message0: 'serial line', output: 'String', colour: C.serial,
      tooltip: 'The text from "when serial receives a line".' },

    /* ---------------- Custom C++ ---------------- */
    cmd({ type: 'ba_cpp_code', message0: 'C++ code %1', colour: C.custom,
      args0: [{ type: 'field_ba_code', name: 'CODE', text: 'Serial.println("hi");' }],
      tooltip: 'Statements placed here in the script. Avoid delay(): use a wait block instead.' }),
    { type: 'ba_cpp_value', message0: 'C++ value %1', output: 'Number', colour: C.custom,
      args0: [{ type: 'field_input', name: 'CODE', text: 'millis() / 1000' }] },
    { type: 'ba_cpp_condition', message0: 'C++ condition %1', output: 'Boolean', colour: C.custom,
      args0: [{ type: 'field_input', name: 'CODE', text: 'digitalRead(4) && x > 3' }] },
    { type: 'ba_cpp_top', message0: 'C++ at top of file %1', colour: C.custom,
      args0: [{ type: 'field_ba_code', name: 'CODE', text: '// #include lines, globals, helper functions' }] },
    { type: 'ba_cpp_setup', message0: 'C++ in setup %1', colour: C.custom,
      args0: [{ type: 'field_ba_code', name: 'CODE', text: '// runs once in setup()' }] },
  ];

  Blockly.common.defineBlocksWithJsonArray(DEFS);

  /* Variable "change by" block styled like the rest. */
  Blockly.common.defineBlocksWithJsonArray([
    cmd({ type: 'ba_change_var', message0: 'change %1 by %2', colour: C.variables, inputsInline: true,
      args0: [{ type: 'field_variable', name: 'VAR', variable: 'score' }, num('DELTA')] }),
  ]);

  /* Which "set up" block each hardware category auto-inserts. */
  const SETUP_FOR = {
    ba_button_pressed: 'ba_button_setup', ba_button_count: 'ba_button_setup', ba_button_reset: 'ba_button_setup',
    ba_stepper_speed: 'ba_stepper_setup_4wire', ba_stepper_move: 'ba_stepper_setup_4wire',
    ba_stepper_moveto: 'ba_stepper_setup_4wire', ba_stepper_stop: 'ba_stepper_setup_4wire',
    ba_stepper_position: 'ba_stepper_setup_4wire', ba_when_stepper_done: 'ba_stepper_setup_4wire',
    ba_neo_pixel: 'ba_neo_setup', ba_neo_pixel_rgb: 'ba_neo_setup', ba_neo_fill: 'ba_neo_setup',
    ba_neo_rainbow: 'ba_neo_setup', ba_neo_brightness: 'ba_neo_setup', ba_neo_clear: 'ba_neo_setup', ba_neo_show: 'ba_neo_setup',
    ba_lcd_print_at: 'ba_lcd_setup', ba_lcd_print_line: 'ba_lcd_setup', ba_lcd_clear: 'ba_lcd_setup',
    ba_lcd_backlight: 'ba_lcd_setup', ba_lcd_scroll: 'ba_lcd_setup',
  };
  const SETUP_TYPES = ['ba_button_setup', 'ba_stepper_setup_4wire', 'ba_stepper_setup_driver', 'ba_neo_setup', 'ba_lcd_setup'];

  /* ---------------- Toolbox ---------------- */
  const N = (v) => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
  const T = (v) => ({ shadow: { type: 'text', fields: { TEXT: v } } });
  const b = (type, inputs) => (inputs ? { kind: 'block', type, inputs } : { kind: 'block', type });

  function toolbox(customBlocks = []) {
    const cat = (name, colour, contents, extra = {}) => ({ kind: 'category', name, colour, contents, ...extra });
    const cats = [
      cat('Events', C.events, [
        b('ba_when_start'), b('ba_forever_hat'), b('ba_every'), b('ba_when_button'), b('ba_when_pin'),
        b('ba_when_analog'), b('ba_when_receive'), b('ba_broadcast'), b('ba_when_serial'), b('ba_stop'),
      ]),
      cat('Pins', C.pins, [
        b('ba_digital_write'), b('ba_toggle_pin'), b('ba_pwm_write', { VALUE: N(128) }),
        b('ba_pwm_percent', { VALUE: N(50) }), b('ba_digital_read'), b('ba_analog_read'), b('ba_pin_mode'),
      ]),
      cat('Switches', C.switches, [b('ba_button_setup'), b('ba_button_pressed'), b('ba_button_count'), b('ba_button_reset')]),
      cat('Servos', C.servos, [
        b('ba_servo_write', { ANGLE: N(90) }), b('ba_servo_sweep', { ANGLE: N(180), SECS: N(1) }),
        b('ba_servo_read'), b('ba_servo_detach'),
      ]),
      cat('Steppers', C.steppers, [
        b('ba_stepper_setup_4wire'), b('ba_stepper_setup_driver'), b('ba_stepper_speed', { SPEED: N(500) }),
        b('ba_stepper_move', { STEPS: N(2048) }), b('ba_stepper_moveto', { POS: N(0) }), b('ba_stepper_stop'),
        b('ba_when_stepper_done'), b('ba_stepper_position'),
      ]),
      cat('NeoPixels', C.neopixels, [
        b('ba_neo_setup'), b('ba_neo_pixel', { INDEX: N(0) }), b('ba_neo_pixel_rgb', { INDEX: N(0), R: N(255), G: N(0), B: N(0) }),
        b('ba_neo_fill'), b('ba_neo_rainbow', { SHIFT: N(1) }), b('ba_neo_brightness', { LEVEL: N(50) }),
        b('ba_neo_clear'), b('ba_neo_show'),
      ]),
      cat('LCD', C.lcd, [
        b('ba_lcd_setup'), b('ba_lcd_print_at', { TEXT: T('Hello'), ROW: N(1), COL: N(1) }),
        b('ba_lcd_print_line', { ROW: N(2), TEXT: T('World') }), b('ba_lcd_clear'), b('ba_lcd_backlight'), b('ba_lcd_scroll'),
      ]),
      cat('Control', C.control, [
        b('ba_wait', { SECS: N(1) }), b('ba_wait_ms', { MS: N(100) }), b('ba_wait_until'), b('ba_repeat', { TIMES: N(10) }),
        b('ba_repeat_until'), b('ba_forever'), b('ba_if'), b('ba_if_else'),
      ]),
      cat('Operators', C.operators, [
        b('ba_arith', { A: N(1), B: N(1) }), b('ba_compare', { A: N(0), B: N(50) }), b('ba_and_or'), b('ba_not'), b('ba_bool'),
        b('ba_random', { FROM: N(1), TO: N(10) }), b('ba_map', { V: N(512), FL: N(0), FH: N(1023), TL: N(0), TH: N(180) }),
        b('ba_constrain', { V: N(50), LO: N(0), HI: N(100) }), b('ba_math_fn', { V: N(9) }), b('ba_millis'),
        b('ba_join', { A: T('score: '), B: N(0) }), { kind: 'block', type: 'math_number' }, { kind: 'block', type: 'text' },
      ]),
      cat('Variables', C.variables, [], { custom: 'BA_VARIABLES' }),
      cat('Serial', C.serial, [b('ba_serial_print', { V: T('Hello!') }), b('ba_serial_line'), b('ba_when_serial')]),
      cat('Custom', C.custom, [
        b('ba_cpp_code'), b('ba_cpp_value'), b('ba_cpp_condition'), b('ba_cpp_top'), b('ba_cpp_setup'),
        ...customBlocks.map((cb) => cb.toolboxItem || { kind: 'block', type: 'custom_' + cb.id }),
      ]),
    ];
    return { kind: 'categoryToolbox', contents: cats };
  }

  /* Variables flyout: create button + set/change/get for each variable. */
  function variablesFlyout(ws) {
    const xml = [{ kind: 'button', text: 'Make a variable', callbackKey: 'BA_CREATE_VAR' }];
    const vars = ws.getVariablesOfType('');
    if (vars.length) {
      const first = vars[0];
      xml.push({ kind: 'block', type: 'variables_set', fields: { VAR: { id: first.getId() } }, inputs: { VALUE: N(0) } });
      xml.push({ kind: 'block', type: 'ba_change_var', fields: { VAR: { id: first.getId() } }, inputs: { DELTA: N(1) } });
      for (const v of vars) xml.push({ kind: 'block', type: 'variables_get', fields: { VAR: { id: v.getId() } } });
    }
    return xml;
  }

  /* Colour the built-in variable blocks to match the category. */
  for (const t of ['variables_get', 'variables_set']) {
    const orig = Blockly.Blocks[t].init;
    Blockly.Blocks[t].init = function () { orig.call(this); this.setColour(C.variables); };
  }
  for (const t of ['math_number', 'text']) {
    const orig = Blockly.Blocks[t].init;
    Blockly.Blocks[t].init = function () { orig.call(this); this.setColour(C.operators); };
  }

  const api = { setBoard, getBoard, pinOptions, toolbox, variablesFlyout, COLOURS: C, SETUP_FOR, SETUP_TYPES, FieldBaPin };
  if (isNode) module.exports = api; else window.BA_BLOCKS = api;
})();
