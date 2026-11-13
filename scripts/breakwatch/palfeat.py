"""The palette as tree inputs (2026-11-10; the redesign's addendum Phase D, decided 2026-11-10: the palette enters as columns, never as a
return rule). Every column is a plain function of the recorded palette stream (events.log, a 4x4x4 RGB histogram a frame), read backwards
only, so a runtime can compute it as it looks; none reads the cover's state.

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/palfeat.py build <golden day> <window> <out.csv>
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/palfeat.py eval <golden day> <window> <HH:MM:SS> <HH:MM:SS>
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/palfeat.py join <pal.csv> <window> <feat.csv> <feat2.csv>

Columns, one row a second that has a palette (t = seconds of the day):
  pal_f      the distance of this second's palette to the second before (total variation, 0 to 1)
  pal_j      the distance of the last three seconds' mean palette to the three before them (a cut that changed the look, read 3 s late)
  pal_pod    how many of the last 60 s had a big jump (pal_j >= 0.5 with pal_f >= 0.25 three seconds before): a pod changes its look
             every 15 or 30 s, a show keeps its grade
  pal_since  seconds since the last big jump, capped at 120
  pal_blind  the distance to the nearest palette of the seconds from 11 minutes to 1 minute ago (BL_FROM, BL_TO): low when the picture
             looks like something the channel showed in the last ten minutes that is not this same spot
  pal_mean   the distance to the mean palette of those same seconds

eval prints each column's AUC (ad against show, the day's labels, promos and neutral time left out) over the stretch, and pal_blind's
for a few choices of its window. join appends the columns to a feature CSV by window and time (a row with no palette within 1.5 s gets
PAL_NONE, -1, so the trees can tell "no palette" from a reading)."""
import csv, io, json, os, sys
import numpy as np

G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
BL_FROM, BL_TO = 660, 60
COLS = ["pal_f", "pal_j", "pal_pod", "pal_since", "pal_blind", "pal_mean"]
PAL_NONE = -1


def secs(hms):
    h, m, s = hms.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)


def load_palette(day, window):
    """H[s]: the normalised 64-bin histogram of the last frame of second s (NaN where no frame within 3 s)."""
    p = os.path.join(G, day, window, "events.log")
    H = np.full((86400, 64), np.nan, dtype=np.float32); last = -1e9; lastv = None; filled = -1
    for line in io.open(p, encoding="utf-8", errors="replace"):
        sp = line.split()
        if len(sp) < 4 or sp[2] != "palette" or len(sp[3]) != 128: continue
        n = sp[0]; t = int(n[:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6]) + int(n[6:9]) / 1000
        try: v = np.frombuffer(bytes.fromhex(sp[3]), dtype=np.uint8).astype(np.float32)
        except ValueError: continue
        tot = v.sum()
        if tot <= 0: continue
        s = int(t)
        if lastv is not None:
            for g in range(max(filled + 1, int(last)), min(s, int(last) + 3)):
                H[g] = lastv; filled = g
        H[s] = v / tot; filled = s; last = t; lastv = v / tot
    return H


def tv(a, b):
    return 0.5 * np.abs(a - b).sum(axis=-1)


def blind(H, have, a, b, lo=BL_FROM, hi=BL_TO):
    """(nearest, to the mean) distance of each second in [a, b) to the palettes of the seconds from lo to hi seconds before it."""
    near = np.full(86400, np.nan, dtype=np.float32); mean = np.full(86400, np.nan, dtype=np.float32)
    for s in range(a, b):
        if not have[s]: continue
        w0, w1 = max(0, s - lo), max(0, s - hi)
        m = have[w0:w1]
        if m.sum() < 30: continue
        vs = H[w0:w1][m]
        near[s] = float(tv(vs, H[s]).min()); mean[s] = float(tv(vs.mean(0), H[s]))
    return near, mean


def columns(H, a=0, b=86400, lo=BL_FROM, hi=BL_TO):
    have = ~np.isnan(H[:, 0]); N = 86400
    F = np.full(N, np.nan, dtype=np.float32); J = np.full(N, np.nan, dtype=np.float32)
    ok = have[1:] & have[:-1]; F[1:][ok] = tv(H[1:], H[:-1])[ok]
    for s in range(max(6, a - 200), b):
        if have[s - 5:s + 1].all(): J[s] = tv(H[s - 5:s - 2].mean(0), H[s - 2:s + 1].mean(0))
    big = np.zeros(N, bool)
    big[3:] = (np.nan_to_num(J[3:]) >= 0.5) & (np.nan_to_num(F[:-3]) >= 0.25)
    pod = np.convolve(big.astype(np.float32), np.ones(60, dtype=np.float32))[:N]
    since = np.full(N, 120.0, dtype=np.float32); last = -1e9
    for s in range(max(0, a - 200), b):
        if big[s]: last = s
        since[s] = min(120.0, s - last)
    near, mean = blind(H, have, a, b, lo, hi)
    return have, dict(pal_f=F, pal_j=J, pal_pod=pod, pal_since=since, pal_blind=near, pal_mean=mean)


def labels(day, window):
    L = json.load(io.open(os.path.join(G, day, "labels.json"), encoding="utf-8"))["windows"][window]
    is_ad = np.zeros(86400, bool); is_neu = np.zeros(86400, bool)
    for x, y in L.get("ads", []): is_ad[int(secs(x)):int(secs(y)) + 1] = True
    neu = L.get("neutral") if isinstance(L.get("neutral"), list) else []
    pf = os.path.join(G, day, "labels.promos.json"); promos = []
    if os.path.exists(pf):
        try:
            pw = json.load(io.open(pf, encoding="utf-8")).get("windows", {}).get(window, {})
            promos = pw.get("promos", pw.get("ads", []))
        except Exception: promos = []
    for x, y in list(neu) + list(promos): is_neu[int(secs(x)):int(secs(y)) + 1] = True
    return is_ad, is_neu


def auc(pos, neg):
    pos = np.asarray(pos, dtype=np.float64); neg = np.asarray(neg, dtype=np.float64)
    pos = pos[~np.isnan(pos)]; neg = neg[~np.isnan(neg)]
    if not len(pos) or not len(neg): return None
    allv = np.concatenate([pos, neg]); order = allv.argsort(kind="mergesort"); ranks = np.empty(len(allv)); ranks[order] = np.arange(1, len(allv) + 1)
    # ties: mean rank
    sv = allv[order]; i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]: j += 1
        if j > i: ranks[order[i:j + 1]] = (i + j + 2) / 2
        i = j + 1
    return round(float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))), 3)


def build(day, window, out):
    H = load_palette(day, window)
    have, c = columns(H)
    n = 0
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["t"] + COLS)
        for s in np.flatnonzero(have):
            row = [c[k][s] for k in COLS]
            w.writerow([int(s)] + [PAL_NONE if np.isnan(v) else round(float(v), 4) for v in row]); n += 1
    print(f"{out}: {n} seconds with a palette")


def evaluate(day, window, a, b):
    H = load_palette(day, window); a, b = int(secs(a)), int(secs(b))
    is_ad, is_neu = labels(day, window)
    have, c = columns(H, a, b)
    sel = np.zeros(86400, bool); sel[a:b] = True; sel &= have & ~is_neu
    print(f"{day} {window} {a}..{b}: {int((sel & is_ad).sum())} ad s, {int((sel & ~is_ad).sum())} show s")
    for k in COLS: print(f"  {k:10s} AUC {auc(c[k][sel & is_ad], c[k][sel & ~is_ad])}")
    for lo, hi in ((330, 30), (360, 60), (660, 60), (690, 90), (960, 60), (1260, 60), (720, 120)):
        near, mean = blind(H, have, a, b, lo, hi)
        print(f"  blind {lo:4d}..{hi:3d} s ago: nearest AUC {auc(near[sel & is_ad], near[sel & ~is_ad])}, mean AUC {auc(mean[sel & is_ad], mean[sel & ~is_ad])}")


def join(pal, window, feat, feat2):
    rows = np.loadtxt(pal, delimiter=",", skiprows=1, ndmin=2); tt = rows[:, 0]
    n = 0; hit = 0
    with open(feat, newline="", encoding="utf-8") as fi, open(feat2, "w", newline="", encoding="utf-8") as fo:
        rd = csv.reader(fi); wr = csv.writer(fo); head = next(rd); wr.writerow(head + COLS)
        for row in rd:
            add = [PAL_NONE] * len(COLS)
            if row[0] == window and len(tt):
                t = float(row[1]); k = int(np.searchsorted(tt, int(t)))
                for q in (k, k - 1):
                    if 0 <= q < len(tt) and abs(tt[q] - t) <= 1.5:
                        add = [("%g" % v) for v in rows[q, 1:]]; hit += 1; break
            wr.writerow(row + add); n += 1
    print(f"{feat2}: {n} rows, {hit} with a palette row")


if __name__ == "__main__":
    os.environ.setdefault("PROMOS", "show")
    if len(sys.argv) < 2: print(__doc__)
    elif sys.argv[1] == "build": build(*sys.argv[2:5])
    elif sys.argv[1] == "eval": evaluate(*sys.argv[2:6])
    elif sys.argv[1] == "join": join(*sys.argv[2:6])
    else: print(__doc__)
