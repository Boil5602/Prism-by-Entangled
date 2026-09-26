"""The Prism mark, once, and every app icon cut from it.

Source of truth: assets/brand/prism-logo.png (RGBA, the mark on transparency, trimmed).
Run this after the mark changes; it rewrites every derived icon:

  targets/win-host/PrismHost/Assets/prism-icon.png   128 px, the grip at the top of the wall
  targets/win-host/PrismHost/Assets/prism.ico        16..256 px, the window, the taskbar, the executable
  prototypes/prism-veil-extension/icons/icon-*.png   16 / 32 / 48 / 128, the extension (rebuild its dist after)

A raster with a flat white background (the mark as it was handed over, 2026-09-09) is keyed back to transparency
by --key: a flood fill from the corners and the mark's hollow centre, with a soft edge, so the near-white
highlights INSIDE the mark are never touched.

    python scripts/brand-icons.py --key Prism.png     # import a flattened mark, then derive
    python scripts/brand-icons.py                     # derive from assets/brand/prism-logo.png
"""
import os, sys
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets", "brand", "prism-logo.png")
HOST = os.path.join(ROOT, "targets", "win-host", "PrismHost", "Assets")
EXT = os.path.join(ROOT, "prototypes", "prism-veil-extension", "icons")


def key_white(path):
    """The flattened mark back onto transparency: flood-fill the white from outside (and the hollow centre), soft edge."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    white = [[min(px[x, y]) >= 236 for x in range(w)] for y in range(h)]
    mask = [[False] * w for _ in range(h)]
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, h // 2)]
    q = deque()
    for sx, sy in seeds:
        if white[sy][sx] and not mask[sy][sx]:
            mask[sy][sx] = True
            q.append((sx, sy))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and white[ny][nx] and not mask[ny][nx]:
                mask[ny][nx] = True
                q.append((nx, ny))
    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if mask[y][x]:
                op[x, y] = (r, g, b, 0)
                continue
            # a pixel touching the keyed background: fade by how white it is (the anti-aliased rim)
            rim = any(0 <= nx < w and 0 <= ny < h and mask[ny][nx] for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
            a = 255
            if rim:
                a = max(0, min(255, int(255 * (255 - min(r, g, b)) / 90)))
                # the rim's colour is the mark's, not the white it was blended with: borrow the nearest inner neighbour
                inner = [px[nx, ny] for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1), (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1))
                         if 0 <= nx < w and 0 <= ny < h and not mask[ny][nx] and min(px[nx, ny]) < 200]
                if inner:
                    r, g, b = (sum(c[i] for c in inner) // len(inner) for i in range(3))
            op[x, y] = (r, g, b, a)
    return out.crop(out.getbbox())


def square(im, margin=0.06):
    """The mark centred on a square transparent canvas with a little air, so a scaled icon never clips a corner."""
    w, h = im.size
    side = int(round(max(w, h) * (1 + 2 * margin)))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return canvas


def derive(source):
    mark = Image.open(source).convert("RGBA")
    sq = square(mark)
    os.makedirs(HOST, exist_ok=True)
    os.makedirs(EXT, exist_ok=True)
    sq.resize((128, 128), Image.LANCZOS).save(os.path.join(HOST, "prism-icon.png"))
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    sq.resize((256, 256), Image.LANCZOS).save(os.path.join(HOST, "prism.ico"), sizes=ico_sizes)
    for n in (16, 32, 48, 128):
        sq.resize((n, n), Image.LANCZOS).save(os.path.join(EXT, f"icon-{n}.png"))
    print("derived: host prism-icon.png + prism.ico, extension icon-16/32/48/128 from", os.path.relpath(source, ROOT))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--key":
        keyed = key_white(os.path.join(ROOT, args[1]) if not os.path.isabs(args[1]) else args[1])
        os.makedirs(os.path.dirname(SOURCE), exist_ok=True)
        keyed.save(SOURCE)
        print("keyed", args[1], "->", os.path.relpath(SOURCE, ROOT), keyed.size)
    derive(SOURCE)
