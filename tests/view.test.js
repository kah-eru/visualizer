import { describe, it, expect } from "vitest";
import { parseRow } from "../src/parse.js";
import {
  matchesFilters, filterEvents, clampView, pxToTime, timeToPx, shiftRange, centeredRange,
  selectVisibleRuns, buildRunCoverIndex, runCoversAt, snapToEdges, jumpTitle,
} from "../src/view.js";

// view.js holds the logic extracted out of app.js — the filter predicate, window/nav math, minimap
// transforms, and the run selection/coverage builds. Before the extraction this was ~64% of the
// source with zero tests, and it is where the recent regressions actually landed.

const ev = (...cols) => parseRow(cols);
const T = "06/17/26 06:07:05 -0600";

/* ---------------------------------- filters ---------------------------------- */
describe("matchesFilters", () => {
  // Defaults matter: showAdvanced defaults false, so the baseline row must not be a noise category.
  const zoneRow = ev(T, "ZN", "WT", "DT", "PG=4", "ZN=12", "AC=10");

  it("passes a plain row when no filter is set", () => {
    expect(matchesFilters(zoneRow, {})).toBe(true);
  });

  describe("advanced / noise", () => {
    // NOISE_CATCODES: substation/network/two-wire chatter. Events1000.csv is 91% TW,ER.
    const noise = ev(T, "TW", "ER", "SY", "SN=5");
    it("hides noise categories by default", () => expect(matchesFilters(noise, {})).toBe(false));
    it("shows them when Advanced is on", () => expect(matchesFilters(noise, { showAdvanced: true })).toBe(true));
  });

  describe("category / action / trigger", () => {
    it("matches on the mapped label, not the raw code", () => {
      // The dropdowns are filled with CATEGORY_MAP labels, so the predicate compares labels.
      expect(matchesFilters(zoneRow, { category: "Zone" })).toBe(true);
      expect(matchesFilters(zoneRow, { category: "Program" })).toBe(false);
    });
    it("filters by action", () => {
      expect(matchesFilters(zoneRow, { action: zoneRow.action })).toBe(true);
      expect(matchesFilters(zoneRow, { action: "Not An Action" })).toBe(false);
    });
    it("filters by trigger", () => {
      expect(matchesFilters(zoneRow, { trigger: zoneRow.trigger })).toBe(true);
      expect(matchesFilters(zoneRow, { trigger: "Not A Trigger" })).toBe(false);
    });
  });

  describe("substation", () => {
    // A substation row identifies itself with SN, or SB on some categories — SN wins when both exist.
    const sn = ev(T, "SB", "RD", "SY", "SN=42");
    const sb = ev(T, "SB", "RD", "SY", "SB=42");
    const both = ev(T, "SB", "RD", "SY", "SN=42", "SB=99");
    const opts = { showAdvanced: true, substation: "42" };
    it("matches on SN", () => expect(matchesFilters(sn, opts)).toBe(true));
    it("falls back to SB when there is no SN", () => expect(matchesFilters(sb, opts)).toBe(true));
    it("prefers SN over SB when both are present", () => {
      expect(matchesFilters(both, opts)).toBe(true);
      expect(matchesFilters(both, { showAdvanced: true, substation: "99" })).toBe(false);
    });
    it("excludes a row with neither", () => expect(matchesFilters(zoneRow, { substation: "42" })).toBe(false));
  });

  describe("human audit", () => {
    // HUMAN_TRIGGERS = US/OP/PR/AD — the spec's four human tiers. DT (scheduled) is not one.
    it("keeps user-triggered rows", () => {
      expect(matchesFilters(ev(T, "ZN", "MR", "US", "ZN=12"), { humanAudit: true })).toBe(true);
    });
    it("drops scheduler-triggered rows", () => {
      expect(matchesFilters(zoneRow, { humanAudit: true })).toBe(false);
    });
  });

  describe("alerts only", () => {
    it("keeps alarms", () => expect(matchesFilters(ev(T, "AL", "ER", "SY"), { alertsOnly: true })).toBe(true));
    it("drops non-alarms", () => expect(matchesFilters(zoneRow, { alertsOnly: true })).toBe(false));
  });

  describe("min flow", () => {
    // e.flow is CONVERTED (AC gpm × 3.785 → L/min), and the slider is in the same units.
    it("compares against the converted flow", () => {
      expect(zoneRow.flow).toBeCloseTo(37.85, 2);
      expect(matchesFilters(zoneRow, { minFlow: 30 })).toBe(true);
      expect(matchesFilters(zoneRow, { minFlow: 40 })).toBe(false);
    });
    it("drops rows with no flow at all once a minimum is set", () => {
      expect(matchesFilters(ev(T, "ZN", "DN", "DT", "ZN=12"), { minFlow: 1 })).toBe(false);
    });
    it("keeps flowless rows when the minimum is 0 (the default)", () => {
      expect(matchesFilters(ev(T, "ZN", "DN", "DT", "ZN=12"), { minFlow: 0 })).toBe(true);
    });
  });

  describe("variance", () => {
    // |AC-EX|/|EX| — 10 vs 8 is 25%. Conversion cancels out, so the percentage is unit-free.
    const varied = ev(T, "ZN", "WT", "DT", "AC=10", "EX=8");
    it("is inert unless the log actually has telemetry", () => {
      // varActive requires hasHydro: a log with no AC/EX must not be emptied by a stray slider.
      expect(matchesFilters(zoneRow, { varMin: 50, varMax: 100, hasHydro: false })).toBe(true);
    });
    it("is inert at the full 0–100 range even with hydro", () => {
      expect(matchesFilters(zoneRow, { varMin: 0, varMax: 100, hasHydro: true })).toBe(true);
    });
    it("keeps a row inside the band", () => {
      expect(matchesFilters(varied, { varMin: 20, varMax: 30, hasHydro: true })).toBe(true);
    });
    it("drops a row outside the band", () => {
      expect(matchesFilters(varied, { varMin: 30, varMax: 100, hasHydro: true })).toBe(false);
    });
    it("drops rows with no computable variance when the band is active", () => {
      expect(matchesFilters(zoneRow, { varMin: 1, varMax: 100, hasHydro: true })).toBe(false);
    });
  });

  it("ANDs conditions together", () => {
    const opts = { category: "Zone", humanAudit: true };
    expect(matchesFilters(ev(T, "ZN", "MR", "US", "ZN=12"), opts)).toBe(true);
    expect(matchesFilters(ev(T, "ZN", "WT", "DT", "ZN=12"), opts)).toBe(false); // right category, wrong trigger
    expect(matchesFilters(ev(T, "PG", "SR", "US", "PG=1"), opts)).toBe(false);  // right trigger, wrong category
  });

  it("filterEvents applies the predicate across a list", () => {
    const evs = [zoneRow, ev(T, "AL", "ER", "SY"), ev(T, "TW", "ER", "SY")];
    expect(filterEvents(evs, {}).length).toBe(2);           // the TW noise row is hidden
    expect(filterEvents(evs, { alertsOnly: true }).length).toBe(1); // ...and only the AL alarm survives
  });
});

/* ------------------------------ window / nav math ------------------------------ */
describe("clampView", () => {
  const full = { s: 1000, e: 101000 };
  it("passes an in-bounds window through", () => {
    expect(clampView(2000, 5000, full)).toEqual({ s: 2000, e: 5000 });
  });
  it("clamps to the data span", () => {
    expect(clampView(-5000, 500000, full)).toEqual({ s: 1000, e: 101000 });
  });
  it("enforces a 1s minimum width", () => {
    expect(clampView(5000, 5000, full)).toEqual({ s: 5000, e: 6000 });
    expect(clampView(5000, 4000, full)).toEqual({ s: 5000, e: 6000 }); // inverted input
  });
  it("keeps a 1s window visible when the start is pinned to the far edge", () => {
    expect(clampView(101000, 101000, full)).toEqual({ s: 100000, e: 101000 });
  });
});

describe("minimap transforms", () => {
  const full = { s: 1000, e: 11000 }, W = 500;
  it("maps px → time", () => {
    expect(pxToTime(0, W, full)).toBe(1000);
    expect(pxToTime(500, W, full)).toBe(11000);
    expect(pxToTime(250, W, full)).toBe(6000);
  });
  it("maps time → px", () => {
    expect(timeToPx(1000, W, full)).toBe(0);
    expect(timeToPx(11000, W, full)).toBe(500);
    expect(timeToPx(6000, W, full)).toBe(250);
  });
  it("round-trips", () => {
    for (const t of [1000, 3456, 6000, 11000]) expect(pxToTime(timeToPx(t, W, full), W, full)).toBeCloseTo(t, 6);
  });
});

describe("shiftRange", () => {
  const r = { start: 1000, end: 3000 };
  it("steps forward one width", () => expect(shiftRange(r, 1)).toEqual({ start: 3000, end: 5000 }));
  it("steps back one width", () => expect(shiftRange(r, -1)).toEqual({ start: -1000, end: 1000 }));
  it("preserves width", () => {
    const out = shiftRange(r, 1);
    expect(out.end - out.start).toBe(r.end - r.start);
  });
});

describe("centeredRange", () => {
  it("centers a window of the given width on t", () => {
    expect(centeredRange(5000, 2000)).toEqual({ start: 4000, end: 6000 });
  });
});

/* ------------------------------ run selection ------------------------------ */
const run = (key, start, end, extra = {}) => ({ key, start, end, ...extra });
const colorFor = (group, key) => `${group}:${key}`;

describe("selectVisibleRuns", () => {
  const runsByMode = {
    program: [run("1", 0, 100), run("2", 0, 100, { manual: true })],
    zone: [run("12", 10, 50), run("13", 10, 50, { manual: true })],
    mainline: [run("1", 0, 100)],
  };
  const sel = (p = [], z = [], m = []) => ({ program: new Set(p), zone: new Set(z), mainline: new Set(m) });

  it("returns nothing when no lane is selected and nothing is manual", () => {
    const out = selectVisibleRuns({ ...runsByMode, zone: [run("12", 10, 50)] }, sel(), { showManual: false }, colorFor);
    expect(out).toEqual([]);
  });

  it("tags each run with its group and color", () => {
    // showManual defaults on, so manual zone 13 rides along via the manual-runs pass below.
    const out = selectVisibleRuns(runsByMode, sel(["1"], [], ["1"]), {}, colorFor);
    expect(out.map(r => [r.group, r.key, r.color])).toEqual([
      ["Mainline", "1", "Mainline:1"], ["Program", "1", "Program:1"], ["Zone", "13", "Zone:13"],
    ]);
  });

  it("honours the run-type toggles for programs and zones", () => {
    const all = sel(["1", "2"], ["12", "13"], []);
    const scheduledOnly = selectVisibleRuns(runsByMode, all, { showScheduled: true, showManual: false }, colorFor);
    expect(scheduledOnly.map(r => r.key)).toEqual(["1", "12"]);
    const manualOnly = selectVisibleRuns(runsByMode, all, { showScheduled: false, showManual: true }, colorFor);
    expect(manualOnly.map(r => r.key)).toEqual(["2", "13"]);
  });

  it("does NOT apply the run-type toggles to mainlines", () => {
    // Mainlines have no manual/scheduled distinction; unchecking Scheduled must not blank them.
    const out = selectVisibleRuns(runsByMode, sel([], [], ["1"]), { showScheduled: false, showManual: false }, colorFor);
    expect(out.map(r => r.group)).toEqual(["Mainline"]);
  });

  it("lists manual zone runs even when the Zones dropdown is empty", () => {
    // The Zones lane picker starts empty (104 zones in a real log), which is exactly why a live demo
    // showed no manual activity in the At Playhead panel. Manual zone runs bypass that selection.
    const out = selectVisibleRuns(runsByMode, sel(), { showManual: true }, colorFor);
    expect(out.map(r => [r.group, r.key])).toEqual([["Zone", "13"]]);
  });

  it("lists a selected manual zone run exactly once", () => {
    // A zone can be both selected AND manual — the dedupe by group|key|start is what stops the
    // panel double-listing it.
    const out = selectVisibleRuns(runsByMode, sel([], ["13"], []), { showManual: true }, colorFor);
    expect(out.filter(r => r.key === "13").length).toBe(1);
  });

  it("keeps manual runs out entirely when Manual is unchecked", () => {
    const out = selectVisibleRuns(runsByMode, sel([], ["13"], []), { showManual: false }, colorFor);
    expect(out).toEqual([]);
  });

  it("copies runs rather than aliasing them", () => {
    const out = selectVisibleRuns(runsByMode, sel(["1"], [], []), {}, colorFor);
    expect(out[0]).not.toBe(runsByMode.program[0]);
    expect(runsByMode.program[0].group).toBeUndefined(); // the source run stays untagged
  });
});

describe("run coverage", () => {
  const index = buildRunCoverIndex({
    zone: [run("12", 100, 200), run("12", 300, 400)],
    program: [run("1", 0, 500)],
    mainline: [],
  });

  it("finds a ts inside a run", () => expect(runCoversAt(index, "Zone", "12", 150)).toBe(true));
  it("rejects a ts between runs", () => expect(runCoversAt(index, "Zone", "12", 250)).toBe(false));
  it("treats both bounds as inclusive, matching the drawn bar", () => {
    // The end bound is inclusive on purpose: Snap is on by default and parks the playhead exactly on
    // a run edge, and eventJumpTarget asks this before offering a ↗ button.
    expect(runCoversAt(index, "Zone", "12", 100)).toBe(true);
    expect(runCoversAt(index, "Zone", "12", 200)).toBe(true);
  });
  it("separates groups that share a key", () => {
    expect(runCoversAt(index, "Program", "1", 250)).toBe(true);
    expect(runCoversAt(index, "Mainline", "1", 250)).toBe(false);
  });
  it("returns false for an unknown key or group", () => {
    expect(runCoversAt(index, "Zone", "999", 150)).toBe(false);
    expect(runCoversAt(index, "Nope", "12", 150)).toBe(false);
  });
  it("coerces numeric keys to strings", () => {
    // eventRunTarget hands over whatever the pairs held; the index is string-keyed.
    expect(runCoversAt(index, "Zone", 12, 150)).toBe(true);
  });
  it("tolerates a missing mode", () => {
    expect(() => buildRunCoverIndex({ zone: [run("1", 0, 1)] })).not.toThrow();
  });
});

/* ------------------------------ scrubber snapping ------------------------------ */
describe("snapToEdges", () => {
  // 1px per ms, so pixel tolerance and ms are interchangeable in this fixture.
  const pxOf = ms => ms;
  const runs = [run("a", 100, 200)];

  it("snaps to a nearby start edge", () => expect(snapToEdges(103, runs, pxOf)).toBe(100));
  it("snaps to a nearby end edge", () => expect(snapToEdges(197, runs, pxOf)).toBe(200));
  it("leaves a t outside the tolerance alone", () => expect(snapToEdges(150, runs, pxOf)).toBe(150));
  it("respects the tolerance boundary", () => {
    expect(snapToEdges(107, runs, pxOf, 8)).toBe(100);
    expect(snapToEdges(109, runs, pxOf, 8)).toBe(109);
  });
  it("picks the nearest edge when two are in range", () => {
    const tight = [run("a", 100, 104)];
    expect(snapToEdges(103, tight, pxOf)).toBe(104);
  });
  it("returns t unchanged with no runs", () => expect(snapToEdges(150, [], pxOf)).toBe(150));
  it("measures in pixels, not ms — so the feel is zoom-independent", () => {
    // Zoomed out 100 ms/px, a 300 ms gap is 3 px away and should still snap.
    expect(snapToEdges(400, runs, ms => ms / 100)).toBe(200);
  });
});

/* ------------------------------ jump tooltip ------------------------------ */
describe("jumpTitle", () => {
  const ts = Date.UTC(2026, 5, 17, 6, 7, 5);
  it("describes a main-timeline jump and its marks", () => {
    const s = jumpTitle({ dest: "timeline", bar: true, tick: false, diamond: false }, ts);
    expect(s).toContain("Scroll up to the timeline");
    expect(s).toContain("rings its run bar");
    expect(s).not.toContain("Switches the Events timeline on");
  });
  it("warns that an events-routed jump switches the card on", () => {
    const s = jumpTitle({ dest: "events", bar: false, tick: false, diamond: true }, ts);
    expect(s).toContain("Interventions & Alerts timeline");
    expect(s).toContain("Switches the Events timeline on if it's off.");
  });
  it("joins multiple marks", () => {
    const s = jumpTitle({ dest: "timeline", bar: true, tick: true, diamond: false }, ts);
    expect(s).toContain("rings its run bar, rings its red alert tick");
  });
});
