import { describe, it, expect, beforeAll } from "vitest";
import { parseRow } from "../src/parse.js";

// The project's #1 hard rule: CSV/event-log CONTENTS must never leave the browser. The feedback
// report may carry only filename, counts, and filter/view state. assembleReport() in feedback.js
// is the single place the outgoing report is built (buildPayload/send/download all go through it),
// so pinning it here turns the privacy promise into a CI-gated invariant.
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
const ROWS = [
  ["06/17/26 06:07:05 -0600", "ZN", "WT", "DT", "PG=41", "ZN=777", "AC=47"],
  ["06/17/26 06:09:00 -0600", "AL", "ER", "SY", "TX=SECRET-VALVE-FAILURE", "Open Circuit Solenoid MARKER-EXTRA"],
  ["06/17/26 06:10:00 -0600", "MS", "RD", "SY", "SN=SECRETSN99", "VP=12.3"],
];

// Mirrors the shape getDiagnostics() (app.js) returns: filename + counts + filter/view state only.
function diagnosticsFor(events) {
  return {
    fileName: "Evnt_flow_test.csv",
    eventCount: events.length,
    filteredCount: events.length,
    hasHydro: true,
    windowUnit: "day",
    range: { start: "2026-06-17T00:00:00.000Z", end: "2026-06-18T00:00:00.000Z" },
    lanes: { program: 1, zone: 0, mainline: 1 },
    flowOn: false, eventTlOn: false,
    filters: { category: "", action: "", trigger: "", substation: "", alertsOnly: false, humanAudit: false, showAdvanced: false, varMin: "0", varMax: "100" },
  };
}

describe("feedback report privacy invariant", () => {
  it("the serialized report contains no CSV row content — raw lines, pair values, or extras", () => {
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
