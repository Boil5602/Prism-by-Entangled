"""One interval over several exams, and whether two benches have been told apart (2026-11-10; the review of 2026-11-09 found policies
being ranked on differences smaller than the noise of a few dozen breaks).

    python scripts/breakwatch/errbars.py <results.json> [<results.json> ...]
    python scripts/breakwatch/errbars.py <results.json> [...] --vs <results.json> [...]

A results file is run_exams.py --results; each exam in it carries "blocks" (exam.py: a marked break with the show around it, to the
midpoints between breaks, as ad s, covered ad s, show s, wrong show s). The blocks of every exam named are pooled and resampled whole,
5000 times: a break is the unit, since the seconds inside one are not independent. Printed: the share of ad time covered and of show
time wrongly covered with a 90% interval, over all the exams and for each.

With --vs the second set is compared with the first. Where the two sets hold the same exams with the same blocks (the same marks, two
detectors) the difference is resampled with the SAME picks on both sides, so what the two share (a hard break is hard for both) cancels;
the two are told apart only when the interval of the difference leaves zero out.
"""
import io, json, sys

import numpy as np

N = 5000
rng = np.random.default_rng(0)


def load(paths):
    out = []
    for p in paths:
        for e in json.load(io.open(p, encoding="utf-8"))["exams"]:
            if "blocks" not in e: sys.exit(f"{p}: the exam '{e.get('exam')}' has no blocks (a results file from before 2026-11-10: run the bench again)")
            out.append((e.get("exam", e.get("name")), np.asarray(e["blocks"], float).reshape(-1, 4)))
    return out


def shares(B, pick=None):
    """The covered and the wrong share of each resample (or of the blocks as they are)."""
    S = B.sum(0)[None, :] if pick is None else B[pick].sum(1)
    return 100 * S[:, 1] / np.maximum(1, S[:, 0]), 100 * S[:, 3] / np.maximum(1, S[:, 2])


def line(name, B):
    c, w = shares(B); c, w = c[0], w[0]
    if len(B) < 3: return f"{name}: {len(B)} blocks | ads covered {c:.1f}% of {int(B[:, 0].sum())} s | show wrongly covered {w:.2f}% of {int(B[:, 2].sum())} s | too few blocks for an interval"
    bc, bw = shares(B, rng.integers(0, len(B), (N, len(B))))
    return (f"{name}: {len(B)} blocks | ads covered {c:.1f}% [{np.percentile(bc, 5):.1f} to {np.percentile(bc, 95):.1f}] of {int(B[:, 0].sum())} s"
            f" | show wrongly covered {w:.2f}% [{np.percentile(bw, 5):.2f} to {np.percentile(bw, 95):.2f}] of {int(B[:, 2].sum())} s")


args = sys.argv[1:]
first = load(args[:args.index("--vs")] if "--vs" in args else args)
second = load(args[args.index("--vs") + 1:]) if "--vs" in args else None
for tag, exams in (("first", first), ("second", second)):
    if exams is None: continue
    if second is not None: print(f"-- the {tag} set")
    print(line("all", np.concatenate([b for _, b in exams])))
    if len(exams) > 1:
        for n, b in exams: print("   " + line(n, b))
if second is not None:
    A, B = np.concatenate([b for _, b in first]), np.concatenate([b for _, b in second])
    same = [n for n, _ in first] == [n for n, _ in second] and A.shape == B.shape and (A[:, [0, 2]] == B[:, [0, 2]]).all()
    if same:
        pick = rng.integers(0, len(A), (N, len(A)))
        (ca, wa), (cb, wb) = shares(A, pick), shares(B, pick)
    else:
        (ca, wa), (cb, wb) = shares(A, rng.integers(0, len(A), (N, len(A)))), shares(B, rng.integers(0, len(B), (N, len(B))))
    print("-- second less first, " + ("the same blocks on both sides (paired)" if same else "different blocks (not paired: a wider interval)"))
    for what, d, unit in (("ads covered", cb - ca, 1), ("show wrongly covered", wb - wa, 2)):
        lo, hi = np.percentile(d, 5), np.percentile(d, 95)
        now = (shares(B)[0][0] - shares(A)[0][0]) if unit == 1 else (shares(B)[1][0] - shares(A)[1][0])
        print(f"   {what}: {now:+.{unit}f} points [{lo:+.{unit}f} to {hi:+.{unit}f}]: " + ("told apart" if lo > 0 or hi < 0 else "not told apart"))
