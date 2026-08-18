// Revier-Auswahl. Die Zahlen kommen live, damit die Karten nicht behaupten,
// was das Backend längst anders weiß.

(function () {
  const cfg = window.PEENWERDER_CONFIG || {};
  const $ = (s) => document.querySelector(s);

  const burger = $("#burger"), nav = $("#nav");
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
  });

  if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith("PASTE")) return;

  const get = (action) => {
    const u = new URL(cfg.APPS_SCRIPT_URL);
    u.searchParams.set("action", action);
    return fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  };

  // Everything on the map today belongs to Peenwerder, so the whole bootstrap
  // is that Revier's count. When a second Revier gets its stands, this needs to
  // split by area — the areas are already on every post.
  const NPA = ["Babke", "Langenhagen", "Schwarzenhof", "Serrahn"];

  get("bootstrap").then((d) => {
    $("#pw-posts").textContent = String((d.posts || []).length);
    $("#pw-hunters").textContent = String((d.hunters || []).length);
  }).catch(() => {});

  get("strecke").then((d) => {
    $("#pw-strecke").textContent = String(d.total || 0) + " Stück";
  }).catch(() => {});

  get("events-list").then((list) => {
    const npa = (Array.isArray(list) ? list : []).filter((e) =>
      NPA.some((a) => String(e.teilgebiet || "").includes(a)));
    $("#npa-hunts").textContent = String(npa.length);
  }).catch(() => {});
})();
