# Product Demo Guide — Baseline Irrigation Event-Log Visualizer

> **Audience:** internal product team.
> **Goal of this doc:** give you everything you need to run a confident 10–15 minute live demo — the
> pitch, the talking points, a click-by-click script, sample "wow" moments, and answers to the
> questions you'll get asked.

---

## 0. The 30-second pitch

Irrigation controllers spit out a cryptic CSV event log — one row per event (a zone starting, a
program finishing, an alarm firing, a flow reading, network chatter). Today, diagnosing "what actually
happened in the field" means scrolling thousands of coded rows by hand.

**This tool turns that raw log into a visual timeline in one drag-and-drop, entirely in the browser.**
You instantly see *what ran, when, for how long, whether it was scheduled or manual, if anything
stopped early, and why.* Nothing is uploaded — the CSV never leaves the user's machine.

**One-liner:** *"Drop in a controller log, get an interactive audit of the whole irrigation day."*

---

## 1. Why it matters (the problem we're solving)

- **Support & field techs** currently read raw event logs line-by-line to reconstruct incidents.
  ("A customer says zone 4 ran for 2 hours — did it?")
- The logs are **dense and coded** (category/action/trigger codes, `key=value` telemetry). You need
  tribal knowledge to read them.
- Real failure modes are **invisible in the raw data**: a zone that faults and never logs a "DONE" can
  look like it ran for 53 hours; a cycle-and-soak zone looks like one solid 2-hour block when it was
  really 6 short watering cycles.

**Value props to hammer in the demo:**
1. **Speed** — seconds to a full visual audit vs. minutes/hours of manual log reading.
2. **Clarity** — color-coded scheduled vs. manual vs. stopped-early runs; plain-English "why did it
   stop" reasons decoded from the controller's own codes.
3. **Trust / privacy** — 100% client-side. Customer data never touches a server. Big deal for
   security-conscious accounts.
4. **Zero install** — it's a web page. Send a link, they use it. Also works offline.

---

## 2. What to have ready before the demo

| Item | Notes |
|---|---|
| **The live URL** | `https://kah-eru.github.io/visualizer/` — open it in a clean browser tab. |
| **A sample log** | Use `Evnt_flow_test.csv` (in the repo root) — a synthetic one-day log built to exercise every feature: flow telemetry, alarms, manual runs, a no-DONE inference, and a cycle-and-soak zone. **Do not demo with a real customer log** unless you have permission — real logs are gitignored for privacy. |
| **A backup screenshot/PDF** | Export a PDF once beforehand so you have a fallback if the live demo hiccups. |
| **Know your "hero moments"** | See §4 — the soak split and the "53h → 20min" inference are the crowd-pleasers. |

> **Tip:** Open the app's own **How to use** button (top-right header) once before the demo — it mirrors
> this flow and is a nice thing to point at ("and there's an in-app guide, too").

---

## 3. Click-by-click demo script (~12 min)

### Act 1 — "From chaos to clarity" (2 min)
1. Open the live URL. Show the empty **Data Source** drop zone.
2. **Drag `Evnt_flow_test.csv` onto it.** The whole dashboard fills in instantly.
   - **Say:** *"That's the entire day parsed in the browser — nothing was uploaded anywhere."*
3. Point at the **Execution Timeline** swimlane: bars grouped into lanes for programs, zones, mainlines.
   - 🟩 green = scheduled, 🟧 amber (+ "M" badge) = manual, 🟥 red/hatched = stopped early.

### Act 2 — "Read a run" (2 min)
4. **Click a bar** → the Activity Audit Feed jumps to that run's raw start line and flashes it.
5. Use the **Window presets** (`All · Month · Week · Day · Hour · Min · Sec`) and the **minimap** to move
   around — a preset opens that much time **centered on the scrubber**, so zooming keeps your moment put.
   **Back** undoes a zoom.
   - **Say:** *"Same time axis everywhere — the chart, the bars, the markers all stay aligned."*

### Act 3 — "What was happening at 6:05am?" (3 min) — *the scrubber*
6. Make sure **Scrubber** is on; **drag the playhead** across the timeline — an amber marker on the minimap
   mirrors its position live.
7. The **"At Playhead"** panel (right side) lists exactly what was running at that instant — programs,
   zones, mainlines, and any active alerts.
8. **Click an item in that panel** → the scrubber snaps onto that run, its bar **flashes** on the
   timeline, and the Activity Audit Feed opens its raw log line.
   - **Say:** *"So you can go from 'what was running' straight to the exact raw evidence — on the
     timeline and in the log at once."*

### Act 4 — The hero moments (3 min)
9. **Cycle-and-soak zone** (see §4a). Find the zone that waters in cycles. With the **Soak** toggle on
   (default), the bar shows solid watering segments with dimmed/striped soak gaps between them. Toggle
   **Soak** off → it collapses to one solid bar.
   - **Say:** *"Off, it looks like a 2-hour run. On, you see it was really 6 short cycles with soaks —
     that's the truth of what the field did."*
   - Drag the playhead into a soak gap → the panel tags the zone **"· soaking"**.
10. **No-DONE inference** (see §4b). Point at a hatched **"ended early"** bar.
    - **Say:** *"This zone faulted and never logged a finish. Naively it'd show as running to the end of
      the log — 50+ hours. We infer the real end from the controller's run-list heartbeat."*

### Act 5 — Depth & export (2 min)
11. Toggle **Flow** → overlays the hydraulic actual-vs-expected flow / pressure chart.
12. Toggle **Events** → adds the **Interventions & Alerts** lane; click a marker to see the decoded
    "why" (pause / disable / alarm reason).
13. Scroll to the **Activity Audit Feed** — **every event in the whole log** (not just the window),
    alarms pinned on top. Click a row to expand its raw detail, or its **↗ timeline** button to drop the
    scrubber on that moment and flash its bar. **Search** across the whole log and **click a column
    header** to sort. Show the sidebar **filters** briefly (Programs/Zones/Mainlines, run type,
    human-audit-only, flow variance).
    - **Say:** *"The feed is the entire log — search it, sort it, and jump from any row straight to that
      moment on the timeline."*
14. **Download PDF** → the whole dashboard exports as shown.
    - **Say:** *"One click to hand a customer or a colleague a shareable audit."*

---

## 4. The two "hero" features — explain these well

### 4a. Cycle-and-soak splitting
- **What it is:** Some zones water in *cycles* — water a few minutes, soak (let it absorb), water again,
  repeat. The controller logs this as an interleaved `water → soak → water → …` sequence per zone.
- **The problem it fixes:** Previously the whole span rendered as one solid bar, hiding the soaks. A
  ~60-min actual watering run looked like a 2-hour block.
- **The fix:** With the **Soak** toggle on (default), each watering cycle is a solid zone-colored
  segment and each soak is a dimmed/striped gap — so you see real watering vs. soaking. The scrubber
  panel even tags a zone **"· soaking"** when the playhead is in a gap. Toggle off to restore the single
  bar.
- **Talking point:** *"This is the difference between what the log literally says and what actually
  happened on the ground."*

### 4b. No-DONE end inference
- **What it is:** A faulted zone can keep being commanded without ever logging a `DONE`.
- **The problem it fixes:** Real case — a colleague saw a ~20-minute run displayed as **53h 58m** because
  it never closed.
- **The fix:** We infer the real end from the controller's run-list heartbeat and mark the bar
  **"ended early (inferred from run list)"** with a distinct hatch — instead of pretending it ran to the
  end of the log.
- **Talking point:** *"The tool is honest about uncertainty — it shows you it inferred the end, rather
  than silently guessing."*

---

## 5. Feature checklist (everything you can point at)

- **Drag-and-drop CSV load**, fully client-side.
- **Execution Timeline swimlane** — programs / zones / mainlines, one bar per run.
- **Run classification** — scheduled (green) vs. manual (amber + "M") vs. stopped-early (red/hatched).
- **Cycle-and-soak splitting** (Soak toggle) + **no-DONE end inference**.
- **Minimap + window presets + zoom/back + arrow-key stepping.**
- **Scrubber** with live "At Playhead" panel; click an item to snap the playhead, flash the run bar, and open the feed row.
- **Flow / pressure chart** (Flow toggle) — actual vs. expected.
- **Interventions & Alerts lane** (Events toggle) with decoded "why" reasons.
- **Activity Audit Feed** — the whole log (not just the window), searchable, sortable by any column,
  alarms pinned, expandable raw rows; each row's **↗ timeline** button drops the scrubber on that moment
  and flashes its bar. Clicking a timeline **run bar** jumps the feed to that run's start line.
- **Rich filters** — date/time range, per-program/zone/mainline lanes, run type, human-audit-only,
  substation, flow-variance %, alerts-only, category/action/trigger.
- **Reference glossary** — decodes every category / action / trigger / status / cause / message code
  (built from the 3200 MZ object spec).
- **PDF export** of the current view, stamped with the Controller ID.
- **In-app "How to use" guide** + a **Feedback** button.

---

## 6. Anticipated questions & answers

**Q: Is customer data uploaded anywhere?**
No. Parsing happens entirely in the browser. The only thing that ever leaves is an optional feedback
report, and even that contains just filename + counts + filter state — **never CSV rows**.

**Q: Which controllers / log formats does it support?**
Baseline controller event logs (`Evnt_yyyyMM.csv` / `Events.csv`). The code glossary is built from the
3200 MZ object spec.

**Q: Does it need an install / backend / login?**
No — it's a static web page (Vite build on GitHub Pages). Works offline once loaded.

**Q: How big a log can it handle?**
It handles full monthly logs; the audit feed is capped/binned for very large files (not yet
virtualized — see §7).

**Q: Can we brand it / white-label it / host it ourselves?**
It's a static bundle, so hosting it elsewhere is trivial. Branding would be a small design task.

**Q: How accurate is the "stopped early / inferred end" logic?**
It's rule-based on the controller's own run-list heartbeat, and it *labels* inferred ends explicitly so
users know when a value is inferred vs. logged.

---

## 7. Known gaps / honest caveats (say these if asked — builds trust)

- **No E2E test layer** over the DOM render yet; pure data logic is unit-tested and gates the deploy.
- **Feed isn't virtualized** — very large logs rely on a row cap + density binning.
- **Polish backlog:** persist toggle state across reloads, keyboard nav for the scrubber, export of the
  event/alert timeline data, a narrow-screen/mobile layout.
- **Format coverage** is Baseline-specific today.

---

## 8. Possible "asks" to tee up with the product team

Use the demo to open these conversations:
- Which **customer segment** is this for first — internal support, field techs, or end customers?
- Is **multi-controller / multi-day comparison** valuable (diff two days, or two zones side by side)?
- Do we want **shareable links / saved views**, or is PDF export enough?
- Is there appetite for **alerting** (flag anomalies automatically) rather than manual auditing?
- Which **other controller formats** would unlock the most accounts?

---

## 9. One-slide summary (if you need a TL;DR slide)

> **Baseline Event-Log Visualizer** — Drop in a controller's CSV, get an instant, interactive audit of
> the irrigation day: color-coded scheduled/manual/stopped-early runs, cycle-and-soak detail, flow &
> pressure, decoded alarm reasons, and a searchable feed — all 100% in the browser, nothing uploaded,
> one-click PDF export. *From cryptic log to clear answer in seconds.*
