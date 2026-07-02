import { describe, it, expect } from "vitest";
import { parseRow } from "../src/parse.js";
import { makeRun, buildRunIntervals, zoneRunInProgram } from "../src/runs.js";

const row = (time, cat, act, trg, ...rest) => [`06/17/26 ${time} -0600`, cat, act, trg, ...rest];
const ms = (time) => parseRow(row(time, "SY", "BT", "SY")).ts.getTime();
const GLOBAL_END = ms("23:59:59");

describe("makeRun", () => {
  it("classifies a plain start/stop as scheduled", () => {
    expect(makeRun("1", 0, 100, { actCode: "SR" }, { actCode: "DN" }).kind).toBe("run-scheduled");
  });
  it("classifies a manual-run (MR) or User/Operator-triggered start as manual", () => {
    expect(makeRun("1", 0, 100, { actCode: "MR" }, null).kind).toBe("run-manual");
    expect(makeRun("1", 0, 100, { actCode: "SR", trgCode: "US" }, null).kind).toBe("run-manual");
    expect(makeRun("1", 0, 100, { actCode: "SR", trgCode: "OP" }, null).kind).toBe("run-manual");
  });
  it("classifies a pause/drop stop or explicit terminated flag as terminated", () => {
    expect(makeRun("1", 0, 100, { actCode: "SR" }, { actCode: "PA" }).kind).toBe("run-terminated");
    expect(makeRun("1", 0, 100, { actCode: "MR" }, null, true).kind).toBe("run-terminated");
  });
});

describe("buildRunIntervals — program mode (PG SR/RN/MR → SP/DN/OF)", () => {
  it("pairs a start with its stop into one scheduled run", () => {
    const evs = [
      parseRow(row("06:00:00", "PG", "SR", "DT", "PG=2")),
      parseRow(row("06:30:00", "PG", "DN", "DT", "PG=2")),
    ];
    const runs = buildRunIntervals(evs, "program", GLOBAL_END);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ key: "2", kind: "run-scheduled", ongoing: false });
    expect(runs[0].start).toBe(ms("06:00:00"));
    expect(runs[0].end).toBe(ms("06:30:00"));
  });

  it("closes an open run as terminated on a PA (pause)", () => {
    const evs = [
      parseRow(row("06:00:00", "PG", "SR", "DT", "PG=2")),
      parseRow(row("06:10:00", "PG", "PA", "US", "PG=2")),
    ];
    const runs = buildRunIntervals(evs, "program", GLOBAL_END);
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("run-terminated");
  });

  it("marks an unclosed run as ongoing, ending at globalEnd", () => {
    const evs = [parseRow(row("06:00:00", "PG", "SR", "DT", "PG=2"))];
    const runs = buildRunIntervals(evs, "program", GLOBAL_END);
    expect(runs).toHaveLength(1);
    expect(runs[0].ongoing).toBe(true);
    expect(runs[0].end).toBe(GLOBAL_END);
  });

  it("ignores non-program rows", () => {
    const evs = [parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=1"))];
    expect(buildRunIntervals(evs, "program", GLOBAL_END)).toHaveLength(0);
  });
});

describe("buildRunIntervals — zone mode (ZN WT → DN)", () => {
  it("pairs WT→DN per zone and groups multi-zone events", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=1;2")),
      parseRow(row("06:20:00", "ZN", "DN", "SY", "ZN=1")),
      parseRow(row("06:25:00", "ZN", "DN", "SY", "ZN=2")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    expect(runs.map(r => r.key).sort()).toEqual(["1", "2"]);
    expect(runs.find(r => r.key === "1").end).toBe(ms("06:20:00"));
    expect(runs.find(r => r.key === "2").end).toBe(ms("06:25:00"));
  });

  it("builds a manual zone run from MR→DN and flags it manual (controller logs ZN,MR,…,PG=MR)", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "MR", "SY", "ZN=12", "PG=MR")),
      parseRow(row("06:05:00", "ZN", "DN", "SY", "ZN=12")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ key: "12", kind: "run-manual", manual: true });
    expect(runs[0].start).toBe(ms("06:00:00"));
    expect(runs[0].end).toBe(ms("06:05:00"));
  });

  it("keeps a scheduled WT→DN zone run non-manual", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=13", "PG=13")),
      parseRow(row("06:30:00", "ZN", "DN", "SY", "ZN=13")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ key: "13", kind: "run-scheduled", manual: false });
  });

  it("closes a no-DN zone at its last run-list heartbeat when a later run-list drops it (Tier 1)", () => {
    // ZN 1 starts, appears in run-list through 06:03, then a later run-list lists only ZN 2 → ZN 1 left.
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=1", "PG=9")),
      parseRow(row("06:01:00", "ZN", "RL", "SY", "ZN=1;2")),
      parseRow(row("06:03:00", "ZN", "RL", "SY", "ZN=1;2")),
      parseRow(row("06:10:00", "ZN", "RL", "SY", "ZN=2")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    const z1 = runs.find(r => r.key === "1");
    expect(z1).toMatchObject({ kind: "run-terminated", inferred: true, ongoing: false });
    expect(z1.end).toBe(ms("06:03:00")); // last run-list that named ZN 1, not GLOBAL_END
  });

  it("keeps a no-DN zone ongoing when it is still in the final run-list (Tier 3)", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=1", "PG=9")),
      parseRow(row("06:01:00", "ZN", "RL", "SY", "ZN=1")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    const z1 = runs.find(r => r.key === "1");
    expect(z1.ongoing).toBe(true);
    expect(z1.inferred).toBe(false);
    expect(z1.end).toBe(GLOBAL_END);
  });

  it("falls back to MV/PM shutdown for a no-DN zone never seen in a run-list (Tier 2)", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=1", "PG=9")),
      parseRow(row("06:08:00", "MV", "DN", "SY", "ZN=204")),
      parseRow(row("06:08:00", "PM", "DN", "SY", "ZN=237")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    const z1 = runs.find(r => r.key === "1");
    expect(z1).toMatchObject({ kind: "run-terminated", inferred: true, ongoing: false });
    expect(z1.end).toBe(ms("06:08:00"));
  });

  it("splits a cycle-and-soak run into alternating water/soak segments (WT/SO/WT/SO/WT→DN)", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:10:00", "ZN", "SO", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:20:00", "ZN", "WT", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:30:00", "ZN", "SO", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:40:00", "ZN", "WT", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:50:00", "ZN", "DN", "SY", "ZN=4")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    expect(runs).toHaveLength(1); // still ONE run envelope
    const z = runs[0];
    expect(z.start).toBe(ms("06:00:00"));
    expect(z.end).toBe(ms("06:50:00"));
    expect(z.segments).toEqual([
      { s: ms("06:00:00"), e: ms("06:10:00"), soak: false },
      { s: ms("06:10:00"), e: ms("06:20:00"), soak: true },
      { s: ms("06:20:00"), e: ms("06:30:00"), soak: false },
      { s: ms("06:30:00"), e: ms("06:40:00"), soak: true },
      { s: ms("06:40:00"), e: ms("06:50:00"), soak: false },
    ]);
  });

  it("ends the last soak/water segment at a PA that terminates a soak run", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:10:00", "ZN", "SO", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:20:00", "ZN", "WT", "SY", "ZN=4", "PG=4")),
      parseRow(row("06:25:00", "ZN", "PA", "SY", "ZN=4", "PG=4")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("run-terminated");
    expect(runs[0].end).toBe(ms("06:25:00"));
    expect(runs[0].segments.at(-1)).toEqual({ s: ms("06:20:00"), e: ms("06:25:00"), soak: false });
  });

  it("attaches no segments to a plain WT→DN run with no soak (unchanged behavior)", () => {
    const evs = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=7", "PG=7")),
      parseRow(row("06:30:00", "ZN", "DN", "SY", "ZN=7")),
    ];
    const runs = buildRunIntervals(evs, "zone", GLOBAL_END);
    expect(runs[0].segments).toBeUndefined();
  });
});

describe("buildRunIntervals — mainline mode (ML RN → OF)", () => {
  it("pairs RN→OF per mainline", () => {
    const evs = [
      parseRow(row("06:00:00", "ML", "RN", "PG", "ML=1")),
      parseRow(row("06:40:00", "ML", "OF", "PG", "ML=1")),
    ];
    const runs = buildRunIntervals(evs, "mainline", GLOBAL_END);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ key: "1" });
    expect(runs[0].end).toBe(ms("06:40:00"));
  });
});

describe("zoneRunInProgram — program↔zone attribution with orphan fallback", () => {
  const zoneRun = { program: "1", start: ms("08:00:00"), end: ms("08:30:00") };
  const p3Runs = [{ start: ms("08:00:00"), end: ms("10:30:00") }]; // Program 3's run window

  it("returns true when the zone's PG tag matches the program lane (normal case)", () => {
    expect(zoneRunInProgram({ ...zoneRun, program: "3" }, "3", new Set(["3"]), p3Runs)).toBe(true);
  });

  it("returns true for an orphaned tag whose run overlaps the program's window", () => {
    // PG=1 corresponds to no real program run → attribute to P3 by time overlap.
    expect(zoneRunInProgram(zoneRun, "3", new Set(["3"]), p3Runs)).toBe(true);
  });

  it("returns false for an orphaned tag whose run does not overlap the program's window", () => {
    const late = { program: "1", start: ms("11:00:00"), end: ms("11:30:00") };
    expect(zoneRunInProgram(late, "3", new Set(["3"]), p3Runs)).toBe(false);
  });

  it("returns false when the tag is a real program elsewhere (no hijacking a legit tag)", () => {
    // PG=1 IS a real program run somewhere, so it is respected — not folded into P3 despite overlap.
    expect(zoneRunInProgram(zoneRun, "3", new Set(["1", "3"]), p3Runs)).toBe(false);
  });
});
