import { describe, it, expect } from "vitest";
import { parseRow } from "../src/parse.js";
import {
  isDurationMarker, feedSeverity, eventGroupOf, whyText, subjectSummary,
  feedSearchText, feedMatches, feedSortValue,
} from "../src/classify.js";

const row = (cat, act, trg, ...rest) => parseRow([`06/17/26 06:00:00 -0600`, cat, act, trg, ...rest]);

describe("isDurationMarker", () => {
  it("is true for zone water/done and program start/run/stop/done/manual lines", () => {
    expect(isDurationMarker(row("ZN", "WT", "SY", "ZN=1"))).toBe(true);
    expect(isDurationMarker(row("ZN", "DN", "SY", "ZN=1"))).toBe(true);
    expect(isDurationMarker(row("PG", "SR", "DT", "PG=2"))).toBe(true);
    expect(isDurationMarker(row("PG", "DN", "DT", "PG=2"))).toBe(true);
  });
  it("is false for instantaneous events shown in the feed", () => {
    expect(isDurationMarker(row("AL", "ER", "FS", "ZN=1"))).toBe(false);
    expect(isDurationMarker(row("ZN", "RD", "SY", "ZN=1"))).toBe(false);
  });
});

describe("feedSeverity", () => {
  it("crit for alerts and specific failure actions", () => {
    expect(feedSeverity(row("AL", "FV", "FS"))).toBe("crit");   // alert
    expect(feedSeverity(row("PM", "LP", "PM"))).toBe("crit");   // low pressure action
  });
  it("warn for pause/skip actions and event-switch category", () => {
    expect(feedSeverity(row("PG", "PA", "US"))).toBe("warn");
    expect(feedSeverity(row("SW", "ST", "SW"))).toBe("warn");
  });
  it("audit for a user configuration change", () => {
    expect(feedSeverity(row("PG", "CC", "US"))).toBe("audit");
  });
  it("empty for everything else", () => {
    expect(feedSeverity(row("ZN", "RD", "SY", "ZN=1"))).toBe("");
  });
});

describe("eventGroupOf (first matching group wins)", () => {
  it("classifies alarms, pauses, skips, config and status events", () => {
    expect(eventGroupOf(row("AL", "ER", "FS")).label).toBe("Alarms");
    expect(eventGroupOf(row("PG", "PA", "US")).label).toBe("Pause");
    expect(eventGroupOf(row("PG", "SK", "PP")).label).toBe("Skip / Drop");
    expect(eventGroupOf(row("PG", "CC", "US")).label).toBe("Config");
    expect(eventGroupOf(row("PG", "ST", "SY")).label).toBe("Status / Set");
  });
  it("returns null for events in no group", () => {
    expect(eventGroupOf(row("ZN", "RD", "SY", "ZN=1"))).toBeNull();
  });
  it("prefers Alarms when an event matches multiple groups", () => {
    // AL category (Alarms) + PA action (Pause) → Alarms is tested first
    expect(eventGroupOf(row("AL", "PA", "US")).label).toBe("Alarms");
  });
});

describe("whyText", () => {
  it("uses the TX message when present", () => {
    expect(whyText(row("FS", "TX", "FS", "TX=Network down"))).toBe("Network down");
  });
  it("uses trailing positional tokens when there's no TX", () => {
    expect(whyText(row("AL", "ER", "FS", "Valve Failure"))).toBe("Valve Failure");
  });
  it("falls back to 'by {trigger}' when there's no reason text", () => {
    expect(whyText(row("PG", "SR", "DT", "PG=2"))).toBe("by Date/Time");
  });
  it("leads with the decoded message code on Message (MG) events", () => {
    expect(whyText(row("MG", "ST", "SY", "KD=ZN_HFVS"))).toBe("Zone High Flow Variance Shutdown");
  });
  it("includes decoded start/stop causes", () => {
    expect(whyText(row("PG", "SP", "SY", "TC=PD"))).toBe("Program Done");
  });
});

describe("subjectSummary", () => {
  it("prefers zones (singular/plural), then mainline, then program", () => {
    expect(subjectSummary(row("ZN", "WT", "SY", "ZN=3")).html).toBe("Zone 3");
    expect(subjectSummary(row("ZN", "WT", "SY", "ZN=1;2")).html).toBe("Zones 1, 2");
    expect(subjectSummary(row("ML", "RN", "PG", "ML=4")).html).toBe("Mainline 4");
    expect(subjectSummary(row("PG", "SR", "DT", "PG=2")).html).toBe("Program 2");
  });
  it("names a device by its identifier key", () => {
    expect(subjectSummary(row("SB", "ST", "SB", "SB=9")).html).toBe("SubStation 9");
  });
  it("falls back to the category label when nothing else identifies a subject", () => {
    const s = subjectSummary(row("SY", "BT", "SY"));
    expect(s.title).toBe("System");
    expect(s.html).toContain("System");
  });
});

describe("feedSearchText / feedMatches (audit-feed search across cells)", () => {
  const e = row("ZN", "RD", "SY", "ZN=1", "PG=3");
  it("concatenates the row's cells + raw line, lowercased", () => {
    const t = feedSearchText(e);
    expect(t).toBe(t.toLowerCase());
    expect(t).toContain("zone 1");   // subject
    expect(t).toContain("system");   // trigger (SY → System)
    expect(t).toContain("zn=1");     // raw line
  });
  it("matches only when every whitespace token is found — across different cells", () => {
    expect(feedMatches(e, "zone 1")).toBe(true);
    expect(feedMatches(e, "zone 3")).toBe(true); // 'zone' from subject, '3' from the PG=3 raw field
  });
  it("fails when any token is absent", () => {
    expect(feedMatches(e, "zone 9")).toBe(false);
  });
  it("treats an empty/blank query as match-all", () => {
    expect(feedMatches(e, "")).toBe(true);
    expect(feedMatches(e, "   ")).toBe(true);
  });
});

describe("feedSortValue", () => {
  it("returns the numeric epoch for the date column", () => {
    const e = row("ZN", "RD", "SY", "ZN=1");
    expect(feedSortValue(e, "date")).toBe(e.ts.getTime());
    expect(typeof feedSortValue(e, "date")).toBe("number");
  });
  it("returns the display string for text columns", () => {
    const e = row("ML", "RN", "PG", "ML=4");
    expect(feedSortValue(e, "action")).toBe(e.action);
    expect(feedSortValue(e, "category")).toBe(e.category);
    expect(feedSortValue(e, "trigger")).toBe(e.trigger);
    expect(feedSortValue(e, "subject")).toBe("Mainline 4");
  });
});
