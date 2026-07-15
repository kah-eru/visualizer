import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { parseRow } from "../src/parse.js";
import { buildDiagnostics } from "../src/diagnostics.js";

// The project's #1 hard rule: CSV/event-log CONTENTS must never leave the browser. The feedback
// report may carry only filename, counts, and filter/view state. assembleReport() in feedback.js
// is the single place the outgoing report is built (buildPayload/send/download all go through it),
// so pinning it here turns the privacy promise into a CI-gated invariant.
//
// The chain under test is the REAL one on both halves: buildDiagnostics (the pure shaping behind
// app.js's getDiagnostics — the only part of the report derived from the loaded log) feeds the real
// assembleReport. This test used to build its input from a hand-written copy of the diagnostics
// shape, which meant a leak added to the real function would still have passed here.
//
// feedback.js (via errors.js) touches window at import time, and assembleReport reads
// location/navigator/window — provide the same minimal shims errors.test.js uses (no jsdom dep).
let assembleReport, pushError, getErrorLog;
beforeAll(async () => {
  globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720 };
  globalThis.location = { href: "http://localhost/visualizer/" };
  if (typeof globalThis.navigator === "undefined" || !globalThis.navigator.userAgent) {
    try { Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test-ua" }, configurable: true }); } catch { /* Node ≥21 exposes a real navigator — fine */ }
  }
  ({ getErrorLog, pushError } = await import("../src/errors.js"));
  ({ assembleReport } = await import("../src/feedback.js"));
});

// Synthetic rows shaped like real controller log lines, parsed by the REAL parser so the events
// carry everything a leak could expose: rawLine, key=value pairs, free-text extras, timestamps.
// The values are distinctive markers we can grep the serialized report for.
//
// The numbers are deliberately long, and the decimals keep their dot: the report legitimately carries
// ISO timestamps (capturedAt, each error's time) and a viewport, so a SHORT numeric marker matches the
// report's own digits by coincidence — the original "AC=47" made `not.toContain("47")` fail during minute
// :47 of every hour, reddening a clean tree (and the deploy gate) ~1 minute in 60. Markers must be
// implausible as timestamp/viewport substrings; a dot can't appear inside an ISO field either.
const ROWS = [
  ["06/17/26 06:07:05 -0600", "ZN", "WT", "DT", "PG=414141", "ZN=777777", "AC=4747.47"],
  ["06/17/26 06:09:00 -0600", "AL", "ER", "SY", "TX=SECRET-VALVE-FAILURE", "Open Circuit Solenoid MARKER-EXTRA"],
  ["06/17/26 06:10:00 -0600", "MS", "RD", "SY", "SN=SECRETSN99", "VP=1212.31"],
];

// The REAL shaping function, handed the parsed events themselves — exactly what app.js hands it.
// This is the point of the split: buildDiagnostics CAN see every row, so if it ever starts emitting
// row content (a "recent events" sample, a raw line on an error), the assertions below catch it.
//
// Filters stay at their defaults on purpose. Their selected VALUES are legitimately carried by the
// report (they're the user's current filter state), and substation in particular is chosen from a
// dropdown populated out of the log's own SN/SB pairs — so seeding a marker here would appear in the
// report by design and prove nothing. The invariant under test is that no event content reaches the
// report through the event arrays.
function diagnosticsFor(events) {
  return buildDiagnostics({
    fileName: "Evnt_flow_test.csv",
    allEvents: events,
    filtered: events,
    hasHydro: true,
    windowUnit: "day",
    range: { start: Date.UTC(2026, 5, 17), end: Date.UTC(2026, 5, 18) },
    lanes: { program: new Set(["1"]), zone: new Set(), mainline: new Set(["1"]) },
    flowOn: false, eventTlOn: false,
    filters: { category: "", action: "", trigger: "", substation: "", alertsOnly: false, humanAudit: false, showAdvanced: false, varMin: "0", varMax: "100" },
  });
}

afterEach(() => { vi.useRealTimers(); });

describe("feedback report privacy invariant", () => {
  it("the serialized report contains no CSV row content — raw lines, pair values, or extras", () => {
    // Freeze the clock on a deliberately hostile instant — 15:47:47.477, every field packed with the
    // digits the markers above are built from — so the timestamp-collision case the old fixture tripped
    // over is covered on EVERY run instead of once an hour. capturedAt and the error's time both use it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T15:47:47.477Z"));
    const events = ROWS.map(parseRow);
    pushError("test", "renderFeed blew up"); // a plausible captured error — no row content in it
    const report = assembleReport({
      message: "the chart looks wrong",
      email: "user@example.com",
      diagnostics: diagnosticsFor(events),
      errors: getErrorLog(),
    });
    const s = JSON.stringify(report);
    for (const e of events) {
      expect(s).not.toContain(e.rawLine);                       // whole raw CSV line
      expect(s).not.toContain(e.tsRaw);                         // row timestamp string
      for (const k of Object.keys(e.pairs)) expect(s).not.toContain(e.pairs[k].raw); // key=value values
      for (const x of e.extras) expect(s).not.toContain(x);     // free-text tokens (alarm reasons)
    }
    // belt & braces on the distinctive markers themselves
    for (const marker of ["SECRET-VALVE-FAILURE", "MARKER-EXTRA", "SECRETSN99", "ZN=777"]) {
      expect(s).not.toContain(marker);
    }
  });

  it("the report carries exactly the whitelisted top-level keys (adding a field must be deliberate)", () => {
    const report = assembleReport({ message: "", email: "", diagnostics: {}, errors: [] });
    expect(Object.keys(report).sort()).toEqual(
      ["buildTime", "capturedAt", "diagnostics", "email", "errors", "message", "url", "userAgent", "version", "viewport"].sort()
    );
  });
});
