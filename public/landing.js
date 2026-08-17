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
