"""Suggested breaks for the marking page (2026-10-07, "What can I do to help. More training, more channels?"): the learned detector, trained
on every mark so far, reads the hours nobody has marked yet, and each break it is fairly sure of becomes a suggestion the person accepts or
dismisses with one tap (suggest.json beside the recording). Where the person corrects it is where it learns most.

    python scripts/breakwatch/prefill.py <feat.csv> <golden day folder>
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from bwfeatures import balanced, features, gbm, load  # noqa: E402

FEAT, DAY = sys.argv[1], sys.argv[2]
labels = json.load(open(os.path.join(DAY, "labels.json"), encoding="utf-8")).get("windows", {})


def sec(h):
    a, b, c = h.split(":")
    return int(a) * 3600 + int(b) * 60 + int(c)


def hms(v):
    v = int(round(v))
    return f"{v // 3600:02d}:{v // 60 % 60:02d}:{v % 60:02d}"


def spans(t, L):
    m = np.zeros(len(t), bool)
    for a, b in L:
        m |= (t >= sec(a)) & (t <= sec(b) + 0.99)
    return m


rows, names, ix = load(FEAT)
Xs, ys = [], []
data = {}
for w, a in rows.items():
    X, _ = features(a, names, ix)
    t = a[:, 0]
    data[w] = (t, X)
    lab = labels.get(w)
    if not lab or not lab.get("ads"):
        continue
    keep = spans(t, lab.get("reviewed", [])) & ~spans(t, lab.get("neutral", []))
    Xs.append(X[keep]); ys.append(spans(t, lab["ads"])[keep].astype(float))
X, y = np.concatenate(Xs), np.concatenate(ys)
m = gbm(); m.fit(X, y, sample_weight=balanced(y))
print(f"trained on {len(y)} marked seconds ({int(y.sum())} of them ads)")

out = {}
for w, (t, Xw) in data.items():
    p = m.predict_proba(Xw)[:, 1]
    done = spans(t, labels.get(w, {}).get("reviewed", []))
    # a break: the chance above 0.85 for two rows on, below 0.55 off; kept when 20 s or longer and not in an hour already marked
    up, run, st, found = False, 0, None, []
    for i, v in enumerate(p):
        run = run + 1 if v > 0.85 else 0
        if not up and run >= 2: up, st = True, i
        elif up and v < 0.55:
            up = False
            found.append((st, i))
    if up: found.append((st, len(p) - 1))
    sug = []
    for a_, b_ in found:
        # a break runs 20 s to about 7 minutes; anything longer is a stretch with no live picture (Prism closed, a page stuck loading)
        if t[b_] - t[a_] < 20 or t[b_] - t[a_] > 480 or done[a_:b_ + 1].mean() > 0.5:
            continue
        sug.append([hms(t[a_]), hms(t[b_]), round(float(p[a_:b_ + 1].mean()), 2)])
    out[w] = sug
    print(f"{w[-6:]:>8}: {len(sug)} suggested breaks")
json.dump({"windows": out}, open(os.path.join(DAY, "suggest.json"), "w", encoding="utf-8"), indent=1)
