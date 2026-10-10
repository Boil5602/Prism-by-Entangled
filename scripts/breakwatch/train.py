"""The learned break detector, first pass (2026-10-07, "I love the idea of the trained model").

Rows: one per window per frame (~1 s), the break model's readings after the frame (bwtest bench with FEATCSV=...). Labels: the person's
marks (labels.json from the marking page). A logistic model over the readings, their recency and their recent history; each channel is
scored by a model trained on the other channels only, so the score is the one a channel Prism has never seen would get. The same rows
scored by the hand rules (the "active" column) are the baseline.

    python scripts/breakwatch/train.py <feat.csv> <labels.json> [logistic|trees]
"""
import csv
import json
import sys

import numpy as np

FEAT, LABELS = sys.argv[1], sys.argv[2]


def sec(h):
    a, b, c = h.split(":")
    return int(a) * 3600 + int(b) * 60 + int(c)


rows = {}
with open(FEAT, newline="") as f:
    r = csv.reader(f)
    head = next(r)
    for line in r:
        rows.setdefault(line[0], []).append([float(x) for x in line[1:]])
names = head[2:]
ix = {n: i + 1 for i, n in enumerate(names)}   # column 0 is t
labels = json.load(open(LABELS, encoding="utf-8"))["windows"]
import os, re
_calls = os.environ.get("RESTARTLOG") or os.path.join(os.path.dirname(LABELS), "calls.log")
RESTARTS = [sec(l[:8]) for l in open(_calls, encoding="utf-8", errors="replace") if "brain ready" in l] if os.path.exists(_calls) else []


def channel_at(win, t):
    """The channel each row was on: the kept recording's 'edge' lines name it about once a minute (and at every change)."""
    ev = os.path.join(os.path.dirname(LABELS), win, "events.log")
    marks = []
    if os.path.exists(ev):
        for line in open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ edge \d (.+)", line.strip())
            if m: marks.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]), m.group(2).strip()))
    marks.sort()
    ts = np.array([x for x, _ in marks]) if marks else np.array([0])
    names_ = [n for _, n in marks] or ["?"]
    i = np.searchsorted(ts, t, side="right") - 1
    # before its first edge line a row belongs to the next channel named
    return np.array([names_[max(0, k)] if k >= 0 else names_[0] for k in i])


def captions_of(win):
    """Every caption line of a window: (seconds of the day, the words)."""
    ev = os.path.join(os.path.dirname(LABELS), win, "events.log")
    out = []
    if os.path.exists(ev):
        for line in open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ cc (.+)", line.rstrip())
            if m: out.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]) + int(m.group(1)[6:9]) / 1000, m.group(2)))
    return out


def build(win):
    a = np.array(sorted(rows[win], key=lambda x: x[0]))
    lab = labels[win]
    t = a[:, 0]
    rev = np.zeros(len(t), bool)
    for x, y in lab.get("reviewed", []):
        rev |= (t >= sec(x)) & (t <= sec(y) + 0.99)
    neu = np.zeros(len(t), bool)
    for x, y in lab.get("neutral", []):
        neu |= (t >= sec(x)) & (t <= sec(y) + 0.99)
    ad = np.zeros(len(t), bool)
    for x, y in lab.get("ads", []):
        ad |= (t >= sec(x)) & (t <= sec(y) + 0.99)
    cols = []
    fn = []
    for n in names:
        v = a[:, ix[n]]
        if n in ("chance", "active"):
            continue                                   # the rules' own outputs are the baseline, never an input
        if n.startswith("since_") or n == "since_logo_up":
            for tau in (3, 10, 40):
                cols.append(np.exp(-v / tau)); fn.append(f"{n}~{tau}")
        else:
            cols.append(v); fn.append(n)
    # recent history (past only) of the picture and the logo
    for n in ("logo_ratio", "logo_seen", "change", "std", "mean"):
        v = a[:, ix[n]]
        for w in (5, 15, 30):
            c = np.convolve(v, np.ones(w) / w)[: len(v)]
            cols.append(c); fn.append(f"{n}@{w}")
    X = np.stack(cols, 1)
    # a window coming back after a restart (a gap in its recording) is loading for a minute or so: dark or a spinner, nothing anyone sees
    # covered or not; its 90 s are left out like a "not sure" mark
    gap = np.zeros(len(t), bool)
    for i in np.where(np.diff(t) > 20)[0]:
        gap |= (t > t[i]) & (t <= t[i + 1] + 90)
    for r0 in RESTARTS:                               # ... and Prism's own restarts (the recording goes on through them, dark and loading)
        gap |= (t >= r0 - 20) & (t <= r0 + 180)
    keep = rev & ~neu & ~gap
    ch = channel_at(win, t)
    return t[keep], X[keep], ad[keep].astype(float), a[keep, ix["active"]], fn, ch[keep]


CAPS = {w: captions_of(w) for w in rows}


_byw = {w: build(w) for w in labels if labels[w].get("ads") and w in rows}
GROUPWIN = {w: w for w in _byw}
if os.environ.get("BYCHANNEL") == "1":
    # each channel its own group (a window that changed channel is split at the change), scored by a model that never saw that channel
    data = {}
    for w, (t, X, y, act, fn, ch) in _byw.items():
        for c in dict.fromkeys(ch):
            k = ch == c
            if k.sum() < 600 or y[k].sum() < 60: continue          # too little of a channel to score it
            key = c if c not in data else c + " (2)"
            data[key] = (t[k], X[k], y[k], act[k], fn, ch[k]); GROUPWIN[key] = w
else:
    data = _byw


def fit(X, y, l2=1e-3, it=600, lr=0.5):
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = (X - mu) / sd
    w = np.zeros(Z.shape[1]); b = 0.0
    pos = y.mean()
    sw = np.where(y > 0, 0.5 / pos, 0.5 / (1 - pos))   # balance the two classes
    for _ in range(it):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        g = (p - y) * sw
        w -= lr * (Z.T @ g / len(y) + l2 * w); b -= lr * g.mean()
    return mu, sd, w, b


def predict(m, X):
    if isinstance(m, tuple) and m[0] == "seq":
        p1 = predict(m[1], X)
        return predict(m[2], np.hstack([X, seqfeat(p1)]))
    if isinstance(m, tuple):
        mu, sd, w, b = m
        return 1 / (1 + np.exp(-(((X - mu) / sd) @ w + b)))
    return m.predict_proba(X)[:, 1]


KIND = sys.argv[3] if len(sys.argv) > 3 else "logistic"
CAPFEAT = os.environ.get("CAPFEAT") == "1"
if KIND in ("trees", "seq"):
    # gradient-boosted trees (scikit-learn's histogram GBM): interactions the linear model cannot express, e.g. a missing logo meaning much
    # on a channel whose corner reads well and little on one whose corner is often unreadable
    from sklearn.ensemble import HistGradientBoostingClassifier
    _fit_linear = fit

    def fit(X, y, **k):
        pos = y.mean()
        sw = np.where(y > 0, 0.5 / pos, 0.5 / (1 - pos))
        m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=80, l2_regularization=1.0, random_state=0)
        m.fit(X, y, sample_weight=sw)
        return m


def seqfeat(p):
    """Stage 2's view of stage 1's chance, past only: its means, peaks and time above a level over the last 10 s to 2 minutes, how long since it
    was last high or low, and how long the current high run has lasted - the rhythm of a break (2-4 minutes, then the show), not one second."""
    from numpy.lib.stride_tricks import sliding_window_view as win
    cols = [p]
    for w in (10, 30, 60, 120):
        q = np.concatenate([np.full(w - 1, p[0]), p]); v = win(q, w)
        cols += [v.mean(1)] + ([v.max(1), (v > 0.7).mean(1)] if w in (30, 60, 120) else [])
    def since(mask, cap=300):
        out = np.empty(len(p)); last = -cap
        for i, m in enumerate(mask):
            if m: last = i
            out[i] = min(cap, i - last)
        return out
    cols += [since(p > 0.9), since(p < 0.2)]
    run = np.zeros(len(p)); r = 0
    for i, v in enumerate(p):
        r = r + 1 if v > 0.7 else 0; run[i] = min(r, 600)
    cols.append(run)
    return np.stack(cols, 1)


def cap_lines(g):
    """A group's caption lines and their labels (the marks 3 s before the line: captions run behind the picture)."""
    t, X, y = data[g][0], data[g][1], data[g][2]
    L = [(ct, txt) for ct, txt in CAPS.get(GROUPWIN[g], []) if t.min() <= ct <= t.max()]
    if not L: return [], np.array([]), np.array([])
    ct = np.array([c for c, _ in L]); idx = np.clip(np.searchsorted(t, ct - 3), 0, len(t) - 1)
    return [x for _, x in L], ct, y[idx]


def cap_text(x):
    # words, and a few marks of ad copy and of dialogue
    marks = []
    if re.search(r"[a-z0-9]\.(com|net|org)", x, re.I): marks.append("_url")
    if re.search(r"\d{3}[-. ]\d{3}[-. ]\d{4}|1-8\d\d", x): marks.append("_phone")
    if ">>" in x: marks.append("_speaker")
    if "?" in x: marks.append("_question")
    if re.search(r"\[[^\]]+\]", x): marks.append("_tag")
    return x.lower() + " " + " ".join(marks)


def cap_model(groups):
    from sklearn.feature_extraction.text import HashingVectorizer
    from sklearn.linear_model import LogisticRegression
    txt, yy = [], []
    for g in groups:
        L, _, ly = cap_lines(g); txt += [cap_text(x) for x in L]; yy += list(ly)
    hv = HashingVectorizer(n_features=2 ** 18, ngram_range=(1, 2), alternate_sign=False, norm="l2")
    lr = LogisticRegression(C=1.0, max_iter=400, class_weight="balanced")
    lr.fit(hv.transform(txt), np.array(yy))
    return lambda lines: lr.predict_proba(hv.transform([cap_text(x) for x in lines]))[:, 1] if lines else np.array([])


def cap_feat(g, scorer):
    """Each row's view of the captions so far: mean ad-ness over the last 8 and 20 s, lines in the last 20 s, seconds since the last line."""
    t = data[g][0]; L, ct, _ = cap_lines(g)
    out = np.zeros((len(t), 4)); out[:, 0] = out[:, 1] = 0.5; out[:, 3] = 60
    if not L: return out
    sc = scorer(L); cs = np.concatenate([[0], np.cumsum(sc)])
    for j, (w8, col) in enumerate(((8, 0), (20, 1))):
        a = np.searchsorted(ct, t - w8, side="left"); b = np.searchsorted(ct, t, side="right"); n = b - a
        out[:, col] = np.where(n > 0, (cs[b] - cs[a]) / np.maximum(n, 1), 0.5)
        if w8 == 20: out[:, 2] = n
    b = np.searchsorted(ct, t, side="right") - 1
    out[:, 3] = np.where(b >= 0, np.minimum(60, t - ct[np.maximum(b, 0)]), 60)
    return out


def policy(p, on, off, hold):
    """Covered or not each row: up once the chance has been above `on` for `hold` rows, down when it falls below `off`."""
    out = np.zeros(len(p), bool); up = False; run = 0
    for i, v in enumerate(p):
        run = run + 1 if v > on else 0
        if not up and run >= hold: up = True
        elif up and v < off: up = False
        out[i] = up
    return out


def score(cov, y):
    ads = y > 0
    return cov[ads].mean() if ads.any() else 0, cov[~ads].mean() if (~ads).any() else 0, ads.sum(), (~ads).sum()


wins = list(data)
OOF = {}
tot = {"rules": [0, 0, 0, 0], "model": [0, 0, 0, 0]}
for test in wins:
    tr = [w for w in wins if w != test]
    if CAPFEAT:
        full = cap_model(tr)
        XS = {w: np.hstack([data[w][1], cap_feat(w, cap_model([v for v in tr if v != w]))]) for w in tr}
        XS[test] = np.hstack([data[test][1], cap_feat(test, full)])
    else:
        XS = {w: data[w][1] for w in tr + [test]}
    X = np.concatenate([XS[w] for w in tr]); y = np.concatenate([data[w][2] for w in tr])
    m = fit(X, y)
    if KIND == "seq":
        # stage 2: trained on stage 1's out-of-fold chances on the training channels (each predicted by a stage 1 that never saw it), so it
        # learns from the mistakes stage 1 really makes; then applied to the held-out channel on top of a stage 1 trained on all the others
        Z, Zy = [], []
        for inner in tr:
            rest = [w for w in tr if w != inner]
            m1 = fit(np.concatenate([data[w][1] for w in rest]), np.concatenate([data[w][2] for w in rest]))
            Z.append(np.hstack([data[inner][1], seqfeat(predict(m1, data[inner][1]))])); Zy.append(data[inner][2])
        m2 = fit(np.concatenate(Z), np.concatenate(Zy))
        _m1 = m
        m = ("seq", _m1, m2)
    # the cover policy's thresholds chosen on the training channels: ads covered minus 20 x show wrongly covered
    best = None
    ptr = {w: predict(m, XS[w]) for w in tr}
    for on in (0.6, 0.7, 0.8, 0.9, 0.95):
        for off in (0.2, 0.3, 0.4, 0.5):
            for hold in (1, 2, 3, 5):
                c = np.concatenate([policy(ptr[w], on, off, hold) for w in tr])
                a_, s_, _, _ = score(c, y)
                v = a_ - 20 * s_
                if best is None or v > best[0]: best = (v, on, off, hold)
    _, on, off, hold = best
    t, _Xt, yt, act, fn, _ch = data[test]; Xt = XS[test]
    pt = predict(m, Xt); OOF[test] = pt
    cov = policy(pt, on, off, hold)
    ra, rs, na, ns = score(act > 0, yt)
    ma, ms, _, _ = score(cov, yt)
    print(f"{test[-18:]:>18}: rules ads {100*ra:5.1f}% wrong {100*rs:5.2f}%   model ads {100*ma:5.1f}% wrong {100*ms:5.2f}%   (on {on} off {off} hold {hold})")
    for k, (a_, s_) in (("rules", (ra, rs)), ("model", (ma, ms))):
        tot[k][0] += a_ * na; tot[k][1] += na; tot[k][2] += s_ * ns; tot[k][3] += ns
for k, v in tot.items():
    print(f"ALL {k}: ads covered {100*v[0]/v[1]:.1f}%  show wrongly covered {100*v[2]/v[3]:.2f}%")
if KIND == "logistic":
    m = fit(np.concatenate([data[w][1] for w in wins]), np.concatenate([data[w][2] for w in wins]))
    order = np.argsort(-np.abs(m[2]))[:15]
    print("strongest readings:", ", ".join(f"{data[wins[0]][4][i]} {m[2][i]:+.2f}" for i in order))

# the trade-off itself (out-of-fold predictions, every channel judged by a model that never saw it): the most ads covered while the show
# wrongly covered stays under each target. One policy for all channels: cover after 2 rows above `on`, uncover below on - 0.3
SPORT = ("TBS", "NFL Network", "NBC Sports Network", "-w3")
if os.environ.get("OOFOUT"):
    np.savez(os.environ["OOFOUT"], **{f"{w}|{k}": v for w in wins for k, v in (("p", OOF[w]), ("t", data[w][0]), ("y", data[w][2]), ("act", data[w][3]))})
for label, ws in (("all", wins), ("without sports", [w for w in wins if not any(x in w for x in SPORT)])):
  print("--", label)
  ys = np.concatenate([data[w][2] for w in ws])
  for target in (0.001, 0.005, 0.01, 0.02):
    best = None
    for on in np.arange(0.30, 0.995, 0.01):
        c = np.concatenate([policy(OOF[w], on, max(0.05, on - 0.3), 2) for w in ws])
        a_, s_, _, _ = score(c, ys)
        if s_ <= target and (best is None or a_ > best[0]): best = (a_, s_, on)
    print(f"wrong under {100*target:.1f}%: " + (f"ads covered {100*best[0]:.1f}% (wrong {100*best[1]:.2f}%, on {best[2]:.2f})" if best else "not reachable"))

# where the floor of wrong covers is: each channel at the strictest policy, and its longest wrongly covered stretches
on = 0.97
for w in wins:
    c = policy(OOF[w], on, on - 0.3, 2); y = data[w][2]; t = data[w][0]
    bad = c & (y == 0)
    runs = []; st = None
    for i in range(len(bad)):
        if bad[i] and st is None: st = i
        if (not bad[i] or i == len(bad) - 1) and st is not None:
            runs.append((int(t[i] - t[st]) + 1, int(t[st]))); st = None
    runs.sort(reverse=True)
    hm = lambda v: f"{v//3600:02d}:{v//60%60:02d}:{v%60:02d}"
    print(f"  {w[-18:]:>18} at on {on}: ads {100*c[y>0].mean():.0f}% wrong {100*bad.sum()/max(1,(y==0).sum()):.2f}%  longest: " + ", ".join(f"{n}s@{hm(s)}" for n, s in runs[:5]))
