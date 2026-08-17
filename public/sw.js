// Service worker for the Standkarte.
//
// The card is opened at home with signal and then used in the Kanzel, where
// there often is none. Without this, reloading the page out there gives a
// browser error screen. So we keep a copy of the Standkarte's shell and serve
// it whenever the network doesn't answer.
//
// Deliberately narrow: only the files listed in SHELL are handled, and only
// when the network fails. Everything else — the map page, the Apps Script
// backend, Google Maps, the fonts — passes straight through untouched, so
// this can't make the rest of the site behave oddly. Hunt data doesn't live
// here either; standkarte.js caches that in localStorage itself.

const CACHE = "preye-standkarte-v1";

const SHELL = [
  "standkarte.html",
  "standkarte.js",
  "style.css",
  "config.js",
  "preye-mark.png",
  "favicon-preye.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One bad file shouldn't fail the whole install, so add them one by one.
      .then((cache) => Promise.all(SHELL.map((f) => cache.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first: online you always get the freshly deployed file, and the
// cache is only there for the moment the network isn't.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const name = url.pathname.replace(/^\/+/, "");
  if (!SHELL.includes(name)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
