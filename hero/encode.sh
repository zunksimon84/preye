#!/usr/bin/env bash
# Turn the rendered frames into what a hero section actually needs.
#
# Three outputs, because one file can't serve every case:
#   hero.mp4   H.264 — plays everywhere, Safari included
#   hero.webm  VP9   — noticeably smaller where it's supported
#   hero.jpg   the first frame, as poster and as the still shown to anyone
#              who set prefers-reduced-motion or is on a slow line
#
# No audio track at all: a silent stream still trips some autoplay heuristics,
# and it costs bytes for nothing.
set -euo pipefail

FRAMES="${1:-../frames}"
OUT="${2:-../out}"
FPS="${3:-25}"

mkdir -p "$OUT"

# The loop is closed by construction, so there is nothing to cross-fade — the
# frames go in as they are. -g keeps keyframes frequent enough that the browser
# can restart the loop without a visible hitch.
ffmpeg -y -loglevel error -framerate "$FPS" -i "$FRAMES/f_%04d.png" \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -crf 28 -preset slow -g "$FPS" -movflags +faststart \
  "$OUT/hero.mp4"

ffmpeg -y -loglevel error -framerate "$FPS" -i "$FRAMES/f_%04d.png" \
  -an -c:v libvpx-vp9 -pix_fmt yuv420p \
  -crf 40 -b:v 0 -row-mt 1 -g "$FPS" \
  "$OUT/hero.webm"

# Poster: frame 0, so the still and the first video frame are the same picture
# and there is no flash when playback starts.
ffmpeg -y -loglevel error -i "$FRAMES/f_0000.png" -q:v 4 "$OUT/hero.jpg"
# This ffmpeg build has no webp encoder, so Pillow writes it.
python3 -c "from PIL import Image; Image.open('$FRAMES/f_0000.png').save('$OUT/hero.webp', quality=78, method=6)"

printf '\n%-12s %s\n' "Datei" "Größe"
for f in hero.mp4 hero.webm hero.jpg hero.webp; do
  printf '%-12s %s\n' "$f" "$(du -h "$OUT/$f" | cut -f1)"
done
printf '\nDauer: %s s bei %s fps\n' "$(echo "scale=2; $(ls "$FRAMES"/f_*.png | wc -l | tr -d ' ') / $FPS" | bc)" "$FPS"
