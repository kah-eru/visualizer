<!-- ============================================================================
     AI HANDOFF — READ THIS FIRST
     Audience: the next AI/developer picking up this repo.
     Purpose: get you oriented in ~2 minutes, then point you at the deep docs.
     Keep this file current: when you finish a chunk of work, update the
     "Current state" and "Last session" sections below before you push.
     ============================================================================ -->

# AI Handoff — Baseline Irrigation Event Log Visualizer

**You are picking up a working, deployed project.** This file is the fast on-ramp.
For the full architecture and gotchas, read **[`NOTES.md`](./NOTES.md)** top-to-bottom — it is the
source of truth. This file just gets you moving and tells you what changed most recently.

---

## What this app is (one paragraph)

A 100% client-side static site that visualizes **Baseline irrigation controller event logs**
(`Evnt_yyyyMM.csv`). The user uploads a CSV in the browser (nothing is ever uploaded to a server); the
app parses it and renders a swimlane timeline of program/zone/mainline runs, an optional flow/pressure
chart, an interventions & alerts timeline, a draggable scrubber with a "what's running now" panel, a
searchable audit feed, and a PDF export. Built with **Vite + vanilla ES modules** (no framework),
deployed to **GitHub Pages** at `https://kah-eru.github.io/visualizer/`.

The target user audits irrigation behavior: *what ran, when, for how long, scheduled or manual, did
anything stop early, and why.*

---

## Get moving

```bash
npm install
npm run dev          # → localhost:5173/visualizer/
npm run test:run     # Vitest unit tests (CI mode) — run after any logic change
npm run build        # → dist/   (npm run preview to serve the prod bundle)
```

- **Test data:** `Evnt_flow_test.csv` (repo root) — synthetic one-day log that exercises the
  flow/variance/alarm/inference paths. Use this for browser smoke tests.
- **Browser verification:** the DOM render pipeline isn't unit-tested, so after UI/render changes,
  load `Evnt_flow_test.csv` in the browser (Chrome DevTools MCP) and confirm no console errors.

---

## Map of the code

| File | Role |
|---|---|
| `index.html` | Markup only; loads `src/main.js`. |
| `src/main.js` | Entry: styles → errors → app → `initFeedback`. |
| `src/app.js` | The dashboard core — filter → render → swimlane/scrubber/feed/minimap + all DOM wiring. Tightly coupled on purpose; shares mutable module-level state. |
| `src/parse.js` / `runs.js` / `format.js` / `classify.js` | **Pure, DOM-free** data logic extracted out of app.js so it's unit-testable in Node. |
| `src/constants.js` | Mapping tables, key info, conversion constants. |
| `src/errors.js` | Global error handlers + ring buffer + fatal banner. |
| `src/feedback.js` | Feedback/crash-report button + modal → Web3Forms. |
| `tests/*.test.js` | Vitest unit tests for the four pure modules. |
| `.github/workflows/` | `ci.yml` (PRs/branches) and `deploy.yml` (push to main → test-gated build → Pages). |

---

## Hard rules — don't break these

- **Privacy:** CSV/event-log **contents must never leave the browser**. The feedback report sends only
  filename, counts, and filter/view state — never CSV rows. Don't change that.
- **Real logs stay out of the repo / `public/`.** The real controller logs (`Evnt_202605.csv`,
  `Events.csv`) were scrubbed from git history. Don't re-add them or any real data to `public/`. Tests use
  synthetic inline CSV or `Evnt_flow_test.csv` only.
- **`.env` is gitignored.** `VITE_WEB3FORMS_KEY` is a public submission token (safe in the client bundle);
  in CI it comes from a repo secret of the same name.
- **Run `npm run test:run` after logic changes** — the Pages deploy is **gated** on tests passing
  (`deploy.yml`: `build needs: test`), so a red test blocks the live site.
- **Keep the Chart.js instance alive even when Flow is off** — it owns the shared time axis everything
  else aligns to. See `NOTES.md` §3.

---

## Current state (as of 2026-07-15)

- **Version:** 1.0.0. **Branch:** `main` (tip `0a13fde` + the feed ↗ routing work below).
- **Deployed & green.** CI gates the deploy on the Vitest suite.
- **Tested:** the pure data logic (`parse`/`runs`/`format`/`classify`), the `errors.js` ring buffer, and
  the feedback-report privacy invariant (`tests/feedback.test.js`) are covered by Vitest — **120 tests**.
  The DOM render pipeline, swimlane/scrubber wiring, and PDF export are **not** automated — verify those
  in a browser.
- **Performance:** initial index JS ≈249 kB (gzip ≈88 kB). **PDF export is native browser print** now
  (`window.print()` + a `@media print` stylesheet) — the html2pdf.js/html2canvas dependency was removed
  (it froze the tab on large logs), so there's no on-demand export chunk anymore.
- **In-app help was audited for accuracy** against the code (tooltips + the "How to use" guide);
  three stale strings were corrected and the untooltipped controls filled in.

## Last session (most recent first)

1. **The feed's ↗ button now only appears when a timeline can point at the event, and routes to the right
   one.** It rendered on every row and always scrolled to `#timelineCard`, but **72% of rows in
   `testmanual.csv` (12,141/16,824) and 78% in `Evnt_202606.csv` (28,678/36,949) had nothing to land on** —
   `ZN,RL` heartbeats ×3302, `MS,RD` readings ×13087, `SB,RD` ×1873 — so it moved the playhead and
   highlighted nothing. Separately, pauses/disables/configs are drawn **only** on the Interventions & Alerts
   card (934 rows in `testmanual.csv` had a diamond and nothing on main), and there was no feed→events path
   at all. Now:
   - `eventJumpTarget(e, runCovers)` (pure, `classify.js`, 9 unit tests) → `{dest, bar, tick, diamond}` or
     **null**; `feedRowHTML` emits an 80px spacer instead of a button when null. Label names the
     destination: **↗ timeline** / **↗ events**.
   - `runCovers` (`app.js`) confirms a bar really exists — `eventRunTarget != null` only says which lane an
     event *names*, and a `ZN,WA` (queued, not watering) names a zone with no bar. Memoized on `runGen`;
     safe because `applyFilters` does `runGen++; lastFeedSig = null;` together.
   - **`isAlert` IS the Alarms group** (identical predicate in `parse.js` and `EVENT_GROUPS`), so alarms are
     drawn on both timelines and are routed explicitly to **main**; `diamond && !isAlert` is then exactly
     "one of the other five groups", which route to `#eventTlCard`.
   - An events-routed jump still rings the run the intervention acted on, and switches on whatever draws
     the mark (`eventTlOn`, `#showAlertMarks`) — same reasoning as the existing `ensureLaneVisible`.
     New sticky `locatedEid` + `.ev-located`, re-applied by `renderEventTimeline` like `.tl-located`.
   - Verified in Chrome on both logs: buttons 100% → **28.9%** of rendered rows (testmanual), a `ZN,DS` row
     switches the Events card on and rings its diamond, a `ZN,PA` rings **both** its diamond and the run it
     killed, an alarm goes to main and re-checks Alert markers for you, rings survive pan/zoom and clear on
     next jump / Reset. 120 tests green, console clean, 2–9 ms per search keystroke at 73k.

2. **A run ending exactly under the playhead now lists as "· over"** instead of vanishing. The panel's
   active filter was `iv.start <= t && t < iv.end`; **Snap is on by default and lands the playhead
   precisely on a run edge**, so parking on a run's end dropped it from the panel while its bar sat right
   under the playhead. The end bound is now inclusive, with `isOver` tagging those rows "· over" and
   showing "ran {duration}" rather than a nonsensical "10 min into 10 min run". Two traps: an **ongoing**
   run's `end` is `globalEnd` (a placeholder, not a real ending) so `isOver` excludes `iv.ongoing` — a
   still-running zone must not read "over" at the end of the log, and it now correctly lists as *running*
   there, where it used to vanish; and **"Running now (N)"** counts `runningCount` (over runs excluded), so
   an ended run is listed without inflating the count. Verified in Chrome with synthetic logs covering
   ended / mid-run / ongoing at one instant, plus the composed `ran 4 min · over · stopped early · manual`.

3. **Manual runs got their own timeline lane** — prompted by a live demo where the **At Playhead** panel
   "didn't show all of the things that were happening manually". Not a classifier bug: **manual runs are
   zone runs** (`ZN,MR,SY,ZN=12,PG=MR`) and the Zones dropdown starts **empty** (a deliberate default —
   104 zones in `testmanual.csv`), so `visibleRunsAt` skipped them entirely and the panel listed only
   "Mainline 1". `Run type → 🟧 Manual` had nothing to act on: *every* manual run in that log is a zone run
   (0 program-level; 87 of 104 zones have one). The pieces:
   - **New Manual Runs section** in `renderSwimlane`, between Mainlines and Programs — the only lane group
     not driven by a dropdown. Shows manual zone runs whatever `laneSel.zone` says, gated by `showManual`,
     hidden when the window has none. Parent `MR` track = `mergeSpans(manualRuns)` (new pure fn in
     `runs.js`, 7 unit tests): a **derived** envelope, deliberately not built from the controller's
     `MR,SR`→`MR,SP` rows so it can't disagree with its children and works on logs with no `MR` category
     rows. Label toggles `expandedManual` (default true). See NOTES.md → Swimlane.
   - **`visibleRunsAt` mirrors it** (deduped by `group|key|start`), so the panel lists `Zone 12 · manual`
     on a fresh load. Its tags now **compose** — `· stopped early · manual` — instead of a ternary chain
     where `run-terminated` shadowed `manual`. `barHTML` already did this right; only the panel was wrong.
   - **Three adjacent bugs found while in there.** (a) `zoneRunsAll` — the rows under an *expanded program*
     — skipped the run-type filter, so unchecking Manual/Scheduled left them on screen and `statRuns`
     disagreed. (b) `PG=MR` was swept into the Programs dropdown as a checked-by-default "Program MR" lane
     that could only render empty. (c) Worst: `realProgTags` didn't know about `MR`, so orphan→overlap
     attribution adopted manual runs into whatever program was running — **111 of 273** on `testmanual.csv`.
     All three fixed via the new `MANUAL_PROG_TAG` constant.
   - **Verified in Chrome (DevTools MCP)** on `testmanual.csv` and `Evnt_202606.csv` (73k, whose manual runs
     carry *no* `PG=` tag — a useful second shape): section present on load with Zones "None"; panel lists
     the manual zones; Manual checkbox drives both; dedupe holds; `statRuns` matches the screen; a full
     toggle round-trip is 35 ms at 73k; console clean. 111 tests green, build clean.

4. **Feed → timeline jumps now scroll the page up and leave a sticky highlight** — prompted by a live demo
   where clicking a feed row's **↗ timeline** "wouldn't scroll me back up" and looked like it did nothing.
   Root cause: `locateOnTimeline` moved the playhead and pulsed the bar (1.3s `.tl-hit`) but **never scrolled
   the window** — the feed sits below the timeline, so the whole effect fired off-screen and expired. The
   pieces:
   - **`src/app.js`** — `locateOnTimeline` now calls `ensureLaneVisible(target)` (ticks the target's lane on;
     zones start as "None", so a zone jump had no bar to mark), sets the sticky `locatedRun`/`locatedTs`
     alongside the one-shot `pendingBarHighlight`, and `scrollPageTo($("timelineCard"), "start")`.
     `renderSwimlane` re-applies `.tl-located` on every render (survives pan/zoom/filter); when the located
     run has **no bar at that instant** — commonly an alarm naming a zone that fired *between* its runs — it
     falls back to marking the red alert tick (`.alert-located`). Cleared on new file + Reset Filters.
   - **Scroll direction is now explicit per call site.** `flashFeedRow`'s `scrollIntoView` walked every
     ancestor scroller (including the window) and would fight the new scroll-up, so feed rows scroll inside
     `#feedScroll` via `scrollFeedTo` (rect math), and the timeline→feed paths (`jumpTo`, `revealRunStart`)
     call `scrollPageTo(feed, "nearest")` themselves. Both honour `prefers-reduced-motion`.
   - **`index.html`** — new `id="timelineCard"` (scroll target) + `id="feedScroll"` (feed scroll box);
     legend + `↗ timeline` tooltip reworded. **`src/styles.css`** — `.tl-located` / `.alert-located`, with
     `.tl-located` declared **last** so `.run-soak` (`box-shadow:none`) and `.run-manual-mark` (inset border)
     don't win at equal specificity and drop the ring.
   - **Verified.** 104 Vitest green (DOM-only change), build clean. Browser (Chrome DevTools MCP): jump from
     the bottom of the feed scrolls the card to viewport top, auto-adds the hidden zone lane, rings the bar,
     ring survives Hour-preset + nav re-renders, clears on the next jump / Reset / new file; alarm-with-no-bar
     rings its tick; bar clicks still scroll *down* to the feed; reduced-motion snaps. On **73,346 events**
     the jump is **15 ms** of synchronous work with **zero** feed rebuilds (`renderFeed`'s signature
     early-return holds). Mirrored in `NOTES.md`, `docs/HOW_TO_USE.md`, `docs/DEMO_GUIDE.md`, in-app guide.
1. **Fixed a time-flake in `tests/feedback.test.js` that could redden the deploy gate** — found while running
   the suite above at 15:47. The privacy test asserts the serialized report contains no pair value, but its
   fixture used **`AC=47`** while `assembleReport` stamps `capturedAt: new Date().toISOString()`
   (`feedback.js:106`; each `errors.js` entry carries an ISO `time` too) — so `not.toContain("47")` failed
   during **minute :47 of every hour**, i.e. a green tree went red ~1 min in 60 and blocked the Pages deploy
   (`deploy.yml`: `build needs: test`). The invariant was sound; only the fixture was. Two changes:
   - **Markers can no longer collide with a timestamp** — `PG=41`/`ZN=777`/`AC=47`/`VP=12.3` →
     `PG=414141`/`ZN=777777`/`AC=4747.47`/`VP=1212.31`: long, and the decimals keep a dot (a dot can't appear
     inside an ISO field), matching the existing `SECRETSN99`-style markers.
   - **The worst case is now deterministic, not 1-in-60** — the test pins the clock with
     `vi.setSystemTime(new Date("2026-06-17T15:47:47.477Z"))` (every field packed with the markers' digits)
     and an `afterEach(vi.useRealTimers)`. Verified both ways: under the frozen clock the **old** `AC=47`
     fixture fails on *every* run (so the guard really bites), and the new one passes. **104 green.**
1. **PDF export rebuilt on native browser print (fixes the freeze on large logs)** — prompted by a user
   report that "Download PDF" was "very very slow, often stopping the entire application." Root cause: the
   export handed the whole `#dashboard` to **html2pdf.js**, which **html2canvas**-rasterized the entire DOM
   at `scale:2` synchronously on the main thread — a multi-second freeze that could exceed the browser's
   canvas-size limit (blank/broken result) on big logs. Replaced it with the browser's **native print**:
   - **`src/app.js`** — the `#pdfBtn` handler now stamps a header, sizes `#dashboard` to `PRINT_WIDTH_PX`
     (1024, fits A4 landscape), sets `hydroDirty=true` + `render()` so the responsive Chart.js canvas and
     the pixel-positioned swimlane bars regenerate at a width that fits the page, then calls
     `window.print()` (after a 2×rAF + 120ms settle). A module-level `afterprint` listener clears the width,
     removes the stamp, and re-renders to restore the screen layout. The `await import("html2pdf.js")` and
     the jsPDF/html2canvas options are gone.
   - **`src/styles.css`** — new `@media print` block: `@page A4 landscape`, isolates `#dashboard` (hides
     `aside`, `#dashHeader`, the scrubber drawer, the modals, and everything tagged
     `data-html2canvas-ignore` — now the "not in the report" marker), keeps the dark theme + colored bars
     via `print-color-adjust:exact`, and `break-inside:avoid` on cards. Feed keeps its 540px clip.
   - **`index.html`** — added `id="dashHeader"` to the main header row (so print hides it by id), relabeled
     the button **"Download PDF" → "Print / Save as PDF"** with a new title, retitled `#controllerId`.
   - **`package.json`** — removed the now-unused `html2pdf.js` dependency (`npm uninstall`, 22 packages
     gone). Initial JS ≈244 kB; no more on-demand export chunk.
   - **Verified.** 104 Vitest green, `npm run build` clean. Browser (Chrome DevTools MCP): on
     `Evnt_flow_test.csv` the print layout renders isolated + dark with colored bars/alert ticks/stamp and
     no console errors, the handler resizes→renders→`print()` once and `afterprint` restores; on a
     synthetic **73,000-event** log the whole print flow took **187 ms** (≈67 ms of real work + the 120 ms
     settle) — no freeze, versus the old multi-second html2canvas hang. Mirrored in `NOTES.md` (§4/§6/§7),
     `docs/HOW_TO_USE.md`, and the in-app guide.
1. **In-app help accuracy pass: fix stale tooltips, fill gaps, refresh the guide**
   (`b558b97`, `c968fea`, `9509a1f`). Prompted by a user question — the "Human audit only" toggle and the
   "More filters" **Category → Manual Run** option both *look* like they should surface manual runs on the
   timeline, but neither does. Audited every `title=` tooltip and the `buildGuide` walkthrough against the
   actual behavior; text/markup only, no logic — **104 tests stayed green**, build clean, verified in
   Chrome (DevTools MCP) with all tooltips present and no console errors. The pieces:
   - **Clarified the feed-vs-timeline distinction** (`b558b97`, `c968fea`). "Human audit only" and the
     More-filters `Category`/`Action`/`Trigger`/`Min-Flow` selects filter *events* for the **Audit Feed**,
     but they share the set that draws the timeline — so a single selection can silently **empty the
     swimlane** (a run bar needs both its start and its controller-generated stop event; only Zone/Program/
     Mainline categories have lanes). Reworded the Human-audit tooltip + sub-label and added tooltips to all
     four More-filters controls, each pointing users to **Show on timeline** (lanes) + **Run type → Manual**
     as the controls that actually shape the timeline. Mirrored in the guide and `docs/HOW_TO_USE.md`.
   - **Fixed three stale/wrong tooltips** (`9509a1f`), each verified against the code: the swimlane legend
     said *"click a block to zoom"* — clicking a bar actually jumps to its start line in the feed
     (`revealRunStart`, `app.js:657`), corner arrows pan to the run's other edge, red ticks jump to the
     alert; the Window-presets tooltip said presets *"centre on the current view"* — they centre on the
     **scrubber playhead** (`setWindowUnitCentered`, `app.js:349`); the stat-strip "Window" tooltip claimed
     the window scopes the feed too — the **feed is whole-log**, independent of the window (`app.js:317`).
   - **Filled the missing tooltips** the guide promises ("hover almost anything"): Date/Time Range, the
     Programs/Zones/Mainlines lane dropdowns, Run type + Scheduled/Manual/Alert-markers, and the Back button.
   - **Refreshed guide step 3** to mention scrubber-centered presets + the minimap's live playhead-mirror
     marker. `docs/HOW_TO_USE.md` was already accurate on all three points — it was the source of truth the
     in-app text had drifted from; no doc change needed there.
1. **BaseManager protocol-spec cross-check + privacy-test gate + P0 cleanup finish** (`ab4a625`;
   `REPO_ANALYSIS_PLAN.md` as `d5551b5`).
   Verified the previous session's docs/code against `REPO_ANALYSIS_PLAN.md` (all P0–P2 claims held;
   102 tests were green) and cross-checked the whole repo against the vendor's internal
   `Baseline Protocol Specification - BaseManager Opcodes.md` (repo root, now **gitignored — local-only,
   never commit**; referenced in `NOTES.md` §1). Spec agreed with `STATUS_MAP`, `EVENT_CAUSE_MAP`,
   SR/SP semantics, GPM/PSI units, and the flush schedule; namespaces confirmed as distinct from the
   event-log columns (don't merge). Gaps fixed:
   - **`PR` (Programmer) added to `HUMAN_TRIGGERS`** (`US/OP/PR/AD` — the spec's four human tiers), so a
     Programmer-triggered run reads as manual and passes "Human audit only"; wording updated in
     `docs/HOW_TO_USE.md`, the `index.html` tooltips, the in-app guide, and `NOTES.md`; `runs.test.js`
     extended. (No PR rows exist in any local log — future-proofing only.)
   - **Spec-derived map additions:** `STATUS_MAP` `FL:"Water Full"`; `KEY_INFO` `DF` (design flow, GPM —
     real `ZN,SR` rows carry it); `GENERAL_NOTES` now notes Error entries flush immediately.
   - **Privacy invariant is now CI-gated:** extracted `assembleReport()` in `src/feedback.js` (the single
     place the outgoing report is built; `buildPayload` delegates) and added `tests/feedback.test.js` —
     real `parseRow` events, serialized report must contain no raw line / pair values / extras, and the
     top-level key whitelist is pinned. **102 → 104 tests.**
   - **P0.4 artifact cleanup:** deleted `image.png` (1.6 MB), the stray screenshot, `index.html.bak`.
   - `REPO_ANALYSIS_PLAN.md` annotated with outcomes (P0–P2 done; 2.3 `ZN,SP` decided as **no change**;
     P3/P4 deferred) so it can be committed as the record of the sweep.
1. **Repo-analysis P0–P2 fixes: privacy, category labels, actor-code unification, noise-alert de-pinning,
   and feed/scrubber performance** (`ab4a625`). Driven by `REPO_ANALYSIS_PLAN.md`. The pieces:
   - **P0 — privacy & labels.** Gitignored `Events1000.csv` (a real support log that was untracked but not
     ignored). Removed a dead duplicate `SS` key in `KEY_INFO`. Extended `CATEGORY_MAP` (`src/constants.js`)
     with the real-log column-B codes it was missing (`PC`=Control Point, `SB`=SubStation, `MG`=Message,
     `PZ`=Program Zone, `AP`/`BK`/`CM`/`CN`/`ED`/`EM`/`EZ`/`NW`, `FL`=Flash Archive) so they read as words
     instead of raw codes — label-only, `NOISE_CATCODES` unchanged.
   - **P1 — decided behavior changes + tests.** New shared `HUMAN_TRIGGERS = {US,OP,AD}` in `constants.js`
     now backs **both** the manual-run classifier (`runs.js` `makeRun`) and the "Human audit only" filter
     (`app.js`), which previously disagreed (`US|OP` vs `US|AD`); Admin-triggered runs now read as manual and
     Operator actions now pass the human-audit filter. `selectFeedRows` no longer pins **noise-category
     alerts** (`isAlert && !isNoise`) so a `TW,ER` two-wire flood (90%+ of a real support log) stops burying
     real events when Advanced is on. Added regression tests: the `Events1000.csv` unpadded/offset-less
     timestamp variant, `ZN,SR` not opening a run, `ZN,DN`+same-second-`ZN,SP` yielding one clean run,
     stop-only `PG=99` floods yielding zero runs, noise-alert de-pinning, the search-text cache, and a new
     `tests/errors.test.js` (ring-buffer cap/truncation/console-tee, with a minimal `window` shim — no jsdom
     dep). **90 → 102 tests.**
   - **P2 — performance.** `renderFeed` now **early-returns on an unchanged content signature** (the feed is
     whole-log, so pan/nav/scrubber re-renders skip the `selectFeedRows` + ≤1500-row `innerHTML` rebuild);
     `applyFilters` sets `lastFeedSig = null` so a same-length filter swap still rebuilds. `feedSearchText`
     memoizes its haystack per event and `#feedSearch` is debounced ~150 ms; `selectFeedRows` column sort
     decorate-sort-undecorates. `visibleRunsAt()` is memoized (`visRunsCache` keyed on `runGen` + lane/type)
     so scrubber `snapTime`/panel frames reuse one array; the panel's flow carry-forward walks a chronological
     AC/EX/PR-only `telemetry` subset (built in `applyFilters`) and breaks past the playhead instead of
     scanning all of `filtered`.
   - **Verified.** 102 Vitest green, `npm run build` clean. Browser-checked (Chrome DevTools MCP) on
     `Evnt_flow_test.csv` (renders, scrubber flow panel), `Events1000.csv` (unpadded timestamps parse to
     6/28→7/2; labels read as words; noise-alerts de-pinned; feed-skip on pan, rebuild on filter), and
     `Evnt_202606.csv` (73,346 events at scale; human-audit filter → 114 person events) — no console errors.
     Mirrored in `NOTES.md`, `docs/HOW_TO_USE.md`, and the in-app guide / tooltips. `REPO_ANALYSIS_PLAN.md`
     documents the full sweep (P3 DRY refactors + P4 structural work intentionally deferred).
2. **Audit-feed overhaul: whole-log list + search/sort + timeline↔feed jumps, orphan-zone dropdown fix, and
   navigation refinements** (branch `feature/audit-feed-search-jump`). The pieces:
   - **Feed now lists the whole loaded log**, not just the current window (`renderFeed()` drops its range
     param and bases off `filtered`). The stat strip / swimlane / chart stay window-scoped. Because the feed
     no longer changes when the window pans, `renderFeed` preserves the scroll container's `scrollTop` across
     renders whose content signature (`feedQuery`/sort/`filtered.length`/`revealedFeedIds.size`) is unchanged.
   - **Whole-log search + column sort** — pure helpers `feedSearchText`/`feedMatches`/`feedSortValue` in
     `classify.js` (unit-tested). `#feedSearch` token-ANDs across each event's cells + raw line; `#feedHead`
     is a clickable column header cycling asc → desc → off. Feed-only `refreshFeed()`; both reset on new-file
     load + Reset Filters.
   - **Per-row "↗ timeline" button** and **bar clicks** + **At-Playhead items** all route through
     `locateOnTimeline(ts, target, feedEvent)`: it turns the scrubber on, drops the playhead exactly on `ts`,
     sets `pendingBarHighlight` (consumed at the end of `renderSwimlane`) so `flashBar` pulses every segment
     of the matched run (amber `.tl-hit`), pans if off-window, and optionally reveals+flashes the raw feed
     row. Target lane comes from the pure `eventRunTarget(e)`. Timeline **run bars** now jump to the feed
     instead of zooming (removed the unused `zoomTo`).
   - **Orphan-zone program dropdown fix** — pure `zoneRunInProgram` in `runs.js` (unit-tested): a zone run
     whose PG tag matches **no** real program run (e.g. a `ZN,WT` stamped with a program that never started)
     is attributed to the program whose run window overlaps it, so expanding that program lists the zones
     that actually ran under it. Normal (matching-PG) case unchanged.
   - **Navigation refinements**: (a) window presets now open a window of that unit's duration **centered on
     the scrubber** (`setWindowUnitCentered` → pure `centeredWindow`/`WINDOW_UNIT_MS`; `snapWindow` still backs
     default/Reset/nav); (b) the minimap view-box + edge handles no longer clip at the extremes
     (`layoutMiniWindow` clamps the box inside the track, handles flush at `0`); (c) `#miniPlayhead`
     (`positionMiniPlayhead`, hooked from `positionPlayhead`) **mirrors the scrubber onto the minimap** live.
   - **Feed selection is now a pure, tested function** — `selectFeedRows(events, {query, sortCol, sortDir,
     revealedIds})` in `classify.js`; `renderFeed` just calls it + caps. Added a regression test mirroring the
     6/28→7/2 report (whole-log, date sort asc/desc, search across days, revealed markers, alarm pinning) so
     "the feed is the whole log" can't silently regress. Verified the live pipeline on `Events1000.csv`
     (235 rows, 6/28→7/2) after a user report that turned out to be a stale browser bundle.
   - **90 Vitest tests green, build clean.** DOM interactions verified by code review + dev-server HMR + an
     ad-hoc Node pipeline check (no Chrome DevTools MCP this session). Mirrored in `docs/HOW_TO_USE.md`,
     `docs/DEMO_GUIDE.md`, the in-app guide, and `NOTES.md`. Test data `Events1000.csv` is local-only (never commit).
2. **Removed the redundant Zone filter from "More filters"** (uncommitted) — the standalone Zone
   dropdown overlapped confusingly with the **Zones** lane picker, so it was dropped; Category / Action /
   Trigger / Min-Flow stay (with no feed text-search, they're the only per-type feed narrowing). Deleted
   the `#zoneFilter` markup (`index.html`) and every reference in `src/app.js` (`fillSelect`, the
   `applyFilters` read + predicate, `FILTER_SELECTS`, the reset list, and the `getDiagnostics` payload);
   corrected the More-filters wording in the in-app guide + `docs/HOW_TO_USE.md`. Verified the remaining
   filters all run correctly in-browser: **Advanced/low-level chatter** (1,833→2,193 on the real support
   log), Category/Action/Trigger, Min-Flow, variance, human-audit, alerts-only, and Reset — no console
   errors. 71 tests green, build clean.
2. **"No flow data" clarity + hover tooltips** (`c5d50f3`) — a support log with no `AC`/`EX` flow
   pairs "showed no flow," which was correct (the Flow overlay is fed only by `FLOW_KEYS = {AC,EX}` in
   `src/constants.js`, consumed at `src/parse.js:71`) but invisible because the existing "No flow
   telemetry" overlay/legend only appears *after* toggling Flow on (off by default). Now: a `#flowNote`
   ("· no flow data") shows next to the **Flow** toggle at load whenever a loaded log has no AC/EX —
   toggled in the same loader spot that sets `hasHydro`/`#varSection` (`src/app.js` ~L216); its `title`
   and the reworded `#hydroEmpty` overlay + legend explain that flow needs AC/EX readings (logged during
   zone runs with flow monitoring) and to check the FlowStation / flow report for flow with no zones
   running. Also added native `title=` hover tooltips across previously-unexplained UI: the Flow/variance
   controls, the timeline legend swatches (scheduled/manual/stopped/soaking + the inferred-end hatch),
   the stat strip, Window presets + minimap, and the sidebar filters (Human-audit, SubStation,
   Alerts-only, Advanced); the At-Playhead run rows' `title` now explains the soaking/stopped/manual tag
   and the alert rows got a title too. UI/markup only — no data-logic change, 71 tests still green,
   build clean; verified in-browser with the real support log (flag + messages) and the synthetic
   `Evnt_flow_test.csv` (flag hidden, flow charts normally), no console errors. Mirrored in
   `docs/HOW_TO_USE.md` step 5 and the in-app guide. (The real support log `Events_test.csv` was added
   to `.gitignore` — never commit it.)
2. **Removed the swimlane event-pin** (`de6be55`) — the blue vertical `#swimPin` line dropped on the
   timeline when clicking a feed row / alert tick / event marker / panel item was confusable with the
   amber scrubber playhead and added little, so it's gone. Deleted `pinnedTs`, `positionPin`, `pinAt`,
   the `#swimPin` element + CSS; `jumpTo` now just `focusFeedEvent` (scroll/expand/flash the feed row),
   and feed-row clicks just expand detail. Updated the legend / feed heading / in-app guide / `NOTES.md`
   wording. 71 tests still green; verified in-browser (feed + marker clicks work, no pin, no console
   errors).
2. **Cycle-and-soak zone runs are split into watering vs soak segments** (`3c77415`) — a zone waters
   in cycles separated by soaks (`ZN,WT` water → `ZN,SO` soak begins → next `ZN,WT` ends the soak →
   … → `DN`/`PA`); previously the whole span rendered as one solid bar (e.g. a real ~60-min watering run
   shown as a 2-hour block). `buildRunIntervals` still emits **one run envelope** (no-`DN` inference,
   manual, scrubber, tests all unchanged) and **additively** attaches a `segments` array
   (`buildSoakSegments` in `src/runs.js`) to zone runs that soaked. A new **Soak** toggle
   (`#soakSplitOn`, default on; `soakSplit` in `app.js`) drives `zoneBars`, which renders each segment via
   `barHTML(…, soak)` — watering = zone color, soak = `.run-soak` (dimmed/striped, new CSS); status hatch
   stays on the last segment, manual badge on the first. The scrubber panel tags a zone "· soaking" with a
   dimmed dot when the playhead is in a soak gap. Zone-only. New `runs.test.js` cases (71 green); a
   cycle-and-soak zone (Z5/PG4, 07:00–07:50) was added to the synthetic `Evnt_flow_test.csv`. Verified
   in-browser (segments, soak tooltip, toggle on/off, "soaking" in the panel) and against the real
   `Evnt_202606.csv` (zone 4, 06/03 → 6 watering cycles + 5 soaks, last segment terminated by the `PA`);
   no console errors. Mirrored in `docs/HOW_TO_USE.md`, the in-app guide, and `NOTES.md`.
2. **"At Playhead" panel items now jump to the raw feed row** (`7347cbc`) — every row in the scrubber's
   right-side panel is clickable. Clicking a **Running now** run (program/zone/mainline) jumps the Activity
   Audit Feed to that run's **start** event and scrolls/expands/flashes it; alert rows already did this via
   `jumpTo`. Run start/done rows are normally hidden from the feed (`isDurationMarker`), so events get a
   stable `_id` at load and the clicked start's id goes into **`revealedFeedIds`**, which `renderFeed`
   force-includes (and shields from the `FEED_CAP` slice). If the start is outside the current window,
   `revealRunStart` `panToTime`s to it first. New helpers in `app.js`: `findRunStartEvent`, `revealRunStart`,
   `flashFeedRow` (shared with `focusFeedEvent`). No data-logic change → the Vitest suite was unaffected
   (68 green); verified in-browser against `Evnt_flow_test.csv` (program, zone, and off-screen cases;
   no console errors). Mirrored in `docs/HOW_TO_USE.md` + the in-app guide.
2. **In-app "How to use" guide + doc** (`e3cef48`) — added a header **How to use** button
   (`#guideBtn`) opening a `#guideModal` walkthrough (numbered getting-started steps, a panes overview,
   and a plain-language tour of every sidebar filter), built by `buildGuide()` in `src/app.js` reusing
   the Reference-modal show/hide/Esc pattern. Static HTML (no data needed), styled with the existing
   Tailwind classes. Mirrored in `docs/HOW_TO_USE.md` for GitHub readers. Verified in-browser (renders,
   color swatches correct, no new console errors).
2. **Zone runs that never log a `DN` now close at their real end** (`e3cef48`) — a faulted zone can
   keep being commanded with no `ZN,DN`, which used to render as *ongoing to end-of-log* (a colleague
   saw a ~20-min run shown as **53h 58m**). `buildRunIntervals` now infers the end of an unclosed
   **zone** run from the controller's run-list heartbeat (`closeOpenZoneRun` in `src/runs.js`):
   Tier 1 = last `ZN,RL` that listed the zone before a later run-list dropped it; Tier 2 = first
   `MV`/`PM` `DN` after start if the zone never appeared in a run-list; Tier 3 = still in the final
   run-list → stays ongoing. Tiers 1–2 mark the run `terminated` + a new `inferred:true` flag; `barHTML`
   (`app.js`) shows "ended early (no DONE logged; inferred from run list)" and reuses the terminated
   hatch (no new CSS). Zones only — programs/mainlines unchanged. New `runs.test.js` cases cover all
   three tiers. Verified against the real `Evnt_202606.csv`: zone 1's 06/22 run now ends 10:23 (was
   53h 58m), and the genuinely-ongoing zone 2 at end-of-log still reads ongoing. (Real monthly logs
   `Evnt_2*.csv` are now gitignored — never commit them.)
2. **Manual runs now visible on the timeline** (`8f2b4e6`) — the controller logs a manual zone run as
   `ZN,MR,…,PG=MR` (action `MR`, no `WT` line), so `buildRunIntervals` (which only opened zone runs on
   `WT`) built no interval and manual zones were invisible. Added `MR` to the zone start set
   (`src/runs.js`); manual bars now keep their zone color plus an amber inset border + "M" badge
   (`barHTML` in `app.js`, `.run-manual-mark`/`.run-manual-badge` in `styles.css`); `CATEGORY_MAP` gained
   `MR:"Manual Run"`; legend updated. New `runs.test.js` cases cover manual (`MR→DN`) vs scheduled
   (`WT→DN`). Verified in-browser against a real log: zone 118 now shows as manual in the bar + the
   "running now" panel. (Real log `testmanual.csv` is gitignored — never commit it.)
2. **3200 MZ object-spec integration** (`2cdb619`) — added the vendor spec at
   `docs/object-definitions-19.8.2.html` + distilled `docs/OBJECT_DEFINITIONS.md`; transcribed its
   enumerations into `src/constants.js` (Status, Event Causes, Message Codes/Category/Priority, Object
   Keys, Stop Conditions, Zone Mode, Data-Group index); added the context-scoped `VALUE_ENUMS` registry
   so `parse.js` decodes enumerated values (`ST`/`SC`/`PC`/`TC`/`KD`/`KT`, with `PR` scoped to `MG`);
   `whyText` now leads with decoded message codes/causes; glossary modal gained the new reference tables
   + a collapsible object-model section. New Vitest cases cover decoding + context-scoping.
2. **Docs sync** (`e261d78`) — brought `NOTES.md` up to date with the items below.
2. **Vitest suite + CI gating** (`a334545`) — extracted pure logic into 4 modules; added tests; deploy
   now gated on them.
3. **Performance pass** (`2ce456b`) — slim Chart.js register, lazy `html2pdf` import, minimap density
   gating (`miniDensityDirty`), rAF-throttled scrubber panel, event delegation.
4. **Web3Forms feedback** (`a689021`) — feedback button POSTs to Web3Forms (`VITE_WEB3FORMS_KEY`).

## Known gaps / candidate next work (not requested — just options)

- No integration/E2E layer (jsdom or Playwright) over the DOM render pipeline.
- Large logs rely on the 1500-row feed cap (`FEED_CAP`) + density binning; the feed isn't virtualized.
- Polish ideas: keyboard nav for the scrubber, persist toggle state across reloads, export the
  event/alert timeline data, narrow-screen layout for the drawer.

---

> **Next AI:** when you finish work, update **"Current state"** and prepend a bullet to **"Last session"**
> above (with the commit hash), and reflect anything architectural in `NOTES.md`. Then push.
