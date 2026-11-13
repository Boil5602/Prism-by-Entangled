"""Phase 5a of the boundary-first redesign (2026-11-08): how much of the ad time repeats, by the perceptual hashes phash.py wrote.

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/repeat.py <out folder>

A frame REPEATS when a frame within 12 bits of its hash exists on another window-day, or on the same window at least 120 s away (a
still picture or a frozen feed is not a repeat). Flat frames (fewer than 8 or more than 55 bits set) are left out: black, white and
near-blank pictures match everything. Matching is by four 16-bit bands of the hash (a frame within 12 bits of another shares at least
one band in most cases), verified by the full distance; buckets of over 4,000 frames are skipped as blank-like.

Reported against the labels (labels.json ads within reviewed time, promos as show as everywhere else):
  - the share of labelled ad seconds whose frame repeats (frame level), and the share inside a cut-bounded segment of 15/30/60/90 s
    (+-1 s) that repeats with a consistent offset on its target (segment level: at least 70% of its seconds point at the same place);
  - the share of labelled show seconds that repeat, split by cross-channel (another window-day) and same-channel (same window-day),
    with the top examples (frames and their targets) for the filters to be tuned on;
  - the coverage-vs-days curve: for each labelled day in order, the share of its labelled ad seconds repeating in that day or EARLIER
    days only (what a library built from recordings so far would have known).
Cuts: a hash distance of 16 bits or more between consecutive seconds, or a gap over 1.5 s.
"""
import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np

GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
out_dir = sys.argv[1]; os.makedirs(out_dir, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import promos as _promos

NEAR = int(os.environ.get('NEAR', '6')); CHAIN_NEAR = int(os.environ.get('CHAINNEAR', str(NEAR))); CUT = 16; SAME_GAP = 120; FLAT_LO, FLAT_HI = 8, 55; MAX_BUCKET = 4000
THRESHOLDS = (2, 4, 6, 8, 10, 12)


def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)


def popcount64(a):
    a = a.astype(np.uint64)
    a = a - ((a >> np.uint64(1)) & np.uint64(0x5555555555555555))
    a = (a & np.uint64(0x3333333333333333)) + ((a >> np.uint64(2)) & np.uint64(0x3333333333333333))
    a = (a + (a >> np.uint64(4))) & np.uint64(0x0F0F0F0F0F0F0F0F)
    return ((a * np.uint64(0x0101010101010101)) >> np.uint64(56)).astype(np.int64)


# ---- load every sidecar
wins = []   # (day, window, t[], h[])
for f in sorted(glob.glob(os.path.join(GOLD, "2026-*", "*", "phash.npz"))):
    z = np.load(f); day = os.path.basename(os.path.dirname(os.path.dirname(f))); win = os.path.basename(os.path.dirname(f))
    if len(z["t"]): wins.append((day, win, z["t"], z["h"]))
wid = np.concatenate([np.full(len(w[2]), i, np.int32) for i, w in enumerate(wins)])
# the channel of every frame (E2, 2026-11-08): channels.json beside the frames, an index per channel id (-1 unknown)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from channels import channel_at as _channel_at
_chan_ix = {}
def _chan_of(day, win, t):
    cid, name = _channel_at(day, win, t); key = cid or name
    if key is None: return -1
    return _chan_ix.setdefault(key, len(_chan_ix))
CHAN = np.concatenate([np.array([_chan_of(w[0], w[1], float(t)) for t in w[2]], np.int32) for w in wins])
print(f"channels joined: {len(_chan_ix)} distinct, {int((CHAN < 0).sum())} frames without one", flush=True)
CROSS_BY_CHANNEL = os.environ.get("CROSS") == "channel"
day_ix = {d: i for i, d in enumerate(sorted(set(w[0] for w in wins)))}
DAY = np.concatenate([np.full(len(w[2]), day_ix[w[0]], np.int32) for w in wins])
T = np.concatenate([w[2] for w in wins]); H = np.concatenate([w[3] for w in wins]).astype(np.uint64)
N = len(H); print(f"{N} frames in {len(wins)} window-days", flush=True)
pc = popcount64(H); usable = (pc >= FLAT_LO) & (pc <= FLAT_HI)
print(f"flat frames left out: {int((~usable).sum())} ({100 * (~usable).mean():.1f}%)", flush=True)

# ---- near-duplicate search by bands
best_d = np.full(N, 99, np.int16); best_j = np.full(N, -1, np.int64)
idx_all = np.flatnonzero(usable)
for band in range(4):
    key = ((H[idx_all] >> np.uint64(16 * band)) & np.uint64(0xFFFF)).astype(np.int64)
    order = np.argsort(key, kind="stable"); ks = key[order]; ids = idx_all[order]
    bounds = np.flatnonzero(np.diff(ks)) + 1; starts = np.concatenate([[0], bounds]); ends = np.concatenate([bounds, [len(ks)]])
    skipped = 0
    for s0, e0 in zip(starts, ends):
        n = e0 - s0
        if n < 2: continue
        if n > MAX_BUCKET: skipped += 1; continue
        g = ids[s0:e0]; hg = H[g]; wg = wid[g]; tg = T[g]
        d = popcount64(hg[:, None] ^ hg[None, :])
        dg = DAY[g]
        other = (dg[:, None] != dg[None, :]) | (np.abs(tg[:, None] - tg[None, :]) >= SAME_GAP)   # another day, or the same day far enough apart (two windows on one channel are one recording)
        d = np.where(other, d, 99); np.fill_diagonal(d, 99)
        jm = d.argmin(axis=1); dm = d[np.arange(n), jm]
        better = dm < best_d[g]
        best_d[g[better]] = dm[better]; best_j[g[better]] = g[jm[better]]
    print(f"band {band}: {skipped} blank-like buckets skipped", flush=True)
rep = best_d <= NEAR
print(f"frames that repeat somewhere: {int(rep.sum())} ({100 * rep.mean():.1f}% of all, {100 * rep[usable].mean():.1f}% of usable)", flush=True)

# ---- the best-match distance of every labelled second, by kind: the table that sets the threshold
dist_table = {"ad": {str(k): 0 for k in THRESHOLDS}, "show": {str(k): 0 for k in THRESHOLDS}, "ad_total": 0, "show_total": 0}

# ---- per window-day: labels, cuts, segments
results = dict(frames=int(N), window_days=len(wins), repeat_frames=int(rep.sum()), per_day={}, days=[], false_examples=[], segments={})
off = np.concatenate([[0], np.cumsum([len(w[2]) for w in wins])])
days_sorted = sorted(set(w[0] for w in wins))
ad_rep_by_day = defaultdict(lambda: [0, 0, 0])   # labelled ad seconds: [total, frame-repeat, frame-repeat with an EARLIER-or-same-day target]
show_rep = defaultdict(lambda: [0, 0, 0])        # labelled show seconds: [total, cross-channel repeats, same-channel repeats]
ad_split = defaultdict(lambda: [0, 0])          # labelled ad seconds that repeat: [on another window-day, on the same window-day]
seg_cov = [0, 0]                                 # labelled ad seconds: [total, inside a repeating cut-bounded segment]
examples = []
RUN_BUCKETS = ((1, 5, "1-4"), (5, 12, "5-11"), (12, 36, "12-35"), (36, 96, "36-95"), (96, 10 ** 9, "96+"))
run_table = {"ad": {b[2]: 0 for b in RUN_BUCKETS}, "show": {b[2]: 0 for b in RUN_BUCKETS}}
unit_cov = [0, 0, 0, 0, 0, 0]   # ad total, ad in 12-95 s runs, show total, show in such runs, the same two on another window-day only
for i, (day, win, t, h) in enumerate(wins):
    f = os.path.join(GOLD, day, "labels.json")
    if not os.path.exists(f): continue
    lab = json.load(open(f, encoding="utf-8")).get("windows", {}).get(win)
    if not lab: continue
    ads = lab.get("ads", [])
    if _promos.on(): ads = _promos.ads_for(os.path.join(GOLD, day), win, ads)
    ads = [(sec(a), sec(b)) for a, b in ads]; rev = [(sec(a), sec(b)) for a, b in lab.get("reviewed", [])]; neu = [(sec(a), sec(b)) for a, b in lab.get("neutral", [])]
    g = np.arange(off[i], off[i + 1]); tt = t
    inside = lambda x, spans: any(a <= x < b for a, b in spans)
    is_ad = np.array([inside(x, ads) for x in tt]); is_rev = np.array([inside(x, rev) and not inside(x, neu) for x in tt])
    r = rep[g]; tgt = best_j[g]
    tgt_day = np.array([wins[wid[j]][0] if j >= 0 else "" for j in tgt])
    # 'same' is the same CHANNEL when CROSS=channel (E2), the same window-day otherwise
    if CROSS_BY_CHANNEL: tgt_same = np.array([(j >= 0 and CHAN[j] >= 0 and CHAN[j] == CHAN[g[k]]) for k, j in enumerate(tgt)])
    else: tgt_same = np.array([wid[j] == i if j >= 0 else False for j in tgt])
    # frame level
    a_mask = is_rev & is_ad; s_mask = is_rev & ~is_ad
    bd = best_d[g]
    dist_table["ad_total"] += int(a_mask.sum()); dist_table["show_total"] += int(s_mask.sum())
    for k in THRESHOLDS:
        dist_table["ad"][str(k)] += int((a_mask & (bd <= k)).sum()); dist_table["show"][str(k)] += int((s_mask & (bd <= k)).sum())
    ad_rep_by_day[day][0] += int(a_mask.sum()); ad_rep_by_day[day][1] += int((a_mask & r).sum())
    ad_rep_by_day[day][2] += int((a_mask & r & (tgt_day <= day)).sum())
    show_rep[day][0] += int(s_mask.sum()); show_rep[day][1] += int((s_mask & r & ~tgt_same).sum()); show_rep[day][2] += int((s_mask & r & tgt_same).sum())
    ad_split[day][0] += int((a_mask & r & ~tgt_same).sum()); ad_split[day][1] += int((a_mask & r & tgt_same).sum())
    picks = np.flatnonzero(s_mask & r); picks = picks[np.linspace(0, len(picks) - 1, min(len(picks), 6)).astype(int)] if len(picks) else picks   # six spread through the window-day
    for k in picks:
        j = tgt[k]; examples.append(dict(day=day, window=win, t=float(tt[k]), target_day=wins[wid[j]][0], target_window=wins[wid[j]][1], target_t=float(T[j]), bits=int(best_d[g[k]]), same=bool(tgt_same[k])))
    # repeat runs: consecutive seconds whose matches sit on one target window-day at a steady offset (+-1.5 s)
    run_len = np.zeros(len(tt), np.int32)
    k0 = 0
    while k0 < len(tt):
        if not r[k0]: k0 += 1; continue
        j = int(tgt[k0]); k1 = k0
        while k1 + 1 < len(tt) and tt[k1 + 1] - tt[k1] < 3:
            # the frame a second on from j, on j's window-day
            # the target frame nearest one second on from j, on j's window-day (the two recordings' seconds are out of phase by up to half a
            # second, so j+1 or j+2 may be the nearer), within CHAIN_NEAR bits
            jw = wid[j]; want = T[j] + (tt[k1 + 1] - tt[k1]); cands = [x for x in (j + 1, j + 2) if x < N and wid[x] == jw and abs(T[x] - want) <= 1.2]
            if not cands: break
            j2 = min(cands, key=lambda x: abs(T[x] - want))
            d2 = min(int(popcount64(np.array([H[k1 + 1] ^ H[x]], np.uint64))[0]) for x in cands)
            if d2 > CHAIN_NEAR: break
            k1 += 1; j = j2
        run_len[k0:k1 + 1] = int(round(tt[k1] - tt[k0])) + 1; k0 = k1 + 1
    for kind, mask in (("ad", a_mask), ("show", s_mask)):
        for lo, hi, nm in RUN_BUCKETS:
            run_table[kind][nm] += int((mask & r & (run_len >= lo) & (run_len < hi)).sum())
    unit = r & (run_len >= 12) & (run_len < 96)
    unit_cov[0] += int(a_mask.sum()); unit_cov[1] += int((a_mask & unit).sum()); unit_cov[2] += int(s_mask.sum()); unit_cov[3] += int((s_mask & unit).sum())
    unit_cov[4] += int((a_mask & unit & ~tgt_same).sum()); unit_cov[5] += int((s_mask & unit & ~tgt_same).sum())
    # cuts and cut-bounded segments of 15 / 30 / 60 / 90 s
    d1 = popcount64(h[1:] ^ h[:-1]); gap = np.diff(tt)
    cuts = np.flatnonzero((d1 >= CUT) | (gap > 1.5)) + 1; cuts = np.concatenate([[0], cuts, [len(tt)]])
    seg_rep = np.zeros(len(tt), bool); nseg = nrep = 0
    cut_t = tt[np.minimum(cuts, len(tt) - 1)]
    for a_i in range(len(cuts) - 1):
        for b_i in range(a_i + 1, min(a_i + 60, len(cuts))):
            L = cut_t[b_i] - cut_t[a_i]
            if L > 92: break
            if not any(abs(L - x) <= 1 for x in (15, 30, 60, 90)): continue
            ks = np.arange(cuts[a_i], cuts[b_i])
            if len(ks) < 10: continue
            nseg += 1
            rr = r[ks]
            if rr.mean() < 0.7: continue
            # consistent offset: the target second minus this second, for the repeating frames
            offs = np.array([T[tgt[k]] - tt[k] for k in ks[rr]]); tw = np.array([wid[tgt[k]] for k in ks[rr]])
            key = np.round(offs).astype(np.int64)
            best = 0
            for w0 in np.unique(tw):
                ko = key[tw == w0]
                for o in np.unique(ko): best = max(best, int((np.abs(ko - o) <= 1).sum()))
            if best >= 0.7 * len(ks): seg_rep[ks] = True; nrep += 1
    seg_cov[0] += int(a_mask.sum()); seg_cov[1] += int((a_mask & seg_rep).sum())
    results["segments"][f"{day}/{win}"] = dict(candidates=nseg, repeating=nrep, ad_seconds=int(a_mask.sum()), ad_in_repeating_segments=int((a_mask & seg_rep).sum()),
                                               show_in_repeating_segments=int((s_mask & seg_rep).sum()), show_seconds=int(s_mask.sum()))
    print(f"{day} {win}: ad s {int(a_mask.sum())} frame-repeat {100 * (a_mask & r).sum() / max(1, a_mask.sum()):.1f}% segment-repeat {100 * (a_mask & seg_rep).sum() / max(1, a_mask.sum()):.1f}%"
          f" | show s {int(s_mask.sum())} frame-repeat {100 * (s_mask & r).sum() / max(1, s_mask.sum()):.1f}% (cross {int((s_mask & r & ~tgt_same).sum())}, same {int((s_mask & r & tgt_same).sum())}) segment-repeat {100 * (s_mask & seg_rep).sum() / max(1, s_mask.sum()):.2f}%", flush=True)

tot_ad = sum(v[0] for v in ad_rep_by_day.values()); tot_show = sum(v[0] for v in show_rep.values())
results["ad_frame_repeat_pct"] = round(100 * sum(v[1] for v in ad_rep_by_day.values()) / max(1, tot_ad), 1)
results["ad_segment_repeat_pct"] = round(100 * seg_cov[1] / max(1, seg_cov[0]), 1)
results["show_frame_repeat_pct"] = round(100 * (sum(v[1] for v in show_rep.values()) + sum(v[2] for v in show_rep.values())) / max(1, tot_show), 2)
results["ad_frame_repeat_cross_pct"] = round(100 * sum(v[0] for v in ad_split.values()) / max(1, tot_ad), 1)
results["ad_frame_repeat_same_pct"] = round(100 * sum(v[1] for v in ad_split.values()) / max(1, tot_ad), 1)
results["show_frame_repeat_cross_pct"] = round(100 * sum(v[1] for v in show_rep.values()) / max(1, tot_show), 2)
results["show_frame_repeat_same_pct"] = round(100 * sum(v[2] for v in show_rep.values()) / max(1, tot_show), 2)
results["show_segment_repeat_pct"] = round(100 * sum(v["show_in_repeating_segments"] for v in results["segments"].values()) / max(1, tot_show), 2)
# coverage vs days: day k's ad seconds repeating in days <= k
curve = []
for k, day in enumerate(d for d in days_sorted if d in ad_rep_by_day):
    v = ad_rep_by_day[day]; curve.append(dict(day=day, days_so_far=k + 1, ad_seconds=v[0], pct_repeat_in_days_so_far=round(100 * v[2] / max(1, v[0]), 1), pct_repeat_any=round(100 * v[1] / max(1, v[0]), 1)))
results["coverage_vs_days"] = curve
results["run_length_table"] = {"ad_pct": {k: round(100 * v / max(1, tot_ad), 1) for k, v in run_table["ad"].items()},
                               "show_pct": {k: round(100 * v / max(1, tot_show), 2) for k, v in run_table["show"].items()}}
results["unit_repeat"] = {"ad_pct": round(100 * unit_cov[1] / max(1, unit_cov[0]), 1), "show_pct": round(100 * unit_cov[3] / max(1, unit_cov[2]), 2),
                          "ad_pct_other_windowday": round(100 * unit_cov[4] / max(1, unit_cov[0]), 1), "show_pct_other_windowday": round(100 * unit_cov[5] / max(1, unit_cov[2]), 2)}
print("repeat runs by length (s): ad", results["run_length_table"]["ad_pct"], "show", results["run_length_table"]["show_pct"])
print("unit repeats (runs of 12 to 95 s): ad", results["unit_repeat"]["ad_pct"], "% show", results["unit_repeat"]["show_pct"], "% | on another window-day only: ad", results["unit_repeat"]["ad_pct_other_windowday"], "% show", results["unit_repeat"]["show_pct_other_windowday"], "%")
results["distance_table"] = {"near_used": NEAR, "ad_pct": {k: round(100 * v / max(1, dist_table["ad_total"]), 1) for k, v in dist_table["ad"].items()},
                             "show_pct": {k: round(100 * v / max(1, dist_table["show_total"]), 2) for k, v in dist_table["show"].items()}}
print("repeat rate by distance (bits): ad", results["distance_table"]["ad_pct"], "show", results["distance_table"]["show_pct"])
results["per_day"] = {d: dict(ad_s=ad_rep_by_day[d][0], ad_rep=ad_rep_by_day[d][1], show_s=show_rep[d][0], show_rep_cross=show_rep[d][1], show_rep_same=show_rep[d][2]) for d in days_sorted if d in ad_rep_by_day}
examples.sort(key=lambda e: (e["same"], e["bits"])); results["false_examples"] = examples[:120]   # cross-channel first, then the nearest
json.dump(results, open(os.path.join(out_dir, "repeat.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({k: results[k] for k in ("frames", "repeat_frames", "ad_frame_repeat_pct", "ad_frame_repeat_cross_pct", "ad_frame_repeat_same_pct", "ad_segment_repeat_pct", "show_frame_repeat_pct", "show_frame_repeat_cross_pct", "show_frame_repeat_same_pct", "show_segment_repeat_pct")}))
print("coverage vs days:", [(c["days_so_far"], c["pct_repeat_in_days_so_far"]) for c in curve])
try:
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot([c["days_so_far"] for c in curve], [c["pct_repeat_in_days_so_far"] for c in curve], "o-", label="repeats in recordings so far")
    ax.plot([c["days_so_far"] for c in curve], [c["pct_repeat_any"] for c in curve], "s--", alpha=0.6, label="repeats anywhere in the set")
    ax.set_xlabel("labelled days recorded"); ax.set_ylabel("% of the day's labelled ad seconds whose frame repeats"); ax.set_ylim(0, 100); ax.grid(alpha=0.3); ax.legend()
    ax.set_title("Repetition coverage of labelled ad time vs days of recording")
    fig.tight_layout(); fig.savefig(os.path.join(out_dir, "coverage-vs-days.png"), dpi=120); print("wrote coverage-vs-days.png")
except Exception as e:
    print("no plot:", e)
