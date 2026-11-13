"""Phase 1 of the boundary-first redesign (2026-11-08): policy-level experiments over the bench's per-look stream, offline.

    python scripts/breakwatch/boundary.py <wide parity dir> <exams.json> <model.json> <out dir> [--picw W] [--notext] [--grid quick|full]

The parity dir holds run_exams' LPWIDE=1 files (<exam>.csv: win,t,p,trees,q,since_black,since_cut,minute,up,sure_ad,sure_show). Each
configuration is a cover policy run over those looks, written as a calls log and scored by exam.py (its JSON line), so hundreds of
policies cost minutes instead of a bench pass each. What the offline run leaves out of the bench's joins: the standing ad line's 20 s
hold, paid-programme cards and the strict band mode (BANDSTRICT=0 in every exam anyway); a marked slot (sure_ad) still covers, and a
start every rule calls show (sure_show, the bench's LVETO) is still vetoed. The 'base' configuration is the shipped policy and is
printed against the bench's own results.json for the same run, so the gap of the emulation is known before any sweep is read.

Configurations:
  base                       on/off/hold/agree as the model's policy
  grid:th,N,tol              1a end-grid: the pod start anchored at the last black or hard cut within 20 s before the cover began; at
                             anchor + 15k s (+-tol) the cover ends if the chance dipped below th in any of the last N looks
  refr:R                     1b refractory: no spotted start within R s of a cover's end (marked starts exempt)
  clock:W                    1c clock prior: the global minute-of-hour share of ad time from the OTHER labelled days moves the
                             effective 'on' threshold by W times its log odds against the average (per-channel priors need the
                             channel of every labelled window, which the recordings do not carry: see the decision log)
  hold:H  agree:0|1          the policy's hold and the agreement rule
  hsmm:on,off,alpha          Phase 2's duration-aware two-state filter (break and show durations from the other labelled days,
                             the clock prior scaling the start hazard when +clock is given; no hold, no agreement)
Combinations are written with '+': grid:0.5,2,1+refr:90+clock:1.0+hold:2+agree:0
"""
import csv
import glob
import json
import math
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GOLD = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
args = sys.argv[1:]


def opt(name, default=None):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default


def flag(name):
    if name in args:
        args.remove(name); return True
    return False


PICW = float(opt("--picw", "0.5")); NOTEXT = flag("--notext"); GRID = opt("--grid", "full"); ONLY = opt("--only")
FORCE_AGREE = flag("--agree"); SURE_AD = flag("--sure-ad")
VERIF_DIR = opt("--verif")
par_dir, exams_path, model_path, out_dir = args[:4]
exams = json.load(open(exams_path, encoding="utf-8"))
model = json.load(open(model_path, encoding="utf-8")); POL = model["policy"]
os.makedirs(out_dir, exist_ok=True)
os.environ.setdefault("PROMOS", "show")


def name(e): return re.sub(r"[^A-Za-z0-9]+", "-", e["name"])
def sec(t): h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
def clock(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"
def logit(p): p = min(0.999, max(0.001, p)); return math.log(p / (1 - p))
def sig(x): return 1 / (1 + math.exp(-x))


VERIF = {}
def verif_chances(e):
    """The end verifier's chance a second for an exam: {int second: chance}, empty without --verif."""
    if not VERIF_DIR: return {}
    path = os.path.join(VERIF_DIR, "par", name(e) + ".csv")
    if not os.path.exists(path): path = os.path.join(VERIF_DIR, name(e) + ".csv")
    out = {}
    if os.path.exists(path):
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                try: out[int(float(row["t"]))] = float(row["p"])
                except (KeyError, ValueError): continue
    return out


def looks(e):
    """The exam's looks in time order: dicts with t, trees, q, black, cut, minute, sure_ad, sure_show."""
    out = []
    with open(os.path.join(par_dir, name(e) + ".csv"), newline="") as f:
        for row in csv.DictReader(f):
            try:
                out.append(dict(t=float(row["t"]), p=float(row["p"]), trees=float(row["trees"]), q=float(row["q"]), black=float(row["since_black"]),
                                cut=float(row["since_cut"]), minute=int(float(row["minute"])), sure_ad=row["sure_ad"] == "1", sure_show=row["sure_show"] == "1"))
            except (KeyError, ValueError):
                continue
    out.sort(key=lambda r: r["t"])
    return out


# ---------------------------------------------------------------- the clock prior (1c), from the other labelled days
def clock_prior(leave_day):
    ad, tot = [0.0] * 60, [0.0] * 60
    for d in sorted(glob.glob(os.path.join(GOLD, "2026-*"))):
        day = os.path.basename(d)
        if day == leave_day: continue
        f = os.path.join(d, "labels.json")
        if not os.path.exists(f): continue
        lab = json.load(open(f, encoding="utf-8")).get("windows", {})
        for w in lab.values():
            rev = [(sec(a), sec(b)) for a, b in w.get("reviewed", [])]; ads = [(sec(a), sec(b)) for a, b in w.get("ads", [])]
            for a, b in rev:
                for t in range(int(a), int(b)):
                    m = (t // 60) % 60; tot[m] += 1
                    if any(x <= t < y for x, y in ads): ad[m] += 1
    share = [(ad[(m - 1) % 60] + ad[m] + ad[(m + 1) % 60]) / max(1, tot[(m - 1) % 60] + tot[m] + tot[(m + 1) % 60]) for m in range(60)]
    base = sum(ad) / max(1, sum(tot))
    return share, base


# B3 (the addendum): a refractory R per channel, from the labelled show segments of the OTHER days: R = the 20th percentile of the
# channel's show-segment lengths (a start sooner than that after an end is suspect), within 45 to 240 s, where ten or more segments exist;
# the global R otherwise. The channel of a look comes from channels.json beside the frames.
sys.path.insert(0, HERE)
from channels import channel_at as _channel_at
PCHAN = {}
def pchan_table(leave_day):
    if leave_day in PCHAN: return PCHAN[leave_day]
    segs = {}
    for d in sorted(glob.glob(os.path.join(GOLD, "2026-*"))):
        day = os.path.basename(d)
        if day == leave_day: continue
        f = os.path.join(d, "labels.json")
        if not os.path.exists(f): continue
        for w, v in json.load(open(f, encoding="utf-8")).get("windows", {}).items():
            ads = sorted((sec(a), sec(b)) for a, b in v.get("ads", [])); rev = [(sec(a), sec(b)) for a, b in v.get("reviewed", [])]
            for (a1, b1), (a2, b2) in zip(ads, ads[1:]):
                if any(x <= b1 and a2 <= y for x, y in rev) and 30 <= a2 - b1 <= 1500:
                    cid, nm = _channel_at(day, w, a2); key = cid or nm
                    if key: segs.setdefault(key, []).append(a2 - b1)
    table = {k: float(min(240, max(45, np.percentile(v, 20)))) for k, v in segs.items() if len(v) >= 10}
    PCHAN[leave_day] = table
    return table


PRIORS = {}
def prior_for(day):
    if day not in PRIORS: PRIORS[day] = clock_prior(day)
    return PRIORS[day]


# ---------------------------------------------------------------- Phase 2: the duration-aware two-state filter (a prototype of the C# one)
DMAX_B, DMAX_S = 420, 1500   # the longest break and show segment the filter tracks, s


def duration_priors(leave_day):
    """Hazards by elapsed duration for breaks and show segments, from the OTHER labelled days: h[d] = P(the segment ends at d | it reached d),
    smoothed over +-2 s and floored, so a duration never seen still has a way out."""
    bd, sd = [], []
    for d in sorted(glob.glob(os.path.join(GOLD, "2026-*"))):
        day = os.path.basename(d)
        if day == leave_day: continue
        f = os.path.join(d, "labels.json")
        if not os.path.exists(f): continue
        for w in json.load(open(f, encoding="utf-8")).get("windows", {}).values():
            ads = sorted((sec(a), sec(b)) for a, b in w.get("ads", [])); rev = [(sec(a), sec(b)) for a, b in w.get("reviewed", [])]
            for a, b in ads:
                if 5 <= b - a <= DMAX_B: bd.append(b - a)
            for (a1, b1), (a2, b2) in zip(ads, ads[1:]):
                if any(x <= b1 and a2 <= y for x, y in rev) and 30 <= a2 - b1 <= DMAX_S: sd.append(a2 - b1)
    def hazard(durs, dmax, floor):
        counts = np.zeros(dmax + 2)
        for x in durs: counts[min(dmax, int(round(x)))] += 1
        k = np.ones(5) / 5; counts = np.convolve(counts, k, mode="same")
        surv = counts[::-1].cumsum()[::-1]
        h = np.where(surv > 0, counts / np.maximum(surv, 1e-9), 1.0)
        h = np.clip(h, floor, 1.0); h[dmax] = 1.0
        return h[:dmax + 1]
    return hazard(bd, DMAX_B, 1e-4), hazard(sd, DMAX_S, 1e-5), len(bd), len(sd)


PRIORS_D = {}
def durations_for(day):
    if day not in PRIORS_D: PRIORS_D[day] = duration_priors(day)
    return PRIORS_D[day]


def run_hsmm(series, c, share_base, hazards):
    """An online forward filter over (state, duration so far). Emission: the blended chance as a likelihood ratio p/(1-p), tempered by
    alpha (the looks a second are far from independent). The show-to-break hazard is scaled by the clock prior's odds at the minute when
    c['clock'] > 0. Cover when P(break) > on, uncover when < off. Marked slots still cover; a start every rule calls show is vetoed."""
    hB, hS = hazards[0].copy(), hazards[1]; share, base = share_base
    alpha, on, off = c["alpha"], c["on"], c["off"]
    if c["gridk"] != 1.0:
        d = np.arange(len(hB)); near = np.minimum(d % 15, 15 - d % 15) <= 1
        hB = np.minimum(1.0, np.where(near & (d >= 14), hB * c["gridk"], hB / c["gridk"]))
    pb_prior = 0.05
    B = np.zeros(DMAX_B + 1); S = np.zeros(DMAX_S + 1); S[1] = 1 - pb_prior; B[1] = pb_prior
    up = False; shown = False; calls = []; looks_seen = 0; last_end = -1e9
    for r in series:
        t = r["t"]; looks_seen += 1
        p = sig(logit(r["trees"]) + PICW * logit(r["q"])) if r["q"] >= 0 else r["trees"]
        p = min(0.995, max(0.005, p))
        lr = (p / (1 - p)) ** alpha
        clockf = math.exp(c["clock"] * (logit(share[r["minute"]]) - logit(base))) if c["clock"] else 1.0
        hs = np.minimum(1.0, hS * clockf)
        toB = float((S * hs).sum()); toS = float((B * hB).sum())
        S2 = np.zeros_like(S); S2[2:] = S[1:-1] * (1 - hs[1:-1]); S2[1] = toS
        B2 = np.zeros_like(B); B2[2:] = B[1:-1] * (1 - hB[1:-1]); B2[1] = toB
        B2 *= lr
        z = S2.sum() + B2.sum(); S, B = S2 / z, B2 / z
        pB = float(B.sum())
        if not up and pB > on and looks_seen > 45 and not r["sure_show"] and t - last_end >= c["refr"]: up = True
        elif up and (pB < off or (c["hardoff"] and p < POL["off"])): up = False; last_end = t
        sh = up or (r["sure_ad"] and SURE_AD)
        if sh != shown:
            shown = sh; calls.append((t, "break" if sh else "show"))
            if not sh: last_end = t
    return calls


# ---------------------------------------------------------------- a configuration
def parse(cfg):
    c = dict(on=POL["on"], off=POL["off"], hold=POL["hold"], agree=bool(POL.get("agree")) or FORCE_AGREE, treeMin=POL.get("treeMin", 0.5), netMin=POL.get("netMin", 0.5),
             grid=None, refr=0, soft=0, clock=0.0, hsmm=False, alpha=1.0, gridk=1.0, hardoff=False, cend=0, softon=0.9, hard=0, verif=0.0, pchan=False)
    for part in cfg.split("+"):
        if part == "base": continue
        k, _, v = part.partition(":")
        if k == "hsmm": on, off, alpha = v.split(",")[:3]; c.update(hsmm=True, on=float(on), off=float(off), alpha=float(alpha))
        elif k == "grid": th, n, tol = v.split(","); c["grid"] = (float(th), int(n), float(tol))
        elif k == "refr": c["refr"] = float(v)
        elif k == "soft": c["soft"] = float(v)        # a soft refractory: within v s of an end, a start needs the chance above softon
        elif k == "softon": c["softon"] = float(v)    # the soft refractory's raised threshold (0.9)
        elif k == "cend": c["cend"] = int(v)          # arm the refractory only after an end confirmed by N sure-show looks within 15 s
        elif k == "hard": c["hard"] = float(v)        # a hard refractory after a confirmed end: no spotted start within v s
        elif k == "verif": c["verif"] = float(v)      # the end verifier: end when its chance is above v on two calls 5 s apart
        elif k == "pchan": c["pchan"] = v == "1"      # B3: the soft refractory's R per channel from the other days' labelled spacing
        elif k == "gridk": c["gridk"] = float(v)      # hsmm: the break's end hazard multiplied at 15 s grid points (+-1 s)
        elif k == "hardoff": c["hardoff"] = v == "1"  # hsmm: the policy's off threshold on the raw chance also ends a cover
        elif k == "clock": c["clock"] = float(v)
        elif k == "hold": c["hold"] = int(v)
        elif k == "agree": c["agree"] = v == "1"
        elif k == "on": c["on"] = float(v)
        elif k == "off": c["off"] = float(v)
        else: raise ValueError(part)
    return c


def run_policy(series, c, share_base, vchance=None, exam=None):
    """The cover calls of one window under configuration c: [(t, 'break'|'show')]."""
    share, base = share_base; vchance = vchance or {}; vlast = -1e9; vhits = 0
    ptable = pchan_table(exam["day"]) if (c["pchan"] and exam) else {}
    up = False; run = 0; calls = []; shown = False
    anchor = None; last_end = -1e9; recent = []
    pending_end = None; sure_run = 0; armed_end = -1e9   # a confirmed end (cend): the end waiting for its confirmation, the sure-show looks since
    for r in series:
        t = r["t"]
        p = sig(logit(r["trees"]) + PICW * logit(r["q"])) if r["q"] >= 0 else r["trees"]
        if c["agree"] and not up and (r["trees"] < c["treeMin"] or r["q"] < c["netMin"]): p = 0.0
        on = c["on"]
        if c["clock"]: on = min(0.95, max(0.6, sig(logit(c["on"]) - c["clock"] * (logit(share[r["minute"]]) - logit(base)))))
        if c["cend"]:
            if pending_end is not None:
                sure_run = sure_run + 1 if r["sure_show"] else 0
                if sure_run >= c["cend"]: armed_end = pending_end; pending_end = None
                elif t - pending_end > 15: pending_end = None
            ref_end = armed_end
        else: ref_end = last_end
        soft_r = c["soft"]
        if c["pchan"] and exam and soft_r:
            cid, nm = _channel_at(exam["day"], exam["window"], t); soft_r = ptable.get(cid or nm, soft_r)
        if soft_r and t - ref_end < soft_r: on = max(on, c["softon"])
        blocked = c["hard"] > 0 and t - ref_end < c["hard"]
        run = run + 1 if p > on else 0
        recent.append(p); recent = recent[-8:]
        if not up:
            if run >= c["hold"] and not r["sure_show"] and t - last_end >= c["refr"] and not blocked:
                up = True; vhits = 0; vlast = t
                back = min(r["black"], r["cut"]) if min(r["black"], r["cut"]) <= 20 else 0
                anchor = t - back
        else:
            end = p < c["off"]
            if c["grid"] and not end:
                th, n, tol = c["grid"]; since = t - anchor
                k = round(since / 15)
                if k >= 1 and abs(since - 15 * k) <= tol and min(recent[-n:]) < th: end = True
            if c["verif"] and not end and t - vlast >= 5:
                vlast = t; vp = vchance.get(int(t), vchance.get(int(t) - 1, 0.0))
                vhits = vhits + 1 if vp > c["verif"] else 0
                if vhits >= 2: end = True
            if end: up = False; last_end = t; pending_end = t; sure_run = 0; vhits = 0
        s = up or (r["sure_ad"] and SURE_AD)
        if s != shown:
            shown = s; calls.append((t, "break" if s else "show"))
            if not s: last_end = t
    return calls


def score(cfg, tag):
    c = parse(cfg)
    d = os.path.join(out_dir, "calls", tag); os.makedirs(d, exist_ok=True)
    per, lags_s, lags_e, pops = [], [], [], []
    tot = dict(ad=0, cov=0, show=0, wrong=0, late=0, mid=0, early=0, whole=0, linger=0, ahead=0, own=0, owns=0, popups=0)
    for e in exams:
        if ONLY and e["name"] != ONLY: continue
        series = LOOKS[e["name"]]
        path = os.path.join(d, name(e) + ".calls.log")
        with open(path, "w", encoding="utf-8") as f:
            calls = run_hsmm(series, c, prior_for(e["day"]), durations_for(e["day"])) if c["hsmm"] else run_policy(series, c, prior_for(e["day"]), VERIF.get(e["name"]), e)
            for t, k in calls: f.write(f"{clock(t)} break watch {e['window']}: {k} (offline)\n")
        out = subprocess.run([sys.executable, os.path.join(HERE, "exam.py"), "--trained", os.path.join(HERE, "trained.json"), e["day"], e["window"], e["from"], e["to"], "x=" + path],
                             capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
        m = re.search(r"^JSON (.*)$", out, re.M)
        if not m: print(tag, e["name"], "not scored:", out[-200:], file=sys.stderr); continue
        j = json.loads(m.group(1)); j["exam"] = e["name"]; per.append(j)
        tot["ad"] += j["ad_s"]; tot["cov"] += j["covered"]; tot["show"] += j["show_s"]; tot["wrong"] += j["wrong"]
        for k in ("late", "mid", "early", "whole", "linger", "ahead", "own", "owns", "popups"): tot[k] += j[k]
        for br in j["breaks"]:
            if not br["miss"]: lags_s.append(br["start_lag"]); lags_e.append(br["end_lag"])
        for pp in j["popup_list"]: pops.append(dict(pp, exam=e["name"]))
    if not tot["ad"]: return None
    def stats(v):
        if not v: return dict(n=0, median=0, p90=0)
        a = sorted(abs(x) for x in v); import statistics
        return dict(n=len(v), median=statistics.median(v), p90=a[min(len(a) - 1, int(round(0.9 * (len(a) - 1))))])
    res = dict(config=cfg, tag=tag, policy=c, picw=PICW, totals=dict(tot, ads_pct=round(100 * tot["cov"] / tot["ad"], 2), show_pct=round(100 * tot["wrong"] / max(1, tot["show"]), 3)),
               lags=dict(start=stats(lags_s), end=stats(lags_e), start_values=lags_s, end_values=lags_e, missed_whole=tot["whole"],
                         tail=dict(start_ge20=sum(1 for x in lags_s if x >= 20), end_ge20=sum(1 for x in lags_e if x >= 20), end_ge60=sum(1 for x in lags_e if x >= 60), breaks=len(lags_s))),
               tail_breaks=[dict(exam=j["exam"], **br) for j in per for br in j["breaks"] if br.get("miss") or br.get("start_lag", 0) >= 20 or br.get("end_lag", 0) >= 20], popups=pops, exams=per)
    json.dump(res, open(os.path.join(out_dir, tag + ".json"), "w", encoding="utf-8"), indent=1)
    return res


def row(r):
    t, L = r["totals"], r["lags"]
    return (f"| {r['config']} | {t['ads_pct']:.1f} | {t['show_pct']:.2f} | {t['popups']} | {t['late']} | {t['mid']} | {t['early']} | {t['whole']} | {t['linger']} | {t['ahead']} | {t['own']} "
            f"| {L['start']['median']:.0f} / {L['start']['p90']:.0f} | {L['end']['median']:.0f} / {L['end']['p90']:.0f} |")


HEAD = ("| configuration | ads% | show% | pop-ups | late s | mid-break s | lifted-early s | missed-whole s | stayed-on s | came-ahead s | on-their-own s | start lag med / p90 | end lag med / p90 |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|")

if __name__ == "__main__":
    LOOKS = {e["name"]: looks(e) for e in exams}
    VERIF = {e["name"]: verif_chances(e) for e in exams}
    if VERIF_DIR: print("verifier chances:", {k: len(v) for k, v in VERIF.items()}, flush=True)
    print("looks:", {k: len(v) for k, v in LOOKS.items()}, flush=True)
    configs = ["base"]
    if GRID != "none":
        # 1a: the plan's thresholds 0.5 / 0.6 sit under the policy's off (0.65 app) and can never fire first; 0.7 to 0.9 are the ones that act
        configs += [f"grid:{th},{n},{tol}" for th in (0.6, 0.7, 0.8, 0.9) for n in (1, 2, 3) for tol in (1, 2)]
        configs += [f"refr:{r}" for r in (90, 180)]            # the hard refractory as specified (it costs every mid-break re-cover)
        configs += [f"soft:{r}" for r in (60, 90, 120, 180)]   # the soft one: within R s of an end a start needs the chance above 0.9
        configs += [f"clock:{w}" for w in (0.5, 1.0)]
        if GRID == "full":
            for combo in ("grid:0.8,2,1+soft:90", "grid:0.8,2,1+soft:90+clock:1.0", "grid:0.9,1,1+soft:120", "grid:0.8,2,1+soft:120+clock:1.0"):
                configs += [combo, combo + "+hold:2", combo + "+hold:1", combo + "+agree:0", combo + "+hold:2+agree:0"]
            configs += ["hold:2", "hold:1", "agree:0", "hold:2+agree:0"]
    if GRID == "soft":          # the two pack rows alone (2026-11-08: the promo-neutral rescoring)
        configs += ["soft:90"]
    if GRID == "b3":
        configs += ["soft:90", "soft:90+pchan:1", "soft:90+pchan:1+softon:0.95", "soft:120+pchan:1"]
    if GRID == "verif":
        configs += ["soft:90"] + [f"verif:{th}" for th in (0.8, 0.9, 0.95)] + [f"verif:{th}+soft:90" for th in (0.8, 0.9, 0.95)]
    if GRID == "b2":
        configs += ["soft:90", "soft:90+softon:0.95"]
        configs += [f"cend:{n}+soft:{r}+softon:{so}" for n in (3, 5, 10) for r in (90,) for so in (0.9, 0.95)]
        configs += [f"cend:{n}+hard:{r}" for n in (3, 5, 10) for r in (60, 90, 120)]
        configs += [f"cend:5+hard:{r}+soft:90" for r in (60, 90, 120)]
    if GRID in ("full", "hsmm"):
        configs += [f"hsmm:{on},{off},{a}" for on in (0.8, 0.9) for off in (0.3, 0.45, 0.6) for a in (0.5, 1.0)]
        configs += [f"hsmm:0.8,0.45,{a}+gridk:{g}" for a in (0.5, 1.0) for g in (3, 10)]
        configs += [f"hsmm:0.8,0.45,{a}+hardoff:1" for a in (0.5, 1.0)]
        configs += [f"hsmm:0.8,0.45,{a}+gridk:{g}+hardoff:1" for a in (0.5, 1.0) for g in (3, 10)]
        configs += ["hsmm:0.8,0.45,0.5+gridk:10+hardoff:1+soft:90", "hsmm:0.9,0.45,0.5+gridk:10+hardoff:1+soft:90+clock:1.0", "hsmm:0.8,0.45,1.0+gridk:10+hardoff:1+clock:1.0"]
    tags = {cfg: re.sub(r"[^A-Za-z0-9]+", "-", cfg).strip("-") for cfg in configs}
    results = {}
    with ThreadPoolExecutor(int(os.environ.get("WORKERS", "4"))) as ex:
        for cfg, r in zip(configs, ex.map(lambda cfg: score(cfg, tags[cfg]), configs)):
            if r: results[cfg] = r; print(row(r), flush=True)
    with open(os.path.join(out_dir, "table.md"), "w", encoding="utf-8") as f:
        f.write(HEAD + "\n" + "\n".join(row(results[c]) for c in configs if c in results) + "\n")
    json.dump({c: dict(totals=r["totals"], lags=dict(start=r["lags"]["start"], end=r["lags"]["end"], tail=r["lags"]["tail"])) for c, r in results.items()},
              open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8"), indent=1)
    print("wrote", os.path.join(out_dir, "table.md"))
