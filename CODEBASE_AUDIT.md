# Codebase audit — 2026-09-08

Audited checkout: `6dc9c71` (`Document complete zone and audit visibility`).

**Remediation status:** Implemented locally on 2026-09-08; see [implementation results](#implementation-results) below and the [completed plan](docs/superpowers/plans/2026-09-08-audit-remediation.md). The original findings and measurements below describe the pre-fix checkout, not the current working tree. Nothing was deployed or pushed.

The most urgent issue is **confirmed JavaScript execution from an uploaded CSV**. Several other confirmed bugs affect the dashboard's central promise: accurately showing what ran, when, and why. The largest measured performance opportunity needs only a cached native comparator. A framework rewrite or dependency replacement is not justified.

## Scope and verification

Reviewed the application modules, HTML/CSS, ingestion and run reconstruction, rendering and navigation, feedback/error reporting, dependencies, build/test/deployment configuration, test coverage boundaries, and repository documentation. Checked the vendor reference's role; did not exhaustively revalidate every vendor enumeration or audit dependency source code, Git history, remote repository settings, or the external feedback service.

No application fixes were applied. The existing untracked `Object_Definitions_19.8.6.html` was preserved. Browser reproductions used synthetic data and blocked non-localhost requests; no feedback was submitted.

| Check | Result |
| --- | --- |
| `npm run test:run` | 200 tests passed across 9 files, including available local-only fixtures |
| `npm run build` | Passed |
| `npx playwright test --reporter=list` | 3 Chromium tests passed |
| `npm audit --json` | 9 affected packages: 2 critical, 4 high, 3 moderate; these include inherited dependency findings |
| `npm audit --omit=dev --json` | 0 reported vulnerabilities |
| Built JS | 252.92 kB / 89.23 kB gzip |
| Built CSS | 28.22 kB / 6.79 kB gzip |
| Built HTML | 34.33 kB / 8.73 kB gzip |

Passing tests do not negate the findings below: the synthetic browser checks reproduced failures outside the existing scenarios. This is an evidence-based review, not a guarantee that no other vulnerabilities exist.

## Security — fix first

### 1. High: uploaded timestamps execute JavaScript

**Locations:** `src/parse.js:14`, `src/app.js:1128`, `src/app.js:1157`.

`parseTimestamp()` matches only the beginning of the timestamp. `feedRowHTML()` then interpolates `e.tsRaw` directly into HTML, unlike the surrounding escaped fields. This harmless synthetic row executed its event handler in the production build:

```csv
06/17/26 08:00:00<img src=x onerror=window.__auditXss=1>,SY,BT,SY,TX=synthetic
```

**Observed:** `window.__auditXss === 1` after opening the file. No external request was allowed during verification.

**Impact:** someone who supplies a crafted CSV can run script with the dashboard's origin privileges. The script could read the selected file through the file input, inspect displayed logs, modify results, or transmit data. Browser-only processing does not protect against this.

**Smallest fix:** use the existing `escapeHtml()` for the timestamp field. Separately anchor and validate timestamp parsing. Add a browser regression that imports the payload and verifies it appears as text without executing. A restrictive Content Security Policy would provide additional protection, but does not replace escaping.

### 2. Medium: imported identifiers collide with inherited object properties

**Locations:** `src/runs.js:22`, `src/parse.js:35`, `src/parse.js:107`.

Untrusted program/zone/mainline identifiers index ordinary `{}` dictionaries. Program names `constructor`, `__proto__`, and `toString` each reproduced `groups[e.program].push is not a function`. Assigning a `__proto__` pair also changes that individual pairs object's prototype.

**Impact:** malformed or crafted imports can crash processing or corrupt lookups. This demonstrates local prototype manipulation and denial of service, not proven global `Object.prototype` pollution.

**Smallest fix:** use `Map` or `Object.create(null)` for dictionaries keyed by imported values, and own-property checks for static lookup tables. Apply it consistently to the parser, inference, and grouping paths.

### 3. High maintenance priority: vulnerable development/test dependency tree

**Locations:** `package.json:20`, `package-lock.json`.

The installed tree includes Vite 5.4.21 and Vitest 2.1.9. Audit reports findings in Vite, Vitest, coverage-v8, mocker, vite-node, esbuild, PostCSS, nanoid, and brace-expansion.

The Vite advisories include Windows file-access bypasses and optimized-dependency source-map traversal. The critical Vitest finding concerns its UI/API/browser server under the conditions described by the maintainer. The checked-in Vitest configuration uses Node tests and does not enable that UI/API exposure, so the audit severity is **not evidence that the deployed static site has remote code execution**.

**Smallest fix:** update Vite and the matched Vitest/coverage pair to supported patched releases, refresh transitive dependencies, and verify build and browser behavior. Avoid an unreviewed `npm audit fix --force`. Retain localhost binding for development servers.

Sources: [Vite Windows advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff), [Vite source-map advisory](https://github.com/vitejs/vite/security/advisories/GHSA-4w7w-66w2-5vf9), [Vitest advisory and exposure conditions](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp). Package counts above come from this checkout's npm audit, not a count of independently exploitable application vulnerabilities.

## Accuracy and reliability

### 4. High: feed filters change the reconstructed history

**Locations:** `src/app.js:273`, `src/app.js:279`, `src/app.js:291`.

Run intervals are reconstructed from `filtered`, and their fallback ending is also calculated from `filtered`. Action, actor, variance, and other event filters remove the boundaries needed to reconstruct a run.

**Reproduction:** program start at 08:00, done at 08:05, unrelated event at 09:00. The original run lasts 300,000 ms. Filtering to the Start action produces a 1 ms run marked ongoing. Other filter combinations remove bars or infer different end times. The Human audit UI explicitly says it does not filter run bars, but it does affect their source events.

**Smallest fix:** reconstruct runs once from the complete relevant history, then apply lane/run visibility separately. Event filters should not discard the evidence used to determine duration. Any controller/substation isolation must preserve that entity's full start/stop history.

### 5. Medium: valid message priority is treated as pressure and crashes the panel

**Locations:** `src/app.js:429`, `src/app.js:283`, `src/app.js:1053`; numeric formatting at `src/app.js:1062`.

The parser correctly decodes `MG,...,PR=HI` as Message Priority. The chart and scrubber later identify telemetry only by the presence of `PR`, treating `HI` as a pressure reading and calling `.toFixed()` on it.

**Reproduction:** load an AC=10 reading at 08:00 and an `MG,ST,SY,PR=HI` event at 08:01, then enable Advanced. A fatal banner appears. `AC=unavailable` also reproduces the crash. Pressure-only logs additionally omit the scrubber's pressure section because `hasHydro` only checks AC/EX.

**Smallest fix:** classify numeric telemetry using its parsed type/unit and category, and reuse that classification in the chart, scrubber, and availability checks. Retain unrecognized values as displayable raw data without graphing them.

### 6. Medium: hydraulic results depend on CSV row order

**Locations:** `src/app.js:283`, `src/app.js:430`, `src/app.js:1059`.

`telemetry` preserves file order, but the scrubber stops at the first sample after the playhead. The chart similarly receives unsorted point arrays with parsing disabled. Program inference and run reconstruction sort their inputs, so the application otherwise accepts out-of-order logs.

**Reproduction:** readings at 08:00 and 14:00 show Actual at the noon playhead when ordered chronologically. Reversing those same rows makes Actual disappear.

**Smallest fix:** build a chronological telemetry view once per relevant data change. Preserve the original `allEvents` order because `_id` is used as an array index.

### 7. Medium: invalid imports leave stale data and silently accept malformed content

**Locations:** `src/app.js:127`, `src/app.js:134`, `src/app.js:186`, `src/parse.js:14`.

Loading a valid file and then a file with no valid events changes the filename and empties `allEvents`, but the early return leaves the old feed, chart, and statistics displayed. Confirmed: filename `invalid.csv`, subtitle “No valid events found,” one old feed row, and total count 1.

The loader also ignores PapaParse's `results.errors`. A row with an unterminated quoted field was displayed as a successfully loaded event. Invalid dates such as February 31 and time `25:99:99` are accepted through JavaScript's date normalization. Invalid rows disappear without an import summary. Concurrent file reads have no generation check, so a slower previous upload can also overwrite newer results.

**Smallest fix:** validate an import before committing its state; either preserve the previous file and clearly report failure or clear all associated state together. Surface parse-error/skipped-row counts, reject normalized invalid dates, and ignore obsolete upload completions.

### 8. Medium: marker navigation targets the wrong row or no row

**Locations:** `src/app.js:825`, `src/app.js:865`, `src/app.js:902`.

Intervention markers store an event ID, but clicking them jumps by timestamp and searches only the current DOM.

**Confirmed:** clicking event ID 1 when IDs 0 and 1 share a timestamp flashes ID 0. Clicking event ID 1500 when only the first 1,500 rows are rendered reveals nothing. Alert ticks use the same timestamp-only path.

**Smallest fix:** carry `_id` through every marker and route clicks through the existing `revealFeedEvent()` mechanism. Explicitly handle an active search that excludes the target, rather than silently failing.

### 9. Medium: resize breaks timeline/chart alignment

**Locations:** `src/app.js:455`, `src/app.js:552`, `src/app.js:1427`.

Chart.js resizes its canvas automatically, but the pixel-positioned bars, event markers, playhead, and minimap density lack corresponding resize synchronization.

**Confirmed:** canvas width changed from 778 to 488 px; the bar stayed at left 284.439 px / width 116.220 px. After an unrelated redraw, it corrected to left 187.773 px / width 67.886 px.

**Smallest fix:** use one chart resize/layout hook, scheduled after the scale is ready, to realign dependent overlays and invalidate minimap sizing. Do not create separate observers for every overlay.

### 10. Medium: visible bars, run counts, and the playhead panel disagree

**Locations:** `src/app.js:593`, `src/app.js:610`, `src/app.js:670`, `src/view.js:82`.

The run counter counts arrays before applying individual lane selections. Separately, expanded program lanes show scheduled zone runs that `selectVisibleRuns()` omits unless the zone is independently selected.

**Confirmed:** selecting one of two program lanes renders one program bar but reports two runs. Expanding a program with an active zone renders that zone's bar while the playhead panel contains zero zone rows.

**Smallest fix:** have the existing selection helper produce the actual visible logical runs, including expanded child lanes, and reuse that result for statistics, scrubber contents, and snapping. Count each logical run once, even if drawn in multiple places or soak segments.

### 11. Medium: search cannot find normal start/done events

**Location:** `src/classify.js:134`.

`selectFeedRows()` removes duration markers before applying search, even though the UI promises search across all events. A WT event containing a unique search term returns zero results unless that event was already revealed through another interaction.

**Smallest fix:** when searching, include duration markers. Keeping them collapsed or omitted in the default feed is a separate presentation choice.

### 12. Medium: raising minimum variance hides the largest deviations

**Locations:** `src/view.js:28`, `src/view.js:41`, `index.html:104`.

The default 0–100 range disables filtering, but any positive minimum activates a hard 100% upper bound. Flow deviation can exceed 100%.

**Confirmed:** AC=30 / EX=10 produces 200% variance. It appears at default settings and disappears when minimum variance becomes 1%, even with the upper slider at its maximum. The maximum's tooltip promises inclusion of the largest deviations.

**Smallest fix:** treat the maximum endpoint as unbounded, or size the slider to observed variance. Make the label agree with that behavior.

### 13. Medium: a missing DONE can merge later sessions into one run

**Locations:** `src/runs.js:69`, `src/runs.js:76`, `src/runs.js:128`.

Missing-DONE inference only runs if the group is still open after its entire event history has been processed. An intervening disappearance from run-list heartbeats is lost if a later session eventually supplies a DONE.

**Reproduction:** zone 1 WT at 08:00, listed at 08:01, absent from the 08:02 run list, WT again at 09:00, DN at 09:05. Output is one ordinary 65-minute run with `inferred: false`, despite the intervening absence.

**Smallest fix:** apply run-list discontinuity evidence while reconstructing history, before merging a subsequent start into the open run. Keep real cycle-and-soak transitions covered. Exact inferred stop times remain estimates and should remain labeled as such.

## Performance and weight

### 14. Medium: natural-language sorting repeatedly constructs locale machinery

**Location:** `src/classify.js:145`.

The comparison loop calls `localeCompare(..., undefined, { numeric: true })` for every comparison.

**Measured:** sorting 20,000 synthetic subject rows took a median **1,815 ms**; the equivalent comparator using one cached `Intl.Collator` took **115 ms**, roughly **16× faster** in this local Node benchmark. Both paths used the same real `feedSortValue()` function, and output equality was asserted. This is a comparator benchmark, not a promised end-to-end UI speedup.

**Smallest fix:** cache `new Intl.Collator(undefined, { numeric: true }).compare`. Also tokenize a search query once per selection instead of once per row in `feedMatches()`.

### 15. Medium: progressive loading repeatedly rebuilds a growing hidden DOM

**Locations:** `src/app.js:1135`, `src/app.js:1146`, `src/app.js:1157`, `src/app.js:1168`.

Every visible feed row eagerly renders its hidden details, raw line, chips, and tooltips. A synthetic 1,500-row feed contained **37,503 descendant elements**, including **1,500 unopened detail panels**. Each Load More sorts/selects again and replaces all previous rows too, losing expanded state. Repeatedly loading all batches therefore repeats increasing amounts of work.

**Smallest fix:** create detail content on first expansion, cache the ordered event list until its inputs change, and append the next batch. Consider virtualization only if measurements still justify it after those changes.

### 16. Low: initial load does avoidable render work

**Locations:** `src/app.js:250`, `src/app.js:1337`, `src/app.js:1616`, `src/app.js:1685`.

`onDataLoaded()` calls `applyFilters()` and then `setScrubber(true)`; both render and can rebuild the chart. The large Reference and How-to-use contents are also constructed eagerly while their modals are hidden.

**Smallest fix:** establish initial drawer state before the first rendering pass. Build each static modal the first time it opens. No new loading framework or dependency is needed.

The file parser also runs without a worker, buffering the complete CSV and parsed events without a size limit. This is a scalability ceiling, not a separately measured exhaustion attack here. Profile representative maximum-size logs after the DOM/sort fixes; if parsing remains a bottleneck, use PapaParse's existing worker/chunk facilities. Verify the legacy `file://` requirement first: the current Vite module build is served over HTTP, while documentation still cites `file://` as the reason workers must be disabled.

## Accessibility and test safeguards

### 17. Medium: keyboard users cannot operate important controls

**Locations:** `index.html:27`, `index.html:298`, `index.html:309`, `src/app.js:531`, `src/app.js:803`, `src/app.js:1127`, `src/feedback.js:51`.

Upload is a clickable `div` surrounding a `display:none` file input; it has no keyboard focus or activation handler. Run bars, expandable lane labels, event markers, feed expansion, and scrubber rows are also predominantly clickable noninteractive elements. The custom modals lack dialog semantics, focus containment, and focus restoration. Several visible form labels are not associated with their inputs.

**Smallest fix:** use native buttons/labels, associate labels with controls, and use native `<dialog>` where appropriate. These platform features also remove custom interaction code. Preserve the zone-blocker buttons, which already have accessible labels.

### 18. Medium: the default drawer makes the mobile dashboard impractical

**Locations:** `src/styles.css:84`, `index.html:289`.

The 300 px drawer is enabled automatically and always reserves 300 px of right padding, including narrow screens.

**Confirmed:** at a 390 px viewport, the main area was only **90 px wide**, with a document width of **624 px**.

**Smallest fix:** use a narrow-screen CSS breakpoint to make the drawer an overlay or a section below the dashboard. Do not permanently reserve its desktop width on phones.

### 19. Medium: deployment can bypass browser checks; some configured checks never run

**Locations:** `.github/workflows/ci.yml:8`, `.github/workflows/deploy.yml:34`, `vitest.config.js:32`, `playwright.config.js:16`, `playwright.config.js:23`, `e2e/smoke.spec.js:10`.

Direct pushes to main run the deploy workflow's unit tests, but CI excludes main pushes and deployment has no browser-test dependency. Repository branch protections were not inspected, so whether PR checks are mandatory is unknown. Neither workflow runs coverage, so the coverage thresholds do not act as CI ratchets. Playwright requests traces on first retry but sets retries to zero: that configuration never captures a retry trace.

The smoke test listens for console and uncaught errors, but `render()` catches errors and writes to the internal error buffer/banner without logging them. It can therefore miss later partial-render failures after its basic elements exist.

**Smallest fix:** gate deployment on the existing small browser suite, make the unit CI command enforce intended coverage thresholds, use failure-retained traces without requiring retries, and assert that no fatal banner appears. Add targeted synthetic cases from this report instead of broad implementation-mirroring tests.

## Smaller hardening and maintenance opportunities

- `src/feedback.js:144`: `setStatus()` uses `innerHTML` although all statuses are plain text, including exception messages. Use `textContent`. No independent exploit through a normal server response was demonstrated; this removes an unnecessary injection sink.
- `src/feedback.js:148`: feedback requests have no abort deadline. A stalled request leaves Send disabled until the request settles. Use an abort signal with a reasonable timeout and keep the download fallback.
- `src/feedback.js:100`, `src/errors.js:51`, `tests/feedback.test.js:69`: the report passes captured error messages/console arguments through, and includes `location.href` and selected filter values. The privacy test deliberately checks event arrays with default filters and a data-free error. It does not prove that arbitrary error text or a selected serial number contains no log content. The UI previews the report, and sending requires user action; automatic transmission was not found. Tighten the privacy wording, omit unneeded URL query/fragment data, and test the intended allowances explicitly.
- `src/parse.js:81`: `rawLine = cols.join(',')` reconstructs a row rather than preserving its exact CSV source. Quoted commas and escaped quotes lose their original representation. Either retain exact source records if necessary or label this as reconstructed CSV.
- `src/app.js:373`: centered presets switch back to calendar-aligned windows when navigating. A centered hour followed by Next can overlap the prior window instead of moving exactly one hour. Make centered and aligned navigation semantics explicit.
- `src/parse.js:20`, `vitest.config.js:8`: timestamps intentionally ignore the supplied offset but are stored as browser-local Dates. DST transitions can therefore make elapsed durations depend on the viewer's timezone. The current UTC test setting does not exercise that case. Decide whether the model represents wall-clock time or elapsed instants and add a cross-timezone transition case before changing it.
- `.gitignore`: real logs are excluded by a few exact filenames/patterns. New customer-log names are not automatically excluded. A dedicated ignored local-log directory or a CSV deny-by-default rule with an explicit synthetic-fixture exception would reduce accidental commits. No history-wide secret/log scan was performed.

## Ponytail audit: what can be deleted or simplified

Ranked by likely reduction; these are recommendations, not applied edits.

- `shrink:` Consolidate repeated project history in `AI_HANDOFF.md`, `NOTES.md`, `REPO_ANALYSIS_PLAN.md`, and `TESTING_AUDIT.md`; keep a short current handoff and link to Git/history for completed work. Several statements already disagree with live code, including Back, feed scope, listener rebinding, and file loading. Preserve current requirements and vendor references.
- `native:` Replace custom modal show/hide/Escape/focus plumbing with `<dialog>` when addressing accessibility. Share only the small behavior actually common to the three dialogs. `src/app.js:1618`, `src/app.js:1687`, `src/feedback.js:51`.
- `delete:` Remove the unused `guard()` API and its success-only test. Application entry points already use their own catches; no production caller exists. `src/errors.js:103`, `tests/errors.test.js:48`.
- `delete:` Remove unreachable zoom-history scaffolding and the Back control/help, or implement history only if Back is still required. `zoomStack` is cleared/read/popped but never populated. `src/app.js:52`, `src/app.js:367`, `index.html:206`.
- `delete:` Remove unused `.detail-row`, `.sortable`, `.data-row`, `.zoom-anim.playing`, `zoomIn`, `tr.raw-hit`, and `.tl-ongoing` styles. Keep `rawFlash`, which is still used by `.feed-flash`. `src/styles.css:18`.
- `delete:` Remove unused `EVENT_TYPE_MAP`, `EVENT_TRIGGER_MAP_SPEC`, and `EVENT_DAY_TYPE_MAP` exports, plus unused `RUN_STOP`/`makeRun` imports in app.js. Their definitions have no application callers; vendor reference documentation remains available. `src/constants.js:127`, `src/app.js:26`.
- `shrink:` Remove redundant rounded-corner utilities and inline border-radius declarations where the global `border-radius:0 !important` rule always overrides them. This is cosmetic cleanup; it should follow the security/correctness fixes. `src/styles.css:12`, `index.html`, `src/app.js`, `src/feedback.js`.

net: approximately -50 lines from the concrete dead-code cuts alone, -0 dependencies recommended. Documentation/modal cleanup could remove more, but was not implemented or counted.

## What to keep

The two runtime dependencies have clear jobs: PapaParse handles real CSV quoting and jagged records, and Chart.js supplies the hydraulic chart and shared axis. Chart.js imports are already selective. The app already uses native printing, delegated event listeners, cached date formatters, and several useful render caches. Preserve those choices and the pure parsing/run/view modules. Splitting files simply to reduce app.js's line count will not correct the state and selection inconsistencies.

Recommended order: fix timestamp XSS; update vulnerable tooling and harden import dictionaries; correct run-history and telemetry handling; repair import/navigation/resize behavior; apply the measured sorting and lazy-detail improvements; then address accessibility, CI safeguards, and dead code.

## Implementation results

Implemented without adding runtime dependencies or replacing the direct-DOM architecture. Ponytail guided the use of native dialogs/controls, cached native sorting, lazy details, and deletion of dead code instead of new frameworks or widget libraries.

| Finding | Resolution and verification |
| --- | --- |
| 1. Timestamp XSS | Escape timestamp output; strictly validate the entire timestamp/calendar; production CSP blocks inline scripts. Malicious import and CSP browser regressions pass. |
| 2. Inherited keys | Null-prototype imported-key dictionaries and own-property lookups across parsing, inference, run grouping and color caches; hostile-key unit regressions pass. |
| 3. Dependencies | Upgraded Vite/Tailwind and matched Vitest/coverage tooling; retained Chart.js/PapaParse. Full `npm audit` now reports 0 vulnerabilities. Requires a supported Node version per `package.json`. |
| 4. Filtered history | Reconstruct/cache from all events with a full-data ending. Event filters no longer alter runs or hydraulic evidence; filter-invariant duration browser check passes. |
| 5. Numeric telemetry | Shared finite, unit-checked `telemetryValue`; MG priority is never pressure. Invalid values remain inspectable; pressure-only logs work. |
| 6. Row ordering | Chronologically sort typed telemetry; carry forward latest known readings across zoom boundaries. Reverse-order/invalid/priority/pressure and zoom browser checks pass. |
| 7. Imports | Reject parser errors/empty-invalid logs, validate calendar dates, report skipped rows, retain previous successful data/filename, reset input, ignore obsolete reads, and enforce a 20 MB limit. Browser checks cover malformed/injected/oversized and out-of-order read completions. |
| 8. Exact navigation | Resolve markers by stable event ID; reveal beyond pagination and outside event filters; clear search and its pending debounce. Coincident markers can be selected precisely by keyboard. |
| 9. Resize | Re-layout overlays/minimap after Chart.js resize using a coalesced animation frame. Desktop width changes and print restoration are checked in Chromium. |
| 10. Run visibility | One logical-run selection backs count, panel and snapping; includes expanded program zones with strict window overlap and deduplicates child/manual lanes. Unit and browser checks pass. |
| 11. Search | Active queries include ordinary start/done markers; terms are tokenized once per selection. Default feed remains uncluttered. |
| 12. Variance | Maximum slider endpoint is unbounded and labeled Any; nonfinite variance is excluded. 200% deviation regression passes. |
| 13. Missing DONE | Split sessions when intervening heartbeat evidence proves disappearance before another start; preserve explicit soak. Supply fallback requires shared explicit identity; unknown topology stays ongoing. Synthetic regressions and local fixture comparison validate five newly separated boundaries. |
| 14. Sorting | Reuse one `Intl.Collator`; keep precomputed sort keys and search cache. Natural ordering/search regressions pass. |
| 15. Feed DOM | Cache ordered selection, append batches, build detail contents only on first expansion, preserve expanded rows on Load More. Browser checks cover append/search/sort/reveal. |
| 16. Startup | Set drawer state before first render, build guide/reference on first open, and bound in-memory imports. Representative large-log profiling supports retaining the simple parser path for now. |
| 17. Accessibility | Native upload label/input, lane/marker/detail buttons, keyboard run/playhead/minimap controls, dropdown expanded state/Escape, native dialogs/focus restoration, accessible input names, and reduced-motion styling. |
| 18. Mobile | Drawer moves below the dashboard; header/timeline controls wrap. Chromium regression confirms the main area stays usable at 390 px without document overflow. |
| 19. Safeguards | Reusable CI runs coverage, builds, and tests Chromium; Pages consumes that exact tested artifact. Failure traces are retained without retries, and browser tests assert absence of fatal banners. Remote Actions execution was not invoked here. |

Smaller recommendations also handled: feedback status is text-only; requests abort after 15 seconds; query/fragment are omitted from the report URL; previewed diagnostics/errors remain the ones sent; privacy wording acknowledges filenames, filter values and error text. Reconstructed rows are labeled as such. Centered navigation preserves width. Controller wall-clock parsing, formatting and date inputs use UTC components, with cross-timezone DST tests. Customer CSVs are ignored by default (case-insensitive extension), with only the committed synthetic fixture exempted.

Removed the dead Back/zoom-history path, unused guard and test, unused enum exports/imports, dead CSS and redundant rounded styling. Tailwind scans application sources only. Consolidated the handoff/developer/testing/history docs and updated both user guides; vendor documentation and local customer/vendor files were preserved.

### Verified results and measurements

- `npm run test:coverage`: **219 tests passed** across 9 files; all six configured per-file coverage thresholds pass. Those six pure modules have 100% statement coverage. The Node report still shows 0% for the DOM app; browser tests cover selected integration paths, not every interaction.
- `npx playwright test --reporter=list`: **12 Chromium tests passed**, including original smoke paths and new security/import/data/navigation/accessibility/print regressions.
- `npm run build`: passed. JS approximately **257.67 kB / 89.92 kB gzip**, CSS **26.88 kB / 6.65 kB gzip**, HTML **33.24 kB / 8.50 kB gzip**. JS grows slightly for validation/accessibility while HTML/CSS shrink; the main measured saving is DOM/interaction work, not a dramatic bundle reduction.
- `npm audit --json`: **0 known vulnerabilities**, including development dependencies.
- Initial synthetic 1,500-row feed: **13,502 descendants**, versus **37,503** before, approximately **64% fewer**. Opened detail content is intentionally additional.
- Local 73,346-event, 2.93 MiB monthly log: approximately **967 ms** to import/render and **315 ms** for first subject-sort interaction; **12,201 initial feed descendants**, no fatal banner. Single local headless-Chromium measurements, not performance guarantees; log contents were not emitted or transmitted to an external service.
- Default CSV privacy rules verified against new lowercase/uppercase customer filenames; the synthetic fixture remains the only tracked CSV.

### Deliberate limits

Imports still parse in memory/on the main thread, bounded at 20 MB. Add chunked/worker ingestion when larger archives or measured supported-device stalls require it. Appending every batch still grows DOM; introduce virtualization only if real usage warrants that complexity. This change does not promise 20 MB is responsive on every device.

The app displays controller wall-clock time, not timezone-adjusted elapsed instants. Run-list endings remain estimates. Substation filtering selects SN/SB-bearing event rows only; it does not infer controller topology or isolate historical/hydraulic streams. Print is a current-view snapshot; automation checks sizing/cleanup, not a physical printer or saved-PDF visual fidelity. Chromium is the automated browser target; broader browser/assistive-technology validation remains outside this local run.

No external feedback was submitted, no deployment occurred, no customer/vendor files were deleted, and no Git history or remote repository protections were audited. Zero npm findings and passing checks do not guarantee absence of undiscovered vulnerabilities.
