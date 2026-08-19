// Assistent: Revier einrichten und Stände einlesen.
//
// Bis zum letzten Schritt wird nichts geschrieben. Alles davor ist reiner
// Zustand im Browser, gespiegelt in localStorage — 47 Stände zu benennen
// dauert eine Stunde, und ein Anruf darf die nicht kosten.

import {
  readTextFile, parseGpx, parseTable, sniffColumns, looksLikeHeader,
  parseLatLng, parsePair, looksSwapped, normaliseStand, validateBatch,
  suggestClusters, distanceMetres,
} from "./geo-import.js";

const cfg = window.PEENWERDER_CONFIG || {};
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const DRAFT = "preye.revier-draft.v1";

const state = {
  step: 1,
  mode: "existing",
  revier: null,          // key des Zielreviers
  neu: null,             // { name, key, short, prefix, areas[] } bei mode=new
  sources: [],           // { file, count, note }
  rows: [],              // die Punkte, mit Status
  existing: [],          // vorhandene Stände des Reviers
  filter: null,
  swapped: false,
  written: {},           // srcId → id, für den Wiederaufnahme-Fall
};

let map = null, markers = new Map(), infoLine = null;

// ---------------------------------------------------------------------------
// Gerüst
// ---------------------------------------------------------------------------

function showStep(n) {
  state.step = n;
  document.querySelectorAll(".rn-step").forEach((s) => {
    s.hidden = Number(s.dataset.step) !== n;
  });
  document.querySelectorAll(".rn-rail li").forEach((li) => {
    const k = Number(li.dataset.step);
    li.classList.toggle("now", k === n);
    li.classList.toggle("done", k < n);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (n === 3) renderPreview();
  if (n === 4) renderConfirm();
  saveDraft();
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT, JSON.stringify({
      at: Date.now(), step: state.step, mode: state.mode,
      revier: state.revier, neu: state.neu, written: state.written,
      sources: state.sources.map((s) => ({ name: s.name, count: s.count })),
      rows: state.rows.map((r) => ({
        src: r.src, sourceLabel: r.sourceLabel, name: r.name, nr: r.nr,
        type: r.type, area: r.area, lat: r.lat, lng: r.lng, take: r.take,
        group: r.group, note: r.note,
      })),
    }));
  } catch (err) { /* privater Modus */ }
}

function clearDraft() { try { localStorage.removeItem(DRAFT); } catch (err) {} }

// ---------------------------------------------------------------------------
// Schritt 1 — Revier
// ---------------------------------------------------------------------------

function fillRevierSelect() {
  const sel = $("#rn-revier");
  sel.innerHTML = window.PREYE_REVIERE
    .map((r) => `<option value="${esc(r.key)}">${esc(r.name)}</option>`).join("");
  const wanted = new URLSearchParams(location.search).get("revier");
  if (wanted && window.preyeRevierByKey(wanted)) sel.value = wanted;
  state.revier = sel.value;
  updateRevierHint();
}

function updateRevierHint() {
  const r = window.preyeRevierByKey(state.revier);
  $("#rn-revier-hint").textContent = r
    ? `${r.areas.length} Teilgebiete: ${r.areas.join(", ")}`
    : "";
}

function slug(s) {
  return String(s).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

function wireStep1() {
  document.querySelectorAll('input[name="rn-mode"]').forEach((el) => {
    el.addEventListener("change", () => {
      state.mode = el.value;
      $("#rn-existing").hidden = state.mode !== "existing";
      $("#rn-new").hidden = state.mode !== "new";
    });
  });
  $("#rn-revier").addEventListener("change", (e) => {
    state.revier = e.target.value; updateRevierHint();
  });

  const name = $("#rn-name"), key = $("#rn-key"), short = $("#rn-short"), prefix = $("#rn-prefix");
  name.addEventListener("input", () => {
    if (!key.dataset.touched) key.value = slug(name.value);
    if (!short.dataset.touched) short.value = name.value;
    if (!prefix.dataset.touched) {
      prefix.value = name.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    }
    echoKey();
  });
  [key, short, prefix].forEach((el) =>
    el.addEventListener("input", () => { el.dataset.touched = "1"; echoKey(); }));
  function echoKey() {
    $("#rn-url").textContent = "preye.org/karte.html?revier=" + (key.value || "…");
    $("#rn-idex").textContent = (prefix.value || "XX") + "-…";
  }

  $("#rn-to-2").addEventListener("click", async () => {
    const msg = $("#rn-msg-1");
    msg.textContent = "";
    if (state.mode === "existing") {
      if (!state.revier) { msg.textContent = "Bitte ein Revier wählen."; return; }
      state.neu = null;
      await loadExistingPosts();
      showStep(2);
      return;
    }
    // Neues Revier: gleich anlegen, damit die Teilgebiete für Schritt 3 da
    // sind. Die Prüfung macht das Backend — dieselbe Funktion wie das
    // Formular im Sheet, damit es nicht zwei Regelwerke gibt.
    const body = {
      action: "revier-create",
      name: name.value.trim(), key: key.value.trim(),
      short: short.value.trim(), prefix: prefix.value.trim(),
      areas: $("#rn-areas").value,
    };
    msg.textContent = "wird angelegt …";
    try {
      const r = await postJson(body);
      if (r.error) { msg.textContent = r.error; return; }
      state.revier = r.key;
      state.neu = { key: r.key, name: r.name, areas: r.areas };
      // Liste neu holen, damit das frische Revier in den Auswahlfeldern steht.
      const list = await getJson("reviere");
      if (list && list.reviere) window.preyeApplyReviere(list.reviere);
      msg.textContent = "";
      await loadExistingPosts();
      showStep(2);
    } catch (err) {
      msg.textContent = "Fehler: " + err.message;
    }
  });
}

async function loadExistingPosts() {
  try {
    const d = await getJson("bootstrap", { revier: state.revier });
    state.existing = (d && d.posts) || [];
    if (d && d.reviere) window.preyeApplyReviere(d.reviere);
  } catch (err) { state.existing = []; }
}

// ---------------------------------------------------------------------------
// Schritt 2 — Daten einlesen
// ---------------------------------------------------------------------------

function wireStep2() {
  const drop = $("#rn-drop"), input = $("#rn-file");
  $("#rn-pick").addEventListener("click", () => input.click());
  input.addEventListener("change", () => handleFiles(input.files));
  ["dragenter", "dragover"].forEach((e) =>
    drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((e) =>
    drop.addEventListener(e, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (ev) => { ev.preventDefault(); handleFiles(ev.dataTransfer.files); });

  $("#rn-paste-go").addEventListener("click", () => {
    const text = $("#rn-paste").value;
    if (!text.trim()) return;
    addRows(readTable(text), "Eingefügt", text.split(/\r?\n/).length);
    $("#rn-paste").value = "";
  });

  $("#rn-to-3").addEventListener("click", () => showStep(3));
}

async function handleFiles(files) {
  const msg = $("#rn-msg-2");
  msg.textContent = "";
  for (const f of Array.from(files || [])) {
    try {
      const text = await readTextFile(f);
      if (/\.gpx$/i.test(f.name) || /<gpx[\s>]/i.test(text.slice(0, 400))) {
        const g = parseGpx(text);
        const note = [];
        if (g.skipped.trackPoints) {
          note.push(`${g.skipped.tracks} ${g.skipped.tracks === 1 ? "Track" : "Tracks"} mit ` +
            `${g.skipped.trackPoints.toLocaleString("de-DE")} Punkten — nicht importiert`);
        }
        if (g.skipped.routePoints) {
          note.push(`${g.skipped.routePoints} ${g.skipped.routePoints === 1 ? "Routenpunkt" : "Routenpunkte"} übergangen`);
        }
        addRows(g.points.map(normaliseStand), f.name, g.points.length, note.join(" · "), g.track);
      } else if (/\.(xlsx|xls)$/i.test(f.name)) {
        msg.textContent = "Excel-Dateien kann diese Seite nicht lesen. " +
          "In Excel: Datei → Speichern unter → „CSV UTF-8“ — oder die Zellen kopieren und unten einfügen.";
      } else {
        addRows(readTable(text), f.name, 0);
      }
    } catch (err) {
      msg.textContent = f.name + ": " + err.message;
    }
  }
  renderSources();
}

// Tabelle einlesen und in Punkte übersetzen.
function readTable(text) {
  const { rows } = parseTable(text);
  if (!rows.length) throw new Error("Die Tabelle ist leer.");
  const hasHeader = looksLikeHeader(rows[0]);
  const cols = hasHeader ? sniffColumns(rows[0]) : { name: 1, area: 2, lat: 3, lng: 4, type: 0 };
  const data = hasHeader ? rows.slice(1) : rows;
  if (cols.name == null || (cols.lat == null && cols.pair == null)) {
    throw new Error("Es fehlen Spalten. Erwartet werden mindestens Bezeichnung, Breite und Länge.");
  }
  return data.map((row, i) => {
    let lat = null, lng = null;
    if (cols.pair != null) {
      const p = parsePair(row[cols.pair]);
      if (p) { lat = p.lat; lng = p.lng; }
    } else {
      lat = parseLatLng(row[cols.lat]);
      lng = parseLatLng(row[cols.lng]);
    }
    return normaliseStand({
      src: "csv:" + (row[cols.name] || i),
      label: String(row[cols.name] || "").trim(),
      group: cols.area != null ? String(row[cols.area] || "").trim() : "",
      sym: cols.type != null ? String(row[cols.type] || "").trim() : "",
      note: "",
      lat, lng,
    });
  });
}

function addRows(points, sourceName, count, note, track) {
  // Vertauschte Spalten erkennen und melden, nicht stillschweigend drehen.
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const swapped = valid.length && valid.every((p) => looksSwapped(p.lat, p.lng));
  if (swapped) {
    points.forEach((p) => { const t = p.lat; p.lat = p.lng; p.lng = t; });
    state.swapped = true;
  }
  const areas = currentAreas();
  points.forEach((p, i) => {
    p.src = p.src + "#" + sourceName + i;
    // Ein Teilgebiet aus der Datei gewinnt, wenn es eins von unseren ist.
    const hit = areas.find((a) => a.toLowerCase() === String(p.group || "").toLowerCase());
    p.area = hit || (areas.length === 1 ? areas[0] : "");
  });
  state.rows = state.rows.concat(points);
  state.sources.push({
    name: sourceName, count: points.length,
    note: [note, swapped ? "Breite und Länge waren vertauscht, automatisch getauscht" : ""]
      .filter(Boolean).join(" · "),
    track: track || null,
  });
  $("#rn-to-3").disabled = state.rows.length === 0;
  renderSources();
  saveDraft();
}

function currentAreas() {
  const r = window.preyeRevierByKey(state.revier);
  return r ? r.areas.slice() : [];
}

function renderSources() {
  $("#rn-sources").innerHTML = state.sources.map((s, i) => `
    <li>
      <b>${esc(s.name)}</b>
      <span class="rn-hint">${s.count} Punkte${s.note ? " · " + esc(s.note) : ""}</span>
      <button class="rn-ghost small" data-rm="${i}">entfernen</button>
    </li>`).join("");
  $("#rn-sources").querySelectorAll("[data-rm]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.rm);
      const name = state.sources[i].name;
      state.rows = state.rows.filter((r) => !String(r.src).includes("#" + name));
      state.sources.splice(i, 1);
      $("#rn-to-3").disabled = state.rows.length === 0;
      renderSources(); saveDraft();
    }));
}

// ---------------------------------------------------------------------------
// Schritt 3 — Vorschau
// ---------------------------------------------------------------------------

function validate() {
  const checked = validateBatch(state.rows, state.existing);
  // Vom Menschen getroffene Entscheidungen überleben eine neue Prüfung.
  checked.forEach((c) => {
    const prev = state.rows.find((r) => r.src === c.src);
    if (prev && prev.userTake != null) c.take = prev.userTake;
    if (prev) c.userTake = prev.userTake;
  });
  state.rows = checked;
  return checked;
}

async function renderPreview() {
  validate();
  fillAreaSelects();
  renderSummary();
  renderRows();
  await ensureMap();
  drawMarkers();
}

function renderSummary() {
  const n = state.rows.length;
  const take = state.rows.filter((r) => r.take).length;
  const err = state.rows.filter((r) => r.status === "error").length;
  const konflikt = state.rows.filter((r) => r.matched).length;
  const ohne = state.rows.filter((r) => !r.area).length;
  const keine = state.rows.filter((r) => r.kind === "kein-stand").length;
  const unsicher = state.rows.filter((r) => r.kind === "unsicher").length;
  const skipped = state.sources.map((s) => s.note).filter(Boolean);

  const btn = (key, label, cls) =>
    `<button data-filter="${key}" class="${cls || ""}${state.filter === key ? " on" : ""}">${label}</button>`;
  $("#rn-summary").innerHTML =
    btn("", `${n} gelesen`) +
    btn("take", `${take} übernehmen`) +
    (konflikt ? btn("konflikt", `${konflikt} Konflikt`, "warn") : "") +
    (err ? btn("error", `${err} Fehler`, "warn") : "") +
    (ohne ? btn("ohne", `${ohne} ohne Teilgebiet`, "warn") : "") +
    (unsicher ? btn("unsicher", `${unsicher} unsicher`, "warn") : "") +
    (keine ? btn("keine", `${keine} kein Stand`) : "") +
    (skipped.length ? `<button disabled>${esc(skipped.join(" · "))}</button>` : "");
  $("#rn-summary").querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      state.filter = b.dataset.filter || null;
      renderSummary(); renderRows();
    }));
}

function visibleRows() {
  const f = state.filter;
  if (!f) return state.rows;
  if (f === "take") return state.rows.filter((r) => r.take);
  if (f === "error") return state.rows.filter((r) => r.status === "error");
  if (f === "konflikt") return state.rows.filter((r) => r.matched);
  if (f === "ohne") return state.rows.filter((r) => !r.area);
  if (f === "unsicher") return state.rows.filter((r) => r.kind === "unsicher");
  if (f === "keine") return state.rows.filter((r) => r.kind === "kein-stand");
  return state.rows;
}

function fillAreaSelects() {
  const areas = currentAreas();
  const opts = ['<option value="">— wählen —</option>']
    .concat(areas.map((a) => `<option>${esc(a)}</option>`)).join("");
  $("#rn-bulk-area").innerHTML = opts;
}

function renderRows() {
  const areas = currentAreas();
  const areaOpts = (sel) => ['<option value="">—</option>']
    .concat(areas.map((a) => `<option${a === sel ? " selected" : ""}>${esc(a)}</option>`)).join("");
  const typeOpts = (sel) => ["Kanzel", "Drückjagdbock", "Leiter"]
    .map((t) => `<option${t === sel ? " selected" : ""}>${esc(t)}</option>`).join("");

  $("#rn-rows").innerHTML = visibleRows().map((r) => `
    <tr data-src="${esc(r.src)}" class="${r.take ? "" : "off"}${r.status === "error" ? " err" : ""}">
      <td><input type="checkbox" data-take ${r.take ? "checked" : ""} ${r.status === "error" ? "disabled" : ""} /></td>
      <td class="src" title="${esc(r.sourceLabel)}">${esc(r.sourceLabel || "—")}</td>
      <td><input type="text" data-name value="${esc(r.name)}" maxlength="60" />
        ${r.messages.length ? `<span class="msg">${esc(r.messages.map((m) => m.text).join(" · "))}</span>` : ""}</td>
      <td class="nr"><input type="text" data-nr value="${esc(r.nr || "")}" maxlength="5" /></td>
      <td><select data-type>${typeOpts(r.type)}</select></td>
      <td><select data-area>${areaOpts(r.area)}</select></td>
      <td class="pos">${r.lat.toFixed(5)}<br />${r.lng.toFixed(5)}</td>
    </tr>`).join("");

  const tbody = $("#rn-rows");
  tbody.querySelectorAll("tr").forEach((tr) => {
    const row = state.rows.find((r) => r.src === tr.dataset.src);
    if (!row) return;
    tr.querySelector("[data-take]").addEventListener("change", (e) => {
      row.take = e.target.checked; row.userTake = e.target.checked;
      tr.classList.toggle("off", !row.take);
      renderSummary(); drawMarkers(); saveDraft();
    });
    tr.querySelector("[data-name]").addEventListener("input", (e) => { row.name = e.target.value; saveDraft(); });
    tr.querySelector("[data-nr]").addEventListener("input", (e) => { row.nr = e.target.value.toUpperCase(); saveDraft(); });
    tr.querySelector("[data-type]").addEventListener("change", (e) => { row.type = e.target.value; saveDraft(); });
    tr.querySelector("[data-area]").addEventListener("change", (e) => {
      row.area = e.target.value; validate(); renderSummary(); drawMarkers(); saveDraft();
    });
    tr.addEventListener("click", () => focusRow(row.src, true));
  });
}

function focusRow(src, fromTable) {
  document.querySelectorAll("#rn-rows tr").forEach((tr) =>
    tr.classList.toggle("sel", tr.dataset.src === src));
  const m = markers.get(src);
  if (m && map) {
    if (fromTable) map.panTo(m.getPosition());
    else {
      const tr = document.querySelector(`#rn-rows tr[data-src="${CSS.escape(src)}"]`);
      if (tr) tr.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
}

// ---------------------------------------------------------------------------
// Karte
// ---------------------------------------------------------------------------

function loadMaps(key) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    const s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&v=weekly";
    s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Google Maps konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
}

async function ensureMap() {
  if (map) return;
  if (!cfg.GOOGLE_MAPS_API_KEY || cfg.GOOGLE_MAPS_API_KEY.startsWith("PASTE")) return;
  try { await loadMaps(cfg.GOOGLE_MAPS_API_KEY); } catch (err) { return; }
  map = new google.maps.Map($("#rn-map"), {
    center: { lat: 51.2, lng: 10.4 }, zoom: 6, mapTypeId: "hybrid",
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    gestureHandling: "greedy",
  });
  infoLine = new google.maps.InfoWindow();
}

function drawMarkers() {
  if (!map) return;
  markers.forEach((m) => m.setMap(null));
  markers.clear();

  // Vorhandene Stände als hohle Ringe im Hintergrund — ohne sie sieht man
  // nicht, ob der Import neben oder auf das Bestehende fällt.
  for (const p of state.existing) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng }, map, title: p.name, clickable: false, zIndex: 1,
      icon: { path: google.maps.SymbolPath.CIRCLE, fillOpacity: 0, strokeColor: "#fff",
              strokeWeight: 2, scale: 4 },
    });
  }

  const bounds = new google.maps.LatLngBounds();
  let any = false;
  for (const r of state.rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const color = !r.take ? "#c9d0d6" : r.matched ? "#ff5722" : r.status === "error" ? "#ff5722" : "#2fa35f";
    const m = new google.maps.Marker({
      position: { lat: r.lat, lng: r.lng }, map, title: r.name, zIndex: 5,
      draggable: true,
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 0.9,
              strokeColor: "#fff", strokeWeight: 1.5, scale: 5 },
    });
    m.addListener("click", () => focusRow(r.src, false));
    m.addListener("dragend", (ev) => {
      if (r.lat0 == null) { r.lat0 = r.lat; r.lng0 = r.lng; }
      r.lat = ev.latLng.lat(); r.lng = ev.latLng.lng();
      validate(); renderSummary(); renderRows(); drawMarkers(); saveDraft();
    });
    markers.set(r.src, m);
    bounds.extend(m.getPosition()); any = true;
  }
  if (any && !map.__fitted) { map.fitBounds(bounds, 40); map.__fitted = true; }
}

function wireStep3() {
  $("#rn-bulk-area").addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) return;
    visibleRows().forEach((r) => { r.area = v; });
    validate(); renderSummary(); renderRows(); drawMarkers(); saveDraft();
    e.target.value = "";
  });
  $("#rn-none").addEventListener("click", () => {
    visibleRows().forEach((r) => { r.take = false; r.userTake = false; });
    renderSummary(); renderRows(); drawMarkers(); saveDraft();
  });
  $("#rn-all").addEventListener("click", () => {
    visibleRows().forEach((r) => { if (r.status !== "error") { r.take = true; r.userTake = true; } });
    renderSummary(); renderRows(); drawMarkers(); saveDraft();
  });
  $("#rn-suggest").addEventListener("click", () => {
    const groups = suggestClusters(state.rows.filter((r) => r.take), 600);
    const areas = currentAreas();
    if (!groups.length) return;
    const msg = groups.map((g, i) => `Gruppe ${i + 1}: ${g.length} Stände`).join("\n");
    const text = prompt(
      "Nach Nachbarschaft gefunden:\n\n" + msg +
      "\n\nNamen eingeben, einer pro Gruppe, durch Komma getrennt.\n" +
      "Vorhandene Teilgebiete: " + (areas.join(", ") || "—"),
      areas.slice(0, groups.length).join(", ")
    );
    if (!text) return;
    const names = text.split(/\s*,\s*/);
    groups.forEach((g, i) => {
      const n = names[i];
      if (!n) return;
      g.forEach((p) => {
        const row = state.rows.find((r) => r.src === p.src);
        if (row) row.area = n;
      });
    });
    validate(); renderSummary(); renderRows(); drawMarkers(); saveDraft();
  });
  $("#rn-to-4").addEventListener("click", () => showStep(4));
  document.querySelectorAll("[data-back]").forEach((b) =>
    b.addEventListener("click", () => showStep(Number(b.dataset.back))));
}

// ---------------------------------------------------------------------------
// Schritt 4 — schreiben
// ---------------------------------------------------------------------------

// Was im Revier steht, aber nicht in der Datei. Wird nur AUFGELISTET, ohne
// jede Handlung: an posts.id hängen Erlegungen, Nachsuchen und Positionen in
// den Ansteller-Runden. Stände verschwinden nicht, auch nicht auf Wunsch.
function missingBlock(take) {
  if (!state.existing.length) return "";
  const near = (p) => take.some((t) => distanceMetres(p, t) <= 25);
  const fehlend = state.existing.filter((p) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && !near(p));
  if (!fehlend.length) return "";
  const liste = fehlend.slice(0, 12).map((p) => esc(p.name)).join(", ");
  return `<details class="rn-missing"><summary class="rn-hint">
      ${fehlend.length} Stände stehen im Revier, aber nicht in dieser Datei
    </summary><p class="rn-hint">${liste}${fehlend.length > 12 ? " …" : ""}<br />
      Sie bleiben unverändert stehen. Stände werden hier nie gelöscht — an ihnen
      hängen Erlegungen, Nachsuchen und die Sitzverteilung alter Jagden.
    </p></details>`;
}

function renderConfirm() {
  const take = state.rows.filter((r) => r.take);
  const byArea = {};
  take.forEach((r) => { byArea[r.area || "—"] = (byArea[r.area || "—"] || 0) + 1; });
  const rest = state.rows.length - take.length;
  const r = window.preyeRevierByKey(state.revier);
  const ohneNr = take.filter((x) => !x.nr).length;
  const ueber80 = take.filter((x) => /^\d+/.test(x.nr || "") && parseInt(x.nr, 10) > 80).length;

  $("#rn-confirm").innerHTML = `
    <h2 style="margin:0 0 6px;font-size:1.15rem">${esc(r ? r.name : state.revier)}</h2>
    <p class="rn-hint">${Object.entries(byArea).map(([a, n]) => `${esc(a)}: ${n}`).join(" · ") || "nichts ausgewählt"}</p>
    ${rest ? `<p class="rn-hint">${rest} Zeilen werden übersprungen.</p>` : ""}
    ${ohneNr ? `<p class="rn-hint">${ohneNr} Stände haben keine Nummer im Namen — auf der Infomail-Karte bekommen sie Buchstaben statt Zahlen.</p>` : ""}
    ${ueber80 ? `<p class="rn-hint">${ueber80} Stände haben Nummern über 80 — für die gibt es noch keinen Kartenstift, auf der Infomail-Karte fehlt dort der Pin.</p>` : ""}
    ${missingBlock(take)}
  `;
  $("#rn-go").textContent = take.length
    ? `${take.length} Stände anlegen`
    : "Nichts ausgewählt";
  $("#rn-go").disabled = !take.length;
}

async function writeAll() {
  const take = state.rows.filter((r) => r.take && !state.written[r.src]);
  const btn = $("#rn-go");
  btn.disabled = true;
  $("#rn-progress").hidden = false;
  const results = [];
  const CHUNK = 25;   // gegen die Zeitgrenze von Apps Script
  let done = 0;

  for (let i = 0; i < take.length; i += CHUNK) {
    const slice = take.slice(i, i + CHUNK);
    try {
      const r = await postJson({
        action: "posts-batch-upsert",
        posts: slice.map((x) => ({
          // Hakt jemand eine als Dublette erkannte Zeile trotzdem an, ist das
          // ein „aktualisieren", kein „noch einmal anlegen". Ohne die ID würde
          // das Backend einen zweiten Stand daneben setzen — und an der alten
          // ID hängen Erlegungen und die Sitzverteilung alter Jagden.
          id: x.matched ? x.matched.post.id : undefined,
          name: x.name, area: x.area, revier: state.revier,
          lat: x.lat, lng: x.lng, type: x.type, nr: x.nr,
        })),
      });
      (r.results || []).forEach((res, k) => {
        results.push({ ...res, row: slice[k] });
        if (res.action !== "error") state.written[slice[k].src] = res.id;
      });
    } catch (err) {
      results.push({ action: "error", error: err.message, row: slice[0] });
      break;
    }
    done += slice.length;
    $("#rn-bar").style.width = Math.round((done / take.length) * 100) + "%";
    $("#rn-progress-text").textContent = `${done} von ${take.length}`;
    saveDraft();
  }

  const ok = results.filter((r) => r.action !== "error");
  const bad = results.filter((r) => r.action === "error");
  $("#rn-result").innerHTML = `
    <p><b>${ok.length} angelegt${bad.length ? `, ${bad.length} nicht` : ""}.</b></p>
    ${bad.length ? `<ul>${bad.map((b) =>
      `<li>${esc((b.row && b.row.name) || "?")}: ${esc(b.error || "unbekannt")}</li>`).join("")}</ul>` : ""}
    ${bad.length
      ? `<div class="rn-actions"><button class="rn-primary" id="rn-retry">Rest anlegen</button></div>`
      : `<div class="rn-actions"><a class="rn-primary" href="karte.html?revier=${encodeURIComponent(state.revier)}"
           style="text-decoration:none;display:inline-block">Revier auf der Karte ansehen</a></div>`}
  `;
  if (bad.length) {
    $("#rn-retry").addEventListener("click", writeAll);
    btn.disabled = false;
  } else {
    clearDraft();
  }
}

// ---------------------------------------------------------------------------
// Netz
// ---------------------------------------------------------------------------

function backendUrl(action, params = {}) {
  const u = new URL(cfg.APPS_SCRIPT_URL);
  u.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v);
  const token = localStorage.getItem("preye.token");
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

async function getJson(action, params) {
  const res = await fetch(backendUrl(action, params));
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function postJson(body) {
  const token = localStorage.getItem("preye.token");
  const res = await fetch(cfg.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },   // hält CORS einfach
    body: JSON.stringify({ ...body, token: token || "" }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const burger = $("#burger"), nav = $("#nav");
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
  });

  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) {
    $("#rn-msg-1").textContent = "Konfiguration fehlt: public/config.js";
    return;
  }
  if (!(await window.PreyeGate.pass())) return;

  try {
    const list = await getJson("reviere");
    if (list && list.reviere) window.preyeApplyReviere(list.reviere);
  } catch (err) { /* Rückfallebene aus reviere-def.js */ }

  fillRevierSelect();
  wireStep1(); wireStep2(); wireStep3();
  $("#rn-go").addEventListener("click", writeAll);
  offerDraft();
  showStep(1);
}

function offerDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DRAFT) || "null"); } catch (err) {}
  if (!d || !d.rows || !d.rows.length) return;
  const when = new Date(d.at).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const box = $("#rn-draft");
  box.hidden = false;
  box.innerHTML = `<span>Am ${esc(when)} angefangen: ${d.rows.length} Punkte für
    <b>${esc(d.revier || "—")}</b>.</span>
    <button class="rn-primary" id="rn-resume">Fortsetzen</button>
    <button class="rn-ghost" id="rn-discard">Verwerfen</button>`;
  $("#rn-resume").addEventListener("click", async () => {
    Object.assign(state, {
      mode: d.mode, revier: d.revier, neu: d.neu, rows: d.rows,
      sources: d.sources || [], written: d.written || {},
    });
    // Wieder aufgenommene Zeilen sind schon einmal entschieden worden.
    state.rows.forEach((r) => { r.userTake = r.take; });
    $("#rn-revier").value = state.revier || "";
    await loadExistingPosts();
    box.hidden = true;
    renderSources();
    $("#rn-to-3").disabled = state.rows.length === 0;
    showStep(d.step >= 3 ? 3 : 2);
  });
  $("#rn-discard").addEventListener("click", () => { clearDraft(); box.hidden = true; });
}

main();
