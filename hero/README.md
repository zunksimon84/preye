# Hero-Loop (Archiv)

**Nicht mehr im Einsatz.** Der Hero auf der Übersicht ist seit August 2026 ein
stehendes Bild (`public/hero.jpg`) mit einer Ken-Burns-Fahrt und einer
driftenden Dunstschicht, beides in CSS — siehe `.band` in
`public/dashboard.css`. Das spart die Videodateien ganz und bleibt auf jedem
Schirm scharf.

Die Skripte hier erzeugen den gerenderten Loop, der vorher dort lief. Sie
bleiben liegen, weil die Loop-Mathematik unten wiederverwendbar ist, falls
wieder ein bewegter Hintergrund gebraucht wird.

Quelle des Videos in `public/hero.mp4` / `.webm` / `.jpg`.

    python3 scene2.py --frames 350 --width 1920 --height 1080 --ss 2 --out frames
    ./encode.sh frames out 25
    cp out/hero.* ../public/

Einzelbild zum Prüfen: `--only 217` (der Moment des Blicks).

## Warum Python und nicht Blender

Der Stil ist flaches 2D-Vektor. Blender ist dafür das falsche Werkzeug — es
steckt in diesem Haus im isometrischen 3D der RIZM-Clips, ein anderer Fall.
PIL zeichnet Polygone direkt, in doppelter Auflösung und dann verkleinert, was
die Kanten glättet, ohne mit Antialiasing zu ringen.

## Die Loop-Regel

Bild 0 und Bild 350 müssen pixelgleich sein. Das hält nur, wenn **jede**
Bewegung eine Funktion der Phase `t` in [0,1) ist:

* Jede Waldschicht wandert um genau eine Periode.
* Jede Streuung (Baumhöhe, Position, Art) hängt am Index *innerhalb* der
  Periode, nie an der absoluten Weltkoordinate. Das war schon zweimal die
  Ursache einer sichtbaren Naht.
* Nebelbänder und Flügelschlag sind Sinusfunktionen von `t` bzw. Fenster auf
  festen Phasen mit ganzzahliger Schlagzahl.
* Ein linearer Drift um einen Bruchteil einer Periode kehrt nie zurück — dafür
  eine Sinusschwingung nehmen.

Vor jedem Render prüfen:

    python3 -c "import scene2 as S, numpy as np; \
      print(np.abs(np.asarray(S.render_frame(0.,400,225,1),int) - \
                   np.asarray(S.render_frame(1.,400,225,1),int)).max())"

Muss 0 ergeben.

## Vorlage

Zwei KI-Clips von Simon (August 2026). Übernommen wurde die Anmutung —
geschichteter Nebelwald, Tiere in Bewegung —, nicht die Grafik und nicht die
Farben. Der Profil-Adler der Vorlage ließ sich als flache Silhouette nicht
überzeugend bauen (kippte in eine Fischform); der Blick von unten mit
gespreizten Handschwingen liest sich bei jeder Größe eindeutig.
