# Testing and verification

This is current guidance. The July testing audit and its completed remediation history are preserved by `git log -p -- TESTING_AUDIT.md`. Current findings and disposition belong in [CODEBASE_AUDIT.md](CODEBASE_AUDIT.md).

## Run the checks

```sh
npm ci
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --json
git diff --check
```

Use `npm.cmd`/`npx.cmd` on Windows if needed. The browser suite exercises the production bundle and starts a fresh localhost preview server; stop any manually running preview first. CI installs Chromium's OS dependencies with `--with-deps`.

## What is covered

| Layer | Checks |
| --- | --- |
| Parsing/formatting | Strict date validation, wall-clock timezone behavior, unsafe dictionary keys, context-sensitive enums, unit conversion, program inference |
| Runs/view | Zone boundary semantics, manual and stop-only cases, separate missing-DONE sessions, supply identity, soak continuity, filters, visible-run deduplication, window and snapping math |
| Feed selection | Search including duration markers, column sorting, noise-alert ordering, whole-file scope |
| Diagnostics/errors/feedback | Real shaping function and key whitelist, event-array exclusion and explicit privacy allowances, bounded buffer, URL sanitization, preview snapshots, text-only failures, request timeout using mocked fetch |
| Pipeline | Committed synthetic CSV through the actual parse/inference/run chain, plus optional local-only fixtures |
| Browser | Production load/render and targeted import, telemetry, filter/run, stable-marker navigation, progressive feed, layout, keyboard, and dialog regressions in `e2e/` |

Treat test names/source as the precise scope. Use fresh command output for counts and pass/fail claims; this document does not freeze a test count or assert a deployed version.

## Coverage means two different things

Vitest measures the Node-executed modules, not Playwright's browser execution. `app.js` can therefore show zero in this report while browser scenarios exercise it. Do not describe that percentage as total application behavior coverage, or extract HTML assembly solely to increase it.

`vitest.config.js` enforces existing per-file thresholds on `parse`, `runs`, `classify`, `format`, `view`, and `diagnostics`. Do not lower them to accommodate a change. Read both missing branches and behavioral relevance before adding tests.

Reports are `coverage/index.html` and `coverage/coverage-summary.json`. Vitest 5 normally suppresses fully covered files in agent terminal output; the text reporter explicitly sets `skipFull: false` so all measured files stay visible. Threshold enforcement was checked by running only `tests/errors.test.js` with coverage: all six unexercised threshold files failed as expected. A complete suite is required for a passing coverage run.

## Fixtures and privacy

`Evnt_flow_test.csv` is synthetic and committed. Customer logs are local-only; CI must pass without them. Optional pipeline fixtures use `describe.skipIf(!existsSync(...))` and load inside test cases, since skipped describe callbacks still run during collection. Never fix a skip by committing customer data.

Privacy tests use the actual `buildDiagnostics` and `assembleReport` functions. They prove event arrays do not add rows/pairs/extras to diagnostics, and deliberately allow selected identifiers and captured error text. They do not prove arbitrary errors contain no log values. Keep the preview and explicit send action. Browser tests should intercept external requests; unit feedback tests mock fetch. Never send a real report to test delivery.

## Remaining verification limits

Chromium is the configured browser project. Coverage thresholds are regression safeguards, not proof of completeness. Browser scenarios cannot establish every vendor sequence, assistive-technology experience, or printer result. Extend focused regression checks for a reproduced bug; inspect native print preview and cleanup when print/layout changes. Profile representative synthetic input before extending the 20 MB cap or adding parser workers/virtualization.

Both CI and Pages deployment run coverage and browser checks through the reusable workflow. Pages uploads the same `dist/` that those browser tests exercised. Traces are retained on failure with zero retries; failure artifacts include the HTML report and trace files.
