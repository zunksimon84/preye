// PREYE — interner Startbildschirm.
//
// Reads the same Apps Script the tools read, so the board cannot disagree with
// them. Every panel fills independently: one slow or failing call leaves the
// others alone rather than blanking the page, and a panel that has nothing to
// say says so in words instead of showing a dash.

const cfg = window.PEENWERDER_CONFIG || {};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

// ---------- Menü ----------

(function menu() {
  const burger = $("#burger");
  const nav = $("#nav");
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
  });
})();

// ---------- Netz ----------

function url(action, params = {}) {
  const u = new URL(cfg.APPS_SCRIPT_URL);
  u.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const token = localStorage.getItem("preye.token");
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

function get(action, params) {
  return fetch(url(action, params)).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
}

function fail(el, what) {
  el.innerHTML = `<p class="muted">${esc(what)} konnte nicht geladen werden.</p>`;
}

// ---------- Datum ----------

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni",
                "Juli", "August", "September", "Oktober", "November", "Dezember"];
const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function longDate(iso) {
  const d = parseDate(iso);
  if (!d) return String(iso || "");
  return `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function shortDate(iso) {
  const d = parseDate(iso);
  return d ? `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}` : String(iso || "");
}

// "in 12 Tagen" is the number anyone actually wants off a hunt list.
function daysUntil(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function untilLabel(n) {
  if (n === null) return "";
  if (n < 0) return `vor ${-n} ${-n === 1 ? "Tag" : "Tagen"}`;
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  return `in ${n} Tagen`;
}

// Hunting season runs 1 April – 31 March.
(function seasonLabel() {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  $("#bar-season").textContent = `Saison ${start}/${String(start + 1).slice(2)}`;
})();

// ---------- Panels ----------

function renderNextHunt(events) {
  const el = $("#next-body");
  const upcoming = events
    .filter((e) => (daysUntil(e.date) ?? -1) >= 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const ev = upcoming[0];

  if (!ev) {
    el.innerHTML = `<p class="muted">Keine kommende Jagd eingetragen.</p>
      <div class="btnrow"><a class="btn btn--primary" href="events.html">Jagd anlegen</a></div>`;
    return;
  }

  const s = ev.stats || {};
  const times = [ev.treff_time && "Treff " + ev.treff_time,
                 ev.start_time && "Beginn " + ev.start_time,
                 ev.end_time && "Ende " + ev.end_time].filter(Boolean).join(" · ");

  el.innerHTML = `
    <p class="next-title">${esc(ev.name)}</p>
    <p class="next-when"><b>${esc(longDate(ev.date))}</b> — ${esc(untilLabel(daysUntil(ev.date)))}</p>
    <div class="next-meta">
      ${ev.teilgebiet ? `<div><span class="k">Teilgebiet</span><span class="v">${esc(ev.teilgebiet)}</span></div>` : ""}
      ${ev.treffpunkt ? `<div><span class="k">Treffpunkt</span><span class="v">${esc(ev.treffpunkt)}</span></div>` : ""}
      ${times ? `<div><span class="k">Zeiten</span><span class="v">${esc(times)}</span></div>` : ""}
      ${ev.organizer ? `<div><span class="k">Organisator</span><span class="v">${esc(ev.organizer)}</span></div>` : ""}
    </div>
    <div class="rsvp">
      <span class="chip chip--yes">${s.accepted || 0} zugesagt</span>
      <span class="chip chip--open">${s.pending || 0} offen</span>
      <span class="chip chip--no">${s.declined || 0} abgesagt</span>
      <span class="chip">${s.invited || 0} eingeladen</span>
    </div>
    <div class="btnrow">
      <a class="btn btn--primary" href="events.html#/event/${encodeURIComponent(ev.id)}">Jagd öffnen</a>
      <a class="btn" href="standkarte.html?event=${encodeURIComponent(ev.id)}">Standkarte</a>
    </div>`;
}

function renderHuntList(events) {
  const el = $("#d-hunts");
  const upcoming = events
    .filter((e) => (daysUntil(e.date) ?? -1) >= 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(1, 6); // the first one already has its own panel

  if (!upcoming.length) {
    el.innerHTML = `<li class="muted">Nichts weiter geplant.</li>`;
    return;
  }
  el.innerHTML = upcoming.map((e) => `
    <li><a href="events.html#/event/${encodeURIComponent(e.id)}">
      <span class="h-when">${esc(shortDate(e.date))} · ${esc(untilLabel(daysUntil(e.date)))}</span>
      <span class="h-name">${esc(e.name)}</span>
      <span class="h-where">${esc(e.teilgebiet || "")}${e.stats ? ` · ${e.stats.accepted || 0} zugesagt` : ""}</span>
    </a></li>`).join("");
}

function renderOpenNachsuchen(list) {
  const el = $("#open-body");
  if (!Array.isArray(list) || !list.length) {
    el.innerHTML = `<p class="ok-note">Keine offene Nachsuche.</p>`;
    return;
  }
  el.innerHTML = `<ul class="openlist">` + list.slice(0, 6).map((n) => {
    const when = n.created_at ? new Date(n.created_at) : null;
    const stamp = when
      ? `${when.getDate()}.${when.getMonth() + 1}. ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
      : "";
    return `<li>
        <span class="o-head">${esc(n.post_name || n.stand_nr || "Stand ?")}</span>
        <span class="o-meta">${esc([stamp, n.hunter, n.summary].filter(Boolean).join(" · "))}</span>
      </li>`;
  }).join("") + `</ul>`;
}

// Die Reihenfolge der Teilgebiete kam bis August 2026 als feste Liste aus
// Peenwerder. Jetzt aus dem Revier, das der Control Room gerade zeigt.
// Beschriftungen, die früher fest im Markup standen und mit dem dritten
// Revier falsch geworden wären.
function applyRevierChrome() {
  const list = window.PREYE_REVIERE || [];
  const key = localStorage.getItem("preye.revier");
  const current = (window.preyeRevierByKey && window.preyeRevierByKey(key)) || list[0];
  const band = $("#band-revier");
  if (band && current) band.textContent = current.name;
  const sub = $("#tile-reviere-sub");
  if (sub && list.length) {
    sub.textContent = list.map((r) => r.short).join(", ") + " — Karte, Stände, Strecke";
  }
  const foot = $("#foot-reviere");
  if (foot && list.length) {
    foot.textContent = list.map((r) => r.short).join(" & ") + " · interner Zugang";
  }
  // Die Panel-Verweise zeigen auf die Karte des gerade gezeigten Reviers.
  if (current) {
    document.querySelectorAll('a[href^="karte.html"]').forEach((a) => {
      a.setAttribute("href", "karte.html?revier=" + encodeURIComponent(current.key));
    });
  }
}

function areaOrder() {
  const key = localStorage.getItem("preye.revier");
  const revier = (window.preyeRevierByKey && window.preyeRevierByKey(key))
    || (window.PREYE_REVIERE || [])[0];
  return revier ? revier.areas : [];
}

function renderPosts(posts) {
  $("#d-posts").textContent = String(posts.length);
  const order = areaOrder();
  const counts = {};
  posts.forEach((p) => { const a = p.area || "?"; counts[a] = (counts[a] || 0) + 1; });
  const rows = order.filter((a) => counts[a]).map((a) => [a, counts[a]]);
  const rest = Object.keys(counts).filter((a) => !order.includes(a))
    .reduce((n, a) => n + counts[a], 0);
  if (rest) rows.push(["Klettersitz & Pirsch", rest]);
  const max = Math.max(...rows.map((r) => r[1]), 1);
  $("#d-areas").innerHTML = rows.map(([name, n]) =>
    `<div class="row" style="--w: ${Math.round(n / max * 100)}"><span>${esc(name)}</span><b>${n}</b></div>`).join("");
}

function renderTopStands(posts, aggregates) {
  const byId = {};
  posts.forEach((p) => { byId[p.id] = p; });
  const best = {};
  (aggregates || []).forEach((row) => {
    const post = byId[row.post_id];
    if (!post) return;
    const area = post.area || "?";
    if (!best[area] || row.total_count > best[area].count) {
      best[area] = { name: post.name || row.post_id, count: row.total_count };
    }
  });
  const rows = areaOrder().filter((a) => best[a]);
  $("#d-top").innerHTML = rows.length
    ? rows.map((a) => `<li>
        <span class="a">${esc(a)}</span>
        <span class="s">${esc(best[a].name)}</span>
        <span class="c">${best[a].count}</span>
      </li>`).join("")
    : `<li class="muted">Noch keine Strecke eingetragen.</li>`;
}

function renderStrecke(data) {
  $("#d-total").textContent = String(data.total || 0);
  const list = data.by_species || [];
  const el = $("#d-species");
  if (!list.length) {
    el.innerHTML = `<li class="muted">Noch nichts in dieser Saison.</li>`;
    return;
  }
  const max = Math.max(...list.map((r) => r.count), 1);
  el.innerHTML = list.map((r) => {
    const g = r.by_gender || {};
    const m = (g.m && g.m.count) || 0;
    const w = (g.w && g.w.count) || 0;
    const rest = Math.max(0, r.count - m - w);
    const split = [m ? "♂ " + m : "", w ? "♀ " + w : "", rest ? "o. A. " + rest : ""]
      .filter(Boolean).join(" · ");
    return `<li>
        <span class="n">${esc(r.species)}</span>
        <span class="c">${r.count}</span>
        <span class="meter"><i style="width:${Math.round(r.count / max * 100)}%"></i></span>
        ${split ? `<span class="split">${esc(split)}</span>` : ""}
      </li>`;
  }).join("");
}

// ---------- Start ----------

// Gleich mit der Rückfallebene beschriften, damit beim ersten Bildaufbau
// nichts Falsches dasteht; die Antwort korrigiert es gleich darauf.
applyRevierChrome();

if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) {
  document.querySelectorAll(".panel-body").forEach((el) => {
    el.innerHTML = `<p class="muted">Konfiguration fehlt: public/config.js</p>`;
  });
} else {
  get("events-list")
    .then((events) => {
      const list = Array.isArray(events) ? events : [];
      renderNextHunt(list);
      renderHuntList(list);
      $("#band-sub").textContent =
        `${list.filter((e) => (daysUntil(e.date) ?? -1) >= 0).length} kommende Jagden`;
    })
    .catch(() => { fail($("#next-body"), "Jagden"); fail($("#d-hunts"), "Jagden"); });

  Promise.all([get("bootstrap"), get("aggregates")])
    .then(([boot, agg]) => {
      if (boot.reviere) { window.preyeApplyReviere(boot.reviere); applyRevierChrome(); }
      const posts = boot.posts || [];
      renderPosts(posts);
      renderTopStands(posts, agg);
    })
    .catch(() => { fail($("#d-areas"), "Stände"); fail($("#d-top"), "Stände"); });

  get("strecke").then(renderStrecke).catch(() => fail($("#d-species"), "Strecke"));

  get("nachsuche-list").then(renderOpenNachsuchen)
    .catch(() => fail($("#open-body"), "Nachsuchen"));

  const now = new Date();
  $("#foot-updated").textContent =
    `Stand ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} Uhr`;
}
