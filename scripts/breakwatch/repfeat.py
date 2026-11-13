"""Addendum Phase E1 (2026-11-08): repetition as a tree feature, with the temporal split that keeps training honest.

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/repfeat.py build <out folder>       the per-second features for every window-day
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/repfeat.py join <out folder> <feat.csv> <golden day> <feat2.csv>
                                                                                              a day's training features with the two columns added

For a frame on day D the library is every usable frame hash of the window-days BEFORE D (strictly earlier days: the same day's other
windows may be the same channel at the same time, and the runtime library in a pack is built from recordings before the model's days
end). rep_near = a frame within 6 bits exists in that library; rep_count15 = how many of the last 15 s had one. Written per window-day
to <out>/<day>/<window>.csv (t, rep_near, rep_count15) and summarised: the library's size by day and the share of ad and show seconds
marked, from the labels.

join appends the two columns to a day's feature CSV (train2.py reads whatever columns the header names, so the retrained trees take
them as inputs; a frame with no feature row, the first day, gets zeros, which is also what a runtime without a library would give).
"""
import csv
import glob
import json
import os
import sys

import numpy as np

GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
NEAR = 6; FLAT_LO, FLAT_HI = 8, 55; MAX_BUCKET = 4000
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def popcount64(a):
    a = a.astype(np.uint64)
    a = a - ((a >> np.uint64(1)) & np.uint64(0x5555555555555555))
    a = (a & np.uint64(0x3333333333333333)) + ((a >> np.uint64(2)) & np.uint64(0x3333333333333333))
    a = (a + (a >> np.uint64(4))) & np.uint64(0x0F0F0F0F0F0F0F0F)
    return ((a * np.uint64(0x0101010101010101)) >> np.uint64(56)).astype(np.int64)


def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)


def near_any(query, library):
    """For each query hash, whether any library hash is within NEAR bits: by the four 16-bit bands, verified on the full word."""
    hit = np.zeros(len(query), bool)
    if not len(library) or not len(query): return hit
    for band in range(4):
        shift = np.uint64(16 * band); mask = np.uint64(0xFFFF)
        lk = ((library >> shift) & mask).astype(np.int64); order = np.argsort(lk, kind="stable"); lks = lk[order]; lib_sorted = library[order]
        qk = ((query >> shift) & mask).astype(np.int64)
        lo = np.searchsorted(lks, qk, "left"); hi = np.searchsorted(lks, qk, "right")
        for i in np.flatnonzero((hi > lo) & ~hit):
            cand = lib_sorted[lo[i]:hi[i]]
            if len(cand) > MAX_BUCKET: continue
            if (popcount64(cand ^ query[i]) <= NEAR).any(): hit[i] = True
    return hit


def build(out):
    os.makedirs(out, exist_ok=True)
    days = sorted(os.path.basename(d) for d in glob.glob(os.path.join(GOLD, "2026-*")))
    library = np.zeros(0, np.uint64); summary = []
    import promos as _promos
    for day in days:
        wins = sorted(w for w in glob.glob(os.path.join(GOLD, day, "*")) if os.path.exists(os.path.join(w, "phash.npz")))
        lab_path = os.path.join(GOLD, day, "labels.json"); labels = json.load(open(lab_path, encoding="utf-8")).get("windows", {}) if os.path.exists(lab_path) else {}
        day_hashes = []; ad_n = ad_r = sh_n = sh_r = 0
        os.makedirs(os.path.join(out, day), exist_ok=True)
        for w in wins:
            win = os.path.basename(w); z = np.load(os.path.join(w, "phash.npz")); t, h = z["t"], z["h"].astype(np.uint64)
            pc = popcount64(h); usable = (pc >= FLAT_LO) & (pc <= FLAT_HI)
            near = np.zeros(len(h), bool); near[usable] = near_any(h[usable], library)
            cnt = np.zeros(len(h), np.int32); j = 0
            for i in range(len(h)):
                while t[i] - t[j] > 15: j += 1
                cnt[i] = int(near[j:i + 1].sum())
            np.savez(os.path.join(out, day, win + ".npz"), t=t, h=h, near=near)   # for the library export
            with open(os.path.join(out, day, win + ".csv"), "w", newline="") as f:
                wr = csv.writer(f); wr.writerow(["t", "rep_near", "rep_count15"])
                for i in range(len(h)): wr.writerow([f"{t[i]:.3f}", int(near[i]), int(cnt[i])])
            day_hashes.append(h[usable])
            lab = labels.get(win)
            if lab and lab.get("ads"):
                ads = lab["ads"]
                if _promos.on(): ads = _promos.ads_for(os.path.join(GOLD, day), win, ads)
                ads = [(sec(a), sec(b)) for a, b in ads]; rev = [(sec(a), sec(b)) for a, b in lab.get("reviewed", [])]
                for i in range(len(h)):
                    if not any(a <= t[i] < b for a, b in rev): continue
                    if any(a <= t[i] < b for a, b in ads): ad_n += 1; ad_r += int(near[i])
                    else: sh_n += 1; sh_r += int(near[i])
        row = dict(day=day, library_frames=int(len(library)), windows=len(wins), ad_s=ad_n, ad_marked_pct=round(100 * ad_r / max(1, ad_n), 1), show_s=sh_n, show_marked_pct=round(100 * sh_r / max(1, sh_n), 2))
        summary.append(row); print(row, flush=True)
        if day_hashes: library = np.concatenate([library] + day_hashes)
    json.dump(summary, open(os.path.join(out, "summary.json"), "w", encoding="utf-8"), indent=1)
    print("library at the end:", len(library), "frames,", round(len(library) * 8 / 1e6, 1), "MB of hashes")


def join(out, feat, day_dir, feat2):
    day = os.path.basename(day_dir.rstrip("/\\"))
    tables = {}
    for f in glob.glob(os.path.join(out, day, "*.csv")):
        win = os.path.basename(f)[:-4]; rows = np.loadtxt(f, delimiter=",", skiprows=1, ndmin=2)
        tables[win] = (rows[:, 0], rows[:, 1], rows[:, 2])
    n = 0; hit = 0
    with open(feat, newline="", encoding="utf-8") as fi, open(feat2, "w", newline="", encoding="utf-8") as fo:
        rd = csv.reader(fi); wr = csv.writer(fo); head = next(rd); wr.writerow(head + ["rep_near", "rep_count15"])
        for row in rd:
            win, t = row[0], float(row[1]); a, b = 0, 0
            if win in tables:
                tt, near, cnt = tables[win]; k = np.searchsorted(tt, t)
                if k < len(tt) and abs(tt[k] - t) <= 1.5: a, b = int(near[k]), int(cnt[k]); hit += 1
                elif k > 0 and abs(tt[k - 1] - t) <= 1.5: a, b = int(near[k - 1]), int(cnt[k - 1]); hit += 1
            wr.writerow(row + [a, b]); n += 1
    print(f"{feat2}: {n} rows, {hit} with a repetition row")


def export(out, lib_path, before, every=False):
    """The pack's library: the hashes of frames that recur with an EARLIER day (near == True in the build), from days before `before`,
    unique; written as PRL1 + int32 count + uint64s (RepLibrary.Load). every=True (export-all, 2026-11-09): every usable frame of those
    days instead, which is what the build's own readings were computed against (the recurring-only library gave the seven nothing: no
    day before 10-08 had a day before it to recur with)."""
    hs = []
    for d in sorted(glob.glob(os.path.join(out, "2026-*"))):
        day = os.path.basename(d)
        if day >= before: continue
        for f in glob.glob(os.path.join(d, "*.npz")):
            z = np.load(f); h = z["h"].astype(np.uint64)
            if every:
                pc = popcount64(h); hs.append(h[(pc >= FLAT_LO) & (pc <= FLAT_HI)])
            else:
                hs.append(h[z["near"].astype(bool)])
    h = np.unique(np.concatenate(hs)) if hs else np.zeros(0, np.uint64)
    with open(lib_path, "wb") as f:
        f.write(b"PRL1"); f.write(np.int32(len(h)).tobytes()); f.write(h.astype("<u8").tobytes())
    print(f"library {lib_path}: {len(h)} hashes from days before {before}, {os.path.getsize(lib_path) / 1e6:.1f} MB")


if __name__ == "__main__":
    os.environ.setdefault("PROMOS", "show")
    if sys.argv[1] == "export-all": export(sys.argv[2], sys.argv[3], sys.argv[4], every=True); sys.exit(0)
    if sys.argv[1] == "export": export(sys.argv[2], sys.argv[3], sys.argv[4]); sys.exit(0)
    if sys.argv[1] == "build": build(sys.argv[2])
    elif sys.argv[1] == "join": join(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    else: print(__doc__)
