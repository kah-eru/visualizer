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

## Current state (as of 2026-06-26)

- **Version:** 1.0.0. **Branch:** `main`. Working tree clean at handoff.
- **Deployed & green.** CI gates the deploy on the Vitest suite.
- **Tested:** the pure data logic (`parse`/`runs`/`format`/`classify`) is covered by Vitest. The DOM
  render pipeline, swimlane/scrubber wiring, and PDF export are **not** automated — verify those in a
  browser.
- **Performance:** initial JS ≈219 kB (gzip ≈78 kB) after slimming Chart.js and lazy-loading html2pdf.

## Last session (most recent first)

1. **In-app "How to use" guide + doc** (uncommitted) — added a header **How to use** button
   (`#guideBtn`) opening a `#guideModal` walkthrough (numbered getting-started steps, a panes overview,
   and a plain-language tour of every sidebar filter), built by `buildGuide()` in `src/app.js` reusing
   the Reference-modal show/hide/Esc pattern. Static HTML (no data needed), styled with the existing
   Tailwind classes. Mirrored in `docs/HOW_TO_USE.md` for GitHub readers. Verified in-browser (renders,
   color swatches correct, no new console errors).
2. **Zone runs that never log a `DN` now close at their real end** (uncommitted) — a faulted zone can
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
