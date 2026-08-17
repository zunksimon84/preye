// PREYE landing page — the little bit of behaviour the page needs.
// Deliberately small: a marketing page that needs a framework to open a menu
// has already gone wrong.

(function () {
  const burger = document.getElementById("burger");
  const nav = document.getElementById("nav");
  const topbar = document.getElementById("topbar");

  // Mobile menu.
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    topbar.classList.toggle("is-menu-open", open);
    burger.setAttribute("aria-expanded", String(open));
  });

  // Close it again after a jump, otherwise the menu covers what you picked.
  nav.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      nav.classList.remove("is-open");
      topbar.classList.remove("is-menu-open");
      burger.setAttribute("aria-expanded", "false");
    }
  });

  // The bar only draws its rule once it is actually sitting on content —
  // over the hero it should be invisible.
  const sentinel = document.querySelector(".hero");
  if (sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => topbar.classList.toggle("is-stuck", !entry.isIntersecting),
      { rootMargin: "-70px 0px 0px 0px", threshold: 0 }
    ).observe(sentinel);
  }

  // Some browsers refuse autoplay until a gesture. If that happens the poster
  // stays up, which is a fine fallback — but retry once on first interaction.
  const loop = document.querySelector(".hero-loop");
  if (loop) {
    const kick = () => {
      loop.play().catch(() => {});
      window.removeEventListener("pointerdown", kick);
    };
    loop.play().catch(() => window.addEventListener("pointerdown", kick, { once: true }));
  }
})();

/* ---------------------------------------------------------------------------
   Dashboard.

   The numbers are pulled live from the same Apps Script the map uses, so the
   landing page cannot quietly disagree with the tool. The markup ships with
   the last known values baked in: if the backend is slow, asleep or down, the
   page still shows something true-ish rather than dashes, and the fetch simply
   replaces it a moment later.
   --------------------------------------------------------------------------- */

(function dashboard() {
  const cfg = window.PEENWERDER_CONFIG || {};
  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) return;

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const url = (action, params = {}) => {
    const u = new URL(cfg.APPS_SCRIPT_URL);
    u.searchParams.set("action", action);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return u.toString();
  };

  const get = (action, params) =>
    fetch(url(action, params)).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

  // Stands are grouped by the four Reviere; Klettersitze and Pirsch spots are
  // real but they are not areas, so they go in one line at the end.
  const AREA_ORDER = ["Hauptrevier", "Nord", "Nordrand", "Ost"];

  function renderPosts(posts) {
    $("#d-posts").textContent = String(posts.length);
    const counts = {};
    posts.forEach((p) => {
      const a = p.area || "?";
      counts[a] = (counts[a] || 0) + 1;
    });
    const rows = AREA_ORDER.filter((a) => counts[a]).map((a) => [a, counts[a]]);
    const rest = Object.keys(counts)
      .filter((a) => !AREA_ORDER.includes(a))
      .reduce((n, a) => n + counts[a], 0);
    if (rest) rows.push(["Klettersitz & Pirsch", rest]);

    const max = Math.max(...rows.map((r) => r[1]), 1);
    $("#d-areas").innerHTML = rows.map(([name, n]) =>
      `<div class="area" style="--w: ${Math.round(n / max * 100)}">
         <span>${esc(name)}</span><b>${n}</b>
       </div>`).join("");
  }

  function renderTopStands(posts, aggregates) {
    const byId = {};
    posts.forEach((p) => { byId[p.id] = p; });
    const best = {}; // area → { name, count }
    aggregates.forEach((row) => {
      const post = byId[row.post_id];
      if (!post) return;
      const area = post.area || "?";
      if (!best[area] || row.total_count > best[area].count) {
        best[area] = { name: post.name || row.post_id, count: row.total_count };
      }
    });

    const rows = AREA_ORDER.filter((a) => best[a]);
    const el = $("#d-top");
    if (!rows.length) {
      el.innerHTML = '<li class="toplist-empty">Noch keine Strecke eingetragen.</li>';
      return;
    }
    el.innerHTML = rows.map((a) =>
      `<li>
         <span class="area-name">${esc(a)}</span>
         <span class="stand">${esc(best[a].name)}</span>
         <span class="count">${best[a].count}</span>
       </li>`).join("");
  }

  function renderStrecke(data) {
    $("#d-total").textContent = String(data.total || 0);
    const list = data.by_species || [];
    const el = $("#d-species");
    if (!list.length) {
      el.innerHTML = '<li class="toplist-empty">Noch keine Strecke in dieser Saison.</li>';
      return;
    }
    const max = Math.max(...list.map((r) => r.count), 1);
    el.innerHTML = list.map((r) => {
      const g = r.by_gender || {};
      const m = (g.m && g.m.count) || 0;
      const w = (g.w && g.w.count) || 0;
      const rest = Math.max(0, r.count - m - w);
      const split = [
        m ? "♂ " + m : "",
        w ? "♀ " + w : "",
        rest ? "ohne Angabe " + rest : "",
      ].filter(Boolean).join(" · ");
      return `<li>
          <span class="sp-name">${esc(r.species)}</span>
          <span class="sp-count">${r.count}</span>
          <span class="sp-bar"><i style="width:${Math.round(r.count / max * 100)}%"></i></span>
          ${split ? `<span class="sp-split">${esc(split)}</span>` : ""}
        </li>`;
    }).join("");

    if (data.season_start && data.season_end) {
      const fmt = (iso) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : iso;
      };
      $("#d-season").textContent = `Saison ${fmt(data.season_start)} – ${fmt(data.season_end)}`;
    }
  }

  // Two calls, both already public, both cheap. Failures stay silent: the
  // baked-in numbers are already on screen and a red error on a landing page
  // helps nobody.
  Promise.all([get("bootstrap"), get("aggregates")])
    .then(([boot, agg]) => {
      const posts = boot.posts || [];
      renderPosts(posts);
      renderTopStands(posts, agg || []);
      const facts = document.querySelectorAll(".hero-facts b");
      if (facts[0]) facts[0].textContent = String(posts.length);
      if (facts[1] && boot.hunters) facts[1].textContent = String(boot.hunters.length);
    })
    .catch(() => {});

  get("strecke").then(renderStrecke).catch(() => {});

  get("events-list").then((events) => {
    const facts = document.querySelectorAll(".hero-facts b");
    if (facts[2] && Array.isArray(events)) facts[2].textContent = String(events.length);
  }).catch(() => {});
})();
