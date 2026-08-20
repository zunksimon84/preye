# Offen — Stand 20.08.2026

## Muss bereitgestellt werden

Nichts. Der Umbau der Jagd-Detailseite kommt ohne Änderung an
`apps-script/Code.gs` aus.

## Fertig und live

**Jagd-Detailseite in drei Blöcken** — neun Schritte, ein Commit je Schritt
(`aa27162` bis `a17bc27`).

1. `wireUi()` abgesichert: 57 rohe `addEventListener` gegen `on()` getauscht,
   in neun Gruppen mit je eigenem `try`. Eine fehlende ID kostet jetzt eine
   Warnung statt der halben Seite.
2. Breite: `#view-detail` auf 1600 px, Liste und Neue-Jagd-Formular bleiben
   bei 720.
3. Drei Blöcke mit Bandkopf: **Die Jagd · Jägerinnen einladen · Der Jagdtag**.
4. Block 1 dreispaltig über `display: contents` — ohne `events.js` anzufassen.
5. Jagdtag: Revierkarte klebt links, Runden und Freigaben rechts.
6. **Jägerregister**: Tabelle statt Kartenliste, mit Reitern
   (Alle / Zugesagt / Offen / Abgesagt), Suche und Sortierung.
7. Rolle nachträglich änderbar — nur bei **gesetzten** Jägern. Bei einer
   Zusage über den Link verweigert das Backend, zu Recht.
8. Alle sieben Fenster auf sinnvolle Breiten begrenzt, das Runden-Fenster
   zweispaltig.
9. Runden-Kacheln zeigen den **Stand je Schütze**, dazu „N ohne Stand" und
   ein Hinweis bei Doppelbelegung.
10. **Hunterbase** steht dauerhaft links, das Vollbild-Fenster ist weg.
    Ein Klick lädt ein oder entfernt, sofort.

## Simon wollte prüfen

1. Die Seite bei sich am Rechner ansehen — vor allem mit einer **echten Jagd
   mit vielen Jägern**. Geprüft wurde mit 60 Jägern und 200 Kontakten, aber
   nur im Browserspeicher.
2. **Rolle ändern** an einem echten gesetzten Jäger. Der Schreibvorgang selbst
   ist ungeprüft — dafür hätte ich der Test Jagd Daten unterschieben müssen.
3. Der Browser hält die alte `style.css` bis zu 10 Minuten. Frische Sitzung
   nehmen, nicht neu laden.

## Bewusst nicht gemacht

- **Kontakte in der Hunterbase bearbeiten oder löschen.** Es gibt nur
  `?action=address-book` zum Lesen; die Stammliste wächst implizit bei jedem
  `eventHunterAdd_`. Pflege wäre eine eigene Aufgabe **mit** Backend-Änderung.
- **Mehrere Kontakte auf einmal übernehmen.** Der Plan sah dafür einen
  Sammelknopf vor; für „40 Leute auf einmal" ist der CSV-Import der bessere
  Weg und war schon da. Wenn es fehlt, ist es nachrüstbar.
- **`renderEventDetail` zerlegen.** Für das Layout nicht nötig, Schritt 4 kam
  mit `display: contents` aus. Sauberer wäre es trotzdem.
- **Doppelbelegung verhindern.** Sie wird angezeigt, nicht unterbunden — es
  kann Gründe geben, und ein Werkzeug, das die Planung blockiert, wird
  umgangen.

## Noch grün, ausdrücklich entschieden

- `.infomail-opt` („Schützen einbeziehen") — fest eingetragenes `#16a34a` mit
  eigenem Aus-Zustand. **Bleibt so, entschieden am 19.08.2026.**
- `--green-dark` / `--green-mid`: dunkle Waldtöne für Schrift und die
  Standkarten-Leiste.
- Zusagen/Absagen, Fehler-Toasts, Löschknöpfe, die Punkte im
  Anschussprotokoll: Bedeutung, nicht Gestaltung.
