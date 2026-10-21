# Custom Metro Transit posters

Unofficial printable posters and a stop map for [Madison Metro Transit](https://www.cityofmadison.com/metro), built from Metro’s public [GTFS feed](https://transitdata.cityofmadison.com/GTFS/).

Open the site with a local web server, or view it live at the [GitHub Pages](https://valkobarnabas.github.io/metrotransit) site.

## Timetable generator

Search for a stop by number or name, then choose one or more routes to include on your poster. The poster lists boxed departure times by hour (AM times in white boxes, PM in grey), split by route headsigns. School-extra routes stay off of the poster unless you specifically include them. Print or save a PDF from the poster page. The QR code in the top right opens Metro’s live predictions for that stop (https://metromap.cityofmadison.com/predictions/bystop/bustime:XXXX, where XXXX is the stop ID number).

## Hybrid generator

Search for a stop and choose *one* route. Each hybrid poster shows boxed departure times, split into the same day columns as the timetable: morning times labeled AM, afternoon and evening times labeled PM on grey boxes. The stop list for those trips follows beneath, which is a table of the next stops served by your chosen route, from your chosen stop (i.e. it shows all the stops you can reach from your stop on your route). Each stop down the line has how many stops away from your stop it is and how long in minutes it takes to get there (this is a trip-weighted average and may vary during peak/off-peak hours). Each stop also list possible transfers to other Metro routes (the cutoff is <=250 ft away as the crow flies, which the median person can walk in exactly 1 minute; only feasible transfers are shown, so you can't transfer from the 81 to the 38 because the 81 starts after 38 stops for the day). Use *Generate stop list only* when you just want the remaining stops and nearby transfers. The QR code is again the live-departures code. Attempt to fit to page starts unchecked. When it is on, it leaves a sheet alone when it is already under 11 inches, and shrinks the row height when it is taller. At 15 inches or more it also tries two columns, and keeps that layout only when the sheet actually gets shorter. This function is not guaranteed to work well on long posters.

## Map

Shows Metro stops on a map of the Madison area. Hover or click a stop for its name, number, and routes. Click anywhere else on the map to close the card. Search for a stop or a Madison-area address, and filter the dots by route, or jurisdiction (Madison, Fitchburg, UW-Madison, Private, etc..., Maple Bluff?!) or shelter-stops under *Advanced*. From a stop’s card, you may directly open its timetable, stop list, or hybrid poster.

## Service changes

Compares the current calendar to the previous one at a stop, as a hybrid page in the browser. Times that moved by 10 minutes or less are yellow, new times are green, and dropped times are red, including whole headings. The stop list uses the same colors when a stop, travel time, stop count, or transfer set changed. Search includes stops that existed only on the previous calendar, shown in red. The current *past* calendar was valid **5/10/26-8/15/26**, while the current *in-effect* calendar is valid **8/16/26-12/5/26**.

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

A folder that already contains `stops.txt` works in place of a zip. The current command rewrites `data/pack.json.gz`, `data/served.json.gz`, and `data/stop-meta.json`. A previous calendar also writes `data/prev-pack.json.gz`, `data/prev-served.json.gz`, and stores the source feed as `data/prev-gtfs.tar.gz`. Update the date range in the home-page footer to match the new feed. 

The data currently loaded is valid August 16, 2026 – December 5, 2026. Data provided under license granted by City of Madison, WI, Metro Transit (see [Terms of Use](https://transitdata.cityofmadison.com/MetroTransitDataTermsOfUse.pdf) for details).
