import { describe, it, expect } from "vitest";
import { buildDiagnostics } from "../src/diagnostics.js";
import { parseRow } from "../src/parse.js";

// buildDiagnostics is the only part of the feedback report derived from the loaded log, so it is
// where a privacy leak would realistically be introduced. tests/feedback.test.js proves no row
// content survives into the serialized report; this file pins the SHAPE, so adding a field to the
// payload is a deliberate, reviewed act rather than something that rides along unnoticed.

const EVENTS = [
  ["06/17/26 06:07:05 -0600", "ZN", "WT", "DT", "PG=414141", "ZN=777777", "AC=4747.47"],
  ["06/17/26 06:09:00 -0600", "AL", "ER", "SY", "TX=SECRET-VALVE-FAILURE", "Open Circuit MARKER-EXTRA"],
].map(parseRow);

const FULL = {
  fileName: "Evnt_flow_test.csv",
  allEvents: EVENTS, filtered: [EVENTS[0]],
  hasHydro: true, windowUnit: "day",
  range: { start: Date.UTC(2026, 5, 17), end: Date.UTC(2026, 5, 18) },
  lanes: { program: new Set(["1", "2"]), zone: new Set(), mainline: new Set(["1"]) },
  flowOn: true, eventTlOn: false,
  filters: { category: "ZN", action: "WT", trigger: "DT", substation: "", alertsOnly: false, humanAudit: true, showAdvanced: false, varMin: "0", varMax: "100" },
};

describe("buildDiagnostics", () => {
  it("carries exactly the whitelisted top-level keys (adding a field must be deliberate)", () => {
    expect(Object.keys(buildDiagnostics(FULL)).sort()).toEqual(
      ["eventCount", "eventTlOn", "fileName", "filteredCount", "filters", "flowOn", "hasHydro", "lanes", "range", "windowUnit"].sort()
    );
  });

  it("carries exactly the whitelisted filter keys — filters are picked, never spread", () => {
    // A spread would let a future leaky filter field through without this module (or the privacy
    // test) ever seeing it, so an unknown key must be dropped rather than copied.
    const d = buildDiagnostics({ ...FULL, filters: { ...FULL.filters, rawLineSample: "06/17/26,ZN,WT,DT,PG=414141" } });
    expect(Object.keys(d.filters).sort()).toEqual(
      ["action", "alertsOnly", "category", "humanAudit", "showAdvanced", "substation", "trigger", "varMax", "varMin"].sort()
    );
    expect(JSON.stringify(d)).not.toContain("PG=414141");
  });

  it("reduces events to counts and lanes to sizes — never the objects themselves", () => {
    const d = buildDiagnostics(FULL);
    expect(d.eventCount).toBe(2);
    expect(d.filteredCount).toBe(1);
    expect(d.lanes).toEqual({ program: 2, zone: 0, mainline: 1 });
  });

  it("normalizes the range to ISO strings", () => {
    expect(buildDiagnostics(FULL).range).toEqual({
      start: "2026-06-17T00:00:00.000Z", end: "2026-06-18T00:00:00.000Z",
    });
  });

  it("survives being called before any data is loaded", () => {
    // getDiagnostics() swallows currentRange()'s throw and passes range:null; the feedback button
    // works on an empty app, so this path ships whenever someone reports a load failure.
    const d = buildDiagnostics();
    expect(d).toMatchObject({ fileName: null, eventCount: 0, filteredCount: 0, range: null });
    expect(d.lanes).toEqual({ program: 0, zone: 0, mainline: 0 });
  });
});
