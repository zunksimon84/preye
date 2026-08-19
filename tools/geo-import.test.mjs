import {
  parseLatLng, parsePair, looksSwapped, sniffDelimiter, parseTable, sniffColumns,
  looksLikeHeader, extractNumber, extractType, normaliseStand, distanceMetres,
  validateBatch, suggestClusters, classifyPoint, prepareBatch,
} from '/Users/simonzunk/Code/hunting-heatmap/public/geo-import.js';

let fehler = 0;
const ist = (was, soll, name) => {
  const ok = typeof soll === "number"
    ? (was != null && Math.abs(was - soll) < 1e-4)
    : JSON.stringify(was) === JSON.stringify(soll);
  if (!ok) { console.log(`  ✗ ${name}: ${JSON.stringify(was)} statt ${JSON.stringify(soll)}`); fehler++; }
  else console.log(`  ✓ ${name.padEnd(42)} ${JSON.stringify(was)}`);
};

console.log("Koordinaten");
ist(parseLatLng("53.6234"), 53.6234, "Dezimalgrad");
ist(parseLatLng("53,6234"), 53.6234, "Dezimalkomma (deutsches Excel)");
ist(parseLatLng("+53.6234"), 53.6234, "mit Pluszeichen");
ist(parseLatLng("-3.5"), -3.5, "negativ");
ist(parseLatLng('53°37\'34.2"N'), 53.6262, "Grad/Minute/Sekunde");
ist(parseLatLng('53° 37\' 34.2" N'), 53.6262, "mit Leerzeichen");
ist(parseLatLng('53°37′34.2″N'), 53.6262, "typografische Zeichen (Excel)");
ist(parseLatLng("N 53 37.410"), 53.6235, "Grad/Dezimalminute (Garmin-Standard)");
ist(parseLatLng("53 37.410 N"), 53.6235, "Richtung hinten");
ist(parseLatLng("O 12.8423"), 12.8423, "deutsches O = Ost");
ist(parseLatLng("W 12.8423"), -12.8423, "West kehrt das Vorzeichen um");
ist(parseLatLng("S 53.6"), -53.6, "Süd kehrt um");
ist(parseLatLng("53.6234°"), 53.6234, "mit Gradzeichen");
ist(parseLatLng("Unfug"), null, "Unlesbares wird verworfen");
ist(parseLatLng(""), null, "leer");

console.log("\nkombiniertes Feld");
ist(parsePair("53.6234, 12.8423"), {lat:53.6234,lng:12.8423}, "aus Google Maps kopiert");
ist(parsePair("53,6234, 12,8423"), {lat:53.6234,lng:12.8423}, "mit Dezimalkomma (3 Kommas)");
ist(parsePair("53.6234 12.8423"), {lat:53.6234,lng:12.8423}, "durch Leerzeichen");

console.log("\nvertauschte Spalten");
ist(looksSwapped(12.8423, 53.6234), true, "eindeutig vertauscht");
ist(looksSwapped(53.6234, 12.8423), false, "richtig herum");
ist(looksSwapped(50.0, 8.0), false, "beides plausibel — nicht drehen");

console.log("\nTrennzeichen");
ist(sniffDelimiter("Stände Revier X\nname;lat;lng\nA;1;2\nB;3;4"), ";", "Titelzeile stört nicht");
ist(sniffDelimiter("a\tb\tc\n1\t2\t3"), "\t", "Tabulator (aus Excel kopiert)");
ist(sniffDelimiter("a,b,c\n1,2,3"), ",", "Komma");

console.log("\nTabelle");
{
  const t = parseTable('name;lat;lng\n"Nr. 5; mit Semikolon";53,6;12,8\nNr. 6;53,7;12,9');
  ist(t.rows.length, 3, "Zeilen");
  ist(t.rows[1][0], "Nr. 5; mit Semikolon", "Trennzeichen im Anführungszeichen");
  ist(looksLikeHeader(t.rows[0]), true, "Kopfzeile erkannt");
  ist(looksLikeHeader(t.rows[1]), false, "Datenzeile ist keine Kopfzeile");
  ist(sniffColumns(t.rows[0]), {name:0,lat:1,lng:2}, "Spalten zugeordnet");
  ist(sniffColumns(["Bezeichnung","Breitengrad","Längengrad","Teilgebiet"]),
      {name:0,lat:1,lng:2,area:3}, "deutsche Überschriften");
}

console.log("\nNummern aus Gerätenamen");
ist(extractNumber("WP001"), "1", "Garmin-Wegpunkt");
ist(extractNumber("Nr. 5 Ackerkante"), "5", "Peenwerder-Schema (Zahl vorn)");
ist(extractNumber("Hochsitz Nord 3"), "3", "Handgerät (Zahl hinten)");
ist(extractNumber("Kanzel 5"), "5", "mit Stichwort");
ist(extractNumber("DJB 63"), "63", "Drückjagdbock");
ist(extractNumber("Nr. 2a"), "2A", "Buchstabenzusatz");
ist(extractNumber("Buchenkanzel"), "", "keine Zahl → keine erfunden");
ist(extractType("DJB 7"), "Drückjagdbock", "Typ aus dem Namen");
ist(extractType("Leiter 3"), "Leiter", "Leiter");
ist(extractType("Nr. 5"), "Kanzel", "Standard");

console.log("\nNamen");
ist(normaliseStand({label:"Nr. 1 Ackerkante"}).name, "Nr. 1 Ackerkante", "vorhandenes Schema bleibt buchstabengleich");
ist(normaliseStand({label:"Hochsitz Nord 3"}).name, "Nr. 3 Hochsitz Nord", "Zahl nach vorn");
ist(normaliseStand({label:"WP001"}).name, "Nr. 1", "Geräte-Präfix fällt weg");
ist(normaliseStand({label:"DJB 7"}).name, "DJB 7", "DJB bleibt DJB");
ist(normaliseStand({label:"Buchenkanzel"}).name, "Buchenkanzel", "ohne Nummer unverändert");

console.log("\nEntfernung");
ist(distanceMetres({lat:53.6262,lng:12.8378},{lat:53.6262,lng:12.8378}), 0, "gleicher Punkt");
{
  const d = distanceMetres({lat:53.6262,lng:12.8378},{lat:53.6272,lng:12.8378});
  console.log(`  ✓ 0,001 Grad Breite entsprechen ${d} m (rechnerisch 111)`);
  if (Math.abs(d-111) > 3) { console.log("  ✗ zu ungenau"); fehler++; }
}

console.log("\nPrüfung");
{
  const vorhanden = [{ id:"HR-1", name:"Nr. 1", lat:53.6262, lng:12.8378 }];
  const rows = [
    { name:"Nr. 5", nr:"5", area:"Hauptrevier", lat:53.6300, lng:12.8400 },
    { name:"Nr. 1 neu", nr:"1", area:"Hauptrevier", lat:53.62622, lng:12.83782 },  // 3 m daneben
    { name:"", area:"Hauptrevier", lat:53.63, lng:12.84 },
    { name:"Nr. 9", nr:"9", area:"", lat:53.63, lng:12.84 },
    { name:"Tirol", nr:"7", area:"Hauptrevier", lat:47.3, lng:11.4 },
  ];
  const out = validateBatch(rows, vorhanden);
  out.forEach((r,i) => console.log(`  ${i+1}. ${r.status.padEnd(5)} take=${String(r.take).padEnd(5)} ${r.messages.map(m=>m.text).join("; ")}`));
  ist(out[0].status, "ok", "sauberer Punkt");
  ist(out[1].take, false, "Doppelgänger vorab abgewählt");
  ist(out[2].status, "error", "Name fehlt");
  ist(out[3].status, "error", "Teilgebiet fehlt");
  ist(out[4].messages.some(m=>m.text.includes("km")), true, "Ausreißer erkannt");
}

console.log("\nGruppierung");
{
  const rows = [
    {lat:53.630,lng:12.830},{lat:53.631,lng:12.831},{lat:53.6305,lng:12.8305},
    {lat:53.660,lng:12.880},{lat:53.661,lng:12.881},
  ];
  const g = suggestClusters(rows, 600);
  ist(g.length, 2, "zwei Gruppen erkannt");
  ist(g.map(x=>x.length), [3,2], "Größen");
}


console.log("\nStand oder Beobachtung");
const k = (label, sym) => classifyPoint({ label, sym }).kind;
ist(k("Leiter Buchenschneise Bodensee"), "stand", "Sitzwort vorn");
ist(k("Klettersitz Roteiche Suhle Weg"), "stand", "Sitzwort vorn schlaegt Gelaendewoerter");
ist(k("RoteichenKanzel SW"), "stand", "Sitzwort im zusammengesetzten Wort");
ist(k("DJ Bock 360"), "stand", "DJ Bock mit Leerzeichen");
ist(k("3214 / 1 (5) Kanzel Wiese NO"), "stand", "Nummer vorweg, dann Kanzel");
ist(k("Suhle Totholz"), "kein-stand", "Suhle");
ist(k("Brunftkuhle Krams"), "kein-stand", "Brunftkuhle");
ist(k("Zur Wildbergung befahrbar"), "kein-stand", "Wegnotiz");
ist(k("Parkplatz vor 110KV"), "kein-stand", "Parkplatz");
ist(k("Kanzel aufstellen"), "unsicher", "Vorhaben");
ist(k("Leiter aufstellen Tanne"), "unsicher", "Vorhaben");
ist(k("Eventuell LeiterObst"), "unsicher", "Vorhaben");
ist(k("Einblick Einstand Leiter?"), "unsicher", "Fragezeichen");
ist(k("Hauptwechsel 100m weiter Leiter"), "unsicher", "Sitzwort hinten neben Gelaendewort");

console.log("\nSymbol aus der Datei lernen");
{
  const pts = [
    { label: "Kanzel Wiese", sym: "flagge-gruen" },
    { label: "Leiter Buchenschneise", sym: "flagge-gruen" },
    { label: "DJBock am Hang", sym: "flagge-gruen" },
    { label: "Hauptwechsel 50m weiter Leiter", sym: "flagge-gruen" },
    { label: "Alte Buche", sym: "flagge-gruen" },
    { label: "Kanzel aufstellen", sym: "flagge-gruen" },
    { label: "Suhle am Bruch", sym: "punkt-rot" },
    { label: "Brunftkuhle", sym: "punkt-rot" },
    { label: "Wechsel Eiche", sym: "punkt-rot" },
  ].map(p => ({ ...p, lat: 53.37, lng: 12.98 }));
  const r = prepareBatch(pts);
  ist(r[3].kind, "stand", "unsicher + sitztypisches Symbol wird Stand");
  ist(r[4].kind, "unsicher", "ohne Sitzwort nur bis unsicher, nicht bis Stand");
  ist(r[5].kind, "unsicher", "Vorhaben bleibt Vorhaben, egal welche Farbe");
  ist(r[6].kind, "kein-stand", "andere Farbe unberuehrt");
  // Gegenprobe: zu wenig Belege, dann darf nichts hochgestuft werden
  const schwach = [
    { label: "Kanzel Wiese", sym: "x" },
    { label: "Suhle", sym: "x" },
    { label: "Wechsel", sym: "x" },
    { label: "Hauptwechsel 50m weiter Leiter", sym: "x" },
  ].map(p => ({ ...p, lat: 53.37, lng: 12.98 }));
  ist(prepareBatch(schwach)[3].kind, "unsicher", "schwache Belege stufen nicht hoch");
}

console.log(fehler ? `\n${fehler} FEHLER` : "\nAlle Prüfungen bestanden.");
process.exit(fehler ? 1 : 0);
