/* ============================================================================
   App core. This is the original single-file dashboard logic, now importing its
   libraries (Chart.js, PapaParse) and constants instead of relying on
   CDN globals. The tightly-coupled render / timeline / swimlane / scrubber /
   feed / minimap code is kept together here on purpose — it shares mutable state
   and dozens of cross-calls; splitting it further buys little and risks regressions.
   ========================================================================== */
// Register only the Chart.js pieces this app uses (one line chart on linear axes) instead of
// chart.js/auto, which pulls in every controller/scale/element and bloats the initial bundle.
import {
  Chart, LineController, LineElement, PointElement, LinearScale, Tooltip,
} from "chart.js";
Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);
import Papa from "papaparse";
// PDF export uses the browser's native print (window.print() + a `@media print` stylesheet), so there
// is no heavy PDF/canvas library to load — see the report-export handler near the bottom of this file.
import {
  CATEGORY_MAP, ACTION_MAP, TRIGGER_MAP,
  FEED_CAP, KEY_INFO, GENERAL_NOTES, MANUAL_PROG_TAG,
  STATUS_MAP, EVENT_CAUSE_MAP, MESSAGE_CODE_MAP, MESSAGE_CATEGORY_MAP,
  MESSAGE_PRIORITY_MAP, OBJECT_KEY_MAP, STOP_CONDITION_MAP, ZONE_MODE_MAP, DATA_GROUPS,
} from "./constants.js";
import { showErrorBanner, pushError } from "./errors.js";
// Pure data logic lives in dependency-free modules (unit-tested in tests/); app.js wires them to the DOM.
import { eventsFromRows, inferEffectivePrograms, telemetryValue } from "./parse.js";
import { RUN_START, buildRunIntervals, zoneRunInProgram, mergeSpans } from "./runs.js";
import {
  escapeHtml, numCmp, distinctSorted, fmtTime, fmtTimeDate, fmtDuration,
  windowLabel, snapWindow, centeredWindow, categoryColor, toLocalInput, fromLocalInput,
} from "./format.js";
import {
  filterEvents, clampView, pxToTime, timeToPx, shiftRange, centeredRange,
  selectVisibleRuns, buildRunCoverIndex, runCoversAt, snapToEdges, jumpTitle,
} from "./view.js";
import {
  feedSeverity, EVENT_GROUPS, eventGroupOf, whyText, subjectSummary,
  eventRunTarget, selectFeedRows, eventJumpTarget,
} from "./classify.js";
import { buildDiagnostics } from "./diagnostics.js";

/* ============================ State ============================ */
let allEvents = [];     // full parsed dataset
let filtered = [];      // current filtered subset
let hydroChart = null;  // Chart.js line chart (hydraulic overlay + shared time axis)
let hydroDirty = true;  // rebuild chart datasets only after import or display-mode changes (else move the x-axis)
let miniDensityDirty = true; // repaint the minimap histogram only when `filtered` changes (not on view-only moves)
let viewSpan = 0;       // current view width (ms), used by the chart tick/tooltip time formatting
let flowOn = false;     // show the hydraulic flow/pressure lines on the main timeline (off by default)
let eventTlOn = false;  // show the separate Interventions & Alerts timeline (off by default)
let soakSplit = true;   // split cycle-and-soak zone runs into watering vs soak segments (on by default)
let zoomRange = null;   // {start,end} when zoomed in; null = use the date-filter window
let hasHydro = false;   // dataset contains any AC/EX/PR telemetry
let dataMinT = 0, dataMaxT = 0; // full data time bounds
// Historical runs use complete evidence; feed filters never remove their start/stop boundaries.
let runCache = {};      // { program|zone|mainline -> intervals[] }
let globalEndCached = 0;// end-of-data marker for still-open ("ongoing") runs
let runGen = 0;         // bumped on every successful import; invalidates the visibleRunsAt() memo
let telemetry = [];     // chronological subset of `allEvents` carrying AC/EX/PR (scrubber flow carry-forward)
let windowUnit = "day"; // active window unit: second|minute|hour|day|week|month|all|custom
// which lanes show on the timeline (checklist dropdowns). empty set = group hidden.
const laneSel = { program: new Set(), zone: new Set(), mainline: new Set() };
const laneAll = { program: [], zone: [], mainline: [] }; // full key lists per group
let programZones = new Map(); // explicit PG= + ZN= links found anywhere in the loaded CSV

/* ============================ Shared helpers ============================ */
const $ = document.getElementById.bind(document);
// Chart.js owns the shared time axis; these expose its scale/area once it's measured.
const chartX = () => (hydroChart && hydroChart.scales) ? hydroChart.scales.x : null;
const chartArea = () => { const a = hydroChart && hydroChart.chartArea; return (a && a.right > a.left) ? a : null; };
const clampX = (ms, area, xScale) => Math.max(area.left, Math.min(area.right, xScale.getPixelForValue(ms)));
// vertical time gridlines aligned to the chart's x ticks, drawn over a lane (translucent)
const gridLinesHTML = (xScale, rgba, z) => `<div style="position:absolute;inset:0;pointer-events:none;z-index:${z};">` +
  (xScale.getTicks ? xScale.getTicks() : []).map(t => `<div style="position:absolute;top:0;bottom:0;left:${xScale.getPixelForValue(t.value)}px;width:1px;background:${rgba};"></div>`).join("") + `</div>`;
// sticky lane-label base style (left gutter), parameterized by row height + width
const laneLabelStyle = (h, w) => `position:sticky;left:0;z-index:2;display:inline-flex;align-items:center;height:${h}px;width:${w}px;font-size:10px;background:#0f172a;`;
const ZONE_BLOCK_ACTIONS = new Set(["PA", "DS", "SK", "DR", "CE"]);
const isZoneBlocker = e => e.isAlert || ZONE_BLOCK_ACTIONS.has(e.actCode);

/* ============================ Detail rendering (with hover help) ============================ */
function keyTooltip(k) {
  const info = Object.hasOwn(KEY_INFO, k) ? KEY_INFO[k] : null;
  if (!info) return `${k} — no published definition`;
  return `${k} — ${info.desc}` + (info.unit ? ` (${info.unit})` : "");
}

// inline chip with a native hover tooltip
function chip(label, value, title, help) {
  const t = escapeHtml(title);
  const cls = help ? "help-chip" : "";
  return `<span class="${cls} inline-flex items-baseline gap-1 mr-2 mb-1 px-2 py-0.5 bg-slate-800 border border-slate-700" title="${t}">` +
         `<span class="text-slate-400 font-semibold">${escapeHtml(label)}</span>` +
         `<span class="text-slate-200">${escapeHtml(value)}</span></span>`;
}

function detailHTML(ev) {
  let html = "";
  html += chip("Category", `${ev.category}`, `${ev.catCode||"?"} = ${ev.category}`, false);
  html += chip("Action", `${ev.action}`, `${ev.actCode||"?"} = ${ev.action}`, false);
  html += chip("Trigger", `${ev.trigger}`, `${ev.trgCode||"?"} = ${ev.trigger}`, false);
  html += chip("Subject", subjectSummary(ev).title, "The zone / program / device acted on", false);
  for (const [k, v] of Object.entries(ev.pairs)) {
    html += chip(k, v.display, keyTooltip(k), true);
  }
  if (ev.extras.length) {
    html += chip("Values", ev.extras.join(", "), "Positional values with no key", false);
  }
  html += `<div class="w-full mt-2 pt-2 border-t border-slate-800 font-mono text-slate-400 break-all">Reconstructed CSV: ${escapeHtml(ev.rawLine)}</div>`;
  return html;
}

/* ============================ File handling ============================ */
const fileInput = $("fileInput");
const dropZone = $("dropZone");
const fileNameEl = $("fileName");

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault(); dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", e => { if (e.target.files.length) handleFile(e.target.files[0]); });

let uploadGeneration = 0;
function handleFile(file) {
  const generation = ++uploadGeneration;
  const status = $("importStatus");
  status.textContent = "Parsing " + file.name + "…";
  // ponytail: bound in-memory imports to 20 MB; use chunked ingestion if larger archives are needed.
  if (file.size > 20 * 1024 * 1024) {
    status.textContent = "This file exceeds 20 MB. Choose a smaller event log. The previous log is unchanged.";
    fileInput.value = "";
    return;
  }
  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    delimiter: ",",
    worker: false,
    complete: (results) => {
      if (generation !== uploadGeneration) return;
      let committed = false;
      try {
        if (results.errors.length) throw new Error(`CSV parse error: ${results.errors[0].message}`);
        const events = eventsFromRows(results.data);
        if (!events.length) throw new Error("No valid events found in file.");
        inferEffectivePrograms(events);
        const skipped = results.data.length - events.length;
        allEvents = events;
        fileNameEl.textContent = file.name;
        revealedFeedIds.clear();
        clearTimeout(feedSearchTimer);
        playheadTime = null;
        committed = true; // state replaced from here on; a later failure must not claim the old log is kept
        onDataLoaded();
        status.textContent = skipped ? `${skipped.toLocaleString()} invalid/header row(s) skipped.` : "";
      } catch (err) {
        status.textContent = committed
          ? `The new log was loaded but could not be displayed: ${err.message}`
          : `${err.message} The previous successful log is retained.`;
      } finally {
        fileInput.value = "";
      }
    },
    error: (err) => {
      if (generation !== uploadGeneration) return;
      status.textContent = "Error reading file: " + err.message + ". The previous successful log is retained.";
      fileInput.value = "";
    }
  });
}

function fillSelect(id, allLabel, values, labelFn) {
  const sel = $(id);
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(v => `<option value="${escapeHtml(String(v))}">${escapeHtml(labelFn ? labelFn(v) : String(v))}</option>`).join("");
}

// Build a lane checklist dropdown (group = program|zone|mainline). selectAll → start all checked.
const ddCap = g => g.charAt(0).toUpperCase() + g.slice(1);
function fillLaneDropdown(group, keys, labelFn, colorFn, selectAll) {
  keys = keys.map(String);
  laneAll[group] = keys;
  laneSel[group] = new Set(selectAll ? keys : []);
  const list = $("dd" + ddCap(group) + "List");
  list.innerHTML = keys.length
    ? keys.map(k => `<label><input type="checkbox" class="ddItem w-3.5 h-3.5 bg-slate-900 border-slate-600 accent-sky-500" value="${escapeHtml(k)}" ${selectAll ? "checked" : ""}>
        <span class="inline-block w-2.5 h-2.5 " style="background:${colorFn(k)}"></span>${escapeHtml(labelFn(k))}</label>`).join("")
    : '<span class="text-slate-500 text-xs">none in file</span>';
  const panel = $("dd" + ddCap(group) + "Panel");
  const allCb = panel.querySelector(".ddAll");
  if (allCb) allCb.checked = selectAll && keys.length > 0;
}

// summary text on each dropdown button
function updateLaneButtons() {
  for (const g of ["program", "zone", "mainline"]) {
    const sel = laneSel[g], total = laneAll[g].length;
    const txt = sel.size === 0 ? "None" : sel.size === total ? "All" : sel.size + " selected";
    const span = document.querySelector("#dd" + ddCap(g) + "Btn .ddSummary");
    if (span) span.textContent = txt;
    const allCb = document.querySelector("#dd" + ddCap(g) + "Panel .ddAll");
    if (allCb) { allCb.checked = total > 0 && sel.size === total; allCb.indeterminate = sel.size > 0 && sel.size < total; }
  }
}

/* ============================ After load: populate filters ============================ */
function onDataLoaded() {
  programZones = new Map();
  for (const e of allEvents) {
    if (e.program == null || String(e.program) === MANUAL_PROG_TAG || !e.zones.length) continue;
    const key = String(e.program);
    const zones = programZones.get(key) || new Set();
    for (const z of e.zones) zones.add(String(z));
    programZones.set(key, zones);
  }

  // range bounds (reduce avoids call-stack limits of spread on large arrays)
  let minT = Infinity, maxT = -Infinity;
  for (const e of allEvents) { const t = e.ts.getTime(); if (t < minT) minT = t; if (t > maxT) maxT = t; }
  dataMinT = minT; dataMaxT = maxT;
  // Default window: the calendar DAY (midnight → midnight) containing the file's last event.
  windowUnit = "day";
  zoomRange = snapWindow("day", maxT);
  runCache = {};
  globalEndCached = dataMaxT + 1;
  runGen++;
  telemetry = allEvents.filter(e => ["AC", "EX", "PR"].some(k => telemetryValue(e, k) != null))
    .sort((a, b) => a.ts - b.ts);

  // populate the timeline lane dropdowns (multi-select checklists). PG=MR isn't a program — it's the
  // tag on a manual zone run (see the Manual Runs lane), and it has no program bars to show, so keep
  // it out of the Programs list rather than offering a lane that can only ever render empty.
  fillLaneDropdown("program", distinctSorted(allEvents.map(e => e.progEff)).filter(p => String(p) !== MANUAL_PROG_TAG),
    p => `Program ${p}`, p => categoryColor("Program " + p), true);
  fillLaneDropdown("zone", distinctSorted(allEvents.flatMap(e => e.zones)), z => `Zone ${z}`, z => zoneColor(z), false);
  fillLaneDropdown("mainline", distinctSorted(allEvents.map(e => e.mainline)), m => `Mainline ${m}`, m => categoryColor("Mainline " + m), true);

  // other filters
  fillSelect("categoryFilter", "All Categories", distinctSorted(allEvents.map(e => e.category)));
  fillSelect("actionFilter", "All Actions", distinctSorted(allEvents.map(e => e.action)));
  fillSelect("triggerFilter", "All Triggers", distinctSorted(allEvents.map(e => e.trigger)));
  // SubStation isolation: use SN= serial when present, else SB= number
  fillSelect("substationFilter", "All SubStations",
    distinctSorted(allEvents.map(e => e.pairs.SN ? e.pairs.SN.raw : (e.pairs.SB ? e.pairs.SB.raw : null))),
    v => /^[A-Za-z]/.test(String(v)) ? v : `SubStation ${v}`);

  updateLaneButtons();
  // fresh log → clear any leftover feed search/sort and jump highlight from a previous file
  feedQuery = ""; feedSortCol = null; feedSortDir = "asc"; $("feedSearch").value = "";
  locatedRun = null; locatedTs = null; locatedEid = null;
  expandedPrograms.clear(); expandedManual = true;
  $("feedHead").classList.remove("hidden"); // sortable column header appears once a log is loaded

  // detect hydraulic telemetry → reveal the variance slider only when meaningful
  hasHydro = telemetry.length > 0;
  const hasFlow = telemetry.some(e => telemetryValue(e, "AC") != null || telemetryValue(e, "EX") != null);
  $("varSection").classList.toggle("hidden", !hasFlow);
  // Flag a loaded log that carries no flow telemetry so the user sees it without toggling Flow on.
  $("flowNote").classList.toggle("hidden", hasFlow);

  // flow max (for the optional Min-Flow slider under More filters)
  const fmax = allEvents.reduce((m, e) => e.flow != null && e.flow > m ? e.flow : m, 0);
  const sliderMax = fmax > 0 ? Math.ceil(fmax) : 100;
  const slider = $("flowSlider");
  slider.max = sliderMax; slider.value = 0;
  $("flowMax").textContent = sliderMax;
  $("flowValue").textContent = "0";

  $("subtitle").textContent =
    `${allEvents.length.toLocaleString()} events — ${fmtTimeDate(minT, 0)} to ${fmtTimeDate(maxT, 0)} (controller time)`;

  $("alertsOnly").checked = false; $("humanAudit").checked = false;
  $("varMin").value = 0; $("varMax").value = 100; syncVarLabels();
  hydroDirty = true;
  playheadOn = true; $("scrubberOn").checked = true;
  timeWrap.classList.add("scrub-on"); $("appRoot").classList.add("scrub-open");
  playheadTime = (zoomRange.start + zoomRange.end) / 2;
  applyFilters();
}

/* ============================ Filtering ============================ */
// Read the sidebar into a plain options object; matchesFilters (view.js) owns the predicate.
function readFilterOpts() {
  return {
    category: $("categoryFilter").value,
    action: $("actionFilter").value,
    trigger: $("triggerFilter").value,
    substation: $("substationFilter").value,
    minFlow: parseFloat($("flowSlider").value) || 0,
    alertsOnly: $("alertsOnly").checked,
    humanAudit: $("humanAudit").checked,
    showAdvanced: $("showAdvanced").checked,
    varMin: parseFloat($("varMin").value) || 0,
    varMax: parseFloat($("varMax").value),
    hasHydro,
  };
}

function applyFilters() {
  filtered = filterEvents(allEvents, readFilterOpts());
  feedLimit = FEED_CAP;

  lastFeedSig = null;
  miniDensityDirty = true;
  render();
}

// Memoized intervals over the full history, rebuilt only after a successful import.
function runIntervals(mode) {
  return runCache[mode] || (runCache[mode] = buildRunIntervals(allEvents, mode, globalEndCached));
}

/* ============================ Stat strip ============================ */
function renderStat(range, inWin) {
  $("statTotal").textContent = inWin.length.toLocaleString();
  $("statAlerts").textContent = inWin.filter(e => e.isAlert).length.toLocaleString();
  const span = range.end - range.start;
  $("statWindow").textContent = `${fmtTimeDate(range.start, span)} → ${fmtTimeDate(range.end, span)}`;
}

/* ============================ Timeline render pipeline ============================ */
// The active view window: an explicit zoom range, else the date-filter window.
function currentRange() {
  if (zoomRange) return { start: zoomRange.start, end: zoomRange.end };
  const f = fromLocalInput($("dateFrom").value)?.getTime();
  const t = fromLocalInput($("dateTo").value)?.getTime();
  const start = isFinite(f) ? f : dataMinT;
  const end = isFinite(t) ? t + 60000 : dataMaxT + 1;
  return { start, end: end > start ? end : start + 60000 };
}

// Top-level render: stat strip → hydraulic chart (provides shared X scale) → swimlane → feed.
function render() {
  if (!allEvents.length) return;
  try {
    const range = currentRange();
    syncDateInputs(range);
    const inWin = filtered.filter(e => { const t = e.ts.getTime(); return t >= range.start && t < range.end; });
    renderStat(range, inWin);
    renderFeed();           // feed lists the whole log, independent of the window
    renderHydro(range);     // builds the chart, then calls renderSwimlane() using its X scale
    renderEventTimeline(range);
    updateNavControls(range);
    renderMiniMap(range);
  } catch (err) {
    pushError("render", err && err.message, err && err.stack, "");
    showErrorBanner("Failed to render the dashboard", err);
  }
}

// reflect the active window into the date pickers (display only; minute precision)
function syncDateInputs(range) {
  $("dateFrom").value = toLocalInput(new Date(range.start));
  $("dateTo").value = toLocalInput(new Date(range.end - 1));
}

// set the view to a window of `unit`'s duration centered on the scrubber (½ the unit on each side), so
// zooming in/out from the preset selector keeps the playhead put. Falls back to the view center when the
// scrubber is off. Navigation preserves this centered window width.
function setWindowUnitCentered(unit) {
  windowUnit = unit;
  if (unit === "all") { zoomRange = { start: dataMinT, end: dataMaxT + 1 }; }
  else {
    const r = currentRange();
    const center = (playheadOn && playheadTime != null) ? playheadTime : (r.start + r.end) / 2;
    zoomRange = centeredWindow(unit, center);
  }
  render();
}

// slide the view (keeping the current window width) so time `t` is centered — used by the
// corner jump-triangles to hop to the other end of a run at the same zoom level.
function panToTime(t) {
  const r = currentRange();
  zoomRange = centeredRange(t, r.end - r.start);
  render();
}

// Keep the preset's centered window width when stepping.
function navShift(dir) {
  if (!allEvents.length) return;
  zoomRange = shiftRange(currentRange(), dir);
  render();
}
function updateNavControls(range) {
  const lbl = (windowUnit && windowUnit !== "custom" && windowUnit !== "all") ? windowUnit : windowLabel(range.end - range.start);
  $("navPrev").title = "Previous " + lbl;
  $("navNext").title = "Next " + lbl;
  $("navLabel").textContent = lbl + " view";
  // highlight the active window-unit preset
  document.querySelectorAll("#windowPresets button[data-win]").forEach(b => {
    const active = b.getAttribute("data-win") === windowUnit;
    b.className = "px-2.5 py-1 " + (active ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700");
  });
}

let expandedPrograms = new Set(); // program keys whose zone drop-down is open (program lane view)
// Is the Manual Runs lane showing its per-zone rows? Starts open: manual runs are the whole point of
// that section, and it only ever holds the zones that ran manually *in the window* (a handful/day).
let expandedManual = true;
// Run start/done rows are normally hidden from the feed (drawn as bars). When the user clicks a
// "Running now" item in the scrubber panel, we force-show that specific event's raw row here.
let revealedFeedIds = new Set();
// Audit-feed search + column sort. The feed always covers the whole log; a non-empty query filters it.
// feedSortCol null = default order (alarms pinned, then chronological); set = sort by that column.
let feedQuery = "", feedSortCol = null, feedSortDir = "asc";
let lastFeedSig = null; // content signature of the last feed render, to preserve scroll on view-only moves
let feedLimit = FEED_CAP;
let feedOrdered = [], feedRenderedIds = new Set();
let feedAlertCount = 0, feedPrefix = 0;
// A run bar to flash on the next swimlane render (set by a "locate on timeline" jump). {group,key,ts}.
let pendingBarHighlight = null;
// The last located run + time. Unlike pendingBarHighlight (a one-shot arrival pulse) these are sticky:
// renderSwimlane re-applies their marks on every render so the jump target stays visible through
// pan/zoom/filter changes, until the next jump, a new file, or Reset Filters.
let locatedRun = null, locatedTs = null;
// Same idea for the Interventions & Alerts timeline: the _id of the event whose diamond is ringed, so
// renderEventTimeline can re-apply the mark on every render. Kept separate from locatedRun because an
// event can be drawn on both timelines at once (a pause rings its diamond AND the run it killed).
let locatedEid = null;

/* ---- Component B: Hydraulic overlay (Chart.js line, provides the shared X scale) ---- */
// Rebuild the Chart.js instance from the whole-log `telemetry` subset. Only needed after an import or a
// display-mode change (e.g. the Flow toggle) — view-only moves use applyHydroView() instead. Datasets hold ALL points; the chart
// clips line points to the x-axis min/max on draw, so panning is just a scale change (no dataset rebuild).
function buildHydroChart(range) {
  const canvas = $("hydroChart");
  viewSpan = range.end - range.start;
  const acPts = [], exPts = [], prPts = [];
  // only gather flow series when the Flow overlay is enabled; otherwise the chart is just a thin time axis
  if (flowOn) for (const e of telemetry) {
    const t = e.ts.getTime();
    const ac = telemetryValue(e, "AC"), ex = telemetryValue(e, "EX"), pr = telemetryValue(e, "PR");
    if (ac != null) acPts.push({ x: t, y: ac });
    if (ex != null) exPts.push({ x: t, y: ex });
    if (pr != null) prPts.push({ x: t, y: pr });
  }
  const datasets = [];
  if (acPts.length) datasets.push({ label: "Actual flow (L/min)", data: acPts, borderColor: "#38bdf8", backgroundColor: "#38bdf8", yAxisID: "yFlow", pointRadius: 2, borderWidth: 2, tension: 0.2 });
  if (exPts.length) datasets.push({ label: "Expected flow (L/min)", data: exPts, borderColor: "#a78bfa", backgroundColor: "#a78bfa", yAxisID: "yFlow", pointRadius: 0, borderWidth: 2, borderDash: [5, 4], tension: 0.2 });
  if (prPts.length) datasets.push({ label: "Pressure (kPa)", data: prPts, borderColor: "#f59e0b", backgroundColor: "#f59e0b", yAxisID: "yPres", pointRadius: 0, borderWidth: 2, tension: 0.2 });
  const hasData = datasets.length > 0;
  // Flow off → collapse the chart to a slim axis ruler (still drives swimlane alignment & gridlines).
  $("hydroBox").style.height = flowOn ? "180px" : "60px";
  $("hydroEmpty").classList.toggle("hidden", !(flowOn && !hasData));

  const scales = {
    x: { type: "linear", min: range.start, max: range.end,
      ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 10, callback: v => fmtTime(v, viewSpan) },
      grid: { color: "rgba(148,163,184,0.06)" } },
    yFlow: { position: "left", display: !!(acPts.length || exPts.length), beginAtZero: true,
      title: { display: true, text: "L/min", color: "#94a3b8" }, ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,0.06)" } },
    yPres: { position: "right", display: prPts.length > 0, beginAtZero: true,
      title: { display: true, text: "kPa", color: "#94a3b8" }, ticks: { color: "#94a3b8" }, grid: { display: false } }
  };
  if (hydroChart) hydroChart.destroy();
  hydroChart = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      onResize: scheduleOverlayLayout,
      layout: { padding: { left: 52, right: 8, top: 4 } }, // fixed gutter so swimlane lane labels fit/align
      plugins: { legend: { display: false },
        tooltip: { mode: "nearest", axis: "x", intersect: false, callbacks: { title: items => items.length ? fmtTime(items[0].parsed.x, viewSpan) : "" } } },
      scales
    }
  });
  $("legendHydro").innerHTML =
    !flowOn ? '<span class="text-slate-600">Flow overlay off — enable “Flow” to chart actual/expected flow &amp; pressure.</span>'
    : hasData ? datasets.map(d => `<span class="flex items-center gap-1"><span class="inline-block w-3 h-2 " style="background:${d.borderColor}"></span><span class="text-slate-300">${escapeHtml(d.label)}</span></span>`).join("")
    : '<span class="text-slate-500" title="Flow is charted from Actual (AC) / Expected (EX) readings and pressure from PR — the controller logs these during zone runs with flow monitoring. None are present here; check the FlowStation / flow report for flow with no zones running.">No flow readings (AC/EX/PR) in this log — check the FlowStation / flow report.</span>';
}

// Cheap view-only update: move the x-axis to the new window (no destroy/recreate, no animation).
function applyHydroView(range) {
  viewSpan = range.end - range.start;
  hydroChart.options.scales.x.min = range.start;
  hydroChart.options.scales.x.max = range.end;
  hydroChart.update("none");
}

function renderHydro(range) {
  if (!hydroChart || hydroDirty) buildHydroChart(range);
  else applyHydroView(range);
  hydroDirty = false;
  renderSwimlane(range);
}

/* ---- Component A: Swimlane (duration runs), pixel-aligned to the hydraulic X scale ---- */
let overlayRaf = null;
function scheduleOverlayLayout() {
  if (overlayRaf) return;
  overlayRaf = requestAnimationFrame(() => {
    overlayRaf = null;
    if (!allEvents.length || !chartArea()) return;
    const range = currentRange();
    renderSwimlane(range); renderEventTimeline(range);
    miniDensityDirty = true; renderMiniMap(range);
  });
}
const SWIM_ROW_H = 26;
function refreshSwimlane() { renderSwimlane(currentRange()); }

const zoneColor = k => categoryColor("Zone " + k);

// one run block + corner jump triangles. Start/end times render INSIDE the bar only when there's
// room for the text; otherwise nothing inline (the full start → stop is always on the hover tooltip).
// `fill` (zone color) overrides the status color but keeps a status hatch overlay.
function barHTML(iv, xOf, range, word, fill, soak) {
  const span = range.end - range.start;
  const x1 = xOf(iv.start), x2 = xOf(iv.end), width = Math.max(3, x2 - x1);
  const clipL = iv.start < range.start, clipR = iv.end > range.end;
  const dur = fmtDuration(iv.end - iv.start);
  const sTxt = fmtTime(iv.start, span), eTxt = iv.ongoing ? "ongoing" : fmtTime(iv.end, span);
  const extra = (word === "Zone" && iv.program != null) ? ` · prog ${iv.program}` : "";
  const note = (iv.inferred ? " — ended early (no DONE logged; inferred from run list)"
    : iv.kind === "run-terminated" ? " — stopped early (pause/alarm)"
    : iv.ongoing ? " — ongoing" : "") + (iv.manual ? " · manual" : "");
  const title = soak
    ? `${word} ${iv.key}${extra} — soaking: ${sTxt} → ${eTxt} (${dur})`
    : `${word} ${iv.key}${extra}: ${sTxt} → ${eTxt} (${dur})${note}`;
  // With a fill (zone color) we drop the status background class, but still flag manual runs with an
  // amber inset border + "M" badge so they're distinguishable from scheduled runs of the same color.
  // Soak segments keep the zone hue but read as "not watering" (dimmed + striped via .run-soak).
  const cls = (fill ? "" : iv.kind) + (iv.manual ? " run-manual-mark" : "") + (soak ? " run-soak" : "");
  const hatch = (!soak && fill && (iv.kind === "run-terminated" || iv.ongoing)) ? " run-hatch" : "";
  const badge = iv.manual ? `<span class="run-manual-badge" title="Manual run">M</span>` : "";
  let style = `left:${x1}px;width:${width}px;` + (fill ? `background:${fill};` : "");
  // does the bar have room for "start  end" (≈6px/char + padding clear of the corner triangles)?
  const needTimes = (sTxt.length + eTxt.length) * 6 + 22;
  let inner = "";
  if (width >= needTimes) {
    inner = `<span>${escapeHtml(sTxt)}</span><span>${escapeHtml(eTxt)}</span>`;
    style += "display:flex;justify-content:space-between;align-items:center;padding:0 9px;";
  } else if (width > 90) {
    inner = escapeHtml(dur); // medium bar: at least show duration
  }
  // ▶ top-left → jump to this run's END;  ◀ top-right → jump to its START (only when clickable)
  const jumps = width >= 16
    ? `<span role="button" tabindex="0" class="tl-jump tl-jump-start" data-to="${iv.end}" title="Jump to end (${escapeHtml(eTxt)})"></span>` +
      `<span role="button" tabindex="0" class="tl-jump tl-jump-end" data-to="${iv.start}" title="Jump to start (${escapeHtml(sTxt)})"></span>`
    : "";
  // group/key/runstart let a bar click resolve back to the run's raw start event in the feed. For a
  // soak/watering *segment* iv.start is the segment start, so iv.runStart carries the true run start.
  const runStart = iv.runStart != null ? iv.runStart : iv.start;
  return `<div role="button" tabindex="0" aria-label="${escapeHtml(title)}" class="tl-bar ${cls}${hatch} ${clipL ? "clip-l" : ""} ${clipR ? "clip-r" : ""}" data-start="${iv.start}" data-end="${iv.end}" data-group="${word}" data-key="${escapeHtml(String(iv.key))}" data-runstart="${runStart}" style="${style}" title="${escapeHtml(title)}">${inner}${badge}${jumps}</div>`;
}

// Render a zone run's bars. With soak handling on, a cycle-and-soak run (iv.segments) is drawn as
// alternating watering (zone color) + soak (dimmed/striped) segments; status visuals stay on the
// last segment and the manual badge on the first. Otherwise it's the single envelope bar.
function zoneBars(iv, xOf, range, col) {
  if (soakSplit && iv.segments && iv.segments.length > 1) {
    const n = iv.segments.length;
    return iv.segments.map((sg, i) => {
      const seg = { ...iv, start: sg.s, end: sg.e, runStart: iv.start, // keep the run's real start for feed lookup
        ongoing:  i === n - 1 ? iv.ongoing  : false,   // ongoing/inferred/terminated belong to the run end
        inferred: i === n - 1 ? iv.inferred : false,
        kind:     i === n - 1 ? iv.kind : "run-scheduled",
        manual:   i === 0 ? iv.manual : false };        // "M" badge on the first segment only
      return barHTML(seg, xOf, range, "Zone", col, sg.soak);
    }).join("");
  }
  return barHTML(iv, xOf, range, "Zone", col);
}

function renderSwimlane(range, attempt) {
  const lane = $("swimlane");
  const area = chartArea(), xScale = chartX();
  if (!area || !xScale) {
    if ((attempt || 0) < 4) requestAnimationFrame(() => renderSwimlane(range, (attempt || 0) + 1));
    return;
  }
  const xOf = ms => clampX(ms, area, xScale);
  const inWin = iv => iv.end > range.start && iv.start < range.end;
  const sortedKeys = runs => [...new Set(runs.map(iv => iv.key))].sort(numCmp);

  // lane dropdowns: a group shows when its selection set is non-empty
  const showPrograms = laneSel.program.size > 0;
  const showZones = laneSel.zone.size > 0;
  const showMainlines = laneSel.mainline.size > 0;
  const showScheduled = $("showScheduled").checked;
  const showManual = $("showManual").checked;
  const runTypeOk = iv => (iv.manual ? showManual : showScheduled);
  const groupsOn = [showPrograms, showZones, showMainlines].filter(Boolean).length;

  const blockersByZone = new Map();
  for (const e of filtered) {
    const t = e.ts.getTime();
    if (!isZoneBlocker(e) || t < range.start || t >= range.end) continue;
    for (const z of e.zones) {
      const key = String(z);
      const list = blockersByZone.get(key) || [];
      list.push(e);
      blockersByZone.set(key, list);
    }
  }
  const blockerMarks = (zone, program = null) => (blockersByZone.get(String(zone)) || [])
    .filter(e => program == null || String(e.progEff) === String(program))
    .map(e => {
      const group = eventGroupOf(e);
      const title = `${fmtTime(e.ts.getTime(), range.end - range.start)} — Zone ${zone} — ${e.action}: ${whyText(e)}`;
      return `<button type="button" class="zone-block-mark" data-eid="${e._id}" data-zone="${escapeHtml(zone)}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}" style="left:${xOf(e.ts.getTime())}px;background:${group.color};"></button>`;
    }).join("");

  const lblW = Math.max(40, area.left);
  const lblBase = laneLabelStyle(SWIM_ROW_H, lblW);
  const swatch = c => `<span style="display:inline-block;width:8px;height:8px;margin-right:4px;background:${c}"></span>`;
  const section = txt => groupsOn > 1 ? `<div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-2 mb-1 pl-1">${txt}</div>` : "";
  const track = (lbl, bars, bg) => `<div class="tl-track" style="height:${SWIM_ROW_H}px;margin-bottom:3px;${bg ? "background:" + bg + ";" : ""}">${lbl}${bars}</div>`;

  // build runs per enabled group. zoneRunsAll is run-type filtered too: the rows under an expanded
  // program are zone runs like any other, so unchecking Manual must drop them there as well.
  const progRuns = showPrograms ? runIntervals("program").filter(inWin).filter(runTypeOk) : [];
  const zoneRunsAll = (showPrograms || showZones) ? runIntervals("zone").filter(inWin).filter(runTypeOk) : [];
  const zoneRuns = showZones ? zoneRunsAll : [];
  const mainRuns = showMainlines ? runIntervals("mainline").filter(inWin) : [];
  // Manual runs get their own section, independent of the Zones dropdown (which starts empty — see
  // fillLaneDropdown in onDataLoaded). Without this a log whose manual runs are all zone runs shows
  // none of them on load, which is exactly the demo bug this section exists to fix.
  const manualRuns = showManual ? runIntervals("zone").filter(inWin).filter(iv => iv.manual) : [];
  // Count logical runs once, even when expanded children or manual lanes draw them more than once.
  $("statRuns").textContent = visibleRunsAt().filter(inWin).length.toLocaleString();

  // index runs by key once (instead of re-filtering the whole array per key in the loops below)
  const byKey = runs => { const m = new Map(); for (const iv of runs) (m.get(iv.key) || m.set(iv.key, []).get(iv.key)).push(iv); return m; };
  const mainByKey = byKey(mainRuns);
  const progByKey = byKey(progRuns);
  const zoneByKey = byKey(zoneRuns);
  const zoneAllByKey = byKey(zoneRunsAll);

  let html = "";
  // Mainlines (top — sits just above the hydraulic chart for flow/pressure correlation)
  if (showMainlines) {
    html += section("Mainlines");
    const mKeys = sortedKeys(mainRuns).filter(k => laneSel.mainline.has(k));
    if (!mKeys.length) html += `<div class="text-[10px] text-slate-500 pb-1 pl-1">No selected mainline runs in view.</div>`;
    for (const k of mKeys) {
      const col = categoryColor("Mainline " + k);
      const bars = (mainByKey.get(k) || []).map(iv => barHTML(iv, xOf, range, "Mainline", col)).join("");
      html += track(`<span style="color:#cbd5e1;${lblBase}" title="Mainline ${escapeHtml(k)}">${swatch(col)}ML${escapeHtml(k)}</span>`, bars);
    }
  }
  // Manual Runs (expandable to the zones that ran by hand). Deliberately NOT tied to the Zones
  // dropdown: manual runs are zone runs, zones start unselected, so this is the only thing that puts
  // them on screen without asking the user to tick ~every zone in the log.
  if (manualRuns.length) {
    html += section("Manual Runs");
    const spans = mergeSpans(manualRuns);
    // Summary bars only — no data-runstart, so the delegated bar-click handler below ignores them and
    // the per-zone rows stay the clickable thing. The label toggles the rows.
    const bars = spans.map(s => {
      const x1 = xOf(s.start), width = Math.max(2, xOf(s.end) - x1);
      const zones = s.keys.slice().sort(numCmp);
      const title = `${zones.length} zone${zones.length > 1 ? "s" : ""} run by hand: ${zones.map(z => "Z" + z).join(", ")} — ${fmtTime(s.start, range.end - range.start)} → ${fmtTime(s.end, range.end - range.start)}`;
      return `<div class="tl-bar tl-manual-envelope" title="${escapeHtml(title)}" style="left:${x1}px;width:${width}px;"></div>`;
    }).join("");
    const lbl = `<button type="button" class="lane-label" data-manual="1" style="cursor:pointer;color:#cbd5e1;${lblBase}" title="Manual runs — started by a person, not the schedule. Click to ${expandedManual ? "hide" : "show"} the zones. Shown regardless of the Zones dropdown; hide the section with Run type → Manual.">${expandedManual ? "▾" : "▸"} MR</button>`;
    html += track(lbl, bars);
    if (expandedManual) {
      const manualByKey = byKey(manualRuns);
      for (const z of sortedKeys(manualRuns)) {
        const col = zoneColor(z);
        const zbars = (manualByKey.get(z) || []).map(iv => zoneBars(iv, xOf, range, col)).join("");
        const zlbl = `<span style="${lblBase}color:#cbd5e1;padding-left:12px;" title="Zone ${escapeHtml(z)} — manual run">↳ ${swatch(col)}Z${escapeHtml(z)}</span>`;
        html += track(zlbl, zbars, "rgba(245,158,11,0.05)");
      }
    }
  }
  // Programs (expandable to their zones)
  if (showPrograms) {
    html += section("Programs");
    // Program tags that actually correspond to a real program run somewhere in the log; a zone whose
    // PG tag is NOT here is "orphaned" and gets attributed to a program by time overlap (see zoneRunInProgram).
    // MANUAL_PROG_TAG is seeded in as a "real" tag so PG=MR zone runs — which name no program — are
    // left to the Manual Runs section instead of being adopted by whatever program they overlap.
    const realProgTags = new Set([...runIntervals("program").map(r => r.key), MANUAL_PROG_TAG]);
    const pKeys = sortedKeys(progRuns).filter(k => laneSel.program.has(k));
    if (!pKeys.length) html += `<div class="text-[10px] text-slate-500 pb-1 pl-1">No selected program runs in view.</div>`;
    for (const k of pKeys) {
      const bars = (progByKey.get(k) || []).map(iv => barHTML(iv, xOf, range, "Program")).join("");
      const expanded = expandedPrograms.has(k);
      const lbl = `<button type="button" class="lane-label" data-prog="${escapeHtml(k)}" style="cursor:pointer;color:#cbd5e1;${lblBase}" title="Click to ${expanded ? "hide" : "show"} zones in Program ${escapeHtml(k)}">${expanded ? "▾" : "▸"} P${escapeHtml(k)}</button>`;
      html += track(lbl, bars);
      if (expanded) {
        const inProg = z => zoneRunInProgram(z, k, realProgTags, progByKey.get(k) || []);
        const runKeys = sortedKeys(zoneRunsAll.filter(inProg));
        const linkedKeys = [...(programZones.get(String(k)) || [])];
        const zKeys = [...new Set([...runKeys, ...linkedKeys])].sort(numCmp);
        if (!zKeys.length) html += `<div class="text-[10px] text-slate-500 pb-1" style="padding-left:${lblW + 6}px">No zone runs recorded for this program in view.</div>`;
        for (const z of zKeys) {
          const col = zoneColor(z);
          const zbars = (zoneAllByKey.get(z) || []).filter(inProg).map(iv => zoneBars(iv, xOf, range, col)).join("");
          const zlbl = `<span class="program-zone-lane-label" data-program="${escapeHtml(k)}" data-zone="${escapeHtml(z)}" style="${lblBase}color:#cbd5e1;padding-left:12px;" title="Zone ${escapeHtml(z)} in Program ${escapeHtml(k)}">↳ ${swatch(col)}Z${escapeHtml(z)}</span>`;
          html += track(zlbl, zbars + blockerMarks(z, k), "rgba(148,163,184,0.04)");
        }
      }
    }
  }
  // Zones
  if (showZones) {
    html += section("Zones");
    const zKeys = laneAll.zone.filter(k => laneSel.zone.has(k));
    for (const k of zKeys) {
      const col = zoneColor(k);
      const runs = zoneByKey.get(k) || [];
      const title = runs.length ? `Zone ${k}` : `Zone ${k} — no runtime in this window`;
      const label = `<span class="zone-lane-label" data-zone="${escapeHtml(k)}" style="color:#cbd5e1;${lblBase}" title="${escapeHtml(title)}">${swatch(col)}Z${escapeHtml(k)}</span>`;
      html += track(label, runs.map(iv => zoneBars(iv, xOf, range, col)).join("") + blockerMarks(k));
    }
  }
  if (!groupsOn) html += `<div class="text-xs text-slate-500 py-3 pl-1">Nothing selected — pick Programs, Zones, or Mainlines from the dropdowns in the sidebar.</div>`;

  // alert markers strip (red ticks at each alert time in the window)
  let alertHTML = "";
  if ($("showAlertMarks").checked) {
    const marks = filtered.filter(e => e.isAlert && e.ts.getTime() >= range.start && e.ts.getTime() < range.end)
      .map(e => { const t = e.ts.getTime(); return `<button type="button" class="alert-mark" data-eid="${e._id}" data-tsms="${t}" title="${escapeHtml(fmtTime(t, range.end - range.start) + " — " + e.action + " (" + e.category + ")")}" style="left:${xOf(t)}px;"></button>`; }).join("");
    alertHTML = `<div id="alertStrip" style="position:relative;height:12px;margin-bottom:2px;z-index:6;">${marks}</div>`;
  }

  // vertical time gridlines aligned to the chart's x ticks, drawn over the lanes (translucent)
  lane.style.position = "relative";
  lane.innerHTML = gridLinesHTML(xScale, "rgba(226,232,240,0.16)", 4) + alertHTML + html;

  // One delegated click handler (attached once) dispatches by target, instead of re-binding a
  // listener on every jump/bar/label/mark on each render. Priority: jump (inside a bar) → label →
  // alert mark → bar body. stopPropagation on jump/bar matches the old behavior (no dropdown-close).
  if (!lane._delegated) {
    lane._delegated = true;
    lane.addEventListener("click", ev => {
      const blocker = ev.target.closest(".zone-block-mark[data-eid]");
      if (blocker) {
        ev.stopPropagation();
        revealFeedEvent(allEvents[Number(blocker.getAttribute("data-eid"))]);
        return;
      }
      const jump = ev.target.closest(".tl-jump[data-to]");
      if (jump) { ev.stopPropagation(); panToTime(Number(jump.getAttribute("data-to"))); return; }
      const label = ev.target.closest(".lane-label[data-prog]");
      if (label) {
        const p = label.getAttribute("data-prog");
        if (expandedPrograms.has(p)) expandedPrograms.delete(p); else expandedPrograms.add(p);
        refreshSwimlane(); return;
      }
      if (ev.target.closest(".lane-label[data-manual]")) { expandedManual = !expandedManual; refreshSwimlane(); return; }
      const mark = ev.target.closest(".alert-mark[data-tsms]");
      if (mark) { revealFeedEvent(allEvents[Number(mark.dataset.eid)]); return; }
      const bar = ev.target.closest(".tl-bar[data-runstart]");
      if (bar) { ev.stopPropagation();
        // scroll the audit feed to this run's raw start line and highlight it (no zoom)
        revealRunStart(findRunStartEvent(bar.getAttribute("data-group"), bar.getAttribute("data-key"), Number(bar.getAttribute("data-runstart")))); }
    });
  }
  // Mark the run a "locate on timeline" jump pointed at. Done here (post-innerHTML) so it survives this
  // function's requestAnimationFrame deferral. Both marks light up every segment of the matched run:
  // `.tl-located` is sticky (re-applied on every render from locatedRun), `.tl-hit` is the one-shot
  // arrival pulse. A jump with no run lane (a plain system/alarm event) marks its red alert tick instead.
  const pulse = pendingBarHighlight;
  pendingBarHighlight = null;
  let marked = false;
  if (locatedRun) {
    const { group, key, ts } = locatedRun;
    const bars = [...lane.querySelectorAll(".tl-bar[data-runstart]")]
      .filter(b => b.dataset.group === group && b.dataset.key === String(key));
    const hit = bars.find(b => Number(b.dataset.start) <= ts && ts < Number(b.dataset.end) + 1);
    if (hit) for (const b of bars) if (b.dataset.runstart === hit.dataset.runstart) {
      b.classList.add("tl-located");
      if (pulse) flashBar(b);
      marked = true;
    }
  }
  // Nothing to ring — either the event maps to no lane at all, or (commonly) it's an alarm that names a
  // zone/program but fired outside any of its runs, so that lane has no bar at this instant. Mark its red
  // tick instead, so an alert jump always lands on something visible.
  if (!marked && locatedTs != null) {
    const tick = lane.querySelector(`.alert-mark[data-tsms="${locatedTs}"]`);
    if (tick) tick.classList.add("alert-located");
  }
  positionPlayhead();
}

// Restart-safe amber flash on a swimlane run bar (used by "locate on timeline" jumps).
function flashBar(b) {
  b.classList.remove("tl-hit");
  void b.offsetWidth; // force reflow so re-adding the class restarts the animation
  b.classList.add("tl-hit");
  b.addEventListener("animationend", () => b.classList.remove("tl-hit"), { once: true });
}

/* ---- Interventions & Alerts timeline (discrete event markers; separate togglable section) ---- */
function renderEventTimeline(range, attempt) {
  const card = $("eventTlCard");
  card.classList.toggle("hidden", !eventTlOn);
  if (!eventTlOn) return;
  const lane = $("eventLane");
  const area = chartArea(), xScale = chartX();
  if (!area || !xScale) {
    if ((attempt || 0) < 4) requestAnimationFrame(() => renderEventTimeline(range, (attempt || 0) + 1));
    return;
  }
  const xOf = ms => clampX(ms, area, xScale);
  const span = range.end - range.start;
  const evs = filtered.filter(e => { const t = e.ts.getTime(); return t >= range.start && t < range.end && eventGroupOf(e); });

  const lblW = Math.max(40, area.left);
  const lblBase = laneLabelStyle(20, lblW);
  const swatch = c => `<span style="display:inline-block;width:8px;height:8px;transform:rotate(45deg);margin-right:5px;background:${c}"></span>`;

  let html = "";
  let total = 0;
  for (const g of EVENT_GROUPS) {
    const list = evs.filter(e => eventGroupOf(e) === g);
    if (!list.length) continue;
    total += list.length;
    const marks = list.map(e => {
      const t = e.ts.getTime();
      const title = `${fmtTime(t, span)} — ${e.action} (${e.category}) · by ${e.trigger}\n${whyText(e)}`;
      // data-eid as well as data-tsms: several events can share a timestamp, and a located jump has to
      // ring the exact one it came from.
      return `<button type="button" class="ev-mark" data-tsms="${t}" data-eid="${e._id}" title="${escapeHtml(title)}" style="left:${xOf(t)}px;background:${g.color};"></button>`;
    }).join("");
    html += `<div class="ev-track">
      <span style="color:#cbd5e1;${lblBase}" title="${escapeHtml(g.label)} (${list.length})">${swatch(g.color)}${escapeHtml(g.label)}</span>${marks}</div>`;
  }
  if (!total) html = `<div class="text-xs text-slate-500 py-3 pl-1">No interventions or alerts in this window.</div>`;

  // gridlines aligned to the chart's x ticks (match the main timeline)
  lane.innerHTML = gridLinesHTML(xScale, "rgba(226,232,240,0.10)", 1) + html;
  // Re-apply the sticky ring a feed jump left on this event's diamond, the same way renderSwimlane
  // re-applies .tl-located — so it survives pan/zoom/filter re-renders until the next jump.
  if (locatedEid != null) {
    const m = lane.querySelector(`.ev-mark[data-eid="${locatedEid}"]`);
    if (m) m.classList.add("ev-located");
  }
  if (!lane._delegated) {
    lane._delegated = true;
    lane.addEventListener("click", ev => {
      const m = ev.target.closest(".ev-mark[data-tsms]");
      if (m) revealFeedEvent(allEvents[Number(m.dataset.eid)]);
    });
  }

  // legend (only the groups present) + count
  const present = EVENT_GROUPS.filter(g => evs.some(e => eventGroupOf(e) === g));
  $("eventLegend").innerHTML = present.map(g =>
    `<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 " style="transform:rotate(45deg);background:${g.color}"></span><span class="text-slate-300">${escapeHtml(g.label)}</span></span>`).join("");
  $("eventTlInfo").textContent = total ? `— ${total.toLocaleString()} in view` : "";
}

// Scroll the PAGE to an element. Kept separate from scrollFeedTo so each jump decides explicitly
// which way the page moves — feed→timeline scrolls up, timeline→feed scrolls down.
function scrollPageTo(el, block) {
  if (!el) return;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}
// Scroll a feed row into view WITHIN the feed's own scroll box. `scrollIntoView` would walk every
// ancestor scroller (including the window) and fight the page scroll the caller just asked for.
function scrollFeedTo(row) {
  const box = $("feedScroll");
  if (!box) return;
  const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
  const top = box.scrollTop + delta - (box.clientHeight - row.offsetHeight) / 2;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}
// expand a feed row's detail, scroll it into view (inside the feed box), and flash it
function flashFeedRow(row) {
  toggleFeedDetail(row, true);
  scrollFeedTo(row);
  row.classList.add("feed-flash");
  setTimeout(() => row.classList.remove("feed-flash"), 1400);
}
// Reveal an exact event regardless of pagination, search or event filters.

function revealFeedEvent(e) {
  if (!e) return;
  clearTimeout(feedSearchTimer); feedQuery = ""; $("feedSearch").value = "";
  revealedFeedIds.add(e._id);
  lastFeedSig = null;
  renderFeed();
  scrollPageTo($("feedScroll"), "nearest");
  const row = $("auditFeed").querySelector(`.feed-row[data-eid="${e._id}"]`);
  if (row) flashFeedRow(row);
}
// Jump to a specific run's start event from the "Running now" panel. Its raw row is normally hidden
// (start/done are drawn as bars), so force-show it, bring it into the window if it's off-screen,
// then expand/flash the row.
function revealRunStart(e) {
  if (!e) return;
  const ts = e.ts.getTime(), r = currentRange();
  if (ts < r.start || ts >= r.end) panToTime(ts);
  revealFeedEvent(e);
}
// Resolve a visible run (group + key + start ms) back to its raw start event in `allEvents`.
function findRunStartEvent(group, key, startMs) {
  return allEvents.find(e => e.ts.getTime() === startMs && (
    group === "Zone" ? (e.catCode === "ZN" && (e.actCode === "WT" || e.actCode === "MR") && e.zones.includes(String(key)))
    : group === "Program" ? (e.catCode === "PG" && RUN_START.has(e.actCode) && String(e.program) === String(key))
    : group === "Mainline" ? (e.catCode === "ML" && e.actCode === "RN" && String(e.mainline) === String(key))
    : false));
}

// "Is a run bar actually drawn for this lane at this instant?" — backs eventJumpTarget, which decides
// whether a feed row gets a ↗ button at all. eventRunTarget only says which lane an event NAMES: a
// `ZN,WA` names a zone while it's queued, not watering, so there's no bar to ring. Indexed by lane and
// memoized on runGen — successful imports invalidate both runs and feed, so runs can never
// change without a feed rebuild, and renderFeed's content signature needs no extra term. Independent of
// laneSel/run-type on purpose: the bar exists whether or not its lane is shown, and ensureLaneVisible
// switches a hidden lane on when the jump lands.
let runCoverCache = null, runCoverGen = -1;
function runCovers(group, key, ts) {
  if (runCoverGen !== runGen || !runCoverCache) {
    runCoverCache = buildRunCoverIndex({
      zone: runIntervals("zone"), program: runIntervals("program"), mainline: runIntervals("mainline"),
    });
    runCoverGen = runGen;
  }
  return runCoversAt(runCoverCache, group, key, ts);
}

// A jump can target a lane the user has hidden (zones start as "None"), which would leave nothing to
// highlight. Tick that lane on so the run is actually drawn. visRunsKey hashes the lane sets, so the
// visibleRunsAt memo invalidates itself.
function ensureLaneVisible(target) {
  if (!target) return;
  const g = target.group.toLowerCase(), key = String(target.key);
  if (!laneAll[g] || !laneAll[g].includes(key) || laneSel[g].has(key)) return;
  laneSel[g].add(key);
  const cb = document.querySelector(`#dd${ddCap(g)}List .ddItem[value="${CSS.escape(key)}"]`);
  if (cb) cb.checked = true;
  updateLaneButtons();
}

// "Locate on the timeline": drop the scrubber playhead exactly on `ts`, center the view if it's
// off-screen, scroll the page to whichever timeline draws this event, mark the matching run bar
// (`target = {group,key}` or null — a plain system/alarm event marks its red tick instead), and — when a
// `feedEvent` is given — reveal + flash its raw feed row too. Shared by the feed ↗ button and the At
// Playhead panel. `srcEvent` (optional) is the event being located; it decides the routing below.
function locateOnTimeline(ts, target, feedEvent, srcEvent) {
  const jump = srcEvent ? eventJumpTarget(srcEvent, runCovers) : null;
  if (!playheadOn) setScrubber(true);              // ensure the playhead is visible
  playheadTime = ts;                               // set AFTER setScrubber so it isn't clamped away
  ensureLaneVisible(target);
  // Turn on whatever draws the mark we're about to make, for the same reason ensureLaneVisible exists:
  // a jump that lands on a hidden marker highlights nothing, which is the bug this all fixes.
  if (jump && jump.dest === "events" && !eventTlOn) { eventTlOn = true; $("eventTlOn").checked = true; }
  if (jump && jump.tick && !jump.bar && !$("showAlertMarks").checked) $("showAlertMarks").checked = true;
  pendingBarHighlight = target ? { group: target.group, key: String(target.key), ts } : null;
  locatedRun = pendingBarHighlight;                // sticky ring; survives re-render until the next jump
  locatedTs = ts;
  locatedEid = jump && jump.diamond ? srcEvent._id : null; // sticky ring on the event-timeline diamond
  if (feedEvent) {
    clearTimeout(feedSearchTimer); feedQuery = ""; $("feedSearch").value = "";
    revealedFeedIds.add(feedEvent._id); lastFeedSig = null;
  }
  const r = currentRange();
  if (ts < r.start || ts >= r.end) panToTime(ts);  // off-screen → center (re-renders: highlight + playhead apply)
  else render();                                   // in view → re-render so the highlight + playhead apply
  // Land on the timeline this event belongs to. An events-routed jump still rings its run bar (if any)
  // on the main card above, so scrolling up shows the run the intervention acted on.
  scrollPageTo(jump && jump.dest === "events" ? $("eventTlCard") : $("timelineCard"), "start");
  if (feedEvent) { const row = $("auditFeed").querySelector(`.feed-row[data-eid="${feedEvent._id}"]`); if (row) flashFeedRow(row); }
}

/* ---- Scrubber playhead + right-edge "what's running" panel ---- */
let playheadOn = false, playheadSnap = true, playheadTime = null;
// The playhead line moves instantly on every pointermove, but the heavy panel rebuild
// (event scans + run cloning) is coalesced to one per animation frame while dragging.
let scrubPanelRaf = null;
function scheduleScrubPanel() {
  if (scrubPanelRaf) return;
  scrubPanelRaf = requestAnimationFrame(() => { scrubPanelRaf = null; updateScrubPanel(); });
}

// run intervals for the currently-visible groups (same gating as renderSwimlane), with a group tag
let visRunsCache = null, visRunsKey = null; // memo for visibleRunsAt (invalidated by runGen + lane/type)
function visibleRunsAt() {
  const showScheduled = $("showScheduled").checked;
  const showManual = $("showManual").checked;
  // Called per pointermove (snapTime) and per scrubber-panel frame — memoize the (spread-heavy) build.
  // Invalidate when the run cache is rebuilt (runGen, bumped in onDataLoaded on import) or lane/run-type changes.
  const range = currentRange();
  const key = JSON.stringify([runGen, showScheduled, showManual, [...laneSel.program],
    [...laneSel.zone], [...laneSel.mainline], [...expandedPrograms], range.start, range.end]);
  if (visRunsCache && visRunsKey === key) return visRunsCache;
  const out = selectVisibleRuns(
    { program: runIntervals("program"), zone: runIntervals("zone"), mainline: runIntervals("mainline") },
    laneSel, { showScheduled, showManual },
    (group, k) => (group === "Zone" ? zoneColor(k) : categoryColor(group + " " + k)),
    { expandedPrograms, range },
  );
  visRunsCache = out; visRunsKey = key;
  return out;
}

// nearest run start/end edge within ~8px, for snapping
function snapTime(t) {
  if (!playheadSnap) return t;
  const xScale = chartX();
  if (!xScale) return t;
  return snapToEdges(t, visibleRunsAt(), ms => xScale.getPixelForValue(ms));
}

function setPlayhead(t) { playheadTime = t; positionPlayhead(); }

function positionPlayhead() {
  const el = $("playhead");
  const panel = $("scrubPanel");
  const xScale = chartX();
  if (!playheadOn || playheadTime == null || !xScale) { el.style.display = "none"; panel.classList.add("hidden"); positionMiniPlayhead(); return; }
  const r = currentRange();
  el.setAttribute("aria-valuemin", String(r.start)); el.setAttribute("aria-valuemax", String(r.end));
  playheadTime = Math.max(r.start, Math.min(r.end, playheadTime)); // clamp into view
  el.setAttribute("aria-valuenow", String(playheadTime)); el.setAttribute("aria-valuetext", fmtTimeDate(playheadTime, 0));
  el.style.left = xScale.getPixelForValue(playheadTime) + "px";
  el.style.display = "block";
  $("playheadTime").textContent = fmtTimeDate(playheadTime, 0); // exact date + time incl. seconds
  panel.classList.remove("hidden");
  positionMiniPlayhead(); // mirror the (clamped, in-window) playhead onto the overview minimap
  // throttle the expensive panel rebuild during an active drag; update immediately otherwise
  if (scrubbing) scheduleScrubPanel(); else updateScrubPanel();
}

function updateScrubPanel() {
  if (playheadTime == null) return;
  const t = playheadTime, r = currentRange(), span = r.end - r.start;
  // The end bound is INCLUSIVE so a run whose last instant is exactly under the playhead still lists,
  // tagged "· over", instead of vanishing. Snap (on by default) lands you precisely on a run edge, so
  // parking on a run's end used to drop it from the panel while its bar sat right under the playhead.
  // An ongoing run's `end` is globalEnd — a placeholder, not a real ending — so it is never "over".
  const isOver = iv => !iv.ongoing && t >= iv.end;
  const active = visibleRunsAt().filter(iv => iv.start <= t && t <= iv.end)
    .sort((a, b) => a.group.localeCompare(b.group) || numCmp(a.key, b.key));
  const runningCount = active.filter(iv => !isOver(iv)).length; // an ended run isn't "running now"
  const dot = (c, dim) => `<span style="display:inline-block;width:9px;height:9px;margin-right:6px;background:${c};${dim ? "opacity:.45;" : ""}"></span>`;
  let runHTML = active.length
    ? active.map(iv => {
        const over = isOver(iv);
        // is the playhead inside a soak gap of this run? (then it's mid-cycle, not actively watering)
        const soaking = soakSplit && iv.segments && !!(iv.segments.find(s => s.s <= t && t < s.e) || {}).soak;
        // How it started and how it ended are independent facts, so compose the tags rather than
        // letting one win: a hand-started run killed by an alarm is "· stopped early · manual", and
        // used to read as merely stopped early. (barHTML already composes these on the bar itself.)
        const tags = [], whys = [];
        if (over) { tags.push(" · over"); whys.push("This run ends exactly here — the playhead is on its last instant. "); }
        if (soaking) { tags.push(" · soaking"); whys.push("Between watering cycles (soaking — valve off). "); }
        if (iv.kind === "run-terminated") { tags.push(" · stopped early"); whys.push("Ended early on a pause/disable/alarm. "); }
        if (iv.manual) { tags.push(" · manual"); whys.push("Started by a person, not the schedule. "); }
        const tag = tags.join(""), tagWhy = whys.join("");
        // "x into y run" reads wrong once the run is done — state the length it ran instead.
        const progress = over ? `ran ${fmtDuration(iv.end - iv.start)}` : `${fmtDuration(t - iv.start)} into ${fmtDuration(iv.end - iv.start)} run`;
        const rowTitle = `${tagWhy}Click to move the scrubber to this run's start, flash its bar, and open it in the audit feed.`;
        return `<div role="button" tabindex="0" class="scrub-run cursor-pointer hover:bg-slate-800 px-1" data-group="${iv.group}" data-key="${escapeHtml(String(iv.key))}" data-start="${iv.start}" title="${escapeHtml(rowTitle)}">
        <div class="flex items-baseline gap-1 py-0.5">${dot(iv.color, soaking || over)}<span class="${over ? "text-slate-400" : "text-slate-200"}">${iv.group} ${escapeHtml(iv.key)}</span>
        <span class="text-slate-500 text-xs ml-auto">${escapeHtml(fmtTime(iv.start, span))}→${iv.ongoing ? "…" : escapeHtml(fmtTime(iv.end, span))}</span></div>
        <div class="text-[10px] ${soaking ? "text-sky-400" : "text-slate-500"} pl-4 pb-1">${progress}${tag}</div></div>`;
      }).join("")
    : `<div class="text-slate-500 text-xs">Nothing running.</div>`;

  // flow/pressure carry-forward (latest known sample at/before t, independent of zoom)
  let flowHTML = "";
  if (hasHydro) {
    let ac = null, ex = null, pr = null, at = null;
    // telemetry is the chronological AC/EX/PR-only subset (hundreds of rows), so we can stop once past t.
    for (const e of telemetry) { const et = e.ts.getTime(); if (et > t) break;
      const a = telemetryValue(e, "AC"), x = telemetryValue(e, "EX"), p = telemetryValue(e, "PR");
      if (a != null) ac = a; if (x != null) ex = x; if (p != null) pr = p;
      if (a != null || x != null || p != null) at = et; }
    if (ac != null || ex != null || pr != null) {
      const row = (lbl, v, u) => v == null ? "" : `<div class="flex justify-between"><span class="text-slate-400">${lbl}</span><span class="text-slate-200">${v.toFixed(1)} ${u}</span></div>`;
      flowHTML = `<div><div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Flow</div>
        ${row("Actual", ac, "L/min")}${row("Expected", ex, "L/min")}${row("Pressure", pr, "kPa")}
        <div class="text-[10px] text-slate-500 mt-0.5">as of ${at ? escapeHtml(fmtTimeDate(at, span)) : "—"}</div></div>`;
    }
  }

  // alerts within tolerance of the playhead
  const tol = Math.max(1000, span / 300);
  const near = filtered.filter(e => e.isAlert && Math.abs(e.ts.getTime() - t) <= tol)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime()).slice(0, 12);
  const alertHTML = near.length
    ? `<div><div class="text-xs font-semibold uppercase tracking-wider text-rose-400 mb-1">Alerts here (${near.length})</div>` +
      near.map(e => {
        const where = e.zones.length ? `Zone ${e.zones.join(", ")}` : (e.program != null ? `Program ${e.program}` : (e.mainline != null ? `Mainline ${e.mainline}` : ""));
        const detail = [where, whyText(e)].filter(Boolean).join(" — "); // what had the error + what the error was
        return `<div role="button" tabindex="0" class="scrub-alert py-1 cursor-pointer hover:bg-slate-800 px-1" data-tsms="${e.ts.getTime()}" data-eid="${e._id}" title="Alarm/error near the playhead. Click to move the scrubber here, flash its bar, and open it in the audit feed.">
        <div class="flex items-baseline gap-1">
          <span class="text-rose-300 text-xs">${escapeHtml(e.action)}</span><span class="text-slate-500 text-[10px]">${escapeHtml(e.category)}</span>
          <span class="text-slate-500 text-[10px] ml-auto">${escapeHtml(fmtTime(e.ts.getTime(), span))}</span>
        </div>
        <div class="text-[11px] text-slate-300 leading-snug">${escapeHtml(detail)}</div></div>`;
      }).join("") + `</div>`
    : "";

  $("scrubBody").innerHTML =
    `<div class="text-lg font-bold text-amber-300">${escapeHtml(fmtTime(t, span))}</div>` +
    `<div><div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Running now (${runningCount})</div>${runHTML}</div>` +
    flowHTML + alertHTML;

  const body = $("scrubBody");
  if (!body._delegated) {
    body._delegated = true;
    body.addEventListener("click", ev => {
      const run = ev.target.closest(".scrub-run[data-start]");
      if (run) {
        const g = run.getAttribute("data-group"), k = run.getAttribute("data-key"), s = Number(run.getAttribute("data-start"));
        const e = findRunStartEvent(g, k, s);
        // move the playhead to the run's start, flash its bar, and reveal its raw feed row
        locateOnTimeline(e ? e.ts.getTime() : s, { group: g, key: k }, e, e);
        return;
      }
      const a = ev.target.closest(".scrub-alert[data-eid]");
      if (a) { const e = allEvents[Number(a.getAttribute("data-eid"))]; if (e) locateOnTimeline(e.ts.getTime(), eventRunTarget(e), e, e); }
    });
  }
}

/* ---- Component C: Activity Audit feed (instantaneous events) ---- */

// Spell out where a row's ↗ actually goes and what it will mark there — the button used to promise a
// timeline jump on every row, including the ~72% that had nothing to land on.
function feedRowHTML(e) {
  const sev = feedSeverity(e), subj = subjectSummary(e), ts = e.ts.getTime();
  const sevCls = sev === "crit" ? "feed-crit" : sev === "warn" ? "feed-warn" : sev === "audit" ? "feed-audit" : "";
  const jump = eventJumpTarget(e, runCovers);
  const jumpHTML = !jump ? '<span style="width:80px"></span>'
    : `<button class="feed-jump text-sky-400 hover:text-sky-200 text-xs whitespace-nowrap text-right" style="width:80px" data-tsms="${ts}" title="${escapeHtml(jumpTitle(jump, ts))}">↗ ${jump.dest === "events" ? "events" : "timeline"}</button>`;
  return `<div class="feed-row ${sevCls} ${e.isAlert ? "feed-pinned" : ""} px-4 py-2 flex flex-wrap items-baseline gap-x-3" data-idx="${e._id}" data-eid="${e._id}" data-tsms="${ts}">
      <button class="feed-expand text-left text-slate-400 text-xs whitespace-nowrap" style="width:130px" aria-expanded="false" aria-controls="feed-detail-${e._id}" title="Expand event details">${escapeHtml(e.tsRaw.replace(/\s*[+-]\d{4}\s*$/, ""))}</button>
      <span class="text-slate-200 text-sm" style="width:88px">${escapeHtml(e.action)}</span>
      <span class="text-slate-500 text-xs" style="width:72px">${escapeHtml(e.category)}</span>
      <span class="text-sky-200 text-xs" style="flex:1 1 140px;min-width:120px">${subj.html}</span>
      <span class="text-slate-500 text-xs truncate" style="width:96px" title="${escapeHtml(`${e.trgCode || "?"} = ${e.trigger}`)}">by ${escapeHtml(e.trigger)}</span>
      ${jumpHTML}
    </div>
    <div id="feed-detail-${e._id}" class="hidden px-4 py-3 text-xs leading-relaxed flex flex-wrap" style="background:#0b1220" data-fdetail="${e._id}"></div>`;
}
function toggleFeedDetail(row, open) {
  const detail = row.nextElementSibling;
  if (!detail || !detail.hasAttribute("data-fdetail")) return;
  if (open === undefined) open = detail.classList.contains("hidden");
  if (open && !detail.dataset.loaded) {
    detail.innerHTML = detailHTML(allEvents[Number(row.dataset.eid)]);
    detail.dataset.loaded = "true";
  }
  detail.classList.toggle("hidden", !open);
  row.querySelector(".feed-expand").setAttribute("aria-expanded", String(open));
}
function renderFeed() {
  const host = $("auditFeed"), searching = !!feedQuery;
  const sig = JSON.stringify([feedQuery, feedSortCol, feedSortDir, filtered.length, [...revealedFeedIds]]);
  const reset = lastFeedSig !== sig || feedLimit < feedPrefix;
  if (!reset && feedPrefix === Math.min(feedLimit, feedOrdered.length)) return;
  if (reset) {
    const source = [...filtered], ids = new Set(source.map(e => e._id));
    for (const id of revealedFeedIds) if (!ids.has(id) && allEvents[id]) source.push(allEvents[id]);
    feedOrdered = selectFeedRows(source, { query: feedQuery, sortCol: feedSortCol, sortDir: feedSortDir, revealedIds: revealedFeedIds });
    feedAlertCount = feedOrdered.reduce((n, e) => n + Number(e.isAlert), 0);
    feedPrefix = 0; feedRenderedIds.clear(); host.replaceChildren();
    lastFeedSig = sig;
  }
  host.querySelector(".feed-more")?.remove();
  const append = e => {
    if (!feedRenderedIds.has(e._id)) {
      host.insertAdjacentHTML("beforeend", feedRowHTML(e));
      feedRenderedIds.add(e._id);
    } else {
      const row = host.querySelector(`.feed-row[data-eid="${e._id}"]`);
      const detail = row.nextElementSibling;
      host.append(row, detail);
    }
  };
  for (const e of feedOrdered.slice(feedPrefix, feedLimit)) append(e);
  feedPrefix = Math.min(feedLimit, feedOrdered.length);
  for (const e of feedOrdered.slice(feedPrefix)) if (revealedFeedIds.has(e._id)) append(e);
  const total = feedOrdered.length, remaining = total - feedRenderedIds.size;
  if (remaining) {
    host.insertAdjacentHTML("beforeend", `<div class="feed-more px-4 py-3 text-center border-t border-slate-800"><button type="button" class="feed-load-more bg-slate-800 border border-slate-700 text-sky-300 text-xs px-4 py-2">Load ${Math.min(FEED_CAP, remaining).toLocaleString()} more (${remaining.toLocaleString()} remaining)</button></div>`);
  } else if (!total) {
    host.innerHTML = `<div class="px-5 py-8 text-center text-slate-500 text-sm">${searching ? "No events match your search." : "No events match the current filters."}</div>`;
  }
  if (!host._delegated) {
    host._delegated = true;
    host.addEventListener("click", ev => {
      if (ev.target.closest(".feed-load-more")) {
        const top = $("feedScroll").scrollTop;
        feedLimit += FEED_CAP; renderFeed(); $("feedScroll").scrollTop = top;
        return;
      }
      const row = ev.target.closest(".feed-row");
      if (!row) return;
      if (ev.target.closest(".feed-jump")) {
        ev.stopPropagation();
        const e = allEvents[Number(row.dataset.eid)];
        locateOnTimeline(e.ts.getTime(), eventRunTarget(e), null, e);
      } else toggleFeedDetail(row);
    });
  }
  updateFeedHead();
  const noun = searching ? `match${total === 1 ? "" : "es"}` : `event${total === 1 ? "" : "s"}`;
  $("feedInfo").textContent = total
    ? `Showing ${feedRenderedIds.size.toLocaleString()} of ${total.toLocaleString()} ${noun}${feedAlertCount ? ` · ${feedAlertCount} alerts` : ""}`
    : searching ? "0 matches across all events" : "0 events";
}
// Reflect the active sort column/direction on the clickable header (arrow + highlight).
function updateFeedHead() {
  const head = $("feedHead");
  if (!head) return;
  head.querySelectorAll(".feed-sort").forEach(btn => {
    const active = btn.getAttribute("data-col") === feedSortCol;
    btn.classList.toggle("feed-sort-active", active);
    const arrow = btn.querySelector(".sort-arrow");
    if (arrow) arrow.textContent = active ? (feedSortDir === "desc" ? " ▼" : " ▲") : "";
  });
}
// Recompute just the feed (search/sort changes don't need the chart/swimlane rebuilt).
function refreshFeed() {
  if (allEvents.length) renderFeed();
}

/* ============================ Filter event wiring ============================ */
const FILTER_SELECTS = ["categoryFilter","actionFilter","triggerFilter","substationFilter","alertsOnly","humanAudit","showAdvanced"];
FILTER_SELECTS.forEach(id =>
  $(id).addEventListener("change", applyFilters));
// editing a date picker becomes the view window — drop any zoom so the typed range takes effect
["dateFrom","dateTo"].forEach(id => $(id).addEventListener("change", () => {
  zoomRange = null; windowUnit = "custom"; render();
}));
const flowSlider = $("flowSlider");
flowSlider.addEventListener("input", () => {
  $("flowValue").textContent = parseFloat(flowSlider.value).toFixed(1);
});
flowSlider.addEventListener("change", applyFilters);

// Audit-feed search box — filters across the whole log; feed-only refresh (no chart/swimlane rebuild).
// Debounced so a fast typist doesn't re-run the whole-log filter on every keystroke.
let feedSearchTimer = null;
$("feedSearch").addEventListener("input", e => {
  const v = e.target.value.trim();
  clearTimeout(feedSearchTimer);
  feedSearchTimer = setTimeout(() => {
    feedQuery = v;
    feedLimit = FEED_CAP;
    refreshFeed();
  }, 150);
});
// Clickable column headers cycle asc → desc → off (back to the pinned-alarms default); a new column
// starts ascending.
$("feedHead").addEventListener("click", e => {
  const btn = e.target.closest(".feed-sort[data-col]");
  if (!btn) return;
  const col = btn.getAttribute("data-col");
  if (feedSortCol !== col) { feedSortCol = col; feedSortDir = "asc"; }
  else if (feedSortDir === "asc") feedSortDir = "desc";
  else { feedSortCol = null; feedSortDir = "asc"; }
  feedLimit = FEED_CAP;
  refreshFeed();
});

$("resetBtn").addEventListener("click", () => {
  if (!allEvents.length) return;
  ["categoryFilter","actionFilter","triggerFilter","substationFilter"]
    .forEach(id => $(id).value = "");
  // lane dropdowns back to defaults: programs & mainlines all, zones none
  laneSel.program = new Set(laneAll.program); laneSel.zone = new Set(); laneSel.mainline = new Set(laneAll.mainline);
  ["program","zone","mainline"].forEach(g => {
    document.querySelectorAll("#dd" + ddCap(g) + "List .ddItem").forEach(c => c.checked = laneSel[g].has(c.value));
  });
  updateLaneButtons();
  $("alertsOnly").checked = false;
  $("humanAudit").checked = false;
  $("showAdvanced").checked = false; // back to focused (non-advanced) default
  flowSlider.value = 0;
  $("flowValue").textContent = "0";
  $("varMin").value = 0; $("varMinVal").textContent = "0%";
  $("varMax").value = 100; $("varMaxVal").textContent = "Any";
  expandedPrograms.clear(); expandedManual = true;
  clearTimeout(feedSearchTimer); revealedFeedIds.clear();
  // clear the audit-feed search box + column sort back to the pinned-alarms default
  feedQuery = ""; feedSortCol = null; feedSortDir = "asc"; $("feedSearch").value = "";
  locatedRun = null; locatedTs = null; locatedEid = null; // drop the sticky "located on timeline" highlights
  // back to the default: the calendar day containing the last event
  windowUnit = "day"; zoomRange = snapWindow("day", dataMaxT);
  applyFilters();
});

/* ============================ Window presets + zoom/navigation ============================ */
$("windowPresets").addEventListener("click", e => {
  const b = e.target.closest("button[data-win]");
  if (!b || !allEvents.length) return;
  setWindowUnitCentered(b.getAttribute("data-win")); // center the new window on the scrubber
});

$("navPrev").addEventListener("click", () => navShift(-1));
$("navNext").addEventListener("click", () => navShift(1));
// keyboard arrows step the window by its own width (ignored when typing in a field)
document.addEventListener("keydown", e => {
  if (!allEvents.length) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.defaultPrevented || e.target.closest("#playhead, #miniMap") || document.querySelector("dialog[open]")) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); navShift(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); navShift(1); }
});

/* ============================ Timeline display toggles + variance sliders ============================ */
// run-type / alert-marker checkboxes only change the view, not `filtered` → just re-render
["showScheduled","showManual","showAlertMarks"].forEach(id =>
  $(id).addEventListener("change", render));

// lane checklist dropdowns (Programs / Zones / Mainlines)
function closeLaneDropdowns() {
  document.querySelectorAll(".ml-dd").forEach(dd => {
    dd.querySelector(".ml-dd-panel").classList.add("hidden");
    dd.querySelector(".ml-dd-btn").setAttribute("aria-expanded", "false");
  });
}
document.querySelectorAll(".ml-dd").forEach(dd => {
  const group = dd.getAttribute("data-group");
  const panel = dd.querySelector(".ml-dd-panel");
  const button = dd.querySelector(".ml-dd-btn");
  button.setAttribute("aria-controls", panel.id);
  button.setAttribute("aria-expanded", "false");
  dd.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeLaneDropdowns(); button.focus(); e.stopPropagation(); }
  });
  // open/close (toggle this panel, close others)
  button.addEventListener("click", e => {
    e.stopPropagation();
    const wasHidden = panel.classList.contains("hidden");
    closeLaneDropdowns();
    if (wasHidden) { panel.classList.remove("hidden"); button.setAttribute("aria-expanded", "true"); }
  });
  // "All" master toggles every item in this group
  panel.querySelector(".ddAll").addEventListener("change", e => {
    const on = e.target.checked;
    laneSel[group] = new Set(on ? laneAll[group] : []);
    panel.querySelectorAll(".ddItem").forEach(c => c.checked = on);
    updateLaneButtons(); render();
  });
  // individual item toggles
  panel.querySelector(".ml-dd-list").addEventListener("change", e => {
    if (!e.target.classList.contains("ddItem")) return;
    if (e.target.checked) laneSel[group].add(e.target.value); else laneSel[group].delete(e.target.value);
    updateLaneButtons(); render();
  });
});
// click outside any dropdown closes open panels
document.addEventListener("click", e => {
  if (!e.target.closest(".ml-dd")) closeLaneDropdowns();
});

/* ---- Scrubber wiring ---- */
const timeWrap = $("timeWrap");
function timeAtClientX(clientX) {
  const xScale = chartX();
  if (!xScale) return null;
  const rect = $("hydroChart").getBoundingClientRect();
  const r = currentRange();
  return Math.max(r.start, Math.min(r.end, xScale.getValueForPixel(clientX - rect.left)));
}
function setScrubber(on) {
  playheadOn = on;
  $("scrubberOn").checked = on;
  timeWrap.classList.toggle("scrub-on", on);
  $("appRoot").classList.toggle("scrub-open", on); // reserve drawer space
  $("scrubPanel").classList.toggle("hidden", !on);
  if (on && playheadTime == null) { const r = currentRange(); playheadTime = (r.start + r.end) / 2; }
  // toggling the drawer changes the available width → rebuild the chart so it measures the new size
  // synchronously and the swimlane bars align to the visible area (not the old, wider canvas).
  // The minimap canvas is width-fitted too, so refit its density histogram at the new width.
  hydroDirty = true;
  miniDensityDirty = true;
  if (allEvents.length) render(); else positionPlayhead();
}
$("scrubberOn").addEventListener("change", e => setScrubber(e.target.checked));
$("scrubberSnap").addEventListener("change", e => { playheadSnap = e.target.checked; });
$("scrubClose").addEventListener("click", () => setScrubber(false));
// Flow overlay toggle — changes the chart contents/height, so rebuild it
$("flowOn").addEventListener("change", e => { flowOn = e.target.checked; hydroDirty = true; if (allEvents.length) render(); });
// Interventions & Alerts timeline toggle — view-only, just re-render
$("eventTlOn").addEventListener("change", e => { eventTlOn = e.target.checked; if (allEvents.length) render(); else $("eventTlCard").classList.toggle("hidden", !eventTlOn); });
// Soak split toggle — view-only (segments are already on the runs), just re-render the swimlane
$("soakSplitOn").addEventListener("change", e => { soakSplit = e.target.checked; if (allEvents.length) render(); });
let scrubbing = false;
timeWrap.addEventListener("pointerdown", e => {
  if (!playheadOn) return;
  if (e.target.closest(".tl-bar, .alert-mark, .lane-label, .zone-block-mark")) return; // let timeline controls handle clicks
  e.preventDefault(); // don't start a text selection while dragging the playhead
  scrubbing = true; timeWrap.setPointerCapture(e.pointerId);
  const t = timeAtClientX(e.clientX); if (t != null) setPlayhead(snapTime(t));
});
timeWrap.addEventListener("pointermove", e => {
  if (!scrubbing) return;
  const t = timeAtClientX(e.clientX); if (t != null) setPlayhead(snapTime(t));
});
function endScrub(e) {
  scrubbing = false;
  // commit a final, non-throttled panel update so it matches the resting playhead exactly
  if (scrubPanelRaf) { cancelAnimationFrame(scrubPanelRaf); scrubPanelRaf = null; }
  if (playheadOn && playheadTime != null) updateScrubPanel();
  try { timeWrap.releasePointerCapture(e.pointerId); } catch (_) {}
}
timeWrap.addEventListener("pointerup", endScrub);
timeWrap.addEventListener("pointercancel", endScrub);

/* ---- Overview minimap (full span + draggable view window) ---- */
const miniMap = $("miniMap");
const miniWindow = $("miniWindow");
const miniCanvas = $("miniCanvas");
const miniPlayhead = $("miniPlayhead");
const miniFull = () => ({ s: dataMinT, e: dataMaxT + 1 });
const miniW = () => miniMap.clientWidth || 1;
function miniX2T(px) { return pxToTime(px, miniW(), miniFull()); }
function miniT2X(t) { return timeToPx(t, miniW(), miniFull()); }

// set the view to [start,end] (clamped to the full span, min 1s) — a custom, non-aligned window
function setViewRange(start, end) {
  const { s, e } = clampView(start, end, miniFull());
  windowUnit = "custom"; zoomRange = { start: s, end: e };
  render();
}

// during drag: move the box instantly (cheap) but coalesce the heavy full re-render to one/frame
let viewRaf = null, pendingView = null;
function setViewRangeLive(start, end) {
  const { s, e } = clampView(start, end, miniFull());
  pendingView = { s, e };
  layoutMiniWindow(s, e); // instant visual feedback without a full render
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => {
    viewRaf = null;
    if (!pendingView) return;
    windowUnit = "custom";
    zoomRange = { start: pendingView.s, end: pendingView.e };
    pendingView = null;
    renderViewLive(zoomRange); // cheap view-only update; the feed rebuilds on release
  });
}

// Lightweight render used only during a live minimap drag: updates everything EXCEPT the heavy feed list,
// reusing the chart (scale move, no recreate) so frames stay cheap. endMiniDrag() commits a full render().
function renderViewLive(range) {
  syncDateInputs(range);
  const inWin = filtered.filter(e => { const t = e.ts.getTime(); return t >= range.start && t < range.end; });
  renderStat(range, inWin);
  renderHydro(range);        // reuses the chart (scale move) unless data changed; also realigns the swimlane
  renderEventTimeline(range);
  updateNavControls(range);
  positionMiniWindow(range); // box only, no density redraw
}

// Density background + alert ticks — depends only on `filtered`, so redraw only on data/filter changes.
function drawMiniDensity() {
  if (!allEvents.length) return;
  miniDensityDirty = false;
  const W = miniMap.clientWidth || 1, H = 44, f = miniFull(), span = f.e - f.s;
  const dpr = window.devicePixelRatio || 1;
  miniCanvas.width = W * dpr; miniCanvas.height = H * dpr;
  miniCanvas.style.width = W + "px"; miniCanvas.style.height = H + "px";
  const ctx = miniCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const bins = new Array(W).fill(0); const alertX = [];
  for (const ev of filtered) {
    const t = ev.ts.getTime();
    const x = Math.floor((t - f.s) / span * W);
    if (x >= 0 && x < W) bins[x]++;
    if (ev.isAlert) alertX.push((t - f.s) / span * W);
  }
  const max = bins.reduce((m, n) => n > m ? n : m, 0) || 1;
  ctx.fillStyle = "rgba(148,163,184,0.45)";
  for (let x = 0; x < W; x++) { if (!bins[x]) continue; const h = Math.max(1, (bins[x] / max) * (H - 6)); ctx.fillRect(x, H - h, 1, h); }
  ctx.fillStyle = "rgba(239,68,68,0.9)";
  for (const x of alertX) ctx.fillRect(x, 0, 1, 6);
}

// Mirror the main scrubber playhead onto the full-span minimap (amber marker inside the view-window box),
// clamped so the 2px line isn't clipped by the minimap's overflow:hidden at the extremes.
function positionMiniPlayhead() {
  if (!miniPlayhead) return;
  if (!playheadOn || playheadTime == null || !allEvents.length) { miniPlayhead.style.display = "none"; return; }
  const W = miniMap.clientWidth || 1;
  miniPlayhead.style.left = Math.max(0, Math.min(miniT2X(playheadTime), W - 2)) + "px";
  miniPlayhead.style.display = "block";
}

// Lay out the view-window box, clamping it fully inside the track so its border + edge handles are never
// cut off by the minimap's overflow:hidden at the extremes (and a min-width box near an end stays visible).
function layoutMiniWindow(startT, endT) {
  const W = miniMap.clientWidth || 1;
  let left = miniT2X(startT);
  const width = Math.max(6, miniT2X(endT) - left);
  left = Math.max(0, Math.min(left, W - width));
  miniWindow.style.left = left + "px";
  miniWindow.style.width = width + "px";
}

// Position the view-window box + edge labels — cheap, called on every view change (incl. live drag).
function positionMiniWindow(range) {
  if (!allEvents.length) return;
  const f = miniFull(), span = f.e - f.s;
  layoutMiniWindow(range.start, range.end);
  $("miniStart").textContent = fmtTime(f.s, span);
  $("miniEnd").textContent = fmtTime(f.e, span);
}

function renderMiniMap(range) {
  if (miniDensityDirty) drawMiniDensity(); // histogram depends only on `filtered`; skip on view-only moves
  positionMiniWindow(range);
}

let miniDrag = null; // { mode:'pan'|'L'|'R', startX, range }
miniMap.addEventListener("pointerdown", e => {
  if (!allEvents.length) return;
  const handle = e.target.closest(".mini-handle");
  const onBox = e.target === miniWindow || e.target.closest("#miniWindow");
  const r = currentRange();
  if (handle) miniDrag = { mode: handle.getAttribute("data-edge"), range: r };
  else if (onBox) { miniDrag = { mode: "pan", startX: e.clientX, range: r }; miniWindow.classList.add("dragging"); }
  else { // click on empty track → center current-width window at the clicked time
    const w = r.end - r.start, c = miniX2T(e.clientX - miniMap.getBoundingClientRect().left), f = miniFull();
    const s = Math.max(f.s, Math.min(c - w / 2, f.e - w)); // clamp start, not each end, so width holds
    setViewRange(s, s + w); return;
  }
  miniMap.setPointerCapture(e.pointerId);
  e.preventDefault();
});
miniMap.addEventListener("pointermove", e => {
  if (!miniDrag) return;
  const rect = miniMap.getBoundingClientRect();
  if (miniDrag.mode === "pan") {
    const dt = miniX2T(e.clientX) - miniX2T(miniDrag.startX); // both in page px; difference cancels offset
    const w = miniDrag.range.end - miniDrag.range.start;
    let s = miniDrag.range.start + dt;
    const f = miniFull();
    s = Math.max(f.s, Math.min(s, f.e - w));
    setViewRangeLive(s, s + w);
  } else {
    const t = miniX2T(e.clientX - rect.left);
    if (miniDrag.mode === "L") setViewRangeLive(t, miniDrag.range.end);
    else setViewRangeLive(miniDrag.range.start, t);
  }
});
function endMiniDrag(e) {
  if (!miniDrag) return;
  miniDrag = null; miniWindow.classList.remove("dragging");
  // commit any frame still pending so the final view matches the box exactly
  if (viewRaf) { cancelAnimationFrame(viewRaf); viewRaf = null; }
  if (pendingView) { setViewRange(pendingView.s, pendingView.e); pendingView = null; }
  try { miniMap.releasePointerCapture(e.pointerId); } catch (_) {}
}
miniMap.addEventListener("pointerup", endMiniDrag);
miniMap.addEventListener("pointercancel", endMiniDrag);


document.addEventListener("keydown", e => {
  const button = e.target.closest('[role="button"]');
  if (button && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault(); e.stopPropagation(); button.click();
  }
});
$("playhead").addEventListener("keydown", e => {
  if (!playheadOn) return;
  const r = currentRange(), step = Math.max(1000, (r.end - r.start) / 100);
  const deltas = { ArrowLeft: -step, ArrowRight: step, PageUp: step * 10, PageDown: -step * 10 };
  let t = e.key === "Home" ? r.start : e.key === "End" ? r.end
    : Object.hasOwn(deltas, e.key) ? playheadTime + deltas[e.key] : null;
  if (t == null) return;
  e.preventDefault(); e.stopPropagation(); setPlayhead(snapTime(t));
});
miniMap.addEventListener("keydown", e => {
  if (!allEvents.length) return;
  const r = currentRange(), width = r.end - r.start, center = (r.start + r.end) / 2;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const delta = width / 10 * (e.key === "ArrowLeft" ? -1 : 1), f = miniFull();
    const s = Math.max(f.s, Math.min(r.start + delta, f.e - width)); // keep width at the data edges
    setViewRange(s, s + width);
  } else if (["+", "=", "-"].includes(e.key)) {
    const half = width * (e.key === "-" ? 1 : 0.25);
    setViewRange(center - half, center + half);
  } else return;
  e.preventDefault(); e.stopPropagation();
});

const varMinEl = $("varMin"), varMaxEl = $("varMax");
function syncVarLabels() {
  // keep min ≤ max
  let lo = parseFloat(varMinEl.value), hi = parseFloat(varMaxEl.value);
  if (lo > hi) { if (document.activeElement === varMinEl) hi = lo, varMaxEl.value = hi; else lo = hi, varMinEl.value = lo; }
  $("varMinVal").textContent = lo + "%";
  $("varMaxVal").textContent = hi === 100 ? "Any" : hi + "%";
}
[varMinEl, varMaxEl].forEach(el => {
  el.addEventListener("input", syncVarLabels);
  el.addEventListener("change", applyFilters);
});

/* ============================ Reference / glossary modal ============================ */
function buildReference() {
  const codeTable = (title, map) => {
    const rows = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, name]) => `<tr class="border-t border-slate-800"><td class="px-3 py-1 font-mono text-sky-300 align-top">${code}</td><td class="px-3 py-1 text-slate-300">${escapeHtml(name)}</td></tr>`).join("");
    return `<div>
      <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">${title}</h4>
      <div class="border border-slate-800 overflow-hidden">
        <table class="w-full text-xs"><tbody>${rows}</tbody></table>
      </div></div>`;
  };

  const keyRows = Object.entries(KEY_INFO).map(([k, info]) =>
    `<tr class="border-t border-slate-800"><td class="px-3 py-1 font-mono text-sky-300 align-top">${k}</td><td class="px-3 py-1 text-slate-300">${escapeHtml(info.desc)}</td><td class="px-3 py-1 text-slate-400 align-top whitespace-nowrap">${escapeHtml(info.unit || "—")}</td></tr>`
  ).join("");
  const keyTable = `<div>
    <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Variable Keys (Column E+)</h4>
    <div class="border border-slate-800 overflow-hidden">
      <table class="w-full text-xs">
        <thead><tr class="bg-slate-800/80 text-left text-slate-400"><th class="px-3 py-1.5">Key</th><th class="px-3 py-1.5">Meaning</th><th class="px-3 py-1.5">Unit</th></tr></thead>
        <tbody>${keyRows}</tbody>
      </table>
    </div></div>`;

  const colRows = GENERAL_NOTES.columns.map(([c, d]) =>
    `<li><span class="font-mono text-sky-300">${c}</span> — ${escapeHtml(d)}</li>`).join("");
  const notes = `<div class="space-y-4">
    <div>
      <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Column Layout</h4>
      <ul class="list-none space-y-1 text-slate-300 text-xs">${colRows}</ul>
    </div>
    <div>
      <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Units</h4>
      <ul class="list-disc pl-5 space-y-1 text-slate-300 text-xs">${GENERAL_NOTES.units.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
    </div>
    <div>
      <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">About the Event File</h4>
      <ul class="list-disc pl-5 space-y-1 text-slate-300 text-xs">${GENERAL_NOTES.about.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
    </div>
  </div>`;

  // Controller object model index (Data Group → name → object key) — collapsed by default.
  const dgRows = DATA_GROUPS.slice().sort((a, b) => a[1].localeCompare(b[1]))
    .map(([dg, name, key]) => `<tr class="border-t border-slate-800"><td class="px-3 py-1 font-mono text-slate-400 align-top">${dg}</td><td class="px-3 py-1 text-slate-300">${escapeHtml(name)}</td><td class="px-3 py-1 font-mono text-sky-300 align-top">${escapeHtml(key)}</td></tr>`).join("");
  const dgTable = `<details class="group">
    <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Controller object model (Data Groups) <span class="text-slate-500 normal-case">— 3200 MZ spec v19.8.2</span></summary>
    <div class="border border-slate-800 overflow-hidden mt-2">
      <table class="w-full text-xs">
        <thead><tr class="bg-slate-800/80 text-left text-slate-400"><th class="px-3 py-1.5">DG</th><th class="px-3 py-1.5">Object</th><th class="px-3 py-1.5">Key</th></tr></thead>
        <tbody>${dgRows}</tbody>
      </table>
    </div></details>`;

  $("refBody").innerHTML =
    notes +
    keyTable +
    `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${codeTable("Category (Column B)", CATEGORY_MAP)}
      ${codeTable("Action / SubCategory (Column C)", ACTION_MAP)}
      ${codeTable("Trigger / Actor (Column D)", TRIGGER_MAP)}
    </div>` +
    `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${codeTable("Status (ST / SS / LT values)", STATUS_MAP)}
      ${codeTable("Event Causes (SC / PC / TC values)", EVENT_CAUSE_MAP)}
      ${codeTable("Stop Conditions", STOP_CONDITION_MAP)}
    </div>` +
    `<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${codeTable("Message Category (KT)", MESSAGE_CATEGORY_MAP)}
      ${codeTable("Message Priority (PR on Message events)", MESSAGE_PRIORITY_MAP)}
      ${codeTable("Zone Mode", ZONE_MODE_MAP)}
    </div>` +
    codeTable("Message Codes (KD values)", MESSAGE_CODE_MAP) +
    codeTable("Object Keys (object-model type — distinct from Column B)", OBJECT_KEY_MAP) +
    dgTable;
}
const refModal = $("refModal");
function openRef() { if (!$("refBody").childElementCount) buildReference(); refModal.showModal(); }
function closeRef() { refModal.close(); }
$("refBtn").addEventListener("click", openRef);
$("refClose").addEventListener("click", closeRef);
refModal.addEventListener("click", e => { if (e.target === refModal) closeRef(); });

/* ============================ How-to-use guide (in-app walkthrough) ============================ */
function buildGuide() {
  $("guideBody").innerHTML = `
    <p>Open a controller CSV to inspect run history, flow and events. Files are processed in this browser. Feedback is optional and previews exactly which diagnostics it includes.</p>
    <h4 class="font-semibold text-white">Load and navigate</h4>
    <p>Choose a CSV (up to 20 MB) or drop it onto Data Source. Invalid imports retain the previous log. The import status reports rejected rows. Times use the controller's wall clock consistently across browsers; offsets do not shift the displayed clock.</p>
    <p>Window presets center on the playhead. Previous/Next or arrow keys move one window width. Drag the minimap to move/resize the view. Focus the minimap and use arrows to pan or +/− to zoom. Date fields change the timeline window, not the feed.</p>
    <h4 class="font-semibold text-white">Runs and playhead</h4>
    <p>Programs and mainlines start selected; zones start empty. Expand a program to see its zones, including ones without runtime. Manual runs have a separate MR lane. Scheduled bars are green, manual runs carry an amber M, and terminated runs are red/hatched. Soak splits show watering and valve-off gaps; inferred endings remain estimates.</p>
    <p>The run count and At Playhead panel use visible logical runs, counting duplicates and soak segments once. Click a bar or playhead item to reveal its start event. Focus the playhead and use arrows, Page Up/Down, Home or End to inspect time; Snap selects nearby run boundaries.</p>
    <h4 class="font-semibold text-white">Events and filters</h4>
    <p>Category, action, actor, substation, human, alert, flow and variance filters select events in the feed, alert markers and event statistics. They do not change reconstructed runs or hydraulic readings. Substation matches an event's SN/SB field; missing device topology is not inferred. Use lane and run-type controls to select runs.</p>
    <p>The feed omits routine start/done rows by default; search includes them and matches every entered word across the complete filtered log. Sort by a column; load more to append the next 1,500 rows. Expand a row to create its detail and reconstructed CSV. Timeline markers reveal the exact event even beyond a loaded batch; a reveal clears search and includes that event outside current filters.</p>
    <p>Flow plots numeric AC/EX readings in L/min and pressure PR in kPa. Message priority is not pressure. Variance's maximum endpoint is unbounded so extreme deviations remain visible. Events shows intervention markers; each marker opens its exact row.</p>
    <h4 class="font-semibold text-white">Keyboard, export and reference</h4>
    <p>Tab reaches upload, lanes, bars, markers, feed details and playhead controls; Enter or Space activates them. Dialogs contain keyboard focus and Escape returns focus to their opener. On narrow screens the playhead panel follows the dashboard.</p>
    <p>Print / Save as PDF exports the current dashboard view with Controller ID. It is a snapshot, including the currently visible feed area, not a full-log export. Reference explains vendor categories, actions, fields and enumerations.</p>`;
}

const guideModal = $("guideModal");
function openGuide() { if (!$("guideBody").childElementCount) buildGuide(); guideModal.showModal(); }
function closeGuide() { guideModal.close(); }
$("guideBtn").addEventListener("click", openGuide);
$("guideClose").addEventListener("click", closeGuide);
guideModal.addEventListener("click", e => { if (e.target === guideModal) closeGuide(); });

/* ============================ Report export (native browser print → Save as PDF) ============================ */
// We hand the dashboard to the browser's own print engine (a `@media print` stylesheet isolates
// `#dashboard`; see styles.css) instead of rasterizing it with a canvas-capture library — that froze the
// tab on large logs (main-thread bitmap of the whole DOM at 2× scale). Native print keeps text
// selectable and avoids building a second full-dashboard bitmap; output remains a view snapshot.
const PRINT_WIDTH_PX = 1024;   // fits the A4-landscape printable width (~1062px @ 96dpi with 8mm margins)

$("pdfBtn").addEventListener("click", () => {
  if (!allEvents.length) return;   // nothing loaded → nothing to print
  const el = $("dashboard");

  // Temporary stamp prepended to the printed area (replaces the on-screen header, which print hides).
  const range = currentRange(), span = range.end - range.start;
  const cid = ($("controllerId").value || "").trim();
  el.querySelectorAll(".pdf-stamp").forEach(s => s.remove()); // a second quick click must not stack stamps
  const stamp = document.createElement("div");
  stamp.className = "pdf-stamp";
  stamp.style.cssText = "padding:6px 4px 12px;margin-bottom:4px;border-bottom:1px solid #334155;color:#e2e8f0;font-size:13px;";
  stamp.innerHTML = `<strong>Baseline Irrigation Report</strong> &nbsp;·&nbsp; Controller: <strong>${escapeHtml(cid || "—")}</strong>` +
    ` &nbsp;·&nbsp; Window: ${escapeHtml(fmtTimeDate(range.start, span))} → ${escapeHtml(fmtTimeDate(range.end, span))}` +
    ` &nbsp;·&nbsp; Generated ${escapeHtml(new Date().toLocaleString())}`;
  el.insertBefore(stamp, el.firstChild);

  // Constrain the dashboard to the print width and re-render, so the responsive Chart.js canvas is
  // regenerated at a width that fits the page and the absolutely-positioned swimlane bars realign to it
  // (same width-change → hydroDirty → render() path setScrubber uses). Then open the print dialog once
  // the chart has settled (buildHydroChart/renderSwimlane use rAF retries; animation is off).
  el.style.width = PRINT_WIDTH_PX + "px";
  hydroDirty = true; render();
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => window.print(), 120)));
});

// Restore the responsive on-screen layout once the print dialog closes (fires on both save and cancel).
window.addEventListener("afterprint", () => {
  const el = $("dashboard");
  el.style.width = "";
  el.querySelectorAll(".pdf-stamp").forEach(s => s.remove());
  if (allEvents.length) { hydroDirty = true; render(); }
});

/* ============================ Diagnostics for the feedback report ============================ */
// Reads the DOM/module state; buildDiagnostics (diagnostics.js) shapes it. The shaping is pure and
// lives there so tests/feedback.test.js can run the REAL function — this one can't be imported in
// Node (app.js touches the DOM at import time). Add payload fields there, not here.
export function getDiagnostics() {
  const safeVal = id => { const el = $(id); return el ? el.value : null; };
  const safeChk = id => { const el = $(id); return el ? el.checked : null; };
  let range = null;
  try { range = currentRange(); } catch { /* before any data is loaded */ }
  return buildDiagnostics({
    fileName: fileNameEl.textContent,
    allEvents, filtered, hasHydro, windowUnit, range,
    lanes: laneSel,
    flowOn, eventTlOn,
    filters: {
      category: safeVal("categoryFilter"), action: safeVal("actionFilter"),
      trigger: safeVal("triggerFilter"), substation: safeVal("substationFilter"),
      alertsOnly: safeChk("alertsOnly"), humanAudit: safeChk("humanAudit"), showAdvanced: safeChk("showAdvanced"),
      varMin: safeVal("varMin"), varMax: safeVal("varMax"),
    },
  });
}
