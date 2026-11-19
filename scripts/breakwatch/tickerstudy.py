"""Does a channel keep its bottom strip (a score ticker, a news crawl) on screen through its advertisements? (2026-11-15)

NFL Network does (B-359), and the break watch then reads the strip's logo as the show. This measures every channel of the exams:
in each stretch of one channel, the rows at the bottom whose mean barely moves from frame to frame through the programme while the
picture above them does (a ticker scrolls along its rows, so the rows' means stand still). That is the channel's strip and its first
row. An advertisement keeps the strip when the same rows' means stand where the programme's did. Beside it, from a training run's exported scores, how much of the ad time was covered with the strip
kept and with it gone.

    PROMOS=show python scripts/breakwatch/tickerstudy.py <parity.csv> <exams.json> [--step=3] [--keep=8] [--debug=<channel>,<channel>]

--debug prints the named channels' row profiles from row 150 down. Reads only. A frame every --step seconds; --keep is how far, in grey levels, the strip's row means may stand from the programme's."""
import csv, io, json, os, re, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import promos  # noqa: E402

args = sys.argv[1:]
def opt(name, default):
    for a in args:
        if a.startswith(name + "="): return a.split("=", 1)[1]
    return default
pos = [a for a in args if not a.startswith("--")]
if len(pos) < 2: print(__doc__); sys.exit(1)
STEP = float(opt("--step", "3")); KEEP = float(opt("--keep", "8"))
G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")


def sec(h): x, y, z = h.split(":"); return int(x) * 3600 + int(y) * 60 + int(z)
def spans(t, ss):
    m = np.zeros(len(t), bool)
    for a, b in ss: m |= (t >= sec(a)) & (t <= sec(b))
    return m
def policy(p, on=0.80, off=0.55, hold=2):
    out = np.zeros(len(p), bool); up = False; run = 0
    for i, v in enumerate(p):
        run = run + 1 if v > on else 0
        if not up and run >= hold: up = True
        elif up and v < off: up = False
        out[i] = up
    return out
def channels(day, win, t):
    ev = os.path.join(G, day, win, "events.log"); marks = []
    if os.path.exists(ev):
        for line in io.open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ edge \d (.+)", line.strip())
            if m: marks.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]), m.group(2).strip()))
    marks.sort()
    if not marks: return np.array(["?"] * len(t), dtype=object)
    ts = np.array([x for x, _ in marks]); i = np.searchsorted(ts, t, side="right") - 1
    return np.array([marks[max(0, k)][1] for k in i], dtype=object)
TOP = 90   # the rows read: from here to the bottom of the 180
def strip(day, win, tt):
    """A frame's lower half as two profiles: each row's mean and each row's spread along the row. A ticker scrolls along its rows,
    so its row means stand still while its pixels do not."""
    x = int(round(tt * 1000))
    try: g = np.fromfile(os.path.join(G, day, win, f"{x // 3600000:02d}{x // 60000 % 60:02d}{x // 1000 % 60:02d}{x % 1000:03d}.gray"), np.uint8)
    except OSError: return None
    if g.size != 57600: return None
    a = g.reshape(180, 320)[TOP:].astype(np.float32)
    return np.concatenate([a.mean(1), a.std(1)])
def band(M, S):
    """The strip of a stretch of programme frames: the rows at the bottom whose mean barely moves from frame to frame while the
    picture above them does, and that are not a plain black bar. Returns its first row (of 180), or None."""
    n = 180 - TOP; tstd = 1.4826 * np.median(np.abs(M - np.median(M, axis=0)), axis=0); pic = float(np.median(tstd[:40]))   # the spread as a median deviation: frames with the strip away (a replay, a full-screen card) do not count against it
    still = (tstd < 0.35 * pic) & (tstd < 12)
    r = n - 1; miss = 0; top = None
    while r >= 0 and miss <= 3:
        if still[r]: top = r; miss = 0
        else: miss += 1
        r -= 1
    if top is None or n - top < 6 or n - top > 45: return None
    if float(np.median(S[:, top:], axis=0).mean()) < 6: return None   # a black bar under a film, not a strip
    return top + TOP


want = {}
exams = json.load(io.open(pos[1], encoding="utf-8"))
for e in exams: want.setdefault(e["day"] + "|" + e["window"], []).append(e)
rows = {k: [] for k in want}
with io.open(pos[0], newline="", encoding="utf-8") as f:
    rd = csv.reader(f); next(rd)
    for w, t, p in rd:
        if w in rows: rows[w].append((float(t), float(p)))

by = {}
for key, ex in sorted(want.items()):
    day, win = key.split("|", 1)
    a = np.array(sorted(rows[key]))
    if not len(a): continue
    t, p = a[:, 0], a[:, 1]; cv = policy(p)
    lab = json.load(io.open(os.path.join(G, day, "labels.json"), encoding="utf-8"))["windows"][win]
    ads = promos.ads_for(os.path.join(G, day), win, lab["ads"]) if promos.on() else lab["ads"]
    keep = spans(t, lab.get("reviewed", [])) & ~spans(t, lab.get("neutral", [])) & ~spans(t, [(x, z) for x, z in ads if sec(z) - sec(x) > 480])
    pm = spans(t, promos.load(os.path.join(G, day)).get(win, [])) if promos.on() else np.zeros(len(t), bool)
    y = spans(t, ads); em = np.zeros(len(t), bool)
    for e in ex: em |= (t >= sec(e["from"])) & (t < sec(e["to"]))
    use = em & keep & ~pm; ch = channels(day, win, t)
    # one stretch of one channel at a time: its show frames give the strip to compare with
    idx = np.flatnonzero(use);
    if not len(idx): continue
    cut = np.flatnonzero((ch[idx][1:] != ch[idx][:-1]) | (np.diff(t[idx]) > 600)) + 1
    for seg in np.split(idx, cut):
        last = -99.0; pick = []
        for i in seg:
            if t[i] - last >= STEP: pick.append(i); last = t[i]
        fr = [(i, strip(day, win, t[i])) for i in pick]; fr = [(i, s) for i, s in fr if s is not None]
        if sum(1 for i, s_ in fr if not y[i]) < 20: continue
        n = 180 - TOP
        M = np.stack([s_[:n] for _, s_ in fr]); S = np.stack([s_[n:] for _, s_ in fr]); isad = np.array([bool(y[i]) for i, _ in fr]); cov = np.array([bool(cv[i]) for i, _ in fr])
        r = by.setdefault(str(ch[seg[0]]), dict(tops=[], none=0, show=[], ad=[], adcov=[], adall=0, covall=0))
        r["adall"] += int(isad.sum()); r["covall"] += int((isad & cov).sum())
        top = band(M[~isad], S[~isad])
        if str(ch[seg[0]]) in opt("--debug", "").split(","):
            ts_ = 1.4826 * np.median(np.abs(M[~isad] - np.median(M[~isad], axis=0)), axis=0); print("DEBUG", ch[seg[0]], day, win[-6:], "pic", round(float(np.median(ts_[:40])), 1), "top", top, "| row std from row 150:", " ".join(f"{v:.0f}" for v in ts_[150 - TOP:]), "| spread:", " ".join(f"{v:.0f}" for v in np.median(S[~isad], axis=0)[150 - TOP:]))
        if top is None: r["none"] += 1; r["ad"] += [False] * int(isad.sum()); r["adcov"] += list(cov[isad]); continue
        r["tops"].append(top)
        ref = np.median(M[~isad][:, top - TOP:], axis=0)
        kept = np.abs(M[:, top - TOP:] - ref).mean(1) < KEEP
        r["show"] += list(kept[~isad]); r["ad"] += list(kept[isad]); r["adcov"] += list(cov[isad])

print(f"a frame every {STEP:g} s; the strip is kept when its rows' means stand within {KEEP:g} grey levels of the programme's")
print("  channel                    stretches with a strip   first row   kept in show   ad frames   kept in ads   ads covered: kept / gone")
out = []
for c, r in by.items():
    if len(r["ad"]) < 15: continue
    ad = np.array(r["ad"], bool); cov = np.array(r["adcov"], bool); sh = np.array(r["show"], bool)
    out.append((float(ad.mean()), c, len(r["tops"]), r["none"], int(np.median(r["tops"])) if r["tops"] else 0, float(sh.mean()) if len(sh) else float("nan"), len(ad), float(cov[ad].mean()) if ad.any() else float("nan"), float(cov[~ad].mean()) if (~ad).any() else float("nan"), int(ad.sum())))
for ka, c, nt, nn, top, hs, na, ck, cg, nk in sorted(out, key=lambda x: -x[0]):
    print(f"  {c[:26]:<26} {nt:6d} of {nt + nn:<3d}             {top if nt else '-':>5}       {100 * hs:5.0f}%      {na:6d}      {100 * ka:5.0f}%        {100 * ck:5.0f}% of {nk:<4d} / {100 * cg:5.0f}% of {na - nk}")
tk = sum(x[9] for x in out); ta = sum(x[6] for x in out)
ck = sum((x[7] * x[9]) for x in out if x[9]); cg = sum((x[8] * (x[6] - x[9])) for x in out if x[6] - x[9])
print(f"ALL: the strip is kept on {tk} of {ta} ad frames ({100 * tk / ta:.1f}%); covered {100 * ck / max(tk, 1):.1f}% of those, {100 * cg / max(ta - tk, 1):.1f}% of the rest")
