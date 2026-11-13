"""Phase A2 of the redesign's addendum (2026-11-08): AUC over the seconds within 30 s of a labelled boundary, beside the whole-set AUC.

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/boundary-auc.py <exams.json> <label>=<chance folder or wide parity folder> [...]

A chance folder is cnn.py's <out>/par (win,t,p per exam: the network's chance a frame); a wide parity folder is run_exams' LPWIDE stream
(the trees' chance in its 'trees' column, the blend in 'p'). For every exam the labelled seconds (reviewed, not neutral, infomercials
left out, promos as show) are scored: the whole-set AUC, and the AUC over the seconds within 30 s of a break's labelled start or end.
Frame-level AUC did not order the networks the way the bench does (the interim's finding); this is the candidate replacement.
"""
import csv
import json
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import promos as _promos
GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
os.environ.setdefault("PROMOS", "show")


def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
def name(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])


def auc(p, y):
    o = np.argsort(p); r = np.empty(len(p)); r[o] = np.arange(1, len(p) + 1)
    pos = y == 1; n1, n0 = pos.sum(), (~pos).sum()
    return (r[pos].sum() - n1 * (n1 + 1) / 2) / max(1, n1 * n0) if n1 and n0 else float("nan")


def labels_for(e):
    G = os.path.join(GOLD, e["day"]); lab = json.load(open(os.path.join(G, "labels.json"), encoding="utf-8"))["windows"][e["window"]]
    ads = lab.get("ads", [])
    if _promos.on(): ads = _promos.ads_for(G, e["window"], ads)
    return [(sec(a), sec(b)) for a, b in ads], [(sec(a), sec(b)) for a, b in lab.get("reviewed", [])], [(sec(a), sec(b)) for a, b in lab.get("neutral", []) + lab.get("infomercials", [])]


def chances(folder, e, column):
    path = os.path.join(folder, name(e) + ".csv")
    if not os.path.exists(path): return None
    out = []
    with open(path, newline="") as f:
        rd = csv.DictReader(f)
        col = column if column in (rd.fieldnames or []) else "p"
        for row in rd:
            try: out.append((float(row["t"]), float(row[col])))
            except (KeyError, ValueError): continue
    return out


exams = json.load(open(sys.argv[1], encoding="utf-8"))
specs = [s.split("=", 1) for s in sys.argv[2:]]
print("| model | whole-set AUC | boundary AUC (within 30 s of a labelled start or end) | seconds (whole / boundary) |\n|---|---|---|---|")
for label, folder in specs:
    column = "trees" if label.lower().startswith("trees") else ("p" if label.lower().startswith("blend") else "p")
    P, Y, B = [], [], []
    for e in exams:
        ch = chances(folder, e, column)
        if not ch: continue
        ads, rev, neu = labels_for(e)
        edges = [x for a, b in ads for x in (a, b)]
        a0, b0 = sec(e["from"]), sec(e["to"])
        for t, p in ch:
            if not (a0 <= t < b0) or not any(x <= t < y for x, y in rev) or any(x <= t < y for x, y in neu): continue
            P.append(p); Y.append(1 if any(x <= t < y for x, y in ads) else 0); B.append(any(abs(t - x) <= 30 for x in edges))
    if not P: print(f"| {label} | (no chances found) | | |"); continue
    P, Y, B = np.array(P), np.array(Y), np.array(B)
    print(f"| {label} | {auc(P, Y):.3f} | {auc(P[B], Y[B]):.3f} | {len(P)} / {int(B.sum())} |", flush=True)
