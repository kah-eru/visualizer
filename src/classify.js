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
