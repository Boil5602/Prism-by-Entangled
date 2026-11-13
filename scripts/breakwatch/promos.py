"""Network promos as show time (2026-11-04: the owner chose to stop covering the networks' own promos). With PROMOS=show, a window's marked
breaks lose the promo spans that scripts/doctor/promos.mjs found in them (golden/<day>/labels.promos.json), so training and every score count
a promo second as show; without it, nothing changes. PROMOSFILE names the file outright (rates.py, whose labels are not in a day folder)."""
import json
import os


def _sec(t):
    h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + int(s)


def _hms(v):
    return f"{v // 3600:02d}:{v // 60 % 60:02d}:{v % 60:02d}"


def on():
    """PROMOS=show cuts the promos out of the marked breaks (they score as show); PROMOS=neutral cuts them out too and exam.py then leaves
    their seconds out of the score altogether (2026-11-08: a cover over a promo is harmless unless it runs into the programme, which is
    still counted). Training reads on() alone, so it treats promos as show either way."""
    return os.environ.get("PROMOS") in ("show", "neutral")


def neutral():
    return os.environ.get("PROMOS") == "neutral"


def _less_recheck(day_dir, out):
    """The promo time sorted again (promos.mjs --recheck-promos, 2026-11-05): what is now a streaming service's advertising, or a
    commercial, is no promo and stays an ad."""
    where = os.path.dirname(os.environ["PROMOSFILE"]) if os.environ.get("PROMOSFILE") else day_dir   # rates.py names the day by its file
    p = os.path.join(where, "labels.promos-recheck.json") if where else None
    if os.environ.get("RECHECK") == "off" or not p or not os.path.exists(p):
        return out
    rc = json.load(open(p, encoding="utf-8")).get("windows", {})
    return {k: cut(v, rc.get(k, {}).get("ads", [])) for k, v in out.items()}


def load(day_dir=None):
    """windows -> [[from, to] ...] of promos, or {} when PROMOS is not "show" or none were found."""
    if not on():
        return {}
    p = os.environ.get("PROMOSFILE") or (os.path.join(day_dir, "labels.promos.json") if day_dir else None)
    if not p or not os.path.exists(p):
        p = None
    if p is None:
        a = os.path.join(day_dir, "labels.auto.json") if day_dir else None
        if not a or not os.path.exists(a): return {}
        return _less_recheck(day_dir, {k: list(v.get("promos", [])) for k, v in json.load(open(a, encoding="utf-8")).get("windows", {}).items()})
    w = json.load(open(p, encoding="utf-8")).get("windows", {})
    out = {k: list(v.get("promos", [])) for k, v in w.items()}
    a = os.path.join(day_dir, "labels.auto.json") if day_dir and not os.environ.get("PROMOSFILE") else None
    if a and os.path.exists(a):   # a sampled night's promos too
        for k, v in json.load(open(a, encoding="utf-8")).get("windows", {}).items(): out.setdefault(k, []).extend(v.get("promos", []))
    return _less_recheck(day_dir, out)


def cut(ads, promos):
    """The marked breaks with the promo spans taken out: a break split around a promo becomes two."""
    if not promos:
        return ads
    ps = sorted((_sec(a), _sec(b)) for a, b in promos)
    out = []
    for a, b in ads:
        segs = [(_sec(a), _sec(b))]
        for pa, pb in ps:
            nxt = []
            for x, y in segs:
                if pb <= x or pa >= y:
                    nxt.append((x, y)); continue
                if x < pa: nxt.append((x, pa))
                if pb < y: nxt.append((pb, y))
            segs = nxt
        out += [[_hms(x), _hms(y)] for x, y in segs if y > x]
    return out


def ads_for(day_dir, win, ads):
    return cut(ads, load(day_dir).get(win, []))


def windows_with_auto(day_dir, windows):
    """A day's marked windows with a sampled night's automatic marks added (labels.auto.json, promos.mjs --auto, 2026-11-04): its reviewed
    spans, breaks and neutral time appended to the window's own, never over time the person or an earlier pass already reviewed."""
    p = os.path.join(day_dir, "labels.auto.json")
    if not os.path.exists(p):
        return windows
    out = {k: dict(v) for k, v in windows.items()}
    for w, a in json.load(open(p, encoding="utf-8")).get("windows", {}).items():
        lab = out.setdefault(w, {"name": w, "ads": [], "reviewed": [], "neutral": []})
        have = [(_sec(x), _sec(y)) for x, y in lab.get("reviewed", [])]
        new = [r for r in a.get("reviewed", []) if not any(_sec(r[0]) < y and _sec(r[1]) > x for x, y in have)]
        inside = lambda s: any(_sec(r[0]) <= _sec(s[0]) and _sec(s[1]) <= _sec(r[1]) for r in new)
        lab["reviewed"] = list(lab.get("reviewed", [])) + new
        lab["ads"] = list(lab.get("ads", [])) + [s for s in a.get("ads", []) if inside(s)]
        lab["neutral"] = list(lab.get("neutral", [])) + [s for s in a.get("neutral", []) if inside(s)]
    return out
