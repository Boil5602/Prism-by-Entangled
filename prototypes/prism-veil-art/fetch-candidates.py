"""
Candidate photos for the Veil art pool - pull, license-check, contact sheet,
then accept the ones that are actually majestic.

Two steps, because "majestic" is a taste call no filter makes:

  1. python fetch-candidates.py --commons --nps
       pulls candidates into candidates/ (add --thumbs for local thumbnails;
       the sheet otherwise lazy-loads Commons' own), with the source
       page, author and license of each, and writes candidates/sheet.html -
       open it, click the photos you want, press "Copy accepted", paste into
       candidates/accepted.json - OR python fetch-candidates.py --upload and
       curate in the hosted gallery (https://prism-reports.fly.dev/curate/,
       key in ~/.prism/curate.key): A approve / X reject, saved as you go.
  2. python fetch-candidates.py --accept
       reads the gallery's approvals (or accepted.json with --local) and
       downloads those files at full resolution into pool/ with
       manifest entries (source, author, license, credit), then run
       `python fetch-art.py --regen` and refresh-pool.cmd as usual.

Sources
  --commons   Wikimedia Commons *Featured pictures* of mountains, lakes,
              waterfalls, coasts, forests, volcanoes, islands, caves, bodies
              of water, plus the by-country landscape categories. Featured =
              community-reviewed for quality; almost all are CC BY / CC BY-SA.
  --agencies  US federal agencies' photography on Commons (NPS's NPGallery,
              Featured NPS-unit pictures, USFWS, Forest Service) - public
              domain as US government works, no key needed.
  --space     astronomy / Earth-from-orbit (Hubble, JWST, Apollo, ISS,
              planetary missions) via Commons search; PD only in practice.
  --nps       US National Park Service galleries (developer.nps.gov) for the
              iconic parks in PARKS; public-domain items only (the API states
              the constraint per gallery). Needs an API key: put yours in
              ~/.prism/nps.key (free, instant, developer.nps.gov/get-started);
              without one the shared DEMO_KEY is used, which throttles fast.

License tiers (every candidate carries one; the sheet shows it):
  free         CC0 / public domain - no strings (the pool's original rule)
  attribution  CC BY / CC BY-SA - listed only with --with-attribution; would
               need a credit line (author + license + link) shown by the
               extension. Off by default: the pool is CC0 / PD only.
  rejected     anything else (NC, ND, GFDL-only, unknown) - never listed

Polite: one request per second, a real User-Agent, thumbnails only until
accepted.
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request, html

HERE = os.path.dirname(os.path.abspath(__file__))
CAND = os.path.join(HERE, "candidates")
THUMBS = os.path.join(CAND, "thumbs")
CAND_JSON = os.path.join(CAND, "candidates.json")
ACCEPTED_JSON = os.path.join(CAND, "accepted.json")
SHEET = os.path.join(CAND, "sheet.html")
POOL = os.path.join(HERE, "pool")
# The hosted curation gallery (prism-veil-reports server, /curate/): --upload
# pushes candidates there, --accept reads its approve/reject decisions. The
# key is the CURATE_KEY fly secret, kept in ~/.prism/curate.key (never git).
CURATE_URL = "https://prism-reports.fly.dev/curate/api/"
CURATE_KEY_FILE = os.path.expanduser("~/.prism/curate.key")
MANIFEST = os.path.join(POOL, "manifest.json")
UA = "PrismVeil-art-candidates/0.1 (https://prism.entangled.world; open-source dashboard frames; polite)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
NPS_API = "https://developer.nps.gov/api/v1"
THUMB_W = 640
MIN_W = 1600            # full-res must be at least this wide to be worth hosting
PAUSE = 1.0
# The pool's rule is CC0 / public domain only - no attribution strings, free
# for business use (decided 2026-08-30). CC BY / CC BY-SA candidates are
# listed only with --with-attribution, and would need a credit line shown.
WITH_ATTR = "--with-attribution" in sys.argv

COMMONS_CATEGORIES = [
    "Featured pictures of mountains", "Featured pictures of lakes", "Featured pictures of waterfalls",
    "Featured pictures of coasts", "Featured pictures of forests", "Featured pictures of volcanoes",
    "Featured pictures of islands", "Featured pictures of caves", "Featured pictures of bodies of water",
]
COMMONS_BY_COUNTRY = "Featured pictures of landscapes by country"
# --agencies: US federal agencies' own photography on Commons - public domain
# as US government works (Commons records the license per file, and the same
# CC0/PD filter applies). No API key needed, unlike developer.nps.gov.
AGENCY_CATEGORIES = [
    "Featured pictures of US National Park Service units",
    "Images from the United States Fish and Wildlife Service",
    "Photographs by the United States Forest Service",
]
# NPGallery (NPS's archive) is ~71,000 files, mostly documents and history:
# searched by scenery terms inside the category instead of scanned.
NPGALLERY_TERMS = ["mountain", "canyon", "glacier", "lake", "sunrise", "sunset", "valley", "waterfall",
                   "alpine", "aurora", "panorama", "vista", "peak", "ridge", "desert", "dunes", "coast",
                   "storm", "snow", "river", "forest", "meadow", "volcano", "geyser", "cliff"]
MAX_SCAN = 6000          # files scanned per category
MAX_SEARCH = 300         # files per search term
# --space: astronomy / Earth-from-orbit photography. The same CC0/PD filter
# applies; in practice that keeps NASA / Hubble (NASA side) / JWST / Apollo
# material (US government works) and drops contributor astrophotography
# (mostly CC BY-SA) and ESA/ESO (CC BY). Its own noise filter: diagrams,
# artist's concepts, hardware, crew portraits are not sky.
SPACE_SEARCHES = [
    "nebula hubble", "nebula webb", "galaxy hubble", "galaxy webb", "carina nebula", "orion nebula",
    "pillars of creation", "andromeda galaxy", "star cluster hubble", "supernova remnant",
    "earth from the international space station", "earthrise", "moon surface apollo", "apollo lunar landscape",
    "jupiter juno", "saturn cassini", "mars surface curiosity", "mars perseverance landscape",
    "solar prominence", "sun sdo", "aurora from space", "comet neowise", "total solar eclipse corona",
]
SPACE_NOISE = re.compile(r"diagram|chart|map|annotated|label|artist|concept|illustration|render|"
                         r"logo|insignia|patch|crew|astronaut|portrait|suit|training|launch|liftoff|"
                         r"rocket|pad|assembly|cleanroom|clean room|facility|building|mirror|instrument|"
                         r"hardware|model|mockup|replica|stamp|poster|cover|screenshot", re.I)
PARKS = ["yose", "grca", "zion", "glac", "dena", "yell", "grte", "olym", "arch", "crla", "mora", "romo",
         "jotr", "havo", "acad", "brca", "cany", "noca", "seki", "kefj", "glba", "redw", "badl", "deva", "bibe"]
NPS_TERMS = ["landscape", "sunrise", "sunset", "mountain", "valley", "canyon", "glacier", "lake", "waterfall", "coast"]

FREE = re.compile(r"^(cc0|pd|public domain)", re.I)
ATTR = re.compile(r"^cc[ -]by(-sa)?[ -]?[0-9.]*( [a-z]+)?$", re.I)
NOISE = re.compile(r"map|diagram|panorama of (the )?city|building|church|castle|bridge|road|train|ship|boat|"
                   r"aircraft|people|portrait|painting|drawing|illustration|satellite|statue|monument|"
                   r"town|village|street|harbour|harbor|port |farm|garden|"
                   r"scan|document|letter|report|plan|poster|brochure|sketch|sign|ranger|visitor|"
                   r"exhibit|museum|historic|house|cabin|fort|cemetery|memorial|battle|"
                   r"interior|room|office|school|hotel|mission|ruins?|archaeolog|artifact|"
                   r"fish(ing|es)? |bird(s)? |duck|goose|eagle|deer|elk|bear|bison|moose|wolf|"
                   r"seal|whale|owl|hawk|crane|turtle|frog|snake|insect|butterfly|flower|plant|"
                   r"tree(s)? (planting|nursery)|logging|crew|staff|worker|meeting|ceremony|"
                   r"aerial view of|highway|parking|campground|trail(head)? sign", re.I)


def get(url, headers=None, binary=False, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=dict({"User-Agent": UA}, **(headers or {})))
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            time.sleep(PAUSE)
            return data if binary else json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 20 * (i + 1); print("  429 - waiting", wait, "s"); time.sleep(wait); continue
            raise
    raise RuntimeError("gave up: " + url)


def tier_for(lic):
    lic = (lic or "").strip()
    if FREE.search(lic): return "free"
    if ATTR.search(lic): return "attribution"
    return "rejected"


def load_json(p, default):
    try:
        with open(p, encoding="utf-8") as f: return json.load(f)
    except Exception: return default


def save_json(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: json.dump(d, f, indent=1, ensure_ascii=False)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:60]


# ------------------------------------------------------------------ Commons
def commons_api(params):
    params = dict(params, format="json")
    return get(COMMONS_API + "?" + urllib.parse.urlencode(params))


def commons_category_files(cat):
    """All files in a category (paged, up to MAX_SCAN)."""
    out, cont = [], {}
    while len(out) < MAX_SCAN:
        d = commons_api(dict({"action": "query", "generator": "categorymembers", "gcmtitle": "Category:" + cat,
                              "gcmtype": "file", "gcmlimit": "50", "prop": "imageinfo",
                              "iiprop": "url|size|extmetadata", "iiurlwidth": str(THUMB_W),
                              "iiextmetadatafilter": "LicenseShortName|Artist|ImageDescription|Credit"}, **cont))
        for p in d.get("query", {}).get("pages", {}).values():
            ii = (p.get("imageinfo") or [None])[0]
            if not ii: continue
            em = ii.get("extmetadata", {})
            out.append({
                "id": "commons:" + p["title"],
                "source": cat,
                "title": p["title"].replace("File:", ""),
                "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_")),
                "author": re.sub(r"<[^>]+>", "", em.get("Artist", {}).get("value", "")).strip()[:80],
                "license": em.get("LicenseShortName", {}).get("value", ""),
                "width": ii.get("width", 0), "height": ii.get("height", 0),
                "thumb": ii.get("thumburl"), "full": ii.get("url"),
            })
        if "continue" in d: cont = d["continue"]
        else: break
    return out


def commons_search_files(query, cat_label):
    """Files matching a Commons search (paged, up to MAX_SEARCH)."""
    out, offset = [], 0
    while len(out) < MAX_SEARCH:
        d = commons_api({"action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": "6",
                         "gsrlimit": "50", "gsroffset": str(offset), "prop": "imageinfo",
                         "iiprop": "url|size|extmetadata", "iiurlwidth": str(THUMB_W),
                         "iiextmetadatafilter": "LicenseShortName|Artist|ImageDescription|Credit"})
        pages = d.get("query", {}).get("pages", {})
        for p in pages.values():
            ii = (p.get("imageinfo") or [None])[0]
            if not ii: continue
            em = ii.get("extmetadata", {})
            out.append({
                "id": "commons:" + p["title"], "source": cat_label, "title": p["title"].replace("File:", ""),
                "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_")),
                "author": re.sub(r"<[^>]+>", "", em.get("Artist", {}).get("value", "")).strip()[:80],
                "license": em.get("LicenseShortName", {}).get("value", ""),
                "width": ii.get("width", 0), "height": ii.get("height", 0),
                "thumb": ii.get("thumburl"), "full": ii.get("url"),
            })
        if "continue" in d: offset = int(d["continue"].get("gsroffset", offset + 50))
        else: break
    return out


def _filter(files, seen, out):
    kept = 0
    for f in files:
        if f["id"] in seen: continue
        seen.add(f["id"])
        f["tier"] = tier_for(f["license"])
        if f["tier"] == "rejected": continue
        if f["tier"] == "attribution" and not WITH_ATTR: continue
        if f["width"] < MIN_W or f["width"] < f["height"]: continue
        if NOISE.search(f["title"]): continue
        out.append(f); kept += 1
    return kept


def space_candidates():
    seen, out = [], []
    seen = set()
    for q in SPACE_SEARCHES:
        try: files = commons_search_files(q, "Space (" + q + ")")
        except Exception as ex: print("  space search failed", q, ex); continue
        kept = 0
        for f in files:
            if f["id"] in seen: continue
            seen.add(f["id"])
            f["tier"] = tier_for(f["license"])
            if f["tier"] == "rejected": continue
            if f["tier"] == "attribution" and not WITH_ATTR: continue
            if not re.search(r"\.(jpe?g|png|tiff?)$", f["title"], re.I): continue
            if f["width"] < MIN_W: continue                    # no orientation gate: tall nebulae are fine
            if SPACE_NOISE.search(f["title"]): continue
            out.append(f); kept += 1
        print(f"  {q}: {len(files)} files, {kept} candidates", flush=True)
    return out


def npgallery_candidates():
    seen, out = set(), []
    for term in NPGALLERY_TERMS:
        try: files = commons_search_files('incategory:"Images from NPGallery" ' + term, "NPS - NPGallery (" + term + ")")
        except Exception as ex: print("  search failed", term, ex); continue
        kept = _filter(files, seen, out)
        print(f"  NPGallery {term}: {len(files)} files, {kept} candidates", flush=True)
    return out


def commons_candidates(cats=None, label="Wikimedia Commons"):
    if cats is not None:
        return _commons_from(cats, label)
    cats = list(COMMONS_CATEGORIES)
    try:
        d = commons_api({"action": "query", "list": "categorymembers", "cmtitle": "Category:" + COMMONS_BY_COUNTRY, "cmtype": "subcat", "cmlimit": "500"})
        cats += [m["title"].replace("Category:", "") for m in d["query"]["categorymembers"]]
    except Exception as ex:
        print("by-country listing failed:", ex)
    return _commons_from(cats, label)


def _commons_from(cats, label):
    seen, out = set(), []
    for cat in cats:
        try: files = commons_category_files(cat)
        except Exception as ex: print("category failed", cat, ex); continue
        kept = 0
        for f in files:
            if f["id"] in seen: continue
            seen.add(f["id"])
            f["tier"] = tier_for(f["license"])
            if f["tier"] == "rejected": continue
            if f["tier"] == "attribution" and not WITH_ATTR: continue   # pool rule: CC0 / public domain only
            if not re.search(r"\.(jpe?g|png|tiff?)$", f["title"], re.I): continue   # images only: Commons search also returns .webm video etc.
            if f["width"] < MIN_W or f["width"] < f["height"]: continue     # landscape orientation, real size
            if NOISE.search(f["title"]): continue
            out.append(f); kept += 1
        print(f"  {cat}: {len(files)} files, {kept} candidates")
    return out


# ---------------------------------------------------------------------- NPS
def nps_key():
    p = os.path.expanduser("~/.prism/nps.key")
    try:
        with open(p) as f: k = f.read().strip()
        if k: return k
    except Exception: pass
    print("  (no ~/.prism/nps.key - using DEMO_KEY, which throttles after a few calls)")
    return "DEMO_KEY"


def nps_candidates():
    key = nps_key()
    out, seen = [], set()
    for park in PARKS:
        for term in NPS_TERMS:
            try:
                d = get(f"{NPS_API}/multimedia/galleries?parkCode={park}&q={urllib.parse.quote(term)}&limit=20&api_key={key}")
            except Exception as ex:
                print("  nps failed", park, term, ex); continue
            for g in d.get("data", []):
                ci = g.get("constraintsInfo") or {}
                if str(ci.get("constraint", "")).lower() != "public domain": continue
                for im in (g.get("images") or []):
                    url = im.get("url"); tid = "nps:" + str(url)
                    if not url or tid in seen: continue
                    seen.add(tid)
                    out.append({
                        "id": tid, "source": "National Park Service - " + (g.get("relatedParks") or [{}])[0].get("fullName", park),
                        "title": (im.get("title") or g.get("title") or "")[:100], "page": g.get("url"),
                        "author": (im.get("credit") or "NPS")[:80], "license": "Public domain (NPS)", "tier": "free",
                        "width": 0, "height": 0, "thumb": url, "full": url,
                    })
        print(f"  {park}: {len(out)} so far")
    return out


# --------------------------------------------------------------- the sheet
def write_sheet(cands):
    cards = []
    for c in cands:
        t = os.path.join("thumbs", c["thumbfile"]) if c.get("thumbfile") else c["thumb"]
        badge = {"free": "CC0 / PD", "attribution": c["license"]}.get(c["tier"], c["license"])
        cards.append(
            f'<figure data-id="{html.escape(c["id"])}" data-src="{html.escape(c["source"])}" class="{c["tier"]}"><img loading="lazy" src="{html.escape(t)}">'
            f'<figcaption><span class="lic {c["tier"]}">{html.escape(badge)}</span> {html.escape(c["title"][:70])}'
            f'<small>{html.escape(c["author"] or "")} &middot; {c["width"]}x{c["height"]} &middot; <a href="{html.escape(c["page"] or "#")}" target="_blank">source</a></small></figcaption></figure>')
    page = f"""<!doctype html><meta charset="utf-8"><title>Veil art candidates</title>
<style>
body{{margin:0;background:#14171C;color:#F2F4F7;font:13px/1.4 system-ui,sans-serif}}
header{{position:sticky;top:0;background:#0F1216;border-bottom:1px solid #3A4250;padding:10px 16px;display:flex;gap:14px;align-items:center;z-index:2}}
header b{{color:#fff}} button{{background:#2A2F38;color:#F2F4F7;border:1px solid #3A4250;border-radius:8px;padding:6px 12px;font:600 12px system-ui;cursor:pointer}}
label{{display:flex;gap:4px;align-items:center}}
main{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;padding:14px}}
figure{{margin:0;background:#1E232B;border:2px solid transparent;border-radius:10px;overflow:hidden;cursor:pointer}}
figure.on{{border-color:#3fb950}} figure img{{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;background:#000}}
figcaption{{padding:8px 10px}} figcaption small{{display:block;color:#C0C8D2;margin-top:3px}} a{{color:#C0C8D2}}
.lic{{font:600 10px system-ui;padding:1px 6px;border-radius:6px;margin-right:6px;background:#2A2F38}} .lic.free{{color:#3fb950}} .lic.attribution{{color:#d29922}}
body.hideattr figure.attribution{{display:none}}
textarea{{width:100%;height:120px;background:#0F1216;color:#F2F4F7;border:1px solid #3A4250;margin:0 14px 14px;width:calc(100% - 28px)}}
</style>
<header><b id="total">{len(cands)} candidates</b><span id="n">0 accepted</span>
<select id="src"><option value="">all sources</option>{''.join(f'<option value="{html.escape(s)}">{html.escape(s)} ({c})</option>' for s, c in sorted(__import__("collections").Counter(c["source"] for c in cands).items()))}</select>
<label><input type="checkbox" id="onlyfree"> CC0 / public domain only</label>
<button id="copy">Copy accepted</button><button id="clear">Clear</button><span style="color:#C0C8D2">Click a photo to accept it. Paste the copied list into candidates/accepted.json, then run fetch-candidates.py --accept</span></header>
<main>{''.join(cards)}</main>
<textarea id="out" readonly placeholder="accepted ids appear here"></textarea>
<script>
const K='prism-art-accepted', sel=new Set(JSON.parse(localStorage.getItem(K)||'[]'));
const figs=[...document.querySelectorAll('figure')], n=document.getElementById('n'), out=document.getElementById('out');
function paint(){{figs.forEach(f=>f.classList.toggle('on',sel.has(f.dataset.id)));n.textContent=sel.size+' accepted';out.value=JSON.stringify([...sel],null,1);localStorage.setItem(K,JSON.stringify([...sel]));}}
figs.forEach(f=>f.addEventListener('click',e=>{{if(e.target.tagName==='A')return;const id=f.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);paint();}}));
document.getElementById('copy').onclick=()=>{{navigator.clipboard.writeText(out.value);}};
document.getElementById('clear').onclick=()=>{{sel.clear();paint();}};
document.getElementById('onlyfree').onchange=e=>document.body.classList.toggle('hideattr',e.target.checked);
document.getElementById('src').onchange=e=>{{const v=e.target.value;let k=0;figs.forEach(f=>{{const show=!v||f.dataset.src===v;f.style.display=show?'':'none';if(show)k++;}});document.getElementById('total').textContent=k+' candidates';}};
paint();
</script>"""
    with open(SHEET, "w", encoding="utf-8") as f: f.write(page)


def fetch_thumbs(cands):
    """Thumbnails in parallel (4 at a time, no pause: Commons renders a 640px
    thumb of a 50-megapixel featured picture slowly, and one-at-a-time took
    ~10 s each). A thumb already on disk is kept."""
    import concurrent.futures
    os.makedirs(THUMBS, exist_ok=True)
    todo = []
    for c in cands:
        name = slug(c["id"]) + ".jpg"
        if os.path.exists(os.path.join(THUMBS, name)): c["thumbfile"] = name; continue
        if c.get("thumb"): todo.append((c, name))
    def one(item):
        c, name = item
        try:
            req = urllib.request.Request(c["thumb"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r: data = r.read()
            with open(os.path.join(THUMBS, name), "wb") as f: f.write(data)
            c["thumbfile"] = name
            time.sleep(0.5)
        except urllib.error.HTTPError as ex:
            if ex.code == 429: time.sleep(30)   # Wikimedia robot policy: back off, the sheet falls back to the remote thumb
            print("  thumb failed", c["id"][:60], ex.code, flush=True)
        except Exception as ex:
            print("  thumb failed", c["id"][:60], ex, flush=True)
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        for _ in ex.map(one, todo):
            done += 1
            if done % 25 == 0: print(f"  thumbs {done}/{len(todo)}", flush=True)


# --------------------------------------------------------------- curation
def curate_key():
    try:
        with open(CURATE_KEY_FILE) as f: return f.read().strip()
    except Exception: return ""


def curate_call(path, body=None):
    key = curate_key()
    if not key: raise RuntimeError("no " + CURATE_KEY_FILE)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(CURATE_URL + path, data=data, method="POST" if data else "GET",
                                 headers={"User-Agent": UA, "x-curate-key": key, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r: return json.loads(r.read().decode("utf-8"))


def upload():
    """Push the candidate list to the hosted gallery (slim: what the page shows)."""
    cands = load_json(CAND_JSON, [])
    slim = [{k: c.get(k) for k in ("id", "source", "title", "page", "author", "license", "tier", "width", "height", "thumb", "full")} for c in cands]
    r = curate_call("candidates", slim)
    print("uploaded", r.get("n"), "candidates to", CURATE_URL.replace("api/", ""))


def decisions():
    """{id: 'a'|'r'} from the hosted gallery."""
    d = curate_call("decisions")
    return {k: v.get("d") for k, v in d.items() if isinstance(v, dict)}


# ---------------------------------------------------------------- accept
def accept():
    cands = {c["id"]: c for c in load_json(CAND_JSON, [])}
    ids = load_json(ACCEPTED_JSON, [])
    if "--local" not in sys.argv:
        try:
            dec = decisions(); ids = [i for i, d in dec.items() if d == "a"]
            print(f"gallery: {len(ids)} approved, {sum(1 for d in dec.values() if d == 'r')} rejected")
        except Exception as ex:
            print("gallery unreachable (", ex, ") - using candidates/accepted.json")
    if not ids: print("nothing approved yet (gallery) and candidates/accepted.json is empty"); return
    man = load_json(MANIFEST, {"images": []})
    have = {im.get("source") for im in man["images"]}
    os.makedirs(POOL, exist_ok=True)
    n = 0
    for cid in ids:
        c = cands.get(cid)
        if not c: print("  unknown id", cid); continue
        if c["page"] in have: print("  already in pool:", c["title"][:50]); continue
        base = ("nps_" if cid.startswith("nps:") else "commons_") + slug(c["title"])[:50] + ".jpg"
        dest = os.path.join(POOL, base)
        try:
            data = get(c["full"], binary=True)
            with open(dest, "wb") as f: f.write(data)
        except Exception as ex:
            print("  download failed", c["title"][:50], ex); continue
        credit = "" if c["tier"] == "free" else f'{c["author"]} / Wikimedia Commons, {c["license"]}'
        man["images"].append({"file": base, "term": "featured", "title": c["title"], "source": c["page"],
                              "author": c["author"], "license": c["license"], "credit": credit})
        print("  added", base, "-", c["license"])
        n += 1
    save_json(MANIFEST, man)
    print(f"{n} added to pool/. Next: python fetch-art.py --regen, then refresh-pool.cmd")


def main():
    if "--accept" in sys.argv: return accept()
    if "--upload" in sys.argv: return upload()
    cands = [c for c in load_json(CAND_JSON, []) if c.get("tier") == "free" or WITH_ATTR]
    known = {c["id"] for c in cands}
    if "--commons" in sys.argv:
        print("Commons featured pictures:")
        for c in commons_candidates():
            if c["id"] not in known: cands.append(c); known.add(c["id"])
    if "--agencies" in sys.argv:
        print("US agencies on Commons (NPS, USFWS, Forest Service):")
        for c in commons_candidates(AGENCY_CATEGORIES, "US agency") + npgallery_candidates():
            if c["id"] not in known: cands.append(c); known.add(c["id"])
    if "--space" in sys.argv:
        print("Space (Commons, PD only):")
        for c in space_candidates():
            if c["id"] not in known: cands.append(c); known.add(c["id"])
    if "--nps" in sys.argv:
        print("National Park Service:")
        for c in nps_candidates():
            if c["id"] not in known: cands.append(c); known.add(c["id"])
    if not cands: print(__doc__); return
    try:
        rej = {i for i, d in decisions().items() if d == "r"}
        if rej: n0 = len(cands); cands = [c for c in cands if c["id"] not in rej]; print(f"dropped {n0 - len(cands)} rejected in the gallery")
    except Exception: pass
    save_json(CAND_JSON, cands)
    if "--thumbs" in sys.argv:            # local thumbnails are optional: the sheet lazy-loads Commons' own
        print("fetching thumbnails...")
        fetch_thumbs(cands)
        save_json(CAND_JSON, cands)
    write_sheet(cands)
    free = sum(1 for c in cands if c["tier"] == "free")
    print(f"{len(cands)} candidates ({free} CC0/PD, {len(cands) - free} attribution) -> {SHEET}")


if __name__ == "__main__":
    main()
