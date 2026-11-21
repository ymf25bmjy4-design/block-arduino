#pragma once
#include "Arduino.h"
struct Servo { int a = 90; void attach(int) {} void write(int v) { a = v; } int read() { return a; } void detach() {} };
struct AccelStepper {
  enum { DRIVER = 1, HALF4WIRE = 8 };
  long pos = 0, target = 0;
  AccelStepper(int, int, int, int = 0, int = 0) {}
  void setMaxSpeed(float) {} void setAcceleration(float) {}
  void move(long d) { target = pos + d; } void moveTo(long t) { target = t; }
  long distanceToGo() { return target - pos; } long currentPosition() { return pos; }
  void stop() { target = pos; } void run() { if (pos < target) pos++; else if (pos > target) pos--; }
};
#define NEO_GRB 0
#define NEO_KHZ800 0
struct Adafruit_NeoPixel {
  int n; uint32_t px[64] = {0}; int shows = 0;
  Adafruit_NeoPixel(int c, int, int) : n(c) {}
  void begin() {} void show() { shows++; } void clear() { memset(px, 0, sizeof px); }
  void setBrightness(int) {} uint16_t numPixels() { return n; }
  void setPixelColor(int i, int r, int g, int b) { if (i < n) px[i] = (r << 16) | (g << 8) | b; }
};
struct TwoWire { void begin() {} void beginTransmission(int) {} int endTransmission() { return 1; } };
extern TwoWire Wire;
struct LiquidCrystal_I2C {
  int addr; char rows[4][41]; int cr = 0, cc = 0;
  LiquidCrystal_I2C(int a, int, int) : addr(a) { memset(rows, ' ', sizeof rows); for (auto &r : rows) r[40] = 0; }
  void init() {} void backlight() {} void noBacklight() {} void clear() {}
  void setCursor(int c, int r) { cc = c; cr = r; }
  void print(const String &s) { for (char ch : s.s) if (cc < 40) rows[cr][cc++] = ch; printf("[%6u] LCD row%d: %.16s\n", sim_ms, cr + 1, rows[cr]); }
  void scrollDisplayLeft() {} void scrollDisplayRight() {}
};
