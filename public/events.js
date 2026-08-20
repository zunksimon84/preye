// PREYE — Drückjagd organisation page.
//
// Lives next to the main map app (same Apps Script backend, same privacy
// gate). Hash routing: #/ = list, #/new = create form, #/event/<id> =
// detail (invites + squads). Magic-link invitations go out via Gmail
// (MailApp on the backend); hunters click the link and land on rsvp.html.

const cfg = window.PEENWERDER_CONFIG || {};

const state = {
  events: [],
  addressBook: [],
  currentEvent: null,  // { event, hunters, squads }
  posts: [],           // Kanzeln, used for Ansteller-Runden Position-Dropdown
  postsLoaded: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- Stale-while-revalidate cache (localStorage) ----------
// Apps Script /exec has a 1–2 s cold-start every call. We cache the JSON
// payload of read-only endpoints in localStorage and render from the cached
// copy immediately, then quietly refresh in the background. Mutations call
// invalidateCache() so the next read fetches fresh.
const CACHE_PREFIX = "preye.cache.v1.";

function cacheKey(action, params) {
  if (!params) return CACHE_PREFIX + action;
  const sorted = Object.keys(params).sort().map((k) => k + "=" + params[k]).join("&");
  return CACHE_PREFIX + action + (sorted ? "?" + sorted : "");
}

function readCache(action, params) {
  try {
    const raw = localStorage.getItem(cacheKey(action, params));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && "data" in obj ? obj.data : null;
  } catch { return null; }
}

function writeCache(action, params, data) {
  const key = cacheKey(action, params);
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch (err) {
    if (err && err.name === "QuotaExceededError") {
      // Drop all our cache entries and try once more.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
      }
      try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
    }
  }
}

function invalidateCache(action, params) {
  try { localStorage.removeItem(cacheKey(action, params)); } catch {}
}

function invalidateCachePrefix(action) {
  try {
    const prefix = CACHE_PREFIX + action;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) localStorage.removeItem(k);
    }
  } catch {}
}

// ---------- Network ----------

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

async function fetchJson(action, params = {}) {
  const res = await fetch(backendUrl(action, params));
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function postJson(body) {
  const res = await fetch(cfg.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, token: localStorage.getItem("preye.token") || "" }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Fehler");
  return data;
}

// ---------- Privacy gate (mirrors app.js) ----------

// Short-circuit the privacy gate when we've already verified within the
// last 15 minutes — otherwise every page load (events overview, event
// detail, etc.) eats two Apps Script cold-start round-trips (~2–4 s)
// before anything renders. Mutations still go through the live token,
// so a revoked token only stays valid for the rest of the TTL window.

// Die Zugangssperre steht in gate.js — eine Fassung für alle Seiten, statt
// wie früher je eine Kopie hier und in events.js.

// ---------- Toast ----------

let toastTimer = null;
function showToast(msg, kind, ms = 3000) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = kind === "error" ? "toast-error" : "";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Routing ----------

function route() {
  const hash = location.hash || "#/";
  // Leaving an event detail page: stop the GPS watch (battery) and forget
  // the fitted bounds so the next event re-frames its own cutout.
  if (!hash.startsWith("#/event/")) {
    stopPlanGeo();
    planMap.fittedFor = null;
  }
  $$(".ev-view").forEach((v) => { v.hidden = true; });
  if (hash === "#/" || hash === "") {
    $("#view-list").hidden = false;
    loadEvents();
  } else if (hash === "#/new") {
    $("#view-new").hidden = false;
    $("#ev-name").focus();
  } else if (hash.startsWith("#/event/")) {
    const id = decodeURIComponent(hash.slice("#/event/".length));
    $("#view-detail").hidden = false;
    loadEventDetail(id);
  } else {
    location.hash = "#/";
  }
}

// ---------- List ----------

async function loadEvents() {
  const list = $("#events-list");
  // Hydrate from cache first so the list is on screen immediately.
  const cached = readCache("events-list");
  if (cached) {
    state.events = cached;
    renderEventsList();
  } else {
    list.innerHTML = "<div class='boar-loader boar-loader--center'>Lade …</div>";
  }
  try {
    const fresh = await fetchJson("events-list");
    state.events = fresh;
    writeCache("events-list", null, fresh);
    renderEventsList();
  } catch (err) {
    if (!cached) {
      list.innerHTML = "";
      showToast("Fehler beim Laden: " + err.message, "error");
    }
  }
}

// One of four hand-drawn animals per event, picked deterministically from
// the event id so the same card always shows the same animal across reloads.
const EVENT_ANIMALS = ["boar", "stag", "roebuck", "fallow"];
function pickEventAnimal(id) {
  const s = String(id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return EVENT_ANIMALS[Math.abs(h) % EVENT_ANIMALS.length];
}

// Filter über der Jagdliste: Revier, Kalenderjahr, Jagdart. Der Stand steht in
// der Adresszeile (?revier=…&jahr=…&art=…) — so bleibt der Link von der
// Revier-Übersicht gültig und ein gefilterter Blick lässt sich weitergeben.
// Geschrieben wird mit replaceState, damit der Zurück-Knopf weiter zur
// vorherigen Seite führt und nicht durch Filterstände wandert.
const FILTERS = [
  { key: "revier", el: "#filter-revier", all: "Alle Reviere" },
  { key: "jahr",   el: "#filter-jahr",   all: "Alle Jahre" },
  { key: "art",    el: "#filter-art",    all: "Alle Jagdarten" },
];

function readFilters() {
  const q = new URLSearchParams(location.search);
  const out = {};
  FILTERS.forEach((f) => { out[f.key] = q.get(f.key) || ""; });
  return out;
}

function writeFilters(next) {
  const q = new URLSearchParams(location.search);
  Object.entries(next).forEach(([k, v]) => {
    if (v) q.set(k, v); else q.delete(k);
  });
  const qs = q.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
}

function eventYear(ev) {
  return String(ev.date || "").slice(0, 4);
}

function visibleEvents() {
  const f = readFilters();
  return state.events.filter((ev) => {
    if (f.revier && !window.preyeEventInRevier(ev, f.revier)) return false;
    if (f.jahr && eventYear(ev) !== f.jahr) return false;
    if (f.art && (ev.art || "drueckjagd") !== f.art) return false;
    return true;
  });
}

function fillSelect(sel, allLabel, options, value) {
  sel.innerHTML = [{ v: "", t: allLabel }].concat(options)
    .map((o) => `<option value="${escapeHtml(o.v)}"${o.v === value ? " selected" : ""}>${escapeHtml(o.t)}</option>`)
    .join("");
}

function renderFilters(shown) {
  const host = $("#ev-filters");
  if (!host) return;
  host.hidden = false;
  const f = readFilters();

  fillSelect($("#filter-revier"), "Alle Reviere",
    window.PREYE_REVIERE.map((r) => ({ v: r.key, t: r.name }))
      .concat([{ v: window.PREYE_REVIER_NONE.key, t: window.PREYE_REVIER_NONE.name }]),
    f.revier);

  // Die Jahre kommen aus den Terminen selbst — eine feste Liste wäre nach zwei
  // Saisons falsch. Das laufende Jahr ist immer dabei, auch wenn nichts drin steht.
  const years = new Set(state.events.map(eventYear).filter(Boolean));
  years.add(String(new Date().getFullYear()));
  fillSelect($("#filter-jahr"), "Alle Jahre",
    [...years].sort().map((y) => ({ v: y, t: y })), f.jahr);

  fillSelect($("#filter-art"), "Alle Jagdarten",
    window.PREYE_JAGDARTEN.map((a) => ({ v: a.key, t: a.name })), f.art);

  const active = FILTERS.some((x) => f[x.key]);
  $("#filter-count").textContent = active
    ? shown + " von " + state.events.length
    : state.events.length + (state.events.length === 1 ? " Jagd" : " Jagden");
  $("#filter-reset").hidden = !active;
}

function wireFilters() {
  FILTERS.forEach((f) => {
    const sel = $(f.el);
    if (!sel) return;
    sel.addEventListener("change", () => {
      writeFilters({ [f.key]: sel.value });
      renderEventsList();
    });
  });
  const reset = $("#filter-reset");
  if (reset) reset.addEventListener("click", () => {
    writeFilters({ revier: "", jahr: "", art: "" });
    renderEventsList();
  });
}

function renderEventsList() {
  const list = $("#events-list");
  const events = visibleEvents();
  renderFilters(events.length);
  const empty = $("#events-empty");
  empty.hidden = events.length > 0;
  if (!events.length) {
    const active = FILTERS.some((f) => readFilters()[f.key]);
    empty.textContent = state.events.length && active
      ? "Keine Jagd passt zu diesem Filter."
      : "Noch keine Jagd angelegt.";
    list.innerHTML = "";
    return;
  }
  // Backend sorts ascending by date; we insert a year-divider whenever the
  // year changes so it's visually obvious where a calendar year ends.
  let lastYear = null;
  const parts = [];
  for (const ev of events) {
    const year = (ev.date || "").slice(0, 4);
    if (year && year !== lastYear) {
      parts.push(`<div class="year-divider"><span>${escapeHtml(year)}</span></div>`);
      lastYear = year;
    }
    parts.push(renderEventCard(ev));
  }
  list.innerHTML = parts.join("");
}

function renderEventCard(ev) {
  const dateStr = formatDate(ev.date);
  const s = ev.stats || { invited: 0, accepted: 0, declined: 0, pending: 0 };
  const animal = pickEventAnimal(ev.id);
  return `
    <div class="event-card-wrap">
      <a class="event-card" href="#/event/${encodeURIComponent(ev.id)}">
        <img class="event-card-icon" src="event-icons/${animal}.png" alt="" loading="lazy" />
        <div class="event-card-content">
          <div class="event-card-head">
            <h3>${escapeHtml(ev.name)}</h3>
            <span class="event-date">${escapeHtml(dateStr)}</span>
          </div>
          <p class="event-meta">
            <span class="event-art event-art--${escapeHtml(ev.art || "drueckjagd")}">${escapeHtml((window.PREYE_JAGDARTEN.find((a) => a.key === (ev.art || "drueckjagd")) || {}).name || "")}</span>
            ${ev.treffpunkt ? escapeHtml(ev.treffpunkt) + (ev.treff_time ? " · " + escapeHtml(ev.treff_time) : "") : ""}
          </p>
          <div class="event-stats">
            <span class="stat stat-invited">${s.invited} eingeladen</span>
            <span class="stat stat-accepted">${s.accepted} ✓</span>
            <span class="stat stat-declined">${s.declined} ✗</span>
            <span class="stat stat-pending">${s.pending} offen</span>
          </div>
        </div>
      </a>
      <button class="event-delete-btn" data-eid="${escapeHtml(ev.id)}" type="button" aria-label="Veranstaltung löschen" title="Veranstaltung löschen">×</button>
    </div>
  `;
}

async function deleteEvent(id) {
  const ev = state.events.find((e) => e.id === id);
  const name = ev ? ev.name : "diese Veranstaltung";
  if (!confirm("„" + name + "“ wirklich löschen? Alle Einladungen, RSVPs und Squads werden mit gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.")) return;
  try {
    await postJson({ action: "event-delete", id });
    invalidateCache("events-list");
    invalidateCache("event-detail", { id });
    showToast("Veranstaltung gelöscht ✓");
    await loadEvents();
  } catch (err) {
    showToast(err.message || "Fehler beim Löschen", "error");
  }
}

function formatDate(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// ---------- Create ----------

async function submitNewEvent(e) {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const teilgebiet = $$("input[name=teilgebiet]:checked").map((c) => c.value).join(", ");
    const nachsuchenfuehrer = $$("#nsf-rows .nsf-row").map((row) => ({
      name: row.querySelector(".nsf-name").value.trim(),
      phone: row.querySelector(".nsf-phone").value.trim(),
    })).filter((p) => p.name || p.phone);
    const tpLatStr = $("#ev-treffpunkt-lat").value.trim();
    const tpLngStr = $("#ev-treffpunkt-lng").value.trim();
    const body = {
      action: "event-create",
      name: $("#ev-name").value.trim(),
      date: $("#ev-date").value,
      teilgebiet,
      art: ($("input[name=art]:checked") || {}).value || "drueckjagd",
      rsvp_deadline: $("#ev-rsvp-deadline").value,
      treffpunkt: $("#ev-treffpunkt").value.trim(),
      treffpunkt_lat: tpLatStr ? Number(tpLatStr) : "",
      treffpunkt_lng: tpLngStr ? Number(tpLngStr) : "",
      treff_time: $("#ev-treff-time").value,
      start_time: $("#ev-start-time").value,
      end_time: $("#ev-end-time").value,
      briefing: $("#ev-briefing").value.trim(),
      organizer: $("#ev-organizer").value.trim(),
      vet_name: $("#ev-vet-name").value.trim(),
      vet_phone: $("#ev-vet-phone").value.trim(),
      coordinator_name: $("#ev-coordinator-name").value.trim(),
      coordinator_phone: $("#ev-coordinator-phone").value.trim(),
      nachsuchenfuehrer,
    };
    const data = await postJson(body);
    invalidateCache("events-list");
    e.target.reset();
    buildNewEventForm(); // reset() räumt die erzeugten Felder nicht auf
    $("#nsf-rows").innerHTML = "";
    showToast("Veranstaltung angelegt ✓");
    location.hash = "#/event/" + encodeURIComponent(data.id);
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------- Detail ----------

async function loadEventDetail(id) {
  // Reiter, Suche und Sortierung überleben das doppelte Rendern derselben
  // Jagd und werden nur beim Wechsel zurückgesetzt.
  jgrReset(id);
  const cached = readCache("event-detail", { id });
  if (cached) {
    state.currentEvent = cached;
    renderEventDetail();
  } else {
    $("#event-header").innerHTML = "<div class='boar-loader boar-loader--center'>Lade …</div>";
    $("#hunters-list").innerHTML = "";
  }
  try {
    const fresh = await fetchJson("event-detail", { id });
    state.currentEvent = fresh;
    writeCache("event-detail", { id }, fresh);
    renderEventDetail();
  } catch (err) {
    if (!cached) {
      $("#event-header").innerHTML = "<p class='ev-error'>Fehler: " + escapeHtml(err.message) + "</p>";
    }
  }
}

function renderEventDetail() {
  const { event, hunters } = state.currentEvent;
  const header = $("#event-header");
  const dateLong = formatLongDate(event.date);
  const dateShort = formatDate(event.date);
  // Singular/plural just like the email — "Teilgebiet" vs "Teilgebiete".
  const teilgebietParts = (event.teilgebiet || "").split(/\s*,\s*/).filter(Boolean);
  const teilgebietLabel = teilgebietParts.length > 1 ? "Teilgebiete" : "Teilgebiet";
  const teilgebietValue = teilgebietParts.join(", ");
  const infoRows = [];
  if (event.treffpunkt || (event.treffpunkt_lat !== "" && event.treffpunkt_lng !== "")) {
    const lat = event.treffpunkt_lat;
    const lng = event.treffpunkt_lng;
    const hasCoords = (lat !== "" && lng !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));
    let html = escapeHtml(event.treffpunkt || "");
    if (hasCoords) {
      const url = `https://www.google.com/maps?q=${lat},${lng}`;
      const coordStr = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
      html += (event.treffpunkt ? " " : "") +
        `<a class="ev-map-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="In Google Maps öffnen">📍 ${escapeHtml(coordStr)}</a>`;
    }
    infoRows.push({ label: "Treffpunkt", html: html });
  }
  const artName = (window.PREYE_JAGDARTEN.find((a) => a.key === (event.art || "drueckjagd")) || {}).name;
  if (artName) infoRows.push({ label: "Jagdart", value: artName });
  infoRows.push(teilgebietValue
    ? { label: teilgebietLabel, value: teilgebietValue }
    : { label: "Revier", value: window.PREYE_REVIER_NONE.name });
  if (event.rsvp_deadline) infoRows.push({ label: "Anmeldeschluss", value: formatLongDate(event.rsvp_deadline) });
  const times = [
    event.treff_time ? { label: "Treff", value: event.treff_time + " Uhr" } : null,
    event.start_time ? { label: "Beginn", value: event.start_time + " Uhr" } : null,
    event.end_time ? { label: "Ende", value: event.end_time + " Uhr" } : null,
  ].filter(Boolean);
  header.innerHTML = `
    <div class="ev-hero">
      <h2 class="ev-hero-title">${escapeHtml(event.name)}</h2>
      ${dateLong ? `<p class="ev-hero-date">${escapeHtml(dateLong)}</p>` : ""}
    </div>
    ${infoRows.length ? `
      <div class="ev-info-list">
        ${infoRows.map((r) => `
          <div class="ev-info-row">
            <span class="ev-info-label">${escapeHtml(r.label)}</span>
            <span class="ev-info-value">${r.html != null ? r.html : escapeHtml(r.value)}</span>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${times.length ? `
      <div class="ev-times-strip">
        ${times.map((t) => `
          <div class="ev-time">
            <span class="ev-time-label">${escapeHtml(t.label)}</span>
            <span class="ev-time-value">${escapeHtml(t.value.replace(" Uhr", ""))}</span>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${event.briefing ? `<p class="ev-briefing">${escapeHtml(event.briefing)}</p>` : ""}
  `;
  renderContactsBlock(event);
  renderFreigabenBlock(event, state.currentEvent.freigaben_matrix);
  renderHuntersList(hunters);
  // Squads section is always visible now (no tabs), so load the posts data
  // it needs on every event open.
  loadPostsIfNeeded().then(renderSquads);
}

function formatLongDate(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function renderContactsBlock(event) {
  const el = $("#event-contacts");
  const lines = [];
  const vet = [event.vet_name, event.vet_phone].filter(Boolean).join(" — ");
  const coord = [event.coordinator_name, event.coordinator_phone].filter(Boolean).join(" — ");
  if (vet) lines.push(`<p><span class="ev-contact-label">Tierarzt:</span> ${escapeHtml(vet)}</p>`);
  if (coord) lines.push(`<p><span class="ev-contact-label">Nachsuchen-Koordinator:</span> ${escapeHtml(coord)}</p>`);
  const nsf = Array.isArray(event.nachsuchenfuehrer) ? event.nachsuchenfuehrer.filter((p) => p.name || p.phone) : [];
  if (nsf.length) {
    const items = nsf.map((p) => `<li>${escapeHtml([p.name, p.phone].filter(Boolean).join(" — "))}</li>`).join("");
    lines.push(`<p class="ev-contact-label">Nachsuchenführer:</p><ul class="ev-nsf-list">${items}</ul>`);
  }
  if (!lines.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = `<h3 class="ev-contacts-title">Kontakte <span class="muted">(für die schriftliche Einladung)</span></h3>${lines.join("")}`;
}

// ---------- Jägerregister (jgr-) ----------
// Aus der Kartenliste (eine .hunter-row à 59 px) wird eine Tabelle mit
// Reitern, Suche und Sortierung. Bei 60 Jägern spart das rund 1900 px
// Seitenhöhe — und man findet überhaupt jemanden wieder.

const JGR_TABS = [
  { key: "alle",     label: "Alle" },
  { key: "zugesagt", label: "Zugesagt" },
  { key: "offen",    label: "Offen" },
  { key: "abgesagt", label: "Abgesagt" },
];

// Die Sicht auf die Liste, kein zweiter Datenbestand. Steht bewusst NEBEN
// state.currentEvent: das wird bei jedem Nachladen komplett ersetzt, die
// Reiterwahl soll das überleben.
const jgrView = { eventId: null, tab: "alle", q: "", sort: "name", dir: 1 };

function jgrReset(eventId) {
  if (jgrView.eventId === eventId) return;   // dieselbe Jagd: Stand behalten
  Object.assign(jgrView, { eventId, tab: "alle", q: "", sort: "name", dir: 1 });
  const feld = $("#jgr-search");
  if (feld) feld.value = "";
}

const JGR_COLL = new Intl.Collator("de", { sensitivity: "base", numeric: true });

const JGR_STATUS_LABEL = {
  accepted: "Zugesagt ✓",
  declined: "Abgesagt ✗",
  invited:  "Eingeladen ⋯",
  pending:  "Offen",
};

// pending und invited liegen im selben Topf: beides heißt "noch keine
// Antwort", und die Reiter sollen vier sein, nicht fünf.
function jgrBucket(status) {
  if (status === "accepted") return "zugesagt";
  if (status === "declined") return "abgesagt";
  return "offen";
}

function jgrRow(h) {
  const gesetzt = !!h.set_manually;
  // Bei einer Zusage über den Link liegen Jagdschein- und VSG-Bestätigung vor,
  // bei einem gesetzten Eintrag nicht. Das ist bei Schützen und Hundeführern
  // ein Unterschied, den man vor der Jagd sehen will; ein Treiber führt keine
  // Waffe.
  //
  // "nicht mitgeliefert" ist nicht dasselbe wie "nicht bestätigt". Solange das
  // Backend die Felder nicht kennt (alte Fassung), darf die Papierspalte
  // NICHTS behaupten — sonst steht bei jemandem, der über den Link zugesagt
  // und beides bestätigt hat, es fehle etwas. Diese Prüfung steht nur hier.
  const kenntBestaetigungen = h.confirmed_jagdschein !== undefined;
  const brauchtPapiere = kenntBestaetigungen && h.status === "accepted" &&
    (h.role === "Schütze/Standschnaller" || h.role === "Hundeführer");
  const fehlt = brauchtPapiere
    ? [!h.confirmed_jagdschein ? "Jagdschein" : "", !h.confirmed_vsg44 ? "VSG 4.4" : ""].filter(Boolean)
    : [];
  const name = h.hunter || "";
  return {
    id: h.id,
    name,
    email: h.email || "",
    language: h.language === "en" ? "en" : "de",
    status: h.status || "pending",
    bucket: jgrBucket(h.status),
    role: h.role || "",
    gesetzt,
    kenntBestaetigungen,
    brauchtPapiere,
    fehlt,
    dogs: (h.status === "accepted" && Array.isArray(h.dogs)) ? h.dogs : [],
    such: (name + " " + (h.email || "") + " " + (h.role || "")).toLowerCase(),
  };
}

const JGR_SORT = {
  name:   (r) => r.name,
  email:  (r) => r.email || "zzz",
  role:   (r) => r.role || "zzz",
  status: (r) => ({ accepted: 0, invited: 1, pending: 2, declined: 3 }[r.status] ?? 9),
  // Probleme nach oben: erst "es fehlt was", dann "geprüft", dann
  // "betrifft ihn nicht".
  papiere: (r) => (r.fehlt.length ? 0 : (r.brauchtPapiere ? 1 : 2)),
};

function jgrSichtbar(zeilen) {
  const gefiltert = zeilen.filter((r) =>
    (jgrView.tab === "alle" || r.bucket === jgrView.tab) &&
    (!jgrView.q || r.such.includes(jgrView.q))
  );
  const schluessel = JGR_SORT[jgrView.sort] || JGR_SORT.name;
  return gefiltert.sort((a, b) => {
    const ka = schluessel(a), kb = schluessel(b);
    const c = (typeof ka === "number") ? ka - kb : JGR_COLL.compare(ka, kb);
    // Der Name ist der zweite Schlüssel, damit gleiche Werte nicht springen.
    return (c || JGR_COLL.compare(a.name, b.name)) * jgrView.dir;
  });
}

// Die Zähler kommen aus der UNGEFILTERTEN Liste. Sonst zeigt der aktive Reiter
// seine eigene Trefferzahl und die anderen null.
function jgrUpdateTabs(alle) {
  const wrap = $("#jgr-tabs");
  if (!wrap) return;
  const zaehler = { alle: alle.length, zugesagt: 0, offen: 0, abgesagt: 0 };
  alle.forEach((r) => { zaehler[r.bucket]++; });
  $$(".ev-tab", wrap).forEach((b) => {
    const k = b.dataset.tab;
    const an = k === jgrView.tab;
    b.classList.toggle("active", an);
    b.setAttribute("aria-selected", an ? "true" : "false");
    const pille = b.querySelector(".ev-tab-count");
    if (pille) pille.textContent = zaehler[k] ?? 0;
  });
}

function jgrPapiereZelle(r) {
  if (!r.kenntBestaetigungen) return "";   // alte Backend-Fassung: nichts
  if (!r.brauchtPapiere) return "";        // Treiber oder noch keine Zusage
  if (!r.fehlt.length) {
    return '<span class="jgr-pap-ok" title="Jagdschein und VSG 4.4 bestätigt">✓</span>';
  }
  return '<span class="hunter-missing" title="Beim Setzen von Hand liegt keine Bestätigung vor">ohne ' +
         escapeHtml(r.fehlt.join(" + ")) + "</span>";
}

// Die Rolle ist nur bei GESETZTEN Jägern änderbar. eventHunterSet_ weigert
// sich, eine selbst abgegebene Zusage zu überschreiben — dort trägt die Rolle
// die Bestätigungen zu Jagdschein und VSG 4.4, die nur die Person selbst geben
// kann. Der Knopf darf deshalb gar nicht erst erscheinen: aus einem
// Fehler-Toast lernt niemand etwas.
function jgrRolleZelle(r) {
  if (!r.role) return '<span class="muted">—</span>';
  if (!r.gesetzt) {
    return '<span title="Zusage über den Anmeldelink — die Rolle steht so, wie er sie selbst gewählt hat.">' +
           escapeHtml(r.role) + "</span>";
  }
  return `<button type="button" class="link-btn jgr-role" data-hid="${escapeHtml(r.id)}" title="Rolle ändern">` +
         escapeHtml(r.role) + ' <span class="jgr-role-stift" aria-hidden="true">✎</span></button>';
}

function jgrKopf(schluessel, text, klasse) {
  const aktiv = jgrView.sort === schluessel;
  const sortiert = aktiv ? (jgrView.dir > 0 ? "ascending" : "descending") : "none";
  return `<th class="${klasse}" scope="col" aria-sort="${sortiert}">` +
         `<button type="button" class="jgr-sort" data-sort="${schluessel}">${escapeHtml(text)}</button></th>`;
}

function renderHuntersList(hunters) {
  const list = $("#hunters-list");
  if (!list) return;
  const alle = (hunters || []).map(jgrRow);
  jgrUpdateTabs(alle);

  if (!alle.length) {
    list.innerHTML = "<p class='empty-msg'>Noch keine Jäger hinzugefügt.</p>";
    jgrUpdateCount(0, 0);
    updateInviteStatus();
    return;
  }

  const zeilen = jgrSichtbar(alle);
  jgrUpdateCount(zeilen.length, alle.length);

  if (!zeilen.length) {
    list.innerHTML = "<p class='empty-msg'>Kein Treffer — Reiter oder Suche ändern.</p>";
    updateInviteStatus();
    return;
  }

  list.innerHTML = `
    <table class="jgr-table">
      <thead>
        <tr>
          <th class="jgr-col-lang" scope="col"><span class="jgr-sr">Sprache</span></th>
          ${jgrKopf("name", "Name", "jgr-col-name")}
          ${jgrKopf("email", "E-Mail", "jgr-col-mail")}
          ${jgrKopf("role", "Rolle", "jgr-col-role")}
          ${jgrKopf("status", "Status", "jgr-col-stat")}
          ${jgrKopf("papiere", "Papiere", "jgr-col-pap")}
          <th class="jgr-col-dogs" scope="col">Hunde</th>
          <th class="jgr-col-act" scope="col"><span class="jgr-sr">Aktionen</span></th>
        </tr>
      </thead>
      <tbody>
        ${zeilen.map((r) => {
          const dogs = r.dogs.length ? r.dogs.map((d) => d.count + "× " + d.breed).join(", ") : "";
          return `
          <tr class="hunter-row hunter-${escapeHtml(r.status)}" data-hid="${escapeHtml(r.id)}">
            <td class="jgr-col-lang" data-label="Sprache"><span class="hunter-flag" title="${r.language === "en" ? "English" : "Deutsch"}">${r.language === "en" ? "🇬🇧" : "🇩🇪"}</span></td>
            <td class="jgr-col-name" data-label="Name"><strong>${escapeHtml(r.name)}</strong></td>
            <td class="jgr-col-mail" data-label="E-Mail">${r.email ? `<a class="hunter-email" href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>` : '<span class="muted">—</span>'}</td>
            <td class="jgr-col-role" data-label="Rolle">${jgrRolleZelle(r)}</td>
            <td class="jgr-col-stat" data-label="Status"><span class="hunter-status">${escapeHtml(JGR_STATUS_LABEL[r.status] || r.status)}</span>${r.gesetzt ? '<span class="jgr-gesetzt" title="Von Hand gesetzt — Jagdschein und VSG 4.4 sind damit nicht bestätigt">gesetzt</span>' : ""}</td>
            <td class="jgr-col-pap" data-label="Papiere">${jgrPapiereZelle(r)}</td>
            <td class="jgr-col-dogs" data-label="Hunde">${dogs ? `<span class="hunter-dogs">${escapeHtml(dogs)}</span>` : ""}</td>
            <td class="jgr-col-act">
              <button class="link-btn hunter-set" data-hid="${escapeHtml(r.id)}"
                      data-gesetzt="${r.gesetzt ? "1" : ""}"
                      title="${r.gesetzt ? "Setzen zurücknehmen" : "Ohne Einladung als zugesagt setzen"}">${r.gesetzt ? "↺" : "✓"}</button>
              <button class="link-btn hunter-remove" data-hid="${escapeHtml(r.id)}" title="Entfernen">×</button>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
  updateInviteStatus();
}

// "12 von 60" nur, wenn wirklich gefiltert wird — eine stumm gefilterte Liste
// liest sich wie eine kaputte.
function jgrUpdateCount(sichtbar, gesamt) {
  const el = $("#jgr-count");
  if (!el) return;
  el.textContent = !gesamt ? ""
    : (sichtbar === gesamt ? `${gesamt} ${gesamt === 1 ? "Jäger" : "Jäger"}` : `${sichtbar} von ${gesamt}`);
}

function jgrNeuZeichnen() {
  renderHuntersList(state.currentEvent?.hunters || []);
}

function updateInviteStatus() {
  const status = $("#invite-status");
  const hunters = state.currentEvent?.hunters || [];
  const unsent = hunters.filter((h) => h.email && !h.invited_at).length;
  const total = hunters.filter((h) => h.email).length;
  if (!total) {
    status.textContent = "";
  } else if (unsent === 0) {
    status.textContent = `${total} Einladung${total === 1 ? "" : "en"} versendet.`;
  } else {
    status.textContent = `${unsent} ausstehend (${total - unsent} bereits versendet).`;
  }
}

async function addHunter(e) {
  e.preventDefault();
  if (!state.currentEvent) return;
  const name = $("#add-hunter-name").value.trim();
  const email = $("#add-hunter-email").value.trim();
  const language = $("#add-hunter-lang").value || "de";
  if (!name) return;
  if (!email) {
    showToast("E-Mail erforderlich", "error");
    return;
  }
  try {
    const rolle = $("#add-hunter-mode").value;
    await postJson({
      action: "event-hunter-add",
      event_id: state.currentEvent.event.id,
      hunter: name,
      email: email,
      language: language,
      // Eine gewählte Rolle heißt: der hat schon zugesagt, keine Einladung.
      role: rolle,
      set: !!rolle,
    });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    invalidateCache("events-list");
    invalidateCache("address-book");
    $("#add-hunter-name").value = "";
    $("#add-hunter-email").value = "";
    $("#add-hunter-lang").value = "de";
    // Die Auswahl NICHT zurücksetzen: wer eine Treibergruppe einträgt, trägt
    // meist mehrere hintereinander ein.
    // Reflect locally so the datalist updates without a refetch.
    const i = state.addressBook.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) state.addressBook[i] = { name, email, language };
    else state.addressBook.push({ name, email, language });
    refreshAddressBookList();
    await loadEventDetail(state.currentEvent.event.id);
    $("#add-hunter-name").focus();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Jemanden nachträglich als zugesagt setzen — oder das zurücknehmen.
//
// Der zweite Fall des mündlichen Zusagens: er steht schon auf der Liste,
// vielleicht ist die Einladung sogar raus, aber er ruft an statt zu klicken.
//
// Die Rolle wird angeklickt, nicht getippt. Ein Eingabefenster mit
// abzuschreibendem „Schütze/Standschnaller" wäre eine Tippfehlerfalle, und der
// Fehler fiele erst nach dem Absenden auf.
const SET_ROLES = ["Schütze/Standschnaller", "Treiber", "Hundeführer"];

// Die Rollenauswahl klappt UNTER der Zeile auf, als eigene Tabellenzeile.
// Bis 20.08.2026 hing sie als <div> in der Zeile selbst — in einem <tr> ist
// ein <div> nicht platzierbar, der Browser wirft es aus der Tabelle heraus
// und die Auswahl stünde irgendwo oben auf der Seite. Der Fehler wäre stumm:
// sichtbar, nur an der falschen Stelle.
function openSetPicker(row, id, hunterName, aktuelleRolle = "") {
  const naechste = row.nextElementSibling;
  if (naechste && naechste.classList.contains("jgr-pickrow")) return;

  const spalten = row.children.length || 1;
  const pick = document.createElement("tr");
  pick.className = "jgr-pickrow";
  pick.innerHTML =
    `<td colspan="${spalten}"><div class="hunter-setpick">` +
    `<span>${escapeHtml(hunterName)} ${aktuelleRolle ? "ist" : "setzen als"}</span>` +
    SET_ROLES.map((r) => `<button type="button" class="${r === aktuelleRolle ? "is-aktuell" : ""}"` +
      ` data-role="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join("") +
    `<button type="button" data-cancel="1" class="hunter-setpick-x">Abbrechen</button>` +
    `</div></td>`;
  row.after(pick);
  pick.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cancel) { pick.remove(); return; }
    pick.remove();
    applySet(id, b.dataset.role, false, hunterName);
  });
}

async function setHunter(id, gesetzt) {
  if (!state.currentEvent) return;
  const h = (state.currentEvent.hunters || []).find((x) => x.id === id);
  if (!h) return;
  if (!gesetzt) {
    const row = document.querySelector(`.hunter-set[data-hid="${CSS.escape(id)}"]`)?.closest(".hunter-row");
    if (row) openSetPicker(row, id, h.hunter);
    return;
  }
  if (!confirm(`Das Setzen für „${h.hunter}" zurücknehmen?`)) return;
  applySet(id, "", true, h.hunter);
}

async function applySet(id, role, undo, hunterName) {
  try {
    const r = await postJson({ action: "event-hunter-set", id: id, role: role, undo: undo });
    if (r.error) { showToast(r.error, "error", 7000); return; }
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    invalidateCache("events-list");
    await loadEventDetail(state.currentEvent.event.id);
    if (r.needsPapers) {
      showToast(
        `${hunterName} ist gesetzt. Jagdschein und VSG 4.4 sind damit nicht ` +
        "bestätigt — das steht so in der Liste.", "", 7000
      );
    } else {
      showToast(undo ? "Setzen zurückgenommen" : `${hunterName} ist gesetzt.`);
    }
  } catch (err) {
    showToast("Fehler: " + err.message, "error", 6000);
  }
}

async function removeHunter(huntId) {
  if (!huntId) return;
  if (!confirm("Diesen Jäger aus der Liste entfernen?")) return;
  try {
    await postJson({ action: "event-hunter-remove", id: huntId });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    invalidateCache("events-list");
    await loadEventDetail(state.currentEvent.event.id);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Two-step invitation flow:
//   1. openInvitePreview — load BOTH the German and English rendered templates
//      and let the organizer edit subject + body in either language via a tab.
//   2. sendInvites — POST both versions; backend picks per hunter based on
//      that hunter's language preference and swaps {link} for their magic URL.
let invitePreview = null; // { de: {subject, body}, en: {...}, activeLang }

async function openInvitePreview() {
  if (!state.currentEvent) return;
  const btn = $("#open-invite-preview");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Lade …";
  try {
    const eid = state.currentEvent.event.id;
    const [de, en] = await Promise.all([
      fetchJson("invite-preview", { event_id: eid, language: "de" }),
      fetchJson("invite-preview", { event_id: eid, language: "en" }),
    ]);
    if (de.error) throw new Error(de.error);
    if (en.error) throw new Error(en.error);
    invitePreview = {
      de: { subject: de.subject || "", body: de.body || "" },
      en: { subject: en.subject || "", body: en.body || "" },
      activeLang: "de",
    };
    showInviteLang("de", /* skipSave */ true);
    updateInviteRecipientsLine();
    $("#invite-backdrop").hidden = false;
    $("#invite-modal").hidden = false;
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function showInviteLang(lang, skipSave) {
  if (!invitePreview) return;
  if (!skipSave && invitePreview.activeLang && invitePreview[invitePreview.activeLang]) {
    invitePreview[invitePreview.activeLang].subject = $("#invite-subject").value;
    invitePreview[invitePreview.activeLang].body = $("#invite-body").value;
  }
  invitePreview.activeLang = lang;
  $("#invite-subject").value = invitePreview[lang].subject;
  $("#invite-body").value = invitePreview[lang].body;
  $$(".invite-lang-tab").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
}

function updateInviteRecipientsLine() {
  const hunters = state.currentEvent?.hunters || [];
  // Gesetzte Jäger haben schon zugesagt. Sie stehen nicht in der Empfängerzahl,
  // weil der Versand sie überspringt — die Zeile soll sagen, was passiert, und
  // nicht, wer eine E-Mail-Adresse hat.
  const gesetzt = hunters.filter((h) => h.email && h.set_manually).length;
  const sendable = hunters.filter((h) => h.email && !h.invited_at && !h.set_manually);
  const total = hunters.filter((h) => h.email && !h.set_manually).length;
  const sent = total - sendable.length;
  let line;
  if (!total) {
    line = "Noch keine Jäger mit E-Mail — versenden ist erst möglich, wenn welche eingetragen sind.";
  } else if (!sendable.length) {
    line = `${total} Einladung${total === 1 ? "" : "en"} bereits versendet — Senden überträgt keine neuen E-Mails.`;
  } else {
    const counts = { de: 0, en: 0 };
    sendable.forEach((h) => { counts[h.language === "en" ? "en" : "de"]++; });
    const parts = [];
    if (counts.de) parts.push(`${counts.de} 🇩🇪`);
    if (counts.en) parts.push(`${counts.en} 🇬🇧`);
    line = `Wird an ${sendable.length} Jäger versendet (${parts.join(" · ")})` +
           (sent ? `, ${sent} bereits versendet — werden übersprungen.` : ".");
  }
  if (gesetzt) {
    line += ` ${gesetzt} gesetzte${gesetzt === 1 ? "r" : ""} bekommt keine Einladung.`;
  }
  $("#invite-recipients").textContent = line;
}

function closeInvitePreview() {
  $("#invite-modal").hidden = true;
  $("#invite-backdrop").hidden = true;
}

async function sendInvites() {
  if (!state.currentEvent || !invitePreview) return;
  // Capture whatever's in the textarea for the currently-visible language.
  invitePreview[invitePreview.activeLang].subject = $("#invite-subject").value;
  invitePreview[invitePreview.activeLang].body = $("#invite-body").value;
  const btn = $("#send-invites-btn");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Sende …";
  try {
    // Bare directory URL (strips ?query, #hash, and the events.html filename)
    // so the backend can build .../rsvp.html?t=… correctly.
    const baseUrl = new URL(".", location.href).href;
    const data = await postJson({
      action: "event-invites-send",
      event_id: state.currentEvent.event.id,
      base_url: baseUrl,
      only_unsent: true,
      subject_de: invitePreview.de.subject,
      body_text_de: invitePreview.de.body,
      subject_en: invitePreview.en.subject,
      body_text_en: invitePreview.en.body,
    });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    invalidateCache("events-list");
    closeInvitePreview();
    // Reload first so the cumulative count reflects the rows just written.
    await loadEventDetail(state.currentEvent.event.id);
    const totalInvited = (state.currentEvent?.hunters || []).filter((h) => h.invited_at).length;
    if (data.errors && data.errors.length) {
      const failed = data.errors.map((e) => e.hunter).join(", ");
      showToast(`Versendet: ${data.sent} · insgesamt eingeladen: ${totalInvited}. Fehler bei: ${failed}`, "error", 7000);
    } else if (data.sent === 0) {
      showToast(`Keine ausstehenden Einladungen — insgesamt eingeladen: ${totalInvited}.`);
    } else {
      const newWord = data.sent === 1 ? "neue Einladung" : "neue Einladungen";
      showToast(`${data.sent} ${newWord} versendet ✓ · insgesamt eingeladen: ${totalInvited}`);
    }
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// ---------- CSV import ----------

function parseCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === delim) { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  // Detect delimiter: comma, semicolon (German Excel default), or tab.
  let delim = ",";
  let max = 0;
  for (const d of [",", ";", "\t"]) {
    const re = new RegExp(d === "\t" ? "\t" : "\\" + d, "g");
    const count = (lines[0].match(re) || []).length;
    if (count > max) { max = count; delim = d; }
  }
  return lines.map((line) => parseCsvLine(line, delim));
}

async function importHuntersFromCsv(file) {
  if (!file || !state.currentEvent) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) {
    showToast("CSV-Datei ist leer.", "error");
    return;
  }
  // First-row header detection: any of "name" / "mail" / "email" in cells.
  const first = rows[0].map((c) => c.toLowerCase().trim());
  const hasHeader = first.some((c) => c.includes("name") || c.includes("mail"));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  let nameIdx = 0, emailIdx = 1, langIdx = 2;
  if (hasHeader) {
    first.forEach((h, i) => {
      if (h.includes("name") && !h.includes("user")) nameIdx = i;
      else if (h.includes("mail")) emailIdx = i;
      else if (/sprache|language|^lang$/.test(h)) langIdx = i;
    });
  }
  const hunters = dataRows
    .map((row) => ({
      name: (row[nameIdx] || "").trim(),
      email: (row[emailIdx] || "").trim(),
      language: ((row[langIdx] || "de").trim().toLowerCase() === "en" ? "en" : "de"),
    }))
    .filter((h) => h.name && h.email);
  if (!hunters.length) {
    showToast("Keine gültigen Zeilen gefunden — erwartet: Name, E-Mail, (Sprache).", "error", 5000);
    return;
  }
  try {
    const r = await postJson({
      action: "event-hunters-batch-add",
      event_id: state.currentEvent.event.id,
      hunters,
    });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    invalidateCache("events-list");
    invalidateCache("address-book");
    const parts = [`${r.added} hinzugefügt`];
    if (r.skipped && r.skipped.length) parts.push(`${r.skipped.length} bereits vorhanden`);
    if (r.errors && r.errors.length) parts.push(`${r.errors.length} Fehler`);
    showToast(parts.join(" · "), r.errors && r.errors.length ? "error" : null, 5000);
    await loadEventDetail(state.currentEvent.event.id);
    await loadAddressBook();
  } catch (err) {
    showToast(err.message || "CSV-Import fehlgeschlagen", "error");
  }
}

// ---------- Address book picker ----------

async function openAddressBookModal() {
  if (!state.currentEvent) return;
  await loadAddressBook();
  const rosterEmails = new Set(
    (state.currentEvent.hunters || []).map((h) => (h.email || "").toLowerCase()).filter(Boolean)
  );
  const list = $("#address-book-list");
  if (!state.addressBook.length) {
    list.innerHTML = "";
    $("#address-book-empty").hidden = false;
  } else {
    $("#address-book-empty").hidden = true;
    // Sort alphabetically by name for predictable browsing.
    const sorted = state.addressBook.slice().sort((a, b) =>
      a.name.localeCompare(b.name, "de", { sensitivity: "base" })
    );
    list.innerHTML = sorted.map((c) => {
      const checked = rosterEmails.has(c.email.toLowerCase()) ? "checked" : "";
      const flag = c.language === "en" ? "🇬🇧" : "🇩🇪";
      return `
        <label class="ab-row">
          <input type="checkbox"
                 data-name="${escapeHtml(c.name)}"
                 data-email="${escapeHtml(c.email)}"
                 data-lang="${escapeHtml(c.language || "de")}"
                 ${checked} />
          <span class="ab-flag" aria-hidden="true">${flag}</span>
          <div class="ab-main">
            <span class="ab-name">${escapeHtml(c.name)}</span>
            <span class="ab-email">${escapeHtml(c.email)}</span>
          </div>
        </label>
      `;
    }).join("");
  }
  $("#address-book-backdrop").hidden = false;
  $("#address-book-modal").hidden = false;
}

function closeAddressBookModal() {
  $("#address-book-modal").hidden = true;
  $("#address-book-backdrop").hidden = true;
}

async function applyAddressBookSelection() {
  if (!state.currentEvent) return;
  const checkboxes = $$("#address-book-list input[type=checkbox]");
  const rosterByEmail = new Map();
  (state.currentEvent.hunters || []).forEach((h) => {
    if (h.email) rosterByEmail.set(h.email.toLowerCase(), h);
  });
  const toAdd = [];
  const toRemoveIds = [];
  checkboxes.forEach((cb) => {
    const email = cb.dataset.email.toLowerCase();
    if (cb.checked && !rosterByEmail.has(email)) {
      toAdd.push({
        name: cb.dataset.name,
        email: cb.dataset.email,
        language: cb.dataset.lang || "de",
      });
    } else if (!cb.checked && rosterByEmail.has(email)) {
      toRemoveIds.push(rosterByEmail.get(email).id);
    }
  });
  if (!toAdd.length && !toRemoveIds.length) {
    closeAddressBookModal();
    return;
  }
  const btn = $("#address-book-apply");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Speichere …";
  try {
    for (const id of toRemoveIds) {
      await postJson({ action: "event-hunter-remove", id });
    }
    let added = 0;
    if (toAdd.length) {
      const r = await postJson({
        action: "event-hunters-batch-add",
        event_id: state.currentEvent.event.id,
        hunters: toAdd,
      });
      added = r.added || 0;
    }
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    invalidateCache("events-list");
    invalidateCache("address-book");
    const parts = [];
    if (added) parts.push(`${added} hinzugefügt`);
    if (toRemoveIds.length) parts.push(`${toRemoveIds.length} entfernt`);
    showToast(parts.join(" · ") || "Keine Änderungen");
    closeAddressBookModal();
    await loadEventDetail(state.currentEvent.event.id);
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// ---------- Address book ----------

async function loadAddressBook() {
  const cached = readCache("address-book");
  if (cached) {
    state.addressBook = cached;
    refreshAddressBookList();
  }
  try {
    const fresh = await fetchJson("address-book");
    state.addressBook = fresh;
    writeCache("address-book", null, fresh);
    refreshAddressBookList();
  } catch (err) {
    if (!cached) state.addressBook = [];
  }
}

function refreshAddressBookList() {
  const dl = $("#address-book-options");
  if (!dl) return;
  dl.innerHTML = state.addressBook.map((c) =>
    `<option value="${escapeHtml(c.name)}" data-email="${escapeHtml(c.email)}"></option>`
  ).join("");
}

// When the user picks a name from the datalist, autofill the email
// and language preference from the address book.
function onHunterNamePick() {
  const name = $("#add-hunter-name").value.trim();
  const hit = state.addressBook.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!hit) return;
  if (hit.email && !$("#add-hunter-email").value) $("#add-hunter-email").value = hit.email;
  if (hit.language) $("#add-hunter-lang").value = hit.language;
}

// ---------- Ansteller Runden (squads) ----------
// Each Ansteller Runde = one Ansteller (group leader) + several Schützen,
// each assigned to a Kanzel (from the event's Teilgebiet) or to a
// Klettersitz with coordinates. Only accepted hunters appear in the picker.

async function loadPostsIfNeeded() {
  if (state.postsLoaded) return;
  // Diese Seite arbeitet revierübergreifend: eine Jagd kann in jedem Revier
  // liegen, und die Stände-Verwaltung zeigt alle. Deshalb ausdrücklich
  // revier=all — ohne den Parameter läge das Standardrevier an, und die
  // Revierkarte jeder fremden Jagd bliebe leer.
  //
  // Eigener Zwischenspeicher-Schlüssel: die Kartenseite legt unter ihrem
  // Revier ab, und deren Ausschnitt wäre hier zu wenig.
  const cached = readCache("bootstrap-all");
  if (cached && Array.isArray(cached.posts)) {
    state.posts = cached.posts;
    if (cached.reviere) window.preyeApplyReviere(cached.reviere);
    state.postsLoaded = true;
    return;
  }
  try {
    const data = await fetchJson("bootstrap", { revier: "all" });
    if (data.reviere) window.preyeApplyReviere(data.reviere);
    state.posts = Array.isArray(data.posts) ? data.posts : [];
    state.postsLoaded = true;
    writeCache("bootstrap-all", null, data);
  } catch (err) {
    state.posts = [];
    state.postsLoaded = true; // avoid retry loop
  }
}

function getAcceptedHunters() {
  return (state.currentEvent?.hunters || []).filter((h) => h.status === "accepted");
}

// Hunters who accepted as Hundeführer.
function getHundefuehrer() {
  return getAcceptedHunters().filter((h) => h.role === "Hundeführer");
}

// Hunters who accepted as Treiber.
function getTreiber() {
  return getAcceptedHunters().filter((h) => h.role === "Treiber");
}

// Eligible members of a Treibergruppe: either Treiber or Hundeführer.
// Used for both the Treiberführer (row 1) and the regular members.
function getTreibergruppeCandidates() {
  return getAcceptedHunters().filter((h) => h.role === "Treiber" || h.role === "Hundeführer");
}

// Squads (ansteller + treiber) are stored in one sheet with a `type`
// column. The two helpers split the union for rendering.
function getAnstellerRunden() {
  return (state.currentEvent?.squads || []).filter((s) => (s.type || "ansteller") === "ansteller");
}
function getTreibergruppen() {
  return (state.currentEvent?.squads || []).filter((s) => s.type === "treiber");
}

// Filter posts to only those whose `area` matches one of the event's
// Teilgebiete. For NPA-Müritz the corresponding areas (Babke, Langenhagen,
// Schwarzenhof) currently have no posts, so this naturally returns empty
// and forces Klettersitz with manual coordinates.
function getKanzelnForEvent() {
  if (!state.currentEvent) return [];
  const teilgebiete = new Set(
    (state.currentEvent.event.teilgebiet || "").split(/\s*,\s*/).filter(Boolean)
  );
  return state.posts.filter((p) => teilgebiete.has(p.area))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

const ROMAN_NUMERALS = ["I","II","III","IV","V","VI","VII","VIII","IX","X",
                        "XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"];
function toRoman(n) { return ROMAN_NUMERALS[n - 1] || String(n); }

function fromRoman(s) {
  const map = { I:1, V:5, X:10, L:50, C:100, D:500, M:1000 };
  const str = String(s || "").toUpperCase();
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    const cur = map[str[i]] || 0;
    const next = map[str[i+1]] || 0;
    if (next && cur < next) result -= cur;
    else result += cur;
  }
  return result;
}

function nextGroupName(squads, prefix) {
  let max = 0;
  for (const s of squads) {
    const re = new RegExp("^" + prefix + "\\s+([IVXLCDM]+|\\d+)", "i");
    const m = re.exec(s.name || "");
    if (!m) continue;
    const num = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : fromRoman(m[1]);
    if (num) max = Math.max(max, num);
  }
  return prefix + " " + toRoman(max + 1);
}

function nextAnstellerRundeName() {
  return nextGroupName(getAnstellerRunden(), "Ansteller Runde");
}

function nextTreibergruppeName() {
  return nextGroupName(getTreibergruppen(), "Treibergruppe");
}

// Convert legacy "Ansteller Runde 1" to Roman ("Ansteller Runde I") at
// display time so older test squads pick up the new style without a backend
// migration.
function displayRundeName(name) {
  const s = String(name || "").trim();
  const m = /^(Ansteller Runde)\s+(\d+)\s*$/i.exec(s);
  if (m) return m[1] + " " + toRoman(parseInt(m[2], 10));
  return s || "Ansteller Runde";
}

function renderSquads() {
  const wrap = $("#squads-list");
  const empty = $("#squads-empty");
  const hint = $("#squads-hint");
  const squads = getAnstellerRunden();
  if (!squads.length) {
    wrap.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    const ctx = squadRenderContext();
    wrap.innerHTML = squads.map((sq) => renderSquadTile(sq, ctx)).join("");
    // Kein Listener je Kachel mehr — die Weiterleitung sitzt in wireRunden auf
    // dem Container, der statisch im Markup steht.
  }
  // Note if no Kanzeln are available (NPA-Müritz or no Teilgebiet picked).
  const kanzeln = getKanzelnForEvent();
  if (state.posts.length && !kanzeln.length) {
    hint.textContent = 'Keine Kanzeln im gewählten Teilgebiet hinterlegt — bitte „Klettersitz" mit Koordinaten verwenden.';
  } else {
    hint.textContent = "";
  }
  renderTreibergruppen();
  // Recolor the Revierkarte — a post turns orange the moment its
  // post_id shows up in a squad position.
  renderPlanMap();
}

// Treibergruppen — same tile layout but a different tint and the leader
// is a Hundeführer (not an Ansteller). Members are Treiber, no Kanzeln.
function renderTreibergruppen() {
  const wrap = $("#treiber-list");
  const empty = $("#treiber-empty");
  const hint = $("#treiber-hint");
  const groups = getTreibergruppen();
  if (!groups.length) {
    wrap.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    const ctx = squadRenderContext();
    wrap.innerHTML = groups.map((sq) => renderTreiberTile(sq, ctx)).join("");
  }
  const candidates = getTreibergruppeCandidates();
  if (!candidates.length) {
    hint.textContent = "Noch keine Zusagen als Treiber oder Hundeführer — eine Treibergruppe braucht mindestens einen.";
  } else {
    hint.textContent = "";
  }
}

function displayTreiberName(name) {
  const s = String(name || "").trim();
  const m = /^(Treibergruppe)\s+(\d+)\s*$/i.exec(s);
  if (m) return m[1] + " " + toRoman(parseInt(m[2], 10));
  return s || "Treibergruppe";
}

// Einmal je Render gebaut, statt bei 20 Kacheln × 60 Positionen einzeln
// nachzuschlagen. Denselben Index braucht später die Spalte "Einteilung".
function squadRenderContext() {
  const postsById = new Map((state.posts || []).map((p) => [p.id, p]));
  const einsatz = new Map();   // Name (klein) -> [Gruppenname, …]
  for (const sq of (state.currentEvent?.squads || [])) {
    const gruppe = sq.type === "treiber" ? displayTreiberName(sq.name) : displayRundeName(sq.name);
    for (const p of (sq.positions || [])) {
      if (!p || !p.hunter) continue;
      const k = p.hunter.toLowerCase();
      if (!einsatz.has(k)) einsatz.set(k, []);
      einsatz.get(k).push(gruppe);
    }
  }
  return { postsById, einsatz, belegt: assignedPostInfo() };
}

// Anzeigename eines Standes. Erst der aktuelle Name aus der Standliste — eine
// umbenannte Kanzel soll neu heißen —, dann der beim Speichern
// mitgeschriebene. Die Reihenfolge gilt NUR fürs Anzeigen: collectPositions
// schreibt weiter post_name mit, weil standkarte.js darauf ohne Rückfall
// zugreift.
function standLabel(pos, postsById) {
  if (!pos) return "";
  if (pos.type === "klettersitz") {
    const ohneKoord = pos.lat === "" || pos.lng === "" || !Number.isFinite(Number(pos.lat));
    return (pos.label || "Klettersitz") + (ohneKoord ? " (ohne Koordinaten)" : "");
  }
  if (pos.post_id) {
    const p = postsById.get(pos.post_id);
    if (p && p.name) return p.name;
  }
  return pos.post_name || "";
}

// Was an einer Position auffällt, ohne sie zu verhindern: derselbe Jäger in
// zwei Gruppen, oder zwei Schützen auf derselben Kanzel. Weder Frontend noch
// Backend schließen das aus, und das soll auch so bleiben — es kann Gründe
// geben. Aber sichtbar muss es sein.
function positionsWarnung(pos, ctx, eigeneGruppe) {
  const kurz = [];
  const lang = [];
  // Ohne Set stünde jede Gruppe so oft da, wie der Jäger in ihr Positionen
  // hat — in der Test Jagd las sich das als "Demo Süd, Demo Süd, Demo Mitte,
  // Demo Mitte, …" und war unlesbar.
  const andere = [...new Set(ctx.einsatz.get((pos.hunter || "").toLowerCase()) || [])]
    .filter((g) => g !== eigeneGruppe);
  if (andere.length) {
    kurz.push(andere.length <= 2
      ? "auch in " + andere.join(" und ")
      : `auch in ${andere.length} weiteren Gruppen`);
    lang.push("Steht außerdem in: " + andere.join(", "));
  }
  if (pos.type === "kanzel" && pos.post_id) {
    const drauf = [...new Set((ctx.belegt.get(pos.post_id) || [])
      .filter((e) => e.hunter !== pos.hunter).map((e) => e.hunter))];
    if (drauf.length) {
      kurz.push("Stand doppelt belegt");
      lang.push("Auf demselben Stand: " + drauf.join(", "));
    }
  }
  return { kurz: kurz.join(" · "), lang: lang.join(" — ") };
}

function renderTreiberTile(squad, ctx) {
  const positions = (squad.positions || []).filter((p) => p && p.hunter);
  // Look up each member's role from the accepted-hunters list so the
  // tile can show "Klaus (Treiber)" vs "Bernd (Hundeführer)".
  const accepted = state.currentEvent?.hunters || [];
  const roleOf = (name) => {
    const h = accepted.find((x) => x.hunter === name);
    return h ? (h.role || "") : "";
  };
  const gruppe = displayTreiberName(squad.name);
  // Treiber laufen hinter dem Hundeführer her und stehen nicht auf
  // nummerierten Kanzeln — dort steht kein Stand und auch kein "ohne Stand".
  const members = positions.map((p, i) => renderTileMember({
    name: p.hunter,
    roleLabel: i === 0 ? "Treiberführer" : roleOf(p.hunter),
    isLeader: i === 0,
    stand: null,
    warn: positionsWarnung(p, ctx, gruppe),
  })).join("");
  const sp = squad.start_pos;
  let startLine = "";
  if (sp) {
    if (sp.label) {
      startLine = `<span class="squad-tile-start">📍 ${escapeHtml(sp.label)}</span>`;
    } else if (sp.lat !== "" && sp.lng !== "") {
      startLine = `<span class="squad-tile-start">📍 ${Number(sp.lat).toFixed(4)}, ${Number(sp.lng).toFixed(4)}</span>`;
    }
  }
  return `
    <button type="button" class="squad-tile treiber-tile" data-sid="${escapeHtml(squad.id)}">
      <span class="squad-tile-name">${escapeHtml(displayTreiberName(squad.name))}</span>
      ${startLine}
      ${positions.length
        ? `<div class="tile-members">${members}</div>`
        : '<span class="squad-tile-ansteller muted">Noch leer — Mitglieder hinzufügen</span>'}
    </button>
  `;
}

// Compact tile in the grid. Click → openSquadEditor. Lists every member
// by name (leader bolded) so the overview reads like a roster at a glance.
function renderSquadTile(squad, ctx) {
  const positions = (squad.positions || []).filter((p) => p && p.hunter);
  const gruppe = displayRundeName(squad.name);
  const members = positions.map((p, i) => renderTileMember({
    name: p.hunter,
    roleLabel: i === 0 ? "Ansteller" : "",
    isLeader: i === 0,
    stand: standLabel(p, ctx.postsById),
    warn: positionsWarnung(p, ctx, gruppe),
  })).join("");
  const ohneStand = positions.filter((p) => !standLabel(p, ctx.postsById)).length;
  // Die Zahl, auf die man bei 60 Jägern schaut.
  const kopf = positions.length
    ? `${positions.length} ${positions.length === 1 ? "Schütze" : "Schützen"}` +
      (ohneStand ? ` · ${ohneStand} ohne Stand` : "")
    : "";
  return `
    <button type="button" class="squad-tile" data-sid="${escapeHtml(squad.id)}">
      <span class="squad-tile-name">${escapeHtml(gruppe)}</span>
      ${kopf ? `<span class="squad-tile-count${ohneStand ? " has-offen" : ""}">${escapeHtml(kopf)}</span>` : ""}
      ${positions.length
        ? `<div class="tile-members">${members}</div>`
        : '<span class="squad-tile-ansteller muted">Noch leer — Schützen hinzufügen</span>'}
    </button>
  `;
}

// stand: null heißt "hat keinen und braucht keinen" (Treiber). Ein leerer
// String heißt "sollte einen haben, hat aber keinen" — und das ist die
// wichtigste Angabe der Kachel, nicht eine Leerstelle.
function renderTileMember({ name, roleLabel, isLeader, stand, warn }) {
  const standZeile = stand === null ? ""
    : (stand
        ? `<span class="tile-member-stand">${escapeHtml(stand)}</span>`
        : '<span class="tile-member-stand tile-member-stand--offen">ohne Stand</span>');
  return `<div class="tile-member${isLeader ? " tile-member--leader" : ""}">` +
         `<span class="tile-member-name">${escapeHtml(name)}</span>` +
         (roleLabel ? `<span class="tile-member-role">${escapeHtml(roleLabel)}</span>` : "") +
         standZeile +
         (warn && warn.kurz
            ? `<span class="tile-member-warn" title="${escapeHtml(warn.lang)}">${escapeHtml(warn.kurz)}</span>`
            : "") +
         `</div>`;
}

let editingSquadId = null;

function openSquadEditor(sid) {
  const squad = (state.currentEvent?.squads || []).find((s) => s.id === sid);
  if (!squad) return;
  editingSquadId = sid;
  if (squad.type === "treiber") {
    return openTreiberEditor(squad);
  }
  return openAnstellerEditor(squad);
}

function openAnstellerEditor(squad) {
  $("#squad-edit-title").textContent = displayRundeName(squad.name);
  const body = $("#squad-edit-body");
  const accepted = getAcceptedHunters();
  // Always show at least one Schütze row so the Ansteller is visible.
  const positions = (squad.positions && squad.positions.length) ? squad.positions : [{ hunter: "" }];
  body.innerHTML = `
    <p class="squad-modal-hint">
      Reihe 1 ist <strong>der Ansteller</strong> — er bekommt seinen Stand wie jeder andere Schütze.
    </p>
    <div class="schuetzen-list" id="modal-schuetzen-list">
      ${positions.map((p, i) => renderSchuetzeRow(p, i, accepted)).join("")}
    </div>
    <button class="ghost-btn" type="button" id="modal-add-schuetze">+ Schütze hinzufügen</button>
    <label class="squad-field">
      <span class="squad-field-label">Bemerkung <span class="muted">(optional)</span></span>
      <textarea id="modal-squad-briefing" rows="2">${escapeHtml(squad.briefing || "")}</textarea>
    </label>
    <div class="modal-danger-row">
      <button id="modal-squad-delete" class="ghost-btn ghost-btn--danger" type="button">Runde löschen</button>
    </div>
  `;
  body.querySelectorAll(".schuetze-row").forEach(wireSchuetzeRow);
  $("#modal-add-schuetze").addEventListener("click", () => {
    const list = $("#modal-schuetzen-list");
    const idx = list.querySelectorAll(".schuetze-row").length;
    list.insertAdjacentHTML("beforeend", renderSchuetzeRow(null, idx, accepted));
    wireSchuetzeRow(list.lastElementChild);
  });
  $("#modal-squad-delete").addEventListener("click", () => deleteEditingSquad(squad));
  $("#squad-edit-backdrop").hidden = false;
  $("#squad-edit-modal").hidden = false;
}

function openTreiberEditor(squad) {
  $("#squad-edit-title").textContent = displayTreiberName(squad.name);
  const body = $("#squad-edit-body");
  const candidates = getTreibergruppeCandidates();
  const positions = (squad.positions && squad.positions.length) ? squad.positions : [{ hunter: "" }];
  const sp = squad.start_pos || {};
  const lat = sp.lat !== undefined && sp.lat !== "" ? Number(sp.lat).toFixed(6) : "";
  const lng = sp.lng !== undefined && sp.lng !== "" ? Number(sp.lng).toFixed(6) : "";
  body.innerHTML = `
    <p class="squad-modal-hint">
      Reihe 1 ist <strong>der Treiberführer</strong> (Gruppenleiter). Mitglieder
      darunter können <strong>Treiber oder Hundeführer</strong> sein — der
      Treiberführer selbst muss kein Hundeführer sein.
    </p>

    <fieldset class="ev-fieldset start-pos-fieldset">
      <legend>Startposition <span class="muted">(von wo die Gruppe startet)</span></legend>
      <div class="sr-coords-grid">
        <input type="number" id="start-pos-lat" step="0.000001" inputmode="decimal" value="${lat}" placeholder="Breitengrad" />
        <input type="number" id="start-pos-lng" step="0.000001" inputmode="decimal" value="${lng}" placeholder="Längengrad" />
      </div>
      <div class="sr-coords-grid">
        <input type="text" id="start-pos-label" value="${escapeHtml(sp.label || "")}" maxlength="60" placeholder="Bezeichnung (z.B. Forsthalle)" />
        <button class="ghost-btn" type="button" id="start-pos-here" title="Aktuelle Position">📍</button>
      </div>
    </fieldset>

    <div class="schuetzen-list" id="modal-treiber-list">
      ${positions.map((p, i) => renderTreiberRow(p, i, candidates)).join("")}
    </div>
    <button class="ghost-btn" type="button" id="modal-add-treiber">+ Mitglied hinzufügen</button>
    <label class="squad-field">
      <span class="squad-field-label">Bemerkung <span class="muted">(optional)</span></span>
      <textarea id="modal-squad-briefing" rows="2">${escapeHtml(squad.briefing || "")}</textarea>
    </label>
    <div class="modal-danger-row">
      <button id="modal-squad-delete" class="ghost-btn ghost-btn--danger" type="button">Gruppe löschen</button>
    </div>
  `;
  body.querySelectorAll(".treiber-row").forEach(wireTreiberRow);
  $("#modal-add-treiber").addEventListener("click", () => {
    const list = $("#modal-treiber-list");
    const idx = list.querySelectorAll(".treiber-row").length;
    list.insertAdjacentHTML("beforeend", renderTreiberRow(null, idx, candidates));
    wireTreiberRow(list.lastElementChild);
  });
  $("#start-pos-here").addEventListener("click", () => {
    if (!navigator.geolocation) { showToast("Standort nicht verfügbar", "error"); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      $("#start-pos-lat").value = pos.coords.latitude.toFixed(6);
      $("#start-pos-lng").value = pos.coords.longitude.toFixed(6);
      showToast("Position übernommen");
    }, (err) => showToast("Standort: " + err.message, "error", 4000),
    { enableHighAccuracy: true, timeout: 8000 });
  });
  $("#modal-squad-delete").addEventListener("click", () => deleteEditingSquad(squad));
  $("#squad-edit-backdrop").hidden = false;
  $("#squad-edit-modal").hidden = false;
}

function collectTreiberStartPos() {
  const latStr = $("#start-pos-lat").value.trim();
  const lngStr = $("#start-pos-lng").value.trim();
  const label = $("#start-pos-label").value.trim();
  const lat = latStr ? Number(latStr) : null;
  const lng = lngStr ? Number(lngStr) : null;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  if (!hasCoords && !label) return null;
  return {
    lat: hasCoords ? lat : "",
    lng: hasCoords ? lng : "",
    label: label,
  };
}

// Treibergruppe row — hunter dropdown drawn from the unified Treiber /
// Hundeführer acceptance pool. Row 0 = Treiberführer (group leader),
// rows 1+ = members. Each option shows the hunter's role in parentheses
// so the organizer can see at a glance who brings dogs.
function renderTreiberRow(pos, idx, candidates) {
  const isLeader = idx === 0;
  const numLabel = isLeader ? "Treiberführer" : (idx + 1) + ".";
  const removeBtn = isLeader
    ? '<span class="sr-remove sr-remove-placeholder" aria-hidden="true"></span>'
    : '<button class="link-btn sr-remove" type="button" aria-label="Mitglied entfernen">×</button>';
  const emptyHint = isLeader
    ? '— Treiberführer wählen —'
    : '— Treiber oder Hundeführer wählen —';
  return `
    <div class="treiber-row schuetze-row${isLeader ? " schuetze-row--ansteller" : ""}" data-idx="${idx}">
      <div class="sr-line sr-hunter-line">
        <span class="sr-num">${escapeHtml(numLabel)}</span>
        <select class="tr-hunter sr-hunter">
          <option value="">${escapeHtml(emptyHint)}</option>
          ${candidates.map((h) => {
            const sel = (h.hunter === (pos && pos.hunter)) ? " selected" : "";
            return `<option value="${escapeHtml(h.hunter)}"${sel}>${escapeHtml(h.hunter)} (${escapeHtml(h.role)})</option>`;
          }).join("")}
        </select>
        ${removeBtn}
      </div>
      ${candidates.length === 0 ? '<p class="sr-empty muted">Noch keine Zusage als Treiber oder Hundeführer.</p>' : ""}
    </div>
  `;
}

function wireTreiberRow(row) {
  if (!row) return;
  const removeBtn = row.querySelector("button.sr-remove");
  if (removeBtn) removeBtn.addEventListener("click", () => row.remove());
}

function collectTreiberPositions(container) {
  return Array.from(container.querySelectorAll(".treiber-row")).map((row) => {
    const hunter = row.querySelector(".tr-hunter").value.trim();
    return hunter ? { hunter } : null;
  }).filter(Boolean);
}

function closeSquadEditor() {
  editingSquadId = null;
  $("#squad-edit-modal").hidden = true;
  $("#squad-edit-backdrop").hidden = true;
}

async function saveEditingSquad() {
  if (!editingSquadId || !state.currentEvent) return;
  const squad = state.currentEvent.squads.find((s) => s.id === editingSquadId);
  if (!squad) return;
  const isTreiber = squad.type === "treiber";
  const positions = isTreiber
    ? collectTreiberPositions($("#squad-edit-body"))
    : collectPositions($("#squad-edit-body"));
  const ansteller = positions[0]?.hunter || "";
  const briefing = $("#modal-squad-briefing").value.trim();
  const start_pos = isTreiber ? collectTreiberStartPos() : null;

  // Optimistic UI: snapshot the old state, apply the new one locally,
  // close the modal immediately so the user isn't waiting on the
  // Apps Script round-trip. Roll back on failure.
  const prev = {
    ansteller: squad.ansteller,
    positions: squad.positions,
    briefing: squad.briefing,
    start_pos: squad.start_pos,
  };
  Object.assign(squad, { ansteller, positions, briefing, start_pos });
  renderSquads();
  closeSquadEditor();
  showToast("Speichere …");
  try {
    await postJson({
      action: "event-squad-save",
      id: squad.id,
      event_id: state.currentEvent.event.id,
      name: squad.name,
      ansteller,
      positions,
      briefing,
      type: squad.type || "ansteller",
      start_pos,
    });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    showToast("Gespeichert ✓");
  } catch (err) {
    Object.assign(squad, prev);
    renderSquads();
    showToast(err.message || "Fehler beim Speichern", "error", 6000);
  }
}

async function deleteEditingSquad(squad) {
  const label = squad.type === "treiber"
    ? displayTreiberName(squad.name)
    : displayRundeName(squad.name);
  if (!confirm(`„${label}" wirklich löschen? Die übrigen werden anschließend neu durchnummeriert.`)) return;
  try {
    await postJson({ action: "event-squad-delete", id: squad.id });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    closeSquadEditor();
    await loadEventDetail(state.currentEvent.event.id);
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  }
}

function hunterSelectHtml(accepted, currentValue) {
  const opts = accepted.map((h) => {
    const sel = (h.hunter === currentValue) ? " selected" : "";
    return `<option value="${escapeHtml(h.hunter)}"${sel}>${escapeHtml(h.hunter)}</option>`;
  }).join("");
  return `<option value="">— Jäger wählen —</option>${opts}`;
}

function positionSelectHtml(currentPosition) {
  const kanzeln = getKanzelnForEvent();
  const currentValue = currentPosition && currentPosition.type === "kanzel"
    ? "kanzel:" + (currentPosition.post_id || "")
    : currentPosition && currentPosition.type === "klettersitz"
      ? "klettersitz" : "";
  // Append the type abbreviation when not a plain Kanzel, so the
  // organizer sees at a glance whether a stand is a Drückjagdbock or
  // a Leiter.
  const typeBadge = (postType) => {
    if (postType === "Drückjagdbock") return " · DJB";
    if (postType === "Leiter") return " · Leiter";
    return "";
  };
  const groupOptions = kanzeln.map((p) => {
    const v = "kanzel:" + p.id;
    const sel = (v === currentValue) ? " selected" : "";
    return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(p.name)} (${escapeHtml(p.area)})${escapeHtml(typeBadge(p.type))}</option>`;
  }).join("");
  const selKlettersitz = (currentValue === "klettersitz") ? " selected" : "";
  return `
    <option value="">— Position wählen —</option>
    ${kanzeln.length ? `<optgroup label="Stand">${groupOptions}</optgroup>` : ""}
    <option value="klettersitz"${selKlettersitz}>Klettersitz (Koordinaten)</option>
  `;
}

function renderSchuetzeRow(pos, idx, accepted) {
  const isKlettersitz = pos && pos.type === "klettersitz";
  const lat = pos && pos.lat !== undefined && pos.lat !== "" ? Number(pos.lat).toFixed(6) : "";
  const lng = pos && pos.lng !== undefined && pos.lng !== "" ? Number(pos.lng).toFixed(6) : "";
  const isAnsteller = idx === 0;
  // Row 1 is the Ansteller; the rest are regular Schützen, numbered from 2.
  const numLabel = isAnsteller ? "Ansteller" : (idx + 1) + ".";
  const removeBtn = isAnsteller
    ? '<span class="sr-remove sr-remove-placeholder" aria-hidden="true"></span>'
    : '<button class="link-btn sr-remove" type="button" aria-label="Schützen entfernen">×</button>';
  return `
    <div class="schuetze-row${isAnsteller ? " schuetze-row--ansteller" : ""}" data-idx="${idx}">
      <div class="sr-line sr-hunter-line">
        <span class="sr-num">${escapeHtml(numLabel)}</span>
        <select class="sr-hunter">${hunterSelectHtml(accepted, pos && pos.hunter)}</select>
        ${removeBtn}
      </div>
      <div class="sr-line sr-position-line">
        <select class="sr-position">${positionSelectHtml(pos)}</select>
      </div>
      <div class="sr-coords" ${isKlettersitz ? "" : "hidden"}>
        <div class="sr-coords-grid">
          <input type="number" class="sr-lat" step="0.000001" inputmode="decimal" value="${lat}" placeholder="Breitengrad" />
          <input type="number" class="sr-lng" step="0.000001" inputmode="decimal" value="${lng}" placeholder="Längengrad" />
        </div>
        <div class="sr-coords-grid">
          <input type="text" class="sr-label" value="${escapeHtml(pos && pos.label || "")}" maxlength="60" placeholder="Bezeichnung (optional)" />
          <button class="ghost-btn sr-here" type="button" title="Aktuelle Position">📍</button>
        </div>
      </div>
    </div>
  `;
}

function wireSchuetzeRow(row) {
  if (!row) return;
  // Ansteller row has no removable button (it's a placeholder span).
  const removeBtn = row.querySelector("button.sr-remove");
  if (removeBtn) removeBtn.addEventListener("click", () => row.remove());
  const posSel = row.querySelector(".sr-position");
  const coords = row.querySelector(".sr-coords");
  posSel.addEventListener("change", () => {
    coords.hidden = posSel.value !== "klettersitz";
  });
  const here = row.querySelector(".sr-here");
  if (here) {
    here.addEventListener("click", () => {
      if (!navigator.geolocation) { showToast("Standort nicht verfügbar", "error"); return; }
      navigator.geolocation.getCurrentPosition((pos) => {
        row.querySelector(".sr-lat").value = pos.coords.latitude.toFixed(6);
        row.querySelector(".sr-lng").value = pos.coords.longitude.toFixed(6);
        showToast("Position übernommen");
      }, (err) => showToast("Standort: " + err.message, "error", 4000),
      { enableHighAccuracy: true, timeout: 8000 });
    });
  }
}

function collectPositions(card) {
  const rows = card.querySelectorAll(".schuetze-row");
  const positions = [];
  rows.forEach((row) => {
    const hunter = row.querySelector(".sr-hunter").value.trim();
    if (!hunter) return; // skip empty rows
    const posVal = row.querySelector(".sr-position").value;
    if (posVal === "klettersitz") {
      const lat = row.querySelector(".sr-lat").value.trim();
      const lng = row.querySelector(".sr-lng").value.trim();
      const label = row.querySelector(".sr-label").value.trim();
      positions.push({
        hunter,
        type: "klettersitz",
        lat: lat ? Number(lat) : "",
        lng: lng ? Number(lng) : "",
        label,
      });
    } else if (posVal && posVal.startsWith("kanzel:")) {
      const post_id = posVal.slice("kanzel:".length);
      const post = state.posts.find((p) => p.id === post_id);
      positions.push({
        hunter,
        type: "kanzel",
        post_id,
        post_name: post ? post.name : "",
      });
    } else {
      // No position picked yet — keep the hunter so the row is preserved.
      positions.push({ hunter, type: "kanzel", post_id: "", post_name: "" });
    }
  });
  return positions;
}

async function addSquad() {
  if (!state.currentEvent) return;
  const btn = $("#new-squad-btn");
  if (btn.disabled) return; // guard against double-click → duplicate squads
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Lege an …";
  try {
    await loadPostsIfNeeded();
    const accepted = getAcceptedHunters();
    if (!accepted.length) {
      showToast("Erst Zusagen einsammeln — Ansteller Runden brauchen mind. einen zugesagten Jäger.", "error", 5000);
      return;
    }
    const r = await postJson({
      action: "event-squad-save",
      event_id: state.currentEvent.event.id,
      name: nextAnstellerRundeName(),
      ansteller: "",
      positions: [],
      briefing: "",
      type: "ansteller",
    });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    await loadEventDetail(state.currentEvent.event.id);
    // Open the editor for the just-created Runde so the user can pick the
    // Ansteller and positions right away.
    openSquadEditor(r.id);
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function addTreibergruppe() {
  if (!state.currentEvent) return;
  const btn = $("#new-treiber-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Lege an …";
  try {
    if (!getTreibergruppeCandidates().length) {
      showToast("Erst Zusagen als Treiber oder Hundeführer einsammeln.", "error", 5000);
      return;
    }
    const r = await postJson({
      action: "event-squad-save",
      event_id: state.currentEvent.event.id,
      name: nextTreibergruppeName(),
      ansteller: "",
      positions: [],
      briefing: "",
      type: "treiber",
    });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    await loadEventDetail(state.currentEvent.event.id);
    openSquadEditor(r.id);
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// ---------- Revierkarte (plan map) ----------
// A satellite cutout at the top of the hunt overview. Every Stand in the
// event's Revier is a marker — yellow while free, darker orange once a
// squad position references it. A Google-Maps-style live blue dot lets the
// Ansteller orient himself in the field.

const PLAN_MARKER_FREE = "#f5c518";   // yellow — Stand not yet assigned
// Fallback red for an assigned Stand whose Runde can't be placed on the
// south→north gradient — shouldn't happen in practice (see anstellerRundeColors).
const PLAN_MARKER_TAKEN = "#e22219";

const planMap = {
  instance: null,
  markers: new Map(),   // post_id → google.maps.Marker (fixed Stände)
  ksMarkers: [],         // markers for Klettersitz positions (free coords)
  infoWindow: null,
  loadPromise: null,
  fittedFor: null,       // event id the bounds were last fitted to
  geoWatchId: null,
  geoMarker: null,
  geoCircle: null,
};

// Load the Google Maps JS API on demand. Mirrors app.js: no loading=async,
// because we use the synchronous google.maps.Map / Marker globals.
function loadPlanMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    const existing = document.getElementById("plan-gmaps-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Maps")));
      return;
    }
    const s = document.createElement("script");
    s.id = "plan-gmaps-script";
    s.src = "https://maps.googleapis.com/maps/api/js?key=" +
            encodeURIComponent(cfg.GOOGLE_MAPS_API_KEY) + "&v=weekly";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Google Maps konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
}

// Creates the map once; later calls just hand back the existing instance.
function ensurePlanMap() {
  if (planMap.instance) return Promise.resolve(planMap.instance);
  if (planMap.loadPromise) return planMap.loadPromise;
  planMap.loadPromise = loadPlanMapsScript().then(() => {
    planMap.instance = new google.maps.Map($("#plan-map"), {
      // Nur bis fitBounds greift — die Karte wird erst gezeigt, wenn es Stände
      // gibt, der Startpunkt ist also nie zu sehen. Vorher stand hier
      // Peenwerders Mitte ein zweites Mal.
      center: { lat: 51.2, lng: 10.4 },
      zoom: 6,
      mapTypeId: "hybrid",
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: "greedy",
      zoomControl: true,
      // Zoom widget up top so it clears the locate button bottom-right.
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
    });
    planMap.infoWindow = new google.maps.InfoWindow();
    return planMap.instance;
  });
  return planMap.loadPromise;
}

// The set of Teilgebiet names whose Stände should appear for this event.
// Eine Jagd in irgendeinem Teilgebiet eines Reviers zeigt dessen ganzen
// Ausschnitt, nicht nur die angehakten Gebiete — der „PN-Werder-Ausschnitt",
// den Simon wollte. Das ist Absicht und soll so bleiben.
//
// Die Zuordnung kam bis August 2026 aus einer eigenen Kopie hier im Code,
// obwohl diese Seite reviere-def.js längst lädt. Und die Kopie war anders
// verschlüsselt als das Original ("NPA-Müritz" gegen key "mueritz").
function eventRevierAreas(event) {
  const tg = (event.teilgebiet || "").split(/\s*,\s*/).filter(Boolean);
  const areas = new Set();
  for (const a of tg) {
    const revier = window.preyeRevierForArea(a);
    if (revier) revier.areas.forEach((x) => areas.add(x));
  }
  return areas;
}

// Fixed Stände (Kanzeln / DJB / Leitern) shown on the cutout for this event.
function postsForPlanMap() {
  if (!state.currentEvent) return [];
  const areas = eventRevierAreas(state.currentEvent.event);
  return state.posts.filter((p) =>
    areas.has(p.area) && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
}

// post_id → [{ hunter, runde }] for every Stand a squad position sits on.
function assignedPostInfo() {
  const map = new Map();
  for (const sq of (state.currentEvent?.squads || [])) {
    const runde = sq.type === "treiber"
      ? displayTreiberName(sq.name) : displayRundeName(sq.name);
    for (const p of (sq.positions || [])) {
      if (p && p.type === "kanzel" && p.post_id) {
        if (!map.has(p.post_id)) map.set(p.post_id, []);
        map.get(p.post_id).push({ hunter: p.hunter || "", runde, squadId: sq.id });
      }
    }
  }
  return map;
}

// Klettersitz positions (hunter assigned to free coordinates) — always
// "taken", drawn as orange markers so the cutout is complete.
function klettersitzPositions() {
  const out = [];
  for (const sq of (state.currentEvent?.squads || [])) {
    const runde = sq.type === "treiber"
      ? displayTreiberName(sq.name) : displayRundeName(sq.name);
    for (const p of (sq.positions || [])) {
      if (!p || p.type !== "klettersitz") continue;
      const lat = Number(p.lat), lng = Number(p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || p.lat === "" || p.lng === "") continue;
      out.push({ lat, lng, label: p.label || "", hunter: p.hunter || "", runde, squadId: sq.id });
    }
  }
  return out;
}

// --- Per-Runde red gradient ------------------------------------------------
// Each Ansteller Runde gets one distinct shade of red. The shades form a
// gradient by how far north the Runde sits: the southernmost Runde is the
// darkest red, lightening the further north a Runde lies.

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// t: 0 = southernmost (darkest) … 1 = northernmost (lightest).
function redGradient(t) {
  return hslToHex(359, 85, 37 + t * 34); // bright red, lightness 37 % … 71 %
}

// Mean latitude of an Ansteller Runde's placed Schützen (Kanzeln +
// Klettersitze) — null when nothing is placed on the map yet.
function rundeLatitude(squad) {
  const lats = [];
  for (const p of (squad.positions || [])) {
    if (!p) continue;
    if (p.type === "kanzel" && p.post_id) {
      const post = state.posts.find((x) => x.id === p.post_id);
      if (post && Number.isFinite(post.lat)) lats.push(post.lat);
    } else if (p.type === "klettersitz" && p.lat !== "") {
      const lat = Number(p.lat);
      if (Number.isFinite(lat)) lats.push(lat);
    }
  }
  return lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
}

// squad.id → red hex for every Ansteller Runde with at least one Schütze
// placed. Ranked south → north; the gradient is spread across the ranking.
function anstellerRundeColors() {
  const ranked = getAnstellerRunden()
    .map((sq) => ({ id: sq.id, lat: rundeLatitude(sq) }))
    .filter((r) => r.lat != null)
    .sort((a, b) => a.lat - b.lat); // south (low latitude) first
  const colors = new Map();
  ranked.forEach((r, i) => {
    const t = ranked.length > 1 ? i / (ranked.length - 1) : 0;
    colors.set(r.id, redGradient(t));
  });
  return colors;
}

function planMarkerIcon(fillColor, prominent) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: prominent ? 2.2 : 1.4,
    scale: prominent ? 8 : 6,
  };
}

// Decide whether the section is shown and, if so, (re)draw it. Safe to call
// repeatedly — it's the single entry point hooked into renderSquads().
function renderPlanMap() {
  const section = $("#event-map-section");
  if (!section || !state.currentEvent) return;
  const placeholder = $("#plan-map-placeholder");
  const wrap = $("#plan-map-wrap");
  section.hidden = false;

  const showPlaceholder = (msg) => {
    wrap.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = msg;
  };

  if (!cfg.GOOGLE_MAPS_API_KEY || cfg.GOOGLE_MAPS_API_KEY.startsWith("PASTE")) {
    showPlaceholder("Karte nicht verfügbar — config.js fehlt.");
    return;
  }
  if (!postsForPlanMap().length) {
    showPlaceholder("Für dieses Revier ist noch kein Kartenausschnitt mit Ständen hinterlegt.");
    return;
  }
  placeholder.hidden = true;
  wrap.hidden = false;
  ensurePlanMap()
    .then(drawPlanMap)
    .catch(() => showPlaceholder("Karte konnte nicht geladen werden."));
}

// Reads current state fresh on every call, so an optimistic squad save
// recolors instantly without re-fetching anything.
function drawPlanMap() {
  const map = planMap.instance;
  if (!map || !state.currentEvent) return;
  const posts = postsForPlanMap();
  const assigned = assignedPostInfo();
  const wantIds = new Set(posts.map((p) => p.id));

  // Drop markers for Stände no longer in the cutout (event switched Revier).
  for (const [id, m] of planMap.markers) {
    if (!wantIds.has(id)) { m.setMap(null); planMap.markers.delete(id); }
  }
  // Each Ansteller Runde gets its own shade of red — darkest in the south,
  // lightening toward the north; a free Stand stays yellow.
  const rundeColors = anstellerRundeColors();
  const colorForSquad = (sid) => rundeColors.get(sid) || PLAN_MARKER_TAKEN;

  for (const post of posts) {
    const owners = assigned.get(post.id);
    const color = owners ? colorForSquad(owners[0].squadId) : PLAN_MARKER_FREE;
    let m = planMap.markers.get(post.id);
    if (!m) {
      m = new google.maps.Marker({
        position: { lat: post.lat, lng: post.lng },
        map,
        title: post.name,
      });
      m.addListener("click", () => openPlanPostInfo(post.id, m));
      planMap.markers.set(post.id, m);
    }
    m.setIcon(planMarkerIcon(color, !!owners));
    m.setZIndex(owners ? 1000 : 100);
  }

  // Klettersitz markers are cheap — rebuild them wholesale each draw.
  planMap.ksMarkers.forEach((m) => m.setMap(null));
  planMap.ksMarkers = [];
  for (const ks of klettersitzPositions()) {
    const m = new google.maps.Marker({
      position: { lat: ks.lat, lng: ks.lng },
      map,
      title: ks.label || "Klettersitz",
      icon: planMarkerIcon(colorForSquad(ks.squadId), true),
      zIndex: 1000,
    });
    m.addListener("click", () => openPlanKsInfo(ks, m));
    planMap.ksMarkers.push(m);
  }

  const takenCount = posts.filter((p) => assigned.has(p.id)).length
    + planMap.ksMarkers.length;
  renderPlanLegend(rundeColors, takenCount, posts.length);

  // Frame the cutout once per event — never on a recolor, so assigning a
  // hunter doesn't yank the map back from wherever the user panned it.
  const eid = state.currentEvent.event.id;
  if (planMap.fittedFor !== eid) {
    google.maps.event.trigger(map, "resize");
    const bounds = new google.maps.LatLngBounds();
    posts.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    planMap.ksMarkers.forEach((m) => bounds.extend(m.getPosition()));
    if (!bounds.isEmpty()) map.fitBounds(bounds, 36);
    planMap.fittedFor = eid;
  }
}

// Legend: a "Frei" swatch, then one swatch per Ansteller Runde in its own
// shade of red (south → north, so the row reads dark → light), then a count.
function renderPlanLegend(rundeColors, takenCount, totalCount) {
  const el = $("#plan-map-legend");
  if (!el) return;
  const item = (color, label) =>
    `<span class="plan-legend-item">` +
    `<span class="plan-dot" style="background:${color}"></span>` +
    `${escapeHtml(label)}</span>`;
  const byId = new Map(getAnstellerRunden().map((s) => [s.id, s]));
  const parts = [item(PLAN_MARKER_FREE, "Frei")];
  for (const [sid, color] of rundeColors) {
    const sq = byId.get(sid);
    if (sq) parts.push(item(color, displayRundeName(sq.name).replace(/^Ansteller\s+/, "")));
  }
  parts.push(
    `<span class="plan-legend-item plan-legend-count">` +
    `${takenCount} besetzt · ${totalCount} Stände</span>`
  );
  el.innerHTML = parts.join("");
}

function openPlanPostInfo(postId, marker) {
  const post = state.posts.find((p) => p.id === postId);
  if (!post) return;
  const assigned = assignedPostInfo().get(postId) || [];
  const typeBadge = post.type && post.type !== "Kanzel" ? " · " + post.type : "";
  let html = `<div class="plan-info"><strong>${escapeHtml(post.name)}</strong>` +
             `<div class="plan-info-sub">${escapeHtml(post.area)}${escapeHtml(typeBadge)}</div>`;
  if (assigned.length) {
    html += assigned.map((a) =>
      `<div class="plan-info-assign">${escapeHtml(a.hunter || "—")}` +
      `<span class="muted"> · ${escapeHtml(a.runde)}</span></div>`
    ).join("");
  } else {
    html += `<div class="plan-info-free muted">Frei — noch nicht zugewiesen</div>`;
  }
  html += `</div>`;
  planMap.infoWindow.setContent(html);
  planMap.infoWindow.open(planMap.instance, marker);
}

function openPlanKsInfo(ks, marker) {
  const title = ks.label ? escapeHtml(ks.label) : "Klettersitz";
  const html = `<div class="plan-info"><strong>${title}</strong>` +
    `<div class="plan-info-sub">Klettersitz</div>` +
    `<div class="plan-info-assign">${escapeHtml(ks.hunter || "—")}` +
    `<span class="muted"> · ${escapeHtml(ks.runde)}</span></div></div>`;
  planMap.infoWindow.setContent(html);
  planMap.infoWindow.open(planMap.instance, marker);
}

// Google-Maps-style live location. First tap starts a watchPosition() that
// keeps the blue dot + accuracy circle moving with the user; later taps
// just recenter on the latest fix.
function startPlanGeo() {
  if (!navigator.geolocation) {
    showToast("Standort wird vom Browser nicht unterstützt", "error");
    return;
  }
  if (!planMap.instance) return;
  const btn = $("#plan-locate-btn");

  if (planMap.geoWatchId != null) {
    if (planMap.geoMarker) {
      planMap.instance.panTo(planMap.geoMarker.getPosition());
      if (planMap.instance.getZoom() < 15) planMap.instance.setZoom(16);
    }
    return;
  }

  btn.classList.add("locating");
  let firstFix = true;
  planMap.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const acc = pos.coords.accuracy || 0;
      if (!planMap.geoMarker) {
        planMap.geoMarker = new google.maps.Marker({
          map: planMap.instance,
          position: ll,
          zIndex: 99999,
          title: "Mein Standort",
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#1a73e8",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
            scale: 7,
          },
        });
        planMap.geoCircle = new google.maps.Circle({
          map: planMap.instance,
          center: ll,
          radius: acc,
          strokeColor: "#1a73e8",
          strokeOpacity: 0.4,
          strokeWeight: 1,
          fillColor: "#1a73e8",
          fillOpacity: 0.12,
          clickable: false,
          zIndex: 99998,
        });
      } else {
        planMap.geoMarker.setPosition(ll);
        planMap.geoCircle.setCenter(ll);
        planMap.geoCircle.setRadius(acc);
      }
      btn.classList.remove("locating");
      btn.classList.add("active");
      if (firstFix) {
        firstFix = false;
        planMap.instance.panTo(ll);
        if (planMap.instance.getZoom() < 15) planMap.instance.setZoom(16);
      }
    },
    (err) => {
      stopPlanGeo();
      showToast("Standort: " + (err.message || "nicht verfügbar"), "error", 4000);
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 }
  );
}

function stopPlanGeo() {
  if (planMap.geoWatchId != null) {
    navigator.geolocation.clearWatch(planMap.geoWatchId);
    planMap.geoWatchId = null;
  }
  if (planMap.geoMarker) { planMap.geoMarker.setMap(null); planMap.geoMarker = null; }
  if (planMap.geoCircle) { planMap.geoCircle.setMap(null); planMap.geoCircle = null; }
  const btn = $("#plan-locate-btn");
  if (btn) btn.classList.remove("active", "locating");
}

// ---------- Wiring ----------

function addNsfRow(name, phone) {
  addNsfRowTo($("#nsf-rows"), name, phone);
}

// Reusable geolocation helper for any pair of lat/lng inputs.
function fillTreffpunktCoords(latSelector, lngSelector) {
  if (!navigator.geolocation) { showToast("Standort nicht verfügbar", "error"); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    $(latSelector).value = pos.coords.latitude.toFixed(6);
    $(lngSelector).value = pos.coords.longitude.toFixed(6);
    showToast("Position übernommen");
  }, (err) => showToast("Standort: " + err.message, "error", 4000),
  { enableHighAccuracy: true, timeout: 8000 });
}

function addNsfRowTo(target, name, phone) {
  const row = document.createElement("div");
  row.className = "nsf-row";
  row.innerHTML =
    `<input type="text" class="nsf-name" placeholder="Name" value="${escapeHtml(name || "")}" autocomplete="off" />` +
    `<input type="tel"  class="nsf-phone" placeholder="Mobil" inputmode="tel" value="${escapeHtml(phone || "")}" autocomplete="off" />` +
    `<button type="button" class="nsf-remove" aria-label="Entfernen">×</button>`;
  row.querySelector(".nsf-remove").addEventListener("click", () => row.remove());
  target.appendChild(row);
}

// ---------- Posts (Stände) manager ----------
// Lets the organizer add Kanzel / Drückjagdbock / Leiter posts to the
// system so they show up in the Ansteller-Runden Kanzel picker. Single
// add via form, or batch via CSV.

async function openPostsModal() {
  await loadPostsIfNeeded();
  fillPostAreaSelect();
  refreshPostsStats();
  $("#posts-backdrop").hidden = false;
  $("#posts-modal").hidden = false;
}

// Teilgebiets-Auswahl und CSV-Hilfetext aus der Revierliste erzeugen. Beim
// Öffnen, nicht beim Laden der Seite: ein Revier, das gerade in einem anderen
// Tab angelegt wurde, taucht so beim nächsten Öffnen auf.
function fillPostAreaSelect() {
  const sel = $("#post-area");
  if (sel) {
    const keep = sel.value;
    sel.innerHTML = '<option value="">— wählen —</option>' +
      window.PREYE_REVIERE
        .filter((r) => r.areas.length)
        .map((r) =>
          `<optgroup label="${escapeHtml(r.short)}">` +
          r.areas.map((a) =>
            `<option${a === keep ? " selected" : ""}>${escapeHtml(a)}</option>`).join("") +
          `</optgroup>`
        ).join("");
  }
  const list = $("#csv-area-list");
  if (list) list.textContent = window.preyeAllAreas().join(" · ") || "— noch keine Teilgebiete —";
  const ex = $("#csv-example");
  if (ex) {
    const first = window.preyeAllAreas()[0] || "Teilgebiet";
    ex.textContent = `Drückjagdbock,DJB 7,${first},53.6234,12.8423`;
  }
}

function closePostsModal() {
  $("#posts-modal").hidden = true;
  $("#posts-backdrop").hidden = true;
}

function refreshPostsStats() {
  const total = (state.posts || []).length;
  const byArea = {};
  for (const p of state.posts || []) {
    byArea[p.area] = (byArea[p.area] || 0) + 1;
  }
  const parts = Object.keys(byArea).sort().map((a) => `${a}: ${byArea[a]}`);
  $("#posts-stats").textContent = `${total} Stände gespeichert${parts.length ? " — " + parts.join(", ") : ""}.`;
}

async function submitNewPost(e) {
  e.preventDefault();
  const status = $("#post-add-status");
  status.textContent = "";
  const body = {
    action: "post-add",
    type: $("#post-type").value,
    name: $("#post-name").value.trim(),
    area: $("#post-area").value,
    lat: Number($("#post-lat").value),
    lng: Number($("#post-lng").value),
  };
  if (!body.name) { status.textContent = "Bezeichnung fehlt."; return; }
  if (!body.area) { status.textContent = "Teilgebiet wählen."; return; }
  if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    status.textContent = "Koordinaten ungültig."; return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await postJson(body);
    // Bootstrap (which carries posts) is cached — invalidate so the next
    // load picks up the new stand for everyone.
    invalidateCache("bootstrap-all");
    state.postsLoaded = false;
    await loadPostsIfNeeded();
    refreshPostsStats();
    e.target.reset();
    $("#post-type").value = "Kanzel";
    showToast("Stand angelegt ✓");
  } catch (err) {
    status.textContent = err.message || "Fehler beim Speichern";
  } finally {
    btn.disabled = false;
  }
}

async function handlePostCsv(file) {
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (!rows.length) { showToast("CSV ist leer.", "error"); return; }
  const first = rows[0].map((c) => c.toLowerCase().trim());
  const hasHeader = first.some((c) => c === "type" || c === "name" || c === "area" || c === "lat" || c === "lng");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  // Column mapping: default to positional [type, name, area, lat, lng].
  let typeIdx = 0, nameIdx = 1, areaIdx = 2, latIdx = 3, lngIdx = 4;
  if (hasHeader) {
    first.forEach((h, i) => {
      if (h === "type" || h.startsWith("typ")) typeIdx = i;
      else if (h === "name" || h.includes("name") || h.includes("bezeichnung")) nameIdx = i;
      else if (h === "area" || h.includes("teilgebiet") || h.includes("revier")) areaIdx = i;
      else if (h === "lat" || h.includes("breit")) latIdx = i;
      else if (h === "lng" || h === "long" || h.includes("läng")) lngIdx = i;
    });
  }
  const posts = dataRows.map((row) => ({
    type: (row[typeIdx] || "Kanzel").trim(),
    name: (row[nameIdx] || "").trim(),
    area: (row[areaIdx] || "").trim(),
    lat: Number((row[latIdx] || "").trim()),
    lng: Number((row[lngIdx] || "").trim()),
  })).filter((p) => p.name && p.area);
  if (!posts.length) {
    showToast("Keine gültigen Zeilen gefunden — erwartet: type, name, area, lat, lng.", "error", 5000);
    return;
  }
  try {
    const r = await postJson({ action: "posts-batch-add", posts });
    invalidateCache("bootstrap-all");
    state.postsLoaded = false;
    await loadPostsIfNeeded();
    refreshPostsStats();
    const parts = [`${r.added} angelegt`];
    if (r.errors && r.errors.length) parts.push(`${r.errors.length} Fehler`);
    showToast(parts.join(" · "), r.errors && r.errors.length ? "error" : null, 5000);
  } catch (err) {
    showToast(err.message || "CSV-Import fehlgeschlagen", "error");
  }
}

// ---------- Per-Schütze Infomails ----------
// One mail per accepted Schütze in every Ansteller Runde, containing the
// runde's roster (recipient bolded) + an embedded satellite map of the
// runde's stands. The map is fetched server-side from the Static-Maps API
// (key stored in Script Properties) and attached as an inline image.

// Open the preview modal: fetch a fully-rendered sample of the first
// eligible recipient's mail (map embedded as data: URI) and show it in
// an isolated iframe, then let the organizer send to everyone.
async function sendInfomails() {
  if (!state.currentEvent) return;
  const btn = $("#send-infomails-btn");
  if (btn.disabled) return;
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Lade …";
  try {
    // Frisch geöffnet: keine gemerkte Auswahl, Vorschau nimmt die erste
    // Ansteller-Runde.
    infomailAuswahl = null;
    const preview = await postJson({
      action: "event-infomails-preview",
      event_id: state.currentEvent.event.id,
    });
    if (preview.error) throw new Error(preview.error);
    openInfomailPreviewModal(preview);
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// Persisted across openings so re-opening the modal keeps your choice.
let infomailIncludeSchuetzen = true;
// Welche Gruppe die Vorschau gerade zeigt, und welche Haken gesetzt sind.
// Beides muss ein Nachladen überleben: das Umschalten der Vorschau baut das
// Fenster neu auf, und eine abgehakte Gruppe darf dabei nicht zurückspringen.
let infomailAuswahl = null;   // Set von squad-ids, null = noch nichts angefasst
let infomailVorschauLaeuft = false;
// Active object URL for the PDF preview, revoked on close to free memory.
let infomailPdfBlobUrl = null;

function infomailMakePdfBlobUrl(base64) {
  // Chrome/Firefox/Safari block data:application/pdf in iframes, but a
  // Blob URL of the same bytes renders fine. Decode base64 → bytes →
  // Blob → object URL.
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    return URL.createObjectURL(blob);
  } catch (err) {
    return null;
  }
}

// Renders the per-event Freigaben editor as a section in the event
// detail page (below the Kontakte block). The checkbox state auto-saves
// to the backend with a short debounce so the organizer can keep editing
// without hitting a Save button — the Infomail PDF picks up whatever's
// stored on the event row when it's eventually sent.
let freigabenSaveTimer = null;
function renderFreigabenBlock(event, matrix) {
  const el = $("#event-freigaben");
  if (!el || !Array.isArray(matrix) || !matrix.length) {
    if (el) { el.hidden = true; el.innerHTML = ""; }
    return;
  }
  const selectedSet = Array.isArray(event.freigaben) ? new Set(event.freigaben) : null;
  const isChecked = (key) => selectedSet ? selectedSet.has(key) : true;
  const speciesHtml = matrix.map((sp) => {
    const groupsHtml = sp.groups.map((g) => {
      const aksHtml = g.aks.map((ak) => {
        const key = `${sp.id}.${g.id}.${ak.id}`;
        const on = isChecked(key);
        return `<label class="freigabe-ak${on ? " freigabe-ak--on" : ""}">
          <input type="checkbox" class="freigabe-cb" data-key="${escapeHtml(key)}"${on ? " checked" : ""}>
          <span>${escapeHtml(ak.label)}</span>
        </label>`;
      }).join("");
      return `<div class="freigabe-group">
        <span class="freigabe-group-label">${escapeHtml(g.label)}</span>
        <div class="freigabe-aks">${aksHtml}</div>
      </div>`;
    }).join("");
    return `<div class="freigabe-species">
      <div class="freigabe-species-label">${escapeHtml(sp.label)}</div>
      ${groupsHtml}
    </div>`;
  }).join("");
  el.hidden = false;
  el.innerHTML = `
    <h3 class="ev-section-title">Freigaben
      <span class="muted">(erscheinen in der Infomail)</span>
      <span class="freigabe-save-status" id="freigabe-save-status"></span>
    </h3>
    <p class="muted freigabe-hint">
      Häkchen setzen, was am Jagdtag erlegt werden darf — wird automatisch gespeichert und in der nächsten Infomail-PDF verwendet.
    </p>
    ${speciesHtml}
    <p class="muted freigabe-foot">Raubwild ist generell nicht freigegeben · Leitbachen verschonen.</p>
  `;
  // Toggle the on/off pill class + schedule a debounced save.
  el.querySelectorAll(".freigabe-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const lbl = cb.closest(".freigabe-ak");
      if (lbl) lbl.classList.toggle("freigabe-ak--on", cb.checked);
      scheduleFreigabenSave(event.id);
    });
  });
}

function scheduleFreigabenSave(eventId) {
  clearTimeout(freigabenSaveTimer);
  const status = $("#freigabe-save-status");
  if (status) status.textContent = "Speichere …";
  freigabenSaveTimer = setTimeout(async () => {
    const selected = Array.from(document.querySelectorAll(".freigabe-cb"))
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.key);
    try {
      await postJson({
        action: "event-freigaben-save",
        event_id: eventId,
        freigaben: selected,
      });
      // Mirror locally so the next loadEventDetail doesn't blank the
      // current selection during a stale-while-revalidate refresh.
      if (state.currentEvent && state.currentEvent.event.id === eventId) {
        state.currentEvent.event.freigaben = selected;
      }
      invalidateCache("event-detail", { id: eventId });
      if (status) {
        status.textContent = "Gespeichert ✓";
        setTimeout(() => { if (status) status.textContent = ""; }, 1500);
      }
    } catch (err) {
      if (status) status.textContent = "Fehler: " + (err.message || err);
    }
  }, 600);
}

// "14.12., 19:30" — kurz genug für eine Zeile in der Auswahlliste.
function formatDateTimeShort(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("de-DE", {
    day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function openInfomailPreviewModal(preview) {
  const body = $("#infomail-body");
  const warns = [];
  if (!preview.has_maps_key) {
    warns.push('⚠ Kein Karten-Key gesetzt (Geoapify oder Google) — die Mails gehen ohne Karte raus.');
  }
  if (preview.no_email && preview.no_email.length) {
    warns.push("Wird übersprungen (keine E-Mail / nicht im Roster): " + preview.no_email.join(", "));
  }
  if (preview.not_accepted && preview.not_accepted.length) {
    warns.push("Wird übersprungen (noch keine Zusage): " + preview.not_accepted.join(", "));
  }
  const warnsHtml = warns.length
    ? '<div class="warning-banner">' + warns.map((w) => escapeHtml(w)).join("<br>") + "</div>"
    : "";

  // Cache counts on the modal so the checkbox handler can recompute the
  // displayed recipient line + send-button label without another fetch.
  const fullCount = preview.recipients || 0;
  const anstellerOnlyCount = preview.ansteller_recipients || 0;

  // Wer bekommt eine? Alle vorausgewählt, abhaken statt anhaken — der übliche
  // Fall ist "alle", und das Nachfassen an eine einzelne Gruppe ist die
  // Ausnahme. Der Nachweis steht daneben, damit man beim zweiten Mal sieht,
  // wen man schon angeschrieben hat.
  const gruppen = preview.gruppen || [];
  const gruppenHtml = gruppen.length ? `
    <div class="infomail-section">
      <div class="infomail-section-heading">📬 Wer bekommt eine?</div>
      ${gruppen.map((g) => {
        const wann = g.infomail_sent_at
          ? `zuletzt ${formatDateTimeShort(g.infomail_sent_at)}${g.infomail_count > 1 ? ` · ${g.infomail_count}×` : ""}`
          : "noch nicht verschickt";
        // Angehakt: die gemerkte Auswahl, sonst alles mit Empfängern.
        const an = infomailAuswahl ? infomailAuswahl.has(g.id) : !!g.recipients;
        // Die Zeile ist ein div und kein label mehr: ein Knopf in einem
        // label schaltet beim Klick das Kästchen mit um.
        const cbId = `infomail-cb-${escapeHtml(g.id)}`;
        const gezeigt = String(g.id) === String(preview.sample_squad_id || "");
        return `<div class="infomail-gruppe${g.recipients ? "" : " infomail-gruppe--leer"}${gezeigt ? " infomail-gruppe--gezeigt" : ""}">
          <input type="checkbox" id="${cbId}" class="infomail-gruppe-cb" value="${escapeHtml(g.id)}"
                 ${an ? "checked" : ""} ${g.recipients ? "" : "disabled"} data-n="${g.recipients}" />
          <label class="infomail-gruppe-name" for="${cbId}">${escapeHtml(g.name)}</label>
          <span class="infomail-gruppe-typ">${g.type === "treiber" ? "Treibergruppe" : "Ansteller-Runde"}</span>
          <span class="infomail-gruppe-n">${g.recipients} Empfänger</span>
          <span class="infomail-gruppe-sent${g.infomail_sent_at ? " is-sent" : ""}">${escapeHtml(wann)}</span>
          ${g.recipients
            ? `<button type="button" class="infomail-gruppe-vorschau${gezeigt ? " is-gezeigt" : ""}"
                       data-squad="${escapeHtml(g.id)}"${gezeigt ? " disabled" : ""}>${gezeigt ? "wird gezeigt" : "Vorschau"}</button>`
            : `<span class="infomail-gruppe-vorschau infomail-gruppe-vorschau--aus">—</span>`}
        </div>`;
      }).join("")}
    </div>` : "";

  // Der Betreff-Block nennt die Gruppe, die gerade gezeigt wird. Ohne das
  // liest man den Text einer Runde und hält ihn für den aller.
  // sample_squad_id kennt erst die Fassung ab 19.08.2026. Fehlt der
  // Schlüssel ganz, ist das Backend alt — das ist etwas anderes als ein
  // leerer Wert, und beides ist etwas anderes als "es gibt keine Vorschau".
  const kenntSquadId = Object.prototype.hasOwnProperty.call(preview, "sample_squad_id");
  const gezeigteGruppe = kenntSquadId
    ? gruppen.find((g) => String(g.id) === String(preview.sample_squad_id || ""))
    : null;

  const summary = gruppenHtml + `
    <div class="infomail-section infomail-options-section">
      <div class="infomail-section-heading">⚙️ Versand-Optionen</div>
      <label class="infomail-opt" for="infomail-include-schuetzen">
        <input type="checkbox" id="infomail-include-schuetzen" ${infomailIncludeSchuetzen ? "checked" : ""}>
        <span class="infomail-opt-text">
          <span class="infomail-opt-title">Schützen einbeziehen</span>
          <span class="infomail-opt-sub">Ohne Haken geht die Infomail nur an die jeweiligen Ansteller — die übrigen Schützen werden übersprungen.</span>
        </span>
      </label>
    </div>

    <div class="infomail-section infomail-meta-section">
      <div class="infomail-meta-row" id="infomail-recipients-line"></div>
      <div class="infomail-meta-row">
        <span class="infomail-meta-label">Betreff</span>
        <span class="infomail-meta-value">${escapeHtml(preview.sample_subject || "")}</span>
      </div>
      <div class="infomail-meta-row">
        <span class="infomail-meta-label">Vorschau zeigt</span>
        <span class="infomail-meta-value">${gezeigteGruppe
          ? `<strong>${escapeHtml(gezeigteGruppe.name)}</strong> — an ${escapeHtml(preview.sample_recipient || "")}.
             Jede Gruppe bekommt ein eigenes PDF mit ihrer eigenen Karte und ihrem eigenen Roster;
             der Mailtext wird je Empfänger mit dessen Stand gebaut.`
          : !preview.sample_recipient
            ? "—"
            : `an ${escapeHtml(preview.sample_recipient)}.
               <em>${kenntSquadId
                 ? "Zu welcher Gruppe dieser Empfänger gehört, meldet das Backend gerade nicht."
                 : "Welche Gruppe das ist, sagt erst die neue Backend-Fassung — bis dahin zeigen alle Vorschau-Knöpfe dasselbe Blatt."}</em>`}</span>
      </div>
    </div>
  `;

  const updateRecipientLine = () => {
    const inclSchuetzen = $("#infomail-include-schuetzen").checked;
    infomailIncludeSchuetzen = inclSchuetzen;
    // Nur die angehakten Gruppen zählen. Ohne das behauptet die Zeile eine
    // Empfängerzahl, die der Versand gar nicht bedient.
    const gewaehlt = $$(".infomail-gruppe-cb").filter((c) => c.checked);
    const n = gruppen.length
      ? gewaehlt.reduce((sum, c) => {
          const g = gruppen.find((x) => x.id === c.value) || {};
          return sum + (inclSchuetzen ? Number(c.dataset.n) : (g.type === "treiber" ? Number(c.dataset.n) : 1));
        }, 0)
      : (inclSchuetzen ? fullCount : anstellerOnlyCount);
    const runden = gewaehlt.length || (preview.runden || 0);
    const value = inclSchuetzen
      ? `${n} Person${n === 1 ? "" : "en"} in ${runden} Gruppe${runden === 1 ? "" : "n"}`
      : `${n} Ansteller und Hundeführer (übrige Schützen werden nicht angeschrieben)`;
    $("#infomail-recipients-line").innerHTML =
      '<span class="infomail-meta-label">Empfänger</span>' +
      '<span class="infomail-meta-value"><strong>' + n + '</strong> ' + escapeHtml(value.replace(/^\d+\s/, "")) + '</span>';
    const opt = $("#infomail-include-schuetzen").closest(".infomail-opt");
    if (opt) opt.classList.toggle("infomail-opt--off", !inclSchuetzen);
    const sendBtn = $("#infomail-send");
    sendBtn.textContent = n
      ? `An ${n} Person${n === 1 ? "" : "en"} versenden`
      : "Nichts ausgewählt";
    sendBtn.disabled = !n;
  };

  // Mint a fresh Blob URL for the PDF preview every time we open the
  // modal — revoke the previous one first so we don't leak memory if
  // the user opens the modal repeatedly.
  if (infomailPdfBlobUrl) { URL.revokeObjectURL(infomailPdfBlobUrl); infomailPdfBlobUrl = null; }
  if (preview.sample_pdf_base64) {
    infomailPdfBlobUrl = infomailMakePdfBlobUrl(preview.sample_pdf_base64);
  }

  if (preview.sample_html) {
    const pdfName = escapeHtml(preview.sample_pdf_name || "infomail-vorschau.pdf");
    const pdfBlock = infomailPdfBlobUrl
      ? `
        <div class="infomail-section">
          <div class="infomail-section-heading">
            📎 PDF-Anhang
            <span class="infomail-section-actions">
              <a class="infomail-link-btn" href="${infomailPdfBlobUrl}" target="_blank" rel="noopener">In neuem Tab ↗</a>
              <a class="infomail-link-btn" href="${infomailPdfBlobUrl}" download="${pdfName}">Download</a>
            </span>
          </div>
          <object id="infomail-pdf-embed" class="infomail-preview-pdf"
                  data="${infomailPdfBlobUrl}#zoom=page-width" type="application/pdf">
            <p class="muted infomail-pdf-fallback">
              Dein Browser zeigt die PDF-Vorschau hier nicht direkt an —
              nutze die Links oben rechts.
            </p>
          </object>
        </div>
      `
      : `
        <div class="infomail-section">
          <div class="infomail-section-heading">📎 PDF-Anhang</div>
          <p class="muted infomail-pdf-fallback">
            ⚠ PDF konnte nicht erzeugt werden (kein Karten-Key?). Die Mail würde ohne Anhang verschickt.
          </p>
        </div>
      `;

    // Sandbox the mail body so its inline styles can't bleed into the rest
    // of the page; PDF iframe is unsandboxed because Chromium needs the
    // default permissions to render the embedded viewer.
    body.innerHTML = warnsHtml + summary +
      '<div class="infomail-section">' +
        '<div class="infomail-section-heading">📨 E-Mail-Text</div>' +
        '<iframe id="infomail-preview-iframe" class="infomail-preview-iframe" sandbox="allow-same-origin"></iframe>' +
      '</div>' +
      pdfBlock;
    const iframe = $("#infomail-preview-iframe");
    iframe.srcdoc = preview.sample_html;
    iframe.addEventListener("load", () => {
      try {
        const h = iframe.contentDocument.body.scrollHeight;
        iframe.style.height = (h + 20) + "px";
      } catch (e) { /* cross-origin or sandbox quirks — ignore */ }
    });
  } else {
    body.innerHTML = warnsHtml + summary + '<p class="muted">Keine zustellbaren Empfänger — bitte erst Zusagen einsammeln.</p>';
  }
  // Die Haken merken, damit ein Umschalten der Vorschau sie nicht zurücksetzt.
  const merkeAuswahl = () => {
    infomailAuswahl = new Set($$(".infomail-gruppe-cb").filter((c) => c.checked).map((c) => c.value));
  };
  $("#infomail-include-schuetzen").addEventListener("change", updateRecipientLine);
  $$(".infomail-gruppe-cb").forEach((c) => c.addEventListener("change", () => {
    merkeAuswahl();
    updateRecipientLine();
  }));
  $$(".infomail-gruppe-vorschau").forEach((b) => {
    if (b.tagName !== "BUTTON") return;
    b.addEventListener("click", () => {
      merkeAuswahl();
      ladeInfomailVorschau(b.dataset.squad, b);
    });
  });
  updateRecipientLine();
  $("#infomail-backdrop").hidden = false;
  $("#infomail-modal").hidden = false;
}

// Vorschau auf eine andere Gruppe umschalten. Holt Mailtext und PDF für
// genau diese Gruppe und baut das Fenster neu auf — die gemerkten Haken und
// die Schützen-Option überleben das.
async function ladeInfomailVorschau(squadId, btn) {
  if (!state.currentEvent || !squadId || infomailVorschauLaeuft) return;
  infomailVorschauLaeuft = true;
  const altText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Lade …"; }
  try {
    const preview = await postJson({
      action: "event-infomails-preview",
      event_id: state.currentEvent.event.id,
      squad_id: squadId,
    });
    if (preview.error) throw new Error(preview.error);
    // Ältere Bereitstellungen kennen squad_id nicht und liefern stur die
    // erste Ansteller-Runde. Das stumm zu übergehen hieße, eine falsche
    // Gruppe als die angeklickte auszugeben. Drei Fälle, drei Sätze — ein
    // Hinweis, der etwas Falsches behauptet, ist schlimmer als keiner.
    if (!Object.prototype.hasOwnProperty.call(preview, "sample_squad_id")) {
      showToast("Das Backend ist noch die alte Fassung — alle Knöpfe zeigen dasselbe Blatt. Code.gs bereitstellen.", "error", 7000);
    } else if (!preview.sample_squad_id) {
      showToast("Für diese Gruppe gibt es niemanden, dem man schreiben kann.", "error", 6000);
    } else if (String(preview.sample_squad_id) !== String(squadId)) {
      showToast("Diese Gruppe hat keinen erreichbaren Empfänger — gezeigt wird eine andere.", "error", 6000);
    }
    openInfomailPreviewModal(preview);
  } catch (err) {
    showToast(err.message || "Vorschau fehlgeschlagen", "error");
    if (btn) { btn.disabled = false; btn.textContent = altText; }
  } finally {
    infomailVorschauLaeuft = false;
  }
}

function closeInfomailPreviewModal() {
  $("#infomail-modal").hidden = true;
  $("#infomail-backdrop").hidden = true;
  if (infomailPdfBlobUrl) {
    URL.revokeObjectURL(infomailPdfBlobUrl);
    infomailPdfBlobUrl = null;
  }
}

async function confirmSendInfomails() {
  if (!state.currentEvent) return;
  const btn = $("#infomail-send");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Sende …";
  try {
    const gewaehlt = $$(".infomail-gruppe-cb").filter((c) => c.checked).map((c) => c.value);
    const data = await postJson({
      action: "event-infomails-send",
      event_id: state.currentEvent.event.id,
      ansteller_only: !$("#infomail-include-schuetzen").checked,
      // Leer heißt im Backend "alle" — hier schicken wir immer die Auswahl mit,
      // damit ein versehentlich leerer Haken nicht doch an alle geht.
      squad_ids: gewaehlt,
    });
    closeInfomailPreviewModal();
    if (data.errors && data.errors.length) {
      const failed = data.errors.map((e) => `${e.hunter}: ${e.error}`).slice(0, 5).join("\n");
      showToast(`Versendet: ${data.sent} · Fehler: ${data.errors.length}\n${failed}`, "error", 8000);
    } else {
      showToast(`${data.sent} Infomail${data.sent === 1 ? "" : "s"} versendet ✓`);
    }
    // Damit "zuletzt verschickt" beim nächsten Öffnen stimmt.
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    await loadEventDetail(state.currentEvent.event.id);
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// ---------- Edit existing event ----------
// Opens a modal pre-filled with the current event's data. If any
// invitation has already been sent (hunter.invited_at set), a warning
// banner appears AND a confirm dialog runs before saving.

function openEventEditor() {
  if (!state.currentEvent) return;
  const event = state.currentEvent.event;
  const hunters = state.currentEvent.hunters || [];
  const hasInvited = hunters.some((h) => h && h.invited_at);

  const tgSet = new Set((event.teilgebiet || "").split(/\s*,\s*/).filter(Boolean));
  const tgCheck = (v) => tgSet.has(v) ? " checked" : "";

  $("#event-edit-body").innerHTML = `
    ${hasInvited ? `
      <div class="warning-banner">
        ⚠ <strong>Einladungen wurden bereits versendet.</strong>
        Änderungen am Datum, Treffpunkt oder Teilgebiet solltest Du den
        eingeladenen Jägern per Update-E-Mail mitteilen.
      </div>
    ` : ""}
    <form id="event-edit-form" class="ev-form" onsubmit="return false;">
      <label>Name<input type="text" id="edit-ev-name" required value="${escapeHtml(event.name)}" /></label>
      <label>Datum<input type="date" id="edit-ev-date" required value="${escapeHtml(event.date)}" /></label>
      <fieldset class="ev-fieldset">
        <legend>Jagdart</legend>
        <div class="ev-radio-row" id="edit-art-row"></div>
      </fieldset>
      <fieldset class="ev-fieldset">
        <legend>Teilgebiet(e) <span class="muted">(mehrfach wählbar, auch revierübergreifend)</span></legend>
        <div class="ev-revier-grid" id="edit-revier-grid">${window.preyeRevierGrid("edit-teilgebiet", [...tgSet])}</div>
      </fieldset>
      <label>Anmeldeschluss <span class="muted">(leer = 2 Wochen vor dem Termin)</span><input type="date" id="edit-ev-rsvp-deadline" value="${escapeHtml(event.rsvp_deadline || "")}" /></label>
      <label>Treffpunkt<input type="text" id="edit-ev-treffpunkt" value="${escapeHtml(event.treffpunkt || "")}" /></label>
      <div class="ev-form-row treffpunkt-coords-row">
        <label>Breitengrad <span class="muted">(optional)</span><input type="number" id="edit-ev-treffpunkt-lat" step="0.000001" inputmode="decimal" value="${escapeHtml(event.treffpunkt_lat ?? "")}" /></label>
        <label>Längengrad <span class="muted">(optional)</span><input type="number" id="edit-ev-treffpunkt-lng" step="0.000001" inputmode="decimal" value="${escapeHtml(event.treffpunkt_lng ?? "")}" /></label>
        <button type="button" id="edit-ev-treffpunkt-here" class="ghost-btn treffpunkt-here-btn">📍 Aktuelle Position</button>
      </div>
      <div class="ev-form-row">
        <label>Treffzeit<input type="time" id="edit-ev-treff-time" value="${escapeHtml(event.treff_time || "")}" /></label>
        <label>Beginn<input type="time" id="edit-ev-start-time" value="${escapeHtml(event.start_time || "")}" /></label>
        <label>Ende<input type="time" id="edit-ev-end-time" value="${escapeHtml(event.end_time || "")}" /></label>
      </div>
      <label>Weitere Hinweise <span class="muted">(optional, intern)</span><textarea id="edit-ev-briefing" rows="3">${escapeHtml(event.briefing || "")}</textarea></label>
      <label>Organisator<input type="text" id="edit-ev-organizer" value="${escapeHtml(event.organizer || "")}" /></label>
      <fieldset class="ev-fieldset ev-fieldset-contacts">
        <legend>Kontakte <span class="muted">(für die schriftliche Einladung)</span></legend>
        <div class="contact-row">
          <label>Tierarzt — Name<input type="text" id="edit-ev-vet-name" autocomplete="off" value="${escapeHtml(event.vet_name || "")}" /></label>
          <label>Tierarzt — Mobil<input type="tel" id="edit-ev-vet-phone" inputmode="tel" autocomplete="off" value="${escapeHtml(event.vet_phone || "")}" /></label>
        </div>
        <div class="contact-row">
          <label>Nachsuchen-Koordinator — Name<input type="text" id="edit-ev-coordinator-name" autocomplete="off" value="${escapeHtml(event.coordinator_name || "")}" /></label>
          <label>Nachsuchen-Koordinator — Mobil<input type="tel" id="edit-ev-coordinator-phone" inputmode="tel" autocomplete="off" value="${escapeHtml(event.coordinator_phone || "")}" /></label>
        </div>
        <div class="nsf-block">
          <p class="nsf-label">Nachsuchenführer <span class="muted">(beliebig viele)</span></p>
          <div id="edit-nsf-rows" class="nsf-rows"></div>
          <button type="button" class="dog-add-btn nsf-add" id="edit-ev-nsf-add">+ Nachsuchenführer hinzufügen</button>
        </div>
      </fieldset>
    </form>
  `;
  renderArtRow($("#edit-art-row"), "edit-art", event.art);
  window.preyeWireRevierGrid($("#edit-revier-grid"), "edit-teilgebiet");

  // Pre-populate Nachsuchenführer rows.
  const nsfTarget = $("#edit-nsf-rows");
  (event.nachsuchenfuehrer || []).forEach((p) => addNsfRowTo(nsfTarget, p.name, p.phone));
  $("#edit-ev-nsf-add").addEventListener("click", () => addNsfRowTo(nsfTarget));
  $("#edit-ev-treffpunkt-here").addEventListener("click", () =>
    fillTreffpunktCoords("#edit-ev-treffpunkt-lat", "#edit-ev-treffpunkt-lng"));

  $("#event-edit-backdrop").hidden = false;
  $("#event-edit-modal").hidden = false;
}

function closeEventEditor() {
  $("#event-edit-modal").hidden = true;
  $("#event-edit-backdrop").hidden = true;
}

async function saveEventEdit() {
  if (!state.currentEvent) return;
  const hunters = state.currentEvent.hunters || [];
  const hasInvited = hunters.some((h) => h && h.invited_at);
  if (hasInvited) {
    const ok = confirm(
      "Einladungen wurden bereits versendet.\n\n" +
      "Sollen die Änderungen trotzdem gespeichert werden? Die eingeladenen " +
      "Jäger sollten per Update-E-Mail informiert werden — am einfachsten, " +
      'indem Du danach erneut „Einladung erstellen" öffnest und eine kurze ' +
      "Notiz vor dem Versenden einfügst."
    );
    if (!ok) return;
  }
  const teilgebiet = $$("input[name=edit-teilgebiet]:checked").map((c) => c.value).join(", ");
  const art = ($("input[name=edit-art]:checked") || {}).value || "drueckjagd";
  const nachsuchenfuehrer = $$("#edit-nsf-rows .nsf-row").map((row) => ({
    name: row.querySelector(".nsf-name").value.trim(),
    phone: row.querySelector(".nsf-phone").value.trim(),
  })).filter((p) => p.name || p.phone);

  const btn = $("#event-edit-save");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Speichere …";
  try {
    const tpLatStr = $("#edit-ev-treffpunkt-lat").value.trim();
    const tpLngStr = $("#edit-ev-treffpunkt-lng").value.trim();
    await postJson({
      action: "event-update",
      id: state.currentEvent.event.id,
      name: $("#edit-ev-name").value.trim(),
      date: $("#edit-ev-date").value,
      teilgebiet,
      art,
      rsvp_deadline: $("#edit-ev-rsvp-deadline").value,
      treffpunkt: $("#edit-ev-treffpunkt").value.trim(),
      treffpunkt_lat: tpLatStr ? Number(tpLatStr) : "",
      treffpunkt_lng: tpLngStr ? Number(tpLngStr) : "",
      treff_time: $("#edit-ev-treff-time").value,
      start_time: $("#edit-ev-start-time").value,
      end_time: $("#edit-ev-end-time").value,
      briefing: $("#edit-ev-briefing").value.trim(),
      organizer: $("#edit-ev-organizer").value.trim(),
      vet_name: $("#edit-ev-vet-name").value.trim(),
      vet_phone: $("#edit-ev-vet-phone").value.trim(),
      coordinator_name: $("#edit-ev-coordinator-name").value.trim(),
      coordinator_phone: $("#edit-ev-coordinator-phone").value.trim(),
      nachsuchenfuehrer,
    });
    invalidateCache("event-detail", { id: state.currentEvent.event.id });
    invalidateCache("events-list");
    showToast("Jagd aktualisiert ✓");
    closeEventEditor();
    await loadEventDetail(state.currentEvent.event.id);
  } catch (err) {
    showToast(err.message || "Fehler beim Speichern", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

// ---------- Einladungsentwurf (default invitation template) ----------
// Global text template that drives every event's invitation. Stored in
// Script Properties; pulled on open, pushed on save. Both languages.
let templateEditor = null; // { de: {subject, body}, en: {...}, activeLang }

async function openTemplateEditor() {
  const btn = $("#edit-template-btn");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Lade …";
  try {
    const [de, en] = await Promise.all([
      fetchJson("invite-template-get", { language: "de" }),
      fetchJson("invite-template-get", { language: "en" }),
    ]);
    if (de.error) throw new Error(de.error);
    if (en.error) throw new Error(en.error);
    templateEditor = {
      de: { subject: de.subject || "", body: de.body || "" },
      en: { subject: en.subject || "", body: en.body || "" },
      activeLang: "de",
    };
    // Render the placeholder reference once from the backend's list.
    const placeholders = (de.placeholders || []);
    $("#template-placeholder-list").innerHTML = placeholders.map((p) =>
      `<li><code>${escapeHtml(p.name)}</code> — ${escapeHtml(p.doc)}</li>`
    ).join("");
    showTemplateLang("de", true);
    $("#template-status").textContent =
      (de.using_default_body && en.using_default_body)
        ? "Standardentwurf — noch nicht geändert."
        : "Eigener Entwurf gespeichert.";
    $("#template-backdrop").hidden = false;
    $("#template-modal").hidden = false;
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

function showTemplateLang(lang, skipSave) {
  if (!templateEditor) return;
  if (!skipSave && templateEditor.activeLang) {
    templateEditor[templateEditor.activeLang].subject = $("#template-subject").value;
    templateEditor[templateEditor.activeLang].body = $("#template-body").value;
  }
  templateEditor.activeLang = lang;
  $("#template-subject").value = templateEditor[lang].subject || "";
  $("#template-body").value = templateEditor[lang].body || "";
  document.querySelectorAll(".tpl-lang-tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.lang === lang)
  );
}

function closeTemplateEditor() {
  templateEditor = null;
  $("#template-modal").hidden = true;
  $("#template-backdrop").hidden = true;
}

async function saveTemplate() {
  if (!templateEditor) return;
  // Capture the currently-edited language.
  templateEditor[templateEditor.activeLang].subject = $("#template-subject").value;
  templateEditor[templateEditor.activeLang].body = $("#template-body").value;
  const btn = $("#template-save");
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = "Speichere …";
  try {
    await postJson({
      action: "invite-template-save",
      language: "de",
      subject: templateEditor.de.subject,
      body: templateEditor.de.body,
    });
    await postJson({
      action: "invite-template-save",
      language: "en",
      subject: templateEditor.en.subject,
      body: templateEditor.en.body,
    });
    showToast("Einladungsentwurf gespeichert ✓");
    closeTemplateEditor();
  } catch (err) {
    showToast(err.message || "Fehler beim Speichern", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function resetTemplate() {
  if (!confirm("Beide Sprachen auf den Standardentwurf zurücksetzen? Eigene Änderungen gehen verloren.")) return;
  try {
    await postJson({ action: "invite-template-save", language: "de", subject: "", body: "" });
    await postJson({ action: "invite-template-save", language: "en", subject: "", body: "" });
    showToast("Auf Standard zurückgesetzt");
    closeTemplateEditor();
  } catch (err) {
    showToast(err.message || "Fehler", "error");
  }
}

// Jagdart und Teilgebiete werden erzeugt, nicht getippt — sonst stünde jede
// neue Option zweimal im Markup (Anlegen und Bearbeiten).
function renderArtRow(host, inputName, selected) {
  const value = selected || "drueckjagd";
  host.innerHTML = window.PREYE_JAGDARTEN.map((a) => `
    <label class="ev-radio"><input type="radio" name="${escapeHtml(inputName)}" value="${escapeHtml(a.key)}"${a.key === value ? " checked" : ""} /> ${escapeHtml(a.name)}</label>
  `).join("");
}

function buildNewEventForm() {
  renderArtRow($("#ev-art-row"), "art", "drueckjagd");
  const grid = $("#ev-revier-grid");
  grid.innerHTML = window.preyeRevierGrid("teilgebiet", []);
  window.preyeWireRevierGrid(grid, "teilgebiet");
}

// Ein fehlendes Element hat wireUi() bisher mitten im Lauf beendet: $ ist
// querySelector und liefert null, und null.addEventListener wirft. Alles nach
// der Fundstelle war damit tot, ohne dass die Seite kaputt aussah. Jetzt fehlt
// genau ein Knopf, und die Konsole sagt welcher.
function on(sel, type, handler, root = document) {
  const el = root.querySelector(sel);
  if (!el) { console.warn("PREYE: Element fehlt, Verdrahtung übersprungen:", sel); return null; }
  el.addEventListener(type, handler);
  return el;
}

function onAll(sel, type, handler, root = document) {
  const els = Array.from(root.querySelectorAll(sel));
  if (!els.length) console.warn("PREYE: keine Elemente für", sel);
  els.forEach((el) => el.addEventListener(type, handler));
  return els;
}

// Grundgerüst: Kopfleiste, Zurück-Knopf, Adresszeile.
function wireShell() {
  on("#new-event-btn", "click", () => { location.hash = "#/new"; });
  on("#back-to-list", "click", () => { location.hash = "#/"; });
  window.addEventListener("hashchange", route);
}

function wireListe() {
  wireFilters();
  // Delegiert: die Karten entstehen bei jedem Render neu.
  on("#events-list", "click", (e) => {
    const btn = e.target.closest(".event-delete-btn");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      deleteEvent(btn.dataset.eid);
    }
  });
}

function wireNeueJagd() {
  buildNewEventForm();
  on("#new-event-form", "submit", submitNewEvent);
  on("#ev-treffpunkt-here", "click", () => fillTreffpunktCoords("#ev-treffpunkt-lat", "#ev-treffpunkt-lng"));
  on("#new-event-cancel", "click", () => { location.hash = "#/"; });
  on("#ev-nsf-add", "click", () => addNsfRow());
}

// Jäger hinzufügen, CSV-Import, Einladungsversand.
function wireEinladen() {
  // Die Rollen des Kombi-Selects aus SET_ROLES erzeugen, statt sie im Markup
  // ein drittes Mal auszuschreiben (das erste ist VALID_ROLES in Code.gs).
  const modus = $("#add-hunter-mode");
  if (modus && modus.options.length === 1) {
    const trenner = document.createElement("option");
    trenner.disabled = true;
    trenner.textContent = "── ohne Einladung setzen als ──";
    modus.appendChild(trenner);
    SET_ROLES.forEach((r) => {
      const o = document.createElement("option");
      o.value = r;
      o.textContent = r;
      modus.appendChild(o);
    });
  }

  on("#add-hunter-form", "submit", addHunter);
  on("#add-hunter-mode", "change", (e) => {
    // Der Knopf soll benennen, was gleich passiert — sonst merkt niemand, dass
    // die Auswahl daneben den Ablauf ändert.
    const btn = $("#add-hunter-btn");
    if (btn) btn.textContent = e.target.value ? "+ Gesetzt hinzufügen" : "+ Hinzufügen";
  });
  on("#add-hunter-name", "change", onHunterNamePick);

  // CSV import — wire the hidden file input via a visible toolbar button.
  on("#open-csv-upload", "click", () => { const i = $("#csv-input"); if (i) i.click(); });
  on("#csv-input", "change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (file) await importHuntersFromCsv(file);
  });

  on("#open-invite-preview", "click", openInvitePreview);
  on("#send-invites-btn", "click", sendInvites);
  on("#invite-close", "click", closeInvitePreview);
  on("#invite-cancel", "click", closeInvitePreview);
  on("#invite-backdrop", "click", closeInvitePreview);
  onAll(".invite-lang-tab", "click", (e) => showInviteLang(e.currentTarget.dataset.lang));
}

function wireHunterbase() {
  on("#open-address-book", "click", openAddressBookModal);
  on("#address-book-close", "click", closeAddressBookModal);
  on("#address-book-cancel", "click", closeAddressBookModal);
  on("#address-book-backdrop", "click", closeAddressBookModal);
  on("#address-book-apply", "click", applyAddressBookSelection);
}

// Die Jägerliste dieser Jagd. Delegiert auf den Container, weil die Zeilen bei
// jedem Render neu entstehen — der Container steht statisch in events.html.
function wireRoster() {
  on("#hunters-list", "click", (e) => {
    const btn = e.target.closest(".hunter-remove");
    if (btn) { removeHunter(btn.dataset.hid); return; }
    const setBtn = e.target.closest(".hunter-set");
    if (setBtn) { setHunter(setBtn.dataset.hid, !!setBtn.dataset.gesetzt); return; }
    // Die Sortierköpfe entstehen bei jedem Render neu, deshalb delegiert.
    const rolle = e.target.closest(".jgr-role");
    if (rolle) {
      const h = (state.currentEvent?.hunters || []).find((x) => x.id === rolle.dataset.hid);
      const zeile = rolle.closest(".hunter-row");
      if (h && zeile) openSetPicker(zeile, h.id, h.hunter, h.role || "");
      return;
    }
    const kopf = e.target.closest(".jgr-sort");
    if (kopf) {
      const k = kopf.dataset.sort;
      jgrView.dir = (jgrView.sort === k) ? -jgrView.dir : 1;
      jgrView.sort = k;
      jgrNeuZeichnen();
    }
  });

  // Reiter und Suchfeld stehen statisch im Markup und werden nie neu
  // gerendert — sonst verlöre das Feld beim Tippen Text und Cursor.
  on("#jgr-tabs", "click", (e) => {
    const b = e.target.closest(".ev-tab");
    if (!b) return;
    jgrView.tab = b.dataset.tab;
    jgrNeuZeichnen();
  });
  on("#jgr-search", "input", (e) => {
    jgrView.q = e.target.value.trim().toLowerCase();
    jgrNeuZeichnen();
  });
}

function wireRunden() {
  // Die Kacheln entstehen bei jedem Render neu; beide Container stehen
  // statisch im Markup, also einmal delegiert statt je Kachel verdrahtet.
  const aufKachel = (e) => {
    const tile = e.target.closest(".squad-tile");
    if (tile) openSquadEditor(tile.dataset.sid);
  };
  on("#squads-list", "click", aufKachel);
  on("#treiber-list", "click", aufKachel);

  on("#new-squad-btn", "click", addSquad);
  on("#new-treiber-btn", "click", addTreibergruppe);
  on("#squad-edit-close", "click", closeSquadEditor);
  on("#squad-edit-cancel", "click", closeSquadEditor);
  on("#squad-edit-backdrop", "click", closeSquadEditor);
  on("#squad-edit-save", "click", saveEditingSquad);

  on("#send-infomails-btn", "click", sendInfomails);
  on("#infomail-close", "click", closeInfomailPreviewModal);
  on("#infomail-cancel", "click", closeInfomailPreviewModal);
  on("#infomail-backdrop", "click", closeInfomailPreviewModal);
  on("#infomail-send", "click", confirmSendInfomails);
}

// Revierkarte — live "Mein Standort" dot.
function wireKarte() {
  on("#plan-locate-btn", "click", startPlanGeo);
}

// Jagd bearbeiten, Stände verwalten, Einladungsentwurf.
function wireModals() {
  on("#edit-event-btn", "click", openEventEditor);
  on("#event-edit-close", "click", closeEventEditor);
  on("#event-edit-cancel", "click", closeEventEditor);
  on("#event-edit-backdrop", "click", closeEventEditor);
  on("#event-edit-save", "click", saveEventEdit);

  on("#manage-posts-btn", "click", openPostsModal);
  on("#posts-close", "click", closePostsModal);
  on("#posts-cancel", "click", closePostsModal);
  on("#posts-backdrop", "click", closePostsModal);
  on("#add-post-form", "submit", submitNewPost);
  on("#post-here-btn", "click", () => {
    if (!navigator.geolocation) { showToast("Standort nicht verfügbar", "error"); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      $("#post-lat").value = pos.coords.latitude.toFixed(6);
      $("#post-lng").value = pos.coords.longitude.toFixed(6);
      showToast("Position übernommen");
    }, (err) => showToast("Standort: " + err.message, "error", 4000),
    { enableHighAccuracy: true, timeout: 8000 });
  });
  on("#post-csv-btn", "click", () => { const i = $("#post-csv-input"); if (i) i.click(); });
  on("#post-csv-input", "change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) await handlePostCsv(file);
  });

  on("#edit-template-btn", "click", openTemplateEditor);
  on("#template-close", "click", closeTemplateEditor);
  on("#template-cancel", "click", closeTemplateEditor);
  on("#template-backdrop", "click", closeTemplateEditor);
  on("#template-save", "click", saveTemplate);
  on("#template-reset", "click", resetTemplate);
  onAll(".tpl-lang-tab", "click", (e) => showTemplateLang(e.currentTarget.dataset.lang));
}

// In Gruppen, damit eine kaputte Gruppe die anderen nicht mitnimmt. on() fängt
// den erwarteten Fehler (Element fehlt), das try den unerwarteten.
function wireUi() {
  const gruppen = [
    ["Grundgerüst", wireShell],
    ["Liste", wireListe],
    ["Neue Jagd", wireNeueJagd],
    ["Einladen", wireEinladen],
    ["Hunterbase", wireHunterbase],
    ["Jägerliste", wireRoster],
    ["Runden", wireRunden],
    ["Karte", wireKarte],
    ["Fenster", wireModals],
  ];
  for (const [name, fn] of gruppen) {
    try { fn(); }
    catch (err) { console.error("PREYE: Verdrahtung „" + name + "“ fehlgeschlagen:", err); }
  }
}

// ---------- Main ----------

async function main() {
  if (!cfg.APPS_SCRIPT_URL) {
    document.body.innerHTML = "<p style='padding:24px'>config.js fehlt — Pages-Deployment prüfen.</p>";
    return;
  }
  if (!(await window.PreyeGate.pass())) return;
  wireUi();
  await loadAddressBook();
  route();
}

main();
