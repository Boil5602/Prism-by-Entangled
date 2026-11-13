"""Every made-up title of titles.json searched on TMDB: a title that is a real film's or show's must be replaced (2026-11-11).

    python -I scripts/standin/check-titles.py

Uses the TMDB key this PC's PRISM already holds (read from the store, never printed). A match is a film or show whose title or
original title is the same words (case, punctuation and a leading article aside). Exit 1 when any title matches.
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
store = json.load(io.open(os.path.join(os.environ["LOCALAPPDATA"], "Prism", "store.json"), encoding="utf-8"))["data"]
key = store.get("lens:tmdb:key:wall")
if isinstance(key, dict): key = key.get("key") or key.get("value")
if not key: sys.exit("no TMDB key in this PC's store")
key = str(key).strip().strip('"')
def norm(s): return re.sub(r"^(the|a|an) ", "", re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip())
def search(q):
    url = "https://api.themoviedb.org/3/search/multi?include_adult=false&query=" + urllib.parse.quote(q)
    h = {"Accept": "application/json", "User-Agent": "standin-check"}
    if len(key) > 40: h["Authorization"] = "Bearer " + key
    else: url += "&api_key=" + key
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r: return json.load(r).get("results", [])
bad = 0
for t in json.load(io.open(os.path.join(HERE, "titles.json"), encoding="utf-8"))["titles"]:
    hits = [x for x in search(t["title"]) if x.get("media_type") in ("movie", "tv") and norm(t["title"]) in {norm(x.get(k)) for k in ("title", "name", "original_title", "original_name")}]
    if hits: bad += 1; print("MATCH", t["title"], "->", [(x.get("media_type"), (x.get("release_date") or x.get("first_air_date") or "")[:4]) for x in hits][:3])
    time.sleep(0.05)
print("checked; matches:", bad)
sys.exit(1 if bad else 0)
