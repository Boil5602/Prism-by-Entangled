"""The channel gate's list written into a model (2026-11-11, agreed 2026-11-09).

    python -I scripts/breakwatch/gate.py <held-out run's text> [<more>] --model <model.json> [--gate 3.0] [--min-show 1800] [--dry]

Reads the per-channel lines of train2.py's held-out run (each channel scored by trees that never saw it: GROUPS=8 or one at a time) and
writes them into the model as "channels": name -> ads (% of ad time covered), wrong (% of show time covered), adS, showS (the seconds
measured). policy.gate is set to --gate: PRISM covers on its own judgement only on a listed channel whose wrong is at most that
(LearnedBreak.Measured); elsewhere it covers sure breaks only. A channel with under --min-show seconds of show is left out: too little
to call a rate. The rates are of the trees alone at the scorer's policy, with none of the app's other checks: a cautious stand-in.
"""
import io, json, re, sys

a = sys.argv[1:]
def opt(n, d):
    if n in a:
        i = a.index(n); v = a[i + 1]; del a[i:i + 2]; return v
    return d
model = opt("--model", None); gate = float(opt("--gate", "3.0")); min_show = int(opt("--min-show", "1800"))
dry = "--dry" in a
if dry: a.remove("--dry")
if not a or not model: print(__doc__); sys.exit(2)
LINE = re.compile(r"^\s*(.+?):\s+rules ads.*?model ads\s+([\d.]+)% wrong\s+([\d.]+)%.*?\((\d+) ad s, (\d+) show s")
ch = {}
for p in a:
    for line in io.open(p, encoding="utf-8", errors="replace"):
        m = LINE.match(line)
        if m and int(m.group(5)) >= min_show:
            ch[m.group(1)] = {"ads": float(m.group(2)), "wrong": float(m.group(3)), "adS": int(m.group(4)), "showS": int(m.group(5))}
ok = sorted(c for c, v in ch.items() if v["wrong"] <= gate); out = sorted(c for c in ch if c not in ok)
print(f"{len(ch)} channels measured; {len(ok)} at or under {gate}% wrong, {len(out)} over")
print("over the gate: " + ", ".join(f"{c} ({ch[c]['wrong']}%)" for c in out))
ads = sum(ch[c]["ads"] * ch[c]["adS"] for c in ok) / max(1, sum(ch[c]["adS"] for c in ok)); wr = sum(ch[c]["wrong"] * ch[c]["showS"] for c in ok) / max(1, sum(ch[c]["showS"] for c in ok))
print(f"on the channels under the gate: ads covered {ads:.1f}%  show wrongly covered {wr:.2f}%")
if not dry:
    m = json.load(io.open(model, encoding="utf-8")); m["channels"] = ch; m.setdefault("policy", {})["gate"] = gate
    f = io.open(model, "w", encoding="utf-8"); f.write(json.dumps(m, separators=(",", ":"))); f.close()
    print("written", model)
