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

   **Click any bar** to zoom into it.
3. **Move around.** Use the **minimap** (drag the bright window across the full span) or the **Window**
   presets (`All · Month · Week · Day · Hour · Min · Sec`). **◀ / ▶** step one window at a time, **Back**
   undoes a zoom, and the **← / →** arrow keys also step.
4. **Inspect a moment.** Keep **Scrubber** on and drag the playhead — the **“At Playhead”** panel on the
   right lists exactly what was running at that instant. **Snap** makes the playhead jump to run
   start/stop edges.
5. **Dig into the detail.** Toggle **Flow** to overlay the hydraulic flow/pressure chart (shown only
   when the file has that telemetry), and **Events** to add a separate **Interventions & Alerts** lane
   (click any marker for the reason). Scroll to the **Activity Audit Feed** for every raw event — click
   a row to expand it and pin it on the timeline.

---

## The panes, top to bottom

| Pane | What it shows |
|---|---|
| **Stat strip** | Events in the current window, active alerts, and run count. |
| **Execution Timeline** | The swimlane of runs + minimap + (optional) flow/pressure chart. |
| **Interventions & Alerts** | Pauses, disables, status changes, and alarms — with the “why”. (Toggle **Events**.) |
| **Activity Audit Feed** | The full searchable event list; alarms are pinned on top. |

---

## Filters (left sidebar)

- **Date / Time Range** — limit everything to a From–To window.
- **Show on timeline** — choose which **Programs**, **Zones**, and **Mainlines** get their own lanes.
  (Zones start empty — pick the ones you care about.)
- **Run type** — show/hide 🟩 scheduled and 🟧 manual runs; **Alert markers** toggles the 🟥 alarm ticks.
- **Human audit only** — keep just person-initiated actions (User / Administrator) to separate people
  from the system.
- **SubStation** — isolate a single substation.
- **Flow Variance |AC−EX| %** — appears when the file has flow telemetry; filter to events whose
  commanded vs. expected flow differ by a chosen range.
- **Show Alerts Only** — the feed shows alarms/errors only.
- **More filters** — narrow by Zone, Category, Action, Trigger/Actor, or a minimum flow rate.
- **Advanced → low-level system events** — off by default; turn on to include substation, network,
  two-wire, and message chatter.
- **Reset Filters** — return to the default view.

---

## Exporting & reference

- **Controller ID** (top-right) is stamped onto the PDF.
- **Download PDF** exports the current dashboard view exactly as shown on screen.
- **Reference** opens the code glossary — what every Category / Action / Trigger, status, cause, and
  message code means.
