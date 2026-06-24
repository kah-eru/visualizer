/* ============================================================================
   Pure CSV-row parsing + program inference — no DOM, no shared app state.
   Extracted from app.js so they can be unit-tested directly in Node.
   ========================================================================== */
import {
  CATEGORY_MAP, ACTION_MAP, TRIGGER_MAP,
  GPM_TO_LPM, PSI_TO_KPA, FLOW_KEYS, PRESSURE_KEYS, NOISE_CATCODES,
  VALUE_ENUMS,
} from "./constants.js";

/* ---- Timestamp parsing. Format: MM/dd/yy HH:mm:ss -0600 ---- */
export function parseTimestamp(raw) {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/);
  if (!m) { const d = new Date(raw); return isNaN(d) ? null : d; }
  let [, mo, day, yr, hh, mm, ss, tz] = m;
  let year = parseInt(yr, 10);
  if (year < 100) year += 2000;
  // Build a local Date (we treat values as wall-clock time from the controller)
  const d = new Date(year, parseInt(mo, 10) - 1, parseInt(day, 10), parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10));
  return isNaN(d) ? null : d;
}

/* ---- Row parsing: one jagged CSV row → one event object ---- */
export function parseRow(cols) {
  if (!cols || cols.length === 0) return null;
  const tsRaw = (cols[0] || "").trim();
  const ts = parseTimestamp(tsRaw);
  if (!ts) return null;

  const catCode = (cols[1] || "").trim();
  const actCode = (cols[2] || "").trim();
  const trgCode = (cols[3] || "").trim();

  const pairs = {};     // key -> {value, display, unit, raw}
  const extras = [];    // positional / non key=value tokens

  for (let i = 4; i < cols.length; i++) {
    const token = (cols[i] || "").trim();
    if (token === "") continue;
    const eq = token.indexOf("=");
    if (eq === -1) { extras.push(token); continue; }
    const key = token.slice(0, eq).trim();
    const rawVal = token.slice(eq + 1).trim();
    let value = rawVal, unit = "", display = rawVal, decoded = "";
    const num = parseFloat(rawVal);
    const isNum = rawVal !== "" && !isNaN(num) && /^-?\d*\.?\d+$/.test(rawVal);

    if (FLOW_KEYS.has(key) && isNum) {
      value = num * GPM_TO_LPM; unit = "L/min"; display = value.toFixed(2) + " L/min";
    } else if (PRESSURE_KEYS.has(key) && isNum) {
      value = num * PSI_TO_KPA; unit = "kPa"; display = value.toFixed(2) + " kPa";
    } else {
      value = isNum ? num : rawVal;
      // Decode enumerated status/cause/message values (context-scoped by category).
      const spec = VALUE_ENUMS[key];
      if (spec && (!spec.cats || spec.cats.includes(catCode))) {
        const name = spec.map[rawVal];
        if (name) { decoded = name; display = `${rawVal} — ${name}`; }
      }
    }
    pairs[key] = { value, display, unit, raw: rawVal, decoded };
  }

  const category = CATEGORY_MAP[catCode] || catCode || "—";
  const action = ACTION_MAP[actCode] || actCode || "—";
  const trigger = TRIGGER_MAP[trgCode] || trgCode || "—";
  const isAlert = catCode === "AL" || actCode === "ER";
  const isNoise = NOISE_CATCODES.has(catCode);
  const program = pairs.PG ? String(pairs.PG.raw) : null;
  const flow = pairs.AC ? pairs.AC.value : (pairs.EX ? pairs.EX.value : null);
  // ZN may be a single zone or a semicolon-separated list; ML is a single mainline.
  const zones = pairs.ZN ? String(pairs.ZN.raw).split(";").map(z => z.trim()).filter(Boolean) : [];
  const mainline = pairs.ML ? String(pairs.ML.raw) : null;

  const rawLine = cols.map(c => (c == null ? "" : c)).join(",");

  return {
    ts, tsRaw, catCode, actCode, trgCode,
    category, action, trigger,
    pairs, extras, isAlert, isNoise, program, progEff: program, flow, zones, mainline, rawLine
  };
}

// Attribute zone events that lack a PG= field to the program that last ran that zone,
// so program filtering keeps each zone's start AND its stop/done/soak lines together.
// Mutates `progEff` on each event in `events`.
export function inferEffectivePrograms(events) {
  const order = events.map((e, i) => i).sort((a, b) => {
    const d = events[a].ts.getTime() - events[b].ts.getTime();
    return d !== 0 ? d : a - b;
  });
  const zoneProgram = {};
  for (const idx of order) {
    const e = events[idx];
    if (e.program != null) {
      e.progEff = e.program;
      for (const z of e.zones) zoneProgram[z] = e.program;
    } else if (e.zones.length) {
      const known = e.zones.map(z => zoneProgram[z]).find(p => p != null);
      e.progEff = known != null ? known : null;
    } else {
      e.progEff = null;
    }
  }
}
