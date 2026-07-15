/* ============================================================================
   Diagnostics shaping for the feedback/crash report.

   This module exists to make the project's #1 hard rule — CSV/event-log contents
   must never leave the browser — a TESTED invariant rather than a convention.

   The rule has two halves. `assembleReport` (feedback.js) is the single place the
   outgoing report is built, and it is already pinned by tests/feedback.test.js.
   This is the other half: the diagnostics object is the only part of that report
   derived from the loaded log, so it is the one place a leak would realistically
   be introduced (a "recent events" sample, a raw line attached to an error).

   Splitting the SHAPING (here, pure) from the DOM READS (getDiagnostics in app.js)
   is what lets a Node test import the real function. app.js touches the DOM at
   import time and can never be imported by a test; before this split the privacy
   test had to build its input from a hand-written copy of this shape, so a leak
   added to the real function would still have shipped green.

   Two properties keep the test honest — do not "simplify" either away:
     1. It takes the EVENT ARRAYS, not just their counts. A leak has to be
        expressible here for the test to be able to prove it doesn't happen.
     2. It PICKS filter keys explicitly instead of spreading `filters`. A spread
        would let a future leaky field ride through without this module — and
        therefore the test — ever seeing it.
   ========================================================================== */

// Snapshot of app state for the crash/feedback payload. Deliberately excludes ALL CSV row
// content — only the filename, counts, and current filter/view selections.
export function buildDiagnostics({
  fileName = null, allEvents = [], filtered = [], hasHydro = false, windowUnit = null,
  range = null, lanes = {}, flowOn = false, eventTlOn = false, filters = {},
} = {}) {
  const laneSize = g => (lanes[g] && typeof lanes[g].size === "number" ? lanes[g].size : 0);
  return {
    fileName: fileName || null,
    eventCount: allEvents.length,
    filteredCount: filtered.length,
    hasHydro,
    windowUnit,
    range: range ? { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() } : null,
    lanes: { program: laneSize("program"), zone: laneSize("zone"), mainline: laneSize("mainline") },
    flowOn, eventTlOn,
    // Explicit picks, not a spread — see the header note.
    filters: {
      category: filters.category ?? null, action: filters.action ?? null,
      trigger: filters.trigger ?? null, substation: filters.substation ?? null,
      alertsOnly: filters.alertsOnly ?? null, humanAudit: filters.humanAudit ?? null,
      showAdvanced: filters.showAdvanced ?? null,
      varMin: filters.varMin ?? null, varMax: filters.varMax ?? null,
    },
  };
}
