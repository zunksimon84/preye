# Offen — Stand 19.08.2026

Notiz für den Wiedereinstieg nach dem Neustart. Alles committet und gepusht
(`545d952`), Arbeitsverzeichnis sauber.

## Muss noch bereitgestellt werden

`apps-script/Code.gs` → Apps Script → Bereitstellen → Bereitstellungen
verwalten → ✏ → Version **Neue Version** → Bereitstellen.

Drin ist nur noch `545d952`: die Naht hinter einem Platzhalter im
Einladungstext (`einladen.{teilgebiete_satz}Ich bitte` blieb zusammen).
**Reine Kosmetik im Vorlagen-Editor** — beim Versand fällt es nicht auf, weil
die Platzhalter vorher ersetzt werden. Kann also warten.

## Simon wollte noch prüfen

1. **Infomail-Fenster** öffnen — oben muss "Wer bekommt eine?" stehen, eine
   Zeile je Ansteller-Runde *und* je Treibergruppe, alle angehakt, daneben
   "zuletzt … (N×)".
2. **Einladung erstellen** — Absätze im Textfeld. Einmal im Vorlagen-Editor
   speichern ersetzt die umbruchlose Vorlage in den ScriptProperties dauerhaft.
3. Das neue Grün (`#7fdc87`) im Betrieb ansehen. Ist seit heute live.

## Schon fertig und live (Pages, ohne Bereitstellung)

- Knopf-Grün 26° kühler, löst sich vom Markenverlauf
- Spalte "Wo" in der Beobachtungsliste, nur für Treiber und Blanko-Karte
- "Control Room" heißt "Operation Center"

## Fertig und bereits bereitgestellt

- Infomail-Verteilung: Auswahl je Gruppe, Nachweis in `infomail_sent_at` /
  `infomail_count`, Treibergruppen bekommen überhaupt erstmals eine
- Treiber-PDF ohne Karte, mit Freigaben und QR
- Absätze im Einladungstext

## Was ich noch nicht überprüfen konnte

Die POST-Endpunkte (`event-infomails-preview`, `event-infomails-send`)
brauchen das Passwort der Zugangssperre, das ich nicht habe. Deshalb sind
Punkt 1 und 2 oben Simons Prüfung und nicht meine.
