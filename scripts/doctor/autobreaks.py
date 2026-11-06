"""The breaks today's model covered in a recorded day, as spans for the promo pass (2026-11-04: the owner asked to sample as much as needed to
improve the promo/commercial split; marking every hour by hand or by vision costs about $1.30 a window-hour, while the model already covers
about 94% of ad time). From golden/<day>/calls.log ("break watch <win>: break (" / "show ("), each cover with 20 s before and 20 s after,
merged, longer than 20 s; spans already in golden/<day>/labels.json's reviewed time or labels.auto.json's are left out, so a night's run
only sends what is new. Writes golden/<day>/labels.candidates.json: windows.<win>.ads = [[from, to] ...] (the promo pass's --labels).

    python scripts/doctor/autobreaks.py <golden day>
"""
import json
import os
import re
import sys

day = sys.argv[1]
G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden", day)
PAD, MIN = 20, 20


def sec(t):
    h, m, s = t.split(":")[:3]; return int(h) * 3600 + int(m) * 60 + int(float(s))


def hms(v):
    v = max(0, min(86399, v)); return f"{v // 3600:02d}:{v // 60 % 60:02d}:{v % 60:02d}"


calls = {}
p = os.path.join(G, "calls.log")
if not os.path.exists(p):
    print("no calls.log for", day); sys.exit(0)
for line in open(p, encoding="utf-8", errors="replace"):
    m = re.match(r"(\d\d:\d\d:\d\d)\.\d+ break watch (\S+): (break|show) \(", line)
    if m: calls.setdefault(m.group(2), []).append((sec(m.group(1)), m.group(3) == "break"))
done = {}
for name in ("labels.json", "labels.auto.json"):
    q = os.path.join(G, name)
    if os.path.exists(q):
        for w, v in json.load(open(q, encoding="utf-8")).get("windows", {}).items():
            done.setdefault(w, []).extend((sec(a), sec(b)) for a, b in v.get("reviewed", []))
out, total = {"day": day, "windows": {}}, 0
for w, cs in calls.items():
    if not os.path.isdir(os.path.join(G, w)): continue
    cs.sort(); spans = []; on = None
    for t, b in cs:
        if b and on is None: on = t
        elif not b and on is not None: spans.append((on - PAD, t + PAD)); on = None
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]: merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else: merged.append((a, b))
    keep = [(a, b) for a, b in merged if b - a > MIN and not any(a < y and b > x for x, y in done.get(w, []))]
    if keep:
        out["windows"][w] = {"ads": [[hms(a), hms(b)] for a, b in keep]}
        total += sum(b - a for a, b in keep)
json.dump(out, open(os.path.join(G, "labels.candidates.json"), "w", encoding="utf-8"), indent=1)
print(f"{day}: {sum(len(v['ads']) for v in out['windows'].values())} new covered breaks in {len(out['windows'])} windows, {total} s, written to labels.candidates.json")
