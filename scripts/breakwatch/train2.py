"""The learned break detector over several marked days (2026-10-08): scored by channel held out, then exported for Prism.

    python scripts/breakwatch/train2.py --day <feat.csv> <golden day folder> [--day ...] [--base <day>[,<day>]] [--export model.json [parity.csv]]

Each channel is scored by trees that never saw it, on caption scores from a classifier that never saw it either, and the trees' own caption
inputs on the training channels come from classifiers that left each of them out in turn - nothing of the held-out channel reaches its own
score. The hand rules ("active", what Prism ran when the day was recorded) are scored on the same seconds. The export trains on everything,
in export_model.py's format, and checks itself against scikit-learn. --base names day folders: each channel is also scored by the same
recipe trained on those days alone (still without the channel), on the same seconds - what a day of marking added.
"""
import json
import os
import re
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from bwfeatures import CapModel, balanced, cap_feat, features, gbm, load  # noqa: E402

args = sys.argv[1:]
DAYS = []
while "--day" in args:
    i = args.index("--day"); DAYS.append((args[i + 1], args[i + 2])); del args[i:i + 3]
EXPORT = args[args.index("--export") + 1] if "--export" in args else None
PARITY = args[args.index("--export") + 2] if EXPORT and len(args) > args.index("--export") + 2 and not args[args.index("--export") + 2].startswith("--") else None
BASE = frozenset(args[args.index("--base") + 1].split(",")) if "--base" in args else None   # day folders' names: also score the recipe trained on these days alone
# the hand rules' own outputs, and the two timers off YouTube TV's ad slots: where in a break a slot falls differs by channel (late on
# CNN and FX, first on Comedy Central), and the trees had learned "a slot ended 40 s ago" as "the break is over" - the cover dropped
# mid-break on a channel new to them (2026-10-08, 6 of 9 such lifts). The slot itself (cue_on) stays.
SKIP2 = ("chance", "active", "since_cue_stop", "since_cue_predict")
TAUS = (10,)        # one kernel a timer: a tree splits the same on any monotone form of it (all 1,811 timer splits sat on one of the three)
ONLY = json.load(open(args[args.index("--only") + 1], encoding="utf-8")) if "--only" in args else None   # train on a manifest's seconds alone
INSET = frozenset(args[args.index("--inset-ads") + 1].split(",")) if "--inset-ads" in args else None   # ticker channels: an inset picture is an ad, marked or not
POLICY = {"on": 0.85, "off": 0.55, "hold": 2}
# the picture study (2026-10-08, scripts/breakwatch/pic): --pic <scores.npz> adds a small network's reading of each frame ("how much does
# this look like an ad") as inputs, --exams <exams.json> then scores the exams by trees trained with and without them
PIC = args[args.index("--pic") + 1] if "--pic" in args else None
EXAMS = json.load(open(args[args.index("--exams") + 1], encoding="utf-8")) if "--exams" in args else None
PIC_NAMES = ["pic", "pic_mean3", "pic_mean8"]


def sec(h):
    a, b, c = h.split(":")
    return int(a) * 3600 + int(b) * 60 + int(c)


def spans(t, L):
    m = np.zeros(len(t), bool)
    for a, b in L:
        m |= (t >= sec(a)) & (t <= sec(b) + 0.99)
    return m


EV = {}         # (day folder, window) -> the day's own event lines, each once, in time order
FOREIGN = {}    # (day folder, window) -> the earliest time of day at which another date's lines stand in the day's log (None with none)


def own_lines(path, earlier):
    """A kept log's own lines: each once, without the lines an earlier day's log of the same name already holds, in time order.
    keep.py compared times of day alone until 2026-10-08, so a day's log after midnight took the day before's lines again with every pass
    (25 copies of the evening, and the morning before laid over the morning) - found when the two-day score came out worse than one day's."""
    if not os.path.exists(path): return [], None
    old = set()
    for e in earlier:
        if os.path.exists(e): old.update(l.rstrip("\n") for l in open(e, encoding="utf-8", errors="replace"))
    seen, out, first = set(), [], None
    for l in open(path, encoding="utf-8", errors="replace"):
        l = l.rstrip("\n")
        if l in seen: continue
        seen.add(l)
        if l in old:
            if l[:9].isdigit() and (first is None or l[:9] < first): first = l[:9]
            continue
        out.append(l)
    out.sort(key=lambda l: l[:9])
    return out, first


def events(day, win, kind):
    if (day, win) not in EV:
        earlier = [os.path.join(d, win, "events.log") for d in EARLIER[day]]
        EV[(day, win)], first = own_lines(os.path.join(day, win, "events.log"), earlier)
        # a day whose log was repaired keeps the mixed one beside it: readings made before the repair (a feature file older than the mixed
        # log's last line) came from that log, and are judged against it
        mixed = os.path.join(day, win, "events.mixed.log")
        if os.path.exists(mixed) and os.path.getmtime(FEAT_OF[day]) < os.path.getmtime(mixed) + 600:
            first = own_lines(mixed, earlier)[1]
        FOREIGN[(day, win)] = None if first is None else int(first[:2]) * 3600 + int(first[2:4]) * 60 + int(first[4:6])
    out = []
    for line in EV[(day, win)]:
        m = re.match(r"(\d{9}) \S+ " + kind + r" (.+)", line)
        if m: out.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]) + int(m.group(1)[6:9]) / 1000, m.group(2).strip()))
    return out


def own_frames(day, win, t):
    """Which rows are frames this day folder holds AND that were recorded on its date: the first keep after midnight copied the whole
    bench, the evening before included, into the new day's folder - the same seconds as the day before's, under the next day's name."""
    tag = os.path.basename(os.path.normpath(day))
    have = set()
    try:
        with os.scandir(os.path.join(day, win)) as it:
            for e in it:
                if e.name.endswith(".gray") and time.strftime("%Y-%m-%d", time.localtime(e.stat().st_mtime)) == tag: have.add(e.name[:9])
    except OSError:
        pass
    ms = np.round(t * 1000).astype(np.int64)
    names = [f"{x // 3600000:02d}{x // 60000 % 60:02d}{x // 1000 % 60:02d}{x % 1000:03d}" for x in ms]
    return np.array([n in have for n in names], bool)


def inset_ads(day, win, t, mask):
    """BreakModel.InsetBreakAt over a window's kept frames, for the rows in mask (a ticker channel's): True where the picture has been
    inset - black margins of 10 to 24 of 320 pixels down both sides - for 3 s, until two frames running reach an edge again or 12 s
    pass with no inset frame. On NFL Network every such stretch looked at was an advertisement, and the hand marks had missed most."""
    out = np.zeros(len(t), bool)
    since, last, fulls, prev = None, -99.0, 0, -99.0
    ms = np.round(t * 1000).astype(np.int64)
    for i in np.flatnonzero(mask):
        x = int(ms[i])
        path = os.path.join(day, win, f"{x // 3600000:02d}{x // 60000 % 60:02d}{x // 1000 % 60:02d}{x % 1000:03d}.gray")
        try:
            g = np.fromfile(path, np.uint8)
        except OSError:
            continue
        if g.size != 57600: continue
        dark = g.reshape(180, 320)[18:158].mean(0) < 14
        le = int(np.argmax(~dark)) if (~dark).any() else 320
        ri = int(np.argmax(~dark[::-1])) if (~dark).any() else 320
        if t[i] - prev > 6: since, fulls = None, 0
        prev = t[i]
        fulls = fulls + 1 if (le < 4 or ri < 4) else 0
        if 10 <= le <= 24 and 10 <= ri <= 24:
            if since is None: since = t[i]
            last = t[i]
        if since is not None and (fulls >= 2 or t[i] - last > 12): since = None
        out[i] = since is not None and last - since >= 3
    return out


def channel_at(day, win, t):
    marks = [(x, n[2:].strip()) for x, n in events(day, win, "edge") if len(n) > 2]
    marks.sort()
    if not marks: return np.array(["?"] * len(t))
    ts = np.array([x for x, _ in marks]); i = np.searchsorted(ts, t, side="right") - 1
    return np.array([marks[max(0, k)][1] for k in i])


EARLIER = {d: [e for _, e in DAYS[:k]] for k, (_, d) in enumerate(DAYS)}   # name the days oldest first
FEAT_OF = {d: f for f, d in DAYS}
P = {}          # every window of every day: its rows and captions
names = None
for feat, day in DAYS:
    rows, names_, ix = load(feat)
    names = names or names_
    assert names_ == names, "the days' readings differ"
    labels = json.load(open(os.path.join(day, "labels.json"), encoding="utf-8")).get("windows", {})
    restarts = [sec(l[:8]) for l in own_lines(os.path.join(day, "calls.log"), [os.path.join(d, "calls.log") for d in EARLIER[day]])[0] if "brain ready" in l]
    tag = os.path.basename(day.rstrip("/\\"))
    for w, a in rows.items():
        lab = labels.get(w)
        if not lab or not lab.get("ads"): continue
        t = a[:, 0]
        X, fn = features(a, names, ix, skip=SKIP2, taus=TAUS, by_seconds=True)
        # a marked ad stretch longer than 8 minutes is an infomercial (paid programming, hours of it overnight): a programme, not a break -
        # Prism covers it by the guide and the phone-number rule; it is left out of the break model's training and score
        info = [(a_, b_) for a_, b_ in lab["ads"] if sec(b_) - sec(a_) > 480]
        keep = spans(t, lab.get("reviewed", [])) & ~spans(t, lab.get("neutral", [])) & ~spans(t, info)
        for r0 in restarts: keep &= ~((t >= r0 - 20) & (t <= r0 + 180))
        y = spans(t, lab["ads"])
        if INSET:
            chn = channel_at(day, w, t)
            more = inset_ads(day, w, t, np.isin(chn, list(INSET))) & ~y
            if more.any(): print(f"{tag} {w[-6:]:>6}: {int((more & keep).sum())} marked-show seconds on {', '.join(sorted(INSET))} are an inset picture: counted as ads", flush=True)
            y = y | more
        cap = events(day, w, "cc")
        # the day's own seconds alone: frames recorded on its date, and none from the time of day where another date's lines stand in its
        # log (the replay that made the readings was fed both dates' captions and screen words there)
        own = own_frames(day, w, t)
        mixed = (t >= FOREIGN[(day, w)]) if FOREIGN[(day, w)] is not None else np.zeros(len(t), bool)
        print(f"{tag} {w[-6:]:>6}: {len(t)} rows, {int(keep.sum())} marked; not this date's {int((keep & ~own).sum())}, under another date's lines {int((keep & own & mixed).sum())}"
              + (f" (from {FOREIGN[(day, w)] // 3600:02d}:{FOREIGN[(day, w)] // 60 % 60:02d})" if FOREIGN[(day, w)] is not None else "") + f"; kept {int((keep & own & ~mixed).sum())}", flush=True)
        keep = keep & own & ~mixed
        exam = np.full(len(t), -1)
        for k_, e_ in enumerate(EXAMS or []):
            if e_["day"] == tag and e_["window"] == w: exam[keep & (t >= sec(e_["from"])) & (t < sec(e_["to"]))] = k_
        if ONLY is not None: keep = keep & spans(t, ONLY.get(tag, {}).get(w, []))
        keep = keep & (exam < 0)     # an exam's seconds train nothing
        ct = np.array([c for c, _ in cap]); lines = [x for _, x in cap]
        at = np.clip(np.searchsorted(t, ct - 3), 0, len(t) - 1) if len(ct) else np.array([], int)
        P[f"{tag}|{w}"] = dict(day=tag, t=t, X=X, y=y, keep=keep, exam=exam, act=a[:, ix["active"]], chance=a[:, ix["chance"]], adtext=a[:, ix["since_ad_text"]], cut=a[:, ix["since_cut"]], qr=a[:, ix["since_qr"]], known=a[:, ix["known_ad"]], ch=channel_at(day, w, t), ct=ct, lines=lines,
                               cy=y[at] if len(ct) else np.array([]), ckeep=keep[at] if len(ct) else np.array([], bool),
                               cch=channel_at(day, w, ct) if len(ct) else np.array([]))
if PIC:
    S_ = np.load(PIC, allow_pickle=False)
    pday = ["2026-10-07", "2026-10-08"]; pwin = [str(x) for x in S_["wins"]]
    for key, v in P.items():
        tag, w = key.split("|", 1)
        pic = np.full(len(v["t"]), np.nan)
        if tag in pday and w in pwin:
            m_ = (S_["day"] == pday.index(tag)) & (S_["win"] == pwin.index(w)) & ~np.isnan(S_["p"])
            st, sp = S_["t"][m_], S_["p"][m_]
            if len(st):
                o = np.argsort(st); st, sp = st[o], sp[o]
                j = np.clip(np.searchsorted(st, v["t"]), 1, len(st) - 1)
                j = np.where(np.abs(st[j - 1] - v["t"]) <= np.abs(st[j] - v["t"]), j - 1, j)
                near = np.abs(st[j] - v["t"]) <= 1.5
                pic[near] = sp[j[near]]
        ok = ~np.isnan(pic); cs = np.concatenate([[0], np.cumsum(np.where(ok, pic, 0))]); cn = np.concatenate([[0], np.cumsum(ok)])
        cols_ = [pic]
        for W_ in (3, 8):    # the mean over the last W seconds that have a reading
            lo = np.searchsorted(v["t"], v["t"] - W_, side="right"); hi = np.arange(len(pic)) + 1
            n_ = cn[hi] - cn[lo]
            cols_.append(np.where(n_ > 0, (cs[hi] - cs[lo]) / np.maximum(n_, 1), np.nan))
        v["X"] = np.hstack([v["X"], np.stack(cols_, 1)])
        print(f"{key[-22:]:>22}: a picture reading for {int(ok.sum())} of {len(pic)} rows, {int((ok & v['keep']).sum())} of {int(v['keep'].sum())} training rows, {int((ok & (v['exam'] >= 0)).sum())} of {int((v['exam'] >= 0).sum())} exam rows", flush=True)
    fn = fn + PIC_NAMES
FN = fn + ["cap_mean8", "cap_mean20", "cap_lines20", "cap_since"]
chans = sorted({c for v in P.values() for c, k in zip(v["ch"], v["keep"]) if k})
counts = {c: (sum(int((v["keep"] & (v["ch"] == c)).sum()) for v in P.values()), sum(int((v["keep"] & (v["ch"] == c) & v["y"]).sum()) for v in P.values())) for c in chans}
chans = [c for c in chans if counts[c][0] >= 600 and counts[c][1] >= 60]
print("channels scored:", ", ".join(f"{c} ({counts[c][0]} s, {counts[c][1]} ads)" for c in chans))


def trained_manifest(path):
    """The marked seconds this training set holds, per day and window, as spans: an exam (exam.py --trained) leaves them out, so marked
    time cannot be an exam for a model that learned from it - `reviewed` in a day's labels covers trained and exam time alike."""
    out = {}
    for key, v in P.items():
        d, w = key.split("|", 1)
        t = np.unique(v["t"][v["keep"]].astype(int))
        if not len(t): continue
        cut = np.flatnonzero(np.diff(t) > 5)
        lo = np.concatenate([[t[0]], t[cut + 1]]); hi = np.concatenate([t[cut], [t[-1]]])
        out.setdefault(d, {})[w] = [[f"{x // 3600:02d}:{x // 60 % 60:02d}:{x % 60:02d}", f"{y // 3600:02d}:{y // 60 % 60:02d}:{y % 60:02d}"] for x, y in zip(lo, hi)]
    with open(path, "w", encoding="utf-8") as f: json.dump(out, f)
    print("trained seconds listed in", path, flush=True)


def cap_fit(excl, days=None):
    L, Y = [], []
    for v in P.values():
        if days and v["day"] not in days: continue
        k = v["ckeep"] & ~np.isin(v["cch"], list(excl))
        L += [x for x, kk in zip(v["lines"], k) if kk]; Y += list(v["cy"][k])
    return CapModel().fit(L, Y)


def cap_scores(model_for):
    """Each window's caption scores, each line scored by model_for(its channel)."""
    out = {}
    for key, v in P.items():
        sc = np.full(len(v["ct"]), 0.5)
        for c in set(v["cch"]):
            k = v["cch"] == c
            sc[k] = model_for(c).score([x for x, kk in zip(v["lines"], k) if kk])
        out[key] = sc
    return out


def policy(p, on, off, hold):
    out = np.zeros(len(p), bool); up = False; run = 0
    for i, v in enumerate(p):
        run = run + 1 if v > on else 0
        if not up and run >= hold: up = True
        elif up and v < off: up = False
        out[i] = up
    return out


def rows_of(sc, sel, days=None):
    """Feature rows (readings + caption view) of the windows' kept rows chosen by sel(v) -> mask (of the named days alone, when given)."""
    Xs, ys = [], []
    for key, v in P.items():
        if days and v["day"] not in days: continue
        k = v["keep"] & sel(v)
        if not k.any(): continue
        XF = np.hstack([v["X"], cap_feat(v["t"], v["ct"], sc[key])])
        Xs.append(XF[k]); ys.append(v["y"][k].astype(float))
    return np.concatenate(Xs), np.concatenate(ys)


PAIRS = {}      # the caption classifiers that leave two channels out, kept across the held-out channels ({c, d} is {d, c})


def held_out(c, days=None):
    """Channel c scored by trees and a caption classifier that never saw it, trained on the named days alone (all of them when None):
    the cover the policy would draw on c's kept seconds, on every day."""
    def inner(d):
        key = (frozenset((c, d)), days)
        if key not in PAIRS: PAIRS[key] = cap_fit({c, d}, days)
        return PAIRS[key]
    test_cap = cap_fit({c}, days)
    sc_tr = cap_scores(lambda d: inner(d) if d != c else test_cap)
    X, y = rows_of(sc_tr, lambda v: v["ch"] != c, days)
    m = gbm(); m.fit(X, y, sample_weight=balanced(y))
    sc_te = cap_scores(lambda d: test_cap)
    cov, probs = [], []
    for key, v in P.items():
        k = v["keep"] & (v["ch"] == c)
        if not k.any(): continue
        XF = np.hstack([v["X"], cap_feat(v["t"], v["ct"], sc_te[key])])
        pr = m.predict_proba(XF)[:, 1]
        cov.append(policy(pr, **POLICY)[k])               # the policy runs over the whole window's time, as live
        probs.append((pr, k))
    return np.concatenate(cov), len(y), probs


if "--manifest" in args: trained_manifest(args[args.index("--manifest") + 1])


def ahead(tt, pr, cv, since_cut, D, low=0.3, high=0.7, short=8, first=True):
    """The same covers, placed with D seconds of hindsight (the look-ahead study, 2026-10-09: the visible picture held D seconds
    behind a hidden copy of the channel, so what the detector decides is known D seconds before it is shown). With that much warning:
    - a gap of D seconds or less inside a cover is known to close, and is closed;
    - a cover of `short` seconds or less is known to be a flicker, and is not drawn;
    - a cover begins where its score began to climb (back to the last second under `low`, D seconds at most), at the cut there;
    - a cover ends where its score began to fall (back to the last second over `high`, D seconds at most), at the cut there."""
    n = len(tt); iv = []; on = None
    for i in range(n):
        if cv[i] and on is None: on = i
        if not cv[i] and on is not None: iv.append([on, i]); on = None
    if on is not None: iv.append([on, n])
    cuts = np.unique(np.round((tt - since_cut)[since_cut < 1.5], 0))
    merged = []
    for a_, b_ in iv:
        if merged and tt[a_] - tt[merged[-1][1] - 1] <= D: merged[-1][1] = b_
        else: merged.append([a_, b_])
    out = np.zeros(n, bool)
    for a_, b_ in merged:
        if tt[b_ - 1] - tt[a_] <= short: continue
        i = a_
        while i > 0 and pr[i - 1] >= low and tt[a_] - tt[i - 1] <= D: i -= 1
        t0 = tt[i]
        c = cuts[(cuts >= t0 - 3) & (cuts <= t0 + 1)]
        if len(c): t0 = max(c[0] if first else c[-1], tt[a_] - D)
        j = b_ - 1
        while j > a_ and pr[j] <= high and tt[b_ - 1] - tt[j] <= D: j -= 1
        t1 = tt[min(j + 1, n - 1)]
        c = cuts[(cuts >= t1 - 3) & (cuts <= t1 + 1)]
        if len(c): t1 = c[-1]
        out |= (tt >= t0) & (tt < max(t1, t0 + 1))
    return out


if EXAMS:
    # The exams, by trees trained on every training second. Fitted as the export fits them (each training row's captions scored by a
    # classifier that never saw its channel); an exam's rows are scored as live scores them (the classifier of all the training).
    from sklearn.metrics import average_precision_score, roc_auc_score
    caps = {c: cap_fit({c}) for c in set(np.concatenate([v["cch"] for v in P.values() if len(v["cch"])]))}
    final_cap = cap_fit(set())
    sc_fit = cap_scores(lambda d: caps.get(d, final_cap)); sc_live = cap_scores(lambda d: final_cap)
    Xa, ya = rows_of(sc_fit, lambda v: np.ones(len(v["t"]), bool))
    variants = [("as live", [i for i, n in enumerate(FN) if n not in PIC_NAMES])]
    if PIC:
        variants += [("with the picture", list(range(len(FN)))), ("with the picture's 3 s mean alone", [i for i, n in enumerate(FN) if n not in ("pic", "pic_mean8")])]
    ON = 0.80
    print(f"EXAMS: trees trained on {len(ya)} marked seconds ({int(ya.sum())} ads); cover above {ON} twice running, ends below 0.55; the trees alone, none of Prism's sure rules", flush=True)
    for vn, cols in variants:
        m = gbm(); m.fit(Xa[:, cols], ya, sample_weight=balanced(ya))
        if PIC and len(cols) == len(FN):
            # which inputs the trees lean on: the share of all splits
            cnt = np.zeros(len(cols))
            for it in m._predictors:
                nd = it[0].nodes
                for f_ in nd["feature_idx"][nd["is_leaf"] == 0]: cnt[f_] += 1
            top = np.argsort(-cnt)[:8]
            print("   splits by input: " + ", ".join(f"{FN[cols[i]]} {100 * cnt[i] / cnt.sum():.1f}%" for i in top) + "; " + ", ".join(f"{n} {100 * cnt[cols.index(FN.index(n))] / cnt.sum():.1f}%" for n in PIC_NAMES), flush=True)
        tot = [0, 0, 0, 0]; lat_all = []; allp, ally = [], []
        print(f" {vn}:", flush=True)
        for k_, e_ in enumerate(EXAMS):
            for key, v in P.items():
                em = v["exam"] == k_
                if not em.any(): continue
                XF = np.hstack([v["X"], cap_feat(v["t"], v["ct"], sc_live[key])])[:, cols]
                pr = m.predict_proba(XF)[:, 1]; cv = policy(pr, ON, 0.55, 2)
                yy = v["y"][em] > 0; cc = cv[em]; tt = v["t"]
                # how many seconds into each marked break the cover first stands
                lab = json.load(open(os.path.join([d for _, d in DAYS if os.path.basename(d.rstrip("/\\")) == v["day"]][0], "labels.json"), encoding="utf-8"))["windows"][key.split("|", 1)[1]]["ads"]
                lat = []
                for a_, b_ in lab:
                    if not (sec(e_["from"]) <= sec(a_) < sec(e_["to"])): continue
                    seg = em & (tt >= sec(a_)) & (tt <= sec(b_))
                    if seg.sum() < 5: continue
                    hit = np.flatnonzero(seg & cv)
                    lat.append(float(tt[hit[0]] - sec(a_)) if len(hit) else float(sec(b_) - sec(a_)))
                lat_all += lat
                tot[0] += int((cc & yy).sum()); tot[1] += int(yy.sum()); tot[2] += int((cc & ~yy).sum()); tot[3] += int((~yy).sum())
                allp.append(pr[em]); ally.append(yy)
                print(f"   {e_['name']:<18} ads covered {100 * cc[yy].mean():5.1f}%  show wrongly covered {100 * cc[~yy].mean():5.2f}% ({int((cc & ~yy).sum())} s)  AUC {roc_auc_score(yy, pr[em]):.4f}  cover begins {np.median(lat):4.1f} s into a break (median of {len(lat)}, mean {np.mean(lat):.1f})", flush=True)
        if vn == "as live":
            # the look-ahead: the same trees and threshold, their covers placed with D seconds of hindsight
            for D_, lo_, hi_, fi_ in ((0, 0, 0, True), (10, 0.3, 0.7, True), (20, 0.3, 0.7, True), (30, 0.3, 0.7, True), (20, 0.3, 0.7, False), (20, 0.3, 0.85, False), (20, 0.3, 0.9, False), (20, 0.5, 0.9, False), (20, 0.15, 0.9, False)):
                tot2 = [0, 0, 0, 0]; lat2 = []; lin2 = []; per = []
                for k_, e_ in enumerate(EXAMS):
                    for key, v in P.items():
                        em = v["exam"] == k_
                        if not em.any(): continue
                        XF = np.hstack([v["X"], cap_feat(v["t"], v["ct"], sc_live[key])])[:, cols]
                        pr = m.predict_proba(XF)[:, 1]; cv = policy(pr, ON, 0.55, 2)
                        if D_: cv = ahead(v["t"], pr, cv, v["cut"], D_, lo_, hi_, 8, fi_)
                        yy = v["y"][em] > 0; cc = cv[em]; tt = v["t"]
                        lab = json.load(open(os.path.join([d for _, d in DAYS if os.path.basename(d.rstrip("/\\")) == v["day"]][0], "labels.json"), encoding="utf-8"))["windows"][key.split("|", 1)[1]]["ads"]
                        for a_, b_ in lab:
                            if not (sec(e_["from"]) <= sec(a_) < sec(e_["to"])): continue
                            seg = em & (tt >= sec(a_)) & (tt <= sec(b_))
                            if seg.sum() < 5: continue
                            hit = np.flatnonzero(seg & cv)
                            lat2.append(float(tt[hit[0]] - sec(a_)) if len(hit) else float(sec(b_) - sec(a_)))
                            after = em & (tt > sec(b_)) & (tt <= sec(b_) + 60)
                            run = 0
                            for q in np.flatnonzero(after):
                                if cv[q]: run += 1
                                else: break
                            lin2.append(run)
                        tot2[0] += int((cc & yy).sum()); tot2[1] += int(yy.sum()); tot2[2] += int((cc & ~yy).sum()); tot2[3] += int((~yy).sum())
                        per.append(f"{e_['name'][:10]} {100 * cc[yy].mean():.1f}/{int((cc & ~yy).sum())}")
                print(f"   look-ahead {D_:>2} s (from {lo_}, to {hi_}, {'first' if fi_ else 'last'} cut): ads covered {100 * tot2[0] / tot2[1]:5.1f}%  show wrongly covered {100 * tot2[2] / tot2[3]:5.2f}% ({tot2[2]} s)  cover begins {np.median(lat2):4.1f} s in (mean {np.mean(lat2):.1f}), stays {np.median(lin2):.0f} s after (mean {np.mean(lin2):.1f})  |  " + "  ".join(per), flush=True)
        allp = np.concatenate(allp); ally = np.concatenate(ally)
        print(f"   ALL                ads covered {100 * tot[0] / tot[1]:5.1f}%  show wrongly covered {100 * tot[2] / tot[3]:5.2f}% ({tot[2]} s)  AUC {roc_auc_score(ally, allp):.4f}  AP {average_precision_score(ally, allp):.4f}  cover begins {np.median(lat_all):.1f} s in (median of {len(lat_all)}, mean {np.mean(lat_all):.1f})", flush=True)
        # the same trees at the threshold that wrongly covers as much show time as the live inputs do at 0.80: the gain at equal cost
        for on2 in (0.70, 0.75, 0.85, 0.90):
            c0 = c1 = n0 = n1 = 0
            for k_, e_ in enumerate(EXAMS):
                for key, v in P.items():
                    em = v["exam"] == k_
                    if not em.any(): continue
                    XF = np.hstack([v["X"], cap_feat(v["t"], v["ct"], sc_live[key])])[:, cols]
                    cv = policy(m.predict_proba(XF)[:, 1], on2, on2 - 0.25, 2)[em]; yy = v["y"][em] > 0
                    c1 += int((cv & yy).sum()); n1 += int(yy.sum()); c0 += int((cv & ~yy).sum()); n0 += int((~yy).sum())
            print(f"      at {on2:.2f}: ads {100 * c1 / n1:5.1f}%  wrong {100 * c0 / n0:5.2f}% ({c0} s)", flush=True)
if "--no-eval" not in args:
    T0 = time.time()
    cols = ["rules", "model"] + (["base"] if BASE else []) + (["model+rules"] if "--with-rules" in args else [])
    tot = {k_: [0, 0, 0, 0] for k_ in cols}
    PROBS = {}      # per scorer: (a window's probabilities over its whole time, the held-out channel's kept rows, their marks)
    if BASE: print("base = the same recipe trained on", ", ".join(sorted(BASE)), "alone (what the live model saw), the channel still held out", flush=True)
    for n_, c in enumerate(chans):
        mine = [v for v in P.values() if (v["keep"] & (v["ch"] == c)).any()]
        yv = np.concatenate([v["y"][v["keep"] & (v["ch"] == c)] for v in mine])
        act = np.concatenate([v["act"][v["keep"] & (v["ch"] == c)] > 0 for v in mine])
        on_days = sorted({v["day"] for v in mine})
        ads = yv > 0
        got = {"rules": act}
        got["model"], n_all, pr = held_out(c)
        PROBS.setdefault("model", []).extend((p_, k_, y_) for (p_, k_), y_ in zip(pr, [v["y"][v["keep"] & (v["ch"] == c)] for v in mine]))
        if BASE:
            got["base"], n_base, pr = held_out(c, BASE)
            PROBS.setdefault("base", []).extend((p_, k_, y_) for (p_, k_), y_ in zip(pr, [v["y"][v["keep"] & (v["ch"] == c)] for v in mine]))
        PROBS.setdefault("rules", []).extend((v["chance"], v["keep"] & (v["ch"] == c), v["y"][v["keep"] & (v["ch"] == c)]) for v in mine)
        if "--with-rules" in args:
            # the rules' break counts too while an ad names itself: the rules at 90% or more, and the ad's words or a QR code on screen in
            # the last 10 s or a known ad picture (live 2026-10-08, NFL Network: the rules at 93% with an address on screen, the model at 0.05)
            sure = np.concatenate([((v["act"] > 0) & (v["chance"] >= 0.9) & ((v["adtext"] <= 10) | (v["qr"] <= 10) | (v["known"] > 0)))[v["keep"] & (v["ch"] == c)] for v in mine])
            got["model+rules"] = got["model"] | sure
        line = f"{c:>20}:"
        for k_ in cols:
            a_, s_ = got[k_][ads].mean(), got[k_][~ads].mean()
            line += f"  {k_} ads {100*a_:5.1f}% wrong {100*s_:5.2f}%"
            tot[k_][0] += a_ * ads.sum(); tot[k_][1] += ads.sum(); tot[k_][2] += s_ * (~ads).sum(); tot[k_][3] += (~ads).sum()
        print(line + f"   ({ads.sum()} ad s, {(~ads).sum()} show s; marked on {'+'.join(d[-5:] for d in on_days)}; trained on {n_all} s{', base ' + str(n_base) if BASE else ''}; {n_ + 1}/{len(chans)}, {time.time() - T0:.0f} s)", flush=True)
    for k_, v in tot.items():
        print(f"ALL {k_}: ads covered {100*v[0]/v[1]:.1f}%  show wrongly covered {100*v[2]/v[3]:.2f}%", flush=True)
    # one threshold is one point on each scorer's curve: the ranking itself (AUC: the chance a marked ad second scores above a show second;
    # average precision), then the same policy at a range of thresholds, to read two scorers at the same wrong-cover rate
    from sklearn.metrics import average_precision_score, roc_auc_score
    for k_, L in PROBS.items():
        ps = np.concatenate([p_[m_] for p_, m_, _ in L]); ys = np.concatenate([y_ for _, _, y_ in L]) > 0
        print(f"RANK {k_}: AUC {roc_auc_score(ys, ps):.4f}  average precision {average_precision_score(ys, ps):.4f}  ({len(ys)} s)", flush=True)
    print("SWEEP (cover begins above `on` twice running, ends below on - 0.30): ads covered % / show wrongly covered %", flush=True)
    for on in (0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95, 0.98):
        line = f"  on {on:.2f}:"
        for k_, L in PROBS.items():
            cv = np.concatenate([policy(p_, on, on - 0.30, POLICY["hold"])[m_] for p_, m_, _ in L]); ys = np.concatenate([y_ for _, _, y_ in L]) > 0
            line += f"   {k_} {100 * cv[ys].mean():5.1f} / {100 * cv[~ys].mean():5.2f}"
        print(line, flush=True)

if EXPORT:
    caps = {c: cap_fit({c}) for c in set(np.concatenate([v["cch"] for v in P.values() if len(v["cch"])]))}
    final_cap = cap_fit(set())
    sc = cap_scores(lambda d: caps.get(d, final_cap))
    X, y = rows_of(sc, lambda v: np.ones(len(v["t"]), bool))
    m = gbm(); m.fit(X, y, sample_weight=balanced(y))
    print(f"exported model: trained on {len(y)} marked seconds ({int(y.sum())} ads), {X.shape[1]} inputs, caption words {len(final_cap.vocab)}")
    trees = []
    for it in m._predictors:
        n = it[0].nodes
        trees.append({"f": n["feature_idx"].tolist(), "thr": [float(x) for x in n["num_threshold"]], "l": n["left"].tolist(), "r": n["right"].tolist(),
                      "leaf": [int(x) for x in n["is_leaf"]], "v": [float(x) for x in n["value"]], "ml": [int(x) for x in n["missing_go_to_left"]]})
    base = float(np.ravel(m._baseline_prediction)[0])
    chk = X[np.random.RandomState(0).choice(len(X), 400, replace=False)]
    z = np.full(len(chk), base)
    for tr in trees:
        for i in range(len(chk)):
            k = 0
            while not tr["leaf"][k]: k = tr["l"][k] if chk[i, tr["f"][k]] <= tr["thr"][k] else tr["r"][k]
            z[i] += tr["v"][k]
    diff = np.abs(1 / (1 + np.exp(-z)) - m.predict_proba(chk)[:, 1]).max()
    print(f"export check: {diff:.2e}"); assert diff < 1e-6
    model = {"version": 2, "trained": len(y), "days": [os.path.basename(d.rstrip("/\\")) for _, d in DAYS], "inputs": list(names), "skip": list(SKIP2),
             "kernels": list(TAUS), "rolls": {"signals": ["logo_ratio", "logo_seen", "change", "std", "mean"], "windows": [5, 15, 30], "seconds": True},
             "captionInputs": ["cap_mean8", "cap_mean20", "cap_lines20", "cap_since"], "features": FN, "baseline": base, "trees": trees,
             "caption": final_cap.export(), "captionLag": 3, "policy": POLICY}
    with open(EXPORT, "w", encoding="utf-8") as f: json.dump(model, f, separators=(",", ":"))
    print("written", EXPORT, os.path.getsize(EXPORT) // 1024, "KB")
    trained_manifest(os.path.splitext(EXPORT)[0] + ".trained.json")
    if PARITY:
        with open(PARITY, "w") as f:
            f.write("win,t,p\n")
            for key, v in P.items():
                XF = np.hstack([v["X"], cap_feat(v["t"], v["ct"], final_cap.score(v["lines"]) if v["lines"] else np.array([]))])
                for tt, pp in zip(v["t"], m.predict_proba(XF)[:, 1]): f.write(f"{key},{tt:.3f},{pp:.6f}\n")
        print("parity rows written", PARITY)
