/*
 * BlockArduino.h — runtime library for Block Arduino
 *
 * Cooperative multitasking for event-based block programs. Every script
 * (hat block) becomes a resumable task built from protothread-style macros:
 * a task saves its position when it waits and the scheduler resumes it on a
 * later pass of loop(). No RTOS, ~6 bytes of RAM per task.
 *
 * Header-only. Versioned with the app so old projects compile the same way.
 *
 * Rules for code inside a task:
 *   - Put each BA_* waiting macro on its own line.
 *   - Do not declare local variables that must survive a wait; use globals.
 *   - Never call delay(); use BA_WAIT_MS() so other scripts keep running.
 */
#ifndef BLOCK_ARDUINO_H
#define BLOCK_ARDUINO_H

#include <Arduino.h>

#define BLOCK_ARDUINO_VERSION "0.1.0"

#ifndef BA_MAX_MESSAGES
#define BA_MAX_MESSAGES 32   /* broadcast message ids 0..31 */
#endif

#ifndef BA_SERIAL_LINE_MAX
#define BA_SERIAL_LINE_MAX 64
#endif

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

class BaTask {
public:
  typedef void (*Fn)(BaTask *);
  Fn fn;
  uint16_t lc;          /* local continuation: where to resume          */
  uint8_t running;      /* 1 while the script is active                 */
  uint8_t ignoreWhileRunning; /* retrigger policy                       */
  uint32_t t0;          /* timestamp used by BA_WAIT_MS                 */
  BaTask *next;

  static BaTask *&head() { static BaTask *h = 0; return h; }

  BaTask(Fn f, uint8_t ignoreRetrigger = 0)
      : fn(f), lc(0), running(0), ignoreWhileRunning(ignoreRetrigger), t0(0), next(0) {
    /* append so tasks step in workspace order */
    BaTask **p = &head();
    while (*p) p = &((*p)->next);
    *p = this;
  }
};

/* Protothread macros. _ba is the task pointer passed to every task fn. */
#define BA_BEGIN()        switch (_ba->lc) { case 0:
#define BA_END()          } _ba->running = 0; _ba->lc = 0; return;
#define BA_YIELD()        do { _ba->lc = __LINE__; return; case __LINE__:; } while (0)
#define BA_WAIT_UNTIL(c)  do { _ba->lc = __LINE__; case __LINE__: if (!(c)) return; } while (0)
#define BA_WAIT_MS(ms)    do { _ba->t0 = millis(); _ba->lc = __LINE__; case __LINE__: \
                               if ((uint32_t)(millis() - _ba->t0) < (uint32_t)(ms)) return; } while (0)
#define BA_EXIT()         do { _ba->running = 0; _ba->lc = 0; return; } while (0)

/* Convenience for hand-written sketches: BA_TASK(name) { BA_BEGIN(); ... BA_END(); } */
#define BA_TASK(name) void name##_fn(BaTask *_ba); BaTask name(name##_fn); void name##_fn(BaTask *_ba)

inline void ba_start(BaTask &t)   { t.lc = 0; t.running = 1; }
inline void ba_trigger(BaTask &t) {
  if (t.running && t.ignoreWhileRunning) return;   /* "ignore while running" */
  t.lc = 0; t.running = 1;                         /* Scratch: restart from top */
}
inline void ba_stop(BaTask &t)    { t.running = 0; t.lc = 0; }
inline bool ba_running(BaTask &t) { return t.running != 0; }

/* Optional hook the generated sketch defines to detach servos, clear pixels... */
void ba_on_stop_all() __attribute__((weak));

inline void ba_stop_all() {
  for (BaTask *t = BaTask::head(); t; t = t->next) { t->running = 0; t->lc = 0; }
  if (ba_on_stop_all) ba_on_stop_all();
}

/* ------------------------------------------------------------------ */
/* Inputs: debounced buttons, digital edges, analog thresholds        */
/* ------------------------------------------------------------------ */

#define BA_ACTIVE_LOW  1   /* switch wired to GND, internal pull-up */
#define BA_ACTIVE_HIGH 0   /* switch wired to 5V, external pull-down */

class BaInput {
public:
  BaInput *nextInput;
  static BaInput *&head() { static BaInput *h = 0; return h; }
  BaInput() : nextInput(0) { BaInput **p = &head(); while (*p) p = &((*p)->nextInput); *p = this; }
  virtual void begin() {}
  virtual void update() = 0;
};

class BaButton : public BaInput {
public:
  uint8_t pin, activeLow, stable, lastRaw, evPress, evRelease, evHeld, heldFired;
  uint16_t presses;
  uint32_t lastChange, downSince, holdMs;

  BaButton(uint8_t p, uint8_t active = BA_ACTIVE_LOW, uint32_t hold = 1000)
      : pin(p), activeLow(active), stable(0), lastRaw(0), evPress(0), evRelease(0),
        evHeld(0), heldFired(0), presses(0), lastChange(0), downSince(0), holdMs(hold) {}

  void begin() { pinMode(pin, activeLow ? INPUT_PULLUP : INPUT); lastRaw = stable = read(); }
  uint8_t read() { uint8_t v = digitalRead(pin) ? 1 : 0; return activeLow ? !v : v; }

  void update() {
    evPress = evRelease = evHeld = 0;
    uint8_t raw = read();
    uint32_t now = millis();
    if (raw != lastRaw) { lastRaw = raw; lastChange = now; }
    if (raw != stable && (uint32_t)(now - lastChange) >= 20) {   /* 20 ms debounce */
      stable = raw;
      if (stable) { evPress = 1; presses++; downSince = now; heldFired = 0; }
      else        { evRelease = 1; }
    }
    if (stable && !heldFired && (uint32_t)(now - downSince) >= holdMs) { evHeld = 1; heldFired = 1; }
  }
  bool pressed()  { return evPress; }   /* true for one loop pass */
  bool released() { return evRelease; }
  bool held()     { return evHeld; }
  bool isDown()   { return stable; }
  uint16_t count() { return presses; }
  void resetCount() { presses = 0; }
};

class BaEdge : public BaInput {
public:
  uint8_t pin, last, evRise, evFall;
  BaEdge(uint8_t p) : pin(p), last(0), evRise(0), evFall(0) {}
  void begin() { pinMode(pin, INPUT); last = digitalRead(pin) ? 1 : 0; }
  void update() {
    uint8_t v = digitalRead(pin) ? 1 : 0;
    evRise = (v && !last); evFall = (!v && last); last = v;
  }
  bool rose() { return evRise; }
  bool fell() { return evFall; }
  bool changed() { return evRise || evFall; }
};

class BaThreshold : public BaInput {
public:
  uint8_t pin, above, evUp, evDown;
  int level, hyst;
  BaThreshold(uint8_t p, int lvl, int h = 10) : pin(p), above(0), evUp(0), evDown(0), level(lvl), hyst(h) {}
  void begin() { above = analogRead(pin) > level; }
  void update() {
    int v = analogRead(pin);
    evUp = evDown = 0;
    if (!above && v > level + hyst) { above = 1; evUp = 1; }
    else if (above && v < level - hyst) { above = 0; evDown = 1; }
  }
  bool wentAbove() { return evUp; }
  bool wentBelow() { return evDown; }
};

/* Fixed-rate timer for "every N ms" hats. */
class BaEvery {
public:
  uint32_t period, last;
  BaEvery(uint32_t ms) : period(ms), last(0) {}
  bool fire() {
    uint32_t now = millis();
    if ((uint32_t)(now - last) >= period) { last = now; return true; }
    return false;
  }
};

/* ------------------------------------------------------------------ */
/* Broadcasts                                                         */
/* ------------------------------------------------------------------ */

struct BaMessages {
  static uint32_t &pending() { static uint32_t p = 0; return p; }
  static uint32_t &current() { static uint32_t c = 0; return c; }
};
inline void ba_broadcast(uint8_t id) { BaMessages::pending() |= (1UL << (id % BA_MAX_MESSAGES)); }
inline bool ba_got(uint8_t id) { return BaMessages::current() & (1UL << (id % BA_MAX_MESSAGES)); }

/* ------------------------------------------------------------------ */
/* Serial line reader for "when serial receives a line"               */
/* ------------------------------------------------------------------ */

struct BaSerialLine {
  static char *buf() { static char b[BA_SERIAL_LINE_MAX + 1] = {0}; return b; }
  static char *line() { static char l[BA_SERIAL_LINE_MAX + 1] = {0}; return l; }
  static uint8_t &len() { static uint8_t n = 0; return n; }
};
#define ba_line (String(BaSerialLine::line()))

inline bool ba_serial_poll() {
  bool got = false;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      BaSerialLine::buf()[BaSerialLine::len()] = 0;
      strcpy(BaSerialLine::line(), BaSerialLine::buf());
      BaSerialLine::len() = 0;
      got = true;
    } else if (BaSerialLine::len() < BA_SERIAL_LINE_MAX) {
      BaSerialLine::buf()[BaSerialLine::len()++] = c;
    }
  }
  return got;
}

/* ------------------------------------------------------------------ */
/* Printing: whole numbers print without ".00" so the plotter and     */
/* beginners see 42, not 42.00                                        */
/* ------------------------------------------------------------------ */

template <class T> inline void ba_print(const T &x) { Serial.println(x); }
inline void ba_print(float x) {
  if (x == (float)(long)x) Serial.println((long)x); else Serial.println(x);
}
inline void ba_print(double x) {
  if (x == (double)(long)x) Serial.println((long)x); else Serial.println(x);
}

template <class T> inline String ba_str(const T &x) { return String(x); }
inline String ba_str(float x) { return x == (float)(long)x ? String((long)x) : String(x); }
inline String ba_str(double x) { return x == (double)(long)x ? String((long)x) : String(x); }

/* ------------------------------------------------------------------ */
/* Background helpers                                                 */
/* ------------------------------------------------------------------ */

/* Smooth servo sweep that runs in the background. Works with any class
 * that has write(int) and read(), e.g. Servo or ESP32Servo. */
template <class S>
class BaSweep {
public:
  S &servo;
  int from, to;
  uint32_t start, dur;
  uint8_t active;
  BaSweep(S &s) : servo(s), from(90), to(90), start(0), dur(0), active(0) {}
  void go(int target, uint32_t ms) {
    from = servo.read(); to = constrain(target, 0, 180); start = millis(); dur = ms; active = 1;
    if (ms == 0) { servo.write(to); active = 0; }
  }
  void update() {
    if (!active) return;
    uint32_t e = millis() - start;
    if (e >= dur) { servo.write(to); active = 0; return; }
    servo.write(from + (long)(to - from) * (long)e / (long)dur);
  }
  bool busy() { return active; }
};

/* Replace a whole LCD row, padding with spaces (row is 0-based). */
template <class L>
inline void ba_lcd_line(L &lcd, uint8_t row, const String &text, uint8_t cols = 16) {
  lcd.setCursor(0, row);
  String t = text;
  while (t.length() < cols) t += ' ';
  lcd.print(t.substring(0, cols));
}

/* ------------------------------------------------------------------ */
/* Main hooks called by the generated sketch                          */
/* ------------------------------------------------------------------ */

inline void ba_begin(bool handshake = true, uint32_t baud = 115200) {
  Serial.begin(baud);
  for (BaInput *i = BaInput::head(); i; i = i->nextInput) i->begin();
  if (handshake) Serial.println(F("BA:READY"));   /* Smart Upload check */
}

/* Call at the top of loop(): refreshes inputs and delivers broadcasts. */
inline void ba_poll() {
  for (BaInput *i = BaInput::head(); i; i = i->nextInput) i->update();
  BaMessages::current() = BaMessages::pending();
  BaMessages::pending() = 0;
}

/* Advance every running task by one step. */
inline void ba_step_all() {
  for (BaTask *t = BaTask::head(); t; t = t->next)
    if (t->running) t->fn(t);
}

#endif /* BLOCK_ARDUINO_H */
