# Offen — Stand 19.08.2026, abends

## Muss bereitgestellt werden

`apps-script/Code.gs` → Apps Script → Bereitstellen → Bereitstellungen
verwalten → ✏ → Version **Neue Version** → Bereitstellen.

Zwei Sachen hängen daran:

1. **Infomail-Vorschau je Gruppe** (`6fad91f`). Ohne Bereitstellung zeigen
   alle Vorschau-Knöpfe dasselbe Blatt, und das Fenster sagt es auch — der
   Hinweis „Das Backend ist noch die alte Fassung" ist genau dieser Fall.
2. Die Naht hinter einem Platzhalter im Einladungstext (`545d952`). Reine
   Kosmetik im Vorlagen-Editor, kann warten.

## Fertig und live (nur Pages, ohne Bereitstellung)

- **Bedienfarbe Grau→Blau**. Verlauf `#cdd7e1 → #4f99dc` auf Knöpfen,
  Kacheln, Hero, Toast; `#84b5e3` flach auf Tabellenköpfen. Der Rand der
  gefüllten Flächen ist eine getönte Haarlinie plus Schatten
  (`--ctl-hairline` / `--ctl-lift`) statt einer vollen Randfarbe. Token
  heißen `--ctl-*`, nicht mehr `--green-*`.
- Vorschau-Knöpfe je Runde und Treibergruppe im Infomail-Fenster
  (Oberfläche steht, wirkt erst nach der Bereitstellung).

## Simon wollte noch prüfen

1. **Nach der Bereitstellung**: Infomail-Fenster öffnen, bei jeder Runde auf
   „Vorschau" — Karte, Roster und Betreff müssen je Gruppe andere sein.
2. **Einladung erstellen** — Absätze im Textfeld. Einmal im Vorlagen-Editor
   speichern ersetzt die umbruchlose Vorlage in den ScriptProperties dauerhaft.
3. Die neue Bedienfarbe im Betrieb ansehen. Der Browser hält .css bis zu
   10 Minuten — frische Sitzung, nicht die laufende neu laden.

## Noch grün, bewusst nicht angefasst

- `.infomail-opt` („Schützen einbeziehen") — fest eingetragenes `#16a34a`
  mit eigenem Aus-Zustand. **Bleibt so, ausdrücklich entschieden am
  19.08.2026.** Ein/Aus-Anzeige, keine Bedienfarbe.
- `--green-dark` / `--green-mid`: dunkle Waldtöne für Schrift und die
  Standkarten-Leiste.
- Zusagen/Absagen, Fehler-Toasts, Löschknöpfe, die Punkte im
  Anschussprotokoll: Bedeutung, nicht Gestaltung.
