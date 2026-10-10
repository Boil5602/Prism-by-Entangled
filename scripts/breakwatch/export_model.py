"""The learned break detector, trained on every mark and exported for Prism (2026-10-07, "Yes do it").

Trains the gradient-boosted trees on the marked seconds (the readings, their recency kernels and rolling means, and the caption classifier's
view - its scores out of fold by channel, so the trees learn from the scores they will really get), then the caption classifier on every
marked caption line, and writes one JSON file Prism reads (Services/LearnedBreak.cs): the input recipe, every tree's nodes, the caption
words' weights and the cover policy. It checks its own export (the trees re-evaluated from the exported numbers match scikit-learn's), and
writes every row's chance for Prism's parity test.

    python scripts/breakwatch/export_model.py <feat.csv> <golden day folder> <out model.json> [parity.csv]
"""
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from bwfeatures import CapModel, balanced, cap_feat, features, gbm, load  # noqa: E402

FEAT, DAY, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
PARITY = sys.argv[4] if len(sys.argv) > 4 else None
labels = json.load(open(os.path.join(DAY, "labels.json"), encoding="utf-8"))["windows"]
POLICY = {"on": 0.85, "off": 0.55, "hold": 2}
ROLLS = {"signals": ["logo_ratio", "logo_seen", "change", "std", "mean"], "windows": [5, 15, 30]}
KERNELS = [3, 10, 40]


def sec(h):
    a, b, c = h.split(":")
    return int(a) * 3600 + int(b) * 60 + int(c)


def spans(t, L):
    m = np.zeros(len(t), bool)
    for a, b in L:
        m |= (t >= sec(a)) & (t <= sec(b) + 0.99)
    return m


def captions(win):
    ev = os.path.join(DAY, win, "events.log")
    out = []
    if os.path.exists(ev):
        for line in open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ cc (.+)", line.rstrip())
            if m: out.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]) + int(m.group(1)[6:9]) / 1000, m.group(2)))
    return out


def channel_at(win, t):
    ev = os.path.join(DAY, win, "events.log")
    marks = []
    if os.path.exists(ev):
        for line in open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ edge \d (.+)", line.strip())
            if m: marks.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]), m.group(2).strip()))
    marks.sort()
    if not marks: return np.array(["?"] * len(t))
    ts = np.array([x for x, _ in marks]); i = np.searchsorted(ts, t, side="right") - 1
    return np.array([marks[max(0, k)][1] for k in i])


restarts = [sec(l[:8]) for l in open(os.path.join(DAY, "calls.log"), encoding="utf-8", errors="replace") if "brain ready" in l]
rows, names, ix = load(FEAT)
W = {}
for w, a in rows.items():
    t = a[:, 0]
    X, fn = features(a, names, ix)
    lab = labels.get(w, {})
    keep = spans(t, lab.get("reviewed", [])) & ~spans(t, lab.get("neutral", []))
    for r0 in restarts: keep &= ~((t >= r0 - 20) & (t <= r0 + 180))
    y = spans(t, lab.get("ads", []))
    cap = captions(w)
    ct = np.array([c for c, _ in cap]); lines = [x for _, x in cap]
    cy = y[np.clip(np.searchsorted(t, ct - 3), 0, len(t) - 1)] if len(ct) else np.array([])
    ckeep = keep[np.clip(np.searchsorted(t, ct - 3), 0, len(t) - 1)] if len(ct) else np.array([], bool)
    W[w] = dict(t=t, X=X, y=y, keep=keep, ch=channel_at(w, t), ct=ct, lines=lines, cy=cy, ckeep=ckeep, cch=channel_at(w, ct) if len(ct) else np.array([]))

# the caption classifier's scores out of fold by channel (each channel's lines scored by a classifier that never saw that channel)
chans = sorted({c for v in W.values() for c in set(v["cch"][v["ckeep"]])})
for v in W.values(): v["sc"] = np.full(len(v["ct"]), np.nan)
for c in chans:
    L, Y = [], []
    for v in W.values():
        k = v["ckeep"] & (v["cch"] != c)
        L += [x for x, kk in zip(v["lines"], k) if kk]; Y += list(v["cy"][k])
    cm = CapModel().fit(L, Y)
    for v in W.values():
        k = v["cch"] == c
        if k.any(): v["sc"][k] = cm.score([x for x, kk in zip(v["lines"], k) if kk])
L, Y = [], []
for v in W.values():
    L += [x for x, kk in zip(v["lines"], v["ckeep"]) if kk]; Y += list(v["cy"][v["ckeep"]])
final_cap = CapModel().fit(L, Y)
for v in W.values():
    miss = np.isnan(v["sc"])
    if miss.any(): v["sc"][miss] = final_cap.score([x for x, kk in zip(v["lines"], miss) if kk])

Xs, ys = [], []
for v in W.values():
    v["XF"] = np.hstack([v["X"], cap_feat(v["t"], v["ct"], v["sc"])])
    Xs.append(v["XF"][v["keep"]]); ys.append(v["y"][v["keep"]].astype(float))
X, y = np.concatenate(Xs), np.concatenate(ys)
m = gbm(); m.fit(X, y, sample_weight=balanced(y))
print(f"trained on {len(y)} marked seconds ({int(y.sum())} ads), {X.shape[1]} inputs, {len(m._predictors)} trees, caption words {len(final_cap.vocab)}")

trees = []
for it in m._predictors:
    n = it[0].nodes
    trees.append({"f": n["feature_idx"].tolist(), "thr": [float(x) for x in n["num_threshold"]], "l": n["left"].tolist(), "r": n["right"].tolist(),
                  "leaf": [int(x) for x in n["is_leaf"]], "v": [float(x) for x in n["value"]], "ml": [int(x) for x in n["missing_go_to_left"]]})
base = float(np.ravel(m._baseline_prediction)[0])


def own_predict(Xr):
    z = np.full(len(Xr), base)
    for tr in trees:
        for i in range(len(Xr)):
            k = 0
            while not tr["leaf"][k]:
                k = tr["l"][k] if Xr[i, tr["f"][k]] <= tr["thr"][k] else tr["r"][k]
            z[i] += tr["v"][k]
    return 1 / (1 + np.exp(-z))


chk = X[np.random.RandomState(0).choice(len(X), 400, replace=False)]
diff = np.abs(own_predict(chk) - m.predict_proba(chk)[:, 1]).max()
print(f"export check: the exported trees match scikit-learn to {diff:.2e}")
assert diff < 1e-6

model = {"version": 1, "trained": len(y), "inputs": list(names), "skip": ["chance", "active"], "kernels": KERNELS, "rolls": ROLLS,
         "captionInputs": ["cap_mean8", "cap_mean20", "cap_lines20", "cap_since"], "features": fn + ["cap_mean8", "cap_mean20", "cap_lines20", "cap_since"],
         "baseline": base, "trees": trees, "caption": final_cap.export(), "captionLag": 3, "policy": POLICY}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(model, f, separators=(",", ":"))
print("written", OUT, os.path.getsize(OUT) // 1024, "KB")

if PARITY:
    # every row's chance, the caption scores from the exported (final) caption classifier as Prism will compute them
    with open(PARITY, "w") as f:
        f.write("win,t,p\n")
        for w, v in W.items():
            sc = final_cap.score(v["lines"]) if v["lines"] else np.array([])
            XF = np.hstack([v["X"], cap_feat(v["t"], v["ct"], sc)])
            p = m.predict_proba(XF)[:, 1]
            for tt, pp in zip(v["t"], p): f.write(f"{w},{tt:.3f},{pp:.6f}\n")
    print("parity rows written", PARITY)
