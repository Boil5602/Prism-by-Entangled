"""The recording's sidecars against a labelled evening (2026-11-08, the redesign's Phase D evaluation).

    python -I scripts/breakwatch/sidecar-eval.py <golden day> <window> <from HH:MM:SS> <to HH:MM:SS> <out.json>

Reads the day's labels.json (the window's ad spans inside the stretch; PROMOSFILE's promo spans count as show as everywhere else),
the sound sidecar's splice.log (silence runs of 150 ms or more, the host's 20 Hz RMS detector; the day's audio folder, then the live
bench/_audio for the open hour) and the screen window's palette events (a 4x4x4 RGB histogram a frame in events.log). It asks, of each
labelled break edge (a start or an end), whether a silence run falls within +-3 s of it (recall) and, of each silence run, whether it
falls within +-3 s of an edge (precision); the same for a palette jump (the L1 distance between a frame's histogram and the one before,
over a sweep of thresholds); and for both together (a silence and a jump within 2 s of each other). Nothing here reads a frame or
alters one; the figures are honest (the labels were not seen by anything that produced the sidecars)."""
import io, json, os, sys
from collections import defaultdict

G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics")
TOL = 3.0


def secs(hms):
    h, m, s = hms.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)


def frame_secs(name):
    return int(name[:2]) * 3600 + int(name[2:4]) * 60 + int(name[4:6]) + int(name[6:9]) / 1000


def spans(day, window, t0, t1):
    p = os.path.join(G, "golden", day, "labels.json")
    w = json.load(io.open(p, encoding="utf-8"))["windows"].get(window, {})
    ads = [(secs(a), secs(b)) for a, b in w.get("ads", [])]
    ads = [(a, b) for a, b in ads if b > t0 and a < t1]
    promos = []
    pf = os.environ.get("PROMOSFILE") or os.path.join(G, "golden", day, "labels.promos.json")
    if os.path.exists(pf):
        try:
            pw = json.load(io.open(pf, encoding="utf-8")).get("windows", {}).get(window, {})
            promos = [(secs(a), secs(b)) for a, b in pw.get("promos", pw.get("ads", []))]
        except Exception:
            promos = []
    # a promo span counts as show: cut it out of the ads
    out = []
    for a, b in ads:
        cuts = [(max(a, pa), min(b, pb)) for pa, pb in promos if pb > a and pa < b]
        cur = a
        for ca, cb in sorted(cuts):
            if ca > cur: out.append((cur, ca))
            cur = max(cur, cb)
        if cur < b: out.append((cur, b))
    return sorted(out), [(a, b) for a, b in ads]


def silences(day, t0, t1):
    runs = []
    for p in (os.path.join(G, "golden", day, "audio", "splice.log"), os.path.join(G, "bench", "_audio", "splice.log")):
        if not os.path.exists(p): continue
        for line in io.open(p, encoding="utf-8", errors="replace"):
            sp = line.split()
            if len(sp) < 4 or sp[1] != "silence": continue
            end = secs(sp[0]); ms = int(sp[3]); start = end - ms / 1000
            if start < t0 or start > t1 or ms > 5000: continue   # a run over 5 s is a mute or a gap, not a splice
            runs.append((start, ms))
    runs.sort()
    # the live file repeats the day folder's lines once keep.py has carried them: one run per start
    out = []
    for r in runs:
        if not out or abs(out[-1][0] - r[0]) > 0.05: out.append(r)
    return out


def palette_jumps(day, window, t0, t1):
    p = os.path.join(G, "golden", day, window, "events.log")
    if not os.path.exists(p): return []
    prev = None; jumps = []
    for line in io.open(p, encoding="utf-8", errors="replace"):
        sp = line.split()
        if len(sp) < 4 or sp[2] != "palette" or sp[3] == "[redacted]": continue
        t = frame_secs(sp[0])
        if t < t0 - 2 or t > t1 + 2: prev = None; continue
        h = bytes.fromhex(sp[3])
        if len(h) != 64: continue
        if prev is not None and t - prev[0] < 3:
            d = sum(abs(a - b) for a, b in zip(h, prev[1])) / max(1, sum(h) + sum(prev[1]))
            jumps.append((t, d))
        prev = (t, h)
    return jumps


def near(t, edges, tol=TOL):
    return any(abs(t - e) <= tol for e in edges)


def score(events, edges):
    """events: times; edges: times. recall = edges with an event within TOL; precision = events within TOL of an edge."""
    hit_e = sum(1 for e in edges if near(e, events)); hit_v = sum(1 for v in events if near(v, edges))
    return dict(events=len(events), edges=len(edges), recall=round(hit_e / max(1, len(edges)), 3), precision=round(hit_v / max(1, len(events)), 3),
                events_per_hour=round(len(events) / max(1e-9, HOURS), 1), false_per_hour=round((len(events) - hit_v) / max(1e-9, HOURS), 1))


if __name__ == "__main__":
    day, window, t0s, t1s, out = sys.argv[1:6]
    t0, t1 = secs(t0s), secs(t1s); HOURS = (t1 - t0) / 3600
    ads, ads_raw = spans(day, window, t0, t1)
    starts = [a for a, b in ads]; ends = [b for a, b in ads]; edges = starts + ends
    sil = silences(day, t0, t1); sil_t = [s for s, ms in sil]
    jumps = palette_jumps(day, window, t0, t1)
    rep = dict(day=day, window=window, stretch=[t0s, t1s], hours=round(HOURS, 2), breaks=len(ads), breaks_before_promo_cut=len(ads_raw),
               tolerance_s=TOL, silence=dict(all=score(sil_t, edges), starts=score(sil_t, starts), ends=score(sil_t, ends),
                                              by_length={}), palette={}, both={})
    for lo, hi in ((150, 300), (300, 600), (600, 1500), (1500, 5000)):
        ts = [s for s, ms in sil if lo <= ms < hi]
        rep["silence"]["by_length"][f"{lo}-{hi} ms"] = score(ts, edges)
    for thr in (0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5):
        js = [t for t, d in jumps if d >= thr]
        rep["palette"][f"jump>={thr}"] = score(js, edges)
        both = [t for t in js if near(t, sil_t, 2.0)]
        rep["both"][f"jump>={thr}+silence"] = score(both, edges)
    # a splice-like reading: a silence of 150 to 1500 ms with a jump within 2 s (the host has no 10 Hz black run yet)
    sp = [s for s, ms in sil if ms < 1500 and near(s, [t for t, d in jumps if d >= 0.2], 2.0)]
    rep["splice_like"] = score(sp, edges)
    json.dump(rep, io.open(out, "w", encoding="utf-8"), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k in ("breaks", "hours")}),
          "| silence", rep["silence"]["all"], "| jump>=0.2", rep["palette"]["jump>=0.2"], "| splice-like", rep["splice_like"])
