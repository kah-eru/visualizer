/* ============================================================================
   Pure view logic — the filter predicate, window/nav math, minimap coordinate
   transforms, and the run-selection/coverage builds — extracted out of app.js so
   they're unit-testable in Node (tests/view.test.js), the same way parse/runs/
   classify/format already are.

   What did NOT move, deliberately: all mutable state, every memo cache
   (visRunsCache/visRunsKey, runCoverCache/runCoverGen), and every DOM read. Those
   stay in app.js because their INVALIDATION is the subtle part — e.g. applyFilters
   does `runGen++; lastFeedSig = null;` together, and splitting the caches from the
   state they key on is how that drifts. This module is math; app.js decides when
   to call it and what to remember.
   ========================================================================== */
import { HUMAN_TRIGGERS } from "./constants.js";
import { eventVariancePct, fmtTimeDate } from "./format.js";

/* ============================ Filtering ============================ */
// The audit-feed / timeline filter predicate. `opts` is the sidebar state, read from the DOM by
// applyFilters (app.js) and passed in here as plain values.
//
// NOTE: the time window is NOT a filter — it's the view window (currentRange), applied at render
// time. That's what lets zoom / nav / window presets roam the whole file independent of `filtered`.
export function matchesFilters(e, {
  category = "", action = "", trigger = "", substation = "", minFlow = 0,
  alertsOnly = false, humanAudit = false, showAdvanced = false,
  varMin = 0, varMax = 100, hasHydro = false,
} = {}) {
  const varActive = hasHydro && (varMin > 0 || varMax < 100);
  if (!showAdvanced && e.isNoise) return false; // hide substation/network/two-wire chatter
  if (category && e.category !== category) return false;
  if (action && e.action !== action) return false;
  if (trigger && e.trigger !== trigger) return false;
  // A substation row identifies itself with SN (serial) or, on some categories, SB.
  if (substation) {
    const sid = e.pairs.SN ? e.pairs.SN.raw : (e.pairs.SB ? e.pairs.SB.raw : null);
    if (String(sid) !== substation) return false;
  }
  if (humanAudit && !HUMAN_TRIGGERS.has(e.trgCode)) return false;
  if (alertsOnly && !e.isAlert) return false;
  if (minFlow > 0) { if (e.flow == null || e.flow < minFlow) return false; }
  if (varActive) { const v = eventVariancePct(e); if (v == null || v < varMin || v > varMax) return false; }
  return true;
}

export function filterEvents(events, opts) {
  return events.filter(e => matchesFilters(e, opts));
}

/* ============================ Window / nav math ============================ */
// Clamp [start,end] to the full data span, keeping at least a 1s window.
// `full` is {s,e} — the minimap's full extent (app.js's miniFull()).
export function clampView(start, end, full) {
  const s = Math.max(full.s, Math.min(start, full.e - 1000));
  const e = Math.min(full.e, Math.max(end, s + 1000));
  return { s, e };
}

// Minimap pixel ↔ time. `W` is the track width in px (app.js passes miniMap.clientWidth || 1).
export function pxToTime(px, W, full) { return full.s + (px / W) * (full.e - full.s); }
export function timeToPx(t, W, full) { return (t - full.s) / (full.e - full.s) * W; }

// Step one window-width in `dir` (±1), keeping the current width — the non-aligned nav case.
// Calendar-aligned units re-snap via snapWindow (format.js) instead.
export function shiftRange(range, dir) {
  const width = range.end - range.start;
  return { start: range.start + dir * width, end: range.end + dir * width };
}

// A window of `width` centered on `t` — the corner jump-triangles hop to a run's other edge at the
// same zoom level.
export function centeredRange(t, width) {
  return { start: t - width / 2, end: t + width / 2 };
}

/* ============================ Run selection ============================ */
// Run intervals for the currently-visible groups, tagged with their group + color. Mirrors
// renderSwimlane's gating so the scrubber panel and the timeline agree about what's on screen.
//
// `runsByMode` is { program, zone, mainline } → interval arrays; `laneSel` is the same shape but of
// Sets of selected keys; `colorFor(group, key)` supplies the lane color (app.js owns categoryColor /
// zoneColor). app.js memoizes the result — this build is spread-heavy and runs per pointermove.
export function selectVisibleRuns(runsByMode, laneSel, { showScheduled = true, showManual = true } = {}, colorFor) {
  const okType = iv => (iv.manual ? showManual : showScheduled);
  const out = [];
  if (laneSel.mainline.size) for (const iv of runsByMode.mainline) if (laneSel.mainline.has(iv.key)) out.push({ ...iv, group: "Mainline", color: colorFor("Mainline", iv.key) });
  if (laneSel.program.size) for (const iv of runsByMode.program) if (laneSel.program.has(iv.key) && okType(iv)) out.push({ ...iv, group: "Program", color: colorFor("Program", iv.key) });
  if (laneSel.zone.size) for (const iv of runsByMode.zone) if (laneSel.zone.has(iv.key) && okType(iv)) out.push({ ...iv, group: "Zone", color: colorFor("Zone", iv.key) });
  // Mirror the swimlane's Manual Runs section: manual zone runs are listed whatever the Zones
  // dropdown says (it starts empty), so the panel can answer "what was running by hand here?" on a
  // fresh load. Dedupe against the pass above — a zone can be selected AND manual, and the panel
  // must list that run once.
  if (showManual) {
    const seen = new Set(out.map(iv => iv.group + "|" + iv.key + "|" + iv.start));
    for (const iv of runsByMode.zone) {
      if (!iv.manual || seen.has("Zone|" + iv.key + "|" + iv.start)) continue;
      out.push({ ...iv, group: "Zone", color: colorFor("Zone", iv.key) });
    }
  }
  return out;
}

/* ---- "does a bar actually exist here?" ---- */
// eventRunTarget only says which lane an event NAMES; a ZN,WA (queued, not watering) names a zone
// with no bar. eventJumpTarget (classify.js) asks this before offering a ↗ button, so that a jump
// can't land on nothing. app.js caches the index against runGen.
export function buildRunCoverIndex(runsByMode) {
  const index = new Map();
  for (const [mode, group] of [["zone", "Zone"], ["program", "Program"], ["mainline", "Mainline"]]) {
    for (const iv of runsByMode[mode] || []) {
      const k = group + "|" + iv.key;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(iv);
    }
  }
  return index;
}

export function runCoversAt(index, group, key, ts) {
  const list = index.get(group + "|" + String(key));
  return !!list && list.some(iv => iv.start <= ts && ts <= iv.end); // inclusive end, matching the bar
}

/* ---- scrubber snapping ---- */
// Nearest run start/end edge within `tolPx`, measured in PIXELS (so the snap feels the same at every
// zoom). `pxOf` is injected — it's the Chart.js x-scale, which stays in app.js.
export function snapToEdges(t, runs, pxOf, tolPx = 8) {
  const px = pxOf(t);
  let best = t, bestD = tolPx;
  for (const iv of runs) for (const edge of [iv.start, iv.end]) {
    const d = Math.abs(pxOf(edge) - px);
    if (d < bestD) { bestD = d; best = edge; }
  }
  return best;
}

/* ============================ Feed ↗ button tooltip ============================ */
// Describes what a jump will do, given eventJumpTarget's {dest,bar,tick,diamond} verdict.
export function jumpTitle(jump, ts) {
  const when = fmtTimeDate(ts, 0);
  const marks = [jump.bar && "rings its run bar", jump.tick && "rings its red alert tick",
    jump.diamond && "rings its marker on the Interventions & Alerts timeline"].filter(Boolean).join(", ");
  const where = jump.dest === "events"
    ? "Scroll to the Interventions & Alerts timeline at this event"
    : "Scroll up to the timeline at this event";
  const extra = jump.dest === "events" ? " Switches the Events timeline on if it's off." : "";
  return `${where} (${when}): the scrubber lands on it and it ${marks} until the next jump.${extra}`;
}
