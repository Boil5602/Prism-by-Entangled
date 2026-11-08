"""Break-shaped smoothing measured on the exams (2026-11-06, the feature review's item 1).

    python scripts/breakwatch/smooth.py <chance folder> <out folder> [--grid]

<chance folder> holds each exam's learned chance per look (run_exams.py LPARITYDIR=<folder>). The chance is run through a two-state
hidden Markov model (show, break), forward only so it can run live: a break lasts about BREAK seconds on average and a stretch of show
about SHOW seconds, so one look cannot flip it, while a run of looks does. The model's chance is taken as the evidence (trained on
balanced classes, p/(1-p) is its likelihood ratio), clamped to [CLAMP, 1-CLAMP] so no single look is certain. The cover policy (up after
HOLD looks above ON, down below OFF) then runs on the smoothed chance. Each setting is scored with exam.py as run_exams.py does, beside
the same policy on the raw chance (the baseline here: the bench's own calls add the rules, so this is the model alone, both ways).
PROMOS=show in the environment as for the exams.
"""
import csv, json, math, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
par_dir, out_dir = sys.argv[1], sys.argv[2]
GRID = "--grid" in sys.argv
exams = json.load(open(os.path.join(HERE, "exams.json"), encoding="utf-8"))
os.makedirs(out_dir, exist_ok=True)


def name(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])
def clock(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def chances(path):
    out = {}
    with open(path, newline="") as f:
        for row in csv.reader(f):
            try: out.setdefault(row[0], []).append((float(row[1]), float(row[2])))
            except (ValueError, IndexError): continue
    return {w: sorted(v) for w, v in out.items()}


def smooth(series, brk, show, clamp):
    """Forward filter: the probability of a break at each look, given the looks so far."""
    a, out, last = 0.1, [], None
    for t, p in series:
        dt = 1.0 if last is None else max(0.5, min(6.0, t - last)); last = t
        sa = 1 - math.exp(-dt / show); as_ = 1 - math.exp(-dt / brk)   # show->break, break->show in dt
        a = a * (1 - as_) + (1 - a) * sa
        q = min(1 - clamp, max(clamp, p))
        num = a * q; a = num / (num + (1 - a) * (1 - q))
        out.append((t, a))
    return out


def policy(series, on, off, hold):
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
    line = (f"{tag}: ads covered {100 * tot['cov'] / tot['ad']:.1f}% | show wrongly covered {100 * tot['wrong'] / tot['show']:.2f}% | missed: late {tot['late']}, "
            f"mid {tot['mid']}, early {tot['early']} | wrong: stayed on {tot['linger']}, own {tot['own']}")
    print(line, flush=True)
    return 100 * tot["cov"] / tot["ad"], 100 * tot["wrong"] / tot["show"], line


def policy2(raw, sm, on, off, hold):
    """Asymmetric: a cover starts on the raw chance (a break's start is sharp) and ends on the smoothed one (its end is where the raw
    chance dips and recovers)."""
    up, run_, calls = False, 0, []
    for (t, p), (_, q) in zip(raw, sm):
        run_ = run_ + 1 if p > on else 0
        if not up and run_ >= hold: up = True; calls.append((t, "break"))
        elif up and q < off: up = False; calls.append((t, "show"))
    return calls


def run2(tag, brk, show, clamp, on, off, hold=2):
    d = os.path.join(out_dir, re.sub(r"[^A-Za-z0-9.]+", "_", tag)); os.makedirs(d, exist_ok=True)
    def calls_for(e):
        ps = chances(os.path.join(par_dir, name(e) + ".csv"))
        path = os.path.join(d, name(e) + ".calls.log")
        with open(path, "w", encoding="utf-8") as f:
            for w, s in ps.items():
                for t, k in policy2(s, smooth(s, brk, show, clamp), on, off, hold): f.write(f"{clock(t)} break watch {w}: {k} (smooth)" + chr(10))
        return path
    return score(tag, calls_for)


def run(tag, transform, on, off, hold=2):
    d = os.path.join(out_dir, re.sub(r"[^A-Za-z0-9.]+", "_", tag)); os.makedirs(d, exist_ok=True)
    def calls_for(e):
        ps = chances(os.path.join(par_dir, name(e) + ".csv"))
        path = os.path.join(d, name(e) + ".calls.log")
        with open(path, "w", encoding="utf-8") as f:
            for w, s in ps.items():
                for t, k in policy(transform(s), on, off, hold): f.write(f"{clock(t)} break watch {w}: {k} (smooth)\n")
        return path
    return score(tag, calls_for)


ON, OFF = float(os.environ.get("SON", "0.8")), float(os.environ.get("SOFF", "0.45"))
run(f"raw on {ON} off {OFF}", lambda s: s, ON, OFF)
if "--asym" in sys.argv:
    for b_ in (120, 180, 240):
        for off_ in (0.45, 0.3, 0.2):
            run2(f"asym start raw on {ON}, lift smoothed (break {b_} show 600) under {off_}", b_, 600, 0.05, ON, off_)
    sys.exit(0)
settings = [(150, 600, 0.05)] if not GRID else [(b, s, c) for b in (120, 180) for s in (480, 900) for c in (0.02, 0.05)]
for b, s, c in settings:
    for on, off in ((ON, OFF), (0.7, 0.3), (0.6, 0.3)):
        run(f"hmm break {b} show {s} clamp {c} on {on} off {off}", lambda x, b=b, s=s, c=c: smooth(x, b, s, c), on, off)
