/**
 * Rebuild timetable and stop-list data from a GTFS zip (or an extracted folder).
 *
 * From the repo root:
 *   node metrotransitgithub/build-data.js path\to\gtfs.zip
 *
 * Writes github/data/pack.json.gz, github-stoplists/data/served.json.gz,
 * and copies both into metrotransitgithub/data/.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const siteData = path.join(__dirname, "data");

function usage() {
  console.error("Usage: node metrotransitgithub/build-data.js <gtfs.zip | folder-with-stops.txt>");
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
    console.log("Updated metrotransitgithub/data/pack.json.gz and served.json.gz");
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}

main();
