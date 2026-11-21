// Minimal Arduino mock for host-side simulation tests.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <string>
#include <cstdlib>
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define F(x) (x)
enum { A0 = 14, A1, A2, A3, A4, A5, A6, A7 };
extern uint32_t sim_ms;
extern int sim_pins[64]; extern int sim_modes[64]; extern int sim_analog[64]; extern int sim_pwm[64];
inline uint32_t millis() { return sim_ms; }
inline void pinMode(int p, int m) { sim_modes[p] = m; if (m == INPUT_PULLUP) sim_pins[p] = 1; }
inline int digitalRead(int p) { return sim_pins[p]; }
void digitalWrite(int p, int v);
inline int analogRead(int p) { return sim_analog[p]; }
inline void analogWrite(int p, int v) { sim_pwm[p] = v; }
template <class T, class L, class H> T constrain(T x, L lo, H hi) { return x < lo ? lo : (x > hi ? hi : x); }
inline long map(long x, long a, long b, long c, long d) { return (x - a) * (d - c) / (b - a) + c; }
inline long random(long a, long b) { return a + rand() % (b - a); }
class String {
 public:
  std::string s;
  String() {}
  String(const char *c) : s(c) {}
  String(const std::string &c) : s(c) {}
  String(char c) : s(1, c) {}
  String(int v) : s(std::to_string(v)) {}
  String(long v) : s(std::to_string(v)) {}
  String(unsigned v) : s(std::to_string(v)) {}
  String(unsigned long v) : s(std::to_string(v)) {}
  String(double v) { char b[32]; snprintf(b, 32, "%.2f", v); s = b; }
  String(float v) : String((double)v) {}
  unsigned length() const { return s.size(); }
  String substring(unsigned a, unsigned b) const { return String(s.substr(a, b - a)); }
  String &operator+=(char c) { s += c; return *this; }
  String operator+(const String &o) const { return String(s + o.s); }
  bool equals(const String &o) const { return s == o.s; }
  const char *c_str() const { return s.c_str(); }
};
struct SimSerial {
  void begin(long) {}
  int available() { return 0; }
  int read() { return -1; }
  void println(const char *x) { printf("[%6u] SERIAL %s\n", sim_ms, x); }
  void println(const String &x) { println(x.c_str()); }
  void println(long x) { printf("[%6u] SERIAL %ld\n", sim_ms, x); }
  void println(int x) { println((long)x); }
  void println(unsigned x) { println((long)x); }
  void println(unsigned long x) { println((long)x); }
  void println(double x) { printf("[%6u] SERIAL %.2f\n", sim_ms, x); }
};
extern SimSerial Serial;
