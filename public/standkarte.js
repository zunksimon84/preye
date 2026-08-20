// PREYE — Digitale Standkarte.
//
// The paper card every Schütze gets handed at the Drückjagd, as a web page:
// times, Freigaben, contacts, his own Stand, plus the Beobachtungsliste to
// fill in from the Kanzel. Everything is read out of the hunt the Jagdleiter
// already created in the Jagdplanungstool (events.html) — no second place to
// maintain the data.
//
// Link form: standkarte.html?event=EVT-…&h=<Name>. Without params the page
// asks for both. The hunt payload and the list entries are cached in
// localStorage, so the card still opens on the Stand without signal.

const cfg = window.PEENWERDER_CONFIG || {};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ROWS = 10; // same ten lines as the printed card

// Wildarten come from the backend (same list the Strecke form uses); this is
// only what we show until the bootstrap call lands.
const SPECIES_FALLBACK = [
  "Rotwild", "Damwild", "Schwarzwild", "Mufflon", "Rehwild",
  "Fuchs", "Dachs", "Waschbär", "Hase", "Wolf", "Sonstiges",
];

const state = {
  blank: false,   // blanko card, not tied to any hunt
  events: [],
  detail: null,   // { event, hunters, squads, freigaben_matrix }
  posts: [],      // Kanzeln from the bootstrap endpoint (for coordinates)
  species: SPECIES_FALLBACK.slice(),
  me: "",
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- Network + offline cache ----------

const CACHE_PREFIX = "preye.stk.cache.";

function backendUrl(action, params = {}) {
  const u = new URL(cfg.APPS_SCRIPT_URL);
  u.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.searchParams.set(k, v);
  }
  const token = localStorage.getItem("preye.token");
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

function cacheKey(action, params) {
  const sorted = Object.keys(params || {}).sort().map((k) => k + "=" + params[k]).join("&");
  return CACHE_PREFIX + action + (sorted ? "?" + sorted : "");
}

function readCache(action, params) {
  try {
    const raw = localStorage.getItem(cacheKey(action, params));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(action, params, data) {
  try { localStorage.setItem(cacheKey(action, params), JSON.stringify(data)); } catch {}
}

// Fetch, but fall back to the last cached copy when the network is gone —
// which is the normal case out in the Revier.
async function fetchJson(action, params = {}) {
  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) {
    throw new Error("Backend nicht konfiguriert");
  }
  try {
    const res = await fetch(backendUrl(action, params));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    writeCache(action, params, data);
    return data;
  } catch (err) {
    const cached = readCache(action, params);
    if (cached) return cached;
    throw err;
  }
}

// ---------- Small helpers ----------

function setState(html, kind) {
  const el = $("#stk-state");
  el.hidden = !html;
  el.className = "stk-state" + (kind ? " stk-state-" + kind : "");
  el.innerHTML = html || "";
}

let toastTimer = null;
function showToast(msg, kind, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = kind === "error" ? "error" : "";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function toRoman(n) {
  const map = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  let rest = n;
  for (const [v, s] of map) { while (rest >= v) { out += s; rest -= v; } }
  return out || String(n);
}

function displayRundeName(name) {
  const s = String(name || "").trim();
  const m = /^(Ansteller Runde)\s+(\d+)\s*$/i.exec(s);
  if (m) return m[1] + " " + toRoman(parseInt(m[2], 10));
  return s || "Ansteller Runde";
}

// tel: links only work with the punctuation stripped.
function telHref(phone) {
  const cleaned = String(phone || "").replace(/[^\d+]/g, "");
  return cleaned ? "tel:" + cleaned : "";
}

function contactLine(label, name, phone) {
  if (!name && !phone) return "";
  const href = telHref(phone);
  const num = phone
    ? (href ? `<a href="${escapeHtml(href)}">${escapeHtml(phone)}</a>` : escapeHtml(phone))
    : "";
  return `<div class="stk-contact">
      <span class="stk-contact-label">${escapeHtml(label)}</span>
      <span class="stk-contact-name">${escapeHtml(name || "")}</span>
      ${num ? `<span class="stk-contact-phone">${num}</span>` : ""}
    </div>`;
}

// Das Revier einer Jagd kommt aus reviere-def.js. Hier stand bis August 2026
// eine dritte Kopie der Müritz-Gebietsliste, neben denen in events.js und
// reviere-def.js.
function huntRevier(ev) {
  return (window.preyeEventRevier || (() => null))(ev);
}

// ---------- Freigaben ----------

// Same compact "AK 0–2" rendering the Infomail PDF uses, so paper and web
// agree. An event with no saved selection means "everything released".
function formatAkSelection(group, checkedIdx) {
  if (!checkedIdx.length) return "";
  const nums = checkedIdx.slice().sort((a, b) => a - b);
  const ranges = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === prev + 1) { prev = nums[i]; continue; }
    ranges.push(start === prev ? String(start) : start + "–" + prev);
    start = nums[i];
    prev = nums[i];
  }
  ranges.push(start === prev ? String(start) : start + "–" + prev);
  return "AK " + ranges.join(", ");
}

function renderFreigaben() {
  const el = $("#stk-freigaben");
  const matrix = state.detail.freigaben_matrix || [];
  const selected = Array.isArray(state.detail.event.freigaben)
    ? new Set(state.detail.event.freigaben)
    : null; // null = not configured = everything released

  const species = matrix.map((sp) => {
    const groups = sp.groups.map((g) => {
      const idx = [];
      g.aks.forEach((ak, i) => {
        const key = sp.id + "." + g.id + "." + ak.id;
        if (!selected || selected.has(key)) idx.push(i);
      });
      if (!idx.length) return null;
      const all = idx.length === g.aks.length;
      return `<li><span class="stk-fg-group">${escapeHtml(g.label)}</span>
        <span class="stk-fg-ak">${all ? "alle AK" : escapeHtml(formatAkSelection(g, idx))}</span></li>`;
    }).filter(Boolean);
    if (!groups.length) {
      return `<div class="stk-fg-species stk-fg-species--none">
        <span class="stk-fg-name">${escapeHtml(sp.label)}</span>
        <span class="stk-fg-closed">nicht freigegeben</span>
      </div>`;
    }
    return `<div class="stk-fg-species">
      <span class="stk-fg-name">${escapeHtml(sp.label)}</span>
      <ul class="stk-fg-list">${groups.join("")}</ul>
    </div>`;
  });

  el.innerHTML =
    (selected ? "" : `<p class="stk-hint">Für diese Jagd ist noch keine Auswahl hinterlegt — es gilt der volle Rahmen. Ansage des Jagdleiters beachten.</p>`) +
    species.join("");
}

// ---------- Mein Stand ----------

function findMyPlacement(name) {
  if (!name) return null;
  for (const sq of state.detail.squads || []) {
    const positions = sq.positions || [];
    for (let i = 0; i < positions.length; i++) {
      if (String(positions[i].hunter || "").trim() === name.trim()) {
        return { squad: sq, pos: positions[i], index: i };
      }
    }
    if (sq.type === "ansteller" && String(sq.ansteller || "").trim() === name.trim()) {
      return { squad: sq, pos: null, index: -1 };
    }
  }
  return null;
}

function postById(id) {
  return state.posts.find((p) => String(p.id) === String(id)) || null;
}

function renderMine() {
  const box = $("#stk-mine");
  const body = $("#stk-mine-body");
  $("#stk-mine-hunter").textContent = state.me || "";
  const placement = findMyPlacement(state.me);

  if (!placement) {
    box.hidden = false;
    body.innerHTML = `<p class="stk-hint">Für Dich ist noch kein Stand eingeteilt. Der Ansteller weist Dir Deinen Platz vor Ort zu.</p>`;
    return;
  }

  const { squad, pos, index } = placement;
  const isAnsteller = squad.type === "ansteller";
  const groupName = isAnsteller ? displayRundeName(squad.name) : (squad.name || "Treibergruppe");
  const rows = [`<div class="stk-mine-row"><span>Gruppe</span><strong>${escapeHtml(groupName)}</strong></div>`];

  if (isAnsteller && squad.ansteller) {
    rows.push(`<div class="stk-mine-row"><span>Ansteller</span><strong>${escapeHtml(squad.ansteller)}</strong></div>`);
  }

  if (pos) {
    const standName = pos.post_name || pos.label || (pos.type === "klettersitz" ? "Klettersitz" : "");
    if (standName) {
      rows.push(`<div class="stk-mine-row"><span>Stand</span><strong>${escapeHtml(standName)}</strong></div>`);
    }
    if (index >= 0 && isAnsteller) {
      rows.push(`<div class="stk-mine-row"><span>Reihenfolge</span><strong>${index === 0 ? "Ansteller" : index + ". Stand der Runde"}</strong></div>`);
    }
    // Der Hund hängt am Menschen, das Mitkommen an der Position — die
    // Einteilung entscheidet, ob er an diesem Tag dabei ist. Steht nur da,
    // wenn das Häkchen gesetzt wurde.
    if (pos.dog) {
      rows.push(`<div class="stk-mine-row"><span>Hund</span><strong>${escapeHtml(pos.dog_label || "dabei")}</strong></div>`);
    }
    const post = pos.post_id ? postById(pos.post_id) : null;
    const lat = pos.lat || (post && post.lat);
    const lng = pos.lng || (post && post.lng);
    if (lat && lng) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      rows.push(`<div class="stk-mine-row stk-mine-nav"><span>Navigation</span>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Route zum Stand öffnen →</a></div>`);
    }
  }

  box.hidden = false;
  body.innerHTML = rows.join("");
  updateWoColumn();
}

// ---------- Beobachtungsliste ----------

function listKey() {
  if (state.blank) return "preye.stk.list.blanko";
  return "preye.stk.list." + (state.detail.event.id || "x") + "." + (state.me || "anon");
}

function readList() {
  try { return JSON.parse(localStorage.getItem(listKey()) || "[]"); } catch { return []; }
}

function saveList() {
  const rows = $$("#stk-tbody tr").map((tr) => ({
    time: $(".stk-in-time", tr).value,
    art: $(".stk-in-art", tr).value,
    sex: (($(".gender-btn.active", tr) || {}).dataset || {}).gender || "",
    count: $(".stk-in-count", tr).value,
    wo: ($(".stk-in-wo", tr) || {}).value || "",
    gesehen: $(".stk-cb-gesehen", tr).checked,
    beschossen: $(".stk-cb-beschossen", tr).checked,
    liegt: $(".stk-cb-liegt", tr).checked,
    nachsuche: $(".stk-cb-nachsuche", tr).checked,
  }));
  try { localStorage.setItem(listKey(), JSON.stringify(rows)); } catch {}
}

// 1–20 and a "20+" bucket for the rare Rotte that nobody counted exactly.
function countOptions(selected) {
  let out = `<option value="">Anzahl</option>`;
  for (let n = 1; n <= 20; n++) {
    out += `<option${String(selected) === String(n) ? " selected" : ""}>${n}</option>`;
  }
  out += `<option${selected === "20+" ? " selected" : ""}>20+</option>`;
  return out;
}

function speciesOptions(selected) {
  return `<option value="">Wildart</option>` + state.species.map((s) =>
    `<option${s === selected ? " selected" : ""}>${escapeHtml(s)}</option>`).join("");
}

// Die Spalte "Wo" bekommt nur, wer keinen festen Stand hat: Treiber laufen
// durch den Trieb, und die Blanko-Karte weiß gar nichts über den Träger. Für
// einen Schützen auf Nr. 14 wäre sie eine leere Spalte, die er neunmal
// übergeht.
function updateWoColumn() {
  const table = document.querySelector(".stk-table");
  if (!table) return;
  const placement = state.blank ? null : findMyPlacement(state.me);
  const mobil = state.blank || (placement && placement.squad.type !== "ansteller");
  table.classList.toggle("stk-table--wo", !!mobil);
}

function renderList() {
  const saved = readList();
  const tbody = $("#stk-tbody");
  let html = "";
  for (let i = 0; i < ROWS; i++) {
    const r = saved[i] || {};
    const n = i + 1;
    html += `<tr>
      <td class="stk-col-nr" data-label="Nr.">${n}</td>
      <td class="stk-col-time" data-label="Uhrzeit"><input type="time" class="stk-in-time" value="${escapeHtml(r.time || "")}" aria-label="Uhrzeit Zeile ${n}" /></td>
      <td class="stk-col-art" data-label="Wildart"><select class="stk-in-art" aria-label="Wildart Zeile ${n}">${speciesOptions(r.art || "")}</select></td>
      <td class="stk-col-sex" data-label="Geschlecht">
        <div class="gender-buttons" role="group" aria-label="Geschlecht Zeile ${n}">
          <button type="button" class="gender-btn${r.sex === "m" ? " active" : ""}" data-gender="m" title="Männlich" aria-label="Männlich" aria-pressed="${r.sex === "m"}">♂</button>
          <button type="button" class="gender-btn${r.sex === "w" ? " active" : ""}" data-gender="w" title="Weiblich" aria-label="Weiblich" aria-pressed="${r.sex === "w"}">♀</button>
          <button type="button" class="gender-btn${r.sex === "x" ? " active" : ""}" data-gender="x" title="Gemischt — Rotte/Rudel aus männlichen und weiblichen Stücken" aria-label="Gemischt" aria-pressed="${r.sex === "x"}">♂♀</button>
        </div>
      </td>
      <td class="stk-col-count" data-label="Anzahl"><select class="stk-in-count" aria-label="Anzahl Zeile ${n}">${countOptions(r.count || "")}</select></td>
      <td class="stk-col-wo" data-label="Wo"><input type="text" class="stk-in-wo" value="${escapeHtml(r.wo || "")}" placeholder="Ort" aria-label="Wo Zeile ${n}" /></td>
      <td data-label="gesehen"><input type="checkbox" class="stk-cb-gesehen"${r.gesehen ? " checked" : ""} aria-label="gesehen Zeile ${n}" /></td>
      <td data-label="beschossen"><input type="checkbox" class="stk-cb-beschossen"${r.beschossen ? " checked" : ""} aria-label="beschossen Zeile ${n}" /></td>
      <td data-label="Stück liegt"><input type="checkbox" class="stk-cb-liegt"${r.liegt ? " checked" : ""} aria-label="Stück liegt Zeile ${n}" /></td>
      <td data-label="Nachsuche"><input type="checkbox" class="stk-cb-nachsuche"${r.nachsuche ? " checked" : ""} aria-label="Nachsuche Zeile ${n}" /></td>
    </tr>`;
  }
  tbody.innerHTML = html;
  updateWoColumn();
}

// The species list only arrives with the bootstrap call, which can land after
// the card is already on screen. Swap the options in without touching what
// the hunter has picked in the meantime.
function refreshSpeciesOptions() {
  $$("#stk-tbody .stk-in-art").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = speciesOptions(current);
    sel.value = current;
  });
}

// Plain-text version of the filled list, for WhatsApp / mail / share sheet.
function buildReport() {
  let head, who;
  if (state.blank) {
    const d = blankData();
    head = "Standkarte " + (d.jagd || "").trim() + (d.datum ? " · " + formatDate(d.datum) : "");
    who = "Schütze: " + (d.name || "—") + (d.stand ? " · Stand: " + d.stand : "");
  } else {
    const ev = state.detail.event;
    const placement = findMyPlacement(state.me);
    const stand = placement && placement.pos
      ? (placement.pos.post_name || placement.pos.label || "Klettersitz")
      : "";
    head = "Standkarte " + (ev.name || "") + " · " + formatDate(ev.date);
    who = "Schütze: " + (state.me || "—") + (stand ? " · Stand: " + stand : "");
  }
  const lines = [head.trim(), who, ""];
  const rows = readList().filter((r) => r &&
    (r.time || r.art || r.sex || r.count || r.wo || r.gesehen || r.beschossen || r.liegt || r.nachsuche));
  if (!rows.length) {
    lines.push("Keine Beobachtungen eingetragen.");
  } else {
    rows.forEach((r, i) => {
      const wild = [
        r.art || "",
        r.sex === "m" ? "♂" : r.sex === "w" ? "♀" : r.sex === "x" ? "⚥ gemischt" : "",
        r.count ? r.count + "×" : "",
      ].filter(Boolean).join(" ");
      const flags = [
        r.gesehen ? "gesehen" : "",
        r.beschossen ? "beschossen" : "",
        r.liegt ? "Stück liegt" : "",
        r.nachsuche ? "NACHSUCHE" : "",
      ].filter(Boolean).join(", ");
      const wo = r.wo ? " @ " + r.wo : "";
      lines.push(`${i + 1}. ${r.time || "--:--"} ${wild}${wo}${flags ? " — " + flags : ""}`.trim());
    });
  }
  return lines.join("\n");
}

// ---------- Card ----------

function renderTimes() {
  const ev = state.detail.event;
  const rows = [];
  const add = (dt, dd) => {
    if (!dd) return;
    rows.push(`<div class="stk-dl-row"><dt>${escapeHtml(dt)}</dt><dd>${dd}</dd></div>`);
  };
  add("Datum", escapeHtml(formatDate(ev.date)));
  if (ev.treffpunkt) {
    const tp = escapeHtml(ev.treffpunkt);
    const link = ev.treffpunkt_lat && ev.treffpunkt_lng
      ? ` <a href="https://www.google.com/maps/dir/?api=1&destination=${ev.treffpunkt_lat},${ev.treffpunkt_lng}" target="_blank" rel="noopener noreferrer">Route →</a>`
      : "";
    add("Treffpunkt", tp + link);
  }
  add("Treffzeit", escapeHtml(ev.treff_time));
  add("Jagdbeginn", escapeHtml(ev.start_time));
  add("Jagdende", escapeHtml(ev.end_time));
  $("#stk-times").innerHTML = rows.join("");

  const brief = $("#stk-briefing");
  if (ev.briefing) {
    brief.textContent = ev.briefing;
    brief.hidden = false;
  } else {
    brief.hidden = true;
  }
}

function renderContacts() {
  const ev = state.detail.event;
  let html = "";
  html += contactLine("Jagdkoordinator", ev.coordinator_name || ev.organizer, ev.coordinator_phone);
  for (const nsf of ev.nachsuchenfuehrer || []) {
    html += contactLine("Nachsuchenführer", nsf.name, nsf.phone);
  }
  if (ev.vet_name || ev.vet_phone) {
    html += contactLine("Notfall Jagdhunde", ev.vet_name, ev.vet_phone);
  } else {
    // Die Klinik hängt jetzt am Revier und wird im Sheet gepflegt. Vorher stand
    // die Müritz-Adresse hier fest im Code, samt Telefonnummer.
    const vet = (huntRevier(ev) || {}).vet;
    if (vet && (vet.name || vet.phone)) {
      const name = [vet.name, vet.address].filter(Boolean).join(", ");
      // Nur http(s) durchlassen. Der Wert kommt aus dem Sheet, ist also
      // vertrauenswürdig — aber ein href aus einer Tabellenzelle ungeprüft in
      // die Seite zu schreiben ist eine Angewohnheit, die man sich nicht
      // zulegen sollte.
      const safeUrl = /^https?:\/\//i.test(vet.url || "") ? vet.url : "";
      const link = safeUrl
        ? ` (<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">24 h Notdienst</a>)`
        : "";
      const tel = vet.phone
        ? `<a href="tel:${escapeHtml(vet.phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(vet.phone)}</a>`
        : "";
      html += `<div class="stk-contact">
        <span class="stk-contact-label">Notfall Jagdhunde</span>
        <span class="stk-contact-name">${escapeHtml(name)}${link}</span>
        <span class="stk-contact-phone">${tel}</span>
      </div>`;
    } else {
      html += `<p class="stk-hint">Für diese Jagd ist keine Notfall-Tierklinik hinterlegt — bei der Jagd oder beim Revier ergänzen.</p>`;
    }
  }
  $("#stk-contacts").innerHTML = html;
}

// Says plainly that the card keeps working without a signal, and switches to
// the actual state the moment the phone loses the network in the Kanzel.
function renderOfflineNote() {
  const el = $("#stk-offline");
  if (!el) return;
  if (navigator.onLine === false) {
    el.className = "stk-offline stk-offline--off";
    el.textContent = "Kein Empfang — die Karte kommt aus dem Speicher dieses Geräts. "
      + "Eintragen funktioniert ganz normal weiter; „Meldung senden“ geht, sobald Du wieder Netz hast.";
  } else {
    el.className = "stk-offline";
    el.textContent = "Offline nutzbar: Karte und Liste liegen auf diesem Gerät. "
      + "Einmal mit Empfang geöffnet, kannst Du sie auf dem Stand ohne Netz weiter ausfüllen.";
  }
}


// ---------- Blanko-Standkarte ----------
//
// Reached from the start page: a card for a hunt that isn't in the tool at
// all — a neighbour's Drückjagd, a spontaneous Ansitz. Everything that would
// normally be read out of the hunt becomes a field you fill in yourself. The
// hunt-linked card (from a QR code, ?event=…) is untouched.
//
// Every keystroke goes to localStorage under one key, so the card survives a
// reload on the Stand exactly like the Beobachtungsliste does.

const BLANK_KEY = "preye.stk.blanko.v1";

function blankData() {
  try { return JSON.parse(localStorage.getItem(BLANK_KEY) || "{}"); } catch { return {}; }
}

function saveBlank() {
  const out = {};
  $$("[data-blank]").forEach((el) => { out[el.dataset.blank] = el.value; });
  try { localStorage.setItem(BLANK_KEY, JSON.stringify(out)); } catch {}
  // The heading mirrors the two fields that name the day.
  $("#stk-title").textContent = out.jagd || "Standkarte";
  $("#stk-subtitle").textContent =
    [out.datum ? formatDate(out.datum) : "", out.revier].filter(Boolean).join(" · ");
  $("#stk-banner-sub").textContent = out.revier || "";
}

function blankField(key, label, type = "text", placeholder = "") {
  const v = escapeHtml(blankData()[key] || "");
  return `<label class="stk-bl-field">
      <span>${escapeHtml(label)}</span>
      <input type="${type}" data-blank="${key}" value="${v}"
             ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ""} />
    </label>`;
}

function renderBlankCard() {
  const d = blankData();
  document.title = "PREYE 👁 Standkarte (blanko)";
  $("#stk-title").textContent = d.jagd || "Standkarte";
  $("#stk-subtitle").textContent =
    [d.datum ? formatDate(d.datum) : "", d.revier].filter(Boolean).join(" · ");
  $("#stk-banner-sub").textContent = d.revier || "";

  // Kopf: what names the day.
  $("#stk-mine").hidden = false;
  $("#stk-mine-hunter").textContent = "";
  $("#stk-mine-body").innerHTML = `
    <div class="stk-bl-grid">
      ${blankField("jagd", "Jagd / Anlass", "text", "z.B. Drückjagd Forst Musterhausen")}
      ${blankField("revier", "Revier / Teilgebiet", "text", "z.B. Nordrevier")}
      ${blankField("datum", "Datum", "date")}
      ${blankField("name", "Mein Name")}
      ${blankField("stand", "Mein Stand", "text", "z.B. Kanzel 14, Buchenweg")}
      ${blankField("runde", "Runde / Ansteller", "text", "optional")}
    </div>`;
  $(".stk-mine-label").textContent = "Meine Angaben";

  // Zeiten: same fixed rules as always, the times typed in.
  $("#stk-times").innerHTML = `
    <div class="stk-bl-grid">
      ${blankField("treffpunkt", "Treffpunkt")}
      ${blankField("treff_time", "Treffzeit", "time")}
      ${blankField("start_time", "Jagdbeginn", "time")}
      ${blankField("end_time", "Jagdende", "time")}
    </div>`;
  $("#stk-briefing").hidden = true;

  $("#stk-contacts").innerHTML = `
    <div class="stk-bl-grid">
      ${blankField("koord_name", "Jagdkoordinator")}
      ${blankField("koord_tel", "Telefon", "tel")}
      ${blankField("nsf_name", "Nachsuchenführer")}
      ${blankField("nsf_tel", "Telefon", "tel")}
      ${blankField("vet_name", "Tierarzt / Klinik")}
      ${blankField("vet_tel", "Telefon", "tel")}
    </div>`;

  // Freigaben as free text, the way the paper card has them — a blank card is
  // filled in a hurry, and the AK matrix belongs to a hunt that exists.
  $("#stk-freigaben").innerHTML = `
    <label class="stk-bl-field stk-bl-field--wide">
      <textarea data-blank="freigaben" rows="4"
        placeholder="z.B. Rot- und Damwild nach Ansage · Schwarzwild alles außer laktierende Bachen · Rehwild alles · kein Raubwild">${escapeHtml(d.freigaben || "")}</textarea>
    </label>`;

  renderList();
  renderOfflineNote();

  $("#stk-foot").textContent = "Waidmannsheil!";
  $("#stk-card").hidden = false;
  $("#stk-switch").hidden = false;
  $("#stk-switch").textContent = "Jagd auswählen";
  document.body.classList.add("stk-blanko");
  setState("");
}

function renderCard() {
  const ev = state.detail.event;
  document.title = "PREYE 👁 Standkarte — " + (ev.name || "");
  $("#stk-banner-sub").textContent = ev.teilgebiet || "";
  $("#stk-title").textContent = ev.name || "Drückjagd";
  $("#stk-subtitle").textContent = [formatDate(ev.date), ev.teilgebiet].filter(Boolean).join(" · ");

  renderMine();
  renderTimes();
  renderContacts();
  renderFreigaben();
  renderList();
  renderOfflineNote();

  $("#stk-foot").textContent = "Waidmannsheil!";
  $("#stk-card").hidden = false;
  $("#stk-switch").hidden = false;
  setState("");
}

// ---------- Pickers ----------

function renderEventPicker() {
  const list = $("#stk-event-list");
  const today = new Date().toISOString().slice(0, 10);
  const sorted = state.events.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const upcoming = sorted.filter((e) => String(e.date) >= today);
  const past = sorted.filter((e) => String(e.date) < today).reverse();
  const ordered = upcoming.concat(past);

  if (!ordered.length) {
    list.innerHTML = `<p class="stk-hint">Es ist noch keine Jagd angelegt.</p>`;
  } else {
    list.innerHTML = ordered.map((e) => `
      <button type="button" class="stk-event-btn" data-id="${escapeHtml(e.id)}">
        <span class="stk-event-date">${escapeHtml(formatDate(e.date))}</span>
        <span class="stk-event-name">${escapeHtml(e.name)}</span>
        <span class="stk-event-area">${escapeHtml(e.teilgebiet || "")}</span>
      </button>`).join("");
    $$(".stk-event-btn", list).forEach((b) => {
      b.addEventListener("click", () => selectEvent(b.dataset.id));
    });
  }
  const blankBtn = $("#stk-blank-btn");
  if (blankBtn) blankBtn.hidden = false;
  $("#stk-pick-event").hidden = false;
  setState("");
}

function renderHunterPicker() {
  const hunters = (state.detail.hunters || [])
    .filter((h) => h.status !== "declined")
    .map((h) => h.hunter)
    .filter(Boolean);
  // Anyone placed in a Runde but not on the invite list still gets an entry.
  for (const sq of state.detail.squads || []) {
    for (const p of sq.positions || []) {
      if (p.hunter && !hunters.includes(p.hunter)) hunters.push(p.hunter);
    }
    if (sq.ansteller && !hunters.includes(sq.ansteller)) hunters.push(sq.ansteller);
  }
  hunters.sort((a, b) => a.localeCompare(b, "de"));

  $("#stk-pick-hunter-sub").textContent = state.detail.event.name + " · " + formatDate(state.detail.event.date);
  $("#stk-hunter-list").innerHTML = hunters.length
    ? hunters.map((n) => `<button type="button" class="stk-hunter-btn" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("")
    : `<p class="stk-hint">Für diese Jagd ist noch niemand eingetragen.</p>`;
  $$(".stk-hunter-btn").forEach((b) => {
    b.addEventListener("click", () => selectHunter(b.dataset.name));
  });
  $("#stk-pick-hunter").hidden = false;
  setState("");
}

// ---------- Flow ----------

function setParams(eventId, hunter) {
  const u = new URL(location.href);
  if (eventId) u.searchParams.set("event", eventId); else u.searchParams.delete("event");
  if (hunter) u.searchParams.set("h", hunter); else u.searchParams.delete("h");
  history.replaceState(null, "", u.toString());
}

async function selectEvent(id) {
  $("#stk-pick-event").hidden = true;
  setState(`<div class="boar-loader boar-loader--center">Lade Jagd …</div>`);
  try {
    state.detail = await fetchJson("event-detail", { id });
  } catch (err) {
    setState(`<p>Die Jagd konnte nicht geladen werden: ${escapeHtml(err.message)}</p>`, "error");
    return;
  }
  localStorage.setItem("preye.stk.event", id);
  setParams(id, state.me);
  loadBootstrap(); // background: Kanzel coordinates + the Wildart list
  if (state.me) renderCard(); else renderHunterPicker();
}

function selectHunter(name) {
  state.me = String(name || "").trim();
  if (!state.me) return;
  localStorage.setItem("preye.stk.hunter", state.me);
  setParams(state.detail.event.id, state.me);
  $("#stk-pick-hunter").hidden = true;
  renderCard();
}

// Kanzel coordinates (for the route link) and the Wildart list, both off the
// same bootstrap call the map page uses.
async function loadBootstrap() {
  try {
    const data = await fetchJson("bootstrap");
    state.posts = data.posts || [];
    if (Array.isArray(data.species) && data.species.length) state.species = data.species;
    if (!$("#stk-card").hidden) {
      renderMine();
      refreshSpeciesOptions();
    }
  } catch {
    try {
      const res = await fetch("posts.json");
      state.posts = await res.json();
      if (!$("#stk-card").hidden) renderMine();
    } catch {}
  }
}

async function resetToEventPicker() {
  state.detail = null;
  state.me = "";
  localStorage.removeItem("preye.stk.event");
  localStorage.removeItem("preye.stk.hunter");
  setParams("", "");
  $("#stk-card").hidden = true;
  $("#stk-pick-hunter").hidden = true;
  $("#stk-switch").hidden = true;
  document.title = "PREYE 👁 Standkarte";
  if (!state.events.length) {
    setState(`<div class="boar-loader boar-loader--center">Lade Jagden …</div>`);
    try {
      state.events = await fetchJson("events-list");
    } catch (err) {
      setState(`<p>Die Jagden konnten nicht geladen werden: ${escapeHtml(err.message)}</p>`, "error");
      return;
    }
  }
  renderEventPicker();
}

function wireUi() {
  $("#stk-switch").addEventListener("click", () => {
    state.blank = false;
    document.body.classList.remove("stk-blanko");
    $("#stk-switch").textContent = "Jagd wechseln";
    resetToEventPicker();
  });

  const blankBtn = $("#stk-blank-btn");
  if (blankBtn) blankBtn.addEventListener("click", () => {
    state.blank = true;
    $("#stk-pick-event").hidden = true;
    $("#stk-pick-hunter").hidden = true;
    setParams("", "");
    history.replaceState(null, "", location.pathname + "?blanko=1");
    renderBlankCard();
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches("[data-blank]")) saveBlank();
  });

  const tbody = $("#stk-tbody");
  tbody.addEventListener("input", saveList);
  tbody.addEventListener("change", saveList);
  // Geschlecht: one or none per row — tapping the active symbol clears it.
  // Same behaviour as the gender toggle on the Strecke form.
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".gender-btn");
    if (!btn) return;
    const wasActive = btn.classList.contains("active");
    $$(".gender-btn", btn.closest("tr")).forEach((o) => {
      o.classList.remove("active");
      o.setAttribute("aria-pressed", "false");
    });
    if (!wasActive) {
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
    }
    saveList();
  });
  $("#stk-hunter-back").addEventListener("click", resetToEventPicker);
  $("#stk-hunter-free-go").addEventListener("click", () => {
    const v = $("#stk-hunter-free").value.trim();
    if (!v) { showToast("Bitte einen Namen eintragen", "error"); return; }
    selectHunter(v);
  });
  $("#stk-hunter-free").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("#stk-hunter-free-go").click(); }
  });

  $("#stk-print").addEventListener("click", () => window.print());

  $("#stk-reset").addEventListener("click", () => {
    const what = state.blank ? "Alle Eingaben dieser Standkarte leeren?" : "Alle Zeilen dieser Standkarte leeren?";
    if (!confirm(what)) return;
    try { localStorage.removeItem(listKey()); } catch {}
    if (state.blank) {
      try { localStorage.removeItem(BLANK_KEY); } catch {}
      renderBlankCard();
      showToast("Zurückgesetzt");
      return;
    }
    renderList();
    showToast("Liste geleert");
  });

  // Hand over to the Anschuss-Protokoll on the map page, prefilled with the
  // Stand and the name we already know.
  $("#stk-anschuss").addEventListener("click", () => {
    if (state.blank) {
      // No Revier behind this card, so the Revier-free protocol it is.
      location.href = "nachsuche.html";
      return;
    }
    const placement = findMyPlacement(state.me);
    const params = new URLSearchParams();
    // Die Karte braucht das Revier der Jagd, nicht das zuletzt benutzte.
    // Fällt die Auflösung aus (alte, zwischengespeicherte reviere-def.js),
    // lassen wir den Parameter weg — dann greift dort das gemerkte Revier.
    const rev = (window.preyeEventRevier || (() => null))(state.detail && state.detail.event);
    if (rev) params.set("revier", rev.key);
    if (placement && placement.pos && placement.pos.post_id) params.set("stand", placement.pos.post_id);
    if (state.me) params.set("name", state.me);
    location.href = "karte.html?" + params.toString() + "#protokoll";
  });

  $("#stk-send").addEventListener("click", async () => {
    const text = buildReport();
    const ev = state.blank
      ? { name: (blankData().jagd || "Standkarte"), coordinator_phone: blankData().koord_tel || "" }
      : state.detail.event;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Standkarte " + (ev.name || ""), text });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    const phone = String(ev.coordinator_phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
    if (phone) {
      window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(text), "_blank", "noopener");
    } else {
      location.href = "mailto:?subject=" + encodeURIComponent("Standkarte " + (ev.name || "")) +
        "&body=" + encodeURIComponent(text);
    }
  });
}

async function main() {
  wireUi();
  window.addEventListener("online", renderOfflineNote);
  window.addEventListener("offline", renderOfflineNote);
  // The service worker is registered by pwa.js on every page now.
  const params = new URLSearchParams(location.search);
  const wantEvent = params.get("event") || localStorage.getItem("preye.stk.event") || "";
  state.me = (params.get("h") || localStorage.getItem("preye.stk.hunter") || "").trim();

  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) {
    setState("<p>Konfiguration fehlt: public/config.js</p>", "error");
    return;
  }

  // From the start page: a blank card, tied to nothing.
  if (params.get("blanko") === "1") {
    state.blank = true;
    renderBlankCard();
    return;
  }

  if (wantEvent) {
    await selectEvent(wantEvent);
    return;
  }

  try {
    state.events = await fetchJson("events-list");
  } catch (err) {
    setState(`<p>Die Jagden konnten nicht geladen werden: ${escapeHtml(err.message)}</p>`, "error");
    return;
  }
  renderEventPicker();
}

main();
