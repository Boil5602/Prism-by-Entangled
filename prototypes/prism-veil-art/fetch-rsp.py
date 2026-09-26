"""Build the source-reliability list from Wikipedia's Perennial Sources page.

Why this source (spec section 5, dashboard-schema "Credibility labeling"): it is
public (every status links to the RfC that decided it), community-engineered
(thousands of editors, adversarial process, published methodology) and
CC BY-SA 4.0, so the derived list can itself be published. It is ordinal, not
numeric, and we keep it that way - no invented precision.

Output: hosted-cred/list.json  {v, source:{...}, entries:[{id, name, status,
tier, last, domains:[...]}]}  - sign with `node sign-list.mjs hosted-cred`,
upload with `python upload-pool.py --cred`.

Tiers (Wikipedia's own legend + colours):
  1 gr  generally reliable        green
  2 nc  no consensus / caveats    amber
  3 gu  generally unreliable      red
  4 d   deprecated                dark red
  5 b   blacklisted               black
  m     mixed (several statuses)  amber
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from html import unescape

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "hosted-cred")
PAGE = "Wikipedia:Reliable sources/Perennial sources"
API = "https://en.wikipedia.org/w/api.php"
UA = "PrismVeil-rsp-fetch/0.1 (PRISM by Entangled, open-source dashboard frames; one request; info@entangled.world)"
STATUS = {"s-gr": ("gr", 1), "s-nc": ("nc", 2), "s-gu": ("gu", 3), "s-d": ("d", 4), "s-b": ("b", 5), "s-m": ("m", 2)}


def api(params):
    for attempt in range(4):
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if "parse" in data:
                return data
            print("api returned", str(data)[:120])
        except Exception as ex:
            print("api error", ex)
        time.sleep(5 * (attempt + 1))
    sys.exit("could not fetch " + PAGE)


def strip(html):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", html))).strip()


def main():
    data = api({"action": "parse", "page": PAGE, "prop": "text|revid", "format": "json", "formatversion": "2"})
    html, revid = data["parse"]["text"], data["parse"]["revid"]
    table = max(re.findall(r"<table[^>]*>.*?</table>", html, re.S), key=len)
    entries, seen = [], set()
    for cls, anchor, body in re.findall(r'<tr class="(s-[a-z]+)" id="([^"]+)">(.*?)</tr>', table, re.S):
        if cls not in STATUS:
            continue
        tds = re.findall(r"<td[^>]*>(.*?)</td>", body, re.S)
        if len(tds) < 4:
            continue
        name = strip(tds[0])
        last = re.search(r"\b(19|20)\d\d\b", strip(tds[3]))
        # domains: Special:LinkSearch/*.<domain[/path]> links in the Use column
        doms = []
        for d in re.findall(r'Special:LinkSearch/\*\.([^"\s]+)"', tds[-1]):
            d = unescape(urllib.parse.unquote(d)).lower().rstrip("/")
            if re.match(r"^[a-z0-9.-]+\.[a-z]{2,}(/[^\s\"']*)?$", d) and d not in doms:
                doms.append(d)
        if not doms:
            continue
        status, tier = STATUS[cls]
        key = (anchor, status)
        if key in seen:
            continue
        seen.add(key)
        entries.append({"id": anchor, "name": name, "status": status, "tier": tier,
                        "last": last.group(0) if last else None, "domains": doms})
    os.makedirs(OUT_DIR, exist_ok=True)
    out = {"v": 1,
           "source": {"name": "Wikipedia: Reliable sources/Perennial sources",
                      "url": "https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources",
                      "license": "CC BY-SA 4.0", "revid": revid,
                      "fetched": time.strftime("%Y-%m-%d")},
           "legend": {"gr": "Generally reliable", "nc": "No consensus / additional considerations",
                      "gu": "Generally unreliable", "d": "Deprecated", "b": "Blacklisted", "m": "Mixed (see entry)"},
           "entries": entries}
    with open(os.path.join(OUT_DIR, "list.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    from collections import Counter
    print("RSP rev %s: %d entries, %d domains, %s" % (revid, len(entries), sum(len(e["domains"]) for e in entries),
          dict(Counter(e["status"] for e in entries))))
    print("REMEMBER: node sign-list.mjs hosted-cred && python upload-pool.py --cred")


if __name__ == "__main__":
    main()
