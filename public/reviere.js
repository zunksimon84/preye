// Revier-Auswahl. Die Karten werden aus der Revierliste erzeugt, die Zahlen
// kommen live — damit die Kacheln nicht behaupten, was das Backend längst
// anders weiß.
//
// Bis August 2026 standen hier zwei handgetippte Karten im Markup, mit einer
// fest eingetragenen 0 bei Müritz' Ständen und einem Statusmerkmal, das jemand
// von Hand hätte umstellen müssen. Beides wird jetzt abgeleitet.

(function () {
  const cfg = window.PEENWERDER_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const burger = $("#burger"), nav = $("#nav");
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
  });

  // Zustand je Revier, wird nachgereicht sobald die Antworten da sind.
  const stats = {};   // key → { posts, hunts, strecke }

  // Kennt das bereitgestellte Backend schon Reviere? Vor dem Bereitstellen
  // ignoriert es ?revier= stillschweigend und liefert auf jede Anfrage die
  // Summe des ganzen Sheets. Eine solche Zahl unter dem Namen eines einzelnen
  // Reviers ist schlimmer als gar keine, weil man ihr glaubt.
  let serverKnowsReviere = false;

  function render() {
    const host = $("#reviere");
    if (!host) return;
    const cards = window.PREYE_REVIERE.map(revierCard).join("");
    host.innerHTML = cards + neuCard();
    // Fehlt das Panorama, tritt der Farbverlauf an seine Stelle. Kein
    // loading="lazy" auf diesen Bildern: der Austausch soll passieren, bevor
    // die Karte ins Bild scrollt, nicht danach.
    host.querySelectorAll("img[data-pano]").forEach((img) => {
      img.addEventListener("error", () => {
        const box = img.closest(".revier-pano");
        if (!box) return;
        box.classList.add("revier-pano--blank");
        box.dataset.name = img.dataset.pano;
        img.remove();
      });
    });
  }

  function revierCard(r) {
    const st = stats[r.key] || {};
    const posts = st.posts != null ? st.posts : (r.posts != null ? r.posts : null);
    // Das Statusmerkmal wird abgeleitet, nicht gepflegt. Die Müritz-Karte
    // springt damit von selbst um, sobald der Import durch ist.
    //
    // Solange die Zahl noch nicht da ist, gilt das Revier als eingerichtet und
    // trägt kein Merkmal. Unbekannt ist nicht dasselbe wie null — sonst stünde
    // beim ersten Bildaufbau an jeder Karte "neu angelegt", und vor dem
    // Bereitstellen des Backends dauerhaft.
    const unbekannt = posts == null;
    const eingerichtet = unbekannt || posts > 0;
    const chip = unbekannt
      ? ""
      : (posts > 0
        ? '<span class="revier-state revier-state--live">eingerichtet</span>'
        : `<span class="revier-state">${st.hunts ? "Stände fehlen noch" : "neu angelegt"}</span>`);
    const href = `karte.html?revier=${encodeURIComponent(r.key)}`;
    const pano = r.pano || `revier-${r.key}.jpg`;

    const links = eingerichtet
      ? `<a class="revier-go" href="${href}">Karte &amp; Strecke öffnen →</a>
         <a class="revier-go revier-go--alt" href="events.html?revier=${encodeURIComponent(r.key)}">Drückjagden ansehen →</a>`
      // Ein frisch angelegtes Revier bekommt keinen toten Link auf eine leere
      // Karte, sondern den Weg, der es fertig macht.
      : `<a class="revier-go" href="revier-neu.html?revier=${encodeURIComponent(r.key)}">Stände importieren →</a>
         <a class="revier-go revier-go--alt" href="events.html?revier=${encodeURIComponent(r.key)}">Drückjagden ansehen →</a>`;

    return `
      <div class="revier${eingerichtet ? "" : " revier--soon"}">
        ${eingerichtet
          ? `<a class="revier-pano" href="${href}" aria-label="${esc(r.name)} – Karte und Strecke öffnen">
               <img data-pano="${esc(r.name)}" src="${esc(pano)}" alt="${esc(r.name)}" width="1600" height="264" />
               ${chip}
             </a>`
          : `<div class="revier-pano">
               <img data-pano="${esc(r.name)}" src="${esc(pano)}" alt="${esc(r.name)}" width="1600" height="264" />
               ${chip}
             </div>`}
        <b class="sr-only">${esc(r.name)}</b>
        <p class="revier-sub">${r.areas.length ? esc(r.areas.join(", ")) : "noch keine Teilgebiete"}</p>
        <dl class="revier-stats">
          <div><dt>Stände</dt><dd data-stat="posts-${esc(r.key)}">${posts != null ? posts : "—"}</dd></div>
          <div><dt>Teilgebiete</dt><dd>${r.areas.length}</dd></div>
          <div><dt>Strecke Saison</dt><dd data-stat="strecke-${esc(r.key)}">—</dd></div>
          <div><dt>Drückjagden</dt><dd data-stat="hunts-${esc(r.key)}">—</dd></div>
        </dl>
        <p class="revier-links">${links}</p>
      </div>`;
  }

  function neuCard() {
    return `
      <a class="revier revier--neu" href="revier-neu.html">
        <div class="revier-neu-body">
          <span class="revier-neu-plus">+</span>
          <b>Neues Revier</b>
          <span>Koordinaten aus GPX oder Tabelle einlesen</span>
        </div>
      </a>`;
  }

  // Die schon bekannten Zahlen nach einem Neuzeichnen wieder eintragen.
  function applyStats() {
    Object.keys(stats).forEach((key) => {
      const st = stats[key];
      if (st.hunts != null) setStat("hunts", key, String(st.hunts));
      if (st.strecke != null) setStat("strecke", key, st.strecke);
    });
  }

  function setStat(kind, key, value) {
    const el = document.querySelector(`[data-stat="${kind}-${key}"]`);
    if (el) el.textContent = value;
  }

  render();

  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) return;

  const get = (action, params = {}) => {
    const u = new URL(cfg.APPS_SCRIPT_URL);
    u.searchParams.set("action", action);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const token = localStorage.getItem("preye.token");
    if (token) u.searchParams.set("token", token);
    return fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  };

  // Die Liste selbst kommt vom Server und ersetzt die Rückfallebene.
  get("reviere").then((d) => {
    if (!d || !d.reviere) throw new Error("keine Liste");
    serverKnowsReviere = true;
    window.preyeApplyReviere(d.reviere);
    d.reviere.forEach((r) => { stats[r.key] = Object.assign(stats[r.key] || {}, { posts: r.posts }); });
    render();
    loadZahlen();
  }).catch(() => {
    // Backend noch nicht bereitgestellt: die Ständezahl aus bootstrap holen und
    // nach Teilgebiet aufteilen. Das ist genau das, was die Seite vorher
    // gemacht hat — nur damals unaufgeteilt, weshalb Peenwerder die Summe des
    // ganzen Sheets zeigte.
    get("bootstrap", { revier: "all" }).then((d) => {
      const posts = (d && d.posts) || [];
      window.PREYE_REVIERE.forEach((r) => {
        const n = window.preyePostsForRevier(posts, r.key).length;
        stats[r.key] = Object.assign(stats[r.key] || {}, { posts: n });
      });
      render();
      loadZahlen();
    }).catch(loadZahlen);
  });

  function loadZahlen() {
    // Jagden je Revier — eine Abfrage, im Speicher aufgeteilt.
    get("events-list").then((list) => {
      const events = Array.isArray(list) ? list : [];
      window.PREYE_REVIERE.forEach((r) => {
        const n = events.filter((e) => window.preyeEventInRevier(e, r.key)).length;
        stats[r.key] = Object.assign(stats[r.key] || {}, { hunts: n });
      });
      // Neu zeichnen statt nur die Zahl zu setzen: vom Vorhandensein geplanter
      // Jagden hängt auch das Statusmerkmal ab („Stände fehlen noch" gegen
      // „neu angelegt").
      render();
      applyStats();
    }).catch(() => {});

    // Strecke je Revier. Eine Abfrage pro Revier — bei zwei oder drei ist das
    // billiger als ein neuer Endpunkt, und die Zahl war vorher schlicht falsch:
    // sie zeigte die Summe des ganzen Sheets unter dem Namen eines Reviers.
    if (!serverKnowsReviere) {
      window.PREYE_REVIERE.forEach((r) => {
        stats[r.key] = Object.assign(stats[r.key] || {}, { strecke: "—" });
        setStat("strecke", r.key, "—");
      });
      const foot = document.getElementById("reviere-foot-text");
      if (foot) foot.textContent =
        "Weitere Reviere kommen dazu. Die Streckenzahlen je Revier erscheinen, " +
        "sobald das Backend neu bereitgestellt ist.";
      return;
    }
    window.PREYE_REVIERE.forEach((r) => {
      get("strecke", { revier: r.key })
        .then((d) => {
          const txt = String(d.total || 0) + " Stück";
          stats[r.key] = Object.assign(stats[r.key] || {}, { strecke: txt });
          setStat("strecke", r.key, txt);
        })
        .catch(() => {});
    });
  }
})();
