"""What a delay buys the break watch (2026-11-06, roadmap: a delay for the big screen): the exams' covers as a watch that sees N seconds
ahead of the viewer would place them, scored against the marks.

    python scripts/breakwatch/lookahead.py <calls folder> <chance folder> [N ...]

<calls folder> holds each exam's cover calls (run_exams.py --keep-calls, copied out), <chance folder> its learned chance per look
(run_exams.py LPARITYDIR=<folder>). Every cover the watch made live is kept, and with N seconds in hand it is moved: its start back to where
the chance first stood above 0.5 without a break, its end back to where the chance last fell below the lift threshold for good, neither
by more than N s; a cover shorter than 15 s is dropped when N is at least 15 (no commercial runs that short, and the watch would know).
An estimate: the watch's own reading of the seconds ahead is the live one; the delay changes only what the viewer is shown, and when.
Scored with exam.py as run_exams.py does (PROMOS=show in the environment counts promos as show).
"""
import csv, json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
calls_dir, par_dir = sys.argv[1], sys.argv[2]
NS = [int(x) for x in sys.argv[3:]] or [0, 5, 10, 20, 30]
OFF = float(os.environ.get("LOOKOFF", "0.45")); RISE = float(os.environ.get("LOOKRISE", "0.5"))
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


def ahead(cs, ps, N):
    res = {}
    for w, lst in cs.items():
        p = ps.get(w, [])
        def at(t0, t1): return [(t, q) for t, q in p if t0 <= t <= t1]
        out = []
        for s, e in lst:
            if N >= 15 and e - s < 15: continue
            s2 = s
            for t, q in reversed(at(s - N, s)):
                if q > RISE: s2 = t
                else: break
            e2 = e
            for t, q in reversed(at(e - N, e)):
                if q < OFF: e2 = t
                else: break
            if e2 > s2: out.append([s2, e2])
        res[w] = out
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
        write(ahead(covers(os.path.join(calls_dir, name(e) + ".calls.log")), chances(os.path.join(par_dir, name(e) + ".csv")), N), dst)
        return dst
    score("look-ahead %d s" % N, path_for)
