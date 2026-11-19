"""Where the break watch's errors are, by kind (2026-11-15, the work on break start and end timing).

A training run's exported scores (the parity file of train2.py --export: window, second, chance) over the exams, with the live
policy (cover above 0.80 twice running, ends below 0.55), split by what went wrong:

  missed ad time   = the start (from the break's first second to the cover), gaps (the cover dropped inside the break),
                     and breaks never covered;
  wrong show time  = the lead (a cover up before the break), the linger (a cover still up after it), time inside a covered break that is no ad
                     (a promo, with PROMOS=show, or show between two breaks under one cover), and covers that touch no break.

Each kind is given as seconds and as a share, with how the trees stood at the edge: a late start where the chance was already
over the threshold is the policy's second, the rest is the trees'. The largest single errors are listed with their clock times
so the frames can be looked at (frames_sheet.py); an error that is the label's is the label's to fix, not the model's.

    PROMOS=show python scripts/breakwatch/edges.py <parity.csv> <exams.json> [--top=20] [--on=0.80] [--off=0.55] [--json=out.json]

Left out, as train2.py leaves them out: neutral time, marked stretches over 8 minutes. Not left out here: the three minutes after
a restart and the inset rule, so the totals stand a little off train2's own row."""
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
ON, OFF, TOP = float(opt("--on", "0.80")), float(opt("--off", "0.55")), int(opt("--top", "20"))
G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")


def sec(h): x, y, z = h.split(":"); return int(x) * 3600 + int(y) * 60 + int(z)
def hms(v): v = int(v); return f"{v // 3600:02d}:{v // 60 % 60:02d}:{v % 60:02d}"
def spans(t, ss):
    m = np.zeros(len(t), bool)
    for a, b in ss: m |= (t >= sec(a)) & (t <= sec(b))
    return m
def policy(p, on, off, hold=2):
    out = np.zeros(len(p), bool); up = False; run = 0
    for i, v in enumerate(p):
        run = run + 1 if v > on else 0
        if not up and run >= hold: up = True
        elif up and v < off: up = False
        out[i] = up
    return out


def channels(day, win, t):
    """The channel each row was on: the kept recording's edge lines name it about once a minute and at every change."""
    ev = os.path.join(G, day, win, "events.log"); marks = []
    if os.path.exists(ev):
        for line in io.open(ev, encoding="utf-8", errors="replace"):
            m = re.match(r"(\d{9}) \S+ edge \d (.+)", line.strip())
            if m: marks.append((int(m.group(1)[:2]) * 3600 + int(m.group(1)[2:4]) * 60 + int(m.group(1)[4:6]), m.group(2).strip()))
    marks.sort()
    if not marks: return np.array(["?"] * len(t), dtype=object)
    ts = np.array([x for x, _ in marks]); i = np.searchsorted(ts, t, side="right") - 1
    return np.array([marks[max(0, k)][1] for k in i], dtype=object)


want = {}
exams = json.load(io.open(pos[1], encoding="utf-8"))
for e in exams: want.setdefault(e["day"] + "|" + e["window"], []).append(e)
rows = {k: [] for k in want}
with io.open(pos[0], newline="", encoding="utf-8") as f:
    rd = csv.reader(f); next(rd)
    for w, t, p in rd:
        if w in rows: rows[w].append((float(t), float(p)))

kinds = ["start", "gap", "never", "lead", "linger", "inside", "alone"]
by = {}; tot = {k: 0.0 for k in kinds}; onpromo = {k: 0.0 for k in kinds}; ad_s = show_s = 0.0; items = []; breaks = []; policy_start = 0.0
for key, ex in sorted(want.items()):
    day, win = key.split("|", 1)
    a = np.array(sorted(rows[key]));
    if not len(a): print("no rows for", key); continue
    t, p = a[:, 0], a[:, 1]; cv = policy(p, ON, OFF)
    lab = json.load(io.open(os.path.join(G, day, "labels.json"), encoding="utf-8"))["windows"][win]
    ads = promos.ads_for(os.path.join(G, day), win, lab["ads"]) if promos.on() else lab["ads"]
    info = [(x, y) for x, y in ads if sec(y) - sec(x) > 480]
    keep = spans(t, lab.get("reviewed", [])) & ~spans(t, lab.get("neutral", [])) & ~spans(t, info)
    keep &= ~spans(t, promos.between(os.path.join(G, day), win, lab["ads"]))   # PROMOBETWEEN: a short promo between two ads is neither
    y = spans(t, ads)
    pm = spans(t, promos.load(os.path.join(G, day)).get(win, [])) if promos.on() else np.zeros(len(t), bool)   # a network promo: show time by the rule, harmless under a cover
    em = np.zeros(len(t), bool)
    for e in ex: em |= (t >= sec(e["from"])) & (t < sec(e["to"]))
    use = em & keep
    dt = np.minimum(np.diff(t, append=t[-1] + 1), 3.0)   # a row stands for the time to the next one (3 s at most: a hole in the recording is no error)
    ad_s += dt[use & y].sum(); show_s += dt[use & ~y].sum()
    ch = channels(day, win, t)
    for c in set(ch[use]):
        m = use & (ch == c); r = by.setdefault(c, dict(ad=0.0, show=0.0, miss=0.0, wrong=0.0, prog=0.0, late=0.0, breaks=0))
        r["ad"] += dt[m & y].sum(); r["show"] += dt[m & ~y].sum(); r["miss"] += dt[m & y & ~cv].sum()
        r["wrong"] += dt[m & ~y & cv].sum(); r["prog"] += dt[m & ~y & cv & ~pm].sum()
    brk = [(sec(x), sec(z)) for x, z in ads if sec(z) - sec(x) <= 480 and (em & (t >= sec(x)) & (t <= sec(z))).sum() >= 5]
    owner = np.full(len(t), -1)   # which break a wrong second belongs to: the cover run it sits in touches that break
    # cover runs
    idx = np.flatnonzero(cv); runs = []
    if len(idx):
        s0 = idx[0]; prev = idx[0]
        for i in idx[1:]:
            if i != prev + 1: runs.append((s0, prev)); s0 = i
            prev = i
        runs.append((s0, prev))
    for bi, (b0, b1) in enumerate(brk):
        inb = use & (t >= b0) & (t <= b1)
        if not inb.any(): continue
        hit = np.flatnonzero(inb & cv)
        name = f"{day[5:]} {win[-6:]} {str(ch[np.flatnonzero(inb)[0]])[:18]:<18}"
        if not len(hit):
            m = dt[inb & y].sum(); tot["never"] += m; items.append((m, "never", name, b0, b1, b0, b1)); breaks.append((name, b0, b1, None, None, 0)); continue
        first = t[hit[0]]; last = t[hit[-1]]
        st = dt[inb & y & ~cv & (t < first)].sum(); gp = dt[inb & y & ~cv & (t > first)].sum()
        tot["start"] += st; tot["gap"] += gp
        # the policy's share of a late start: seconds with the chance already over the threshold
        policy_start += dt[inb & y & ~cv & (t < first) & (p > ON)].sum()
        if st >= 1: items.append((st, "start", name, b0, b1, b0, first))
        if gp >= 1: items.append((gp, "gap", name, b0, b1, first, b1))
        breaks.append((name, b0, b1, first - b0, None, gp))
        cb = ch[np.flatnonzero(inb)[0]]; by[cb]["breaks"] += 1; by[cb]["late"] += st
    # wrong seconds, by the run they sit in
    for r0, r1 in runs:
        seg = np.zeros(len(t), bool); seg[r0:r1 + 1] = True
        wrong = seg & use & ~y
        if not wrong.any(): continue
        t0, t1 = t[r0], t[r1]
        touch = [(b0, b1) for b0, b1 in brk if b0 <= t1 + 2 and b1 >= t0 - 2]
        name = f"{day[5:]} {win[-6:]} {str(ch[r0])[:18]:<18}"
        if not touch:
            m = dt[wrong].sum(); tot["alone"] += m; onpromo["alone"] += dt[wrong & pm].sum(); items.append((m, "alone", name, t0, t1, t0, t1)); continue
        b0 = min(x for x, _ in touch); b1 = max(z for _, z in touch)
        ld = dt[wrong & (t < b0)].sum(); lg = dt[wrong & (t > b1)].sum(); mid = dt[wrong & (t >= b0) & (t <= b1)].sum()   # mid: a promo or show between two breaks under one cover
        tot["lead"] += ld; tot["linger"] += lg; tot["inside"] += mid
        onpromo["lead"] += dt[wrong & pm & (t < b0)].sum(); onpromo["linger"] += dt[wrong & pm & (t > b1)].sum(); onpromo["inside"] += dt[wrong & pm & (t >= b0) & (t <= b1)].sum()
        if ld >= 1: items.append((ld, "lead", name, b0, b1, t0, b0))
        if lg >= 1: items.append((lg, "linger", name, b0, b1, b1, t1))
        if mid >= 1: items.append((mid, "inside", name, b0, b1, b0, b1))

miss = tot["start"] + tot["gap"] + tot["never"]; wrong = tot["lead"] + tot["linger"] + tot["inside"] + tot["alone"]
print(f"{len(exams)} exams, {len(breaks)} breaks; ad time {ad_s:.0f} s, show time {show_s:.0f} s; cover above {ON} twice running, ends below {OFF}")
print(f"ads covered {100 * (1 - miss / ad_s):.1f}%   show wrongly covered {100 * wrong / show_s:.2f}% ({wrong:.0f} s)")
print()
print("MISSED AD TIME                 seconds   share of missed   points of ad time")
for k, label in (("start", "late start"), ("gap", "dropped inside a break"), ("never", "break never covered")):
    print(f"  {label:<28} {tot[k]:7.0f}   {100 * tot[k] / max(miss, 1):6.1f}%          {100 * tot[k] / ad_s:5.2f}")
print(f"  of the late starts, the policy's own second (chance already over {ON}): {policy_start:.0f} s")
print()
print("WRONG SHOW TIME                seconds   share of wrong    points of show time   of it over a promo")
for k, label in (("lead", "up before the break"), ("linger", "still up after the break"), ("inside", "promo or show inside a break"), ("alone", "in the show, no break near")):
    print(f"  {label:<28} {tot[k]:7.0f}   {100 * tot[k] / max(wrong, 1):6.1f}%          {100 * tot[k] / show_s:5.2f}                 {onpromo[k]:5.0f} s")
allp = sum(onpromo.values())
print(f"  over the programme itself: {wrong - allp:.0f} s = {100 * (wrong - allp) / show_s:.2f}% of show time; over promos: {allp:.0f} s")
print()
for k in kinds:
    v = sorted((x[0] for x in items if x[1] == k), reverse=True)
    if not v: continue
    c = np.cumsum(v); half = int(np.searchsorted(c, c[-1] / 2)) + 1
    print(f"  {k:<7} {len(v):4d} cases, median {np.median(v):5.1f} s, largest {v[0]:5.0f} s; the {half} largest hold half of its {c[-1]:.0f} s")
print()
print("BY CHANNEL (most error time first; wrong = over the programme, promos left out)")
print("  channel                    breaks   ad s  missed s   covered   show s  wrong s   wrong   share of all missed / wrong")
allm = sum(r["miss"] for r in by.values()); allw = sum(r["prog"] for r in by.values())
for c, r in sorted(by.items(), key=lambda x: -(x[1]["miss"] + x[1]["prog"])):
    if r["ad"] + r["show"] < 60: continue
    print(f"  {str(c)[:26]:<26} {r['breaks']:5d} {r['ad']:6.0f} {r['miss']:8.0f}   {100 * (1 - r['miss'] / max(r['ad'], 1)):6.1f}%  {r['show']:7.0f} {r['prog']:7.0f}  {100 * r['prog'] / max(r['show'], 1):5.2f}%   {100 * r['miss'] / max(allm, 1):5.1f}% / {100 * r['prog'] / max(allw, 1):5.1f}%")
print()
print(f"THE {TOP} LARGEST")
items.sort(key=lambda x: -x[0])
for m, k, name, b0, b1, x0, x1 in items[:TOP]:
    print(f"  {m:5.0f} s  {k:<7} {name}  break {hms(b0)}-{hms(b1)}  error {hms(x0)}-{hms(x1)}")
out = opt("--json", "")
if out:
    f = io.open(out, "w", encoding="utf-8")
    f.write(json.dumps({"totals": tot, "ad_s": ad_s, "show_s": show_s, "policy_start": policy_start, "items": [dict(s=m, kind=k, where=name, brk=[hms(b0), hms(b1)], err=[hms(x0), hms(x1)]) for m, k, name, b0, b1, x0, x1 in items]}, indent=1))
    f.close()
