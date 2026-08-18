# Hero-Loop v2 — Workflow

Vorlage: zwei KI-Clips (Downloads). Übernommen wird die Animation, nicht die
Grafik: Profil-Adler mit echtem Schlagzyklus, geschichteter Wald, Nebelbänder
zwischen den Ebenen, Hirsch klein zwischen den Stämmen. Farben und Stil bleiben
unsere.

Kein Blender. Der Stil ist flaches 2D-Vektor — dafür ist Blender das falsche
Werkzeug (die RIZM-Clips nutzen es für isometrisches 3D, ein anderer Fall).
Python/PIL rendert das direkt, deterministisch, und der Loop schließt
rechnerisch statt durch Überblenden.

## Schritte

1  tree_lib.py       Fichte mit Astetagen, Eiche, Buche + Kronenband
2  eagle_profile.py   Adler im Profil, Schlagzyklus, Kopf zum Wild
3  scene2.py          flaches Gelände, Waldschichten, Nebel, Hirsch, Adler
4  je Baustein eine Vorschau, erst dann der volle Lauf
5  350 Bilder in doppelter Auflösung → verkleinern
6  encode.sh → MP4/WebM/Poster, nach public/

## Was der Loop halten muss

Bild 0 und Bild 350 pixelgleich. Jede Ebene bewegt sich um genau eine
Periode, jede Variation hängt an der Position *innerhalb* der Periode, nie an
der absoluten Weltkoordinate. Nebel und Schlagzyklus ebenso.

## Farben (unsere, nicht die des Prompts)

Tief   #045d75  Pool Blue dunkel — Hintergrund, fernste Schicht
Mitte  #0b7c95 / #0f9a78 — Schichten dazwischen
Nah    #06202b — vorderste Schicht, fast schwarz
Akzent #b5d33a Lime — nur Lichtsaum und der Blick
