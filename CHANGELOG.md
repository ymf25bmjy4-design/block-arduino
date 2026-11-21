# Changelog

All notable changes to Block Arduino. Each version here becomes the notes of its GitHub Release
and appears on the downloads page. Format: [Keep a Changelog](https://keepachangelog.com), versions follow [SemVer](https://semver.org).

## [0.1.0] - 2026-11-22

First release, built from the Block Arduino design doc.

### Added
- Scratch-style block editor (Blockly, zelos renderer) with 12 categories: Events, Pins, Switches, Servos, Steppers, NeoPixels, LCD, Control, Operators, Variables, Serial and Custom.
- Event model: hat blocks (`when board starts`, `forever`, `every N ms`, button, pin edge, analog threshold, broadcasts, serial line, stepper finished) compiled to cooperative tasks by the `BlockArduino.h` runtime, so waits never block other scripts.
- Live C++ panel with syntax colouring; click a line to find its block, select a block to see its lines.
- Smart Upload: automatic port and board detection by USB VID/PID, error classification with up to 4 retries (old/new Nano bootloader, wrong board by chip signature, busy port, Leonardo port hop, ESP32 boot mode), remembered per-board profiles and a `BA:READY` start-up check.
- Build errors mapped back to the block that caused them, in plain language.
- Serial monitor with send box, and a live plotter for printed numbers.
- Custom C++ blocks (code, value, condition, top of file, setup) and a Block Maker for reusable JSON custom blocks; import/export `.bablock` files and extension-pack folders.
- Smart pin checks (PWM, analog-only, two parts on one pin) and a pin map per board.
- Seven starter projects: Blink, Button LED, Servo Sweep, Stepper Clock, Rainbow Strip, LCD Hello, Night Light.
- Boards: Uno R3, Nano (new and old bootloader), Mega 2560, Leonardo, Micro / Pro Micro, ESP32 DevKit.
- Bundled arduino-cli 1.1.1; board support and libraries install on first use into the app's own folder.
- Projects saved as `.bard` files (gzipped JSON).
- Packages for macOS (Intel and Apple Silicon), Windows (installer and portable zip) and Linux (AppImage, .deb, .tar.gz).
