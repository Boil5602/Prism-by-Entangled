"""The per-channel calibration study (2026-11-07): what a channel's free labels could do for its threshold.

    python scripts/breakwatch/calib.py <exams.json> <sure dir> [--on 0.8] [--off 0.65] [--hold 3] [--agree] [--bound 1.0] [--every 300]

Reads the bench's LPSURE=1 parity files (win,t,p,trees,sure_ad,sure_show: the blended chance, the trees' own, and whether the look was a
sure ad - a marked slot playing, a known ad, an infomercial - or a sure show - every rule says show) and each exam's marks (labels.json,
PROMOS=show as the exams). First the facts: how many sure seconds each exam gives and how the chance sits on them against the truth.
Then a replay of the cover policy as the bench runs it, once as is and once with a per-channel offset in logit learned online from the
sure seconds seen so far (never from the marks): the show's sure seconds say how high the chance runs on the show, the sure ads how low
it runs on ads; the offset moves the chance so a sure show stays clear of "on" and a sure ad clears it, bounded, revised every
--every seconds. Scored as exam.py scores: ad time covered, show wrongly covered, pop-ups (a cover on the show gone within 20 s)."""
import csv, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("PROMOS", "show")
import promos as _promos  # noqa: E402

G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
args = sys.argv[1:]
def opt(n, d):
    if n in args: i = args.index(n); return args[i + 1]
    return d
ON, OFF, HOLD = float(opt("--on", "0.8")), float(opt("--off", "0.65")), int(opt("--hold", "3"))
AGREE = "--agree" in args; BOUND = float(opt("--bound", "1.0")); EVERY = float(opt("--every", "300"))
exams = json.load(open(args[0], encoding="utf-8")); SURE = args[1]


def sec(h): x, y, z = h.split(":"); return int(x) * 3600 + int(y) * 60 + int(z)
def logit(p): p = min(0.999, max(0.001, p)); return math.log(p / (1 - p))
def sig(x): return 1 / (1 + math.exp(-x))


def truth(e):
    lab = json.load(open(os.path.join(G, e["day"], "labels.json"), encoding="utf-8"))["windows"][e["window"]]
    if _promos.on(): lab = dict(lab, ads=_promos.ads_for(os.path.join(G, e["day"]), e["window"], lab.get("ads", [])))
    A, B = sec(e["from"]), sec(e["to"]); n = B - A + 1
    rev = np.zeros(n, bool); ads = np.zeros(n, bool)
    for x, y in lab.get("reviewed", []): rev[max(0, sec(x) - A):max(0, sec(y) - A + 1)] = True
    for x, y in lab.get("ads", []):
        if sec(y) > A and sec(x) < B: ads[max(0, sec(x) - A):max(0, min(sec(y), B) - A + 1)] = True
    for x, y in lab.get("neutral", []): rev[max(0, sec(x) - A):max(0, sec(y) - A + 1)] = False
    return A, B, rev, ads


def looks(e):
    name = "".join(ch if ch.isalnum() else "-" for ch in e["name"]).strip("-")
    rows = []
    with open(os.path.join(SURE, name + ".csv"), newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["win"] != e["window"]: continue
            rows.append((float(r["t"]), float(r["p"]), float(r["trees"]), r["sure_ad"] == "1", r["sure_show"] == "1"))
    rows.sort(); return rows


def policy(rows, A, B, offset_fn):
    """The bench's cover: up after HOLD looks above ON, down below OFF; with --agree no start unless trees >= .5 and the network's
    share of the blend >= .5. offset_fn(t) gives the logit offset in force at t. Returns the covered seconds in [A, B]."""
    n = B - A + 1; cov = np.zeros(n, bool); up = False; run = 0; upAt = None
    for t, p, trees, _, _ in rows:
        b = offset_fn(t)
        q = sig(2 * (logit(p) - logit(trees)))   # the network's chance, back out of the blend at weight 0.5
        pc = sig(logit(p) + b)
        if AGREE and not up and (trees < 0.5 or q < 0.5): pc = 0
        run = run + 1 if pc > ON else 0
        if not up:
            if run >= HOLD: up = True; upAt = t
        elif pc < OFF: up = False
        s = int(t)
        if up and A <= s <= B: cov[s - A] = True
    return cov


def score(cov, rev, ads):
    adS = (ads & rev).sum(); shS = (~ads & rev).sum()
    covA = (cov & ads & rev).sum(); wrong = cov & ~ads & rev
    # pop-ups: covered stretches on the show, no ad within 4 s, 20 s or less
    edge = np.diff(np.concatenate([[0], cov.astype(int), [0]])); st = np.flatnonzero(edge == 1); en = np.flatnonzero(edge == -1)
    pops = sum(1 for s, e_ in zip(st, en) if e_ - s <= 20 and rev[s:e_].any() and not ads[max(0, s - 4):e_ + 4].any())
    return adS, covA, shS, int(wrong.sum()), pops


tot = {"base": [0, 0, 0, 0, 0], "cal": [0, 0, 0, 0, 0]}
for e in exams:
    A, B, rev, ads = truth(e); rows = looks(e)
    # the facts
    sa = [(p, trees, A <= int(t) <= B and ads[int(t) - A]) for t, p, trees, a, s in rows if a and A <= int(t) <= B and rev[int(t) - A]]
    ss = [(p, trees, A <= int(t) <= B and ads[int(t) - A]) for t, p, trees, a, s in rows if s and A <= int(t) <= B and rev[int(t) - A]]
    def q(v, k): return np.percentile(v, k) if len(v) else float("nan")
    print(f"{e['name']:<22} sure ads {len(sa):5d} s (truly ads {100 * np.mean([x[2] for x in sa]) if sa else 0:4.0f}%), chance median {q([x[0] for x in sa], 50):.2f} 10th {q([x[0] for x in sa], 10):.2f}"
          f" | sure show {len(ss):5d} s (truly show {100 * (1 - np.mean([x[2] for x in ss])) if ss else 0:4.0f}%), chance median {q([x[0] for x in ss], 50):.2f} 90th {q([x[0] for x in ss], 90):.2f} 99th {q([x[0] for x in ss], 99):.2f}")
    # the online offset: revised every EVERY seconds from the sure seconds seen so far on this window
    sched = []; adL = []; shL = []; nextAt = rows[0][0] + EVERY if rows else 0; b = 0.0
    for t, p, trees, a, s in rows:
        if a: adL.append(logit(p))
        if s: shL.append(logit(p))
        if t >= nextAt:
            nextAt = t + EVERY
            bs = min(0.0, logit(0.5) - np.percentile(shL, 90)) if len(shL) >= 600 else 0.0   # the show's 90th percentile below 0.5
            ba = max(0.0, logit(0.9) - np.percentile(adL, 50)) if len(adL) >= 120 else 0.0   # the sure ads' median at 0.9 or above
            b = float(np.clip(bs + ba, -BOUND, BOUND)); sched.append((t, b))
    def offset_at(t, sched=sched):
        b = 0.0
        for at, v in sched:
            if at <= t: b = v
            else: break
        return b
    base = score(policy(rows, A, B, lambda t: 0.0), rev, ads)
    cal = score(policy(rows, A, B, offset_at), rev, ads)
    for k, v in (("base", base), ("cal", cal)):
        for i in range(5): tot[k][i] += v[i]
    print(f"{'':<22} as is: ads {100 * base[1] / max(1, base[0]):5.1f}%  show {100 * base[3] / max(1, base[2]):5.2f}%  pop-ups {base[4]:3d} | calibrated: ads {100 * cal[1] / max(1, cal[0]):5.1f}%  show {100 * cal[3] / max(1, cal[2]):5.2f}%  pop-ups {cal[4]:3d}"
          f" | offsets {', '.join(f'{v:+.2f}' for _, v in sched[::max(1, len(sched) // 6)])}")
for k in ("base", "cal"):
    v = tot[k]; print(f"ALL {k}: ads covered {100 * v[1] / max(1, v[0]):.1f}%  show wrongly covered {100 * v[3] / max(1, v[2]):.2f}%  pop-ups {v[4]}")
