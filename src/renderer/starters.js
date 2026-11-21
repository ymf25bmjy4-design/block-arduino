/* Starter projects (Blockly JSON serialisation built with small helpers). */
(function () {
  const isNode = typeof window === 'undefined';

  const N = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
  const T = (t) => ({ shadow: { type: 'text', fields: { TEXT: t } } });
  const V = (block, shadowNum) => (shadowNum !== undefined ? { block, ...N(shadowNum) } : { block });
  const B = (type, fields, inputs) => ({ type, ...(fields ? { fields } : {}), ...(inputs ? { inputs } : {}) });
  /* chain(a, b, c): a -> b -> c via next connections */
  const chain = (...bs) => {
    const list = bs.filter(Boolean);
    for (let i = list.length - 2; i >= 0; i--) list[i] = { ...list[i], next: { block: list[i + 1] } };
    return list[0];
  };
  const at = (x, y, block) => ({ ...block, x: Math.round(x * 1.7), y: Math.round(y * 1.9) });
  const stmt = (...bs) => ({ block: chain(...bs) });
  const ws = (...tops) => ({ blocks: { languageVersion: 0, blocks: tops } });

  const STARTERS = [
    {
      id: 'blink', name: 'Blink', board: 'uno', description: 'Flash the built-in LED on pin 13.',
      workspace: ws(at(40, 40, chain(
        B('ba_forever_hat'),
        B('ba_digital_write', { PIN: '13', STATE: 'HIGH' }),
        B('ba_wait', null, { SECS: N(0.5) }),
        B('ba_digital_write', { PIN: '13', STATE: 'LOW' }),
        B('ba_wait', null, { SECS: N(0.5) }),
      ))),
    },
    {
      id: 'button_led', name: 'Button LED', board: 'uno',
      description: 'A button on pin 2 (to GND) toggles the LED while another script blinks pin 12.',
      workspace: ws(
        at(40, 40, chain(B('ba_when_start'), B('ba_serial_print', null, { V: T('Press the button on pin 2') }))),
        at(40, 160, chain(B('ba_when_button', { PIN: '2', EVENT: 'pressed' }), B('ba_toggle_pin', { PIN: '13' }),
          B('ba_serial_print', null, { V: V(B('ba_button_count', { PIN: '2' })) }))),
        at(380, 40, chain(B('ba_every', { MS: 250 }), B('ba_toggle_pin', { PIN: '12' }))),
      ),
    },
    {
      id: 'servo_sweep', name: 'Servo Sweep', board: 'uno', description: 'Sweep a servo on pin 9 back and forth.',
      workspace: ws(at(40, 40, chain(
        B('ba_forever_hat'),
        B('ba_servo_sweep', { PIN: '9' }, { ANGLE: N(180), SECS: N(1) }),
        B('ba_wait', null, { SECS: N(1.2) }),
        B('ba_servo_sweep', { PIN: '9' }, { ANGLE: N(0), SECS: N(1) }),
        B('ba_wait', null, { SECS: N(1.2) }),
      ))),
    },
    {
      id: 'stepper_clock', name: 'Stepper Clock', board: 'uno',
      description: 'A 28BYJ-48 stepper ticks like a second hand (4096 half-steps per turn).',
      workspace: ws(
        at(40, 40, chain(B('ba_when_start'), B('ba_stepper_setup_4wire', { ID: '1', P1: '8', P2: '9', P3: '10', P4: '11' }),
          B('ba_stepper_speed', { ID: '1' }, { SPEED: N(800) }))),
        at(40, 200, chain(B('ba_every', { MS: 1000 }), B('ba_stepper_move', { ID: '1', WAIT: 'no' }, { STEPS: N(68) }))),
      ),
    },
    {
      id: 'rainbow_strip', name: 'Rainbow Strip', board: 'uno', description: 'Animate a rainbow on 8 NeoPixels (pin 6).',
      workspace: ws(
        at(40, 40, chain(B('ba_when_start'), B('ba_neo_setup', { COUNT: 8, CONN: 'pin', PIN: '6' }),
          B('ba_neo_brightness', null, { LEVEL: N(40) }))),
        at(40, 200, chain(B('ba_every', { MS: 30 }), B('ba_neo_rainbow', null, { SHIFT: N(1) }))),
      ),
    },
    {
      id: 'lcd_hello', name: 'LCD Hello', board: 'uno', description: 'Say hello on an I2C LCD and count seconds.',
      workspace: ws(
        at(40, 40, chain(B('ba_when_start'), B('ba_lcd_setup', { SIZE: '16x2', ADDR: 'auto' }),
          B('ba_lcd_print_line', null, { ROW: N(1), TEXT: T('Hello, world!') }))),
        at(40, 220, chain(B('ba_every', { MS: 1000 }),
          B('ba_lcd_print_line', null, { ROW: N(2), TEXT: V(B('ba_join', null, { A: T('Seconds: '),
            B: V(B('ba_math_fn', { FN: 'floor' }, { V: V(B('ba_arith', { OP: '/' }, { A: V(B('ba_millis')), B: N(1000) })) })) })) }))),
      ),
    },
    {
      id: 'night_light', name: 'Night Light', board: 'uno',
      description: 'A light sensor on A0 turns on NeoPixels when it gets dark; the LCD shows the level and a button counts presses.',
      workspace: ws(
        at(40, 40, chain(B('ba_when_start'), B('ba_neo_setup', { COUNT: 8, CONN: 'pin', PIN: '6' }),
          B('ba_lcd_setup', { SIZE: '16x2', ADDR: 'auto' }), B('ba_lcd_print_line', null, { ROW: N(1), TEXT: T('Night light') }))),
        at(40, 240, chain(B('ba_when_analog', { PIN: 'A0', DIR: 'below', LEVEL: 300 }),
          B('ba_neo_fill', { COLOUR: '#ffb347' }), B('ba_lcd_print_line', null, { ROW: N(1), TEXT: T('Dark: light on') }))),
        at(40, 400, chain(B('ba_when_analog', { PIN: 'A0', DIR: 'above', LEVEL: 300 }),
          B('ba_neo_clear'), B('ba_lcd_print_line', null, { ROW: N(1), TEXT: T('Bright: light off') }))),
        at(420, 40, chain(B('ba_every', { MS: 500 }),
          B('ba_lcd_print_line', null, { ROW: N(2), TEXT: V(B('ba_join', null, { A: T('Level '), B: V(B('ba_analog_read', { PIN: 'A0' })) })) }))),
        at(420, 220, chain(B('ba_when_button', { PIN: '2', EVENT: 'pressed' }), B('ba_broadcast', { MSG: 'flash', WAIT: 'wait' }),
          B('ba_serial_print', null, { V: T('flash done') }))),
        at(420, 380, chain(B('ba_when_receive', { MSG: 'flash' }),
          B('ba_repeat', null, { TIMES: N(3), DO: stmt(B('ba_neo_fill', { COLOUR: '#ffffff' }), B('ba_wait', null, { SECS: N(0.1) }),
            B('ba_neo_clear'), B('ba_wait', null, { SECS: N(0.1) })) }))),
      ),
    },
  ];

  if (isNode) module.exports = STARTERS; else window.BA_STARTERS = STARTERS;
})();
