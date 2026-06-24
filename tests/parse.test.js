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

describe("enumerated value decoding (VALUE_ENUMS)", () => {
  it("decodes a status value (ST) into its display and decoded fields", () => {
    const e = parseRow(row("06:00:00", "ZN", "ST", "SY", "ST=RN"));
    expect(e.pairs.ST.decoded).toBe("Running");
    expect(e.pairs.ST.display).toBe("RN — Running");
    expect(e.pairs.ST.raw).toBe("RN"); // raw is preserved
  });

  it("decodes start/pause/stop causes (SC/PC/TC) on any line", () => {
    const e = parseRow(row("06:00:00", "PG", "SP", "SY", "TC=PD", "PC=RD"));
    expect(e.pairs.TC.decoded).toBe("Program Done");
    expect(e.pairs.PC.decoded).toBe("Rain Delay");
  });

  it("decodes message code/category (KD/KT) only on Message (MG) lines", () => {
    const e = parseRow(row("06:00:00", "MG", "ST", "SY", "KD=ZN_HFVS", "KT=ZN"));
    expect(e.pairs.KD.decoded).toBe("Zone High Flow Variance Shutdown");
    expect(e.pairs.KT.decoded).toBe("Zone");
  });

  it("treats PR as Message Priority on MG lines but Pressure (kPa) elsewhere", () => {
    const mg = parseRow(row("06:00:00", "MG", "ST", "SY", "PR=HI"));
    expect(mg.pairs.PR.decoded).toBe("High");

    const fs = parseRow(row("06:00:00", "FS", "RD", "FS", "PR=60"));
    expect(fs.pairs.PR.unit).toBe("kPa");          // numeric pressure, not decoded as priority
    expect(fs.pairs.PR.decoded).toBe("");
    expect(fs.pairs.PR.value).toBeCloseTo(413.6, 1); // 60 * 6.894
  });

  it("leaves unknown enum values undecoded (display falls back to raw)", () => {
    const e = parseRow(row("06:00:00", "ZN", "ST", "SY", "ST=ZZ"));
    expect(e.pairs.ST.decoded).toBe("");
    expect(e.pairs.ST.display).toBe("ZZ");
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
