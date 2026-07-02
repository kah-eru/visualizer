/* ============================================================================
   Pure formatting / math / sorting helpers — no DOM, no shared app state.
   Extracted from app.js so they can be unit-tested directly in Node.
   ========================================================================== */

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// numeric-aware comparator (e.g. zone/program keys): sort by number, then lexically
export const numCmp = (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || String(a).localeCompare(String(b));

// numeric-aware distinct + sort, returns array of string values
export function distinctSorted(values) {
  return [...new Set(values.filter(v => v != null && v !== ""))].sort(numCmp);
}

/* deterministic color per category (memoized) */
const CATEGORY_COLORS = {};
export function categoryColor(name) {
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const c = `hsl(${h}, 65%, 58%)`;
  CATEGORY_COLORS[name] = c;
  return c;
}

/* ---- time / duration formatting ---- */
// Constructing an Intl formatter per call is the expensive part; fmtTime/fmtTimeDate fire per-bar and
// per-axis-tick during render. Lazily cache one instance per option shape (locale [] = default). Output
// is identical to the old toLocale* calls with the same options.
const _dtfCache = {};
function dtf(key, opts) {
  return _dtfCache[key] || (_dtfCache[key] = new Intl.DateTimeFormat([], opts));
}
const _HM = { hour: "2-digit", minute: "2-digit" };
const _HMS = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
const _MD = { month: "short", day: "numeric" };

export function fmtTime(ms, spanMs) {
  const d = new Date(ms);
  if (spanMs <= 3 * 60000) return dtf("hms", _HMS).format(d);
  if (spanMs <= 2 * 86400000) return dtf("hm", _HM).format(d);
  return dtf("mdhm", { ..._MD, ..._HM }).format(d);
}
// Like fmtTime but always includes the calendar date — used for the window-range label so a
// same-day window reads e.g. "Jun 17, 12:00 AM" instead of a bare "12:00 AM".
export function fmtTimeDate(ms, spanMs) {
  const d = new Date(ms);
  if (spanMs <= 3 * 60000) return dtf("mdhms", { ..._MD, ..._HMS }).format(d);
  return dtf("mdhm", { ..._MD, ..._HM }).format(d);
}
export function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function windowLabel(ms) {
  if (ms <= 1500) return "second";
  if (ms <= 90000) return "minute";
  if (ms <= 5400000) return "hour";
  if (ms <= 172800000) return "day";
  if (ms <= 1209600000) return "week";
  return "month";
}

// Snap a window of the given unit to natural calendar boundaries around `anchorMs`
// (day → local midnight…next midnight, week → Sun 00:00…+7d, month → 1st…1st, etc.).
// `bounds` = { min, max } supplies the full-data span for the default/"all" case.
export function snapWindow(unit, anchorMs, bounds = {}) {
  const d = new Date(anchorMs); let start, end, e;
  switch (unit) {
    case "second": d.setMilliseconds(0); start = d.getTime(); end = start + 1000; break;
    case "minute": d.setSeconds(0, 0); start = d.getTime(); end = start + 60000; break;
    case "hour":   d.setMinutes(0, 0, 0); start = d.getTime(); end = start + 3600000; break;
    case "day":    d.setHours(0, 0, 0, 0); start = d.getTime(); e = new Date(start); e.setDate(e.getDate() + 1); end = e.getTime(); break;
    case "week":   d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); start = d.getTime(); e = new Date(start); e.setDate(e.getDate() + 7); end = e.getTime(); break;
    case "month":  start = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); break;
    default:       start = bounds.min; end = bounds.max + 1;
  }
  return { start, end };
}

/* ---- hydraulic variance ---- */
export function eventVariancePct(e) {
  const ac = e.pairs.AC ? e.pairs.AC.value : null;
  const ex = e.pairs.EX ? e.pairs.EX.value : null;
  if (ac == null || ex == null || ex === 0) return null;
  return Math.abs(ac - ex) / Math.abs(ex) * 100;
}
