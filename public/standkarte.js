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

const state = {
  events: [],
  detail: null,   // { event, hunters, squads, freigaben_matrix }
  posts: [],      // Kanzeln from the bootstrap endpoint (for coordinates)
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

const NPA_AREAS = ["Babke", "Langenhagen", "Schwarzenhof", "Serrahn"];
function isNpaHunt(ev) {
  const tg = String((ev && ev.teilgebiet) || "");
  return NPA_AREAS.some((a) => tg.includes(a));
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
}

// ---------- Beobachtungsliste ----------

function listKey() {
  return "preye.stk.list." + (state.detail.event.id || "x") + "." + (state.me || "anon");
}

function readList() {
  try { return JSON.parse(localStorage.getItem(listKey()) || "[]"); } catch { return []; }
}

function saveList() {
  const rows = $$("#stk-tbody tr").map((tr) => ({
    time: $(".stk-in-time", tr).value,
    wild: $(".stk-in-wild", tr).value,
    gesehen: $(".stk-cb-gesehen", tr).checked,
    beschossen: $(".stk-cb-beschossen", tr).checked,
    liegt: $(".stk-cb-liegt", tr).checked,
    nachsuche: $(".stk-cb-nachsuche", tr).checked,
  }));
  try { localStorage.setItem(listKey(), JSON.stringify(rows)); } catch {}
}

function renderList() {
  const saved = readList();
  const tbody = $("#stk-tbody");
  let html = "";
  for (let i = 0; i < ROWS; i++) {
    const r = saved[i] || {};
    html += `<tr>
      <td class="stk-col-nr" data-label="Nr.">${i + 1}</td>
      <td class="stk-col-time" data-label="Uhrzeit"><input type="time" class="stk-in-time" value="${escapeHtml(r.time || "")}" aria-label="Uhrzeit Zeile ${i + 1}" /></td>
      <td class="stk-col-wild" data-label="Wildart / Geschlecht / Anzahl"><input type="text" class="stk-in-wild" value="${escapeHtml(r.wild || "")}" placeholder="Wildart / Geschlecht / Anzahl" aria-label="Wildart Zeile ${i + 1}" /></td>
      <td data-label="gesehen"><input type="checkbox" class="stk-cb-gesehen"${r.gesehen ? " checked" : ""} aria-label="gesehen Zeile ${i + 1}" /></td>
      <td data-label="beschossen"><input type="checkbox" class="stk-cb-beschossen"${r.beschossen ? " checked" : ""} aria-label="beschossen Zeile ${i + 1}" /></td>
      <td data-label="Stück liegt"><input type="checkbox" class="stk-cb-liegt"${r.liegt ? " checked" : ""} aria-label="Stück liegt Zeile ${i + 1}" /></td>
      <td data-label="Nachsuche"><input type="checkbox" class="stk-cb-nachsuche"${r.nachsuche ? " checked" : ""} aria-label="Nachsuche Zeile ${i + 1}" /></td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

// Plain-text version of the filled list, for WhatsApp / mail / share sheet.
function buildReport() {
  const ev = state.detail.event;
  const placement = findMyPlacement(state.me);
  const stand = placement && placement.pos
    ? (placement.pos.post_name || placement.pos.label || "Klettersitz")
    : "";
  const lines = [
    "Standkarte " + (ev.name || "") + " · " + formatDate(ev.date),
    "Schütze: " + (state.me || "—") + (stand ? " · Stand: " + stand : ""),
    "",
  ];
  const rows = readList().filter((r) => r && (r.time || r.wild || r.gesehen || r.beschossen || r.liegt || r.nachsuche));
  if (!rows.length) {
    lines.push("Keine Beobachtungen eingetragen.");
  } else {
    rows.forEach((r, i) => {
      const flags = [
        r.gesehen ? "gesehen" : "",
        r.beschossen ? "beschossen" : "",
        r.liegt ? "Stück liegt" : "",
        r.nachsuche ? "NACHSUCHE" : "",
      ].filter(Boolean).join(", ");
      lines.push(`${i + 1}. ${r.time || "--:--"} ${r.wild || ""}${flags ? " — " + flags : ""}`.trim());
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
  } else if (isNpaHunt(ev)) {
    // Standard 24-h clinic for the NPA-Müritz hunts, as on the paper card.
    html += `<div class="stk-contact">
      <span class="stk-contact-label">Notfall Jagdhunde</span>
      <span class="stk-contact-name">Müritz-Tierklinik, Goethestraße 52, 17192 Waren
        (<a href="https://www.xn--mritz-tierklinik-jzb.de/24hnotdienst" target="_blank" rel="noopener noreferrer">24 h Notdienst</a>)</span>
      <span class="stk-contact-phone"><a href="tel:03991664626">03991 / 66 46 26</a></span>
    </div>`;
  } else {
    html += `<p class="stk-hint">Für diese Jagd ist keine Notfall-Tierklinik hinterlegt — im Jagdplanungstool ergänzen.</p>`;
  }
  $("#stk-contacts").innerHTML = html;
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
  loadPosts(); // background, only needed for the navigation link
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

async function loadPosts() {
  try {
    const data = await fetchJson("bootstrap");
    state.posts = data.posts || [];
    if (!$("#stk-card").hidden) renderMine();
  } catch {
    try {
      const res = await fetch("posts.json");
      state.posts = await res.json();
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
  $("#stk-switch").addEventListener("click", resetToEventPicker);
  const tbody = $("#stk-tbody");
  tbody.addEventListener("input", saveList);
  tbody.addEventListener("change", saveList);
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
    if (!confirm("Alle Zeilen dieser Standkarte leeren?")) return;
    try { localStorage.removeItem(listKey()); } catch {}
    renderList();
    showToast("Liste geleert");
  });

  // Hand over to the Anschuss-Protokoll on the map page, prefilled with the
  // Stand and the name we already know.
  $("#stk-anschuss").addEventListener("click", () => {
    const placement = findMyPlacement(state.me);
    const params = new URLSearchParams();
    if (placement && placement.pos && placement.pos.post_id) params.set("stand", placement.pos.post_id);
    if (state.me) params.set("name", state.me);
    location.href = "index.html?" + params.toString() + "#protokoll";
  });

  $("#stk-send").addEventListener("click", async () => {
    const text = buildReport();
    const ev = state.detail.event;
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
  const params = new URLSearchParams(location.search);
  const wantEvent = params.get("event") || localStorage.getItem("preye.stk.event") || "";
  state.me = (params.get("h") || localStorage.getItem("preye.stk.hunter") || "").trim();

  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) {
    setState("<p>Konfiguration fehlt: public/config.js</p>", "error");
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
