# Product demo guide

The dashboard turns a Baseline controller CSV into a timeline of scheduled/manual watering, interruptions, hydraulic readings, and searchable evidence. The useful question is: what ran, when, and what evidence explains it?

## Prepare

Use the committed synthetic `Evnt_flow_test.csv`. Do not present customer logs without permission. Check the build you intend to demonstrate; these notes do not assert that current local changes are deployed. For a local production demo, run `npm run build` then `npm run preview`, and open `http://localhost:4173/visualizer/`.

Rehearse the interactions and browser print preview once. A saved synthetic PDF is a useful fallback. The fixture includes zone 5/program 4 cycle-and-soak around 07:00–07:50 on June 17, 2026; use that sequence instead of narrating unverified historical timings.

## A 10-minute walkthrough

1. Load the synthetic CSV through Data Source. Explain that parsing happens locally and note any import warning. The app accepts files up to 20 MB; it preserves the prior dataset if a new import is rejected.
2. Point out Programs/Mainlines and the Manual Runs lane. Expand a program to show child zones. Scheduled/manual/terminated status and soak segments describe different aspects of a run; the run count deduplicates repeated appearances.
3. Click a run bar to open its start event in the feed. Click an intervention marker to open the exact event and decoded reason. This connects a visual summary to evidence, including events with identical timestamps.
4. Put the playhead inside a run. Show At Playhead, Snap, and the over tag at a logged end. Focus the playhead and use keyboard arrows or Home/End; show the same panel below the dashboard at a narrow width.
5. Find zone 5's cycle-and-soak sequence. Toggle Soak and move into a gap. Explain that these are segments within one logical run, not separate run-count entries.
6. Inspect an inferred end. Explain the evidence and its limit: disappearance from run-list heartbeats or an explicitly linked supply shutdown can estimate a missing DONE. It is not a measured physical stop time; insufficient evidence stays ongoing.
7. Enable Flow and Events. Show numeric actual/expected flow and pressure. Event filters can narrow the audit without erasing a run's stop boundary or changing hydraulic history. SubStation filters events only.
8. Search the whole-file feed, including a normal start/done event, then cycle a column's sort order. With a larger synthetic dataset, demonstrate Load More retaining an expanded row. The feed is independent of the timeline window.
9. Use a preset centered on the playhead and Previous/Next to move one window width. Show minimap pan/resize and its keyboard controls. There is no zoom Back history.
10. Enter a synthetic Controller ID and open Print / Save as PDF. Explain that the PDF contains the current view with a clipped feed. Open Reference or How to use and demonstrate Escape restoring focus.

Show Feedback's preview if useful, but do not send a report during the demo. Explain that event arrays are excluded while filenames, selected filters, typed text, and error messages may contain log values.

## Answers and limits

- Supported format: Baseline controller event logs, with code decoding based on the 3200 MZ object definitions. This is not a generic irrigation controller importer.
- Privacy: analysis stays in the browser; optional feedback requires an explicit send. Review its diagnostic preview before sharing.
- Time: controller wall-clock values are displayed consistently across viewer timezones; offset differences and controller clock changes are not converted into elapsed physical instants.
- Scale: 20 MB input limit, main-thread parsing, and 1,500-row feed batches. Loading all batches still grows the DOM; do not promise unlimited size or instant printing.
- Installation/network: a static webpage needs no backend or login. Analysis works after assets load; offline reload is not guaranteed, and `file://` launch is unsupported.
- Confidence: unit coverage and production browser tests gate the configured deployment workflow. Inference remains limited by missing events/topology, and automated Chromium checks do not cover every browser, printer, or assistive technology.

For day-to-day instructions use [HOW_TO_USE.md](HOW_TO_USE.md); for technical behavior use [NOTES.md](../NOTES.md). Product ideas such as saved views, comparisons, or additional controller formats are future decisions, not existing features.
