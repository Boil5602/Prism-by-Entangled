"""The public repository's snapshot of the source (2026-10-07, the owner asked for the snapshot and the release script's fix).

Prism's public repo (Boil5602/Prism-by-Entangled) carries one commit per release: the archive's file tree at that moment, on top of the public
history and never the archive's own (the archive keeps the full history, privately). Every release publishes a binary, and the matching source
belongs beside it (GPLv3); until today the release script made the GitHub Release but never the snapshot, so the public code stood still at
the first release for eleven days.

Before a snapshot the tree is checked for the household's details: the patterns in ~/.prism/public-scrub.txt (kept on the publishing machine
and never in the tree, since the list itself names what must not be published). Any match stops the release and lists the lines; no list
file stops it too. A line of the list is a regular expression, matched without regard to case; a line beginning "case:" is matched exactly;
"#" starts a comment.

    python scripts/release/public-snapshot.py check              the check alone
    python scripts/release/public-snapshot.py push "<message>"   check, then the snapshot pushed to the public repo's main; prints its sha
"""
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LIST = os.path.expanduser("~/.prism/public-scrub.txt")
REMOTE = "public"
# the archive's own files that never go public (2026-11-05): the working instructions for Claude, which describe how the archive is kept,
# and the bug ledger, the internal record of what was asked and fixed
PRIVATE_PATHS = ("CLAUDE.md", "docs/bugs/",
                 # and, by the owner's decision of the same night, what tells when and how the house used its screens and how the project is run
                 "scripts/breakwatch/exams.json", "scripts/breakwatch/exams.md", "scripts/breakwatch/marking-todo.json", "scripts/breakwatch/passes/",
                 "docs/break-watch-scorecard.md", "docs/doctor.md", "docs/test-scripts.md")


# A release or a public snapshot runs only after 6 PM Eastern or before 6 AM (2026-10-12), unless told otherwise (--daytime /
# PRISM_DAYTIME=1). The private archive takes pushes at any hour.
def eastern_now():
    from datetime import datetime
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        return datetime.now()   # no zone data on this Windows (no tzdata package): the publishing PC keeps Eastern time


def after_hours(now=None):
    t = now or eastern_now()
    return t.hour >= 18 or t.hour < 6


def daytime_guard(allowed, what):
    if allowed or os.environ.get("PRISM_DAYTIME") == "1" or after_hours():
        return
    sys.exit(what + " runs after 6 PM Eastern (it is " + eastern_now().strftime("%H:%M") + " now); pass --daytime or PRISM_DAYTIME=1 to run it anyway")


def git(*args, check=True):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        sys.exit("git " + " ".join(args) + " failed: " + r.stderr.strip())
    return r.stdout.strip()


def patterns():
    if not os.path.exists(LIST):
        sys.exit("no scrub list at " + LIST + ": the tree cannot be checked, so nothing is published")
    out = []
    for line in open(LIST, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("case:"):
            out.append(re.compile(line[5:]))
        else:
            out.append(re.compile(line, re.IGNORECASE))
    if not out:
        sys.exit("the scrub list at " + LIST + " is empty: nothing is published")
    return out


def check():
    """The household's details in the tree being published (HEAD's files as checked out): a list of 'path:line: text'."""
    pats = patterns()
    hits = []
    for path in git("ls-files").splitlines():
        full = os.path.join(ROOT, path)
        try:
            data = open(full, "rb").read()
        except OSError:
            continue
        if b"\0" in data[:8192]:
            continue   # a binary
        text = data.decode("utf-8", errors="replace")
        private = any(path == x.rstrip("/") or path.startswith(x) for x in PRIVATE_PATHS if x.endswith("/")) or path in PRIVATE_PATHS
        timed = not private and not re.search(r"(^|/)(tests?|fixtures)/|\.data\.ts$|^packages/core/data/", path)
        for n, line in enumerate(text.splitlines(), 1):
            if any(p.search(line) for p in pats):
                hits.append(f"{path}:{n}: {line.strip()[:160]}")
            # a time of day beside a date in prose - docs, notes, comments - tells when the work was done (2026-11-05, the owner's
            # decision): dates only in what goes public
            elif timed and DATED_TIME.search(line) and (path.endswith((".md", ".json")) or COMMENT_LINE.match(line) or "//" in line):
                hits.append(f"{path}:{n}: a time of day beside a date: {line.strip()[:120]}")
    return hits


DATED_TIME = re.compile(r"20[0-9]{2}-[01][0-9]-[0-3][0-9](?:,? (?:at )?| )[0-2]?[0-9]:[0-5][0-9]")
COMMENT_LINE = re.compile(r"^\s*(//|/\*|\*|#|<!--)")


def public_tree():
    """HEAD's tree less PRIVATE_PATHS, built in a throwaway index so the archive's own index and files are untouched."""
    import tempfile
    idx = os.path.join(tempfile.mkdtemp(prefix="prism-public-"), "index")
    env = dict(os.environ, GIT_INDEX_FILE=idx)
    def gi(*args):
        r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, env=env)
        if r.returncode != 0:
            sys.exit("git " + " ".join(args) + " failed: " + r.stderr.strip())
        return r.stdout.strip()
    gi("read-tree", "HEAD")
    for path in PRIVATE_PATHS:
        gi("rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", path.rstrip("/"))
    tree = gi("write-tree")
    left = [p for p in PRIVATE_PATHS if gi("ls-tree", "-r", "--name-only", tree, "--", p.rstrip("/"))]
    if left:
        sys.exit("a private file would be published: " + ", ".join(left))
    return tree


def push(message):
    hits = check()
    if hits:
        sys.exit("the household's details are in the tree - nothing published:\n  " + "\n  ".join(hits[:40]) + ("\n  ..." if len(hits) > 40 else ""))
    # the owner's own words never reach the public repo (2026-11-05): every line strip-quotes.py flags must be described, or judged by a
    # person not to be the owner's (quotes-ok.txt); otherwise nothing is published
    q = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "strip-quotes.py"), "--gate"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if q.returncode != 0:
        sys.exit("the owner's words may still be in the tree - nothing published:\n" + "\n".join(q.stdout.strip().split("\n")[-25:]))
    if git("status", "--porcelain"):
        sys.exit("the working tree has changes: the snapshot is of committed files only")
    git("fetch", "-q", REMOTE)
    tree = public_tree()
    parent = git("rev-parse", REMOTE + "/main")
    if git("rev-parse", parent + "^{tree}") == tree:
        print("public snapshot: unchanged since " + parent[:8])
        return parent
    sha = git("commit-tree", tree, "-p", parent, "-m", message)
    git("push", REMOTE, sha + ":refs/heads/main")
    print("public snapshot: " + sha[:8] + " on " + REMOTE + "/main")
    return sha


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "check":
        h = check()
        print("\n".join(h) if h else "clean: no line of the tree matches the scrub list")
        sys.exit(1 if h else 0)
    if len(sys.argv) >= 3 and sys.argv[1] == "push":
        daytime_guard(False, "the public snapshot")
        print(push(sys.argv[2]))
        sys.exit(0)
    sys.exit(__doc__)
