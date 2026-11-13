"""The palette columns stacked on the trees' chance, judged by the cover policy (2026-11-10; the redesign's addendum Phase D). The palette
exists only from 2026-11-08, so the trees cannot be retrained with it yet without learning which day a row is from. This asks the
smaller question first: does a second, small model that sees the shipped trees' chance AND the palette columns cover better than the
trees alone, when it is trained on one labelled evening and judged on another?

    python scripts/breakwatch/palstack.py <wide parity dir> <out dir> <exams.json> [<exams.json> ...]

The parity dir holds run_exams' LPWIDE=1 files of every exam named (the shipped model's looks). Each exam is predicted by models trained
on the OTHER exams only. Variants, each written as a parity folder whose `trees` column is the stacked chance (boundary.py then runs the
shipped policy over it, so the picture network, the agreement rule and the hold are as shipped):
  recal     a logistic fit on the trees' log odds alone: the control, what a recalibration on these evenings gives with no palette
  pal-lr    a logistic fit on the trees' log odds and the six palette columns
  pal-gbm   small boosted trees on the same inputs
The promos and the neutral time are left out of the fit. Prints each variant's AUC on the held-out looks and the logistic weights; the
cover figures come from boundary.py --grid none over <out dir>/<variant> with <out dir>/exams.json.
"""
import csv, io, json, math, os, re, sys
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import palfeat  # noqa: E402

par, out = sys.argv[1], sys.argv[2]
exams = [e for p in sys.argv[3:] for e in json.load(io.open(p, encoding="utf-8"))]
name = lambda e: re.sub(r"[^A-Za-z0-9]+", "-", e["name"])
lg = lambda p: np.log(np.clip(p, 0.001, 0.999) / (1 - np.clip(p, 0.001, 0.999)))
os.makedirs(out, exist_ok=True)
EDGE = 20
with io.open(os.path.join(out, "exams.json"), "w", encoding="utf-8") as f: f.write(json.dumps(exams, indent=1))

D = {}
for e in exams:
    with open(os.path.join(par, name(e) + ".csv"), newline="") as f:
        rd = csv.reader(f); head = next(rd); rows = [r for r in rd if len(r) == len(head)]
    t = np.array([float(r[head.index("t")]) for r in rows]); trees = np.array([float(r[head.index("trees")]) for r in rows])
    H = palfeat.load_palette(e["day"], e["window"]); have, c = palfeat.columns(H)
    s = t.astype(int)
    P = np.stack([c[k][s] for k in palfeat.COLS], axis=1).astype(np.float64)
    is_ad, is_neu = palfeat.labels(e["day"], e["window"])
    a, b = palfeat.secs(e["from"]), palfeat.secs(e["to"])
    use = (t >= a) & (t < b) & ~is_neu[s]
    # the looks within EDGE seconds of a labelled break's start or end: where the cover's errors are (2026-11-09 review)
    edge = np.zeros(86400, bool)
    for k in np.flatnonzero(is_ad[1:] != is_ad[:-1]) + 1: edge[max(0, k - EDGE):k + EDGE] = True
    D[e["name"]] = dict(head=head, rows=rows, t=t, trees=trees, P=P, y=is_ad[s].astype(int), use=use, edge=use & edge[s])
    print(f"{e['name']}: {len(rows)} looks, {int(use.sum())} in the fit ({int((use & is_ad[s]).sum())} ad), palette on {int((~np.isnan(P[:, 0])).sum())}, the blind distance on {int((~np.isnan(P[:, 4])).sum())}", flush=True)


def inputs(d, med):
    """The trees' log odds, the palette columns (a missing one takes the training median) and a mark for a missing blind distance."""
    P = d["P"].copy(); miss = np.isnan(P[:, 4]).astype(float)
    for k in range(P.shape[1]): P[np.isnan(P[:, k]), k] = med[k]
    return np.column_stack([lg(d["trees"]), P, miss])


VAR = ("recal", "pal-lr", "pal-gbm")
for e in exams:
    test = D[e["name"]]; train = [D[o["name"]] for o in exams if o["name"] != e["name"]]
    med = np.nanmedian(np.concatenate([d["P"][d["use"]] for d in train]), axis=0)
    Xtr = np.concatenate([inputs(d, med)[d["use"]] for d in train]); ytr = np.concatenate([d["y"][d["use"]] for d in train])
    Xte = inputs(test, med); yte = test["y"]; u = test["use"]
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9; Z = lambda X: (X - mu) / sd
    w = np.where(ytr > 0, 0.5 / ytr.mean(), 0.5 / (1 - ytr.mean()))
    preds = {}
    m = LogisticRegression(C=1.0, max_iter=2000).fit(Z(Xtr)[:, :1], ytr, sample_weight=w); preds["recal"] = m.predict_proba(Z(Xte)[:, :1])[:, 1]
    m = LogisticRegression(C=1.0, max_iter=2000).fit(Z(Xtr), ytr, sample_weight=w); preds["pal-lr"] = m.predict_proba(Z(Xte))[:, 1]
    print(f"\nheld out: {e['name']} (fit on {len(ytr)} looks of the others, {int(ytr.sum())} ad)")
    print("  pal-lr weights (a standard deviation each): " + ", ".join(f"{k} {v:+.2f}" for k, v in zip(["trees"] + palfeat.COLS + ["no_blind"], m.coef_[0])))
    g = HistGradientBoostingClassifier(max_iter=120, learning_rate=0.05, max_leaf_nodes=8, min_samples_leaf=80, l2_regularization=1.0, random_state=0).fit(Xtr, ytr, sample_weight=w)
    preds["pal-gbm"] = g.predict_proba(Xte)[:, 1]
    print(f"  AUC on its looks: trees {roc_auc_score(yte[u], test['trees'][u]):.4f}" + "".join(f", {v} {roc_auc_score(yte[u], preds[v][u]):.4f}" for v in VAR))
    u = test["edge"]
    print(f"  AUC within {EDGE} s of a labelled edge ({int(u.sum())} looks): trees {roc_auc_score(yte[u], test['trees'][u]):.4f}" + "".join(f", {v} {roc_auc_score(yte[u], preds[v][u]):.4f}" for v in VAR)
          + "; the columns alone: " + ", ".join(f"{k} {roc_auc_score(yte[u & ~np.isnan(test['P'][:, i])], test['P'][u & ~np.isnan(test['P'][:, i]), i]):.3f}" for i, k in enumerate(palfeat.COLS)))
    ti = test["head"].index("trees")
    for v in VAR:
        os.makedirs(os.path.join(out, v), exist_ok=True)
        with open(os.path.join(out, v, name(e) + ".csv"), "w", newline="") as f:
            wr = csv.writer(f); wr.writerow(test["head"])
            for r, p in zip(test["rows"], preds[v]): r2 = list(r); r2[ti] = "%.6f" % p; wr.writerow(r2)
print("\nwritten: " + ", ".join(os.path.join(out, v) for v in VAR))
