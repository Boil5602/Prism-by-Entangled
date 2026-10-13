# Sweep the break watch's recordings for a web page's own chrome showing in a video window: the words the picture reader read,
# clustered into episodes (one window, gaps under 45 s). Read-only. Prints the episodes, longest first, and a tally per day and window.
import glob, os, re, sys, collections

GOLDEN = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
# phrases a service's page shows and a broadcast does not. Each is (regex, label, weight); an episode needs weight >= 2 in a frame,
# or a weight-2 phrase alone. Single nav words ("Home") count only together.
PHRASES = [
    (r"who'?s watching", "profile gate", 2),
    (r"are you still watching", "still-watching prompt", 2),
    (r"something went wrong|playback error|an error occurred|try again later|error playing", "error page", 2),
    (r"\bsign in\b|\bsigned out\b|\blog in\b", "sign-in", 2),
    (r"join live|watch now|play from (the )?(start|beginning)|start over", "title page controls", 2),
    (r"add to library|added to library|\brecord\b.*\bseries\b|recording", "library controls", 1),
    (r"recommended for you|because you watched|continue watching|more like this", "home rows", 2),
    (r"accept all|cookies?\b.*(accept|consent)|privacy settings", "cookie banner", 2),
    (r"free trial|upgrade|add-on|subscribe now|start your", "upsell", 1),
    (r"next episode|up next|autoplay", "next-episode prompt", 1),
    (r"no internet|offline|reconnect", "connection", 1),
    (r"\bhome\b", "nav:home", 1), (r"\blibrary\b", "nav:library", 1), (r"\bsearch\b", "nav:search", 1), (r"\bsettings\b", "nav:settings", 1),
    (r"\bguide\b|\bchannels?\b", "nav:guide", 1), (r"youtube tv", "brand", 1),
]
RX = [(re.compile(p, re.I), label, w) for p, label, w in PHRASES]


def hhmmss(ts):
    return "%s:%s:%s" % (ts[0:2], ts[2:4], ts[4:6])


def secs(ts):
    return int(ts[0:2]) * 3600 + int(ts[2:4]) * 60 + int(ts[4:6])


episodes = []
tally = collections.Counter()
for ev in sorted(glob.glob(os.path.join(GOLDEN, "*", "*", "events.log"))):
    day = os.path.basename(os.path.dirname(os.path.dirname(ev)))
    win = os.path.basename(os.path.dirname(ev))
    cur = None
    for line in open(ev, encoding="utf-8", errors="replace"):
        p = line.split(" ", 3)
        if len(p) < 4 or p[2] != "text":
            continue
        txt = p[3]
        hits = [(label, w) for rx, label, w in RX if rx.search(txt)]
        weight = sum(w for _, w in hits)
        nav = sum(1 for label, _ in hits if label.startswith("nav:"))
        strong = any(w >= 2 for _, w in hits)
        if not (strong or nav >= 3 or (nav >= 2 and weight >= 3)):
            continue
        t = secs(p[0]); labels = {label for label, _ in hits}
        if cur and t - cur["end"] <= 45:
            cur["end"] = t; cur["n"] += 1; cur["labels"] |= labels; cur["frames"].append(p[0])
            if len(cur["sample"]) < 3: cur["sample"].append(txt.strip()[:90])
        else:
            if cur: episodes.append(cur)
            cur = {"day": day, "win": win, "start": t, "end": t, "n": 1, "labels": set(labels), "frames": [p[0]], "sample": [txt.strip()[:90]]}
    if cur: episodes.append(cur)

# an episode is more than one reading: a single frame's words are often a caption that happened to say "search"
real = [e for e in episodes if e["n"] >= 3 or any(l in e["labels"] for l in ("profile gate", "still-watching prompt", "error page", "sign-in", "cookie banner"))]
real.sort(key=lambda e: -(e["end"] - e["start"]))
for e in real: tally[(e["day"], e["win"][-6:])] += e["end"] - e["start"]
print("%d episodes (%d of one or two frames set aside)" % (len(real), len(episodes) - len(real)))
print("--- longest first (day window start-end seconds frames | what | a sample reading)")
for e in real[:int(sys.argv[1]) if len(sys.argv) > 1 else 40]:
    print("%s %-7s %s-%s %4ds %3d | %s | %s" % (e["day"][5:], e["win"][-6:], hhmmss(e["frames"][0]), hhmmss(e["frames"][-1]), e["end"] - e["start"], e["n"], ", ".join(sorted(e["labels"]))[:60], e["sample"][0]))
print("--- seconds of chrome per day and window")
for (day, win), s in sorted(tally.items()): print("  %s %-7s %5d s" % (day[5:], win, s))
