"""Phase A1 of the redesign's addendum (2026-11-08): the channel joined to every golden window-day and every labelled break.

    python scripts/breakwatch/channels.py backfill        write <golden>/<day>/<window>/channels.json for every window-day, print what joined
    python scripts/breakwatch/channels.py breaks           the channel of every labelled break (labels.json ads), as a table and a JSON

A window's events.log carries two things about the channel: "channel <id>" lines (the YouTube TV channel id, the same id the logo
references are named by) whenever the window tunes, and "edge N <name>" lines (the channel's name read from the page's own guide edge)
while it plays. A window-day's sidecar lists the segments between tunes with the id and the name most often read inside the segment;
before the first "channel" line the name alone stands (the id unknown) when the edge lines give one. A labelled break takes the segment
that holds its start. The sidecar is written beside the frames and never alters them.

Others read it through channel_at(day, window, t) -> (id, name) or (None, None).
"""
import glob
import json
import os
import sys
from collections import Counter

GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")


def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
def clock(t):
    t = int(t); return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def ev_time(stamp):
    """events.log's first column: HHMMSSmmm of the day (as the frame names)."""
    return int(stamp[:2]) * 3600 + int(stamp[2:4]) * 60 + int(stamp[4:6]) + int(stamp[6:9]) / 1000.0


def segments(day, win):
    path = os.path.join(GOLD, day, win, "events.log")
    if not os.path.exists(path): return []
    tunes, edges = [], []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            sp = line.rstrip("\n").split(" ", 3)
            if len(sp) < 4: continue
            kind = sp[2]
            try: t = ev_time(sp[0])
            except ValueError: continue
            if kind == "channel": tunes.append((t, sp[3].strip()))
            elif kind == "edge":
                rest = sp[3].split(" ", 1)
                if len(rest) == 2 and rest[1].strip(): edges.append((t, rest[1].strip()))
    if not tunes and not edges: return []
    bounds = [0.0] + [t for t, _ in tunes] + [86400.0]
    ids = [None] + [cid for _, cid in tunes]
    out = []
    for i in range(len(bounds) - 1):
        a, b = bounds[i], bounds[i + 1]
        names = Counter(n for t, n in edges if a <= t < b)
        name = names.most_common(1)[0][0] if names else None
        if ids[i] is None and name is None: continue
        out.append(dict(**{"from": clock(a), "to": clock(b)}, id=ids[i], name=name, edge_reads=sum(names.values())))
    return out


def backfill():
    rows = []
    for d in sorted(glob.glob(os.path.join(GOLD, "2026-*"))):
        day = os.path.basename(d)
        for w in sorted(glob.glob(os.path.join(d, "*"))):
            if not os.path.isdir(w) or not glob.glob(os.path.join(w, "*.gray")): continue
            win = os.path.basename(w); seg = segments(day, win)
            json.dump({"day": day, "window": win, "segments": seg}, open(os.path.join(w, "channels.json"), "w", encoding="utf-8"), indent=1)
            rows.append((day, win, len(seg), sum(1 for s in seg if s["id"]), sum(1 for s in seg if s["name"])))
    joined = sum(1 for r in rows if r[2]); print(f"{len(rows)} window-days, {joined} with a channel timeline ({len(rows) - joined} with none: no YouTube TV channel or edge events)")
    for r in rows: print(f"  {r[0]} {r[1]}: {r[2]} segments, {r[3]} with an id, {r[4]} with a name")
    return rows


_CACHE = {}
def channel_at(day, win, t):
    key = (day, win)
    if key not in _CACHE:
        p = os.path.join(GOLD, day, win, "channels.json")
        _CACHE[key] = json.load(open(p, encoding="utf-8"))["segments"] if os.path.exists(p) else []
    for s in _CACHE[key]:
        if sec(s["from"]) <= t < sec(s["to"]): return s["id"], s["name"]
    return None, None


def breaks():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import promos as _promos
    out = []
    for d in sorted(glob.glob(os.path.join(GOLD, "2026-*"))):
        day = os.path.basename(d); f = os.path.join(d, "labels.json")
        if not os.path.exists(f): continue
        for win, lab in json.load(open(f, encoding="utf-8")).get("windows", {}).items():
            ads = lab.get("ads", [])
            if _promos.on(): ads = _promos.ads_for(d, win, ads)
            for a, b in ads:
                cid, name = channel_at(day, win, sec(a))
                out.append(dict(day=day, window=win, start=a, end=b, id=cid, name=name))
    with_id = sum(1 for o in out if o["id"]); with_name = sum(1 for o in out if o["name"])
    print(f"{len(out)} labelled breaks: {with_id} with a channel id, {with_name} with a name, {sum(1 for o in out if not o['id'] and not o['name'])} with neither")
    by = Counter((o["name"] or o["id"] or "?") for o in out)
    print("breaks by channel:", ", ".join(f"{k} {v}" for k, v in by.most_common(40)))
    json.dump(out, open(os.path.join("scripts", "doctor", "out", "redesign-20261107", "breaks-by-channel.json"), "w", encoding="utf-8"), indent=1)
    return out


if __name__ == "__main__":
    os.environ.setdefault("PROMOS", "show")
    if sys.argv[1:2] == ["backfill"]: backfill()
    elif sys.argv[1:2] == ["breaks"]: breaks()
    else: print(__doc__)
