# Metro Transit stop list posters

Unofficial printable timetable and stop list posters for [Madison Metro Transit](https://www.cityofmadison.com/metro).

## Use the site

0. Choose the **Timetable Generator** or the **Stop List Generator**.
1. Type a **stop number** or search by **stop name**.
2. Pick your **route(s)** (school extras 60–64 stay hidden unless you uncheck **Exclude school extras**).
3. **Generate poster**. Nearby transfers use a fixed 250 ft radius.
4. Print or Save as PDF from the poster chrome.

## Rebuild the stop data

From the parent repo (the folder that contains `stops.txt` from the GTFS data):

```bash
node metrotransit-main/build-data.js
```

That writes `data/served.json.gz` (patterns + coordinates).

## Attribution
The walking figure beside a transfer distance is Bootstrap Icons’ `person-walking` ([twbs/icons](https://github.com/twbs/icons)), MIT License. Copyright 2019–2024 The Bootstrap Authors.
