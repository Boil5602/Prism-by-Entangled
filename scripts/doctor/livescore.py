"""The live score and the closing promos (2026-11-05), for the doctor's night run and the attention page.

Live score: what Prism actually covered on a sampled day (golden/<day>/calls.log, the live model's covers as the host logged them) against
the doctor's automatic labels for that day (labels.auto.json): of the covered seconds inside labelled spans, how many were commercial,
promo, show or unsure, and how much of the labelled commercial time was covered. A model change that makes things worse shows up the next
morning. It is a cover's precision more than a full score: the labels only reach the spans a model covered, so a break no model covered is
never labelled and never counted missed.

Closing promos: the promos that end a break, just before the show returns (35% of 503 hand-marked breaks end on one, a median 14 s). The
promo-aware model's covers stay on through them; they are the examples the next retraining needs most, counted apart.

A promo here is one of the promo pass's spans less what its recheck called streaming or commercial (labels.promos-recheck.json): a streaming
service's advertising is covered like a commercial (2026-11-05).

    python scripts/doctor/livescore.py [--days 7] [--out scripts/doctor/out/livescore.json]
"""
import json
import os
import re
import sys
from datetime import date, timedelta

G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
args = sys.argv[1:]


def opt(name, default):
    return args[args.index(name) + 1] if name in args else default


def sec(t):
    h, m, s = t.split(":")[:3]
    return int(h) * 3600 + int(m) * 60 + int(float(s))


def secs(spans):
    out = set()
    for a, b in spans:
        out.update(range(sec(a), sec(b)))
    return out


def load(path):
    try:
        return json.load(open(path, encoding="utf-8")).get("windows", {})
    except (OSError, ValueError):
        return {}


def promos_of(day_dir, win, files):
    """The promo seconds of a window: every promo span named in files, less the recheck's streaming and commercial."""
    p = set()
    for f in files:
        p |= secs(load(os.path.join(day_dir, f)).get(win, {}).get("promos", []))
    p -= secs(load(os.path.join(day_dir, "labels.promos-recheck.json")).get(win, {}).get("ads", []))
    return p


def closing(ads_spans, promo):
    """Promo runs that end a break (within 4 s of its end): count and seconds."""
    n = s = 0
    for a, b in ads_spans:
        a, b = sec(a), sec(b)
        if not any(x in promo for x in range(max(a, b - 4), b)):
            continue
        k = b - 1
        while k >= a and (k in promo or k >= b - 4):
            k -= 1
        run = sum(1 for x in range(k + 1, b) if x in promo)
        if run >= 4:
            n += 1; s += run
    return n, s


def live(day):
    d = os.path.join(G, day)
    lab = load(os.path.join(d, "labels.auto.json"))
    calls = os.path.join(d, "calls.log")
    if not lab or not os.path.exists(calls):
        return None
    cov = {}
    for line in open(calls, encoding="utf-8", errors="replace"):
        m = re.match(r"(\d\d:\d\d:\d\d)\.\d+ break watch (\S+): (break|show) \(", line)
        if m:
            cov.setdefault(m.group(2), []).append((sec(m.group(1)), m.group(3) == "break"))
    tot = dict(commercial=0, promo=0, show=0, unsure=0, unlabelled=0)
    com_all = com_cov = 0; promo_s = 0; close_n = close_s = 0
    for w, L in lab.items():
        rev = secs(L.get("reviewed", [])); ads = secs(L.get("ads", [])); neu = secs(L.get("neutral", []))
        pro = promos_of(d, w, ["labels.auto.json"]) & ads
        com = ads - pro
        promo_s += len(pro & rev)
        n, s = closing(L.get("ads", []), pro); close_n += n; close_s += s
        covered = set(); on = None
        for t, b in sorted(cov.get(w, [])):
            if b and on is None: on = t
            elif not b and on is not None: covered.update(range(on, t)); on = None
        for x in covered:
            if x not in rev: tot["unlabelled"] += 1
            elif x in pro: tot["promo"] += 1
            elif x in com: tot["commercial"] += 1
            elif x in neu: tot["unsure"] += 1
            else: tot["show"] += 1
        com_all += len(com & rev); com_cov += len(com & rev & covered)
    n = sum(v for k, v in tot.items() if k != "unlabelled")
    if not n and not com_all:
        return None
    pct = lambda v: round(100 * v / max(1, n), 1)
    return dict(covered=n, commercial=pct(tot["commercial"]), promo=pct(tot["promo"]), show=pct(tot["show"]), unsure=pct(tot["unsure"]),
                unlabelled=tot["unlabelled"], commercial_covered=round(100 * com_cov / max(1, com_all), 1), commercial_s=com_all,
                promo_s=promo_s, closing=close_n, closing_s=close_s)


def hand(day):
    """A hand-marked day's closing promos (labels.json breaks, labels.promos.json promos)."""
    d = os.path.join(G, day)
    lab = load(os.path.join(d, "labels.json"))
    if not lab or not os.path.exists(os.path.join(d, "labels.promos.json")):
        return None
    n = s = p = 0
    for w, L in lab.items():
        pro = promos_of(d, w, ["labels.promos.json"]) & secs(L.get("ads", []))
        a, b = closing(L.get("ads", []), pro); n += a; s += b; p += len(pro)
    return dict(promo_s=p, closing=n, closing_s=s)


ndays = int(opt("--days", "7"))
today = date.today()
out = dict(at=today.isoformat(), live={}, hand={})
for k in range(ndays):
    day = (today - timedelta(days=k)).isoformat()
    r = live(day)
    if r: out["live"][day] = r
for day in sorted(x for x in os.listdir(G) if x[:2] == "20"):
    h = hand(day)
    if h: out["hand"][day] = h
path = opt("--out", os.path.join(ROOT, "scripts", "doctor", "out", "livescore.json"))
json.dump(out, open(path, "w", encoding="utf-8"), indent=1)
for day, r in sorted(out["live"].items()):
    print("%s live: covered %d s labelled: commercial %.1f%%, promo %.1f%%, show %.1f%%, unsure %.1f%% | commercial covered %.1f%% of %d s | %d closing promos (%d s)" % (
        day, r["covered"], r["commercial"], r["promo"], r["show"], r["unsure"], r["commercial_covered"], r["commercial_s"], r["closing"], r["closing_s"]))
for day, h in sorted(out["hand"].items()):
    print("%s hand-marked: %d closing promos (%d s) of %d promo s" % (day, h["closing"], h["closing_s"], h["promo_s"]))
