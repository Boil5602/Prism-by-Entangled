"""The learned break detector's inputs, shared by train.py and prefill.py (2026-10-07).

Each window's rows (bwtest bench with FEATCSV=...: one per frame, the break model's readings after it) become one feature vector a row:
every reading as it is, each "seconds since" as three recency kernels exp(-s/tau), and the picture's and the logo's recent history as
causal rolling means. Past only, so the same features work live.
"""
import csv

import numpy as np

SKIP = ("chance", "active")   # the hand rules' own outputs: the baseline, never an input


def load(path):
    rows = {}
    with open(path, newline="") as f:
        r = csv.reader(f)
        head = next(r)
        for line in r:
            rows.setdefault(line[0], []).append([float(x) for x in line[1:]])
    names = head[2:]
    ix = {n: i + 1 for i, n in enumerate(names)}   # column 0 is t
    return {w: np.array(sorted(v, key=lambda x: x[0])) for w, v in rows.items()}, names, ix


ROLL_SIGNALS = ("logo_ratio", "logo_seen", "change", "std", "mean")
ROLL_WINDOWS = (5, 15, 30)


def features(a, names, ix, skip=SKIP, taus=(3, 10, 40), by_seconds=False):
    """by_seconds (2026-10-08): the rolling means are over the last w SECONDS, not the last w rows. The recordings are made with Ad debug
    on, a look a second on every window; without it a quiet small window is looked at every two, and a mean over "the last 5 rows" spans
    ten seconds there - the model would read every household's small windows differently from what it was trained on."""
    cols, fn = [], []
    for n in names:
        if n in skip:
            continue
        v = a[:, ix[n]]
        if n.startswith("since_"):
            for tau in taus:
                cols.append(np.exp(-v / tau)); fn.append(f"{n}~{tau}")
        else:
            cols.append(v); fn.append(n)
    t = a[:, 0]
    for n in ROLL_SIGNALS:
        v = a[:, ix[n]]
        cs = np.concatenate([[0.0], np.cumsum(v)])
        for w in ROLL_WINDOWS:
            if by_seconds:
                lo = np.searchsorted(t, t - w, side="right")          # the first row later than t - w
                hi = np.arange(1, len(t) + 1)
                cols.append((cs[hi] - cs[lo]) / np.maximum(1, hi - lo))
            else:
                cols.append(np.convolve(v, np.ones(w) / w)[: len(v)])
            fn.append(f"{n}@{w}")
    return np.stack(cols, 1), fn


def gbm():
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=80, l2_regularization=1.0, random_state=0)


def balanced(y):
    pos = y.mean()
    return np.where(y > 0, 0.5 / pos, 0.5 / (1 - pos))


# ---- the caption classifier, in a form Prism reproduces exactly (2026-10-07): explicit words, no hashing ----
import re as _re

_URL = _re.compile(r"[a-z0-9]\.(com|net|org)", _re.I)
_PHONE = _re.compile(r"\d{3}[-. ]\d{3}[-. ]\d{4}|1-8\d\d")
_TAG = _re.compile(r"\[[^\]]+\]")
_WORD = _re.compile(r"[a-z0-9']+")


def cap_tokens(x):
    """A caption line's tokens: its lowercase words (letters, digits, apostrophes) of two characters or more, each pair of neighbouring words,
    and marks for an address, a phone number, a speaker change (>>), a question and a [tag]. Prism's LearnedBreak.CapTokens is the same."""
    words = [w for w in _WORD.findall(x.lower()) if len(w) >= 2]
    toks = set(words) | {words[i] + " " + words[i + 1] for i in range(len(words) - 1)}
    if _URL.search(x): toks.add("_url")
    if _PHONE.search(x): toks.add("_phone")
    if ">>" in x: toks.add("_speaker")
    if "?" in x: toks.add("_question")
    if _TAG.search(x): toks.add("_tag")
    return toks


class CapModel:
    """Logistic regression over the presence of each token (rows normalised to unit length), class-balanced; tokens seen fewer than 3 times
    are left out. Exported as {token: weight} and an intercept."""

    def fit(self, lines, y):
        from sklearn.linear_model import LogisticRegression
        from collections import Counter
        cnt = Counter(t for x in lines for t in cap_tokens(x))
        self.vocab = {t: i for i, (t, c) in enumerate(sorted(cnt.items())) if c >= 3}
        self.vocab = {t: i for i, t in enumerate(self.vocab)}
        lr = LogisticRegression(C=1.0, max_iter=500, class_weight="balanced")
        lr.fit(self._matrix(lines), np.asarray(y))
        self.w = lr.coef_[0]; self.b = float(lr.intercept_[0])
        return self

    def _matrix(self, lines):
        from scipy.sparse import csr_matrix
        r, c = [], []
        for i, x in enumerate(lines):
            for t in cap_tokens(x):
                j = self.vocab.get(t)
                if j is not None: r.append(i); c.append(j)
        m = csr_matrix((np.ones(len(r)), (r, c)), shape=(len(lines), len(self.vocab)))
        n = np.sqrt(np.asarray(m.sum(1)).ravel()); n[n == 0] = 1
        return csr_matrix(m.multiply(1 / n[:, None]))

    def score(self, lines):
        if not lines: return np.array([])
        z = self._matrix(lines) @ self.w + self.b
        return 1 / (1 + np.exp(-z))

    def export(self):
        return {"intercept": self.b, "weights": {t: float(self.w[i]) for t, i in self.vocab.items()}}   # every word: each counts in a line's length


def cap_feat(t, ct, sc):
    """Each row's view of the captions so far: mean ad-ness over the last 8 and 20 s (0.5 with none), lines in the last 20 s, seconds since
    the last line (60 at most). t: the rows' times; ct, sc: the caption lines' times and scores, in time order."""
    out = np.zeros((len(t), 4)); out[:, 0] = out[:, 1] = 0.5; out[:, 3] = 60
    if len(ct) == 0: return out
    cs = np.concatenate([[0], np.cumsum(sc)])
    for w, col in ((8, 0), (20, 1)):
        a = np.searchsorted(ct, t - w, side="left"); b = np.searchsorted(ct, t, side="right"); n = b - a
        out[:, col] = np.where(n > 0, (cs[b] - cs[a]) / np.maximum(n, 1), 0.5)
        if w == 20: out[:, 2] = n
    b = np.searchsorted(ct, t, side="right") - 1
    out[:, 3] = np.where(b >= 0, np.minimum(60, t - ct[np.maximum(b, 0)]), 60)
    return out
