/**
 * Stops-served posters: remaining stops from a chosen stop, one sheet per
 * route direction / numbered variant (parent unnumbered trips fold in).
 */
const DEFAULT_RADIUS = 250;
const FT_PER_M = 3.280839895;
const FORK_LONG = 4;
const ROUTE_INFO_URL = "https://www.cityofmadison.com/metro/routes-schedules/route-{route}";

/** Nearby day/evening last stops: one combined last row, one terminate note. */
const CLOSE_TERMINUS_PAIRS = [
  {
    route: "C",
    dayCode: "2091",
    eveningCode: "2916",
    eveningWhen: "on weekdays after 7pm and on weekends",
  },
  {
    route: "F",
    dayCode: "10001",
    eveningCode: "10004",
    eveningWhen: "on weekdays after 8pm and on weekends",
  },
];

/** Rare alternate Hughes at S Park: keep the usual last stop, drop the thin one. */
const IGNORE_ALT_TERMINI = [
  { route: "G", keepCode: "0194", dropCode: "0321" },
  { route: "H", keepCode: "0321", dropCode: "0194" },
];

function qrLib() {
  if (typeof globalThis !== "undefined" && globalThis.QRCode && globalThis.QRCode.create) {
    return globalThis.QRCode;
  }
  if (typeof require === "function") {
    try {
      return require("qrcode");
    } catch {
      return null;
    }
  }
  return null;
}

function metroLogoDataUri() {
  if (typeof globalThis !== "undefined" && globalThis.METRO_LOGO_DATA_URI) {
    return globalThis.METRO_LOGO_DATA_URI;
  }
  if (typeof require === "function") {
    try {
      const fs = require("fs");
      const path = require("path");
      const files = [
        path.join(__dirname, "data", "metrologo-mark.png"),
        path.join(__dirname, "..", "github", "data", "metrologo-mark.png"),
        path.join(__dirname, "..", "metrologo-mark.png"),
      ];
      for (const file of files) {
        if (fs.existsSync(file)) return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
      }
    } catch {
      /* browser bundle */
    }
  }
  return "";
}

function qrBits(text) {
  const QRCode = qrLib();
  if (!QRCode || !QRCode.create || !text) return "";
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  let bits = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) bits += qr.modules.get(r, c) ? "1" : "0";
  }
  return bits;
}

function qrSvgFromBits(bits) {
  if (!bits) return "";
  const n = Math.round(Math.sqrt(bits.length));
  if (!n) return "";
  const margin = 1;
  const dim = n + margin * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (bits[r * n + c] === "1") d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const logo = dim * 0.28;
  const x = (dim - logo) / 2;
  const cx = dim / 2;
  const hole = logo * 0.56;
  const mark = metroLogoDataUri();
  const logoSvg = mark
    ? `<circle cx="${cx}" cy="${cx}" r="${hole}" fill="#fff"/><image href="${mark}" x="${x}" y="${x}" width="${logo}" height="${logo}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" aria-hidden="true">
    <rect width="${dim}" height="${dim}" fill="#fff"/>
    <path d="${d}" fill="#111"/>
    ${logoSvg}
  </svg>`;
}

function qrSvgWithLogo(text) {
  return qrSvgFromBits(qrBits(text));
}

function ensureMapQr(pack) {
  if (!pack || pack.mapQr) return pack && pack.mapQr;
  const mapQr = {};
  for (const r of pack.routes || []) {
    if (r.s) continue;
    const bits = qrBits(routeMapUrl(r.n));
    if (bits) mapQr[r.n] = bits;
  }
  pack.mapQr = mapQr;
  return mapQr;
}

function routeMapCode(poster, pack) {
  const route = (pack.routeByName && pack.routeByName.get(poster.routeName)) || {};
  if (route.s) return "";
  return String(poster.routeName || "").trim();
}

function routeMapUrl(code) {
  if (!code) return "";
  return ROUTE_INFO_URL.replace("{route}", encodeURIComponent(String(code).toLowerCase()));
}

function mapQrHtml(poster, pack) {
  const code = routeMapCode(poster, pack);
  const url = routeMapUrl(code);
  if (!url) return "";
  const bits = (pack.mapQr && pack.mapQr[code]) || qrBits(url);
  const svg = qrSvgFromBits(bits);
  if (!svg) return "";
  return `<div class="qr-block">
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Route map and detours">
      ${svg}
      <div class="qr-cap">Route map<br />and detours</div>
    </a>
  </div>`;
}

const CARDINAL = {
  0: "northbound",
  90: "eastbound",
  180: "southbound",
  270: "westbound",
};

const ICONS = {
  hospital: { label: "Hospital", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4v8M4 8h8" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>' },
  university: { label: "University", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 7.2 8 3.5 14.5 7.2 8 10.8z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 8.4v3.2c1.3.8 2.6 1.2 4 1.2s2.7-.4 4-1.2V8.4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  capitol: { label: "Capitol", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 3 6h10z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 6.5v6h8v-6M2.5 13.2h11" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8 1.5v2" stroke="currentColor" stroke-width="1.3"/></svg>' },
  library: { label: "Library", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h6.5v10H3zM9.5 5.5H13v8H9.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 6h3.5M4.5 8.2h3.5M4.5 10.4h3.5" stroke="currentColor" stroke-width="1.1"/></svg>' },
  school: { label: "School", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="6" width="11" height="8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.5 2.5 6h11zM8 6v8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  park: { label: "Park", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5c-2.4 0-4 2.2-4 4.2C4 9.2 8 13.5 8 13.5s4-4.3 4-6.8C12 4.7 10.4 2.5 8 2.5z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="6.6" r="1.3" fill="currentColor"/></svg>' },
  shopping: { label: "Shopping", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 5.5h8l-.7 7.2H4.7z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 5.5V4.2A2 2 0 0 1 8 2.2a2 2 0 0 1 2 2v1.3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  government: { label: "Government", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13.5h10M4 6v7.5M8 6v7.5M12 6v7.5M2.5 6h11M8 2.5 2.5 6h11z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  museum: { label: "Museum", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11M4 7.5v6M8 7.5v6M12 7.5v6M2.5 7.5h11M3 4.5h10L8 2.2z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  airport: { label: "Airport", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8v12.4M3.2 6.2 8 8.2l4.8-2M3.5 12.8 8 10.6l4.5 2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>' },
  recreation: { label: "Recreation", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.4" r="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 5.2v4.2L5 13.2M8 9.4l3 3.8M4.2 7.8h7.6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  transit: { label: "Transit", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2.5" width="10" height="8.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 7.2h10M5 13h.8M10.2 13H11" stroke="currentColor" stroke-width="1.3"/><circle cx="5.4" cy="12.2" r="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10.6" cy="12.2" r="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' },
  landmark: { label: "Landmark", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 9.8 6h4.2l-3.4 2.6 1.3 4.2L8 10.4 4.1 12.8 5.4 8.6 2 6h4.2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>' },
  church: { label: "Church", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6v3.2M6.6 3.2H9.4M8 4.8 3.2 8.2V14h9.6V8.2zM8 8.2V14" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  stadium: { label: "Stadium", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6.2" ry="3.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.2 7.2 4 12.5h8l1.8-5.3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' },
  grocery: { label: "Grocery", svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.2h2.1l1.2 7.4h6.8l1.4-5.2H5.2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="7.2" cy="13.2" r="1" fill="currentColor"/><circle cx="11.4" cy="13.2" r="1" fill="currentColor"/></svg>' },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function streetDirectionLabel(stop) {
  const raw = String(stop.cardinal_direction ?? stop.cd ?? "").trim();
  const dir = raw === "" ? "" : CARDINAL[Number(raw)];
  const street = (stop.primary_street || stop.street || "").trim();
  if (dir && street) return `${dir} ${street}`;
  return street || dir || "";
}

function formatHeadboard(routeShortName, tripHeadsign) {
  const raw = String(tripHeadsign || "").trim();
  const branched = raw.match(/^(\d+)-(.+)$/);
  if (branched) {
    const num = branched[1];
    const dest = branched[2].trim();
    const code = /^[A-Za-z]$/.test(routeShortName) ? `${routeShortName}${num}` : num;
    return { code, dest: dest.toUpperCase().replace(/\./g, "") };
  }
  return { code: String(routeShortName), dest: raw.toUpperCase().replace(/\./g, "") };
}

function boardParts(code) {
  const raw = String(code || "");
  const letter = raw.match(/^([A-Za-z]+)(\d*)$/);
  if (letter) {
    return { kind: 0, base: letter[1].toUpperCase(), variant: letter[2] || "" };
  }
  const numbered = raw.match(/^(\d+)([A-Za-z]*)$/);
  if (numbered) return { kind: 1, base: numbered[1], variant: numbered[2] || "" };
  return { kind: 2, base: raw.toUpperCase(), variant: "" };
}

function compareBoardCodes(a, b) {
  const pa = boardParts(a);
  const pb = boardParts(b);
  if (pa.kind !== pb.kind) return pa.kind - pb.kind;
  if (pa.base !== pb.base) {
    return pa.kind === 1
      ? Number(pa.base) - Number(pb.base)
      : pa.base.localeCompare(pb.base, "en");
  }
  const va = pa.variant === "" ? Number.POSITIVE_INFINITY : Number(pa.variant) || 0;
  const vb = pb.variant === "" ? Number.POSITIVE_INFINITY : Number(pb.variant) || 0;
  if (va !== vb) return va - vb;
  return String(a).localeCompare(String(b), "en");
}

function headsignLabel(board) {
  const dest = String((board && board.dest) || "").trim();
  const code = String((board && board.code) || "").trim();
  if (!dest) return code;
  if (/\bTO\b/i.test(dest)) return dest;
  if (code && dest.toUpperCase().startsWith(code.toUpperCase() + " ")) return dest;
  return `${code} TO ${dest}`;
}

function distM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function metersToFeet(m) {
  return Number(m) * FT_PER_M;
}

function roundFeetUp10(m) {
  const ft = metersToFeet(m);
  if (!Number.isFinite(ft) || ft <= 0) return 10;
  return Math.ceil(ft / 10) * 10;
}

function formatDateRange(start, end) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parseYmd = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  const a = parseYmd(start);
  const b = parseYmd(end);
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]} ${b.getFullYear()}`;
}

function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function headingWordFromBearing(deg) {
  const d = (deg + 360) % 360;
  if (d >= 45 && d < 135) return "eastbound";
  if (d >= 135 && d < 225) return "southbound";
  if (d >= 225 && d < 315) return "westbound";
  return "northbound";
}

function minutesFromTenths(t) {
  return Number(t) / 10;
}

function roundMinutes(n) {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function formatMinutes(n) {
  const m = Math.max(1, roundMinutes(n));
  return `${m} min.`;
}

function displayMinute(n) {
  return Math.max(1, roundMinutes(n));
}

function smoothMinuteOrder(rows) {
  const out = (rows || []).map((row) => (row.type === "stop" ? { ...row } : row));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 40) {
    changed = false;
    let prev = null;
    for (const row of out) {
      if (row.type === "branch") {
        prev = null;
        continue;
      }
      if (row.type !== "stop") continue;
      if (prev && displayMinute(prev.minutes) === displayMinute(row.minutes) + 1) {
        prev.minutes = row.minutes;
        changed = true;
      }
      prev = row;
    }
  }
  return out;
}

function routeMap(pack) {
  const map = new Map();
  for (const r of pack.routes || []) map.set(String(r.n), r);
  return map;
}

function patternsForStop(pack, stopCode) {
  const code = String(stopCode);
  const out = [];
  for (const p of pack.patterns || []) {
    const s = p.s || [];
    let idx = -1;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === code) {
        idx = i;
        break;
      }
    }
    if (idx < 0) continue;
    const remaining = s.slice(idx + 1);
    const originT = minutesFromTenths(p.m[idx] || 0);
    const minutes = remaining.map((_, j) => minutesFromTenths(p.m[idx + 1 + j] || 0) - originT);
    out.push({
      r: p.r,
      d: p.d,
      board: { code: p.k, dest: p.e },
      trips: p.n || 1,
      remaining,
      minutes,
    });
  }
  return out;
}

function posterKeyGroups(instances, routeByName) {
  const byRouteDir = new Map();
  for (const inst of instances) {
    const key = `${inst.r}\t${inst.d}`;
    if (!byRouteDir.has(key)) byRouteDir.set(key, []);
    byRouteDir.get(key).push(inst);
  }
  const posters = [];
  for (const [key, list] of byRouteDir) {
    const [routeName, dirId] = key.split("\t");
    const school = !!(routeByName && routeByName.get(routeName) && routeByName.get(routeName).s);
    if (school) {
      const byCode = new Map();
      for (const inst of list) {
        const code = inst.board.code || routeName;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(inst);
      }
      const codes = [...byCode.keys()].sort(compareBoardCodes);
      for (const code of codes) {
        posters.push({
          routeName,
          dirId,
          titleCode: code,
          familyBase: boardParts(code).base,
          instances: byCode.get(code),
        });
      }
      continue;
    }
    const byFamily = new Map();
    for (const inst of list) {
      const parts = boardParts(inst.board.code);
      const fam = `${parts.kind}:${parts.base}`;
      if (!byFamily.has(fam)) byFamily.set(fam, { parts, items: [] });
      byFamily.get(fam).items.push(inst);
    }
    for (const { parts, items } of byFamily.values()) {
      const numbered = new Map();
      const parent = [];
      for (const inst of items) {
        const v = boardParts(inst.board.code).variant;
        if (v) {
          if (!numbered.has(v)) numbered.set(v, []);
          numbered.get(v).push(inst);
        } else parent.push(inst);
      }
      if (numbered.size) {
        const variants = [...numbered.keys()].sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)));
        for (const v of variants) {
          posters.push({
            routeName,
            dirId,
            titleCode: `${parts.base}${v}`,
            familyBase: parts.base,
            instances: numbered.get(v).concat(parent),
          });
        }
      } else {
        posters.push({
          routeName,
          dirId,
          titleCode: parent[0] ? parent[0].board.code : parts.base,
          familyBase: parts.base,
          instances: parent,
        });
      }
    }
  }
  return posters;
}

function uniqueBoards(items) {
  const seen = new Set();
  const out = [];
  for (const inst of items) {
    const key = headsignLabel(inst.board);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(inst.board);
  }
  return out;
}

function nextVisitMinutes(inst, code) {
  const idx = inst.seq.indexOf(code);
  if (idx < 0) return null;
  const m = inst.minutes && inst.minutes[idx];
  return Number.isFinite(m) ? m : null;
}

function consumeThrough(inst, code) {
  const idx = inst.seq.indexOf(code);
  if (idx < 0) return false;
  inst.seq.splice(0, idx + 1);
  if (inst.minutes) inst.minutes.splice(0, idx + 1);
  return true;
}

function emitStop(code, serving, subset, emittedEnds, onlyBoards) {
  const rows = [];
  let num = 0;
  let den = 0;
  for (const inst of serving) {
    const m = nextVisitMinutes(inst, code);
    if (m == null) continue;
    num += m * inst.trips;
    den += inst.trips;
  }
  rows.push({
    type: "stop",
    code,
    minutes: den ? num / den : 0,
    trips: den,
    onlyBoards: onlyBoards && onlyBoards.length ? onlyBoards : null,
  });
  const ends = [];
  for (const inst of subset) {
    if (!consumeThrough(inst, code)) continue;
    if (!inst.seq.length) ends.push(inst.board);
  }
  const boards = [];
  const seen = new Set();
  for (const board of ends) {
    const dest = headsignLabel(board);
    const key = `${dest}\t${code}`;
    if (seen.has(dest) || emittedEnds.has(key)) continue;
    seen.add(dest);
    emittedEnds.add(key);
    boards.push(board);
  }
  if (boards.length) rows.push({ type: "end", boards, at: code });
  return rows;
}

function firstIndependentFork(instances) {
  const items = instances.map((inst) => ({
    inst,
    seq: inst.remaining.slice(),
  }));
  const active = () => items.filter((i) => i.seq.length);
  while (true) {
    const act = active();
    if (!act.length) return null;
    const heads = [...new Set(act.map((i) => i.seq[0]))];
    if (heads.length === 1) {
      for (const i of act) {
        const idx = i.seq.indexOf(heads[0]);
        if (idx >= 0) i.seq.splice(0, idx + 1);
      }
      continue;
    }
    const independent = heads.filter((h) =>
      act.every((i) => i.seq[0] === h || !i.seq.includes(h))
    );
    if (independent.length === heads.length && heads.length > 1) {
      return heads.map((h) => {
        const groupItems = act.filter((i) => i.seq[0] === h);
        return {
          instances: groupItems.map((x) => x.inst),
          seqs: groupItems.map((i) => i.seq.slice()),
          remain: Math.max(...groupItems.map((i) => i.seq.length)),
        };
      });
    }
    const pick = independent[0] || heads[0];
    for (const i of act) {
      if (!i.seq.includes(pick)) continue;
      const idx = i.seq.indexOf(pick);
      i.seq.splice(0, idx + 1);
    }
  }
}

function shouldSplitFork(groups) {
  const sets = groups.map((g) => {
    const s = new Set();
    for (const seq of g.seqs || []) {
      for (const code of seq) s.add(code);
    }
    return s;
  });
  if (sets.length < 2) return false;
  const exclusives = sets.map((s, i) => {
    let n = 0;
    for (const code of s) {
      if (sets.every((other, j) => j === i || !other.has(code))) n += 1;
    }
    return n;
  });
  const shared = [...sets[0]].filter((code) => sets.every((s) => s.has(code))).length;
  if (shared > 0) return Math.max(...exclusives) > FORK_LONG;
  return Math.min(...exclusives) > FORK_LONG;
}

function partitionPosters(instances) {
  const fork = firstIndependentFork(instances);
  if (!fork) return [instances];
  if (shouldSplitFork(fork)) {
    return fork.flatMap((g) => partitionPosters(g.instances));
  }
  return [instances];
}

function primaryBoard(instances) {
  const tally = new Map();
  for (const inst of instances) {
    const key = headsignLabel(inst.board);
    if (!tally.has(key)) tally.set(key, { board: inst.board, trips: 0 });
    tally.get(key).trips += inst.trips;
  }
  return [...tally.values()].sort((a, b) => b.trips - a.trips)[0]?.board || null;
}

function exclusiveStopCount(group, others) {
  const otherSet = new Set();
  for (const g of others) {
    for (const inst of g.items) {
      for (const code of inst.seq) otherSet.add(code);
    }
  }
  const mine = new Set();
  for (const inst of group.items) {
    for (const code of inst.seq) mine.add(code);
  }
  let n = 0;
  for (const code of mine) {
    if (!otherSet.has(code)) n += 1;
  }
  return n;
}

function matchingCloseTerminus(routeName, rows) {
  const codes = new Set();
  for (const row of rows || []) {
    if (row.type === "stop") codes.add(String(row.code));
  }
  const route = String(routeName || "").toUpperCase();
  for (const rule of CLOSE_TERMINUS_PAIRS) {
    if (route !== rule.route) continue;
    if (codes.has(rule.dayCode) && codes.has(rule.eveningCode)) return rule;
  }
  return null;
}

function collectEndBoards(rows, codes) {
  const want = new Set(codes.map(String));
  const boards = [];
  const seen = new Set();
  for (const row of rows || []) {
    const list =
      row.type === "end" && want.has(String(row.at))
        ? row.boards || (row.board ? [row.board] : [])
        : row.type === "stop" && want.has(String(row.code))
          ? row.onlyBoards || []
          : [];
    for (const board of list) {
      const key = headsignLabel(board);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      boards.push(board);
    }
  }
  return boards;
}

function applyCloseTermini(rows, routeName) {
  const rule = matchingCloseTerminus(routeName, rows);
  if (!rule) return { rows, destNote: null };
  const day = rows.find((r) => r.type === "stop" && r.code === rule.dayCode);
  const evening = rows.find((r) => r.type === "stop" && r.code === rule.eveningCode);
  let num = 0;
  let den = 0;
  for (const row of [day, evening]) {
    if (!row) continue;
    const trips = Number(row.trips) || 0;
    num += (Number(row.minutes) || 0) * trips;
    den += trips;
  }
  const boards = collectEndBoards(rows, [rule.dayCode, rule.eveningCode]);
  const cleaned = [];
  for (const row of rows) {
    if (row.type === "end" && (row.at === rule.dayCode || row.at === rule.eveningCode)) continue;
    if (row.type === "stop" && row.code === rule.eveningCode) continue;
    if (row.type === "stop" && row.code === rule.dayCode) {
      cleaned.push({
        ...row,
        onlyBoards: null,
        starTerminus: false,
        alsoCodes: [rule.dayCode, rule.eveningCode],
        xferCodes: [rule.dayCode, rule.eveningCode],
        minutes: den ? num / den : row.minutes,
        trips: den || row.trips,
      });
      continue;
    }
    cleaned.push(row);
  }
  cleaned.push({
    type: "end",
    kind: "closeTerminus",
    boards,
    at: rule.dayCode,
    dayCode: rule.dayCode,
    eveningCode: rule.eveningCode,
    eveningWhen: rule.eveningWhen,
  });
  return { rows: cleaned, destNote: null };
}

function applyIgnoredTermini(result, routeName) {
  const route = String(routeName || "").toUpperCase();
  const codes = new Set();
  for (const row of result.rows || []) {
    if (row.type === "stop") codes.add(String(row.code));
  }
  let rows = result.rows;
  for (const rule of IGNORE_ALT_TERMINI) {
    if (route !== rule.route) continue;
    if (!codes.has(rule.dropCode) || !codes.has(rule.keepCode)) continue;
    rows = rows
      .filter((row) => {
        if (row.type === "stop" && row.code === rule.dropCode) return false;
        if (row.type === "end" && row.at === rule.dropCode) return false;
        return true;
      })
      .map((row) => (row.type === "stop" && row.code === rule.keepCode ? { ...row, onlyBoards: null } : row));
  }
  return { ...result, rows };
}

function mergeInstances(instances) {
  const items = instances.map((inst) => ({
    board: inst.board,
    trips: inst.trips,
    seq: inst.remaining.slice(),
    minutes: (inst.minutes || []).slice(),
  }));
  const emittedEnds = new Set();

  function walk(subset, onlyBoards) {
    const rows = [];
    const active = () => subset.filter((i) => i.seq.length);
    while (true) {
      const act = active();
      if (!act.length) break;
      const heads = [...new Set(act.map((i) => i.seq[0]))];
      if (heads.length === 1) {
        rows.push(...emitStop(heads[0], act, subset, emittedEnds, onlyBoards));
        continue;
      }
      const independent = heads.filter((h) =>
        act.every((i) => i.seq[0] === h || !i.seq.includes(h))
      );
      if (independent.length === heads.length && heads.length > 1) {
        const groups = heads
          .map((h) => {
            const groupItems = act.filter((i) => i.seq[0] === h);
            return {
              items: groupItems,
              trips: groupItems.reduce((s, i) => s + i.trips, 0),
            };
          })
          .sort((a, b) => {
            const remainA = Math.max(...a.items.map((i) => i.seq.length));
            const remainB = Math.max(...b.items.map((i) => i.seq.length));
            if (remainA !== remainB) return remainA - remainB;
            return b.trips - a.trips;
          });
        for (const g of groups) {
          const ex = exclusiveStopCount(g, groups.filter((x) => x !== g));
          const tag = ex > 0 && ex <= FORK_LONG ? uniqueBoards(g.items) : null;
          rows.push(...walk(g.items, tag));
        }
        break;
      }
      const pick = independent[0] || heads[0];
      const serving = act.filter((i) => i.seq.includes(pick));
      const tag =
        serving.length < act.length && serving.length
          ? uniqueBoards(serving)
          : onlyBoards;
      rows.push(...emitStop(pick, serving, subset, emittedEnds, tag));
    }
    return rows;
  }

  return walk(items);
}

function routeHeading(originCode, rows, geo, fallback) {
  const origin = geo[originCode];
  if (!origin) return fallback || "";
  for (const row of rows) {
    if (row.type !== "stop") continue;
    const g = geo[row.code];
    if (!g) continue;
    if (distM(origin, g) < 120) continue;
    return headingWordFromBearing(bearingDeg(origin, g));
  }
  for (const row of rows) {
    if (row.type !== "stop") continue;
    const g = geo[row.code];
    if (!g) continue;
    if (distM(origin, g) < 40) continue;
    return headingWordFromBearing(bearingDeg(origin, g));
  }
  return fallback || "";
}

function sameRouteName(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

const departingByStop = new WeakMap();

function departingRoutesAt(pack, stopCode) {
  let idx = departingByStop.get(pack);
  if (!idx) {
    idx = new Map();
    for (const p of pack.patterns || []) {
      const name = String(p.r || "").toLowerCase();
      const seq = p.s || [];
      for (let i = 0; i < seq.length - 1; i++) {
        let set = idx.get(seq[i]);
        if (!set) {
          set = new Set();
          idx.set(seq[i], set);
        }
        set.add(name);
      }
    }
    departingByStop.set(pack, idx);
  }
  return idx.get(stopCode) || new Set();
}

function routeDepartsFrom(pack, routeName, stopCode) {
  return departingRoutesAt(pack, stopCode).has(String(routeName || "").toLowerCase());
}

function addHourMinutes(hours, route, code, minutes) {
  const r = String(route || "");
  const c = String(code || "");
  const t = Number(minutes);
  if (!r || !c || !Number.isFinite(t)) return hours;
  if (!hours[r]) hours[r] = {};
  const prev = hours[r][c];
  if (!prev) hours[r][c] = [t, t];
  else {
    if (t < prev[0]) prev[0] = t;
    if (t > prev[1]) prev[1] = t;
  }
  return hours;
}

function serviceSpan(pack, routeName, stopCode) {
  const table = pack && pack.hours;
  if (!table) return null;
  const byStop = table[routeName];
  if (!byStop) return null;
  const span = byStop[stopCode];
  if (!Array.isArray(span) || span.length < 2) return null;
  const first = Number(span[0]);
  const last = Number(span[1]);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return { first, last };
}

function serviceOverlaps(pack, fromRoute, fromStop, toRoute, toStop) {
  const from = serviceSpan(pack, fromRoute, fromStop);
  const to = serviceSpan(pack, toRoute, toStop);
  if (!from || !to) return true;
  return to.last >= from.first;
}

function chooseNearbyTransfers(nearby) {
  const byRoute = new Map();
  for (const x of nearby) {
    let list = byRoute.get(x.r.n);
    if (!list) byRoute.set(x.r.n, (list = []));
    list.push(x);
  }
  const eligible = new Map();
  for (const [name, list] of byRoute) {
    list.sort((a, b) => a.d - b.d || String(a.code).localeCompare(String(b.code)));
    const feet = roundFeetUp10(list[0].d);
    const opts = [];
    const seen = new Set();
    for (const x of list) {
      if (roundFeetUp10(x.d) !== feet) continue;
      if (seen.has(x.code)) continue;
      seen.add(x.code);
      opts.push(x);
    }
    eligible.set(name, opts);
  }
  const names = [...eligible.keys()].sort(
    (a, b) => eligible.get(a).length - eligible.get(b).length || compareBoardCodes(a, b)
  );
  const chosen = new Map();
  for (const name of names) {
    const opts = eligible.get(name);
    let pick = opts[0];
    let pickScore = nearbyStopScore(pick, eligible);
    for (const opt of opts.slice(1)) {
      const score = nearbyStopScore(opt, eligible);
      if (
        score > pickScore ||
        (score === pickScore &&
          (opt.d < pick.d || (opt.d === pick.d && String(opt.code) < String(pick.code))))
      ) {
        pick = opt;
        pickScore = score;
      }
    }
    chosen.set(name, pick);
  }
  return [...chosen.values()];
}

function nearbyStopScore(cand, eligible) {
  let n = 0;
  for (const opts of eligible.values()) {
    if (opts.some((o) => o.code === cand.code)) n += 1;
  }
  return n;
}

function transfersForStop(stopCode, posterRouteName, radius, pack, opts) {
  const excludeSchool = !!(opts && opts.excludeSchool);
  const geo = pack.geo || {};
  const stopRoutes = pack.stopRoutes || {};
  const origin = geo[stopCode];
  const here = stopRoutes[stopCode] || [];
  const keep = (r, at) =>
    !sameRouteName(r.n, posterRouteName) &&
    !(excludeSchool && r.s) &&
    routeDepartsFrom(pack, r.n, at) &&
    serviceOverlaps(pack, posterRouteName, stopCode, r.n, at);
  const same = here.filter((r) => keep(r, stopCode));
  const nearby = [];
  if (origin && radius > 0) {
    for (const [code, g] of Object.entries(geo)) {
      if (code === stopCode) continue;
      const d = distM(origin, g);
      if (metersToFeet(d) > radius) continue;
      for (const r of stopRoutes[code] || []) {
        if (!keep(r, code)) continue;
        if (routeDepartsFrom(pack, r.n, stopCode)) continue;
        nearby.push({ r, code, d });
      }
    }
  }
  same.sort((a, b) => compareBoardCodes(a.n, b.n));
  const others = chooseNearbyTransfers(nearby).sort(
    (a, b) => a.d - b.d || compareBoardCodes(a.r.n, b.r.n)
  );
  return { same, others };
}

function squareHtml(route) {
  const bg = route.c || "#333366";
  const ink = route.t || "#fff";
  return `<span class="sq" style="background:${escapeHtml(bg)};color:${escapeHtml(ink)}"><span class="mark">${escapeHtml(route.n)}</span></span>`;
}

function transferGroups(xfer) {
  const groups = [];
  if (xfer.same.length) groups.push({ routes: xfer.same });
  const byStop = new Map();
  for (const x of xfer.others) {
    let g = byStop.get(x.code);
    if (!g) {
      g = { code: x.code, d: x.d, routes: [] };
      byStop.set(x.code, g);
    }
    g.routes.push(x.r);
    if (x.d < g.d) g.d = x.d;
  }
  const nearby = [...byStop.values()].sort(
    (a, b) => a.d - b.d || String(a.code).localeCompare(b.code)
  );
  for (const g of nearby) {
    g.routes.sort((a, b) => compareBoardCodes(a.n, b.n));
    groups.push({ routes: g.routes, code: g.code, d: g.d });
  }
  return groups;
}

function walkIconHtml() {
  return `<svg class="walk" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.5 1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M6.44 3.752A.75.75 0 0 1 7 3.5h1.445c.742 0 1.32.643 1.243 1.38l-.43 4.083a1.8 1.8 0 0 1-.088.395l-.318.906.213.242a.8.8 0 0 1 .114.175l2 4.25a.75.75 0 1 1-1.357.638l-1.956-4.154-1.68-1.921A.75.75 0 0 1 6 8.96l.138-2.613-.435.489-.464 2.786a.75.75 0 1 1-1.48-.246l.5-3a.75.75 0 0 1 .18-.375l2-2.25Z"/><path d="M6.25 11.745v-1.418l1.204 1.375.261.524a.8.8 0 0 1-.12.231l-2.5 3.25a.75.75 0 1 1-1.19-.914zm4.22-4.215-.494-.494.205-1.843.006-.067 1.124 1.124h1.44a.75.75 0 0 1 0 1.5H11a.75.75 0 0 1-.531-.22Z"/></svg>`;
}

function groupHtml(group) {
  const squares = group.routes.map(squareHtml).join("");
  if (!group.code) return `<span class="xfer-cluster">${squares}</span>`;
  const feet = roundFeetUp10(group.d);
  return `<span class="xfer-cluster">${squares}<span class="xfer-stop">(${walkIconHtml()}${feet} ft.)</span></span>`;
}

function transfersHtml(xfer, geo) {
  const groups = transferGroups(xfer);
  if (!groups.length) return "";
  return `<span class="xfer">${groups.map((g) => groupHtml(g)).join('<span class="xfer-plus">+</span>')}</span>`;
}

function transfersForStops(codes, posterRouteName, radius, pack, opts) {
  const byName = new Map();
  for (const code of codes || []) {
    const xfer = transfersForStop(code, posterRouteName, radius, pack, opts);
    for (const r of xfer.same) byName.set(r.n, r);
    for (const x of xfer.others) {
      if (!byName.has(x.r.n)) byName.set(x.r.n, x.r);
    }
  }
  const same = [...byName.values()].sort((a, b) => compareBoardCodes(a.n, b.n));
  return { same, others: [] };
}

function ledParts(board) {
  const code = String((board && board.code) || "").trim();
  let dest = String((board && board.dest) || "")
    .replace(/[\u2708\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (code) {
    const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    dest = dest.replace(new RegExp(`^${esc}\\s+TO\\s+`, "i"), "");
  }
  dest = dest.replace(/^TO\s+/i, "");
  return { code, dest };
}

function ledPlaneSvg() {
  return `<svg class="led-plane" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.16 2.25L9.71 10.8 4.7 10.8 3.18 9.12 1.2 9.12 2.46 12.05 1.2 14.93 3.18 14.93 4.68 13.29 9.69 13.29 7.16 21.75 9.14 21.9 14.6 13.29 21.53 13.29C21.88 13.29 22.18 13.17 22.43 12.95 22.68 12.72 22.8 12.42 22.8 12.05 22.8 11.88 22.77 11.72 22.7 11.57 22.64 11.42 22.55 11.29 22.43 11.17 22.31 11.05 22.17 10.96 22.02 10.9 21.86 10.83 21.7 10.8 21.53 10.8L14.64 10.8 9.14 2.1Z"/></svg>`;
}

function headboardDestHtml(dest) {
  if (String(dest || "").trim() === "AIRPORT") {
    return `${ledPlaneSvg()}<span class="led-word">AIRPORT</span>${ledPlaneSvg()}`;
  }
  return escapeHtml(dest);
}

function signLabel(board) {
  const parts = ledParts(board);
  return [parts.code, parts.dest].filter(Boolean).join(" TO ");
}

function joinNoteLeds(boards) {
  const chips = boards.map((b) => `<span class="note-led">${escapeHtml(signLabel(b))}</span>`);
  if (chips.length <= 1) return chips[0] || "";
  if (chips.length === 2) return `${chips[0]} and ${chips[1]}`;
  return `${chips.slice(0, -1).join(", ")}, and ${chips[chips.length - 1]}`;
}

function stopPhrase(code, geo) {
  const g = (geo && code && geo[code]) || {};
  return `<span class="term-name">${escapeHtml(g.n || code)}</span>`;
}

function closeTerminusNoteHtml(row, geo) {
  const led = joinNoteLeds(row.boards || []);
  const signed = led ? `Trips signed ${led}` : "Trips";
  const a = geo && geo[row.dayCode];
  const b = geo && geo[row.eveningCode];
  const feet = a && b ? roundFeetUp10(distM(a, b)) : null;
  const apart = feet ? ` The two stops are ${feet} feet away from each other.` : "";
  return `<p class="tt-note">${signed} terminate at ${stopPhrase(row.eveningCode, geo)} ${escapeHtml(
    row.eveningWhen || "on evenings and weekends"
  )}, and ${stopPhrase(row.dayCode, geo)} otherwise.${apart}</p>`;
}

function endNoteHtml(row, geo) {
  if (row && row.kind === "closeTerminus") return closeTerminusNoteHtml(row, geo);
  const list = ((row && (row.boards || (row.board ? [row.board] : []))) || []).filter(Boolean);
  const atCode = row && row.at;
  const g = (geo && atCode && geo[atCode]) || {};
  const where = g.n || atCode || "the last stop listed above";
  return `<p class="tt-note">Trips signed ${joinNoteLeds(list)} terminate at <span class="term-name">${escapeHtml(where)}</span>.</p>`;
}

function destNoteHtml(note) {
  if (!note) return "";
  if (note.type === "terminus") {
    return `<p class="tt-note">*${escapeHtml(note.lead)}<span class="term-name">${escapeHtml(
      note.stopName
    )}</span> <span class="term-no">(Stop #${escapeHtml(note.stopCode)})</span>.</p>`;
  }
  if (note.type === "headsign") {
    return `<p class="tt-note">*${escapeHtml(note.lead)}<span class="note-led">${escapeHtml(note.headsign)}</span>.</p>`;
  }
  return "";
}

function prettyDest(dest) {
  return String(dest || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^via$/i.test(w)) return "via";
      if (/^uw$/i.test(w)) return "UW";
      if (/^to$/i.test(w)) return "to";
      if (/^[nsew]$/i.test(w) || /^(ne|nw|se|sw)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function prettyHeadsign(board) {
  const parts = ledParts(board);
  const dest = prettyDest(parts.dest);
  if (parts.code && dest) return `${parts.code} to ${dest}`;
  return parts.code || dest;
}

function needsWideStopName(poster) {
  if (String(poster.titleCode || "").toUpperCase() === "A2") return true;
  for (const row of poster.rows || []) {
    const names = new Set((row.onlyBoards || []).map(prettyHeadsign));
    if (
      names.has("A to East Campus via High Crossing") &&
      names.has("A to Junction via High Crossing")
    ) {
      return true;
    }
  }
  return false;
}

function onlyServedHtml(boards) {
  if (!boards || !boards.length) return "";
  const names = [...new Set(boards.map(prettyHeadsign))].filter(Boolean);
  if (!names.length) return "";
  const led = (name) => `<span class="only-led"><span class="mark">${escapeHtml(name)}</span></span>`;
  const phrase =
    names.length === 1
      ? led(names[0])
      : names.length === 2
        ? `${led(names[0])} and ${led(names[1])}`
        : `${names.slice(0, -1).map(led).join(", ")}, and ${led(names[names.length - 1])}`;
  return `<div class="only-served${names.length > 1 ? " many" : ""}"><span class="only-cap">(only served by</span>${phrase}<span class="only-cap">)</span></div>`;
}

function headboardHtml(board) {
  if (!board) return "";
  const parts = ledParts(board);
  const led = [parts.code, parts.dest].filter(Boolean).join(" TO ");
  return `<div class="headboard" aria-label="${escapeHtml(led)}">
    <span class="led-code">${escapeHtml(parts.code)}</span>
    ${parts.dest ? `<span class="led-to">TO</span><span class="led-dest">${headboardDestHtml(parts.dest)}</span>` : ""}
  </div>`;
}

function routeBadgeHtml(code, color, ink) {
  const name = String(code || "");
  const size = 0.92;
  let font = name.length > 2 ? 42 : name.length > 1 ? 56 : 72;
  font = Math.max(11, Math.round(font * (size / 0.92)));
  return `<div class="badge" style="background:${escapeHtml(color || "#333366")};color:${escapeHtml(ink || "#fff")};width:${size}in;height:${size}in;font-size:${font}px"><span class="mark">${escapeHtml(name)}</span></div>`;
}

function normalizeLoi(rec) {
  if (!rec) return [];
  const raw = Array.isArray(rec)
    ? rec
    : Array.isArray(rec.items)
      ? rec.items
      : rec.label || rec.icon
        ? [rec]
        : [];
  return raw
    .map((item) => ({
      label: String((item && item.label) || "").trim(),
      icon: String((item && item.icon) || "").trim(),
    }))
    .filter((item) => item.label || item.icon);
}

function newLandmarkId(label) {
  const slug = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `lm-${slug || Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function migrateLocations(raw, pack) {
  const src = raw || {};
  if (Array.isArray(src.landmarks) && src.landmarks.length) {
    return {
      reviewed: [...(src.reviewed || [])],
      landmarks: src.landmarks.map((lm) => ({
        id: lm.id || newLandmarkId(lm.label),
        label: String(lm.label || "").trim(),
        icon: String(lm.icon || "").trim(),
        lat: Number(lm.lat),
        lon: Number(lm.lon),
        stops: [...new Set((lm.stops || []).map(String))],
      })),
    };
  }
  const landmarks = [];
  const geo = (pack && pack.geo) || {};
  for (const [code, rec] of Object.entries(src.stops || {})) {
    for (const item of normalizeLoi(rec)) {
      const label = item.label || (ICONS[item.icon] && ICONS[item.icon].label) || "";
      const found = landmarks.find((l) => l.label === label && l.icon === item.icon);
      if (found) {
        if (!found.stops.includes(String(code))) found.stops.push(String(code));
        continue;
      }
      const g = geo[code] || {};
      landmarks.push({
        id: newLandmarkId(label),
        label,
        icon: item.icon,
        lat: Number(g.lat) || 0,
        lon: Number(g.lon) || 0,
        stops: [String(code)],
      });
    }
  }
  return { reviewed: [...(src.reviewed || [])], landmarks };
}

function loiItemsForStop(code, locations) {
  if (!locations) return [];
  if (Array.isArray(locations.landmarks) && locations.landmarks.length) {
    return locations.landmarks
      .filter((lm) => (lm.stops || []).map(String).includes(String(code)))
      .map((lm) => ({
        label: String(lm.label || "").trim(),
        icon: String(lm.icon || "").trim(),
      }))
      .filter((item) => item.label || item.icon);
  }
  const map = locations.stops || locations;
  return normalizeLoi(map[String(code)]);
}

function loiHtml(code, locations) {
  const items = loiItemsForStop(code, locations);
  if (!items.length) return "";
  return `<div class="loi-list">${items
    .map((item) => {
      const icon = item.icon && ICONS[item.icon] ? ICONS[item.icon].svg : "";
      return `<span class="loi">${icon}<span>${escapeHtml(item.label)}</span></span>`;
    })
    .join("")}</div>`;
}

function stopCell(code, geo, star) {
  const g = geo[code] || {};
  const name = g.n || code;
  const mark = star ? "*" : "";
  return `<span class="stop-name">${escapeHtml(name)}${mark}</span> <span class="stop-no">(#${escapeHtml(code)})</span>`;
}

function collapseEndNotes(rows) {
  const out = [];
  for (const row of rows) {
    if (row.type !== "end") {
      out.push(row);
      continue;
    }
    const boards = row.boards || (row.board ? [row.board] : []);
    const prev = out[out.length - 1];
    if (prev && prev.type === "end" && !prev.kind && !row.kind) {
      prev.boards.push(...boards);
    } else {
      out.push({ ...row, boards: boards.slice() });
    }
  }
  return out;
}

function rowsHtml(rows, originCode, posterRouteName, radius, pack, locations, excludeSchool) {
  const geo = pack.geo || {};
  const out = [];
  let stripe = 0;
  let lastVariant = false;
  let variantGroup = 0;
  let openVariant = false;
  let mainN = 0;
  let extraN = 0;
  let pendingExtra = false;
  function variantClass() {
    if (!lastVariant && !openVariant) return "";
    const alt = variantGroup > 0 && variantGroup % 2 === 0;
    return alt ? " variant variant-alt" : " variant";
  }
  for (const row of collapseEndNotes(rows)) {
    if (row.type === "end") {
      const extra = lastVariant ? variantClass() : "";
      if (lastVariant) {
        pendingExtra = false;
        extraN = 0;
        openVariant = false;
      }
      out.push(`<tr class="end${extra}"><td colspan="4">${endNoteHtml(row, geo)}</td></tr>`);
      continue;
    }
    if (row.type === "branch") {
      lastVariant = false;
      openVariant = false;
      variantGroup = 0;
      continue;
    }
    const variant = !!(row.onlyBoards && row.onlyBoards.length);
    if (variant) {
      if (!openVariant) variantGroup += 1;
      openVariant = true;
    } else {
      openVariant = false;
      variantGroup = 0;
    }
    lastVariant = variant;
    stripe += 1;
    let idx;
    if (variant) {
      extraN += 1;
      pendingExtra = true;
      idx = `(${mainN + extraN})`;
    } else {
      mainN += 1;
      idx = pendingExtra && extraN ? `${mainN} (${mainN + extraN})` : String(mainN);
    }
    const alt = !variant && stripe % 2 === 0 ? " alt" : "";
    const extra = variant ? variantClass() : "";
    const xferCodes = row.xferCodes || [row.code];
    const xfer =
      xferCodes.length > 1
        ? transfersForStops(xferCodes, posterRouteName, radius, pack, { excludeSchool })
        : transfersForStop(xferCodes[0], posterRouteName, radius, pack, { excludeSchool });
    const names = (row.alsoCodes && row.alsoCodes.length ? row.alsoCodes : [row.code])
      .map((code) => stopCell(code, geo, row.starTerminus && code === row.code))
      .join(" or<br />");
    out.push(`<tr class="data${alt}${extra}">
      <td class="idx">${idx}</td>
      <td class="min">${formatMinutes(row.minutes)}</td>
      <td class="sn">${names}${onlyServedHtml(row.onlyBoards)}</td>
      <td class="xf">${transfersHtml(xfer, geo)}</td>
    </tr>`);
  }
  return out.join("\n");
}

function comparePosters(a, b, pack) {
  const ra = (pack.routeByName.get(a.routeName) || {}).o || 0;
  const rb = (pack.routeByName.get(b.routeName) || {}).o || 0;
  if (ra !== rb) return ra - rb;
  const schoolA = pack.routeByName.get(a.routeName)?.s ? 1 : 0;
  const schoolB = pack.routeByName.get(b.routeName)?.s ? 1 : 0;
  if (schoolA !== schoolB) return schoolA - schoolB;
  if (a.routeName !== b.routeName) return compareBoardCodes(a.routeName, b.routeName);
  if (a.heading !== b.heading) return String(a.heading).localeCompare(String(b.heading), "en");
  const tc = compareBoardCodes(a.titleCode, b.titleCode);
  if (tc) return tc;
  return String(a.destLabel || "").localeCompare(String(b.destLabel || ""), "en");
}

function postersForStop(pack, stopCode, opts) {
  const options = opts || {};
  const radius = options.radius == null ? DEFAULT_RADIUS : Number(options.radius);
  const excludeSchool = !!options.excludeSchool;
  const routeNames = options.routes && options.routes.length ? [options.routes[0]] : null;
  const want = routeNames ? new Set(routeNames.map((n) => String(n).toLowerCase())) : null;
  const locations = options.locations || {};
  const routeByName = routeMap(pack);
  pack.routeByName = routeByName;
  pack.stopRoutes = pack.stopRoutes || {};

  let instances = patternsForStop(pack, stopCode);
  if (want) instances = instances.filter((i) => want.has(String(i.r).toLowerCase()));
  if (excludeSchool) {
    instances = instances.filter((i) => !routeByName.get(i.r)?.s);
  }
  const groups = posterKeyGroups(instances, routeByName);
  const geo = pack.geo || {};
  const posters = [];
  for (const g of groups) {
    const parts = partitionPosters(g.instances);
    const split = parts.length > 1;
    for (const insts of parts) {
      const merged = applyIgnoredTermini(applyCloseTermini(mergeInstances(insts), g.routeName), g.routeName);
      const rows = smoothMinuteOrder(merged.rows);
      if (!rows.some((r) => r.type === "stop")) continue;
      const heading = routeHeading(stopCode, rows, geo, "");
      const route = routeByName.get(g.routeName) || {};
      const board = primaryBoard(insts);
      posters.push({
        stopCode,
        routeName: g.routeName,
        titleCode: g.titleCode,
        dirId: g.dirId,
        heading,
        destLabel: board ? headsignLabel(board) : "",
        primaryBoard: board,
        showHeadboard: split || !!options.showHeadboard,
        color: route.c || "#333366",
        ink: route.t || "#ffffff",
        rows,
        destNote: merged.destNote,
        radius,
        excludeSchool,
        locations,
      });
    }
  }
  posters.sort((a, b) => comparePosters(a, b, pack));
  const headingsByRoute = new Map();
  for (const p of posters) {
    if (!p.heading) continue;
    if (!headingsByRoute.has(p.routeName)) headingsByRoute.set(p.routeName, new Set());
    headingsByRoute.get(p.routeName).add(p.heading);
  }
  for (const p of posters) {
    const set = headingsByRoute.get(p.routeName);
    p.showHeading = !!(set && set.size > 1);
  }
  return posters;
}

function titleCaseHeading(heading) {
  const raw = String(heading || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function posterKicker(poster) {
  const code = poster.titleCode || poster.routeName || "";
  if (poster.showHeading && poster.heading) {
    return `Metro Transit ${titleCaseHeading(poster.heading)} Route ${code} stop list`;
  }
  return `Metro Transit Route ${code} stop list`;
}

function packPdfSlug(posters) {
  const stop = String((posters[0] && posters[0].stopCode) || "").trim();
  const codes = [...new Set((posters || []).map((p) => String(p.titleCode || "route").toLowerCase()))];
  if (codes.length === 1 && posters[0]) return pdfSlugFor(posters[0]);
  if (codes.length && codes.length <= 4) return ["served", ...codes, stop].filter(Boolean).join("-");
  return ["served", stop].filter(Boolean).join("-");
}

function pdfSlugFor(poster) {
  const bits = ["served", String(poster.titleCode || "route").toLowerCase()];
  if (poster.showHeadboard && poster.destLabel) {
    bits.push(
      String(poster.destLabel)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40)
    );
  }
  bits.push(String(poster.stopCode || ""));
  return bits.filter(Boolean).join("-").replace(/-+/g, "-");
}

function sheetHtml(poster, pack) {
  const geo = pack.geo || {};
  const origin = geo[poster.stopCode] || {};
  const street = streetDirectionLabel({
    cardinal_direction: origin.cd,
    primary_street: origin.street,
  });
  const onStreet = street ? `on ${street}` : "";
  const kicker = posterKicker(poster);
  const name = origin.n || poster.stopCode;
  const meta = [`Stop #${poster.stopCode}`, onStreet].filter(Boolean).join(", ");
  const body = rowsHtml(
    poster.rows,
    poster.stopCode,
    poster.routeName,
    poster.radius,
    pack,
    poster.locations,
    poster.excludeSchool
  );
  const board = poster.showHeadboard ? headboardHtml(poster.primaryBoard) : "";
  const qr = mapQrHtml(poster, pack);
  return `<section class="sheet${needsWideStopName(poster) ? " wide-sn" : ""}" data-pdf-name="${escapeHtml(pdfSlugFor(poster))}" style="--route:${escapeHtml(poster.color)};--route-ink:${escapeHtml(poster.ink)}">
    <header class="mast${qr ? " has-qr" : ""}">
      <div class="badges">${routeBadgeHtml(poster.titleCode, poster.color, poster.ink)}</div>
      <div class="ident">
        <div class="kicker">${escapeHtml(kicker)}</div>
        <h1>${escapeHtml(name)}</h1>
        <div class="meta">${escapeHtml(meta)}</div>
      </div>
      ${qr}
    </header>
    <div class="next-stops" aria-hidden="true">
      <span class="ns-line"></span>
      <span class="ns-mark">
        <svg viewBox="0 0 10 7" aria-hidden="true"><path d="M0 0h10L5 7z"/></svg>
        Next Stops
        <svg viewBox="0 0 10 7" aria-hidden="true"><path d="M0 0h10L5 7z"/></svg>
      </span>
      <span class="ns-line"></span>
    </div>
    ${board}
    <table class="ss-table">
      <thead>
        <tr>
          <th class="idx">Stops ↓<br />from here</th>
          <th class="min">Minutes ↓<br />from here</th>
          <th class="sn">Stop name</th>
          <th class="xf">Transfer to</th>
        </tr>
      </thead>
      <tbody>
        ${body}
      </tbody>
    </table>
    ${destNoteHtml(poster.destNote)}
    <footer class="notes">
      <div>
        <div>This is a citizen-made stop list intended to improve accessibility, not an official Metro Transit bulletin. Times are trip-weighted averages and may vary at peak and off-hours.</div>
        <div class="source">${sourceLine(pack)}</div>
      </div>
    </footer>
  </section>`;
}

function sourceLine(pack) {
  const feed = pack.feed || {};
  const version = feed.feed_version || feed.v || "";
  const range =
    feed.feed_start_date && feed.feed_end_date
      ? `, valid ${formatDateRange(feed.feed_start_date, feed.feed_end_date)}`
      : "";
  return `Source: Metro Transit GTFS${version ? " " + escapeHtml(version) : ""}${escapeHtml(range)}. Please check for detours and holidays at cityofmadison.com/metro.`;
}

const POSTER_CHROME_SCRIPT = String.raw`
(function () {
  function inchPx() {
    var probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-9999px;width:1in;height:1in";
    document.body.appendChild(probe);
    var inch = probe.offsetHeight || 96;
    document.body.removeChild(probe);
    return inch;
  }
  function sizeNote() {
    var sheets = document.querySelectorAll(".sheet");
    var el = document.getElementById("page-count");
    if (!sheets.length || !el) return;
    var sheet = sheets[0];
    var inch = inchPx();
    var h = Math.max(0.5, sheet.offsetHeight / inch);
    var n = Math.max(1, Math.ceil(h / 11));
    sheet.setAttribute("data-pages", String(n));
    var text = h.toFixed(2) + " inches tall, 8.5 inches wide";
    if (sheets.length > 1) text = sheets.length + " sheets · " + text;
    el.textContent = text;
  }
  function inIframe() {
    try { return window.parent && window.parent !== window; } catch (e) { return true; }
  }
  function isPhone() {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }
  function pdfSlug() {
    var body = document.body && document.body.getAttribute("data-pdf-name");
    if (body) return body;
    var sheet = document.querySelector(".sheet[data-pdf-name]");
    return (sheet && sheet.getAttribute("data-pdf-name")) || document.title;
  }
  function printPoster() {
    var slug = pdfSlug();
    var prev = document.title;
    var parentPrev = null;
    document.title = slug;
    try {
      if (window.parent && window.parent !== window) {
        parentPrev = window.parent.document.title;
        window.parent.document.title = slug;
      }
    } catch (e) {}
    var restored = false;
    function restore() {
      if (restored) return;
      restored = true;
      document.title = prev;
      try { if (parentPrev != null) window.parent.document.title = parentPrev; } catch (e) {}
      window.removeEventListener("afterprint", restore);
    }
    window.addEventListener("afterprint", restore);
    if (inIframe() && isPhone()) {
      var w = window.open("", "_blank");
      if (w) {
        w.document.open();
        w.document.write("<!DOCTYPE html>\n" + document.documentElement.outerHTML);
        w.document.close();
        w.document.title = slug;
        w.focus();
        try { w.print(); } catch (e) {}
        restore();
        return;
      }
    }
    window.print();
    setTimeout(restore, 2500);
  }
  var printBtn = document.getElementById("print-poster");
  if (printBtn) printBtn.addEventListener("click", printPoster);
  sizeNote();
  if (document.readyState !== "complete") window.addEventListener("load", sizeNote);
  window.addEventListener("resize", sizeNote);
})();
`;

function posterCss() {
  return `
    :root {
      --ink: #111;
      --muted: #4a4a4a;
      --rule: #d0d0d0;
      --paper: #fff;
      --desk: #cfc8be;
      --led: #f5a623;
      --led-bg: #0c0c0c;
      --board-size: 26px;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--desk);
      color: var(--ink);
      font-family: "IBM Plex Sans", "Segoe UI", Tahoma, sans-serif;
    }
    body.shot { background: #fff; }
    body.shot .chrome { display: none; }
    body.shot .sheet { margin: 0; }
    .chrome {
      width: 8.5in;
      margin: 18px auto 10px;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .chrome button, .chrome label {
      background: #fff;
      border: 1px solid #7a7a7a;
      border-radius: 2px;
      padding: 7px 11px;
      font: inherit;
      cursor: pointer;
    }
    .chrome .hint { color: #333; }
    .sheet {
      position: relative;
      width: 8.5in;
      margin: 0 auto 28px;
      background: var(--paper);
      color: var(--ink);
      padding: 0.28in 0.34in 0.2in 0.42in;
      display: flex;
      flex-direction: column;
    }
    .sheet::before {
      content: "";
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 0.24in;
      background: var(--route);
    }
    header.mast {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px;
      align-items: center;
      padding-bottom: 10px;
      margin-bottom: 0;
    }
    header.mast.has-qr { grid-template-columns: auto 1fr 0.95in; }
    .qr-block {
      justify-self: end;
      width: 0.95in;
      text-align: center;
    }
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
    .badge {
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.04em;
    }
    .badge .mark,
    .sq .mark {
      display: block;
      line-height: 1;
      text-box-trim: trim-both;
      text-box-edge: cap alphabetic;
    }
    .ident .kicker {
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--route);
    }
    .ident h1 {
      margin: 2px 0 3px;
      font-size: 26px;
      line-height: 1.05;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .ident .meta { font-size: 12px; color: var(--muted); }
    .headboard {
      background: var(--led-bg);
      color: var(--led);
      border: 2px solid #2b2b2b;
      padding: 10px 14px 9px;
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 0.45em;
      min-height: 2.45em;
      max-height: 2.45em;
      overflow: hidden;
      margin: 0 0 10px;
    }
    .led-code, .led-dest {
      font-family: "Share Tech Mono", "Consolas", monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      line-height: 1;
      font-size: var(--board-size);
    }
    .led-code { flex: 0 0 auto; }
    .led-to {
      flex: 0 0 auto;
      font-family: "Share Tech Mono", "Consolas", monospace;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      line-height: 1;
      font-size: calc(var(--board-size) * 0.5);
      opacity: 0.85;
      padding-top: 0.2em;
    }
    .led-dest {
      flex: 1 1 auto;
      min-width: 0;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .led-plane { width: 0.9em; height: 0.9em; margin: 0 0.12em; vertical-align: -0.12em; }
    .next-stops {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0 0 10px;
      color: var(--route);
    }
    .next-stops .ns-line {
      flex: 1 1 auto;
      height: 0;
      border-top: 3px solid var(--route);
    }
    .next-stops .ns-mark {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex: 0 0 auto;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      white-space: nowrap;
      line-height: 1;
    }
    .next-stops svg {
      width: 8px;
      height: 6px;
      fill: currentColor;
      display: block;
    }
    .ss-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      border: 0;
      border-left: 1px solid var(--route);
      border-right: 1px solid var(--route);
      border-bottom: 1px solid var(--route);
    }
    .ss-table th {
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-align: left;
      background: var(--route);
      color: #fff;
      border-bottom: 0;
      border-right: 1px solid rgba(255,255,255,0.35);
      padding: 0.06in 0.07in 0.07in;
      vertical-align: bottom;
    }
    .ss-table th.sn,
    .ss-table th.xf {
      font-size: 10px;
      letter-spacing: 0.03em;
    }
    .ss-table td {
      position: relative;
      border-bottom: 0;
      border-right: 0;
      padding: 0.055in 0.07in;
      vertical-align: top;
      font-size: 10.5px;
      line-height: 1.25;
      background: #fff;
    }
    .ss-table td::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      right: 0;
      width: 1px;
      background: var(--ink);
      pointer-events: none;
      z-index: 2;
    }
    .ss-table td:last-child::before { content: none; }
    .ss-table td::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 1px;
      background: var(--rule);
      pointer-events: none;
      z-index: 1;
    }
    .ss-table tr.alt td { background: #f3f1ed; }
    .ss-table tr.variant td { background: #d4d1cb; }
    .ss-table tr.variant td::after { background: var(--ink); }
    .ss-table tr.variant td.sn { font-style: italic; }
    .ss-table tr.variant-alt td { background: #fff; }
    .ss-table tr.end.variant td {
      background: #d4d1cb;
      font-style: normal;
    }
    .ss-table tr.end.variant td::after { background: var(--rule); }
    .ss-table tr.end.variant-alt td { background: #fff; }
    .ss-table tbody tr:last-child td::after {
      content: none;
      display: none;
    }
    .ss-table th:last-child,
    .ss-table td:last-child { border-right: 0; }
    .ss-table .idx { width: 0.72in; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
    .ss-table .min { width: 0.85in; font-variant-numeric: tabular-nums; font-weight: 600; }
    .ss-table .sn { width: 2.55in; }
    .sheet.wide-sn .ss-table .sn { width: 3.24in; }
    .sheet.wide-sn .only-served { white-space: nowrap; }
    .ss-table .xf { width: auto; }
    .stop-name { font-weight: 600; }
    .stop-no { color: var(--muted); font-weight: 500; }
    .xfer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      row-gap: 4px;
      max-width: 100%;
    }
    .xfer-cluster {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      row-gap: 4px;
    }
    .xfer-plus {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 0.85em;
      margin: 0 0.1em;
      font-weight: 700;
      font-size: 9px;
      line-height: 1;
      color: var(--muted);
      vertical-align: middle;
    }
    .sq {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5em;
      height: 1.2em;
      min-width: 1.5em;
      padding: 0;
      margin-right: 2px;
      font-size: 10.5px;
      font-weight: 800;
      line-height: 1;
      vertical-align: middle;
      box-sizing: border-box;
    }
    .xfer-cluster .sq:last-of-type { margin-right: 0; }
    .xfer-stop {
      display: inline-flex;
      align-items: center;
      gap: 0.15em;
      margin-left: 0.2em;
      font-size: 8px;
      color: var(--muted);
      white-space: nowrap;
    }
    .xfer-stop .walk { width: 11px; height: 11px; flex: none; }
    .loi-list {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 8px;
    }
    .loi {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 1.25;
      color: var(--ink);
      font-style: normal;
    }
    .loi svg { width: 11px; height: 11px; flex: none; }
    tr.end td {
      padding: 0.07in 0.08in;
      background: #fff;
      font-style: normal;
    }
    .only-served {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      gap: 0.35em;
      margin-top: 1px;
      font-style: italic;
      font-weight: 400;
      font-size: 9px;
      line-height: 1;
      color: var(--muted);
    }
    .only-served.many { flex-wrap: wrap; }
    .only-led {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 14px;
      font-family: "Share Tech Mono", "Consolas", monospace;
      font-style: normal;
      font-weight: 400;
      font-size: 8px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      line-height: 8px;
      background: var(--led-bg);
      color: var(--led);
      border: 1px solid #2b2b2b;
      padding: 0 0.32em;
      box-sizing: border-box;
    }
    .only-led .mark {
      display: block;
      line-height: 8px;
      text-box-trim: trim-both;
      text-box-edge: cap alphabetic;
    }
    .ss-table tr.variant td.sn .only-led { font-style: normal; }
    .tt-note {
      margin: 0;
      font-size: 10.5px;
      line-height: 1.45;
      color: var(--muted);
      font-weight: 500;
      font-style: normal;
    }
    .sheet > .tt-note { margin: 8px 0 0; }
    .tt-note .term-name { font-weight: 700; color: var(--ink); }
    .tt-note .term-no { font-weight: 500; }
    .note-led {
      display: inline-block;
      font-family: "Share Tech Mono", "Consolas", monospace;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 1.05em;
      line-height: 1;
      background: var(--led-bg);
      color: var(--led);
      border: 1px solid #2b2b2b;
      padding: 0.18em 0.4em 0.12em;
      vertical-align: baseline;
      font-weight: 400;
    }
    footer.notes {
      margin-top: auto;
      padding-top: 8px;
      border-top: 0;
      font-size: 9.5px;
      line-height: 1.4;
      color: var(--muted);
    }
    footer.notes .source { margin-top: 0.02em; }
    @page { size: letter portrait; margin: 0; }
    @media print {
      html, body {
        margin: 0;
        padding: 0;
        background: #fff !important;
        width: 8.5in;
        max-width: 8.5in;
      }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body > *:not(.sheet) { display: none !important; }
      .sheet {
        margin: 0 !important;
        width: 8.5in;
        max-width: 8.5in;
        page-break-after: always;
      }
    }
  `;
}

function renderServedHtml(pack, posters, extra) {
  const feed = pack.feed || {};
  const stopCode = posters[0] ? posters[0].stopCode : "";
  const name = (pack.geo && pack.geo[stopCode] && pack.geo[stopCode].n) || stopCode;
  const sheets = posters.map((p) => sheetHtml(p, pack)).join("\n");
  const pdfSlug = packPdfSlug(posters);
  const source =
    feed.feed_version || feed.v
      ? `Source: Madison Metro GTFS ${escapeHtml(feed.feed_version || feed.v)}.`
      : "Source: Madison Metro GTFS.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pdfSlug)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
  <style>${posterCss()}</style>
</head>
<body data-pdf-name="${escapeHtml(pdfSlug)}">
  <div class="chrome">
    <button type="button" id="print-poster">Print/Save as PDF</button>
    <span class="hint" id="page-count">Measuring size…</span>
  </div>
  ${sheets}
  <!-- ${source} ${escapeHtml((extra && extra.note) || "")} -->
  <script>
${POSTER_CHROME_SCRIPT}
  </script>
</body>
</html>`;
}

function generateServedHtml(pack, stopCode, opts) {
  ensureMapQr(pack);
  const posters = postersForStop(pack, stopCode, opts);
  if (!posters.length) {
    throw new Error(`No remaining stops from ${stopCode} for the selected route.`);
  }
  return { html: renderServedHtml(pack, posters, opts), posters };
}

function uniqueStopsForRoute(pack, routeName, dirId) {
  const seqs = [];
  for (const p of pack.patterns || []) {
    if (String(p.r) !== String(routeName)) continue;
    if (dirId != null && String(p.d) !== String(dirId)) continue;
    seqs.push(p.s || []);
  }
  const dummy = seqs.map((s) => ({
    board: { code: routeName, dest: "" },
    trips: 1,
    remaining: s.slice(),
    minutes: s.map(() => 0),
  }));
  if (!dummy.length) return [];
  const rows = mergeInstances(dummy);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.type !== "stop") continue;
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    out.push(row.code);
  }
  return out;
}

function directionsForRoute(pack, routeName) {
  const dirs = new Set();
  for (const p of pack.patterns || []) {
    if (String(p.r) === String(routeName)) dirs.add(String(p.d));
  }
  return [...dirs].sort();
}

function headingForRouteDir(pack, routeName, dirId) {
  let best = null;
  for (const p of pack.patterns || []) {
    if (String(p.r) !== String(routeName)) continue;
    if (dirId != null && String(p.d) !== String(dirId)) continue;
    if (!best || p.n > best.n || (p.n === best.n && (p.s || []).length > (best.s || []).length)) {
      best = p;
    }
  }
  const fallback = dirId == null ? "" : `Direction ${dirId}`;
  if (!best || !(best.s || []).length) return { heading: fallback, dest: "" };
  const geo = pack.geo || {};
  const origin = geo[best.s[0]];
  const end = geo[best.s[best.s.length - 1]];
  let heading = fallback;
  if (origin && end && distM(origin, end) >= 120) {
    heading = headingWordFromBearing(bearingDeg(origin, end));
  } else if (origin) {
    for (const code of best.s.slice(1)) {
      const g = geo[code];
      if (!g || distM(origin, g) < 120) continue;
      heading = headingWordFromBearing(bearingDeg(origin, g));
      break;
    }
  }
  return { heading, dest: best.e || "" };
}

function routeDirLabel(pack, routeName, dirId) {
  const info = headingForRouteDir(pack, routeName, dirId);
  const head = titleCaseHeading(info.heading);
  const to = prettyDest(info.dest);
  if (head && to) return `${head} to ${to}`;
  return head || to || `Direction ${dirId}`;
}

const api = {
  DEFAULT_RADIUS,
  ICONS,
  qrBits,
  routeMapUrl,
  escapeHtml,
  streetDirectionLabel,
  formatHeadboard,
  boardParts,
  compareBoardCodes,
  distM,
  metersToFeet,
  transferGroups,
  bearingDeg,
  headingWordFromBearing,
  patternsForStop,
  postersForStop,
  generateServedHtml,
  uniqueStopsForRoute,
  directionsForRoute,
  headingForRouteDir,
  routeDirLabel,
  prettyDest,
  normalizeLoi,
  newLandmarkId,
  migrateLocations,
  loiItemsForStop,
  transfersForStop,
  serviceOverlaps,
  addHourMinutes,
  headsignLabel,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.MMTServed = api;
}
