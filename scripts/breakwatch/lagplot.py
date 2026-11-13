"""Boundary-lag histograms from run_exams results.json files (2026-11-07, the boundary-first redesign).

    ~/.prism/cnn-venv/Scripts/python scripts/breakwatch/lagplot.py <out.png> "<title>" <label>=<results.json> [<label>=<results.json> ...]

Two panels: start lags (first covered second minus the marked start; negative = ahead) and end lags (last covered second minus the marked
end; positive = lingered), one histogram per results file, clipped to -30..+60 s with the overflow in the end bins.
"""
import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

out, title, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
fig, ax = plt.subplots(1, 2, figsize=(12, 4.2))
bins = np.arange(-30, 61, 2)
for spec in specs:
    label, path = spec.split("=", 1)
    r = json.load(open(path, encoding="utf-8"))
    for i, key in enumerate(("start_values", "end_values")):
        L = r.get("lags_capped") or r["lags"]   # the capped lags (2026-11-08) when the result carries them
        v = np.clip(np.array(L[key], float), -30, 60)
        st = L["start" if i == 0 else "end"]
        ax[i].hist(v, bins=bins, alpha=0.5, label=f"{label} (median {st.get('median', 0):.0f}, p90 {st.get('p90', 0):.0f}, n {st.get('n', 0)})")
ax[0].set_title("start lag, s (negative = ahead of the break)")
ax[1].set_title("end lag, s (positive = stayed on after it)")
for a in ax:
    a.axvline(0, color="k", lw=0.8)
    a.set_ylabel("breaks")
    a.legend(fontsize=8)
fig.suptitle(title)
fig.tight_layout()
fig.savefig(out, dpi=120)
print("wrote", out)
