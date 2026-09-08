import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  escapeHtml, numCmp, distinctSorted, fmtTime, fmtTimeDate, fmtDuration,
  windowLabel, snapWindow, centeredWindow, eventVariancePct, categoryColor, toLocalInput, fromLocalInput,
} from "../src/format.js";

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const T = new Date(2026, 5, 17, 6, 7, 5).getTime(); // a fixed instant

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("numCmp / distinctSorted", () => {
  it("sorts numerically first, then lexically", () => {
    expect(numCmp("2", "10")).toBeLessThan(0);
    expect(numCmp("10", "2")).toBeGreaterThan(0);
    expect(numCmp("a", "b")).toBeLessThan(0); // non-numeric → localeCompare
  });
  it("dedupes, drops null/empty, and sorts numerically", () => {
    expect(distinctSorted(["3", "1", "2", "1", null, "", "10"])).toEqual(["1", "2", "3", "10"]);
  });
});

describe("fmtDuration", () => {
  it("formats minutes, hours+minutes, and whole hours", () => {
    expect(fmtDuration(30 * MIN)).toBe("30 min");
    expect(fmtDuration(59 * MIN)).toBe("59 min");
    expect(fmtDuration(60 * MIN)).toBe("1h");
    expect(fmtDuration(90 * MIN)).toBe("1h 30m");
    expect(fmtDuration(120 * MIN)).toBe("2h");
  });
});

describe("fmtTime / fmtTimeDate (locale-tolerant structural checks)", () => {
  it("includes seconds for a sub-3-minute span", () => {
    expect(fmtTime(T, 60000)).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
  it("drops seconds for an intra-2-day span", () => {
    const s = fmtTime(T, HOUR);
    expect(s).toMatch(/\d{1,2}:\d{2}/);
    expect(s).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
  it("adds a calendar date for spans beyond 2 days (longer than the intra-day form)", () => {
    expect(fmtTime(T, 3 * DAY).length).toBeGreaterThan(fmtTime(T, HOUR).length);
  });
  it("fmtTimeDate always includes the date (longer than bare fmtTime)", () => {
    expect(fmtTimeDate(T, HOUR).length).toBeGreaterThan(fmtTime(T, HOUR).length);
  });
});

describe("windowLabel", () => {
  it("maps a span (ms) to its natural unit", () => {
    expect(windowLabel(1000)).toBe("second");
    expect(windowLabel(60000)).toBe("minute");
    expect(windowLabel(HOUR)).toBe("hour");
    expect(windowLabel(DAY)).toBe("day");
    expect(windowLabel(7 * DAY)).toBe("week");
    expect(windowLabel(40 * DAY)).toBe("month");
  });
});

describe("snapWindow (boundaries via local getters — TZ-agnostic)", () => {
  it("day → local midnight … next midnight, containing the anchor", () => {
    const { start, end } = snapWindow("day", T);
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(end).getHours()).toBe(0);
    expect(start).toBeLessThanOrEqual(T);
    expect(T).toBeLessThan(end);
    expect(end - start).toBe(DAY);
  });
  it("hour aligns to the top of the hour", () => {
    const { start, end } = snapWindow("hour", T);
    expect(new Date(start).getMinutes()).toBe(0);
    expect(new Date(start).getSeconds()).toBe(0);
    expect(end - start).toBe(HOUR);
  });
  it("minute and second align to their boundary", () => {
    expect(snapWindow("minute", T).end - snapWindow("minute", T).start).toBe(MIN);
    expect(new Date(snapWindow("minute", T).start).getSeconds()).toBe(0);
    expect(snapWindow("second", T).end - snapWindow("second", T).start).toBe(1000);
    expect(new Date(snapWindow("second", T).start).getMilliseconds()).toBe(0);
  });
  it("week starts on a Sunday and spans 7 days", () => {
    const { start, end } = snapWindow("week", T);
    expect(new Date(start).getDay()).toBe(0);
    expect(new Date(start).getHours()).toBe(0);
    expect(end - start).toBe(7 * DAY);
  });
  it("month starts on the 1st and ends on the next 1st", () => {
    const { start, end } = snapWindow("month", T);
    expect(new Date(start).getDate()).toBe(1);
    expect(new Date(end).getDate()).toBe(1);
    expect(start).toBeLessThanOrEqual(T);
    expect(T).toBeLessThan(end);
  });
  it("unknown unit falls back to the full-data bounds", () => {
    expect(snapWindow("all", 0, { min: 5, max: 10 })).toEqual({ start: 5, end: 11 });
  });
});

describe("centeredWindow (½ the unit on each side of a point)", () => {
  it("centers an hour/minute window on the given time", () => {
    expect(centeredWindow("hour", 1_000_000)).toEqual({ start: 1_000_000 - 1_800_000, end: 1_000_000 + 1_800_000 });
    expect(centeredWindow("minute", 1_000_000)).toEqual({ start: 1_000_000 - 30_000, end: 1_000_000 + 30_000 });
  });
  it("returns null for 'all' or an unknown unit (caller uses the full span)", () => {
    expect(centeredWindow("all", 1_000_000)).toBeNull();
    expect(centeredWindow("nope", 1_000_000)).toBeNull();
  });
});

describe("eventVariancePct", () => {
  it("computes |AC−EX|/EX*100", () => {
    expect(eventVariancePct({ pairs: { AC: { value: 110 }, EX: { value: 100 } } })).toBeCloseTo(10);
    expect(eventVariancePct({ pairs: { AC: { value: 80 }, EX: { value: 100 } } })).toBeCloseTo(20);
  });
  it("returns null when AC/EX is missing or EX is zero", () => {
    expect(eventVariancePct({ pairs: { EX: { value: 100 } } })).toBeNull();
    expect(eventVariancePct({ pairs: { AC: { value: 5 }, EX: { value: 0 } } })).toBeNull();
  });
  it("rejects nonnumeric and nonfinite operands or results", () => {
    for (const value of ["unavailable", "110", NaN, Infinity]) {
      expect(eventVariancePct({ pairs: { AC: { value }, EX: { value: 100 } } })).toBeNull();
      expect(eventVariancePct({ pairs: { AC: { value: 100 }, EX: { value } } })).toBeNull();
    }
    expect(eventVariancePct({ pairs: { AC: { value: 1e308 }, EX: { value: 1e-308 } } })).toBeNull();
  });
});

describe("categoryColor", () => {
  it("is deterministic, memoized, and returns an hsl() string", () => {
    const a = categoryColor("Zone 1");
    expect(a).toMatch(/^hsl\(\d+, 65%, 58%\)$/);
    expect(categoryColor("Zone 1")).toBe(a); // stable / cached
  });
  it("handles imported names that collide with inherited object properties", () => {
    for (const key of ["__proto__", "constructor", "toString"]) {
      expect(categoryColor(key)).toMatch(/^hsl\(\d+, 65%, 58%\)$/);
      expect(centeredWindow(key, T)).toBeNull();
    }
  });
});

describe("controller wall-clock inputs and viewer DST", () => {
  it("round trips datetime-local without viewer timezone conversion and rejects invalid inputs", () => {
    const value = "2026-03-08T02:30";
    expect(toLocalInput(fromLocalInput(value))).toBe(value);
    expect(fromLocalInput(value).toISOString()).toBe(value + ":00.000Z");
    for (const invalid of ["", null, "2026-02-31T02:30", "2026-03-08T25:30", value + "Z"]) expect(fromLocalInput(invalid)).toBeNull();
    expect(toLocalInput(new Date(NaN))).toBe("");
  });

  it("keeps spring/fall durations, calendar windows, inputs and labels identical in UTC and Denver", () => {
    const script = `
      import { parseTimestamp } from ${JSON.stringify(new URL("../src/parse.js", import.meta.url).href)};
      import { snapWindow, toLocalInput, fromLocalInput, fmtTime, fmtTimeDate } from ${JSON.stringify(new URL("../src/format.js", import.meta.url).href)};
      const result = ["03/08/26", "11/01/26"].map(day => {
        const a = parseTimestamp(day + " 01:30:00 -0700");
        const b = parseTimestamp(day + " 03:30:00 -0600");
        return { duration: b - a, input: toLocalInput(a), roundTrip: fromLocalInput(toLocalInput(a)).getTime() === a.getTime(),
          day: snapWindow("day", a.getTime()), week: snapWindow("week", a.getTime()), month: snapWindow("month", a.getTime()),
          time: fmtTime(a.getTime(), 0), label: fmtTimeDate(a.getTime(), 0) };
      });
      process.stdout.write(JSON.stringify(result));`;
    const read = TZ => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }));
    const utc = read("UTC");
    expect(read("America/Denver")).toEqual(utc);
    expect(utc.map(r => [r.duration, r.day.end - r.day.start, r.roundTrip])).toEqual([[2 * HOUR, DAY, true], [2 * HOUR, DAY, true]]);
    expect(utc.map(r => r.input)).toEqual(["2026-03-08T01:30", "2026-11-01T01:30"]);
  });
});
