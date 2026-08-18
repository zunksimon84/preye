// Hält --vv-top / --vv-bottom aktuell: um wie viel das sichtbare Fenster gegen
// das Layout-Fenster verschoben ist.
//
// Auf dem iPhone reicht env(safe-area-inset-top) allein nicht. Die Seite läuft
// mit viewport-fit=cover, liegt also bis unter Statusleiste und Browserleiste.
// Die Safe-Area deckt die Statusleiste ab; was sie nicht abdeckt, ist der
// Versatz, der beim Zoomen und beim Ein- und Ausfahren der Safari-Leiste
// entsteht. Genau den liefert visualViewport.offsetTop.
//
// Stand bisher nur in app.js und wirkte deshalb nur auf der Kartenseite —
// im Control Room und in den Revieren rutschten Logo und Navigation unter die
// URL-Leiste, weil dort weder das eine noch das andere ankam.

(function () {
  "use strict";
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty("--vv-top", Math.max(0, vv.offsetTop) + "px");
    root.style.setProperty(
      "--vv-bottom",
      Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px"
    );
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
})();
