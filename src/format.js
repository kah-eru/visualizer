/* ============================================================================
   Pure formatting / math / sorting helpers — no DOM, no shared app state.
   Extracted from app.js so they can be unit-tested directly in Node.
   ========================================================================== */

import { parseTimestamp } from "./parse.js";

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
const CATEGORY_COLORS = Object.create(null);
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
const _dtfCache = Object.create(null);
function dtf(key, opts) {
  return _dtfCache[key] || (_dtfCache[key] = new Intl.DateTimeFormat([], { ...opts, timeZone: "UTC" }));
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
// (day → controller midnight…next midnight, week → Sun 00:00…+7d, month → 1st…1st, etc.).
// `bounds` = { min, max } supplies the full-data span for the default/"all" case.
export function snapWindow(unit, anchorMs, bounds = {}) {
  const d = new Date(anchorMs); let start, end, e;
  switch (unit) {
    case "second": d.setUTCMilliseconds(0); start = d.getTime(); end = start + 1000; break;
    case "minute": d.setUTCSeconds(0, 0); start = d.getTime(); end = start + 60000; break;
    case "hour":   d.setUTCMinutes(0, 0, 0); start = d.getTime(); end = start + 3600000; break;
    case "day":    d.setUTCHours(0, 0, 0, 0); start = d.getTime(); end = start + 86400000; break;
    case "week":   d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); start = d.getTime(); end = start + 604800000; break;
    case "month":  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); start = d.getTime(); e = new Date(start); e.setUTCMonth(e.getUTCMonth() + 1); end = e.getTime(); break;
    default:       start = bounds.min; end = bounds.max + 1;
  }
  return { start, end };
}

// Approximate duration of each window-preset unit, for a window centered on a point (the scrubber)
// rather than snapped to calendar boundaries.
export const WINDOW_UNIT_MS = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };

// A window of `unit`'s duration centered on `center` (½ the unit on each side). Returns null for "all"
// or any unknown unit so the caller can fall back to the full data span.
export function centeredWindow(unit, center) {
  const w = Object.hasOwn(WINDOW_UNIT_MS, unit) ? WINDOW_UNIT_MS[unit] : null;
  if (!w) return null;
  return { start: center - w / 2, end: center + w / 2 };
}

// datetime-local displays the controller wall clock encoded in our Date's UTC components.
export function toLocalInput(d) {
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 16) : "";
}

export function fromLocalInput(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)
    ? parseTimestamp(value) : null;
}

/* ---- hydraulic variance ---- */
export function eventVariancePct(e) {
  const ac = e.pairs.AC ? e.pairs.AC.value : null;
  const ex = e.pairs.EX ? e.pairs.EX.value : null;
  if (!Number.isFinite(ac) || !Number.isFinite(ex) || ex === 0) return null;
  const variance = Math.abs(ac - ex) / Math.abs(ex) * 100;
  return Number.isFinite(variance) ? variance : null;
}
