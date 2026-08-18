// Installier-Verdrahtung.
//
// Every page registers the service worker, because the browser only offers
// "install" when one is present — and the offer has to work no matter which
// page someone happens to open first. The worker itself stays narrow (see
// sw.js): it only answers for the Standkarte's own files.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
