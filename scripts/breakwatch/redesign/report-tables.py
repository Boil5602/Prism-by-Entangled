"""Prints the report's section-1 tables from docs/break-watch-results-<date>.json (2026-11-08, with the addendum's tail columns).

The tail columns read the capped lags (a cover running through a promo-split pod is not a linger over the next pod's ads) where a
result carries them, the raw lags otherwise (marked with a dagger).
"""
import json
import sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
HEAD = ("| configuration | ads% | show% | pop-ups | late s | mid-break s | lifted-early s | missed-whole s | stayed-on s | came-ahead s | on-their-own s "
        "| start lag med / p90 | end lag med / p90 | start >= 20 s | end >= 20 s | end >= 60 s | ms per look |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")


def fmt(name, r, ms="", mark=""):
    cap = r.get("lags_capped")
    if cap: sl, el, tl, dag = cap["start"], cap["end"], cap["tail"], ""
    else: sl, el, tl, dag = r["start_lag"], r["end_lag"], (r.get("tail_raw") or {}), " (raw)"
    med = lambda x: f"{x['median']:.0f}" if x.get("median") is not None else "-"
    p90 = lambda x: f"{x['p90']:.0f}" if x.get("p90") is not None else "-"
    tv = lambda k: str(tl.get(k)) if tl and tl.get(k) is not None else "-"
    return (f"| {name}{mark} | {r['ads_pct']:.1f} | {r['show_pct']:.2f} | {r['popups']} | {r['late']} | {r['mid']} | {r['early']} | {r['whole']} | {r['linger']} | {r['ahead']} | {r['own']} "
            f"| {med(sl)} / {p90(sl)}{dag} | {med(el)} / {p90(el)}{dag} | {tv('start_ge20')} | {tv('end_ge20')} | {tv('end_ge60')} | {ms} |")


def cost_ms(r):
    c = r.get("cost") or {}
    return f"{c.get('trees_ms', 0) + c.get('net_ms', 0):.1f}" if c.get("looks") else ""


SWEEP_ROWS = ["base", "soft:90", "soft:180", "grid:0.9,1,1", "clock:1.0", "hold:2", "agree:0", "hsmm:0.9,0.45,0.5", "hsmm:0.8,0.45,0.5+gridk:10+hardoff:1"]
B2_ROWS = ["cend:3+hard:90", "soft:90+softon:0.95"]
C2_ROWS = ["verif:0.9", "verif:0.9+soft:90"]
for s, title in (("seven", "The seven exams (honest)"), ("night", "The ordinary evening (honest)"), ("1104", "The 11-04 election night")):
    print(f"\n#### {title}\n\n{HEAD}")
    for model in ("app", "ext"):
        base_key = f"{model}-clean-{s}"
        b = (d.get("phase0c_baselines_rerun") or {}).get(base_key) or d["phase0_baselines"].get(base_key)
        if b: print(fmt(f"{model} shipped policy, clean network (bench)" + (" *open-book*" if s == "1104" else ""), b, cost_ms(b)))
        sh = d["phase0_baselines"].get(f"{model}-shipped-{s}")
        if sh: print(fmt(f"{model} shipped policy, shipped network (bench)", sh, "", " *open-book on the evening*" if s == "night" else ""))
        if model == "app":
            for k, r in (d.get("phaseA3_five_day_model") or {}).items():
                if k.endswith(s): print(fmt(f"app five-day model (no 11-04) {k.split('-')[1]} (bench, honest)", r, cost_ms(r)))
        for k, r in (d.get("phase1c_bench_confirmation") or {}).items():
            if k.startswith(model) and k.endswith(s): print(fmt(f"{model} {k.split('-')[1]} (bench)", r, ""))
        sw = (d.get("phase1_sweeps") or {}).get(f"{model}-{s}", {})
        for cfg in SWEEP_ROWS:
            if cfg in sw: print(fmt(f"{model} {cfg} (offline)", sw[cfg], ""))
        b2 = (d.get("phaseB2_sweeps") or {}).get(f"{model}-{s}", {})
        for cfg in B2_ROWS:
            if cfg in b2: print(fmt(f"{model} {cfg} (offline, B2)", b2[cfg], ""))
        c2 = (d.get("phaseC2_sweeps") or {}).get(f"{model}-{s}", {})
        for cfg in C2_ROWS:
            if cfg in c2: print(fmt(f"{model} end verifier {cfg} (offline, C)", c2[cfg], ""))
        if model == "app":
            for k, r in (d.get("phaseE1_repetition_bench") or {}).items():
                if k.endswith(s): print(fmt(f"app trees + repetition feature, {k.split('-')[1]} (bench, E1)", r, cost_ms(r)))
        for k, r in (d.get("phaseF_two_networks") or {}).items():
            if k.startswith(model) and k.endswith(s): print(fmt(f"{model} {k[len(model) + 1:-len(s) - 1]} (bench, F)", r, cost_ms(r)))
        for k, r in (d.get("phase4_networks") or {}).items():
            if k.startswith(model) and k.endswith(s): print(fmt(f"{model} network {k[len(model) + 1:-len(s) - 1]} (bench, Phase 4)", r, cost_ms(r)))
