/* ============================================================================
   Pure run-interval pairing (swimlane durations) — no DOM, no shared app state.
   Extracted from app.js so it can be unit-tested directly in Node.
   ========================================================================== */

export const RUN_START = new Set(["SR", "RN", "MR"]);
export const RUN_STOP  = new Set(["SP", "DN", "OF"]);

export function makeRun(key, start, end, startEv, stopEv, terminated, ongoing, inferred) {
  let kind = "run-scheduled";
  const manual = !!(startEv && (startEv.actCode === "MR" || startEv.trgCode === "US" || startEv.trgCode === "OP"));
  if (terminated || (stopEv && (stopEv.actCode === "PA" || stopEv.actCode === "DR"))) kind = "run-terminated";
  else if (manual) kind = "run-manual";
  const program = startEv ? (startEv.program != null ? startEv.program : startEv.progEff) : null;
  return { key: String(key), start, end, kind, manual, ongoing: !!ongoing, inferred: !!inferred, program };
}

// Pair start→stop events into runs. mode "program": PG SR/RN/MR → SP/DN/OF;
// "zone": ZN WT → DN; "mainline": ML RN → OF (ignoring DS/disable).
export function buildRunIntervals(evs, mode, globalEnd) {
  const groups = {};
  for (const e of evs) {
    if (mode === "program") {
      if (e.catCode !== "PG" || e.program == null) continue;
      (groups[e.program] = groups[e.program] || []).push(e);
    } else if (mode === "mainline") {
      if (e.catCode !== "ML" || e.mainline == null) continue;
      (groups[e.mainline] = groups[e.mainline] || []).push(e);
    } else {
      if (e.catCode !== "ZN" || !e.zones.length) continue;
      for (const z of e.zones) (groups[z] = groups[z] || []).push(e);
    }
  }
  // Zone runs open on WT (scheduled) or MR (manual run — logged as `ZN,MR,…,PG=MR`, no WT line).
  const startSet = mode === "program" ? RUN_START : mode === "mainline" ? new Set(["RN"]) : new Set(["WT", "MR"]);
  const stopSet  = mode === "program" ? RUN_STOP  : mode === "mainline" ? new Set(["OF"]) : new Set(["DN"]);

  // For zone mode, precompute the run-list signals used to close a run that never logs a DN:
  //   maxZnRlTs   — latest `ZN,RL` heartbeat anywhere (proves a zone left the active list when a
  //                 later run-list no longer names it), and
  //   mvPmStops   — sorted MV/PM shutdown times (fallback when a zone never appears in a run-list).
  let maxZnRlTs = 0;
  const mvPmStops = [];
  if (mode === "zone") {
    for (const e of evs) {
      if (e.catCode === "ZN" && e.actCode === "RL") { const t = e.ts.getTime(); if (t > maxZnRlTs) maxZnRlTs = t; }
      else if ((e.catCode === "MV" || e.catCode === "PM") && e.actCode === "DN") mvPmStops.push(e.ts.getTime());
    }
    mvPmStops.sort((a, b) => a - b);
  }

  const out = [];
  for (const key of Object.keys(groups)) {
    const list = groups[key].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    let open = null, openEv = null, lastSeen = null; // lastSeen = last `ZN,RL` ts that listed this zone
    for (const e of list) {
      const t = e.ts.getTime();
      if (startSet.has(e.actCode)) { if (open == null) { open = t; openEv = e; lastSeen = null; } }
      else if (stopSet.has(e.actCode)) { if (open != null) { out.push(makeRun(key, open, t, openEv, e)); open = null; openEv = null; lastSeen = null; } }
      else if ((e.actCode === "PA" || e.actCode === "DR") && open != null) { out.push(makeRun(key, open, t, openEv, e, true)); open = null; openEv = null; lastSeen = null; }
      else if (e.actCode === "RL" && open != null) { lastSeen = t; } // run-list heartbeat
    }
    if (open != null) {
      if (mode === "zone") out.push(closeOpenZoneRun(key, open, openEv, lastSeen, maxZnRlTs, mvPmStops, globalEnd));
      else out.push(makeRun(key, open, globalEnd, openEv, null, false, true));
    }
  }
  return out;
}

// Close a zone run that started but never logged a DN. The controller can keep commanding a faulted
// zone, so "ongoing to end-of-log" badly overstates the run. Infer the real end from the run-list:
//   Tier 1 — if the zone last appeared in a `ZN,RL` heartbeat before a later run-list (it dropped out
//            of the active list), it stopped then → close at that last heartbeat (terminated/inferred).
//   Tier 2 — if it never appeared in any run-list, fall back to the first MV/PM shutdown after it
//            started (the supply was cut) → close there (terminated/inferred).
//   Tier 3 — otherwise it's still in the final heartbeat / genuinely cut off by end-of-log → ongoing.
function closeOpenZoneRun(key, open, openEv, lastSeen, maxZnRlTs, mvPmStops, globalEnd) {
  if (lastSeen != null) {
    if (maxZnRlTs > lastSeen) return makeRun(key, open, lastSeen, openEv, null, true, false, true); // Tier 1
    return makeRun(key, open, globalEnd, openEv, null, false, true); // Tier 3: still in the last run-list
  }
  const stop = mvPmStops.find(t => t > open); // Tier 2
  if (stop != null) return makeRun(key, open, stop, openEv, null, true, false, true);
  return makeRun(key, open, globalEnd, openEv, null, false, true); // Tier 3
}
