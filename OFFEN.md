# Offen — Stand 20.08.2026

## Muss bereitgestellt werden — jetzt wirklich

`apps-script/Code.gs` → Apps Script → Bereitstellen → Bereitstellungen
verwalten → ✏ → Version **Neue Version** → Bereitstellen.

Drin ist die pflegbare Hunterbase (`eb630e3`):

- `address_book` bekommt `id`, `phone`, `note`, `default_role`, `dogs`,
  `updated_at`. Die drei vorhandenen Spalten werden nicht angefasst, die
  neuen hängt `ensureSheet_` hinten an.
- Drei neue Actions: `address-book-save`, `-delete`, `-batch-add`.
- Zusagen mit Hund schreiben Rasse und Rolle in den Stammeintrag zurück.
- Jede Position einer Ansteller-Runde trägt `dog` und `dog_label`.
- Das Infomail-PDF bekommt eine Hunde-Spalte, wenn in der Gruppe einer
  mitkommt.

**Bis dahin** sagt das Hunterbase-Fenster selbst, dass Anlegen, Ändern,
Löschen und CSV nicht gehen; Ansehen und Suchen geht schon. Alles andere auf
der Seite ist unberührt.

## Fertig und live

- **Jagd-Detailseite in drei Blöcken** (`aa27162` … `a17bc27`) — Breite bis
  1600, Jägerregister als Tabelle mit Reitern, Karte klebend, Runden mit
  Stand je Schütze, Fenster begrenzt.
- **Kontakte-Kasten**: eine Zeile je Kontakt, alle Nummern an derselben
  Stelle, Block 1 zweispaltig.
- **„Zur Jagd einladen"**: zehn Namen sichtbar, dann scrollen; Ziehen und
  Ablegen in zwei Zonen (Einladen / Hat schon zugesagt).

## Simon wollte prüfen

1. **Nach der Bereitstellung**: Hunterbase-Fenster über den Titel öffnen —
   Kontakt anlegen, ändern, löschen, CSV hochladen. Die Spalte „Jagden" muss
   echte Zahlen zeigen statt Striche.
2. **Hund**: jemanden über den Anmeldelink mit Hund zusagen lassen, dann in
   einer Runde prüfen, ob das Häkchen vorbelegt ist.
3. **Rolle ändern** an einem echten gesetzten Jäger.
4. Frische Browsersitzung, die alte `.css` hängt bis zu 10 Minuten.

## Als Nächstes

- **Farbkonzept** aus Simons Google Doc umsetzen: alles Anklickbare in einer
  einheitlichen Farbe (der Grau-Blau-Verlauf), Überschriften in einem anderen
  Ton, damit der Unterschied zwischen Bedienelement und Grafik klar ist.
  https://docs.google.com/document/d/1_R1BqfrMoJjL7C9gDi8oauBQJNM1B8FFdr0P-mI4hNY

## Bewusst nicht gemacht

- **Mehrere Kontakte auf einmal in eine Jagd übernehmen.** Für „40 Leute auf
  einmal" ist der CSV-Import in die Hunterbase der Weg, danach zieht man sie
  hinüber.
- **Kontakte zusammenführen.** Wer doppelt drinsteht: einen pflegen, den
  anderen löschen. Die Jagden hängen nicht an der Stammliste.
- **`renderEventDetail` zerlegen.** Für das Layout nicht nötig.
- **Doppelbelegung verhindern.** Sie wird angezeigt, nicht unterbunden.

## Noch grün, ausdrücklich entschieden

- `.infomail-opt` („Schützen einbeziehen") — bleibt so, entschieden am
  19.08.2026.
- `--green-dark` / `--green-mid`: dunkle Waldtöne für Schrift und die
  Standkarten-Leiste.
- Zusagen/Absagen, Fehler-Toasts, Löschknöpfe, die Punkte im
  Anschussprotokoll: Bedeutung, nicht Gestaltung.
