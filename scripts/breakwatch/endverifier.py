"""Addendum Phase C (2026-11-08): the end verifier. One question, asked while a cover is up: has the show returned?

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/endverifier.py train <out> --leave <day> [--leave <day>]   train on every labelled day but these
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/endverifier.py score <out> <exams.json>                      the chance a second for each exam window -> <out>/par/<exam>.csv
    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/endverifier.py export <out>                                  ONNX (verifier.onnx) for the cost measurements

A sample is a second t inside or just after a labelled break, with:
  - the picture over the last 20 s: the frame at t and at t-5, t-10, t-15, t-20 (106x60 blocks of the 320x180 grey, as the picture network
    reads them; a missing frame leaves zeros), five channels;
  - the hand readings at t from the day's feature CSV (the trees' own inputs: the logo, the picture statistics, the text, the sound, the
    known-ad flags), 44 numbers scaled as train2.py scales them (log1p on the "since" kinds).
Label 1 = the show is back (t in [end, end + 20] of a labelled break; promos are show, so a promo after the last ad is the show returned);
label 0 = still the break (t in [end - 20, end), and every other break second at a fifth).
Judged offline: the chance a second on the exam windows, read by boundary.py's verif:theta configuration (end the cover when the
chance is above theta on two calls 5 s apart; the verifier never starts a cover).
"""
import csv
import glob
import json
import math
import os
import re
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import promos as _promos
GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
FEATS = {"2026-10-07": "scripts/doctor/out/train-recent-ad-20261105/feat_2026-10-07.csv", "2026-10-08": "scripts/doctor/out/train-recent-ad-20261105/feat_2026-10-08.csv",
         "2026-11-04": "scripts/doctor/out/train-recent-ad-20261105/feat_2026-11-04.csv", "2026-11-05": "scripts/doctor/out/promo-retrain/feat_2026-11-05.csv",
         "2026-11-06": "scripts/doctor/out/promo-retrain/feat_2026-11-06.csv", "2026-11-07": "scripts/doctor/out/promo-retrain/feat_2026-11-07.csv"}
SKIP = {"win", "t", "chance", "active", "since_cue_stop", "since_cue_predict"}
W_, H_ = 106, 60; BACK = (0, 5, 10, 15, 20)
os.environ.setdefault("PROMOS", "show")


def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
def name(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])


def frames_of(day, win):
    fs = sorted(glob.glob(os.path.join(GOLD, day, win, "*.gray")))
    def t(n): return int(n[:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6]) + int(n[6:9]) / 1000.0
    ts = np.array([t(os.path.basename(f)[:-5]) for f in fs]); return ts, fs


def small(path):
    a = np.fromfile(path, dtype=np.uint8)
    if a.size != 320 * 180: return None
    return a.reshape(180, 320)[:, :318].reshape(60, 3, 106, 3).mean(axis=(1, 3)).astype(np.float32) / 255.0


def stack(ts, fs, t):
    x = np.zeros((len(BACK), H_, W_), np.float32)
    for c, back in enumerate(BACK):
        k = np.searchsorted(ts, t - back); best = None
        for j in (k - 1, k):
            if 0 <= j < len(ts) and abs(ts[j] - (t - back)) <= 1.5 and (best is None or abs(ts[j] - (t - back)) < abs(ts[best] - (t - back))): best = j
        if best is not None:
            s = small(fs[best])
            if s is not None: x[c] = s
    return x


def feat_table(day):
    """The day's hand readings by window: (t array, matrix, names)."""
    path = FEATS.get(day)
    if not path or not os.path.exists(path): return {}
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.reader(f); head = next(rd); names = [h for h in head if h not in SKIP]; ix = [head.index(h) for h in names]
        rows = {}
        for row in rd:
            try: rows.setdefault(row[0], []).append([float(row[1])] + [float(row[i]) for i in ix])
            except ValueError: continue
    for w, r in rows.items():
        a = np.array(r, np.float32); a = a[np.argsort(a[:, 0])]
        out[w] = (a[:, 0], a[:, 1:], names)
    return out


def feats_at(table, w, t):
    if w not in table: return None
    ts, m, names = table[w]; k = np.searchsorted(ts, t)
    for j in (k - 1, k):
        if 0 <= j < len(ts) and abs(ts[j] - t) <= 1.5:
            v = m[j].copy()
            for i, n in enumerate(names):
                if n.startswith("since_") or n in ("absent_for", "spot_gap"): v[i] = math.log1p(max(0.0, v[i]))
            return v
    return None


def labelled(day):
    p = os.path.join(GOLD, day, "labels.json")
    if not os.path.exists(p): return {}
    lab = json.load(open(p, encoding="utf-8")).get("windows", {}); out = {}
    for w, v in lab.items():
        if not v.get("ads"): continue
        raw = [(sec(a), sec(b)) for a, b in v["ads"]]
        ads = v["ads"]
        if _promos.on(): ads = _promos.ads_for(os.path.join(GOLD, day), w, ads)
        ads = [(sec(a), sec(b)) for a, b in ads]
        promo = [(a, b) for a, b in raw if not any(abs(a - x) < 1 and abs(b - y) < 1 for x, y in ads)]   # the promo stretches the show scoring took out of the breaks
        out[w] = dict(ads=sorted(ads), promos=promo, rev=[(sec(a), sec(b)) for a, b in v.get("reviewed", [])], neu=[(sec(a), sec(b)) for a, b in v.get("neutral", [])])
    return out


def samples(day, w, L, ts, fs, table, rng):
    """(t, label, weight) for one window: the ends with 20 s each side, promos' first 10 s, and a fifth of the other break seconds."""
    out = []
    inside = lambda t, spans: any(a <= t < b for a, b in spans)
    for a, b in L["ads"]:
        if b - a > 480 or b - a < 5: continue
        for t in np.arange(b, b + 21):
            if inside(t, L["rev"]) and not inside(t, L["neu"]) and not inside(t, L["ads"]): out.append((float(t), 1, 1.0))
        for t in np.arange(max(a, b - 20), b): out.append((float(t), 0, 1.0))
        for t in np.arange(a + 1, max(a + 1, b - 20)):
            if rng.random() < 0.2: out.append((float(t), 0, 1.0))
    # a promo's seconds are NOT negatives (2026-11-08, second pass): under the standing condition promos are show, so the labelled end of a
    # break is the last ad's end and the promo after it is the show returned; the first pass took the promo's first ten seconds as
    # still-the-break, against its own positives, and 35% of the lingering it was to cut falls on exactly those promo tails
    return out


def net(nfeat):
    import torch.nn as nn
    class V(nn.Module):
        def __init__(self):
            super().__init__()
            def blk(i, o): return [nn.Conv2d(i, o, 3, 2, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True)]
            self.cnn = nn.Sequential(*blk(len(BACK), 16), *blk(16, 32), *blk(32, 48), *blk(48, 64), nn.AdaptiveAvgPool2d((2, 4)), nn.Flatten())
            self.mlp = nn.Sequential(nn.Linear(nfeat, 64), nn.ReLU(inplace=True))
            self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(64 * 8 + 64, 64), nn.ReLU(inplace=True), nn.Linear(64, 1))
        def forward(self, x, f): return self.head(torch.cat([self.cnn(x), self.mlp(f)], 1))
    import torch
    return V()


def build(days, rng):
    X, F, Y, Wt, meta = [], [], [], [], []
    nfeat = None
    for day in days:
        L = labelled(day); table = feat_table(day)
        for w, lab in L.items():
            if w not in table: continue
            ts, fs = frames_of(day, w)
            if not len(ts): continue
            for t, y, wt in samples(day, w, lab, ts, fs, table, rng):
                f = feats_at(table, w, t)
                if f is None: continue
                nfeat = len(f); X.append(stack(ts, fs, t)); F.append(f); Y.append(y); Wt.append(wt); meta.append((day, w, t))
        print(f"{day}: {sum(1 for m in meta if m[0] == day)} samples so far {len(Y)}", flush=True)
    return np.stack(X), np.stack(F).astype(np.float32), np.array(Y, np.float32), np.array(Wt, np.float32), nfeat, meta


def train(out, leave):
    import torch
    torch.manual_seed(1); torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
    days = [d for d in sorted(FEATS) if d not in leave and os.path.isdir(os.path.join(GOLD, d))]
    rng = np.random.default_rng(1); t0 = time.time()
    X, F, Y, Wt, nfeat, meta = build(days, rng)
    mu, sd = F.mean(0), F.std(0) + 1e-6; F = (F - mu) / sd
    print(f"{len(Y)} samples ({Y.mean() * 100:.1f}% show-returned) from {', '.join(days)}, built in {time.time() - t0:.0f} s", flush=True)
    m = net(nfeat); opt = torch.optim.AdamW(m.parameters(), 2e-3, weight_decay=1e-4)
    pw = torch.tensor([(1 - Y.mean()) / max(1e-6, Y.mean())]); lossf = torch.nn.BCEWithLogitsLoss(pos_weight=pw, reduction="none")
    Xt, Ft, Yt, Wtt = torch.from_numpy(X), torch.from_numpy(F), torch.from_numpy(Y), torch.from_numpy(Wt)
    E = int(os.environ.get("EPOCHS", "8")); sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=E * math.ceil(len(Y) / 128))
    for ep in range(E):
        m.train(); perm = torch.randperm(len(Y)); tot = 0
        for b in range(0, len(Y), 128):
            k = perm[b:b + 128]; x = Xt[k]
            dx, dy = np.random.randint(-3, 4), np.random.randint(-2, 3); x = torch.roll(x, (dy, dx), (2, 3))
            loss = (lossf(m(x, Ft[k]).squeeze(1), Yt[k]) * Wtt[k]).mean(); opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot += loss.item() * len(k)
        print(f"epoch {ep + 1}: loss {tot / len(Y):.4f} ({time.time() - t0:.0f} s)", flush=True)
    os.makedirs(out, exist_ok=True)
    torch.save(dict(state=m.state_dict(), mu=mu, sd=sd, nfeat=nfeat, leave=list(leave)), os.path.join(out, "verifier.pt"))
    json.dump(dict(samples=int(len(Y)), positive=float(Y.mean()), days=days, leave=list(leave), nfeat=nfeat), open(os.path.join(out, "verifier.json"), "w"), indent=1)


def load(out):
    import torch
    ck = torch.load(os.path.join(out, "verifier.pt"), weights_only=False); m = net(ck["nfeat"]); m.load_state_dict(ck["state"]); m.eval()
    return m, ck["mu"], ck["sd"]


def score(out, exams_path):
    import torch
    m, mu, sd = load(out); exams = json.load(open(exams_path, encoding="utf-8")); os.makedirs(os.path.join(out, "par"), exist_ok=True)
    for e in exams:
        ts, fs = frames_of(e["day"], e["window"]); table = feat_table(e["day"]); a0, b0 = sec(e["from"]), sec(e["to"])
        rows = []; xs = []; ffs = []; tt = []
        for t in np.arange(math.ceil(a0), math.floor(b0), 1.0):
            f = feats_at(table, e["window"], t)
            if f is None: continue
            xs.append(stack(ts, fs, t)); ffs.append((f - mu) / sd); tt.append(t)
            if len(xs) == 256:
                with torch.no_grad(): p = torch.sigmoid(m(torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(ffs).astype(np.float32))).squeeze(1)).numpy()
                rows += list(zip(tt, p)); xs, ffs, tt = [], [], []
        if xs:
            with torch.no_grad(): p = torch.sigmoid(m(torch.from_numpy(np.stack(xs)), torch.from_numpy(np.stack(ffs).astype(np.float32))).squeeze(1)).numpy()
            rows += list(zip(tt, p))
        with open(os.path.join(out, "par", name(e) + ".csv"), "w", newline="") as f:
            wr = csv.writer(f); wr.writerow(["win", "t", "p"])
            for t, p in rows: wr.writerow([e["window"], f"{t:.3f}", f"{p:.6f}"])
        print(f"{e['name']}: {len(rows)} seconds scored", flush=True)


def export(out):
    import torch
    m, mu, sd = load(out); ck = torch.load(os.path.join(out, "verifier.pt"), weights_only=False)
    torch.onnx.export(m, (torch.zeros(1, len(BACK), H_, W_), torch.zeros(1, ck["nfeat"])), os.path.join(out, "verifier.onnx"), input_names=["frames", "features"], output_names=["logit"], opset_version=17, dynamo=os.environ.get("EXPORT_DYNAMO") == "1")   # the legacy exporter cannot do the adaptive pool; the new one needs PYTHONUTF8=1 for its glyphs
    json.dump(dict(mu=mu.tolist(), sd=sd.tolist()), open(os.path.join(out, "verifier-scale.json"), "w"))
    print("exported", os.path.join(out, "verifier.onnx"), os.path.getsize(os.path.join(out, "verifier.onnx")), "bytes")


if __name__ == "__main__":
    mode, out = sys.argv[1], sys.argv[2]
    if mode == "train":
        leave = set(); a = sys.argv[3:]
        while "--leave" in a: i = a.index("--leave"); leave.add(a[i + 1]); del a[i:i + 2]
        train(out, leave)
    elif mode == "score": score(out, sys.argv[3])
    elif mode == "export": export(out)
    else: print(__doc__)
