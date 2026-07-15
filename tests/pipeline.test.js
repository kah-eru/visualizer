import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { eventsFromRows, inferEffectivePrograms } from "../src/parse.js";
import { buildRunIntervals } from "../src/runs.js";

// End-to-end golden tests over the whole data pipeline: a real CSV off disk → PapaParse →
// eventsFromRows → inferEffectivePrograms → buildRunIntervals, with the resulting counts pinned.
// The unit tests around each module use small synthetic rows; these catch the failure they can't —
// a parser change that silently drops or mis-pairs rows on a real file.
//
// eventsFromRows is the same function handleFile (app.js) uses, and these Papa options are the same
// ones it passes, so this exercises the app's real ingestion path rather than a re-implementation.
const load = (name) => {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
  const rows = Papa.parse(readFileSync(path, "utf8"), { header: false, skipEmptyLines: true }).data;
  const events = eventsFromRows(rows);
  inferEffectivePrograms(events);
  const globalEnd = Math.max(...events.map(e => e.ts.getTime())) + 1;
  const runs = mode => buildRunIntervals(events, mode, globalEnd);
  return { rows, events, runs };
};
const has = (name) => existsSync(fileURLToPath(new URL(`../${name}`, import.meta.url)));

// Load on first use, not in the describe body. `describe.skipIf` still EXECUTES its callback to
// collect the tests inside it — it only marks them skipped — so a top-level load() of a missing
// local-only log throws ENOENT during collection and reds the whole file instead of skipping.
const lazy = (name) => { let cached; return () => (cached ||= load(name)); };
const iso = (ms) => new Date(ms).toISOString(); // TZ is pinned to UTC in vitest.config.js
const span = (events) => [
  iso(Math.min(...events.map(e => e.ts.getTime()))),
  iso(Math.max(...events.map(e => e.ts.getTime()))),
];

/* ============================================================================
   Evnt_flow_test.csv — the synthetic fixture, and the ONLY log committed to the
   repo. Everything below always runs, in CI included.
   ========================================================================== */
describe("pipeline · Evnt_flow_test.csv (synthetic fixture)", () => {
  const { rows, events, runs } = load("Evnt_flow_test.csv");

  it("parses every row — nothing is silently dropped", () => {
    expect(rows.length).toBe(44);
    expect(events.length).toBe(44);
  });

  it("assigns dense, load-ordered ids (the feed looks rows up by _id)", () => {
    expect(events.map(e => e._id)).toEqual(events.map((_, i) => i));
  });

  it("pins the event mix", () => {
    expect(events.filter(e => e.isAlert).length).toBe(2);   // AL,LP + AL,FV
    expect(events.filter(e => e.isNoise).length).toBe(2);   // SB,RD + NW,RY
    expect(events.filter(e => e.flow != null).length).toBe(16);
  });

  it("builds the expected runs in every mode", () => {
    expect(runs("program").length).toBe(4);
    expect(runs("zone").length).toBe(5);
    expect(runs("mainline").length).toBe(2);
  });

  it("splits the cycle-and-soak zone run into segments", () => {
    // Zone 5 / program 4, 07:00–07:50 — the run this fixture was extended to cover: waters in
    // cycles separated by soaks, so it must be 5 segments (3 watering + 2 soak), not one solid bar.
    const z5 = runs("zone").find(r => r.key === "5");
    expect(iso(z5.start)).toBe("2026-06-17T07:00:05.000Z");
    expect(iso(z5.end)).toBe("2026-06-17T07:50:00.000Z");
    expect(z5.segments.length).toBe(5);
  });

  it("classifies the manual, terminated, and ongoing runs", () => {
    const byKey = Object.fromEntries(runs("program").map(r => [r.key, r]));
    expect(byKey["1"]).toMatchObject({ kind: "run-scheduled", manual: false, ongoing: false });
    expect(byKey["2"]).toMatchObject({ kind: "run-terminated", manual: true });   // PG,MR then PG,PA
    expect(byKey["3"]).toMatchObject({ ongoing: true });                          // never closed
  });

  it("attributes zone runs to their programs", () => {
    expect(runs("zone").map(r => [r.key, r.program])).toEqual([
      ["1", "1"], ["2", "1"], ["3", "2"], ["4", "3"], ["5", "4"],
    ]);
  });
});

/* ============================================================================
   Real controller logs — LOCAL ONLY.

   These four are gitignored (see .gitignore: "Real controller logs must never be
   committed"), so they are absent in CI and on a fresh clone, and this block skips
   itself. That is intended, not a bug to fix: DO NOT make these run by committing a
   log — the privacy rule outranks the coverage.

   Their value is local. They carry shapes the synthetic fixture doesn't — unpadded
   offset-less timestamps, a 34k-row stop-only flood, 73k-row scale, manual runs with
   no PG tag — so if you have them, a parser change that breaks real data fails here
   before it reaches a user.
   ========================================================================== */
describe.skipIf(!has("Events1000.csv"))("pipeline · Events1000.csv (local only)", () => {
  const data = lazy("Events1000.csv");

  it("parses the unpadded, offset-less timestamp variant across the whole file", () => {
    // This log's timestamps are `6/28/26 3:59:30` — no tz offset, no zero-padding, unlike every
    // other log. parse.test.js pins the form synthetically; this pins that all 4,087 rows survive it.
    const { events } = data();
    expect(events.length).toBe(4087);
    expect(span(events)).toEqual(["2026-06-28T03:59:30.000Z", "2026-07-02T11:39:30.000Z"]);
  });

  it("is a two-wire noise flood that is also alarms", () => {
    // 91% of the file is TW,ER: simultaneously isAlert (actCode ER) and isNoise (TW). This is the
    // log behind the noise-alert de-pinning rule in selectFeedRows.
    const { events } = data();
    expect(events.filter(e => e.isNoise).length).toBe(3742);
    expect(events.filter(e => e.isAlert && e.isNoise).length).toBe(3742);
  });
});

describe.skipIf(!has("Evnt_202606.csv"))("pipeline · Evnt_202606.csv (local only)", () => {
  const data = lazy("Evnt_202606.csv");

  it("parses the full monthly log at scale", () => {
    const { events } = data();
    expect(events.length).toBe(73346);
    expect(span(events)).toEqual(["2026-06-01T00:00:00.000Z", "2026-06-24T16:01:02.000Z"]);
  });

  it("yields zero runs from the PG=99 stop-only flood", () => {
    // 34,135 `PG,SP,…,PG=99` rows with no matching start — 47% of the file. The pairing loop ignores
    // a stop with no open run; a refactor that got this wrong would invent 34k phantom runs.
    const { events, runs } = data();
    expect(events.filter(e => e.program === "99").length).toBe(34135);
    expect(runs("program").some(r => r.key === "99")).toBe(false);
  });

  it("builds runs in every mode", () => {
    const { runs } = data();
    expect(runs("program").length).toBe(148);
    expect(runs("zone").length).toBe(383);
  });
});

describe.skipIf(!has("testmanual.csv"))("pipeline · testmanual.csv (local only)", () => {
  const data = lazy("testmanual.csv");

  it("parses the full log", () => {
    expect(data().events.length).toBe(24392);
  });

  it("finds the manual zone runs", () => {
    // Every manual run here is a ZONE run (`ZN,MR,…,PG=MR`) — none are program-level. This is the
    // log behind the Manual Runs swimlane lane.
    const { runs } = data();
    expect(runs("zone").filter(r => r.manual).length).toBe(273);
    expect(runs("program").filter(r => r.manual).length).toBe(0);
  });

  it("never attributes a manual run to a real program", () => {
    // PG=MR is a literal tag, not a program: before MANUAL_PROG_TAG existed, orphan→overlap
    // attribution adopted 111 of these 273 into whatever program happened to be running.
    expect(data().runs("program").some(r => r.key === "MR")).toBe(false);
  });
});
