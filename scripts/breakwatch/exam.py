"""An exam: marked hours no model has trained on, replayed through each detector, scored against the marks, and split by cause.

    python scripts/breakwatch/exam.py <golden day> <window> <from HH:MM:SS> <to HH:MM:SS> <name>=<calls log> [<name>=<calls log> ...]
    python scripts/breakwatch/exam.py --library <golden day> <from HH:MM:SS>     the library copy to replay with (BWDIR)
    ... --trained scripts/breakwatch/trained.json                                leave out seconds the live model was trained on

A calls log holds a detector's covers as host.log lines ("HH:MM:SS.mmm break watch <window>: break|show (...)"): the replay harness's
LCALLS for a learned model, its bench log for the hand rules, or the day's own calls.log for what Prism showed.

Per detector, of the marked ad time: the share covered, and where the rest went - the cover began late, dropped in the middle of a break,
lifted early, or the break was missed whole. Of ALL show time in the stretch: the share wrongly covered, and whether that was a cover
staying on after a break, one that came up just ahead of a break, or one on its own in the middle of a show. The last is what the 0.1%
target speaks of; the edges are a few seconds a break and are tracked in seconds.

Only seconds the recording holds a frame for are scored. The range after each share is a 90% interval from resampling the breaks (each
with the show time around it): a handful of breaks is a small sample, and two detectors whose ranges overlap have not been told apart.
"""
import json
import os
import re
import sys

import numpy as np

GOLDEN = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")


def sec(h):
    x, y, z = h.split(":"); return int(x) * 3600 + int(y) * 60 + int(z)


if len(sys.argv) >= 4 and sys.argv[1] == "--library":
    # what Prism knew before the stretch: the newest library copy keep.py made at or before <from>
    root = os.path.join(GOLDEN, sys.argv[2], "library")
    want = sys.argv[3].replace(":", "")
    have = sorted(d for d in (os.listdir(root) if os.path.isdir(root) else []) if d <= want)
    print(os.path.join(root, have[-1]) if have else "none before " + sys.argv[3])
    sys.exit(0 if have else 1)

TRAINED = None
if "--trained" in sys.argv:
    i = sys.argv.index("--trained"); TRAINED = json.load(open(sys.argv[i + 1], encoding="utf-8")); del sys.argv[i:i + 2]
day, win, a, b = sys.argv[1:5]
G = os.path.join(GOLDEN, day)
A, B = sec(a), sec(b)
lab = json.load(open(os.path.join(G, "labels.json"), encoding="utf-8"))["windows"][win]
T = np.arange(A, B + 1)
rev = np.zeros(len(T), bool); ads = np.zeros(len(T), bool)
for x, y in lab.get("reviewed", []): rev[max(0, sec(x) - A):max(0, sec(y) - A + 1)] = True
breaks = sorted((max(sec(x), A), min(sec(y), B)) for x, y in lab.get("ads", []) if sec(y) > A and sec(x) < B)
for x, y in breaks: ads[x - A:y - A + 1] = True
for x, y in lab.get("neutral", []): rev[max(0, sec(x) - A):max(0, sec(y) - A + 1)] = False
# only the seconds the recording holds a frame for (within 3 s): a stretch with no frames could not be looked at, and a replay's cover
# left up across it is no cover of anything
has = np.zeros(len(T), bool)
for f in os.listdir(os.path.join(G, win)):
    if f.endswith(".gray"):
        t = int(f[:2]) * 3600 + int(f[2:4]) * 60 + int(f[4:6])
        if A - 3 <= t <= B + 3: has[max(0, t - A - 3):max(0, t - A + 4)] = True
gaps = int((rev & ~has).sum())
rev &= has
# ... and none the model was trained on (train2.py's manifest): that would be an open-book exam
if TRAINED:
    seen = np.zeros(len(T), bool)
    for x, y in TRAINED.get(day, {}).get(win, []): seen[max(0, sec(x) - A):max(0, sec(y) - A + 1)] = True
    if (rev & seen).any(): print(f"   {int((rev & seen).sum())} of these seconds are in the model's training: left out")
    rev &= ~seen
print(f"{day} {win} {a}-{b}: {int(rev.sum())} reviewed seconds with frames ({gaps} s reviewed with none, left out), {len(breaks)} marked breaks, {int((ads & rev).sum())} ad s, {int((~ads & rev).sum())} show s")

# each break with the show time around it, to the midpoints between breaks: the unit the intervals resample
cuts = [0] + [((breaks[i][1] + breaks[i + 1][0]) // 2) - A for i in range(len(breaks) - 1)] + [len(T)]
blocks = [(cuts[i], cuts[i + 1]) for i in range(len(breaks))] if breaks else [(0, len(T))]
rng = np.random.default_rng(0)


def interval(num, den):
    """90% interval of sum(num)/sum(den) over resampled blocks."""
    num, den = np.asarray(num, float), np.asarray(den, float)
    if len(num) < 3 or den.sum() == 0: return ""
    pick = rng.integers(0, len(num), (2000, len(num)))
    r = num[pick].sum(1) / np.maximum(1, den[pick].sum(1))
    return f" [{100 * np.percentile(r, 5):.1f}-{100 * np.percentile(r, 95):.1f}]"


for spec in sys.argv[5:]:
    name, path = spec.split("=", 1)
    cov = np.zeros(len(T), bool); up = None; n = 0
    for l in open(path, encoding="utf-8", errors="replace"):
        m = re.match(r"(\d\d):(\d\d):(\d\d)\.\d+ break watch " + re.escape(win) + r": (break|show) ", l)
        if not m:
            # a restart, or the person's Not an ad, takes a cover down too (Prism's own calls for the day)
            m2 = re.match(r"(\d\d):(\d\d):(\d\d)", l)
            if m2 and up is not None and ("brain ready" in l or ("break watch " + win + ":" in l and "said Not an ad" in l)):
                t = int(m2.group(1)) * 3600 + int(m2.group(2)) * 60 + int(m2.group(3))
                cov[max(0, up - A):max(0, t - A)] = True; up = None
            continue
        t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        if m.group(4) == "break":
            if up is None:
                up = t
                if A <= t <= B: n += 1
        elif up is not None:
            cov[max(0, up - A):max(0, t - A)] = True; up = None
    if up is not None: cov[max(0, up - A):] = True

    # the marked ad time that went uncovered, by cause
    late = mid = early = whole = 0; begins, stays = [], []
    for x, y in breaks:
        i0, i1 = x - A, y - A
        seg = cov[i0:i1 + 1]; ok = rev[i0:i1 + 1]
        if not seg.any(): whole += int(ok.sum()); continue
        first = int(np.argmax(seg)); last = len(seg) - 1 - int(np.argmax(seg[::-1]))
        late += int((~seg[:first] & ok[:first]).sum())
        early += int((~seg[last + 1:] & ok[last + 1:]).sum())
        mid += int((~seg[first:last + 1] & ok[first:last + 1]).sum())
        begins.append(first)
        after = cov[i1 + 1:i1 + 181]
        stays.append(int(np.argmax(~after)) if (~after).any() else 180)
    # the show time that was covered, by kind
    wrong = cov & ~ads & rev
    edge = np.diff(np.concatenate([[0], wrong.astype(int), [0]])); starts = np.flatnonzero(edge == 1); ends = np.flatnonzero(edge == -1)
    linger = ahead = own = owns = 0
    for s, e in zip(starts, ends):
        if ads[max(0, s - 4):s].any(): linger += e - s
        elif ads[e:e + 4].any(): ahead += e - s
        else: own += e - s; owns += 1
    ad_s, show_s = int((ads & rev).sum()), int((~ads & rev).sum())
    blk = [(int((cov & ads & rev)[i:j].sum()), int((ads & rev)[i:j].sum()), int(wrong[i:j].sum()), int((~ads & rev)[i:j].sum())) for i, j in blocks]
    med = lambda v: int(np.median(v)) if v else -1
    print(f"   {name}")
    print(f"      ads covered {100 * (cov & ads & rev).sum() / max(1, ad_s):5.1f}%{interval([x[0] for x in blk], [x[1] for x in blk])}"
          f"   missed {ad_s - int((cov & ads & rev).sum())} s: began late {late}, dropped mid-break {mid}, lifted early {early}, breaks missed whole {whole}")
    print(f"      show wrongly covered {100 * wrong.sum() / max(1, show_s):5.2f}%{interval([x[2] for x in blk], [x[3] for x in blk])} ({int(wrong.sum())} s):"
          f" stayed on after a break {linger}, came up ahead of one {ahead}, on their own {own} s in {owns} covers ({100 * own / max(1, show_s):.3f}% of show time)")
    print(f"      covers {n}; a cover begins {med(begins)} s into a break and stays {med(stays)} s after it (medians)")
