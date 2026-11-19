"""The look-ahead's end finder, the reading that looks both ways (2026-11-17, roadmap: the look-ahead's end finder).

    python scripts/breakwatch/endfinder.py <out folder> <exam readings folder> --day <feat.csv> <golden day folder> [--day ...]
                                           [--export <end-finder.json>]

--export writes the trees for PRISM (targets/win-host/PrismHost.Core/EndFinder.cs reads them; the app ships the file as
Assets/breakwatch/end-finder.json), checked against scikit-learn. bwtest ENDMODEL=<json> ENDQCSV=<csv> is the parity check of the
app's own scoring against <out>/q.

One question, asked of a look at time c with the looks around it in hand: is the show back at c? The live watch can only use what came
before a moment; the look-ahead holds the big screen some seconds behind, so for a moment it is about to show it also has what came
after. A look's inputs are the break model's own readings (the feature file of run_exams.py FEATDIR / bwtest FEATCSV) at c and at the
looks OFFSETS before and after it, and the change of a few of them from the five looks before to the five after.

Trained on the labelled days' looks within 20 s of a marked break's end (1 = at or after the end), with a share of looks deep in breaks
(0) and deep in the show (1) so a black frame between two advertisements is not taken for the end. The exams' own stretches are left
out, and every second the exams hold. PROMOS=show as everywhere: a promo after the last advertisement is the show returned.

Out: <out>/q/<exam>.csv (win,t,q: the chance the show is back, for every look of each exam), read by lookahead.py LOOKQ=<out>/q with
LOOKFIND=model; and a held-out score over the last two days given.
"""
import csv, json, os, re, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("PROMOS", "show")
import promos  # noqa: E402
from bwfeatures import load  # noqa: E402

args = sys.argv[1:]
DAYS = []
while "--day" in args:
    i = args.index("--day"); DAYS.append((args[i + 1], args[i + 2])); del args[i:i + 3]
EXPORT = None
if "--export" in args:
    i = args.index("--export"); EXPORT = args[i + 1]; del args[i:i + 2]
MIN = 0.7   # the chance over which a look says the show is back: the careful setting (chosen 2026-11-17)
OUT, EXAMFEAT = args[0], args[1]
OFFSETS = (-8, -5, -3, -2, -1, 0, 1, 2, 3, 5)     # looks, about a second each; nothing later than five, so ten seconds back from a lift stay inside fifteen in hand
SKIP = ("chance", "active", "since_cue_stop", "since_cue_predict", "cue_on", "print_seen")
DELTA = ("mean", "std", "change", "logo_seen", "has_logo", "logo_ratio", "db", "peak")
exams = json.load(open(os.path.join(HERE, "exams.json"), encoding="utf-8"))


def sec(h): a, b, c = h.split(":"); return int(a) * 3600 + int(b) * 60 + int(c)
def nm(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])


def inputs(a, names, ix):
    use = [n for n in names if n not in SKIP and not n.startswith("pal_")]
    base = np.stack([np.minimum(a[:, ix[n]], 30) if n.startswith("since_") else a[:, ix[n]] for n in use], 1)
    n = len(a); idx = np.arange(n); cols, fn = [], []
    for k in OFFSETS:
        j = np.clip(idx + k, 0, n - 1)
        # a look that is not about k seconds away (a gap in the recording) gives nothing true: its row is still used, the gap is an input
        cols.append(base[j]); fn += [f"{u}@{k:+d}" for u in use]
        cols.append((a[j, 0] - a[:, 0])[:, None]); fn.append(f"dt@{k:+d}")
    for u in DELTA:
        v = a[:, ix[u]]; cs = np.concatenate([[0.0], np.cumsum(v)])
        after = (cs[np.clip(idx + 6, 0, n)] - cs[np.clip(idx + 1, 0, n)]) / 5
        before = (cs[idx] - cs[np.clip(idx - 5, 0, n)]) / 5
        cols.append((after - before)[:, None]); fn.append(f"{u}:after-before")
    return np.hstack(cols), fn, use


X, Y, G = [], [], []
rng = np.random.default_rng(0)
for feat, day in DAYS:
    tag = os.path.basename(os.path.normpath(day))
    rows, names, ix = load(feat)
    labels = json.load(open(os.path.join(day, "labels.json"), encoding="utf-8"))["windows"]
    labels = promos.windows_with_auto(day, labels)
    for w, a in rows.items():
        lab = labels.get(w)
        if not lab or not lab.get("ads") or len(a) < 100: continue
        ads = promos.ads_for(day, w, lab["ads"]) if promos.on() else lab["ads"]
        ads = sorted((sec(x), sec(y) + 1) for x, y in ads)
        t = a[:, 0]
        ad = np.zeros(len(t), bool)
        for s, e in ads: ad |= (t >= s) & (t < e)
        keep = np.zeros(len(t), bool)
        for i, (s, e) in enumerate(ads):
            if e - s < 30 or e - s > 480: continue                      # a fragment, or a marked stretch that is no commercial break
            if i + 1 < len(ads) and ads[i + 1][0] - e < 30: continue     # another break follows at once: no return to the show here
            keep |= (t >= e - 20) & (t <= e + 20)
            keep |= (t >= s + 15) & (t < e - 20) & (rng.random(len(t)) < 0.15)   # deep in the break
        keep |= ~ad & (rng.random(len(t)) < 0.01)                              # deep in the show
        # only seconds a person marked: between the first and the last marked break of the window
        keep &= (t >= ads[0][0] - 60) & (t <= ads[-1][1] + 60)
        # nothing the exams hold
        for ex in exams:
            if ex["day"] == tag and ex["window"] == w: keep &= ~((t >= sec(ex["from"]) - 300) & (t <= sec(ex["to"]) + 300))
        if not keep.any(): continue
        x, fn, USE = inputs(a, names, ix)
        X.append(x[keep]); Y.append((~ad[keep]).astype(int)); G += [tag] * int(keep.sum())
    print(tag, "looks kept so far", sum(len(y) for y in Y), flush=True)

X = np.vstack(X); Y = np.concatenate(Y); G = np.array(G)
print("looks", len(Y), "show share %.2f" % Y.mean(), "inputs", X.shape[1], flush=True)

from sklearn.ensemble import HistGradientBoostingClassifier  # noqa: E402
from sklearn.metrics import roc_auc_score  # noqa: E402


def model(): return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=15, min_samples_leaf=60, l2_regularization=1.0, random_state=0)


days = sorted(set(G)); held = days[-2:]
m = model().fit(X[~np.isin(G, held)], Y[~np.isin(G, held)])
p = m.predict_proba(X[np.isin(G, held)])[:, 1]
print("held out", held, "AUC %.4f" % roc_auc_score(Y[np.isin(G, held)], p), "right at 0.5: %.1f%%" % (100 * ((p > 0.5) == Y[np.isin(G, held)]).mean()), flush=True)

m = model().fit(X, Y)
if EXPORT:
    trees = []
    for it in m._predictors:
        n = it[0].nodes
        trees.append({"f": n["feature_idx"].tolist(), "thr": [float(v) for v in n["num_threshold"]], "l": n["left"].tolist(), "r": n["right"].tolist(),
                      "leaf": [int(v) for v in n["is_leaf"]], "v": [float(v) for v in n["value"]]})
    base = float(np.ravel(m._baseline_prediction)[0])
    chk = X[np.random.RandomState(0).choice(len(X), 400, replace=False)]
    z = np.full(len(chk), base)
    for tr in trees:
        for i in range(len(chk)):
            k = 0
            while not tr["leaf"][k]: k = tr["l"][k] if chk[i, tr["f"][k]] <= tr["thr"][k] else tr["r"][k]
            z[i] += tr["v"][k]
    diff = np.abs(1 / (1 + np.exp(-z)) - m.predict_proba(chk)[:, 1]).max()
    print("export check: the exported trees match scikit-learn to %.2e" % diff); assert diff < 1e-6
    with open(EXPORT, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "trained": int(len(Y)), "use": USE, "offsets": list(OFFSETS), "delta": list(DELTA), "clip": 30, "min": MIN,
                   "baseline": base, "trees": trees}, f, separators=(",", ":"))
    print("exported", EXPORT, len(trees), "trees", flush=True)
os.makedirs(os.path.join(OUT, "q"), exist_ok=True)
for ex in exams:
    rows, names, ix = load(os.path.join(EXAMFEAT, nm(ex) + ".csv"))
    with open(os.path.join(OUT, "q", nm(ex) + ".csv"), "w", newline="") as f:
        wr = csv.writer(f); wr.writerow(["win", "t", "q"])
        for w, a in rows.items():
            x, _, _ = inputs(a, names, ix)
            for t, q in zip(a[:, 0], m.predict_proba(x)[:, 1]): wr.writerow([w, "%.3f" % t, "%.4f" % q])
    print("scored", ex["name"], flush=True)
