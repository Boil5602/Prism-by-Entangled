"""Prism first (2026-10-08). The study's first evening took the live break watch from 57 looks a minute a window to 27: reading 140,000
frames off the disk, a whole-day replay and a training run on the card the windows draw with, all at once, and "below normal" priority
protected nothing (the disk and the card have no such thing). A study step now asks here before each piece of work: while Prism is
looking less often than it should, the step waits.

    from gentle import wait_if_busy
    wait_if_busy()          # in every loop that reads many files or works the card
"""
import os
import time

BENCH = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "bench")
_last = [0.0, True]


def looks_a_minute():
    """The most looks any window got in the last 60 s (a frame is written at each look while recording is on); None when nothing is
    being recorded at all, which tells nothing."""
    now = time.time(); best = None
    try:
        for w in os.scandir(BENCH):
            if not w.is_dir(): continue
            n = 0
            with os.scandir(w.path) as it:
                for e in it:
                    if e.name.endswith(".gray") and now - e.stat().st_mtime <= 60: n += 1
            if n and (best is None or n > best): best = n
    except OSError:
        return None
    return best


def wait_if_busy(floor=54, every=20, say=print):
    """Checked at most every `every` seconds: under `floor` looks a minute, wait (and say so once) until Prism is back to it."""
    if time.time() - _last[0] < every: return
    told = False
    while True:
        n = looks_a_minute(); _last[0] = time.time()
        if n is None or n >= floor:
            if told: say(f"   Prism is back to {n} looks a minute: going on", flush=True)
            return
        if not told: say(f"   Prism is at {n} looks a minute (it should be 56 or more): waiting", flush=True); told = True
        time.sleep(30)
