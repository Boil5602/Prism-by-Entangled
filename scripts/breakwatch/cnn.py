"""A small picture classifier for the break watch (2026-11-06, the feature review's item 3), trained and judged on the bench.

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/cnn.py train <out folder>
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/cnn.py blend <out folder> <chance folder>

train: every labelled day but the exams' (10-08) gives frames from its reviewed time (labels.json, else labels.auto.json, PROMOS=show
as for the exams, infomercials and neutral time left out, as train2.py), one every STEP seconds. Each sample is the recorded frame
(320x180 grey, the frame both the app and the extension read) cut to 106x60 (3x3 blocks), beside its change from the frame before. The network keeps
where things are (no global pooling) so a corner logo counts. Judged frame by frame on the exams' own spans, which it never saw; its
chance for every second of the exams is written to <out>/par/<exam>.csv in run_exams' LPARITYDIR form.
blend: the cover policy on ext-a's chance (run_exams LPARITYDIR) alone, and with the network's chance added in logit at weight W, scored
with exam.py as prior.py does.
"""
import csv, glob, json, math, os, re, subprocess, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import promos
GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
exams = json.load(open(os.path.join(HERE, "exams.json"), encoding="utf-8"))
# the seven exams' day stays out of training whole; the other exam sets (exams-night.json, 2026-11-07) leave out only their own hours on
# their own windows, with ten minutes' margin each side - the rest of that day (the sampler's low channels, 2026-11-07 evening) trains.
# Leaving the whole day out cost the network its data from those channels (AUC on the seven exams 0.926 -> 0.883).
LEAVE = set(e["day"] for e in exams)
LEAVE_SPANS = {}
for _f in ("exams-night.json",):
    if os.path.exists(os.path.join(HERE, _f)):
        for e in json.load(open(os.path.join(HERE, _f), encoding="utf-8")):
            def _sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
            LEAVE_SPANS.setdefault((e["day"], e["window"]), []).append((_sec(e["from"]) - 600, _sec(e["to"]) + 600))
W_, H_ = 106, 60   # 320x180 in 3x3 blocks
STEP = int(os.environ.get("STEP", "3"))


def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
def clock(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"
def name(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])
def inside(t, spans): return any(a <= t < b for a, b in spans)


def frames_of(day, win):
    d = os.path.join(GOLD, day, win)
    fs = sorted(glob.glob(os.path.join(d, "*.gray")))
    def t(n): return int(n[:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6]) + int(n[6:9]) / 1000.0   # HHMMSSmmm, as bwtest's Sec9
    return [(t(os.path.basename(f)[:-5]), f) for f in fs]


def small(path):
    a = np.fromfile(path, dtype=np.uint8)
    if a.size != 320 * 180: return None
    a = a.reshape(180, 320).astype(np.float32)
    return a[:, :318].reshape(60, 3, 106, 3).mean(axis=(1, 3))


def pair(prev, cur):
    c = small(cur)
    if c is None: return None
    p = small(prev) if prev else None
    dlt = (c - p) if p is not None else np.zeros_like(c)
    return np.stack([c / 255.0, dlt / 255.0]).astype(np.float16)


def labelled(day):
    dd = os.path.join(GOLD, day)
    lp = os.path.join(dd, "labels.json")
    labels = json.load(open(lp, encoding="utf-8")).get("windows", {}) if os.path.exists(lp) else {}
    labels = promos.windows_with_auto(dd, labels)
    out = {}
    for w, lab in labels.items():
        if not lab.get("ads") or not os.path.isdir(os.path.join(dd, w)): continue
        ads = promos.ads_for(dd, w, lab["ads"]) if promos.on() else lab["ads"]
        ads = [(sec(a), sec(b)) for a, b in ads]
        info = [(a, b) for a, b in ads if b - a > 480]
        rev = [(sec(a), sec(b)) for a, b in lab.get("reviewed", [])]
        neu = [(sec(a), sec(b)) for a, b in lab.get("neutral", [])]
        out[w] = (ads, info, rev, neu)
    return out


def nearest(fr, i, back, tol=0.7):
    """The frame nearest `back` seconds before frame i (its path), within tol, else None."""
    want = fr[i][0] - back; j = i
    while j > 0 and fr[j - 1][0] >= want - tol: j -= 1
    best = None
    for k in range(j, i):
        if abs(fr[k][0] - want) <= tol and (best is None or abs(fr[k][0] - want) < abs(fr[best][0] - want)): best = k
    return fr[best][1] if best is not None else None


# TEMPORAL=1 (2026-11-07, the strategy ledger's second untried row): a break is a rhythm one frame cannot show. Beside the frame and its
# change from the frame before, two channels of the ten seconds behind it, at a two-second stride: the mean absolute change between
# successive strides (cuts come every two to four seconds in a break) and the change from the frame six seconds before. A frame missing
# from the recording leaves its stride out; with none, the channels are zero.
TEMPORAL = os.environ.get("TEMPORAL") == "1"
CH = 4 if TEMPORAL else 2


def sample(fr, i):
    t, f = fr[i]
    prev = fr[i - 1][1] if i and t - fr[i - 1][0] < 3 else None
    x = pair(prev, f)
    if x is None or not TEMPORAL: return x
    c = x[0].astype(np.float32) * 255
    greys = [c]
    for back in (2, 4, 6, 8, 10):
        p = nearest(fr, i, back); g = small(p) if p else None
        greys.append(g)
    diffs = [np.abs(greys[k] - greys[k + 1]) for k in range(5) if greys[k] is not None and greys[k + 1] is not None]
    energy = np.mean(diffs, axis=0) if diffs else np.zeros_like(c)
    six = (c - greys[3]) if greys[3] is not None else np.zeros_like(c)
    return np.concatenate([x, np.stack([energy / 255.0, six / 255.0]).astype(np.float16)])


def build_window(args):
    day, w, step = args
    ads, info, rev, neu = labelled(day)[w]
    X, Y = [], []
    fr = frames_of(day, w); last = -1e9
    exam = LEAVE_SPANS.get((day, w), [])
    for i, (t, f) in enumerate(fr):
        if t - last < step or not inside(t, rev) or inside(t, neu) or inside(t, info) or inside(t, exam): continue
        x = sample(fr, i)
        if x is None: continue
        last = t; X.append(x); Y.append(1 if inside(t, ads) else 0)
    return day, w, (np.stack(X) if X else np.zeros((0, CH, H_, W_), np.float16)), np.array(Y, dtype=np.float32)


def build(days, step, cap):
    from concurrent.futures import ProcessPoolExecutor
    jobs = [(d, w, step) for d in days for w in labelled(d)]
    X, Y, D, per = [], [], [], {}
    with ProcessPoolExecutor(int(os.environ.get("WORKERS", "4"))) as ex:   # each window's frames read in its own process
        for day, w, x, y in ex.map(build_window, jobs):
            X.append(x); Y.append(y); D.append(np.full(len(y), days.index(day), np.int32)); n = per.setdefault(day, [0, 0]); n[0] += len(y); n[1] += int(y.sum())
    for day in days:
        if day in per: print(f"{day}: {per[day][0]} samples, {per[day][1]} ads", flush=True)
    X, Y, D = np.concatenate(X), np.concatenate(Y), np.concatenate(D)
    if len(Y) > cap:
        k = np.random.default_rng(1).choice(len(Y), cap, replace=False); X, Y, D = X[k], Y[k], D[k]
    return X, Y, D   # D: each sample's day, an index into days (the folds of HARDNEG / CALIB)


# Phase 4 of the boundary-first redesign (2026-11-08): the network has no global pooling, so a corner logo keeps its place and the
# network is partly a logo recognizer for the channels it trained on. Three variants, each a switch (off by default):
#   MASKCORNERS=1  the four corner bands (a fifth of the height, a quarter of the width) zeroed in every channel of the input;
#   CORNERSWAP=1   in each batch, the corner bands of ad frames and show frames are swapped at random (a logo band from a show frame
#                  lands on an ad frame and vice versa), so the presence of a logo stops telling the two apart. The learned .logo
#                  references are not read: the swap takes real corners from real frames, which carries their bugs, scores and tickers too;
#   TICKER=1       with CORNERSWAP, a bright ticker band (the bottom eighth) with text-like noise and a small bug is composited onto a
#                  third of the ad frames (the election-night case, B-476: the station's ticker stays through the ads).
MASKCORNERS = os.environ.get("MASKCORNERS") == "1"; CORNERSWAP = os.environ.get("CORNERSWAP") == "1"; TICKER = os.environ.get("TICKER") == "1"
CH_, CW_ = 12, 26   # the corner band in 3x3 blocks: 36 px high, 78 px wide on the 320x180 frame


def augment(x, y):
    """Batch augmentation for the Phase 4 variants; x: (n, ch, 60, 106) float tensor, y: (n,) labels."""
    import torch
    if MASKCORNERS:
        x = x.clone(); x[:, :, :CH_, :CW_] = 0; x[:, :, :CH_, -CW_:] = 0; x[:, :, -CH_:, :CW_] = 0; x[:, :, -CH_:, -CW_:] = 0
        return x
    if CORNERSWAP:
        x = x.clone(); ads = torch.nonzero(y > 0.5).flatten(); shows = torch.nonzero(y <= 0.5).flatten()
        n = min(len(ads), len(shows))
        if n > 0:
            a = ads[torch.randperm(len(ads))[:n]]; b = shows[torch.randperm(len(shows))[:n]]
            swap = torch.rand(n) < 0.5
            a, b = a[swap], b[swap]
            for (r0, r1, c0, c1) in ((0, CH_, 0, CW_), (0, CH_, -CW_, None), (-CH_, None, 0, CW_), (-CH_, None, -CW_, None)):
                if torch.rand(1).item() < 0.7:
                    ca = x[a, :, r0:r1, c0:c1].clone(); x[a, :, r0:r1, c0:c1] = x[b, :, r0:r1, c0:c1]; x[b, :, r0:r1, c0:c1] = ca
        if TICKER:
            ads = torch.nonzero(y > 0.5).flatten(); pick = ads[torch.rand(len(ads)) < 0.33]
            if len(pick):
                band = x[pick, 0, -8:, :]
                noise = (torch.rand_like(band) < 0.15).float() * 0.9 + 0.08   # a bright strip with text-like speckle
                x[pick, 0, -8:, :] = noise
                x[pick, 0, -12:-8, :16] = 0.95   # a station bug above the strip's left end
                if x.shape[1] > 1: x[pick, 1, -12:, :] = 0   # the band does not change frame to frame
        return x
    return x


def net():
    import torch.nn as nn
    def blk(i, o, s): return [nn.Conv2d(i, o, 3, s, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True)]
    return nn.Sequential(*blk(CH, 16, 2), *blk(16, 32, 2), *blk(32, 48, 2), *blk(48, 64, 2),   # 60x106 -> 4x7
                         nn.Flatten(), nn.Dropout(0.3), nn.Linear(64 * 4 * 7, 64), nn.ReLU(inplace=True), nn.Linear(64, 1))


def auc(p, y):
    o = np.argsort(p); r = np.empty(len(p)); r[o] = np.arange(1, len(p) + 1)
    pos = y == 1; n1, n0 = pos.sum(), (~pos).sum()
    return (r[pos].sum() - n1 * (n1 + 1) / 2) / max(1, n1 * n0)


def train(out):
    import torch
    torch.manual_seed(1); torch.set_num_threads(int(os.environ.get("THREADS", max(1, (os.cpu_count() or 4) // 2))))   # half the cores unless told: the sampler and PRISM keep theirs
    days = [os.path.basename(d) for d in sorted(glob.glob(os.path.join(GOLD, "2026-*"))) if os.path.basename(d) not in LEAVE]
    t0 = time.time()
    X, Y, D = build(days, STEP, int(os.environ.get("CAP", "80000")))
    print(f"training on {len(Y)} samples ({Y.mean() * 100:.1f}% ads) from {', '.join(days)}, built in {time.time() - t0:.0f} s", flush=True)
    Xt, Yt = torch.from_numpy(X), torch.from_numpy(Y)
    E = int(os.environ.get("EPOCHS", "6"))

    def fit(idx, w, epochs, tag):
        """A network trained on the samples idx, each weighted w (ones for plain training)."""
        m = net(); opt = torch.optim.AdamW(m.parameters(), 2e-3, weight_decay=1e-4)
        ym = float(Y[idx].mean()); pw = torch.tensor([(1 - ym) / max(1e-6, ym)])
        lossf = torch.nn.BCEWithLogitsLoss(pos_weight=pw, reduction="none"); Wt = torch.from_numpy(w)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=epochs * math.ceil(len(idx) / 128))
        it = torch.from_numpy(idx)
        for ep in range(epochs):
            m.train(); perm = it[torch.randperm(len(idx))]; tot = 0
            for b in range(0, len(idx), 128):
                k = perm[b:b + 128]; x = Xt[k].float()
                dx, dy = np.random.randint(-3, 4), np.random.randint(-2, 3)   # a little shift and brightness: recordings differ a little
                x = torch.roll(x, (dy, dx), (2, 3)); x[:, 0] = x[:, 0] * float(np.random.uniform(0.85, 1.15))
                x = augment(x, Yt[k])
                loss = (lossf(m(x).squeeze(1), Yt[k]) * Wt[k]).mean(); opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot += loss.item() * len(k)
            print(f"{tag} epoch {ep + 1}: loss {tot / len(idx):.4f} ({time.time() - t0:.0f} s)", flush=True)
        return m

    def logits(m, idx):
        m.eval(); out_ = []
        with torch.no_grad():
            for k in range(0, len(idx), 512): out_.append(m(Xt[torch.from_numpy(idx[k:k + 512])].float()).squeeze(1).numpy())
        return np.concatenate(out_) if out_ else np.zeros(0, np.float32)

    # HARDNEG=1 / CALIB=1 (2026-11-07, the strategy ledger's third and fourth untried rows). Two folds by day: each half's samples are
    # scored by a network that never saw them. HARDNEG weights the samples that network got wrong (a show frame over 0.5, an ad frame
    # under) three times in the final training, so the network dwells on the scenes that fool it. CALIB fits a scale and a shift on
    # the held-out logits (Platt), written to calibration.json and carried in the export, so the chance means what it says.
    w = np.ones(len(Y), np.float32)
    if os.environ.get("HARDNEG") == "1" or os.environ.get("CALIB") == "1":
        held = np.zeros(len(Y), np.float32); fold = D % 2
        for f_ in (0, 1):
            tr = np.flatnonzero(fold != f_); te = np.flatnonzero(fold == f_)
            held[te] = logits(fit(tr, w, max(2, E // 2), f"fold {f_}"), te)
        p = 1 / (1 + np.exp(-held))
        if os.environ.get("HARDNEG") == "1":
            hard = ((Y == 0) & (p > 0.5)) | ((Y == 1) & (p < 0.5)); w[hard] = 3
            print(f"hard samples: {int(hard.sum())} ({((Y == 0) & (p > 0.5)).sum() / max(1, (Y == 0).sum()) * 100:.1f}% of show frames over 0.5, "
                  f"{((Y == 1) & (p < 0.5)).sum() / max(1, (Y == 1).sum()) * 100:.1f}% of ad frames under); held-out AUC {auc(p, Y):.3f}", flush=True)
        if os.environ.get("CALIB") == "1":
            a_ = torch.tensor(1.0, requires_grad=True); b_ = torch.tensor(0.0, requires_grad=True)
            L_, Y_ = torch.from_numpy(held), torch.from_numpy(Y)
            opt_ = torch.optim.LBFGS([a_, b_], max_iter=300)
            def closure():
                opt_.zero_grad(); loss = torch.nn.functional.binary_cross_entropy_with_logits(a_ * L_ + b_, Y_); loss.backward(); return loss
            opt_.step(closure)
            cal = {"a": a_.item(), "b": b_.item()}
            json.dump(cal, open(os.path.join(out, "calibration.json"), "w"))
            print(f"calibration from the held folds: logit' = {cal['a']:.3f} * logit + {cal['b']:.3f}", flush=True)
    m = fit(np.arange(len(Y)), w, E, "final")
    os.makedirs(os.path.join(out, "par"), exist_ok=True)
    torch.save(m.state_dict(), os.path.join(out, "cnn.pt"))
    # the exams, every second, never seen in training
    m.eval(); allp, ally = [], []
    lab = labelled(exams[0]["day"])
    for e in exams:
        a, b = sec(e["from"]), sec(e["to"]); fr = [x for x in frames_of(e["day"], e["window"])]
        rows, xs = [], []
        for i, (t, f) in enumerate(fr):
            if not (a <= t < b): continue
            x = sample(fr, i)
            if x is None: continue
            xs.append(x); rows.append(t)
        ps = []
        with torch.no_grad():
            for k in range(0, len(xs), 512): ps.append(torch.sigmoid(m(torch.from_numpy(np.stack(xs[k:k + 512])).float()).squeeze(1)).numpy())
        ps = np.concatenate(ps) if ps else np.zeros(0)
        with open(os.path.join(out, "par", name(e) + ".csv"), "w", newline="") as f:
            wr = csv.writer(f); wr.writerow(["win", "t", "p"])
            for t, p in zip(rows, ps): wr.writerow([e["window"], f"{t:.3f}", f"{p:.6f}"])
        L = lab.get(e["window"])
        if L:
            ads, info, rev, neu = L
            for t, p in zip(rows, ps):
                if inside(t, rev) and not inside(t, neu) and not inside(t, info): allp.append(p); ally.append(1 if inside(t, ads) else 0)
        print(f"{e['name']}: {len(rows)} frames judged", flush=True)
    allp, ally = np.array(allp), np.array(ally)
    print(f"exams, frame by frame: AUC {auc(allp, ally):.3f} over {len(ally)} s ({ally.mean() * 100:.1f}% ads); at 0.5: "
          f"{((allp > 0.5) & (ally == 1)).sum() / max(1, ally.sum()) * 100:.1f}% of ad seconds, {((allp > 0.5) & (ally == 0)).sum() / max(1, (ally == 0).sum()) * 100:.1f}% of show seconds", flush=True)


def chances(path):
    out = {}
    with open(path, newline="") as f:
        for row in csv.reader(f):
            try: out.setdefault(row[0], []).append((float(row[1]), float(row[2])))
            except (ValueError, IndexError): continue
    return {w: sorted(v) for w, v in out.items()}


def policy(series, on, off, hold=2):
    up, run, calls = False, 0, []
    for t, q in series:
        run = run + 1 if q > on else 0
        if not up and run >= hold: up = True; calls.append((t, "break"))
        elif up and q < off: up = False; calls.append((t, "show"))
    return calls


def score(tag, calls_for):
    tot = dict(ad=0, cov=0, show=0, wrong=0, late=0, mid=0, early=0, linger=0, own=0)
    for e in exams:
        out = subprocess.run([sys.executable, os.path.join(HERE, "exam.py"), "--trained", os.path.join(HERE, "trained.json"), e["day"], e["window"], e["from"], e["to"], "x=" + calls_for(e)],
                             capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
        h = re.search(r"(\d+) ad s, (\d+) show s", out)
        m1 = re.search(r"ads covered\s+([\d.]+)%.*?missed (\d+) s: began late (\d+), dropped mid-break (\d+), lifted early (\d+)", out)
        m2 = re.search(r"\((\d+) s\): stayed on after a break (\d+), came up ahead of one (\d+), on their own (\d+) s", out)
        if not (h and m1 and m2): print(tag, e["name"], "not scored"); continue
        tot["ad"] += int(h.group(1)); tot["cov"] += int(h.group(1)) - int(m1.group(2)); tot["show"] += int(h.group(2)); tot["wrong"] += int(m2.group(1))
        tot["late"] += int(m1.group(3)); tot["mid"] += int(m1.group(4)); tot["early"] += int(m1.group(5)); tot["linger"] += int(m2.group(2)); tot["own"] += int(m2.group(4))
    print(f"{tag}: ads covered {100 * tot['cov'] / tot['ad']:.1f}% | show wrongly covered {100 * tot['wrong'] / tot['show']:.2f}% | missed: late {tot['late']}, "
          f"mid {tot['mid']}, early {tot['early']} | wrong: stayed on {tot['linger']}, own {tot['own']}", flush=True)


def blend(out, par_dir):
    def logit(p): p = min(0.999, max(0.001, p)); return math.log(p / (1 - p))
    def sig(x): return 1 / (1 + math.exp(-x))
    # WS=only (2026-11-07): the network's chance alone through the same policy, the trees left out, for the alone-against-combined reading
    for W in ["only" if x.strip() == "only" else float(x) for x in os.environ.get("WS", "0,0.25,0.5,1").split(",")]:
        for on, off in ((0.8, 0.45),):
            d = os.path.join(out, f"blend_w{W}"); os.makedirs(d, exist_ok=True)
            def calls_for(e, W=W, on=on, off=off, d=d):
                ps = chances(os.path.join(par_dir, name(e) + ".csv")); cs = chances(os.path.join(out, "par", name(e) + ".csv"))
                path = os.path.join(d, name(e) + ".calls.log")
                with open(path, "w", encoding="utf-8") as f:
                    for w, s in ps.items():
                        c = cs.get(w, []); ct = np.array([t for t, _ in c]); cp = np.array([p for _, p in c])
                        adj = []
                        for t, p in s:
                            q = p
                            if W and len(ct):
                                j = int(np.clip(np.searchsorted(ct, t), 1, len(ct) - 1)); j = j if abs(ct[j] - t) < abs(ct[j - 1] - t) else j - 1
                                if abs(ct[j] - t) < 3: q = cp[j] if W == "only" else sig(logit(p) + W * logit(cp[j]))
                            adj.append((t, q))
                        for t, k in policy(adj, on, off): f.write(f"{clock(t)} break watch {w}: {k} (cnn)" + chr(10))
                return path
            score(f"picture network weight {W} on {on} off {off}", calls_for)


def export(out):
    """The trained network as plain numbers for the app's and the extension's own code (2026-11-06): each batch norm folded into the
    convolution before it, weights as little-endian float32 in base64. Also writes parity rows: the network's chance on frames of
    10-08, for the ports to match."""
    import torch, base64
    m = net(); m.load_state_dict(torch.load(os.path.join(out, "cnn.pt"))); m.eval()
    layers, mods = [], list(m)
    def b64(a): return base64.b64encode(np.ascontiguousarray(a, dtype="<f4").tobytes()).decode("ascii")
    i = 0
    while i < len(mods):
        md = mods[i]
        if isinstance(md, torch.nn.Conv2d):
            bn = mods[i + 1]; sc = (bn.weight / torch.sqrt(bn.running_var + bn.eps)).detach().numpy()
            w = md.weight.detach().numpy() * sc[:, None, None, None]; b = bn.bias.detach().numpy() - bn.running_mean.detach().numpy() * sc
            layers.append({"type": "conv", "in": md.in_channels, "out": md.out_channels, "k": 3, "stride": 2, "pad": 1, "w": b64(w), "b": b64(b)})
            i += 3; continue   # conv, batch norm, relu
        if isinstance(md, torch.nn.Linear):
            layers.append({"type": "linear", "in": md.in_features, "out": md.out_features, "w": b64(md.weight.detach().numpy()), "b": b64(md.bias.detach().numpy()),
                           "relu": i + 1 < len(mods) and isinstance(mods[i + 1], torch.nn.ReLU)})
        i += 1
    cal_path = os.path.join(out, "calibration.json")
    spec = {"version": 1, "kind": "picture-net", "input": {"w": W_, "h": H_, "block": 3, "channels": ["grey/255", "(grey - previous grey)/255, zero with no frame in the last 3 s"] + (["mean |grey(t-2k) - grey(t-2k-2)| over k=0..4, /255", "(grey - grey six seconds before)/255"] if TEMPORAL else [])},
            "trained": "2026-11-06, scripts/breakwatch/cnn.py", "layers": layers}
    if os.path.exists(cal_path): spec["calibration"] = json.load(open(cal_path))   # logit' = a * logit + b, from the held folds (CALIB=1)
    json.dump(spec, open(os.path.join(out, "picture-net.json"), "w"), separators=(",", ":"))
    # parity: 400 frames of 10-08 (the exams' day), raw paths and the network's chance
    rows = []
    fr = frames_of("2026-10-08", "screen")[30000:30400]
    with torch.no_grad():
        for i, (t, f) in enumerate(fr):
            prev = fr[i - 1][1] if i and t - fr[i - 1][0] < 3 else None
            x = sample(fr, i)
            if x is None: continue
            p = float(torch.sigmoid(m(torch.from_numpy(x[None].astype(np.float32)))).item())
            rows.append({"t": t, "frame": f, "prev": prev, "p": p, **({"back": [nearest(fr, i, bk) for bk in (2, 4, 6, 8, 10)]} if TEMPORAL else {})})
    json.dump(rows, open(os.path.join(out, "picture-net-parity.json"), "w"))
    print("exported", len(layers), "layers,", os.path.getsize(os.path.join(out, "picture-net.json")), "bytes;", len(rows), "parity rows")


if __name__ == "__main__":
    if sys.argv[1] == "train": train(sys.argv[2])
    elif sys.argv[1] == "export": export(sys.argv[2])
    else: blend(sys.argv[2], sys.argv[3])
