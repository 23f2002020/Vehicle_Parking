// Server-corrected clock. Countdowns and "is this time in the past?" checks use the SERVER's idea of "now",
// so a wrong device clock (or the demo time-travel tool) can never produce a wrong booking time.
export const clock = Vue.observable({ now: Date.now(), skew: 0 });

export function syncClock(serverIso) {
  const t = Date.parse(serverIso);
  if (!isNaN(t)) { clock.skew = t - Date.now(); clock.now = Date.now() + clock.skew; }
}
export const nowMs = () => Date.now() + clock.skew;

setInterval(() => { clock.now = Date.now() + clock.skew; }, 1000);
