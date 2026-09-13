/**
 * Generate a European-style stop poster from Metro GTFS.
 * Usage: node generate_poster.js --route F --stop 6894
 *        node generate_poster.js --route ALL --stop 0010
 *        node generate_poster.js --route ALL+SCHOOL --stop 0716
 *        node generate_poster.js --route A,C,80 --stop 0716
 */
const isNode = typeof process !== "undefined" && !!(process.versions && process.versions.node);
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

function columnDayLabel(col) {
  if (col.key === "weekday") return "Monday–Friday";
  if (col.key === "weekend") return "Saturday–Sunday";
  if (col.key === "frisat") return "Friday–Saturday";
  if (col.key === "mt") return "Monday–Thursday";
  if (col.key === "sunthu") return "Sunday–Thursday";
  if (col.key === "friday") return "Fridays";
  if (col.key === "saturday") return "Saturdays";
  if (col.key === "sunday") return "Sundays";
  return col.label;
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

let GTFS = null;
function loadGtfs() {
  if (GTFS) return GTFS;
  const stops = parseCsv(fs.readFileSync("stops.txt", "utf8"));
  const routes = parseCsv(fs.readFileSync("routes.txt", "utf8"));
  const calendar = parseCsv(fs.readFileSync("calendar.txt", "utf8"));
  const calDates = parseCsv(fs.readFileSync("calendar_dates.txt", "utf8"));
  const feed = parseCsv(fs.readFileSync("feed_info.txt", "utf8"))[0];
  const trips = parseCsv(fs.readFileSync("trips.txt", "utf8"));
  const stopTimes = parseCsv(fs.readFileSync("stop_times.txt", "utf8"));
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
    trips,
    stopTimes,
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
  return [...active].sort((a, b) => Number(a) - Number(b));
}

function typicalServiceIds(calendar, calDates, feed) {
  const start = parseYmd(feed.feed_start_date);
  const end = parseYmd(feed.feed_end_date);
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
  const seen = new Set();
  const out = [];
  for (const r of deps) {
    const k = `${r.hh}:${r.mm}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
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
    return { ...named, deps: b.deps };
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
  if (!atStop.length) throw new Error(`Route ${route.route_short_name} does not serve stop ${stop.stop_code}`);

  const stopById = Object.fromEntries(stops.map((s) => [s.stop_id, s]));
  const typical = typicalForFeed();

  const records = [];
  for (const st of atStop) {
    if (st.pickup_type === "1") continue;
    const trip = routeTrips[st.trip_id];
    const seq = (timesByTrip.get(st.trip_id) || [])
      .slice()
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const idx = seq.findIndex((r) => r.stop_id === stop.stop_id);
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
    const lastSt = remaining.length ? remaining[remaining.length - 1] : null;
    let travelMinutes = 0;
    if (lastSt) {
      const destT = parseTime(lastSt.arrival_time || lastSt.departure_time);
      travelMinutes = destT.minutes - time.minutes;
      if (travelMinutes < 0) travelMinutes += 24 * 60;
    }
    records.push({
      service_id: trip.service_id,
      headsign,
      direction: trip.trip_direction_name,
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
  if (!records.length) throw new Error(`No pickup trips for route ${route.route_short_name} at stop ${stop.stop_code}`);

  function dayDepartures(serviceSet, headsign, direction) {
    return uniqueTimes(
      records
        .filter((r) => serviceSet.has(r.service_id) && r.headsign === headsign && r.direction === direction)
        .sort((a, b) => a.hh - b.hh || a.mm - b.mm)
    );
  }

  function fallbackByCalendar(headsign, direction, which) {
    return uniqueTimes(
      records
        .filter((r) => {
          if (r.headsign !== headsign || r.direction !== direction) return false;
          const flags = serviceDayFlags(calendarById[r.service_id]);
          return flags[which];
        })
        .sort((a, b) => a.hh - b.hh || a.mm - b.mm)
    );
  }

  const headingKeys = [...new Set(records.map((r) => `${r.headsign}\t${r.direction}`))];
  const headings = headingKeys
    .map((key) => {
      const [headsign, direction] = key.split("\t");
      const group = records.filter((r) => r.headsign === headsign && r.direction === direction);
      let monThu = dayDepartures(typical.tuesday, headsign, direction);
      let friday = dayDepartures(typical.friday, headsign, direction);
      let saturday = dayDepartures(typical.saturday, headsign, direction);
      let sunday = dayDepartures(typical.sunday, headsign, direction);
      if (!monThu.length && !friday.length && !saturday.length && !sunday.length) {
        monThu = fallbackByCalendar(headsign, direction, "tuesday");
        friday = fallbackByCalendar(headsign, direction, "friday");
        saturday = fallbackByCalendar(headsign, direction, "saturday");
        sunday = fallbackByCalendar(headsign, direction, "sunday");
      }
      monThu = markSessionOnly(monThu, dayDepartures(typical.tuesdayReduced, headsign, direction));
      friday = markSessionOnly(friday, dayDepartures(typical.fridayReduced, headsign, direction));
      saturday = markSessionOnly(saturday, dayDepartures(typical.saturdayReduced, headsign, direction));
      sunday = markSessionOnly(sunday, dayDepartures(typical.sundayReduced, headsign, direction));
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
        routeColor: `#${route.route_color || "333366"}`,
        routeTextColor: `#${route.route_text_color || "FFFFFF"}`,
        routeShortName: route.route_short_name,
      };
    })
    .filter(Boolean);

  headings.sort((a, b) => b.weekdayCount - a.weekdayCount || a.earliest - b.earliest);

  return {
    stop,
    route,
    routes: [route],
    feed,
    headings,
    direction: mostCommon(countBy(records, "direction")),
  };
}

function findStop(stopCode) {
  const { stops } = loadGtfs();
  const stop = stops.find((s) => s.stop_code === String(stopCode));
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
    .sort((a, b) => Number(a.route_sort_order) - Number(b.route_sort_order));
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
  const headings = parts.flatMap((p) => p.headings);
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
  if (parts.length === 1) {
    const p = parts[0];
    return { ...p, routes: p.routes && p.routes.length ? p.routes : [p.route], multi: false };
  }
  const headings = parts.flatMap((p) => p.headings);
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
  if (names.length <= 1) return `Metro Transit Route ${names[0]} departures`;
  return `Metro Transit Route ${routeListPhrase(names)} departures`;
}

function routeBadge(route, pack) {
  const name = route.route_short_name;
  const bg = `#${route.route_color || "333366"}`;
  const ink = `#${route.route_text_color || "FFFFFF"}`;
  let size = name.length > 2 ? 42 : name.length > 1 ? 56 : 72;
  if (pack > 3) size = Math.round(size * 0.36);
  return `<div class="badge" style="background:${bg};color:${ink};font-size:${size}px" aria-label="Route ${escapeHtml(name)}">${escapeHtml(name)}</div>`;
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
      const star = r.sessionOnly ? `<sup class="uw">*</sup>` : "";
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
  return typeof n === "string" ? n : n.name;
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
    nodes.push({ type: "terminus", name: heading.dest, code: heading.destCode || "" });
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
      return `<div class="lbl ${node.type}" style="left:${pct}%">${wrapLabel(node.name)}${here}${stopNo}</div>`;
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
  const label = headerLabel || col.label;
  const title = label !== col.label ? ` title="${escapeHtml(col.label)}"` : "";
  return `<table class="tt">
    <thead><tr><th></th><th${title}>${escapeHtml(label)}${col.sub ? `<span class="sub">${escapeHtml(col.sub)}</span>` : ""}</th></tr></thead>
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

function tableHtml(heading) {
  const columns = heading.columns;
  const n = columns.length;
  const hours = hourSet(columns, n > 1);
  if (n <= 1) return `<div class="tt-wrap cols-1">${oneColTable(columns[0], hours)}</div>`;
  const mins = colMinWidths(columns);
  const available = TT_INNER_IN - TT_GAP_IN * (n - 1);
  const extra = Math.max(0, available - mins.reduce((a, b) => a + b, 0));
  const widths = mins.map((m) => m + extra / n);
  const tables = columns
    .map((col, i) => {
      const short = headerTextWidthIn(col.label) > widths[i] - 0.54;
      return oneColTable(col, hours, short ? abbreviateDayLabel(col.label) : col.label);
    })
    .join("");
  const cols = mins.map((w) => `minmax(${w.toFixed(2)}in, 1fr)`).join(" ");
  return `<div class="tt-wrap cols-${n}" style="grid-template-columns:${cols}">${tables}</div>`;
}

let LOGO_DATA_URI = null;
function metroLogoDataUri() {
  if (LOGO_DATA_URI) return LOGO_DATA_URI;
  if (typeof globalThis !== "undefined" && typeof globalThis.METRO_LOGO_DATA_URI === "string") {
    LOGO_DATA_URI = globalThis.METRO_LOGO_DATA_URI;
    return LOGO_DATA_URI;
  }
  if (!fs || !path) return "";
  const mark = path.join(__dirname, "metrologo-mark.png");
  const full = path.join(__dirname, "metrologo.png");
  const file = fs.existsSync(mark) ? mark : fs.existsSync(full) ? full : "";
  if (!file) return "";
  LOGO_DATA_URI = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  return LOGO_DATA_URI;
}

function stopPredictionUrl(stopCode) {
  return `https://metromap.cityofmadison.com/predictions/bystop/bustime:${stopCode}`;
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

function renderPoster(data) {
  const { stop, route, feed, headings } = data;
  const routes = data.routes && data.routes.length ? data.routes : [route];
  const multi = routes.length > 1;
  const color = headings[0]?.routeColor || `#${route.route_color || "333366"}`;
  const textColor = headings[0]?.routeTextColor || `#${route.route_text_color || "FFFFFF"}`;
  const lastColor = headings[headings.length - 1]?.routeColor || color;
  const street = streetDirectionLabel(stop);
  const pack = routes.length;
  const badges = `<div class="badges n-${pack > 3 ? "many" : pack}">${routes.map((r) => routeBadge(r, pack)).join("")}</div>`;
  const kicker = timetableKicker(routes);

  const predUrl = stopPredictionUrl(stop.stop_code);
  const qr = data.qrSvg || qrSvgFromBits(data.qrBits) || qrSvgWithLogo(predUrl);
  const routeNote = data.routeNote || routeServiceNote(route);
  const anySessionOnly = headings.some((h) => h.hasSessionOnly);

  const sections = headings
    .map((h, i) => {
      const caption = serviceCaptionHtml(h.routeDirection, h.columns);
      const led = `${h.board.code} TO ${h.board.dest}`;
      const headingColor = h.routeColor || color;
      const prev = i > 0 ? headings[i - 1] : null;
      const routeBreak = multi && (!prev || prev.routeShortName !== h.routeShortName);
      const breakLabel = routeBreak
        ? `<div class="route-break-label">Route ${escapeHtml(h.routeShortName)}</div>`
        : "";
      return `<section class="heading${routeBreak ? " route-break" : ""}" style="--route: ${headingColor}">
        ${breakLabel}
        <div class="headboard" aria-label="${escapeHtml(led)}">
          <span class="led-code">${escapeHtml(h.board.code)}</span>
          <span class="led-to">TO</span>
          <span class="led-dest">${escapeHtml(h.board.dest)}</span>
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
  <title>${escapeHtml(multi ? `Routes ${routeListPhrase(routes.map((r) => r.route_short_name))}` : `Route ${route.route_short_name}`)} · ${escapeHtml(stop.stop_name)} · ${escapeHtml(stop.stop_code)}</title>
  <link rel="icon" type="image/png" href="../metrologo-mark.png" />
  <link rel="shortcut icon" type="image/png" href="../metrologo-mark.png" />
  <link rel="apple-touch-icon" href="../metrologo-mark.png" />
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
      border-bottom: 3px solid var(--route);
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
      align-content: center;
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
    .badges.n-many {
      max-width: 1.36in;
    }
    .badges.n-many .badge {
      width: 0.32in;
      height: 0.32in;
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
      font-size: 10px;
      letter-spacing: ${pack > 3 ? "0.06em" : "0.16em"};
      text-transform: uppercase;
      font-weight: 700;
      color: var(--route);
    }
    .ident h1 {
      margin: 2px 0 3px;
      font-size: 26px;
      line-height: 1.05;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .ident .meta { font-size: 12px; color: var(--muted); }
    .qr-block {
      justify-self: end;
      width: 0.95in;
      text-align: center;
    }
    .qr-block a { color: inherit; text-decoration: none; display: block; }
    .qr-block svg { width: 0.92in; height: 0.92in; display: block; margin: 0 auto; }
    .qr-block .qr-cap {
      font-size: 7.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
      margin-top: 3px;
      line-height: 1.2;
      color: var(--muted);
    }

    .heading {
      padding-top: 8px;
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
      font-size: 26px;
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
      font-size: 13px;
      opacity: 0.85;
      padding-top: 0.2em;
    }
    .led-dest {
      flex: 1 1 auto;
      min-width: 0;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
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
      font-weight: 700;
      padding: 4px 8px 5px 0;
      border-bottom: 2px solid var(--ink);
      vertical-align: bottom;
      white-space: nowrap;
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
      font-size: 13px;
    }
    table.tt tbody th.hour::after {
      content: ":";
      margin-left: 0.04em;
    }
    table.tt td, table.tt tbody th {
      padding: 1px 8px 1px 0;
      border-top: 1px solid var(--rule);
      font-size: 13px;
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
    .min .uw { font-size: 0.72em; font-weight: 700; margin-left: 1px; }
    .h12 .ap { font-size: 0.58em; font-weight: 600; margin-left: 1px; }

    footer.notes {
      margin-top: auto;
      padding-top: 8px;
      border-top: 1px solid var(--rule);
      font-size: 9.5px;
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
        height: auto;
      }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body > *:not(.sheet) { display: none !important; }
      .sheet {
        margin: 0 !important;
        width: 8.5in;
        max-width: none;
        min-height: 0 !important;
        height: auto !important;
        overflow: visible;
      }
      @page { size: 8.5in 11in; margin: 0; }
    }
  </style>
</head>
<body data-clock="12">
  <script>if (new URLSearchParams(location.search).has("shot")) document.body.classList.add("shot");</script>
  <div class="chrome">
    <button type="button" onclick="window.print()">Print / save PDF</button>
    <label><input type="radio" name="clock" value="12" checked onchange="document.body.dataset.clock='12'" /> 12-hour</label>
    <label><input type="radio" name="clock" value="24" onchange="document.body.dataset.clock='24'" /> 24-hour</label>
    <span class="hint">Letter · actual size · tape extra pages if needed</span>
  </div>

  <article class="sheet${multi ? " multi" : ""}" data-headings="${headings.length}">
    <header class="mast">
      ${badges}
      <div class="ident">
        <div class="kicker">${escapeHtml(kicker)}</div>
        <h1>${escapeHtml(stop.stop_name)}</h1>
        <div class="meta">Stop #${escapeHtml(stop.stop_code)}${street ? `, on ${escapeHtml(street)}` : ""}</div>
      </div>
      <div class="qr-block">
        <a href="${escapeHtml(predUrl)}" target="_blank" rel="noopener" title="Live departures from this stop">
          ${qr}
          <div class="qr-cap">Live departures</div>
        </a>
      </div>
    </header>

    ${sections}

    <footer class="notes">
      <div>
        <div>This is a citizen-made timetable intended to improve accessibility, not an official Metro Transit bulletin. Holidays usually follow Sunday schedules.${anySessionOnly ? " * UW in session only." : ""}${routeNote ? ` ${escapeHtml(routeNote)}` : ""}</div>
        <div class="source">Source: Metro Transit GTFS ${escapeHtml(feed.feed_version)}, valid ${escapeHtml(formatDateRange(feed.feed_start_date, feed.feed_end_date))}. Please check for detours and holidays at cityofmadison.com/metro.</div>
      </div>
    </footer>
  </article>
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
