#!/usr/bin/env python3
"""Generate hunting-post marker pins as PNGs.

Produces a teardrop pin for every stand number — 1..80 — plus an "a" and
"b" sub-position variant (1a, 1b, 2a, 2b, …). 240 PNGs total, written
to public/markers/. The Infomail PDF map references these by URL via
Static Maps' custom-icon parameter.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "markers"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Canvas + pin geometry. Static Maps recommends ≤ 64 px on the longest
# edge for icon performance; we go a bit taller (88) to fit the tail
# without squishing the head.
W, H = 64, 88
CX = 32                  # horizontal centre of canvas
CY_HEAD = 30             # vertical centre of head circle
R_OUT = 28               # outline radius
R_IN = 26                # fill radius (smaller by stroke width)
APEX_OUT = (CX, 86)      # outline apex (bottom of pin)
APEX_IN = (CX, 82)       # fill apex (inset by stroke)

FILL = (255, 222, 0, 255)
STROKE = (0, 0, 0, 255)
TEXT_FILL = (0, 0, 0, 255)
FONT_PATH = "/System/Library/Fonts/Helvetica.ttc"
FONT_INDEX_BOLD = 1  # 0 = Regular, 1 = Bold in Helvetica.ttc


def tangent_points(apex, center, radius):
    """Where the two tangent lines from `apex` touch the circle.

    Both points live on the circle and are perpendicular to the radius
    they sit on — that's what makes the join between head and tail
    look like a smooth teardrop instead of a sharp corner.
    """
    px, py = apex
    cx, cy = center
    d = math.hypot(px - cx, py - cy)
    # sin(theta) = r/d, where theta is the half-angle of the tangent
    # cone seen from the apex. The two tangent points sit at ±theta
    # from the line apex→centre.
    sin_t = radius / d
    cos_t = math.sqrt(max(0.0, 1.0 - sin_t * sin_t))
    # Direction from centre → apex, normalised.
    nx, ny = (px - cx) / d, (py - cy) / d
    # Tangent points: centre + r * (rotate (nx, ny) by ±90°-theta).
    # Easier form: the tangent-point offset from centre is
    #   r * (cos_t * perpendicular + sin_t * (centre→apex))
    # Subtract sin_t * direction because the tangent point sits on
    # the "near" side of the circle relative to the apex.
    perp1 = (-ny, nx)
    perp2 = (ny, -nx)
    t1 = (cx + radius * (cos_t * perp1[0] + sin_t * nx),
          cy + radius * (cos_t * perp1[1] + sin_t * ny))
    t2 = (cx + radius * (cos_t * perp2[0] + sin_t * nx),
          cy + radius * (cos_t * perp2[1] + sin_t * ny))
    # Order them left-to-right for predictable polygon winding.
    return tuple(sorted([t1, t2], key=lambda p: p[0]))


def font_for(text):
    """Largest readable font size that fits the text inside the head."""
    n = len(text)
    if n <= 1:
        size = 34
    elif n == 2:
        size = 28
    elif n == 3:
        size = 22
    else:
        size = 18
    return ImageFont.truetype(FONT_PATH, size, index=FONT_INDEX_BOLD)


def make_pin(label, out_path):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Outline (black) first, then fill (yellow) on top, slightly inset
    # so the black peeks out as the pin's outline.
    out_left, out_right = tangent_points(APEX_OUT, (CX, CY_HEAD), R_OUT)
    in_left, in_right = tangent_points(APEX_IN, (CX, CY_HEAD), R_IN)

    draw.ellipse([CX - R_OUT, CY_HEAD - R_OUT, CX + R_OUT, CY_HEAD + R_OUT], fill=STROKE)
    draw.polygon([out_left, out_right, APEX_OUT], fill=STROKE)

    draw.ellipse([CX - R_IN, CY_HEAD - R_IN, CX + R_IN, CY_HEAD + R_IN], fill=FILL)
    draw.polygon([in_left, in_right, APEX_IN], fill=FILL)

    # Text centred inside the head.
    font = font_for(label)
    bbox = draw.textbbox((0, 0), label, font=font, anchor="lt")
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (W - tw) / 2 - bbox[0]
    ty = CY_HEAD - th / 2 - bbox[1] - 1
    draw.text((tx, ty), label, font=font, fill=TEXT_FILL)

    img.save(out_path, "PNG", optimize=True)


def main():
    count = 0
    # Numbered stands 1..80 + their a/b sub-position variants.
    for n in range(1, 81):
        for suffix in ("", "a", "b"):
            label = f"{n}{suffix}"
            make_pin(label, OUT_DIR / f"{label}.png")
            count += 1
    # Letter fallbacks for posts without a numeric id (Klettersitze with
    # descriptive names like "Klettersitz Süd"). Capital A..H is more
    # than enough for any realistic Runde size.
    for letter in "ABCDEFGH":
        make_pin(letter, OUT_DIR / f"{letter}.png")
        count += 1
    print(f"Generated {count} pins in {OUT_DIR}")


if __name__ == "__main__":
    main()
