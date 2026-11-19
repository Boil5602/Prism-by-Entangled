"""Which channels carry the service's own ad marks (2026-11-17): of each channel's labelled ad time, the share inside a break the stream marked.

    PROMOS=show python scripts/breakwatch/markedshare.py [--days a,b,...] [--min 300]

A marked break is what the sure rule covers: events.log `cueat <event> <length> <elapsed> <lead>` places a break from (now - elapsed)
for <length> seconds. A mark the page could not place (lead `now`) is left out: before 2026-11-10 those were mostly a preview tile's
(B-484). The channel of a second is the last `edge` line's. Labels: labels.json with the sampled nights' automatic marks, promos as
show. Reads only the kept recordings."""
import json, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import promos
G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
a = sys.argv[1:]
days = a[a.index("--days") + 1].split(",") if "--days" in a else sorted(d for d in os.listdir(G) if os.path.exists(os.path.join(G, d, "labels.json")))
MIN = int(a[a.index("--min") + 1]) if "--min" in a else 300
sec = lambda t: int(t[:2]) * 3600 + int(t[3:5]) * 60 + int(t[6:8])
ad = defaultdict(int); mk = defaultdict(int); brk = defaultdict(int); bm = defaultdict(int); dd = defaultdict(set)
for day in days:
    D = os.path.join(G, day)
    wins = promos.windows_with_auto(D, json.load(open(os.path.join(D, "labels.json"), encoding="utf-8"))["windows"])
    for win, lab in wins.items():
        ev = os.path.join(D, win, "events.log")
        if not os.path.exists(ev): continue
        chan = [None] * 86400; marked = bytearray(86400); cur = None; last = 0; any_cue = False
        for line in open(ev, encoding="utf-8", errors="replace"):
            sp = line.split(" ", 3)
            if len(sp) < 3 or len(sp[0]) != 9 or not sp[0].isdigit(): continue
            t = int(sp[0][:2]) * 3600 + int(sp[0][2:4]) * 60 + int(sp[0][4:6])
            if t > 86399: continue
            for s in range(last, t): chan[s] = cur
            last = max(last, t)
            if sp[2] == "edge" and len(sp) > 3:
                n = sp[3].strip().split(" ", 1); cur = n[1].strip() if len(n) > 1 and n[1].strip() else None
            elif sp[2] == "cueat" and len(sp) > 3:
                c = sp[3].split()
                if len(c) >= 4 and c[3] != "now":
                    try: ln, el = float(c[1]), float(c[2])
                    except ValueError: continue
                    x = int(t - el); any_cue = True
                    for s in range(max(0, x), min(86400, int(x + ln) + 1)): marked[s] = 1
        for s in range(last, 86400): chan[s] = cur
        if not any_cue and day < "2026-11-08": continue   # the placed line is written since 2026-11-08
        rev = bytearray(86400)
        for x, y in lab.get("reviewed", []):
            for s in range(sec(x), min(86399, sec(y)) + 1): rev[s] = 1
        for x, y in lab.get("neutral", []):
            for s in range(sec(x), min(86399, sec(y)) + 1): rev[s] = 0
        for x, y in promos.ads_for(D, win, lab.get("ads", [])):
            ss = [s for s in range(sec(x), min(86399, sec(y)) + 1) if rev[s] and chan[s]]
            if len(ss) < 10: continue
            by = defaultdict(int)
            for s in ss: by[chan[s]] += 1
            c = max(by, key=by.get); m = sum(marked[s] for s in ss)
            ad[c] += len(ss); mk[c] += m; brk[c] += 1; bm[c] += 1 if m >= 0.5 * len(ss) else 0; dd[c].add(day)
rows = sorted(((100 * mk[c] / ad[c], c) for c in ad if ad[c] >= MIN), reverse=True)
print("%d channels with %d s or more of labelled ad time; days %s to %s" % (len(rows), MIN, days[0], days[-1]))
print("%-28s %8s %8s %8s %12s %5s" % ("channel", "ad s", "marked", "share", "breaks marked", "days"))
for p, c in rows: print("%-28s %8d %8d %7.0f%% %7d of %-3d %4d" % (c[:28], ad[c], mk[c], p, bm[c], brk[c], len(dd[c])))
T = sum(ad.values()); print("all channels: %d ad s, %.1f%% marked" % (T, 100 * sum(mk.values()) / max(1, T)))
for lo, hi, n in ((90, 101, "nearly all"), (10, 90, "in part"), (0, 10, "almost none")):
    L = [c for p, c in rows if lo <= p < hi]; print("%s (%d): %s" % (n, len(L), ", ".join(L)))
