/**
 * Rebuild timetable and stop-list data from a GTFS zip (or an extracted folder).
 *
 * From the repo root:
 *   node metrotransit-main/build-data.js path\to\gtfs.zip
 *
 * Writes github/data/pack.json.gz, github-stoplists/data/served.json.gz,
 * and copies both into metrotransit-main/data/ with a fresh stop-meta.json
 * (jurisdiction and shelter flags for the map filters).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const siteData = path.join(__dirname, "data");

function usage() {
  console.error("Usage: node metrotransit-main/build-data.js <gtfs.zip | folder-with-stops.txt>");
  process.exit(1);
}

function findGtfsDir(dir) {
  if (fs.existsSync(path.join(dir, "stops.txt"))) return dir;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(current, entry.name);
      if (fs.existsSync(path.join(sub, "stops.txt"))) return sub;
      stack.push(sub);
    }
  }
  return null;
}

function extractZip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    execFileSync("tar", ["-xf", zip, "-C", dest], { stdio: "inherit" });
    return;
  } catch (error) {
    console.error(error.message || error);
  }
  const ps = [
    "-NoProfile",
    "-Command",
    "Expand-Archive -LiteralPath $env:GTFS_ZIP -DestinationPath $env:GTFS_OUT -Force",
  ];
  execFileSync("powershell.exe", ps, {
    stdio: "inherit",
    env: { ...process.env, GTFS_ZIP: zip, GTFS_OUT: dest },
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => String(cell).trim()));
}

function writeStopMeta(gtfsDir, outPath) {
  const stops = parseCsv(fs.readFileSync(path.join(gtfsDir, "stops.txt"), "utf8"));
  const head = stops[0] || [];
  const idI = head.indexOf("stop_id");
  const codeI = head.indexOf("stop_code");
  const jurI = head.indexOf("jurisdiction_id");
  if (codeI < 0 || jurI < 0) throw new Error("stops.txt is missing stop_code or jurisdiction_id.");
  const codeById = new Map();
  const meta = {};
  for (const row of stops.slice(1)) {
    const code = String(row[codeI] || "").trim() || String(row[idI] || "").trim();
    if (!code) continue;
    if (idI >= 0) codeById.set(row[idI], code);
    meta[code] = { j: String(row[jurI] || "").trim() };
  }
  const featuresPath = path.join(gtfsDir, "stop_features.txt");
  let shelters = 0;
  if (fs.existsSync(featuresPath)) {
    const features = parseCsv(fs.readFileSync(featuresPath, "utf8"));
    const featHead = features[0] || [];
    const fid = featHead.indexOf("stop_id");
    const ftype = featHead.indexOf("stop_feature");
    for (const row of features.slice(1)) {
      const kind = String(row[ftype] || "");
      if (kind !== "1000" && kind !== "1100") continue;
      const code = codeById.get(row[fid]);
      if (!code || !meta[code] || meta[code].s) continue;
      meta[code].s = 1;
      shelters += 1;
    }
  } else {
    console.log("No stop_features.txt; shelter flags were left unset.");
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(meta));
  return { stops: Object.keys(meta).length, shelters };
}

function runBuilder(script, gtfsDir) {
  execFileSync(process.execPath, [script], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, GTFS_DIR: gtfsDir },
  });
}

function main() {
  const input = process.argv[2];
  if (!input) usage();
  const source = path.resolve(input);
  if (!fs.existsSync(source)) {
    console.error(`Not found: ${source}`);
    usage();
  }

  let gtfsDir = null;
  let temp = null;
  try {
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      gtfsDir = findGtfsDir(source);
    } else {
      temp = fs.mkdtempSync(path.join(os.tmpdir(), "mmt-gtfs-"));
      console.log(`Extracting ${source}`);
      extractZip(source, temp);
      gtfsDir = findGtfsDir(temp);
    }
    if (!gtfsDir) throw new Error("stops.txt was not found in that GTFS feed.");
    for (const name of ["routes.txt", "trips.txt", "stop_times.txt"]) {
      if (!fs.existsSync(path.join(gtfsDir, name))) {
        throw new Error(`Missing ${name} next to stops.txt.`);
      }
    }

    console.log(`Reading GTFS from ${gtfsDir}`);
    runBuilder(path.join(root, "github", "build-data.js"), gtfsDir);
    runBuilder(path.join(root, "github-stoplists", "build-data.js"), gtfsDir);

    fs.mkdirSync(siteData, { recursive: true });
    fs.copyFileSync(path.join(root, "github", "data", "pack.json.gz"), path.join(siteData, "pack.json.gz"));
    fs.copyFileSync(path.join(root, "github-stoplists", "data", "served.json.gz"), path.join(siteData, "served.json.gz"));
    const metaPath = path.join(siteData, "stop-meta.json");
    const meta = writeStopMeta(gtfsDir, metaPath);
    console.log(
      `Updated metrotransit-main/data/pack.json.gz, served.json.gz, and stop-meta.json (${meta.stops} stops, ${meta.shelters} shelters)`
    );
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { writeStopMeta };
