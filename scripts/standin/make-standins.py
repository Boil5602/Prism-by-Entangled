"""The stand-in pictures for shots of PRISM (docs/features/tutorial.md, "The pictures"; 2026-11-11).

    python -I scripts/standin/make-standins.py [--out <folder>] [--only poster|backdrop|still|face|album] [--sheet <folder>]

Writes the stand-in folder (%LOCALAPPDATA%/Prism/diagnostics/standin unless --out): made-up film and show artwork that looks like the
real thing and is none of it. Same input, same output: every choice comes from a hash of the title, never from a clock or a random seed.

  poster-NN.png     600 x 900    a title's tall poster (NN = its place in titles.json)
  backdrop-NN.png   1280 x 720   its wide picture, the title set small at the lower left
  still-NN-K.png    640 x 360    six stills a title (an episode takes one by its number)
  face-NN.png       400 x 600    a made-up person: a plain silhouette on a colour field, never a face
  album-NN.png      640 x 640    a made-up record
  standin.json      the titles' words: year, rating, runtime, tagline, overview, seasons and episode names, cast

Backgrounds are the CC0 and public-domain nature photographs of the extension's art pool (prototypes/prism-veil-art: the hosted
copies, re-encoded at 1920 px; a photo not on this PC is fetched once from the public pool and kept beside the output). No studio's
artwork, no real title, no real person's name or face. The typefaces are in scripts/standin/fonts, each under the SIL Open Font
License (THIRD-PARTY-NOTICES.md). --sheet also writes contact sheets of everything into that folder.
"""
import hashlib, io, json, math, os, random, sys, urllib.request

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(REPO, "prototypes", "prism-veil-art", "hosted")
POOL_URL = "https://prism.entangled.world/veil/art/"
FONTS = os.path.join(HERE, "fonts")
A = sys.argv[1:]
def opt(n, d=None):
    if n in A:
        i = A.index(n); v = A[i + 1]; del A[i:i + 2]; return v
    return d
OUT = opt("--out", os.path.join(os.environ.get("LOCALAPPDATA", "."), "Prism", "diagnostics", "standin"))
ONLY = opt("--only"); SHEET = opt("--sheet")
CACHE = os.path.join(OUT, "_pool")
DATA = json.load(io.open(os.path.join(HERE, "titles.json"), encoding="utf-8"))
TITLES = DATA["titles"]

F = {"bebas": "BebasNeue-Regular.ttf", "abril": "AbrilFatface-Regular.ttf", "audiowide": "Audiowide-Regular.ttf", "monoton": "Monoton-Regular.ttf",
     "bangers": "Bangers-Regular.ttf", "pacifico": "Pacifico-Regular.ttf", "righteous": "Righteous-Regular.ttf", "anton": "Anton-Regular.ttf",
     "pathway": "PathwayGothicOne-Regular.ttf", "rye": "Rye-Regular.ttf", "vibes": "GreatVibes-Regular.ttf", "cinzel": "CinzelDecorative-Bold.ttf",
     "limelight": "Limelight-Regular.ttf", "josefin": "JosefinSans[wght].ttf"}
_fc = {}
def font(name, size):
    k = (name, int(size))
    if k not in _fc:
        f = ImageFont.truetype(os.path.join(FONTS, F[name]), int(size))
        if name == "josefin":
            try: f.set_variation_by_axes([600])
            except Exception: pass
        _fc[k] = f
    return _fc[k]

def rng_for(*parts):
    return random.Random(int(hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:16], 16))

# ---- the photographs ----
SKIP = ("kayaking", "liberty_island", "komos", "dungenesscrab", "manatee", "jaguar", "meleagris", "oncorhynchus", "poecile", "phalaropus", "redthroatedloon", "warbler", "skipper", "doe_stalks")
MANIFEST = [m["file"] for m in json.load(io.open(os.path.join(POOL, "manifest.json"), encoding="utf-8"))["images"]] if os.path.exists(os.path.join(POOL, "manifest.json")) else []
def pool_list():
    names = sorted(MANIFEST) if MANIFEST else sorted(json.load(io.open(os.path.join(HERE, "pool.json"), encoding="utf-8")))
    return [n for n in names if not any(s in n for s in SKIP)]
PHOTOS = pool_list()
LIKES = {"scifi": ("nebula", "webb", "m57", "cosmic", "galaxy", "midnight_sun", "geyser", "erupting"),
         "thriller": ("fog", "forest", "snow", "cliff", "canyon", "black", "river", "falls", "rapids"),
         "mystery": ("fog", "forest", "lake", "reflections", "cliff", "falls", "sunset"),
         "comedy": ("poppy", "poppies", "meadow", "wildflowers", "beach", "lupine", "cactus", "aster", "foliage"),
         "romance": ("sunset", "sunrise", "meadow", "lake", "wildflowers", "lotus", "poppies"),
         "drama": ("mountain", "mt_", "lake", "valley", "beach", "foliage", "fall", "sunrise", "clouds"),
         "western": ("canyon", "pueblo", "cactus", "valley", "sunset", "mountains", "waring", "coyote"),
         "kids": ("meadow", "wildflowers", "poppies", "coral", "clouds", "lupine", "paintbrush", "aster", "lake"),
         "documentary": ("glacier", "mountain", "mt_", "cliffs", "sea", "superior", "peak", "river", "island", "dunes")}
_used = set(); _wide = set()
def photo_for(genre, *key):
    """A photograph for a genre, by the key's hash: one of the genre's kind first, and none twice for a poster while others are left."""
    r = rng_for("photo", genre, *key)
    liked = [n for n in PHOTOS if any(w in n for w in LIKES.get(genre, ()))] or PHOTOS
    fresh = [n for n in liked if n not in _used] or [n for n in PHOTOS if n not in _used] or liked
    n = fresh[r.randrange(len(fresh))]
    return n
_pc = {}
def load_photo(name):
    if name in _pc: return _pc[name]
    p = os.path.join(POOL, name)
    if not os.path.exists(p):
        os.makedirs(CACHE, exist_ok=True); p = os.path.join(CACHE, name)
        if not os.path.exists(p):
            with urllib.request.urlopen(urllib.request.Request(POOL_URL + name, headers={"User-Agent": "standin-pool"}), timeout=60) as rsp, open(p, "wb") as f: f.write(rsp.read())
    im = Image.open(p).convert("RGB")
    if len(_pc) > 24: _pc.clear()
    _pc[name] = im
    return im

def cover(im, w, h, fx=0.5, fy=0.5, zoom=1.0):
    s = max(w / im.width, h / im.height) * zoom
    r = im.resize((max(w, int(im.width * s + 0.5)), max(h, int(im.height * s + 0.5))), Image.LANCZOS)
    x = int((r.width - w) * fx); y = int((r.height - h) * fy)
    return r.crop((x, y, x + w, y + h))

# ---- the grade, by genre ----
def grade(im, genre, r):
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = (a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114)[..., None]
    def sat(x, k): return lum + (x - lum) * k
    def con(x, k): return (x - 0.5) * k + 0.5
    h, w = a.shape[:2]
    if genre == "thriller": a = con(sat(a, 0.35), 1.3) * np.array([0.6, 0.82, 1.1]) * 1.0
    elif genre == "mystery": a = con(sat(a, 0.45), 1.25) * np.array([0.66, 0.95, 0.9]) * 0.95
    elif genre == "comedy": a = sat(a, 1.4) * np.array([1.1, 1.02, 0.84]) * 1.06
    elif genre == "romance": a = sat(a, 1.05) * np.array([1.12, 0.93, 0.96]) * 1.04 + 0.04
    elif genre == "drama": a = con(sat(a, 0.62), 0.92) * np.array([1.04, 0.98, 0.9]) + 0.05
    elif genre == "western":
        g = con(lum, 1.2); a = np.concatenate([g * 1.12, g * 0.9, g * 0.62], -1) + 0.03
    elif genre == "scifi":
        g = np.clip(con(lum, 1.35), 0, 1)
        lo, mid, hi = np.array([0.07, 0.0, 0.22]), np.array([0.9, 0.12, 0.62]), np.array([0.35, 0.95, 1.0])
        a = np.where(g < 0.5, lo + (mid - lo) * (g * 2), mid + (hi - mid) * (g * 2 - 1))
        a[::3, :, :] *= 0.86   # scan lines
    elif genre == "kids": a = con(sat(a, 1.65), 1.05) * 1.1 + 0.02
    elif genre == "documentary": a = np.repeat(np.clip(con(lum, 1.4), 0, 1), 3, -1)
    if genre in ("drama", "documentary", "western", "thriller"):
        n = np.random.RandomState(r.randrange(1 << 30)).normal(0, 0.035 if genre != "thriller" else 0.02, (h, w, 1)).astype(np.float32); a = a + n
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    v = {"thriller": 0.4, "mystery": 0.4, "scifi": 0.45, "drama": 0.35, "documentary": 0.4, "western": 0.4}.get(genre, 0.15)
    a = a * (1 - v * np.clip(d - 0.35, 0, 1)[..., None] ** 1.5)
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))

def shade(im, top=0.0, bottom=0.0, left=0.0, colour=(0, 0, 0)):
    """Darken toward an edge so type reads: each strength is the opacity at that edge, fading to nothing by the middle."""
    w, h = im.size; a = np.zeros((h, w), np.float32)
    y = np.linspace(0, 1, h)[:, None]; x = np.linspace(0, 1, w)[None, :]
    if top: a = np.maximum(a, top * np.clip(1 - y / 0.45, 0, 1) ** 1.4 + 0 * x)
    if bottom: a = np.maximum(a, bottom * np.clip((y - 0.45) / 0.55, 0, 1) ** 1.2 + 0 * x)
    if left: a = np.maximum(a, left * np.clip(1 - x / 0.7, 0, 1) ** 1.3 + 0 * y)
    ov = Image.new("RGB", im.size, colour); return Image.composite(ov, im, Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)))

# ---- type ----
def text_w(s, f, track=0):
    return sum(f.getlength(c) for c in s) + track * max(0, len(s) - 1) if track else f.getlength(s)
def draw_line(d, x, y, s, f, fill, track=0, anchor="m", stroke=0, stroke_fill=None):
    """One line, tracked letter by letter when asked; x is its middle (anchor m), left (l) or right (r); y its top."""
    w = text_w(s, f, track)
    x0 = x - w / 2 if anchor == "m" else x - w if anchor == "r" else x
    if not track: d.text((x0, y), s, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill); return
    for c in s:
        d.text((x0, y), c, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill); x0 += f.getlength(c) + track
def split_lines(words, n):
    """The words in n lines of about the same length."""
    if n <= 1 or len(words) <= 1: return [" ".join(words)]
    best = None
    def rec(i, k, cur):
        nonlocal best
        if k == 1:
            c = cur + [" ".join(words[i:])]
            if all(c):
                s = max(len(x) for x in c) - min(len(x) for x in c) * 0.3
                if best is None or s < best[0]: best = (s, c)
            return
        for j in range(i + 1, len(words) - k + 2): rec(j, k - 1, cur + [" ".join(words[i:j])])
    rec(0, min(n, len(words)), [])
    return best[1]
def fit_title(title, fname, maxw, maxh, upper=True, track=0.0, lead=1.0, max_size=400):
    """The title's lines and the largest type that fits the box: (lines, font, line height)."""
    t = title.upper() if upper else title; words = t.split()
    best = None
    for n in (1, 2, 3, 4):
        if n > len(words): break
        lines = split_lines(words, n)
        lo, hi = 10, max_size
        while lo < hi:
            m = (lo + hi + 1) // 2; f = font(fname, m); asc, desc = f.getmetrics(); lh = (asc + desc) * lead
            if max(text_w(x, f, track * m) for x in lines) <= maxw and lh * len(lines) <= maxh: lo = m
            else: hi = m - 1
        if best is None or lo > best[0]: best = (lo, lines)
    f = font(fname, best[0]); asc, desc = f.getmetrics()
    return best[1], f, (asc + desc) * lead
def title_layer(size, lines, f, lh, cx, top, fill, track=0, anchor="m", stroke=0, stroke_fill=None):
    L = Image.new("RGBA", size, (0, 0, 0, 0)); d = ImageDraw.Draw(L)
    for i, s in enumerate(lines): draw_line(d, cx, top + i * lh, s, f, fill, track, anchor, stroke, stroke_fill)
    return L
def with_shadow(base, layer, blur=8, colour=(0, 0, 0), strength=0.8, offset=(0, 4)):
    a = layer.getchannel("A").filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * strength))
    sh = Image.new("RGBA", base.size, colour + (0,)); sh.putalpha(ImageChops.offset(a, *offset))
    out = Image.alpha_composite(base.convert("RGBA"), sh); return Image.alpha_composite(out, layer)
def glow(base, layer, colour, blur=14, times=2):
    out = base.convert("RGBA"); a = layer.getchannel("A")
    for k in range(times):
        g = Image.new("RGBA", base.size, colour + (0,)); g.putalpha(a.filter(ImageFilter.GaussianBlur(blur * (k + 1))))
        out = Image.alpha_composite(out, g)
    return Image.alpha_composite(out, layer)

def person(i): return DATA["first"][i % len(DATA["first"])] + " " + DATA["last"][(i * 7 + 3) % len(DATA["last"])]
PEOPLE = [person(i) for i in range(30)]
def cast_of(n):
    r = rng_for("cast", TITLES[n]["title"]); return r.sample(range(len(PEOPLE)), 6)

def billing(d, w, y, n, colour, size):
    r = rng_for("billing", TITLES[n]["title"]); c = [PEOPLE[i].upper() for i in cast_of(n)]
    house = r.choice(["NORTHLIGHT PICTURES", "KESTREL FILMWORKS", "TIDEWATER STUDIO", "LANTERNHOUSE", "ELM RIDGE PICTURES"])
    lines = [f"{house} PRESENTS  A {r.choice(['QUAY NINE', 'MAPLE HALL', 'VESPER', 'ARDEN BAY'])} PRODUCTION  {c[0]}  {c[1]}  {c[2]}",
             f"MUSIC BY {c[3]}   EDITED BY {c[4]}   WRITTEN BY {c[5]}   DIRECTED BY {c[(r.randrange(3))]}"]
    f = font("pathway", size)
    for k, s in enumerate(lines):
        while text_w(s, f, 1.2) > w * 0.86 and "  " in s: s = s.rsplit("  ", 1)[0]
        draw_line(d, w / 2, y + k * size * 1.18, s, f, colour, 1.2)

def laurel(im, cx, cy, s, colour, top, bottom):
    d = ImageDraw.Draw(im)
    for side in (-1, 1):
        for k in range(9):
            a = math.radians(205 - k * 17) if side < 0 else math.radians(-25 + k * 17)
            x = cx + math.cos(a) * s; y = cy - math.sin(a) * s * 0.92
            leaf = Image.new("RGBA", (int(s * 0.5), int(s * 0.5)), (0, 0, 0, 0)); ld = ImageDraw.Draw(leaf)
            ld.ellipse((s * 0.1, s * 0.19, s * 0.4, s * 0.31), fill=colour)
            leaf = leaf.rotate(math.degrees(a) + (90 if side < 0 else -90) + side * 28, resample=Image.BICUBIC)
            im.alpha_composite(leaf, (int(x - s * 0.25), int(y - s * 0.25)))
    f1 = font("josefin", s * 0.2); f2 = font("pathway", s * 0.3)
    while text_w(top, f1, 1) > s * 1.2: f1 = font("josefin", f1.size - 1)
    draw_line(d, cx, cy - s * 0.42, top, f1, colour, 1)
    words = bottom.upper().split(); mid = (len(words) + 1) // 2
    draw_line(d, cx, cy - s * 0.14, " ".join(words[:mid]), f2, colour, 0.5); draw_line(d, cx, cy + s * 0.2, " ".join(words[mid:]), f2, colour, 0.5)

STYLE = {  # the title's typeface (two to choose from), case, tracking, colour and where it sits
    "thriller": dict(fonts=("bebas", "anton"), upper=True, track=0.06, fill=(240, 244, 250), pos="bottom"),
    "mystery": dict(fonts=("cinzel", "limelight"), upper=True, track=0.03, fill=(232, 226, 200), pos="bottom"),
    "comedy": dict(fonts=("pacifico", "righteous"), upper=False, track=0, fill=(255, 226, 92), pos="top"),
    "romance": dict(fonts=("vibes", "abril"), upper=False, track=0, fill=(255, 244, 240), pos="bottom"),
    "drama": dict(fonts=("abril", "limelight"), upper=False, track=0, fill=(250, 244, 232), pos="middle"),
    "western": dict(fonts=("rye", "rye"), upper=True, track=0.02, fill=(250, 226, 170), pos="middle"),
    "scifi": dict(fonts=("audiowide", "monoton"), upper=True, track=0.04, fill=(240, 255, 255), pos="middle"),
    "kids": dict(fonts=("bangers", "righteous"), upper=True, track=0.02, fill=(255, 232, 64), pos="top"),
    "documentary": dict(fonts=("anton", "bebas"), upper=True, track=0.05, fill=(255, 255, 255), pos="bottom"),
}

def poster(n):
    t = TITLES[n]; g = t["genre"]; r = rng_for("poster", t["title"]); st = STYLE[g]
    W, H = 600, 900
    name = photo_for(g, t["title"]); _used.add(name)
    im = grade(cover(load_photo(name), W, H, r.uniform(0.2, 0.8), r.uniform(0.3, 0.7), r.uniform(1.0, 1.25)), g, r)
    pos = st["pos"]
    im = shade(im, top=0.75 if pos == "top" else 0.35, bottom=0.92 if g not in ("kids", "comedy") else 0.7, colour=(8, 10, 22) if g in ("thriller", "scifi", "mystery") else (20, 12, 8) if g in ("western", "drama", "romance") else (0, 0, 0)).convert("RGBA")
    d = ImageDraw.Draw(im)
    fname = st["fonts"][r.randrange(2)]
    if fname == "monoton" and len(t["title"]) > 20: fname = "audiowide"
    if fname == "vibes" and len(t["title"]) > 24: fname = "abril"
    upper = st["upper"] and fname not in ("pacifico", "vibes")
    boxh = H * (0.3 if pos != "middle" else 0.34)
    lines, f, lh = fit_title(t["title"], fname, W * 0.84, boxh, upper, st["track"], 0.98 if upper else 1.05, 170)
    th = lh * len(lines)
    top = H * 0.09 if pos == "top" else H * 0.5 - th / 2 if pos == "middle" else H * 0.8 - th
    track = st["track"] * f.size
    if g == "kids":
        L = title_layer(im.size, lines, f, lh, W / 2, top, st["fill"], track, stroke=max(4, f.size // 9), stroke_fill=(40, 24, 110))
        im = with_shadow(im, L, 2, (255, 90, 120), 1.0, (5, 7))
    elif g == "comedy":
        L = title_layer(im.size, lines, f, lh, W / 2, top, st["fill"], track, stroke=max(2, f.size // 16), stroke_fill=(120, 40, 20))
        im = with_shadow(im, L, 3, (60, 20, 10), 0.9, (4, 6))
    elif g == "scifi":
        L = title_layer(im.size, lines, f, lh, W / 2, top, st["fill"], track); im = glow(im, L, (90, 240, 255) if r.random() < 0.5 else (255, 80, 200), 10, 2)
    else:
        L = title_layer(im.size, lines, f, lh, W / 2, top, st["fill"], track); im = with_shadow(im, L, 10, (0, 0, 0), 0.85, (0, 5))
    d = ImageDraw.Draw(im)
    # the tagline, on the side of the title that has room
    tf = font("josefin", 25); tag = t["tagline"].upper() if g in ("thriller", "scifi", "documentary", "mystery", "western") else t["tagline"]
    ty = top + th + 18 if pos != "bottom" else top - 50
    while text_w(tag, tf, 2 if tag.isupper() else 0) > W * 0.86: tf = font("josefin", tf.size - 1)
    TL = Image.new("RGBA", im.size, (0, 0, 0, 0)); draw_line(ImageDraw.Draw(TL), W / 2, ty, tag, tf, (255, 255, 255, 240), 2 if tag.isupper() else 0)
    im = with_shadow(im, TL, 5, (0, 0, 0), 1.0, (0, 2)); d = ImageDraw.Draw(im)
    if g == "documentary":
        d.line((W * 0.2, top - 62, W * 0.8, top - 62), fill=(255, 255, 255, 200), width=2)
    # a laurel, an "Original" line, or neither
    k = r.random()
    if k < 0.3: laurel(im, W / 2 if pos != "top" else W * 0.5, H * 0.15 if pos != "top" else H * 0.64, 84, (255, 255, 255, 235), "WINNER" if r.random() < 0.5 else "OFFICIAL SELECTION", r.choice(DATA["festivals"]))
    elif k < 0.62:
        o = r.choice(DATA["originals"]).upper(); of = font("josefin", 20)
        draw_line(d, W / 2, H * 0.045 if pos != "top" else H * 0.78, o, of, (255, 255, 255, 235), 4, stroke=1, stroke_fill=(0, 0, 0, 110))
    billing(d, W, H - 86, n, (255, 255, 255, 200), 20)
    yr = font("josefin", 16); draw_line(d, W / 2, H - 30, ("SEASON %d" % len(t["seasons"]) if t["kind"] == "show" and r.random() < 0.6 else "COMING SOON" if r.random() < 0.3 else str(t["year"])), yr, (255, 255, 255, 170), 5)
    return im.convert("RGB")

def backdrop(n):
    t = TITLES[n]; g = t["genre"]; r = rng_for("backdrop", t["title"]); st = STYLE[g]; W, H = 1280, 720
    liked = [x for x in PHOTOS if any(w in x for w in LIKES.get(g, ()))] or PHOTOS
    fresh = [x for x in liked if x not in _wide and x != photo_for(g, t["title"])] or [x for x in PHOTOS if x not in _wide]
    name = fresh[r.randrange(len(fresh))]; _wide.add(name)
    im = grade(cover(load_photo(name), W, H, r.uniform(0.3, 0.7), r.uniform(0.25, 0.6), 1.0), g, r)
    im = shade(im, bottom=0.7, left=0.72, colour=(6, 8, 14)).convert("RGBA")
    fname = st["fonts"][rng_for("poster", t["title"]).randrange(2)]
    if fname == "monoton": fname = "audiowide"
    if fname == "vibes" and len(t["title"]) > 24: fname = "abril"
    upper = st["upper"] and fname not in ("pacifico", "vibes")
    lines, f, lh = fit_title(t["title"], fname, W * 0.4, H * 0.3, upper, st["track"], 1.0, 110)
    top = H * 0.86 - lh * len(lines) - 30
    L = title_layer(im.size, lines, f, lh, W * 0.06, top, st["fill"], st["track"] * f.size, anchor="l")
    im = glow(im, L, (90, 240, 255), 8, 1) if g == "scifi" else with_shadow(im, L, 8, (0, 0, 0), 0.85, (0, 4))
    d = ImageDraw.Draw(im); draw_line(d, W * 0.06, top + lh * len(lines) + 10, t["tagline"], font("josefin", 22), (255, 255, 255, 215), 0, anchor="l")
    return im.convert("RGB")

def still(n, k):
    t = TITLES[n]; g = t["genre"]; r = rng_for("still", t["title"], k)
    liked = [x for x in PHOTOS if any(w in x for w in LIKES.get(g, ()))] or PHOTOS
    im = cover(load_photo(liked[r.randrange(len(liked))]), 640, 360, r.random(), r.random(), r.uniform(1.0, 1.9))
    return grade(im, g, r)

def face(i):
    r = rng_for("face", PEOPLE[i]); W, H = 400, 600
    hue = r.random()
    def hsv(h, s, v):
        import colorsys; return tuple(int(c * 255) for c in colorsys.hsv_to_rgb(h % 1, s, v))
    c1, c2 = hsv(hue, 0.45, 0.8), hsv(hue + 0.08, 0.6, 0.35); fig = hsv(hue + 0.5, 0.35, 0.22); rim = hsv(hue + 0.02, 0.3, 0.95)
    y = np.linspace(0, 1, H)[:, None, None]; bg = (np.array(c1) * (1 - y) + np.array(c2) * y) * np.ones((1, W, 1))
    im = Image.fromarray(bg.astype(np.uint8)).convert("RGBA"); d = ImageDraw.Draw(im)
    for _ in range(r.randrange(3, 6)):   # soft shapes behind, as a studio backdrop
        x, yy, s = r.uniform(0, W), r.uniform(0, H * 0.7), r.uniform(80, 220); d.ellipse((x - s, yy - s, x + s, yy + s), fill=hsv(hue + r.uniform(-0.05, 0.1), 0.4, r.uniform(0.5, 0.9)) + (60,))
    im = im.filter(ImageFilter.GaussianBlur(18)); m = Image.new("L", (W, H), 0); md = ImageDraw.Draw(m)
    cx = W / 2 + r.uniform(-14, 14); hw = r.uniform(78, 92); hh = hw * r.uniform(1.22, 1.34); cy = H * 0.4
    md.ellipse((cx - hw, cy - hh, cx + hw, cy + hh), fill=255)                                    # the head
    kind = r.randrange(4)                                                                          # hair: a shape, never a feature
    if kind == 0: md.ellipse((cx - hw * 1.18, cy - hh * 1.2, cx + hw * 1.18, cy + hh * 0.2), fill=255)
    elif kind == 1: md.rounded_rectangle((cx - hw * 1.25, cy - hh * 1.1, cx + hw * 1.25, cy + hh * 1.5), radius=int(hw), fill=255)
    elif kind == 2: md.ellipse((cx - hw * 0.6, cy - hh * 1.55, cx + hw * 0.6, cy - hh * 0.7), fill=255)
    md.rectangle((cx - hw * 0.42, cy + hh * 0.7, cx + hw * 0.42, cy + hh * 1.5), fill=255)       # the neck
    sw = r.uniform(150, 185); sy = cy + hh * 1.32
    md.rounded_rectangle((cx - sw, sy, cx + sw, H + 80), radius=int(sw * 0.55), fill=255)        # the shoulders
    body = Image.new("RGBA", (W, H), fig + (255,)); bd = ImageDraw.Draw(body)
    for k in range(-H, W, r.randrange(22, 40)): bd.line((k, H, k + H, 0), fill=hsv(hue + 0.5, 0.3, 0.3) + (255,), width=6)
    rimm = ImageChops.subtract(m.filter(ImageFilter.GaussianBlur(1)), ImageChops.offset(m, 10, 6)); rl = Image.new("RGBA", (W, H), rim + (0,)); rl.putalpha(rimm.point(lambda v: int(v * 0.7)))
    im.paste(body, (0, 0), m.filter(ImageFilter.GaussianBlur(1))); im = Image.alpha_composite(im, rl)
    return im.convert("RGB")

def album(i):
    r = rng_for("album", i); S = 640; g = r.choice(["scifi", "drama", "comedy", "documentary", "romance", "thriller", "kids", "western"])
    im = grade(cover(load_photo(PHOTOS[r.randrange(len(PHOTOS))]), S, S, r.random(), r.random(), r.uniform(1.0, 1.6)), g, r)
    artist, name = DATA["artists"][i % len(DATA["artists"])], DATA["albums"][(i * 5 + 2) % len(DATA["albums"])]
    lay = r.randrange(4); fname = r.choice(["bebas", "abril", "righteous", "anton", "limelight", "audiowide", "pacifico"])
    if lay == 0:
        im = shade(im, bottom=0.85).convert("RGBA"); lines, f, lh = fit_title(name, fname, S * 0.84, S * 0.3, fname != "pacifico", 0.02, 1.0, 120)
        L = title_layer(im.size, lines, f, lh, S * 0.08, S * 0.9 - lh * len(lines), (255, 255, 255), 0, "l"); im = with_shadow(im, L, 6); d = ImageDraw.Draw(im)
        draw_line(d, S * 0.08, S * 0.07, artist.upper(), font("josefin", 26), (255, 255, 255, 235), 5, "l")
    elif lay == 1:
        im = im.convert("RGBA"); band = Image.new("RGBA", (S, int(S * 0.3)), tuple(r.randrange(20, 240) for _ in range(3)) + (235,)); im.alpha_composite(band, (0, int(S * 0.35)))
        lines, f, lh = fit_title(name, fname, S * 0.88, S * 0.2, True, 0.03, 1.0, 100); d = ImageDraw.Draw(im)
        for k, s in enumerate(lines): draw_line(d, S / 2, S * 0.5 - lh * len(lines) / 2 - S * 0.03 + k * lh, s, f, (255, 255, 255), 0.03 * f.size)
        draw_line(d, S / 2, S * 0.585, artist.upper(), font("josefin", 22), (255, 255, 255, 235), 6)
    elif lay == 2:
        im = shade(im, top=0.8).convert("RGBA"); lines, f, lh = fit_title(artist, fname, S * 0.86, S * 0.26, True, 0.02, 1.0, 130)
        L = title_layer(im.size, lines, f, lh, S / 2, S * 0.08, (255, 240, 200), 0.02 * f.size); im = with_shadow(im, L, 6); d = ImageDraw.Draw(im)
        draw_line(d, S / 2, S * 0.9, name.upper(), font("josefin", 26), (255, 255, 255, 235), 6)
    else:
        im = im.convert("RGBA"); fr = Image.new("RGBA", (S, S), (0, 0, 0, 0)); fd = ImageDraw.Draw(fr); m = int(S * 0.07)
        fd.rectangle((m, m, S - m, S - m), outline=(255, 255, 255, 235), width=4); im = Image.alpha_composite(im, fr); d = ImageDraw.Draw(im)
        lines, f, lh = fit_title(name, fname, S * 0.7, S * 0.3, fname != "pacifico", 0, 1.0, 110)
        L = title_layer(im.size, lines, f, lh, S / 2, S / 2 - lh * len(lines) / 2, (255, 255, 255), 0); im = with_shadow(im, L, 8); d = ImageDraw.Draw(im)
        draw_line(d, S / 2, S * 0.84, artist.upper(), font("josefin", 22), (255, 255, 255, 235), 6)
    return im.convert("RGB")

# ---- the words ----
EP_A = ["The Long", "A Small", "The Last", "Another", "The Missing", "A Borrowed", "The Second", "No Ordinary", "The Quiet", "An Honest", "The Crooked", "A Late", "The Wrong", "The Other", "A Cold"]
EP_B = ["Lighthouse", "Ledger", "Harvest", "Tide", "Signal", "Lantern", "Orchard", "Ferry", "Almanac", "Bridge", "Crossing", "Promise", "Map", "Storm", "Kite", "Parade", "Key", "Letter", "Winter", "Detour"]
EP_C = ["Arden Bay", "Elm Ridge", "Quay Nine", "Hollis", "Vesper", "Marrow Point", "Maple Hall", "the North Road"]
OVER = {"thriller": "When {a} goes missing near {p}, a {r} finds that every answer leads back to one night nobody will talk about.",
        "mystery": "A {r} arrives in {p} to settle a small matter, and stays to untangle a secret the whole town has agreed to forget.",
        "comedy": "A {r} with a plan and no backup plan turns {p} upside down, one well-meant disaster at a time.",
        "romance": "Two people who were sure they had it figured out meet in {p}, and spend a year proving each other wrong.",
        "drama": "Three generations share one house in {p}. Over a single season, an old debt comes due and nothing stays buried.",
        "western": "A {r} rides back to {p} to bury the past, and finds it waiting at the county line.",
        "scifi": "A {r} at a listening post near {p} picks up a signal that should not exist, and that answers back.",
        "kids": "Best friends from {p} set off on a big little adventure, with a snack, a map and a lot of heart.",
        "documentary": "Filmed over a full year around {p}: the people, the weather and the work that keep a quiet corner of the map alive."}
ROLES = ["retired ferry pilot", "night-shift radio host", "small-town surveyor", "junior archivist", "lighthouse keeper", "travelling mapmaker", "school band leader", "harbor mechanic"]
def words():
    out = []
    for n, t in enumerate(TITLES):
        r = rng_for("words", t["title"]); e = dict(t); e["index"] = n
        e["overview"] = OVER[t["genre"]].format(a=r.choice(["a ferry", "a survey crew", "the last train", "a radio operator"]), p=r.choice(EP_C), r=r.choice(ROLES))
        e["cast"] = [PEOPLE[i] for i in cast_of(n)]; e["castIndex"] = cast_of(n)
        if t["kind"] == "show":
            seen = set(); e["episodes"] = []
            for s, count in enumerate(t["seasons"]):
                names = []
                for k in range(count):
                    while True:
                        nm = r.choice([f"{r.choice(EP_A)} {r.choice(EP_B)}", f"{r.choice(EP_B)} at {r.choice(EP_C)}", f"The {r.choice(EP_B)} and the {r.choice(EP_B)}"])
                        if nm not in seen and len(set(nm.split())) == len(nm.split()): seen.add(nm); break
                    names.append({"name": nm, "runtime": r.choice([22, 24, 26] if t["genre"] in ("comedy", "kids") else [42, 46, 51, 55, 58])})
                e["episodes"].append(names)
        out.append(e)
    return out

def sheet(paths, cols, cell, labels, out, pad=10, labelh=34):
    rows = (len(paths) + cols - 1) // cols; W = cols * (cell[0] + pad) + pad; H = rows * (cell[1] + pad + labelh) + pad
    s = Image.new("RGB", (W, H), (11, 13, 18)); d = ImageDraw.Draw(s); f = font("josefin", 15)
    for i, p in enumerate(paths):
        x = pad + (i % cols) * (cell[0] + pad); y = pad + (i // cols) * (cell[1] + pad + labelh)
        s.paste(Image.open(p).resize(cell, Image.LANCZOS), (x, y)); d.text((x, y + cell[1] + 6), labels[i][:int(cell[0] / 7.6)], font=f, fill=(232, 236, 242))
    s.save(out, quality=88); print("sheet", out)

def main():
    os.makedirs(OUT, exist_ok=True)
    def want(k): return ONLY in (None, k)
    made = {"poster": [], "backdrop": [], "still": [], "face": [], "album": []}
    for n in range(len(TITLES)):
        if want("poster"): p = os.path.join(OUT, f"poster-{n:02d}.png"); poster(n).save(p); made["poster"].append(p)
        else: _used.add(photo_for(TITLES[n]["genre"], TITLES[n]["title"]))
    for n in range(len(TITLES)):
        if want("backdrop"): p = os.path.join(OUT, f"backdrop-{n:02d}.png"); backdrop(n).save(p); made["backdrop"].append(p)
        if want("still"):
            for k in range(6): p = os.path.join(OUT, f"still-{n:02d}-{k}.png"); still(n, k).save(p); made["still"].append(p)
    if want("face"):
        for i in range(len(PEOPLE)): p = os.path.join(OUT, f"face-{i:02d}.png"); face(i).save(p); made["face"].append(p)
    if want("album"):
        for i in range(16): p = os.path.join(OUT, f"album-{i:02d}.png"); album(i).save(p); made["album"].append(p)
    if ONLY is None:
        with io.open(os.path.join(OUT, "standin.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump({"titles": words(), "people": PEOPLE, "songs": DATA["songs"], "albums": [{"artist": DATA["artists"][i % len(DATA["artists"])], "album": DATA["albums"][(i * 5 + 2) % len(DATA["albums"])]} for i in range(16)]}, f, indent=1)
    print({k: len(v) for k, v in made.items()}, "in", OUT)
    if SHEET:
        os.makedirs(SHEET, exist_ok=True); lab = [f"{n:02d} {t['title']}" for n, t in enumerate(TITLES)]
        if made["poster"]:
            for part in range(0, len(made["poster"]), 16): sheet(made["poster"][part:part + 16], 8, (240, 360), lab[part:part + 16], os.path.join(SHEET, f"posters-{part // 16 + 1}.jpg"))
        if made["backdrop"]:
            for part in range(0, len(made["backdrop"]), 24): sheet(made["backdrop"][part:part + 24], 4, (480, 270), lab[part:part + 24], os.path.join(SHEET, f"backdrops-{part // 24 + 1}.jpg"))
        if made["still"]: sheet(made["still"][:48], 6, (320, 180), [os.path.basename(p)[:-4] for p in made["still"][:48]], os.path.join(SHEET, "stills.jpg"))
        if made["face"]: sheet(made["face"], 10, (180, 270), PEOPLE, os.path.join(SHEET, "faces.jpg"))
        if made["album"]: sheet(made["album"], 8, (240, 240), [DATA["albums"][(i * 5 + 2) % len(DATA["albums"])] for i in range(16)], os.path.join(SHEET, "albums.jpg"))

if __name__ == "__main__": main()
