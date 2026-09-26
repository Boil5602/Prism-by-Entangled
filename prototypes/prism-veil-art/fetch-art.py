"""
Fetch CC0 / public-domain nature photos from Wikimedia Commons into pool/ and
regenerate every art list the Veil consumes.

Layout (see README.md here):
  pool/            full-res photos + manifest.json  -> uploaded verbatim to
                   https://prism.entangled.world/veil/art/ (the hosted pool the
                   start page streams from)
  hosted/          GENERATED re-encoded pool + list.json {v, files:[{f, sha256}]} + manifest.json;
                   sign with sign-list.mjs -> list.sig, upload with upload-pool.py
  ../prism-veil-extension/art/      GENERATED bundled subset: BUNDLE_N photos
                   downscaled to BUNDLE_MAX_W px, used for ad covers (which must
                   be extension-local: page CSP + Referer, see extension README)
                   and as the start page's offline fallback
  ../prism-veil-extension/src/art.js  GENERATED list of that bundle

Why Commons + strict license filter: every image the veil shows must trace to a
named source (spec section 5). Commons' API returns per-file license metadata,
so we keep ONLY files whose license is CC0 or public domain (no attribution
required, no strings) and write art/manifest.json with the source page, author
and license for each one.

Usage:  python fetch-art.py            (adds up to TARGET_TOTAL images, then regen)
        python fetch-art.py --regen    (only regenerate lists + bundle from pool/)
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ART_DIR = os.path.join(HERE, "pool")
MANIFEST = os.path.join(ART_DIR, "manifest.json")
EXT_DIR = os.path.normpath(os.path.join(HERE, "..", "prism-veil-extension"))
BUNDLE_DIR = os.path.join(EXT_DIR, "art")
HOSTED_DIR = os.path.join(HERE, "hosted")   # GENERATED re-encoded pool that is uploaded (git-ignored)
HOSTED_MAX_W = 1920
HOSTED_QUALITY = 82
BUNDLE_N = 24          # photos shipped inside the extension (covers only)
BUNDLE_MAX_W = 900     # ad slots top out around 970px wide; covers are small
BUNDLE_QUALITY = 75
API = "https://commons.wikimedia.org/w/api.php"
UA = "PrismVeil-art-fetch/0.1 (PRISM by Entangled, open-source dashboard frames; one-off fetch of ~100 CC0 nature photos; polite: 1 req/s)"

TERMS = [
    "forest", "old growth forest", "mountain landscape", "alpine lake", "waterfall",
    "aurora borealis", "glacier", "canyon", "desert dunes", "ocean coast",
    "river valley", "meadow wildflowers", "autumn foliage", "snow mountains",
    "coral reef", "volcano landscape", "fjord", "rainforest", "sunset beach", "cliffs sea",
    "lake reflection", "ocean waves", "rolling hills", "tundra", "wetland marsh", "prairie grassland",
    "hot springs", "sea stack", "cloud forest", "misty valley", "sand beach dunes", "mountain lake sunrise",
]
PER_TERM = 14
TARGET_TOTAL = 260
MIN_W = 1200
FETCH_W = 1600
OK_LICENSE = re.compile(r"^(cc0|pd|public domain)", re.I)
# titles that are not nature photography even when the search term matches
NOISE = re.compile(r"coast guard|cutter|navy|army|marine|military|soldier|aircraft|helicopter|ship|vessel|"
                   r"boat|vehicle|truck|car|road|bridge|building|city|town|street|people|man|woman|"
                   r"person|portrait|map|diagram|chart|logo|drawing|painting|illustration|screenshot|"
                   r"satellite|nasa|iss|space|flag|sign|text|poster|book|page|scan|tour|hosts|service", re.I)


def api(params):
    params = dict(params, format="json")
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as ex:
            if ex.code == 429 and attempt < 3:
                time.sleep(30 * (attempt + 1)); continue
            raise


def search(term, limit=40):
    # bitmap files, reasonably large; license is checked per file afterwards
    q = f'{term} haslicense:unrestricted filetype:bitmap filemime:image/jpeg fileres:>{MIN_W}'
    data = api({
        "action": "query", "generator": "search", "gsrsearch": q, "gsrnamespace": 6,
        "gsrlimit": limit, "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime",
        "iiurlwidth": FETCH_W, "iiextmetadatafilter": "LicenseShortName|Artist|License",
    })
    pages = (data.get("query") or {}).get("pages") or {}
    out = []
    for p in pages.values():
        ii = (p.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata") or {}
        lic = (md.get("LicenseShortName") or md.get("License") or {}).get("value", "")
        if not OK_LICENSE.search(lic or ""):
            continue
        if ii.get("mime") != "image/jpeg" or (ii.get("width") or 0) < MIN_W:
            continue
        w, h = ii.get("width", 0), ii.get("height", 0)
        if h > w * 1.2:  # skip portrait orientation; covers are mostly landscape
            continue
        if NOISE.search(p["title"]):
            continue
        artist = re.sub(r"<[^>]+>", "", (md.get("Artist") or {}).get("value", "")).strip()
        out.append({
            "title": p["title"], "page": ii.get("descriptionurl"), "thumb": ii.get("thumburl"),
            "author": artist[:120], "license": lic, "w": w, "h": h,
        })
    return out


def load_manifest():
    if os.path.exists(MANIFEST):
        with open(MANIFEST, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"images": []}


def save_manifest(m):
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=1, ensure_ascii=False)


def _licensed_files():
    """Only files with a recorded CC0 / public-domain license ship anywhere
    (spec section 5: every image traceable to a named source). Anything in
    pool/ without a manifest entry is skipped loudly."""
    m = load_manifest()
    lic = {im["file"]: im["license"] for im in m["images"]}
    files = sorted(f for f in os.listdir(ART_DIR) if f.lower().endswith(".jpg"))
    ok = []
    for f in files:
        if f not in lic:
            print("SKIP (no manifest entry):", f); continue
        if not OK_LICENSE.search(lic[f]):
            print("SKIP (license %r):" % lic[f], f); continue
        ok.append(f)
    return ok


BUNDLE_PIN = os.path.join(HERE, "bundle.txt")

def _pick_bundle(files, n):
    """The bundled subset is PINNED in bundle.txt so pool growth never churns
    the extension package. First run (no pin) spreads across the pool and
    writes the pin; edit bundle.txt by hand to change what ships."""
    if os.path.exists(BUNDLE_PIN):
        pinned = [l.strip() for l in open(BUNDLE_PIN, encoding="utf-8") if l.strip() and not l.startswith("#")]
        missing = [f for f in pinned if f not in files]
        if missing:
            print("bundle.txt entries not in the licensed pool (dropped):", missing)
        return [f for f in pinned if f in files]
    if len(files) <= n:
        chosen = list(files)
    else:
        step = len(files) / float(n)
        chosen = [files[int(i * step)] for i in range(n)]
    with open(BUNDLE_PIN, "w", encoding="utf-8", newline=chr(10)) as f:
        f.write("# Photos bundled inside the extension (ad covers + offline fallback). One per line." + chr(10) + chr(10).join(chosen) + chr(10))
    return chosen


def regen_art_list():
    """Write pool/list.json (hosted index), then the extension bundle:
    art/*.jpg (downscaled subset) + src/art.js (its list)."""
    from PIL import Image, ImageOps
    # The pool is self-curated (files we chose and downloaded from Commons /
    # NPS), and each is downscaled right here - so PIL's decompression-bomb
    # cap (~179 MP) is wrong for us: featured panoramas run 300+ MP.
    Image.MAX_IMAGE_PIXELS = None
    files = _licensed_files()
    nl = chr(10)
    # Hosted set: originals re-encoded to HOSTED_MAX_W (wallpaper-sized, ~3x
    # smaller than the 1600px originals = 3x less bandwidth). Re-encoding is
    # deterministic, but only files missing from hosted/ are (re)made so the
    # hashes - and the signed index - stay stable across refreshes.
    os.makedirs(HOSTED_DIR, exist_ok=True)
    for fn in files:
        dst = os.path.join(HOSTED_DIR, fn)
        if os.path.exists(dst):
            continue
        try:
            im = ImageOps.exif_transpose(Image.open(os.path.join(ART_DIR, fn))).convert("RGB")
        except Exception as ex:
            print("  skipped (not an image?):", fn, ex); continue
        if im.width > HOSTED_MAX_W:
            im = im.resize((HOSTED_MAX_W, round(im.height * HOSTED_MAX_W / im.width)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=HOSTED_QUALITY, optimize=True, progressive=True)
    for stale in os.listdir(HOSTED_DIR):
        if stale.lower().endswith(".jpg") and stale not in files:
            os.remove(os.path.join(HOSTED_DIR, stale))
    # Hosted index: filename + sha256 per hosted file. The extension verifies
    # the signature over this file (sign-list.mjs -> list.sig) and each image's
    # hash, so a compromised host cannot substitute a single image.
    import hashlib
    entries = []
    for fn in files:
        with open(os.path.join(HOSTED_DIR, fn), "rb") as fh:
            entries.append({"f": fn, "sha256": hashlib.sha256(fh.read()).hexdigest()})
    with open(os.path.join(HOSTED_DIR, "list.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 1, "files": entries}, f, separators=(",", ":"))
    import shutil; shutil.copy(MANIFEST, os.path.join(HOSTED_DIR, "manifest.json"))
    hsize = sum(os.path.getsize(os.path.join(HOSTED_DIR, x)) for x in os.listdir(HOSTED_DIR))
    print("hosted/: %d photos, %.1f MB" % (len(files), hsize / 1e6))
    print("REMEMBER: node sign-list.mjs && python upload-pool.py")

    os.makedirs(BUNDLE_DIR, exist_ok=True)
    for old in os.listdir(BUNDLE_DIR):
        os.remove(os.path.join(BUNDLE_DIR, old))
    chosen = _pick_bundle(files, BUNDLE_N)
    for fn in chosen:
        try:
            im = ImageOps.exif_transpose(Image.open(os.path.join(ART_DIR, fn))).convert("RGB")
        except Exception as ex:
            print("  skipped (not an image?):", fn, ex); continue
        if im.width > BUNDLE_MAX_W:
            im = im.resize((BUNDLE_MAX_W, round(im.height * BUNDLE_MAX_W / im.width)), Image.LANCZOS)
        im.save(os.path.join(BUNDLE_DIR, fn), "JPEG", quality=BUNDLE_QUALITY, optimize=True, progressive=True)
    paths = ["art/" + fn for fn in chosen]
    body = ("," + nl).join('  "%s"' % p for p in paths)
    header = "/* GENERATED by prism-veil-art/fetch-art.py --regen - do not edit. Bundled nature-only art subset. */" + nl
    with open(os.path.join(EXT_DIR, "src", "art.js"), "w", encoding="utf-8", newline=nl) as f:
        f.write(header + "(function () {" + nl + "  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});" + nl + "  PV.ART_FILES = [" + nl + body + nl + "  ];" + nl + "})();" + nl)
    with open(os.path.join(BUNDLE_DIR, "list.json"), "w", encoding="utf-8") as f:
        json.dump(paths, f, indent=0)
    size = sum(os.path.getsize(os.path.join(BUNDLE_DIR, x)) for x in os.listdir(BUNDLE_DIR))
    print("hosted pool: %d photos; bundle: %d photos, %.1f MB" % (len(files), len(chosen), size / 1e6))
    return len(files)


def main():
    os.makedirs(ART_DIR, exist_ok=True)
    if "--regen" in sys.argv:
        print("ART entries:", regen_art_list()); return
    m = load_manifest()
    have = {im["title"] for im in m["images"]}
    existing = len([f for f in os.listdir(ART_DIR) if f.lower().endswith(".jpg")])
    total = existing
    for term in TERMS:
        if total >= TARGET_TOTAL:
            break
        time.sleep(1.5)
        try:
            cands = search(term)
        except Exception as ex:
            print("search failed", term, ex); continue
        taken = 0
        for c in cands:
            if taken >= PER_TERM or total >= TARGET_TOTAL:
                break
            if c["title"] in have or not c["thumb"]:
                continue
            slug = re.sub(r"[^a-z0-9]+", "_", term.lower()).strip("_")
            fn = "commons_%s_%d.jpg" % (slug, len(m["images"]) + 1)
            try:
                data = None
                for attempt in range(4):
                    req = urllib.request.Request(c["thumb"], headers={"User-Agent": UA})
                    try:
                        with urllib.request.urlopen(req, timeout=120) as r:
                            data = r.read(); break
                    except urllib.error.HTTPError as ex:
                        if ex.code == 429 and attempt < 3: time.sleep(30 * (attempt + 1)); continue
                        raise
                if len(data) < 40_000:
                    continue
                with open(os.path.join(ART_DIR, fn), "wb") as f:
                    f.write(data)
            except Exception as ex:
                print("download failed", c["title"], ex); continue
            m["images"].append({"file": fn, "term": term, "title": c["title"], "source": c["page"],
                                "author": c["author"], "license": c["license"]})
            have.add(c["title"]); taken += 1; total += 1
            print("%3d  %-38s %-14s %s" % (total, fn, c["license"], c["title"][:60]))
            time.sleep(1.0)
        save_manifest(m)
    save_manifest(m)
    print("ART entries:", regen_art_list())


if __name__ == "__main__":
    main()
