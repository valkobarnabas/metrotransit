/**
 * Pack GTFS into the static site under github/data.
 * Run from the repo root: node github/build-data.js
 */
const fs = require("fs");
const path = require("path");
const {
  loadGtfs,
  collectPosterData,
  routesServingStop,
  isSchoolSupplement,
  qrBits,
  stopPredictionUrl,
} = require("../generate_poster.js");

const DIR = { 0: "NB", 90: "EB", 180: "SB", 270: "WB" };
const OUT = __dirname;

function slimStop(s) {
  return {
    stop_id: s.stop_id,
    stop_code: s.stop_code,
    stop_name: s.stop_name,
    cardinal_direction: s.cardinal_direction,
    primary_street: s.primary_street,
  };
}

function slimRoute(r) {
  return {
    route_id: r.route_id,
    route_short_name: r.route_short_name,
    route_long_name: r.route_long_name,
    route_desc: r.route_desc,
    route_color: r.route_color,
    route_text_color: r.route_text_color,
    route_sort_order: r.route_sort_order,
  };
}

function slimFeed(f) {
  return {
    feed_version: f.feed_version,
    feed_start_date: f.feed_start_date,
    feed_end_date: f.feed_end_date,
  };
}

function slimHeading(h) {
  return {
    headsign: h.headsign,
    board: h.board,
    routeDirection: h.routeDirection,
    here: h.here,
    next3: h.next3,
    dest: h.dest,
    remainingCount: h.remainingCount,
    avgTravelMinutes: h.avgTravelMinutes,
    skippedAfter: h.skippedAfter,
    columns: h.columns,
    hasSessionOnly: h.hasSessionOnly,
    routeColor: h.routeColor,
    routeTextColor: h.routeTextColor,
    routeShortName: h.routeShortName,
  };
}

function packPart(data) {
  return {
    stop: slimStop(data.stop),
    route: slimRoute(data.route),
    routes: [slimRoute(data.route)],
    feed: slimFeed(data.feed),
    headings: data.headings.map(slimHeading),
    school: isSchoolSupplement(data.route),
  };
}

function main() {
  fs.copyFileSync(path.join(__dirname, "../generate_poster.js"), path.join(OUT, "generate_poster.js"));
  const { stops, feed } = loadGtfs();
  const dataDir = path.join(OUT, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const stopDir = path.join(dataDir, "s");
  if (fs.existsSync(stopDir)) fs.rmSync(stopDir, { recursive: true, force: true });
  const oldIndex = path.join(dataDir, "stops.json");
  if (fs.existsSync(oldIndex)) fs.unlinkSync(oldIndex);

  const index = [];
  const byCode = {};
  let packed = 0;
  for (const stop of stops) {
    const serving = routesServingStop(stop);
    if (!serving.length) continue;
    const parts = [];
    for (const route of serving) {
      try {
        parts.push(packPart(collectPosterData(route.route_short_name, stop.stop_code)));
      } catch {
        /* listed but no pickups */
      }
    }
    if (!parts.length) continue;
    const code = stop.stop_code;
    byCode[code] = {
      stop: slimStop(stop),
      feed: slimFeed(feed),
      qrBits: qrBits(stopPredictionUrl(stop.stop_code)),
      parts,
    };
    index.push({
      code,
      name: stop.stop_name,
      street: (stop.primary_street || "").trim(),
      dir: DIR[Number(stop.cardinal_direction)] || "",
      routes: parts.map((p) => ({
        n: p.route.route_short_name,
        c: `#${p.route.route_color || "333366"}`,
        t: `#${p.route.route_text_color || "FFFFFF"}`,
        s: p.school,
      })),
    });
    packed += 1;
    if (packed % 100 === 0) console.log(`  packed ${packed} stops`);
  }

  index.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  const outPath = path.join(dataDir, "pack.json");
  fs.writeFileSync(outPath, JSON.stringify({ stops: index, byCode }));
  const mb = (fs.statSync(outPath).size / 1e6).toFixed(1);
  console.log(`Wrote ${index.length} stops to github/data/pack.json (${mb} MB)`);
}

main();
