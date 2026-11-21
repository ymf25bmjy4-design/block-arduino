// Runs a generated sketch against simulated time and inputs.
// args: end_ms then events: press:<pin>:<from>:<to>  analog:<pin>:<value>:<from>
#include "Arduino.h"
#include <vector>
uint32_t sim_ms = 0; int sim_pins[64]; int sim_modes[64]; int sim_analog[64]; int sim_pwm[64];
SimSerial Serial;
struct TwoWire; 
#include "libs.h"
TwoWire Wire;
void digitalWrite(int p, int v) {
  if (sim_pins[p] != v && (p == 12 || p == 13)) printf("[%6u] PIN %d -> %s\n", sim_ms, p, v ? "ON" : "OFF");
  sim_pins[p] = v;
}
void setup(); void loop();
int main(int argc, char **argv) {
  for (int i = 0; i < 64; i++) sim_analog[i] = 800;
  uint32_t end = atoi(argv[1]);
  struct Ev { char kind; int pin, a, b; }; std::vector<Ev> evs;
  for (int i = 2; i < argc; i++) { Ev e; char k[16]; sscanf(argv[i], "%15[^:]:%d:%d:%d", k, &e.pin, &e.a, &e.b); e.kind = k[0]; evs.push_back(e); }
  setup();
  for (sim_ms = 0; sim_ms <= end; sim_ms++) {
    for (auto &e : evs) {
      if (e.kind == 'p') { if (sim_ms == (uint32_t)e.a) sim_pins[e.pin] = 0; if (sim_ms == (uint32_t)e.b) sim_pins[e.pin] = 1; }
      if (e.kind == 'a' && sim_ms == (uint32_t)e.b) sim_analog[e.pin] = e.a;
    }
    for (int k = 0; k < 3; k++) loop();
  }
}
