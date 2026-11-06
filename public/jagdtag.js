// Jagdtag-Vorbelegung für die festen QR-Links aus einer Papiereinladung.
//
// Die Einladung des Nationalparkamts trägt zwei QR-Codes ohne Jagd-ID:
//   preye.org/standkarte.html?blanko=1   und   preye.org/nachsuche.html
// Gedruckt ist gedruckt — die Links bleiben, also kommt der Jagdtag hierher.
// Solange heute zwischen gilt_ab und gilt_bis liegt, füllen Blanko-Standkarte
// und Anschussprotokoll Jagd, Zeiten und Kontakte selbst aus, und die
// Standkarte geht per SMS an den Nachsuchen-Koordinator. Danach ist
// window.PREYE_JAGDTAG null und beide Seiten sind wieder ganz leer.
//
// Für die nächste Einladung dieser Art: Werte tauschen, Daten verschieben.

(function () {
  const JAGDTAG = {
    gilt_ab: "2026-11-01",
    gilt_bis: "2026-11-08", // ein Tag Luft für Nachsuchen am Folgetag

    jagd: "Ansitzdrückjagd Müritz-West · Fitten",
    revier: "Distrikt Müritz-West, Schwarzenhof (Fitten)",
    datum: "2026-11-07",

    treffpunkt: "Charlottenhof, 17192 Kargow",
    treffpunkt_hinweis: "B192 Kargow, Ortsausgang hinter den Bahnschienen im 180°-Winkel links Richtung Charlottenhof",
    treffpunkt_lat: 53.501270,
    treffpunkt_lng: 12.818989,
    treff_time: "07:30",
    start_time: "09:00",
    end_time: "12:30",
    nach_der_jagd: "Rangerstation Schwarzenhof, Schwarzenhof 5, 17192 Kargow",
    nach_der_jagd_lat: 53.462932,
    nach_der_jagd_lng: 12.800693,

    // Empfänger der Standkarte per SMS.
    nachsuchen_koordinator: { name: "Felix Sahlmann", phone: "0157 87447686" },
    // Bewusst leer — wird am Jagdtag selbst eingetragen.
    nachsuchenfuehrer: [],
    tierarzt: { name: "Achim Meyer-Breckwoldt", phone: "0171 5192264" },
  };

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  window.PREYE_JAGDTAG =
    today >= JAGDTAG.gilt_ab && today <= JAGDTAG.gilt_bis ? JAGDTAG : null;
})();
