"""'The nine' (the addendum's section 1b): the breaks the baseline lingered on for 60 s or more, followed across configurations (2026-11-08).

    python scripts/breakwatch/redesign/nine.py <out.json>

Reads the baseline's results.json (phase0b app-clean-seven and app-clean-night), takes every break whose end lag was 60 s or more, and
for each later configuration finds the same break (day, window, labelled start) and reports its end lag and start lag there. Sources:
the bench's results.json files (phase1c, phaseE1, phaseF) and the offline sweeps' per-configuration JSON (phase1b, phaseC2).
"""
import glob
import json
import os
import sys

R = "scripts/doctor/out/redesign-20261107"
sys.path.insert(0, "scripts/breakwatch")
from channels import channel_at   # noqa: E402

SOURCES = [
    ("baseline (bench, clean network)", "phase0b/app-clean-{set}.json"),
    ("baseline rerun, capped lags (bench)", "phase0c/app-clean-{set}.json"),
    ("soft refractory 90 s (bench)", "phase1c/app-soft90-{set}.json"),
    ("trees + repetition feature (bench)", "phaseE1/rep-base-{set}.json"),
    ("repetition + soft 90 (bench)", "phaseE1/rep-soft90-{set}.json"),
    ("two networks, no refractory (bench)", "phaseF/app-two-soft0-{set}.json"),
    ("two networks + soft 90 (bench)", "phaseF/app-two-soft90-{set}.json"),
    ("end verifier 0.9 (offline)", "phaseC2/app-{set}/verif-0-9.json"),
    ("end verifier 0.9 + soft 90 (offline)", "phaseC2/app-{set}/verif-0-9-soft-90.json"),
    ("end grid 0.9,1,1 (offline)", "phase1b/app-{set}/grid-0-9-1-1.json"),
]


def breaks_of(path):
    """{(day, window, start): break dict} from a bench results.json or an offline configuration JSON."""
    if not os.path.exists(path): return None
    d = json.load(open(path, encoding="utf-8")); out = {}
    for e in d.get("exams", []):
        day, win = e.get("day"), e.get("window")
        for br in e.get("breaks", []):
            if day is None:   # the offline JSON carries the exam name only; the day and window come from the exams file
                day, win = EXAM_DAY.get(e.get("exam"), (None, None))
            out[(day, win, int(br["start"]))] = br
    return out


exams = json.load(open("scripts/breakwatch/exams.json", encoding="utf-8")) + json.load(open("scripts/breakwatch/exams-night.json", encoding="utf-8"))
EXAM_DAY = {e["name"]: (e["day"], e["window"]) for e in exams}


def clock(t): t = int(t); return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


MODE = os.environ.get("NINE", "end")   # end: the baseline's lingers of 60 s+ (raw, the interim's nine); start: the start tail, 20 s+ late, from the rerun
rows = []
for set_ in ("seven", "night"):
    base = breaks_of(f"{R}/phase0c/app-clean-{set_}.json" if MODE == "start" else f"{R}/phase0b/app-clean-{set_}.json") or {}
    cols = [(label, breaks_of(f"{R}/" + pat.format(set=set_))) for label, pat in SOURCES]
    for key, br in sorted(base.items()):
        if br.get("miss"): continue
        if MODE == "end" and br.get("end_lag", 0) < 60: continue
        if MODE == "start" and br.get("start_lag", 0) < 20: continue
        day, win, start = key
        cid, name = channel_at(day, win, start)
        row = dict(set=set_, day=day, window=win, channel=name or cid or "?", start=clock(start), end=clock(br["end"]), length=br["end"] - start,
                   base_start_lag=br.get("start_lag"), base_end_lag=br.get("end_lag"), by_config={})
        for label, table in cols:
            if table is None: row["by_config"][label] = None; continue
            b2 = table.get(key)
            row["by_config"][label] = None if b2 is None else ("missed" if b2.get("miss") else dict(start_lag=b2.get("start_lag"), end_lag=b2.get("end_lag")))
        rows.append(row)
json.dump(rows, open(sys.argv[1], "w", encoding="utf-8"), indent=1)
labels = [l for l, _ in SOURCES]
print("| set | channel | break (start, length) | " + " | ".join(l.replace(" (bench)", "").replace(" (offline)", "*") for l in labels) + " |")
print("|---|---|---|" + "---|" * len(labels))
for r in rows:
    cells = []
    for l in labels:
        v = r["by_config"].get(l)
        cells.append("-" if v is None else v if isinstance(v, str) else f"{v['end_lag']:+.0f} s (start {v['start_lag']:+.0f})")
    print(f"| {r['set']} | {r['channel']} | {r['start']}, {r['length']:.0f} s | " + " | ".join(cells) + " |")
print("")
print(f"{len(rows)} breaks " + ("lingered 60 s or more (raw) under the baseline" if MODE == "end" else "began 20 s or more late under the baseline rerun (capped)") + "; * = offline emulation over the bench's stream")
