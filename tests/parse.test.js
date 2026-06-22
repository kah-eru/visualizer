import { describe, it, expect } from "vitest";
import { parseTimestamp, parseRow, inferEffectivePrograms } from "../src/parse.js";

// helper: build a CSV row (array of columns) with a given time + trailing key=value/positional tokens
const row = (time, cat, act, trg, ...rest) => [`06/17/26 ${time} -0600`, cat, act, trg, ...rest];

describe("parseTimestamp", () => {
  it("parses MM/dd/yy HH:mm:ss with a trailing tz offset as wall-clock local", () => {
    const d = parseTimestamp("06/17/26 06:07:05 -0600");
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);   // June (0-based)
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(6);
    expect(d.getMinutes()).toBe(7);
    expect(d.getSeconds()).toBe(5);
  });

  it("expands a 2-digit year to 2000+ and accepts a 4-digit year", () => {
    expect(parseTimestamp("01/02/26 00:00:00").getFullYear()).toBe(2026);
    expect(parseTimestamp("01/02/2026 00:00:00").getFullYear()).toBe(2026);
  });

  it("returns null for empty/invalid input", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp("not a date at all")).toBeNull();
  });

  it("falls back to Date() for a non-matching but parseable string", () => {
    const d = parseTimestamp("2026-06-17T06:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(isNaN(d)).toBe(false);
  });
});

describe("parseRow", () => {
  it("returns null for empty rows or rows without a valid timestamp", () => {
    expect(parseRow([])).toBeNull();
    expect(parseRow([""])).toBeNull();
    expect(parseRow(["garbage", "ZN", "WT"])).toBeNull();
  });

  it("maps category/action/trigger codes to labels", () => {
    const e = parseRow(row("06:00:00", "PG", "SR", "DT", "PG=2"));
    expect(e.category).toBe("Program");
    expect(e.action).toBe("Start");
    expect(e.trigger).toBe("Date/Time");
    expect(e.program).toBe("2");
  });

  it("splits a semicolon zone list and keeps a single mainline", () => {
    const e = parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=1;2;3", "ML=4"));
    expect(e.zones).toEqual(["1", "2", "3"]);
    expect(e.mainline).toBe("4");
  });

  it("converts AC/EX flow GPM→L/min and PR pressure PSI→kPa at parse time", () => {
    const e = parseRow(row("06:00:00", "FS", "RD", "FS", "AC=47", "EX=46", "PR=63"));
    expect(e.pairs.AC.value).toBeCloseTo(177.9, 1); // 47 * 3.785
    expect(e.pairs.AC.unit).toBe("L/min");
    expect(e.pairs.PR.value).toBeCloseTo(434.3, 1); // 63 * 6.894
    expect(e.pairs.PR.unit).toBe("kPa");
    expect(e.flow).toBeCloseTo(177.9, 1); // flow = AC, else EX
  });

  it("flags alerts (AL category or ER action) and noise categories", () => {
    expect(parseRow(row("06:00:00", "AL", "FV", "FS")).isAlert).toBe(true);
    expect(parseRow(row("06:00:00", "PM", "ER", "PM")).isAlert).toBe(true);
    expect(parseRow(row("06:00:00", "PG", "SR", "DT")).isAlert).toBe(false);
    expect(parseRow(row("06:00:00", "SB", "ST", "SB")).isNoise).toBe(true);
    expect(parseRow(row("06:00:00", "PG", "SR", "DT")).isNoise).toBe(false);
  });

  it("collects key=value pairs and positional (no-'=') tokens into extras", () => {
    const e = parseRow(row("06:00:00", "AL", "ER", "FS", "ZN=2", "Valve Failure:Open Circuit Solenoid."));
    expect(e.pairs.ZN.raw).toBe("2");
    expect(e.extras).toContain("Valve Failure:Open Circuit Solenoid.");
  });

  it("preserves the original line in rawLine", () => {
    const cols = row("06:00:00", "PG", "SR", "DT", "PG=2");
    expect(parseRow(cols).rawLine).toBe(cols.join(","));
  });
});

describe("inferEffectivePrograms", () => {
  it("stamps a zone stop line lacking PG with the program that last ran that zone", () => {
    const events = [
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=5", "PG=2")), // zone 5 started by program 2
      parseRow(row("06:30:00", "ZN", "DN", "SY", "ZN=5")),          // zone 5 done, no PG
    ];
    inferEffectivePrograms(events);
    expect(events[0].progEff).toBe("2");
    expect(events[1].progEff).toBe("2"); // inherited
  });

  it("leaves progEff null when the zone has no known program and for non-zone/non-program events", () => {
    const events = [
      parseRow(row("06:00:00", "ZN", "DN", "SY", "ZN=9")), // never started by a program
      parseRow(row("06:01:00", "SY", "BT", "SY")),          // no zones, no program
    ];
    inferEffectivePrograms(events);
    expect(events[0].progEff).toBeNull();
    expect(events[1].progEff).toBeNull();
  });

  it("orders by timestamp (not array order) when inferring", () => {
    const events = [
      parseRow(row("06:30:00", "ZN", "DN", "SY", "ZN=5")),          // later, listed first
      parseRow(row("06:00:00", "ZN", "WT", "SY", "ZN=5", "PG=7")),  // earlier start
    ];
    inferEffectivePrograms(events);
    expect(events[0].progEff).toBe("7"); // the DN inherits the earlier-in-time start
  });
});
