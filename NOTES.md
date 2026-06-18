# Baseline Irrigation Event Log Dashboard — Developer Hand-off

> Context for the next person/AI picking this up. Read this top-to-bottom before editing.
> Everything lives in one file: **`index.html`** (≈1827 lines as of this writing). There is no
> build step, no server, no tests. Open the file in a browser (`file://` is fine) and drop a CSV.

---

## 1. What this is

A self-contained, offline dashboard for visualizing **Baseline irrigation controller event logs**
(`Evnt_yyyyMM.csv`, sometimes `Events.csv`). An irrigation controller writes one CSV row per
"event" — a zone starting, a program finishing, an alarm firing, a config change, flow/pressure
readings, network chatter, etc. This tool parses that log and turns it into:

- a **swimlane timeline** of program/zone/mainline runs (durations as bars),
- an optional **hydraulic chart** (actual vs expected flow, pressure),
- an optional **interventions & alerts timeline** (pauses, disables, alarms, with the "why"),
- a **scrubber** with a live "what's running right now" side panel,
- a searchable/filterable **audit feed**, and
- a **PDF export** of the whole dashboard.

The target user is someone auditing irrigation behavior: "what ran, when, for how long, was it
scheduled or manual, did anything get stopped early, and why." (See the memory files referenced
below for the user's stated priorities.)

### Tech stack (all CDN, no bundler)
- **Chart.js 4.4.1** — the hydraulic line chart. Critically, it also **owns the shared X (time) scale**
  that the swimlane bars, event markers, gridlines, scrubber, and pins all align to via
  `hydroChart.scales.x.getPixelForValue(ms)` / `getValueForPixel(px)`.
- **PapaParse 5.4.1** — CSV parsing (`worker:false` because workers are blocked under `file://`).
- **TailwindCSS (CDN)** — styling, utility classes inline in the markup.
- **html2pdf.js 0.10.1** — PDF export.

### Related context files (read these too)
- `C:\Users\bmauricio\.claude\projects\C--Users-bmauricio-visualizer\memory\` — auto-memory:
  - `baseline-event-file-format.md` — CSV column + key=value field meanings.
  - `visualizer-program-inference.md` — why zone stop/done events get an inferred program.
  - `visualizer-relevant-events.md` — user wants program/zone/runtime/flow; substation & network
    categories are noise, hidden by default.
- Sample data: `Evnt_202605.csv` (note: this file has **zero AC/EX/PR flow telemetry**, so the Flow
  chart shows empty — that drove the "Flow off by default" design).

---

## 2. The data model (how a CSV row becomes an event object)

Rows are headerless and jagged. `parseRow(cols)` (≈L498) produces one event object:

| field | meaning |
|---|---|
| `ts`, `tsRaw` | `Date` + original string. Format `MM/dd/yy HH:mm:ss -0600`; parsed as **wall-clock local** (tz offset ignored on purpose). |
| `catCode`/`actCode`/`trgCode` | raw 2-letter codes from columns B/C/D. |
| `category`/`action`/`trigger` | human labels via `CATEGORY_MAP`/`ACTION_MAP`/`TRIGGER_MAP` (≈L376). |
| `pairs` | object of `key → {value, display, unit, raw}` from `key=value` tokens in column E+. Flow keys `AC`/`EX` are converted GPM→L/min, `PR` PSI→kPa **at parse time**. |
| `extras` | column E+ tokens that had **no** `=` (positional values, e.g. `"Valve Failure:Open Circuit Solenoid."`). |
| `zones` | `pairs.ZN` split on `;` (a row can name multiple zones). |
| `program` | `pairs.PG` (raw). |
| `progEff` | **inferred** program — see below. |
| `mainline` | `pairs.ML`. |
| `flow` | `AC` value, else `EX`. |
| `isAlert` | `catCode === "AL" || actCode === "ER"`. |
| `isNoise` | `catCode` in `NOISE_CATCODES` (substation/network/two-wire/message chatter; hidden unless "Advanced" is on). |
| `rawLine` | the original CSV line, shown in the feed's expanded detail. |

**Program inference (`inferEffectivePrograms`, ≈L662):** zone stop/done/soak lines frequently lack a
`PG=` field. We walk events in time order, remember the last program that touched each zone, and stamp
`progEff` on later zone lines. This keeps a zone's start AND its stop/done together when filtering by
program. (This is non-obvious; see the `visualizer-program-inference` memory.)

---

## 3. The two key architectural ideas

### (a) Chart.js owns the time axis; everything else is positioned against it
There is no separate time-scale math. The swimlane, the event timeline, the alert ticks, the
gridlines, the scrubber playhead, and the feed-pin all call
`hydroChart.scales.x.getPixelForValue(ms)` and read `hydroChart.chartArea.left/right`. The chart has a
fixed **52px left layout padding** (`layout.padding.left:52` in `buildHydroChart`, ≈L942) so the
swimlane lane labels have a consistent gutter to live in and bars line up under the chart.

Consequence: **renderHydro must run before renderSwimlane / renderEventTimeline**, because they read
the chart's scale. Both have a `requestAnimationFrame` retry (up to 4 attempts) for the very first
render when `chartArea` isn't measured yet.

When Flow is **off**, the chart still exists — it just has no datasets and collapses to a **60px** tall
strip that acts purely as a time-axis ruler. (It was 44px and clipped the bottom tick labels; bumped
to 60px.) Do **not** remove the chart when flow is off — the whole alignment system depends on it.

### (b) The date range is a *view window*, not a hard filter
`applyFilters()` (≈L748) builds `filtered` from sidebar filters **but deliberately ignores the
date range**. The visible time window (`currentRange()`, ≈L794) is applied at *render* time. This lets
zoom / nav / window presets / the minimap roam the whole file freely without rebuilding `filtered`.

- `filtered` only changes when an actual filter changes → that's when we set `hydroDirty = true` so the
  chart datasets and minimap density get rebuilt.
- View-only changes (drag, pan, zoom, nav presets) just move the X-axis min/max.

---

## 4. The performance design (why it's split the way it is)

The minimap drag used to call full `render()` every `pointermove` → it recreated the Chart.js instance
and rebuilt up to 1500 feed rows **per frame** → janky. The fix (now in place):

- **`renderHydro(range)`** (≈L962) dispatches:
  - `buildHydroChart(range)` (≈L907) — destroy + recreate the chart, rebuild datasets from **all** of
    `filtered` (Chart.js clips points to the x min/max, so datasets can stay full). Only runs when
    `!hydroChart || hydroDirty`.
  - `applyHydroView(range)` (≈L955) — the cheap path: set `scales.x.min/max` + `hydroChart.update("none")`.
- **Minimap split:** `drawMiniDensity()` (≈L1641, depends only on `filtered`) vs
  `positionMiniWindow(range)` (≈L1665, just moves the box + edge labels). `renderMiniMap` = both.
- **Live drag path:** `setViewRangeLive()` (≈L1611) moves the box instantly, then coalesces to one
  `requestAnimationFrame` that calls **`renderViewLive(range)`** (≈L1630) — which does stat + hydro +
  event timeline + nav + minimap-box, but **skips the heavy feed**. On release, `endMiniDrag()`
  (≈L1711) cancels the pending frame and commits a full `render()` (which rebuilds the feed once).

**Rule of thumb when you touch this:** if a change alters `filtered` or the chart's pixel width
(e.g. opening/closing the scrubber drawer), set `hydroDirty = true` so the chart rebuilds. If it's a
pure view move, leave `hydroDirty` false so only the scale moves.

---

## 5. Module map (where things are)

```
index.html
├── <head> CSS (≈L11–89)   — swimlane bars (.tl-*), event markers (.ev-*), alert ticks,
│                             playhead, minimap, scrubber drawer reservation (#appRoot.scrub-open)
├── markup (≈L91–372)
│   ├── sidebar / filters (aside, ≈L96–240)
│   ├── main → #dashboard (≈L242–350): stat strip, Execution Timeline card,
│   │         Interventions & Alerts card (#eventTlCard), Activity Audit feed
│   ├── scrubber drawer (#scrubPanel, ≈L355)
│   └── reference modal (#refModal, ≈L364)
└── <script> (≈L374–1824)
    ├── mapping tables + KEY_INFO + GENERAL_NOTES (≈L376–453)
    ├── State (≈L455–470)         — allEvents, filtered, hydroChart, hydroDirty, viewSpan,
    │                               flowOn, eventTlOn, zoomRange/zoomStack, windowUnit, laneSel/laneAll
    ├── timestamp + row parsing (≈L483–550)
    ├── detail rendering / chips (≈L552–583)
    ├── file handling + onDataLoaded (≈L585–733)
    ├── filtering: applyFilters (≈L748)
    ├── render pipeline:
    │     render() (≈L804) → renderStat → renderFeed → renderHydro → renderEventTimeline
    │                       → updateNavControls → renderMiniMap
    ├── window/zoom/nav: snapWindow, setWindowUnit, panToTime, zoomTo/zoomOut, navShift (≈L822–898)
    ├── hydro chart: buildHydroChart / applyHydroView / renderHydro (≈L903–967)
    ├── swimlane: RUN_START/RUN_STOP, makeRun, buildRunIntervals, barHTML, renderSwimlane (≈L969–1171)
    ├── event timeline: EVENT_GROUPS, whyText, renderEventTimeline (≈L1173–1243)
    ├── feed focus + pin: focusFeedEvent, positionPin/pinAt (≈L1245–1266)
    ├── scrubber: visibleRunsAt, snapTime, positionPlayhead, updateScrubPanel (≈L1268–1365)
    ├── audit feed: isDurationMarker, feedSeverity, feedRowHTML, renderFeed (≈L1367–1415)
    ├── helpers: escapeHtml, fmtTime, fmtDuration, subjectSummary (≈L1417–1455)
    ├── event wiring (filters, presets, nav, lane dropdowns, scrubber, minimap, variance) (≈L1457–1733)
    ├── reference modal builder (≈L1735–1793)
    └── PDF export (≈L1795–1823)
```

---

## 6. Feature notes / subtle behaviors

### Swimlane (`renderSwimlane`, ≈L1052)
- Runs are built by pairing start→stop events (`buildRunIntervals`, ≈L984):
  - **program:** `PG` SR/RN/MR → SP/DN/OF
  - **zone:** `ZN` WT → DN
  - **mainline:** `ML` RN → OF
  - A `PA` (pause) or `DR` (drop) closes an open run as **terminated** (red hatch).
  - An unclosed run at the end of data is **ongoing** (hatch, "ongoing" label).
- Run color: scheduled = green, manual = amber, terminated = red. Manual is detected via
  `actCode==="MR"` or trigger User/Operator. Zone/mainline bars use a per-key color with a status hatch overlay.
- Lanes shown are driven by the three **checklist dropdowns** in the sidebar (`laneSel.{program,zone,mainline}`).
  Default: programs & mainlines **all**, zones **none**. Programs are expandable to their zones (click the label).
- Each bar: click body → `zoomTo` that run; corner triangles → `panToTime` the other end at the same zoom.
- Red alert ticks (`.alert-mark`) sit above the lanes; click → `pinAt` + `focusFeedEvent`.

### Interventions & Alerts timeline (`renderEventTimeline`, ≈L1195) — toggle `eventTlOn`, OFF by default
- Separate card (`#eventTlCard`). Groups events into `EVENT_GROUPS` (≈L1176): Alarms, Pause, Disable,
  Skip/Drop, Config, Status/Set. First matching group wins.
- Diamond markers per event; tooltip and the scrubber panel use **`whyText(e)`** (≈L1187): the `TX`
  message plus any `extras` tokens (that's where alarm reasons live), else "by {trigger}".
- Click a marker → pin + jump to it in the feed.

### Scrubber (`positionPlayhead`/`updateScrubPanel`, ≈L1300/1313) — ON by default
- Draggable amber playhead over the timeline; optional snap-to-run-edges (`snapTime`, ≈L1285, ~8px tolerance).
- The right drawer (`#scrubPanel`) shows: the playhead time, **Running now** (active runs at that
  instant from `visibleRunsAt`), **Flow** (latest AC/EX/PR carry-forward, only if `hasHydro`), and
  **Alerts here** (alerts within tolerance). Each alert row shows a second line:
  **where** (Zone/Program/Mainline) **—** **what** (`whyText`). This was a specific user request:
  "show the error like it is but also what zone had the error and what the error was."
- Opening/closing the drawer changes the chart's available width, so `setScrubber` sets
  `hydroDirty=true` and re-renders so bars realign to the narrower canvas.
- `#appRoot.scrub-open { padding-right:300px }` reserves space; `<main>` has `min-w-0` so flex content
  shrinks instead of spilling **under** the fixed drawer (this was an actual overlap bug — keep `min-w-0`).

### Audit feed (`renderFeed`, ≈L1392)
- Shows instantaneous events; **excludes** duration markers (`isDurationMarker`, ≈L1369) since those
  are drawn as swimlane bars.
- Alarms pinned on top, then chronological. Severity left-border accent via `feedSeverity`.
- Capped at 1500 rows (`CAP` in `renderFeed`); there's also `MAX_TABLE_ROWS=1000` constant (legacy).
- Click a row → expand detail (chips + raw CSV line) and drop a pin on the timeline.

### Minimap (≈L1588+)
- Full-data-span overview with a draggable/resizable view-window box. Canvas density bins + red alert
  ticks (`drawMiniDensity`). Drag the box to pan, drag edge handles to resize, click empty track to
  center. Excluded from PDF (`data-html2canvas-ignore`).

### Filters & windowing
- Window presets All/Month/Week/Day/Hour/Min/Sec snap to calendar boundaries (`snapWindow`, ≈L825).
- Default window on load: the calendar **day** containing the file's **last** event.
- ◀ ▶ buttons and ←/→ arrow keys step by the current window (`navShift`).
- "Advanced" reveals noise categories; "Human audit only" = User/Administrator triggers; "Alerts only";
  SubStation isolation; flow-variance |AC−EX|% (only shown when `hasHydro`).

---

## 7. Conventions & gotchas (don't get burned)

- **Always run renderHydro before swimlane/event-timeline** — they read its scale.
- **Set `hydroDirty=true`** on: filter changes (`applyFilters` does this), Flow toggle, and scrubber
  drawer toggle (width change). Not on pure pan/zoom.
- **Keep the chart alive when Flow is off** — it's the time-axis source. Just collapse its height.
- **`min-w-0` on `<main>`** is load-bearing for the drawer-overlap fix.
- **`viewSpan`** (module-level) is used by the chart tick/tooltip time formatting; it's set in
  `buildHydroChart`/`applyHydroView`. `fmtTime(ms, span)` changes format by span (sec → date).
- **PapaParse `worker:false`** — required for `file://`. Don't "optimize" it to a worker.
- **PDF export** excludes anything with `data-html2canvas-ignore` (upload box, all controls, minimap).
- **No framework / no state library** — it's direct DOM. Re-render functions rebuild `innerHTML` and
  re-attach listeners each time; keep that pattern.
- **Syntax check after edits** (there are no real tests):
  ```bash
  sed -n '/<script>/,/<\/script>/p' index.html | sed '1d;$d' > /tmp/v.js && node --check /tmp/v.js
  ```
  This only checks JS syntax, not behavior — verify visually in a browser.

---

## 8. State of play / open items

**Recently done (this session):**
- Minimap drag made smooth (chart reuse + deferred feed, see §4).
- Scrubber on by default; drawer always present when on.
- Panel/timeline overlap fixed (`min-w-0`).
- New Interventions & Alerts timeline (togglable, off by default); Flow overlay off by default.
- Collapsed Flow axis height 44→60px (was clipping bottom tick labels).
- Scrubber alert rows enriched with where + why.

**Still to do / worth verifying:**
1. **Browser-verify** the last two fixes with a real file (collapsed Flow axis labels not clipped;
   "At Playhead" alert rows show zone/program + error text correctly).
2. **Flow path is untested against real telemetry** — `Evnt_202605.csv` has no AC/EX/PR. Find/synthesize
   a file with flow data to exercise `buildHydroChart`'s dataset/legend/variance code paths.
3. **No automated tests** — only `node --check`. Behavior is manual-verify only.
4. **Large logs** rely on the 1500-row feed cap + density binning; not virtualized.
5. **Polish ideas** (not requested, just candidates): keyboard nav for the scrubber, persist toggle
   state across reloads, export the event/alert timeline data, narrow-screen layout for the drawer,
   reconcile the unused `MAX_TABLE_ROWS` constant with the `CAP` in `renderFeed`.
