import { describe, it, expect } from "vitest";
import { parseRow } from "../src/parse.js";
import {
  isDurationMarker, feedSeverity, eventGroupOf, whyText, subjectSummary,
  feedSearchText, feedMatches, feedSortValue, eventRunTarget, selectFeedRows, eventJumpTarget,
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
  it("caches the haystack on the event and reuses it on repeat calls", () => {
    const ev = row("ZN", "RD", "SY", "ZN=1");
    const first = feedSearchText(ev);
    expect(ev._searchText).toBe(first);     // cached on the event
    expect(feedSearchText(ev)).toBe(first); // same value returned from cache
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

describe("eventRunTarget (which run bar to flash on the timeline)", () => {
  it("prefers zones (first key), then mainline, then program", () => {
    expect(eventRunTarget(row("ZN", "RD", "SY", "ZN=1;2", "PG=3"))).toEqual({ group: "Zone", key: "1" });
    expect(eventRunTarget(row("ML", "RN", "PG", "ML=4"))).toEqual({ group: "Mainline", key: "4" });
    expect(eventRunTarget(row("PG", "SR", "DT", "PG=2"))).toEqual({ group: "Program", key: "2" });
  });
  it("returns null when the event maps to no run lane", () => {
    expect(eventRunTarget(row("SY", "BT", "SY"))).toBeNull();
  });
});

describe("selectFeedRows (whole-log feed, not window-limited — mirrors the 6/28→7/2 bug report)", () => {
  // events spread across five calendar days, like Events1000.csv
  const at = (date, cat, act, trg, ...rest) => parseRow([`${date} -0600`, cat, act, trg, ...rest]);
  const e628 = at("06/28/26 10:00:00", "ZN", "RD", "SY", "ZN=1");       // earliest, non-marker, non-alert
  const alert629 = at("06/29/26 08:00:00", "AL", "ER", "FS", "ZN=2");   // alert
  const marker630 = at("06/30/26 09:00:00", "ZN", "WT", "SY", "ZN=6");  // duration marker (hidden by default)
  const e701 = at("07/01/26 12:00:00", "ZN", "RD", "SY", "ZN=3");       // non-marker
  const e702 = at("07/02/26 17:00:00", "ZN", "RD", "SY", "ZN=5");       // latest, non-marker
  const all = [e628, alert629, marker630, e701, e702];
  all.forEach((e, i) => { e._id = i; });

  it("returns every non-duration-marker event across all days — the window never limits it", () => {
    const rows = selectFeedRows(all, {});
    expect(rows).toContain(e628);            // 6/28 present even though it's the earliest of five days
    expect(rows).toContain(e702);            // 7/2 present
    expect(rows).not.toContain(marker630);   // duration marker hidden by default
    expect(rows.length).toBe(4);             // all four non-marker events, nothing dropped by any window
  });
  it("date column sorts the WHOLE log ascending (6/28 first) and descending (7/2 first)", () => {
    const asc = selectFeedRows(all, { sortCol: "date", sortDir: "asc" });
    expect(asc[0]).toBe(e628);
    expect(asc[asc.length - 1]).toBe(e702);
    const desc = selectFeedRows(all, { sortCol: "date", sortDir: "desc" });
    expect(desc[0]).toBe(e702);
    expect(desc[desc.length - 1]).toBe(e628);
  });
  it("search filters across all days, not just a window", () => {
    expect(selectFeedRows(all, { query: "zn=3" })).toEqual([e701]); // only the 7/1 row, found from the whole log
  });
  it("reveals a duration marker only when its id is in revealedIds", () => {
    expect(selectFeedRows(all, {})).not.toContain(marker630);
    expect(selectFeedRows(all, { revealedIds: new Set([marker630._id]) })).toContain(marker630);
  });
  it("default order pins alarms above the (earlier) chronological rows", () => {
    expect(selectFeedRows(all, {})[0]).toBe(alert629); // alert on 6/29 pinned above the 6/28 row
  });

  it("does NOT pin a noise-category alert (e.g. TW,ER) — only real alarms pin to the top", () => {
    // A two-wire error is both isAlert AND isNoise; on real logs there can be thousands of these.
    const noiseAlert = at("06/27/26 06:00:00", "TW", "ER", "SY", "ER=TW No Response"); // isAlert && isNoise
    const set = [e628, alert629, noiseAlert];
    set.forEach((e, i) => { e._id = 100 + i; });
    const rows = selectFeedRows(set, {});
    expect(rows[0]).toBe(alert629);            // the real AL/ER alert is pinned on top
    expect(rows).toContain(noiseAlert);        // the noise-alert still appears...
    expect(rows[0]).not.toBe(noiseAlert);      // ...but is NOT pinned above the real alarm
    // noise-alert falls into the chronological (unpinned) tail — before the 6/28 row by time
    expect(rows.indexOf(noiseAlert)).toBeLessThan(rows.indexOf(e628));
    expect(rows.indexOf(noiseAlert)).toBeGreaterThan(0);
  });
});

// A feed row only earns a "↗" button if some timeline actually draws the event. ~72% of real rows draw
// nowhere (ZN,RL heartbeats, SB,RD readings, MS,RD...), and their button used to move the playhead and
// highlight nothing. Alarms are drawn on BOTH timelines and belong to the main one; the other five
// intervention groups are drawn ONLY on the Interventions & Alerts card.
describe("eventJumpTarget (does the timeline have anything to point at, and which one)", () => {
  const covers = () => true;   // a run is under the event
  const noRuns = () => false;  // no run under the event

  it("returns null for a plain system/device row — no lane, no alert, no group", () => {
    expect(eventJumpTarget(row("SB", "RD", "SY", "SB=4"), covers)).toBe(null);
    expect(eventJumpTarget(row("MS", "RD", "SY", "SN=99"), covers)).toBe(null);
  });

  it("returns null when the row NAMES a zone but no run is under it (the ZN,WA queued case)", () => {
    // ZN,WA names zone 50 while it's waiting to water — eventRunTarget resolves, but there's no bar.
    const wa = row("ZN", "WA", "SY", "ZN=50", "PG=13");
    expect(eventRunTarget(wa)).toEqual({ group: "Zone", key: "50" }); // names a lane...
    expect(eventJumpTarget(wa, noRuns)).toBe(null);                   // ...but nothing to ring
  });

  it("routes a manual run start to the main timeline and points at its bar", () => {
    expect(eventJumpTarget(row("ZN", "MR", "SY", "ZN=12", "PG=MR"), covers))
      .toEqual({ dest: "main", bar: { group: "Zone", key: "12" }, tick: false, diamond: false });
  });

  it("routes a pause to the events timeline but STILL points at the run it killed", () => {
    expect(eventJumpTarget(row("ZN", "PA", "SY", "ZN=24", "PG=1"), covers))
      .toEqual({ dest: "events", bar: { group: "Zone", key: "24" }, tick: false, diamond: true });
  });

  it("routes a pause with no run under it to the events timeline, with no bar", () => {
    expect(eventJumpTarget(row("ZN", "PA", "SY", "ZN=24", "PG=1"), noRuns))
      .toEqual({ dest: "events", bar: null, tick: false, diamond: true });
  });

  it("routes an alarm to the MAIN timeline even though it is also in the Alarms group", () => {
    // isAlert and the Alarms group are the same predicate, so an alarm is drawn on both timelines.
    const err = row("ZN", "ER", "SY", "ZN=1");
    expect(eventGroupOf(err).label).toBe("Alarms");
    expect(eventJumpTarget(err, covers))
      .toEqual({ dest: "main", bar: { group: "Zone", key: "1" }, tick: true, diamond: true });
  });

  it("keeps an alarm with no run on the main timeline — its red tick is still there", () => {
    expect(eventJumpTarget(row("AL", "ER", "SY", "TX=Open Circuit"), noRuns))
      .toEqual({ dest: "main", bar: null, tick: true, diamond: true });
  });

  it("routes a lane-less intervention (config/status/disable) to the events timeline", () => {
    expect(eventJumpTarget(row("MG", "SE", "BM", "MG=3"), covers)).toMatchObject({ dest: "events", bar: null });
    expect(eventJumpTarget(row("SY", "CC", "US"), covers)).toMatchObject({ dest: "events", diamond: true });
  });

  it("only consults runCovers for the lane the event names, at the event's own time", () => {
    const seen = [];
    eventJumpTarget(row("ZN", "MR", "SY", "ZN=12", "PG=MR"), (g, k, ts) => { seen.push([g, k, ts]); return true; });
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe("Zone");
    expect(seen[0][1]).toBe("12");
    expect(seen[0][2]).toBe(row("ZN", "MR", "SY", "ZN=12").ts.getTime());
  });
});
