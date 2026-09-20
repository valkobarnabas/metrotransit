const P = window.MMTPoster;
const qEl = document.getElementById("q");
const resultsEl = document.getElementById("results");
const pickedEl = document.getElementById("picked");
const pickedName = document.getElementById("picked-name");
const pickedMeta = document.getElementById("picked-meta");
const routesEl = document.getElementById("routes");
const allEl = document.getElementById("all");
const noSchoolEl = document.getElementById("noschool");
const goEl = document.getElementById("go");
const errEl = document.getElementById("err");
const outEl = document.getElementById("out");
const preview = document.getElementById("preview");

let stops = [];
let byCode = {};
let selected = null;
let lastHtml = "";

function showErr(msg) {
  errEl.hidden = !msg;
  errEl.textContent = msg || "";
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
    .map(
      (r) =>
        `<span class="pill" style="background:${r.c};color:${r.t}">${escapeText(r.n)}</span>`
    )
    .join("");
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      const dir = s.dir ? `<span class="dir">${s.dir}</span>` : "";
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
  for (const input of routeInputs()) {
    const row = input.closest("label");
    const hidden = !vis.has(input.dataset.route);
    row.classList.toggle("off", hidden);
    input.disabled = hidden;
    if (hidden) input.checked = false;
    else if (allEl.checked) input.checked = true;
  }
  goEl.disabled = !chosenNames().length;
}

function chosenNames() {
  return routeInputs()
    .filter((i) => i.checked && !i.disabled)
    .map((i) => i.dataset.route);
}

function showPicked(stop) {
  selected = stop;
  pickedEl.hidden = false;
  resultsEl.hidden = true;
  qEl.value = `${stop.name}  #${stop.code}`;
  pickedName.textContent = stop.name;
  const street = [stop.dir, stop.street].filter(Boolean).join(" ");
  pickedMeta.textContent = `Stop #${stop.code}${street ? " · " + street : ""}`;
  allEl.checked = true;
  outEl.hidden = true;
  routesEl.innerHTML = stop.routes
    .map(
      (r) =>
        `<label><input type="checkbox" data-route="${escapeText(r.n)}" checked /> <span class="pill" style="background:${r.c};color:${r.t}">${escapeText(r.n)}</span>${r.s ? " extra" : ""}</label>`
    )
    .join("");
  syncRouteChecks();
}

function generate() {
  showErr("");
  if (!selected) return;
  if (!P || !P.mergePosterParts || !P.renderPoster) {
    showErr("Poster engine failed to load. Refresh the page.");
    return;
  }
  const names = chosenNames();
  if (!names.length) {
    showErr("Pick at least one route.");
    return;
  }
  const pack = byCode[selected.code];
  if (!pack) {
    showErr(`No packed data for stop ${selected.code}`);
    return;
  }
  const want = new Set(names.map((n) => n.toLowerCase()));
  const parts = pack.parts.filter((p) => want.has(p.route.route_short_name.toLowerCase()));
  if (!parts.length) {
    showErr("No timetable data for the selected routes.");
    return;
  }
  try {
    const data = P.mergePosterParts(parts);
    data.feed = pack.feed;
    data.qrBits = pack.qrBits;
    lastHtml = P.renderPoster(data);
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
  const needX = !!(sheet && preview.clientWidth + 1 < sheet.offsetWidth);
  preview.style.overflowX = needX ? "auto" : "hidden";
  preview.style.overflowY = "hidden";
  const innerOverflow = needX ? "visible" : "hidden";
  doc.documentElement.style.overflow = innerOverflow;
  doc.body.style.overflow = innerOverflow;
  doc.body.style.minWidth = needX && sheet ? sheet.offsetWidth + "px" : "";
  if (needX) preview.style.height = h + 16 + "px";
}

preview.addEventListener("load", () => {
  fitPreview();
  const doc = preview.contentDocument;
  if (!doc) return;
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fitPreview);
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => fitPreview());
    ro.observe(doc.body);
    const sheet = doc.querySelector(".sheet");
    if (sheet) ro.observe(sheet);
  }
  for (const el of doc.querySelectorAll('input[name="clock"]')) {
    el.addEventListener("change", () => setTimeout(fitPreview, 0));
  }
});
window.addEventListener("resize", () => {
  if (!outEl.hidden) fitPreview();
});

function download() {
  if (!lastHtml || !selected) return;
  const names = chosenNames().map((n) => n.toLowerCase());
  const slug =
    names.length <= 1 ? `${names[0]}-${selected.code}` : `all-${selected.code}`;
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

allEl.addEventListener("change", () => {
  if (allEl.checked) {
    for (const input of routeInputs()) {
      if (!input.disabled) input.checked = true;
    }
  }
  goEl.disabled = !chosenNames().length;
});

noSchoolEl.addEventListener("change", () => {
  if (allEl.checked) {
    for (const input of routeInputs()) {
      if (!input.disabled) input.checked = true;
    }
  }
  syncRouteChecks();
});

routesEl.addEventListener("change", () => {
  const vis = visibleRoutes();
  const checked = chosenNames();
  allEl.checked = vis.length > 0 && checked.length === vis.length;
  goEl.disabled = !checked.length;
});

goEl.addEventListener("click", generate);
document.getElementById("save").addEventListener("click", download);
document.getElementById("open").addEventListener("click", openTab);

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

async function loadPack() {
  const res = await fetch("data/pack.json.gz");
  if (!res.ok) throw new Error("Stop data missing. Run node github/build-data.js");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text;
  if (gzip) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot decode the timetable file.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const data = JSON.parse(text);
  stops = data.stops || [];
  byCode = data.byCode || {};
}

qEl.disabled = true;
showErr("Loading timetables…");
Promise.all([loadPack(), loadLogo()])
  .then(() => {
    qEl.disabled = false;
    showErr("");
    qEl.focus();
    if (qEl.value) renderResults(searchStops(qEl.value));
  })
  .catch((e) => showErr(e.message || String(e)));
