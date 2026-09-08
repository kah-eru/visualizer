# Audit Remediation Implementation Plan

**Goal:** Resolve all actionable findings in `CODEBASE_AUDIT.md`, preserving the browser-only dashboard and its vendor-specific behavior.

**Architecture:** Keep the existing pure data modules and direct DOM app. Reconstruct complete histories independently of feed filters; use one numeric telemetry definition and one visible-run selection. Prefer native browser controls and existing dependencies.

**Tech stack:** JavaScript modules, Vite, Chart.js, PapaParse, Tailwind, Vitest, Playwright.

**Spec:** `CODEBASE_AUDIT.md` (findings 1–19 and smaller hardening/cleanup recommendations).

## Constraints and choices

- Preserve customer logs, the untracked vendor reference, manual runs, cycle-and-soak behavior, and native printing.
- No framework, new runtime dependencies, uploads, deployment, or history rewriting.
- Feed filters select events; they do not reconstruct or truncate historical runs. Substation filters affect the feed only until complete device topology is available, and UI copy must say so.
- Controller wall-clock fields remain the display model. Represent them consistently as UTC components (a timezone-neutral wall clock), using UTC formatting/input/window math, so browser DST does not alter intervals. Do not silently reinterpret supplied controller offsets as local viewer time.
- Invalid/rejected uploads retain the previous successful dataset and its filename. Report skipped rows and parser errors; ignore obsolete read completions.
- Remove the nonfunctional Back feature and obsolete code; preserve current requirements in concise docs.

## Tasks

- [x] **1. Secure parsing and correct pure data logic** — `src/parse.js`, `runs.js`, `format.js`, `classify.js`, `view.js`, `constants.js`; corresponding unit tests. Add failing cases for timestamp suffix injection/invalid dates, inherited dictionary keys, numeric telemetry and MG priority, missing-DONE separate sessions, search duration rows, variance >100%, and expanded child-run selection. Implement null-prototype dictionaries, strict wall-clock parsing, `telemetryValue(event,key)`, chronological telemetry consumers, cached `Intl.Collator`, query tokenization once, and finite variance checks. Keep `_id` stable. Verify targeted tests, including UTC/Denver DST agreement.
- [x] **2. Upgrade tooling and harden feedback** — `package*.json`, Vite/Vitest/Playwright configs, `.github/workflows`, `src/feedback.js`, `errors.js`, `diagnostics.js`, matching tests. Verify supported patched version compatibility before installation; retain runtime dependencies. Use plain-text status, timeout, sanitized report URL, explicit privacy wording, and native feedback dialog. Remove unused guard. Enforce coverage/browser deployment gates, failure traces, least required CI permissions, and zero npm audit findings where available.
- [x] **3. Repair app history and ingestion** — `src/app.js`, `index.html`. Add complete-history run caches, unit-checked typed/sorted telemetry, atomic guarded imports, input reset and row warning. Escape timestamp HTML; preserve parsed raw values for detail display and label reconstructed CSV. Set initial drawer state before first render. Add a restrictive production CSP compatible with native printing and the configured feedback endpoint.
- [x] **4. Unify visibility, navigation, and rendering** — `src/app.js`, `src/view.js`, `index.html`, browser tests. Reuse visible logical runs for count/scrubber/snap; include expanded program children once. Use event IDs and existing reveal logic for marker clicks, even beyond pagination or excluded by search. Preserve centered window widths during navigation; remove dead zoom history. Synchronize chart overlays/minimap after resize.
- [x] **5. Reduce feed and startup work** — `src/app.js`, browser tests. Cache ordered selection until actual inputs change, append batches without replacing prior DOM, lazily fill detail panels on expansion, and lazily build guide/reference content. Verify retained expanded rows, pagination/search sorting, marker reveal, and bounded initial DOM. Profile a representative large synthetic input before choosing parser worker/size behavior.
- [x] **6. Accessibility and responsive layout** — `index.html`, `src/app.js`, `src/styles.css`, browser tests. Native file input/label, real buttons for single actions, keyboard activation for compound run/feed controls, associated labels, native guide/reference dialogs, focus restoration and accessible names. Provide keyboard scrubber/minimap controls and cancel handling. Move drawer into document flow on narrow screens. Remove unused CSS and overridden corner styling.
- [x] **7. Documentation, privacy hygiene, final review** — `.gitignore`, `AI_HANDOFF.md`, `NOTES.md`, prior planning/testing docs, user guide. Ignore customer CSVs by default with the synthetic fixture exception; preserve local vendor material. Consolidate duplicated history into concise current instructions and Git references. Update guide promises to tested behavior. Record resolution for every audit finding, including deliberately retained constraints.

## Verification and completion

For each task, run the relevant regression checks and inspect the changed call sites before integration. Final commands:

```powershell
npm.cmd run test:coverage
npm.cmd run build
npx.cmd playwright test --reporter=list
npm.cmd audit --json
git diff --check
```

Browser checks cover malicious and malformed imports, same-timestamp and off-page markers, filtered run invariance, message priority/pressure, sorting and progressive append, resizing, keyboard/dialog operation, mobile layout, and print cleanup. Use synthetic payloads and intercept external feedback requests. Finish with the plan checked against every audit finding and a concise summary of changes, measurements, and remaining limits.

## Completion record — 2026-09-08

All seven tasks implemented locally. See [CODEBASE_AUDIT.md](../../../CODEBASE_AUDIT.md#implementation-results) for finding-by-finding results, measurements and retained limits.

- Coverage: 219 tests pass; existing per-file thresholds remain enforced.
- Production build and 12 Chromium browser checks pass; tests cover print sizing/cleanup, not printer/PDF visual fidelity.
- Full dependency audit: zero known vulnerabilities.
- Initial synthetic feed DOM reduced from 37,503 to 13,502 descendants (about 64%).
- Representative local monthly log (73,346 events): about 967 ms import/render, 315 ms first subject-sort interaction; no external requests or raw content output. Retained the bounded in-memory parser rather than adding worker/chunk complexity without a demonstrated need for this workload.
- Independent integration reviews found and resolved a boundary-overlap mismatch and pre-window telemetry carry-forward loss; final focused ingestion/feed review found no additional must-fix issues.
- Native controls/dialogs, lazy content, removed dead code, and consolidated docs follow Ponytail's minimum-sufficient implementation guidance. No runtime dependency was added.
- No commits, push, deployment, real feedback submission, or customer/vendor-file deletion performed. Original local material remains intact.
