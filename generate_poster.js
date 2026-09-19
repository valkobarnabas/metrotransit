/**
 * Generate a European-style stop poster from Metro GTFS.
 * Usage: node generate_poster.js --route F --stop 6894
 *        node generate_poster.js --route ALL --stop 0010
 *        node generate_poster.js --route ALL+SCHOOL --stop 0716
 *        node generate_poster.js --route A,C,80 --stop 0716
 */
const isNode =
  typeof process !== "undefined" &&
  !!(process.versions && process.versions.node) &&
  typeof require === "function";
const fs = isNode ? require("fs") : null;
const path = isNode ? require("path") : null;
const QRCode = isNode ? require("qrcode") : typeof globalThis !== "undefined" ? globalThis.QRCode : null;

function parseArgs(argv) {
  const out = { route: "F", stop: "6894" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--route") out.route = argv[++i];
    else if (argv[i] === "--stop") out.stop = argv[++i];
  }
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
    return row;
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function parseYmd(s) {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

function formatDateRange(start, end) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const a = parseYmd(start);
  const b = parseYmd(end);
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]} ${b.getFullYear()}`;
}

function parseTime(t) {
  const [hh, mm, ss] = t.split(":").map(Number);
  return { hh, mm, ss, minutes: hh * 60 + mm };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mostCommon(counter) {
  const entries = Object.entries(counter);
  if (!entries.length) return "";
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function countBy(rows, key) {
  const acc = {};
  for (const r of rows) {
    const k = r[key];
    acc[k] = (acc[k] || 0) + 1;
  }
  return acc;
}

function titleDirection(name) {
  if (!name) return "";
  return String(name).charAt(0).toUpperCase() + String(name).slice(1);
}

const CARDINAL = {
  0: "northbound",
  90: "eastbound",
  180: "southbound",
  270: "westbound",
};

/** Street travel direction at the stop, e.g. "eastbound Allen". */
function streetDirectionLabel(stop) {
  const raw = String(stop.cardinal_direction ?? "").trim();
  const dir = raw === "" ? "" : CARDINAL[Number(raw)];
  const street = (stop.primary_street || "").trim();
  if (dir && street) return `${dir} ${street}`;
  return street || dir || "";
}

/** Bus headboard: A2 AMERICAN CENTER, not A 2-AMERICAN CENTER. */
function formatHeadboard(routeShortName, tripHeadsign) {
  const raw = String(tripHeadsign || "").trim();
  const branched = raw.match(/^(\d+)-(.+)$/);
  if (branched) {
    const num = branched[1];
    const dest = branched[2].trim();
    const code = /^[A-Za-z]$/.test(routeShortName) ? `${routeShortName}${num}` : num;
    return { code, dest: dest.toUpperCase().replace(/\./g, "") };
  }
  return { code: String(routeShortName), dest: raw.toUpperCase().replace(/\./g, "") };
}

function clockHour(h) {
  return ((h % 24) + 24) % 24;
}

function hour12(hh, mm, mode) {
  let h = hh;
  if (mode === "end" && mm >= 30) h += 1;
  const clock = clockHour(h);
  const hr = clock % 12 || 12;
  const ap = clock < 12 ? "am" : "pm";
  return `${hr}${ap}`;
}

function hourLabel24(h) {
  return String(h > 24 ? h - 24 : h);
}

function hourLabel12(h) {
  const clock = clockHour(h);
  const hr = clock % 12 || 12;
  const ap = clock < 12 ? "am" : "pm";
  return `${hr}<span class="ap">${ap}</span>`;
}

function spanLabel(deps) {
  if (!deps.length) return "";
  const first = deps[0];
  const last = deps[deps.length - 1];
  const a = hour12(first.hh, first.mm, "start");
  if (deps.length === 1) return a;
  const b = hour12(last.hh, last.mm, "end");
  return a === b ? a : `${a}–${b}`;
}

function isAfterMidnightDep(dep) {
  const h = Number(dep && dep.hh);
  if (!Number.isFinite(h)) return false;
  return h >= 24 || (h >= 0 && h < 4);
}

function isNightOnlyColumn(col) {
  const deps = (col && col.deps) || [];
  return deps.length > 0 && deps.every(isAfterMidnightDep);
}

function columnDayLabel(col) {
  let label = col.label;
  if (col.key === "weekday") label = "Monday–Friday";
  else if (col.key === "weekend") label = "Saturday–Sunday";
  else if (col.key === "frisat") label = "Friday–Saturday";
  else if (col.key === "mt") label = "Monday–Thursday";
  else if (col.key === "sunthu") label = "Sunday–Thursday";
  else if (col.key === "friday") label = "Fridays";
  else if (col.key === "saturday") label = "Saturdays";
  else if (col.key === "sunday") label = "Sundays";
  if (isNightOnlyColumn(col) && !/night/i.test(label)) label = `${label} Night`;
  return label;
}

function serviceCaption(direction, columns) {
  const parts = columns
    .map((col) => {
      const span = spanLabel(col.deps);
      if (!span) return "";
      return `${columnDayLabel(col)} ${span}`;
    })
    .filter(Boolean);
  const body = parts.join(", ");
  if (direction && body) return `${direction} ${body}`;
  if (body) return body;
  if (direction) return direction;
  return "";
}

function serviceCaptionHtml(direction, columns) {
  const parts = columns
    .map((col) => {
      const hours = spanLabel(col.deps);
      if (!hours) return "";
      return `<span class="days">${escapeHtml(columnDayLabel(col))}</span> <span class="hours">${escapeHtml(hours)}</span>`;
    })
    .filter(Boolean);
  const body = parts.join(", ");
  const dir = direction ? `<span class="dir">${escapeHtml(direction)}</span>` : "";
  if (dir && body) return `${dir} ${body}`;
  return dir || body || "";
}

function routeServiceNote(route) {
  const d = route.route_desc || "";
  return "";
}

const DEFAULT_POSTER_OPTS = {
  agencyName: "Metro Transit",
  showTo: true,
  headboardStyle: "led",
  footerBlurb:
    "This is a citizen-made timetable intended to improve accessibility, not an official Metro Transit bulletin. Holidays usually follow Sunday schedules.",
  sourceCheck: "Please check for detours and holidays at cityofmadison.com/metro.",
  qrUrlTemplate: "https://metromap.cityofmadison.com/predictions/bystop/bustime:{stop_code}",
  qrCaption: "Live departures\nfrom this stop",
  logoDataUri: "",
  findStopBy: "code",
  routeColors: {},
  fonts: {
    title: 26,
    kicker: 10,
    meta: 12,
    table: 13,
    footer: 9.5,
    board: 26,
  },
};

let POSTER_OPTS = {
  ...DEFAULT_POSTER_OPTS,
  fonts: { ...DEFAULT_POSTER_OPTS.fonts },
};

function setPosterOptions(opts) {
  const next = opts || {};
  POSTER_OPTS = {
    ...DEFAULT_POSTER_OPTS,
    ...next,
    fonts: { ...DEFAULT_POSTER_OPTS.fonts, ...(next.fonts || {}) },
    routeColors: next.routeColors || {},
  };
}

function posterOptions() {
  return POSTER_OPTS;
}

function resetPosterOptions() {
  POSTER_OPTS = { ...DEFAULT_POSTER_OPTS, fonts: { ...DEFAULT_POSTER_OPTS.fonts }, routeColors: {} };
}

let GTFS = null;
let GTFS_DIR = null;

function setGtfsDir(dir) {
  GTFS_DIR = dir || null;
  GTFS = null;
}

function setGtfs(bundle) {
  GTFS = bundle || null;
  if (!GTFS) return GTFS;
  if (!GTFS.timesByTrip || !GTFS.timesByStop) indexStopTimes(GTFS);
  if (!GTFS.routeByTrip && GTFS.trips) {
    GTFS.routeByTrip = new Map(GTFS.trips.map((t) => [t.trip_id, t.route_id]));
  }
  if (!GTFS.feed) GTFS.feed = {};
  if (!GTFS.calendar) GTFS.calendar = [];
  if (!GTFS.calDates) GTFS.calDates = [];
  GTFS.typical = null;
  return GTFS;
}

function indexStopTimes(g) {
  const timesByTrip = g.timesByTrip || new Map();
  const timesByStop = g.timesByStop || new Map();
  if (!g.timesByTrip || !g.timesByStop) {
    timesByTrip.clear();
    timesByStop.clear();
    for (const row of g.stopTimes || []) {
      let tripRows = timesByTrip.get(row.trip_id);
      if (!tripRows) timesByTrip.set(row.trip_id, (tripRows = []));
      tripRows.push(row);
      let stopRows = timesByStop.get(row.stop_id);
      if (!stopRows) timesByStop.set(row.stop_id, (stopRows = []));
      stopRows.push(row);
    }
  }
  g.timesByTrip = timesByTrip;
  g.timesByStop = timesByStop;
}

function readCsvFile(file) {
  if (!fs || !fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"));
}

function gtfsDir() {
  if (GTFS_DIR) return GTFS_DIR;
  if (!fs || !path) return ".";
  const here = __dirname;
  if (fs.existsSync(path.join(here, "stops.txt"))) return here;
  const parent = path.join(here, "..");
  if (fs.existsSync(path.join(parent, "stops.txt"))) return parent;
  return process.cwd();
}

function inferFeedDates(feed, calendar, calDates) {
  const out = { ...(feed || {}) };
  if (out.feed_start_date && out.feed_end_date) return out;
  let min = "99999999";
  let max = "00000000";
  for (const c of calendar || []) {
    if (c.start_date && c.start_date < min) min = c.start_date;
    if (c.end_date && c.end_date > max) max = c.end_date;
  }
  for (const d of calDates || []) {
    if (d.date && d.date < min) min = d.date;
    if (d.date && d.date > max) max = d.date;
  }
  if (min !== "99999999") out.feed_start_date = out.feed_start_date || min;
  if (max !== "00000000") out.feed_end_date = out.feed_end_date || max;
  return out;
}

function loadGtfs() {
  if (GTFS) return GTFS;
  const root = gtfsDir();
  const stops = parseCsv(fs.readFileSync(path.join(root, "stops.txt"), "utf8"));
  const routes = parseCsv(fs.readFileSync(path.join(root, "routes.txt"), "utf8"));
  const calendar = readCsvFile(path.join(root, "calendar.txt"));
  const calDates = readCsvFile(path.join(root, "calendar_dates.txt"));
  const feed = inferFeedDates(readCsvFile(path.join(root, "feed_info.txt"))[0] || {}, calendar, calDates);
  const agencies = readCsvFile(path.join(root, "agency.txt"));
  const trips = parseCsv(fs.readFileSync(path.join(root, "trips.txt"), "utf8"));
  const stopTimes = parseCsv(fs.readFileSync(path.join(root, "stop_times.txt"), "utf8"));
  const timesByTrip = new Map();
  const timesByStop = new Map();
  for (const row of stopTimes) {
    let tripRows = timesByTrip.get(row.trip_id);
    if (!tripRows) timesByTrip.set(row.trip_id, (tripRows = []));
    tripRows.push(row);
    let stopRows = timesByStop.get(row.stop_id);
    if (!stopRows) timesByStop.set(row.stop_id, (stopRows = []));
    stopRows.push(row);
  }
  GTFS = {
    stops,
    routes,
    calendar,
    calDates,
    feed,
    agencies,
    trips,
    timesByTrip,
    timesByStop,
    routeByTrip: new Map(trips.map((t) => [t.trip_id, t.route_id])),
  };
  return GTFS;
}

function typicalForFeed() {
  const g = loadGtfs();
  if (!g.typical) g.typical = typicalServiceIds(g.calendar, g.calDates, g.feed);
  return g.typical;
}

function servicesOnDate(d, calendar, calDates) {
  const date = ymd(d);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dow = days[d.getDay()];
  const active = new Set();
  for (const cal of calendar) {
    if (cal[dow] === "1" && cal.start_date <= date && date <= cal.end_date) {
      active.add(cal.service_id);
    }
  }
  for (const ex of calDates) {
    if (ex.date !== date) continue;
    if (ex.exception_type === "1") active.add(ex.service_id);
    else if (ex.exception_type === "2") active.delete(ex.service_id);
  }
  return [...active].sort((a, b) => String(a).localeCompare(String(b)));
}

function typicalServiceIds(calendar, calDates, feed) {
  const span = inferFeedDates(feed, calendar, calDates);
  if (!span.feed_start_date || !span.feed_end_date) {
    const empty = {};
    for (const n of ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]) {
      empty[n] = new Set();
      empty[`${n}Reduced`] = new Set();
    }
    return empty;
  }
  const start = parseYmd(span.feed_start_date);
  const end = parseYmd(span.feed_end_date);
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const byDow = Object.fromEntries(names.map((n) => [n, {}]));
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const combo = servicesOnDate(d, calendar, calDates).join(",");
    if (!combo) continue;
    const key = names[d.getDay()];
    byDow[key][combo] = (byDow[key][combo] || 0) + 1;
  }
  function pick(bucket) {
    if (!Object.keys(bucket).length) return new Set();
    return new Set(mostCommon(bucket).split(",").filter(Boolean));
  }
  function pickReduced(bucket) {
    const entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
    if (entries.length < 2 || entries[1][1] < 2) return new Set();
    return new Set(entries[1][0].split(",").filter(Boolean));
  }
  const out = {};
  for (const n of names) {
    out[n] = pick(byDow[n]);
    out[`${n}Reduced`] = pickReduced(byDow[n]);
  }
  return out;
}

function timesEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.hh === b[i].hh && r.mm === b[i].mm);
}

function serviceDayFlags(calendarRow) {
  if (!calendarRow) {
    return { monday: false, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: false, sunday: false };
  }
  return {
    monday: calendarRow.monday === "1",
    tuesday: calendarRow.tuesday === "1",
    wednesday: calendarRow.wednesday === "1",
    thursday: calendarRow.thursday === "1",
    friday: calendarRow.friday === "1",
    saturday: calendarRow.saturday === "1",
    sunday: calendarRow.sunday === "1",
  };
}

function uniqueTimes(deps) {
  const seen = new Map();
  for (const r of deps) {
    const k = `${r.hh}:${r.mm}`;
    const prev = seen.get(k);
    if (!prev) {
      seen.set(k, r);
      continue;
    }
    seen.set(k, {
      ...prev,
      ...r,
      sessionOnly: !!(prev.sessionOnly || r.sessionOnly),
      noteStar: !!(prev.noteStar || r.noteStar),
    });
  }
  return [...seen.values()];
}

function markSessionOnly(deps, reducedDeps) {
  if (!deps.length || !reducedDeps.length) return deps.map((r) => ({ ...r, sessionOnly: false }));
  const reduced = new Set(reducedDeps.map((r) => `${r.hh}:${r.mm}`));
  const marked = deps.map((r) => ({ ...r, sessionOnly: !reduced.has(`${r.hh}:${r.mm}`) }));
  if (marked.every((r) => r.sessionOnly)) return deps.map((r) => ({ ...r, sessionOnly: false }));
  return marked;
}

function labelDayCluster(days) {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const set = new Set(days);
  const seq = order.filter((d) => set.has(d));
  const key = seq.join("-");
  const names = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
    Sun: "Sunday",
  };
  if (key === "Mon-Tue-Wed-Thu-Fri") return { key: "weekday", label: "Monday–Friday", sub: "" };
  if (key === "Sat-Sun") return { key: "weekend", label: "Saturday–Sunday", sub: "" };
  if (key === "Fri-Sat") return { key: "frisat", label: "Friday–Saturday", sub: "" };
  if (key === "Mon-Tue-Wed-Thu") return { key: "mt", label: "Monday–Thursday", sub: "" };
  if (key === "Sun-Mon-Tue-Wed-Thu" || (set.has("Sun") && set.has("Mon") && set.has("Tue") && set.has("Wed") && set.has("Thu") && !set.has("Fri") && !set.has("Sat"))) {
    return { key: "sunthu", label: "Sunday–Thursday", sub: "" };
  }
  if (seq.length === 1) return { key: seq[0].toLowerCase(), label: names[seq[0]], sub: "" };
  if (seq.length === 7) return { key: "daily", label: "Daily", sub: "" };
  return { key: seq.join("").toLowerCase(), label: `${names[seq[0]]}–${names[seq[seq.length - 1]]}`, sub: "" };
}

const CLOSE_TERMINUS_PAIRS = [
  {
    route: "C",
    boardDest: "UW HOSPITAL",
    direction: /westbound/i,
    dayCode: "2091",
    eveningCode: "2916",
    displayName: "Observatory at Highland",
    destNote: {
      type: "terminus",
      lead: "Trips on weekdays after 7pm and on weekends terminate at southbound ",
      stopName: "Highland at Observatory",
      stopCode: "2916",
    },
    footnote:
      "Trips on weekdays after 7pm and on weekends terminate at southbound Highland at Observatory (Stop #2916).",
  },
  {
    route: "F",
    direction: /westbound/i,
    dayCode: "10001",
    eveningCode: "10004",
    displayName: "Junction",
    destNote: {
      type: "terminus",
      lead: "Trips on weekdays after 8pm and on weekends terminate at ",
      stopName: "Junction at Park And Ride",
      stopCode: "10004",
    },
    footnote:
      "Trips on weekdays after 8pm and on weekends terminate at Junction at Park And Ride (Stop #10004).",
  },
];

/** Westbound A: East Springs through Junction, plus High Crossing at E Springs (#9624). */
const A_WESTBOUND_FROM_HIGH_CROSSING_E_SPRINGS = new Set([
  "9624",
  "10137",
  "10133",
  "10129",
  "10125",
  "10121",
  "10117",
  "10113",
  "10109",
  "10105",
  "10101",
  "10097",
  "10093",
  "10089",
  "10085",
  "10081",
  "10077",
  "10069",
  "10061",
  "10057",
  "10053",
  "10049",
  "10045",
  "10041",
  "10037",
  "10033",
  "10029",
  "10025",
  "10021",
  "10017",
  "10013",
  "10001",
]);

/** Eastbound A2: Eastpark spur after High Crossing, through to the garage. */
const A_EASTBOUND_EASTPARK = new Set(["9330", "9906", "9584", "9115", "9717", "9300"]);

function viaHeadsignMerge(route, direction, keepDest, foldDest, stopCodes, displayName) {
  return {
    route,
    direction,
    keepDest,
    foldDest,
    displayName,
    destNote: {
      type: "headsign",
      lead: "Marked trips from this stop follow the same route but operate under the headsign ",
      headsign: foldDest,
    },
    footnote: `Marked trips from this stop follow the same route but operate under the headsign ${foldDest}.`,
    starTerminus: false,
    stopCodes,
  };
}

const HEADSIGN_MERGES = [
  viaHeadsignMerge("A", /westbound/i, "JUNCTION", "JUNCTION VIA HIGH CROSSING", A_WESTBOUND_FROM_HIGH_CROSSING_E_SPRINGS, "Junction"),
  viaHeadsignMerge("A", /eastbound/i, "AMERICAN CENTER", "AMERICAN CENTER VIA HIGH CROSSING", A_EASTBOUND_EASTPARK),
];

function matchingTerminusRule(a, b) {
  if (!a || !b) return null;
  if ((a.routeDirection || "") !== (b.routeDirection || "")) return null;
  if ((a.board && a.board.code) !== (b.board && b.board.code)) return null;
  if ((a.board && a.board.dest) !== (b.board && b.board.dest)) return null;
  const routeA = String(a.routeShortName || "").toUpperCase();
  const routeB = String(b.routeShortName || "").toUpperCase();
  const codes = new Set([String(a.destCode || ""), String(b.destCode || "")]);
  for (const rule of CLOSE_TERMINUS_PAIRS) {
    if (routeA !== rule.route || routeB !== rule.route) continue;
    if (rule.boardDest && ((a.board && a.board.dest) !== rule.boardDest || (b.board && b.board.dest) !== rule.boardDest)) {
      continue;
    }
    if (rule.direction && !rule.direction.test(a.routeDirection || "")) continue;
    if (codes.has(rule.dayCode) && codes.has(rule.eveningCode)) return rule;
  }
  return null;
}

function markColumnDeps(columns, extra) {
  return (columns || []).map((col) => ({
    ...col,
    deps: (col.deps || []).map((d) => ({ ...d, ...extra })),
  }));
}

function boardDestOf(h) {
  return String((h && h.board && h.board.dest) || "").toUpperCase();
}

function headingStopCode(h, stop) {
  if (h && h.hereCode) return String(h.hereCode);
  if (stop) return String(publicStopCode(stop) || stop.stop_code || "");
  return "";
}

function matchingHeadsignRule(a, b, stop) {
  if (!a || !b) return null;
  if ((a.routeDirection || "") !== (b.routeDirection || "")) return null;
  if ((a.board && a.board.code) !== (b.board && b.board.code)) return null;
  const routeA = String(a.routeShortName || "").toUpperCase();
  const routeB = String(b.routeShortName || "").toUpperCase();
  const dests = new Set([boardDestOf(a), boardDestOf(b)]);
  const code = headingStopCode(a, stop) || headingStopCode(b, stop);
  for (const rule of HEADSIGN_MERGES) {
    if (routeA !== rule.route || routeB !== rule.route) continue;
    if (rule.direction && !rule.direction.test(a.routeDirection || "")) continue;
    if (!dests.has(rule.keepDest) || !dests.has(rule.foldDest)) continue;
    if (rule.stopCodes && !rule.stopCodes.has(code)) continue;
    return rule;
  }
  return null;
}

function mergeHeadingColumns(aCols, bCols) {
  const out = (aCols || []).map((col) => ({ ...col, deps: (col.deps || []).slice() }));
  for (const col of bCols || []) {
    const i = out.findIndex((c) => c.key === col.key || c.label === col.label);
    if (i < 0) {
      out.push({ ...col, deps: (col.deps || []).slice() });
      continue;
    }
    out[i] = {
      ...out[i],
      deps: uniqueTimes(
        [...out[i].deps, ...(col.deps || [])].sort(
          (x, y) => x.hh - y.hh || x.mm - y.mm || (x.sessionOnly ? 1 : 0) - (y.sessionOnly ? 1 : 0)
        )
      ),
      days: [...new Set([...(out[i].days || []), ...(col.days || [])])],
    };
  }
  return out;
}

function mergePairedTermini(day, evening, rule) {
  const columns = mergeHeadingColumns(day.columns, evening.columns);
  const earliestA = day.earliest != null ? day.earliest : 99 * 60;
  const earliestB = evening.earliest != null ? evening.earliest : 99 * 60;
  return {
    ...day,
    dest: rule.displayName,
    destCode: rule.dayCode,
    destFootnote: rule.footnote,
    destNote: rule.destNote || null,
    starTerminus: rule.starTerminus !== false,
    columns,
    weekdayCount: (day.weekdayCount || 0) + (evening.weekdayCount || 0),
    earliest: Math.min(earliestA, earliestB),
    hasSessionOnly: !!(day.hasSessionOnly || evening.hasSessionOnly),
  };
}

function mergeHeadsignPair(keep, fold, rule) {
  const columns = mergeHeadingColumns(keep.columns, markColumnDeps(fold.columns, { noteStar: true }));
  const earliestA = keep.earliest != null ? keep.earliest : 99 * 60;
  const earliestB = fold.earliest != null ? fold.earliest : 99 * 60;
  return {
    ...keep,
    dest: rule.displayName || keep.dest,
    destFootnote: rule.footnote,
    destNote: rule.destNote || null,
    starTerminus: rule.starTerminus !== false,
    columns,
    weekdayCount: (keep.weekdayCount || 0) + (fold.weekdayCount || 0),
    earliest: Math.min(earliestA, earliestB),
    hasSessionOnly: !!(keep.hasSessionOnly || fold.hasSessionOnly),
  };
}

function mergeCloseTermini(headings, stop) {
  if (POSTER_OPTS.agencyName !== "Metro Transit") return headings || [];
  const list = headings || [];
  const used = new Set();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    let pair = -1;
    let rule = null;
    let kind = null;
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(j)) continue;
      rule = matchingTerminusRule(list[i], list[j]);
      if (rule) {
        pair = j;
        kind = "terminus";
        break;
      }
      rule = matchingHeadsignRule(list[i], list[j], stop);
      if (rule) {
        pair = j;
        kind = "headsign";
        break;
      }
    }
    if (pair < 0) {
      out.push(list[i]);
      continue;
    }
    used.add(pair);
    const a = list[i];
    const b = list[pair];
    if (kind === "headsign") {
      const keep = boardDestOf(a) === rule.keepDest ? a : b;
      const fold = boardDestOf(a) === rule.foldDest ? a : b;
      out.push(mergeHeadsignPair(keep, fold, rule));
      continue;
    }
    const day = a.destCode === rule.dayCode ? a : b;
    const evening = a.destCode === rule.eveningCode ? a : b;
    out.push(mergePairedTermini(day, evening, rule));
  }
  return out;
}

function parseBoardSort(h) {
  const raw = String((h.board && h.board.code) || h.routeShortName || "");
  const letter = raw.match(/^([A-Za-z]+)(\d*)$/);
  if (letter) {
    return {
      kind: 0,
      base: letter[1].toUpperCase(),
      variant: letter[2] === "" ? Number.POSITIVE_INFINITY : Number(letter[2]),
    };
  }
  const numbered = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (numbered) {
    return { kind: 1, base: numbered[1].padStart(4, "0"), variant: 0 };
  }
  return { kind: 2, base: raw.toUpperCase(), variant: 0 };
}

function columnDayCount(col) {
  if (col.days && col.days.length) return col.days.length;
  const k = String(col.key || "");
  if (k === "weekday" || k === "sunthu") return 5;
  if (k === "mt") return 4;
  if (k === "weekend" || k === "frisat") return 2;
  if (k === "daily") return 7;
  return 1;
}

function headingTripWeight(h) {
  return (h.columns || []).reduce((n, col) => n + (col.deps || []).length * columnDayCount(col), 0);
}

function isSchoolHeading(h) {
  if (h && h.school === true) return true;
  const name = String((h && h.routeShortName) || "");
  return /^6[0-4]$/.test(name);
}

function headingFamilyKey(h) {
  const r = parseBoardSort(h);
  return [isSchoolHeading(h) ? 1 : 0, r.kind, r.base, String(h.routeDirection || "").toLowerCase()].join("\t");
}

function isSparseHeading(h, familyMax) {
  const w = headingTripWeight(h);
  if (familyMax <= 0) return false;
  if (w >= familyMax * 0.35) return false;
  return w < 15 || w < familyMax * 0.2;
}

function compareHeadings(a, b, familyMax) {
  const sa = isSchoolHeading(a) ? 1 : 0;
  const sb = isSchoolHeading(b) ? 1 : 0;
  if (sa !== sb) return sa - sb;
  const ra = parseBoardSort(a);
  const rb = parseBoardSort(b);
  if (ra.kind !== rb.kind) return ra.kind - rb.kind;
  if (ra.base !== rb.base) return ra.base.localeCompare(rb.base, "en");
  const da = String(a.routeDirection || "").toLowerCase();
  const db = String(b.routeDirection || "").toLowerCase();
  if (da !== db) return da.localeCompare(db, "en");
  const max = familyMax || new Map();
  const sparseA = isSparseHeading(a, max.get(headingFamilyKey(a)) || 0) ? 1 : 0;
  const sparseB = isSparseHeading(b, max.get(headingFamilyKey(b)) || 0) ? 1 : 0;
  if (sparseA !== sparseB) return sparseA - sparseB;
  const wa = headingTripWeight(a);
  const wb = headingTripWeight(b);
  if (sparseA && sparseB && wa !== wb) return wb - wa;
  if (ra.variant !== rb.variant) return ra.variant - rb.variant;
  if (wa !== wb) return wb - wa;
  return String((a.board && a.board.dest) || a.dest || "").localeCompare(
    String((b.board && b.board.dest) || b.dest || ""),
    "en"
  );
}

function sortHeadings(headings) {
  const list = (headings || []).slice();
  const familyMax = new Map();
  for (const h of list) {
    const k = headingFamilyKey(h);
    familyMax.set(k, Math.max(familyMax.get(k) || 0, headingTripWeight(h)));
  }
  return list.sort((a, b) => compareHeadings(a, b, familyMax));
}

function mergeDaySchedules(monThu, friday, saturday, sunday) {
  const groups = [
    { days: ["Mon", "Tue", "Wed", "Thu"], deps: monThu },
    { days: ["Fri"], deps: friday },
    { days: ["Sat"], deps: saturday },
    { days: ["Sun"], deps: sunday },
  ];
  const buckets = [];
  for (const g of groups) {
    if (!g.deps.length) continue;
    const match = buckets.find((b) => timesEqual(b.deps, g.deps));
    if (match) match.days.push(...g.days);
    else buckets.push({ days: [...g.days], deps: g.deps });
  }
  const rank = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  buckets.sort((a, b) => Math.min(...a.days.map((d) => rank[d])) - Math.min(...b.days.map((d) => rank[d])));
  return buckets.map((b) => {
    const named = labelDayCluster(b.days);
    return { ...named, deps: b.deps, days: b.days };
  });
}

function collectPosterData(routeId, stopCode) {
  const { stops, routes, calendar, feed, trips, timesByTrip, timesByStop } = loadGtfs();
  const stop = findStop(stopCode);
  const route = routes.find(
    (r) => r.route_id === String(routeId) || r.route_short_name.toLowerCase() === String(routeId).toLowerCase()
  );
  if (!route) throw new Error(`Route ${routeId} not found`);

  const calendarById = Object.fromEntries(calendar.map((c) => [c.service_id, c]));
  const routeTrips = {};
  for (const t of trips) {
    if (t.route_id === route.route_id) routeTrips[t.trip_id] = t;
  }
  if (!Object.keys(routeTrips).length) throw new Error(`No trips for route ${routeId}`);

  const atStop = [];
  for (const row of timesByStop.get(stop.stop_id) || []) {
    if (routeTrips[row.trip_id]) atStop.push(row);
  }
  if (!atStop.length) throw new Error(`Route ${route.route_short_name} does not serve stop ${publicStopCode(stop)}`);

  const stopById = Object.fromEntries(stops.map((s) => [s.stop_id, s]));
  const typical = typicalForFeed();

  const records = [];
  for (const st of atStop) {
    if (st.pickup_type === "1") continue;
    const trip = routeTrips[st.trip_id];
    const seq = (timesByTrip.get(st.trip_id) || [])
      .slice()
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const idx = seq.findIndex(
      (r) => r.stop_id === stop.stop_id && String(r.stop_sequence) === String(st.stop_sequence)
    );
    if (idx < 0) continue;
    const remaining = seq.slice(idx + 1);
    const nextStops = remaining
      .map((r) => {
        const s = stopById[r.stop_id];
        return s ? { name: s.stop_name, code: s.stop_code || "" } : null;
      })
      .filter(Boolean);
    const last = nextStops.length ? nextStops[nextStops.length - 1] : { name: stop.stop_name, code: stop.stop_code };
    const lastName = last.name;
    const beforeDest = nextStops.length ? nextStops.slice(0, -1) : [];
    const intermediates = beforeDest.slice(0, 3);
    const time = parseTime(st.departure_time);
    const headsign = (st.stop_headsign || trip.trip_headsign || "").trim();
    const direction = trip.trip_direction_name || "";
    const lastSt = remaining.length ? remaining[remaining.length - 1] : null;
    let travelMinutes = 0;
    if (lastSt) {
      const destT = parseTime(lastSt.arrival_time || lastSt.departure_time);
      travelMinutes = destT.minutes - time.minutes;
      if (travelMinutes < 0) travelMinutes += 24 * 60;
    }
    const pathKey = [
      headsign,
      trip.direction_id || "",
      direction,
      lastName,
      intermediates.map((s) => s.name).join("|"),
    ].join("\t");
    records.push({
      service_id: trip.service_id,
      headsign,
      direction,
      pathKey,
      hh: time.hh,
      mm: time.mm,
      here: stop.stop_name,
      next3: intermediates,
      dest: lastName,
      destCode: last.code || "",
      remainingCount: nextStops.length,
      travelMinutes,
      skippedAfter: beforeDest.length > 3,
    });
  }
  if (!records.length) throw new Error(`No pickup trips for route ${route.route_short_name} at stop ${publicStopCode(stop)}`);

  function dayDepartures(serviceSet, pathKey) {
    return uniqueTimes(
      records
        .filter((r) => serviceSet.has(r.service_id) && r.pathKey === pathKey)
        .sort((a, b) => a.hh - b.hh || a.mm - b.mm)
    );
  }

  function fallbackByCalendar(pathKey, which) {
    return uniqueTimes(
      records
        .filter((r) => {
          if (r.pathKey !== pathKey) return false;
          const flags = serviceDayFlags(calendarById[r.service_id]);
          return flags[which];
        })
        .sort((a, b) => a.hh - b.hh || a.mm - b.mm)
    );
  }

  const headingKeys = [...new Set(records.map((r) => r.pathKey))];
  const headings = headingKeys
    .map((key) => {
      const group = records.filter((r) => r.pathKey === key);
      const headsign = group[0].headsign;
      const direction = group[0].direction;
      let monThu = dayDepartures(typical.tuesday, key);
      let friday = dayDepartures(typical.friday, key);
      let saturday = dayDepartures(typical.saturday, key);
      let sunday = dayDepartures(typical.sunday, key);
      if (!monThu.length && !friday.length && !saturday.length && !sunday.length) {
        monThu = fallbackByCalendar(key, "tuesday");
        friday = fallbackByCalendar(key, "friday");
        saturday = fallbackByCalendar(key, "saturday");
        sunday = fallbackByCalendar(key, "sunday");
      }
      monThu = markSessionOnly(monThu, dayDepartures(typical.tuesdayReduced, key));
      friday = markSessionOnly(friday, dayDepartures(typical.fridayReduced, key));
      saturday = markSessionOnly(saturday, dayDepartures(typical.saturdayReduced, key));
      sunday = markSessionOnly(sunday, dayDepartures(typical.sundayReduced, key));
      const colors = resolveRouteColors(route);
      const dest = mostCommon(countBy(group, "dest")) || group[0].dest;
      const destCode =
        mostCommon(
          group
            .filter((r) => r.dest === dest)
            .reduce((acc, r) => {
              if (r.destCode) acc[r.destCode] = (acc[r.destCode] || 0) + 1;
              return acc;
            }, {})
        ) ||
        group[0].destCode ||
        "";
      const next3 = mostCommon(
        group.reduce((acc, r) => {
          const k = r.next3.map((s) => `${s.name}\t${s.code || ""}`).join(" | ");
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {})
      )
        .split(" | ")
        .filter(Boolean)
        .map((p) => {
          const [name, code] = p.split("\t");
          return { name, code: code || "" };
        });
      const skippedAfter = group.filter((r) => r.skippedAfter).length > group.length / 2;
      const remainingCount = Number(mostCommon(countBy(group, "remainingCount")) || 0);
      const travelSamples = group.map((r) => r.travelMinutes).filter((n) => n > 0);
      const avgTravelMinutes = travelSamples.length
        ? Math.round(travelSamples.reduce((a, b) => a + b, 0) / travelSamples.length)
        : 0;
      const columns = mergeDaySchedules(monThu, friday, saturday, sunday);
      if (!columns.length) return null;
      const board = formatHeadboard(route.route_short_name, headsign);
      const earliest = columns[0].deps[0];
      const hasSessionOnly = columns.some((c) => c.deps.some((r) => r.sessionOnly));
      return {
        headsign,
        board,
        routeDirection: titleDirection(direction),
        here: stop.stop_name,
        hereCode: publicStopCode(stop),
        next3,
        dest,
        destCode,
        remainingCount,
        avgTravelMinutes,
        skippedAfter,
        columns,
        weekdayCount: monThu.length + friday.length,
        earliest: earliest ? earliest.hh * 60 + earliest.mm : 99 * 60,
        hasSessionOnly,
        routeColor: colors.bg,
        routeTextColor: colors.ink,
        routeShortName: route.route_short_name,
        school: isSchoolSupplement(route),
      };
    })
    .filter(Boolean);

  const mergedHeadings = sortHeadings(mergeCloseTermini(headings, stop));

  return {
    stop,
    route,
    routes: [route],
    feed,
    headings: mergedHeadings,
    direction: mostCommon(countBy(records, "direction")),
  };
}

function publicStopCode(stop) {
  const code = String(stop.stop_code || "").trim();
  return code || stop.stop_id;
}

function hexColor(value, fallback) {
  const s = String(value || "").replace(/^#/, "").trim();
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s}`;
  return fallback;
}

function resolveRouteColors(route) {
  const ov = (POSTER_OPTS.routeColors || {})[route.route_short_name] || (POSTER_OPTS.routeColors || {})[route.route_id];
  const fallbackBg = hexColor(route.route_color, "#333366");
  const fallbackInk = hexColor(route.route_text_color, "#FFFFFF");
  if (typeof ov === "string") return { bg: hexColor(ov, fallbackBg), ink: fallbackInk };
  if (ov && typeof ov === "object") {
    return {
      bg: hexColor(ov.bg || ov.color, fallbackBg),
      ink: hexColor(ov.text || ov.ink, fallbackInk),
    };
  }
  return { bg: fallbackBg, ink: fallbackInk };
}

function findStop(stopCode) {
  const { stops } = loadGtfs();
  const want = String(stopCode);
  let stop = stops.find((s) => s.stop_code === want);
  if (!stop && POSTER_OPTS.findStopBy === "codeOrId") {
    stop = stops.find((s) => s.stop_id === want);
  }
  if (!stop) throw new Error(`Stop ${stopCode} not found`);
  return stop;
}

function routesServingStop(stop) {
  const { routes, timesByStop, routeByTrip } = loadGtfs();
  const ids = new Set();
  for (const row of timesByStop.get(stop.stop_id) || []) {
    const rid = routeByTrip.get(row.trip_id);
    if (rid) ids.add(rid);
  }
  return routes
    .filter((r) => ids.has(r.route_id))
    .sort(
      (a, b) =>
        Number(a.route_sort_order || 0) - Number(b.route_sort_order || 0) ||
        String(a.route_short_name || "").localeCompare(String(b.route_short_name || ""), undefined, { numeric: true })
    );
}

/** School extras (60–64): limited AM/PM trips, no service on public-school recess/holidays. */
function isSchoolSupplement(route) {
  const desc = route.route_desc || "";
  const longName = route.route_long_name || "";
  return /public school/i.test(desc) || /extras/i.test(longName);
}

function routeArgTokens(routeArg) {
  return String(routeArg || "")
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveRouteList(routeArg, stop) {
  const raw = String(routeArg || "").trim();
  if (!raw) return [];
  const parts = routeArgTokens(raw);
  const flags = new Set(parts.map((s) => s.toUpperCase()));
  const serving = routesServingStop(stop);
  if (flags.has("ALL")) {
    if (flags.has("SCHOOL")) return serving;
    const regular = serving.filter((r) => !isSchoolSupplement(r));
    if (!regular.length && serving.length) {
      throw new Error(
        `Stop ${stop.stop_code} is only served by school supplement routes; use --route ALL+SCHOOL or a specific route`
      );
    }
    return regular;
  }
  if (parts.length <= 1) return [];
  const want = new Set(parts.map((s) => s.toLowerCase()));
  const picked = serving.filter(
    (r) => want.has(r.route_short_name.toLowerCase()) || want.has(r.route_id.toLowerCase())
  );
  if (!picked.length) throw new Error(`None of [${parts.join(", ")}] serve stop ${stop.stop_code}`);
  return picked;
}

function headingsFromParts(parts) {
  return (parts || []).flatMap((p) =>
    (p.headings || []).map((h) => ({
      ...h,
      school: !!(h.school || p.school || (p.route && isSchoolSupplement(p.route))),
    }))
  );
}

function collectMultiPosterData(routeList, stopCode) {
  const parts = [];
  for (const r of routeList) {
    try {
      parts.push(collectPosterData(r.route_short_name, stopCode));
    } catch {
      /* route listed but no pickups at this stop */
    }
  }
  if (!parts.length) throw new Error(`No pickup trips at stop ${stopCode} for those routes`);
  const headings = sortHeadings(mergeCloseTermini(headingsFromParts(parts), parts[0].stop));
  const notes = [...new Set(parts.map((p) => routeServiceNote(p.route)).filter(Boolean))];
  return {
    stop: parts[0].stop,
    route: parts[0].route,
    routes: parts.map((p) => p.route),
    feed: parts[0].feed,
    headings,
    routeNote: notes.join(" "),
    multi: parts.length > 1,
  };
}

function mergePosterParts(parts) {
  if (!parts.length) throw new Error("No routes selected");
  const headings = sortHeadings(mergeCloseTermini(headingsFromParts(parts), parts[0].stop));
  if (parts.length === 1) {
    const p = parts[0];
    return {
      ...p,
      headings,
      routes: p.routes && p.routes.length ? p.routes : [p.route],
      multi: false,
    };
  }
  const notes = [...new Set(parts.map((p) => p.routeNote || routeServiceNote(p.route)).filter(Boolean))];
  return {
    stop: parts[0].stop,
    route: parts[0].route,
    routes: parts.map((p) => p.route),
    feed: parts[0].feed,
    headings,
    routeNote: notes.join(" "),
    multi: true,
    qrSvg: parts[0].qrSvg,
  };
}

function routeListPhrase(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

function timetableKicker(routes) {
  const names = routes.map((r) => r.route_short_name);
  const agency = POSTER_OPTS.agencyName || "Metro Transit";
  if (names.length <= 1) return `${agency} Route ${names[0]} departures`;
  return `${agency} Route ${routeListPhrase(names)} departures`;
}

function badgeGrid(n) {
  const maxW = 2.95;
  const gap = 0.04;
  const minSize = 0.48;
  if (n <= 1) return { cols: 1, size: 0.92, gap };
  if (n === 2) return { cols: 2, size: 0.86, gap };
  if (n === 3) return { cols: 3, size: 0.78, gap };
  const preferred = 0.68;
  const fit = (cols) => Math.min(preferred, (maxW - Math.max(0, cols - 1) * gap) / cols);
  let cols = Math.ceil(n / 2);
  let size = fit(cols);
  if (size < minSize) {
    cols = Math.ceil(n / 3);
    size = fit(cols);
  }
  return { cols, size, gap };
}

function routeBadge(route, grid) {
  const name = route.route_short_name;
  const { bg, ink } = resolveRouteColors(route);
  let font = name.length > 2 ? 42 : name.length > 1 ? 56 : 72;
  font = Math.max(11, Math.round(font * (grid.size / 0.92)));
  return `<div class="badge" style="background:${bg};color:${ink};width:${grid.size}in;height:${grid.size}in;font-size:${font}px" aria-label="Route ${escapeHtml(name)}">${escapeHtml(name)}</div>`;
}

function groupByHour(deps) {
  const map = new Map();
  for (const r of deps) {
    if (!map.has(r.hh)) map.set(r.hh, []);
    map.get(r.hh).push(r);
  }
  return map;
}

function hourSet(columns, fillGaps = false) {
  const s = new Set();
  for (const col of columns) for (const r of col.deps) s.add(r.hh);
  const hours = [...s].sort((a, b) => a - b);
  if (!fillGaps || hours.length <= 1) return hours;
  const out = [];
  for (let h = hours[0]; h <= hours[hours.length - 1]; h++) out.push(h);
  return out;
}

function minsHtml(list) {
  if (!list || !list.length) return `<span class="empty">-</span>`;
  return list
    .map((r) => {
      const star = r.sessionOnly || r.noteStar ? `<sup class="uw">*</sup>` : "";
      return `<span class="min">${String(r.mm).padStart(2, "0")}${star}</span>`;
    })
    .join("");
}

function formatRideDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function rideTimeCaption(heading) {
  const stops = Number(heading.remainingCount) || 0;
  if (!stops) return "";
  const noun = stops === 1 ? "stop" : "stops";
  const time = heading.avgTravelMinutes ? ` and ~${formatRideDuration(heading.avgTravelMinutes)}` : "";
  return `${stops} ${noun}${time} to final stop`;
}

function wrapLabel(name) {
  if (!name) return "";
  if (name.length > 16 && name.includes(" at ")) {
    const i = name.indexOf(" at ");
    return `${escapeHtml(name.slice(0, i + 3))}<br />${escapeHtml(name.slice(i + 4))}`;
  }
  return escapeHtml(name);
}

function stopNodeName(n) {
  if (!n) return "";
  return typeof n === "string" ? n : n.name || "";
}

function stopNodeCode(n) {
  return typeof n === "string" ? "" : n.code || "";
}

function headingNodes(heading) {
  const nodes = [{ type: "here", name: heading.here }];
  for (const n of heading.next3 || []) {
    nodes.push({ type: "next", name: stopNodeName(n), code: stopNodeCode(n) });
  }
  if (heading.remainingCount > 0 && heading.dest) {
    nodes.push({
      type: "terminus",
      name: heading.dest,
      code: heading.destCode || "",
      star: heading.starTerminus !== false && !!heading.destFootnote,
    });
  } else if (nodes.length === 1) {
    nodes[0].type = "terminus";
  }
  return nodes;
}

function nodeXs(n, w, pad) {
  if (n <= 1) return [w / 2];
  return Array.from({ length: n }, (_, i) => pad + (i * (w - pad * 2)) / (n - 1));
}

function spineSvg(heading, nodes) {
  const w = 740;
  const mid = 38;
  const pad = 46;
  const n = nodes.length;
  const xs = nodeXs(n, w, pad);

  const parts = [];
  if (n > 1) {
    const shaft = 50;
    const head = 6.5;
    const xA = xs[0] + 22;
    const xB = xA + shaft;
    const ay = 14;
    const cx = (xA + xB) / 2;
    parts.push(
      `<text x="${cx}" y="11" text-anchor="middle" fill="#111" font-size="8" font-family="IBM Plex Sans, Segoe UI, sans-serif" font-weight="600" letter-spacing="0.04em">Next Stops</text>`
    );
    parts.push(`<line x1="${xA}" y1="${ay}" x2="${xB}" y2="${ay}" stroke="#111" stroke-width="1.2"/>`);
    parts.push(
      `<path d="M${xB} ${ay - 3.1} L${xB + head} ${ay} L${xB} ${ay + 3.1} Z" fill="#111"/>`
    );
    const ride = rideTimeCaption(heading);
    if (ride) {
      const tx = xs[n - 1] + 11;
      parts.push(
        `<text x="${tx}" y="11" text-anchor="end" fill="#111" font-size="8.5" font-family="IBM Plex Sans, Segoe UI, sans-serif" font-weight="600" letter-spacing="0.04em">${escapeHtml(ride)}</text>`
      );
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const skip = nodes[i + 1].type === "terminus" && heading.skippedAfter;
    const x1 = xs[i];
    const x2 = xs[i + 1];
    if (skip) {
      const midX = (x1 + x2) / 2;
      const gap = 26;
      parts.push(
        `<line x1="${x1}" y1="${mid}" x2="${midX - gap}" y2="${mid}" stroke="var(--route)" stroke-width="8" stroke-linecap="round"/>`
      );
      parts.push(
        `<line x1="${midX + gap}" y1="${mid}" x2="${x2}" y2="${mid}" stroke="var(--route)" stroke-width="8" stroke-linecap="round"/>`
      );
      for (const dx of [-10, 0, 10]) {
        parts.push(`<circle cx="${midX + dx}" cy="${mid}" r="2.6" fill="var(--route)"/>`);
      }
    } else {
      parts.push(
        `<line x1="${x1}" y1="${mid}" x2="${x2}" y2="${mid}" stroke="var(--route)" stroke-width="8" stroke-linecap="round"/>`
      );
    }
  }

  nodes.forEach((node, i) => {
    const x = xs[i];
    if (node.type === "here") {
      parts.push(`<circle cx="${x}" cy="${mid}" r="16.5" fill="#fff" stroke="var(--route)" stroke-width="4"/>`);
      parts.push(`<circle cx="${x}" cy="${mid}" r="7.5" fill="var(--route)"/>`);
    } else if (node.type === "terminus") {
      parts.push(`<rect x="${x - 11}" y="${mid - 11}" width="22" height="22" rx="2" fill="var(--route)"/>`);
      parts.push(`<rect x="${x - 4.5}" y="${mid - 4.5}" width="9" height="9" fill="#fff"/>`);
    } else {
      parts.push(`<circle cx="${x}" cy="${mid}" r="8" fill="#fff" stroke="var(--route)" stroke-width="3.5"/>`);
    }
  });

  return `<svg class="spine" viewBox="0 0 ${w} 64" aria-hidden="true">${parts.join("")}</svg>`;
}

function diagramHtml(heading) {
  const nodes = headingNodes(heading);
  const w = 740;
  const pad = 46;
  const xs = nodeXs(nodes.length, w, pad);
  const labels = nodes
    .map((node, i) => {
      const pct = ((xs[i] / w) * 100).toFixed(2);
      const here = node.type === "here" ? `<span class="here-note">(you are here)</span>` : "";
      const stopNo =
        node.type !== "here" && node.code
          ? `<span class="stop-no">Stop #${escapeHtml(node.code)}</span>`
          : "";
      const labelName = node.star ? `${node.name}*` : node.name;
      return `<div class="lbl ${node.type}" style="left:${pct}%">${wrapLabel(labelName)}${here}${stopNo}</div>`;
    })
    .join("");
  return `<div class="diag">
    ${spineSvg(heading, nodes)}
    <div class="labels">${labels}</div>
  </div>`;
}

function rowBreakClass(hours, i) {
  if (i === 0) return "";
  const prev = hours[i - 1];
  const h = hours[i];
  return prev < 12 && h >= 12 && h < 24 ? "ampm" : "";
}

function rowClass(hours, i) {
  const bits = [];
  const br = rowBreakClass(hours, i);
  if (br) bits.push(br);
  if (hours[i] >= 12) bits.push("pm");
  return bits.join(" ");
}

function hourCell(h) {
  return `<th class="hour"><span class="h24">${hourLabel24(h)}</span><span class="h12">${hourLabel12(h)}</span></th>`;
}

const DAY_ABBREV = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

function abbreviateDayLabel(label) {
  return String(label).replace(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/g, (d) => DAY_ABBREV[d]);
}

/** 10px bold caps with 0.12em tracking. */
function headerTextWidthIn(text) {
  const n = [...String(text)].length;
  if (!n) return 0;
  return (n * 8.0 - 1.2) / 96;
}

function isWeekendColumn(col) {
  const k = String(col.key || "");
  if (k === "weekend" || k === "saturday" || k === "sunday" || k === "sat" || k === "sun" || k === "frisat") return true;
  const label = String(col.label || "");
  if (/^(Saturday|Sunday)/.test(label)) return true;
  if (/Saturday–Sunday|Sat–Sun|Friday–Saturday|Fri–Sat/.test(label)) return true;
  return false;
}

function ledPlaneSvg() {
  return `<svg class="led-plane" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.16 2.25L9.71 10.8 4.7 10.8 3.18 9.12 1.2 9.12 2.46 12.05 1.2 14.93 3.18 14.93 4.68 13.29 9.69 13.29 7.16 21.75 9.14 21.9 14.6 13.29 21.53 13.29C21.88 13.29 22.18 13.17 22.43 12.95 22.68 12.72 22.8 12.42 22.8 12.05 22.8 11.88 22.77 11.72 22.7 11.57 22.64 11.42 22.55 11.29 22.43 11.17 22.31 11.05 22.17 10.96 22.02 10.9 21.86 10.83 21.7 10.8 21.53 10.8L14.64 10.8 9.14 2.1Z"/></svg>`;
}

function headboardDestHtml(dest) {
  const stripped = String(dest || "")
    .replace(/[\u2708\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (POSTER_OPTS.agencyName === "Metro Transit" && stripped === "AIRPORT") {
    return `${ledPlaneSvg()}<span class="led-word">AIRPORT</span>${ledPlaneSvg()}`;
  }
  return escapeHtml(dest);
}

function oneColTable(col, hours, headerLabel) {
  const byHour = groupByHour(col.deps);
  const rows = hours
    .map((h, i) => {
      const cls = rowClass(hours, i);
      return `<tr class="${cls}">
        ${hourCell(h)}
        <td>${minsHtml(byHour.get(h))}</td>
      </tr>`;
    })
    .join("\n");
  const full = columnDayLabel(col);
  const label = headerLabel || full;
  const title = label !== full ? ` title="${escapeHtml(full)}"` : "";
  const wknd = isWeekendColumn(col) ? " class=\"wknd\"" : "";
  return `<table class="tt">
    <thead><tr><th></th><th${title}${wknd}>${escapeHtml(label)}${col.sub ? `<span class="sub">${escapeHtml(col.sub)}</span>` : ""}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function maxTripsPerHour(col) {
  const byHour = groupByHour(col.deps);
  let max = 1;
  for (const list of byHour.values()) max = Math.max(max, list.length);
  return max;
}

const TT_INNER_IN = 7.52;
const TT_GAP_IN = 14 / 96;
const TT_COL_FLOOR_IN = 1.2;
const TT_HOUR_IN = 0.62;
const TT_MIN_IN = 0.185;

/** Min widths from densest hours; leftover splits equally. Sum is capped to the sheet. */
function colMinWidths(columns) {
  const n = columns.length;
  const available = TT_INNER_IN - TT_GAP_IN * (n - 1);
  const needed = columns.map((col) =>
    Math.max(TT_COL_FLOOR_IN, TT_HOUR_IN + TT_MIN_IN * maxTripsPerHour(col))
  );
  const sum = needed.reduce((a, b) => a + b, 0);
  if (sum <= available) return needed;
  const extraNeeded = needed.map((w) => w - TT_COL_FLOOR_IN);
  const extraSum = extraNeeded.reduce((a, b) => a + b, 0);
  const extraAvail = available - TT_COL_FLOOR_IN * n;
  if (extraSum <= 0 || extraAvail <= 0) return needed.map(() => available / n);
  return extraNeeded.map((e) => TT_COL_FLOOR_IN + (e / extraSum) * extraAvail);
}

function destNoteHtml(heading) {
  const note = heading.destNote;
  if (note && note.type === "headsign") {
    return `<p class="tt-note">*${escapeHtml(note.lead)}<span class="note-led">${escapeHtml(note.headsign)}</span>.</p>`;
  }
  if (note && note.type === "terminus") {
    return `<p class="tt-note">*${escapeHtml(note.lead)}<span class="term-name">${escapeHtml(
      note.stopName
    )}</span> <span class="term-no">(Stop #${escapeHtml(note.stopCode)})</span>.</p>`;
  }
  if (heading.destFootnote) return `<p class="tt-note">*${escapeHtml(heading.destFootnote)}</p>`;
  return "";
}

function tableHtml(heading) {
  const columns = heading.columns;
  const n = columns.length;
  const hours = hourSet(columns, n > 1);
  const note = destNoteHtml(heading);
  if (n <= 1) return `<div class="tt-wrap cols-1">${oneColTable(columns[0], hours)}</div>${note}`;
  const mins = colMinWidths(columns);
  const available = TT_INNER_IN - TT_GAP_IN * (n - 1);
  const extra = Math.max(0, available - mins.reduce((a, b) => a + b, 0));
  const widths = mins.map((m) => m + extra / n);
  const tables = columns
    .map((col, i) => {
      const full = columnDayLabel(col);
      const short = headerTextWidthIn(full) > widths[i] - 0.54;
      return oneColTable(col, hours, short ? abbreviateDayLabel(full) : full);
    })
    .join("");
  const cols = mins.map((w) => `minmax(${w.toFixed(2)}in, 1fr)`).join(" ");
  return `<div class="tt-wrap cols-${n}" style="grid-template-columns:${cols}">${tables}</div>${note}`;
}

let LOGO_DATA_URI = null;
function metroLogoDataUri() {
  if (POSTER_OPTS.logoDataUri) return POSTER_OPTS.logoDataUri;
  if (LOGO_DATA_URI) return LOGO_DATA_URI;
  if (typeof globalThis !== "undefined" && typeof globalThis.METRO_LOGO_DATA_URI === "string") {
    LOGO_DATA_URI = globalThis.METRO_LOGO_DATA_URI;
    return LOGO_DATA_URI;
  }
  if (!fs || !path) return "";
  const candidates = [
    path.join(__dirname, "metrologo-mark.png"),
    path.join(__dirname, "data", "metrologo-mark.png"),
    path.join(__dirname, "github", "data", "metrologo-mark.png"),
    path.join(__dirname, "..", "data", "metrologo-mark.png"),
    path.join(__dirname, "metrologo.png"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return "";
  LOGO_DATA_URI = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  return LOGO_DATA_URI;
}

function stopPredictionUrl(stopCode) {
  const t = POSTER_OPTS.qrUrlTemplate;
  if (!t) return "";
  return String(t).replace(/\{stop_code\}/g, encodeURIComponent(stopCode));
}

function qrBits(text) {
  if (!QRCode || !QRCode.create) return "";
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  let bits = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) bits += qr.modules.get(r, c) ? "1" : "0";
  }
  return bits;
}

function qrSvgFromBits(bits) {
  if (!bits) return "";
  const n = Math.round(Math.sqrt(bits.length));
  const margin = 1;
  const dim = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (bits[r * n + c] === "1") d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const logo = dim * 0.28;
  const x = (dim - logo) / 2;
  const cx = dim / 2;
  const hole = logo * 0.56;
  const mark = metroLogoDataUri();
  const logoSvg = mark
    ? `<circle cx="${cx}" cy="${cx}" r="${hole}" fill="#fff"/><image href="${mark}" x="${x}" y="${x}" width="${logo}" height="${logo}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" aria-hidden="true">
    <rect width="${dim}" height="${dim}" fill="#fff"/>
    <path d="${d}" fill="#111"/>
    ${logoSvg}
  </svg>`;
}

function qrSvgWithLogo(text) {
  if (!QRCode || !QRCode.create) return "";
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const modules = qr.modules;
  const n = modules.size;
  const margin = 1;
  const dim = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules.get(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const logo = dim * 0.28;
  const x = (dim - logo) / 2;
  const cx = dim / 2;
  const hole = logo * 0.56;
  const mark = metroLogoDataUri();
  const logoSvg = mark
    ? `<circle cx="${cx}" cy="${cx}" r="${hole}" fill="#fff"/><image href="${mark}" x="${x}" y="${x}" width="${logo}" height="${logo}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" aria-hidden="true">
    <rect width="${dim}" height="${dim}" fill="#fff"/>
    <path d="${d}" fill="#111"/>
    ${logoSvg}
  </svg>`;
}

const POSTER_CHROME_SCRIPT = String.raw`
(function () {
  function inchPx() {
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-9999px;width:1in;height:1in";
    document.body.appendChild(probe);
    var inch = probe.offsetHeight || 96;
    document.body.removeChild(probe);
    return inch;
  }
  function sheetInches() {
    var sheet = document.querySelector(".sheet");
    if (!sheet) return { w: 8.5, h: 11 };
    var inch = inchPx();
    return { w: 8.5, h: Math.max(0.5, sheet.offsetHeight / inch) };
  }
  function sizeNote() {
    var sheet = document.querySelector(".sheet");
    var el = document.getElementById("page-count");
    if (!sheet || !el) return;
    var dim = sheetInches();
    var n = Math.max(1, Math.ceil(dim.h / 11));
    sheet.setAttribute("data-pages", String(n));
    el.textContent = dim.h.toFixed(2) + " inches tall, 8.5 inches wide";
  }
  function pdfFilename() {
    var sheet = document.querySelector(".sheet");
    var slug = sheet && sheet.getAttribute("data-pdf-name");
    return (slug || "timetable") + ".pdf";
  }
  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve();
    var urls = [
      "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"
    ];
    function one(src) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { reject(new Error("Could not load PDF helper")); };
        document.head.appendChild(s);
      });
    }
    return one(urls[0]).catch(function () { return one(urls[1]); });
  }
  function asciiBytes(str) {
    var u = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255;
    return u;
  }
  function concatBytes(chunks) {
    var n = 0, i, out, o = 0;
    for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    out = new Uint8Array(n);
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
    return out;
  }
  function jpegsToPdf(pages) {
    if (!pages || !pages.length) return new Uint8Array(0);
    var nl = String.fromCharCode(10);
    var pieces = [asciiBytes("%PDF-1.4" + nl + "%" + String.fromCharCode(226, 227, 207, 211) + nl)];
    var offsets = [0];
    var offset = pieces[0].length;
    function addObj(body) {
      offsets.push(offset);
      var bytes = typeof body === "string" ? asciiBytes(body) : body;
      pieces.push(bytes);
      offset += bytes.length;
    }
    var n = pages.length;
    var kids = [];
    var i;
    for (i = 0; i < n; i++) kids.push((3 + i * 3) + " 0 R");
    addObj("1 0 obj" + nl + "<< /Type /Catalog /Pages 2 0 R >>" + nl + "endobj" + nl);
    addObj("2 0 obj" + nl + "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + n + " >>" + nl + "endobj" + nl);
    for (i = 0; i < n; i++) {
      var pageObj = 3 + i * 3;
      var imgObj = 4 + i * 3;
      var contentObj = 5 + i * 3;
      var pageW = 8.5 * 72;
      var pageH = pageW * (pages[i].h / pages[i].w);
      var content = "q" + nl + pageW.toFixed(2) + " 0 0 " + pageH.toFixed(2) + " 0 0 cm" + nl + "/Im0 Do" + nl + "Q" + nl;
      addObj(
        pageObj + " 0 obj" + nl + "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
          pageW.toFixed(2) + " " + pageH.toFixed(2) +
          "] /Resources << /XObject << /Im0 " + imgObj + " 0 R >> >> /Contents " + contentObj + " 0 R >>" + nl + "endobj" + nl
      );
      addObj(concatBytes([
        asciiBytes(
          imgObj + " 0 obj" + nl + "<< /Type /XObject /Subtype /Image /Width " + pages[i].w +
            " /Height " + pages[i].h +
            " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
            pages[i].jpeg.length + " >>" + nl + "stream" + nl
        ),
        pages[i].jpeg,
        asciiBytes(nl + "endstream" + nl + "endobj" + nl)
      ]));
      addObj(
        contentObj + " 0 obj" + nl + "<< /Length " + content.length + " >>" + nl + "stream" + nl + content + "endstream" + nl + "endobj" + nl
      );
    }
    var xrefStart = offset;
    var xref = "xref" + nl + "0 " + offsets.length + nl + "0000000000 65535 f " + nl;
    for (i = 1; i < offsets.length; i++) {
      xref += ("0000000000" + offsets[i]).slice(-10) + " 00000 n " + nl;
    }
    pieces.push(asciiBytes(
      xref + "trailer" + nl + "<< /Size " + offsets.length + " /Root 1 0 R >>" + nl + "startxref" + nl + xrefStart + nl + "%%EOF" + nl
    ));
    return concatBytes(pieces);
  }
  function downloadBlob(bytes, name, type) {
    var blob = new Blob([bytes], { type: type || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var doc = document;
    try {
      if (window.parent && window.parent !== window) doc = window.parent.document;
    } catch (e) {}
    var a = doc.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.style.display = "none";
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
  }
  function captureSheet(sheet) {
    var maxPx = 16384;
    var scale = Math.min(6.25, maxPx / Math.max(1, sheet.offsetHeight), maxPx / Math.max(1, sheet.offsetWidth));
    return window.html2canvas(sheet, {
      scale: scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: sheet.scrollWidth,
      windowHeight: sheet.scrollHeight,
      onclone: function (doc) {
        var clones = doc.querySelectorAll(".sheet");
        for (var c = 0; c < clones.length; c++) {
          clones[c].style.margin = "0";
          clones[c].style.overflow = "hidden";
        }
        var chrome = doc.querySelector(".chrome");
        if (chrome) chrome.style.display = "none";
      }
    }).then(function (canvas) {
      var jpegB64 = canvas.toDataURL("image/jpeg", 0.97).split(",")[1];
      var bin = atob(jpegB64);
      var jpeg = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
      return { jpeg: jpeg, w: canvas.width, h: canvas.height };
    });
  }
  function saveAsPdf() {
    var btn = document.getElementById("download-pdf");
    var sheets = [].slice.call(document.querySelectorAll(".sheet"));
    if (!sheets.length) return;
    var name = pdfFilename();
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    var waitFonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    waitFonts
      .then(function () { return loadHtml2Canvas(); })
      .then(function () {
        var chain = Promise.resolve([]);
        sheets.forEach(function (sheet) {
          chain = chain.then(function (pages) {
            return captureSheet(sheet).then(function (page) {
              pages.push(page);
              return pages;
            });
          });
        });
        return chain;
      })
      .then(function (pages) {
        downloadBlob(jpegsToPdf(pages), name, "application/pdf");
        if (btn) btn.textContent = "Save as PDF";
      })
      .catch(function (err) {
        console.error(err);
        if (btn) btn.textContent = "Couldn’t save";
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }
  var pdfBtn = document.getElementById("download-pdf");
  if (pdfBtn) pdfBtn.addEventListener("click", saveAsPdf);
  sizeNote();
  if (document.readyState !== "complete") window.addEventListener("load", sizeNote);
  window.addEventListener("resize", sizeNote);
})();
`;

function renderPoster(data) {
  const { stop, route, feed } = data;
  const headings = sortHeadings(mergeCloseTermini(data.headings, data.stop));
  const routes = data.routes && data.routes.length ? data.routes : [route];
  const multi = routes.length > 1;
  const firstColors = resolveRouteColors(route);
  const color = headings[0]?.routeColor || firstColors.bg;
  const textColor = headings[0]?.routeTextColor || firstColors.ink;
  const lastColor = headings[headings.length - 1]?.routeColor || color;
  const street = streetDirectionLabel(stop);
  const pack = routes.length;
  const grid = badgeGrid(pack);
  const badges = `<div class="badges" style="--badge-cols:${grid.cols};--badge-gap:${grid.gap}in">${routes.map((r) => routeBadge(r, grid)).join("")}</div>`;
  const kicker = timetableKicker(routes);
  const fonts = POSTER_OPTS.fonts;
  const showTo = POSTER_OPTS.showTo !== false;
  const hbClass = POSTER_OPTS.headboardStyle === "plain" ? "headboard plain" : "headboard";
  const stopNo = publicStopCode(stop);
  const pdfSlug =
    routes.length <= 4
      ? `${routes.map((r) => String(r.route_short_name || "route").toLowerCase()).join("-")}-${stopNo}`
      : `all-${stopNo}`;

  const predUrl = stopPredictionUrl(stopNo);
  const qr = data.qrSvg || qrSvgFromBits(data.qrBits) || (predUrl ? qrSvgWithLogo(predUrl) : "");
  const routeNote = data.routeNote || routeServiceNote(route);
  const anySessionOnly = headings.some((h) => h.hasSessionOnly);
  const sourceRange =
    feed && feed.feed_start_date && feed.feed_end_date
      ? `, valid ${escapeHtml(formatDateRange(feed.feed_start_date, feed.feed_end_date))}`
      : "";
  const sourceLine = `Source: ${escapeHtml(POSTER_OPTS.agencyName)} GTFS${
    feed && feed.feed_version ? ` ${escapeHtml(feed.feed_version)}` : ""
  }${sourceRange}.${POSTER_OPTS.sourceCheck ? ` ${escapeHtml(POSTER_OPTS.sourceCheck)}` : ""}`;
  const logo = POSTER_OPTS.logoDataUri || "";
  const fav = logo
    ? `<link rel="icon" href="${logo}" />`
    : `<link rel="icon" type="image/png" href="../metrologo-mark.png" />
  <link rel="shortcut icon" type="image/png" href="../metrologo-mark.png" />
  <link rel="apple-touch-icon" href="../metrologo-mark.png" />`;

  const sections = headings
    .map((h, i) => {
      const caption = serviceCaptionHtml(h.routeDirection, h.columns);
      const led = showTo ? `${h.board.code} TO ${h.board.dest}` : `${h.board.code} ${h.board.dest}`;
      const headingColor = h.routeColor || color;
      const prev = i > 0 ? headings[i - 1] : null;
      const routeBreak = multi && (!prev || prev.routeShortName !== h.routeShortName);
      const breakLabel = routeBreak
        ? `<div class="route-break-label">Route ${escapeHtml(h.routeShortName)}</div>`
        : "";
      return `<section class="heading${routeBreak ? " route-break" : ""}" style="--route: ${headingColor}">
        ${breakLabel}
        <div class="${hbClass}" aria-label="${escapeHtml(led)}">
          <span class="led-code">${escapeHtml(h.board.code)}</span>
          ${showTo ? `<span class="led-to">TO</span>` : ""}
          <span class="led-dest">${headboardDestHtml(h.board.dest)}</span>
        </div>
        ${caption ? `<div class="board-meta">${caption}</div>` : ""}
        ${diagramHtml(h)}
        ${tableHtml(h)}
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(multi ? `Routes ${routeListPhrase(routes.map((r) => r.route_short_name))}` : `Route ${route.route_short_name}`)} · ${escapeHtml(stop.stop_name)} · ${escapeHtml(stopNo)}</title>
  ${fav}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
  <style>
    :root {
      --route: ${color};
      --route-ink: ${textColor};
      --ink: #111;
      --muted: #4a4a4a;
      --rule: #d0d0d0;
      --paper: #fff;
      --desk: #cfc8be;
      --led: #f5a623;
      --led-bg: #0c0c0c;
      --title-size: ${fonts.title}px;
      --kicker-size: ${fonts.kicker}px;
      --meta-size: ${fonts.meta}px;
      --board-size: ${fonts.board}px;
      --table-size: ${fonts.table}px;
      --footer-size: ${fonts.footer}px;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--desk);
      color: var(--ink);
      font-family: "IBM Plex Sans", "Segoe UI", Tahoma, sans-serif;
    }
    body[data-clock="12"] .h24 { display: none; }
    body[data-clock="24"] .h12 { display: none; }
    body.shot { background: #fff; }
    body.shot .chrome { display: none; }
    body.shot .sheet { margin: 0; }

    .chrome {
      width: 8.5in;
      margin: 18px auto 10px;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .chrome button, .chrome label {
      background: #fff;
      border: 1px solid #7a7a7a;
      border-radius: 2px;
      padding: 7px 11px;
      font: inherit;
      cursor: pointer;
    }
    .chrome .hint { color: #333; }

    .sheet {
      position: relative;
      width: 8.5in;
      margin: 0 auto;
      background: var(--paper);
      color: var(--ink);
      padding: 0.28in 0.34in 0.2in 0.42in;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    @media screen {
      .sheet { margin-bottom: 28px; }
    }
    .sheet::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 0.13in;
      background: var(--route);
    }

    header.mast {
      display: grid;
      grid-template-columns: auto 1fr 0.95in;
      gap: 12px;
      align-items: center;
      padding-bottom: 10px;
    }
    .mast-rule {
      display: flex;
      align-items: center;
      height: 8px;
      margin: 0 0 10px;
    }
    .mast-rule span {
      flex: 1 1 auto;
      height: 0;
      border-top: 3px solid var(--route);
    }
    .badges {
      display: grid;
      grid-template-columns: repeat(var(--badge-cols, 1), auto);
      gap: var(--badge-gap, 4px);
      align-items: center;
      align-content: center;
      justify-items: center;
    }
    .badge {
      width: 0.92in;
      height: 0.92in;
      background: var(--route);
      color: var(--route-ink);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.04em;
    }
    .sheet.multi .heading {
      position: relative;
    }
    .sheet.multi .heading::before,
    .sheet.multi footer.notes::before {
      content: "";
      position: absolute;
      left: -0.42in;
      width: 0.13in;
      top: 0;
      bottom: 0;
      background: var(--route);
    }
    .sheet.multi .heading + .heading::before { top: -7px; }
    .sheet.multi .heading.route-break::before { top: 0; }
    .sheet.multi .heading:has(+ .heading.route-break)::before { bottom: -16px; }
    .sheet.multi > header + .heading.route-break::before { top: 0; }
    .sheet.multi footer.notes {
      position: relative;
      --route: ${lastColor};
    }
    .sheet.multi .heading:last-of-type::before { bottom: -8px; }
    .sheet.multi footer.notes::before {
      top: -8px;
      bottom: -0.2in;
    }
    .ident .kicker {
      font-size: var(--kicker-size);
      letter-spacing: ${pack > 3 ? "0.06em" : "0.16em"};
      text-transform: uppercase;
      font-weight: 700;
      color: var(--route);
    }
    .ident h1 {
      margin: 2px 0 3px;
      font-size: var(--title-size);
      line-height: 1.05;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .ident .meta { font-size: var(--meta-size); color: var(--muted); }
    .qr-block {
      justify-self: end;
      width: 0.95in;
      text-align: center;
    }
    .qr-block a { color: inherit; text-decoration: none; display: block; }
    .qr-block svg { width: 0.92in; height: 0.92in; display: block; margin: 0 auto; }
    .qr-block .qr-cap {
      font-size: 6.5px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 700;
      margin-top: 2px;
      line-height: 1.1;
      color: var(--muted);
    }

    .heading {
      padding-top: 0;
    }
    .heading + .heading {
      margin-top: 6px;
      padding-top: 8px;
      border-top: 1px solid var(--rule);
    }
    .sheet.multi .heading.route-break {
      margin-top: 16px;
      padding-top: 0;
      border-top: none;
    }
    .sheet.multi > header + .heading.route-break {
      margin-top: 10px;
    }
    .route-break-label {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--route);
      padding: 0 0 7px;
      margin: 0 0 10px;
      border-bottom: 3px solid var(--route);
    }

    .headboard {
      background: var(--led-bg);
      color: var(--led);
      border: 2px solid #2b2b2b;
      padding: 10px 14px 9px;
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 0.45em;
      min-height: 2.45em;
      max-height: 2.45em;
      overflow: hidden;
    }
    .led-code, .led-dest {
      font-family: "Share Tech Mono", "Consolas", monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      line-height: 1;
      font-size: var(--board-size);
    }
    .led-code {
      flex: 0 0 auto;
    }
    .led-to {
      flex: 0 0 auto;
      font-family: "Share Tech Mono", "Consolas", monospace;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      line-height: 1;
      font-size: calc(var(--board-size) * 0.5);
      opacity: 0.85;
      padding-top: 0.2em;
    }
    .headboard.plain {
      background: #fff;
      color: var(--ink);
      border: 2px solid var(--route);
    }
    .headboard.plain .led-code,
    .headboard.plain .led-dest,
    .headboard.plain .led-to {
      font-family: "IBM Plex Sans", "Segoe UI", Tahoma, sans-serif;
      letter-spacing: 0.04em;
      color: inherit;
    }
    .led-dest {
      flex: 1 1 auto;
      min-width: 0;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      display: flex;
      align-items: center;
      gap: 0;
    }
    .led-word {
      letter-spacing: 0.12em;
      padding-left: 0.32em;
      padding-right: 0.14em;
      margin-right: -0.12em;
    }
    .led-plane {
      width: 1em;
      height: 1em;
      flex: 0 0 auto;
    }
    .board-meta {
      margin: 5px 0 8px;
      font-size: 12px;
      color: var(--muted);
      font-weight: 400;
      font-style: italic;
      text-align: left;
    }
    .board-meta .dir {
      font-style: normal;
      font-weight: 700;
      color: var(--ink);
    }
    .board-meta .hours {
      font-style: italic;
      font-weight: 400;
    }

    .diag { margin: 0 0 8px; }
    .diag .spine { width: 100%; height: auto; display: block; }
    .diag .labels {
      position: relative;
      min-height: 2.2em;
      margin-top: 1px;
    }
    .diag .lbl {
      position: absolute;
      top: 0;
      transform: translateX(-50%);
      text-align: center;
      width: 1.4in;
      font-size: 9.5px;
      line-height: 1.15;
      font-weight: 600;
    }
    .diag .lbl.here { font-weight: 700; }
    .diag .lbl.here .here-note {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      font-style: italic;
      font-weight: 500;
      font-size: 7.5px;
      letter-spacing: 0.02em;
      line-height: 1.15;
    }
    .diag .lbl .stop-no {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      font-style: normal;
      font-weight: 500;
      font-size: 7.5px;
      letter-spacing: 0.02em;
      line-height: 1.15;
      color: var(--muted);
    }
    .diag .lbl.terminus { font-weight: 700; }

    .tt-wrap {
      display: grid;
      gap: 0 14px;
      align-items: start;
      width: 100%;
      max-width: 100%;
    }
    .tt-wrap.cols-1 { grid-template-columns: 1fr; }
    .tt-wrap.cols-2 { grid-template-columns: 1fr 1fr; }
    .tt-wrap.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
    .tt-wrap.cols-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
    .tt-wrap > table.tt { min-width: 0; }
    .tt-wrap table.tt td { white-space: normal; }
    .tt-wrap .min { white-space: nowrap; }
    .tt-note {
      margin: 8px 0 0;
      font-size: 10.5px;
      line-height: 1.35;
      color: var(--muted);
      font-weight: 500;
    }
    .tt-note .term-name {
      font-weight: 700;
      color: var(--ink);
    }
    .tt-note .term-no {
      font-weight: 500;
    }
    .tt-note .note-led {
      display: inline-block;
      font-family: "Share Tech Mono", "Consolas", monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 1.05em;
      line-height: 1;
      background: var(--led-bg);
      color: var(--led);
      border: 1px solid #2b2b2b;
      padding: 0.18em 0.4em 0.12em;
      vertical-align: baseline;
      font-weight: 400;
    }
    .tt-wrap:not(.cols-1) table.tt td { padding-right: 4px; }

    table.tt {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    table.tt thead th {
      text-align: left;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 800;
      padding: 4px 8px 5px 0;
      border-bottom: 2px solid var(--ink);
      vertical-align: bottom;
      white-space: nowrap;
    }
    table.tt thead th.wknd {
      font-style: italic;
      font-weight: 400;
    }
    table.tt thead th .sub {
      display: block;
      letter-spacing: 0.03em;
      text-transform: none;
      font-weight: 500;
      color: var(--muted);
      font-size: 10px;
      margin-top: 1px;
    }
    table.tt .hour {
      width: 0.54in;
      text-align: right;
      padding-right: 8px;
      font-weight: 700;
      font-size: var(--table-size);
    }
    table.tt tbody th.hour::after {
      content: ":";
      margin-left: 0.04em;
    }
    table.tt td, table.tt tbody th {
      padding: 1px 8px 1px 0;
      border-top: 1px solid var(--rule);
      font-size: var(--table-size);
      vertical-align: middle;
    }
    table.tt tbody tr { height: 0.19in; }
    table.tt tbody tr:last-child td,
    table.tt tbody tr:last-child th { border-bottom: 1px solid var(--rule); }
    table.tt tr.ampm td, table.tt tr.ampm th { border-top: 2.5px solid var(--ink); }
    table.tt tr.pm td, table.tt tr.pm th { background: #eeeeee; }
    .min {
      font-weight: 500;
    }
    .min:not(:last-child)::after {
      content: ",";
      margin-right: 0.22em;
    }
    .tt-wrap:not(.cols-1) .min:not(:last-child)::after {
      margin-right: 0.12em;
    }
    .empty { color: #c4c4c4; }
    .min .uw { font-size: 0.68em; font-weight: 700; margin: 0 0 0 -0.18em; padding: 0; }
    .h12 .ap { font-size: 0.58em; font-weight: 600; margin-left: 1px; }

    footer.notes {
      margin-top: auto;
      padding-top: 8px;
      border-top: 1px solid var(--rule);
      font-size: var(--footer-size);
      line-height: 1.4;
      color: var(--muted);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 16px;
      align-items: end;
    }
    footer.notes .source { margin-top: 0.02em; }
    .unofficial {
      text-align: right;
      font-weight: 700;
      color: var(--ink);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-size: 9px;
      line-height: 1.35;
    }

    @media print {
      html, body {
        margin: 0;
        padding: 0;
        background: #fff !important;
        width: 8.5in;
        max-width: 8.5in;
        height: auto;
        overflow-x: hidden;
      }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body > *:not(.sheet) { display: none !important; }
      .sheet {
        margin: 0 !important;
        width: 8.5in;
        max-width: 8.5in;
        min-height: 0 !important;
        height: auto !important;
        overflow-x: hidden;
      }
      @page { size: letter portrait; margin: 0; }
    }
  </style>
</head>
<body data-clock="12">
  <script>if (new URLSearchParams(location.search).has("shot")) document.body.classList.add("shot");</script>
  <div class="chrome">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" id="download-pdf">Save as PDF</button>
    <label><input type="radio" name="clock" value="12" checked onchange="document.body.dataset.clock='12'" /> 12-hour</label>
    <label><input type="radio" name="clock" value="24" onchange="document.body.dataset.clock='24'" /> 24-hour</label>
    <span class="hint" id="page-count">Measuring size…</span>
  </div>

  <article class="sheet${multi ? " multi" : ""}" data-headings="${headings.length}" data-pdf-name="${escapeHtml(pdfSlug)}">
    <header class="mast">
      ${badges}
      <div class="ident">
        <div class="kicker">${escapeHtml(kicker)}</div>
        <h1>${escapeHtml(stop.stop_name)}</h1>
        <div class="meta">Stop #${escapeHtml(stopNo)}${street ? `, on ${escapeHtml(street)}` : ""}</div>
      </div>
      ${
        qr
          ? `<div class="qr-block">
        <a href="${escapeHtml(predUrl)}" target="_blank" rel="noopener" title="${escapeHtml((POSTER_OPTS.qrCaption || "Live departures from this stop").replace(/\s+/g, " "))}">
          ${qr}
          <div class="qr-cap">${(POSTER_OPTS.qrCaption || "Live departures\nfrom this stop").split(/\n/).map((line) => escapeHtml(line)).join("<br />")}</div>
        </a>
      </div>`
          : `<div class="qr-block"></div>`
      }
    </header>
    <div class="mast-rule" aria-hidden="true"><span></span></div>

    ${sections}

    <footer class="notes">
      <div>
        <div>${escapeHtml(POSTER_OPTS.footerBlurb)}${anySessionOnly ? " * UW in session only." : ""}${routeNote ? ` ${escapeHtml(routeNote)}` : ""}</div>
        <div class="source">${sourceLine}</div>
      </div>
    </footer>
  </article>
  <script>
${POSTER_CHROME_SCRIPT}
  </script>
</body>
</html>
`;
}

function generatePoster(routeId, stopCode) {
  const stop = findStop(stopCode);
  const routeList = resolveRouteList(routeId, stop);
  const data =
    routeList.length > 1
      ? collectMultiPosterData(routeList, stopCode)
      : collectPosterData(routeList[0] ? routeList[0].route_short_name : routeId, stopCode);
  const html = renderPoster(data);
  const outDir = path.join("posters");
  fs.mkdirSync(outDir, { recursive: true });
  const names = (data.routes || [data.route]).map((r) => r.route_short_name.toLowerCase());
  const slug =
    names.length <= 1
      ? `${names[0]}-${data.stop.stop_code}`
      : routeArgTokens(routeId).some((t) => t.toUpperCase() === "ALL")
        ? `all-${data.stop.stop_code}`
        : `${names.join("-")}-${data.stop.stop_code}`;
  const outPath = path.join(outDir, `${slug}.html`);
  fs.writeFileSync(outPath, html);
  console.log("Wrote", outPath);
  console.log("Stop:", data.stop.stop_name, data.stop.stop_code);
  if (names.length > 1) console.log("Routes:", names.map((n) => n.toUpperCase()).join(", "));
  for (const h of data.headings) {
    const cols = h.columns.map((c) => `${c.label} ${c.deps.length}`).join(" / ");
    const caption = serviceCaption(h.routeDirection, h.columns);
    console.log(`  ${h.board.code}    ${h.board.dest}  ${caption}`);
    const nextNames = h.next3.map((n) => (typeof n === "string" ? n : n.name));
    console.log(`    ${h.here} → ${nextNames.join(" → ")}${nextNames.length ? " → " : ""}${h.skippedAfter ? "… → " : ""}${h.dest}  [${cols}]`);
  }
  return outPath;
}

const posterApi = {
  generatePoster,
  formatHeadboard,
  streetDirectionLabel,
  collectPosterData,
  collectMultiPosterData,
  mergePosterParts,
  renderPoster,
  isSchoolSupplement,
  routesServingStop,
  qrSvgWithLogo,
  qrBits,
  stopPredictionUrl,
  loadGtfs,
  setGtfs,
  setGtfsDir,
  setPosterOptions,
  resetPosterOptions,
  posterOptions,
  parseCsv,
  parseCsvLine,
  publicStopCode,
  findStop,
  inferFeedDates,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = posterApi;
}
if (typeof window !== "undefined") {
  window.MMTPoster = posterApi;
}

if (isNode && require.main === module) {
  const args = parseArgs(process.argv);
  generatePoster(args.route, args.stop);
}
