# Developer handoff

Baseline Event-Log Visualizer is a browser-only dashboard for Baseline irrigation controller CSV logs. It shows scheduled/manual runs, cycle-and-soak segments, hydraulic readings, interventions, and searchable evidence. Vite builds vanilla JavaScript modules into a static site; no backend or framework is required.

Start with [NOTES.md](NOTES.md) for architecture and vendor rules, [TESTING_AUDIT.md](TESTING_AUDIT.md) for verification, and [the user guide](docs/HOW_TO_USE.md) for current behavior. The September audit and remediation record are in [CODEBASE_AUDIT.md](CODEBASE_AUDIT.md) and [the implementation plan](docs/superpowers/plans/2026-09-08-audit-remediation.md).

## Run locally

Use a Node version supported by `package.json`; CI uses Node 22. On Windows, use `npm.cmd`/`npx.cmd` if PowerShell blocks the corresponding scripts.

```sh
npm ci
npm run dev
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
```

Development serves `http://localhost:5173/visualizer/`; `npm run preview` serves the build at `http://localhost:4173/visualizer/`. Stop a manual preview before Playwright, which starts a fresh server. Serve over HTTP; opening the built HTML through `file://` is unsupported.

## Requirements to preserve

- CSV processing stays local. Feedback sends only after a user action; filenames, selected filter values, and captured errors can contain log values, so preserve the preview and its accurate privacy wording. Never submit real feedback during tests.
- Keep customer CSVs, local vendor material, and `.env` out of commits and `public/`. `Evnt_flow_test.csv` is the committed synthetic fixture. Missing optional local logs are a valid test skip.
- Chart.js owns the shared time axis, including when Flow is off. Keep PapaParse for jagged/quoted CSV and native browser printing for PDF output.
- Reconstruct runs and sorted numeric telemetry from complete history. Event filters, including SubStation, must not shorten runs or alter hydraulic history. Timeline lane/run-type selections control visible logical runs.
- Controller times use UTC components as a timezone-neutral wall clock. Supplied offsets do not shift displayed times. Keep `_id` stable and never reorder `allEvents` in place.
- Imports are limited to 20 MB; rejected imports preserve the prior dataset. Marker navigation reveals exact IDs beyond pagination, clearing the search when needed.
- Feed details and guide/reference content are lazy; Load More appends rows. Use native dialogs and preserve keyboard operation, focus restoration, mobile layout, and print cleanup.

CI and Pages deployment share the coverage/build/browser workflow. Deployment uses the exact build tested by Playwright. Check actual workflow results before claiming anything is deployed or passing.

Completed session narratives live in Git history, not an accumulating checklist here:

```sh
git log --oneline
git log -p -- AI_HANDOFF.md NOTES.md TESTING_AUDIT.md REPO_ANALYSIS_PLAN.md
```
