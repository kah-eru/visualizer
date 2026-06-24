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
  VH: { desc: "Current rainfall rate", unit: "" },
  // Enumerated status / cause / message fields (decoded via VALUE_ENUMS — see Object Definitions spec)
  ST: { desc: "Current status (enumerated — see Status)", unit: "" },
  SS: { desc: "Drive / secondary status (enumerated — see Status)", unit: "" },
  LT: { desc: "Learned-flow status (enumerated — see Status)", unit: "" },
  SC: { desc: "Last start cause (enumerated — see Event Causes)", unit: "" },
  PC: { desc: "Last pause cause (enumerated — see Event Causes)", unit: "" },
  TC: { desc: "Last stop cause (enumerated — see Event Causes)", unit: "" },
  KT: { desc: "Message category (Message events — see Message Category)", unit: "" },
  KD: { desc: "Message code (Message events — see Message Code)", unit: "" }
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

/* ============================================================================
   3200 MZ Object Definitions (v19.8.2) enumeration tables.
   Source: docs/object-definitions-19.8.2.html (Test-engine "DO,DE" dump).
   These decode the enumerated *values* of certain key=value fields — distinct
   from the event-file column maps above. See docs/OBJECT_DEFINITIONS.md.
   NOTE: the spec's "Object Keys" namespace is NOT identical to the event-file
   Column-B categories (CATEGORY_MAP); keep both, don't merge them.
   ========================================================================== */

// Current status of a device/program/zone (ST / SS / LT values).
export const STATUS_MAP = {UK:"Unknown",UA:"Unassigned",DC:"Disconnected",CN:"Connected",CG:"Connecting",DL:"DNS Lookup",OS:"Open Socket",SE:"Security",WS:"Websocket",AU:"Wait Auth",DS:"Disabled",ER:"Error",FB:"Fallback",EM:"Water Empty",FF:"Flow Fault",PF:"Pressure Fault",LF:"Learn Flow",MR:"Manual Run",OB:"Over Budget",OF:"Off",ON:"On",OC:"Over Current",OK:"OK",PA:"Paused",RD:"Rain Delay",RN:"Running",RS:"Rain Switch",SO:"Soaking",SU:"Success",WA:"Waiting",WT:"Watering",DE:"Device Error",VT:"Variance Testing",EV:"Event Day",ST:"Self Test",EE:"Empty Event Switch",EP:"Empty Pressure",FN:"Finished",DN:"Done",NA:"Interface NA",IN:"Initializing",NL:"No Link",DH:"DHCP",RY:"Ready",RU:"Reset Usage",OL:"Offline"};

// Why a run started / paused / stopped (SC / PC / TC values).
export const EVENT_CAUSE_MAP = {UK:"No Cause",SY:"System",PD:"Program Done",FW:"Flow Switch",PW:"Pause Switch",RD:"Rain Delay",RW:"Rain Switch",SD:"Shutdown",WA:"System Wait",WW:"Water Window",ED:"Event Date",ST:"Start Time",MS:"Moisture",PS:"Pressure",SW:"Event Switch",TM:"Temperature",RG:"Rain Gauge",ET:"ET",BM:"BaseManager",US:"User",OP:"Operator User",PR:"Programmer User",AD:"Admin User",TE:"Test Engine"};

// Message (MG) classification.
export const MESSAGE_CATEGORY_MAP = {BMGR:"BaseManager",CTLR:"Controller",CNMOD:"CNM",CELL:"CNM Cellular",FSTN:"FlowStation",IOT:"IOT",ML:"Mainline",CP:"Control Point",PG:"Program",SSTN:"SubStation",WS:"Water Source",UK:"Unknown",ZN:"Zone",MV:"Master Valve",PMP:"Pump",MS:"Moisture",FLOW:"Flow",ESW:"Event Switch",TS:"Temperature",RAIN:"Rain Gauge",PRES:"Pressure",ALERT:"Alert Relay",BATT:"Solar Battery"};

export const MESSAGE_PRIORITY_MAP = {NONE:"None",HI:"High",MED:"Medium",LO:"Low"};

// Message code (KD value) → human-readable name. ~130 codes.
export const MESSAGE_CODE_MAP = {ODE_UK:"Unknown",BM_CNER:"BaseMgr Connect Error",BM_MS:"BaseMgr Message",BM_NoET:"BaseMgr No ETo Data",CNMCFWF:"CNM Cell FW Update Failure",CNMCFWS:"Cell FW Update Success",CNM_FWF:"CNM FW Update Failure",CNM_FWS:"CNM FW Update Success",CN_Boot:"Controller Boot Up",CN_EDSP:"Controller Event Date Stop",CN_SWPA:"Controller Event Switch Pause",CN_SWSP:"Controller Event Switch Stop",CN_FJSP:"Controller Flow Stop Jumper",CN_MSPU:"Controller Moisture Pause",CN_MSSP:"Controller Moisture Stop",CN_Off:"Controller Off",CN_ROff:"Controller Off (Remote)",CN_ROn:"Controller On (Remote)",CN_PAJM:"Controller Pause Jumper",CN_PSPU:"Controller Pressure Pause",CN_PSPB:"Controller Pressure Pause (Bar)",CN_PSSP:"Controller Pressure Stop",CN_PSSB:"Controller Pressure Stop (Bar)",CN_RDSP:"Controller Rain Days Stop",CN_RPUD:"Controller Rain Gauge Pause (Day)",CN_RPUH:"Controller Rain Gauge Pause (Hour)",CN_RPUR:"Controller Rain Gauge Pause (Rate)",CN_RSPD:"Controller Rain Gauge Stop (Day)",CN_RSPH:"Controller Rain Gauge Stop (Hour)",CN_RSPR:"Controller Rain Gauge Stop (Rate)",CN_RJSP:"Controller Rain Stop Jumper",CN_ResF:"Controller Restore Failed",CN_ResS:"Controller Restore Successful",CN_TSPU:"Controller Temperature Pause",CN_TSSP:"Controller Temperature Stop",CN_TWSC:"Controller Two-Wire Short Circuit",CN_USBF:"Controller USB Storage Failed",CN_RTCF:"Controller RTC Failed",CN_RTCL:"Controller RTC Lost Time",CN_TWNR:"Controller Control Board",CN_ETNR:"Controller Ethernet",CN_FLNR:"Controller Flash",CN_EZPA:"Controller Zone Event Date Pause",CN_EZST:"Controller Zone Event Date Stop",CP_CErr:"Control Point Configuration Error",CP_Dis:"Control Point Disabled",CP_HFDE:"Control Point High Flow Detected",CP_HFSD:"Control Point High Flow Shutdown",CP_HPD:"Control Point High Pressure Detected",CP_HPDB:"Control Point High Pressure Detected (Bar)",CP_HPS:"Control Point High Pressure Shutdown",CP_HPSB:"Control Point High Pressure Shutdown (Bar)",CP_LPD:"Control Point Low Pressure Detected",CP_LPDB:"Control Point Low Pressure Detected (Bar)",CP_LPS:"Control Point Low Pressure Shutdown",CP_LPSB:"Control Point Low Pressure Shutdown (Bar)",CP_UFD:"Control Point Unscheduled Flow Detected",CP_UFSD:"Control Point Unscheduled Flow Shutdown",DV_AERR:"Device Assign Error",DV_DIS:"Device Disabled",DV_FMBR:"Flow Meter Bad Reading",DV_FMRU:"Flow Meter Usage Reset",DV_FMRF:"Flow Meter Usage Reset Failure",DV_MSBR:"Moisture Sensor Bad Reading",DV_MSBT:"Moisture Sensor Bad Temperature",DV_PSBR:"Pressure Sensor Bad Reading",DV_RGRB:"Rain Gauge Bad Reading",DV_RGRT:"Rain Gauge Total Reset",DV_RGRF:"Rain Gauge Total Reset Failure",DV_TSBR:"Temperature Sensor Bad Reading",DV_TWNR:"Two-Wire No Response",DV_VOP:"Valve Open Circuit",DV_VSC:"Valve Short Circuit",DV_VLC:"Valve Leakage Current",DV_VLV:"Valve Low Voltage",DV_WrSN:"Device Wrong Serial Number",DV_Chsm:"Device Checksum",DV_SBOf:"SubStation Offline",FS_CnER:"FlowStation Connect Error",IOTCnER:"IOT Connect Error",ML_CErr:"Mainline Configuration Error",ML_Dis:"Mainline Disabled",ML_HFVD:"Mainline High Flow Variance Detected",ML_HFVS:"Mainline High Flow Variance Shutdown",ML_LFTD:"Mainline Learn Flow Terminated (BiCoder Disabled)",ML_LFTE:"Mainline Learn Flow Terminated (BiCoder Error)",ML_LFVD:"Mainline Low Flow Variance Detected",ML_LFVS:"Mainline Low Flow Variance Shutdown",ML_FSFF:"Mainline FlowStation Flow Fault",ML_FSPF:"Mainline FlowStation Pressure Fault",ML_FSDS:"Mainline FlowStation Disabled",ML_NoCP:"Mainline FlowStation No Control Point",PG_LFCE:"Program Learn Flow Complete (Errors)",PG_LFCS:"Program Learn Flow Complete (Success)",PG_ORun:"Program Over Run",PG_PUSW:"Program Paused (Event Switch)",PG_PUMS:"Program Paused (Moisture)",PG_PUPS:"Program Paused (Pressure)",PG_PUPB:"Program Paused (Pressure Bar)",PG_PURD:"Program Paused (Rain Gauge Day)",PG_PURH:"Program Paused (Rain Gauge Hour)",PG_PURR:"Program Paused (Rain Gauge Rate)",PG_PUTS:"Program Paused (Temperature)",PG_PUWW:"Program Paused (Water Window)",PG_PriP:"Program Priority Preempted",PG_SkMS:"Program Skipped (Moisture)",PG_STBS:"Program Started (Bad Sensor)",PG_STSW:"Program Started (Event Switch)",PG_STMS:"Program Started (Moisture)",PG_STPS:"Program Started (Pressure)",PG_STPB:"Program Started (Pressure Bar)",PG_STRD:"Program Started (Rain Gauge Day)",PG_STRH:"Program Started (Rain Gauge Hour)",PG_STRR:"Program Started (Rain Gauge Rate)",PG_STTS:"Program Started (Temperature)",PG_SPED:"Program Stopped (Event Day)",PG_SPSW:"Program Stopped (Event Switch)",PG_SPMS:"Program Stopped (Moisture)",PG_SPPS:"Program Stopped (Pressure)",PG_SPPB:"Program Stopped (Pressure Bar)",PG_SPRD:"Program Stopped (Rain Gauge Day)",PG_SPRH:"Program Stopped (Rain Gauge Hour)",PG_SPRR:"Program Stopped (Rain Gauge Rate)",PG_SPTM:"Program Stopped (Temperature)",PG_BgEx:"Program Water Budget Exceeded",PG_RaEx:"Program Water Ration Exceeded",PG_MLDB:"Program Mainline Disable Blocked",PG_CPDB:"Program Control Point Disable Blocked",PG_WSDB:"Program Water Source Disable Blocked",PG_CPUB:"Program Control Point Unassigned Blocked",PG_WSUB:"Program Water Source Unassigned Blocked",PG_MLFB:"Program Mainline FlowStation Blocked",PG_CPFB:"Program Control Point FlowStation Blocked",PG_WSFB:"Program Water Source FlowStation Blocked",SB_CNER:"SubStation Connect Error",SB_Dis:"SubStation Disabled",SB_TWSC:"SubStation Two-Wire Short Circuit",SB_BLOW:"SubStation Battery Low",WS_CErr:"Water Source Configuration Error",WS_Dis:"Water Source Disabled",WS_BEX:"Water Source Budget Exceeded",WS_BEXS:"Water Source Budget Exceeded Shutdown",WS_EmSW:"Water Source Empty Event Switch",WS_EmMS:"Water Source Empty Moisture Sensor",WS_EmPS:"Water Source Empty Pressure Sensor",WS_EmPB:"Water Source Empty Pressure Sensor (Bar)",ZN_ExAF:"Zone Exceeds Available Flow",ZN_HFVD:"Zone High Flow Variance Detected",ZN_HFVS:"Zone High Flow Variance Shutdown",ZN_LNCE:"Zone Learn Flow Complete (Error)",ZN_LNCS:"Zone Learn Flow Complete (Success)",ZN_LFVD:"Zone Low Flow Variance Detected",ZN_LFVS:"Zone Low Flow Variance Shutdown",ZNMSCFC:"Zone MS Calibration Failed (No Change)",ZNMSCFS:"Zone MS Calibration Failed (No Saturation)",ZNMSCS:"Zone MS Calibration Success",ZNMSRSC:"Zone MS Requires Soak Cycle"};

// Object-model type keys (DG namespace) — reference only; NOT the event-file Column-B codes.
export const OBJECT_KEY_MAP = {ZN:"Zone",MV:"Master Valve",PM:"Pump",MS:"Moisture Sensor",FM:"Flow Sensor",SW:"Event Switch",TS:"Temperature Sensor",RG:"Rain Gauge",AN:"Pressure Sensor",AR:"Alert Relay",BA:"Solar Battery",PG:"Program",WS:"Water Source",PC:"Control Point",ML:"Mainline",PZ:"Program Zone",PT:"Start Event",PS:"Pause Event",PP:"Stop Event",ED:"Event Day",EZ:"Zone Event Day",EM:"Empty Condition",SB:"SubStation",AP:"Active Program",MG:"Message",CF:"Backup",MH:"Machine",CN:"BaseStation",NW:"Network Interface",BM:"BaseManager",FS:"FlowStation",IO:"IOT"};

export const STOP_CONDITION_MAP = {IM:"Stop Immediately",CY:"Stop at End of Cycle"};
export const ZONE_MODE_MAP = {TM:"Timed",PR:"Primary",LK:"Linked"};
export const EVENT_TYPE_MAP = {PT:"Event Start",PS:"Event Pause",PP:"Event Stop"};
export const EVENT_TRIGGER_MAP_SPEC = {NA:"Event None",MS:"Event on Moisture",SW:"Event on Event Switch",TS:"Event on Temperature",RG:"Event on Precipitation",PS:"Event on Pressure",DT:"Event on Date and Time"};
export const EVENT_DAY_TYPE_MAP = {WD:"Event Day Weekday",EV:"Event Day Even",OS:"Event Day Odd Skip 31st",OD:"Event Day Odd",IN:"Event Day Interval",CI:"Event Day Smart Intervals",AL:"Event Day On Demand"};

/* Context-scoped value decode registry. For each enumerated key, `map` decodes
   its value; optional `cats` limits decoding to those Column-B categories so a
   key reused with a different meaning (e.g. PR = Pressure vs Message Priority)
   is only decoded where the enumerated meaning applies. */
export const VALUE_ENUMS = {
  ST: { map: STATUS_MAP }, SS: { map: STATUS_MAP }, LT: { map: STATUS_MAP },
  SC: { map: EVENT_CAUSE_MAP }, PC: { map: EVENT_CAUSE_MAP }, TC: { map: EVENT_CAUSE_MAP },
  KT: { map: MESSAGE_CATEGORY_MAP, cats: ["MG"] },
  KD: { map: MESSAGE_CODE_MAP, cats: ["MG"] },
  PR: { map: MESSAGE_PRIORITY_MAP, cats: ["MG"] } // PR stays Pressure (kPa) on non-MG lines
};

/* Controller object model index (Data Group → name → object key). Reference for
   the glossary; full member detail lives in docs/object-definitions-19.8.2.html. */
export const DATA_GROUPS = [
  [101,"Zone","ZN"],[111,"Master Valve","MV"],[113,"Pump","PM"],[121,"Moisture Sensor","MS"],
  [131,"Flow Sensor","FM"],[141,"Event Switch","SW"],[151,"Temperature Sensor","TS"],[133,"Rain Gauge","RG"],
  [115,"Pressure Sensor","AN"],[161,"Alert Relay","AR"],[171,"Solar Battery","BA"],[317,"Program","PG"],
  [402,"Water Source","WS"],[412,"Control Point","PC"],[422,"Mainline","ML"],[316,"Program Zone","PZ"],
  [318,"Start Event","PT"],[319,"Pause Event","PS"],[320,"Stop Event","PP"],[338,"Event Day","ED"],
  [342,"Zone Event Day","EZ"],[405,"Empty Condition","EM"],[341,"SubStation","SB"],[1001,"Active Program","AP"],
  [1002,"Message","MG"],[1000,"Backup","CF"],[339,"Machine","MH"],[340,"BaseStation","CN"],
  [335,"Network Interface","NW"],[336,"BaseManager","BM"],[332,"FlowStation","FS"],[337,"IOT","IO"]
];
