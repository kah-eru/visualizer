<!-- Distilled from docs/object-definitions-19.8.2.html — the authoritative
     code-generated object model for the Baseline 3200 MZ controller
     (Test-engine "DO,DE" dump, version 19.8.2, generated 1/28/26). -->

# 3200 MZ Object Definitions (v19.8.2) — distilled reference

This is a human-readable distillation of the vendor spec
[`object-definitions-19.8.2.html`](./object-definitions-19.8.2.html). That HTML is the source of
truth (full member lists, value types, byte sizes, min/max); this file captures the parts the
**visualizer** actually uses or could use to decode event logs.

## How this maps to the event log — and a namespace caveat

The visualizer parses **`Evnt_yyyyMM.csv`** event logs, whose columns were originally documented by a
separate, looser doc ("Interpreting an Event File"):

| Column | Meaning | Decoded by |
|---|---|---|
| A | Timestamp | `parseTimestamp` |
| B | Category | `CATEGORY_MAP` |
| C | Action / SubCategory | `ACTION_MAP` |
| D | Trigger / Actor | `TRIGGER_MAP` |
| E+ | `key=value` result pairs | `KEY_INFO` (key meaning) + `VALUE_ENUMS` (value decode) |

**Caveat — two different namespaces.** This object spec also has an **"Object Keys"** enumeration
(the object-model *type* codes). It is **not** identical to the event-file Column-B category codes.
For example the spec uses Pump = `PM` and Pressure Sensor = `AN`, while the event file's Column-B
splits Pump-Station vs Pump and uses different codes. Likewise a `key=value` key can mean different
things by context: `PR` is **Pressure** on a FlowStation line but **Message Priority** on a Message
(`MG`) line. The app therefore:

- keeps `CATEGORY_MAP / ACTION_MAP / TRIGGER_MAP / KEY_INFO` as the parsing source of truth, and
- decodes enumerated *values* with a **context-scoped** registry (`VALUE_ENUMS` in `src/constants.js`)
  that limits ambiguous keys (`KT/KD/PR`) to the `MG` category.

The enumerations below are transcribed into `src/constants.js` (`STATUS_MAP`, `EVENT_CAUSE_MAP`,
`MESSAGE_CODE_MAP`, `MESSAGE_CATEGORY_MAP`, `MESSAGE_PRIORITY_MAP`, `OBJECT_KEY_MAP`,
`STOP_CONDITION_MAP`, `ZONE_MODE_MAP`, `DATA_GROUPS`, …) and surfaced in the in-app glossary modal.

## Decoded value fields (runtime integration)

These `key=value` fields are decoded from raw 2-letter codes into plain English at parse time:

| Key(s) | Enumeration | Scope |
|---|---|---|
| `ST`, `SS`, `LT` | Status | any line |
| `SC`, `PC`, `TC` | Event Causes (start / pause / stop cause) | any line |
| `KT` | Message Category | `MG` lines only |
| `KD` | Message Code | `MG` lines only |
| `PR` | Message Priority | `MG` lines only (else Pressure, kPa) |

Decoded message codes and causes also flow into the interventions/alerts "why" text (`whyText`).

## Data Groups (object model index)

| DG | Object | Key |
|---|---|---|
| 101 | Zone | `ZN` |
| 111 | Master Valve | `MV` |
| 113 | Pump | `PM` |
| 121 | Moisture Sensor | `MS` |
| 131 | Flow Sensor | `FM` |
| 141 | Event Switch | `SW` |
| 151 | Temperature Sensor | `TS` |
| 133 | Rain Gauge | `RG` |
| 115 | Pressure Sensor | `AN` |
| 161 | Alert Relay | `AR` |
| 171 | Solar Battery | `BA` |
| 317 | Program | `PG` |
| 402 | Water Source | `WS` |
| 412 | Control Point | `PC` |
| 422 | Mainline | `ML` |
| 316 | Program Zone | `PZ` |
| 318 | Start Event | `PT` |
| 319 | Pause Event | `PS` |
| 320 | Stop Event | `PP` |
| 338 | Event Day | `ED` |
| 342 | Zone Event Day | `EZ` |
| 405 | Empty Condition | `EM` |
| 341 | SubStation | `SB` |
| 1001 | Active Program | `AP` |
| 1002 | Message | `MG` |
| 1000 | Backup | `CF` |
| 339 | Machine | `MH` |
| 340 | BaseStation | `CN` |
| 335 | Network Interface | `NW` |
| 336 | BaseManager | `BM` |
| 332 | FlowStation | `FS` |
| 337 | IOT | `IO` |

## Enumerations

### Status (`ST` / `SS` / `LT`)
`UK` Unknown · `UA` Unassigned · `DC` Disconnected · `CN` Connected · `CG` Connecting · `DL` DNS Lookup ·
`OS` Open Socket · `SE` Security · `WS` Websocket · `AU` Wait Auth · `DS` Disabled · `ER` Error ·
`FB` Fallback · `EM` Water Empty · `FF` Flow Fault · `PF` Pressure Fault · `LF` Learn Flow ·
`MR` Manual Run · `OB` Over Budget · `OF` Off · `ON` On · `OC` Over Current · `OK` OK · `PA` Paused ·
`RD` Rain Delay · `RN` Running · `RS` Rain Switch · `SO` Soaking · `SU` Success · `WA` Waiting ·
`WT` Watering · `DE` Device Error · `VT` Variance Testing · `EV` Event Day · `ST` Self Test ·
`EE` Empty Event Switch · `EP` Empty Pressure · `FN` Finished · `DN` Done · `NA` Interface NA ·
`IN` Initializing · `NL` No Link · `DH` DHCP · `RY` Ready · `RU` Reset Usage · `OL` Offline

### Event Causes (`SC` / `PC` / `TC`)
`UK` No Cause · `SY` System · `PD` Program Done · `FW` Flow Switch · `PW` Pause Switch · `RD` Rain Delay ·
`RW` Rain Switch · `SD` Shutdown · `WA` System Wait · `WW` Water Window · `ED` Event Date · `ST` Start Time ·
`MS` Moisture · `PS` Pressure · `SW` Event Switch · `TM` Temperature · `RG` Rain Gauge · `ET` ET ·
`BM` BaseManager · `US` User · `OP` Operator User · `PR` Programmer User · `AD` Admin User · `TE` Test Engine

### Message Category (`KT`)
`BMGR` BaseManager · `CTLR` Controller · `CNMOD` CNM · `CELL` CNM Cellular · `FSTN` FlowStation ·
`IOT` IOT · `ML` Mainline · `CP` Control Point · `PG` Program · `SSTN` SubStation · `WS` Water Source ·
`UK` Unknown · `ZN` Zone · `MV` Master Valve · `PMP` Pump · `MS` Moisture · `FLOW` Flow ·
`ESW` Event Switch · `TS` Temperature · `RAIN` Rain Gauge · `PRES` Pressure · `ALERT` Alert Relay ·
`BATT` Solar Battery

### Message Priority (`PR` on Message events)
`NONE` None · `HI` High · `MED` Medium · `LO` Low

### Message Codes (`KD`)
~130 codes; see `MESSAGE_CODE_MAP` in `src/constants.js` for the complete table. Notable groups:
- **Controller** (`CN_*`): boot, off/on (remote), pressure/moisture/temperature pause & stop, rain
  gauge pause/stop (day/hour/rate), jumpers, RTC/flash/USB faults, two-wire short circuit.
- **Control Point** (`CP_*`): high/low pressure detected & shutdown, high/unscheduled flow.
- **Device** (`DV_*`): bad readings, valve open/short/leakage/low-voltage, two-wire no response.
- **Mainline** (`ML_*`) / **Zone** (`ZN_*`): high/low flow variance detected & shutdown, learn-flow
  results (e.g. `ZN_HFVS` = Zone High Flow Variance Shutdown).
- **Program** (`PG_*`): started/paused/stopped by moisture/pressure/temperature/rain/event-switch/
  water-window, budget/ration exceeded, priority preempted, disable/unassigned/FlowStation blocked.
- **Water Source** (`WS_*`), **SubStation** (`SB_*`), **BaseManager** (`BM_*`), **CNM** (`CNM*`).

### Object Keys (object-model type — distinct from Column B)
`ZN` Zone · `MV` Master Valve · `PM` Pump · `MS` Moisture Sensor · `FM` Flow Sensor · `SW` Event Switch ·
`TS` Temperature Sensor · `RG` Rain Gauge · `AN` Pressure Sensor · `AR` Alert Relay · `BA` Solar Battery ·
`PG` Program · `WS` Water Source · `PC` Control Point · `ML` Mainline · `PZ` Program Zone ·
`PT` Start Event · `PS` Pause Event · `PP` Stop Event · `ED` Event Day · `EZ` Zone Event Day ·
`EM` Empty Condition · `SB` SubStation · `AP` Active Program · `MG` Message · `CF` Backup · `MH` Machine ·
`CN` BaseStation · `NW` Network Interface · `BM` BaseManager · `FS` FlowStation · `IO` IOT

### Other enumerations
- **Stop Conditions:** `IM` Stop Immediately · `CY` Stop at End of Cycle
- **Zone Mode:** `TM` Timed · `PR` Primary · `LK` Linked
- **Event Types:** `PT` Event Start · `PS` Event Pause · `PP` Event Stop
- **Event Trigger Types:** `NA` None · `MS` Moisture · `SW` Event Switch · `TS` Temperature ·
  `RG` Precipitation · `PS` Pressure · `DT` Date and Time
- **Event Day Type:** `WD` Weekday · `EV` Even · `OS` Odd Skip 31st · `OD` Odd · `IN` Interval ·
  `CI` Smart Intervals · `AL` On Demand
- **Event Switch State:** `CL` Closed · `OP` Open
- **Network Interface Type:** `ET` Ethernet · `CE` CNM Ethernet · `CW` CNM WiFi · `CC` CNM Cellular
- **Message Priority / Limit Type / Reset Types / Languages / WiFi Security / Water Window Types /
  Time Zones / Test-engine modes** — see the source HTML for the full lists (not used at runtime).
