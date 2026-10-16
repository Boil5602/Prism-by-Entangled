"""
Shrink a pack's pictures for the download (2026-10-15): every picture a Prism shows on a cover ships inside the app (packs are never
fetched at render, concept-scenes section 3), and the curated Museum art and Cosmos came to about 50 MB as the museums and NASA serve them.
Each is re-encoded at most 1920 px wide, JPEG quality 80, progressive - as sharp as a TV shows it - and its pack.json entry's sha256, w and
h are written to match, so the pack gate (verify-imagery-packs.mjs, I4) still holds. Nothing else in the record changes.

    python -P scripts/shrink-pack.py <pack id>      (after node scripts/fetch-pack.mjs <pack id>)
"""
import hashlib, io, json, os, sys
from PIL import Image

MAX_W, QUALITY = 1920, 80
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pack = sys.argv[1]
d = os.path.join(root, "packs", pack)
mp = os.path.join(d, "pack.json")
m = json.load(open(mp, encoding="utf-8"))
before = after = 0
for im in m["images"]:
    f = os.path.join(d, im["file"])
    if not os.path.exists(f):
        continue
    raw = open(f, "rb").read()
    before += len(raw)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if img.width > MAX_W:
        img = img.resize((MAX_W, round(img.height * MAX_W / img.width)), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    data = out.getvalue()
    if len(data) >= len(raw):   # already small: kept as served
        after += len(raw)
        continue
    with open(f, "wb") as fh:
        fh.write(data)
    im["sha256"] = hashlib.sha256(data).hexdigest()
    im["w"], im["h"] = img.width, img.height
    after += len(data)
with open(mp, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
print(f"{pack}: {before / 1048576:.1f} MB -> {after / 1048576:.1f} MB")
