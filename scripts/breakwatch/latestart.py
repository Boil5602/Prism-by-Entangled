"""Why the learned chance rises late at a break's start (2026-11-15). For each late start of 10 s or more in a run's edges file, the
rows of the late seconds are scored again with one family of inputs replaced by the values the same break shows once it is covered;
the rise in the chance says which family held it down.

    CLOCK=1 python scripts/breakwatch/latestart.py <run folder> [min seconds]
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ["CLOCK"] = "1"
from bwfeatures import CapModel, cap_feat, features, load  # noqa: E402

RUN = sys.argv[1]; MIN = float(sys.argv[2]) if len(sys.argv) > 2 else 10
G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
M = json.load(open(os.path.join(RUN, "control.json")))
FN = M["features"]; TREES = M["trees"]; BASE = M["baseline"]
cap = CapModel(); cap.vocab = {t: i for i, t in enumerate(M["caption"]["weights"])}
cap.w = np.array(list(M["caption"]["weights"].values())); cap.b = M["caption"]["intercept"]


def sec(h):
    a, b, c = h.split(":"); return int(a) * 3600 + int(b) * 60 + int(c)


def logit(X):
    z = np.full(len(X), BASE)
    for tr in TREES:
        f, thr, l, r, leaf, v = tr["f"], tr["thr"], tr["l"], tr["r"], tr["leaf"], tr["v"]
        for i in range(len(X)):
            k = 0
            while not leaf[k]: k = l[k] if X[i, f[k]] <= thr[k] else r[k]
            z[i] += v[k]
    return z


def P(X): return 1 / (1 + np.exp(-logit(X)))


def captions(day, win):
    import re
    ev = os.path.join(G, day, win, "events.log"); out = []
    if os.path.exists(ev):
        for line in open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ cc (.+)", line.rstrip())
            if m:
                s = m.group(1); out.append((int(s[:2]) * 3600 + int(s[2:4]) * 60 + int(s[4:6]) + int(s[6:9]) / 1000, m.group(2)))
    return out


def family(n):
    b = n.split("~")[0].split("@")[0]
    if b.startswith("cap_") or b in ("since_cc_ad", "since_cc_line"): return "captions"
    if b in ("logo", "logo_seen", "logo_ratio", "since_logo_up", "absent_for", "has_logo"): return "logo"
    if b in ("change", "mean", "std"): return "picture" if "@" not in n else "picture, rolling"
    if b in ("since_black", "since_cut", "cuts_30", "cuts_60", "spot_gap", "beats_black", "beats_any"): return "cuts and black"
    if b in ("db", "peak", "db_seen", "db_d30", "db_m5", "since_silence", "since_sound"): return "sound"
    if b in ("minute_of_hour", "near_edge", "set_aside", "cue_on"): return "other"
    return "words and known pictures"


SLOW = lambda n: n.endswith("@15") or n.endswith("@30") or n.split("~")[0] in ("cuts_30", "cuts_60", "cap_mean20", "cap_lines20", "absent_for", "db_d30", "logo_ratio")
FAM = sorted({family(n) for n in FN})
edges = json.load(open(os.path.join(RUN, "edges-control.json")))
cases = [i for i in edges["items"] if i["kind"] == "start" and i["s"] >= MIN]
days = {}
tot = {f: [] for f in FAM + ["slow by make", "all"]}; single = {n: [] for n in FN}
print("late  channel                     p late  " + "  ".join(f"{f[:10]:>10}" for f in FAM) + "   slow   all")
for c in cases:
    day = "2026-" + c["where"][:5]; tail = c["where"].split()[1]; chan = " ".join(c["where"].split()[2:])
    if day not in days:
        rows, names, ix = load(os.path.join(RUN, "feat", f"feat_{day}.csv")); days[day] = (rows, names, ix, {})
    rows, names, ix, done = days[day]
    win = [w for w in rows if w.endswith(tail)][0]
    if win not in done:
        a = rows[win]; X, fn = features(a, names, ix, skip=tuple(M["skip"]), taus=tuple(M["kernels"]), by_seconds=True)
        cp = captions(day, win); ct = np.array([x for x, _ in cp]); sc = cap.score([x for _, x in cp])
        XF = np.hstack([X, cap_feat(a[:, 0], ct, sc)]); assert fn + M["captionInputs"] == FN, "feature order"
        done[win] = (a[:, 0], XF)
    t, XF = done[win]
    t0, t1 = sec(c["brk"][0]), sec(c["brk"][1]); te = sec(c["err"][1])
    late = (t >= t0 + 1) & (t <= te - 1); ref = (t >= te + 3) & (t <= min(t1, te + 30))
    if late.sum() < 3 or ref.sum() < 3: continue
    XL = XF[late]; R = np.median(XF[ref], 0); p0 = P(XL)
    line = f"{c['s']:4.0f}  {chan[:24]:24}  {p0.mean():6.2f}  "
    for f in FAM + ["slow by make", "all"]:
        cols = [j for j, n in enumerate(FN) if (f == "all") or (f == "slow by make" and SLOW(n)) or family(n) == f]
        Xs = XL.copy(); Xs[:, cols] = R[cols]; g = P(Xs).mean() - p0.mean(); tot[f].append((g, c["s"]))
        line += f"{g:+10.2f}  " if f in FAM else f"{g:+5.2f}  "
    for j, n in enumerate(FN):
        Xs = XL.copy(); Xs[:, j] = R[j]; single[n].append(P(Xs).mean() - p0.mean())
    print(line)
print()
print("mean rise in the chance when the family takes its covered-break values (weighted by the late seconds):")
for f in FAM + ["slow by make", "all"]:
    g = np.array([x for x, _ in tot[f]]); w = np.array([s for _, s in tot[f]])
    print(f"  {f:26} {np.average(g, weights=w):+.3f}   cases over +0.20: {(g > 0.2).sum()} of {len(g)}")
print("single inputs, mean rise:")
for n, v in sorted(single.items(), key=lambda kv: -np.mean(kv[1]))[:14]: print(f"  {n:22} {np.mean(v):+.3f}")
