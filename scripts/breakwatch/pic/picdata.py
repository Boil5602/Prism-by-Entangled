"""The picture study's data (2026-10-08): every marked second's kept frame, halved to 160x90, with its mark, its channel, and whether it is
a second the live trees were trained on (trained.json) or an exam's (exams.json). Nothing here is read by Prism.

    python scripts/breakwatch/pic/picdata.py <out.npz>

A ticker channel's marks are left out of the training side (NFL Network: most of its inset breaks are unmarked)."""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
DAYS = ["2026-10-07", "2026-10-08"]
NO_TRAIN = {"NFL Network"}
TRAINED = json.load(open(os.path.join(HERE, "..", "trained.json"), encoding="utf-8"))
EXAMS = json.load(open(os.path.join(HERE, "..", "exams.json"), encoding="utf-8"))


def sec(h):
    a, b, c = h.split(":"); return int(a) * 3600 + int(b) * 60 + int(c)


def inside(t, L):
    m = np.zeros(len(t), bool)
    for a, b in L: m |= (t >= sec(a)) & (t <= sec(b) + 0.99)
    return m


X, Y, TR, EX, CH, DAY, WIN, T = [], [], [], [], [], [], [], []
chans, wins = [], []
for di, day in enumerate(DAYS):
    labels = json.load(open(os.path.join(GOLDEN, day, "labels.json"), encoding="utf-8")).get("windows", {})
    for win, lab in labels.items():
        if not lab.get("ads"): continue
        d = os.path.join(GOLDEN, day, win)
        fr = []
        with os.scandir(d) as it:
            for e in it:
                if e.name.endswith(".gray") and time.strftime("%Y-%m-%d", time.localtime(e.stat().st_mtime)) == day:
                    n = e.name; fr.append((int(n[0:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6]) + int(n[6:9]) / 1000, n))
        fr.sort()
        t = np.array([x for x, _ in fr])
        info = [(a, b) for a, b in lab["ads"] if sec(b) - sec(a) > 480]
        keep = inside(t, lab.get("reviewed", [])) & ~inside(t, lab.get("neutral", [])) & ~inside(t, info)
        y = inside(t, lab["ads"])
        tr = keep & inside(t, TRAINED.get(day, {}).get(win, []))
        ex = np.full(len(t), -1, np.int8)
        for k, e in enumerate(EXAMS):
            if e["day"] == day and e["window"] == win: ex[keep & (t >= sec(e["from"])) & (t < sec(e["to"]))] = k
        tr &= ex < 0     # an exam's seconds are never training, whatever the manifest says
        marks = []
        for l in open(os.path.join(d, "events.log"), encoding="utf-8", errors="replace"):
            p = l.rstrip("\n").split(" ", 4)
            if len(p) == 5 and p[2] == "edge" and len(p[0]) == 9 and p[0].isdigit() and p[4].strip():
                marks.append((int(p[0][0:2]) * 3600 + int(p[0][2:4]) * 60 + int(p[0][4:6]), p[4].strip()))
        marks.sort()
        mt = np.array([m for m, _ in marks]) if marks else np.array([0])
        name = [marks[max(0, i)][1] if marks else "?" for i in np.searchsorted(mt, t, side="right") - 1]
        if win not in wins: wins.append(win)
        sel = np.flatnonzero(tr | (ex >= 0)); got = 0
        for i in sel:
            c = name[i]
            if tr[i] and c in NO_TRAIN: continue
            g = np.fromfile(os.path.join(d, fr[i][1]), np.uint8)
            if g.size != 57600: continue
            X.append(g.reshape(90, 2, 160, 2).mean((1, 3)).astype(np.uint8))
            if c not in chans: chans.append(c)
            Y.append(y[i]); TR.append(tr[i]); EX.append(ex[i]); CH.append(chans.index(c)); DAY.append(di); WIN.append(wins.index(win)); T.append(t[i]); got += 1
        print(f"{day} {win[-9:]:>9}: {len(t)} frames of the date, {int(tr.sum())} trained seconds, {int((ex >= 0).sum())} exam seconds, {got} kept", flush=True)
np.savez(sys.argv[1], X=np.stack(X), y=np.array(Y, np.uint8), tr=np.array(TR, bool), ex=np.array(EX, np.int8), ch=np.array(CH, np.int16), day=np.array(DAY, np.int8), win=np.array(WIN, np.int8),
         t=np.array(T, np.float64), chans=np.array(chans), wins=np.array(wins), exams=np.array([e["name"] for e in EXAMS]))
tr = np.array(TR, bool); y = np.array(Y, bool); ch = np.array(CH)
print("training frames", int(tr.sum()), "ads", int((tr & y).sum()), "| exam frames", int((~tr).sum()), "ads", int((~tr & y).sum()))
for k, c in enumerate(chans): print(f"   {c:<22} train {int((tr & (ch == k)).sum()):>6} (ads {int((tr & y & (ch == k)).sum()):>5})   exam {int((~tr & (ch == k)).sum()):>6}")
