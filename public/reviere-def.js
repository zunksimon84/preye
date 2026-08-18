// Welche Teilgebiete zu welchem Revier gehören.
//
// Das Backend kennt nur Teilgebiete ("Hauptrevier", "Schwarzenhof", …) — an
// jedem Stand und an jeder Drückjagd hängt eines davon. Dass vier davon
// Peenwerder sind und vier der Müritz-Nationalpark, weiß nur die Oberfläche.
// Bis hierher stand diese Zuordnung in reviere.js und noch einmal als
// Checkbox-Spalten im Formular in events.html. Kommt ein drittes Revier dazu,
// ist das hier die erste Stelle, die es braucht.

window.PREYE_REVIERE = [
  { key: "peenwerder", name: "Peenwerder",
    areas: ["Hauptrevier", "Ost", "Nord", "Nordrand"] },
  { key: "mueritz", name: "Müritz Nationalpark",
    areas: ["Babke", "Langenhagen", "Schwarzenhof", "Serrahn"] },
];

// Eine Jagd kann revierübergreifend sein ("Nord, Nordrand"), das Feld ist
// deshalb eine Liste. Sie zählt zu einem Revier, sobald eines ihrer
// Teilgebiete dort liegt.
window.preyeEventInRevier = function (event, key) {
  const revier = window.PREYE_REVIERE.find((r) => r.key === key);
  if (!revier) return false;
  const parts = String((event && event.teilgebiet) || "")
    .split(/\s*,\s*/).filter(Boolean);
  return parts.some((p) => revier.areas.includes(p));
};
