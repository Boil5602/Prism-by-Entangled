"""Every exam in exams.json replayed through Prism's own break code (the bwtest harness) and scored against the marks: one line.

    python scripts/breakwatch/run_exams.py [--model <learned.json>] [--on 0.80] [--off 0.55] [--only "<exam name>"] [--keep-calls] [--exams <file>]
                                           [--gentle] [NAME=VALUE ...]

- The model is the one Prism ships (targets/win-host/PrismHost/Assets/breakwatch/learned.json) unless --model names another; --on and
  --off replace its cover and lift thresholds for the run.
- NAME=VALUE pairs go to the harness as environment switches (ADLINE=0, CUECOMING=0, PLAINLIFT=2, LINFO=1 ...), which is how a rule is
  read with and without: two runs, the same exams, the same library copies. An exam's own cue lead (exams.json "lead") is CUELEAD.
- Each exam replays with the known-ad library as it stood before the stretch (exams.json "library": a folder of
  golden/<day>/library), never the live one: the live library has since learned the very breaks being replayed.
- --gentle waits between exams while Prism's own break watch is looking less often than it should (pic/gentle.py): a replay reads
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
keep_calls = flag("--keep-calls"); gentle = flag("--gentle")
switches = dict(a.split("=", 1) for a in args if "=" in a)
if gentle:
    sys.path.insert(0, os.path.join(HERE, "pic"))
    from gentle import wait_if_busy
exams = [e for e in json.load(open(opt("--exams", os.path.join(HERE, "exams.json")), encoding="utf-8")) if not only or e["name"] == only]
os.makedirs(WORK, exist_ok=True)
model = json.load(open(model_path, encoding="utf-8"))
if on: model["policy"]["on"] = float(on)
if off: model["policy"]["off"] = float(off)
mp = os.path.join(WORK, "model.json")
json.dump(model, open(mp, "w", encoding="utf-8"), separators=(",", ":"))


def hhmmss(h):
    return h.replace(":", "") + "000"


tot = dict(ad=0, cov=0, show=0, wrong=0, late=0, mid=0, early=0, linger=0, ahead=0, own=0, owns=0); per = []
for e in exams:
    if gentle: wait_if_busy(every=0)
    day, win = e["day"], e["window"]
    root = os.path.join(WORK, "root-" + day + "-" + win)       # a folder holding only this window: the harness replays every window it finds
    link = os.path.join(root, win)
    if not os.path.exists(link):
        os.makedirs(root, exist_ok=True)
        subprocess.run(["cmd", "/c", "mklink", "/J", link, os.path.join(GOLDEN, day, win)], capture_output=True)
    lib = os.path.join(GOLDEN, day, "library", e["library"])
    assert os.path.isdir(lib), "no library copy " + lib
    # the replay begins a few minutes before the exam, so the readings that look back have something to look back on
    f0, f1 = e.get("frames", [hhmmss(e["from"]), hhmmss(e["to"])])
    calls = os.path.join(WORK, re.sub(r"[^A-Za-z0-9]+", "-", e["name"]) + ".calls.log")
    env = dict(os.environ, BENCHROOT=root, FEATCSV="", BWDIR=lib, LMODEL=mp, LPARITY="", LVETO="1", HALF="0", LCALLS=calls, LCALLS0="", CUELEAD=str(e.get("lead", 18)))
    env.update(switches)
    subprocess.run([EXE, "bench", f0, f1, os.path.join(WORK, "rules.log")], env=env, capture_output=True)
    out = subprocess.run([sys.executable, os.path.join(HERE, "exam.py"), "--trained", os.path.join(HERE, "trained.json"), day, win, e["from"], e["to"], "x=" + calls],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    h = re.search(r"(\d+) ad s, (\d+) show s", out)
    m1 = re.search(r"ads covered\s+([\d.]+)%.*?missed (\d+) s: began late (\d+), dropped mid-break (\d+), lifted early (\d+)", out)
    m2 = re.search(r"\((\d+) s\): stayed on after a break (\d+), came up ahead of one (\d+), on their own (\d+) s in (\d+) covers", out)
    if not (h and m1 and m2):
        print(e["name"], "could not be scored:", out[-400:]); continue
    ad, show, missed = int(h.group(1)), int(h.group(2)), int(m1.group(2))
    tot["ad"] += ad; tot["cov"] += ad - missed; tot["show"] += show; tot["wrong"] += int(m2.group(1))
    tot["late"] += int(m1.group(3)); tot["mid"] += int(m1.group(4)); tot["early"] += int(m1.group(5))
    tot["linger"] += int(m2.group(2)); tot["ahead"] += int(m2.group(3)); tot["own"] += int(m2.group(4)); tot["owns"] += int(m2.group(5))
    per.append(f"{e['name']} {m1.group(1)}% / {m2.group(1)} s / mid {m1.group(4)}")
    if not keep_calls:
        try: os.remove(calls)
        except OSError: pass
if tot["ad"]:
    name = "on " + str(model["policy"]["on"]) + " off " + str(model["policy"].get("off")) + (" " + " ".join(k + "=" + v for k, v in switches.items()) if switches else "")
    print(f"{name}: ads covered {100 * tot['cov'] / tot['ad']:.1f}% of {tot['ad']} s | show wrongly covered {100 * tot['wrong'] / tot['show']:.2f}% ({tot['wrong']} s of {tot['show']})"
          f" | missed: late {tot['late']}, mid-break {tot['mid']}, early {tot['early']} | wrong: stayed on {tot['linger']}, ahead {tot['ahead']}, on their own {tot['own']} s in {tot['owns']}")
    print("   " + "   ".join(per))
