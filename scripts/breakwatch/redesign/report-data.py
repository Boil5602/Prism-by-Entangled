"""Gathers the boundary-first redesign's results into one JSON for the report (2026-11-08, the addendum's phases included).

    python scripts/breakwatch/redesign/report-data.py <out.json>

Reads scripts/doctor/out/redesign-20261107/: the baselines (phase0b, and phase0c when it exists: the rerun with the capped lags), the
offline sweeps (phase1b, phaseB2, phaseC, phaseC2), the bench confirmations (phase1c), A3's five-day model, the Phase 4 networks, E1's
repetition rows and coverage, Phase F's two-network rows, the A2 tables, the channel join, the lingering breaks (nine.json), the audio
sidecar's state, the night judge's lines and the decision log.
"""
import glob
import json
import os
import re
import sys

R = "scripts/doctor/out/redesign-20261107"
GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
out = {"generated_for": "docs/break-watch-results-2026-11-08.md",
       "sets": {"seven": "2026-10-08, seven stretches on known channels (honest)", "night": "2026-11-05 evening, unfamiliar channels (honest)",
                "1104": "2026-11-04 night: open-book for the six-day app model and the extension's; honest with A3's five-day model"}}


def results(path):
    try: d = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError): return None
    if not isinstance(d, dict) or "totals" not in d or "lags" not in d: return None   # a model or a manifest beside the results
    t, L = d["totals"], d["lags"]
    cap = d.get("lags_capped")
    return dict(ads_pct=t["ads_pct"], show_pct=t["show_pct"], popups=t["short"], late=t["late"], mid=t["mid"], early=t["early"], whole=t.get("whole", 0),
                linger=t["linger"], ahead=t["ahead"], own=t["own"], start_lag=dict(median=L["start"].get("median"), p90=L["start"].get("p90")),
                end_lag=dict(median=L["end"].get("median"), p90=L["end"].get("p90")), tail_raw=L.get("tail"), missed_whole=L.get("missed_whole"),
                lags_capped=(dict(start=cap["start"], end=cap["end"], tail=cap["tail"]) if cap else None),
                cost=d.get("cost"), network_channels=d["config"].get("network_channels"), network=d["config"].get("network"), policy=d["config"].get("policy"),
                switches=d["config"].get("switches"), popup_list=d.get("popups"), tail_breaks=d.get("tail_breaks"))


def sweep(folder):
    d = {}
    for f in sorted(glob.glob(os.path.join(folder, "*.json"))):
        if os.path.basename(f) == "summary.json": continue
        try: v = json.load(open(f, encoding="utf-8"))
        except (OSError, ValueError): continue
        if "config" not in v: continue
        cap = v.get("lags_capped")
        d[v["config"]] = dict(ads_pct=v["totals"]["ads_pct"], show_pct=v["totals"]["show_pct"], popups=v["totals"]["popups"], late=v["totals"]["late"], mid=v["totals"]["mid"], early=v["totals"]["early"],
                              whole=v["totals"]["whole"], linger=v["totals"]["linger"], ahead=v["totals"]["ahead"], own=v["totals"]["own"],
                              start_lag=v["lags"]["start"], end_lag=v["lags"]["end"], tail_raw=v["lags"].get("tail"),
                              lags_capped=(dict(start=cap["start"], end=cap["end"], tail=cap["tail"]) if cap else None))
    return d


for key, pat in (("phase0_baselines", "phase0b/*.json"), ("phase0c_baselines_rerun", "phase0c/*.json"), ("phase1c_bench_confirmation", "phase1c/*.json"),
                 ("phaseA3_five_day_model", "phaseA3/*.json"), ("phase4_networks", "phase4/*.json"), ("phaseE1_repetition_bench", "phaseE1/*.json"), ("phaseF_two_networks", "phaseF/*.json")):
    out[key] = {os.path.basename(f)[:-5]: results(f) for f in sorted(glob.glob(f"{R}/{pat}")) if os.path.basename(f) not in ("summary.json",)}
    out[key] = {k: v for k, v in out[key].items() if v}
for key, pat in (("phase1_sweeps", "phase1b"), ("phaseB2_sweeps", "phaseB2"), ("phaseC_sweeps_first_pass", "phaseC"), ("phaseC2_sweeps", "phaseC2")):
    out[key] = {os.path.basename(d): sweep(d) for d in sorted(glob.glob(f"{R}/{pat}/*")) if os.path.isdir(d) and glob.glob(os.path.join(d, "summary.json"))}
out["phase4_frame_level"] = {}
for f in sorted(glob.glob(f"{R}/phase4/*/train.log")) + sorted(glob.glob("scripts/doctor/out/cnn-2026110*/train.log")):
    tag = os.path.basename(os.path.dirname(f)); m = re.search(r"AUC ([\d.]+).*?([\d.]+)% of ad seconds, ([\d.]+)% of show seconds", open(f, encoding="utf-8", errors="replace").read(), re.S)
    if m: out["phase4_frame_level"][tag] = dict(auc=float(m.group(1)), ad_seconds_at_half=float(m.group(2)), show_seconds_at_half=float(m.group(3)))
out["a2_boundary_auc"] = {os.path.basename(f)[:-3]: open(f, encoding="utf-8").read() for f in glob.glob(f"{R}/a2-boundary-auc-*.md")}
aud = {}
for f in sorted(glob.glob(f"{R}/phase5a/**/repeat*.json", recursive=True)):
    d = json.load(open(f, encoding="utf-8")); d.pop("false_examples", None); d.pop("segments", None)
    aud[os.path.relpath(f, f"{R}/phase5a").replace(os.sep, "/")] = d
out["phase5a_repetition"] = aud
try: out["phaseE1_repetition_coverage"] = json.load(open(f"{R}/phaseE1/repfeat/summary.json", encoding="utf-8"))
except OSError: pass
for name, path in (("channels_breaks", f"{R}/breaks-by-channel.json"), ("the_nine", f"{R}/nine.json")):
    try: out[name] = json.load(open(path, encoding="utf-8"))
    except OSError: pass
if "channels_breaks" in out:
    b = out["channels_breaks"]; out["channels_join"] = dict(breaks=len(b), with_id=sum(1 for x in b if x["id"]), with_name=sum(1 for x in b if x["name"]), neither=sum(1 for x in b if not x["id"] and not x["name"]))
    del out["channels_breaks"]
# the audio sidecar: what is recorded so far
adir = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "bench", "_audio")
files = [(os.path.basename(f), os.path.getsize(f)) for f in sorted(glob.glob(os.path.join(adir, "*.mp3")))] + [(os.path.relpath(f, GOLD), os.path.getsize(f)) for f in sorted(glob.glob(os.path.join(GOLD, "*", "audio", "*.mp3")))]
out["audio_sidecar"] = dict(files=files, total_mb=round(sum(s for _, s in files) / 1e6, 1), log=(open(os.path.join(adir, "audio.log"), encoding="utf-8").read().splitlines()[-6:] if os.path.exists(os.path.join(adir, "audio.log")) else []))
night = {}
lines = open(f"{R}/../judge-night-20261107.log", encoding="utf-8", errors="replace").read().splitlines()
for i, l in enumerate(lines):
    m = re.match(r"\d\d:\d\d:\d\d (.*): (app|ext) model, (seven|evening)$", l)
    if m and i + 1 < len(lines):
        n = re.search(r"ads covered ([\d.]+)%.*?show wrongly covered ([\d.]+)%.*?pop-ups \(on the show, gone within 20 s\) (\d+)", lines[i + 1])
        if n: night[f"{m.group(1)} | {m.group(2)} | {m.group(3)}"] = dict(ads_pct=float(n.group(1)), show_pct=float(n.group(2)), popups=int(n.group(3)))
out["night_judge_networks"] = night
try: out["decisions"] = open(f"{R}/decisions.md", encoding="utf-8").read()
except OSError: pass
json.dump(out, open(sys.argv[1], "w", encoding="utf-8"), indent=1)
print("wrote", sys.argv[1], "|", {k: (len(v) if isinstance(v, (dict, list)) else "-") for k, v in out.items() if k not in ("decisions", "sets", "generated_for")})
