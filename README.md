# Metro Transit timetable generator
This is an unofficial tool to create custom printable timetables for [Madison Metro Transit](https://www.cityofmadison.com/metro) stops, built from the public [GTFS data](https://transitdata.cityofmadison.com/GTFS/). It is modelled after European bus stop posters (à la Budapest, Vienna, Helsinki, etc...). The leftmost column in each table is the hour, and the comma-separated minutes follow to the right. The poster is split up by route headboards, so users of the system know precisely which bus they are looking for: each headboard section contains hours of operation, the next three stops on that route, the final stop of the route, and how many stops/how long it takes to get to said final stop. 

## Use the site

1. Type a **stop number** (`0010`) or search by **stop name** (`Langdon at N Park`).
2. Pick a match. Colored letters are the routes at that stop; **EB / NB / WB / SB** is the street direction.
3. Choose **All routes** or select individual routes to include on your poster. **Exclude school extras** is on by default (routes 60–64).
4. **Generate poster**, then **Open** or **Download HTML**.
5. Print or save pdf from the poster page. You may choose either the 12-hour or 24-hour variant.

Scan or click the QR code in the top right to view Metro’s official live departure predictions for that stop.

## Rebuild the stop data

Packed timetables live in `data/pack.json.gz` (about 1,500 stops, ~2 MB gzipped). Rebuild it from the parent GTFS repo (GTFS data updates every ~3 months) after a feed update:

```bash
# from the mmt_gtfs repo root, after putting the contents of this repo into a github/ folder
node github/build-data.js
```

That writes `data/pack.json.gz` and a copy of `generate_poster.js` into this folder.

## Command-line posters

From the parent `mmt_gtfs` repo (Node required; `npm install` once):

```bash
node generate_poster.js --route C --stop 2717
node generate_poster.js --route ALL --stop 0010
node generate_poster.js --route ALL+SCHOOL --stop 2655
node generate_poster.js --route 55,75 --stop 4401
```

`--route ALL` skips school extras. `--route ALL+SCHOOL` includes them. A named list (`--route 60` or `--route E,62`) always includes those routes. If `ALL` finds only one regular route, the file is named like the single-route poster (`e-2775.html`), not `all-2775.html`.

HTML files are written to `posters/`.
