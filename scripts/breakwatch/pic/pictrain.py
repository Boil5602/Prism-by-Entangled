"""The picture study's model (2026-10-08): a small network that looks at one 160x90 grey frame and says how much it looks like an ad.
Offline only; nothing here runs in Prism.

    <venv>/python scripts/breakwatch/pic/pictrain.py <frames.npz> <scores.npz> [--mask-corners] [--epochs 6]

Trained and scored the way its answer would be used, as one more input to the break trees:
- on the seconds the live trees were trained on, every frame is scored by a model that never saw its CHANNEL (the channels are dealt
  into folds), so the trees are not handed a score that has memorised the show it is scoring;
- an exam's frames are scored by the model trained on all of those seconds, and no exam frame trains anything.
--mask-corners blacks out the four corners, where a channel's logo sits: the trees already know whether the logo is up, and what is
asked of this model is what an ad LOOKS like."""
import sys
import time

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import average_precision_score, roc_auc_score

src, out = sys.argv[1], sys.argv[2]
MASK = "--mask-corners" in sys.argv
EPOCHS = int(sys.argv[sys.argv.index("--epochs") + 1]) if "--epochs" in sys.argv else 6
dev = "cuda" if torch.cuda.is_available() else "cpu"
D = np.load(src, allow_pickle=False)
X = torch.from_numpy(D["X"]).to(dev)            # uint8 [N, 90, 160], kept on the card
y = D["y"].astype(np.float32); tr = D["tr"]; ex = D["ex"]; ch = D["ch"]; chans = [str(c) for c in D["chans"]]; exams = [str(e) for e in D["exams"]]
if MASK:
    X[:, :22, :40] = 0; X[:, :22, -40:] = 0; X[:, -22:, :40] = 0; X[:, -22:, -40:] = 0
print(f"{len(y)} frames on {dev}; training {int(tr.sum())} ({int(y[tr].sum())} ads), exams {int((ex >= 0).sum())}; corners {'masked' if MASK else 'as they are'}", flush=True)


def net():
    def b(i, o, s): return [nn.Conv2d(i, o, 3, stride=s, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True)]
    return nn.Sequential(*b(1, 24, 2), *b(24, 48, 2), *b(48, 64, 2), *b(64, 96, 2), *b(96, 128, 1), nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Dropout(0.3), nn.Linear(128, 1)).to(dev)


def prep(xb, train):
    xb = xb.float().div_(255).unsqueeze(1)
    if train:
        n = xb.shape[0]
        dy, dx = np.random.randint(0, 9), np.random.randint(0, 13)
        xb = xb[:, :, dy:dy + 82, dx:dx + 148]                                   # a shifted crop
        g = 1 + (torch.rand(n, 1, 1, 1, device=dev) - 0.5) * 0.4; o = (torch.rand(n, 1, 1, 1, device=dev) - 0.5) * 0.16
        xb = (xb * g + o).clamp_(0, 1)                                           # brighter, darker, flatter
    return (xb - 0.4) / 0.25


def fit(idx, tag):
    m = net(); idx = np.array(idx); yt = torch.from_numpy(y).to(dev)
    pos = float(y[idx].mean()); w = torch.tensor([(1 - pos) / max(pos, 1e-3)], device=dev)
    opt = torch.optim.AdamW(m.parameters(), lr=2e-3, weight_decay=1e-4); steps = EPOCHS * (len(idx) // 256 + 1)
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps); lossf = nn.BCEWithLogitsLoss(pos_weight=w)
    t0 = time.time(); k = 0
    for ep in range(EPOCHS):
        m.train(); perm = np.random.permutation(idx); tot = 0.0
        for s in range(0, len(perm), 256):
            bi = torch.from_numpy(perm[s:s + 256]).to(dev)
            with torch.autocast(dev, enabled=dev == "cuda"):
                loss = lossf(m(prep(X[bi], True)).squeeze(1), yt[bi])
            opt.zero_grad(set_to_none=True); loss.backward(); opt.step()
            if k < steps - 1: sch.step()
            k += 1; tot += float(loss) * len(bi)
            time.sleep(0.012)                                                    # the card is shared with the windows playing on it
        print(f"   {tag} epoch {ep + 1}/{EPOCHS} loss {tot / len(perm):.4f} ({time.time() - t0:.0f} s)", flush=True)
    return m


@torch.no_grad()
def score(m, idx):
    m.eval(); idx = np.array(idx); p = np.zeros(len(idx), np.float32)
    for s in range(0, len(idx), 1024):
        bi = torch.from_numpy(idx[s:s + 1024]).to(dev)
        with torch.autocast(dev, enabled=dev == "cuda"):
            p[s:s + 1024] = torch.sigmoid(m(prep(X[bi], False)).squeeze(1)).float().cpu().numpy()
    return p


np.random.seed(7); torch.manual_seed(7)
P = np.full(len(y), np.nan, np.float32)
# the training channels dealt into five folds, the largest first, each to the smallest fold so far
tc = sorted({int(c) for c in ch[tr]}, key=lambda c: -int((tr & (ch == c)).sum())); folds = [[] for _ in range(min(5, len(tc)))]; size = [0] * len(folds)
for c in tc:
    f = int(np.argmin(size)); folds[f].append(c); size[f] += int((tr & (ch == c)).sum())
for f, cs in enumerate(folds):
    held = tr & np.isin(ch, cs); rest = tr & ~held
    print(f"fold {f + 1}: held out {', '.join(chans[c] for c in cs)} ({int(held.sum())} frames)", flush=True)
    P[held] = score(fit(np.flatnonzero(rest), f"fold {f + 1}"), np.flatnonzero(held))
print("the model for the exams: every training frame", flush=True)
final = fit(np.flatnonzero(tr), "final")
P[ex >= 0] = score(final, np.flatnonzero(ex >= 0))
torch.save(final.state_dict(), out.replace(".npz", ".pt"))
np.savez(out, p=P, day=D["day"], win=D["win"], t=D["t"], wins=D["wins"], tr=tr, ex=ex, y=D["y"], ch=ch, chans=D["chans"], exams=D["exams"])


def line(name, m):
    if m.sum() < 50 or y[m].min() == y[m].max(): return
    print(f"   {name:<24} {int(m.sum()):>7} frames, {100 * y[m].mean():4.1f}% ads | AUC {roc_auc_score(y[m], P[m]):.3f}  average precision {average_precision_score(y[m], P[m]):.3f}")


print("training seconds, each frame scored by a model that never saw its channel:")
line("all", tr)
for c in tc: line(chans[c], tr & (ch == c))
print("exams, scored by the model trained on every training second:")
line("all exams", ex >= 0)
for k, e in enumerate(exams): line(e, ex == k)
