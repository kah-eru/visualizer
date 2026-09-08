# Developer reference

This file records current architecture and behavior. Historical investigations and completed changes are available through `git log -p -- NOTES.md`; the current audit is [CODEBASE_AUDIT.md](CODEBASE_AUDIT.md).

## Architecture and runtime

The app is a static Vite build of vanilla ES modules. All CSV parsing and rendering happen in the browser. Serve it over HTTP, with `/visualizer/` as the configured base path. There is no backend, login, CDN dependency, service worker, or supported `file://` launch path. Once the page's assets have loaded, log analysis needs no network; an offline reload is not guaranteed.

| Location | Responsibility |
| --- | --- |
| `index.html`, `src/styles.css` | Markup, native controls/dialogs, responsive layout, print styling |
| `src/main.js` | Import styles/error capture/app, then initialize feedback |
| `src/app.js` | Import lifecycle, state/cache ownership, chart and DOM rendering, navigation and event delegation |
| `src/parse.js` | Strict timestamps, row decoding, numeric telemetry, effective program inference, stable event IDs |
| `src/runs.js` | Run pairing, missing-DONE inference, soak segments, program attribution, manual envelopes |
| `src/format.js`, `src/classify.js`, `src/view.js` | Formatting, feed selection/sorting, filters, window math, visible logical runs and snapping |
| `src/constants.js` | Event labels, context-sensitive enumerations, units, actor definitions, batch size |
| `src/diagnostics.js`, `src/errors.js`, `src/feedback.js` | Whitelisted state summary, bounded error capture, user-reviewed feedback |

Keep Chart.js 4.4.1 and PapaParse 5.4.1 unless a concrete compatibility/security need warrants changing them. Chart.js registers only used components. Tailwind v4 is compiled by Vite. Printing uses `window.print()` and CSS, with no PDF or canvas-capture dependency. `package.json` and its lockfile define supported tooling; Node 22 is used in CI.

## Vendor rules

The checked-in vendor reference is [object definitions 19.8.2](docs/object-definitions-19.8.2.html), summarized in [OBJECT_DEFINITIONS.md](docs/OBJECT_DEFINITIONS.md). Preserve other locally supplied vendor files without committing them unless authorized. The internal `Baseline Protocol Specification - BaseManager Opcodes.md` is local-only.

Object keys, protocol parameters, and event-log columns are different namespaces. Do not bulk-copy one map into another: protocol `AC` can mean ASCII file type while event-log `AC` means actual flow. `VALUE_ENUMS` scopes ambiguous values; `MG` category `PR` is Message Priority, even when its value looks numeric.

`HUMAN_TRIGGERS` is shared by manual classification and Human audit: User/Operator/Programmer/Administrator (`US`, `OP`, `PR`, `AD`). A zone's literal `PG=MR` is a manual tag, not a scheduled program. Exclude it from the Programs picker and from orphan attribution to an overlapping scheduled program.

## Import and time model

CSV records are headerless and jagged. PapaParse handles CSV quoting; `parseRow` decodes category/action/trigger columns plus key/value pairs and positional extras. Unknown values remain displayable. Imported dictionaries use null prototypes and static lookups require own properties.

The loader rejects files above 20 MB, parse errors, and files with no valid events. It validates before replacing app state, reports skipped invalid/header rows, resets the file input for a retry, and ignores obsolete asynchronous completions. A rejected file preserves the previous dataset and filename. Parsing currently buffers the file on the main thread; the size cap bounds input but does not guarantee responsiveness at that limit. Consider PapaParse worker/chunk parsing only after profiling representative files.

Timestamps accept validated controller date/time fields and supported ISO forms. UTC components encode the controller's wall clock; UTC formatting, input, and window arithmetic keep viewer timezone/DST out of the result. Supplied offsets are validated but intentionally ignored. This is a wall-clock visualization, not a reconstruction of physical elapsed instants across controller clock changes or repeated DST hours.

`allEvents` retains input order because `_id` indexes it. Sort copies or derived views. `rawLine` is reconstructed CSV from parsed cells, not byte-for-byte original CSV; label it accordingly and escape imported strings before HTML interpolation.

Numeric `AC`/`EX` convert GPM to L/min and pressure converts PSI to kPa at parse time. Reuse `telemetryValue` for availability checks, plotting, and scrubber carry-forward: it requires the expected parsed unit and a finite value. Build the chronological telemetry view once from complete history. Pressure-only logs work; message priority and malformed numeric values are not hydraulic samples.

## Run reconstruction and visibility

Run intervals come from complete history with the full dataset ending as the fallback. Category/action/actor, alerts, variance, Advanced, and SubStation filters select events; they cannot remove evidence used to reconstruct a run or select the latest hydraulic sample. SubStation is explicitly event-only because full topology is unavailable.

| Group | Opens | Closes normally |
| --- | --- | --- |
| Program | `PG` `SR`, `RN`, `MR` | `SP`, `DN`, `OF` |
| Zone | `ZN` `WT`, `MR` | `DN` |
| Mainline | `ML` `RN` | `OF` |

`PA`/`DR` terminate an open run. A stop without a start creates no run. Zone `SR` is queue/schedule evidence, not watering; zone `SP` is a cascade stop echo and is deliberately not a zone boundary.

Effective program inference remembers the last program associated with each zone in chronological order so untagged zone stop/soak rows remain attributable. Expanded programs use explicit `PG`/`ZN` links for no-runtime zone rows. Runtime attribution honors real program tags; an orphan tag may fall back to overlapping program intervals. Overlap is an inference, not established controller topology.

Missing-DONE zone runs may end at the last run-list heartbeat before disappearance. Disappearance followed by a later start separates sessions instead of merging them. Explicit soak periods preserve cycle continuity. Supply shutdown fallback requires matching explicit supply identity; an unrelated mainline/pump shutdown cannot establish a zone's stop. Insufficient evidence leaves a run ongoing. Inferred ends remain labeled estimates.

Cycle-and-soak produces one logical zone run with watering/soak segments. The Manual Runs parent is a merged visual envelope of manual zone runs, not an extra logical run. Manual zones remain available without selecting them individually. Selected zones retain rows even when no runtime exists in the window.

`selectVisibleRuns` is shared by counts, the At Playhead panel, and snapping. It includes expanded program children and deduplicates logical runs rendered in multiple locations. An ended run remains listed at its exact end with an "over" tag but does not inflate Running now; an ongoing fallback end is not treated as a logged end.

## Rendering and navigation

Chart.js owns the X axis. Render its scale before positioning bars, intervention markers, alert ticks, and playhead. Keep the chart alive as a collapsed ruler when Flow is off. Chart resize synchronization realigns dependent overlays and invalidates minimap sizing.

The date range is a view window. The feed searches/browses filtered events across the entire file. Presets center on the playhead (or view center); Previous/Next preserve a centered window's width. The default window is the day containing the last event. There is no zoom-history Back control.

Feed ordering uses cached search text, query tokens computed once per selection, and a cached numeric `Intl.Collator`. Ordinary duration markers are hidden by default; search includes them. Non-noise alarms are pinned in default ordering. Column sorting cycles ascending, descending, then default.

`FEED_CAP` is a 1,500-row batch size, not a permanent limit. Cache ordered selections until file/filter/search/sort/reveal inputs change. Load More appends rows, retaining existing expansion and scroll state. Populate a row's detail only when expanded. Pan/zoom and scrubber moves should not reconstruct the feed.

Route marker jumps through stable event IDs and the shared reveal path. Reveal can extend pagination, include the requested event outside current filters, and clear an excluding search. Multiple events at one timestamp must remain distinguishable. Run-start lookup uses full history. Feed-to-timeline buttons appear only where a timeline can point to the event, enable the required lane/marker, and leave a persistent location highlight. Scroll the page and the inner feed deliberately so they do not fight each other.

Use delegated container listeners for generated rows. Guide/reference content is built on first open. Native dialogs provide focus containment; closing or Escape restores opener focus. Upload, lane labels, run bars, markers, and row expansion support keyboard operation. Focused playhead arrows/Page Up/Page Down/Home/End adjust time; minimap arrows pan and +/- zoom. Keep chart/main content shrinkable, and put the scrubber drawer into normal flow on narrow screens.

## Privacy, feedback, and print

No automatic upload of CSVs or diagnostics. `buildDiagnostics` reduces event arrays to counts and explicitly picks filter keys; never spread arbitrary app state into reports. Filenames, selected filter values, user-entered text, and captured errors can contain log values. The preview states these allowances. Error/state snapshots shown in the dialog remain the ones sent, and the report URL excludes query/fragment data.

`VITE_WEB3FORMS_KEY` is a public submission token embedded in the bundle, not a secret capable of protecting a client operation. Without it, `VITE_FEEDBACK_ENDPOINT` can select a generic endpoint; builds require HTTPS for this endpoint. No configured endpoint or a failed/timed-out request leaves the download option available. Requests abort after 15 seconds; status uses plain text. Error capture is bounded to 50 entries, with message/stack truncation. The unused `guard` API was removed.

Production Vite output adds a CSP allowing local scripts/assets, required inline styles, and only the configured feedback origins for connections. Development omits it for HMR. CSP supplements escaping and validation.

Print uses the browser dialog, a controller/time-range stamp, and a temporary dashboard width; cleanup restores the screen. Sidebar, controls, minimap, drawer, and dialogs are omitted. The feed retains a clipped viewport, so PDF is a view report, not a complete CSV export. Browser pagination, selected print settings, and device performance still matter.

Keep real logs and local vendor documents out of Git, `public/`, build artifacts, and feedback tests. Use the synthetic `Evnt_flow_test.csv`; local-only pipeline fixtures must load lazily inside tests because `describe.skipIf` still executes its collection callback.

## Verification and remaining limits

See [TESTING_AUDIT.md](TESTING_AUDIT.md) for commands and coverage interpretation. Pages deployment calls the same coverage/build/browser workflow as CI and publishes the tested artifact. This describes configuration, not a claim about a current deployment.

The feed is progressively loaded, not virtualized; loading every batch grows DOM memory. Parsing remains synchronous within the size cap. Missing topology, missing events, controller clock changes, and overlapping orphan attribution limit inference. The automated browser project is Chromium; other browsers, assistive technology, and final printed output need targeted verification when relevant. Avoid adding frameworks, caches, virtualization, or persistent settings solely for speculative future use.
