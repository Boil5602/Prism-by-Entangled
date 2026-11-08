"""A contact sheet of a window's recorded frames (320x180 grey), to LOOK at what was on screen: a "wrong cover" is not one until its
frames say so (2026-10-08/09: four covers the marks called wrong were ads the marks had missed).

    python scripts/breakwatch/frames_sheet.py <day | bench> <window> <out.png> <HH:MM:SS>x<frames>x<step seconds> [more rows ...]

    ... 2026-10-08 youtube-tv-home-16x9-XL cc.png 14:31:16x8x3 14:33:38x8x2      two rows: a break's start, and its end, to the second
    ... bench youtube-tv-home-16x9-XL-w3 now.png 00:16:30x12x75                  the live recording's last hour (frames not kept yet)

Each row is one stretch, a frame every <step> seconds, its time of day above it. `bench` reads the live recording
(%LOCALAPPDATA%/Prism/diagnostics/bench), a day reads the kept one (golden/<day>). Reads only."""
import bisect
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics")
day, win, out = sys.argv[1], sys.argv[2], sys.argv[3]
folder = os.path.join(ROOT, "bench", win) if day == "bench" else os.path.join(ROOT, "golden", day, win)
names = sorted(f for f in os.listdir(folder) if f.endswith(".gray") and f[:9].isdigit())
times = [int(n[0:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6]) + int(n[6:9]) / 1000 for n in names]
rows = []
for spec in sys.argv[4:]:
    at, n, step = spec.split("x"); h, m, s = map(int, at.split(":")); t0 = h * 3600 + m * 60 + s; row = []
    for k in range(int(n)):
        x = t0 + k * int(step); i = bisect.bisect_left(times, x - 0.5)
        row.append((x, names[i] if i < len(times) and times[i] - x < max(2, int(step) / 2) else None))
    rows.append(row)
W, H = 240, 135
cols = max(len(r) for r in rows)
sheet = Image.new("L", (cols * W, len(rows) * (H + 14)), 0); dr = ImageDraw.Draw(sheet)
shown = 0
for r, row in enumerate(rows):
    for c, (x, n) in enumerate(row):
        if n:
            b = open(os.path.join(folder, n), "rb").read()
            if len(b) == 320 * 180: sheet.paste(Image.frombytes("L", (320, 180), b).resize((W, H)), (c * W, r * (H + 14) + 14)); shown += 1
        dr.text((c * W + 3, r * (H + 14) + 1), "%02d:%02d:%02d" % (x // 3600, x // 60 % 60, x % 60) + ("" if n else "  (no frame)"), fill=255)
sheet.save(out)
print(out, shown, "frames")
