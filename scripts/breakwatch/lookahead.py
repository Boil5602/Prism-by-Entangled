"""What a delay buys the break watch (2026-11-06, roadmap: a delay for the big screen): the exams' covers as a watch that sees N seconds
ahead of the viewer would place them, scored against the marks.

    python scripts/breakwatch/lookahead.py <calls folder> <chance folder> [N ...]

<calls folder> holds each exam's cover calls (run_exams.py --keep-calls, copied out), <chance folder> its learned chance per look
(run_exams.py LPARITYDIR=<folder>). Every cover the watch made live is kept, and with N seconds in hand it is moved: its start back to where
the chance first stood above 0.5 without a break, its end back to where the chance last fell below the lift threshold for good, neither
by more than N s; a cover shorter than 15 s comes down as soon as the watch has lifted it, N s before that reaches the viewer (no
commercial runs that short): the same rule as the app's LookAheadPlan (targets/win-host/PrismHost.Core, docs/features/look-ahead.md).
An estimate: the watch's own reading of the seconds ahead is the live one; the delay changes only what the viewer is shown, and when.
Scored with exam.py as run_exams.py does (PROMOS=show in the environment counts promos as show).
"""
import csv, json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
calls_dir, par_dir = sys.argv[1], sys.argv[2]
NS = [int(x) for x in sys.argv[3:]] or [0, 5, 10, 20, 30]
OFF = float(os.environ.get("LOOKOFF", "0.45")); RISE = float(os.environ.get("LOOKRISE", "0.5"))
# LOOKEND=1 also moves a cover's end back to where the chance fell (measured 2026-11-17 and left out of the app: nothing gained); LOOKSHORT=0 keeps the covers the watch lifted again within 15 s
ENDBACK = os.environ.get("LOOKEND", "0") != "0"; SHORT = os.environ.get("LOOKSHORT", "1") != "0"
# The end finder (2026-11-17, roadmap: the look-ahead's end finder). LOOKFEAT=<folder of run_exams.py FEATDIR files> and
# LOOKFIND=<readings, in order of trust> e.g. "black,silence": when the watch lifts a cover, the seconds just before are searched for
# the earliest black frame (then silence ...) no more than LOOKFINDW s back (and never more than N), and the cover ends there plus
# LOOKFINDPAD s. LOOKSHIFT=<s> instead ends every cover that many seconds sooner (the plain comparison).
FEAT = os.environ.get("LOOKFEAT"); FIND = [k for k in os.environ.get("LOOKFIND", "").split(",") if k]
FINDW = float(os.environ.get("LOOKFINDW", "10")); FINDPAD = float(os.environ.get("LOOKFINDPAD", "0")); SHIFT = float(os.environ.get("LOOKSHIFT", "0"))
QDIR = os.environ.get("LOOKQ"); QMIN = float(os.environ.get("LOOKQMIN", "0.6"))
DIP = float(os.environ.get("LOOKDIP", "0.45"))
FINDWHICH = os.environ.get("LOOKFINDWHICH", "earliest")


def events(path):
    out = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            t = float(r["t"]); d = out.setdefault(r["win"], {})
            for k in FIND:
                if k in ("dip", "model"): continue
                v = float(r["since_" + k])
                if v < 100:   # the readings stop counting at 120 s: such a value is no event
                    lst = d.setdefault(k, [])
                    if not lst or abs(lst[-1] - (t - v)) > 0.6: lst.append(t - v)
    return out


LINE = re.compile(r"^(\d\d):(\d\d):(\d\d(?:\.\d+)?) break watch (\S+): (break|show)\b")
exams = json.load(open(os.path.join(HERE, "exams.json"), encoding="utf-8"))


def name(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])
def secs(h, m, s): return int(h) * 3600 + int(m) * 60 + float(s)
def clock(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def covers(path):
    out, open_at = {}, {}
    for raw in open(path, encoding="utf-8", errors="replace"):
        x = LINE.match(raw)
        if not x: continue
        t, w, k = secs(x.group(1), x.group(2), x.group(3)), x.group(4), x.group(5)
        if k == "break" and w not in open_at: open_at[w] = t
        elif k == "show" and w in open_at: out.setdefault(w, []).append([open_at.pop(w), t])
    for w, t0 in open_at.items(): out.setdefault(w, []).append([t0, t0 + 3600])
    return out


def chances(path):
    out = {}
    with open(path, newline="") as f:
        for row in csv.reader(f):
            try: out.setdefault(row[0], []).append((float(row[1]), float(row[2])))
            except (ValueError, IndexError): continue
    return {w: sorted(v) for w, v in out.items()}


def ahead(cs, ps, N, ev=None, qs=None):
    res = {}
    for w, lst in cs.items():
        evw = (ev or {}).get(w, {})
        p = ps.get(w, [])
        def at(t0, t1): return [(t, q) for t, q in p if t0 <= t <= t1]
        out = []
        for s, e in lst:
            short = e - s < 15
            s2 = s
            for t, q in reversed(at(s - N, s)):
                if q > RISE: s2 = t
                else: break
            e2 = e
            for t, q in (reversed(at(e - N, e)) if ENDBACK else []):
                if q < OFF: e2 = t
                else: break
            # as the app's LookAheadPlan does (2026-11-17): a cover lifted again within 15 s comes down once that is known, N s before
            # its end reaches the viewer - never shown when N is 15 or more, its first seconds shown when N is less
            if short and SHORT: e2 = min(e2, e - N)
            elif SHIFT: e2 = max(s2, e - min(SHIFT, N))
            elif FIND:
                for k in FIND:
                    # "dip": the first look in those seconds where the chance was already under LOOKDIP (it often falls at the cut
                    # to the show and climbs again for a few seconds before the watch lifts)
                    src = [t for t, q in p if q < DIP and e - 30 <= t <= e] if k == "dip" else evw.get(k, [])
                    if k == "model":
                        # the reading that looks both ways (endfinder.py, LOOKQ=<its q folder>): the earliest look from which
                        # every look up to the lift says the show is back (chance over LOOKQMIN)
                        src = []
                        for t, q in reversed([x for x in (qs or {}).get(w, []) if e - min(FINDW, N) <= x[0] < e]):
                            if q >= QMIN: src.insert(0, t)
                            else: break
                        src = src[:1]
                    c = [x for x in src if e - min(FINDW, N) <= x < e and x > s + 15]
                    if c: e2 = min(e, (c[0] if FINDWHICH == "earliest" else c[-1]) + FINDPAD); break
            if e2 > s2: out.append([s2, e2])
        # a start moved back can reach into the cover before it: the two are one cover (the app's plan answers for a moment, so it
        # joins them by itself; written as calls they must not cross, or the first one's end would lift the second)
        out.sort(); merged = []
        for s2, e2 in out:
            if merged and s2 <= merged[-1][1]: merged[-1][1] = max(merged[-1][1], e2)
            else: merged.append([s2, e2])
        res[w] = merged
    return res


def write(res, path):
    with open(path, "w", encoding="utf-8") as f:
        ev = sorted([(s, w, "break") for w, l in res.items() for s, _ in l] + [(e, w, "show") for w, l in res.items() for _, e in l])
        for t, w, k in ev: f.write(f"{clock(t)} break watch {w}: {k} (look-ahead)\n")


def score(tag, path_for):
    tot = dict(ad=0, cov=0, show=0, wrong=0, late=0, mid=0, early=0, linger=0, ahead=0, own=0)
    for e in exams:
        out = subprocess.run([sys.executable, os.path.join(HERE, "exam.py"), "--trained", os.path.join(HERE, "trained.json"), e["day"], e["window"], e["from"], e["to"], "x=" + path_for(e)],
                             capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
        h = re.search(r"(\d+) ad s, (\d+) show s", out)
        m1 = re.search(r"ads covered\s+([\d.]+)%.*?missed (\d+) s: began late (\d+), dropped mid-break (\d+), lifted early (\d+)", out)
        m2 = re.search(r"\((\d+) s\): stayed on after a break (\d+), came up ahead of one (\d+), on their own (\d+) s", out)
        if not (h and m1 and m2): print(tag, e["name"], "not scored"); continue
        tot["ad"] += int(h.group(1)); tot["cov"] += int(h.group(1)) - int(m1.group(2)); tot["show"] += int(h.group(2)); tot["wrong"] += int(m2.group(1))
        tot["late"] += int(m1.group(3)); tot["mid"] += int(m1.group(4)); tot["early"] += int(m1.group(5))
        tot["linger"] += int(m2.group(2)); tot["ahead"] += int(m2.group(3)); tot["own"] += int(m2.group(4))
    print(f"{tag}: ads covered {100 * tot['cov'] / tot['ad']:.1f}% | show wrongly covered {100 * tot['wrong'] / tot['show']:.2f}% | missed: late {tot['late']}, mid {tot['mid']},"
          f" early {tot['early']} | wrong: stayed on {tot['linger']}, ahead {tot['ahead']}, own {tot['own']}", flush=True)


for N in NS:
    outd = os.path.join(calls_dir, "ahead%d" % N); os.makedirs(outd, exist_ok=True)
    def path_for(e, N=N, outd=outd):
        dst = os.path.join(outd, name(e) + ".calls.log")
        write(ahead(covers(os.path.join(calls_dir, name(e) + ".calls.log")), chances(os.path.join(par_dir, name(e) + ".csv")), N,
                    events(os.path.join(FEAT, name(e) + ".csv")) if FEAT and FIND else None,
                    chances(os.path.join(QDIR, name(e) + ".csv")) if QDIR and "model" in FIND else None), dst)
        return dst
    score("look-ahead %d s" % N, path_for)
