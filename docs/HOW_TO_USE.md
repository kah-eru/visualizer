# How to use the Baseline Event-Log Dashboard

Open a Baseline controller event-log CSV to inspect what ran, when, and why it stopped. Log analysis happens in your browser. Optional feedback is sent only when you choose Send; its preview can include filenames, selected identifiers, and error text containing log values.

## Load and inspect a log

1. Choose a CSV through Data Source, or drag it onto the upload area. The limit is 20 MB. Invalid/header rows are counted when skipped; CSV syntax errors or no valid events reject the import. A rejected file leaves your previous successful dataset and filename on screen.
2. Read the Execution Timeline: scheduled runs, manual runs with an M badge, stopped-early hatching, and watering/soak segments. Expand a program to see its zones. Manual Runs gathers manual zone runs even when those zones are not individually selected.
3. Select a run bar to reveal its start event in the Activity Audit Feed. Select an alert/intervention/blocker marker to reveal that exact event, including when several events share its timestamp. The feed clears its search, loads later batches when needed, and includes the target outside current filters.
4. Move the playhead to inspect the At Playhead panel. Snap selects nearby run edges. Tags can combine manual, stopped early, soaking, and over. At the exact logged end, a run remains listed as over but is excluded from Running now.
5. Turn on Flow for numeric Actual/Expected flow and pressure. Pressure-only logs are supported. Missing or invalid readings are not plotted; message priority is not pressure. Turn on Events for the separate Interventions & Alerts timeline and decoded reasons.

Selected zones keep their rows without runtime, so blocker events can still be inspected. Soak toggles the visual segments, not the logical run count. Inferred ends are estimates from run-list or explicitly linked supply evidence; a stop logged after a zone left the run list also ends at the last listing and is labeled inferred. Disabling a zone ends its open run. Absent evidence can leave a run ongoing.

## Windows, lanes, and event filters

Date fields and the minimap control the timeline window. The default is the day containing the last event. Presets center on the playhead, or view center if the scrubber is off; All shows the full span. Previous/Next move one window width. Drag the minimap window to pan or its edges to resize.

Times display the controller's wall-clock fields consistently across viewer timezones. Supplied offsets do not shift them. Durations describe that wall clock and may not equal elapsed physical time across controller clock changes.

| Control | What it changes |
| --- | --- |
| Programs, Zones, Mainlines | Visible timeline lanes; zones begin unselected |
| Scheduled / Manual | Visible run types, including the Manual Runs section |
| Expanded programs | Child zone visibility; logical runs count once even when drawn twice |
| Human audit | Events triggered by User, Operator, Programmer, or Administrator |
| SubStation | Events only; it does not isolate run or hydraulic history |
| Category / Action / Trigger / minimum flow | Event selection |
| Alerts Only / Advanced | Alarms/errors or inclusion of low-level system chatter |
| Flow variance | Event deviation range; the maximum endpoint includes deviations above 100% |

Event filters change the feed and event markers. Complete run boundaries and hydraulic history remain available, so filtering for a start action cannot shorten a run. To isolate manual runs visually, use Manual under Run type. Reset Filters returns to defaults.

## Search and evidence

The feed spans the whole file, independently of the timeline window, within active event filters. Search matches all space-separated terms across event fields and reconstructed CSV; it includes normal start/done events that are hidden in the default feed. Sort a column ascending, descending, then back to default alarm-prioritized order.

The first 1,500 matching rows are shown. Load More appends another batch while keeping existing expanded rows. Continue to reach every match. Select a row to build and expand its details. Reconstructed CSV preserves parsed values, not the original quoting or byte-for-byte source record.

A row's timeline/events arrow appears only when there is a destination to highlight. It moves the playhead, enables the relevant lane or marker, and leaves a location ring until the next jump/reset. Rows such as standalone sensor readings may have no timeline arrow.

## Keyboard and smaller screens

Tab reaches the upload, controls, lane labels, bars, markers, and feed rows; Enter or Space activates them. With the playhead focused, arrows move it, Page Up/Down make larger moves, and Home/End select window edges. With the minimap focused, arrows pan and +/- zoom. Outside those controls and text inputs, Left/Right step the timeline window.

Reference, How to use, and Feedback open dialogs that contain focus. Escape closes them and returns focus to the opener. On narrow screens, At Playhead follows the dashboard in normal page flow.

## Print, reference, and feedback

Print / Save as PDF opens the browser's native print dialog. Enter Controller ID for the report stamp and choose Save as PDF or a printer. The print layout omits controls, sidebar, minimap, and drawer; the feed remains clipped, so this is a report of the current view, not a full CSV export. Check the preview before sharing.

Reference explains Baseline category/action/trigger codes and vendor enumerations. Unknown values remain visible for inspection.

Feedback previews the diagnostic snapshot before sending or downloading. Event arrays are excluded, but filename/filter values and captured error messages can contain log values. Review them first. Nothing sends automatically; if sending is unavailable or times out, Download report remains available. The loaded app can analyze logs without a network connection, but an offline page reload is not guaranteed.
