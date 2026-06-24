/* ============================================================================
   Pure run-interval pairing (swimlane durations) — no DOM, no shared app state.
   Extracted from app.js so it can be unit-tested directly in Node.
   ========================================================================== */

export const RUN_START = new Set(["SR", "RN", "MR"]);
export const RUN_STOP  = new Set(["SP", "DN", "OF"]);

export function makeRun(key, start, end, startEv, stopEv, terminated, ongoing) {
  let kind = "run-scheduled";
  const manual = !!(startEv && (startEv.actCode === "MR" || startEv.trgCode === "US" || startEv.trgCode === "OP"));
  if (terminated || (stopEv && (stopEv.actCode === "PA" || stopEv.actCode === "DR"))) kind = "run-terminated";
  else if (manual) kind = "run-manual";
  const program = startEv ? (startEv.program != null ? startEv.program : startEv.progEff) : null;
  return { key: String(key), start, end, kind, manual, ongoing: !!ongoing, program };
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
  const out = [];
  for (const key of Object.keys(groups)) {
    const list = groups[key].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    let open = null, openEv = null;
    for (const e of list) {
      const t = e.ts.getTime();
      if (startSet.has(e.actCode)) { if (open == null) { open = t; openEv = e; } }
      else if (stopSet.has(e.actCode)) { if (open != null) { out.push(makeRun(key, open, t, openEv, e)); open = null; openEv = null; } }
      else if ((e.actCode === "PA" || e.actCode === "DR") && open != null) { out.push(makeRun(key, open, t, openEv, e, true)); open = null; openEv = null; }
    }
    if (open != null) out.push(makeRun(key, open, globalEnd, openEv, null, false, true));
  }
  return out;
}
