"""Prism toolbar / listing icon: an amber prism on the dark wall, a white beam
entering from the left, splitting into a warm fan on the right. Rendered at
4x and downsampled so it stays crisp at 16 px. Run: python make-icons.py
-> icons/icon-{16,32,48,128}.png (referenced from manifest.json)."""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icons")
WALL, AMBER, INK = (20, 23, 28, 255), (240, 168, 60, 255), (215, 220, 227, 255)
FAN = [(240, 168, 60, 230), (232, 120, 80, 200), (180, 140, 220, 180)]


def render(size):
    S = 4
    w = size * S
    im = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = w * 0.22
    d.rounded_rectangle([0, 0, w - 1, w - 1], radius=r, fill=WALL)
    # prism: an equilateral-ish triangle, apex up, slightly right of centre
    cx, base_y, top_y = w * 0.54, w * 0.80, w * 0.20
    half = w * 0.30
    tri = [(cx, top_y), (cx - half, base_y), (cx + half, base_y)]
    # beam in (white) - from the left edge to the prism's left face
    bw = max(1, w * 0.045)
    d.line([(w * 0.04, w * 0.55), (cx - half * 0.45, w * 0.55)], fill=INK, width=int(bw))
    # fan out (three bands) - from the right face outward
    ox, oy = cx + half * 0.45, w * 0.52
    ends = [(w * 0.98, w * 0.38), (w * 0.98, w * 0.55), (w * 0.98, w * 0.72)]
    for col, e in zip(FAN, ends):
        d.line([(ox, oy), e], fill=col, width=int(bw))
    d.polygon(tri, fill=AMBER)
    # a subtle inner facet line for depth
    d.line([(cx, top_y), (cx, base_y)], fill=(255, 210, 130, 90), width=int(max(1, w * 0.02)))
    return im.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in (16, 32, 48, 128):
        render(s).save(os.path.join(OUT, "icon-%d.png" % s))
    print("icons written to", OUT)
