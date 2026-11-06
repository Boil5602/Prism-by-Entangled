"""Cross-channel recurrence (a study, 2026-11-05, from a broadcast monitor's published method: a clip is taken for a commercial once it has
aired on several channels): a commercial airs on many channels, a network's promo on its own network (or its family's) alone. Is the number
of channels a stretch of sound was heard on a clean line between the two, and between both and the show?

The sound words and the matching are repeats.py's (events.log `afp`, 64-word blocks, a quarter of the bits apart, a programme shown again
dropped); here every hearing of a block notes the channel it was heard on (the recording's `edge` lines), so each second of a window gets
the set of channels its sound was heard on, its own included. Then the labels say what those seconds were:
  promo       labels.promos.json / labels.auto.json promo spans (the doctor's vision pass over each break)
  commercial  the marked or auto-labelled breaks less their promos
  show        the reviewed time outside every break

    python scripts/breakwatch/recurrence.py [--days a,b,...] [--maxrun 150] [--out <folder>]

Reads only the kept recordings and the labels beside them; writes nothing in the day folders."""
import json
import os
import sys
import time
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOLDEN = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
BLOCK, MAXBITS = 64, int(64 * 32 * 0.25)
GAP = 120.0
KMAX = 24
args = sys.argv[1:]


def opt(name, default=None):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default


days = (opt("--days") or ",".join(sorted(d for d in os.listdir(GOLDEN) if d[:2] == "20"))).split(",")
MAXRUN = float(opt("--maxrun", "150"))
out = opt("--out", os.path.join(ROOT, "scripts", "doctor", "out", "recurrence"))
os.makedirs(out, exist_ok=True)
t0 = time.time()


def sec(h):
    a = h.split(":"); return int(a[0]) * 3600 + int(a[1]) * 60 + int(float(a[2]))


# ---- every window's words and the channel it was on (repeats.py's reader)
streams, W, T = [], [], []
chan_id = {}
n = 0
for di, day in enumerate(days):
    for win in sorted(os.listdir(os.path.join(GOLDEN, day))):
        p = os.path.join(GOLDEN, day, win, "events.log")
        if not os.path.isfile(p): continue
        words, times, ct, cn = [], [], [], []
        with open(p, "rb") as f:
            for raw in f:
                if len(raw) < 16 or not raw[:9].isdigit(): continue
                kind = raw[10:].split(b" ", 2)
                if len(kind) < 3: continue
                hh = raw[:9]; t = int(hh[0:2]) * 3600 + int(hh[2:4]) * 60 + int(hh[4:6]) + int(hh[6:9]) / 1000
                k = kind[1]
                if k == b"afp":
                    hx = kind[2].strip(); m = len(hx) // 8
                    if m == 0: continue
                    try: w = np.frombuffer(bytes.fromhex(hx[:m * 8].decode("ascii")), dtype=">u4")
                    except ValueError: continue
                    words.append(w); times.append(t - 0.05 * np.arange(m - 1, -1, -1))
                elif k == b"edge":
                    rest = kind[2].strip().split(b" ", 1)
                    if len(rest) == 2:
                        name = rest[1].decode("utf-8", "replace").strip()
                        if name: ct.append(t); cn.append(chan_id.setdefault(name, len(chan_id)))
        if not words or not ct: continue
        w = np.concatenate(words).astype(np.uint32); t = np.concatenate(times)
        streams.append(dict(day=day, win=win, di=di, lo=n, hi=n + len(w), ct=np.array(ct), cn=np.array(cn)))
        W.append(w); T.append(t + di * 86400.0); n += len(w)
W = np.concatenate(W); T = np.concatenate(T)
SID = np.zeros(len(W), dtype=np.int32)
for i, s in enumerate(streams): SID[s["lo"]:s["hi"]] = i
DI = np.array([s["di"] for s in streams])
names = {v: k for k, v in chan_id.items()}
# --families: count owner groups, not channels (a network cross-promotes on its sister channels: Food Network's promo on HGTV and TLC).
# Groups by owner as carried on YouTube TV in 2026, broadly; a channel not listed is a group of its own.
FAMILIES = {
    "Warner Bros. Discovery": "CNN TBS TNT truTV|Food Network|HGTV|TLC|Travel Channel|Animal Planet|Magnolia Network|Turner Classic Movies|Cartoon Network|Adult Swim",
    "Paramount": "Comedy Central|MTV|MTV2|MTV Classic|Nickelodeon|Nick Jr.|Nicktoons|TeenNick|BET|BET Her|CMT|VH1|TV Land|Paramount|Pop|Smithsonian Channel|CBS Sports Network|Dabl|WTAJ",
    "Disney": "FX|FXX|Freeform|Disney Junior|Nat Geo|ABC 23",
    "NBCUniversal and Versant": "USA|Bravo|E!|SYFY|Golf Channel|NBC Sports Network|NBCSN Extra|NBC Sports Philadelphia|Telemundo|WJAC-TV 6",
    "AMC Networks": "AMC|AMC Thrillers|BBC America|IFC|Stories by AMC|Portlandia",
    "Fox": "FOX 8|FS2|BTN",
    "TelevisaUnivision": "Univision|UniMas",
    "Allen Media": "JusticeCentral.TV|Comedy.TV",
    "Sinclair": "CHARGE!|ROAR|T2|The Nest",
    "Nexstar": "NewsNation|CW ALLEGHENIES",
}
fam_of = {}
for f_, chs_ in FAMILIES.items():
    for c_ in chs_.replace("CNN TBS TNT truTV", "CNN|TBS|TNT|truTV").split("|"): fam_of[c_] = f_
if "--families" in args:
    args.remove("--families")
    fid = {}
    remap = {cid: fid.setdefault(fam_of.get(nm, nm), len(fid)) for cid, nm in names.items()}
    chan_id = {nm: remap[cid] for nm, cid in chan_id.items()}
    names = {v: k for k, v in fid.items()}
    for s in streams: s["cn"] = np.array([remap[int(c)] for c in s["cn"]])
    print("counting owner groups: %d" % len(fid))
print("read %d windows over %d days: %.0f h of sound, %d channels named (%.0f s)" % (len(streams), len(days), len(W) / 72000, len(chan_id), time.time() - t0), flush=True)

# each word's channel: the last edge line at or before it (the first one if before it; unknown more than 90 s before the first)
CH = np.full(len(W), -1, dtype=np.int32)
for i, s in enumerate(streams):
    tt = T[s["lo"]:s["hi"]] - s["di"] * 86400.0
    k = np.searchsorted(s["ct"], tt, side="right") - 1
    c = s["cn"][np.maximum(k, 0)].astype(np.int32)
    c[(k < 0) & (tt < s["ct"][0] - 90)] = -1
    CH[s["lo"]:s["hi"]] = c

# ---- candidate pairs and their check (repeats.py)
bits = np.bitwise_count(W)
order = np.argsort(W, kind="stable"); Ws = W[order]
edges = np.flatnonzero(np.r_[True, Ws[1:] != Ws[:-1], True]); sizes = np.diff(edges)
ok_word = (bits[order[edges[:-1]]] >= 6) & (bits[order[edges[:-1]]] <= 26)
pa, pb = [], []
for g in range(2, KMAX + 1):
    starts = edges[:-1][(sizes == g) & ok_word]
    if not len(starts): continue
    idx = order[starts[:, None] + np.arange(g)[None, :]]
    i, j = np.triu_indices(g, 1)
    a, b = idx[:, i].ravel(), idx[:, j].ravel()
    far = (SID[a] != SID[b]) | (np.abs(T[a] - T[b]) >= GAP)
    pa.append(a[far]); pb.append(b[far])
pa = np.concatenate(pa); pb = np.concatenate(pb)
lo_of = np.array([s["lo"] for s in streams]); hi_of = np.array([s["hi"] for s in streams])
ka, kb = [], []
ar = np.arange(BLOCK)
for c in range(0, len(pa), 150000):
    a0 = pa[c:c + 150000] - BLOCK // 2; b0 = pb[c:c + 150000] - BLOCK // 2
    sa, sb = SID[pa[c:c + 150000]], SID[pb[c:c + 150000]]
    inb = (a0 >= lo_of[sa]) & (a0 + BLOCK <= hi_of[sa]) & (b0 >= lo_of[sb]) & (b0 + BLOCK <= hi_of[sb])
    a0, b0 = a0[inb], b0[inb]
    whole = (T[a0 + BLOCK - 1] - T[a0] < 4.5) & (T[b0 + BLOCK - 1] - T[b0] < 4.5)
    a0, b0 = a0[whole], b0[whole]
    if not len(a0): continue
    d = np.bitwise_count(W[a0[:, None] + ar] ^ W[b0[:, None] + ar]).sum(axis=1)
    m = d <= MAXBITS
    ka.append(a0[m]); kb.append(b0[m])
A0 = np.concatenate(ka); B0 = np.concatenate(kb)
print("matching blocks: %d (%.0f s)" % (len(A0), time.time() - t0), flush=True)

# a programme shown again: a run at one offset longer than any ad
off = np.abs(T[A0] - T[B0]); tl = np.maximum(T[A0], T[B0])
sa_, sb_ = SID[A0].astype(np.int64), SID[B0].astype(np.int64)
rerun = np.zeros(len(A0), dtype=bool)
for phase in (0.0, 1.5):
    key = (np.minimum(sa_, sb_) * 1000 + np.maximum(sa_, sb_)) * 400000 + np.floor((off + phase) / 3.0).astype(np.int64)
    o = np.lexsort((tl, key)); k, t = key[o], tl[o]
    brk = np.flatnonzero(np.r_[True, (k[1:] != k[:-1]) | (t[1:] - t[:-1] > 8.0), True])
    for a, b in zip(brk[:-1], brk[1:]):
        if t[b - 1] - t[a] + 3.2 > MAXRUN: rerun[o[a:b]] = True
A0, B0 = A0[~rerun], B0[~rerun]
print("programmes shown again dropped: %.0f%% of the blocks" % (100 * rerun.mean()), flush=True)

# ---- per window-second: the channels its sound was heard on (the other hearing's channel)
pair_key, pair_ch = [], []
for here, there in ((A0, B0), (B0, A0)):
    si = SID[here]; base = DI[si] * 86400.0
    d0 = (T[here] - base).astype(np.int64); d1 = (T[here + BLOCK - 1] - base).astype(np.int64)
    for k in range(0, 5):
        sel = d0 + k <= d1
        pair_key.append(si[sel].astype(np.int64) * 86400 + np.clip(d0[sel] + k, 0, 86399))
        pair_ch.append(CH[there][sel])
pair_key = np.concatenate(pair_key); pair_ch = np.concatenate(pair_ch)
good = pair_ch >= 0
u = np.unique(np.stack([pair_key[good], pair_ch[good].astype(np.int64)], 1), axis=0)
heard = defaultdict(set)
for kk, cc in u.tolist(): heard[kk].add(cc)
print("seconds heard elsewhere: %d (%.0f s)" % (len(heard), time.time() - t0), flush=True)


# ---- labels per window-second
def spans(path, win, key):
    if not os.path.exists(path): return []
    w = json.load(open(path, encoding="utf-8")).get("windows", {}).get(win, {})
    return [(sec(a), sec(b)) for a, b in w.get(key, [])]


def mask(sp):
    m = np.zeros(86400, dtype=bool)
    for a, b in sp: m[a:b + 1] = True
    return m


promo_runs = []
by_kind = defaultdict(Counter); promo_sets = Counter(); comm_one = Counter(); per_day = defaultdict(Counter)
for si, s in enumerate(streams):
    g = os.path.join(GOLDEN, s["day"])
    files = [os.path.join(g, f) for f in ("labels.json", "labels.auto.json")]
    pfiles = [os.path.join(g, "labels.promos.json"), os.path.join(g, "labels.auto.json"),
              os.path.join(ROOT, "scripts", "doctor", "out", "promos-" + s["day"], "labels.promos.json")]
    ads = mask([x for f in files for x in spans(f, s["win"], "ads")])
    rev = mask([x for f in files for x in spans(f, s["win"], "reviewed")])
    if not ads.any() and not rev.any(): continue
    promo = mask([x for f in pfiles for x in spans(f, s["win"], "promos")]) & ads
    neutral = mask([x for f in files for x in spans(f, s["win"], "neutral")])
    tt = np.clip((T[s["lo"]:s["hi"]] - s["di"] * 86400.0).astype(np.int64), 0, 86399)
    sound = np.zeros(86400, dtype=bool); sound[tt] = True
    own = np.full(86400, -1, dtype=np.int64); own[tt] = CH[s["lo"]:s["hi"]]
    for kind, m in (("promo", promo & sound & ~neutral), ("commercial", ads & ~promo & sound & ~neutral), ("show", rev & ~ads & sound & ~neutral)):
        for x in np.flatnonzero(m).tolist():
            h = heard.get(si * 86400 + x)
            if h:
                chs = set(h)
                if own[x] >= 0: chs.add(int(own[x]))
                nch = len(chs)
            else:
                chs, nch = set(), 0
            by_kind[kind][min(nch, 6)] += 1; per_day[(s["day"], kind)][min(nch, 3)] += 1
            if kind == "promo" and nch >= 3:
                promo_sets[tuple(sorted(names[c] for c in chs))] += 1
                r = promo_runs[-1] if promo_runs else None
                if r and r[0] == s["day"] and r[1] == s["win"] and x - r[3] <= 5: r[3] = x; r[4] += 1
                else: promo_runs.append([s["day"], s["win"], x, x, 1, names.get(int(own[x]), "?")])
            if kind == "commercial" and nch == 1: comm_one[names[next(iter(chs))]] += 1


def pct(c, k, tot): return "%5.1f%%" % (100 * c[k] / tot)


print()
print("channels a labelled second's sound was heard on, its own included (0 = never heard again), days " + ",".join(days))
for kind in ("commercial", "promo", "show"):
    c = by_kind[kind]; tot = sum(c.values()) or 1
    print("%-11s %7d s |  0 %s |  1 %s |  2 %s |  3 %s |  4 %s |  5 %s |  6+ %s |  3+ %s" % (
        kind, tot, *[pct(c, k, tot) for k in range(7)], "%5.1f%%" % (100 * sum(v for q, v in c.items() if q >= 3) / tot)))
print()
for (day, kind), c in sorted(per_day.items()):
    tot = sum(c.values()) or 1
    print("  %s %-11s %6d s | 0 %s | 1 %s | 2 %s | 3+ %s" % (day, kind, tot, *[pct(c, k, tot) for k in range(4)]))
with open(os.path.join(out, "promos-on-3plus.txt"), "w", encoding="utf-8") as f:
    for chs, nn in promo_sets.most_common(80): f.write("%5d s  %s\n" % (nn, ", ".join(chs)))
with open(os.path.join(out, "promo-runs-on-3plus.txt"), "w", encoding="utf-8") as f:
    for d_, w_, a_, b_, n_, ch_ in sorted(promo_runs, key=lambda r: -r[4]):
        f.write("%s %-28s %02d:%02d:%02d-%02d:%02d:%02d %4d s  on %s\n" % (d_, w_, a_ // 3600, a_ // 60 % 60, a_ % 60, b_ // 3600, b_ // 60 % 60, b_ % 60, n_, ch_))
with open(os.path.join(out, "commercials-one-channel.txt"), "w", encoding="utf-8") as f:
    for ch, nn in comm_one.most_common(80): f.write("%5d s  %s\n" % (nn, ch))
json.dump({k: dict(v) for k, v in by_kind.items()}, open(os.path.join(out, "histogram.json"), "w"))
print("\npromos heard on 3+ channels, by channel set: %s\ncommercials heard again on their own channel only: %s\ndone in %.0f s" % (
    os.path.join(out, "promos-on-3plus.txt"), os.path.join(out, "commercials-one-channel.txt"), time.time() - t0))
