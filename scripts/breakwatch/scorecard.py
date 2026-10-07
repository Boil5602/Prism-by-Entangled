"""The break watch's errors, hour by hour (2026-10-07, "I want to keep track of false neg/pos times. That's very important to me").

Two sources, both on this PC, nothing sent anywhere:
  - the person's reports (breakwatch/corrections.log): a wrong cover with its seconds, a late cover with its seconds, a missed ad;
  - the break watch's own calls (diagnostics/host.log and host.log.prev): a cover that dropped for under 15 s and came back is ad time let
    through ("when you break an ad for 5 seconds and go straight back to ad, you know you've committed an error"), and a cover of under
    10 s is almost always a wrong one.
Neither is the truth: a report is a moment a person noticed, and the calls only show the watch disagreeing with itself. The measured passes
(docs/break-watch-scorecard.md) are the truth; this keeps the count between them.

    python scripts/breakwatch/scorecard.py [YYYY-MM-DD]      (default: today)
"""
import os
import re
import sys
from collections import defaultdict
from datetime import date

DATA = os.environ.get("PRISM_DATA_DIR") or os.path.join(os.environ["LOCALAPPDATA"], "Prism")
DAY = sys.argv[1] if len(sys.argv) > 1 else date.today().isoformat()
GAP_S, BLIP_S = 15, 10


def secs(hms):
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


hours = defaultdict(lambda: defaultdict(float))

# the person's reports
path = os.path.join(DATA, "breakwatch", "corrections.log")
if os.path.exists(path):
    for line in open(path, encoding="utf-8", errors="replace"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 4 or not parts[0].startswith(DAY):
            continue
        hour, what = parts[0][11:13], parts[3]
        h = hours[hour]
        m = re.search(r"wrong cover ([\d.]+) s", what)
        if m:
            h["reported wrong covers"] += 1
            h["reported wrong s"] += float(m.group(1))
        elif what.startswith("not an ad"):
            h["not an ad (uncovered)"] += 1
        m = re.search(r"late ([\d.]+) s", what)
        if m:
            h["reported late"] += 1
            h["reported late s"] += float(m.group(1))
        elif "missed" in what:
            h["reported missed (15 s+)"] += 1

# the watch's own calls: today's host.log (and .prev), per window, in order
calls = defaultdict(list)
for name in ("host.log.prev", "host.log"):
    p = os.path.join(DATA, "diagnostics", name)
    if not os.path.exists(p) or date.fromtimestamp(os.path.getmtime(p)).isoformat() != DAY:
        continue
    for line in open(p, encoding="utf-8", errors="replace"):
        m = re.match(r"(\d\d:\d\d:\d\d\.\d+) break watch (\S+): (break|show) \(", line)
        if m:
            calls[m.group(2)].append((secs(m.group(1)), m.group(3) == "break"))
        elif "brain ready" in line:
            # a restart drops every cover: the next call starts a new run, not a gap
            t = secs(line[:12])
            for w in calls:
                calls[w].append((t, None))
for w, seq in calls.items():
    seq.sort(key=lambda x: x[0])
    prev = None
    for t, on in seq:
        if prev is not None and on is not None and prev[1] is not None:
            dt = t - prev[0]
            hour = "%02d" % int(prev[0] // 3600)
            if prev[1] and not on and dt < BLIP_S:
                hours[hour]["short covers (likely wrong)"] += 1
                hours[hour]["short cover s"] += dt
            if not prev[1] and on and dt < GAP_S:
                hours[hour]["gaps in a break (likely missed)"] += 1
                hours[hour]["gap s"] += dt
        prev = (t, on)

cols = ["reported wrong covers", "reported wrong s", "not an ad (uncovered)", "reported late", "reported late s", "reported missed (15 s+)",
        "short covers (likely wrong)", "short cover s", "gaps in a break (likely missed)", "gap s"]
print("Break watch scorecard, " + DAY)
print("| hour | " + " | ".join(cols) + " |")
print("|---|" + "---|" * len(cols))
tot = defaultdict(float)
for hour in sorted(hours):
    print("| %s:00 | " % hour + " | ".join(("%g" % round(hours[hour][c], 1)) for c in cols) + " |")
    for c in cols:
        tot[c] += hours[hour][c]
print("| all | " + " | ".join(("%g" % round(tot[c], 1)) for c in cols) + " |")
