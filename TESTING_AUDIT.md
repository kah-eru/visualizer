# Testing Adequacy Audit

**Date:** 2026-07-15 · **Method:** read-only review of all source and test files, CI workflows, and one run of the suite. No code was changed.

**Suite status at audit time:** `npx vitest run` → **6 files, 120 tests, all passing** in ~2s (vitest 2.1.9, Node environment, `TZ=UTC` pinned in `vitest.config.js`).

> ## Remediation status (updated 2026-07-15, post-implementation)
>
> **P0, both P1 items, and both P2 items are DONE.** Suite is now **9 files, 200 tests** (~3s), plus a
> Playwright smoke test and coverage tooling. P3 (Gap 6) remains **open**. What landed:
>
> | Gap | Status | What was done |
> |---|---|---|
> | 2 — privacy test guards a copy | ✅ | `buildDiagnostics` extracted to `src/diagnostics.js` (pure); `getDiagnostics` (app.js) now only reads the DOM and delegates. `feedback.test.js` runs the **real** function; new `tests/diagnostics.test.js` pins its key whitelist. **Verified by injecting a leak and watching both tests fail.** |
> | 1 — `app.js` untested | ✅ (partial by design) | `src/view.js` (147 ln, **100% covered**, 60 tests): filter predicate, window/nav math, minimap transforms, run selection/coverage, snapping, `jumpTitle`. `toLocalInput` → `format.js`. Memo caches stayed in `app.js` on purpose. `app.js` 1,742 → **1,687 ln**. |
> | 5 — CSV ingestion untested | ✅ | `eventsFromRows` extracted to `parse.js` (shared by `handleFile` and the test); `tests/pipeline.test.js` runs real CSVs through the whole chain. **See the correction below.** |
> | 3 — no coverage | ✅ | `@vitest/coverage-v8` + `npm run test:coverage`, per-file thresholds on the pure modules only. |
> | 4 — no E2E | ✅ | `e2e/smoke.spec.js` + `playwright.config.js`; `npm run test:e2e`. Wired into `ci.yml` only — **not** the deploy gate (see below). |
> | 6 — `guard()` / `initFeedback` | ⏸ open | Still P3. Needs a DOM; `errors.js` 70%, `feedback.js` 27%. |
>
> ### Correction to this audit's own premise (Gaps 4 & 5)
>
> Gap 5 below says *"five real sample logs sit in the repo"* and Gap 4 proposes a smoke test that drops
> `Events_test.csv`. **That is wrong, and following it literally would have broken CI or the privacy
> rule.** Four of the five logs are gitignored (`testmanual.csv`, `Evnt_2*.csv`, `Events_test.csv`,
> `Events1000.csv` — confirmed with `git check-ignore`); only the synthetic `Evnt_flow_test.csv` is
> committed. Tests over the other four would be red on every fresh clone, and the obvious "fix" —
> committing a log — violates the repo's #1 rule.
>
> **How it was resolved:** `pipeline.test.js` always pins `Evnt_flow_test.csv` (gates CI), and guards
> each real log behind `describe.skipIf(!existsSync(...))` — full protection locally, clean skip in CI.
> The smoke test uses the synthetic fixture. *Gotcha for whoever touches this next:* `describe.skipIf`
> still **executes its callback** to collect tests, so the CSV load must be lazy (inside the `it`s) —
> a top-level `load()` throws ENOENT during collection and reds the file instead of skipping it. Both
> paths were verified by temporarily hiding a log.
>
> ### Coverage baseline (2026-07-15, first measurement)
>
> ```
> File            | % Stmts | % Branch | % Funcs | % Lines
> All files       |   34.33 |    94.00 |   78.57 |   34.33
>  app.js         |       0 |        0 |       0 |       0   ← the blind spot, now measured
>  view.js        |     100 |      100 |     100 |     100
>  diagnostics.js |     100 |      100 |     100 |     100
>  parse.js       |     100 |    87.34 |     100 |     100
>  runs.js        |     100 |    98.09 |     100 |     100
>  classify.js    |     100 |    93.93 |     100 |     100
>  format.js      |   97.34 |      100 |    92.3 |   97.34
>  errors.js      |   70.17 |    70.58 |      75 |   70.17   ← Gap 6
>  feedback.js    |   27.48 |       25 |    7.69 |   27.48   ← Gap 6
> ```
>
> `app.js` reporting 0% is **expected and is the point** — it can't be imported in Node at all. That
> number is the visible measure of Gap 1, and it should fall as more logic is extracted. Thresholds are
> therefore **per-file on the pure modules only**: a global threshold would fail on `app.js` every run
> and train everyone to ignore the signal entirely.
>
> ### Why the smoke test is not a deploy gate
>
> `ci.yml` runs it on PRs/branches; `deploy.yml` still gates only on `npm run test:run`. The deploy gate
> is currently 100% reliable and a browser job is the most flake-prone thing here — a flaky gate blocks
> the live site. Promote it once it has a green track record.

---

## Verdict

**The data pipeline is well tested; the interactive layer is not tested at all.**

The repo has a deliberate, effective testing architecture: all parsing, run-interval, classification, and formatting logic lives in small dependency-free modules, and every one of those modules has a thoughtful test file. The tests themselves are unusually high quality — grounded in real log data, regression-pinned, and flake-hardened.

The gap is `src/app.js`: 1,742 lines (~64% of all source), zero tests, and — per recent git history — the place where regressions actually happen. There is also one targeted hole in the repo's most important test (the privacy invariant), no coverage measurement, and no integration/E2E layer.

**Overall grade: B.** Adequate for the pure core, inadequate for the app as a whole.

---

## Scorecard

*(As of the audit. See the remediation table above for what changed — the post-fix figures are in
brackets.)*

| Module | Lines | Test file | Coverage assessment |
|---|---|---|---|
| `src/parse.js` | 106 [120] | `parse.test.js` (165 ln, 20 tests) | **Excellent** — timestamps (both CSV variants), enum decoding, unit conversion, null/garbage input, program inference incl. out-of-order events. *[+ `eventsFromRows`, covered by `pipeline.test.js`]* |
| `src/runs.js` | 136 | `runs.test.js` (308 ln, 32 tests) | **Excellent** — all 3 modes, manual/terminated/ongoing, 3-tier no-DN inference, cycle-and-soak segments, real-log regressions |
| `src/classify.js` | 156 | `classify.test.js` (259 ln, 41 tests) | **Excellent** — every export tested, incl. jump-routing and feed-selection bug regressions |
| `src/format.js` | 105 [113] | `format.test.js` (132 ln, 20 tests) | **Good** — all exports; time formatting checked structurally (locale-tolerant), which is a sensible tradeoff. *[+ `toLocalInput`, moved in from app.js]* |
| `src/errors.js` | 114 | `errors.test.js` (52 ln, 5 tests) | **Partial** — ring buffer solid; `guard()` error path, `showErrorBanner`, and global handler wiring untested |
| `src/feedback.js` | 211 | `feedback.test.js` (88 ln [102], 2 tests) | **Partial** — `assembleReport` privacy invariant + key whitelist tested; `initFeedback` (~half the file: widget, send/download paths) untested. *[now fed by the real `buildDiagnostics`, closing Gap 2]* |
| `src/app.js` | **1,742** [1,687] | **none** | **Untested** — see Gap 1 |
| `src/view.js` | *[147]* | *[`view.test.js` (317 ln, 60 tests)]* | *[**Excellent** — 100%. Extracted from app.js: filter predicate, window/nav math, minimap transforms, run selection/coverage, snapping, `jumpTitle`]* |
| `src/diagnostics.js` | *[52]* | *[`diagnostics.test.js` (62 ln, 5 tests)]* | *[**Excellent** — 100%. The pure shaping behind `getDiagnostics`]* |
| `src/constants.js` | 154 | — (data only) | OK — exercised indirectly by parse/classify tests |
| `src/main.js` | 9 | — (entry point) | OK — trivial |
| — | — | *[`pipeline.test.js` (164 ln, 15 tests)]* | *[Golden end-to-end tests over real CSVs — Gap 5]* |

Totals: ~2,730 lines of source, 1,004 lines of tests. *[After remediation: ~2,930 source, ~1,600 tests
across 9 files + 1 Playwright spec.]*

---

## Strengths worth preserving

1. **Testability by architecture.** Pure logic is extracted out of the DOM layer into modules with no imports beyond each other. This is why 120 fast Node tests exist at all in a browser app with no jsdom dependency.

2. **Regression tests grounded in real data.** `runs.test.js:186-221` pins behaviors discovered in the real monthly log (`Evnt_202606.csv`): same-second `ZN,SR`/`ZN,WT` must not double-open a run; a `ZN,DN` trailed by a same-second `ZN,SP` must not create a phantom run; a 34k-row stop-only flood must yield zero runs. `classify.test.js:146-196` pins the "6/28→7/2 feed window" bug report and the noise-alert pinning rule.

3. **Flake-hardening with documented reasoning.** `feedback.test.js:27-35` explains why the privacy markers are long dotted numbers (a short marker matched the report's own timestamp during minute :47 of every hour) and freezes the clock on the hostile instant `15:47:47.477` so the collision case runs every time instead of once an hour.

4. **The privacy invariant is CI-gated.** `feedback.test.js` asserts the outgoing feedback report contains no raw CSV lines, pair values, or free-text extras, and that its top-level keys are an exact whitelist — turning the project's #1 rule ("CSV contents never leave the browser") into a deploy gate.

5. **CI is real and gates deploys.** `.github/workflows/ci.yml` runs `npm run test:run` on PRs and non-main pushes; `.github/workflows/deploy.yml` runs the same tests as a prerequisite of the Pages build, so a red suite cannot ship.

6. **Determinism.** `vitest.config.js` pins `TZ=UTC` so the wall-clock `Date` logic behaves identically on every machine and in CI.

---

## Gaps (ranked)

### 1. `src/app.js` — 64% of the source, zero tests

The entire interactive layer is untested: filtering, view-window/zoom/nav math, timeline + swimlane rendering, scrubber and playhead, minimap, feed rendering, jump-to-timeline routing glue, print export, and file loading.

This is not just theoretical risk — the last five commits are all fixes to this file's behavior (feed arrow routing, At-Playhead panel, feed→timeline jump scrolling, PDF print freeze). **Regressions cluster exactly where there are no tests.**

Much of `app.js` is DOM-bound, but a meaningful slice is pure or nearly pure and could be extracted and tested the same way `classify.js` already was:

- `applyFilters` predicate logic (app.js:265-276) — 8 interacting filter conditions, none tested
- Window/nav math: `currentRange`, `clampView` (app.js:1369), `navShift`, `zoomOut`, `snapTime` (app.js:973)
- Minimap coordinate transforms `miniX2T`/`miniT2X` (app.js:1365-1366)
- `visibleRunsAt` (app.js:945) and `runCovers` (app.js:877) — the latter feeds the already-tested `eventJumpTarget`
- `jumpTitle` (app.js:1100), `toLocalInput` (app.js:244), bar-position math inside `barHTML` (app.js:496)

**Remedy:** continue the existing extraction pattern — move these into a pure module (e.g. `src/view.js`) and test them in Node. No framework change needed.

### 2. The privacy test has a hole at the exact point real data enters

`feedback.test.js:38-50` builds the diagnostics object from a **hand-written fixture** (`diagnosticsFor()`, commented "Mirrors the shape getDiagnostics() (app.js) returns"). The real `getDiagnostics()` (app.js:1721) is exported but never imported by any test.

Consequence: if a future edit adds a field to `getDiagnostics()` that carries row content (a "recent events" sample, a raw-line snippet in an error), **the privacy invariant test still passes**, because it never sees the real function. The repo's strongest test guards a copy of the thing, not the thing.

**Remedy:** feed the real `getDiagnostics()` output through `assembleReport` in the test. `app.js` touches the DOM at import time, so either (a) extract the diagnostics-shaping logic into a pure function that both `app.js` and the test import, or (b) add a key-whitelist test on `getDiagnostics`' return shape equivalent to the existing one on the report (feedback.test.js:82-87). Option (a) is stronger.

### 3. No coverage measurement

`@vitest/coverage-v8` is not installed; there is no `coverage` script or threshold. The `app.js` blind spot is invisible in CI — nothing reports that most of the codebase is unexecuted by tests, and nothing will flag it if tested modules regress in coverage.

**Remedy:** add `@vitest/coverage-v8`, a `test:coverage` script, and (once baseline is known) per-file thresholds on the pure modules.

### 4. No DOM/integration/E2E layer

There is no jsdom and no browser-driver (Playwright/Cypress) testing. Every user-facing flow — drop a CSV, change filters, drag the scrubber/minimap, sort/search the feed, click a feed row's ↗ jump, print to PDF — is verified only by hand. The PDF-export freeze fixed in `f9b5d37` is the kind of bug only this layer catches.

**Remedy (proportionate):** a single Playwright smoke test that loads the built app, drops `Events_test.csv`, and asserts the subtitle event count, one timeline bar, and one feed row would catch whole-app breakage (wiring, import order, Chart.js/PapaParse upgrades) at low maintenance cost. A full E2E matrix is not warranted for a project this size.

### 5. CSV ingestion is untested end-to-end

`handleFile` (app.js:119-146) — the PapaParse configuration, the parse-error paths, and the zero-valid-events early return in `onDataLoaded` (app.js:184-187) — is untested. Five real sample logs sit in the repo (`Events_test.csv`, `Events1000.csv`, `Evnt_202606.csv`, `Evnt_flow_test.csv`, `testmanual.csv`) but no test reads any of them.

**Remedy:** a Node-side golden test per fixture: read the file, run rows through `parseRow`/`inferEffectivePrograms`/`buildRunIntervals`, and pin the counts (events parsed, runs built, alerts). This would have caught the `Events1000.csv` timestamp-variant issue that `parse.test.js:24` now pins synthetically, and it protects against parser changes silently dropping rows on real data.

### 6. Untested branches in otherwise-tested modules

- `errors.js`: `guard()`'s catch branch (errors.js:110-112) and `showErrorBanner` are untested — only the success path is (`errors.test.js:49-51`). The window `error`/`unhandledrejection` wiring is shimmed away by the test setup.
- `feedback.js`: `initFeedback` (the widget, the Web3Forms send path, the download fallback) — roughly half the file — is untested.

These are lower priority: they are error-display plumbing, and fully testing them needs a DOM (jsdom or the Gap-4 smoke test would cover them incidentally).

---

## Prioritized recommendations

| Priority | Action | Effort | Payoff |
|---|---|---|---|
| ~~**P0**~~ ✅ | Close the `getDiagnostics` hole in the privacy test (Gap 2) | Small | The repo's #1 invariant becomes actually enforced |
| ~~**P1**~~ ✅ | Extract `app.js` pure logic (filters, window math, minimap transforms) into a tested module (Gap 1) | Medium | Tests where regressions actually occur |
| ~~**P1**~~ ✅ | Golden fixture tests over the sample CSVs (Gap 5) | Small | End-to-end pipeline protection using data already in the repo |
| ~~**P2**~~ ✅ | Add `@vitest/coverage-v8` + coverage script (Gap 3) | Small | Makes the blind spot visible and trackable |
| ~~**P2**~~ ✅ | One Playwright smoke test on the built app (Gap 4) | Medium | Catches whole-app/wiring breakage no unit test can |
| **P3** | Cover `guard()` error path and `initFeedback` (Gap 6) | Small | Completes the error/feedback plumbing |

### Still open after the 2026-07-15 remediation

- **Gap 6 (P3)** — `guard()`'s catch branch, `showErrorBanner`, and `initFeedback` (the widget, the
  Web3Forms send path, the download fallback). Needs a DOM; the smoke test could cover some incidentally.
- **Gap 1 is reduced, not closed.** `app.js` is still 1,687 lines at 0%. What remains there is genuinely
  DOM-bound — the render pipeline, swimlane/scrubber wiring, event delegation — and is better served by
  extending the smoke test than by extracting more. `barHTML` was **deliberately left** in place: it is
  95% HTML-string assembly, so extracting its four lines of bar arithmetic would test the trivial part
  and leave the actual regression surface uncovered.
