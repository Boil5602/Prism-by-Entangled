"""Keeps the bench's recording (2026-10-07, "let's kick ass with the model then. What can I do to help"): the bench prunes each window to its
last frames, so this copies what is new into diagnostics/golden/<day> for marking and training - frames not yet kept, each window's
events.log lines newer than the last kept one, and Prism's own calls (covers, restarts) from host.log. Safe to run again and again.

    python scripts/breakwatch/keep.py            once
    python scripts/breakwatch/keep.py --every 1800   every half hour, for as long as it runs

Every frame and line goes to the folder of the date it was RECORDED on (2026-10-08). The bench names a frame, and stamps a line, with the
time of day alone, and the first cut filed everything under the date of the keep: the first keep after midnight copied the whole evening
before into the new day's folder (the same seconds under two days' names, and a day whose 16:00 was yesterday's), and "newer than the last
kept line" compared times of day, so every later keep took yesterday's lines again - 25 copies of the evening in the new day's log, the
morning before laid over the morning. Found when a model trained on the two days scored worse than on one.
"""
import os
import re
import shutil
import sys
import time

DIAG = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics")
BENCH = os.path.join(DIAG, "bench")
GOLDEN = os.path.join(DIAG, "golden")
CALLS = (": break (", ": show (", "brain ready", "said Not an ad", "covered again", "the stream's ad cue")


def tod(s):
    """Seconds of the day from HHMMSS... or HH:MM:SS..."""
    s = s.replace(":", "")
    return int(s[:2]) * 3600 + int(s[2:4]) * 60 + int(s[4:6])


def day_name(epoch):
    return time.strftime("%Y-%m-%d", time.localtime(epoch))


def frame_date(path, name, now):
    """The date a bench frame was recorded on. Its file's own date when the file was written as the frame was taken (its time agrees with
    the name); else by the name alone - the bench holds less than a day, so a time of day later than now is yesterday's."""
    t = tod(name)
    m = os.path.getmtime(path)
    lm = time.localtime(m)
    if abs(lm.tm_hour * 3600 + lm.tm_min * 60 + lm.tm_sec - t) <= 120:
        return day_name(m)
    ln = time.localtime(now)
    return day_name(now - (86400 if t > ln.tm_hour * 3600 + ln.tm_min * 60 + ln.tm_sec + 60 else 0))


def line_dates(times, last_epoch):
    """The date of each line of a log that carries the time of day alone. The log is in order, so walking back from its last line (written
    on the date the file was last touched) each jump UP in the time of day is a midnight crossed."""
    out = [""] * len(times)
    lt = time.localtime(last_epoch)
    noon = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 12, 0, 0, 0, 0, -1))
    prev = None
    for i in range(len(times) - 1, -1, -1):
        if prev is not None and times[i] > prev + 3600:
            noon -= 86400
        prev = times[i]
        out[i] = day_name(noon)
    return out


def dated_lines(path, stamp):
    """[(date, line)] for every line of a log that begins with a time of day (`stamp`: the regular expression of that beginning)."""
    if not os.path.exists(path):
        return []
    lines = [l for l in open(path, encoding="utf-8", errors="replace") if stamp.match(l)]
    return list(zip(line_dates([tod(l[:8]) for l in lines], os.path.getmtime(path)), lines))


def last_stamp(path):
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        f.seek(max(0, os.path.getsize(path) - 4096))
        tail = f.read().decode("utf-8", "replace").strip().splitlines()
    return tail[-1].split(" ", 1)[0] if tail else ""


EVENT = re.compile(r"\d{9} ")
CALL = re.compile(r"\d\d:\d\d:\d\d")


def keep_once():
    now = time.time()
    copied = {}
    for win in os.listdir(BENCH):
        src = os.path.join(BENCH, win)
        if not os.path.isdir(src):
            continue
        have = {}
        for f in os.listdir(src):
            if not f.endswith(".gray"):
                continue
            p = os.path.join(src, f)
            try:
                day = frame_date(p, f, now)
                out = os.path.join(GOLDEN, day, win)
                if day not in have:
                    os.makedirs(out, exist_ok=True)
                    have[day] = set(os.listdir(out))
                if f not in have[day]:
                    shutil.copy2(p, os.path.join(out, f)); copied[day] = copied.get(day, 0) + 1
            except OSError:
                pass                                   # pruned while copying
        # each date's lines to that date's log: the ones after its last kept line (times of one date compare)
        by_day = {}
        for day, l in dated_lines(os.path.join(src, "events.log"), EVENT):
            by_day.setdefault(day, []).append(l)
        for day, lines in by_day.items():
            out = os.path.join(GOLDEN, day, win, "events.log")
            last = last_stamp(out)
            new = [l for l in lines if l[:9] > last]
            if new and (os.path.isdir(os.path.dirname(out)) or day == day_name(now)):
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "a", encoding="utf-8") as f:
                    f.writelines(new)
    # Prism's calls for each date (covers, lifts, restarts), the marking page's amber stretches
    by_day = {}
    for day, l in dated_lines(os.path.join(DIAG, "host.log"), CALL):
        if any(p in l for p in CALLS):
            by_day.setdefault(day, []).append(l.rstrip("\n"))
    for day, lines in by_day.items():
        if not os.path.isdir(os.path.join(GOLDEN, day)):
            continue
        calls = os.path.join(GOLDEN, day, "calls.log")
        have = set(open(calls, encoding="utf-8", errors="replace").read().splitlines()) if os.path.exists(calls) else set()
        with open(calls, "a", encoding="utf-8") as f:
            for l in lines:
                if l not in have:
                    f.write(l + "\n")
    lib = keep_library(now)
    print(time.strftime("%H:%M:%S"), "kept", ", ".join(f"{n} frames into {d}" for d, n in sorted(copied.items())) or "no new frames", "| library", lib, flush=True)


LIBRARY = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "breakwatch")


def keep_library(now):
    """The break watch's own memory as it stands - the ads it knows by picture and by sound, each channel's learned logo - copied to
    golden/<day>/library/<HHMMSS>. A replay must use what Prism knew BEFORE the stretch it replays (2026-10-08): replayed with the
    library of the moment, which has since learned those very breaks, the known-ad readings come out better than they were live -
    in training and in an exam alike. exam.py --library names the copy to hand the replay as BWDIR. Skipped while nothing has changed."""
    try:
        src = [f for f in os.listdir(LIBRARY) if f.endswith((".bin", ".logo"))]
        if not src:
            return "none"
        stamp = max(os.path.getmtime(os.path.join(LIBRARY, f)) for f in src)
        root = os.path.join(GOLDEN, day_name(now), "library")
        os.makedirs(root, exist_ok=True)
        last = sorted(os.listdir(root))
        if last and max((os.path.getmtime(os.path.join(root, last[-1], f)) for f in os.listdir(os.path.join(root, last[-1]))), default=0) >= stamp:
            return "unchanged"
        dest = os.path.join(root, time.strftime("%H%M%S", time.localtime(now)))
        os.makedirs(dest, exist_ok=True)
        for f in src:
            shutil.copy2(os.path.join(LIBRARY, f), os.path.join(dest, f))
        return os.path.basename(dest)
    except OSError as e:
        return "not kept (" + str(e) + ")"


if __name__ == "__main__":
    if "--every" in sys.argv:
        every = int(sys.argv[sys.argv.index("--every") + 1])
        while True:
            keep_once(); time.sleep(every)
    keep_once()
