"""Channels that sell no advertising, taken out of the score and the training (2026-11-15).

A PBS station and the C-SPAN channels carry no commercial breaks. What a labeller marks there is a sponsor message or the station's
own announcement, and a detector that leaves it alone is right. Their marked stretches are moved from a window's `ads` to its
`neutral` time, which every scorer and the training leave out. The channel on screen is read from the kept recording's edge lines.

    python scripts/breakwatch/adfree.py <day> [<day> ...] [--dry]

The day's labels.json is copied to labels.before-adfree.json first (once: an existing copy is kept). The sampler's labelling
(label-sampled.py) already skips the PBS station; this covers the hours labelled whole."""
import io, json, os, re, shutil, sys

G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
ADFREE = re.compile(r"^(WPSU|PBS|C-SPAN)", re.I)
DRY = "--dry" in sys.argv
days = [a for a in sys.argv[1:] if not a.startswith("--")]


def sec(h): x, y, z = h.split(":"); return int(x) * 3600 + int(y) * 60 + int(z)


def marks(day, win):
    ev = os.path.join(G, day, win, "events.log"); out = []
    if os.path.exists(ev):
        for line in io.open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ edge \d (.+)", line.strip())
            if m: out.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]), m.group(2).strip()))
    return sorted(out)


def channel(mk, t):
    name = None
    for x, n in mk:
        if x > t: break
        name = n
    return name


for day in days:
    p = os.path.join(G, day, "labels.json")
    if not os.path.exists(p): print(day, "no labels.json"); continue
    lab = json.load(io.open(p, encoding="utf-8")); moved = 0; secs = 0
    for win, w in lab.get("windows", {}).items():
        mk = marks(day, win); keep = []
        for a, b in w.get("ads", []):
            c = channel(mk, sec(a)) or ""
            if ADFREE.match(c):
                w.setdefault("neutral", []).append([a, b]); moved += 1; secs += sec(b) - sec(a)
                print(f"  {day} {win[-6:]} {c}: {a} to {b}")
            else: keep.append([a, b])
        w["ads"] = keep
        if "neutral" in w: w["neutral"] = sorted(w["neutral"])
    print(f"{day}: {moved} marked stretches ({secs} s) on channels with no advertising" + (" (dry: nothing written)" if DRY else ""))
    if moved and not DRY:
        bak = os.path.join(G, day, "labels.before-adfree.json")
        if not os.path.exists(bak): shutil.copy2(p, bak)
        f = io.open(p, "w", encoding="utf-8"); f.write(json.dumps(lab, indent=1)); f.close()
