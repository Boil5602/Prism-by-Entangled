"""A channel gate, measured (2026-11-17): the learned detector covers on its own judgement only on channels listed with a measured rate.

    python scripts/breakwatch/chgate.py <train-A.txt> <train-B.txt>

Reads the held-out-by-channel rows of two train2.py runs over the same seconds (each channel scored by trees that never saw it, two
different splits of the channels). A channel is LISTED when run A gives it at least MIN show seconds and no more than T of them wrongly
covered. The listed channels are then scored on run B (the choice and the score are not the same model's). Off the list nothing the
detector finds is covered, so those ad seconds count as missed and those show seconds as clean."""
import re, sys
ROW = re.compile(r"^\s*(.+?):\s+rules ads\s+[\d.]+% wrong\s+[\d.]+%\s+model ads\s+([\d.]+)% wrong\s+([\d.]+)%\s+\((\d+) ad s, (\d+) show s")
def rows(p):
    out = {}
    for line in open(p, encoding="utf-8", errors="replace"):
        m = ROW.match(line)
        if m: out[m.group(1)] = (float(m.group(2)) / 100 * int(m.group(4)), float(m.group(3)) / 100 * int(m.group(5)), int(m.group(4)), int(m.group(5)))
    return out
A, B = rows(sys.argv[1]), rows(sys.argv[2])
both = sorted(set(A) & set(B))
ad = sum(B[c][2] for c in both); show = sum(B[c][3] for c in both)
print("%d channels in both runs, %d ad s, %d show s" % (len(both), ad, show))
print("no gate: ads %.1f%%, show wrongly %.2f%%" % (100 * sum(B[c][0] for c in both) / ad, 100 * sum(B[c][1] for c in both) / show))
print("%-22s %8s %10s %12s %14s %16s" % ("listed when (run A)", "channels", "ad time", "ads, all", "show wrongly", "ads, on listed"))
for mins in (1500, 3000):
    for t in (1, 2, 3, 5, 100):
        L = [c for c in both if A[c][3] >= mins and 100 * A[c][1] / A[c][3] <= t]
        if not L: continue
        la = sum(B[c][2] for c in L); cov = sum(B[c][0] for c in L); wr = sum(B[c][1] for c in L)
        print("%-22s %8d %9.1f%% %11.1f%% %13.2f%% %15.1f%%" % ("<= %d%%, >= %d s" % (t, mins), len(L), 100 * la / ad, 100 * cov / ad, 100 * wr / show, 100 * cov / la))
