#!/usr/bin/env python3
"""
Hero-Loop v2 — "Nebelwald".

Nach den beiden Vorlagen: geschichteter Mischwald auf flachem Gelände, dichter
Nebel zwischen den Stammschichten, ein Adler über den Kronen, ein Hirsch klein
zwischen den Bäumen. Farben sind unsere, nicht die der Vorlage.

Der Unterschied zum ersten Loop ist der Nebel. Dort trennten Höhenzüge die
Ebenen; hier ist das Gelände flach und die Tiefe entsteht durch Nebelbänder,
die vor jeder Schicht liegen und ihren Fuß verschlucken. Das ist das
Stimmungsmittel der Vorlage.

Der Loop schließt rechnerisch: jede Schicht wandert um genau eine Periode,
jede Streuung hängt am Index innerhalb der Periode, Nebel und Flügelschlag
sind Funktionen der Phase. Nichts hängt an absoluten Weltkoordinaten.

    python3 scene2.py --frames 350 --width 1920 --out ../frames2
"""
import argparse
import math
import os
from PIL import Image, ImageDraw, ImageFilter

from tree_lib import canopy_band, spruce
from eagle_lib import eagle_polys

# --- Unsere Rampe ----------------------------------------------------------
POOL_DEEP = (4, 93, 117)
POOL = (11, 124, 149)
SEA = (15, 154, 120)
GREEN = (47, 163, 95)
LIME = (181, 211, 58)
LIME_BRIGHT = (198, 224, 60)

# Himmel: oben tief, damit weiße Schrift darauf sitzt; zum Horizont wärmer.
# Komponiert für das Band, nicht für 16:9. Das Band auf der Übersicht ist
# 4,2:1 — bei einem 16:9-Bild schnitt "cover" alles außer y 0,40..0,60 weg,
# also Adler, Hirsch und Vordergrund. Waagerecht beschneiden ist dagegen
# gratis, weil die Szene periodisch durchläuft.
SKY = [
    (0.00, (3, 40, 56)),
    (0.14, (4, 66, 88)),
    (0.26, (9, 100, 122)),
    (0.36, (22, 134, 140)),
    (0.46, (56, 162, 148)),
    (0.60, (108, 188, 152)),
    (1.00, (158, 206, 130)),
]

# Waldschichten von hinten nach vorn. `base` ist die Bodenlinie, `speed` das
# Tempo (nah = schnell), `trees` die Zahl der Bäume je Periode, `size` ihre
# Höhe als Anteil der Bildhöhe. Fast flaches Gelände, wie im Prompt.
# Ein dunkler Waldton; die Farbe jeder Schicht entsteht daraus, indem sie zum
# Himmel an ihrer Höhe hin aufgehellt wird. Das ist Luftperspektive und stimmt
# von sich aus — von Hand gesetzte Werte ließen die fernen Schichten
# nach vorn drängen, weil sie zu grün und zu hell waren.
FOREST = (7, 54, 50)

LAYERS = [
    # base, speed, trees, size,  wave,  haze
    (0.365, 0.10, 210, 0.105, 0.010, 0.80),
    (0.455, 0.17, 150, 0.140, 0.013, 0.64),
    (0.552, 0.27, 104, 0.185, 0.015, 0.48),
    (0.660, 0.42, 68, 0.245, 0.017, 0.32),
    (0.780, 0.62, 42, 0.330, 0.018, 0.16),
    (0.910, 0.88, 26, 0.430, 0.020, 0.00),
    (1.055, 1.30, 10, 0.900, 0.016, -0.34),  # Vordergrund, schneidet den Rand
]

EAGLE_INK = (4, 26, 36)
STAG_INK = (3, 20, 27)

SPOT_AT = 0.62        # wann der Blick fällt
STAG_LAYER = 4        # in welcher Schicht der Hirsch steht
STAG_AT_SPOT = 0.63   # wo im Bild er dann steht


def lerp(a, b, u):
    return a + (b - a) * u


def mix(c1, c2, u):
    return tuple(int(round(lerp(c1[i], c2[i], u))) for i in range(3))


def sky_colour(v):
    for i in range(len(SKY) - 1):
        p0, c0 = SKY[i]
        p1, c1 = SKY[i + 1]
        if p0 <= v <= p1:
            return mix(c0, c1, (v - p0) / (p1 - p0) if p1 > p0 else 0.0)
    return SKY[-1][1]


def make_sky(w, h):
    col = Image.new("RGB", (1, h))
    px = col.load()
    for y in range(h):
        px[0, y] = sky_colour(y / (h - 1))
    return col.resize((w, h), Image.BILINEAR)


def ground_wave(x_world, period, amp, seed):
    """Fast flaches Gelände — nur genug Welle, dass die Bodenlinie lebt."""
    u = (x_world / period) * 2 * math.pi
    return (math.sin(u + seed * 1.7) + 0.45 * math.sin(u * 2 + seed * 3.1)) * amp / 1.45


def fog_band(img, w, h, y_at, thickness, strength, tint):
    """
    Ein Nebelband vor einer Waldschicht: oben weich einsetzend, nach unten
    dichter, damit die Stämme darin verschwinden statt abgeschnitten zu werden.
    """
    top = int(y_at - thickness * 0.45)
    bot = int(y_at + thickness * 0.85)
    if bot <= top:
        return
    band = Image.new("RGBA", (w, bot - top), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    n = bot - top
    for i in range(n):
        v = i / max(1, n - 1)
        # Weich rein, dichter raus — eine Glocke, hinten schwerer.
        a = int(255 * strength * (math.sin(math.pi * min(1.0, v * 0.92)) ** 1.25) * (0.45 + 0.55 * v))
        bd.line([(0, i), (w, i)], fill=tint + (a,))
    img.alpha_composite(band, (0, top))


def drifting_fog(img, w, h, t):
    """
    Nebelschwaden, die quer durchziehen. Eigene Periode je Band, damit sie sich
    nicht im Gleichschritt bewegen — und alle geschlossen über eine Runde.
    """
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(layer)
    bands = [
        (0.425, 0.075, 30, 2.6, 5),
        (0.560, 0.090, 40, 1.9, 4),
        (0.690, 0.085, 44, 1.4, 4),
        (0.830, 0.070, 38, 1.1, 3),
    ]
    for bi, (by, bs, ba, pf, count) in enumerate(bands):
        period = w * pf
        off = (t * period) % period
        for k in range(count):
            cx = (period * (k / count) + bi * 211.0 - off) % period
            if cx > w + w * 0.35:
                continue
            cy = by * h + math.sin(2 * math.pi * (k / count) + bi) * h * 0.006
            cw = w * bs * (0.8 + 0.5 * ((k * 7 + bi * 3) % 5) / 5.0)
            ch = h * bs * 0.13
            for j in range(4):
                u = j / 3.0
                ex, ey = cw * (1 - u * 0.42), ch * (1 + u * 0.55)
                cd.ellipse([cx - ex, cy - ey, cx + ex, cy + ey],
                           fill=(214, 236, 228, int(ba * (0.4 + 0.6 * u))))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(h * 0.013)))


def stag_shape(x, y, hgt):
    """Rothirsch im Profil, nach links. Aus dem ersten Loop übernommen."""
    u = hgt / 100.0

    def P(px, py):
        return (x + px * u, y + py * u)

    def band(p0, p1, w0, w1):
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dy) or 1.0
        px, py = -dy / ln, dx / ln
        return [(p0[0] + px * w0 / 2, p0[1] + py * w0 / 2),
                (p1[0] + px * w1 / 2, p1[1] + py * w1 / 2),
                (p1[0] - px * w1 / 2, p1[1] - py * w1 / 2),
                (p0[0] - px * w0 / 2, p0[1] - py * w0 / 2)]

    def poly(pts):
        return [P(*p) for p in pts]

    def L(pts, w):
        return ([P(*p) for p in pts], w * u)

    body = poly([(-33, -48), (-31, -58), (-22, -62), (-4, -62), (14, -60),
                 (28, -56), (35, -50), (36, -42), (31, -35), (10, -33),
                 (-10, -34), (-27, -38)])
    tail = poly([(35, -52), (40, -49), (38, -41), (34, -46)])
    neck = poly(band((-27, -55), (-47, -78), 17, 10))
    head = poly(band((-46, -78), (-61, -75), 11, 5))
    ear = poly([(-47, -83), (-51, -91), (-43, -85)])

    def antler(back):
        o, t, w = (5.0, 0.88, 3.2) if back else (0.0, 1.0, 4.0)

        def A(px, py):
            return (px + o, -80 + (py + 80) * t)

        return [L([A(-48, -81), A(-48, -89), A(-44, -97), A(-37, -103)], w),
                L([A(-40, -100), A(-33, -104)], w * 0.72),
                L([A(-42, -99), A(-36, -107)], w * 0.72),
                L([A(-46, -94), A(-37, -97), A(-32, -99)], w * 0.78),
                L([A(-48, -88), A(-39, -90), A(-33, -91)], w * 0.78),
                L([A(-48, -82), A(-54, -83), A(-59, -85)], w * 0.75)]

    legs = [L([(-19, -38), (-16, 0)], 2.0), L([(-26, -40), (-27, 0)], 2.5),
            L([(26, -38), (30, -19), (27, 0)], 2.1), L([(32, -40), (36, -19), (33, 0)], 2.6)]

    return {"polys": [body, tail, neck, head, ear],
            "lines": legs + antler(True) + antler(False)}


def wingbeat(t, bursts=2, beats=4, burst_len=0.17):
    """Gleiten mit zwei Schlagserien. Abschlag schnell, Aufholen langsam."""
    flap = 0.06 * math.sin(2 * math.pi * t * 2)
    thrust = 0.0
    for b in range(bursts):
        start = (b + 0.18) / bursts
        u = (t - start) % 1.0
        if u >= burst_len:
            continue
        v = u / burst_len
        env = math.sin(math.pi * v) ** 0.6
        ph = (v * beats) % 1.0
        if ph < 0.38:
            w = -math.sin(ph / 0.38 * math.pi) ** 0.85
        else:
            w = 0.62 * math.sin((ph - 0.38) / 0.62 * math.pi) ** 1.3
        flap += w * 0.52 * env
        thrust += max(0.0, -w) * env
    return flap, thrust


def render_frame(t, w, h, ss):
    W, H = w * ss, h * ss
    img = make_sky(W, H).convert("RGBA")

    # Lichtsaum am Horizont — der einzige warme Ton außer dem Blick.
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gx, gy, gr = W * 0.66, H * 0.335, H * 0.50
    for i in range(22):
        u = i / 21.0
        r = gr * (1.0 - u * 0.84)
        gd.ellipse([gx - r * 2.1, gy - r * 0.6, gx + r * 2.1, gy + r * 0.6],
                   fill=LIME_BRIGHT + (int(46 * u ** 1.5),))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(H * 0.022)))

    draw = ImageDraw.Draw(img)

    # Ferne Hügel: brechen die schnurgerade Waldkante und geben Tiefe hinter
    # der hintersten Baumschicht.
    for hi, (hy, hamp, hspeed, htint) in enumerate(
            ((0.295, 0.052, 0.045, 0.86), (0.335, 0.040, 0.075, 0.78))):
        period = W * 1.9 * max(hspeed, 0.01)
        off = t * period
        col = mix(FOREST, sky_colour(hy - 0.03), htint)
        pts = [(-4, H)]
        stp = max(3, W // 260)
        for x in range(-stp, W + stp * 2, stp):
            u = ((x + off) / period) * 2 * math.pi
            y = hy * H + (math.sin(u + hi * 2.1) + 0.5 * math.sin(u * 2 + hi)) * hamp * H / 1.5
            pts.append((x, y))
        pts.append((W + 4, H))
        draw.polygon(pts, fill=col)

    d = abs(((t - SPOT_AT + 0.5) % 1.0) - 0.5)
    spotted = max(0.0, 1.0 - d / 0.13)

    base_travel = W * 1.9
    stag_x = stag_y = None
    stag_h = H * 0.205

    for i, (base, speed, trees, size, wave, haze) in enumerate(LAYERS):
        # Zum Himmel an dieser Höhe hin aufgehellt = Dunst.
        colour = (mix(FOREST, sky_colour(base - 0.02), haze) if haze >= 0
                  else mix(FOREST, (2, 14, 18), -haze))
        period = base_travel * speed
        offset = t * period
        amp = wave * H

        def ground(xw, base=base, period=period, amp=amp, i=i):
            return base * H + ground_wave(xw, period, amp, i + 1)

        # Boden der Schicht als Fläche, damit die Stämme darauf stehen.
        step = max(2, W // 400)
        pts = [(-step, H + 10)]
        for x in range(-step, W + step * 2, step):
            pts.append((x, ground(x + offset)))
        pts.append((W + step, H + 10))
        draw.polygon(pts, fill=colour)

        # Der Hirsch steht in dieser Schicht, vor deren Bäumen.
        skip = None
        if i == STAG_LAYER:
            world_x = (STAG_AT_SPOT * W + SPOT_AT * period) % period
            sx = (world_x - offset) % period
            if -W * 0.2 < sx < W * 1.2:
                stag_x, stag_y = sx, ground(world_x) + stag_h * 0.06
                skip = (sx - stag_h * 1.5, sx + stag_h * 1.5)

        canopy_band(draw, ground, -W * 0.06, W * 1.06, offset, period,
                    trees, size * H, colour, salt=i * 4.7,
                    mix=(0.84, 0.09, 0.07))

        if stag_x is not None and i == STAG_LAYER:
            # Heller Nebelfleck als Hintergrund, sonst geht die Silhouette in
            # der eigenen Schicht unter.
            halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            hd = ImageDraw.Draw(halo)
            hw_, hh_ = stag_h * 3.4, stag_h * 0.62
            hd.ellipse([stag_x - hw_, stag_y - hh_ * 1.15, stag_x + hw_, stag_y + hh_ * 0.35],
                       fill=mix(colour, sky_colour(base - 0.02), 0.34 + 0.14 * spotted) + (135,))
            img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(H * 0.045)))
            draw = ImageDraw.Draw(img)
            ink = STAG_INK
            st = stag_shape(stag_x, stag_y, stag_h)
            for poly in st["polys"]:
                draw.polygon(poly, fill=ink)
            for seg, wd in st["lines"]:
                draw.line(seg, fill=ink, width=max(1, int(round(wd))), joint="curve")

        # Nebel vor der Schicht: verschluckt ihren Fuß, trennt sie von der
        # nächsten. Das ist das eigentliche Stimmungsmittel.
        strength = [0.62, 0.52, 0.44, 0.34, 0.24, 0.10, 0.0][i]
        if strength:
            fog_band(img, W, H, base * H + size * H * 0.55, size * H * 1.5,
                     strength, sky_colour(base + 0.02))
            draw = ImageDraw.Draw(img)

    # Niedriges Gebüsch ganz vorn: füllt den sonst leeren Bodenstreifen und
    # gibt der untersten Kante etwas zu tun.
    scrub_period = base_travel * 1.45
    scrub_off = t * scrub_period
    canopy_band(draw, lambda xw: H * 1.02, -W * 0.05, W * 1.05, scrub_off,
                scrub_period, 34, H * 0.20, mix(FOREST, (2, 14, 18), 0.40),
                salt=31.0, mix=(0.30, 0.36, 0.34))

    drifting_fog(img, W, H, t)
    draw = ImageDraw.Draw(img)

    # --- Adler über den Kronen ---------------------------------------------
    flap, thrust = wingbeat(t)
    ex = W * (0.40 + 0.075 * math.sin(2 * math.pi * t))
    ey = H * (0.175 + 0.030 * math.sin(2 * math.pi * t * 2 + 0.6)) \
        + H * 0.045 * spotted - thrust * H * 0.026
    span = W * 0.078
    bank = math.sin(2 * math.pi * t) * 0.09 + 0.11 * spotted

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for part in eagle_polys(ex + span * 0.03, ey + span * 0.05, span, flap, bank):
        sd.polygon(part, fill=(2, 20, 30, 60))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(H * 0.006)))
    draw = ImageDraw.Draw(img)
    for part in eagle_polys(ex, ey, span, flap, bank, head_turn=spotted):
        draw.polygon(part, fill=EAGLE_INK)

    # --- Der Blick ----------------------------------------------------------
    if spotted > 0.02 and stag_x is not None:
        beam = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        bd = ImageDraw.Draw(beam)
        x0, y0 = ex, ey + span * 0.03
        x1, y1 = stag_x, stag_y - H * 0.035
        reach = min(1.0, spotted * 1.6)
        steps = 48
        for k in range(steps):
            u0, u1 = k / steps, (k + 1) / steps
            if u1 > reach:
                break
            a = int(200 * spotted * (0.30 + 0.70 * u0))
            bd.line([(lerp(x0, x1, u0), lerp(y0, y1, u0)),
                     (lerp(x0, x1, u1), lerp(y0, y1, u1))],
                    fill=LIME_BRIGHT + (a,), width=max(2, int(H * 0.0024)))
        if reach >= 0.99:
            for k in range(7):
                rr = H * (0.004 + 0.009 * k / 6)
                bd.ellipse([x1 - rr, y1 - rr, x1 + rr, y1 + rr],
                           fill=LIME_BRIGHT + (int(190 * spotted * (1 - k / 7) ** 1.5),))
        img.alpha_composite(beam.filter(ImageFilter.GaussianBlur(H * 0.0022)))

    # Vignette oben und unten, damit HTML-Text darauf lesbar bleibt.
    scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sc = ImageDraw.Draw(scrim)
    for y in range(H):
        v = y / (H - 1)
        a = int(52 * max(0.0, (0.20 - v) / 0.20) ** 1.3 + 56 * max(0.0, (v - 0.82) / 0.18) ** 1.5)
        if a:
            sc.line([(0, y), (W, y)], fill=(2, 20, 30, a))
    img.alpha_composite(scrim)

    return img.convert("RGB").resize((w, h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=350)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=460)
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--out", default="../frames2")
    ap.add_argument("--only", type=int, default=-1)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    rng = [args.only] if args.only >= 0 else range(args.frames)
    for i in rng:
        img = render_frame((i % args.frames) / args.frames, args.width, args.height, args.ss)
        img.save(os.path.join(args.out, "f_%04d.png" % i))
        if args.only < 0 and i % 25 == 0:
            print("frame %d/%d" % (i, args.frames), flush=True)
    print("done")


if __name__ == "__main__":
    main()
