// Formatting helpers. Dates arrive as UTC ISO strings ("...Z") and are shown in the viewer's local timezone.
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(n) {
  n = Number(n || 0);
  return '₹' + (Math.abs(n - Math.round(n)) < 0.005 ? inr0.format(Math.round(n)) : inr2.format(n));
}
export const moneyExact = n => '₹' + inr2.format(Number(n || 0));

const fDateTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fDateLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const dt = iso => (iso ? fDateTime.format(new Date(iso)) : '—');
export const dateOnly = iso => (iso ? fDate.format(new Date(iso)) : '—');
export const dateLong = iso => (iso ? fDateLong.format(new Date(iso)) : '—');
export const timeOnly = iso => (iso ? fTime.format(new Date(iso)) : '—');
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export function range(startIso, endIso) {
  if (!startIso || !endIso) return '—';
  return sameDay(startIso, endIso)
    ? `${dateOnly(startIso)}, ${timeOnly(startIso)} → ${timeOnly(endIso)}`
    : `${dt(startIso)} → ${dt(endIso)}`;
}

export function duration(mins) {
  mins = Math.round(mins || 0);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const parts = [];
  if (d) parts.push(d + 'd'); if (h) parts.push(h + 'h'); if (m || !parts.length) parts.push(m + 'm');
  return parts.join(' ');
}

export function countdown(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = n => String(n).padStart(2, '0');
  return (h ? h + ':' : '') + p(m) + ':' + p(sec);
}

export function relTime(iso, nowMs) {
  const diff = (new Date(iso).getTime() - nowMs) / 60000;
  const a = Math.abs(diff);
  const txt = a < 1 ? 'just now' : a < 60 ? Math.round(a) + ' min' : a < 1440 ? Math.round(a / 60) + ' h' : Math.round(a / 1440) + ' d';
  if (a < 1) return txt;
  return diff > 0 ? 'in ' + txt : txt + ' ago';
}

export const localTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'local time'; } };

export function pad(n) { return String(n).padStart(2, '0'); }
export const isoFromLocal = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const toIso = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
export const todayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// status -> label + colour class + icon (shared by driver and admin UIs)
const STATUS = {
  upcoming:  { label: 'Upcoming',       cls: 'info', icon: 'bi-clock' },
  ready:     { label: 'Ready to check in', cls: 'ok', icon: 'bi-box-arrow-in-right' },
  parked:    { label: 'Parked',         cls: 'ok',   icon: 'bi-p-square-fill' },
  overstay:  { label: 'Overstaying',    cls: 'bad',  icon: 'bi-exclamation-triangle-fill' },
  completed: { label: 'Completed',      cls: '',     icon: 'bi-check2-circle' },
  cancelled: { label: 'Cancelled',      cls: '',     icon: 'bi-x-circle' },
  no_show:   { label: 'No-show',        cls: 'warn', icon: 'bi-person-x' },
};
export const statusMeta = s => STATUS[s] || { label: s, cls: '', icon: 'bi-circle' };

export const VEHICLE_TYPES = [
  { v: 'car', l: 'Car', i: 'bi-car-front' }, { v: 'suv', l: 'SUV', i: 'bi-truck-front' },
  { v: 'ev', l: 'Electric', i: 'bi-ev-front' }, { v: 'bike', l: 'Bike', i: 'bi-bicycle' },
];
export const isValidCardNumber = n => {
  const d = (n || '').replace(/\D/g, ''); if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let x = +d[i]; if (alt) { x *= 2; if (x > 9) x -= 9; } sum += x; alt = !alt; }
  return sum % 10 === 0;
};

// ---- local date/time helpers used by the booking forms (all "local" = the viewer's own timezone)
export function nextSlotTime(ms, leadMinutes = 15) {
  const t = new Date(ms + leadMinutes * 60000);
  t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);
  return { date: todayKey(t.getTime()), time: `${pad(t.getHours())}:${pad(t.getMinutes())}` };
}
export function localToMs(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || ''), t = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '');
  if (!d || !t) return NaN;
  return new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], 0, 0).getTime();
}
export const addDaysKey = (ms, days) => todayKey(ms + days * 86400000);
