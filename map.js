const qEl = document.getElementById("q");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const clearEl = document.getElementById("clear");
const routeFilterEl = document.getElementById("route-filter");

const VIEW = { south: 42.95, west: -89.65, north: 43.25, east: -89.15 };
let stops = [];
let addressMarker = null;
let addressHits = [];
const locked = new Set();

const map = L.map("map", { zoomControl: true }).fitBounds(
  [
    [42.98, -89.58],
    [43.19, -89.3],
  ],
  { padding: [16, 16] }
);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const canvas = L.canvas({ padding: 0.5 });

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

function pills(routes) {
  return (routes || [])
    .map((r) => `<span class="pill" style="background:${r.c};color:${r.t}">${escapeText(r.n)}</span>`)
    .join("");
}

function tipHtml(stop) {
  const code = encodeURIComponent(stop.code);
  return `<div class="tip">
    <div class="tip-name">${escapeText(stop.name)}</div>
    <div class="tip-code">#${escapeText(stop.code)}</div>
    <div class="tip-routes">${pills(stop.routes) || '<span class="dir">No scheduled routes</span>'}</div>
    <div class="tip-actions">
      <a href="timetable.html?stop=${code}">View timetable</a>
      <a href="stoplist.html?stop=${code}">View stop list</a>
      <a href="hybrid.html?stop=${code}">View hybrid poster</a>
    </div>
  </div>`;
}

function paint(stop, on) {
  stop.marker.setStyle({
    radius: on ? 7 : 4.5,
    weight: on ? 2 : 1,
    color: on ? "#111" : "#ffffff",
    fillColor: "#333366",
    fillOpacity: on ? 1 : 0.88,
  });
  const tip = stop.marker.getTooltip();
  if (!tip) return;
  tip.options.permanent = on;
  if (on) {
    stop.marker.openTooltip();
    tip.getElement()?.classList.add("stop-locked");
  } else {
    stop.marker.closeTooltip();
    tip.getElement()?.classList.remove("stop-locked");
  }
}

function setLocked(stop, on) {
  if (locked.has(stop.code) === on) return;
  const now = performance.now();
  if (stop._lockAt && now - stop._lockAt < 80) return;
  stop._lockAt = now;
  if (on) {
    locked.add(stop.code);
    stop._suppressHover = false;
  } else {
    locked.delete(stop.code);
    stop._suppressHover = true;
  }
  stop._closing = !on;
  paint(stop, on);
  stop._closing = false;
}

function clearAddressPin() {
  if (!addressMarker) return;
  map.removeLayer(addressMarker);
  addressMarker = null;
}

function titleCaseWords(s) {
  return String(s || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^(n|s|e|w|ne|nw|se|sw)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function mapAddressLabel(hit) {
  const a = hit.address || {};
  const parts = String(hit.display_name || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  let num = String(a.house_number || "").trim();
  let road = String(a.road || a.pedestrian || a.residential || a.footway || "").trim();
  let city = String(a.city || a.town || a.village || a.hamlet || "").trim();
  if (!num && parts.length && /^\d+[A-Za-z]?$/.test(parts[0])) num = parts[0];
  if (!road && parts.length) {
    const street = /^\d+[A-Za-z]?$/.test(parts[0]) ? parts[1] : parts[0];
    const split = String(street || "").match(/^(\d+[A-Za-z]?)\s+(.*)$/);
    if (!num && split) {
      num = split[1];
      road = split[2];
    } else road = street || "";
  }
  if (!city) city = parts.find((p) => /madison/i.test(p)) || "Madison";
  const line = [num, titleCaseWords(road)].filter(Boolean).join(" ");
  return `${line}, ${titleCaseWords(city)}`;
}

function placeAddressPin(lat, lon, label) {
  clearAddressPin();
  addressMarker = L.marker([lat, lon], { title: label, zIndexOffset: 1000 }).addTo(map);
  addressMarker.bindTooltip(`<div class="tip-name">Searched address</div><div class="tip-code">${escapeText(label)}</div>`, {
    permanent: true,
    direction: "top",
    offset: [0, -28],
    opacity: 1,
    className: "address-tip",
  });
}

function chooseStop(stop) {
  resultsEl.hidden = true;
  qEl.value = `${stop.name}  #${stop.code}`;
  clearAddressPin();
  setLocked(stop, true);
  map.flyTo([stop.lat, stop.lon], 17);
  statusEl.textContent = `${stop.name} · #${stop.code}`;
}

function chooseAddress(hit) {
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  resultsEl.hidden = true;
  qEl.value = hit.display_name;
  placeAddressPin(lat, lon, mapAddressLabel(hit));
  map.flyTo([lat, lon], 16);
  statusEl.textContent = "Searched address is marked on the map.";
}

function matchingStops(query) {
  let raw = String(query || "").trim();
  if (!raw) return [];
  const picked = raw.match(/^(.*?)\s+#(\d{3,5})$/);
  if (picked) {
    const code = picked[2];
    const byCode = stops.filter((s) => s.code === code || s.code.replace(/^0+/, "") === code.replace(/^0+/, ""));
    if (byCode.length) return byCode;
    raw = picked[1].trim();
    if (!raw) return [];
  }
  const exact = stops.filter((s) => s.code === raw || s.code.replace(/^0+/, "") === raw.replace(/^0+/, ""));
  if (/^\d{3,5}$/.test(raw) && exact.length) return exact;
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
  return scored.map((x) => x.s);
}

function selectedRoute() {
  return routeFilterEl ? routeFilterEl.value : "";
}

function servesSelectedRoute(stop) {
  const route = selectedRoute();
  if (!route) return true;
  return (stop.routes || []).some((r) => r.n === route);
}

function searchStops(query) {
  return matchingStops(query).filter(servesSelectedRoute).slice(0, 8);
}

function fillRouteFilter() {
  if (!routeFilterEl) return;
  const byName = new Map();
  for (const stop of stops) {
    for (const route of stop.routes || []) {
      if (route && route.n && !byName.has(route.n)) byName.set(route.n, route);
    }
  }
  const routes = [...byName.values()].sort((a, b) => {
    if (!!a.s !== !!b.s) return a.s ? 1 : -1;
    const aLetter = /^[A-Za-z]/.test(a.n);
    const bLetter = /^[A-Za-z]/.test(b.n);
    if (aLetter !== bLetter) return aLetter ? -1 : 1;
    return String(a.n).localeCompare(String(b.n), undefined, { numeric: true });
  });
  const options = ['<option value="">All routes</option>'].concat(
    routes.map((route) => `<option value="${escapeText(route.n)}">${escapeText(route.n)}${route.s ? " extra" : ""}</option>`)
  );
  routeFilterEl.innerHTML = options.join("");
  routeFilterEl.disabled = false;
}

function applyRouteFilter() {
  for (const stop of stops) {
    const show = servesSelectedRoute(stop);
    const onMap = map.hasLayer(stop.marker);
    if (show && !onMap) stop.marker.addTo(map);
    if (!show && onMap) {
      if (locked.has(stop.code)) setLocked(stop, false);
      map.removeLayer(stop.marker);
    }
  }
}

function unlockAll() {
  for (const stop of stops) {
    if (locked.has(stop.code)) setLocked(stop, false);
  }
}

function renderResults(list) {
  const q = qEl.value.trim();
  const stopHtml = list
    .map((s) => {
      const dir = s.dir ? `<span class="dir">${escapeText(s.dir)}</span>` : "";
      return `<button type="button" class="result" data-code="${escapeText(s.code)}">
        <div><span class="name">${escapeText(s.name)}</span><span class="code">#${escapeText(s.code)}</span></div>
        <div class="lines">${pills(s.routes)}${dir}</div>
      </button>`;
    })
    .join("");
  const addrHtml = addressHits
    .map(
      (hit, i) =>
        `<button type="button" class="address-hit" data-addr="${i}"><div class="addr">${escapeText(hit.display_name)}</div></button>`
    )
    .join("");
  const lookup =
    q.length >= 3
      ? `<button type="button" class="address-hit" data-lookup="1"><div class="addr">Search addresses for “${escapeText(q)}”</div></button>`
      : "";
  const html = stopHtml + addrHtml + lookup;
  resultsEl.hidden = !html;
  resultsEl.innerHTML = html;
}

async function lookupAddresses() {
  const q = qEl.value.trim();
  if (q.length < 3) return;
  statusEl.textContent = "Searching addresses…";
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("viewbox", `${VIEW.west},${VIEW.north},${VIEW.east},${VIEW.south}`);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("addressdetails", "1");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Address search failed");
  const hits = await res.json();
  addressHits = (hits || []).filter((hit) => {
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    return lat >= VIEW.south && lat <= VIEW.north && lon >= VIEW.west && lon <= VIEW.east;
  });
  renderResults(searchStops(q));
  if (!addressHits.length) statusEl.textContent = "No Madison-area address matched that search.";
  else statusEl.textContent = `${addressHits.length} address match${addressHits.length === 1 ? "" : "es"}.`;
  if (addressHits.length === 1 && !searchStops(q).length) chooseAddress(addressHits[0]);
}

function hookMarker(stop) {
  const marker = L.circleMarker([stop.lat, stop.lon], {
    renderer: canvas,
    radius: 4.5,
    weight: 1,
    color: "#ffffff",
    fillColor: "#333366",
    fillOpacity: 0.88,
  }).addTo(map);
  stop.marker = marker;
  marker.bindTooltip(tipHtml(stop), {
    permanent: false,
    interactive: true,
    direction: "top",
    offset: [0, -2],
    opacity: 1,
    className: "stop-tip",
  });
  marker.off("mouseover", marker._openTooltip);
  marker.off("mouseout", marker.closeTooltip);
  marker.off("click", marker._openTooltip);
  marker.on("mouseover", () => {
    if (stop._suppressHover) return;
    if (!locked.has(stop.code)) marker.openTooltip();
  });
  marker.on("mouseout", () => {
    window.setTimeout(() => {
      const el = marker.getTooltip()?.getElement();
      if (el && el.matches(":hover")) return;
      if (locked.has(stop.code)) {
        marker.openTooltip();
        return;
      }
      stop._suppressHover = false;
      marker.closeTooltip();
    }, 220);
  });
  marker.on("tooltipclose", () => {
    if (stop._closing || stop._suppressHover) return;
    if (locked.has(stop.code)) marker.openTooltip();
  });
  marker.on("tooltipopen", () => {
    const el = marker.getTooltip()?.getElement();
    if (!el || el.dataset.bound) return;
    el.dataset.bound = "1";
    el.style.pointerEvents = "auto";
    L.DomEvent.disableClickPropagation(el);
    el.addEventListener("mouseleave", () => {
      if (!locked.has(stop.code)) marker.closeTooltip();
    });
    el.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      L.DomEvent.stop(event);
      const wasLocked = locked.has(stop.code);
      unlockAll();
      if (!wasLocked) setLocked(stop, true);
    });
  });
  marker.on("click", (event) => {
    L.DomEvent.stopPropagation(event);
    if (event.originalEvent) event.originalEvent._stopped = true;
    const wasLocked = locked.has(stop.code);
    unlockAll();
    if (!wasLocked) setLocked(stop, true);
  });
}

map.on("click", unlockAll);

async function loadGzipJson(url) {
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

qEl.addEventListener("input", () => {
  addressHits = [];
  renderResults(searchStops(qEl.value));
});
if (routeFilterEl) {
  routeFilterEl.addEventListener("change", () => {
    applyRouteFilter();
    if (qEl.value.trim()) renderResults(searchStops(qEl.value));
  });
}

qEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const matches = searchStops(qEl.value);
  const raw = qEl.value.trim();
  const exact = matches.find((s) => s.code === raw || s.code.replace(/^0+/, "") === raw.replace(/^0+/, ""));
  if (exact) {
    chooseStop(exact);
    return;
  }
  if (matches.length === 1 && !/\d/.test(raw)) {
    chooseStop(matches[0]);
    return;
  }
  lookupAddresses().catch((error) => {
    statusEl.textContent = error.message || "Address search failed.";
  });
});

resultsEl.addEventListener("click", (event) => {
  const stopBtn = event.target.closest(".result");
  if (stopBtn) {
    const stop = stops.find((s) => s.code === stopBtn.dataset.code);
    if (stop) chooseStop(stop);
    return;
  }
  const addrBtn = event.target.closest(".address-hit");
  if (!addrBtn) return;
  if (addrBtn.dataset.lookup) {
    lookupAddresses().catch((error) => {
      statusEl.textContent = error.message || "Address search failed.";
    });
    return;
  }
  const hit = addressHits[Number(addrBtn.dataset.addr)];
  if (hit) chooseAddress(hit);
});

clearEl.addEventListener("click", () => {
  addressHits = [];
  qEl.value = "";
  resultsEl.hidden = true;
  resultsEl.innerHTML = "";
  clearAddressPin();
  if (routeFilterEl) routeFilterEl.value = "";
  unlockAll();
  for (const stop of stops) {
    if (stop.marker && !map.hasLayer(stop.marker)) stop.marker.addTo(map);
  }
  statusEl.textContent = "";
});

loadGzipJson("data/served.json.gz")
  .then((pack) => {
    const routesByCode = new Map((pack.stops || []).map((s) => [s.code, s.routes || []]));
    const geo = pack.geo || {};
    stops = Object.keys(geo)
      .map((code) => {
        const g = geo[code];
        const lat = Number(g.lat);
        const lon = Number(g.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          code,
          name: g.n || code,
          lat,
          lon,
          street: g.street || "",
          dir: g.dir || "",
          routes: routesByCode.get(code) || [],
        };
      })
      .filter(Boolean);
    for (const stop of stops) hookMarker(stop);
    fillRouteFilter();
    qEl.disabled = false;
    qEl.focus();
    statusEl.textContent = "";
  })
  .catch((error) => {
    statusEl.textContent = error.message || "Could not load stops.";
  });
