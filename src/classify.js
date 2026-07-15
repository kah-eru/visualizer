/* ============================================================================
   Pure event-classification helpers (severity, grouping, subject) — no DOM,
   no shared app state. Extracted from app.js so they can be unit-tested.
   ========================================================================== */
import { escapeHtml } from "./format.js";

// Events that define run durations are shown on the swimlane, not in the audit feed.
export function isDurationMarker(e) {
  return (e.catCode === "ZN" && (e.actCode === "WT" || e.actCode === "DN")) ||
         (e.catCode === "PG" && ["SR", "RN", "SP", "DN", "MR"].includes(e.actCode));
}

export function feedSeverity(e) {
  if (e.isAlert || ["FV", "CE", "LP", "DC"].includes(e.actCode)) return "crit";
  if (["PA", "SK"].includes(e.actCode) || e.catCode === "SW") return "warn";
  if (e.actCode === "CC" && e.trgCode === "US") return "audit";
  return "";
}

// Grouped, ordered; first matching group wins. These are the "why did this happen" events:
// pauses, disables, skips/drops, config changes/errors, status/set messages, and alarms.
export const EVENT_GROUPS = [
  { label: "Alarms",       color: "#f43f5e", test: e => e.catCode === "AL" || e.actCode === "ER" },
  { label: "Pause",        color: "#f59e0b", test: e => e.actCode === "PA" },
  { label: "Disable",      color: "#ef4444", test: e => e.actCode === "DS" },
  { label: "Skip / Drop",  color: "#fb923c", test: e => e.actCode === "SK" || e.actCode === "DR" },
  { label: "Config",       color: "#38bdf8", test: e => e.actCode === "CC" || e.actCode === "CE" },
  { label: "Status / Set", color: "#a78bfa", test: e => e.actCode === "ST" || e.actCode === "SE" },
];
export function eventGroupOf(e) { return EVENT_GROUPS.find(g => g.test(e)) || null; }

// The reason an action was taken: decoded message code / start-pause-stop cause,
// then the TX message and/or trailing free-text tokens, else the trigger.
export function whyText(e) {
  const parts = [];
  if (e.pairs.KD && e.pairs.KD.decoded) parts.push(e.pairs.KD.decoded); // Message (MG) code
  for (const k of ["SC", "PC", "TC"]) {                                  // start / pause / stop cause
    if (e.pairs[k] && e.pairs[k].decoded) parts.push(e.pairs[k].decoded);
  }
  if (e.pairs.TX) parts.push(e.pairs.TX.raw);
  for (const x of e.extras) { const s = String(x).replace(/=$/, "").trim(); if (s) parts.push(s); }
  const why = parts.join(" · ");
  return why || `by ${e.trigger}`;
}

// Short, human-readable summary of what the event acted on (zone / mainline / device).
// Returns { html, title } — title is the longer plain-text version for the hover tooltip.
const DEVICE_KEYS = [["SB", "SubStation"], ["RG", "Rain Gauge"], ["MV", "Master Valve"], ["PM", "Pump"],
  ["CP", "Control Point"], ["MS", "Moisture Sensor"], ["TS", "Temp Sensor"], ["PS", "Pressure Sensor"],
  ["FM", "Flow Meter"], ["WS", "Water Source"], ["SN", "Serial"], ["ID", "ID"]];
export function subjectSummary(e) {
  if (e.zones.length) {
    const lbl = e.zones.length > 1 ? "Zones" : "Zone";
    return { html: `${lbl} ${escapeHtml(e.zones.join(", "))}`, title: `${lbl} ${e.zones.join(", ")} (category: ${e.category})` };
  }
  if (e.mainline != null) return { html: `Mainline ${escapeHtml(e.mainline)}`, title: `Mainline ${e.mainline}` };
  if (e.program != null)  return { html: `Program ${escapeHtml(e.program)}`, title: `Program ${e.program}` };
  for (const [k, lbl] of DEVICE_KEYS) {
    if (e.pairs[k]) return { html: `${lbl} ${escapeHtml(e.pairs[k].raw)}`, title: `${lbl} ${e.pairs[k].raw} (category: ${e.category})` };
  }
  // fall back to the category itself as the subject (e.g. "System")
  return { html: `<span class="text-slate-400">${escapeHtml(e.category)}</span>`, title: e.category };
}

/* ---- Audit-feed search + sort (pure; drive the feed's search box and sortable columns) ---- */

// The searchable haystack for one event: every visible "cell" plus the raw line, lowercased, so a
// single query can match across multiple columns at once (date, action, category, subject, trigger).
export function feedSearchText(e) {
  // Cache per event (events are immutable after load) so a keystroke doesn't rebuild the haystack —
  // including a subjectSummary() call — for every row on large logs.
  return e._searchText ?? (e._searchText = [e.tsRaw, e.action, e.category, subjectSummary(e).title, e.trigger, e.rawLine]
    .filter(Boolean).join(" ").toLowerCase());
}

// True when every whitespace-separated token of `query` appears somewhere in the event's search text
// (token AND). An empty/blank query matches everything.
export function feedMatches(e, query) {
  const toks = (query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  const hay = feedSearchText(e);
  return toks.every(t => hay.includes(t));
}

// The run lane an event belongs to (for flashing its bar on the timeline). Mirrors subjectSummary's
// precedence: zones first (a zone event can also carry a program), then mainline, then program. Returns
// { group, key } or null when the event maps to no run lane (e.g. a plain system/device event).
export function eventRunTarget(e) {
  if (e.zones.length) return { group: "Zone", key: e.zones[0] };
  if (e.mainline != null) return { group: "Mainline", key: String(e.mainline) };
  if (e.program != null) return { group: "Program", key: String(e.program) };
  return null;
}

// Where a feed row's "↗" can actually land, or null when the event is drawn on NEITHER timeline — the
// feed omits the button rather than offering a jump that highlights nothing (that was ~72% of rows).
// An event can be marked in up to three places, and they are not exclusive:
//   bar     — a run bar on the main swimlane. NOTE eventRunTarget only says which lane an event *names*;
//             a `ZN,WA` (zone queued, not watering) names a zone with no bar at that instant, so the
//             caller's `runCovers(group, key, ts)` has to confirm a run is actually there.
//   tick    — the main swimlane's red alert tick.
//   diamond — an .ev-mark on the Interventions & Alerts timeline.
// `runCovers` is injected so this module stays pure and DOM-free.
export function eventJumpTarget(e, runCovers) {
  const target = eventRunTarget(e);
  const bar = target && runCovers(target.group, target.key, e.ts.getTime()) ? target : null;
  const diamond = !!eventGroupOf(e);
  if (!bar && !e.isAlert && !diamond) return null;
  // `isAlert` and the Alarms group are the SAME predicate (parse.js / EVENT_GROUPS above), so every alarm
  // is drawn on BOTH timelines. Alarms belong to the main one (their red ticks live there), which leaves
  // `diamond && !isAlert` meaning exactly "one of the other five groups" — Pause/Disable/Skip/Config/
  // Status, none of which the main timeline draws at all.
  const dest = diamond && !e.isAlert ? "events" : "main";
  return { dest, bar, tick: !!e.isAlert, diamond };
}

// Comparable value for sorting a feed row by a column: numeric epoch for "date", else the display string.
export function feedSortValue(e, col) {
  switch (col) {
    case "action":   return e.action || "";
    case "category": return e.category || "";
    case "subject":  return subjectSummary(e).title || "";
    case "trigger":  return e.trigger || "";
    default:         return e.ts.getTime(); // "date"
  }
}

// Choose + order the audit-feed rows from the WHOLE loaded log (never window-limited):
//   - drop duration markers (drawn as swimlane bars) unless explicitly revealed by a jump,
//   - keep only search matches when `query` is set,
//   - order by the active column (numeric for date, natural string else, event-time tiebreak) when
//     `sortCol` is set, otherwise pin alarms/errors on top then chronological.
// Returns the full ordered list; the caller applies FEED_CAP. Pure → unit-tested.
export function selectFeedRows(events, { query = "", sortCol = null, sortDir = "asc", revealedIds = new Set() } = {}) {
  const base = events.filter(e => !isDurationMarker(e) || revealedIds.has(e._id));
  const matched = query ? base.filter(e => feedMatches(e, query)) : base;
  if (sortCol) {
    const dir = sortDir === "desc" ? -1 : 1;
    // Precompute each row's sort key once (the subject key calls subjectSummary) instead of recomputing
    // both sides inside every comparison — decorate, sort, undecorate.
    return matched
      .map(e => ({ e, v: feedSortValue(e, sortCol) }))
      .sort((a, b) => {
        let c = sortCol === "date" ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
        if (!c) c = a.e.ts.getTime() - b.e.ts.getTime();
        return c * dir;
      })
      .map(x => x.e);
  }
  // default order: real alarms pinned on top, then chronological. Noise-category alerts (two-wire /
  // network chatter, e.g. TW,ER — can be thousands of rows) are NOT pinned, so they don't bury real
  // events when "Advanced" is on; they still appear in-line and keep their timeline ticks/stats.
  const byT = (a, b) => a.ts.getTime() - b.ts.getTime();
  const pinned = e => e.isAlert && !e.isNoise;
  return matched.filter(pinned).sort(byT).concat(matched.filter(e => !pinned(e)).sort(byT));
}
