"""The palette comparison against a labelled evening (2026-11-09; the redesign's Phase D, the half the first evaluation left out).

    python -I scripts/breakwatch/palette-eval.py <golden day> <window> <bench results.json> <out.json> [sampler log]

The first evaluation (sidecar-eval.py) asked one thing of the palette: is a frame-to-frame jump a trigger. It is not. The addendum asked
for two readings, and this script measures both as they were written:

  1. the palette jump at a cut: the distance between the 3 s before and the 3 s after, at labelled break starts against cuts inside a show;
  2. the show palette's return: a running palette of the show (held from before the cover came up) and the distance of each second to
     it. A cover that is still up while the picture is back at the show's palette is the lingering cover, the largest single error.

The show palette is tried three ways: an average with a 60 s memory, a plain mean of the last two minutes, and a bank (the last five
minutes of show seconds, each second compared with its nearest neighbour in the bank; a show cuts between a few set-ups, so a mean
blurs what a bank keeps). Two versions of each: 'oracle' builds the show palette from labelled show seconds; 'live' builds it only
from what a running PRISM knows (seconds with no cover up, read 15 s late so a late cover does not let the break's first seconds in,
held while a cover is up). The breaks, and the covers the bench drew, are the bench's own rows (results.json, one exam).

A slot change (the sampler tunes the screen every half hour; the optional log gives the times) starts the show palette again; the
minute after one is left out. Nothing here alters a frame or a label. Thresholds chosen on the same evening are optimistic; the
held-out lines choose the threshold on the other slots and apply it to the one left out.

What is written: the distances' AUC over every second, over the minute after a break, and over the seconds the bench's cover was up or
down (the residual: what the palette knows where the detector erred); a return rule (K seconds in a row under a threshold end the
cover), its linger in show seconds beside the bench's, with false returns and the ad seconds they would uncover at worst; the same
held out by slot; the departure from the show palette at the start; the jump at cuts; the count of jumps in the last minute.
DESC=gray32 or thumb8 reads the kept grey frames instead of the palette (a grey histogram, an 8x8 thumbnail): what the older days,
recorded before the palette, could give. SERIES=HH:MM:SS-HH:MM:SS prints the live distances every 5 s; SKIP=<break start seconds,...>
leaves breaks out of the return rule's sums (a break whose labelled end the frames show to be wrong)."""
import io, json, os, re, sys
import numpy as np

G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics")
DELAY = 15       # the live show palette is read this many seconds late
BANK = 300       # seconds of show a bank keeps
NL = chr(10)


def secs(hms):
    h, m, s = hms.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)


def load_palette(day, window):
    """1 Hz grid over the day: H[s] is the normalised 64-bin histogram of the last frame at or before s+1 (NaN where none within 3 s)."""
    p = os.path.join(G, "golden", day, window, "events.log")
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


def load_gray(day, window, a, b, kind):
    """The same grid from the kept grey frames (320x180, one byte a pixel): a 32-bin grey histogram, or an 8x8 thumbnail scaled so that
    half the L1 distance is half the mean difference of the blocks. The older labelled days hold frames and no palette."""
    folder = os.path.join(G, "golden", day, window); d = 32 if kind == "gray32" else 64
    H = np.full((86400, d), np.nan, dtype=np.float32)
    for n in sorted(f for f in os.listdir(folder) if f.endswith(".gray") and f[:9].isdigit()):
        s = int(n[:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6])
        if s < a or s > b: continue
        with open(os.path.join(folder, n), "rb") as f: px = np.frombuffer(f.read(), dtype=np.uint8)
        if px.size != 320 * 180: continue
        if kind == "gray32": v = np.bincount(px >> 3, minlength=32).astype(np.float32) / px.size
        else: v = px.reshape(180, 320)[:176].reshape(8, 22, 8, 40).mean(axis=(1, 3)).ravel().astype(np.float32) / 255 / 64
        H[s] = v
    real = ~np.isnan(H[:, 0])
    for s in range(a, b):       # a second with no frame takes the one before it, up to 2 s
        if not real[s]:
            for k in (1, 2):
                if real[s - k]: H[s] = H[s - k]; break
    return H


def auc(pos, neg):
    """The chance that a value from pos is above one from neg (ties half)."""
    pos = np.asarray(pos, dtype=np.float64); neg = np.asarray(neg, dtype=np.float64)
    if len(pos) == 0 or len(neg) == 0: return None
    allv = np.concatenate([pos, neg]); order = allv.argsort(kind="mergesort"); ranks = np.empty(len(allv)); ranks[order] = np.arange(1, len(allv) + 1)
    # average the ranks of ties
    sv = allv[order]; i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]: j += 1
        if j > i: ranks[order[i:j + 1]] = (i + j + 2) / 2
        i = j + 1
    return round(float((ranks[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))), 4)


def tv(a, b):
    return 0.5 * np.abs(a - b).sum(axis=-1)


def pct(v, q):
    return None if len(v) == 0 else round(float(np.percentile(v, q)), 1)


if __name__ == "__main__":
    day, window, bench, out = sys.argv[1:5]
    samplog = sys.argv[5] if len(sys.argv) > 5 else None
    res = json.load(io.open(bench, encoding="utf-8"))
    exams = res["exams"]; ex = (list(exams.values()) if isinstance(exams, dict) else exams)[0]
    rows = [r for r in ex["breaks"]]
    L = json.load(io.open(os.path.join(G, "golden", day, "labels.json"), encoding="utf-8"))["windows"][window]
    lab_ads = [(secs(a), secs(b)) for a, b in L.get("ads", [])]
    neutral = [(secs(a), secs(b)) for a, b in (L.get("neutral") or [])] if isinstance(L.get("neutral"), list) else []
    t0 = int(min(r["start"] for r in rows)) - 900; t1 = int(max(r["end"] for r in rows)) + 300
    pf = os.path.join(G, "golden", day, "labels.promos.json"); promos = []
    if os.path.exists(pf):
        try:
            pw = json.load(io.open(pf, encoding="utf-8")).get("windows", {}).get(window, {})
            promos = [(secs(a), secs(b)) for a, b in pw.get("promos", pw.get("ads", []))]
        except Exception: promos = []
    slots = []
    if samplog and os.path.exists(samplog):
        for line in io.open(samplog, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d\d:\d\d:\d\d) slot:", line)
            if m: slots.append(secs(m.group(1)))
    DESC = os.environ.get("DESC", "palette")     # palette (the recorded colour histogram), gray32 (a grey histogram from the kept frames,
    H = load_palette(day, window) if DESC == "palette" else load_gray(day, window, t0 - 400, t1 + 10, DESC)   # which every older day has too), thumb8
    have = ~np.isnan(H[:, 0])
    N = 86400
    is_ad = np.zeros(N, bool); is_neu = np.zeros(N, bool); cover = np.zeros(N, bool); slot_id = np.zeros(N, int)
    for a, b in lab_ads: is_ad[int(a):int(b) + 1] = True
    for a, b in neutral + promos: is_neu[int(a):int(b) + 1] = True
    for r in rows:
        if not r.get("miss") and r.get("cover_start") is not None: cover[int(r["cover_start"]):int(r["cover_end"]) + 1] = True
    for s in sorted(slots):
        slot_id[int(s):] += 1; is_neu[int(s):int(s) + 60] = True
    show = have & ~is_ad & ~is_neu
    span = np.zeros(N, bool); span[t0:t1] = True

    # ---- the show palette, second by second, six ways ------------------------------------------------------------------------------
    def distances(live):
        """d[model][s]: the distance of second s to the show palette as it stands for s."""
        usable = have & ~is_neu & (~cover if live else ~is_ad)
        d = {k: np.full(N, np.nan, dtype=np.float32) for k in ("ema60", "mean120", "bank")}
        ema = None; hist = []      # hist: (second, vector) of usable seconds in this slot
        frozen = None; cur_slot = -1
        for s in range(t0, t1):
            if slot_id[s] != cur_slot: cur_slot = slot_id[s]; hist = []; frozen = None
            held = cover[s] if live else is_ad[s]
            if not held:
                edge = s - (DELAY if live else 7)
                pool = [(q, v) for q, v in hist if q <= edge and q > edge - BANK]
                frozen = pool if pool else frozen
            pool = frozen
            if have[s] and pool:
                vs = np.stack([v for q, v in pool]); qs = np.array([q for q, v in pool]); ref = qs[-1]
                d["bank"][s] = float(tv(vs, H[s]).min())
                w = np.exp(-(ref - qs) / 60.0); d["ema60"][s] = float(tv((vs * w[:, None]).sum(0) / w.sum(), H[s]))
                m = vs[qs > ref - 120]; d["mean120"][s] = float(tv(m.mean(0), H[s]))
            if usable[s]: hist.append((s, H[s]))
            if len(hist) > BANK + 60: hist = hist[-(BANK + 60):]
        return d

    THRS = (0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3)
    SKIP = set(int(v) for v in os.environ.get("SKIP", "").split(",") if v)      # break starts to leave out of the return rule's sums
    SERIES = os.environ.get("SERIES")                                           # HH:MM:SS-HH:MM:SS: print the live distances, every 5 s
    order = sorted(rows, key=lambda r: r["start"])

    def sim(dv, K, thr):
        """The return rule on every covered break: K seconds in a row under THR while the cover is up end the cover. Linger is counted in
        show seconds; a cover that runs across two breaks is split at the second one's start. A return before the labelled end is a
        false return, and every ad second after it counts as uncovered (the worst case: the detector would cover again in a few seconds)."""
        outp = []
        for i, r in enumerate(order):
            if r.get("miss") or r.get("cover_start") is None or int(r["start"]) in SKIP: continue
            a, b = int(r["start"]), int(r["end"]); nxt = int(order[i + 1]["start"]) if i + 1 < len(order) else t1
            cs, ce = int(r["cover_start"]), int(r["cover_end"]); stop = min(ce, nxt - 1)
            base = int(show[b + 1:stop + 1].sum()); ret = None; run = 0
            for q in range(max(cs + 5, a + 5), stop + 1):
                v = dv[q]; run = run + 1 if (not np.isnan(v) and v < thr) else 0
                if run >= K: ret = q; break
            if ret is None: outp.append(dict(slot=int(slot_id[a]), base=base, linger=base, lost=0, false=0, lag=None))
            elif ret < b - 2: outp.append(dict(slot=int(slot_id[a]), base=base, linger=0, lost=int(is_ad[ret:b + 1].sum()), false=1, lag=None))
            else: outp.append(dict(slot=int(slot_id[a]), base=base, linger=int(show[b + 1:ret + 1].sum()), lost=0, false=0, lag=ret - b))
        return outp

    rep = dict(day=day, window=window, bench=os.path.basename(bench), breaks=len(rows), slots=len(slots), delay_s=DELAY, bank_s=BANK,
               palette_seconds=int((have & span).sum()), note="distances are half the L1 distance between normalised 4x4x4 RGB histograms (0 to 1)")

    for mode in ("oracle", "live"):
        d = distances(mode == "live"); R = rep[mode] = {}
        for k, dv in d.items():
            ad_v = []; after_v = []
            for r in rows:
                a, b = int(r["start"]), int(r["end"])
                s = np.arange(a + 3, b - 1); s = s[~np.isnan(dv[s])]; ad_v += list(dv[s])
                s = np.arange(b + 2, b + 61); s = s[show[s] & ~np.isnan(dv[s])]; after_v += list(dv[s])
            M = R[k] = dict(auc_ad_against_show_after=auc(ad_v, after_v), ad_median=pct(np.array(ad_v) * 100, 50), after_median=pct(np.array(after_v) * 100, 50),
                            ad_p10=pct(np.array(ad_v) * 100, 10), after_p90=pct(np.array(after_v) * 100, 90))
            # the whole evening, every second: is the picture away from the show's palette
            sel = span & ~is_neu & ~np.isnan(dv)
            M["auc_all_seconds"] = auc(dv[sel & is_ad], dv[sel & ~is_ad])
            M["cover_up_auc_ad_against_show"] = auc(dv[sel & cover & is_ad], dv[sel & cover & show])
            M["cover_down_auc_ad_against_show"] = auc(dv[sel & ~cover & is_ad], dv[sel & ~cover & show])
            M["return"] = {}
            for K in (2, 3, 5):
                for thr in THRS:
                    per = sim(dv, K, thr); good = [x["lag"] for x in per if x["lag"] is not None]
                    M["return"][f"K{K} thr{thr}"] = dict(false_returns=sum(x["false"] for x in per), ad_s_uncovered=sum(x["lost"] for x in per),
                                                          returns=len(good), lag_median=pct(good, 50), lag_p90=pct(good, 90),
                                                          linger_bench=sum(x["base"] for x in per), linger_with_rule=sum(x["linger"] for x in per),
                                                          long_linger_bench=sum(x["base"] for x in per if x["base"] > 15),
                                                          long_linger_with_rule=sum(x["linger"] for x in per if x["base"] > 15))
        # held out by slot: the bank, K=3, the threshold chosen on the other slots (cost = linger left + 3 x ad seconds uncovered)
        dv = d["bank"]; sims = {thr: sim(dv, 3, thr) for thr in THRS}
        ids = [x["slot"] for x in sims[THRS[0]]]; tot_l = tot_u = tot_b = 0; picks = []
        for sid in sorted(set(ids)):
            tr = [i for i, q in enumerate(ids) if q != sid]; te = [i for i, q in enumerate(ids) if q == sid]
            best = min(THRS, key=lambda t: sum(sims[t][i]["linger"] + 3 * sims[t][i]["lost"] for i in tr))
            picks.append(best)
            tot_l += sum(sims[best][i]["linger"] for i in te); tot_u += sum(sims[best][i]["lost"] for i in te); tot_b += sum(sims[best][i]["base"] for i in te)
        R["held_out_by_slot_bank_K3"] = dict(linger_bench=int(tot_b), linger_with_rule=int(tot_l), ad_s_uncovered=int(tot_u), thresholds=picks)
        if mode == "live" and SERIES:
            x0, x1 = (int(secs(v)) for v in SERIES.split("-"))
            for q in range(x0, x1, 5):
                print(f"{q // 3600:02d}:{q // 60 % 60:02d}:{q % 60:02d}", "ad" if is_ad[q] else ("neu" if is_neu[q] else "show"), "COVER" if cover[q] else "     ",
                      " ".join("  nan" if np.isnan(d[k][q]) else f"{d[k][q]:.3f}" for k in ("bank", "ema60", "mean120")))

        # the start side: the picture leaves the show's palette. How late after the labelled start do K seconds in a row sit over THR, and
        # how often does the same happen inside a show (per show hour)
        S = R["departure_bank"] = {}
        for K in (2, 3):
            for thr in (0.2, 0.3, 0.4, 0.5):
                lags = []
                for r in rows:
                    a, b = int(r["start"]), int(r["end"]); run = 0; hit = None
                    for s in range(a - 3, min(b, a + 60)):
                        v = dv[s]; run = run + 1 if (not np.isnan(v) and v > thr) else 0
                        if run >= K: hit = s; break
                    lags.append((hit - a) if hit is not None else 60)
                # episodes in show: rising runs of K
                run = 0; eps = 0; show_s = 0
                for s in range(t0, t1):
                    if not show[s] or np.isnan(dv[s]) or is_ad[max(0, s - 20):s + 20].any(): run = 0; continue
                    show_s += 1
                    run = run + 1 if dv[s] > thr else 0
                    if run == K: eps += 1
                S[f"K{K} thr{thr}"] = dict(start_lag_median=pct(lags, 50), start_lag_p90=pct(lags, 90), found_within_10s=int(sum(1 for x in lags if x <= 10)),
                                           false_per_show_hour=round(eps / max(1, show_s) * 3600, 1))
        if mode == "live":
            rep["per_break"] = [dict(start=int(r["start"]), length=int(r["end"] - r["start"]), bench_start_lag=r.get("start_lag"), bench_end_lag=r.get("end_lag"),
                                     bank_at_end_minus5=None if np.isnan(dv[int(r["end"]) - 5]) else round(float(dv[int(r["end"]) - 5]), 3),
                                     bank_at_end_plus3=None if np.isnan(dv[int(r["end"]) + 3]) else round(float(dv[int(r["end"]) + 3]), 3),
                                     bank_at_end_plus8=None if np.isnan(dv[int(r["end"]) + 8]) else round(float(dv[int(r["end"]) + 8]), 3)) for r in rows]

    # ---- the jump at a cut: 3 s before against 3 s after ------------------------------------------------------------------------------
    J = np.full(N, np.nan, dtype=np.float32); F = np.full(N, np.nan, dtype=np.float32)
    for s in range(t0 + 3, t1 - 3):
        if have[s - 3:s + 3].all(): J[s] = tv(H[s - 3:s].mean(0), H[s:s + 3].mean(0))
        if have[s - 1] and have[s]: F[s] = tv(H[s - 1], H[s])
    starts = [int(r["start"]) for r in rows]; ends = [int(r["end"]) for r in rows]
    edge = np.zeros(N, bool)
    for e in starts + ends: edge[e - 8:e + 9] = True
    def at(e):
        w = J[e - 2:e + 3]; w = w[~np.isnan(w)]; return float(w.max()) if len(w) else np.nan
    js = np.array([at(e) for e in starts]); je = np.array([at(e) for e in ends])
    cut = (F >= 0.25) & ~np.isnan(J) & ~is_neu & span
    show_cuts = J[cut & ~is_ad & ~edge]; ad_cuts = J[cut & is_ad & ~edge]
    show_hours = (show & span).sum() / 3600
    rep["jump"] = dict(at_starts_median=pct(js[~np.isnan(js)], 50), at_ends_median=pct(je[~np.isnan(je)], 50),
                       show_cuts=int(len(show_cuts)), show_cuts_per_hour=round(len(show_cuts) / max(1e-9, show_hours), 1), show_cut_median=pct(show_cuts, 50),
                       ad_cuts=int(len(ad_cuts)), ad_cut_median=pct(ad_cuts, 50),
                       auc_start_against_show_cut=auc(js[~np.isnan(js)], show_cuts), auc_end_against_show_cut=auc(je[~np.isnan(je)], show_cuts),
                       auc_ad_cut_against_show_cut=auc(ad_cuts, show_cuts), by_threshold={})
    for thr in (0.3, 0.4, 0.5, 0.6, 0.7):
        rep["jump"]["by_threshold"][str(thr)] = dict(starts=int((js >= thr).sum()), ends=int((je >= thr).sum()), of=len(rows),
                                                     show_cuts_per_hour=round(float((show_cuts >= thr).sum()) / max(1e-9, show_hours), 1),
                                                     ad_cuts_per_ad_minute=round(float((ad_cuts >= thr).sum()) / max(1e-9, (is_ad & span).sum() / 60), 2))
    # the pod's signature: big jumps in the last 60 s (ads change their look every 15 or 30 s; a show keeps its grade)
    big = (np.nan_to_num(J) >= 0.5) & (np.nan_to_num(F) >= 0.25)
    cnt = np.convolve(big.astype(np.float32), np.ones(60, dtype=np.float32))[:N]
    sel = span & ~is_neu & have
    rep["pod_signature"] = dict(auc_jumps_in_last_60s=auc(cnt[sel & is_ad], cnt[sel & ~is_ad]),
                                ad_median=pct(cnt[sel & is_ad], 50), show_median=pct(cnt[sel & ~is_ad], 50), show_p90=pct(cnt[sel & ~is_ad], 90))

    with io.open(out, "w", encoding="utf-8") as f: f.write(json.dumps(rep, indent=1))
    brief = {m: {k: (rep[m][k]["auc_ad_against_show_after"], rep[m][k]["auc_all_seconds"]) for k in ("ema60", "mean120", "bank")} for m in ("oracle", "live")}
    print(json.dumps(dict(breaks=rep["breaks"], palette_seconds=rep["palette_seconds"], auc=brief, held=rep["live"]["held_out_by_slot_bank_K3"],
                          jump_auc=rep["jump"]["auc_start_against_show_cut"], pod_auc=rep["pod_signature"]["auc_jumps_in_last_60s"])))
