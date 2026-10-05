import { createStore } from "./store.js";
import { allowedDomains } from "./config.js";

/* ---------------- constants ---------------- */
const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const COLORS = {
  light: { building: "#d9d4ce", puck: "#c8102e", gone: "#9a948e", selected: "#ffb100", stem: "#6b6560", slab: "#ffb100" },
  dark: { building: "#59606a", puck: "#ff4d5e", gone: "#6f6a66", selected: "#ffc53d", stem: "#a19c97", slab: "#ffc53d" },
};
const HOME = { center: [-71.0893, 42.3388], zoom: 16.2, pitch: 58, bearing: -28 };
const CAMPUS = { south: 42.3315, north: 42.3455, west: -71.0985, east: -71.0805 };
const FLOOR_M = 4.2;      // metres per storey for drawing pins at floor height
const PUCK_M = 8;         // pin footprint, metres
const NEU_BUILDINGS = [
  "Curry Student Center", "Snell Library", "Snell Engineering Center", "Ell Hall", "Richards Hall",
  "Dodge Hall", "Hayden Hall", "Mugar Life Sciences Building", "Churchill Hall", "Forsyth Building",
  "Hurtig Hall", "Robinson Hall", "Egan Research Center", "Shillman Hall", "ISEC", "EXP",
  "Behrakis Health Sciences Center", "Ryder Hall", "Nightingale Hall", "Lake Hall", "Meserve Hall",
  "Holmes Hall", "Kariotis Hall", "Cargill Hall", "Stearns Center", "Marino Recreation Center",
  "Cabot Physical Education Center", "Matthews Arena", "International Village", "West Village H",
  "West Village G", "West Village F", "East Village", "Stetson East", "Stetson West", "Speare Hall",
  "Smith Hall", "Kennedy Hall", "Light Hall", "White Hall", "Melvin Hall", "Loftman Hall",
  "Davenport Commons", "Burstein Hall", "Rubenstein Hall", "Kerr Hall", "Columbus Place",
  "Renaissance Park", "Interdisciplinary Science and Engineering Complex",
];

/* ---------------- state ---------------- */
const state = {
  store: null,
  user: null,
  items: [],
  view: "list",          // list | building | form
  buildingKey: null,
  selectedId: null,
  draft: null,
  placing: false,
  pendingAfterAuth: null,
  search: "",
  is3D: true,
};
const theme = () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const isPhone = () => matchMedia("(max-width: 767px)").matches;
const $ = (s) => document.querySelector(s);
const panelBody = $("#panel-body");
const panel = $("#panel");

/* ---------------- helpers ---------------- */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const keyOf = (name) => (name || "").trim().toLowerCase().replace(/\s+/g, " ");
const ledText = (level) => (level > 0 ? `${level}F` : `B${-level}`);
function floorName(level) {
  if (level < 0) return level === -1 ? "Basement" : `Basement ${-level}`;
  const s = ["th", "st", "nd", "rd"], v = level % 100;
  return `${level}${s[(v - 20) % 10] || s[v] || s[0]} floor`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function tally(item) {
  let here = 0, gone = 0;
  for (const v of Object.values(item.votes || {})) v === "here" ? here++ : v === "gone" && gone++;
  return { here, gone, missing: gone >= 2 && gone > here };
}
function dateOf(ts) {
  const d = ts?.toDate ? ts.toDate() : typeof ts === "number" ? new Date(ts) : null;
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
function metersBetween(a, b) {
  const dy = (a.lat - b.lat) * 111320, dx = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
const canPost = () => !!state.user && (state.user.emailVerified || state.store?.preview);
const isMine = (item) => state.store?.preview || (state.user && item.createdBy === state.user.uid);
const domainOk = (email) => allowedDomains.some((d) => email.toLowerCase().endsWith("@" + d));
const inCampus = ({ lat, lng }) => lat > CAMPUS.south && lat < CAMPUS.north && lng > CAMPUS.west && lng < CAMPUS.east;

function groups() {
  const map = new Map();
  for (const it of state.items) {
    const k = keyOf(it.building);
    if (!map.has(k)) map.set(k, { key: k, name: it.building.trim(), items: [] });
    map.get(k).items.push(it);
  }
  for (const g of map.values()) {
    g.lat = g.items.reduce((s, i) => s + i.lat, 0) / g.items.length;
    g.lng = g.items.reduce((s, i) => s + i.lng, 0) / g.items.length;
    g.levels = [...new Set(g.items.map((i) => i.level))].sort((a, b) => b - a);
    g.allMissing = g.items.every((i) => tally(i).missing);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- map ---------------- */
const map = new maplibregl.Map({
  container: "map",
  style: STYLE[theme()],
  ...HOME,
  minZoom: 14.5,
  maxZoom: 20.5,
  maxPitch: 75,
  maxBounds: [[-71.118, 42.322], [-71.062, 42.355]],
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({
  compact: true,
  customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
}));
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

function squareAround(lng, lat, size) {
  const dLat = size / 2 / 111320, dLng = size / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]];
}
const altitude = (level) => (level > 0 ? (level - 1) * FLOOR_M : 0);

function pinData() {
  const pucks = [], stems = [];
  for (const it of state.items) {
    const base = altitude(it.level);
    const props = { id: it.id, missing: tally(it).missing, base, top: base + 3 };
    pucks.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: squareAround(it.lng, it.lat, PUCK_M) } });
    if (base > 0) stems.push({ type: "Feature", properties: { top: base }, geometry: { type: "Polygon", coordinates: squareAround(it.lng, it.lat, 0.9) } });
  }
  return { pucks: { type: "FeatureCollection", features: pucks }, stems: { type: "FeatureCollection", features: stems } };
}
const emptyFC = { type: "FeatureCollection", features: [] };

function puckColor() {
  const c = COLORS[theme()];
  return ["case", ["==", ["get", "id"], state.selectedId || ""], c.selected, ["get", "missing"], c.gone, c.puck];
}

function setupLayers() {
  const c = COLORS[theme()];
  const layers = map.getStyle().layers;
  for (const l of layers) if (l["source-layer"] === "building" && l.type !== "fill-extrusion") map.setLayoutProperty(l.id, "visibility", "none");
  const firstSymbol = layers.find((l) => l.type === "symbol")?.id;
  map.addLayer({
    id: "neu-buildings",
    type: "fill-extrusion",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": c.building,
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.62,
    },
  }, firstSymbol);
  const d = pinData();
  map.addSource("mw-stems", { type: "geojson", data: d.stems });
  map.addSource("mw-pucks", { type: "geojson", data: d.pucks });
  map.addSource("floor-slab", { type: "geojson", data: emptyFC });
  // Drawn before the translucent buildings so pins show through the walls.
  map.addLayer({ id: "floor-slab", type: "fill-extrusion", source: "floor-slab",
    paint: { "fill-extrusion-color": c.slab, "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": 0.55 } }, "neu-buildings");
  map.addLayer({ id: "mw-stems", type: "fill-extrusion", source: "mw-stems",
    paint: { "fill-extrusion-color": c.stem, "fill-extrusion-base": 0, "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": 0.9 } }, "neu-buildings");
  map.addLayer({ id: "mw-pucks", type: "fill-extrusion", source: "mw-pucks",
    paint: { "fill-extrusion-color": puckColor(), "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": 1 } }, "neu-buildings");
  updateSlab();
}
map.on("style.load", setupLayers);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => map.setStyle(STYLE[theme()], { diff: false }));

function updateMapData() {
  if (!map.getSource("mw-pucks")) return;
  const d = pinData();
  map.getSource("mw-pucks").setData(d.pucks);
  map.getSource("mw-stems").setData(d.stems);
  map.setPaintProperty("mw-pucks", "fill-extrusion-color", puckColor());
}

// Highlight the selected microwave's floor across the whole building footprint.
function updateSlab() {
  const src = map.getSource("floor-slab");
  if (!src) return;
  const it = state.items.find((i) => i.id === state.selectedId);
  if (!it) return src.setData(emptyFC);
  const pt = map.project([it.lng, it.lat]);
  const hit = map.queryRenderedFeatures([[pt.x - 3, pt.y - 3], [pt.x + 3, pt.y + 3]], { layers: ["neu-buildings"] })
    .find((f) => (f.properties.render_height ?? 0) > altitude(it.level));
  const geometry = hit?.geometry ?? { type: "Polygon", coordinates: squareAround(it.lng, it.lat, 24) };
  const base = altitude(it.level);
  src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { base, top: base + 0.35 }, geometry }] });
}

/* building count markers */
const markers = new Map();
function updateMarkers() {
  const seen = new Set();
  for (const g of groups()) {
    seen.add(g.key);
    let m = markers.get(g.key);
    if (!m) {
      const el = h("button", { class: "bldg-marker", type: "button" });
      el.addEventListener("click", (e) => { e.stopPropagation(); if (!state.placing) openBuilding(g.key, { fly: true }); });
      m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([g.lng, g.lat]).addTo(map);
      markers.set(g.key, m);
    }
    m.setLngLat([g.lng, g.lat]);
    const el = m.getElement();
    el.replaceChildren(h("i"), String(g.items.length));
    el.setAttribute("aria-label", `${g.name}: ${plural(g.items.length, "microwave")}`);
    el.classList.toggle("active", state.view === "building" && state.buildingKey === g.key);
    el.classList.toggle("gone", g.allMissing);
  }
  for (const [k, m] of markers) if (!seen.has(k)) { m.remove(); markers.delete(k); }
}

/* clicks on the map */
map.on("click", (e) => {
  if (state.placing) return placeDraft(e.lngLat);
  const f = map.queryRenderedFeatures(e.point, { layers: ["mw-pucks"] })[0];
  if (f) selectMicrowave(f.properties.id);
});
map.on("mouseenter", "mw-pucks", () => { if (!state.placing) map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "mw-pucks", () => { map.getCanvas().style.cursor = ""; });

function mapPadding() {
  if (isPhone()) return { top: 120, bottom: panel.classList.contains("collapsed") ? 150 : Math.round(innerHeight * 0.58), left: 0, right: 0 };
  return { top: 70, bottom: 0, left: 404, right: 0 };
}
function flyTo(lng, lat, zoom = 18.2) {
  map.flyTo({ center: [lng, lat], zoom, pitch: state.is3D ? 60 : 0, padding: mapPadding(), duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400 });
}
map.on("moveend", updateSlab);

/* ---------------- views ---------------- */
function setView(view) {
  state.view = view;
  if (view !== "building") state.selectedId = null;
  $("#add-btn").hidden = view === "form";
  renderPanel();
  updateMarkers();
  updateMapData();
  updateSlab();
}

function renderPanel() {
  panelBody.replaceChildren();
  if (state.view === "list") renderListView();
  else if (state.view === "building") renderBuildingView();
  else if (state.view === "form") renderFormView();
  panelBody.scrollTop = 0;
}

function renderListView() {
  const search = h("input", { id: "search", class: "search", type: "search", placeholder: "Search buildings or spots", value: state.search, "aria-label": "Search buildings or spots" });
  search.addEventListener("input", () => { state.search = search.value; renderList(); });
  panelBody.append(
    h("div", {}, h("h1", { text: "Find a microwave" })),
    h("p", { class: "muted", text: "Every pin was marked by a Northeastern student. Pins float at the floor they're on. Tap a building to see each floor." }),
    h("div", { class: "summary", id: "summary" }),
    search,
    h("div", { class: "list", id: "list" }),
    h("p", { class: "footer-note" },
      "Student-made, not affiliated with Northeastern University. Map data © ",
      h("a", { href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener", text: "OpenStreetMap" }),
      " contributors."),
  );
  renderList();
}

function renderList() {
  const gs = groups();
  const summary = $("#summary"), list = $("#list");
  if (!list) return;
  summary.replaceChildren(
    h("div", {}, h("b", { text: String(state.items.length) }), h("span", { text: state.items.length === 1 ? "microwave" : "microwaves" })),
    h("div", {}, h("b", { text: String(gs.length) }), h("span", { text: gs.length === 1 ? "building" : "buildings" })),
  );
  const q = state.search.trim().toLowerCase();
  const shown = q ? gs.filter((g) => g.name.toLowerCase().includes(q) || g.items.some((i) => `${i.spot} ${i.notes || ""}`.toLowerCase().includes(q))) : gs;
  list.replaceChildren();
  if (!state.items.length) {
    list.append(h("div", { class: "empty" },
      h("h3", { text: "No microwaves marked yet" }),
      h("p", { class: "muted", text: "Know where one is? Tap Add microwave, drop a pin on the building and pick the floor." })));
    return;
  }
  if (!shown.length) { list.append(h("p", { class: "muted", text: `Nothing matches "${state.search}".` })); return; }
  for (const g of shown) {
    list.append(h("button", { class: "row", type: "button", onclick: () => openBuilding(g.key, { fly: true }) },
      h("span", { class: "row-name", text: g.name }),
      h("span", { class: "row-count", text: plural(g.items.length, "microwave") }),
      h("span", { class: "row-floors" }, g.levels.map((l) => h("span", { class: "led small", text: ledText(l), title: floorName(l) })))));
  }
}

function renderBuildingView() {
  const g = groups().find((x) => x.key === state.buildingKey);
  if (!g) return setView("list");
  const levels = g.items.map((i) => i.level);
  const top = Math.max(...levels, 1), bottom = Math.min(...levels, 1);
  const addHere = h("button", { class: "ghost-btn", type: "button", text: "+ Add one here",
    onclick: () => startAdd({ building: g.name, lat: g.lat, lng: g.lng }) });
  panelBody.append(
    h("button", { class: "back-btn", type: "button", text: "← All buildings", onclick: () => { setView("list"); } }),
    h("div", { class: "head-row" },
      h("div", {}, h("p", { class: "eyebrow", text: `${plural(g.items.length, "microwave")} · ${plural(g.levels.length, "floor")}` }), h("h2", { text: g.name })),
      addHere),
  );
  const stack = h("div", { class: "stack" });
  for (let l = top; l >= bottom; l--) {
    if (l === 0) continue;
    const here = g.items.filter((i) => i.level === l);
    stack.append(h("div", { class: "floor" },
      h("span", { class: `led${here.length ? "" : " dim"}`, text: ledText(l), title: floorName(l) }),
      here.length ? h("div", { class: "floor-items" }, here.map(card)) : h("div", { class: "floor-empty", "aria-label": `${floorName(l)}: none marked` })));
  }
  panelBody.append(stack);
  const sel = document.getElementById("card-" + state.selectedId);
  if (sel) requestAnimationFrame(() => sel.scrollIntoView({ block: "nearest", behavior: "smooth" }));
}

function card(it) {
  const t = tally(it);
  const myVote = state.user ? it.votes?.[state.user.uid] : null;
  const el = h("article", { class: `card${it.id === state.selectedId ? " selected" : ""}${t.missing ? " gone" : ""}`, id: "card-" + it.id });
  el.addEventListener("click", (e) => { if (!e.target.closest("button")) selectMicrowave(it.id); });
  const status = t.missing
    ? h("span", { class: "pill warn", text: `Reported missing by ${t.gone}` })
    : t.here ? h("span", { class: "pill ok", text: `Confirmed by ${t.here}` }) : h("span", { class: "pill", text: "Not confirmed yet" });
  const vote = (value, label) => h("button", { class: "vote-btn", type: "button", "aria-pressed": String(myVote === value), text: label,
    onclick: () => castVote(it, myVote === value ? null : value) });
  const actions = h("div", { class: "card-actions" }, vote("here", "Still here"), vote("gone", "It's gone"));
  if (isMine(it)) {
    actions.append(h("button", { class: "ghost-btn", type: "button", text: "Edit", onclick: () => startEdit(it) }));
    const del = h("button", { class: "ghost-btn danger", type: "button", text: "Delete" });
    let armed = null;
    del.addEventListener("click", async () => {
      if (!armed) { del.textContent = "Tap again to delete"; armed = setTimeout(() => { armed = null; del.textContent = "Delete"; }, 4000); return; }
      clearTimeout(armed);
      try { await state.store.remove(it.id); toast("Deleted."); } catch (e) { toast(errorText(e)); }
    });
    actions.append(del);
  }
  el.append(...[
    h("p", { class: "card-spot", text: it.spot }),
    it.notes ? h("p", { class: "card-notes", text: it.notes }) : null,
    h("div", { class: "card-meta" }, h("span", { text: `${floorName(it.level)} · ${plural(it.count, "microwave")}` }), status, dateOf(it.createdAt) ? h("span", { text: `Added ${dateOf(it.createdAt)}` }) : null),
    actions,
  ].filter(Boolean));
  return el;
}

function openBuilding(key, { fly = false, selectedId = null } = {}) {
  state.buildingKey = key;
  state.view = "building";
  state.selectedId = selectedId;
  expandSheet();
  renderPanel();
  updateMarkers();
  updateMapData();
  const g = groups().find((x) => x.key === key);
  if (fly && g) flyTo(g.lng, g.lat, 17.8);
  updateSlab();
}
function selectMicrowave(id) {
  const it = state.items.find((i) => i.id === id);
  if (!it) return;
  openBuilding(keyOf(it.building), { selectedId: id });
  flyTo(it.lng, it.lat);
}

/* ---------------- add / edit ---------------- */
let draftMarker = null;

function startAdd(prefill = {}) {
  if (!state.user) { state.pendingAfterAuth = () => startAdd(prefill); return openAuth(); }
  if (!canPost()) { showBanner(); return toast("Verify your email first. The link is in your Northeastern inbox."); }
  state.draft = { building: "", level: 1, spot: "", count: 1, notes: "", levels: null, buildingAuto: false, ...prefill };
  setView("form");
  if (prefill.lat != null) setDraftPoint({ lat: prefill.lat, lng: prefill.lng }, { lookup: !prefill.building });
  else setPlacing(true);
}
function startEdit(it) {
  state.draft = { id: it.id, building: it.building, level: it.level, spot: it.spot, count: it.count, notes: it.notes || "", lat: it.lat, lng: it.lng, levels: null };
  setView("form");
  setDraftPoint({ lat: it.lat, lng: it.lng }, { lookup: false });
}

function setPlacing(on) {
  state.placing = on;
  document.body.classList.toggle("placing", on);
  $("#place-hint").hidden = !on;
  $("#add-btn").hidden = on || state.view === "form";
  if (on && isPhone()) panel.classList.add("collapsed");
}
$("#place-cancel").addEventListener("click", () => cancelForm());

function placeDraft(lngLat) {
  const pt = { lat: lngLat.lat, lng: lngLat.lng };
  if (!inCampus(pt)) return toast("That's off the Boston campus. Tap a campus building.");
  setPlacing(false);
  expandSheet();
  setDraftPoint(pt, { lookup: true });
}

function setDraftPoint(pt, { lookup }) {
  Object.assign(state.draft, pt);
  if (!draftMarker) {
    draftMarker = new maplibregl.Marker({ element: h("div", { class: "draft-marker", "aria-label": "New microwave location" }), draggable: true, anchor: "bottom" });
    draftMarker.on("dragend", () => {
      const ll = draftMarker.getLngLat();
      if (!inCampus({ lat: ll.lat, lng: ll.lng })) { toast("Keep the pin on campus."); draftMarker.setLngLat([state.draft.lng, state.draft.lat]); return; }
      setDraftPoint({ lat: ll.lat, lng: ll.lng }, { lookup: true });
    });
  }
  draftMarker.setLngLat([pt.lng, pt.lat]).addTo(map);
  updateFormStep();
  if (lookup) lookupBuilding(pt);
}

let lookupSeq = 0;
async function lookupBuilding(pt) {
  const seq = ++lookupSeq;
  const status = $("#lookup");
  const nearby = groups().map((g) => ({ g, d: metersBetween(g, pt) })).sort((a, b) => a.d - b.d)[0];
  if (status) status.textContent = "Finding the building…";
  let found = null;
  try {
    const q = `[out:json][timeout:5];is_in(${pt.lat.toFixed(6)},${pt.lng.toFixed(6)})->.a;(way(pivot.a)[building];relation(pivot.a)[building];);out tags;`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q), { signal: ctrl.signal });
    clearTimeout(timer);
    const json = await res.json();
    const el = json.elements.find((e) => e.tags?.name) || json.elements[0];
    if (el) found = { name: el.tags?.name || "", levels: parseInt(el.tags?.["building:levels"], 10) || null };
  } catch { /* lookup is a convenience; the field stays editable */ }
  if (seq !== lookupSeq || state.view !== "form") return;
  let name = found?.name || "";
  if (!name && nearby && nearby.d < 35) name = nearby.g.name;
  state.draft.levels = found?.levels || null;
  const input = $("#f-building");
  if (input && (!input.value.trim() || state.draft.buildingAuto)) {
    input.value = name;
    state.draft.building = name;
    state.draft.buildingAuto = !!name;
  }
  if (status) status.textContent = name ? `Looks like ${name}${found?.levels ? ` (${found.levels} floors)` : ""}. Change it if that's wrong.` : "Type the building name. Suggestions appear as you type.";
  fillFloorOptions();
  validateForm();
}

function fillFloorOptions() {
  const sel = $("#f-level");
  if (!sel) return;
  const max = Math.max(state.draft.levels || 14, state.draft.level || 1);
  sel.replaceChildren();
  for (let l = max; l >= -2; l--) if (l !== 0) sel.append(h("option", { value: String(l), text: l === 1 ? "1st floor (street level)" : floorName(l) }));
  sel.value = String(state.draft.level);
}

function renderFormView() {
  const d = state.draft;
  const editing = !!d.id;
  const opts = h("datalist", { id: "bldg-list" },
    [...new Set([...groups().map((g) => g.name), ...NEU_BUILDINGS])].sort().map((n) => h("option", { value: n })));
  const form = h("form", { class: "stackform", id: "mw-form", novalidate: true });
  form.append(
    h("h2", { text: editing ? "Edit microwave" : "Add a microwave" }),
    h("div", { class: "step", id: "step-place" }),
    h("label", { for: "f-building", text: "Building" }),
    h("input", { id: "f-building", type: "text", list: "bldg-list", maxlength: "80", autocomplete: "off", placeholder: "e.g. Curry Student Center", value: d.building }),
    h("p", { class: "lookup", id: "lookup" }),
    opts,
    h("div", { class: "field-row" },
      h("div", {}, h("label", { for: "f-level", text: "Floor" }), h("select", { id: "f-level" })),
      h("div", {}, h("label", { for: "f-count", text: "How many" }), h("input", { id: "f-count", type: "number", min: "1", max: "30", step: "1", inputmode: "numeric", value: String(d.count) }))),
    h("label", { for: "f-spot", text: "Where exactly?" }),
    h("textarea", { id: "f-spot", maxlength: "200", rows: "2", placeholder: "e.g. Food court, next to the napkin station" }),
    h("label", { for: "f-notes" }, "Tips ", h("span", { class: "muted", text: "(optional)" })),
    h("textarea", { id: "f-notes", maxlength: "300", rows: "2", placeholder: "e.g. Line at noon. Open until 10pm." }),
    h("p", { class: "form-error", id: "form-error", hidden: true }),
    h("div", { class: "form-actions" },
      h("button", { class: "ghost-btn", type: "button", text: "Cancel", onclick: () => cancelForm() }),
      h("button", { class: "primary-btn", type: "submit", id: "f-save", text: editing ? "Save changes" : "Add microwave" })),
  );
  panelBody.append(form);
  $("#f-spot").value = d.spot;
  $("#f-notes").value = d.notes;
  fillFloorOptions();
  updateFormStep();
  form.addEventListener("input", (e) => {
    if (e.target.id === "f-building") { d.building = e.target.value; d.buildingAuto = false; }
    if (e.target.id === "f-spot") d.spot = e.target.value;
    if (e.target.id === "f-notes") d.notes = e.target.value;
    if (e.target.id === "f-count") d.count = parseInt(e.target.value, 10) || 1;
    validateForm();
  });
  form.addEventListener("change", (e) => { if (e.target.id === "f-level") d.level = parseInt(e.target.value, 10); });
  form.addEventListener("submit", (e) => { e.preventDefault(); saveForm(); });
  validateForm();
}

function updateFormStep() {
  const step = $("#step-place");
  if (!step) return;
  const placed = state.draft?.lat != null;
  step.classList.toggle("done", placed);
  step.replaceChildren(placed
    ? h("span", {}, h("b", { text: "Pin placed. " }), "Drag it to fine-tune, or ", h("button", { type: "button", class: "link-btn", text: "tap a new spot", onclick: () => setPlacing(true) }), ".")
    : h("span", {}, h("b", { text: "Step 1: " }), "tap the building on the map."));
  validateForm();
}

function validateForm() {
  const btn = $("#f-save");
  if (!btn) return;
  const d = state.draft;
  btn.disabled = !(d.lat != null && d.building.trim().length >= 2 && d.spot.trim().length >= 2);
}

async function saveForm() {
  const d = state.draft;
  const err = $("#form-error");
  const data = {
    building: d.building.trim().replace(/\s+/g, " ").slice(0, 80),
    level: d.level,
    spot: d.spot.trim().slice(0, 200),
    count: Math.min(30, Math.max(1, d.count | 0)),
    notes: d.notes.trim().slice(0, 300),
    lat: +d.lat.toFixed(7),
    lng: +d.lng.toFixed(7),
  };
  // Snap the building name to an existing one with the same spelling, so pins group together.
  const match = groups().find((g) => g.key === keyOf(data.building));
  if (match) data.building = match.name;
  $("#f-save").disabled = true;
  try {
    if (d.id) await state.store.update(d.id, data); else await state.store.add(data);
    removeDraft();
    toast(d.id ? "Saved." : "Added. Thanks!");
    const added = d.id ? state.items.find((i) => i.id === d.id) : null;
    openBuilding(keyOf(data.building), { selectedId: added?.id ?? null });
    flyTo(data.lng, data.lat);
  } catch (e) {
    err.textContent = errorText(e);
    err.hidden = false;
    $("#f-save").disabled = false;
  }
}

function removeDraft() {
  draftMarker?.remove();
  state.draft = null;
  setPlacing(false);
  $("#add-btn").hidden = false;
}
function cancelForm() {
  const back = state.draft?.id ? keyOf(state.items.find((i) => i.id === state.draft.id)?.building) : null;
  removeDraft();
  if (back) openBuilding(back); else setView("list");
}

async function castVote(it, value) {
  if (!state.user) { state.pendingAfterAuth = () => castVote(it, value); return openAuth(); }
  if (!canPost()) { showBanner(); return toast("Verify your email first. The link is in your Northeastern inbox."); }
  try { await state.store.vote(it.id, value); } catch (e) { toast(errorText(e)); }
}

/* ---------------- auth ---------------- */
const dlg = $("#auth-dialog");
let authMode = "signin";
function setAuthMode(mode) {
  authMode = mode;
  $("#tab-signin").setAttribute("aria-selected", String(mode === "signin"));
  $("#tab-signup").setAttribute("aria-selected", String(mode === "signup"));
  $("#auth-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
  $("#auth-title").textContent = mode === "signin" ? "Sign in to add microwaves" : "Make an account";
  $("#pw-hint").hidden = mode === "signin";
  $("#auth-forgot").hidden = mode !== "signin";
  $("#auth-password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  authMsg();
}
function authMsg(error = "", info = "") {
  $("#auth-error").textContent = error; $("#auth-error").hidden = !error;
  $("#auth-info").textContent = info; $("#auth-info").hidden = !info;
}
function openAuth() { setAuthMode(authMode); dlg.showModal(); $("#auth-email").focus(); }
$("#tab-signin").addEventListener("click", () => setAuthMode("signin"));
$("#tab-signup").addEventListener("click", () => setAuthMode("signup"));
$("#auth-close").addEventListener("click", () => { state.pendingAfterAuth = null; dlg.close(); });
$("#auth-forgot").addEventListener("click", async () => {
  const email = $("#auth-email").value.trim();
  if (!domainOk(email)) return authMsg("Type your Northeastern email above first.");
  try { await state.store.resetPassword(email); authMsg("", "If that account exists, a reset link is on its way. Check Junk too."); }
  catch (e) { authMsg(errorText(e)); }
});
$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim(), pw = $("#auth-password").value;
  if (!domainOk(email)) return authMsg(`Use your ${allowedDomains.map((d) => "@" + d).join(" or ")} email.`);
  if (authMode === "signup" && pw.length < 8) return authMsg("Use at least 8 characters for your password.");
  $("#auth-submit").disabled = true;
  try {
    if (authMode === "signin") await state.store.signIn(email, pw);
    else await state.store.signUp(email, pw);
    dlg.close();
    $("#auth-password").value = "";
    if (authMode === "signup" && !state.store.preview) toast("Account made. Open the link we emailed you (check Junk), then come back.", 8000);
    const next = state.pendingAfterAuth; state.pendingAfterAuth = null;
    if (next && canPost()) next();
  } catch (err) { authMsg(errorText(err)); }
  finally { $("#auth-submit").disabled = false; }
});

const acct = $("#account-btn");
let acctMenu = null;
acct.addEventListener("click", () => {
  if (!state.user) return openAuth();
  if (acctMenu) { acctMenu.remove(); acctMenu = null; return; }
  acctMenu = h("div", { class: "banner", style: "position:fixed;right:12px;top:calc(env(safe-area-inset-top,0px) + 60px);z-index:7;margin:0;background:var(--surface);box-shadow:var(--shadow);max-width:calc(100vw - 24px)" },
    h("span", { text: `Signed in as ${state.user.email}` }),
    h("button", { type: "button", text: "Sign out", onclick: async () => { acctMenu.remove(); acctMenu = null; await state.store.signOut(); toast("Signed out."); } }));
  document.body.append(acctMenu);
});

function showBanner() {
  const b = $("#banner");
  b.replaceChildren();
  if (state.store?.preview) {
    b.append(h("span", { text: "Preview mode: pins are saved only in this browser until Firebase is connected in config.js." }));
  } else if (state.user && !state.user.emailVerified) {
    b.append(
      h("span", { text: `Check ${state.user.email} for a verification link (look in Junk too).` }),
      h("button", { type: "button", text: "I've verified", onclick: async () => {
        const u = await state.store.refreshUser();
        state.user = u; renderAccount();
        toast(u?.emailVerified ? "Verified. You can add microwaves now." : "Not verified yet. Open the link in the email first.");
      } }),
      h("button", { type: "button", text: "Resend email", onclick: async () => {
        try { await state.store.resendVerification(); toast("Sent again."); } catch (e) { toast(errorText(e)); }
      } }));
  }
  b.hidden = !b.childNodes.length;
}

function renderAccount() {
  acct.textContent = state.user ? state.user.email.split("@")[0] : "Sign in";
  acct.title = state.user ? `Signed in as ${state.user.email}` : "Sign in with your Northeastern email";
  showBanner();
  if (state.view === "building") renderPanel();
}

function errorText(e) {
  const code = e?.code || "";
  const msgs = {
    "auth/invalid-credential": "That email and password don't match. Try again or reset your password.",
    "auth/wrong-password": "That email and password don't match. Try again or reset your password.",
    "auth/user-not-found": "No account with that email yet. Switch to “I'm new”.",
    "auth/email-already-in-use": "That email already has an account. Switch to “I have an account”.",
    "auth/weak-password": "Use at least 8 characters for your password.",
    "auth/invalid-email": "That doesn't look like an email address.",
    "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
    "auth/network-request-failed": "No connection. Check your Wi-Fi and try again.",
    "permission-denied": "The database refused that. Make sure your email is verified, then try again.",
    "unavailable": "Can't reach the database right now. Try again in a moment.",
  };
  return msgs[code] || e?.message || "Something went wrong. Try again.";
}

/* ---------------- chrome ---------------- */
let toastEl = null, toastTimer = null;
function toast(msg, ms = 3500) {
  if (!toastEl) {
    toastEl = h("div", { role: "status", style: "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 24px);z-index:20;background:var(--fg);color:var(--surface);padding:10px 16px;border-radius:12px;font-weight:700;box-shadow:var(--shadow);max-width:calc(100vw - 32px);text-align:center" });
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

function expandSheet() { panel.classList.remove("collapsed"); }
$("#sheet-handle").addEventListener("click", () => panel.classList.toggle("collapsed"));
$("#add-btn").addEventListener("click", () => startAdd());
const t3d = $("#toggle-3d");
t3d.addEventListener("click", () => {
  state.is3D = !state.is3D;
  t3d.setAttribute("aria-pressed", String(state.is3D));
  t3d.textContent = state.is3D ? "3D" : "2D";
  map.easeTo({ pitch: state.is3D ? 60 : 0, duration: 600 });
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.placing) cancelForm();
});
function applyPadding() { map.setPadding(mapPadding()); }
addEventListener("resize", applyPadding);
map.jumpTo({ ...HOME, zoom: isPhone() ? 15.4 : HOME.zoom, padding: mapPadding() });
$("#home-btn")?.addEventListener("click", () => map.flyTo({ ...HOME, zoom: isPhone() ? 15.4 : HOME.zoom, pitch: state.is3D ? HOME.pitch : 0, padding: mapPadding() }));

/* ---------------- boot ---------------- */
renderPanel();
(async () => {
  try {
    state.store = await createStore();
  } catch (e) {
    console.error(e);
    toast("Couldn't load the database. Refresh to try again.", 8000);
    return;
  }
  showBanner();
  state.store.onAuth((u) => {
    state.user = u;
    renderAccount();
    if (u && state.pendingAfterAuth && canPost()) { const next = state.pendingAfterAuth; state.pendingAfterAuth = null; next(); }
  });
  state.store.subscribe((items) => {
    state.items = items.filter((i) => typeof i.lat === "number" && typeof i.lng === "number" && i.building);
    updateMapData();
    updateMarkers();
    if (state.view === "list") renderList();
    else if (state.view === "building") renderBuildingView0();
    updateSlab();
  }, (e) => toast(errorText(e), 6000));
})();

// Re-render the building view without jumping the scroll position.
function renderBuildingView0() {
  const top = panelBody.scrollTop;
  panelBody.replaceChildren();
  renderBuildingView();
  panelBody.scrollTop = top;
}
