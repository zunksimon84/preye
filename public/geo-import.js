// Geodaten einlesen: GPX vom Handgerät und Tabellen (CSV/TSV).
//
// Reine Funktionen, kein DOM-Bezug, kein Netz. Das ist Absicht: der Teil, in
// dem Koordinaten falsch werden können, muss ohne Browser prüfbar sein.
//
// Die Oberfläche dazu steht in revier-neu.js.

// ---------------------------------------------------------------------------
// Datei lesen
// ---------------------------------------------------------------------------

// Excel schreibt unter Windows „CSV (Trennzeichen-getrennt)" als
// Windows-1252 und „CSV UTF-8" mit Byte-Order-Mark. Beides liegt im selben
// Dialog einen Klick auseinander, beides kommt vor. file.text() nimmt immer
// UTF-8 an und macht aus jedem Umlaut Buchstabensalat.
export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ---------------------------------------------------------------------------
// Koordinaten
// ---------------------------------------------------------------------------

// Deutschland liegt zwischen 47,2 und 55,1 Grad Breite und 5,8 und 15,1 Grad
// Länge. Die Bänder überschneiden sich nicht — vertauschte Spalten sind
// deshalb sicher erkennbar, nicht nur vermutbar.
export const DE_LAT = [47.2, 55.1];
export const DE_LNG = [5.8, 15.1];

// Excel macht aus geraden Anführungszeichen typografische. Wer das nicht
// mitnimmt, verwirft die halben von Hand getippten Koordinaten.
const MIN_MARKS = "'′’";
const SEC_MARKS = '"″”';

// Himmelsrichtung. Achtung: im Deutschen steht O für Ost, also für East.
// Ein Leser, der das nicht kennt, verwirft die Zeile oder — schlimmer —
// behandelt sie als unbekannt und dreht das Vorzeichen nicht.
const HEMI = { N: 1, S: -1, E: 1, W: -1, O: 1 };

export function parseLatLng(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Vorzeichen aus der Himmelsrichtung, vorn oder hinten.
  let sign = 1;
  const hemiFront = s.match(/^([NSEWO])\s*/i);
  const hemiBack = s.match(/\s*([NSEWO])$/i);
  if (hemiFront) { sign = HEMI[hemiFront[1].toUpperCase()]; s = s.slice(hemiFront[0].length); }
  else if (hemiBack) { sign = HEMI[hemiBack[1].toUpperCase()]; s = s.slice(0, s.length - hemiBack[0].length); }
  s = s.trim();

  // Grad, Minuten, Sekunden — 53°37'34.2"
  const dms = s.match(
    new RegExp("^(-?\\d+)\\s*[°d]\\s*(\\d+(?:[.,]\\d+)?)\\s*[" + MIN_MARKS + "m]\\s*" +
               "(\\d+(?:[.,]\\d+)?)\\s*(?:[" + SEC_MARKS + "s]|''|" + MIN_MARKS + MIN_MARKS + ")?$", "i")
  );
  if (dms) return sign * dmsToDeg(dms[1], dms[2], dms[3]);

  // Grad und Dezimalminuten — N 53 37.410, die Voreinstellung auf Garmin-Geräten
  const dmm = s.match(new RegExp("^(-?\\d+)\\s*[°d ]\\s*(\\d+(?:[.,]\\d+)?)\\s*[" + MIN_MARKS + "m]?$", "i"));
  if (dmm) return sign * dmsToDeg(dmm[1], dmm[2], 0);

  // Dezimalgrad, auch mit Komma und einem angehängten Gradzeichen
  const dec = s.replace(/[°\s]/g, "").replace(",", ".");
  if (/^[+-]?\d+(\.\d+)?$/.test(dec)) return sign * parseFloat(dec);

  return null;
}

function dmsToDeg(d, m, sec) {
  const deg = Math.abs(parseFloat(String(d).replace(",", ".")));
  const min = parseFloat(String(m).replace(",", ".")) || 0;
  const s = parseFloat(String(sec).replace(",", ".")) || 0;
  const val = deg + min / 60 + s / 3600;
  return String(d).trim().startsWith("-") ? -val : val;
}

// Ein Feld wie „53.6234, 12.8423" — kommt vor, wenn jemand aus Google Maps
// kopiert. Fallstrick: „53,6234, 12,8423" mit Dezimalkomma. Über die Zahl der
// Kommas auflösbar.
export function parsePair(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  const commas = (s.match(/,/g) || []).length;
  let parts;
  if (commas === 3) {
    const m = s.match(/^(.+?,\d+)\s*,\s*(.+)$/);
    parts = m ? [m[1], m[2]] : null;
  } else {
    parts = s.split(/[;,]|\s{2,}/).map((x) => x.trim()).filter(Boolean);
    if (parts.length !== 2) parts = s.split(/\s+/).filter(Boolean);
  }
  if (!parts || parts.length !== 2) return null;
  const a = parseLatLng(parts[0]), b = parseLatLng(parts[1]);
  return (a == null || b == null) ? null : { lat: a, lng: b };
}

// Vertauschte Spalten. Nur eindeutig, wenn beide Werte in das jeweils andere
// Band fallen — sonst wird nichts gedreht.
export function looksSwapped(lat, lng) {
  const inLat = (v) => v >= DE_LAT[0] && v <= DE_LAT[1];
  const inLng = (v) => v >= DE_LNG[0] && v <= DE_LNG[1];
  return !inLat(lat) && inLat(lng) && !inLng(lng) && inLng(lat);
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

// Über DOMParser, nicht über reguläre Ausdrücke. Namensräume, Umlaut-Entitäten
// (&#228;) und CDATA in <desc> bekommt ein Ausdruck nicht zuverlässig hin, und
// Garmin schreibt lat vor lon, andere Programme umgekehrt.
export function parseGpx(text) {
  const clean = String(text || "").replace(/^﻿/, "");
  const doc = new DOMParser().parseFromString(clean, "application/xml");
  // DOMParser wirft nie. Er liefert ein Dokument mit <parsererror> darin.
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("Die Datei ließ sich nicht lesen: " + err.textContent.split("\n")[0]);
  if (!doc.documentElement || doc.documentElement.localName !== "gpx") {
    throw new Error("Das ist keine GPX-Datei.");
  }

  const pick = (tag) => Array.from(doc.getElementsByTagNameNS("*", tag));
  const points = pick("wpt").map((w, i) => gpxPoint(w, i, "wpt")).filter(Boolean);
  const rtepts = pick("rtept").map((w, i) => gpxPoint(w, i, "rtept")).filter(Boolean);

  // Tracks werden gezählt und gemeldet, nicht importiert. Sie haben keine
  // Namen und es sind Tausende. Stumm wegzulassen ist genau das Muster, das
  // dieses Programm an anderer Stelle schon teuer gemacht hat.
  const trkpts = pick("trkpt");
  const track = trkpts.map((t) => ({
    lat: parseFloat(t.getAttribute("lat")),
    lng: parseFloat(t.getAttribute("lon")),
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  return {
    points,
    routePoints: rtepts,
    track,
    skipped: {
      tracks: pick("trk").length,
      trackPoints: trkpts.length,
      routes: pick("rte").length,
      routePoints: rtepts.length,
    },
  };
}

function gpxPoint(el, i, kind) {
  const lat = parseFloat(el.getAttribute("lat"));
  const lng = parseFloat(el.getAttribute("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Als DIREKTES Kind lesen. Locus schreibt Erweiterungsblöcke mit einem
  // eigenen <name> darin — wer die Nachfahren durchsucht, erwischt den
  // falschen.
  const child = (tag) => {
    for (const c of el.children) if (c.localName === tag) return c.textContent.trim();
    return "";
  };
  return {
    src: kind + ":" + (child("name") || String(i + 1)),
    label: child("name"),
    note: child("desc") || child("cmt"),
    sym: child("sym"),
    // Die Kategorie auf dem Gerät. Wer seine Wegpunkte dort schon sortiert
    // hat, liefert damit faktisch die Teilgebietsspalte mit.
    group: child("type"),
    lat, lng,
  };
}

// ---------------------------------------------------------------------------
// Tabellen
// ---------------------------------------------------------------------------

// Trennzeichen über mehrere Zeilen bestimmen, nicht über die erste allein:
// eine Überschriftszeile („Stände Revier X") oder eine einspaltige erste Zeile
// führt sonst zur falschen Wahl. Gewinnt das Zeichen, das am häufigsten UND
// am gleichmäßigsten vorkommt.
export function sniffDelimiter(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim()).slice(0, 6);
  if (!lines.length) return ",";
  let best = ",", bestScore = -1;
  for (const d of ["\t", ";", ",", "|"]) {
    const counts = lines.map((l) => (l.split(d).length - 1)).filter((n) => n > 0);
    if (!counts.length) continue;
    // Über den häufigsten Wert, nicht über das Minimum: eine Titelzeile
    // („Stände Revier X") enthält das Trennzeichen gar nicht und würde es
    // sonst komplett ausschließen. Genau der Fall, für den das hier da ist.
    const freq = {};
    counts.forEach((n) => { freq[n] = (freq[n] || 0) + 1; });
    const mode = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a] || b - a)[0]);
    const score = freq[mode] * 10 + mode;   // gleichmäßig, und dann häufig
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

// Zeichenweiser Leser, damit ein Zeilenumbruch in einem Feld in
// Anführungszeichen die Tabelle nicht ab dort zerlegt.
export function parseTable(text, delim) {
  const d = delim || sniffDelimiter(text);
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === d) { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return { rows: rows.filter((r) => r.some((x) => String(x).trim())), delimiter: d };
}

// Spalten nach Kopfzeile erkennen. Deutsche und englische Bezeichnungen.
export const TABLE_FIELDS = ["name", "lat", "lng", "area", "type", "nr"];

export function sniffColumns(header) {
  const map = {};
  header.forEach((raw, i) => {
    const h = String(raw).toLowerCase().trim();
    if (!h) return;
    if (/^(name|bezeichnung|titel|label|stand)$/.test(h) || h.includes("bezeichn")) map.name ??= i;
    else if (/^(lat|breite|breitengrad|latitude)$/.test(h) || h.startsWith("breit")) map.lat ??= i;
    else if (/^(lng|lon|long|länge|laenge|längengrad|longitude)$/.test(h) || h.startsWith("läng") || h.startsWith("laeng")) map.lng ??= i;
    else if (/^(area|teilgebiet|gebiet|revierteil)$/.test(h)) map.area ??= i;
    else if (/^(type|typ|art)$/.test(h)) map.type ??= i;
    else if (/^(nr|nummer|no|number)$/.test(h)) map.nr ??= i;
    else if (/(koord|coord|position)/.test(h)) map.pair ??= i;
  });
  return map;
}

export function looksLikeHeader(row) {
  const joined = row.map((c) => String(c).toLowerCase()).join(" ");
  return /(name|bezeichn|lat|breit|lng|läng|laeng|teilgebiet|typ|koord)/.test(joined)
    // Eine Zeile mit lauter Zahlen ist keine Kopfzeile, egal wie sie heißt.
    && !row.every((c) => /^-?[\d.,]+$/.test(String(c).trim()));
}

// ---------------------------------------------------------------------------
// Nummer, Name, Typ
// ---------------------------------------------------------------------------

const DEVICE_PREFIX = /^(WP|WPT|WAYPOINT|PKT|POI)[\s\-_]*/i;
const STAND_WORDS = /(Nr\.?|DJB|Drückjagdbock|Kanzel|Hochsitz|Leiter|Bock|Sitz|Ansitz)/i;

// Peenwerder schreibt die Nummer vorn („Nr. 5 Ackerkante"), Handgeräte hinten
// („Hochsitz Nord 3"). Eine Regel allein trifft immer eine der beiden Familien
// falsch, deshalb zwei: steht ein Stichwort da, gilt die Zahl danach; sonst
// die letzte Zahl im Text.
export function extractNumber(label) {
  let s = String(label || "").trim().replace(DEVICE_PREFIX, "");
  if (!s) return "";
  const after = s.match(new RegExp(STAND_WORDS.source + "\\s*0*(\\d+[a-z]?)", "i"));
  if (after) return after[2].toUpperCase();
  const all = s.match(/0*(\d+[a-z]?)/gi);
  if (!all || !all.length) return "";
  const last = all[all.length - 1].replace(/^0+(?=\d)/, "");
  return last.toUpperCase();
}

export function extractType(label, sym) {
  const s = (String(label || "") + " " + String(sym || "")).toLowerCase();
  if (/dj\s?b|drückjagdbock|drueckjagdbock/.test(s)) return "Drückjagdbock";
  if (/leiter|ladder/.test(s)) return "Leiter";
  return "Kanzel";
}

// Passt der Name schon ins Muster, bleibt er BUCHSTABENGLEICH — nur so
// erzeugt ein erneuter Import von Peenwerder keine Änderung.
//
// Sonst wird „Nr. <Zahl>" vorangestellt. Das ist kein Schönheitsgrund:
// postNumberString_ im Backend nimmt die ERSTE Ziffernfolge im Namen, um den
// Kartenstift für das Jagd-PDF zu wählen. Bei „B12 Kanzel 5" wäre das die 12.
export function normaliseStand(point) {
  const label = String(point.label || "").trim();
  const nr = extractNumber(label);
  const type = extractType(label, point.sym);
  const already = /^(Nr\.?|DJB)\s*\d/i.test(label);
  let name;
  if (already) {
    name = label;
  } else if (nr) {
    const rest = label
      .replace(DEVICE_PREFIX, "")
      .replace(new RegExp(STAND_WORDS.source + "\\s*0*" + nr + "\\b", "i"), "")
      .replace(new RegExp("\\b0*" + nr + "\\b"), "")
      .replace(/\s{2,}/g, " ").trim();
    const head = type === "Drückjagdbock" ? "DJB " + nr : "Nr. " + nr;
    name = rest ? head + " " + rest : head;
  } else {
    name = label;
  }
  // Die Einschätzung hängt mit dran, damit der Assistent nur die Sitze
  // vorauswählt und bei allem anderen sagt, warum es abgewählt ist.
  const klasse = classifyPoint(point);
  return {
    ...point, nr, type, name: name.slice(0, 60), sourceLabel: label,
    kind: klasse.kind, kindReason: klasse.reason,
  };
}

// ---------------------------------------------------------------------------
// Ist das überhaupt ein Stand?
// ---------------------------------------------------------------------------
//
// Manche Geodaten-Apps sind das Notizbuch fürs ganze Revier: neben den Sitzen
// stehen Suhlen, Brunftplätze, Wechsel, befahrbare Wege und Obstbäume darin.
// Aus 102 Wegpunkten zweier solcher Dateien waren 34 Stände.
//
// Drei Töpfe, nicht zwei. „Kanzel aufstellen“ und „Leiter aufstellen Tanne“
// sind Vorhaben, keine vorhandenen Sitze — sie als Stand zu übernehmen wäre
// genauso falsch wie sie wegzuwerfen. Sie landen in „unsicher“, werden
// angezeigt und sind vorab abgewählt.

// Was einen Sitz benennt.
export const SITZ_WORDS = [
  "kanzel", "djbock", "dj bock", "djb", "drückjagdbock", "drueckjagdbock",
  "bock", "leiter", "klettersitz", "baumansitz", "hochsitz", "ansitz", "sitz",
];

// Was ein Geländemerkmal oder eine Beobachtung benennt. Wirkt nur, wenn kein
// Sitzwort vorn steht — „Leiter Senke Suhle Lichtleitung“ ist eine Leiter,
// die zufällig an einer Suhle steht.
export const NON_STAND_WORDS = [
  "suhle", "einstand", "brunft", "wechsel", "mahlbaum", "mast", "kessel",
  "sollloch", "solloch", "kuhle", "gatter", "nest", "kobel", "bergung",
  "zuwegung", "parkplatz", "pegel", "brücke", "bruecke", "lichtleitung",
  "saat", "zaun", "einfahrt", "pirsch", "fährte", "faehrte", "losung",
  "schweiß", "schweiss", "trittsiegel", "kirrung", "wildacker", "schneise",
];

// Was ein Vorhaben statt eines Bestands anzeigt.
export const PLANNED_WORDS = ["aufstellen", "eventuell", "evtl", "geplant", "vielleicht", "anlegen"];

// Symbole, die manche Apps vergeben. In den geprüften GaiaGPS-Dateien war
// purple-pin bei 25 von 25 ein Sitz und green-pin bei 18 von 18 keiner;
// red-pin-down war gemischt und trägt deshalb nichts bei.
export const SYM_STAND = ["tree-stand", "purple-pin", "hochsitz", "stand"];
export const SYM_NOT_STAND = ["green-pin", "trailhead", "campground", "water"];

function words(label) {
  return String(label || "").toLowerCase().split(/[\s\/,.\-_()]+/).filter(Boolean);
}

// Gibt { kind: "stand" | "kein-stand" | "unsicher", reason } zurück.
export function classifyPoint(point) {
  const label = String(point.label || "");
  const low = label.toLowerCase();
  const w = words(label);
  const sym = String(point.sym || "").toLowerCase();

  const symSagtStand = SYM_STAND.some((x) => sym.includes(x));
  const symSagtNein = SYM_NOT_STAND.some((x) => sym.includes(x));

  // Wo steht das Sitzwort? Ganz vorn heißt „das IST ein Sitz“, weit hinten
  // heißt oft „… 100m weiter steht eine Leiter“ — eine Wegbeschreibung.
  let posIdx = -1;
  for (let i = 0; i < w.length; i++) {
    if (SITZ_WORDS.some((k) => w[i].includes(k.replace(/\s/g, "")))) { posIdx = i; break; }
  }
  const hatSitzwort = posIdx >= 0 || SITZ_WORDS.some((k) => k.includes(" ") && low.includes(k));
  const vornDran = posIdx >= 0 && posIdx <= 2;

  const geplant = PLANNED_WORDS.some((k) => low.includes(k)) || /\?\s*$|\?\s/.test(label);
  const negWort = NON_STAND_WORDS.some((k) => low.includes(k));

  if (!hatSitzwort && !symSagtStand) {
    return { kind: "kein-stand", reason: symSagtNein ? "Beobachtung (Symbol)" : "kein Sitz im Namen" };
  }
  if (geplant) {
    return { kind: "unsicher", geplant: true,
             reason: "klingt nach Vorhaben, nicht nach vorhandenem Sitz" };
  }
  if (hatSitzwort && !vornDran && negWort) {
    return { kind: "unsicher", reason: "Sitzwort steht hinten — eher eine Wegbeschreibung" };
  }
  if (symSagtNein && !vornDran) {
    return { kind: "unsicher", reason: "Symbol spricht für eine Beobachtung" };
  }
  return { kind: "stand", reason: symSagtStand ? "Sitzwort und Symbol" : "Sitzwort im Namen" };
}

// Zweiter Durchgang: aus der Datei lernen, welches Symbol für Sitze steht.
//
// Simons Beobachtung: er vergibt innerhalb eines Teilgebiets für Sitze immer
// dieselbe Pin-Farbe. Wenn also ein Symbol bei den sicher erkannten Ständen
// vorkommt und bei keiner Beobachtung, dann spricht dasselbe Symbol auch bei
// einem unklaren Namen für einen Sitz.
//
// Das schlägt die fest eingetragenen Farbnamen, weil es mit jeder App
// funktioniert. SYM_STAND / SYM_NOT_STAND bleiben als Vorannahme für den Fall,
// dass die Datei zu wenig hergibt.
//
// Bewusst nur in die positive Richtung und bewusst nicht über Vorhaben hinweg:
// eine geplante Kanzel bleibt geplant, egal welche Farbe ihr Pin hat.
export function classifyBatch(points) {
  const erst = points.map((p) => ({ p, c: classifyPoint(p) }));

  // Wer wie oft mit welchem Symbol?
  const tally = {};
  erst.forEach(({ p, c }) => {
    const sym = String(p.sym || "").toLowerCase().trim();
    if (!sym) return;
    tally[sym] = tally[sym] || { stand: 0, kein: 0 };
    if (c.kind === "stand") tally[sym].stand++;
    else if (c.kind === "kein-stand") tally[sym].kein++;
  });

  // Ein Symbol gilt als sitztypisch, wenn es bei mindestens zwei sicheren
  // Ständen vorkommt und überwiegend dort.
  //
  // Über ein Verhältnis, nicht über „keine einzige Ausnahme“: sonst genügt ein
  // einziger anders benannter Punkt derselben Farbe, um das Signal zu
  // löschen — und weil genau solche Punkte die Kandidaten fürs Hochstufen
  // sind, schlägt sich die Regel dann selbst aus dem Rennen.
  //
  // 0,75 trennt sauber: in den geprüften Dateien lagen die eindeutigen
  // Symbole bei 1,0 und die gemischten bei 0,18 bis 0,44.
  const sitztypisch = {};
  Object.keys(tally).forEach((sym) => {
    const t = tally[sym];
    sitztypisch[sym] = t.stand >= 2 && t.stand / (t.stand + t.kein) >= 0.75;
  });

  return erst.map(({ p, c }) => {
    const sym = String(p.sym || "").toLowerCase().trim();
    if (!sym || !sitztypisch[sym]) return { ...c };
    const anzahl = tally[sym].stand;
    if (c.kind === "unsicher" && !c.geplant) {
      return { kind: "stand", reason: `Symbol wie ${anzahl} sichere Sitze in dieser Datei` };
    }
    if (c.kind === "kein-stand") {
      // Nur bis „unsicher“ hochstufen, nicht bis „Stand“. Ein Punkt ohne
      // jedes Sitzwort bleibt eine Entscheidung für den Menschen.
      return { kind: "unsicher", reason: `Symbol wie ${anzahl} sichere Sitze — Name sagt nichts` };
    }
    return { ...c };
  });
}

// Eine ganze Datei aufbereiten: Namen und Nummern je Punkt, danach der
// lernende Durchgang über die Symbole. Das ist der Weg, den die Oberfläche
// nimmt — normaliseStand allein kennt die Datei nicht und kann deshalb nichts
// aus ihr lernen.
export function prepareBatch(points) {
  const norm = points.map(normaliseStand);
  const klassen = classifyBatch(points);
  return norm.map((r, i) => ({ ...r, kind: klassen[i].kind, kindReason: klassen[i].reason }));
}

// ---------------------------------------------------------------------------
// Prüfen
// ---------------------------------------------------------------------------

export function distanceMetres(a, b) {
  // Ebene Näherung. Auf Revierentfernungen genau genug und drei Zeilen lang.
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = (((b.lng - a.lng) * Math.PI) / 180) * Math.cos(((a.lat + b.lat) / 2 * Math.PI) / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * R);
}

function median(values) {
  const v = values.slice().sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

export function validateBatch(rows, existingPosts, opts = {}) {
  const nearMetres = opts.nearMetres || 25;
  const farKm = opts.farKm || 15;
  const existing = (existingPosts || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const valid = rows.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  // Median, nicht Mittelwert: den Mittelwert zieht genau der Ausreißer weg,
  // den man sucht — der Wegpunkt vom Tirol-Urlaub im Geräteauszug.
  const centre = valid.length
    ? { lat: median(valid.map((r) => r.lat)), lng: median(valid.map((r) => r.lng)) }
    : null;

  const seenName = {};
  return rows.map((r) => {
    const msgs = [];
    let status = "ok";
    const add = (level, text) => {
      msgs.push({ level, text });
      if (level === "error") status = "error";
      else if (status !== "error") status = "warn";
    };

    if (!r.name) add("error", "Name fehlt");
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) {
      add("error", "Koordinaten fehlen oder sind unlesbar");
      return { ...r, status: "error", messages: msgs, take: false };
    }
    if (r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) {
      add("error", "Koordinaten außerhalb des gültigen Bereichs");
    }
    // Außerhalb Deutschlands ist nur eine Warnung — ein Revier darf in
    // Österreich liegen.
    const inDe = r.lat >= DE_LAT[0] && r.lat <= DE_LAT[1] && r.lng >= DE_LNG[0] && r.lng <= DE_LNG[1];
    if (!inDe) add("warn", "liegt außerhalb Deutschlands");

    if (centre) {
      const d = distanceMetres(centre, r);
      if (d > farKm * 1000) add("warn", `${(d / 1000).toFixed(0)} km vom Rest der Datei entfernt`);
    }
    if (!r.nr) add("warn", "keine Nummer im Namen");
    if (!r.area) add("error", "kein Teilgebiet zugeordnet");
    // Kein Fehler — eine Einschätzung. Der Mensch entscheidet.
    if (r.kind === "kein-stand") add("warn", "kein Stand: " + (r.kindReason || ""));
    else if (r.kind === "unsicher") add("warn", r.kindReason || "unsicher");

    const key = r.name.toLowerCase();
    if (seenName[key]) add("warn", "Name kommt in der Datei mehrfach vor");
    seenName[key] = true;

    let match = null;
    for (const p of existing) {
      const d = distanceMetres(p, r);
      if (d <= nearMetres) { match = { post: p, distance: d }; break; }
    }
    if (match) {
      // Kein Fehler, sondern eine Entscheidung: anhaken bedeutet
      // aktualisieren, nicht ein zweites Mal anlegen.
      add("warn", match.distance === 0
        ? `steht schon da („${match.post.name}") — anhaken aktualisiert ihn`
        : `${match.distance} m neben „${match.post.name}" — anhaken aktualisiert ihn`);
    }

    return {
      ...r,
      status,
      messages: msgs,
      matched: match,
      // Zeilen mit Fehler und Doppelgänger sind vorab abgewählt: nichts wird
      // geschrieben, was der Mensch nicht ausdrücklich bestätigt hat.
      // Nur was klar ein Sitz ist, kommt vorausgewählt. Suhlen, Wechsel und
      // Vorhaben stehen in der Liste, aber abgehakt — sichtbar statt still
      // weggeworfen.
      take: status !== "error" && !match && r.kind !== "kein-stand" && r.kind !== "unsicher",
    };
  });
}

// Vorschlag zur Gruppierung nach Nachbarschaft. Einfache Verkettung mit einer
// Schwelle — ein Parameter, nachvollziehbar, ohne vorher zu wissen, wie viele
// Gruppen es gibt.
export function suggestClusters(rows, metres = 600) {
  const pts = rows.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  const parent = pts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (distanceMetres(pts[i], pts[j]) <= metres) parent[find(i)] = find(j);
    }
  }
  const groups = {};
  pts.forEach((p, i) => {
    const root = find(i);
    (groups[root] = groups[root] || []).push(p);
  });
  return Object.values(groups).sort((a, b) => b.length - a.length);
}
