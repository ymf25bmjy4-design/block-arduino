/* Board definitions shared by the main process (Smart Upload) and the
 * renderer (pin helper, smart pin checks). One entry per board profile. */
(function (root) {
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const A = (n) => range(0, n - 1).map((i) => 'A' + i);

  const BOARDS = [
    {
      id: 'uno', name: 'Arduino Uno R3', fqbn: 'arduino:avr:uno', core: 'arduino:avr',
      family: 'avr', signature: '0x1e950f',
      usb: ['2341:0043', '2341:0001', '2a03:0043', '2341:0243'],
      alternatives: [],
      pins: { digital: range(0, 13), analog: A(6), analogOnly: [], pwm: [3, 5, 6, 9, 10, 11],
              i2c: { sda: 'A4', scl: 'A5' }, interrupt: [2, 3], serial: [0, 1], led: 13 },
      ramBytes: 2048, flashBytes: 32256, adcMax: 1023,
    },
    {
      id: 'nano', name: 'Arduino Nano', fqbn: 'arduino:avr:nano:cpu=atmega328', core: 'arduino:avr',
      family: 'avr', signature: '0x1e950f', usb: [],
      alternatives: ['arduino:avr:nano:cpu=atmega328old'],
      pins: { digital: range(0, 13), analog: A(8), analogOnly: ['A6', 'A7'], pwm: [3, 5, 6, 9, 10, 11],
              i2c: { sda: 'A4', scl: 'A5' }, interrupt: [2, 3], serial: [0, 1], led: 13 },
      ramBytes: 2048, flashBytes: 30720, adcMax: 1023,
    },
    {
      id: 'nano_old', name: 'Arduino Nano (old bootloader)', fqbn: 'arduino:avr:nano:cpu=atmega328old',
      core: 'arduino:avr', family: 'avr', signature: '0x1e950f', usb: [],
      alternatives: ['arduino:avr:nano:cpu=atmega328'],
      pins: { digital: range(0, 13), analog: A(8), analogOnly: ['A6', 'A7'], pwm: [3, 5, 6, 9, 10, 11],
              i2c: { sda: 'A4', scl: 'A5' }, interrupt: [2, 3], serial: [0, 1], led: 13 },
      ramBytes: 2048, flashBytes: 30720, adcMax: 1023,
    },
    {
      id: 'mega', name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega:cpu=atmega2560', core: 'arduino:avr',
      family: 'avr', signature: '0x1e9801', usb: ['2341:0042', '2341:0010', '2a03:0042', '2341:0242'],
      alternatives: [],
      pins: { digital: range(0, 53), analog: A(16), analogOnly: [], pwm: [...range(2, 13), 44, 45, 46],
              i2c: { sda: 20, scl: 21 }, interrupt: [2, 3, 18, 19, 20, 21], serial: [0, 1], led: 13 },
      ramBytes: 8192, flashBytes: 253952, adcMax: 1023,
    },
    {
      id: 'leonardo', name: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo', core: 'arduino:avr',
      family: 'avr', signature: '0x1e9587', usb: ['2341:8036', '2341:0036', '2a03:8036', '2a03:0036'],
      alternatives: [], portHops: true,
      pins: { digital: range(0, 13), analog: A(6), analogOnly: [], pwm: [3, 5, 6, 9, 10, 11, 13],
              i2c: { sda: 2, scl: 3 }, interrupt: [0, 1, 2, 3, 7], serial: [], led: 13 },
      ramBytes: 2560, flashBytes: 28672, adcMax: 1023,
    },
    {
      id: 'micro', name: 'Arduino Micro / Pro Micro', fqbn: 'arduino:avr:micro', core: 'arduino:avr',
      family: 'avr', signature: '0x1e9587', usb: ['2341:8037', '2341:0037', '1b4f:9206', '1b4f:9205'],
      alternatives: ['arduino:avr:leonardo'], portHops: true,
      pins: { digital: range(0, 13), analog: A(6), analogOnly: [], pwm: [3, 5, 6, 9, 10, 11, 13],
              i2c: { sda: 2, scl: 3 }, interrupt: [0, 1, 2, 3, 7], serial: [], led: 13 },
      ramBytes: 2560, flashBytes: 28672, adcMax: 1023,
    },
    {
      id: 'esp32', name: 'ESP32 DevKit', fqbn: 'esp32:esp32:esp32', core: 'esp32:esp32',
      coreUrl: 'https://espressif.github.io/arduino-esp32/package_esp32_index.json',
      family: 'esp32', usb: ['1a86:55d4', '303a:1001'],
      alternatives: ['esp32:esp32:esp32:UploadSpeed=115200'],
      pins: { digital: [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
              analog: [32, 33, 34, 35, 36, 39], analogOnly: [34, 35, 36, 39],
              pwm: [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
              i2c: { sda: 21, scl: 22 }, interrupt: 'all', serial: [1, 3], led: 2 },
      ramBytes: 327680, flashBytes: 1310720, adcMax: 4095,
    },
  ];

  /* USB chips used by clone boards: they only identify the chip, so Smart
   * Upload ranks likely boards for them. */
  const CLONE_CHIPS = {
    '1a86:7523': { chip: 'CH340', likely: ['nano_old', 'nano', 'uno', 'mega', 'esp32'] },
    '10c4:ea60': { chip: 'CP2102', likely: ['esp32', 'nano', 'uno'] },
    '0403:6001': { chip: 'FTDI', likely: ['nano', 'uno', 'nano_old'] },
    '1a86:55d4': { chip: 'CH9102', likely: ['esp32'] },
  };

  const SIGNATURES = {
    '0x1e950f': 'uno',      // ATmega328P
    '0x1e9514': 'uno',      // ATmega328 (non-P)
    '0x1e9801': 'mega',     // ATmega2560
    '0x1e9587': 'leonardo', // ATmega32U4
  };

  const api = {
    BOARDS, CLONE_CHIPS, SIGNATURES,
    byId: (id) => BOARDS.find((b) => b.id === id) || BOARDS[0],
    byUsb: (vidpid) => BOARDS.find((b) => b.usb.includes(String(vidpid).toLowerCase())),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BA_BOARDS = api;
})(typeof window !== 'undefined' ? window : globalThis);
