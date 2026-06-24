import { describe, it, expect } from "vitest";
import { parseRow } from "../src/parse.js";
import { makeRun, buildRunIntervals } from "../src/runs.js";

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
