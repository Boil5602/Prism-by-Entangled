"""The clock as a reading (2026-11-06, the feature review's item 2: position in the programme).

    python scripts/breakwatch/prior.py <chance folder> <out folder>

Networks place their breaks at much the same minutes of each half hour. From every labelled day but the exams' own (10-08), the share of
ad time in each minute of the hour is counted (labels.json ads, else labels.auto.json, within `reviewed`; a minute either side pooled).
Each look's learned chance (run_exams.py LPARITYDIR) is then moved by that minute's odds against the average:
logit(p') = logit(p) + W * (logit(share[minute]) - logit(average)), and the cover policy runs on p'. Scored with exam.py beside W = 0.
PROMOS=show in the environment as for the exams.
"""
import csv, glob, json, math, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
par_dir, out_dir = sys.argv[1], sys.argv[2]
exams = json.load(open(os.path.join(HERE, "exams.json"), encoding="utf-8"))
GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
LEAVE = set(e["day"] for e in exams)
os.makedirs(out_dir, exist_ok=True)


def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
def clock(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"
def name(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])
def logit(p): p = min(0.999, max(0.001, p)); return math.log(p / (1 - p))
def sig(x): return 1 / (1 + math.exp(-x))


def prior():
    ad, tot, days = [0.0] * 60, [0.0] * 60, []
    for d in sorted(glob.glob(os.path.join(GOLD, "2026-*"))):
        day = os.path.basename(d)
        if day in LEAVE: continue
        f = os.path.join(d, "labels.json")
        if not os.path.exists(f) and not os.environ.get("HANDONLY"): f = os.path.join(d, "labels.auto.json")
        if not os.path.exists(f): continue
        lab = json.load(open(f, encoding="utf-8")).get("windows", {})
        used = False
        for w in lab.values():
            rev = [(sec(a), sec(b)) for a, b in w.get("reviewed", [])]
            ads = [(sec(a), sec(b)) for a, b in w.get("ads", [])]
            if not rev or not ads: continue
            used = True
            for a, b in rev:
                for t in range(int(a), int(b)):
                    m = (t // 60) % 60; tot[m] += 1
                    if any(x <= t < y for x, y in ads): ad[m] += 1
        if used: days.append(day)
    share = [(ad[(m - 1) % 60] + ad[m] + ad[(m + 1) % 60]) / max(1, tot[(m - 1) % 60] + tot[m] + tot[(m + 1) % 60]) for m in range(60)]
    return share, sum(ad) / max(1, sum(tot)), days


def chances(path):
    out = {}
    with open(path, newline="") as f:
        for row in csv.reader(f):
            try: out.setdefault(row[0], []).append((float(row[1]), float(row[2])))
            except (ValueError, IndexError): continue
    return {w: sorted(v) for w, v in out.items()}


def policy(series, on, off, hold=2):
    up, run, calls = False, 0, []
    for t, q in series:
        run = run + 1 if q > on else 0
        if not up and run >= hold: up = True; calls.append((t, "break"))
        elif up and q < off: up = False; calls.append((t, "show"))
    return calls


def score(tag, calls_for):
    tot = dict(ad=0, cov=0, show=0, wrong=0, late=0, mid=0, early=0, linger=0, own=0)
    for e in exams:
        out = subprocess.run([sys.executable, os.path.join(HERE, "exam.py"), "--trained", os.path.join(HERE, "trained.json"), e["day"], e["window"], e["from"], e["to"], "x=" + calls_for(e)],
                             capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
        h = re.search(r"(\d+) ad s, (\d+) show s", out)
        m1 = re.search(r"ads covered\s+([\d.]+)%.*?missed (\d+) s: began late (\d+), dropped mid-break (\d+), lifted early (\d+)", out)
        m2 = re.search(r"\((\d+) s\): stayed on after a break (\d+), came up ahead of one (\d+), on their own (\d+) s", out)
        if not (h and m1 and m2): print(tag, e["name"], "not scored"); continue
        tot["ad"] += int(h.group(1)); tot["cov"] += int(h.group(1)) - int(m1.group(2)); tot["show"] += int(h.group(2)); tot["wrong"] += int(m2.group(1))
        tot["late"] += int(m1.group(3)); tot["mid"] += int(m1.group(4)); tot["early"] += int(m1.group(5)); tot["linger"] += int(m2.group(2)); tot["own"] += int(m2.group(4))
    print(f"{tag}: ads covered {100 * tot['cov'] / tot['ad']:.1f}% | show wrongly covered {100 * tot['wrong'] / tot['show']:.2f}% | missed: late {tot['late']}, "
          f"mid {tot['mid']}, early {tot['early']} | wrong: stayed on {tot['linger']}, own {tot['own']}", flush=True)


share, base, days = prior()
print("prior from", ", ".join(days), "| average ad share %.1f%%" % (100 * base))
print("by minute:", " ".join("%02d:%d" % (m, round(100 * share[m])) for m in range(60)))
ON, OFF = 0.8, 0.45
for W in (0.0, 0.5, 1.0, 1.5):
    for on, off in ((ON, OFF), (0.7, 0.45)) if W else ((ON, OFF),):
        d = os.path.join(out_dir, f"w{W}_on{on}"); os.makedirs(d, exist_ok=True)
        def calls_for(e, W=W, on=on, off=off, d=d):
            ps = chances(os.path.join(par_dir, name(e) + ".csv"))
            path = os.path.join(d, name(e) + ".calls.log")
            with open(path, "w", encoding="utf-8") as f:
                for w, s in ps.items():
                    adj = [(t, sig(logit(p) + W * (logit(share[int(t // 60) % 60]) - logit(base)))) for t, p in s]
                    for t, k in policy(adj, on, off): f.write(f"{clock(t)} break watch {w}: {k} (prior)" + chr(10))
            return path
        score(f"clock weight {W} on {on} off {off}", calls_for)
