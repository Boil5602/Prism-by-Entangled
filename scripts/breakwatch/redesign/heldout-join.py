"""The held-out-by-channel figures from one or more runs' text files (2026-11-09): a run stopped by a memory guard or a reboot resumes
with --skip-done, and this joins the per-channel lines of all of them into the ALL figures train2.py would have printed.

    python -I scripts/breakwatch/redesign/heldout-join.py <run.txt> [<run.txt> ...] [--against <other run.txt> ...]

--against: a second set of runs (the same channels without the repetition columns, say) read on the channels both sets scored."""
import io, re, sys

pat = re.compile(r"^\s*(.+?):\s+rules ads\s+([\d.]+)% wrong\s+([\d.]+)%\s+model ads\s+([\d.]+)% wrong\s+([\d.]+)%\s+\((\d+) ad s, (\d+) show s")


def read(paths):
    d = {}
    for p in paths:
        for line in io.open(p, encoding="utf-8", errors="replace"):
            m = pat.match(line)
            if m and m.group(1) not in d: d[m.group(1)] = tuple(float(x) for x in m.groups()[1:])
    return d


def agg(d, chans):
    ad = sum(d[c][4] for c in chans); sh = sum(d[c][5] for c in chans)
    return 100 * sum(d[c][2] / 100 * d[c][4] for c in chans) / ad, 100 * sum(d[c][3] / 100 * d[c][5] for c in chans) / sh, int(ad), int(sh)


if __name__ == "__main__":
    args = sys.argv[1:]
    mine = args[:args.index("--against")] if "--against" in args else args
    other = args[args.index("--against") + 1:] if "--against" in args else []
    a = read(mine)
    chans = sorted(a)
    if other:
        b = read(other); chans = [c for c in chans if c in b]
    r = agg(a, chans)
    print(f"{len(chans)} channels: model ads covered {r[0]:.1f}%  show wrongly covered {r[1]:.2f}%  ({r[2]} ad s, {r[3]} show s)")
    if other:
        s = agg(b, chans)
        print(f"against: ads covered {s[0]:.1f}%  show wrongly covered {s[1]:.2f}%; better on {sum(1 for c in chans if a[c][2] > b[c][2])} channels, wrong more on {sum(1 for c in chans if a[c][3] > b[c][3])}")
