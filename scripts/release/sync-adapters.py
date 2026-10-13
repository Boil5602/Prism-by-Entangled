"""The built-in services, said in one place and copied to the two that name them (2026-10-11, "Should we mention all built in adapters
so far?" - 3: the website's Adapters page, after its legal review, with the full list, synced from the catalog like the tour).

The source is prism-adapters/catalog/<id>.json (the service's name) with adapters/<id>.json (what Prism reads from it). Written:
  - the tour's Add your services page: one point, "Built in today: ...", in targets/win-host/PrismHost/Assets/tutorial/tutorial.json
    (Prism and the website's tour page both read that file; sync-tutorial.py carries it to the website)
  - the website's Adapters page data: src/data/adapters.json in the website's repository, one card a service, plain names only.
    The page shows them only once site.config's adaptersLive is switched on, after the review (docs/LEGAL-REVIEW.md there).

    python scripts/release/sync-adapters.py                     write the tour's line (and say what changed)
    python scripts/release/sync-adapters.py --site <folder>     ... and the website's adapters.json
    python scripts/release/sync-adapters.py --site <folder> --check   exit 1 when either copy is out of date (scripts/verify.mjs)

First-party tiles (prism-*) and the example are not services and are left out. So are the dashboard-era page adapters with no player
(Weather, NPR, Google Calendar, YouTube: a selector table for framing a page, from before the two players, which Set up services does
not offer): "We don't have a weather adapter yet, right??" (2026-10-11). Only what Set up services offers is listed.
"""
import argparse, glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
CATALOG = os.path.join(REPO, "prism-adapters", "catalog")
ADAPTERS = os.path.join(REPO, "prism-adapters", "adapters")
TOUR = os.path.join(REPO, "targets", "win-host", "PrismHost", "Assets", "tutorial", "tutorial.json")
LEAD = "Built in today: "

ap = argparse.ArgumentParser()
ap.add_argument("--site")
ap.add_argument("--check", action="store_true")
a = ap.parse_args()


def services():
    out = []
    for p in sorted(glob.glob(os.path.join(CATALOG, "*.json"))):
        cid = os.path.basename(p)[:-5]
        if cid.startswith("_") or cid.startswith("prism-"):
            continue
        c = json.load(open(p, encoding="utf-8"))
        ad = {}
        ap_ = os.path.join(ADAPTERS, (c.get("adapter") or cid) + ".json")
        if os.path.exists(ap_):
            ad = json.load(open(ap_, encoding="utf-8"))
        keys = set(ad)
        kind = "video" if any(k.startswith("video") for k in keys) else "music" if any(k.startswith("music") for k in keys) or cid in ("amazon-music", "apple-music", "pandora", "spotify") else "other"
        brings = []
        if "videoLibrary" in keys: brings.append("Continue watching and My List")
        if "videoOwnedUrls" in keys: brings.append("your purchases")
        if "videoLive" in keys: brings.append("live channels")
        if "videoSearch" in keys or "videoSearchUrl" in keys: brings.append("search")
        if kind == "music": brings.append("your music, with play controls on the Prism screen and your phone" + (", and your playlists and stations by name" if "musicPlay" in keys else ""))
        if not brings: brings.append("its page on the Prism screen")
        if kind == "other": continue
        out.append({"id": cid, "name": c.get("name") or cid, "kind": kind, "brings": ", ".join(brings)})
    return out


def tour_line(svcs):
    def names(kind): return ", ".join(s["name"] for s in svcs if s["kind"] == kind)
    return LEAD + "video from " + names("video") + ". Music from " + names("music") + "."


def write_tour(line):
    raw = open(TOUR, "rb").read()
    doc = json.loads(raw.decode("utf-8"))
    page = next(p for s in doc["subjects"] if s["id"] == "start" for p in s["pages"] if p["picture"] == "start-services")
    pts = [p for p in page["points"] if not p.startswith(LEAD)]
    had = next((p for p in page["points"] if p.startswith(LEAD)), None)
    page["points"] = pts + [line]
    if had == line:
        return False
    text = json.dumps(doc, indent=2, ensure_ascii=True) + "\n"
    if any(ord(ch) > 127 for ch in text):
        sys.exit("the tour's file would hold a character outside ASCII")
    open(TOUR, "w", encoding="ascii", newline="\n").write(text)
    return True


def site_doc(svcs):
    return {
        "_comment": "Adapter cards for the Adapters page, written by scripts/release/sync-adapters.py in the Prism repo from its catalog: do not edit here. Only used when site.adaptersLive is true in src/site.config.ts (after the review in docs/LEGAL-REVIEW.md). status is 'ready' or 'soon'. Plain-text names only, no logos.",
        "adapters": [{"name": s["name"], "brings": s["brings"], "status": "ready"} for s in svcs],
    }


svcs = services()
line = tour_line(svcs)
print("%d built-in services: %d video, %d music, %d other" % (len(svcs), *(sum(1 for s in svcs if s["kind"] == k) for k in ("video", "music", "other"))))

if a.check:
    doc = json.load(open(TOUR, encoding="utf-8"))
    page = next(p for s in doc["subjects"] if s["id"] == "start" for p in s["pages"] if p["picture"] == "start-services")
    stale = []
    if line not in page["points"]:
        stale.append("the tour's Built in today line")
    if a.site and os.path.isdir(os.path.join(a.site, "src")):
        sp = os.path.join(a.site, "src", "data", "adapters.json")
        try:
            have = json.load(open(sp, encoding="utf-8")).get("adapters")
        except Exception:
            have = None
        if have != site_doc(svcs)["adapters"]:
            stale.append("the website's src/data/adapters.json")
    if stale:
        print("out of date: " + " and ".join(stale) + ". Run: python scripts/release/sync-adapters.py" + (" --site " + a.site if a.site else ""))
        sys.exit(1)
    print("the built-in services are said the same everywhere")
    sys.exit(0)

changed = write_tour(line)
print(("tour updated: " if changed else "tour already current: ") + line)
if a.site:
    sp = os.path.join(a.site, "src", "data", "adapters.json")
    os.makedirs(os.path.dirname(sp), exist_ok=True)
    open(sp, "w", encoding="utf-8", newline="\n").write(json.dumps(site_doc(svcs), indent=2, ensure_ascii=False) + "\n")
    print("website adapters.json written: %d cards (shown once adaptersLive is on)" % len(svcs))
