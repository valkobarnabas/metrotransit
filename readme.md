# Metro stop posters

Unofficial printable timetables for [Madison Metro Transit](https://www.cityofmadison.com/metro) stops, built from the public GTFS feed. This is a citizen-made tool, not a Metro bulletin. Check [cityofmadison.com/metro](https://www.cityofmadison.com/metro) for detours and holidays.

## Use the site

1. Type a **stop number** (`0010`) or search by **stop name** (`Langdon at N Park`).
2. Pick a match. Colored letters are the routes at that stop; **EB / NB / WB / SB** is the street direction.
3. Choose **All routes** or select individual routes to include on your poster. **Exclude school extras** is on by default (routes 60–64).
4. **Generate poster**, then **Open** or **Download HTML**.

Print from the poster page: Letter, actual size, no headers or footers.

Live departures (QR code in top right) goes to Metro’s official live departure predictions.

## GitHub Pages

This folder is the site root. To publish:

1. Create a GitHub repository and copy everything in this folder into it (including `data/pack.json`).
2. Settings → Pages → Deploy from a branch → `main` / root.

Do not open `index.html` as a local file. Serve the folder instead:

```bash
npx serve .
```

## Rebuild the stop data

Packed timetables live in one file, `data/pack.json` (about 1,500 stops). Rebuild it from the parent GTFS repo (GTFS data updates every ~3 months) after a feed update:

```bash
# from the mmt_gtfs repo root (the folder that contains stops.txt)
node github/build-data.js
```

That writes `data/pack.json` and a copy of `generate_poster.js` into this folder.

## Command-line posters

From the parent `mmt_gtfs` repo (Node required; `npm install` once):

```bash
node generate_poster.js --route F --stop 6894
node generate_poster.js --route ALL --stop 0010
node generate_poster.js --route ALL+SCHOOL --stop 0716
node generate_poster.js --route A,C,80 --stop 0716
```

`--route ALL` skips school extras. `--route ALL+SCHOOL` includes them. A named list (`60` or `C,64`) always includes those routes. If `ALL` finds only one regular route, the file is named like the single-route poster (`f-2197.html`), not `all-2197.html`.

HTML files are written to `posters/`.
