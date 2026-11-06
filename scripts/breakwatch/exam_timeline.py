"""An exam break by break: where the replay's cover let go inside each marked break, how long it stayed on after, and where
YouTube TV's own slot sat. For finding WHAT is being missed, before looking at its frames (frames_sheet.py).

    python scripts/breakwatch/run_exams.py --keep-calls --only "<exam name>"
    python scripts/breakwatch/exam_timeline.py "<exam name>"

Reads the calls run_exams.py kept (%LOCALAPPDATA%/Prism/diagnostics/exam-work) and the day's marks; a second without a recorded frame
counts as covered (it is not scored either)."""
import bisect
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics")
name = sys.argv[1]
e = next(x for x in json.load(open(os.path.join(HERE, "exams.json"), encoding="utf-8")) if x["name"] == name)
G = os.path.join(ROOT, "golden", e["day"])


def sec(h):
    a = h.split(":"); return int(a[0]) * 3600 + int(a[1]) * 60 + int(float(a[2]))


def hm(x):
    x = int(x); return "%02d:%02d:%02d" % (x // 3600, x // 60 % 60, x % 60)


def fsec(n):
    return int(n[0:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6]) + int(n[6:9]) / 1000


A, B = sec(e["from"]), sec(e["to"])
ads = [(sec(a), sec(b)) for a, b in json.load(open(os.path.join(G, "labels.json"), encoding="utf-8"))["windows"][e["window"]]["ads"] if A <= sec(a) < B]
cov = []; on = None
for l in open(os.path.join(ROOT, "exam-work", re.sub(r"[^A-Za-z0-9]+", "-", name) + ".calls.log"), encoding="utf-8", errors="replace"):
    m = re.match(r"(\d\d:\d\d:\d\d)\.\d+ break watch \S+: (break|show)", l)
    if not m: continue
    t = sec(m.group(1))
    if m.group(2) == "break" and on is None: on = t
    elif m.group(2) == "show" and on is not None: cov.append((on, t)); on = None
slots = []; s0 = None
for l in open(os.path.join(G, e["window"], "events.log"), encoding="utf-8", errors="replace"):
    p = l.split(" ", 3)
    if len(p) < 4 or p[2] != "cue": continue
    q = p[3].split(); t = fsec(p[0]) + float(e.get("lead", 18))      # as read, slid to the picture by the exam's lead
    if q[0] == "EVENT_START": s0 = t
    elif q[0] == "EVENT_STOP" and s0 is not None: slots.append((s0, t)); s0 = None
frames = sorted(fsec(f[:9]) for f in os.listdir(os.path.join(G, e["window"])) if f.endswith(".gray") and f[:9].isdigit())


def has(x):
    i = bisect.bisect_left(frames, x - 1.5); return i < len(frames) and frames[i] <= x + 1.5


def covered(x):
    return any(u <= x < v for u, v in cov)


for a, b in ads:
    gaps = []; g0 = None
    for x in range(a, b):
        c = covered(x) or not has(x)
        if not c and g0 is None: g0 = x
        if c and g0 is not None: gaps.append((g0, x)); g0 = None
    if g0 is not None: gaps.append((g0, b))
    linger = 0
    while covered(b + linger) and linger < 120: linger += 1
    sl = [(u, v) for u, v in slots if u < b + 30 and v > a - 30]
    print(f"{hm(a)}-{hm(b)} ({b - a:>3} s)  uncovered: " + (", ".join(f"+{u - a}..+{v - a} ({v - u} s)" for u, v in gaps) or "nothing")
          + f"  | stays on {linger} s after" + ("  | slot " + ", ".join(f"+{u - a:.0f}..+{v - a:.0f}" for u, v in sl) if sl else ""))
