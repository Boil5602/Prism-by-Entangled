"""The Pareto scatter of the boundary-first redesign (2026-11-08): show wrongly covered against ads covered, pop-ups as the marker size.

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/pareto.py <out.png> <label>=<summary.json or results.json> [...]

A summary.json (boundary.py) holds many configurations; a results.json (run_exams) one. Each file is one colour; the base configuration
of a summary is ringed. The household's ordering: lower-left is better on the two axes that count, small markers better on the third.
"""
import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

out, specs = sys.argv[1], sys.argv[2:]
fig, ax = plt.subplots(figsize=(9, 6))
for spec in specs:
    label, path = spec.split("=", 1)
    d = json.load(open(path, encoding="utf-8"))
    pts = []
    if "totals" in d:   # a single run
        pts.append(("run", d["totals"]["ads_pct"], d["totals"]["show_pct"], d["totals"]["short"] if "short" in d["totals"] else d["totals"].get("popups", 0)))
    else:
        for cfg, v in d.items(): pts.append((cfg, v["totals"]["ads_pct"], v["totals"]["show_pct"], v["totals"]["popups"]))
    xs = [p[1] for p in pts]; ys = [p[2] for p in pts]; ss = [20 + 6 * p[3] for p in pts]
    sc = ax.scatter(xs, ys, s=ss, alpha=0.55, label=label, edgecolors="none")
    for cfg, x, y, n in pts:
        if cfg in ("base", "run"): ax.scatter([x], [y], s=160, facecolors="none", edgecolors=sc.get_facecolor()[0], linewidths=2)
        if cfg.startswith("soft:90") or cfg.startswith("hsmm:0.9,0.45,0.5") and "+" not in cfg: ax.annotate(cfg, (x, y), fontsize=7, xytext=(4, 4), textcoords="offset points")
ax.set_xlabel("ads covered, %"); ax.set_ylabel("show wrongly covered, %")
ax.set_title("Policy configurations: show% against ads%, marker size = pop-ups (the ring is the base policy)")
ax.grid(alpha=0.3); ax.legend(fontsize=8)
fig.tight_layout(); fig.savefig(out, dpi=120); print("wrote", out)
