/* ============================ Mapping tables ============================ */
export const CATEGORY_MAP = {AL:"Alarm",AN:"Pressure Decoder",BM:"BaseManager",CP:"Control Point",ET:"Evapotranspiration",FM:"Flow Meter",FS:"FlowStation",IO:"IOT Server",ML:"Mainline",MS:"Moisture Sensor",MV:"Master Valve",NM:"Cloud Network Module",NT:"Ethernet",PG:"Program",PM:"Pump",PS:"Pump Station",RG:"Rain Gauge Decoder",SS:"SubStation",SW:"Event Switch",SY:"System",TS:"Temperature Sensor",TW:"Two Wire",WS:"Water Source",ZP:"Primary Zone",ZN:"Zone"};
export const ACTION_MAP = {AD:"ET Adjustment",BK:"Backup",BT:"Boot up",CA:"Clear All",CB:"Calibration",CC:"Configuration Change",CE:"Configuration Error",CL:"Clear",CN:"Connect",DC:"Disconnect",DN:"Done",DR:"Drop",DS:"Disable",DT:"Date/Time",ER:"Error",FV:"Flow Variance",HF:"High Flow",HR:"Hourly Data",LF:"Learn Flow",LP:"Low Pressure",LR:"Learn Flow Results",MR:"Manual Run",OF:"Off",PA:"Pause",RD:"Reading",RS:"Restore",RN:"Run",RL:"Run List",RX:"Receive",SB:"Subtract",SE:"Set",SK:"Skipped",SO:"Soak",SR:"Start",ST:"Status",SP:"Stop",TF:"Traffic",TT:"Transmit",TX:"Text",UD:"Update",VT:"Variance Test",WA:"Wait",WT:"Water"};
export const TRIGGER_MAP = {AD:"Administrator",BL:"Baseline Commander",BM:"BaseManager",CM:"Cloud Network Module",CP:"Control Point",DL:"Dial",DT:"Date/Time",ED:"Event Date",ET:"Ethernet",FJ:"Flow Jumper",FM:"Flow Meter",FS:"FlowStation",IO:"IOT Server",ML:"Mainline",MS:"Moisture Sensor",MV:"Master Valve",NT:"Network",OP:"Operator",PG:"Program",PJ:"Pause Jumper",PP:"Program Priority",PR:"Programmer",PS:"Pressure Sensor",PZ:"Primary Zone",RA:"Rain Shutdown",RG:"Rain Gauge",RJ:"Rain Jumper",SB:"SubStation",SW:"Event Switch",SY:"System",TE:"Test Engine",TS:"Temperature Sensor",US:"User",WS:"Weather Station",WW:"Water Window",ZN:"Zone"};

export const GPM_TO_LPM = 3.785;   // AC / EX
export const PSI_TO_KPA = 6.894;   // PR
export const FLOW_KEYS = new Set(["AC","EX"]);
export const PRESSURE_KEYS = new Set(["PR"]);
export const FEED_CAP = 1500; // cap DOM rows in the audit feed for performance on large logs

// Low-level chatter (substation, networking, two-wire bus) hidden unless "Advanced" is checked.
// Matched on the raw column-B category code.
export const NOISE_CATCODES = new Set(["SB","SS","CM","NM","NT","IO","BM","TW","MG","NW"]);

/* Variable key=value field definitions (from Baseline "Interpreting an Event File").
   { desc, unit } — unit "" when none. Keys not listed have no published definition. */
export const KEY_INFO = {
  // Identity / device
  NU: { desc: "Number", unit: "" },
  SN: { desc: "Serial number", unit: "" },
  MC: { desc: "MAC address", unit: "" },
  TY: { desc: "Type (SS, RV, or CP)", unit: "" },
  VR: { desc: "Firmware version", unit: "" },
  HW: { desc: "Hardware version", unit: "" },
  TX: { desc: "Text (e.g. network path)", unit: "" },
  MG: { desc: "Message ID — BaseManager/SubStation message queue (not in official spec)", unit: "" },
  NW: { desc: "Network path/type, e.g. CC=Cell, IOT=IOT server (FlowStation network status; not in official spec)", unit: "" },
  // Structure
  ML: { desc: "Mainline number", unit: "" },
  ZN: { desc: "Zone or list of zones (semicolon-separated)", unit: "" },
  PG: { desc: "Program number", unit: "" },
  PZ: { desc: "Primary zone", unit: "" },
  // Flow / variance
  AC: { desc: "Actual flow reading (original GPM, shown in L/min)", unit: "L/min" },
  EX: { desc: "Expected flow value (original GPM, shown in L/min)", unit: "L/min" },
  FS: { desc: "FlowStation variance status (HI, LO, or OK)", unit: "" },
  LX: { desc: "Low variance enabled (otherwise high variance)", unit: "" },
  SJ: { desc: "Strikes detected (not shutdown)", unit: "" },
  SK: { desc: "Strikes towards shutdown", unit: "" },
  TH: { desc: "Variance threshold", unit: "%" },
  // Pump / pressure
  IP: { desc: "Address of PumpStation", unit: "" },
  PR: { desc: "Pressure (original PSI, shown in kPa)", unit: "kPa" },
  SS: { desc: "Drive status", unit: "" },
  PD: { desc: "PID feedback", unit: "" },
  FQ: { desc: "Output frequency", unit: "" },
  AM: { desc: "Output current", unit: "" },
  TM: { desc: "Total run time", unit: "seconds" },
  ER: { desc: "Fault type [total IO count / missed IO count]", unit: "" },
  // Rain gauge / two-wire
  RG: { desc: "Rain gauge number", unit: "" },
  VT: { desc: "Two-wire voltage drop", unit: "" },
  VK: { desc: "Accumulated, total rainfall", unit: "" },
  VI: { desc: "Hourly rainfall", unit: "" },
  VH: { desc: "Current rainfall rate", unit: "" }
};

/* General reference notes shown in the glossary modal. */
export const GENERAL_NOTES = {
  units: [
    "Time values (run time, cycle time, soak time, etc.) are given in seconds.",
    "Temperature values are given in Fahrenheit.",
    "Flow is recorded in US gallons. This dashboard converts AC/EX flow to L/min and PR pressure to kPa."
  ],
  columns: [
    ["A", "Date / time the action occurred (24-hour clock)"],
    ["B", "Category — the subject of the entry (e.g. Alarm, Moisture Sensor)"],
    ["C", "SubCategory / Action — what occurred (e.g. Configuration Change)"],
    ["D", "Trigger / Actor — what caused it (e.g. a Date/Time start)"],
    ["E+", "Result of the action as key=value pairs (where applicable)"]
  ],
  about: [
    "Monthly file named Evnt_yyyyMM.csv, created in the controller's Archive folder; it is always active and cannot be suppressed.",
    "The current month's file is uncompressed. When it reaches 5 MB, the oldest 0.5 MB of records are erased and new records are appended, keeping the file bounded.",
    "At the start of a new month the previous file is compressed to Evnt_yyyyMM.zip.",
    "Event lines are buffered and flushed to flash at the top of every minute (and before reboots, halts, or crashes)."
  ]
};
