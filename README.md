# Custom Metro Transit posters

Unofficial printable posters and a stop map for [Madison Metro Transit](https://www.cityofmadison.com/metro), built from Metro’s public [GTFS feed](https://transitdata.cityofmadison.com/GTFS/).

Open the site with a local web server, or view it live at the [GitHub Pages](https://valkobarnabas.github.io/metrotransit) site. The timetables, stop lists, and map load gzipped schedule data, which a browser will not fetch from a `file://` page.

## Timetable generator

Search for a stop by number or name, then choose one or more routes. The poster lists departures by hour, split by headsign. School-extra routes stay off unless you include them. Print or save a PDF from the poster page. The QR code opens Metro’s live predictions for that stop.

## Hybrid generator

Search for a stop and choose one route. Each direction is a row of boxed departure times, split into the same day columns as the timetable: AM departures in white boxes, PM departures in grey boxes. The stop list for those trips follows. Use **Generate stop list only** when you just want the remaining stops and nearby transfers. The QR code is the live-departures code. Attempt to fit to page starts unchecked. When it is on, it leaves a sheet alone when it is already under 11 inches, and shrinks the row height when it is taller. At 15 inches or more it also tries two columns, and keeps that layout only when the sheet actually gets shorter. The poster still says how many letter pages it needs when the type cannot shrink any further.

## Map

Shows Metro stops on a map of the Madison area. Hover or click a stop for its name, number, and routes. Click anywhere else on the map to close the card. Search for a stop or a Madison-area address, and filter the dots by route. From a stop’s card, open its timetable, stop list, or hybrid poster. The map link is also in the header on the other tools.

## Service changes

Compares the current calendar to the previous one at a stop, as a hybrid page. Times that moved by 10 minutes or less are yellow, new times are green, and dropped times are red, including whole headings. The stop list uses the same colors when a stop, travel time, stop count, or transfer set changed. Search includes stops that existed only on the previous calendar, shown in red.

## Refresh the data

When a new GTFS zip is published, from the parent folder of this site:

```bash
node metrotransit-main/build-data.js path/to/current.zip
```

To rebuild the previous calendar at the same time (the comparison page needs this):

```bash
node metrotransit-main/build-data.js path/to/current.zip path/to/previous.zip
```

To rebuild only the previous calendar:

```bash
node metrotransit-main/build-data.js --prev path/to/previous.zip
```

A folder that already contains `stops.txt` works in place of a zip. The current command rewrites `data/pack.json.gz`, `data/served.json.gz`, and `data/stop-meta.json`. A previous calendar also writes `data/prev-pack.json.gz`, `data/prev-served.json.gz`, and stores the source feed as `data/prev-gtfs.tar.gz`. Update the date range in the home-page footer to match the new feed. The data currently loaded is valid **August 16, 2026 – December 5, 2026**.
