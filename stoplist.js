const S = window.MMTServed;
const qEl = document.getElementById("q");
const resultsEl = document.getElementById("results");
const pickedEl = document.getElementById("picked");
const pickedName = document.getElementById("picked-name");
const pickedMeta = document.getElementById("picked-meta");
const routesEl = document.getElementById("routes");
const noSchoolEl = document.getElementById("noschool");
const headboardEl = document.getElementById("headboard");
const goEl = document.getElementById("go");
const useCurateEl = document.getElementById("use-curate");
const curateStatus = document.getElementById("curate-status");
const errEl = document.getElementById("err");
const outEl = document.getElementById("out");
const preview = document.getElementById("preview");

let pack = null;
let stops = [];
let selected = null;
let lastHtml = "";
let locations = { reviewed: [], stops: {} };

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

async function loadGzipJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} missing`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const gzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text;
  if (gzip) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot decode the data file.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  return JSON.parse(text);
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
  return (routes || [])
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

function chosenName() {
  const input = routeInputs().find((i) => i.checked && !i.disabled);
  return input ? input.dataset.route : "";
}

function syncRouteChecks() {
  const vis = new Set(visibleRoutes().map((r) => r.n));
  let selectedOn = false;
  for (const input of routeInputs()) {
    const on = vis.has(input.dataset.route);
    input.disabled = !on;
    input.closest("label").classList.toggle("off", !on);
    if (!on) input.checked = false;
    else if (input.checked) selectedOn = true;
  }
  if (!selectedOn) {
    const first = routeInputs().find((i) => !i.disabled);
    if (first) first.checked = true;
  }
  goEl.disabled = !chosenName();
}

function showPicked(stop) {
  selected = stop;
  resultsEl.hidden = true;
  qEl.value = `${stop.name}  #${stop.code}`;
  pickedName.textContent = stop.name;
  const street = [stop.dir, stop.street].filter(Boolean).join(" ");
  pickedMeta.textContent = `Stop #${stop.code}${street ? " · " + street : ""}`;
  routesEl.innerHTML = (stop.routes || [])
    .map(
      (r, i) => `<label>
        <input type="radio" name="route" data-route="${escapeText(r.n)}" ${i === 0 ? "checked" : ""} />
        <span class="pill" style="background:${r.c};color:${r.t}">${escapeText(r.n)}</span>
      </label>`
    )
    .join("");
  pickedEl.hidden = false;
  outEl.hidden = true;
  syncRouteChecks();
}

function curatorLocations() {
  try {
    return JSON.parse(localStorage.getItem("mmt-locations") || "null");
  } catch {
    return null;
  }
}

function curatorHasData(raw) {
  return !!(
    raw &&
    ((Array.isArray(raw.landmarks) && raw.landmarks.length) ||
      (raw.stops && Object.keys(raw.stops).length))
  );
}

function refreshCurateStatus() {
  if (!curateStatus || !useCurateEl) return;
  const raw = curatorLocations();
  if (!curatorHasData(raw) || !pack) {
    curateStatus.textContent = "No curator landmarks in this browser yet.";
    useCurateEl.checked = false;
    useCurateEl.disabled = true;
    return;
  }
  const loc = S.migrateLocations(raw, pack);
  const n = (loc.landmarks || []).length;
  const tagged = new Set();
  for (const lm of loc.landmarks || []) {
    for (const code of lm.stops || []) tagged.add(code);
  }
  useCurateEl.disabled = false;
  curateStatus.textContent = `${n} landmark${n === 1 ? "" : "s"} · ${tagged.size} stop${tagged.size === 1 ? "" : "s"} saved in this browser`;
}

function mergedLocations() {
  if (useCurateEl && useCurateEl.checked) {
    const raw = curatorLocations();
    if (curatorHasData(raw)) return S.migrateLocations(raw, pack);
  }
  return S.migrateLocations(locations || {}, pack);
}

function generate() {
  showErr("");
  if (!selected || !S) return;
  const name = chosenName();
  if (!name) {
    showErr("Pick a route.");
    return;
  }
  try {
    const { html } = S.generateServedHtml(pack, selected.code, {
      routes: [name],
      radius: S.DEFAULT_RADIUS,
      excludeSchool: noSchoolEl.checked,
      showHeadboard: !!(headboardEl && headboardEl.checked),
      locations: mergedLocations(),
    });
    lastHtml = html;
    preview.srcdoc = html;
    outEl.hidden = false;
    outEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    showErr(e.message || String(e));
  }
}

function fitPreview() {
  const doc = preview.contentDocument;
  if (!doc || !doc.body) return;
  const sheets = [...doc.querySelectorAll(".sheet")];
  let h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
  if (sheets.length) {
    const last = sheets[sheets.length - 1];
    h = Math.ceil(last.offsetTop + last.offsetHeight + 32);
  }
  preview.style.height = h + "px";
  const sheet = sheets[0];
  const needX = !!(sheet && preview.clientWidth + 1 < sheet.offsetWidth);
  preview.style.overflowX = needX ? "auto" : "hidden";
  preview.style.overflowY = "hidden";
  const innerOverflow = needX ? "visible" : "hidden";
  doc.documentElement.style.overflow = innerOverflow;
  doc.body.style.overflow = innerOverflow;
  doc.body.style.minWidth = needX && sheet ? sheet.offsetWidth + "px" : "";
  if (needX) preview.style.height = h + 16 + "px";
}

function download() {
  if (!lastHtml || !selected) return;
  const name = (chosenName() || "route").toLowerCase();
  const slug = `served-${name}-${selected.code}`;
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

preview.addEventListener("load", () => {
  fitPreview();
  const doc = preview.contentDocument;
  if (!doc) return;
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(fitPreview);
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => fitPreview());
    ro.observe(doc.body);
    for (const sheet of doc.querySelectorAll(".sheet")) ro.observe(sheet);
  }
});
window.addEventListener("resize", () => {
  if (!outEl.hidden) fitPreview();
});

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
  goEl.disabled = !chosenName();
});
if (headboardEl) {
  headboardEl.addEventListener("change", () => {
    if (selected && !outEl.hidden) generate();
  });
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshCurateStatus();
});
window.addEventListener("focus", refreshCurateStatus);
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
    if (code) showErr(`No stop list data for stop ${code}.`);
    return;
  }
  showPicked(stop);
}

qEl.disabled = true;
showErr("Loading stop data…");
Promise.all([
  loadGzipJson("data/served.json.gz"),
  loadGzipJson("data/pack.json.gz").catch(() => null),
  fetch("data/locations.json")
    .then((r) => (r.ok ? r.json() : { reviewed: [], stops: {} }))
    .catch(() => ({ reviewed: [], stops: {} })),
  loadLogo(),
])
  .then(([data, timePack, loc]) => {
    pack = data;
    if (timePack && timePack.byCode && S.buildClockIndex) pack.clock = S.buildClockIndex(timePack.byCode);
    stops = data.stops || [];
    locations = loc || { reviewed: [], stops: {} };
    qEl.disabled = false;
    showErr("");
    refreshCurateStatus();
    openFromQuery();
    if (!selected) qEl.focus();
    if (!selected && qEl.value) renderResults(searchStops(qEl.value));
  })
  .catch((e) => showErr(e.message || String(e)));
