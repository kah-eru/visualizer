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
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s+([+-]\d{4}))?$/);
  const iso = !m && text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m && !iso) return null;
  const [yr, mo, day, hh, mm, ss, fraction, tz] = m
    ? [m[3], m[1], m[2], m[4], m[5], m[6], "", m[7]]
    : [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6] || "0", iso[7] || "", iso[8]];
  const year = Number(yr) + (yr.length === 2 ? 2000 : 0);
  if (tz && tz !== "Z") {
    const offset = tz.slice(1).replace(":", "");
    if (Number(offset.slice(0, 2)) > 23 || Number(offset.slice(2)) > 59) return null;
  }
  // UTC components encode the controller's wall clock; viewer DST and supplied offsets never shift it.
  const d = new Date(0);
  d.setUTCFullYear(year, Number(mo) - 1, Number(day));
  d.setUTCHours(Number(hh), Number(mm), Number(ss), Number(fraction.padEnd(3, "0")));
  return d.getUTCFullYear() === year && d.getUTCMonth() === Number(mo) - 1 &&
    d.getUTCDate() === Number(day) && d.getUTCHours() === Number(hh) &&
    d.getUTCMinutes() === Number(mm) && d.getUTCSeconds() === Number(ss) ? d : null;
}

// Parsed numeric telemetry only. MG's PR means message priority, even if its raw value is numeric.
export function telemetryValue(e, key) {
  const unit = FLOW_KEYS.has(key) ? "L/min" : key === "PR" && e.catCode !== "MG" ? "kPa" : null;
  const pair = Object.hasOwn(e.pairs, key) ? e.pairs[key] : null;
  return unit && pair?.unit === unit && Number.isFinite(pair.value) ? pair.value : null;
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

  const pairs = Object.create(null); // imported keys must not address Object.prototype
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
    const isNum = rawVal !== "" && Number.isFinite(num) && /^-?\d*\.?\d+$/.test(rawVal);

    if (FLOW_KEYS.has(key) && isNum) {
      value = num * GPM_TO_LPM; unit = "L/min"; display = value.toFixed(2) + " L/min";
    } else if (PRESSURE_KEYS.has(key) && catCode !== "MG" && isNum) {
      value = num * PSI_TO_KPA; unit = "kPa"; display = value.toFixed(2) + " kPa";
    } else {
      value = isNum ? num : rawVal;
      // Decode enumerated status/cause/message values (context-scoped by category).
      const spec = Object.hasOwn(VALUE_ENUMS, key) ? VALUE_ENUMS[key] : null;
      if (spec && (!spec.cats || spec.cats.includes(catCode))) {
        const name = Object.hasOwn(spec.map, rawVal) ? spec.map[rawVal] : null;
        if (name) { decoded = name; display = `${rawVal} — ${name}`; }
      }
    }
    pairs[key] = { value, display, unit, raw: rawVal, decoded };
  }

  const category = Object.hasOwn(CATEGORY_MAP, catCode) ? CATEGORY_MAP[catCode] : catCode || "—";
  const action = Object.hasOwn(ACTION_MAP, actCode) ? ACTION_MAP[actCode] : actCode || "—";
  const trigger = Object.hasOwn(TRIGGER_MAP, trgCode) ? TRIGGER_MAP[trgCode] : trgCode || "—";
  const isAlert = catCode === "AL" || actCode === "ER";
  const isNoise = NOISE_CATCODES.has(catCode);
  const program = pairs.PG ? String(pairs.PG.raw) : null;
  const flow = telemetryValue({ catCode, pairs }, "AC") ?? telemetryValue({ catCode, pairs }, "EX");
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

// Parse CSV rows (as PapaParse hands them over: arrays of cells) into events, dropping the ones
// parseRow rejects — blank lines, headers, anything with an unreadable timestamp. Each survivor gets
// a stable `_id` (its index) that the feed uses to look its row back up: revealedFeedIds, the ↗ jump
// highlight, and the At Playhead panel all key off it, so ids must stay dense and load-order stable.
// Shared by handleFile (app.js) and the golden pipeline test, so both exercise the same path.
export function eventsFromRows(rows) {
  const events = [];
  for (const cols of rows) {
    const ev = parseRow(cols);
    if (ev) { ev._id = events.length; events.push(ev); }
  }
  return events;
}

// Attribute zone events that lack a PG= field to the program that last ran that zone,
// so program filtering keeps each zone's start AND its stop/done/soak lines together.
// Mutates `progEff` on each event in `events`.
export function inferEffectivePrograms(events) {
  const order = events.map((e, i) => i).sort((a, b) => {
    const d = events[a].ts.getTime() - events[b].ts.getTime();
    return d !== 0 ? d : a - b;
  });
  const zoneProgram = Object.create(null);
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
