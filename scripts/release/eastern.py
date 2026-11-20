"""The Eastern clock for the public-after-hours rule, with or without zone data on the PC.

Windows has no zone database of its own and Python's zoneinfo then needs the tzdata package, which the publishing PC does not
have. Without it the hour is worked out: daylight time from the second Sunday of March (07:00 UTC) to the first Sunday of
November (06:00 UTC). A fixed five hours behind UTC, which publish-chrome.py and publish-firefox.py fell back to until
2026-11-19, reads one hour behind the wall clock all summer: it let an upload go until 7 AM Eastern and held one until 7 PM.
"""
from datetime import date, datetime, timedelta, timezone


def eastern_from_utc(utc):
    """utc: an aware UTC datetime. The same moment on the Eastern wall clock (aware, with its offset)."""
    y = utc.year

    def nth_sunday(month, n):
        d = date(y, month, 1); first = d + timedelta(days=(6 - d.weekday()) % 7); return first + timedelta(weeks=n - 1)
    start = datetime(y, 3, nth_sunday(3, 2).day, 7, tzinfo=timezone.utc)
    end = datetime(y, 11, nth_sunday(11, 1).day, 6, tzinfo=timezone.utc)
    off = -4 if start <= utc < end else -5
    return utc.astimezone(timezone(timedelta(hours=off)))


def eastern_now():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        return eastern_from_utc(datetime.now(timezone.utc))


def daytime(now=None):
    """True in the hours an upload waits: a weekday from 8 AM to 6 PM Eastern (from 8 AM since 2026-11-20). Saturday and Sunday are free at any hour."""
    t = now or eastern_now()
    return t.weekday() < 5 and 8 <= t.hour < 18


if __name__ == "__main__":
    # the worked-out hour against known moments (run: python scripts/release/eastern.py)
    cases = [((2026, 7, 15, 21, 30), 17, -4), ((2026, 7, 15, 22, 0), 18, -4), ((2026, 11, 19, 13, 52), 8, -5), ((2026, 1, 5, 23, 0), 18, -5),
             ((2026, 3, 8, 6, 59), 1, -5), ((2026, 3, 8, 7, 0), 3, -4), ((2026, 11, 1, 5, 59), 1, -4), ((2026, 11, 1, 6, 0), 1, -5)]
    bad = 0
    for utc, hour, off in cases:
        t = eastern_from_utc(datetime(*utc, tzinfo=timezone.utc))
        ok = t.hour == hour and t.utcoffset() == timedelta(hours=off)
        bad += not ok
        print("%s  %s UTC -> %s" % ("ok  " if ok else "FAIL", "%04d-%02d-%02d %02d:%02d" % utc, t.strftime("%H:%M %z")))
    print("now: %s, daytime rule %s" % (eastern_now().strftime("%a %H:%M %z"), "holds an upload" if daytime() else "lets an upload go"))
    raise SystemExit(1 if bad else 0)
