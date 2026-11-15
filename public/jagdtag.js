// Jagdtag-Vorbelegung für die festen QR-Links aus den Papiereinladungen.
//
// Die Einladungen des Nationalparkamts tragen zwei QR-Codes ohne Jagd-ID:
//   preye.org/standkarte.html?blanko=1   und   preye.org/nachsuche.html
// Gedruckt ist gedruckt — die Links bleiben, also kommen die Jagdtage hierher.
// Blanko-Standkarte und Anschussprotokoll füllen Jagd, Treffpunkt und Kontakte
// dann selbst aus, und die Standkarte geht per SMS an den Nachsuchen-
// Koordinator.
//
// Welche Jagd gilt, entscheidet das Datum auf dem Handy, ganz ohne Server:
//   1. Ist heute eine Jagd, gilt die.
//   2. Sonst die von gestern — für Nachsuchen am Folgetag.
//   3. Sonst die nächste kommende.
// Ist keine mehr übrig, ist window.PREYE_JAGDTAG null und beide Seiten sind
// wieder ganz leer. Neue Einladung: einfach unten in JAGDEN anhängen.
//
// Zum Testen: ?heute=2026-12-10 an die Adresse hängen.

(function () {
  // Bleibt bei allen Jagden gleich.
  const KONTAKTE = {
    // Empfänger der Standkarte per SMS.
    nachsuchen_koordinator: { name: "Felix Sahlmann", phone: "0157 87447686" },
    // Bewusst leer — wird am Jagdtag selbst eingetragen.
    nachsuchenfuehrer: [],
    tierarzt: { name: "Achim Meyer-Breckwoldt", phone: "0171 5192264" },
  };

  // Treffpunkte, die mehrfach vorkommen.
  const BLANKENFOERDE = {
    treffpunkt: "Parkplatz NLP-Info / Rangerstation Blankenförde, Blankenförde 30, 17252 Mirow-Roggentin",
    treffpunkt_hinweis: "Neustrelitz Richtung Userin, 2 km hinter Zwenzow rechts Richtung Blankenförde. " +
      "Die Info liegt rechts auf Höhe der Vorfahrtsstraße Richtung Babke, der Parkplatz links gegenüber auf der Freifläche.",
    treffpunkt_lat: 53.354895,
    treffpunkt_lng: 12.923318,
    nach_der_jagd: "Rangerstation Blankenförde (Treffpunkt)",
    nach_der_jagd_lat: 53.354895,
    nach_der_jagd_lng: 12.923318,
  };
  const SCHWARZENHOF_NACH = {
    nach_der_jagd: "Rangerstation Schwarzenhof, Schwarzenhof 5, 17192 Kargow",
    nach_der_jagd_lat: 53.462932,
    nach_der_jagd_lng: 12.800693,
  };

  // Aus den Einladungen (Ulf Zimmermann). Die Einladungen nennen nur den
  // Treffpunkt um 7:30 — Jagdbeginn und -ende bleiben deshalb leer und
  // erscheinen dann gar nicht erst auf der Karte.
  const JAGDEN = [
    Object.assign({
      jagd: "Ansitzdrückjagd Müritz-Mitte · Fuchsbruch",
      revier: "Distrikt Müritz-Mitte, Fuchsbruch",
      datum: "2026-12-09",
      treff_time: "07:30",
    }, BLANKENFOERDE),
    Object.assign({
      jagd: "Ansitzdrückjagd Müritz-Mitte · Babke",
      revier: "Distrikt Müritz-Mitte, Babke",
      datum: "2026-12-10",
      treff_time: "07:30",
    }, BLANKENFOERDE),
    Object.assign({
      jagd: "Ansitzdrückjagd Müritz-West · Schwarzenhof",
      revier: "Distrikt Müritz-West, Schwarzenhof",
      datum: "2026-12-11",
      treffpunkt: "NLP-Information / Rangerstation Schwarzenhof, Schwarzenhof 5, 17192 Kargow",
      treffpunkt_hinweis: "B192 – Kargow – Federow – Schwarzenhof, nach 200 m im Ort links.",
      treffpunkt_lat: 53.462932,
      treffpunkt_lng: 12.800693,
      treff_time: "07:30",
    }, SCHWARZENHOF_NACH),
    Object.assign({
      jagd: "Ansitzdrückjagd Müritz-West · Fitten",
      revier: "Distrikt Müritz-West, Schwarzenhof (Fitten)",
      datum: "2026-12-19",
      treffpunkt: "Charlottenhof, 17192 Kargow",
      treffpunkt_hinweis: "B192 Kargow, Ortsausgang hinter den Bahnschienen im 180°-Winkel links Richtung Charlottenhof.",
      treffpunkt_lat: 53.501270,
      treffpunkt_lng: 12.818989,
      treff_time: "07:30",
    }, SCHWARZENHOF_NACH),
  ].map((j) => Object.assign({}, j, KONTAKTE))
    .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

  let now = new Date();
  const override = new URLSearchParams(location.search).get("heute");
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    now = new Date(override + "T12:00:00");
  }
  const today = iso(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = iso(y);

  window.PREYE_JAGDTAG =
    JAGDEN.find((j) => j.datum === today) ||
    JAGDEN.find((j) => j.datum === yesterday) ||
    JAGDEN.find((j) => j.datum > today) ||
    null;
})();
