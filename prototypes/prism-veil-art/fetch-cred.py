"""Build the second and third source-reliability lists (spec section 5,
"Credibility labeling": label, never censor) next to Wikipedia's RSP list
(fetch-rsp.py -> hosted-cred/list.json):

  hosted-cred/iffy.json  Iffy Index (iffy.news, Barrett Golding; CC BY 4.0).
                         ~2,000 sites that Media Bias/Fact Check rates LOW
                         credibility. The disk colour follows MBFC's factual-
                         reporting rating on the sheet: VL/L red, M yellow,
                         MF/H green (a handful). Every entry links to its MBFC
                         review, which carries the written rationale.
  hosted-cred/sb.json    Steven Black "fakenews" hosts extension (MIT).
                         A plain domain list - a site is on it or it isn't, so
                         the disk is red when listed and grey otherwise; the
                         "why" can only be the list itself.

Both are one signed file each (`node sign-list.mjs hosted-cred iffy|sb`) and
upload with `python upload-pool.py --cred`. One request per source, polite UA.

Output schema (shared with the extension, src/marks.js):
  {v:1, source:{id,name,url,license,fetched}, legend:{status:label},
   scale:{status: "r"|"y"|"g"}, entries:[{id,name,status,domains:[...],why}]}
"""
import csv, io, json, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "hosted-cred")
UA = "PrismVeil-cred-fetch/0.1 (PRISM by Entangled, open-source dashboard frames; one request per list; info@entangled.world)"

IFFY_CSV = "https://docs.google.com/spreadsheets/d/1ck1_FZC-97uDLIlvRJDTrGqBk0FuDe9yHkluROgpGS8/gviz/tq?tqx=out:csv&sheet=Iffy-news"
SB_HOSTS = "https://raw.githubusercontent.com/StevenBlack/hosts/master/extensions/fakenews/hosts"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def today():
    return time.strftime("%Y-%m-%d")


def write(name, doc):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print("%s: %d entries -> %s" % (name, len(doc["entries"]), path))


def iffy():
    rows = list(csv.DictReader(io.StringIO(get(IFFY_CSV))))
    # MBFC factual-reporting rating -> our tier. Everything on the Iffy Index is
    # LOW credibility per MBFC; the factual rating adds the gradient.
    FACT = {"VL": ("vl", "Very low factual reporting", "r"), "L": ("l", "Low factual reporting", "r"),
            "M": ("m", "Mixed factual reporting", "y"), "MF": ("mf", "Mostly factual reporting", "g"),
            "H": ("h", "High factual reporting", "g"), "VH": ("vh", "Very high factual reporting", "g")}
    entries, seen = [], set()
    for r in rows:
        dom = (r.get("Domain") or "").strip().lower()
        if not dom or dom in seen: continue
        seen.add(dom)
        f = FACT.get((r.get("MBFC Fact") or "").strip().upper(), ("l", "Low factual reporting", "r"))
        entries.append({"id": dom, "name": (r.get("Name") or dom).strip(), "status": f[0], "domains": [dom],
                        "why": (r.get("Media Bias/Fact Check") or "").strip() or "https://iffy.news/index/"})
    legend = {k[0]: k[1] for k in FACT.values()}
    scale = {k[0]: k[2] for k in FACT.values()}
    write("iffy", {"v": 1,
                   "source": {"id": "iffy", "name": "Iffy Index (via Media Bias/Fact Check)", "url": "https://iffy.news/index/",
                              "license": "CC BY 4.0", "fetched": today()},
                   "legend": legend, "scale": scale, "entries": entries})


def sb():
    doms = []
    for line in get(SB_HOSTS).splitlines():
        m = re.match(r"^0\.0\.0\.0\s+([a-z0-9.-]+)\s*$", line.strip().lower())
        if m and m.group(1) != "0.0.0.0": doms.append(m.group(1))
    doms = sorted(set(doms))
    entries = [{"id": d, "name": d, "status": "listed", "domains": [d],
                "why": "https://github.com/StevenBlack/hosts/blob/master/extensions/fakenews/readme.md"} for d in doms]
    write("sb", {"v": 1,
                 "source": {"id": "sb", "name": "Steven Black hosts - fakenews extension", "url": "https://github.com/StevenBlack/hosts",
                            "license": "MIT", "fetched": today()},
                 "legend": {"listed": "On the fakenews hosts list"}, "scale": {"listed": "r"}, "entries": entries})


if __name__ == "__main__":
    which = sys.argv[1:] or ["iffy", "sb"]
    if "iffy" in which: iffy()
    if "sb" in which: sb()
