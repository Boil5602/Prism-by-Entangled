"""Recomputes every kept result's boundary lags with the capped definition (2026-11-08): a cover running on across a short show gap into
the next labelled break lingers over the gap, not over the next break's ads, and a cover carried in from the break before is not an
early start. Writes lags_capped (median, p90, tail counts, the values) into each results.json (the bench) and each configuration JSON
of the offline sweeps, in place, beside the raw figures. Safe to run again.

    python scripts/breakwatch/redesign/relag.py
"""
import glob
import json
import os
import statistics

R = "scripts/doctor/out/redesign-20261107"


def capped(breaks):
    """breaks: the exam's list as exam.py wrote it (start, end, miss, cover_start, cover_end), in time order."""
    bs = sorted((b for b in breaks if "start" in b), key=lambda b: b["start"])
    out_s, out_e = [], []
    for i, b in enumerate(bs):
        if b.get("miss") or "cover_start" not in b: continue
        cs, ce, x, y = b["cover_start"], b["cover_end"], b["start"], b["end"]
        prev_end = bs[i - 1]["end"] if i > 0 else -1e9; next_start = bs[i + 1]["start"] if i + 1 < len(bs) else 1e9
        out_s.append((max(cs, prev_end + 1) - x) if cs <= x else cs - x)
        out_e.append((min(ce, next_start - 1) - y) if ce >= y else ce - y)
    return out_s, out_e


def stats(v):
    if not v: return dict(n=0)
    a = sorted(abs(x) for x in v)
    return dict(n=len(v), median=statistics.median(v), p90=a[min(len(a) - 1, int(round(0.9 * (len(a) - 1))))],
                tail=dict(start_ge20=None, end_ge20=None, end_ge60=None))


def apply(path):
    try: d = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError): return False
    exams = d.get("exams")
    if not exams or not any("breaks" in e for e in exams): return False
    S, E = [], []
    for e in exams:
        s_, e_ = capped(e.get("breaks", [])); S += s_; E += e_
    if not S: return False
    st, en = stats(S), stats(E)
    d["lags_capped"] = dict(start=dict(n=st["n"], median=st["median"], p90=st["p90"]), end=dict(n=en["n"], median=en["median"], p90=en["p90"]),
                            tail=dict(start_ge20=sum(1 for x in S if x >= 20), end_ge20=sum(1 for x in E if x >= 20), end_ge60=sum(1 for x in E if x >= 60), breaks=len(S)),
                            start_values=S, end_values=E)
    json.dump(d, open(path, "w", encoding="utf-8"), indent=1)
    return True


if __name__ == "__main__":
    n = 0
    for pat in ("phase0b/*.json", "phase1c/*.json", "phaseA3/*.json", "phaseE1/*.json", "phaseF/*.json", "phase4/*.json", "phase1b/*/*.json", "phaseB2/*/*.json", "phaseC2/*/*.json", "phaseC/*/*.json"):
        for f in glob.glob(os.path.join(R, pat)):
            if os.path.basename(f) in ("summary.json",): continue
            if apply(f): n += 1
    print("recomputed", n, "files")
    for f in ("phase0b/app-clean-seven.json", "phase0b/app-clean-night.json", "phase1c/app-soft90-seven.json", "phaseE1/rep-base-seven.json"):
        p = os.path.join(R, f)
        if os.path.exists(p):
            d = json.load(open(p, encoding="utf-8")); raw = d["lags"]; cap = d["lags_capped"]
            print(f"  {f}: raw end median {raw['end'].get('median')} p90 {raw['end'].get('p90')} tail {raw.get('tail') or raw['end'].get('tail')} | capped end median {cap['end']['median']} p90 {cap['end']['p90']} tail {cap['tail']}")
