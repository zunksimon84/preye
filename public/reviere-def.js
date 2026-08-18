// Welche Teilgebiete zu welchem Revier gehören.
//
// Das Backend kennt nur Teilgebiete ("Hauptrevier", "Schwarzenhof", …) — an
// jedem Stand und an jeder Drückjagd hängt eines davon. Dass vier davon
// Peenwerder sind und vier der Müritz-Nationalpark, weiß nur die Oberfläche.
// Bis hierher stand diese Zuordnung in reviere.js und noch einmal als
// Checkbox-Spalten im Formular in events.html. Kommt ein drittes Revier dazu,
// ist das hier die erste Stelle, die es braucht.

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
