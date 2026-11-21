#!/usr/bin/env bash
# Compiles generated starter sketches against a mock Arduino core and checks timing.
set -euo pipefail
cd "$(dirname "$0")"
INC=../../resources/libraries/BlockArduino/src
OUT=$(mktemp -d)
build() { cp ../out/$1/$1.ino $OUT/$1.cpp; g++ -std=c++17 -I. -I$INC -include Arduino.h harness.cpp $OUT/$1.cpp -o $OUT/$1; }
expect() { grep -qF "$2" <<<"$1" || { echo "FAIL: expected '$2'"; echo "$1"; exit 1; }; }
for id in blink button_led servo_sweep stepper_clock rainbow_strip lcd_hello night_light; do build $id; done
r=$($OUT/blink 1600);              expect "$r" "[   500] PIN 13 -> OFF"; expect "$r" "[  1000] PIN 13 -> ON"
r=$($OUT/button_led 1600 press:2:1000:1200); expect "$r" "[  1020] PIN 13 -> ON"; expect "$r" "[  1250] PIN 12 -> ON"
r=$($OUT/night_light 3000 analog:14:200:500 press:2:1500:1600); expect "$r" "[  2120] SERIAL flash done"; expect "$r" "Dark: light on"
r=$($OUT/lcd_hello 2100);           expect "$r" "Seconds: 2"
echo "simulation tests passed"
