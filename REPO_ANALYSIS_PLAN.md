# Repository Analysis & Engineering Plan

> **Status (updated 2026-07-09, post-implementation):** P0, P1, and P2 are **done** (see the
> roadmap annotations below and `AI_HANDOFF.md` → "Last session" for the change log). P3 (DRY
> refactors) and P4 (structural) are intentionally **deferred**. One plan item was decided the
> opposite way after inspecting real data: `ZN,SP` is **not** a zone-run stop (see 2.3).

> Produced from a full repo sweep (2026-07-09): all root Markdown docs (`AI_HANDOFF.md`, `NOTES.md`,
> `docs/OBJECT_DEFINITIONS.md`, `docs/HOW_TO_USE.md`), all five root CSV logs
> (`Events1000.csv`, `Events_test.csv`, `Evnt_202606.csv`, `Evnt_flow_test.csv`, `testmanual.csv`),
> every module in `src/`, and all four Vitest suites in `tests/`.
> Findings cite `file:line` anchors and, where data-driven, the CSV evidence behind them.

## Data profile (context for the findings below)

| File | Rows | Notable |
|---|---|---|
| `Events1000.csv` | 4,087 | **91% is `TW,ER` noise** (3,742 rows). Timestamps have **no tz offset and no zero-padding** (`6/28/26 3:59:30`) — a different format than every other log. |
| `Events_test.csv` | 2,193 | Real support log. Carries category codes `BK, CM, CN, EM, FL, MG, NW, PC, SB` — several unmapped (see 1.1). |
| `Evnt_202606.csv` | 73,346 | Real monthly log. **34,292 `PG,SP,…,PG=99` stop rows** (47% of the file), 832 `ZN,SR`, 491 `ZN,WT`, 38 `ZN,SP`, 13k `MS,RD` moisture readings. |
| `Evnt_flow_test.csv` | 44 | Synthetic fixture; the only log allowed in the repo. |
| `testmanual.csv` | 24,392 | Real log; heavy cycle-and-soak (1,312 `ZN,SO`) and 131 `ZN,MR` manual runs. |

---

## Pillar 1 — Inconsistencies & Redundancies

### 1.1 `CATEGORY_MAP` is missing category codes that real logs emit — **highest-value mapping fix**
`src/constants.js:2` maps 26 column-B codes, but the five logs contain codes it doesn't:
`PC` (Control Point — present in 3 of 5 logs, incl. `Events1000.csv`), `SB` (SubStation — the map has
`SS:"SubStation"` but the data emits `SB`), `CM`, `CN`, `MG`, `NW`, `BK`, `FL`, `EM`, `AP`, `ED`, `EZ`, `PZ`.
Unmapped codes fall through `parseRow` (`src/parse.js:65`) and display as raw 2-letter codes in the
audit feed, the Category filter dropdown, and the glossary. Human-readable names already exist in
`OBJECT_KEY_MAP` / `DATA_GROUPS` (`src/constants.js:114,136`) to borrow from — but note the docs' own
caveat (`docs/OBJECT_DEFINITIONS.md` §namespace): the object-key namespace is *not* identical to
column B, so each addition should be sanity-checked against real rows, not bulk-merged.

**Action:** extend `CATEGORY_MAP` with the observed codes (at minimum `PC`, `SB`, `CM`, `MG`, `NW`,
`BK`, `FL`); keep `NOISE_CATCODES` (`src/constants.js:14`) in sync for any that are chatter.

### 1.2 Duplicate `SS` key in `KEY_INFO` — dead code
`src/constants.js:49` defines `SS: { desc: "Drive status" }` and `src/constants.js:59` redefines it
(`"Drive / secondary status (enumerated — see Status)"`). Object-literal semantics mean the first is
silently discarded. **Action:** delete the first entry (the second, enum-linked one is correct).

### 1.3 `isDurationMarker` disagrees with the run-pairing boundary sets
`src/classify.js:8` hides `ZN WT/DN` and `PG SR/RN/SP/DN/MR` from the feed because they're "drawn as
bars." But `buildRunIntervals` (`src/runs.js:35-36`) opens/closes runs on more than that:
- zone starts = `{WT, MR}` → **`ZN,MR` rows (manual starts) appear both as a bar and a feed row**;
- zone soak boundaries `ZN,SO` render as bar segments *and* feed rows;
- mainline runs `ML RN → OF` render as bars *and* feed rows.

This may be intentional (manual runs are audit-relevant), but it's undocumented and asymmetric.
**Action:** decide per action code, align `isDurationMarker` (or document the intent in `NOTES.md` §6),
and pin with tests. Note `findRunStartEvent` (`src/app.js:758`) and `revealRunStart` (`src/app.js:747`)
already special-case `ZN,MR`, so any change must keep the reveal path working.

### 1.4 Two different "human actor" trigger sets
- Manual-run detection: `US | OP` (`src/runs.js:11`)
- "Human audit only" filter: `US | AD` (`src/app.js:264`)

`TRIGGER_MAP` has US=User, OP=Operator, AD=Administrator. Whether Operators count as "human audit"
and Administrators as "manual" is a product decision, but today the two features silently disagree.
**Action:** confirm intent, then export shared constants (e.g. `MANUAL_TRIGGERS`, `HUMAN_TRIGGERS`)
from `src/constants.js` and use them in both places.

### 1.5 Three hand-rolled modal implementations
Reference (`src/app.js:1395-1401`), Guide (`src/app.js:1460-1466`), and Feedback
(`src/feedback.js:85-92`) each duplicate the show/hide/backdrop-click/Escape wiring, and **each adds
its own permanent `document`-level keydown listener**. **Action:** extract one ~15-line
`wireModal(modalEl, openBtn, closeBtn)` helper (a single shared Escape listener), used by all three.

### 1.6 `revealRunStart` duplicates most of `locateOnTimeline`
`src/app.js:747-756` vs `src/app.js:772-781`: both do reveal-if-duration-marker →
pan-if-off-window-else-render → `flashFeedRow`. The only differences are the playhead move and bar
highlight. **Action:** implement `revealRunStart` as a thin call into `locateOnTimeline` (with a
`moveScrubber:false`-style option), removing ~10 lines of drift-prone duplication.

### 1.7 Reset button re-enumerates filter IDs that `FILTER_SELECTS` already holds
`src/app.js:1024` hardcodes `["categoryFilter","actionFilter","triggerFilter","substationFilter"]`
while `FILTER_SELECTS` (`src/app.js:995`) already lists them. A future filter added to one list but
not the other resets inconsistently (this exact drift class bit the removed Zone filter cleanup).
**Action:** derive the reset list from `FILTER_SELECTS`.

### 1.8 Privacy & housekeeping — **do first**
- **`Events1000.csv` is not gitignored.** `AI_HANDOFF.md` (Last session §1) says it is "local-only
  (never commit)", yet `.gitignore` covers only `testmanual.csv`, `Evnt_2*.csv`, and
  `Events_test.csv`. `git status` shows `Events1000.csv` untracked — one `git add .` away from
  committing a real support log. **Action:** add `Events1000.csv` (or a broader
  `Events*.csv` rule) to `.gitignore`.
- Root clutter: `image.png` (1.6 MB) and `1755103792415-Screenshot 2025-08-13 094938.png` (357 KB)
  are untracked-or-stale artifacts at the root; `index.html.bak` is gitignored but 109 KB of dead
  weight. **Action:** delete or move to a gitignored `scratch/` folder.

---

## Pillar 2 — Testing Gap Analysis (grounded in the CSV data rules)

The 90-test Vitest suite covers the four pure modules well, but several behaviors the *real* logs
exercise are unpinned:

### 2.1 The `Events1000.csv` timestamp variant is untested
Every test row uses `06/17/26 06:07:05 -0600`. `Events1000.csv` uses `6/28/26 3:59:30` — no offset,
no zero-padding. `parseTimestamp` (`src/parse.js:14`) handles it today (`\d{1,2}` + optional tz),
but nothing prevents a regression that re-tightens the regex. **Action:** add `parse.test.js` cases
for the unpadded/offset-less form (and a mixed-format file).

### 2.2 `ZN,SR` is not a zone-run start — intentional but unpinned
`Evnt_202606.csv` has **832 `ZN,SR`** rows (e.g. `06/01/26 05:00:00,ZN,SR,DT,PG=1,ZN=20`, followed
seconds later by `ZN,SR,SY,…,ML=1,DF=2.8`), yet the zone start set is `{WT, MR}` (`src/runs.js:35`).
The plausible reading: `SR` = zone queued/started by the scheduler, `WT` = actually watering — so
bars starting at `WT` is the right *watering* semantics. But since `SR` count (832) ≈ 1.7× `WT`
count (491), zones can be queued and never water, and nothing documents or tests this choice.
**Action:** add a `runs.test.js` case asserting `ZN,SR` does not open a run; document the SR-vs-WT
semantics in `NOTES.md` §6.

### 2.3 `ZN,SP` does not close a zone run — likely a gap
> **RESOLVED — decided the OPPOSITE of the lean below.** Inspecting real `ZN,SP` sequences in
> `Evnt_202606.csv` showed every `ZN,SP` trails a **same-second `ZN,DN`** that already closed the
> run (it's a program-cascade stop echo), so adding `SP` to the zone stop set would change nothing
> (or double-close). The invariant is pinned by `runs.test.js` ("one clean run when a DN is
> immediately followed by a same-second ZN,SP") and documented in `NOTES.md` §6.

The real log has **38 `ZN,SP` (Stop)** rows, but the zone stop set is `{DN}` only
(`src/runs.js:36`), so an SP'd zone stays "open" until a `PA`/`DR`, a run-list inference tier, or
end-of-log. The program mode treats `SP` as a stop; zones don't. **Action:** inspect real `ZN,SP`
sequences in `Evnt_202606.csv`; if they terminate watering (they appear to), add `SP` to the zone
stop set (probably as a `terminated`-style close, mirroring `PA`) + tests for `WT→SP`.

### 2.4 Noise-alert flood behavior is unpinned
3,742 of 4,087 rows in `Events1000.csv` are `TW,ER` — simultaneously `isAlert` (actCode `ER`) *and*
`isNoise` (`TW` ∈ `NOISE_CATCODES`). With Advanced off they're filtered out; with Advanced **on**,
3,742 alarms get pinned above every other feed row (`selectFeedRows` default order,
`src/classify.js:123`) and painted as minimap/alert ticks. No test covers the noise+alert
combination in either state. **Action:** add tests that (a) noise-alerts are excluded from
`filtered`-equivalent selection when noise is hidden, and (b) decide/pin whether thousands of pinned
noise alarms is acceptable UX (candidate: don't pin alerts that are also noise).

### 2.5 Stop-without-start floods are silently dropped — unpinned
47% of the real monthly log is `PG,SP,PS,PG=99,SN=` rows with no matching start; the pairing loop
ignores stops with no open run (`src/runs.js:70`). That's correct, but untested — a refactor could
easily turn these into 34k phantom runs. Same for `ZN,DN` without `WT` (`Events1000.csv`: 62 DN vs
19 WT). **Action:** tests asserting stop-only groups produce zero runs.

### 2.6 `PG=MR` flowing through program inference — unpinned combination
A manual run is logged `ZN,MR,…,PG=MR`, so `inferEffectivePrograms` (`src/parse.js:88`) records
`"MR"` as a zone's last program and stamps it on later un-tagged lines; `zoneRunInProgram`
(`src/runs.js:88`) then treats `"MR"` as an orphan tag and attributes by time overlap. The pieces
are individually tested; the end-to-end interaction (manual run followed by untagged `DN`/`SO`
lines, inside a real program's window) is not. **Action:** one integration-style test over the pure
modules chained together.

### 2.7 `errors.js` and the feedback privacy invariant have zero tests
- The ring buffer (50-entry cap, message/stack truncation, `console.error/warn` tee) is nearly pure
  and trivially testable in jsdom/Node.
- The project's #1 hard rule — *"the feedback report never includes CSV rows"* — is enforced only by
  convention in `getDiagnostics()` (`src/app.js:1512`) and `buildPayload()` (`src/feedback.js:94`).
  **Action:** a jsdom test that loads synthetic rows, builds the payload, and asserts no raw-line
  content or `pairs` values appear anywhere in the serialized report. This turns the privacy promise
  into a gated invariant.

### 2.8 No DOM/integration layer (known, documented gap)
The render pipeline, swimlane/scrubber wiring, and PDF export are verified by hand per
`AI_HANDOFF.md`. **Action (roadmap P4):** a minimal Playwright (or Vitest+jsdom) smoke: load
`Evnt_flow_test.csv`, assert bar counts / feed rows / no console errors. Keeps the deploy gate
meaningful for UI regressions, not just data logic.

---

## Pillar 3 — Efficiency & Performance Bottlenecks

The bundle/interaction work already done (slim Chart.js, native-print export with no PDF library —
html2pdf/html2canvas was removed because it froze the tab on large logs — minimap gating, rAF
throttling, event delegation) is solid. The remaining costs are concentrated in the feed and the
scrubber hot paths:

### 3.1 `renderFeed` rebuilds up to 1,500 DOM rows on every full `render()` — even when nothing changed
`render()` (`src/app.js:305`) always calls `renderFeed()`. The feed is whole-log (window-independent),
and `renderFeed` already computes a content signature `sig` (`src/app.js:939`) — but only uses it to
preserve `scrollTop`. Every pan, arrow-key nav, `panToTime`, and locate-jump therefore pays
`selectFeedRows` (filter + sort over all events) **plus** a 1,500-row `innerHTML` rebuild for output
identical to the previous render. **Action:** early-return before the `selectFeedRows`/DOM work when
`sig === lastFeedSig` (details already open/closed via the DOM survive untouched). This is the
single biggest interaction win and is ~5 lines.

### 3.2 Feed search recomputes the full haystack per keystroke
`feedMatches` → `feedSearchText` (`src/classify.js:69-81`) rebuilds a lowercased concat — including
a fresh `subjectSummary()` — for **every event on every `input` event** (`src/app.js:1009`). On
`Evnt_202606.csv` that's 73k string builds per keystroke. **Action:** (a) lazily cache the haystack
per event (`e._searchText ||= …`; invalidate never — events are immutable after load), and
(b) debounce the search input ~150 ms. Keep `feedSearchText` pure by having it read/write the cache
field explicitly so tests stay deterministic.

### 3.3 Column sort recomputes `feedSortValue` twice per comparison
`selectFeedRows` (`src/classify.js:115`) calls `feedSortValue(a)`/`feedSortValue(b)` inside the
comparator — for the *subject* column that's a `subjectSummary()` call per side per comparison
(O(n log n) rebuilds). **Action:** decorate-sort-undecorate: precompute `[key, event]` pairs once,
sort, unwrap.

### 3.4 `visibleRunsAt()` clones every run object on every scrubber pointermove
`snapTime` (`src/app.js:806`) calls `visibleRunsAt()` per `pointermove`, and `visibleRunsAt`
(`src/app.js:794`) rebuilds the array with `{ ...iv, group, color }` spreads each call. The panel
rebuild is rAF-throttled but snapping is not. **Action:** memoize `visibleRunsAt()` keyed on the
`runCache` generation + lane/run-type selections (all invalidation points already funnel through
`applyFilters`/`render`); `snapTime` only needs a flat sorted array of edge timestamps, which can be
precomputed alongside.

### 3.5 Scrub-panel flow carry-forward scans all of `filtered` per frame
`updateScrubPanel` (`src/app.js:863`) walks the entire `filtered` array looking for the latest
AC/EX/PR at-or-before the playhead — O(n) per animation frame during a drag on a 73k-row log.
`filtered` is chronological. **Action:** binary-search the playhead index (or precompute a
telemetry-only subarray at filter time — there are typically only hundreds of AC/EX rows) and walk
backward from there.

### 3.6 Minor / note-only
- `onDataLoaded` (`src/app.js:181`) makes ~8 full passes over `allEvents` (bounds, 3 lane fills,
  3 selects + substation, `hasHydro`, flow max). Fine at 73k rows; fold into one pass only if load
  time ever matters.
- `buildRunIntervals` groups then sorts the 34k-row `PG=99` stop-only group before the pairing loop
  discards it (`src/runs.js:54`). Harmless today; a "skip groups with no start actions" pre-check is
  available if profiles ever show it.
- The feed remains capped (`FEED_CAP` 1500), not virtualized — acceptable per docs; virtualization
  stays a P4 option.

---

## Roadmap (sequenced, actionable)

Repo conventions apply to every item: `npm run test:run` after any logic change (deploy is
test-gated), and a browser smoke with `Evnt_flow_test.csv` for anything touching the render path.

### P0 — Privacy & one-line correctness — ✅ DONE (items 1–3 in the P0–P2 session; item 4 in the spec-cross-check session)
1. Add `Events1000.csv` to `.gitignore` (privacy hard rule; it is currently one `git add .` from a leak).
2. Remove the duplicate `SS` entry in `KEY_INFO` (`src/constants.js:49`).
3. Extend `CATEGORY_MAP` with observed real-log codes (`PC`, `SB`, `CM`, `MG`, `NW`, `BK`, `FL`, …),
   cross-checking each against sample rows; sync `NOISE_CATCODES` where applicable. Verify in-browser
   with `Events_test.csv` that Control Point / SubStation rows now read as words.
4. Clean root artifacts (`image.png`, stray screenshot, `index.html.bak`).

### P1 — Data-rule decisions + regression tests — ✅ DONE (item 6 resolved as "no change", see 2.3; item 9's privacy test landed as `tests/feedback.test.js` in the spec-cross-check session)
5. `parse.test.js`: unpadded / offset-less timestamp cases (2.1).
6. Decide + implement `ZN,SP` as a zone-run stop; tests for `WT→SP` (2.3).
7. Pin `ZN,SR` non-start semantics with a test + `NOTES.md` sentence (2.2).
8. Tests for noise-alert selection behavior and stop-without-start floods (2.4, 2.5); decide whether
   noise-alerts should be pinned when Advanced is on.
9. `errors.test.js` (ring buffer) + jsdom privacy test asserting no CSV content in the feedback
   payload (2.7).

### P2 — Performance — ✅ DONE (all three items; verified on `Evnt_202606.csv` at 73k rows)
10. `renderFeed`: skip rebuild when the content signature is unchanged (3.1).
11. Cache `feedSearchText` per event + debounce `#feedSearch` (3.2); precompute sort keys in
    `selectFeedRows` (3.3). Both are pure-module changes → extend `classify.test.js`.
12. Memoize `visibleRunsAt()` + edge array for `snapTime` (3.4); binary-search/telemetry-subarray for
    the scrub-panel flow scan (3.5). Verify scrubber drag stays smooth on `Evnt_202606.csv`.

### P3 — DRY refactors (opportunistic, low risk) — ⏸ DEFERRED (item 13's `HUMAN_TRIGGERS` half is done; the modal/reveal/reset refactors 14–16 remain open)
13. Shared `MANUAL_TRIGGERS` / `HUMAN_TRIGGERS` constants after confirming intent (1.4).
14. Fold `revealRunStart` into `locateOnTimeline` (1.6); derive the reset list from
    `FILTER_SELECTS` (1.7).
15. Single modal helper for Reference/Guide/Feedback (1.5).
16. Align `isDurationMarker` with the run boundary sets, or document the asymmetry (1.3).

### P4 — Structural (optional, when capacity allows) — ⏸ DEFERRED
17. Playwright (or jsdom) smoke over the DOM render pipeline using `Evnt_flow_test.csv` (2.8),
    wired into `ci.yml` so the deploy gate covers UI regressions.
18. Feed virtualization to lift `FEED_CAP` (3.6) — only if users hit the cap in practice.

---

## Verification

- **Every logic change:** `npm run test:run` (90 tests currently green; deploy is gated on them).
- **Render-path changes:** load `Evnt_flow_test.csv` in the dev server (`npm run dev`), confirm
  bars/feed/scrubber and zero console errors; spot-check `Events1000.csv` (timestamp variant + noise
  flood) and `Evnt_202606.csv` (scale) locally.
- **P0 privacy item:** `git check-ignore Events1000.csv` must succeed; `git status` must show no
  real logs as addable.
- **Build health:** `npm run build` clean; initial-bundle size should not regress (≈219 kB JS).
