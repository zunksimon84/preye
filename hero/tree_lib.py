"""
Bäume für den Hero-Loop v2.

Die Vorlage zeichnet Fichten nicht als Dreieck, sondern als Stapel hängender
Astetagen — das ist der Unterschied zwischen "Zacke" und "Nadelbaum". Dazu
Laubbäume mit unregelmäßiger Krone, damit ein Mischwald entsteht.

Alle Formen sind Polygone in einer Farbe: jede Waldschicht ist eine flache
Silhouette, die Tiefe kommt aus dem Wertabstand zwischen den Schichten.

Jeder Zufallswert hängt an einem Index *innerhalb der Periode*, damit der Loop
schließt. Nichts hier greift auf absolute Weltkoordinaten zu.
"""
import math


def h11(n, salt=0.0):
    """Deterministischer Hash 0..1. Gleiches n gibt in jedem Bild den gleichen Baum."""
    v = math.sin(n * 12.9898 + salt * 78.233) * 43758.5453123
    return v - math.floor(v)


def spruce(draw, x, ground, h, w, colour, tiers=None):
    """
    Fichte in zwei Darstellungen, je nach Größe — weil die Darstellung der
    Auflösung folgen muss und nicht umgekehrt.

    Klein (ferne Schichten): ein geschlossener Kegel mit gezackter Kante. Bei
    20 px liest sich das sauber als Nadelbaum, und getrennte Äste würden zu
    Grieß zerfallen.

    Groß (nahe Schichten): ein schlanker Kern mit einzelnen hängenden Astetagen
    und Lücken dazwischen, wie in der Vorlage. Durch die Lücken sieht man die
    Schicht dahinter, und genau das gibt dem Wald Luft.
    """
    if tiers is None:
        tiers = 4 if h < 34 else (6 if h < 90 else 9)

    t = max(0.6, w * 0.028)
    draw.polygon([(x - t, ground), (x + t, ground),
                  (x + t * 0.7, ground - h * 0.24), (x - t * 0.7, ground - h * 0.24)],
                 fill=colour)

    top = ground - h
    body = h * 0.94

    if h < 70:
        half = []
        for i in range(tiers + 1):
            u = i / tiers
            half.append((top + body * (0.05 + 0.95 * u), w * 0.5 * (u ** 0.66)))
        right = [(x, top)]
        for i, (y, hw) in enumerate(half):
            if i == 0:
                continue
            pull = 0.74 + 0.10 * h11(i, 5.1)
            right.append((x + hw, y))
            right.append((x + hw * pull, y + body * (0.42 / tiers)))
        pts = right + [(x + half[-1][1] * 0.80, ground)] \
                    + [(x - half[-1][1] * 0.80, ground)] \
                    + [(-px + 2 * x, py) for px, py in reversed(right[1:])]
        draw.polygon(pts, fill=colour)
        return

    # Großer Baum: Kern plus getrennte Etagen.
    core = w * 0.045
    draw.polygon([(x - core, ground - h * 0.10), (x + core, ground - h * 0.10),
                  (x + core * 0.35, top + body * 0.06), (x - core * 0.35, top + body * 0.06)],
                 fill=colour)
    step = body / tiers
    for i in range(tiers):
        u = (i + 1) / tiers                       # 0 oben, 1 unten
        cy = top + body * (0.10 + 0.88 * u)
        hw = w * 0.5 * (u ** 0.72)
        droop = step * (0.85 + 0.35 * h11(i, 9.4))
        for side in (1, -1):
            wob = 0.88 + 0.22 * h11(i, 2.6 + (0 if side > 0 else 4.2))
            draw.polygon([
                (x, cy - step * 0.42),
                (x + side * hw * 0.45 * wob, cy - step * 0.10),
                (x + side * hw * wob, cy + droop * 0.62),
                (x + side * hw * 0.72 * wob, cy + droop * 0.58),
                (x + side * hw * 0.34 * wob, cy + droop * 0.28),
                (x, cy + step * 0.34),
            ], fill=colour)
    # Spitze: schlankes Dreieck, das bis in die erste Astetage reicht. Zu kurz
    # gezeichnet klafft dort eine Lücke und die Spitze sieht aufgesteckt aus.
    draw.polygon([(x, top),
                  (x + w * 0.115, top + body * 0.24),
                  (x - w * 0.115, top + body * 0.24)], fill=colour)


def oak(draw, x, ground, h, w, colour, seed=0.0):
    """Eiche: kurzer kräftiger Stamm, breite knorrige Krone aus Kreisen."""
    t = max(1.0, w * 0.045)
    draw.polygon([(x - t, ground), (x + t, ground),
                  (x + t * 0.6, ground - h * 0.40), (x - t * 0.6, ground - h * 0.40)],
                 fill=colour)
    cy = ground - h * 0.70
    lobes = [(0.0, 0.0, 0.52), (-0.34, 0.10, 0.36), (0.34, 0.08, 0.38),
             (-0.17, -0.20, 0.34), (0.19, -0.22, 0.32)]
    for k, (dx, dy, r) in enumerate(lobes):
        j = (h11(k, seed) - 0.5) * 0.10
        rx = w * r * (0.92 + j)
        ry = h * r * 0.46 * (0.92 + j)
        cx = x + w * dx
        yy = cy + h * dy
        draw.ellipse([cx - rx, yy - ry, cx + rx, yy + ry], fill=colour)


def beech(draw, x, ground, h, w, colour, seed=0.0):
    """Buche: hoher schlanker Stamm, eiförmige Krone, höher als breit."""
    t = max(1.0, w * 0.042)
    draw.polygon([(x - t, ground), (x + t, ground),
                  (x + t * 0.6, ground - h * 0.55), (x - t * 0.6, ground - h * 0.55)],
                 fill=colour)
    cy = ground - h * 0.72
    rx = w * 0.40
    ry = h * 0.30
    draw.ellipse([x - rx, cy - ry, x + rx, cy + ry], fill=colour)
    for k, (dx, dy, r) in enumerate([(-0.26, 0.16, 0.28), (0.27, 0.14, 0.26), (0.0, -0.20, 0.26)]):
        j = (h11(k, seed + 3.3) - 0.5) * 0.12
        draw.ellipse([x + w * dx - w * r * (1 + j), cy + h * dy - h * r * 0.52,
                      x + w * dx + w * r * (1 + j), cy + h * dy + h * r * 0.52], fill=colour)


def canopy_band(draw, ground_at, x_from, x_to, offset, period, n_per_period,
                base_h, colour, salt=0.0, mix=(0.62, 0.20, 0.18), tiers=None):
    """
    Ein Waldband entlang einer Bodenlinie.

    `mix` ist der Anteil (Fichte, Eiche, Buche) — ein Mischwald, wie im Prompt.
    `ground_at(world_x)` gibt die Bodenhöhe, damit das Band dem Gelände folgt.
    Gezeichnet wird von hinten nach vorn über den Index, damit sich die Kronen
    immer gleich überlappen.
    """
    gap = period / n_per_period
    k0 = int(math.floor((offset + x_from) / gap)) - 2
    k1 = int(math.ceil((offset + x_to) / gap)) + 2

    for k in range(k0, k1):
        n = k % n_per_period                     # Identität innerhalb der Periode
        xw = k * gap + (h11(n, salt) - 0.5) * gap * 0.9
        sx = xw - offset
        if sx < x_from - gap * 3 or sx > x_to + gap * 3:
            continue

        r_h, r_w, r_t = h11(n, salt + 3.1), h11(n, salt + 7.7), h11(n, salt + 11.3)
        # Gruppen statt gleichmäßigem Rauschen: eine langsame Welle über den Index.
        grove = 0.5 + 0.5 * math.sin(2 * math.pi * n / n_per_period * 9 + salt)
        h = base_h * (0.58 + 0.62 * r_h + 0.48 * grove)
        g = ground_at(xw)

        if r_t < mix[0]:
            spruce(draw, sx, g, h, base_h * (0.34 + 0.24 * r_w), colour, tiers=tiers)
        elif r_t < mix[0] + mix[1]:
            oak(draw, sx, g, h * 0.74, base_h * (0.58 + 0.30 * r_w), colour, seed=n)
        else:
            beech(draw, sx, g, h * 0.86, base_h * (0.44 + 0.22 * r_w), colour, seed=n)
