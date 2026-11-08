"""The picture study, second cut (2026-10-08): what do networks already trained on millions of pictures see in a frame? Each marked frame
(the ones picdata.py listed, read again at their full 320x180) is turned into such a network's description of it, a few hundred numbers,
and a plain classifier is fitted on those - channels held out for the training seconds, the exams scored by the fit on all of them.

    <venv>/python scripts/breakwatch/pic/picembed.py <frames.npz> <out folder> [model ...]

Models: mobilenet (MobileNetV3-small, 2.5 M numbers: what could ship), resnet18 (11 M), clip (ViT-B/32, 88 M: the ceiling, too heavy
to ship, a teacher at most). Nothing here runs in Prism."""
import os
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gentle import wait_if_busy  # noqa: E402
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.preprocessing import StandardScaler

src, outdir = sys.argv[1], sys.argv[2]
models = sys.argv[3:] or ["mobilenet", "resnet18", "clip"]
GOLDEN = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
DAYS = ["2026-10-07", "2026-10-08"]
dev = "cuda"
D = np.load(src, allow_pickle=False)
y = D["y"].astype(int); tr = D["tr"]; ex = D["ex"]; ch = D["ch"]; chans = [str(c) for c in D["chans"]]; exams = [str(e) for e in D["exams"]]; wins = [str(w) for w in D["wins"]]
N = len(y)


def path(i):
    x = int(round(float(D["t"][i]) * 1000))
    return os.path.join(GOLDEN, DAYS[int(D["day"][i])], wins[int(D["win"][i])], f"{x // 3600000:02d}{x // 60000 % 60:02d}{x // 1000 % 60:02d}{x % 1000:03d}.gray")


def build(name):
    if name == "clip":
        import open_clip
        m, _, _ = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k"); m = m.to(dev).eval()
        mean, std = (0.4815, 0.4578, 0.4082), (0.2686, 0.2613, 0.2758)
        return (lambda x: F.normalize(m.encode_image(x), dim=-1)), (224, 224), mean, std
    import torchvision
    mean, std = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
    if name == "mobilenet":
        m = torchvision.models.mobilenet_v3_small(weights="DEFAULT").to(dev).eval()
        return (lambda x: torch.flatten(m.avgpool(m.features(x)), 1)), (180, 320), mean, std
    m = torchvision.models.resnet18(weights="DEFAULT").to(dev).eval(); m.fc = torch.nn.Identity()
    return m, (180, 320), mean, std


frames = None
for name in models:
    emb_path = os.path.join(outdir, f"emb_{name}.npy")
    if not os.path.exists(emb_path):
        if frames is None:
            t0 = time.time(); frames = np.zeros((N, 180, 320), np.uint8)
            for i in range(N):
                g = np.fromfile(path(i), np.uint8)
                if g.size == 57600: frames[i] = g.reshape(180, 320)
                if i % 200 == 0: time.sleep(0.25); wait_if_busy()                 # some 800 files a second at most, and none while Prism lags
                if i % 20000 == 0: print(f"   reading frames {i}/{N} ({time.time() - t0:.0f} s)", flush=True)
        f, size, mean, std = build(name); out = []; t0 = time.time()
        mu = torch.tensor(mean, device=dev).view(1, 3, 1, 1); sd = torch.tensor(std, device=dev).view(1, 3, 1, 1)
        with torch.no_grad():
            for s in range(0, N, 128):
                x = torch.from_numpy(frames[s:s + 128]).to(dev).float().div_(255).unsqueeze(1)
                if size != (180, 320): x = F.interpolate(x, size=size, mode="bilinear", align_corners=False)     # the whole frame, squeezed (the letter shapes matter less than what is in it)
                x = (x.expand(-1, 3, -1, -1) - mu) / sd
                with torch.autocast(dev):
                    out.append(f(x).float().cpu().numpy())
                time.sleep(0.05); wait_if_busy()                                  # the card is shared with the windows playing on it
        E = np.concatenate(out); np.save(emb_path, E)
        print(f"{name}: {E.shape[1]} numbers a frame, {N} frames in {time.time() - t0:.0f} s", flush=True)
    E = np.load(emb_path)
    P = np.full(N, np.nan)
    tc = sorted({int(c) for c in ch[tr]}, key=lambda c: -int((tr & (ch == c)).sum())); folds = [[] for _ in range(min(5, len(tc)))]; size_ = [0] * len(folds)
    for c in tc:
        k = int(np.argmin(size_)); folds[k].append(c); size_[k] += int((tr & (ch == c)).sum())

    def fit(mask):
        sc = StandardScaler().fit(E[mask]); m = LogisticRegression(C=0.05, max_iter=400, class_weight="balanced").fit(sc.transform(E[mask]), y[mask])
        return lambda q: m.predict_proba(sc.transform(E[q]))[:, 1]
    for cs in folds:
        held = tr & np.isin(ch, cs); P[held] = fit(tr & ~held)(held)
    P[ex >= 0] = fit(tr)(ex >= 0)
    np.savez(os.path.join(outdir, f"scores_{name}.npz"), p=P.astype(np.float32), day=D["day"], win=D["win"], t=D["t"], wins=D["wins"], tr=tr, ex=ex, y=D["y"], ch=ch, chans=D["chans"], exams=D["exams"])

    def line(nm, m):
        if m.sum() < 50 or y[m].min() == y[m].max(): return
        print(f"   {nm:<24} {int(m.sum()):>7} frames, {100 * y[m].mean():4.1f}% ads | AUC {roc_auc_score(y[m], P[m]):.3f}  average precision {average_precision_score(y[m], P[m]):.3f}", flush=True)
    print(f"=== {name}: a plain classifier on its description of a frame")
    print("training seconds, each scored by a fit that never saw its channel:"); line("all", tr)
    for c in tc: line(chans[c], tr & (ch == c))
    print("exams, scored by the fit on every training second:"); line("all exams", ex >= 0)
    for k, e in enumerate(exams): line(e, ex == k)
