# Zone Inventory and Blocking-Event Lanes

## Goal

Show selected zones on the execution timeline even when they have no runtime in the current window, and show the blocking event that explains why a zone did not run when the CSV contains one.

## Current behavior

The Zones checklist is already populated from every `ZN=` value in the loaded CSV and sorted numerically. The timeline instead derives its row keys from built run intervals, so a selected zone disappears when it has no `WT`/`MR` to `DN` interval. Expanded programs have the same run-only behavior.

Real logs demonstrate the gap: zones 41, 126, and 127 have Disable events but no run interval, while zone 200 has repeated Configuration Error events (`TX=Missing Program`) and no run interval.

## Design

### Standalone Zones section

Render rows from the selected zone inventory (`laneSel.zone` ordered against `laneAll.zone`), not from the keys present in `zoneRuns`. A selected zone therefore keeps its row whether it ran earlier, ran outside the current window, or never ran at all. Existing run bars remain unchanged.

An empty row means “no runtime in this window.” The zone label tooltip will state that when the row has no visible run.

### Expanded program zones

Keep the existing runtime attribution through `zoneRunInProgram`. Add zones explicitly linked to the program by a CSV event containing both `PG=` and `ZN=`—including Program Zone (`PZ`) configuration events. Exclude the manual tag `PG=MR`.

The expanded child rows are the numerically sorted union of:

- zones with a runtime attributed to the program; and
- zones explicitly linked to the program anywhere in the loaded CSV.

Do not assign a zone to a program when the CSV provides no program link. Such a zone remains available in the standalone Zones section. This avoids inventing program membership.

Selected program rows themselves remain runtime-driven; this change affects the zone children of a visible, expanded program.

### Blocking-event markers

Draw a small colored diamond on a zone row for these events:

- Alarm or Error (`isAlert`);
- Pause (`PA`);
- Disable (`DS`);
- Skip or Drop (`SK` / `DR`); and
- Configuration Error (`CE`).

Configuration changes, ordinary Set/Status events, and Wait events are not blockers.

Markers use the existing event-group colors and `whyText` explanation. Their timestamp must fall inside the current view. Their source event must pass the current event filters, matching the rest of the timeline. In an expanded program, only a blocker attributed to that program through its explicit or inferred effective program is shown.

Each marker is a keyboard-focusable button with a descriptive accessible label and hover title. Activating it uses the existing timeline-to-feed navigation to open and flash the raw Audit Feed row.

Multiple blockers at the same timestamp may overlap, matching the existing event-marker behavior; clustering is outside this change.

## Data flow

1. CSV parsing and `inferEffectivePrograms` remain unchanged.
2. `onDataLoaded` continues building the complete zone inventory and checklist.
3. The render path derives explicit program-zone links once from loaded events, excluding `PG=MR`.
4. `renderSwimlane` renders selected/linked zone keys before looking up their optional run bars.
5. The same render pass selects matching blocker events and places their markers against the existing Chart.js time scale.
6. Marker activation delegates to the existing feed-jump handler.

No new dependency, parser format, state library, or general-purpose abstraction is needed.

## Empty and malformed data

- A selected zone with no run and no blocker still renders as an empty row.
- A blocker without `ZN=` cannot be placed on a zone row and stays on the existing global event timelines.
- A zone without a program link is never guessed into an expanded program.
- Existing parser rejection and empty-file behavior are unchanged.

## Verification

Extend the existing Playwright coverage with one small synthetic CSV case that proves:

1. selected zone rows render in numeric order;
2. a zone with no runtime still has a row;
3. its blocking-event diamond renders with the expected explanation;
4. activating the marker opens the matching Audit Feed row; and
5. a zone explicitly linked to a program appears when that program is expanded despite having no runtime.

Run the existing Vitest suite and production build as regression checks. Update the in-app guide, `docs/HOW_TO_USE.md`, and the developer handoff text so they no longer describe zone lanes as runtime-only.

## Out of scope

- Inferring complete controller configuration not present in the event log.
- Showing every zone under every program.
- Inventing a duration for a zone that never started.
- Marker clustering or a new alert-classification system.
