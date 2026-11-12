# Codebase audit — 2026-11-12

This is the current audit record. The September 2026 audit, its remediation (commit `ff87d85`, on `origin/main`) and its line references to pre-fix code are in Git history: `git log -p -- CODEBASE_AUDIT.md`.

## Scope

- All `src/` modules, `index.html` and `src/styles.css`, build/test/CI configuration, and the repository docs.
- Run reconstruction was checked against local-only customer logs. Only aggregate counts are recorded here; no log content is committed.
- Before fixes: 219 unit tests passed. Playwright was not run during the audit.

## Findings

Status for every row: **fixed in working tree 2026-11-12, not yet committed.** Nothing here is deployed.

| Finding | Change |
| --- | --- |
| A paused program drew a 0-second bar and lost its real run. | `PG,WT` now starts or resumes a program run. Zero-length runs are dropped. |
| A late logged stop overstated a zone run (3 of 377 closed runs in one local log, 19–39 hours too long). | A stop that arrives after the zone left the run-list heartbeats now closes the run at the last listing, labelled inferred. |
| A disabled zone stayed running (121.6 h in one local log). | `ZN,DS` now terminates an open zone run. Mainline `DS` is still ignored. |
| The chart tooltip used Chart.js `index` mode across datasets of different length. | Tooltip now uses nearest-on-x. |
| Minimap keyboard pan and track click narrowed the window at data edges. | Window width is preserved. |
| Smaller issues. | Carried-forward flow "as of" label shows the date; the import failure message no longer claims the previous log is retained after state was replaced; lane dropdown `aria-expanded` resets on outside click; empty `PG=`/`ML=` values are treated as absent; sub-minute durations show in seconds; the print stamp is idempotent; timeline uses `touch-action: pan-y`; dead `#bucketLabel` and unused `snapWindow` branches removed; `data-html2canvas-ignore` renamed `data-print-hide`. |

## Checked, not changed

- Supply-shutdown fallback (`sharesSupply`) needs `ML`/`CP`/`WS`/`MV`/`PM` on the zone start row. The local logs never carry these, so the fallback is inert for them.
- `ZN,ER` does not end a run: run-list evidence shows zones continue after errors.
- The local, untracked vendor spec 19.8.6 differs from the checked-in 19.8.2 only in the version line and numeric addresses, so the enumerations are current.
- No HTML injection path was found.
- Dev-tool advisories (vite, vitest, source-map-js) are fixed: vite 8.3.8 and vitest/coverage 5.1.0. `npm audit` reports 0, with and without dev dependencies.
