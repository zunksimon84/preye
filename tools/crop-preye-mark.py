#!/usr/bin/env python3
"""One-off: crop the P-mark out of the full preye logo (drops the wordmark
+ tagline), knock out the white background, and emit the site logo +
favicon assets. Re-runnable; source PNG path is the Downloads original."""
from PIL import Image
import numpy as np
import sys

SRC = '/Users/simonzunk/Downloads/preye.png'
PUB = '/Users/simonzunk/Code/hunting-heatmap/public'

img = Image.open(SRC).convert('RGBA')
a = np.array(img)
h, w = a.shape[:2]
ink = a[:, :, :3].astype(int).min(axis=2) < 235  # non-white content

# group content rows into bands, then merge bands split by a small gap
rows = ink.any(axis=1)
bands, y = [], 0
while y < h:
    if rows[y]:
        s = y
        while y < h and rows[y]:
            y += 1
        bands.append([s, y - 1])
    else:
        y += 1
merged = [bands[0]]
for s, e in bands[1:]:
    if s - merged[-1][1] < 60:
        merged[-1][1] = e
    else:
        merged.append([s, e])
print(f'image {w}x{h}  row-bands: {merged}')

ms, me = merged[0]  # first band = the P-mark
xs = np.where(ink[ms:me + 1, :].any(axis=0))[0]
x0, x1 = xs[0], xs[-1]

pad = 24
box = (max(0, x0 - pad), max(0, ms - pad),
       min(w, x1 + 1 + pad), min(h, me + 1 + pad))
mark = img.crop(box)
print(f'mark crop: {box}  -> {mark.size}')

# knock out the white background (and the P counter) to transparency
m = np.array(mark)
m[m[:, :, :3].astype(int).min(axis=2) > 246, 3] = 0
mark = Image.fromarray(m)

# site logo: cap height at 420px, keep aspect
LOGO_H = 420
logo = mark.resize((round(mark.width * LOGO_H / mark.height), LOGO_H), Image.LANCZOS)
logo.save(f'{PUB}/preye-mark.png')
print(f'wrote preye-mark.png {logo.size}')

# favicon: 256x256 square, mark centred with a 10% margin
FAV, margin = 256, 0.10
fr = round(FAV * (1 - 2 * margin)) / max(mark.width, mark.height)
fmark = mark.resize((round(mark.width * fr), round(mark.height * fr)), Image.LANCZOS)
canvas = Image.new('RGBA', (FAV, FAV), (0, 0, 0, 0))
canvas.paste(fmark, ((FAV - fmark.width) // 2, (FAV - fmark.height) // 2), fmark)
canvas.save(f'{PUB}/favicon-preye.png')
print(f'wrote favicon-preye.png {canvas.size}')
