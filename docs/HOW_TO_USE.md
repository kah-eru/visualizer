# How to use the Baseline Event-Log Dashboard

This tool turns a Baseline irrigation controller event log (`Evnt_yyyyMM.csv`) into a visual timeline
so you can see **what ran, when, for how long, scheduled or manual, and why anything stopped**.

> **Privacy:** everything happens in your browser. Your CSV is **never uploaded** to any server.

The same walkthrough is available inside the app — click **How to use** in the top-right header.

---

## Getting started (5 steps)

1. **Load your log.** Drag a `.csv` onto the **Data Source** box (top-left of the sidebar), or click it
   to browse. The dashboard fills in instantly.
2. **Read the timeline.** The **Execution Timeline** shows one bar per run, grouped into lanes for
   programs, zones, and mainlines. Bar colors:
   - 🟩 **green** — scheduled run
   - 🟧 **amber** (amber border + an “M” badge) — manual run
   - 🟥 **red** — stopped early by a pause or alarm
   - A **hatched bar marked “ended early”** started but never logged a finish (`DN`), so its end is
     **inferred from the controller’s run-list** rather than shown running to the end of the log.
   - A **cycle-and-soak** zone shows solid watering segments with **dimmed/striped soak** gaps between
     them, so you see the real watering vs. soaking. Turn the **Soak** toggle off to collapse it back
     to one continuous bar.

   **Click any bar** to jump the Activity Audit Feed to that run’s raw start line (it scrolls, expands and flashes it).
3. **Move around.** Use the **minimap** (drag the bright window across the full span) or the **Window**
   presets (`All · Month · Week · Day · Hour · Min · Sec`). A preset opens a window of that length **centered
   on the scrubber** — e.g. **Hour** shows ½ hour on each side of the playhead — so zooming in/out keeps the
   moment you’re looking at put. **◀ / ▶** step one window at a time, **Back** undoes a zoom, and the
   **← / →** arrow keys also step.
4. **Inspect a moment.** Keep **Scrubber** on and drag the playhead — the **“At Playhead”** panel on the
   right lists exactly what was running at that instant, and an amber marker on the **minimap** mirrors the
   playhead’s position live. **Click any item in that panel** — a running program/zone/mainline or an alert
   — to move the scrubber right onto that event, flash its run bar on the timeline, and open its raw log
   line in the Activity Audit Feed (the view pans to it if it’s outside the current window). **Snap** makes
   the playhead jump to run start/stop edges.
5. **Dig into the detail.** Toggle **Flow** to overlay the hydraulic flow/pressure chart. Flow is read
   from **Actual (AC) / Expected (EX)** values the controller logs during zone runs with flow monitoring
   — if a log has none, a **“no flow data”** note appears next to the toggle and the chart says so (for
   flow with *no zones running*, that data lives in the FlowStation / flow report, not the event log).
   Toggle **Events** to add a separate **Interventions & Alerts** lane (click any marker for the reason),
   and **Soak** (on by default) to split cycle-and-soak zones into watering vs. soak segments. Scroll to
   the **Activity Audit Feed**, which lists **every event in the whole log** (not just the current window —
   it stays put as you pan the timeline). Click a row to expand its raw detail, or its **↗ timeline**
   button (right side) to drop the scrubber on that moment and flash its run bar. Use the **search box** to
   find events across the whole log (date, action, zone, program, keyword — space-separated terms all must
   match) and **click any column header** to sort by it (click again to flip, a third click restores the
   pinned-alarms default). Clicking a **run bar** on the timeline jumps the feed to that run's raw start
   line. **Hover almost any control** — toggles, the stat strip, legend swatches, and sidebar filters — for a tooltip.

---

## The panes, top to bottom

| Pane | What it shows |
|---|---|
| **Stat strip** | Events in the current window, active alerts, and run count. |
| **Execution Timeline** | The swimlane of runs + minimap + (optional) flow/pressure chart. |
| **Interventions & Alerts** | Pauses, disables, status changes, and alarms — with the “why”. (Toggle **Events**.) |
| **Activity Audit Feed** | Every event in the whole log (independent of the window) — searchable, sortable by any column; alarms pinned on top. |

---

## Filters (left sidebar)

- **Date / Time Range** — limit everything to a From–To window.
- **Show on timeline** — choose which **Programs**, **Zones**, and **Mainlines** get their own lanes.
  (Zones start empty — pick the ones you care about.)
- **Run type** — show/hide 🟩 scheduled and 🟧 manual runs; **Alert markers** toggles the 🟥 alarm ticks.
- **Human audit only** — keep just the events a *person* triggered (User / Operator / Programmer /
  Administrator) and hide everything the controller did on its own — a “who touched this?” view.
  Note this filters the *events* and Audit Feed, **not** the run bars: it won't isolate manual runs,
  because a run's stop event is controller-generated and gets hidden. To see manual runs on the
  timeline, use **Run type → 🟧 Manual** instead.
- **SubStation** — isolate a single substation.
- **Flow Variance |AC−EX| %** — appears when the file has flow telemetry; filter to events whose
  commanded vs. expected flow differ by a chosen range.
- **Show Alerts Only** — the feed shows alarms/errors only.
- **More filters** — narrow by Category, Action, Trigger/Actor, or a minimum flow rate. These slice
  the *Audit Feed*, and because they share the set that draws the timeline, a single selection can
  empty it: only **Zone / Program / Mainline** categories have timeline lanes (others — Manual Run,
  Alarm, Message… — are feed-only), and a run bar needs *both* its start and its stop event, which
  usually differ in action and trigger. To shape the timeline instead, use **Show on timeline**
  (lanes) and **Run type**.
- **Advanced → low-level system events** — off by default; turn on to include substation, network,
  two-wire, and message chatter.
- **Reset Filters** — return to the default view.

---

## Exporting & reference

- **Controller ID** (top-right) is stamped onto the PDF.
- **Download PDF** exports the current dashboard view exactly as shown on screen.
- **Reference** opens the code glossary — what every Category / Action / Trigger, status, cause, and
  message code means.
