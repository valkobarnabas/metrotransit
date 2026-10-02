const P = window.MMTPoster;
const S = window.MMTServed;
const qEl = document.getElementById("q");
const resultsEl = document.getElementById("results");
const pickedEl = document.getElementById("picked");
const pickedName = document.getElementById("picked-name");
const pickedMeta = document.getElementById("picked-meta");
const routesEl = document.getElementById("routes");
const noSchoolEl = document.getElementById("noschool");
const goEl = document.getElementById("go");
const goTimesEl = document.getElementById("go-times");
const goStopsEl = document.getElementById("go-stops");
const errEl = document.getElementById("err");
const outEl = document.getElementById("out");
const preview = document.getElementById("preview");

let stops = [];
let byCode = {};
let servedPack = null;
let locations = { reviewed: [], stops: {} };
let selected = null;
let lastHtml = "";
let lastPart = "both";
let lastFit = false;
let lastBw = false;

function showErr(msg) {
  errEl.hidden = !msg;
  errEl.textContent = msg || "";
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchStops(query) {
  const raw = query.trim();
  if (!raw) return [];
  const exact = stops.filter((s) => s.code === raw || s.code.replace(/^0+/, "") === raw.replace(/^0+/, ""));
  if (/^\d{3,5}$/.test(raw) && exact.length) return exact.slice(0, 8);
  const nq = norm(raw);
  const scored = [];
  for (const s of stops) {
    const name = norm(s.name);
    const code = s.code.toLowerCase();
    let score = 0;
    if (code === raw.toLowerCase()) score = 100;
    else if (code.startsWith(raw.toLowerCase())) score = 80;
    else if (name.startsWith(nq)) score = 60;
    else if (name.includes(nq)) score = 40;
    else if (norm(s.street).includes(nq)) score = 20;
    if (score) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, 12).map((x) => x.s);
}

function routePills(routes) {
  return routes
    .map((r) => `<span class="pill" style="background:${r.c};color:${r.t}">${escapeText(r.n)}</span>`)
    .join("");
}

function renderResults(list) {
  if (!list.length) {
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    return;
  }
  resultsEl.hidden = false;
  resultsEl.innerHTML = list
    .map((s) => {
      const dir = s.dir ? `<span class="dir">${escapeText(s.dir)}</span>` : "";
      return `<button type="button" class="result" data-code="${escapeText(s.code)}">
        <div><span class="name">${escapeText(s.name)}</span><span class="code">#${escapeText(s.code)}</span></div>
        <div class="lines">${routePills(s.routes)}${dir}</div>
      </button>`;
    })
    .join("");
}

function visibleRoutes() {
  if (!selected) return [];
  return noSchoolEl.checked ? selected.routes.filter((r) => !r.s) : selected.routes;
}

function routeInputs() {
  return [...routesEl.querySelectorAll("input[data-route]")];
}

function syncRouteChecks() {
  const vis = new Set(visibleRoutes().map((r) => r.n));
  let checkedVisible = false;
  for (const input of routeInputs()) {
    const row = input.closest("label");
    const hidden = !vis.has(input.dataset.route);
    row.classList.toggle("off", hidden);
    input.disabled = hidden;
    if (hidden) input.checked = false;
    else if (input.checked) checkedVisible = true;
  }
  if (!checkedVisible) {
    const first = routeInputs().find((input) => !input.disabled);
    if (first) first.checked = true;
  }
  setGenerateEnabled(chosenNames().length > 0);
}

function chosenNames() {
  return routeInputs()
    .filter((i) => i.checked && !i.disabled)
    .map((i) => i.dataset.route);
}

function setGenerateEnabled(on) {
  const off = !on;
  goEl.disabled = off;
  if (goTimesEl) goTimesEl.disabled = off;
  if (goStopsEl) goStopsEl.disabled = off;
}

function showPicked(stop) {
  selected = stop;
  pickedEl.hidden = false;
  resultsEl.hidden = true;
  qEl.value = `${stop.name}  #${stop.code}`;
  pickedName.textContent = stop.name;
  const street = [stop.dir, stop.street].filter(Boolean).join(" ");
  pickedMeta.textContent = `Stop #${stop.code}${street ? " · " + street : ""}`;
  outEl.hidden = true;
  const first = stop.routes.findIndex((r) => !(noSchoolEl && noSchoolEl.checked && r.s));
  routesEl.innerHTML = stop.routes
    .map(
      (r, i) =>
        `<label><input type="radio" name="hybrid-route" data-route="${escapeText(r.n)}"${i === first ? " checked" : ""} /> <span class="pill" style="background:${r.c};color:${r.t}">${escapeText(r.n)}</span>${r.s ? " extra" : ""}</label>`
    )
    .join("");
  syncRouteChecks();
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

function minuteOf(dep) {
  let h = Number(dep.hh);
  const m = Number(dep.mm) || 0;
  if (!Number.isFinite(h)) h = 0;
  if (h < 4) h += 24;
  return h * 60 + m;
}

function sortDeps(deps) {
  return (deps || []).slice().sort((a, b) => minuteOf(a) - minuteOf(b));
}

function isAfterMidnightDep(dep) {
  const h = Number(dep && dep.hh);
  if (!Number.isFinite(h)) return false;
  return h >= 24 || (h >= 0 && h < 4);
}

function isNightOnlyColumn(col) {
  const deps = (col && col.deps) || [];
  return deps.length > 0 && deps.every(isAfterMidnightDep);
}

function columnDayLabel(col) {
  let label = col.label;
  if (col.key === "weekday") label = "Monday–Friday";
  else if (col.key === "weekend") label = "Saturday–Sunday";
  else if (col.key === "frisat") label = "Friday–Saturday";
  else if (col.key === "mt") label = "Monday–Thursday";
  else if (col.key === "sunthu") label = "Sunday–Thursday";
  else if (col.key === "friday") label = "Fridays";
  else if (col.key === "saturday") label = "Saturdays";
  else if (col.key === "sunday") label = "Sundays";
  if (isNightOnlyColumn(col) && !/night/i.test(label)) label = `${label} Night`;
  return `${label}:`;
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

function bandOf(dep) {
  if (isAfterMidnightDep(dep)) return "roll";
  return Number(dep.hh) >= 12 ? "pm" : "am";
}

function uniqDeps(deps) {
  const map = new Map();
  for (const dep of sortDeps(deps)) {
    const key = `${dep.hh}:${dep.mm}`;
    const prev = map.get(key);
    if (!prev) map.set(key, dep);
    else if ((dep.sessionOnly || dep.noteStar) && !(prev.sessionOnly || prev.noteStar)) map.set(key, dep);
  }
  return [...map.values()];
}

function boxText(dep, band) {
  const h = clockHour(Number(dep.hh));
  const hr = h % 12 || 12;
  const mm = String(Number(dep.mm) || 0).padStart(2, "0");
  const clock = `${hr}:${mm}`;
  return band === "roll" ? `${clock}am` : clock;
}

function isWeekendColumn(col) {
  const k = String((col && col.key) || "");
  if (k === "weekend" || k === "saturday" || k === "sunday" || k === "sat" || k === "sun" || k === "frisat") return true;
  const label = String((col && col.label) || "");
  if (/^(Saturday|Sunday)/.test(label)) return true;
  if (/Saturday–Sunday|Sat–Sun|Friday–Saturday|Fri–Sat/.test(label)) return true;
  return false;
}

function boxesHtml(deps, kind) {
  return deps.map((dep) => `<span class="tbox ${kind}">${boxText(dep, kind)}</span>`).join("");
}

function dayColumnHtml(col) {
  const deps = uniqDeps(col.deps);
  const am = deps.filter((d) => bandOf(d) === "am");
  const pm = deps.filter((d) => bandOf(d) === "pm");
  const roll = deps.filter((d) => bandOf(d) === "roll");
  const amInner = boxesHtml(am, "am");
  const pmBoxes = boxesHtml(pm, "pm");
  const rollBoxes = boxesHtml(roll, "roll");
  const rollInner = rollBoxes ? `<div class="boxes roll-row">${rollBoxes}</div>` : "";
  const pmInner = pmBoxes + rollInner;
  const wknd = isWeekendColumn(col) ? " wknd" : "";
  const mf = col.key === "weekday" ? " mf" : "";
  const second = amInner ? "PM" : pm.length ? "PM" : "AM";
  return `<div class="daycol">
    <div class="dayhead${wknd}${mf}">${escapeText(columnDayLabel({ ...col, deps }))}</div>
    ${amInner ? `<span class="band-lab">AM</span><div class="boxes">${amInner}</div>` : ""}
    ${pmInner ? `<span class="band-lab">${second}</span><div class="boxes">${pmInner}</div>` : ""}
  </div>`;
}

function extraHeadsign(h) {
  const note = h && h.destNote;
  if (!note || note.type !== "headsign") return "";
  const sign = String(note.headsign || "").trim();
  if (sign.toUpperCase() !== "JUNCTION VIA HIGH CROSSING") return "";
  return sign;
}

function hideTerminusNote(h) {
  const note = h && h.destNote;
  const code = note && note.type === "terminus" ? String(note.stopCode || "") : "";
  if (code === "2916" || code === "10004") return true;
  return /Highland at Observatory \(Stop #2916\)|Junction at Park And Ride \(Stop #10004\)/i.test(
    String((h && h.destFootnote) || "")
  );
}

function headingNote(h) {
  if (extraHeadsign(h) || hideTerminusNote(h)) return "";
  const note = h.destNote;
  if (note && note.type === "headsign") return `*${note.lead || ""}${note.headsign || ""}.`;
  if (note && note.type === "terminus") {
    return `*${note.lead || ""}${note.stopName || ""} (Stop #${note.stopCode || ""}).`;
  }
  const foot = String(h.destFootnote || "");
  if (/JUNCTION VIA HIGH CROSSING/i.test(foot)) return "";
  if (foot) return `*${foot}`;
  return "";
}

function normDest(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function posterDest(poster) {
  const board = poster.primaryBoard;
  if (board && board.dest) return board.dest;
  return String(poster.destLabel || "")
    .replace(/^.+\bTO\b\s*/i, "")
    .trim();
}

function matchPoster(heading, posters, used) {
  const route = String(heading.routeShortName || "").toLowerCase();
  const dest = normDest(heading.board && heading.board.dest);
  const dir = String(heading.routeDirection || "").toLowerCase();
  let best = -1;
  let score = -1;
  posters.forEach((poster, index) => {
    if (used.has(index)) return;
    if (String(poster.routeName || "").toLowerCase() !== route) return;
    let s = 1;
    const pd = normDest(posterDest(poster));
    if (dest && pd && (pd === dest || pd.includes(dest) || dest.includes(pd))) s += 5;
    if (dir && String(poster.heading || "").toLowerCase() === dir) s += 3;
    if (s > score) {
      score = s;
      best = index;
    }
  });
  if (best < 0) return null;
  used.add(best);
  return posters[best];
}

function routeListPhrase(names) {
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

function gapTo(inner) {
  return String(inner)
    .replace(/ TO /g, '<span class="to-gap">T</span>')
    .replace(/ to /g, '<span class="to-gap">T</span>');
}

function destAfterTo(label) {
  const text = String(label || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/\bTO\b\s+(.+)$/i);
  return (match ? match[1] : text).trim();
}

function joinWords(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function ledPhrase(dests, className) {
  return joinWords(dests.map((dest) => `<span class="${className}">${dest}</span>`));
}

function applySplitEnds(html) {
  const re =
    /terminate at <span class="term-name">([^<]*)<\/span> on weekdays after (\d+)pm and on weekends, and <span class="term-name">([^<]*)<\/span> otherwise\.(?: The two stops are \d+ feet away from each other\.)?/g;
  return String(html).replace(
    re,
    (match, evening, hour, day) =>
      `terminate at <span class="term-name">${day}</span> (weekdays until ${hour}pm) or <span class="term-name">${evening}</span> (weekends + after ${hour}pm).`
  );
}

function hideSignedTo(html) {
  let out = applySplitEnds(String(html)).replace(/Trips signed ([\s\S]*?) terminate/g, (match, leds) => {
    const dests = [];
    const re = /<span class="note-led">([\s\S]*?)<\/span>/g;
    let found;
    while ((found = re.exec(leds))) {
      const dest = destAfterTo(found[1]);
      if (dest) dests.push(dest);
    }
    if (!dests.length) return match;
    return `Trips towards ${ledPhrase(dests, "note-led")} terminate`;
  });
  out = out.replace(/<div class="only-served[^"]*">([\s\S]*?)<\/div>/g, (match, inner) => {
    const dests = [];
    const re = /<span class="mark">([^<]*)<\/span>/g;
    let found;
    while ((found = re.exec(inner))) {
      const dest = destAfterTo(found[1]);
      if (dest) dests.push(dest);
    }
    if (!dests.length) return match;
    return `<div class="only-served"><span class="only-cap">(only trips towards ${ledPhrase(dests, "only-led")} serve this stop)</span></div>`;
  });
  return out.replace(/<span class="note-led">([\s\S]*?)<\/span>/g, (match, inner) => {
    if (!/ TO | to /.test(inner)) return match;
    return `<span class="note-led">${gapTo(inner)}</span>`;
  });
}

function listCaption(heading, poster) {
  if (!heading) return poster.titleCode || poster.routeName || "Stops";
  const code = (heading.board && heading.board.code) || heading.routeShortName || poster.routeName || "";
  const dir = String(heading.routeDirection || "").trim();
  const dest = String((heading.board && heading.board.dest) || posterDest(poster) || "").trim();
  return [`Route ${code}`, dir, dest ? `towards ${dest}` : ""].filter(Boolean).join(" ");
}

function routeLine(heading) {
  const code = (heading.board && heading.board.code) || heading.routeShortName || "";
  const dir = String(heading.routeDirection || "").trim();
  const dest = String((heading.board && heading.board.dest) || "").trim();
  const also = extraHeadsign(heading);
  return `<div class="hy-head">
    <span class="hy-line">
      <span class="hy-route">Route ${escapeText(code)}</span>
      ${dir ? `<span class="hy-dir">${escapeText(dir)}</span>` : ""}
      ${dest ? `<span class="hy-towards">towards</span><span class="hy-dest">${escapeText(dest)}</span>` : ""}
      ${also ? `<span class="hy-and">and</span><span class="hy-dest">${escapeText(also)}</span>` : ""}
    </span>
  </div>`;
}

function timeBlockHtml(heading) {
  const columns = heading.columns || [];
  const note = headingNote(heading);
  const cols = Math.max(1, columns.length);
  const narrow = isSparse(heading) ? " narrow" : "";
  return `<section class="hy-block${narrow}" style="--route:${escapeText(heading.routeColor || "#333366")};--route-ink:${escapeText(heading.routeTextColor || "#ffffff")}">
    ${routeLine(heading)}
    <div class="days" style="grid-template-columns:repeat(${cols}, minmax(0, 1fr))">
      ${columns.map(dayColumnHtml).join("")}
    </div>
    ${note ? `<p class="tt-note">${escapeText(note)}</p>` : ""}
  </section>`;
}

function shownCount(heading) {
  let n = 0;
  for (const col of heading.columns || []) n += uniqDeps(col.deps || []).length;
  return n;
}

function isSparse(heading) {
  const cols = (heading.columns || []).filter((col) => uniqDeps(col.deps || []).length);
  return cols.length > 0 && cols.length <= 2 && shownCount(heading) <= 2;
}

function timesHtml(headings) {
  const parts = [];
  for (let i = 0; i < headings.length; i++) {
    const here = headings[i];
    const next = headings[i + 1];
    if (next && isSparse(here) && isSparse(next)) {
      parts.push(`<div class="hy-pair">${timeBlockHtml(here)}${timeBlockHtml(next)}</div>`);
      i += 1;
    } else {
      parts.push(timeBlockHtml(here));
    }
  }
  return parts.join("\n");
}

function formatDateRange(start, end) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function parse(ymd) {
    const s = String(ymd);
    return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  }
  const a = parse(start);
  const b = parse(end);
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]} ${b.getFullYear()}`;
}

function sourceLine(feed) {
  const version = (feed && (feed.feed_version || feed.v)) || "";
  const range =
    feed && feed.feed_start_date && feed.feed_end_date
      ? `, valid ${formatDateRange(feed.feed_start_date, feed.feed_end_date)}`
      : "";
  return `Source: Metro Transit GTFS${version ? " " + version : ""}${range}. Please check for detours and holidays at cityofmadison.com/metro.`;
}

function renderHybridHtml(opts) {
  const fit = !!opts.fit;
  const bw = !!opts.bw;
  const headings = opts.headings || [];
  const posters = opts.posters || [];
  const used = new Set();
  const paired = headings.map((heading) => ({ heading, poster: matchPoster(heading, posters, used) }));
  const extra = posters.filter((_, index) => !used.has(index));
  const lists = paired.filter((row) => row.poster).map((row) => row);
  extra.forEach((poster) => lists.push({ heading: null, poster }));
  const first = headings[0] || {};
  const color = first.routeColor || (lists[0] && lists[0].poster.color) || "#333366";
  const ink = first.routeTextColor || "#ffffff";
  const stop = opts.stop || {};
  const code = opts.stopCode || "";
  const name = opts.stopName || code;
  const street = opts.street || "";
  const names = [];
  const seen = new Set();
  for (const heading of headings) {
    const n = heading.routeShortName;
    if (!n || seen.has(n)) continue;
    seen.add(n);
    names.push(n);
  }
  const kicker = `Metro Transit Route ${routeListPhrase(names)}`;
  const badgeSize = names.length <= 1 ? 0.92 : names.length === 2 ? 0.86 : names.length === 3 ? 0.78 : 0.68;
  const badges = names
    .map((n) => {
      const heading = headings.find((h) => h.routeShortName === n) || {};
      const bg = heading.routeColor || "#333366";
      const fg = heading.routeTextColor || "#ffffff";
      let font = n.length > 2 ? 42 : n.length > 1 ? 56 : 72;
      font = Math.max(11, Math.round(font * (badgeSize / 0.92)));
      return `<div class="badge" style="background:${escapeText(bg)};color:${escapeText(fg)};width:${badgeSize}in;height:${badgeSize}in;font-size:${font}px"><span class="mark">${escapeText(n)}</span></div>`;
    })
    .join("");
  const qr = opts.qr || "";
  const predUrl = opts.predUrl || "";
  const part = opts.part === "timetable" || opts.part === "stops" ? opts.part : "both";
  const times = part === "stops" ? "" : timesHtml(headings);
  const manyLists = lists.length > 1;
  const listHtml = lists
    .map((row) => {
      const caption = manyLists
        ? `<div class="list-kicker">${escapeText(listCaption(row.heading, row.poster))}</div>`
        : "";
      return `<div class="list-pair">${caption}${hideSignedTo(S.listSectionHtml(row.poster, opts.servedPack))}</div>`;
    })
    .join("\n");
  const listHtmlOut = part === "timetable" ? "" : listHtml;
  const mastRule =
    part === "stops"
      ? ""
      : `<div class="mast-rule" aria-hidden="true">
      <span class="ns-line"></span>
      <span class="ns-mark">
        <svg viewBox="0 0 10 7" aria-hidden="true"><path d="M0 0h10L5 7z"/></svg>
        Timetable
        <svg viewBox="0 0 10 7" aria-hidden="true"><path d="M0 0h10L5 7z"/></svg>
      </span>
      <span class="ns-line"></span>
    </div>`;
  const slug = `${names.length ? names.join("-").toLowerCase() : "hybrid"}-${code}-hybrid`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeText(kicker)} · ${escapeText(name)} · ${escapeText(code)}</title>
  <link rel="icon" type="image/png" href="data/metrologo-mark.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
  <style>
    :root {
      --route: ${color};
      --route-ink: ${ink};
      --ink: #111;
      --muted: #4a4a4a;
      --rule: #d0d0d0;
      --paper: #fff;
      --desk: #cfc8be;
      --led: #f5a623;
      --led-bg: #0c0c0c;
      --fit: 1;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { background: var(--desk); color: var(--ink); font-family: "IBM Plex Sans", "Segoe UI", Tahoma, sans-serif; }
    .chrome {
      width: 8.3in;
      margin: 18px auto 10px;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .chrome button, .chrome #fit-label {
      background: #fff;
      border: 1px solid #7a7a7a;
      border-radius: 2px;
      padding: 7px 11px;
      font: inherit;
      cursor: pointer;
    }
    .chrome #fit-label { display: inline-flex; align-items: center; gap: 6px; }
    .chrome #fit-label[hidden] { display: none; }
    .chrome .tone { display: inline-flex; align-items: center; gap: 12px; }
    .chrome .tone label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    .chrome .hint { color: #333; }
    .sheet {
      position: relative;
      width: 8.3in;
      margin: 0 auto 28px;
      background: var(--paper);
      color: var(--ink);
      padding: 0.28in 0.34in 0.2in 0.32in;
      display: flex;
      flex-direction: column;
    }
    .sheet::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 0.14in;
      background: var(--route);
    }
    .sheet.bw,
    .sheet.bw .hy-block,
    .sheet.bw .list-block {
      --route: #5a5a5a !important;
      --route-ink: #fff !important;
      --led: #fff !important;
    }
    .sheet.bw .badge,
    .sheet.bw .sq {
      background: #5a5a5a !important;
      color: #fff !important;
    }
    header.mast {
      display: grid;
      grid-template-columns: auto 1fr 0.95in;
      gap: 12px;
      align-items: center;
      padding-bottom: 8px;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .badge {
      width: 0.92in;
      height: 0.92in;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.04em;
      background: var(--route);
      color: var(--route-ink);
    }
    .badge .mark {
      display: block;
      line-height: 1;
      text-box-trim: trim-both;
      text-box-edge: cap alphabetic;
    }
    .ident .kicker {
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--route);
    }
    .ident h1 { margin: 2px 0 3px; font-size: 26px; line-height: 1.05; font-weight: 700; letter-spacing: -0.02em; }
    .ident .meta { font-size: 12px; color: var(--muted); }
    .qr-block { justify-self: end; width: 0.95in; text-align: center; }
    .qr-block a { color: inherit; text-decoration: none; display: block; }
    .qr-block svg { width: 0.92in; height: 0.92in; display: block; margin: 0 auto; }
    .qr-block .qr-cap {
      font-size: 6.5px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      font-weight: 700;
      margin-top: 2px;
      line-height: 1.1;
      color: var(--muted);
    }
    .mast-rule {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 10px;
      color: var(--route);
    }
    .mast-rule .ns-line { flex: 1 1 auto; height: 0; border-top: 3px solid var(--route); }
    .mast-rule .ns-mark,
    .next-stops .ns-mark {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      white-space: nowrap;
      line-height: 1;
    }
    .mast-rule svg,
    .next-stops svg { width: 8px; height: 6px; fill: currentColor; display: block; }
    .flow { display: block; }
    .sheet.two-col .flow {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.12in 0.16in;
      align-items: start;
    }
    .hy-block {
      break-inside: avoid;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      margin: 0 0 calc(0.16in * var(--fit));
      background: transparent;
      border: 0;
      padding: 0;
    }
    .hy-block.narrow { width: max-content; max-width: 100%; }
    .hy-pair {
      position: relative;
      display: grid;
      grid-template-columns: max-content max-content;
      column-gap: 0.18in;
      align-items: stretch;
      width: max-content;
      max-width: 100%;
      margin: 0 0 calc(0.16in * var(--fit));
    }
    .hy-pair > .hy-block + .hy-block { position: relative; }
    .hy-pair > .hy-block + .hy-block::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(-0.09in - 0.5px);
      width: 1px;
      background: #111;
    }
    .hy-pair > .hy-block { width: max-content; max-width: 100%; margin: 0; }
    .hy-pair .hy-head { font-size: calc(11.5px * var(--fit)); }
    .hy-pair .hy-line { flex-wrap: nowrap; }
    .hy-pair .hy-dest { font-size: calc(13px * var(--fit)); letter-spacing: 0.08em; }
    .hy-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.22em 0.45em;
      margin: 0 0 5px;
      font-size: calc(13px * var(--fit));
      line-height: 1.35;
    }
    .hy-line {
      display: flex;
      flex: 1 1 100%;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.22em 0.35em;
      width: 100%;
      box-sizing: border-box;
      border: 0;
      background: none;
      color: #111;
      padding: 0;
    }
    .hy-route { font-weight: 700; }
    .hy-dir { font-weight: 400; margin-right: -0.16em; }
    .hy-towards, .hy-and { color: inherit; }
    .hy-dest {
      font-family: "Share Tech Mono", Consolas, monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: calc(15px * var(--fit));
      line-height: 1;
      background: var(--led-bg);
      color: var(--led);
      border: 1px solid #2b2b2b;
      padding: 0.12em 0.38em 0.08em;
    }
    .days { display: grid; column-gap: 0.16in; align-items: stretch; }
    .daycol {
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      column-gap: 0.28em;
      align-items: start;
      align-content: start;
    }
    .dayhead {
      grid-column: 1 / -1;
      justify-self: start;
      font-size: calc(10px * var(--fit));
      font-weight: 800;
      letter-spacing: 0.04em;
      margin: 0 0 5px;
      text-decoration: none;
      line-height: 1.2;
    }
    .dayhead.mf { font-size: calc((10px + 1pt) * var(--fit)); font-weight: 800; }
    .dayhead.wknd { font-style: italic; font-weight: 400; }
    .band-lab {
      font-size: calc(11.5px * var(--fit));
      font-weight: 600;
      line-height: 1.2;
      padding-top: calc(1px * var(--fit));
    }
    .boxes {
      --time-size: calc(11.5px * var(--fit));
      font-size: var(--time-size);
      --box: round(3.45em, 1px);
      --box-h: round(1.2em + 2px, 1px);
      display: grid;
      grid-template-columns: repeat(auto-fill, var(--box));
      justify-content: start;
      align-items: start;
      width: 100%;
      min-width: 0;
      column-gap: 0;
      row-gap: 0;
    }
    .boxes .roll-row {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      width: 100%;
      min-width: 0;
      margin: 0;
      padding: 0;
      gap: 0;
      font-size: var(--time-size);
    }
    .tbox {
  box-sizing: border-box;
  width: calc(100% + 1px);
  height: var(--box-h);
  border: 1px solid #111;
  margin: 0 -1px -1px 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--time-size);
  line-height: 1;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  background: #fff;
  text-align: center;
  white-space: nowrap;
}
    .tbox.roll {
  width: auto;
  min-width: calc(var(--box) + 1px);
  max-width: none;
  flex: 0 0 auto;
  margin: 0 -1px -1px 0;
  padding-left: 0.22em;
  padding-right: 0.22em;
  background: #fff;
  font-weight: 500;
}
    .tbox.pm { background: #d9d9d9; font-weight: 700; }
    .tt-note { margin: 4px 0 0; font-size: calc(10.5px * var(--fit)); line-height: 1.35; color: var(--muted); }
    .ss-table .tt-note { margin: 0; line-height: 1; }
    .list-kicker {
      margin: 0.08in 0 2px;
      font-size: calc(12px * var(--fit));
      font-weight: 700;
      line-height: 1.3;
    }
    .list-block { margin: 0.1in 0 0; }
    .next-stops {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 8px;
      color: var(--route);
    }
    .next-stops .ns-line { flex: 1 1 auto; height: 0; border-top: 3px solid var(--route); }
    .ss-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      border-left: 1px solid var(--route);
      border-right: 1px solid var(--route);
      border-bottom: 1px solid var(--route);
    }
    .ss-table th {
      font-size: calc(8.5px * var(--fit));
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-align: left;
      background: var(--route);
      color: #fff;
      border-right: 1px solid rgba(255,255,255,0.35);
      padding: calc(0.05in * var(--fit)) 0.06in;
      vertical-align: bottom;
    }
    .ss-table th.sn, .ss-table th.xf { font-size: calc(10px * var(--fit)); }
    .ss-table td {
      position: relative;
      padding: calc(0.045in * var(--fit)) 0.06in;
      vertical-align: top;
      font-size: calc(10.5px * var(--fit));
      line-height: 1.25;
      background: #fff;
    }
    .ss-table td::before {
      content: "";
      position: absolute;
      top: 0; bottom: 0; right: 0;
      width: 1px;
      background: var(--ink);
      z-index: 1;
    }
    .ss-table td:last-child::before { content: none; }
    .ss-table td::after {
      content: "";
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 1px;
      background: var(--rule);
    }
    .ss-table tr.alt td { background: #f3f1ed; }
    .ss-table tr.variant td { background: #d4d1cb; }
    .ss-table tr.variant td::after { background: var(--ink); }
    .ss-table tr.variant td.sn { font-style: italic; }
    .ss-table tr.variant-alt td { background: #fff; }
    .ss-table tr.end.variant td::after { background: var(--rule); }
    .ss-table tbody tr:last-child td::after { content: none; }
    .ss-table th:last-child, .ss-table td:last-child { border-right: 0; }
    .ss-table .idx { width: 0.62in; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    .ss-table .min { width: 0.72in; font-variant-numeric: tabular-nums; font-weight: 600; }
    .ss-table .sn { width: auto; }
    .stop-name { font-weight: 600; }
    .stop-no { color: var(--muted); font-weight: 500; }
    .xfer { display: flex; flex-wrap: wrap; align-items: center; row-gap: 3px; }
    .xfer-cluster { display: inline-flex; flex-wrap: wrap; align-items: center; row-gap: 3px; }
    .xfer-plus { width: 0.85em; margin: 0 0.08em; font-weight: 700; font-size: 9px; color: var(--muted); }
    .sq {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5em;
      height: 1.15em;
      min-width: 1.5em;
      margin-right: 2px;
      font-size: calc(10.5px * var(--fit));
      font-weight: 800;
      line-height: 1;
      vertical-align: middle;
    }
    .sq .mark { display: block; line-height: 1; }
    .xfer-stop {
      display: inline-flex;
      align-items: center;
      gap: 0.15em;
      margin-left: 0.2em;
      font-size: 8px;
      color: var(--muted);
      white-space: nowrap;
    }
    .xfer-stop .walk { width: calc(11px * var(--fit)); height: calc(11px * var(--fit)); flex: none; }
    .loi-list { display: flex; flex-wrap: wrap; gap: 2px 8px; }
    .loi { display: inline-flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 600; }
    .loi svg { width: 11px; height: 11px; flex: none; }
    .only-served {
      display: block;
      min-width: 0;
      margin-top: 1px;
      font-style: italic;
      font-size: 9px;
      line-height: 14px;
      color: var(--muted);
      white-space: normal;
    }
    .only-cap { font-style: italic; white-space: normal; }
    .only-led {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      height: 11px;
      font-family: "Share Tech Mono", Consolas, monospace;
      font-style: normal;
      font-size: 7.5px;
      letter-spacing: 0.04em;
      line-height: 1;
      text-transform: uppercase;
      text-box-trim: trim-both;
      text-box-edge: cap alphabetic;
      transform: translateY(-0.5px);
      background: var(--led-bg);
      color: var(--led);
      border: 1px solid #2b2b2b;
      padding: 0 0.28em;
    }
    .led-plane { width: 0.9em; height: 0.9em; margin: 0 0.12em; vertical-align: -0.12em; }
    .tt-note .term-name { font-weight: 700; color: var(--ink); }
    .tt-note .term-no { font-weight: 500; }
    tr.end td {
      padding: calc(0.03in * var(--fit)) 0.08in;
      background: #fff;
      font-style: normal;
      vertical-align: middle;
    }
    .list-block.wide-sn .ss-table .sn { width: 42%; }
    .note-led {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      height: calc((12px + 1pt) * var(--fit));
      font-family: "Share Tech Mono", Consolas, monospace;
      font-size: calc((8px + 1pt) * var(--fit));
      font-weight: 400;
      letter-spacing: 0.05em;
      line-height: 1;
      text-transform: uppercase;
      text-box-trim: trim-both;
      text-box-edge: cap alphabetic;
      vertical-align: middle;
      transform: translateY(-1px);
      background: var(--led-bg);
      color: var(--led);
      border: 1px solid #2b2b2b;
      padding: 0 0.3em;
    }
    .note-led .to-gap,
    .only-led .to-gap { visibility: hidden; }
    footer.notes {
      margin-top: 4px;
      padding-top: 0;
      font-size: calc(9.5px * var(--fit));
      line-height: 1.4;
      color: var(--muted);
    }
    footer.notes .source { margin-top: 0.15em; }
    @page { size: letter portrait; margin: 0 0 0.2in 0.2in; }
    @media print {
      html, body { margin: 0; background: #fff !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body > *:not(.sheet) { display: none !important; }
      .sheet { width: 8.3in; margin: 0 !important; }
    }
  </style>
</head>
<body data-pdf-name="${escapeText(slug)}">
  <div class="chrome">
    <button type="button" id="print-poster">Print/Save as PDF</button>
    <span class="tone">
      <label><input type="radio" name="tone" value="color"${bw ? "" : " checked"} /> Color</label>
      <label><input type="radio" name="tone" value="bw"${bw ? " checked" : ""} /> Black and white</label>
    </span>
    <label id="fit-label" hidden><input type="checkbox" id="fit-page"${fit ? " checked" : ""} /> Attempt to fit to page</label>
    <span class="hint" id="page-count">Measuring size…</span>
  </div>
  <article class="sheet${bw ? " bw" : ""}" style="--route:${escapeText(color)};--route-ink:${escapeText(ink)}">
    <header class="mast">
      <div class="badges">${badges}</div>
      <div class="ident">
        <div class="kicker">${escapeText(kicker)}</div>
        <h1>${escapeText(name)}</h1>
        <div class="meta">${escapeText([`Stop #${code}`, street ? "on " + street : ""].filter(Boolean).join(", "))}</div>
      </div>
      ${
        qr
          ? `<div class="qr-block"><a href="${escapeText(predUrl)}" target="_blank" rel="noopener"><div class="qr-svg">${qr}</div><div class="qr-cap">Live departures<br />and detours</div></a></div>`
          : `<div class="qr-block"></div>`
      }
    </header>
    ${mastRule}
    <div class="flow">
      ${times}
      ${listHtmlOut}
    </div>
    <footer class="notes">
      <div>This is a citizen-made poster intended to improve accessibility, not an official Metro Transit bulletin. Times are trip-weighted averages and may vary at peak and off-hours.</div>
      <div class="source">${escapeText(sourceLine(opts.feed || {}))}</div>
    </footer>
  </article>
  <script>
${FIT_SCRIPT}
  </script>
</body>
</html>`;
}

const FIT_SCRIPT = `
(function () {
  function inchPx() {
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-9999px;width:1in;height:1in";
    document.body.appendChild(probe);
    var inch = probe.offsetHeight || 96;
    document.body.removeChild(probe);
    return inch;
  }
  function sheetEl() { return document.querySelector(".sheet"); }
  function heightIn() { return sheetEl().offsetHeight / inchPx(); }
  function unsplit(sheet) {
    var flow = sheet.querySelector(".flow");
    if (!flow || !flow.getAttribute("data-split")) return;
    var cols = flow.querySelectorAll(":scope > .hy-col");
    var blocks = [];
    for (var i = 0; i < cols.length; i++) {
      while (cols[i].firstChild) blocks.push(cols[i].removeChild(cols[i].firstChild));
    }
    for (var j = 0; j < cols.length; j++) cols[j].remove();
    for (var k = 0; k < blocks.length; k++) flow.appendChild(blocks[k]);
    flow.removeAttribute("data-split");
    sheet.classList.remove("two-col");
  }
  function split(sheet) {
    var flow = sheet.querySelector(".flow");
    if (!flow || flow.getAttribute("data-split")) return;
    var blocks = [];
    for (var i = 0; i < flow.children.length; i++) blocks.push(flow.children[i]);
    if (blocks.length < 2) return;
    var heights = blocks.map(function (b) { return b.offsetHeight; });
    var total = heights.reduce(function (a, b) { return a + b; }, 0);
    var acc = 0;
    var cut = blocks.length;
    for (var n = 0; n < heights.length; n++) {
      acc += heights[n];
      if (acc >= total / 2) { cut = n + 1; break; }
    }
    if (cut < 1) cut = 1;
    if (cut >= blocks.length) cut = blocks.length - 1;
    var left = document.createElement("div");
    var right = document.createElement("div");
    left.className = "hy-col";
    right.className = "hy-col";
    blocks.forEach(function (b, i) { (i < cut ? left : right).appendChild(b); });
    flow.appendChild(left);
    flow.appendChild(right);
    flow.setAttribute("data-split", "1");
    sheet.classList.add("two-col");
  }
  var LIMIT = 10.8;
  var MARGIN_L = 0.2;
  var MARGIN_B = 0.2;
  function tileTimes(sheet) {
    var nodes = sheet.querySelectorAll(".boxes");
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!nodes[i].classList.contains("roll-row")) nodes[i].style.gridTemplateColumns = "";
    }
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.classList.contains("roll-row")) continue;
      var font = parseFloat(getComputedStyle(el).fontSize) || 11.5;
      var min = Math.max(24, Math.round(3.45 * font));
      var inner = Math.floor(el.getBoundingClientRect().width);
      if (!(inner >= min)) continue;
      var n = Math.max(1, Math.floor(inner / min));
      var size = Math.floor(inner / n);
      el.style.setProperty("--box", size + "px");
      el.style.gridTemplateColumns = "repeat(" + n + ", " + size + "px)";
    }
    var rolls = sheet.querySelectorAll(".tbox.roll");
    for (i = 0; i < rolls.length; i++) rolls[i].style.width = "";
    for (i = 0; i < rolls.length; i++) {
      var box = rolls[i];
      var w = Math.ceil(box.getBoundingClientRect().width - 0.01);
      if (w > 0) box.style.width = w + "px";
    }
  }
  function shrink(sheet) {
    var lo = 0.62;
    var hi = 1;
    if (heightIn() <= LIMIT) {
      sheet.style.setProperty("--fit", "1");
      return;
    }
    for (var i = 0; i < 10; i++) {
      var mid = (lo + hi) / 2;
      sheet.style.setProperty("--fit", mid.toFixed(3));
      tileTimes(sheet);
      if (heightIn() > LIMIT) hi = mid;
      else lo = mid;
    }
    sheet.style.setProperty("--fit", lo.toFixed(3));
    tileTimes(sheet);
  }
  function note() {
    var el = document.getElementById("page-count");
    var sheet = sheetEl();
    if (!el || !sheet) return;
    var h = heightIn();
    var w = sheet.offsetWidth / inchPx();
    var paperH = h + MARGIN_B;
    var pages = paperH <= 11.02 ? 1 : Math.ceil(paperH / 11);
    var text = paperH.toFixed(2) + " inches tall, " + (w + MARGIN_L).toFixed(2) + " inches wide";
    if (pages > 1) text += " · " + pages + " pages";
    el.textContent = text;
  }
  function toneOn() {
    var bw = document.querySelector('input[name="tone"][value="bw"]');
    return !!(bw && bw.checked);
  }
  function applyTone() {
    var sheet = sheetEl();
    if (sheet) sheet.classList.toggle("bw", toneOn());
    var box = document.getElementById("fit-page");
    var lab = box && box.closest("label");
    report(lab ? !lab.hidden : false, box && box.checked);
  }
  function report(tall, fitChecked) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: "hybrid-fit", tall: tall, fit: !!fitChecked, bw: toneOn() }, "*");
      }
    } catch (err) {}
  }
  function apply() {
    var sheet = sheetEl();
    var box = document.getElementById("fit-page");
    if (!sheet) return;
    applyTone();
    unsplit(sheet);
    sheet.style.setProperty("--fit", "1");
    tileTimes(sheet);
    var h = heightIn();
    var lab = box && box.closest("label");
    if (lab) lab.hidden = h <= LIMIT;
    report(h > LIMIT, box && box.checked);
    if (box && box.checked && h > LIMIT) {
      if (h >= 15) {
        split(sheet);
        tileTimes(sheet);
        var two = heightIn();
        if (two > h * 0.95) {
          unsplit(sheet);
          tileTimes(sheet);
        }
      }
      if (heightIn() > LIMIT) shrink(sheet);
    }
    tileTimes(sheet);
    note();
  }
  function printPoster() {
    var slug = document.body.getAttribute("data-pdf-name") || document.title;
    var prev = document.title;
    document.title = slug;
    window.addEventListener("afterprint", function restore() {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    });
    window.print();
  }
  var btn = document.getElementById("print-poster");
  if (btn) btn.addEventListener("click", printPoster);
  var fit = document.getElementById("fit-page");
  if (fit) fit.addEventListener("change", apply);
  var tones = document.querySelectorAll('input[name="tone"]');
  for (var t = 0; t < tones.length; t++) tones[t].addEventListener("change", applyTone);
  if (document.readyState !== "complete") window.addEventListener("load", apply);
  else apply();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply);
})();
`;

function listsFor(names, stopCode) {
  const posters = [];
  let loc = locations;
  try {
    loc = S.migrateLocations(locations || {}, servedPack);
  } catch {
    loc = locations || {};
  }
  for (const name of names) {
    try {
      const found = S.postersForStop(servedPack, stopCode, {
        routes: [name],
        excludeSchool: !!(noSchoolEl && noSchoolEl.checked),
        radius: S.DEFAULT_RADIUS,
        locations: loc,
      });
      posters.push(...found);
    } catch {
      /* this route has no remaining stops */
    }
  }
  return posters;
}

function generate(part) {
  if (part === "timetable" || part === "stops" || part === "both") lastPart = part;
  showErr("");
  if (!selected) return;
  if (!P || !P.mergePosterParts || !S || !S.listSectionHtml || !S.postersForStop) {
    showErr("Poster engine failed to load. Refresh the page.");
    return;
  }
  const names = chosenNames();
  if (!names.length) {
    showErr("Pick at least one route.");
    return;
  }
  const entry = byCode[selected.code];
  if (!entry) {
    showErr(`No packed data for stop ${selected.code}`);
    return;
  }
  const want = new Set(names.map((n) => n.toLowerCase()));
  const parts = (entry.parts || []).filter((p) => want.has(p.route.route_short_name.toLowerCase()));
  if (!parts.length) {
    showErr("No timetable data for the selected routes.");
    return;
  }
  try {
    const merged = P.mergePosterParts(parts);
    const geo = (servedPack && servedPack.geo && servedPack.geo[selected.code]) || {};
    const street = S.streetDirectionLabel
      ? S.streetDirectionLabel({ cardinal_direction: geo.cd, primary_street: geo.street })
      : "";
    const predUrl = P.stopPredictionUrl ? P.stopPredictionUrl(selected.code) : "";
    const qr =
      (entry.qrBits && P.qrSvgFromBits && P.qrSvgFromBits(entry.qrBits)) ||
      (predUrl && P.qrSvgWithLogo && P.qrSvgWithLogo(predUrl)) ||
      "";
    lastHtml = renderHybridHtml({
      fit: lastFit,
      bw: lastBw,
      part: lastPart,
      headings: merged.headings || [],
      posters: servedPack ? listsFor(names, selected.code) : [],
      servedPack,
      stopCode: selected.code,
      stopName: selected.name,
      street,
      feed: entry.feed || merged.feed || {},
      qr,
      predUrl,
    });
    preview.srcdoc = lastHtml;
    outEl.hidden = false;
    outEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    showErr(e.message || String(e));
  }
}

function fitPreview() {
  const doc = preview.contentDocument;
  if (!doc || !doc.body) return;
  const sheet = doc.querySelector(".sheet");
  const h = sheet
    ? Math.ceil(sheet.offsetTop + sheet.offsetHeight + 32)
    : Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
  preview.style.height = h + "px";
  preview.style.overflowX = "hidden";
  preview.style.overflowY = "hidden";
}

window.addEventListener("message", (event) => {
  if (event.source !== preview.contentWindow) return;
  const data = event.data;
  if (!data || data.source !== "hybrid-fit") return;
  if (typeof data.fit === "boolean") lastFit = data.fit;
  if (typeof data.bw === "boolean") lastBw = data.bw;
});

preview.addEventListener("load", () => {
  fitPreview();
  const doc = preview.contentDocument;
  if (!doc) return;
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fitPreview);
  const fit = doc.getElementById("fit-page");
  if (fit) fit.addEventListener("change", () => setTimeout(fitPreview, 30));
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => fitPreview());
    const sheet = doc.querySelector(".sheet");
    if (sheet) ro.observe(sheet);
  }
});

function download() {
  if (!lastHtml || !selected) return;
  const names = chosenNames().map((n) => n.toLowerCase());
  const slug = `${names.length ? names.join("-") : "hybrid"}-${selected.code}-hybrid`;
  const blob = new Blob([lastHtml], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function openTab() {
  if (!lastHtml) return;
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(lastHtml);
    w.document.close();
  }
}

qEl.addEventListener("input", () => {
  selected = null;
  pickedEl.hidden = true;
  outEl.hidden = true;
  showErr("");
  renderResults(searchStops(qEl.value));
});

qEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = resultsEl.querySelector(".result");
  if (first) first.click();
});

resultsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".result");
  if (!btn) return;
  const stop = stops.find((s) => s.code === btn.dataset.code);
  if (stop) showPicked(stop);
});

noSchoolEl.addEventListener("change", () => {
  syncRouteChecks();
});

routesEl.addEventListener("change", () => {
  setGenerateEnabled(chosenNames().length > 0);
});

goEl.addEventListener("click", () => generate("both"));
if (goTimesEl) goTimesEl.addEventListener("click", () => generate("timetable"));
if (goStopsEl) goStopsEl.addEventListener("click", () => generate("stops"));
document.getElementById("save").addEventListener("click", download);
document.getElementById("open").addEventListener("click", openTab);

async function loadGzip(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Stop data missing.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text;
  if (gzip) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  return JSON.parse(text);
}

async function loadLogo() {
  try {
    const res = await fetch("data/metrologo-mark.png");
    if (!res.ok) return;
    const blob = await res.blob();
    const uri = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    globalThis.METRO_LOGO_DATA_URI = uri;
  } catch {
    /* QR still works without the mark */
  }
}

function findStop(code) {
  const raw = String(code || "").trim();
  if (!raw) return null;
  const bare = raw.replace(/^0+/, "");
  return (
    stops.find((s) => s.code === raw || s.code.toLowerCase() === raw.toLowerCase()) ||
    stops.find((s) => s.code.replace(/^0+/, "") === bare) ||
    null
  );
}

function openFromQuery() {
  const code = new URLSearchParams(location.search).get("stop");
  const stop = findStop(code);
  if (!stop) {
    if (code) showErr(`No timetable data for stop ${code}.`);
    return;
  }
  showPicked(stop);
}

qEl.disabled = true;
showErr("Loading timetables…");
Promise.all([
  loadGzip("data/pack.json.gz"),
  loadGzip("data/served.json.gz"),
  loadLogo(),
  fetch("data/locations.json")
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null),
])
  .then(([pack, served, , loc]) => {
    stops = pack.stops || [];
    byCode = pack.byCode || {};
    servedPack = served;
    locations = loc || { reviewed: [], stops: {} };
    qEl.disabled = false;
    showErr("");
    openFromQuery();
    if (!selected) qEl.focus();
  })
  .catch((e) => showErr(e.message || String(e)));
