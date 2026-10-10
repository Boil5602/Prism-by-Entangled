"""Repeats without labels (a study, the plan's step 5): is a stretch of sound that was heard before, on another programme or channel, an ad?

An ad's soundtrack is the same every time it airs; a show's is not. The recordings keep every window's sound as the page's meter gives it
(events.log `afp` lines: one 32-bit word per 50 ms, AdSounds.cs), so this needs no frames and no marks: every 64-word block (about 3 s)
is looked for in everything heard at another time, and a second is "heard before" when a block over it matches (a quarter of the bits may
differ, AdSounds' own test). Then the marks say what those seconds were.

    python scripts/breakwatch/repeats.py [--days 2026-10-07,2026-10-08,2026-10-09] [--out <folder>] [--level 2|3] [--maxrun 150] [--libs <folder>] [--heard <folder>] [--admax 125] [--tail] [--mature]

Prints, for the marked days: of the seconds heard before, how many were marked ad (and how many show); of the ad seconds, how many were
heard before; the same counted forward in time only (what a library that learns as it goes would have known at that second) and both ways
(what it would know once it has run for days); and how soon after each exam break's start the first heard-before second comes. With
--out it writes each window's per-second flags (repeats-<day>-<window>.npy: 0 none, 1 heard before, 2 on another programme, 3 on another
channel) and the longest heard-before runs inside time marked show (a list to look at: unmarked ads, or a show's own repeats).
Reads only the kept recordings."""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
BLOCK, MAXBITS = 64, int(64 * 32 * 0.25)
GAP = 120.0        # the same window's own sound within two minutes is not "another time"
KMAX = 24          # a word found more often than this names nothing (silence, a held tone)
args = sys.argv[1:]


def opt(name, default=None):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default


LEVEL = int(opt("--level", "2"))     # what counts in the exam lines and the list: 2 another programme or channel, 3 another channel only
days = (opt("--days") or ",".join(sorted(d for d in os.listdir(GOLDEN) if d[:2] == "20"))).split(",")
out = opt("--out")
t_start = time.time()


def sec(h):
    a = h.split(":"); return int(a[0]) * 3600 + int(a[1]) * 60 + float(a[2])


# ---- read every window's words, and what it was showing
streams = []   # dict(day, win, lo, hi, titles [(t, name)], chans [(t, name)])
W, T = [], []
n = 0
for di, day in enumerate(days):
    for win in sorted(os.listdir(os.path.join(GOLDEN, day))):
        p = os.path.join(GOLDEN, day, win, "events.log")
        if not os.path.isfile(p): continue
        words, times, titles, chans = [], [], [], []
        with open(p, "rb") as f:
            for raw in f:
                if len(raw) < 16 or not raw[:9].isdigit(): continue
                kind = raw[10:].split(b" ", 2)
                if len(kind) < 3: continue
                hh = raw[:9]; t = int(hh[0:2]) * 3600 + int(hh[2:4]) * 60 + int(hh[4:6]) + int(hh[6:9]) / 1000
                k = kind[1]
                if k == b"afp":
                    hx = kind[2].strip()
                    m = len(hx) // 8
                    if m == 0: continue
                    try: w = np.frombuffer(bytes.fromhex(hx[:m * 8].decode("ascii")), dtype=">u4")
                    except ValueError: continue
                    words.append(w); times.append(t - 0.05 * np.arange(m - 1, -1, -1))
                elif k == b"title": titles.append((t, kind[2].strip().decode("utf-8", "replace")))
                elif k == b"edge":
                    rest = kind[2].strip().split(b" ", 1)
                    if len(rest) == 2: chans.append((t, rest[1].decode("utf-8", "replace")))
        if not words: continue
        w = np.concatenate(words).astype(np.uint32); t = np.concatenate(times) + di * 86400.0
        streams.append(dict(day=day, win=win, lo=n, hi=n + len(w), titles=titles, chans=chans, di=di))
        W.append(w); T.append(t); n += len(w)
W = np.concatenate(W); T = np.concatenate(T)
SID = np.zeros(len(W), dtype=np.int16)
for i, s in enumerate(streams): SID[s["lo"]:s["hi"]] = i
print("read %d windows over %d days: %.1f million words (%.0f h of sound) in %.0f s" % (len(streams), len(days), len(W) / 1e6, len(W) / 72000, time.time() - t_start), flush=True)


def at(pairs, t):
    """What a (time, name) list says at t: the last name at or before it, the first one otherwise."""
    if not pairs or t < pairs[0][0] - 90: return ""      # before the recording named it: not known
    lo, hi = 0, len(pairs)
    while lo < hi:
        mid = (lo + hi) // 2
        if pairs[mid][0] <= t: lo = mid + 1
        else: hi = mid
    return pairs[max(0, lo - 1)][1]


# ---- candidate pairs: the same word at two places
bits = np.bitwise_count(W)
order = np.argsort(W, kind="stable")
Ws = W[order]
edges = np.flatnonzero(np.r_[True, Ws[1:] != Ws[:-1], True])
sizes = np.diff(edges)
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
print("candidate pairs: %.1f million (words found 2 to %d times, %d%% of all words)" % (len(pa) / 1e6, KMAX, 100 * int(sizes[(sizes >= 2) & (sizes <= KMAX)].sum()) // len(W)), flush=True)

# ---- verify: the 64 words around each, a quarter of the bits at most apart
lo_of = np.array([s["lo"] for s in streams]); hi_of = np.array([s["hi"] for s in streams])
keep_a, keep_b, keep_tail = [], [], []
ar = np.arange(BLOCK)
for c in range(0, len(pa), 150000):
    a0 = pa[c:c + 150000] - BLOCK // 2; b0 = pb[c:c + 150000] - BLOCK // 2
    sa, sb = SID[pa[c:c + 150000]], SID[pb[c:c + 150000]]
    inb = (a0 >= lo_of[sa]) & (a0 + BLOCK <= hi_of[sa]) & (b0 >= lo_of[sb]) & (b0 + BLOCK <= hi_of[sb])
    a0, b0 = a0[inb], b0[inb]
    whole = (T[a0 + BLOCK - 1] - T[a0] < 4.5) & (T[b0 + BLOCK - 1] - T[b0] < 4.5)     # no gap in either block
    a0, b0 = a0[whole], b0[whole]
    if not len(a0): continue
    x = np.bitwise_count(W[a0[:, None] + ar] ^ W[b0[:, None] + ar])
    d = x.sum(axis=1)
    m = d <= MAXBITS
    keep_a.append(a0[m]); keep_b.append(b0[m]); keep_tail.append(x[m][:, BLOCK - 16:].sum(axis=1) <= 16 * 32 * 0.25)
A0 = np.concatenate(keep_a); B0 = np.concatenate(keep_b); TAIL = np.concatenate(keep_tail)   # TAIL: the block's last 0.8 s matches too
print("matching blocks: %d (%.0f s)" % (len(A0), time.time() - t_start), flush=True)

# ---- a programme shown again is not an ad: matches that run on at one time offset for longer than any ad does (MAXRUN) are a film, a
# talk show or a game airing a second time, and are dropped. Two bucketings of the offset, so a run astride a bucket's edge is still seen.
MAXRUN = float(opt("--maxrun", "150"))
off = np.abs(T[A0] - T[B0]); tl = np.maximum(T[A0], T[B0])
sa_, sb_ = SID[A0].astype(np.int64), SID[B0].astype(np.int64)
rerun = np.zeros(len(A0), dtype=bool)
run_len = np.zeros(len(A0)); run_end = np.zeros(len(A0))
for phase in (0.0, 1.5):
    key = (np.minimum(sa_, sb_) * 1000 + np.maximum(sa_, sb_)) * 400000 + np.floor((off + phase) / 3.0).astype(np.int64)
    o = np.lexsort((tl, key))
    k, t = key[o], tl[o]
    brk = np.flatnonzero(np.r_[True, (k[1:] != k[:-1]) | (t[1:] - t[:-1] > 8.0), True])
    for a, b in zip(brk[:-1], brk[1:]):
        if t[b - 1] - t[a] + 3.2 > MAXRUN: rerun[o[a:b]] = True
        if phase == 0.0: run_len[o[a:b]] = t[b - 1] - t[a] + 3.2; run_end[o[a:b]] = t[b - 1] + 3.2
print("programmes shown again: %d of the blocks (%.0f%%) lie in runs over %d s at one offset and are dropped" % (int(rerun.sum()), 100 * rerun.mean(), MAXRUN), flush=True)
A0, B0, run_len, run_end, TAIL = A0[~rerun], B0[~rerun], run_len[~rerun], run_end[~rerun], TAIL[~rerun]

# ---- flags per window-second: forward (the later hearing only) and both ways; plain, and "on another programme or channel"
fwd = [np.zeros(86400, dtype=np.uint8) for _ in streams]
both = [np.zeros(86400, dtype=np.uint8) for _ in streams]
ta, tb = T[A0], T[B0]
early = np.where(ta <= tb, A0, B0); late = np.where(ta <= tb, B0, A0)
cache = {}


def prog(si, t):
    key = (si, int(t) // 30)
    if key not in cache:
        s = streams[si]; tt = t - s["di"] * 86400.0
        cache[key] = (at(s["chans"], tt), at(s["titles"], tt))
    return cache[key]


for e0, l0 in zip(early.tolist(), late.tolist()):
    se, sl = int(SID[e0]), int(SID[l0])
    ce, pe = prog(se, T[e0]); cl, pl = prog(sl, T[l0])
    other = 3 if (ce and cl and ce != cl) else 2 if (pe and pl and pe != pl) else 1
    for arr_set, i0, si in ((fwd, l0, sl), (both, l0, sl), (both, e0, se)):
        d0 = int(T[i0] - streams[si]["di"] * 86400.0); d1 = int(T[i0 + BLOCK - 1] - streams[si]["di"] * 86400.0)
        seg = arr_set[si][max(0, d0):min(86400, d1 + 1)]
        np.maximum(seg, other, out=seg)
print("flags made (%.0f s)" % (time.time() - t_start), flush=True)

# ---- the design this is a study for, played forward exactly: Prism keeps the sound it hears; when a stretch turns out to be a repeat of
# something heard on another programme or channel, and the repeat ends within an ad's length (ADMAX), both hearings are learned as an
# ad's sound (AdSounds). From then on a block that matches a learned stretch is a known ad - at the block's end, three seconds in.
ADMAX = float(opt("--admax", "125"))
lvl = np.fromiter((3 if (c1 and c2 and c1 != c2) else 2 if (p1 and p2 and p1 != p2) else 1
                   for (c1, p1), (c2, p2) in ((prog(int(SID[e0]), T[e0]), prog(int(SID[l0]), T[l0])) for e0, l0 in zip(early.tolist(), late.tolist()))), dtype=np.int8, count=len(early))
adlike = (lvl >= LEVEL) & (run_len <= ADMAX)
learned_at = np.full(len(W), np.inf)
for c in range(0, int(adlike.sum()), 200000):
    sel = np.flatnonzero(adlike)[c:c + 200000]
    when = np.repeat(run_end[sel], BLOCK)
    for side in (early[sel], late[sel]):
        np.minimum.at(learned_at, (side[:, None] + ar).ravel(), when)
known = learned_at[early + BLOCK // 2] <= T[late + BLOCK - 1]          # the earlier hearing was already a learned ad when this one played
if "--tail" in args:
    args.remove("--tail"); known &= TAIL                                # and the block's last 0.8 s matches by itself: the ad is still playing
kn = [np.zeros(86400, dtype=bool) for _ in streams]
for l0 in late[known].tolist():
    si = int(SID[l0]); kn[si][min(86399, int(T[l0 + BLOCK - 1] - streams[si]["di"] * 86400.0))] = True
if "--mature" in args:
    # not forward: every hearing of a stretch that is learned at ANY time in the recordings counts, the first ones too - what a library
    # that has been learning for as long as the recordings run would know (an estimate of later, not a score of now)
    args.remove("--mature")
    was = np.isfinite(learned_at)
    for side in (early, late):
        for i0 in side[was[side + BLOCK // 2] & TAIL].tolist():
            si = int(SID[i0]); kn[si][min(86399, int(T[i0 + BLOCK - 1] - streams[si]["di"] * 86400.0))] = True
print("learned as ads' sound: %.1f h of the %.0f h heard; %d of the later hearings were of a stretch already learned (%.0f s)" % (
    np.isfinite(learned_at).sum() / 72000, len(W) / 72000, int(known.sum()), time.time() - t_start), flush=True)
heard_dir = opt("--heard")
if heard_dir:
    for si, s in enumerate(streams):
        os.makedirs(os.path.join(heard_dir, s["day"]), exist_ok=True)
        with open(os.path.join(heard_dir, s["day"], s["win"] + ".heard"), "w") as f:
            f.write("\n".join(str(int(x)) for x in np.flatnonzero(kn[si])) + "\n")

# ---- what the marks say those seconds were
exams = json.load(open(os.path.join(HERE, "exams.json"), encoding="utf-8"))
tot = {}
runs_in_show = []
frames_of = {}
for si, s in enumerate(streams):
    lp = os.path.join(GOLDEN, s["day"], "labels.json")
    if out:
        os.makedirs(out, exist_ok=True)
        np.save(os.path.join(out, "repeats-%s-%s.npy" % (s["day"], s["win"])), np.stack([fwd[si], both[si]]))
    if not os.path.exists(lp): continue
    lab = json.load(open(lp, encoding="utf-8"))["windows"].get(s["win"])
    if not lab: continue
    rev = np.zeros(86400, dtype=bool); ad = np.zeros(86400, dtype=bool); heard = np.zeros(86400, dtype=bool)
    for a, b in lab.get("reviewed", []): rev[int(sec(a)):int(sec(b)) + 1] = True
    for a, b in lab.get("ads", []): ad[int(sec(a)):int(sec(b)) + 1] = True
    tt = (T[s["lo"]:s["hi"]] - s["di"] * 86400.0).astype(np.int64); heard[np.clip(tt, 0, 86399)] = True     # seconds with sound recorded
    rev &= heard
    # and only seconds a frame was kept for (exam.py's rule): where the recording has sound and no picture nobody could mark an ad
    seen = np.zeros(86400, dtype=bool)
    for nme in os.listdir(os.path.join(GOLDEN, s["day"], s["win"])):
        if nme.endswith(".gray") and nme[:6].isdigit(): seen[min(86399, int(nme[0:2]) * 3600 + int(nme[2:4]) * 60 + int(nme[4:6]))] = True
    seen = seen | np.r_[seen[1:], False] | np.r_[False, seen[:-1]]
    rev &= seen
    frames_of[si] = seen
    for name, flags in (("forward, any", fwd[si] >= 1), ("forward, other programme", fwd[si] >= 2), ("forward, other channel", fwd[si] >= 3),
                        ("both ways, any", both[si] >= 1), ("both ways, other programme", both[si] >= 2), ("both ways, other channel", both[si] >= 3),
                        ("known: a learned ad's sound", kn[si])):
        d = tot.setdefault(name, dict(ad=0, show=0, fad=0, fshow=0))
        d["ad"] += int((rev & ad).sum()); d["show"] += int((rev & ~ad).sum()); d["fad"] += int((rev & ad & flags).sum()); d["fshow"] += int((rev & ~ad & flags).sum())
    # the longest heard-before runs (other programme, both ways) in time marked show: a list to look at
    f = (both[si] >= LEVEL) & rev & ~ad
    # close gaps of up to 4 s, then runs
    idx = np.flatnonzero(f)
    if len(idx):
        cut = np.flatnonzero(np.diff(idx) > 5)
        for a, b in zip(np.r_[idx[0], idx[cut + 1]], np.r_[idx[cut], idx[-1]]):
            if b - a >= 12: runs_in_show.append((int(f[a:b + 1].sum()), s["day"], s["win"], int(a), int(b), at(s["chans"], a), at(s["titles"], a)))
print()
for name, d in tot.items():
    print("%-28s of %6d ad s heard before: %5.1f%% | of %6d show s heard before: %5.2f%% (%d s) | heard-before seconds that are ads: %.1f%%" % (
        name, d["ad"], 100 * d["fad"] / max(1, d["ad"]), d["show"], 100 * d["fshow"] / max(1, d["show"]), d["fshow"], 100 * d["fad"] / max(1, d["fad"] + d["fshow"])))

# ---- the exams: how soon after a break's start is something heard before
print()
for e in exams:
    si = next((i for i, s in enumerate(streams) if s["day"] == e["day"] and s["win"] == e["window"]), None)
    if si is None: continue
    lab = json.load(open(os.path.join(GOLDEN, e["day"], "labels.json"), encoding="utf-8"))["windows"][e["window"]]
    lo, hi = sec(e["from"]), sec(e["to"])
    for label, arr in (("forward", fwd[si]), ("both ways", both[si]), ("known", kn[si].astype(np.uint8) * 3)):
        firsts = []; cov = 0; adn = 0; wrong = 0; shown = 0
        admask = np.zeros(86400, dtype=bool)
        for a, b in lab["ads"]:
            a, b = int(sec(a)), int(sec(b))
            if a < lo or b > hi or b - a < 20: continue
            admask[a:b + 1] = True
            f = np.flatnonzero(arr[a:b + 1] >= LEVEL)
            firsts.append(int(f[0]) if len(f) else None); cov += len(f); adn += b - a + 1
        showmask = np.zeros(86400, dtype=bool); showmask[int(lo):int(hi)] = True; showmask &= ~admask
        if si in frames_of: showmask &= frames_of[si]
        for a, b in lab["ads"]: showmask[int(sec(a)):int(sec(b)) + 1] = False
        wrong = int((arr[showmask] >= LEVEL).sum()); shown = int(showmask.sum())
        got = sorted(x for x in firsts if x is not None)
        print("%-20s %-9s breaks %2d | heard before in %2d | first heard-before second: median %s s, within 5 s in %d, within 10 s in %d | ad s heard before %4.1f%% | show s heard before %.2f%% (%d s)" % (
            e["name"], label, len(firsts), len(got), got[len(got) // 2] if got else "-", sum(x <= 5 for x in got), sum(x <= 10 for x in got), 100 * cov / max(1, adn), 100 * wrong / max(1, shown), wrong))

# ---- --libs <folder>: for each exam, the known-ad library of before its stretch (golden/<day>/library/<name>) with one thing added - the
# exam window's own sound wherever it was heard before (forward only, LEVEL) - so the replay harness's AdSounds hears those stretches as
# a Prism that learned from repeats would have (three seconds in, as it must). Writes <folder>/exams.json naming the new folders.
libs = opt("--libs")
if libs:
    import shutil
    import struct
    new_exams = []
    for e in exams:
        si = next((i for i, s in enumerate(streams) if s["day"] == e["day"] and s["win"] == e["window"]), None)
        if si is None: continue
        s = streams[si]
        src = os.path.join(GOLDEN, e["day"], "library", e["library"])
        dst = os.path.join(libs, "".join(c if c.isalnum() else "-" for c in e["name"]))
        if os.path.isdir(dst): shutil.rmtree(dst)
        shutil.copytree(src, dst)
        clips = []
        sp = os.path.join(src, "sounds.bin")
        if os.path.exists(sp):
            raw = open(sp, "rb").read()
            ver, cnt = struct.unpack_from("<ii", raw, 0); pos = 8
            for _ in range(cnt if ver == 1 else 0):
                (ln,) = struct.unpack_from("<i", raw, pos); pos += 4
                clips.append(np.frombuffer(raw, dtype="<u4", count=ln, offset=pos).copy()); pos += 4 * ln
        had = len(clips)
        f0 = e.get("frames", [e["from"].replace(":", "") + "000"])[0]
        lo = int(f0[0:2]) * 3600 + int(f0[2:4]) * 60 + int(f0[4:6]); hi = int(sec(e["to"]))
        flagged = np.flatnonzero(fwd[si][lo:hi + 1] >= LEVEL) + lo
        tt = T[s["lo"]:s["hi"]] - s["di"] * 86400.0
        added = 0
        if len(flagged):
            cut = np.flatnonzero(np.diff(flagged) > 1)
            for a, b in zip(np.r_[flagged[0], flagged[cut + 1]], np.r_[flagged[cut], flagged[-1]]):
                i0, i1 = np.searchsorted(tt, a), np.searchsorted(tt, b + 1)
                w = W[s["lo"] + i0:s["lo"] + i1]
                for k in range(0, len(w), 1600):
                    if len(w[k:k + 1600]) >= BLOCK: clips.append(w[k:k + 1600].astype("<u4")); added += 1
        with open(os.path.join(dst, "sounds.bin"), "wb") as f:
            f.write(struct.pack("<ii", 1, len(clips)))
            for c in clips: f.write(struct.pack("<i", len(c))); f.write(c.astype("<u4").tobytes())
        new_exams.append(dict(e, library=dst.replace("\\", "/")))
        print("%-20s library %s: %d clips it had, %d stretches heard before added (%d s)" % (e["name"], e["library"], had, added, len(flagged)))
    json.dump(new_exams, open(os.path.join(libs, "exams.json"), "w", encoding="utf-8"), indent=1)

if out:
    runs_in_show.sort(reverse=True)
    with open(os.path.join(out, "repeats-in-show.txt"), "w", encoding="utf-8") as f:
        for nsec, day, win, a, b, ch, title in runs_in_show[:400]:
            f.write("%s %-28s %02d:%02d:%02d-%02d:%02d:%02d %4d s  %s | %s\n" % (day, win, a // 3600, a // 60 % 60, a % 60, b // 3600, b // 60 % 60, b % 60, nsec, ch, title))
    print("\n%d heard-before runs of 12 s or more inside time marked show: %s" % (len(runs_in_show), os.path.join(out, "repeats-in-show.txt")))
print("done in %.0f s" % (time.time() - t_start))
