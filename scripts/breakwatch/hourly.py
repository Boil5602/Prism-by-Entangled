"""Hourly break-watch check (read-only): per channel over the last hour - covers started, covered time, and the person's reports - and
how often the break watch looked at each window (56-59 a minute is normal; fewer means the PC, or a job beside Prism, is in its way).

    python scripts/breakwatch/hourly.py

Reads %LOCALAPPDATA%/Prism/diagnostics/host.log (and host.log.prev across a rotation), breakwatch/corrections.log and the live
recording's frames. A window taken off the screen ends its cover; times are counted back from now, so an hour across midnight is whole."""
def short(w):
    return w.replace("youtube-tv-home-16x9-", "ytv-").replace("youtube-home-16x9-", "yt-")


import sys
try: sys.stdout.reconfigure(errors="replace")   # a page title can carry a character the console's code page lacks (2026-10-11)
except Exception: pass
import os
import re
import time
from collections import defaultdict

P = os.path.join(os.environ["LOCALAPPDATA"], "Prism")
now = time.localtime()
CLOCK = now.tm_hour * 3600 + now.tm_min * 60 + now.tm_sec
# every time below is seconds before now (0 = now, -3600 = an hour ago): a time of day later than the clock is yesterday's, so the hour
# before 00:30 is read whole (2026-10-09: the first check after midnight counted from 00:00)
NOW = 0
FROM = -3600
stamp = time.time()


def ago(sec_of_day):
    r = sec_of_day - CLOCK
    if 0 < r <= 300: return 0      # written while this check runs: now, not yesterday
    return r if r <= 0 else r - 86400


def tod(s):
    return ago(int(s[0:2]) * 3600 + int(s[3:5]) * 60 + int(s[6:8]))


def hm(t):
    t = (CLOCK + t) % 86400
    return f"{t // 3600:02d}:{t // 60 % 60:02d}"


# each window's channel over time, from the bench's edge lines (today's: a time of day later than now is yesterday's)
chan = {}
bench = os.path.join(P, "diagnostics", "bench")
for w in os.listdir(bench):
    ev = os.path.join(bench, w, "events.log")
    if not os.path.exists(ev): continue
    marks = []
    for l in open(ev, encoding="utf-8", errors="replace"):
        m = re.match(r"(\d{2})(\d{2})(\d{2})\d{3} \S+ edge \d (.+)", l)
        if m:
            t = ago(int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)))
            if m.group(4).strip(): marks.append((t, m.group(4).strip()))
    # the file runs on for days and names a line by its time of day alone: only its last lines are this hour's (an edge line comes about
    # once a minute). Without this, yesterday's lines from the same hour sat among today's - a window on TNT was reported under the channel
    # it had been on a day before (NFL Network at 02:00, Disney Channel at 09:00, 2026-10-10).
    marks = marks[-80:]
    chan[w] = sorted(x for x in marks if FROM - 600 <= x[0] <= NOW)


def channel_of(w, t):
    name = "?"
    for a, n in chan.get(w, []):
        if a <= t + 90: name = n
        else: break
    return name


covers = defaultdict(list)      # channel -> [seconds covered]
up = {}
restarts = []
# the log is rotated in place when it grows (host.log.prev holds what came before): the hour can straddle the two (2026-10-09: a check
# after a 06:59 rotation read half an hour and showed a channel with no covers at all)
_lines = []
_prev = os.path.join(P, "diagnostics", "host.log.prev")
if os.path.exists(_prev) and time.time() - os.path.getmtime(_prev) < 2 * 3600:
    with open(_prev, "rb") as _f:
        _f.seek(max(0, os.path.getsize(_prev) - 40_000_000)); _lines = _f.read().decode("utf-8", "replace").splitlines(True)[1:]
_lines += open(os.path.join(P, "diagnostics", "host.log"), encoding="utf-8", errors="replace").readlines()
_first = 0      # the log is in order and may hold more than a day: from its end back to the first line older than the hour
for _i in range(len(_lines) - 1, -1, -1):
    if re.match(r"\d\d:\d\d:\d\d", _lines[_i]) and tod(_lines[_i]) < FROM - 7200: _first = _i + 1; break   # two hours further back: who was covered as the hour began
for l in _lines[_first:]:
    if not re.match(r"\d\d:\d\d:\d\d", l): continue
    t = tod(l)
    if t < FROM:
        # before the hour: only who is covered as it begins. A cover that stood through the whole hour has no line of its own in it,
        # and was left out altogether (2026-10-11: a paid programme's cover, up for 31 minutes and counting, showed as no row at all)
        if "brain ready" in l: up = {}; continue
        g0 = re.search(r"<- surface\.destroy (\S+)", l)
        if g0: up.pop(g0.group(1), None); continue
        m0 = re.search(r"break watch (\S+): (break|show) \(", l) or re.search(r"break watch (\S+): the person (said) Not an ad", l)
        if m0:
            if m0.group(2) == "break": up[m0.group(1)] = FROM
            else: up.pop(m0.group(1), None)
        continue
    if not (FROM <= t <= NOW): continue
    if "brain ready" in l:
        restarts.append(t)
        for w, a in up.items(): covers[channel_of(w, a)].append(t - a)
        up = {}
        continue
    # a window taken off the screen ends its cover with no "show" line (2026-10-09: Animal Planet's window, displaced by a title dragged
    # in six seconds into a cover, was counted as covered for the ten minutes to the next restart)
    gone = re.search(r"<- surface\.destroy (\S+)", l)
    if gone and gone.group(1) in up:
        a0 = up.pop(gone.group(1)); covers[channel_of(gone.group(1), a0)].append(t - a0)
        continue
    m = re.search(r"break watch (\S+): (break|show) \(", l) or re.search(r"break watch (\S+): the person (said) Not an ad", l)   # a Not an ad lifts the cover too
    if not m: continue
    w = m.group(1)
    if m.group(2) == "break":
        up.setdefault(w, t)
    elif w in up:
        a = up.pop(w); covers[channel_of(w, a)].append(t - a)
for w, a in up.items(): covers[channel_of(w, a) + " (still up)"].append(NOW - a)

rep = defaultdict(lambda: [0, 0, 0])   # channel -> not an ad, missed, late
for l in open(os.path.join(P, "breakwatch", "corrections.log"), encoding="utf-8", errors="replace"):
    p = l.rstrip("\n").split("\t")
    if len(p) < 4: continue
    try: t = time.mktime(time.strptime(p[0][:19], "%Y-%m-%d %H:%M:%S")) - stamp
    except ValueError: continue
    if not (FROM <= t <= NOW): continue
    k = 0 if p[3].startswith("not an ad") else 1 if "missed" in p[3] else 2
    rep[p[2]][k] += 1

print(f"{hm(FROM)}-{hm(NOW)}; restarts at " + (", ".join(hm(r) for r in restarts) or "none"))
names = sorted(set(list(covers) + list(rep)))
for n in names:
    c = covers.get(n, [])
    r = rep.get(n.replace(" (still up)", ""), [0, 0, 0]) if "(still up)" not in n else [0, 0, 0]
    print(f"  {n:<28} covers {len(c):2d}, covered {int(sum(c)):5d} s (longest {int(max(c)) if c else 0} s) | not an ad {r[0]}, missed {r[1]}, late {r[2]}")
print("channels now:", {short(w): (chan[w][-1][1] if chan.get(w) else "?") for w in sorted(chan)})

# a window's short name: a YouTube window and a YouTube TV window both end in 6x9-XL, so the last six letters charged one to the other (2026-10-11)
# page chrome (2026-10-11): the host asks each video window every 15 s whether its video fills the window, and logs a change
# ("page chrome <id>: video|page|overlay, ..."). The time each window spent on a page or under an overlay this hour, from those lines.
_pc_state = {}; _pc_time = {}; _pc_n = {}; _pc_last = {}
for l in _lines[_first:]:
    m = re.match(r"(\d\d:\d\d:\d\d)\.\d+ page chrome (\S+): (video|page|overlay)(.*)", l)
    if not m: continue
    t = tod(l); w = m.group(2); st = m.group(3)
    if w in _pc_state and _pc_state[w][0] != "video":
        _pc_time[w] = _pc_time.get(w, 0) + (min(t, NOW) - max(_pc_state[w][1], FROM))
    if st != "video" and FROM <= t <= NOW: _pc_n[w] = _pc_n.get(w, 0) + 1; _pc_last[w] = m.group(4).strip()[:70]
    _pc_state[w] = (st, t)
# a window that said nothing this hour and is gone (closed, replaced) is not charged to the hour's end: its last state was from before (2026-10-11)
_pc_alive = {m.group(2) for l in _lines[_first:] for m in [re.match(r"(\d\d:\d\d:\d\d)\.\d+ page chrome (\S+):", l)] if m and FROM <= tod(l) <= NOW} | set(chan.keys())
for w, (st, t0) in _pc_state.items():
    if st != "video" and (w in _pc_alive or t0 >= FROM): _pc_time[w] = _pc_time.get(w, 0) + (NOW - max(t0, FROM))
_pc = [f"{short(w)} {int(max(0, s))} s ({_pc_n.get(w, 0)} time(s), last: {_pc_last.get(w, '')})" for w, s in sorted(_pc_time.items()) if s > 0]
print("page chrome (a window not showing video):", "; ".join(_pc) or "none")

# the look rate (2026-10-08): how often the break watch looked at each window in the hour, by the frames it recorded. 56-59 a minute is
# normal; CPU and memory read fine on the evening my study jobs halved it
import glob
_bench = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "bench")
_now = time.time(); _line = []
for _w in sorted(os.listdir(_bench)) if os.path.isdir(_bench) else []:
    _per = {}
    try:
        for _e in os.scandir(os.path.join(_bench, _w)):
            if _e.name.endswith(".gray"):
                _age = _now - _e.stat().st_mtime
                if 60 <= _age < 3660: _per[int(_age // 60)] = _per.get(int(_age // 60), 0) + 1
    except OSError:
        continue
    if _per: _line.append(f"{short(_w)} {min(_per.values())}-{max(_per.values())} (now {_per.get(1, 0)})")
print("looks a minute, lowest-highest in the hour:", "; ".join(_line) or "nothing recorded")
