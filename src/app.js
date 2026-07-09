/* ============================================================================
   App core. This is the original single-file dashboard logic, now importing its
   libraries (Chart.js, PapaParse, html2pdf) and constants instead of relying on
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
// html2pdf (jsPDF + html2canvas + DOMPurify) is heavy and only needed when the user exports a PDF,
// so it's loaded on demand via dynamic import() in the PDF handler — not in the initial bundle.
import {
  CATEGORY_MAP, ACTION_MAP, TRIGGER_MAP,
  FEED_CAP, KEY_INFO, GENERAL_NOTES, HUMAN_TRIGGERS,
  STATUS_MAP, EVENT_CAUSE_MAP, MESSAGE_CODE_MAP, MESSAGE_CATEGORY_MAP,
  MESSAGE_PRIORITY_MAP, OBJECT_KEY_MAP, STOP_CONDITION_MAP, ZONE_MODE_MAP, DATA_GROUPS,
} from "./constants.js";
import { showErrorBanner, pushError } from "./errors.js";
// Pure data logic lives in dependency-free modules (unit-tested in tests/); app.js wires them to the DOM.
import { parseRow, inferEffectivePrograms } from "./parse.js";
import { RUN_START, RUN_STOP, makeRun, buildRunIntervals, zoneRunInProgram } from "./runs.js";
import {
  escapeHtml, numCmp, distinctSorted, fmtTime, fmtTimeDate, fmtDuration,
  windowLabel, snapWindow, centeredWindow, eventVariancePct, categoryColor,
} from "./format.js";
import {
  isDurationMarker, feedSeverity, EVENT_GROUPS, eventGroupOf, whyText, subjectSummary,
  eventRunTarget, selectFeedRows,
} from "./classify.js";

/* ============================ State ============================ */
let allEvents = [];     // full parsed dataset
let filtered = [];      // current filtered subset
let hydroChart = null;  // Chart.js line chart (hydraulic overlay + shared time axis)
let hydroDirty = true;  // rebuild chart datasets only when `filtered` changes (else just move the x-axis)
let miniDensityDirty = true; // repaint the minimap histogram only when `filtered` changes (not on view-only moves)
let viewSpan = 0;       // current view width (ms), used by the chart tick/tooltip time formatting
let flowOn = false;     // show the hydraulic flow/pressure lines on the main timeline (off by default)
let eventTlOn = false;  // show the separate Interventions & Alerts timeline (off by default)
let soakSplit = true;   // split cycle-and-soak zone runs into watering vs soak segments (on by default)
let zoomRange = null;   // {start,end} when zoomed in; null = use the date-filter window
let zoomStack = [];     // previous ranges for "reset/zoom out"
let hasHydro = false;   // dataset contains any AC/EX/PR telemetry
let dataMinT = 0, dataMaxT = 0; // full data time bounds
// run-interval cache: built lazily per mode from `filtered`, cleared whenever `filtered` changes.
let runCache = {};      // { program|zone|mainline -> intervals[] }
let globalEndCached = 0;// end-of-data marker for still-open ("ongoing") runs
let runGen = 0;         // bumped on every applyFilters; invalidates the visibleRunsAt() memo
let telemetry = [];     // chronological subset of `filtered` carrying AC/EX/PR (scrubber flow carry-forward)
let windowUnit = "day"; // active window unit: second|minute|hour|day|week|month|all|custom
// which lanes show on the timeline (checklist dropdowns). empty set = group hidden.
const laneSel = { program: new Set(), zone: new Set(), mainline: new Set() };
const laneAll = { program: [], zone: [], mainline: [] }; // full key lists per group

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

/* ============================ Detail rendering (with hover help) ============================ */
function keyTooltip(k) {
  const info = KEY_INFO[k];
  if (!info) return `${k} — no published definition`;
  return `${k} — ${info.desc}` + (info.unit ? ` (${info.unit})` : "");
}

// inline chip with a native hover tooltip
function chip(label, value, title, help) {
  const t = escapeHtml(title);
  const cls = help ? "help-chip" : "";
  return `<span class="${cls} inline-flex items-baseline gap-1 mr-2 mb-1 px-2 py-0.5 rounded bg-slate-800 border border-slate-700" title="${t}">` +
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
  // exact CSV line, as written in the file
  html += `<div class="w-full mt-2 pt-2 border-t border-slate-800 font-mono text-slate-400 break-all">${escapeHtml(ev.rawLine)}</div>`;
  return html;
}

/* ============================ File handling ============================ */
const fileInput = $("fileInput");
const dropZone = $("dropZone");
const fileNameEl = $("fileName");

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault(); dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", e => { if (e.target.files.length) handleFile(e.target.files[0]); });

function handleFile(file) {
  fileNameEl.textContent = file.name;
  $("subtitle").textContent = "Parsing " + file.name + "…";
  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    worker: false, // workers are blocked when the page is opened via file://
    complete: (results) => {
      try {
        const rows = results.data;
        allEvents = [];
        revealedFeedIds.clear(); // new file → drop any force-shown rows from the previous one
        for (const cols of rows) {
          const ev = parseRow(cols);
          if (ev) { ev._id = allEvents.length; allEvents.push(ev); } // stable id for feed row lookup
        }
        onDataLoaded();
      } catch (err) {
        pushError("parse", err && err.message, err && err.stack, file.name);
        $("subtitle").textContent = "Error reading this file — see the feedback report for details.";
        showErrorBanner("Failed to read the event file", err);
      }
    },
    error: (err) => {
      $("subtitle").textContent = "Error parsing file: " + err.message;
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
    ? keys.map(k => `<label><input type="checkbox" class="ddItem w-3.5 h-3.5 rounded bg-slate-900 border-slate-600 accent-sky-500" value="${escapeHtml(k)}" ${selectAll ? "checked" : ""}>
        <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${colorFn(k)}"></span>${escapeHtml(labelFn(k))}</label>`).join("")
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
  if (!allEvents.length) {
    $("subtitle").textContent = "No valid events found in file.";
    return;
  }
  inferEffectivePrograms(allEvents);

  // range bounds (reduce avoids call-stack limits of spread on large arrays)
  let minT = Infinity, maxT = -Infinity;
  for (const e of allEvents) { const t = e.ts.getTime(); if (t < minT) minT = t; if (t > maxT) maxT = t; }
  dataMinT = minT; dataMaxT = maxT;
  // Default window: the calendar DAY (midnight → midnight) containing the file's last event.
  windowUnit = "day";
  zoomRange = snapWindow("day", maxT, { min: dataMinT, max: dataMaxT });
  zoomStack = [];

  // populate the timeline lane dropdowns (multi-select checklists)
  fillLaneDropdown("program", distinctSorted(allEvents.map(e => e.progEff)), p => `Program ${p}`, p => categoryColor("Program " + p), true);
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
  // fresh log → clear any leftover feed search/sort from a previous file
  feedQuery = ""; feedSortCol = null; feedSortDir = "asc"; $("feedSearch").value = "";
  $("feedHead").classList.remove("hidden"); // sortable column header appears once a log is loaded

  // detect hydraulic telemetry → reveal the variance slider only when meaningful
  hasHydro = allEvents.some(e => e.pairs.AC || e.pairs.EX);
  $("varSection").classList.toggle("hidden", !hasHydro);
  // Flag a loaded log that carries no flow telemetry so the user sees it without toggling Flow on.
  $("flowNote").classList.toggle("hidden", !(allEvents.length && !hasHydro));

  // flow max (for the optional Min-Flow slider under More filters)
  const fmax = allEvents.reduce((m, e) => e.flow != null && e.flow > m ? e.flow : m, 0);
  const sliderMax = fmax > 0 ? Math.ceil(fmax) : 100;
  const slider = $("flowSlider");
  slider.max = sliderMax; slider.value = 0;
  $("flowMax").textContent = sliderMax;
  $("flowValue").textContent = "0";

  $("subtitle").textContent =
    `${allEvents.length.toLocaleString()} events — ${new Date(minT).toLocaleString()} to ${new Date(maxT).toLocaleString()}`;

  applyFilters();
  setScrubber(true); // scrubber on by default — shows the "running now" side panel (chart/x-scale now exist)
}

function toLocalInput(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ============================ Filtering ============================ */
function applyFilters() {
  const cat = $("categoryFilter").value;
  const act = $("actionFilter").value;
  const trg = $("triggerFilter").value;
  const substation = $("substationFilter").value;
  const minFlow = parseFloat($("flowSlider").value) || 0;
  const alertsOnly = $("alertsOnly").checked;
  const humanAudit = $("humanAudit").checked;
  const showAdvanced = $("showAdvanced").checked;
  const varMin = parseFloat($("varMin").value) || 0;
  const varMax = parseFloat($("varMax").value);
  const varActive = hasHydro && (varMin > 0 || varMax < 100);

  // NOTE: the time window is NOT a filter here — it's the view window (currentRange), applied at
  // render time. This lets zoom / nav / window presets roam the whole file independent of `filtered`.
  filtered = allEvents.filter(e => {
    if (!showAdvanced && e.isNoise) return false; // hide substation/network/two-wire chatter
    if (cat && e.category !== cat) return false;
    if (act && e.action !== act) return false;
    if (trg && e.trigger !== trg) return false;
    if (substation) { const sid = e.pairs.SN ? e.pairs.SN.raw : (e.pairs.SB ? e.pairs.SB.raw : null); if (String(sid) !== substation) return false; }
    if (humanAudit && !HUMAN_TRIGGERS.has(e.trgCode)) return false;
    if (alertsOnly && !e.isAlert) return false;
    if (minFlow > 0) { if (e.flow == null || e.flow < minFlow) return false; }
    if (varActive) { const v = eventVariancePct(e); if (v == null || v < varMin || v > varMax) return false; }
    return true;
  });

  // run intervals depend only on `filtered` → recompute their cache key and clear the memo
  runCache = {};
  globalEndCached = filtered.length ? filtered.reduce((m, e) => Math.max(m, e.ts.getTime()), 0) + 1 : dataMaxT + 1;
  // chronological telemetry-only subset for the scrubber's flow carry-forward (usually hundreds of rows,
  // vs. scanning all of `filtered` per animation frame). filtered preserves the file's chronological order.
  telemetry = filtered.filter(e => e.pairs.AC || e.pairs.EX || e.pairs.PR);
  runGen++; lastFeedSig = null; // filter changed → invalidate the visibleRunsAt() memo and force a feed rebuild

  hydroDirty = true; // data/filter changed → chart datasets + minimap density need a full rebuild
  miniDensityDirty = true;
  render();
}

// memoized run intervals for the current `filtered` set (see buildRunIntervals)
function runIntervals(mode) {
  return runCache[mode] || (runCache[mode] = buildRunIntervals(filtered, mode, globalEndCached));
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
  const f = new Date($("dateFrom").value).getTime();
  const t = new Date($("dateTo").value).getTime();
  const start = isFinite(f) ? f : dataMinT;
  const end = isFinite(t) ? t + 60000 : dataMaxT + 1;
  return { start, end: end > start ? end : start + 60000 };
}

// Top-level render: stat strip → hydraulic chart (provides shared X scale) → swimlane → feed.
function render() {
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

// set the view to an aligned window of `unit`, snapped to the period containing `anchor`
function setWindowUnit(unit, anchor) {
  windowUnit = unit; zoomStack = [];
  zoomRange = unit === "all" ? { start: dataMinT, end: dataMaxT + 1 } : snapWindow(unit, anchor, { min: dataMinT, max: dataMaxT });
  render();
}

// set the view to a window of `unit`'s duration centered on the scrubber (½ the unit on each side), so
// zooming in/out from the preset selector keeps the playhead put. Falls back to the view center when the
// scrubber is off. Used by the preset buttons; `setWindowUnit` (calendar-aligned) still drives nav-stepping.
function setWindowUnitCentered(unit) {
  windowUnit = unit; zoomStack = [];
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
  const r = currentRange(), W = r.end - r.start;
  let start = t - W / 2, end = t + W / 2;
  zoomStack = []; zoomRange = { start, end };
  render();
}

function zoomOut() {
  if (zoomStack.length) zoomRange = zoomStack.pop();
  else zoomRange = null;            // back to the date-picker window
  render();
}
// step to the adjacent period — re-snapping for aligned units, else shift by width
function navShift(dir) {
  const r = currentRange();
  if (windowUnit && windowUnit !== "custom" && windowUnit !== "all") {
    setWindowUnit(windowUnit, dir > 0 ? r.end + 1 : r.start - 1);
  } else {
    const width = r.end - r.start;
    zoomRange = { start: r.start + dir * width, end: r.end + dir * width };
    render();
  }
}
function updateNavControls(range) {
  const lbl = (windowUnit && windowUnit !== "custom" && windowUnit !== "all") ? windowUnit : windowLabel(range.end - range.start);
  $("zoomOutBtn").classList.toggle("hidden", !zoomStack.length);
  $("navPrev").title = "Previous " + lbl;
  $("navNext").title = "Next " + lbl;
  $("navLabel").textContent = lbl + " view";
  $("bucketLabel").textContent = "";
  // highlight the active window-unit preset
  document.querySelectorAll("#windowPresets button[data-win]").forEach(b => {
    const active = b.getAttribute("data-win") === windowUnit;
    b.className = "px-2.5 py-1 " + (active ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700");
  });
}

let expandedPrograms = new Set(); // program keys whose zone drop-down is open (program lane view)
// Run start/done rows are normally hidden from the feed (drawn as bars). When the user clicks a
// "Running now" item in the scrubber panel, we force-show that specific event's raw row here.
let revealedFeedIds = new Set();
// Audit-feed search + column sort. Empty query = windowed feed; non-empty = search across the whole log.
// feedSortCol null = default order (alarms pinned, then chronological); set = sort by that column.
let feedQuery = "", feedSortCol = null, feedSortDir = "asc";
let lastFeedSig = null; // content signature of the last feed render, to preserve scroll on view-only moves
// A run bar to flash on the next swimlane render (set by a "locate on timeline" jump). {group,key,ts}.
let pendingBarHighlight = null;

/* ---- Component B: Hydraulic overlay (Chart.js line, provides the shared X scale) ---- */
// Rebuild the Chart.js instance from the full `filtered` telemetry. Only needed when `filtered` changes
// (a data/filter change) — view-only moves use applyHydroView() instead. Datasets hold ALL points; the chart
// clips line points to the x-axis min/max on draw, so panning is just a scale change (no dataset rebuild).
function buildHydroChart(range) {
  const canvas = $("hydroChart");
  viewSpan = range.end - range.start;
  const acPts = [], exPts = [], prPts = [];
  // only gather flow series when the Flow overlay is enabled; otherwise the chart is just a thin time axis
  if (flowOn) for (const e of filtered) {
    const t = e.ts.getTime();
    if (e.pairs.AC) acPts.push({ x: t, y: e.pairs.AC.value });
    if (e.pairs.EX) exPts.push({ x: t, y: e.pairs.EX.value });
    if (e.pairs.PR) prPts.push({ x: t, y: e.pairs.PR.value });
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
      layout: { padding: { left: 52, right: 8, top: 4 } }, // fixed gutter so swimlane lane labels fit/align
      plugins: { legend: { display: false },
        tooltip: { mode: "index", intersect: false, callbacks: { title: items => items.length ? fmtTime(items[0].parsed.x, viewSpan) : "" } } },
      scales
    }
  });
  $("legendHydro").innerHTML =
    !flowOn ? '<span class="text-slate-600">Flow overlay off — enable “Flow” to chart actual/expected flow &amp; pressure.</span>'
    : hasData ? datasets.map(d => `<span class="flex items-center gap-1"><span class="inline-block w-3 h-2 rounded-sm" style="background:${d.borderColor}"></span><span class="text-slate-300">${escapeHtml(d.label)}</span></span>`).join("")
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
    ? `<span class="tl-jump tl-jump-start" data-to="${iv.end}" title="Jump to end (${escapeHtml(eTxt)})"></span>` +
      `<span class="tl-jump tl-jump-end" data-to="${iv.start}" title="Jump to start (${escapeHtml(sTxt)})"></span>`
    : "";
  // group/key/runstart let a bar click resolve back to the run's raw start event in the feed. For a
  // soak/watering *segment* iv.start is the segment start, so iv.runStart carries the true run start.
  const runStart = iv.runStart != null ? iv.runStart : iv.start;
  return `<div class="tl-bar ${cls}${hatch} ${clipL ? "clip-l" : ""} ${clipR ? "clip-r" : ""}" data-start="${iv.start}" data-end="${iv.end}" data-group="${word}" data-key="${escapeHtml(String(iv.key))}" data-runstart="${runStart}" style="${style}" title="${escapeHtml(title)}">${inner}${badge}${jumps}</div>`;
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

  const lblW = Math.max(40, area.left);
  const lblBase = laneLabelStyle(SWIM_ROW_H, lblW);
  const swatch = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;background:${c}"></span>`;
  const section = txt => groupsOn > 1 ? `<div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-2 mb-1 pl-1">${txt}</div>` : "";
  const track = (lbl, bars, bg) => `<div class="tl-track" style="height:${SWIM_ROW_H}px;margin-bottom:3px;${bg ? "background:" + bg + ";" : ""}">${lbl}${bars}</div>`;

  // build runs per enabled group
  const progRuns = showPrograms ? runIntervals("program").filter(inWin).filter(runTypeOk) : [];
  const zoneRunsAll = (showPrograms || showZones) ? runIntervals("zone").filter(inWin) : [];
  const zoneRuns = showZones ? zoneRunsAll.filter(runTypeOk) : [];
  const mainRuns = showMainlines ? runIntervals("mainline").filter(inWin) : [];
  $("statRuns").textContent = (progRuns.length + zoneRuns.length + mainRuns.length).toLocaleString();

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
  // Programs (expandable to their zones)
  if (showPrograms) {
    html += section("Programs");
    // Program tags that actually correspond to a real program run somewhere in the log; a zone whose
    // PG tag is NOT here is "orphaned" and gets attributed to a program by time overlap (see zoneRunInProgram).
    const realProgTags = new Set(runIntervals("program").map(r => r.key));
    const pKeys = sortedKeys(progRuns).filter(k => laneSel.program.has(k));
    if (!pKeys.length) html += `<div class="text-[10px] text-slate-500 pb-1 pl-1">No selected program runs in view.</div>`;
    for (const k of pKeys) {
      const bars = (progByKey.get(k) || []).map(iv => barHTML(iv, xOf, range, "Program")).join("");
      const expanded = expandedPrograms.has(k);
      const lbl = `<span class="lane-label" data-prog="${escapeHtml(k)}" style="cursor:pointer;color:#cbd5e1;${lblBase}" title="Click to ${expanded ? "hide" : "show"} zones in Program ${escapeHtml(k)}">${expanded ? "▾" : "▸"} P${escapeHtml(k)}</span>`;
      html += track(lbl, bars);
      if (expanded) {
        const inProg = z => zoneRunInProgram(z, k, realProgTags, progByKey.get(k) || []);
        const zKeys = sortedKeys(zoneRunsAll.filter(inProg));
        if (!zKeys.length) html += `<div class="text-[10px] text-slate-500 pb-1" style="padding-left:${lblW + 6}px">No zone runs recorded for this program in view.</div>`;
        for (const z of zKeys) {
          const col = zoneColor(z);
          const zbars = (zoneAllByKey.get(z) || []).filter(inProg).map(iv => zoneBars(iv, xOf, range, col)).join("");
          const zlbl = `<span style="${lblBase}color:#cbd5e1;padding-left:12px;" title="Zone ${escapeHtml(z)} in Program ${escapeHtml(k)}">↳ ${swatch(col)}Z${escapeHtml(z)}</span>`;
          html += track(zlbl, zbars, "rgba(148,163,184,0.04)");
        }
      }
    }
  }
  // Zones
  if (showZones) {
    html += section("Zones");
    const zKeys = sortedKeys(zoneRuns).filter(k => laneSel.zone.has(k));
    if (!zKeys.length) html += `<div class="text-[10px] text-slate-500 pb-1 pl-1">No selected zone runs in view.</div>`;
    for (const k of zKeys) {
      const col = zoneColor(k);
      const bars = (zoneByKey.get(k) || []).map(iv => zoneBars(iv, xOf, range, col)).join("");
      html += track(`<span style="color:#cbd5e1;${lblBase}" title="Zone ${escapeHtml(k)}">${swatch(col)}Z${escapeHtml(k)}</span>`, bars);
    }
  }
  if (!groupsOn) html += `<div class="text-xs text-slate-500 py-3 pl-1">Nothing selected — pick Programs, Zones, or Mainlines from the dropdowns in the sidebar.</div>`;

  // alert markers strip (red ticks at each alert time in the window)
  let alertHTML = "";
  if ($("showAlertMarks").checked) {
    const marks = filtered.filter(e => e.isAlert && e.ts.getTime() >= range.start && e.ts.getTime() < range.end)
      .map(e => { const t = e.ts.getTime(); return `<div class="alert-mark" data-tsms="${t}" title="${escapeHtml(fmtTime(t, range.end - range.start) + " — " + e.action + " (" + e.category + ")")}" style="left:${xOf(t)}px;"></div>`; }).join("");
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
      const jump = ev.target.closest(".tl-jump[data-to]");
      if (jump) { ev.stopPropagation(); panToTime(Number(jump.getAttribute("data-to"))); return; }
      const label = ev.target.closest(".lane-label[data-prog]");
      if (label) {
        const p = label.getAttribute("data-prog");
        if (expandedPrograms.has(p)) expandedPrograms.delete(p); else expandedPrograms.add(p);
        refreshSwimlane(); return;
      }
      const mark = ev.target.closest(".alert-mark[data-tsms]");
      if (mark) { jumpTo(Number(mark.getAttribute("data-tsms"))); return; }
      const bar = ev.target.closest(".tl-bar[data-runstart]");
      if (bar) { ev.stopPropagation();
        // scroll the audit feed to this run's raw start line and highlight it (no zoom)
        revealRunStart(findRunStartEvent(bar.getAttribute("data-group"), bar.getAttribute("data-key"), Number(bar.getAttribute("data-runstart")))); }
    });
  }
  // Flash a run bar requested by a "locate on timeline" jump. Done here (post-innerHTML) so it survives
  // this function's requestAnimationFrame deferral. Lights up every segment of the matched run.
  if (pendingBarHighlight) {
    const { group, key, ts } = pendingBarHighlight;
    pendingBarHighlight = null;
    const bars = [...lane.querySelectorAll(".tl-bar[data-runstart]")]
      .filter(b => b.dataset.group === group && b.dataset.key === String(key));
    const hit = bars.find(b => Number(b.dataset.start) <= ts && ts < Number(b.dataset.end) + 1);
    if (hit) for (const b of bars) if (b.dataset.runstart === hit.dataset.runstart) flashBar(b);
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
  const swatch = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;transform:rotate(45deg);margin-right:5px;background:${c}"></span>`;

  let html = "";
  let total = 0;
  for (const g of EVENT_GROUPS) {
    const list = evs.filter(e => eventGroupOf(e) === g);
    if (!list.length) continue;
    total += list.length;
    const marks = list.map(e => {
      const t = e.ts.getTime();
      const title = `${fmtTime(t, span)} — ${e.action} (${e.category}) · by ${e.trigger}\n${whyText(e)}`;
      return `<div class="ev-mark" data-tsms="${t}" title="${escapeHtml(title)}" style="left:${xOf(t)}px;background:${g.color};"></div>`;
    }).join("");
    html += `<div class="ev-track">
      <span style="color:#cbd5e1;${lblBase}" title="${escapeHtml(g.label)} (${list.length})">${swatch(g.color)}${escapeHtml(g.label)}</span>${marks}</div>`;
  }
  if (!total) html = `<div class="text-xs text-slate-500 py-3 pl-1">No interventions or alerts in this window.</div>`;

  // gridlines aligned to the chart's x ticks (match the main timeline)
  lane.innerHTML = gridLinesHTML(xScale, "rgba(226,232,240,0.10)", 1) + html;
  if (!lane._delegated) {
    lane._delegated = true;
    lane.addEventListener("click", ev => {
      const m = ev.target.closest(".ev-mark[data-tsms]");
      if (m) jumpTo(Number(m.getAttribute("data-tsms")));
    });
  }

  // legend (only the groups present) + count
  const present = EVENT_GROUPS.filter(g => evs.some(e => eventGroupOf(e) === g));
  $("eventLegend").innerHTML = present.map(g =>
    `<span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-sm" style="transform:rotate(45deg);background:${g.color}"></span><span class="text-slate-300">${escapeHtml(g.label)}</span></span>`).join("");
  $("eventTlInfo").textContent = total ? `— ${total.toLocaleString()} in view` : "";
}

// expand a feed row's detail, scroll it into view, and flash it
function flashFeedRow(row) {
  const host = $("auditFeed");
  const d = host.querySelector(`[data-fdetail="${row.getAttribute("data-idx")}"]`);
  if (d) d.classList.remove("hidden");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("feed-flash");
  setTimeout(() => row.classList.remove("feed-flash"), 1400);
}
// scroll the audit feed to the event at `ts`, expand and flash it
function focusFeedEvent(ts) {
  const row = $("auditFeed").querySelector(`.feed-row[data-tsms="${ts}"]`);
  if (row) flashFeedRow(row);
}
// Jump to a specific run's start event from the "Running now" panel. Its raw row is normally hidden
// (start/done are drawn as bars), so force-show it, bring it into the window if it's off-screen,
// then expand/flash the row.
function revealRunStart(e) {
  if (!e) return;
  const ts = e.ts.getTime();
  if (isDurationMarker(e)) revealedFeedIds.add(e._id);
  const r = currentRange();
  if (ts < r.start || ts >= r.end) panToTime(ts); // off-screen → center the view on it (re-renders)
  else render();                                   // in view → rebuild the feed with the revealed row
  const row = $("auditFeed").querySelector(`.feed-row[data-eid="${e._id}"]`);
  if (row) flashFeedRow(row);
}
// Resolve a visible run (group + key + start ms) back to its raw start event in `filtered`.
function findRunStartEvent(group, key, startMs) {
  return filtered.find(e => e.ts.getTime() === startMs && (
    group === "Zone" ? (e.catCode === "ZN" && (e.actCode === "WT" || e.actCode === "MR") && e.zones.includes(String(key)))
    : group === "Program" ? (e.catCode === "PG" && RUN_START.has(e.actCode) && String(e.program) === String(key))
    : group === "Mainline" ? (e.catCode === "ML" && e.actCode === "RN" && String(e.mainline) === String(key))
    : false));
}

// scroll/expand/flash the matching feed row (shared by all marker clicks)
function jumpTo(ts) { focusFeedEvent(ts); }

// "Locate on the timeline": drop the scrubber playhead exactly on `ts`, center the view if it's
// off-screen, flash the matching run bar (`target = {group,key}` or null), and — when a `feedEvent`
// is given — reveal + flash its raw feed row too. Shared by the feed ↗ button and the At Playhead panel.
function locateOnTimeline(ts, target, feedEvent) {
  if (!playheadOn) setScrubber(true);              // ensure the playhead is visible
  playheadTime = ts;                               // set AFTER setScrubber so it isn't clamped away
  pendingBarHighlight = target ? { group: target.group, key: String(target.key), ts } : null;
  if (feedEvent && isDurationMarker(feedEvent)) revealedFeedIds.add(feedEvent._id);
  const r = currentRange();
  if (ts < r.start || ts >= r.end) panToTime(ts);  // off-screen → center (re-renders: highlight + playhead apply)
  else render();                                   // in view → re-render so the highlight + playhead apply
  if (feedEvent) { const row = $("auditFeed").querySelector(`.feed-row[data-eid="${feedEvent._id}"]`); if (row) flashFeedRow(row); }
}

/* ---- Scrubber playhead + right-edge "what's running" panel ---- */
let playheadOn = false, playheadSnap = true, playheadTime = null;
// The playhead line moves instantly on every pointermove, but the heavy panel rebuild
// (two full `filtered` scans + run cloning) is coalesced to one per animation frame while dragging.
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
  // Invalidate when the run cache is rebuilt (runGen, bumped in applyFilters) or lane/run-type changes.
  const key = runGen + "|" + (showScheduled ? 1 : 0) + (showManual ? 1 : 0) + "|" +
    [...laneSel.program] + "|" + [...laneSel.zone] + "|" + [...laneSel.mainline];
  if (visRunsCache && visRunsKey === key) return visRunsCache;
  const okType = iv => (iv.manual ? showManual : showScheduled);
  const out = [];
  if (laneSel.mainline.size) for (const iv of runIntervals("mainline")) if (laneSel.mainline.has(iv.key)) out.push({ ...iv, group: "Mainline", color: categoryColor("Mainline " + iv.key) });
  if (laneSel.program.size) for (const iv of runIntervals("program")) if (laneSel.program.has(iv.key) && okType(iv)) out.push({ ...iv, group: "Program", color: categoryColor("Program " + iv.key) });
  if (laneSel.zone.size) for (const iv of runIntervals("zone")) if (laneSel.zone.has(iv.key) && okType(iv)) out.push({ ...iv, group: "Zone", color: zoneColor(iv.key) });
  visRunsCache = out; visRunsKey = key;
  return out;
}

// nearest run start/end edge within ~8px, for snapping
function snapTime(t) {
  if (!playheadSnap) return t;
  const xScale = chartX();
  if (!xScale) return t;
  const tolPx = 8, px = xScale.getPixelForValue(t);
  let best = t, bestD = tolPx;
  for (const iv of visibleRunsAt()) for (const edge of [iv.start, iv.end]) {
    const d = Math.abs(xScale.getPixelForValue(edge) - px);
    if (d < bestD) { bestD = d; best = edge; }
  }
  return best;
}

function setPlayhead(t) { playheadTime = t; positionPlayhead(); }

function positionPlayhead() {
  const el = $("playhead");
  const panel = $("scrubPanel");
  const xScale = chartX();
  if (!playheadOn || playheadTime == null || !xScale) { el.style.display = "none"; panel.classList.add("hidden"); positionMiniPlayhead(); return; }
  const r = currentRange();
  playheadTime = Math.max(r.start, Math.min(r.end, playheadTime)); // clamp into view
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
  const active = visibleRunsAt().filter(iv => iv.start <= t && t < iv.end)
    .sort((a, b) => a.group.localeCompare(b.group) || numCmp(a.key, b.key));
  const dot = (c, dim) => `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${c};${dim ? "opacity:.45;" : ""}"></span>`;
  let runHTML = active.length
    ? active.map(iv => {
        // is the playhead inside a soak gap of this run? (then it's mid-cycle, not actively watering)
        const soaking = soakSplit && iv.segments && !!(iv.segments.find(s => s.s <= t && t < s.e) || {}).soak;
        const tag = soaking ? " · soaking" : iv.kind === "run-terminated" ? " · stopped early" : iv.manual ? " · manual" : "";
        const tagWhy = soaking ? "Between watering cycles (soaking — valve off). " :
          iv.kind === "run-terminated" ? "Ended early on a pause/disable/alarm. " :
          iv.manual ? "Started by a person, not the schedule. " : "";
        const rowTitle = `${tagWhy}Click to move the scrubber to this run's start, flash its bar, and open it in the audit feed.`;
        return `<div class="scrub-run cursor-pointer hover:bg-slate-800 rounded px-1" data-group="${iv.group}" data-key="${escapeHtml(String(iv.key))}" data-start="${iv.start}" title="${escapeHtml(rowTitle)}">
        <div class="flex items-baseline gap-1 py-0.5">${dot(iv.color, soaking)}<span class="text-slate-200">${iv.group} ${escapeHtml(iv.key)}</span>
        <span class="text-slate-500 text-xs ml-auto">${escapeHtml(fmtTime(iv.start, span))}→${iv.ongoing ? "…" : escapeHtml(fmtTime(iv.end, span))}</span></div>
        <div class="text-[10px] ${soaking ? "text-sky-400" : "text-slate-500"} pl-4 pb-1">${fmtDuration(t - iv.start)} into ${fmtDuration(iv.end - iv.start)} run${tag}</div></div>`;
      }).join("")
    : `<div class="text-slate-500 text-xs">Nothing running.</div>`;

  // flow/pressure carry-forward (latest sample at/before t in window)
  let flowHTML = "";
  if (hasHydro) {
    let ac = null, ex = null, pr = null, at = null;
    // telemetry is the chronological AC/EX/PR-only subset (hundreds of rows), so we can stop once past t.
    for (const e of telemetry) { const et = e.ts.getTime(); if (et < r.start) continue; if (et > t) break;
      if (e.pairs.AC) { ac = e.pairs.AC.value; at = et; } if (e.pairs.EX) ex = e.pairs.EX.value; if (e.pairs.PR) pr = e.pairs.PR.value; }
    if (ac != null || ex != null || pr != null) {
      const row = (lbl, v, u) => v == null ? "" : `<div class="flex justify-between"><span class="text-slate-400">${lbl}</span><span class="text-slate-200">${v.toFixed(1)} ${u}</span></div>`;
      flowHTML = `<div><div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Flow</div>
        ${row("Actual", ac, "L/min")}${row("Expected", ex, "L/min")}${row("Pressure", pr, "kPa")}
        <div class="text-[10px] text-slate-500 mt-0.5">as of ${at ? escapeHtml(fmtTime(at, span)) : "—"}</div></div>`;
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
        return `<div class="scrub-alert py-1 cursor-pointer hover:bg-slate-800 rounded px-1" data-tsms="${e.ts.getTime()}" data-eid="${e._id}" title="Alarm/error near the playhead. Click to move the scrubber here, flash its bar, and open it in the audit feed.">
        <div class="flex items-baseline gap-1">
          <span class="text-rose-300 text-xs">${escapeHtml(e.action)}</span><span class="text-slate-500 text-[10px]">${escapeHtml(e.category)}</span>
          <span class="text-slate-500 text-[10px] ml-auto">${escapeHtml(fmtTime(e.ts.getTime(), span))}</span>
        </div>
        <div class="text-[11px] text-slate-300 leading-snug">${escapeHtml(detail)}</div></div>`;
      }).join("") + `</div>`
    : "";

  $("scrubBody").innerHTML =
    `<div class="text-lg font-bold text-amber-300">${escapeHtml(fmtTime(t, span))}</div>` +
    `<div><div class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Running now (${active.length})</div>${runHTML}</div>` +
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
        locateOnTimeline(e ? e.ts.getTime() : s, { group: g, key: k }, e);
        return;
      }
      const a = ev.target.closest(".scrub-alert[data-eid]");
      if (a) { const e = allEvents[Number(a.getAttribute("data-eid"))]; if (e) locateOnTimeline(e.ts.getTime(), eventRunTarget(e), e); }
    });
  }
}

/* ---- Component C: Activity Audit feed (instantaneous events) ---- */
function feedRowHTML(e, idx) {
  const sev = feedSeverity(e);
  const sevCls = sev === "crit" ? "feed-crit" : sev === "warn" ? "feed-warn" : sev === "audit" ? "feed-audit" : "";
  const subj = subjectSummary(e);
  const ts = e.ts.getTime();
  return `<div class="feed-row ${sevCls} ${e.isAlert ? "feed-pinned" : ""} px-4 py-2 flex flex-wrap items-baseline gap-x-3" data-idx="${idx}" data-eid="${e._id}" data-tsms="${ts}">
      <span class="text-slate-400 text-xs whitespace-nowrap" style="width:130px">${e.tsRaw.replace(/\s*[+-]\d{4}\s*$/, "")}</span>
      <span class="text-slate-200 text-sm" style="width:88px">${escapeHtml(e.action)}</span>
      <span class="text-slate-500 text-xs" style="width:72px">${escapeHtml(e.category)}</span>
      <span class="text-sky-200 text-xs" style="flex:1 1 140px;min-width:120px">${subj.html}</span>
      <span class="text-slate-500 text-xs truncate" style="width:96px" title="${escapeHtml(`${e.trgCode || "?"} = ${e.trigger}`)}">by ${escapeHtml(e.trigger)}</span>
      <button class="feed-jump text-sky-400 hover:text-sky-200 text-xs whitespace-nowrap text-right" style="width:80px" data-tsms="${ts}" title="Jump the timeline to this event (${escapeHtml(fmtTimeDate(ts, 0))})">↗ timeline</button>
    </div>
    <div class="hidden px-4 py-3 text-xs leading-relaxed flex flex-wrap" style="background:#0b1220" data-fdetail="${idx}">${detailHTML(e)}</div>`;
}
function renderFeed() {
  const host = $("auditFeed");
  const searching = !!feedQuery;
  // Content signature: when the rows are unchanged across pan / nav / scrubber re-renders, the DOM
  // (including any expanded rows and the scroll position) is already correct — skip the whole rebuild.
  // applyFilters sets lastFeedSig=null so any filter change forces a rebuild even at equal length.
  const sig = `${feedQuery}${feedSortCol}${feedSortDir}${filtered.length}${revealedFeedIds.size}`;
  if (lastFeedSig !== null && sig === lastFeedSig) return; // rows unchanged → skip selectFeedRows + DOM rebuild
  lastFeedSig = sig;
  const ordered = selectFeedRows(filtered, { query: feedQuery, sortCol: feedSortCol, sortDir: feedSortDir, revealedIds: revealedFeedIds });
  const alertCount = ordered.reduce((n, e) => n + (e.isAlert ? 1 : 0), 0);
  const shown = ordered.slice(0, FEED_CAP);
  // make sure a revealed row survives the cap so the jump can find it
  for (const e of ordered.slice(FEED_CAP)) if (revealedFeedIds.has(e._id)) shown.push(e);
  host.innerHTML = shown.length
    ? shown.map((e, idx) => feedRowHTML(e, idx)).join("")
    : `<div class="px-5 py-8 text-center text-slate-500 text-sm">${searching ? "No events match your search." : "No events loaded."}</div>`;
  // One delegated listener (attached once) instead of re-binding every row on each render.
  if (!host._delegated) {
    host._delegated = true;
    host.addEventListener("click", ev => {
      const jump = ev.target.closest(".feed-jump[data-tsms]");
      if (jump) {
        ev.stopPropagation();
        const jr = jump.closest(".feed-row");
        const e = jr && allEvents[Number(jr.getAttribute("data-eid"))];
        if (e) locateOnTimeline(e.ts.getTime(), eventRunTarget(e), null);
        return;
      }
      const row = ev.target.closest(".feed-row");
      if (!row) return;
      const idx = row.getAttribute("data-idx");
      const d = host.querySelector(`[data-fdetail="${idx}"]`);
      if (d) d.classList.toggle("hidden");
    });
  }
  updateFeedHead();
  const total = ordered.length;
  $("feedInfo").textContent = searching
    ? `${total > FEED_CAP ? `First ${FEED_CAP.toLocaleString()} of ` : ""}${total.toLocaleString()} match${total === 1 ? "" : "es"} across all events${alertCount ? ` · ${alertCount} alerts` : ""}`
    : total > FEED_CAP
      ? `Showing first ${FEED_CAP.toLocaleString()} of ${total.toLocaleString()} (${alertCount} alerts)`
      : `${total.toLocaleString()} events${alertCount ? ` · ${alertCount} alerts` : ""}`;
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
  zoomRange = null; zoomStack = []; windowUnit = "custom"; render();
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
  feedSearchTimer = setTimeout(() => { feedQuery = v; refreshFeed(); }, 150);
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
  $("varMax").value = 100; $("varMaxVal").textContent = "100%";
  zoomStack = []; expandedPrograms.clear();
  // clear the audit-feed search box + column sort back to the pinned-alarms default
  feedQuery = ""; feedSortCol = null; feedSortDir = "asc"; $("feedSearch").value = "";
  // back to the default: the calendar day containing the last event
  windowUnit = "day"; zoomRange = snapWindow("day", dataMaxT, { min: dataMinT, max: dataMaxT });
  applyFilters();
});

/* ============================ Window presets + zoom/navigation ============================ */
$("windowPresets").addEventListener("click", e => {
  const b = e.target.closest("button[data-win]");
  if (!b || !allEvents.length) return;
  setWindowUnitCentered(b.getAttribute("data-win")); // center the new window on the scrubber
});
$("zoomOutBtn").addEventListener("click", zoomOut);
$("navPrev").addEventListener("click", () => navShift(-1));
$("navNext").addEventListener("click", () => navShift(1));
// keyboard arrows step the window by its own width (ignored when typing in a field)
document.addEventListener("keydown", e => {
  if (!allEvents.length) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); navShift(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); navShift(1); }
});

/* ============================ Timeline display toggles + variance sliders ============================ */
// run-type / alert-marker checkboxes only change the view, not `filtered` → just re-render
["showScheduled","showManual","showAlertMarks"].forEach(id =>
  $(id).addEventListener("change", render));

// lane checklist dropdowns (Programs / Zones / Mainlines)
document.querySelectorAll(".ml-dd").forEach(dd => {
  const group = dd.getAttribute("data-group");
  const panel = dd.querySelector(".ml-dd-panel");
  // open/close (toggle this panel, close others)
  dd.querySelector(".ml-dd-btn").addEventListener("click", e => {
    e.stopPropagation();
    const wasHidden = panel.classList.contains("hidden");
    document.querySelectorAll(".ml-dd-panel").forEach(p => p.classList.add("hidden"));
    if (wasHidden) panel.classList.remove("hidden");
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
  if (!e.target.closest(".ml-dd")) document.querySelectorAll(".ml-dd-panel").forEach(p => p.classList.add("hidden"));
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
  if (e.target.closest(".tl-bar, .alert-mark, .lane-label")) return; // let bar/alert/label clicks work
  e.preventDefault(); // don't start a text selection while dragging the playhead
  scrubbing = true; timeWrap.setPointerCapture(e.pointerId);
  const t = timeAtClientX(e.clientX); if (t != null) setPlayhead(snapTime(t));
});
timeWrap.addEventListener("pointermove", e => {
  if (!scrubbing) return;
  const t = timeAtClientX(e.clientX); if (t != null) setPlayhead(snapTime(t));
});
timeWrap.addEventListener("pointerup", e => {
  scrubbing = false;
  // commit a final, non-throttled panel update so it matches the resting playhead exactly
  if (scrubPanelRaf) { cancelAnimationFrame(scrubPanelRaf); scrubPanelRaf = null; }
  if (playheadOn && playheadTime != null) updateScrubPanel();
  try { timeWrap.releasePointerCapture(e.pointerId); } catch (_) {}
});

/* ---- Overview minimap (full span + draggable view window) ---- */
const miniMap = $("miniMap");
const miniWindow = $("miniWindow");
const miniCanvas = $("miniCanvas");
const miniPlayhead = $("miniPlayhead");
const miniFull = () => ({ s: dataMinT, e: dataMaxT + 1 });
function miniX2T(px) { const f = miniFull(), W = miniMap.clientWidth || 1; return f.s + (px / W) * (f.e - f.s); }
function miniT2X(t) { const f = miniFull(), W = miniMap.clientWidth || 1; return (t - f.s) / (f.e - f.s) * W; }

// set the view to [start,end] (clamped to the full span, min 1s) — a custom, non-aligned window
function clampView(start, end) {
  const f = miniFull();
  let s = Math.max(f.s, Math.min(start, f.e - 1000));
  let e = Math.min(f.e, Math.max(end, s + 1000));
  return { s, e };
}
function setViewRange(start, end) {
  const { s, e } = clampView(start, end);
  zoomStack = []; windowUnit = "custom"; zoomRange = { start: s, end: e };
  render();
}

// during drag: move the box instantly (cheap) but coalesce the heavy full re-render to one/frame
let viewRaf = null, pendingView = null;
function setViewRangeLive(start, end) {
  const { s, e } = clampView(start, end);
  pendingView = { s, e };
  layoutMiniWindow(s, e); // instant visual feedback without a full render
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => {
    viewRaf = null;
    if (!pendingView) return;
    zoomStack = []; windowUnit = "custom";
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
    const w = r.end - r.start, c = miniX2T(e.clientX - miniMap.getBoundingClientRect().left);
    setViewRange(c - w / 2, c + w / 2); return;
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

const varMinEl = $("varMin"), varMaxEl = $("varMax");
function syncVarLabels() {
  // keep min ≤ max
  let lo = parseFloat(varMinEl.value), hi = parseFloat(varMaxEl.value);
  if (lo > hi) { if (document.activeElement === varMinEl) hi = lo, varMaxEl.value = hi; else lo = hi, varMinEl.value = lo; }
  $("varMinVal").textContent = lo + "%";
  $("varMaxVal").textContent = hi + "%";
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
      <div class="border border-slate-800 rounded-lg overflow-hidden">
        <table class="w-full text-xs"><tbody>${rows}</tbody></table>
      </div></div>`;
  };

  const keyRows = Object.entries(KEY_INFO).map(([k, info]) =>
    `<tr class="border-t border-slate-800"><td class="px-3 py-1 font-mono text-sky-300 align-top">${k}</td><td class="px-3 py-1 text-slate-300">${escapeHtml(info.desc)}</td><td class="px-3 py-1 text-slate-400 align-top whitespace-nowrap">${escapeHtml(info.unit || "—")}</td></tr>`
  ).join("");
  const keyTable = `<div>
    <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Variable Keys (Column E+)</h4>
    <div class="border border-slate-800 rounded-lg overflow-hidden">
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
    <div class="border border-slate-800 rounded-lg overflow-hidden mt-2">
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
buildReference();

const refModal = $("refModal");
function openRef() { refModal.classList.remove("hidden"); }
function closeRef() { refModal.classList.add("hidden"); }
$("refBtn").addEventListener("click", openRef);
$("refClose").addEventListener("click", closeRef);
refModal.addEventListener("click", e => { if (e.target === refModal) closeRef(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !refModal.classList.contains("hidden")) closeRef(); });

/* ============================ How-to-use guide (in-app walkthrough) ============================ */
function buildGuide() {
  const swatch = (c) => `<span class="inline-block w-2.5 h-2.5 rounded-sm align-middle" style="background:${c}"></span>`;
  const step = (n, title, body) => `<div class="flex gap-3">
    <div class="flex-shrink-0 w-6 h-6 rounded-full bg-sky-500 text-slate-900 font-bold text-xs flex items-center justify-center">${n}</div>
    <div class="min-w-0"><h4 class="text-sm font-semibold text-white mb-1">${title}</h4><div class="text-slate-300 text-xs space-y-1">${body}</div></div>
  </div>`;
  const sec = (title, body) => `<div><h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">${title}</h4>${body}</div>`;
  const li = (items) => `<ul class="list-disc pl-5 space-y-1 text-slate-300 text-xs">${items.map(i => `<li>${i}</li>`).join("")}</ul>`;

  $("guideBody").innerHTML =
    `<p class="text-slate-300 text-xs leading-relaxed">This tool turns a Baseline controller event log
       (<span class="font-mono text-sky-300">Evnt_yyyyMM.csv</span>) into a visual timeline so you can see
       <em>what ran, when, for how long, scheduled or manual, and why anything stopped</em>.
       <span class="text-emerald-400">Everything stays in your browser</span> — your file is never uploaded anywhere.</p>` +

    sec("Getting started", `<div class="space-y-3">
      ${step(1, "Load your log", `Drag a <span class="font-mono text-sky-300">.csv</span> onto the <b>Data Source</b> box (top-left) or click it to browse. The dashboard fills in instantly.`)}
      ${step(2, "Read the timeline", `The <b>Execution Timeline</b> shows one bar per run, grouped into lanes for programs, zones and mainlines.
        Bar colors: ${swatch("#22c55e")} scheduled &nbsp; ${swatch("#f59e0b")} manual (amber border + “M”) &nbsp; ${swatch("#ef4444")} stopped early by a pause/alarm.
        A hatched bar marked “ended early” started but never logged a finish, so its end is inferred from the controller’s run-list.
        A <b>cycle-and-soak</b> zone shows solid watering segments with dimmed/striped <b>soak</b> gaps between them (toggle <b>Soak</b> off to see it as one continuous bar). <b>Click any bar</b> to jump the Activity Audit Feed to that run’s raw start line (it scrolls, expands and flashes it).`)}
      ${step(3, "Move around", `Use the <b>minimap</b> (drag the bright window across the full span) or the <b>Window</b> presets
        (<span class="font-mono">All · Month · Week · Day · Hour · Min · Sec</span>). <b>◀ / ▶</b> step one window at a time; <b>Back</b> undoes a zoom; arrow keys <b>← / →</b> also step.`)}
      ${step(4, "Inspect a moment", `Keep <b>Scrubber</b> on and drag the playhead — the “At Playhead” panel on the right lists exactly what was running at that instant.
        <b>Click any item in that panel</b> — a running program/zone/mainline or an alert — to move the scrubber right onto it, flash its run bar on the timeline, and open its raw log line in the Activity Audit Feed. <b>Snap</b> makes the playhead jump to run start/stop edges.`)}
      ${step(5, "Dig into the detail", `Toggle <b>Flow</b> to overlay the hydraulic flow/pressure chart. Flow is read from Actual (AC) / Expected (EX) values the controller logs during zone runs with flow monitoring — if a log has none, a <b>“no flow data”</b> note appears next to the toggle and the chart says so (for flow with no zones running, check the FlowStation / flow report). Toggle <b>Events</b> to add a separate <b>Interventions &amp; Alerts</b> lane — click any marker for the reason. Scroll down to the <b>Activity Audit Feed</b> for every raw event; click a row to expand its raw detail, or its <b>↗ timeline</b> button to drop the scrubber on that moment and flash its run bar. The <b>search box</b> finds events across the whole log (space-separated terms all must match), and <b>clicking a column header</b> sorts by it. <b>Hover almost anything</b> — toggles, stats, legend swatches, filters — for a tooltip explaining it.`)}
    </div>`) +

    sec("The panes, top to bottom", li([
      `<b>Stat strip</b> — events in the current window, active alerts, and run count.`,
      `<b>Execution Timeline</b> — the swimlane of runs + minimap + (optional) flow chart.`,
      `<b>Interventions &amp; Alerts</b> — pauses, disables, status changes, and alarms, with the “why”.`,
      `<b>Activity Audit Feed</b> — the full searchable event list; alarms are pinned on top.`,
    ])) +

    sec("Filters (left sidebar)", li([
      `<b>Date / Time Range</b> — limit everything to a From–To window.`,
      `<b>Show on timeline</b> — pick which <b>Programs</b>, <b>Zones</b> and <b>Mainlines</b> get their own lanes (zones start empty — choose the ones you care about).`,
      `<b>Run type</b> — show/hide ${swatch("#22c55e")} scheduled and ${swatch("#f59e0b")} manual runs; <b>Alert markers</b> toggles the ${swatch("#ef4444")} alarm ticks.`,
      `<b>Human audit only</b> — keep just the events a <i>person</i> triggered (User / Operator / Programmer / Administrator) and hide everything the controller did on its own: a “who touched this?” view. Note this filters the <i>events</i> and Audit Feed, not the run bars — it won't isolate manual runs, because a run's stop event is controller-generated and gets hidden. To see manual runs on the timeline, use <b>Run type → ${swatch("#f59e0b")} Manual</b> instead.`,
      `<b>SubStation</b> — isolate one substation.`,
      `<b>Flow Variance |AC−EX| %</b> — appears when the file has flow; filter to events whose commanded vs. expected flow differ by a chosen range.`,
      `<b>Show Alerts Only</b> — feed shows alarms/errors only.`,
      `<b>More filters</b> — narrow by Category, Action, Trigger/Actor, or a minimum flow rate. These slice the <i>Audit Feed</i>; they share the set that draws the timeline, so a single selection can empty it: only <b>Zone / Program / Mainline</b> categories have lanes (others are feed-only), and a run bar needs <i>both</i> its start and its stop event, which usually differ in action and trigger. To shape the timeline instead, use <b>Show on timeline</b> (lanes) and <b>Run type</b>.`,
      `<b>Advanced → low-level system events</b> — off by default; turn on to include substation, network, two-wire and message chatter.`,
      `<b>Reset Filters</b> — back to the default view.`,
    ])) +

    sec("Exporting & reference", li([
      `<b>Controller ID</b> (top-right) is stamped onto the PDF.`,
      `<b>Download PDF</b> exports the current dashboard view exactly as shown.`,
      `<b>Reference</b> opens the code glossary — what every Category/Action/Trigger, status, cause and message code means.`,
    ]));
}
buildGuide();

const guideModal = $("guideModal");
function openGuide() { guideModal.classList.remove("hidden"); }
function closeGuide() { guideModal.classList.add("hidden"); }
$("guideBtn").addEventListener("click", openGuide);
$("guideClose").addEventListener("click", closeGuide);
guideModal.addEventListener("click", e => { if (e.target === guideModal) closeGuide(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !guideModal.classList.contains("hidden")) closeGuide(); });

/* ============================ PDF export (WYSIWYG + Controller ID / timeframe stamp) ============================ */
$("pdfBtn").addEventListener("click", async () => {
  const el = $("dashboard");
  const btn = $("pdfBtn");
  const prev = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating…";

  // html2pdf (jsPDF + html2canvas + DOMPurify) is loaded on demand so it stays out of the initial bundle.
  let html2pdf;
  try {
    ({ default: html2pdf } = await import("html2pdf.js"));
  } catch (err) {
    pushError("pdf", err && err.message, err && err.stack, "");
    btn.disabled = false; btn.textContent = prev;
    showErrorBanner("Couldn't load the PDF exporter", err);
    return;
  }

  // temporary stamp prepended to the captured area
  const range = currentRange(), span = range.end - range.start;
  const cid = ($("controllerId").value || "").trim();
  const stamp = document.createElement("div");
  stamp.style.cssText = "padding:6px 4px 12px;margin-bottom:4px;border-bottom:1px solid #334155;color:#e2e8f0;font-size:13px;";
  stamp.innerHTML = `<strong>Baseline Irrigation Report</strong> &nbsp;·&nbsp; Controller: <strong>${escapeHtml(cid || "—")}</strong>` +
    ` &nbsp;·&nbsp; Window: ${escapeHtml(fmtTimeDate(range.start, span))} → ${escapeHtml(fmtTimeDate(range.end, span))}` +
    ` &nbsp;·&nbsp; Generated ${escapeHtml(new Date().toLocaleString())}`;
  el.insertBefore(stamp, el.firstChild);

  const cleanCid = cid ? cid.replace(/[^A-Za-z0-9_-]/g, "") : "report";
  const opt = {
    margin: 8,
    filename: `baseline-${cleanCid}-${new Date().toISOString().slice(0,10)}.pdf`,
    image: { type: "jpeg", quality: 0.95 },
    html2canvas: { scale: 2, backgroundColor: "#0f172a", useCORS: true, scrollY: 0 },
    jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
    pagebreak: { mode: ["css", "legacy"] }
  };
  const done = () => { stamp.remove(); btn.disabled = false; btn.textContent = prev; };
  html2pdf().set(opt).from(el).save().then(done).catch(done);
});

/* ============================ Diagnostics for the feedback report ============================ */
// Snapshot of app state for the crash/feedback payload. Deliberately excludes ALL CSV row
// content — only the filename, counts, and current filter/view selections.
export function getDiagnostics() {
  const safeVal = id => { const el = $(id); return el ? el.value : null; };
  const safeChk = id => { const el = $(id); return el ? el.checked : null; };
  let range = null;
  try { range = currentRange(); } catch { /* before any data is loaded */ }
  return {
    fileName: fileNameEl.textContent || null,
    eventCount: allEvents.length,
    filteredCount: filtered.length,
    hasHydro,
    windowUnit,
    range: range ? { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() } : null,
    lanes: { program: laneSel.program.size, zone: laneSel.zone.size, mainline: laneSel.mainline.size },
    flowOn, eventTlOn,
    filters: {
      category: safeVal("categoryFilter"), action: safeVal("actionFilter"),
      trigger: safeVal("triggerFilter"), substation: safeVal("substationFilter"),
      alertsOnly: safeChk("alertsOnly"), humanAudit: safeChk("humanAudit"), showAdvanced: safeChk("showAdvanced"),
      varMin: safeVal("varMin"), varMax: safeVal("varMax"),
    },
  };
}
