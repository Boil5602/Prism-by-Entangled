"""Every exam in exams.json replayed through PRISM's own break code (the bwtest harness) and scored against the marks: one line.

    python scripts/breakwatch/run_exams.py [--model <learned.json>] [--on 0.80] [--off 0.55] [--only "<exam name>"] [--keep-calls] [--exams <file>]
                                           [--gentle] [NAME=VALUE ...]

- The model is the one PRISM ships (targets/win-host/PrismHost/Assets/breakwatch/learned.json) unless --model names another; --on and
  --off replace its cover and lift thresholds for the run.
- NAME=VALUE pairs go to the harness as environment switches (ADLINE=0, CUECOMING=0, PLAINLIFT=2, LINFO=1 ...), which is how a rule is
  read with and without: two runs, the same exams, the same library copies. An exam's own cue lead (exams.json "lead") is CUELEAD.
- Each exam replays with the known-ad library as it stood before the stretch (exams.json "library": a folder of
  golden/<day>/library), never the live one: the live library has since learned the very breaks being replayed.
- --gentle waits between exams while PRISM's own break watch is looking less often than it should (pic/gentle.py): a replay reads
  thousands of frames off the disk the windows are playing from.
- --keep-calls leaves each exam's cover calls in the work folder as <exam>.calls.log (timeline and frame checks read them).

Build the harness first: dotnet build -c Release scripts/breakwatch/bwtest. The work folder (links to each exam's window, the calls) is
%LOCALAPPDATA%/Prism/diagnostics/exam-work; nothing in the recordings is written to."""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
WORK = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "exam-work")
EXE = os.path.join(HERE, "bwtest", "bin", "Release", "net8.0", "bwtest.exe")
EXE = os.environ.get("BWEXE") or EXE   # another build of the harness (2026-11-06: one built aside while a replay holds this one)
SHIPPED = os.path.join(HERE, "..", "..", "targets", "win-host", "PrismHost", "Assets", "breakwatch", "learned.json")

args = sys.argv[1:]


def opt(name, default=None):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default


def flag(name):
    if name in args:
        args.remove(name); return True
    return False


model_path = opt("--model", SHIPPED); on = opt("--on"); off = opt("--off"); only = opt("--only")
soft = opt("--soft")   # --soft R (2026-11-08): the policy's soft refractory in seconds, written into the work model
keep_calls = flag("--keep-calls"); gentle = flag("--gentle")
# --max-short N (2026-11-07, the pop-up gate): the run fails (exit 2) when its veils that came up on the show and were gone within
# 20 s number more than N. A new model must not raise the count the live one scores.
max_short = opt("--max-short")
# --results <path> (2026-11-07, the boundary-first redesign's Phase 0): every metric of the run, machine-readable - the configuration, the
# model and network with their hashes, each exam, the totals, the boundary-lag distributions, the pop-ups with their times, the cost a look
results_path = opt("--results") or os.environ.get("RESULTS")
# --trained <manifest> (2026-11-07): the training manifest exam.py reads to leave out seconds the model trained on; trained.json by default
trained_path = opt("--trained", os.path.join(HERE, "trained.json"))
# Network promos score as show time unless told otherwise (the owner stopped covering them 2026-11-04): PROMOS=show is the exams'
# standing condition, so a run without it in the environment gets it here; PROMOS=ads scores them as ads.
if os.environ.get("PROMOS") is None: os.environ["PROMOS"] = "show"
switches = dict(a.split("=", 1) for a in args if "=" in a)
if gentle:
    sys.path.insert(0, os.path.join(HERE, "pic"))
    from gentle import wait_if_busy
exams = [e for e in json.load(open(opt("--exams", os.path.join(HERE, "exams.json")), encoding="utf-8")) if not only or e["name"] == only]
os.makedirs(WORK, exist_ok=True)
model = json.load(open(model_path, encoding="utf-8"))
if on: model["policy"]["on"] = float(on)
if off: model["policy"]["off"] = float(off)
if soft: model["policy"]["softRefractory"] = float(soft)
mp = os.path.join(WORK, "model.json")
json.dump(model, open(mp, "w", encoding="utf-8"), separators=(",", ":"))


def hhmmss(h):
    return h.replace(":", "") + "000"


def lag_stats(v):
    """median, p90 and the bucket counts (<1, 1-2, 2-5, 5-10, 10-20, >20 s) of a list of lags, by magnitude."""
    if not v: return dict(n=0)
    import statistics
    a = sorted(abs(x) for x in v); p90 = a[min(len(a) - 1, int(round(0.9 * (len(a) - 1))))]
    edges = [1, 2, 5, 10, 20]; names = ["<1", "1-2", "2-5", "5-10", "10-20", ">20"]
    buckets = {k: 0 for k in names}
    for x in a:
        i = 0
        while i < len(edges) and x >= edges[i]: i += 1
        buckets[names[i]] += 1
    return dict(n=len(v), median=statistics.median(v), p90=p90, mean=sum(v) / len(v), ahead=sum(1 for x in v if x < 0), buckets=buckets)


def tail(starts, ends):
    """The tail (the addendum's A4): breaks whose start lag is 20 s or more, whose end lag is 20 s or more, 60 s or more."""
    return dict(start_ge20=sum(1 for x in starts if x >= 20), end_ge20=sum(1 for x in ends if x >= 20), end_ge60=sum(1 for x in ends if x >= 60), breaks=len(starts))


def lag_line(starts, ends):
    if not starts: return ""
    a, b, t = lag_stats(starts), lag_stats(ends), tail(starts, ends)
    return (f" | start lag median {a['median']:.0f} p90 {a['p90']:.0f} | end lag median {b['median']:.0f} p90 {b['p90']:.0f}"
            f" | tail: start>=20 s {t['start_ge20']}, end>=20 s {t['end_ge20']}, end>=60 s {t['end_ge60']} of {t['breaks']}")


def sha(path):
    import hashlib
    try: return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]
    except OSError: return None


def write_results(path, name, model_path, model, switches, per_exam, tot, start_lags, end_lags, popup_list, costs):
    import datetime
    net = switches.get("PICNET")
    out = dict(
        at=datetime.datetime.now().isoformat(timespec="seconds"), name=name, bench=EXE,
        config=dict(model=model_path, model_sha=sha(model_path), policy=model.get("policy"), switches=switches, network=net, network_sha=sha(net) if net else None,
                    network_channels=(json.load(open(net)).get("layers", [{}])[0].get("in") if net and os.path.exists(net) else None), promos=os.environ.get("PROMOS")),
        exams=per_exam,
        totals=dict(tot, ads_pct=round(100 * tot["cov"] / max(1, tot["ad"]), 2), show_pct=round(100 * tot["wrong"] / max(1, tot["show"]), 3)),
        lags=dict(start=lag_stats(start_lags), end=lag_stats(end_lags), start_values=start_lags, end_values=end_lags, missed_whole=tot["whole"], tail=tail(start_lags, end_lags)),
        tail_breaks=[dict(exam=j["exam"], day=j["day"], window=j["window"], **br) for j in per_exam for br in j["breaks"] if br.get("miss") or br.get("start_lag", 0) >= 20 or br.get("end_lag", 0) >= 20],
        popups=popup_list,
        cost=(dict(looks=sum(c["looks"] for c in costs), trees_ms=round(sum(c["trees_ms"] * c["looks"] for c in costs) / max(1, sum(c["looks"] for c in costs)), 3),
                   net_ms=round(sum(c["net_ms"] * c["looks"] for c in costs) / max(1, sum(c["looks"] for c in costs)), 3), peak_mb=max(c["peak_mb"] for c in costs),
                   known_looks=sum(c.get("known_looks", 0) for c in costs), unknown_looks=sum(c.get("unknown_looks", 0) for c in costs)) if costs else None))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf-8"), indent=1)


tot = dict(ad=0, cov=0, show=0, wrong=0, late=0, mid=0, early=0, linger=0, ahead=0, own=0, owns=0, short=0, whole=0); per = []
per_exam, start_lags, end_lags, popup_list, costs = [], [], [], [], []
for e in exams:
    if gentle: wait_if_busy(every=0)
    day, win = e["day"], e["window"]
    root = os.path.join(WORK, "root-" + day + "-" + win)       # a folder holding only this window: the harness replays every window it finds
    link = os.path.join(root, win)
    if not os.path.exists(link):
        os.makedirs(root, exist_ok=True)
        subprocess.run(["cmd", "/c", "mklink", "/J", link, os.path.join(GOLDEN, day, win)], capture_output=True)
    # EXAMLIB (2026-11-04, the known-ads step): a folder of library copies by name to replay with instead, e.g. the snapshots fed from
    # other days' labels; the exam's own snapshot otherwise
    lib = os.path.join(os.environ["EXAMLIB"], e["library"]) if os.environ.get("EXAMLIB") else os.path.join(GOLDEN, day, "library", e["library"])
    assert os.path.isdir(lib), "no library copy " + lib
    # the replay begins a few minutes before the exam, so the readings that look back have something to look back on
    f0, f1 = e.get("frames", [hhmmss(e["from"]), hhmmss(e["to"])])
    calls = os.path.join(WORK, re.sub(r"[^A-Za-z0-9]+", "-", e["name"]) + ".calls.log")
    env = dict(os.environ, BENCHROOT=root, FEATCSV="", BWDIR=lib, LMODEL=mp, LPARITY="", LVETO="1", HALF="0", LCALLS=calls, LCALLS0="", CUELEAD=str(e.get("lead", 18)))
    env.update(switches)
    # EXTRAFEATROOT=<folder> (2026-11-08, E1): the day's folder of per-window repetition sidecars, read by the bench as extra readings
    if os.environ.get("EXTRAFEATROOT"): env["EXTRAFEAT"] = os.path.join(os.environ["EXTRAFEATROOT"], day)
    # LPARITYDIR=<folder> (2026-11-06, the look-ahead measure): each exam's learned chance per look, as <folder>/<exam>.csv
    if switches.get("LPARITYDIR"):
        env["LPARITY"] = os.path.join(switches["LPARITYDIR"], re.sub(r"[^A-Za-z0-9]+", "-", e["name"]) + ".csv")
    # below normal priority (2026-11-07): the bench at normal priority stalled the running PRISM's UI thread for up to a second at a time
    bout = subprocess.run([EXE, "bench", f0, f1, os.path.join(WORK, "rules.log")], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          creationflags=getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)).stdout
    mc = re.search(r"cost looks (\d+) trees ms ([\d.]+) net ms ([\d.]+) peak MB (\d+)", bout or "")
    mk = re.search(r"networks: known-channel looks (\d+), unknown-channel looks (\d+)", bout or "")
    if mk: costs.append(dict(looks=0, trees_ms=0, net_ms=0, peak_mb=0, known_looks=int(mk.group(1)), unknown_looks=int(mk.group(2))))
    if mc: costs.append(dict(looks=int(mc.group(1)), trees_ms=float(mc.group(2)), net_ms=float(mc.group(3)), peak_mb=int(mc.group(4))))
    out = subprocess.run([sys.executable, os.path.join(HERE, "exam.py"), "--trained", trained_path, day, win, e["from"], e["to"], "x=" + calls],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    h = re.search(r"(\d+) ad s, (\d+) show s", out)
    m1 = re.search(r"ads covered\s+([\d.]+)%.*?missed (\d+) s: began late (\d+), dropped mid-break (\d+), lifted early (\d+)", out)
    m2 = re.search(r"\((\d+) s\): stayed on after a break (\d+), came up ahead of one (\d+), on their own (\d+) s in (\d+) covers", out)
    m3 = re.search(r"covers (\d+), on the show and gone within 20 s (\d+)", out)
    if not (h and m1 and m2 and m3):
        print(e["name"], "could not be scored:", out[-400:]); continue
    ad, show, missed = int(h.group(1)), int(h.group(2)), int(m1.group(2))
    tot["ad"] += ad; tot["cov"] += ad - missed; tot["show"] += show; tot["wrong"] += int(m2.group(1))
    tot["late"] += int(m1.group(3)); tot["mid"] += int(m1.group(4)); tot["early"] += int(m1.group(5))
    tot["linger"] += int(m2.group(2)); tot["ahead"] += int(m2.group(3)); tot["own"] += int(m2.group(4)); tot["owns"] += int(m2.group(5))
    tot["short"] += int(m3.group(2))
    per.append(f"{e['name']} {m1.group(1)}% / {m2.group(1)} s / mid {m1.group(4)} / short {m3.group(2)}")
    mj = re.search(r"^JSON (.*)$", out, re.M)
    if mj:
        j = json.loads(mj.group(1)); j["exam"] = e["name"]; j["day"] = day; j["window"] = win; j["from"] = e["from"]; j["to"] = e["to"]
        tot["whole"] += j["whole"]; per_exam.append(j)
        for br in j["breaks"]:
            if not br["miss"]: start_lags.append(br["start_lag"]); end_lags.append(br["end_lag"])
        for pp in j["popup_list"]: popup_list.append(dict(pp, exam=e["name"], day=day, window=win))
    if not keep_calls:
        try: os.remove(calls)
        except OSError: pass
if tot["ad"]:
    name = "on " + str(model["policy"]["on"]) + " off " + str(model["policy"].get("off")) + (" " + " ".join(k + "=" + v for k, v in switches.items()) if switches else "")
    print(f"{name}: ads covered {100 * tot['cov'] / tot['ad']:.1f}% of {tot['ad']} s | show wrongly covered {100 * tot['wrong'] / tot['show']:.2f}% ({tot['wrong']} s of {tot['show']})"
          f" | missed: late {tot['late']}, mid-break {tot['mid']}, early {tot['early']} | wrong: stayed on {tot['linger']}, ahead {tot['ahead']}, on their own {tot['own']} s in {tot['owns']}"
          f" | pop-ups (on the show, gone within 20 s) {tot['short']}" + lag_line(start_lags, end_lags))
    print("   " + "   ".join(per))
    if results_path: write_results(results_path, name, model_path, model, switches, per_exam, tot, start_lags, end_lags, popup_list, costs)
    if max_short is not None and tot["short"] > int(max_short):
        print(f"GATE FAILED: {tot['short']} pop-ups, more than the {max_short} allowed"); sys.exit(2)
