// Reviere und Teilgebiete — die Mechanik. Die Daten kommen vom Server.
//
// Bis August 2026 stand die Liste hier fest, und ein neues Revier hätte einen
// Git-Push gebraucht. Jetzt liegt sie im Sheet (Blätter `reviere` und
// `revier_areas`) und kommt mit `bootstrap` bzw. `?action=reviere` herein.
//
// Die Liste unten bleibt trotzdem stehen, als **Rückfallebene**: sie ist das,
// was beim ersten Bildaufbau und ohne Netz angezeigt wird. Sobald die Antwort
// da ist, überschreibt preyeApplyReviere() sie. Wer sie ändert, ändert nur den
// Startwert — die Wahrheit steht im Sheet.

window.PREYE_REVIERE = [
  { key: "peenwerder", name: "Peenwerder", short: "Peenwerder",
    areas: ["Hauptrevier", "Ost", "Nord", "Nordrand"] },
  { key: "mueritz", name: "Müritz Nationalpark", short: "NPA-Müritz",
    areas: ["Babke", "Langenhagen", "Schwarzenhof", "Serrahn"] },
];

// Nicht jede Jagd liegt in einem der eingerichteten Reviere — ein
// Gruppenansitz kann anderswo stattfinden. Solche Termine haben schlicht kein
// Teilgebiet. Der Schlüssel steht hier, damit Filter und Formular denselben
// Namen dafür benutzen.
window.PREYE_REVIER_NONE = { key: "ohne", name: "Kein Revier hinterlegt", short: "Ohne Revier" };

// Jagdart. Die Werte müssen zu HUNT_KINDS in Code.gs passen; alte Termine
// haben die Spalte leer, das Backend liest sie als "drueckjagd".
window.PREYE_JAGDARTEN = [
  { key: "drueckjagd", name: "Drückjagd" },
  { key: "gruppenansitz", name: "Gruppenansitz" },
];

// Freie Gebiete, die kein Teilgebiet sind: von Jägern selbst erzeugte Standorte.
// Stand bisher in app.js.
window.PREYE_FREE_AREAS = ["Klettersitz", "Pirsch"];

const PREYE_REVIERE_STORE = "preye.reviere.v1";

// Übernimmt die Liste vom Server. Wird von bootstrap und ?action=reviere
// gefüttert und legt sie zusätzlich in sessionStorage ab, damit der nächste
// Seitenaufbau sofort die richtigen Namen zeigt statt kurz die alten.
window.preyeApplyReviere = function (list) {
  if (!Array.isArray(list) || !list.length) return window.PREYE_REVIERE;
  window.PREYE_REVIERE = list.map((r) => ({
    key: String(r.key),
    name: String(r.name || r.key),
    short: String(r.short || r.name || r.key),
    areas: Array.isArray(r.areas) ? r.areas.slice() : [],
    status: String(r.status || ""),
    center: r.center || null,
    zoom: r.zoom || null,
    pano: r.pano || "",
    vet: r.vet || null,
    posts: Number(r.posts) || 0,
  }));
  try {
    sessionStorage.setItem(PREYE_REVIERE_STORE, JSON.stringify(window.PREYE_REVIERE));
  } catch (err) { /* privater Modus, egal */ }
  return window.PREYE_REVIERE;
};

// Beim Laden gleich den letzten bekannten Stand nehmen, falls vorhanden.
(function () {
  try {
    const cached = sessionStorage.getItem(PREYE_REVIERE_STORE);
    if (cached) window.preyeApplyReviere(JSON.parse(cached));
  } catch (err) { /* egal */ }
})();

window.preyeRevierByKey = function (key) {
  return window.PREYE_REVIERE.find((r) => r.key === key) || null;
};

// Zu welchem Revier gehört ein Teilgebiet? Ersetzt die Kopien in events.js und
// standkarte.js.
window.preyeRevierForArea = function (area) {
  return window.PREYE_REVIERE.find((r) => r.areas.includes(area)) || null;
};

// Das Revier einer Jagd. Ersetzt isNpaHunt() in standkarte.js.
window.preyeEventRevier = function (event) {
  const parts = window.preyeEventAreas(event);
  for (const a of parts) {
    const r = window.preyeRevierForArea(a);
    if (r) return r;
  }
  return null;
};

// Alle Teilgebiete aller Reviere, in Reihenfolge.
window.preyeAllAreas = function () {
  return window.PREYE_REVIERE.flatMap((r) => r.areas);
};

// Die Stände eines Reviers. Der Server liefert schon gefiltert; das hier ist
// für die Fälle, in denen eine Seite alles geholt hat (Offline-Rückfall, oder
// die Jagdplanungen, die revierübergreifend arbeiten).
//
// Klettersitz und Pirsch gehören keinem Teilgebiet an. Sie tragen ihr Revier
// in einer eigenen Spalte — über den Gebietsnamen wären sie nicht zuzuordnen.
window.preyePostsForRevier = function (posts, key) {
  if (!key) return posts || [];
  const revier = window.preyeRevierByKey(key);
  if (!revier) return [];
  const areas = new Set(revier.areas);
  return (posts || []).filter((p) => {
    if (p && p.revier) return p.revier === key;
    return areas.has(p && p.area);
  });
};

// Eine Jagd kann revierübergreifend sein ("Nord, Nordrand"), das Feld ist
// deshalb eine Liste. Sie zählt zu einem Revier, sobald eines ihrer
// Teilgebiete dort liegt.
window.preyeEventAreas = function (event) {
  return String((event && event.teilgebiet) || "").split(/\s*,\s*/).filter(Boolean);
};

window.preyeEventInRevier = function (event, key) {
  const parts = window.preyeEventAreas(event);
  if (key === window.PREYE_REVIER_NONE.key) return parts.length === 0;
  const revier = window.PREYE_REVIERE.find((r) => r.key === key);
  if (!revier) return false;
  return parts.some((p) => revier.areas.includes(p));
};

// Das Auswahlraster für Teilgebiete. Stand bis August 2026 zweimal wörtlich im
// Markup — einmal im Anlege-Formular, einmal im Bearbeiten-Dialog — und hätte
// mit der dritten Spalte ein drittes Mal dagestanden.
window.preyeRevierGrid = function (inputName, selectedAreas) {
  const sel = new Set(selectedAreas || []);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cols = window.PREYE_REVIERE.map((r) => `
    <div class="ev-revier-col">
      <p class="ev-revier-title">${esc(r.short)}</p>
      <div class="ev-checkbox-grid ev-checkbox-grid--single">
        ${r.areas.map((a) => `<label class="ev-checkbox"><input type="checkbox" name="${esc(inputName)}" value="${esc(a)}"${sel.has(a) ? " checked" : ""} /> ${esc(a)}</label>`).join("\n        ")}
      </div>
    </div>`);
  // Dritte Spalte: kein Teilgebiet. Technisch ist das derselbe Zustand wie
  // "nichts angehakt" — sichtbar gemacht, damit es eine Entscheidung ist und
  // kein Vergessen.
  cols.push(`
    <div class="ev-revier-col ev-revier-col--none">
      <p class="ev-revier-title">${esc(window.PREYE_REVIER_NONE.short)}</p>
      <div class="ev-checkbox-grid ev-checkbox-grid--single">
        <label class="ev-checkbox"><input type="checkbox" data-revier-none="1"${sel.size ? "" : " checked"} /> Kein Revier</label>
      </div>
      <p class="ev-revier-note">z.B. ein Gruppenansitz außerhalb der eingerichteten Reviere</p>
    </div>`);
  return cols.join("");
};

// Verdrahtet das Raster: "Kein Revier" und die Teilgebiete schließen sich aus.
window.preyeWireRevierGrid = function (root, inputName) {
  const none = root.querySelector("[data-revier-none]");
  const areas = [...root.querySelectorAll(`input[name="${inputName}"]`)];
  if (!none) return;
  none.addEventListener("change", () => {
    if (none.checked) areas.forEach((a) => { a.checked = false; });
    else if (!areas.some((a) => a.checked)) none.checked = true; // nichts sonst gewählt
  });
  areas.forEach((a) => a.addEventListener("change", () => {
    if (a.checked) none.checked = false;
    else if (!areas.some((x) => x.checked)) none.checked = true;
  }));
};

// ---------------------------------------------------------------------------
// Farben je Teilgebiet
// ---------------------------------------------------------------------------
//
// Peenwerders sechs Farben stehen fest und werden nie erzeugt — das Lime ist
// die Markenfarbe, und „blau = Ost" ist gelernt.
window.PREYE_PINNED_COLORS = {
  "Hauptrevier": "#b5d33a",
  "Ost":         "#1565c0",
  "Nord":        "#ef6c00",
  "Nordrand":    "#6a1b9a",
  "Klettersitz": "#03a9f4",
  "Pirsch":      "#e2dc3a",
};

// Alles andere wird gerechnet, und zwar in OKLCH bei **konstanter Helligkeit**.
// Auf einem gewöhnlichen Farbkreis mit fester Sättigung ist Gelb sehr viel
// heller als Blau; auf dem Satellitenbild springt das eine ins Auge und das
// andere verschwindet im beschatteten Wald.
//
// Nachgemessen für acht Farben mit gleichem Winkelabstand, Kontrast gegen
// dunklen Mischwald (#1a2c18):
//     OKLCH, konstante Helligkeit   3,7 … 4,8   (Spanne 1,1)
//     HSL 50 %, wie man es naiv macht   2,4 … 6,7   (Spanne 4,3)
// Die Helligkeitsspanne ist damit gut viermal enger. Der weiße Rand am Marker
// trägt die Kante zusätzlich.
const PREYE_L = 0.62;   // über dunklem Wald, unter hellem Stoppelfeld
const PREYE_C = 0.17;

function preyeOklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return "#" + lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  }).join("");
}

// Der Startwinkel kommt aus dem Revier-Schlüssel, nicht aus der Position in der
// Liste. Sonst würde sich beim Anlegen eines weiteren Reviers jede bestehende
// Farbe verschieben.
function preyeHashHue(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

const preyeColorCache = {};

window.preyeAreaColor = function (area) {
  if (window.PREYE_PINNED_COLORS[area]) return window.PREYE_PINNED_COLORS[area];
  if (preyeColorCache[area]) return preyeColorCache[area];
  const revier = window.preyeRevierForArea(area);
  if (!revier) return "#8a8a8a";
  const i = revier.areas.indexOf(area);
  const n = Math.max(revier.areas.length, 1);
  const hue = (preyeHashHue(revier.key) + (i * 360) / n) % 360;
  const hex = preyeOklchToHex(PREYE_L, PREYE_C, hue);
  preyeColorCache[area] = hex;
  return hex;
};

// Punktgröße: feste Kanzeln groß, selbst gesetzte Standorte kleiner. Stand
// bisher als MARKER_SCALE in app.js.
window.preyeMarkerScale = function (area) {
  if (area === "Pirsch") return 3;
  if (area === "Klettersitz") return 4;
  return 5;
};
