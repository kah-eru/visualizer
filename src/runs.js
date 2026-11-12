/* ============================================================================
   Pure run-interval pairing (swimlane durations) — no DOM, no shared app state.
   Extracted from app.js so it can be unit-tested directly in Node.
   ========================================================================== */
import { HUMAN_TRIGGERS } from "./constants.js";

// Program run starts. WT also starts (or resumes) a program run: some controllers log PG SR then PA
// in the same second, then PG WT when watering really starts hours later. app.js findRunStartEvent
// uses this set to resolve a Program bar click back to its start event.
export const RUN_START = new Set(["SR", "RN", "MR", "WT"]);
export const RUN_STOP  = new Set(["SP", "DN", "OF"]);

export function makeRun(key, start, end, startEv, stopEv, terminated, ongoing, inferred) {
  let kind = "run-scheduled";
  const manual = !!(startEv && (startEv.actCode === "MR" || HUMAN_TRIGGERS.has(startEv.trgCode)));
  if (terminated || (stopEv && (stopEv.actCode === "PA" || stopEv.actCode === "DR"))) kind = "run-terminated";
  else if (manual) kind = "run-manual";
  const program = startEv ? (startEv.program != null ? startEv.program : startEv.progEff) : null;
  return { key: String(key), start, end, kind, manual, ongoing: !!ongoing, inferred: !!inferred, program };
}

// Pair start→stop events into runs. mode "program": PG SR/RN/MR/WT → SP/DN/OF;
// "zone": ZN WT/MR → DN; "mainline": ML RN → OF (ignoring DS/disable). PA/DR terminate an open run
// in every mode; DS (disabled) also terminates one in zone mode only. A run with end <= start is
// dropped: a zero-length bar is not a run.
export function buildRunIntervals(evs, mode, globalEnd) {
  const groups = Object.create(null);
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
  const termSet  = new Set(mode === "zone" ? ["PA", "DR", "DS"] : ["PA", "DR"]);

  // For zone mode, precompute the run-list signals used to close a run that never logs a DN:
  //   maxZnRlTs   — latest `ZN,RL` heartbeat anywhere (proves a zone left the active list when a
  //                 later run-list no longer names it), and
  //   mvPmStops   — sorted MV/PM shutdown events (fallback with explicit shared supply identity).
  let maxZnRlTs = 0;
  const mvPmStops = [], heartbeats = [];
  if (mode === "zone") {
    for (const e of evs) {
      if (e.catCode === "ZN" && e.actCode === "RL") { const t = e.ts.getTime(); heartbeats.push(t); if (t > maxZnRlTs) maxZnRlTs = t; }
      else if ((e.catCode === "MV" || e.catCode === "PM") && e.actCode === "DN") mvPmStops.push(e);
    }
    heartbeats.sort((a, b) => a - b);
    mvPmStops.sort((a, b) => a.ts - b.ts);
  }

  const out = [];
  for (const key of Object.keys(groups)) {
    const list = groups[key].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    // lastSeen = last `ZN,RL` ts that listed this zone; marks = ordered water/soak boundaries within
    // the open run (cycle-and-soak), used to split a zone bar into watering vs soak segments.
    let open = null, openEv = null, lastSeen = null, marks = null;
    let heartbeatIndex = 0;
    // Attach soak segments (zone mode only) to a run that actually soaked, leaving non-soak runs
    // byte-identical to before. endT closes the final segment.
    const attachSegs = (run, endT) => {
      if (mode === "zone" && marks && marks.some(m => m.type === "soak")) run.segments = buildSoakSegments(marks, endT);
      return run;
    };
    for (const e of list) {
      const t = e.ts.getTime();
      const isStart = startSet.has(e.actCode), isStop = stopSet.has(e.actCode), isTerm = termSet.has(e.actCode);
      // Zone left the run-list before this start/stop: a later heartbeat (strictly before t) no longer
      // names it. Close at its last listing instead — a later start is a new session, and a late stop
      // would overstate the run. An explicit SO still means the controller is between watering cycles,
      // where absence from the watering list is expected. heartbeats is empty outside zone mode.
      if (open != null && (isStart || isStop || isTerm)) {
        while (heartbeatIndex < heartbeats.length && heartbeats[heartbeatIndex] < t) heartbeatIndex++;
        if (marks.at(-1).type !== "soak" && lastSeen != null && heartbeats[heartbeatIndex - 1] > lastSeen) {
          out.push(attachSegs(makeRun(key, open, lastSeen, openEv, null, true, false, true), lastSeen));
          open = null;
          if (!isStart) continue; // the late stop has nothing left to close
        }
      }
      if (isStart) {
        if (open == null) { open = t; openEv = e; lastSeen = null; marks = [{ t, type: "water" }]; }
        else { marks.push({ t, type: "water" }); lastSeen = null; } // soak ended, next cycle begins
      }
      else if (isStop) { if (open != null) { out.push(attachSegs(makeRun(key, open, t, openEv, e), t)); open = null; openEv = null; lastSeen = null; marks = null; } }
      else if (isTerm && open != null) { out.push(attachSegs(makeRun(key, open, t, openEv, e, true), t)); open = null; openEv = null; lastSeen = null; marks = null; }
      else if (e.actCode === "SO" && open != null) { marks.push({ t, type: "soak" }); } // soak begins (cycle done)
      else if (e.actCode === "RL" && open != null) { lastSeen = t; } // run-list heartbeat
    }
    if (open != null) {
      const run = mode === "zone" && marks.at(-1).type !== "soak" ? closeOpenZoneRun(key, open, openEv, lastSeen, maxZnRlTs, mvPmStops, globalEnd, marks.at(-1).t)
        : makeRun(key, open, globalEnd, openEv, null, false, true);
      out.push(attachSegs(run, run.end));
    }
  }
  return out.filter(r => r.end > r.start);
}

// Merge runs into their covering spans, collecting the distinct keys in each — the envelope drawn on
// the Manual Runs parent track. Derived from the runs themselves (not the controller's MR,SR/MR,SP
// session rows) so the parent can never disagree with the child rows below it, and so a log that
// flags runs manual by human trigger alone still gets a parent bar. Abutting spans (prev.end === s)
// merge: two back-to-back manual runs read as one stretch of hand-watering.
export function mergeSpans(runs) {
  const out = [];
  for (const r of [...runs].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const prev = out[out.length - 1];
    if (prev && r.start <= prev.end) { if (r.end > prev.end) prev.end = r.end; if (!prev.keys.includes(r.key)) prev.keys.push(r.key); }
    else out.push({ start: r.start, end: r.end, keys: [r.key] });
  }
  return out;
}

// A zone run belongs to a program lane when its PG tag matches that program, OR — when its tag
// corresponds to no real program run anywhere (orphaned, e.g. a ZN,WT line stamped with a program
// that never started) — when the run overlaps one of that program's run windows. This recovers the
// program a zone actually watered under from time overlap.
export function zoneRunInProgram(zoneRun, progKey, realProgTags, progRunsForKey) {
  if (String(zoneRun.program) === String(progKey)) return true;   // normal: PG matches
  if (realProgTags.has(String(zoneRun.program))) return false;    // tag is a real program elsewhere — respect it
  return progRunsForKey.some(pr => zoneRun.start < pr.end && zoneRun.end > pr.start); // orphan → overlap
}

// Split a zone run into alternating watering/soak segments from its ordered boundary marks
// (marks[0] is the opening WT). Each mark runs until the next one, or `end` for the last.
function buildSoakSegments(marks, end) {
  const segs = [];
  for (let i = 0; i < marks.length; i++) {
    const s = marks[i].t, e = i + 1 < marks.length ? marks[i + 1].t : end;
    if (e > s) segs.push({ s, e, soak: marks[i].type === "soak" });
  }
  return segs;
}

// Close a zone run that started but never logged a DN. The controller can keep commanding a faulted
// zone, so "ongoing to end-of-log" badly overstates the run. Infer the real end from the run-list:
//   Tier 1 — if the zone last appeared in a `ZN,RL` heartbeat before a later run-list (it dropped out
//            of the active list), it stopped then → close at that last heartbeat (terminated/inferred).
//   Tier 2 — if it never appeared in any run-list, a shutdown of its explicitly linked supply
//            closes the run. Missing topology cannot establish which zone lost its supply.
//   Tier 3 — otherwise it's still in the final heartbeat / genuinely cut off by end-of-log → ongoing.
function closeOpenZoneRun(key, open, openEv, lastSeen, maxZnRlTs, mvPmStops, globalEnd, lastWater) {
  if (lastSeen != null) {
    if (maxZnRlTs > lastSeen) return makeRun(key, open, lastSeen, openEv, null, true, false, true); // Tier 1
    return makeRun(key, open, globalEnd, openEv, null, false, true); // Tier 3: still in the last run-list
  }
  const stop = mvPmStops.find(e => e.ts.getTime() > lastWater && sharesSupply(openEv, e)); // Tier 2
  if (stop != null) return makeRun(key, open, stop.ts.getTime(), openEv, null, true, false, true);
  return makeRun(key, open, globalEnd, openEv, null, false, true); // Tier 3
}

function sharesSupply(zone, stop) {
  let matched = false;
  for (const key of ["ML", "CP", "WS", "MV", "PM"]) {
    const a = zone.pairs[key]?.raw;
    const b = stop.pairs[key]?.raw ?? (stop.catCode === key && stop.zones.length === 1 ? stop.zones[0] : null);
    if (a == null || b == null) continue;
    if (a !== b) return false;
    matched = true;
  }
  return matched;
}
