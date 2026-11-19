"""Which channels keep a strip along the bottom of the picture (a score ticker, a news crawl)? (2026-11-15)

tickerstudy.py measures the channels of the labelled exams. This reads every recorded day and window, labelled or not, and lists
each channel with two measures of a strip, made on every stretch of one channel of ten minutes or more:

  still   the bottom rows whose mean brightness stands still through the stretch (tickerstudy's band): a strip of one colour
  line    a row where the picture ends: the difference between a row and the row above it is large on that row in most frames
          and small on the rows around it. A strip whose brightness changes with the scores still has this line.

For each, the share of the stretch's frames that show it, and, where the day's labels mark the window, the share of the
advertisement frames that show it: a channel that keeps its strip through its advertisements shows it there too.

    python scripts/breakwatch/stripsurvey.py [--step=20] [--days=2026-11-05,2026-11-06] [--min=30]

Reads only. A frame every --step seconds; a stretch needs --min frames. Prints one line a channel, the likeliest strip channels first,
and writes the stretches to stripsurvey.json beside the golden folders' parent (diagnostics/picstudy)."""
import io, json, os, re, sys
import numpy as np

args = sys.argv[1:]
def opt(name, default):
    for a in args:
        if a.startswith(name + "="): return a.split("=", 1)[1]
    return default
STEP = float(opt("--step", "20")); MINF = int(opt("--min", "30")); DAYS = [d for d in opt("--days", "").split(",") if d]
D = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics"); G = os.path.join(D, "golden")
TOP = 90; N = 180 - TOP


def sec(h): x, y, z = h.split(":"); return int(x) * 3600 + int(y) * 60 + int(z)


def marks(day, win):
    ev = os.path.join(G, day, win, "events.log"); out = []
    if os.path.exists(ev):
        for line in io.open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ edge \d (.+)", line.strip())
            if m: out.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]), m.group(2).strip()))
    out.sort(); return out


def frame(path):
    try: g = np.fromfile(path, np.uint8)
    except OSError: return None
    if g.size != 57600: return None
    a = g.reshape(180, 320)[TOP - 1:].astype(np.float32)
    edge = np.abs(a[1:] - a[:-1]).mean(1)          # each row against the row above it
    a = a[1:]
    return np.concatenate([a.mean(1), a.std(1), edge])


def band(M, S):
    tstd = 1.4826 * np.median(np.abs(M - np.median(M, axis=0)), axis=0); pic = float(np.median(tstd[:40]))
    still = (tstd < 0.35 * pic) & (tstd < 12)
    r = N - 1; miss = 0; top = None
    while r >= 0 and miss <= 3:
        if still[r]: top = r; miss = 0
        else: miss += 1
        r -= 1
    if top is None or N - top < 6 or N - top > 45: return None
    if float(np.median(S[:, top:], axis=0).mean()) < 6: return None   # a black bar under a film, not a strip
    return top + TOP


def line(E, M, S):
    """The row where the picture ends: its edge stands out from the rows around it in the median frame. Rows 135 to 174 of 180."""
    med = np.median(E, axis=0); best = None
    for r in range(135 - TOP, 175 - TOP):
        around = np.concatenate([med[max(0, r - 8):r - 1], med[r + 2:r + 9]])
        if med[r] > 10 and med[r] > 3 * float(np.median(around)) and (best is None or med[r] > med[best]): best = r
    if best is None: return None
    if float(np.median(M[:, best:], axis=0).mean()) < 24 and float(np.median(S[:, best:], axis=0).mean()) < 6: return None   # a film's black bar
    return best + TOP


res = []
for day in sorted(os.listdir(G)):
    if DAYS and day not in DAYS: continue
    dd = os.path.join(G, day)
    if not os.path.isdir(dd): continue
    try: labs = json.load(io.open(os.path.join(dd, "labels.json"), encoding="utf-8")).get("windows", {})
    except (OSError, ValueError): labs = {}
    for win in sorted(os.listdir(dd)):
        wd = os.path.join(dd, win); mk = marks(day, win)
        if not os.path.isdir(wd) or not mk: continue
        names = sorted(n for n in os.listdir(wd) if n.endswith(".gray") and len(n) == 14)
        ts = np.array([int(n[:2]) * 3600 + int(n[2:4]) * 60 + int(n[4:6]) for n in names])
        mt = np.array([x for x, _ in mk]); ci = np.searchsorted(mt, ts, side="right") - 1
        lab = labs.get(win)
        pick = []; last = -99
        for i in range(len(names)):
            if ci[i] < 0: continue
            if ts[i] - last >= STEP: pick.append(i); last = ts[i]
        if not pick: continue
        ch = [mk[ci[i]][1] for i in pick]; pt = ts[pick]
        cuts = [0] + [k for k in range(1, len(pick)) if ch[k] != ch[k - 1] or pt[k] - pt[k - 1] > 600] + [len(pick)]
        for a, b in zip(cuts[:-1], cuts[1:]):
            if b - a < MINF: continue
            fr = [(k, frame(os.path.join(wd, names[pick[k]]))) for k in range(a, b)]; fr = [(k, f) for k, f in fr if f is not None]
            if len(fr) < MINF: continue
            A = np.stack([f for _, f in fr]); M, S, E = A[:, :N], A[:, N:2 * N], A[:, 2 * N:]
            t = np.array([pt[k] for k, _ in fr])
            isad = None
            if lab:
                def inside(ss):
                    m = np.zeros(len(t), bool)
                    for x, z in ss: m |= (t >= sec(x)) & (t <= sec(z))
                    return m
                rev = inside(lab.get("reviewed", [])) & ~inside(lab.get("neutral", []))
                if rev.sum() >= 0.8 * len(t): isad = inside(lab.get("ads", [])) & rev
            top = band(M, S); ln = line(E, M, S)
            row = dict(day=day, win=win, channel=ch[a], frames=len(fr), still=top, line=ln, ads=int(isad.sum()) if isad is not None else None)
            if top is not None:
                kept = np.abs(M[:, top - TOP:] - np.median(M[:, top - TOP:], axis=0)).mean(1) < 8
                row["still_kept"] = float(kept.mean())
                if isad is not None and isad.sum() >= 5: row["still_ads"] = float(kept[isad].mean())
            if ln is not None:
                e = E[:, ln - TOP]; kept = e > 0.5 * float(np.median(e))
                row["line_kept"] = float(kept.mean())
                if isad is not None and isad.sum() >= 5: row["line_ads"] = float(kept[isad].mean())
            res.append(row)
        print(day, win, len(names), "frames", flush=True, file=sys.stderr)

os.makedirs(os.path.join(D, "picstudy"), exist_ok=True)
json.dump(res, io.open(os.path.join(D, "picstudy", "stripsurvey.json"), "w", encoding="utf-8"), indent=0)
by = {}
for r in res: by.setdefault(r["channel"], []).append(r)
out = []
for c, rs in by.items():
    n = len(rs); st = [r for r in rs if r["still"] is not None]; ln = [r for r in rs if r["line"] is not None]
    def mean(k, xs): v = [x[k] for x in xs if k in x]; return (float(np.mean(v)), len(v)) if v else (float("nan"), 0)
    out.append((max(len(st), len(ln)) / n, c, n, len(st), int(np.median([r["still"] for r in st])) if st else 0, mean("still_kept", st), mean("still_ads", st),
                len(ln), int(np.median([r["line"] for r in ln])) if ln else 0, mean("line_kept", ln), mean("line_ads", ln)))
print(f"a frame every {STEP:g} s; stretches of {MINF} frames or more; {len(res)} stretches, {len(by)} channels")
print("  channel                     stretches | still: found  row  kept  in ads (labelled stretches) | line: found  row  kept  in ads (labelled stretches)")
def pc(v): return "   - " if v != v else f"{100 * v:4.0f}%"
for share, c, n, ns, rs_, sk, sa, nl, rl, lk, la in sorted(out, key=lambda x: (-x[0], -x[2])):
    if n < 2: continue
    print(f"  {c[:26]:<26} {n:6d}    | {ns:11d} {rs_ if ns else '-':>4} {pc(sk[0])} {pc(sa[0])} ({sa[1]})                 | {nl:10d} {rl if nl else '-':>4} {pc(lk[0])} {pc(la[0])} ({la[1]})")
