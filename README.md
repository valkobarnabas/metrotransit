# Custom Metro Transit posters

Unofficial printable posters and a stop map for [Madison Metro Transit](https://www.cityofmadison.com/metro), built from Metro’s public [GTFS feed](https://transitdata.cityofmadison.com/GTFS/).

Open the site with a local web server, or view it live at the [GitHub Pages](https://valkobarnabas.github.io/metrotransit) site. The timetables, stop lists, and map load gzipped schedule data, which a browser will not fetch from a `file://` page.

## Timetable generator

Search for a stop by number or name, then choose one or more routes. The poster lists departures by hour, split by headsign, with the next stops, the end of the line, and how long that ride takes. School-extra routes stay off unless you include them. Print or save a PDF from the poster page. The QR code opens Metro’s live predictions for that stop.

## Stop list generator

Search for a stop and pick a route. Each direction leaving that stop becomes its own letter-size sheet of the stops still ahead, plus nearby transfers. A headboard option can be forced on; splits that already need one, such as route 80 at stop 0010, keep it.

## Hybrid generator

Search for a stop and choose one route. Each direction is a row of boxed departure times, split into the same day columns as the timetable: morning times labeled AM, afternoon and evening times labeled PM on grey boxes, and after-midnight trips marked with “am”. The stop list for those trips follows, with the same Next Stops rule and footer as the stop-list posters. The QR code is the live-departures code. Attempt to fit to page starts unchecked. When it is on, it leaves a sheet alone when it is already under 11 inches, and shrinks the row height when it is taller. At 15 inches or more it also tries two columns, and keeps that layout only when the sheet actually gets shorter. The poster still says how many letter pages it needs when the type cannot shrink any further.

## Map

Shows Metro stops on a map of the Madison area. Hover or click a stop for its name, number, and routes. Click anywhere else on the map to close the card. Search for a stop or a Madison-area address, and filter the dots by route. From a stop’s card, open its timetable, stop list, or hybrid poster.

## Refresh the data

When a new GTFS zip is published, from the parent folder of this site:

```bash
node metrotransitgithub/build-data.js path/to/gtfs.zip
```

A folder that already contains `stops.txt` works in place of the zip. The command rewrites `data/pack.json.gz` and `data/served.json.gz`. Update the date range in the home-page footer to match the new feed. The data currently loaded is valid August 16, 2026 – December 5, 2026.
