"""The public repository's snapshot of the source (2026-10-07, "Yes, push the snapshot and fix the release script").

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
        for n, line in enumerate(text.splitlines(), 1):
            if any(p.search(line) for p in pats):
                hits.append(f"{path}:{n}: {line.strip()[:160]}")
    return hits


def push(message):
    hits = check()
    if hits:
        sys.exit("the household's details are in the tree - nothing published:\n  " + "\n  ".join(hits[:40]) + ("\n  ..." if len(hits) > 40 else ""))
    if git("status", "--porcelain"):
        sys.exit("the working tree has changes: the snapshot is of committed files only")
    git("fetch", "-q", REMOTE)
    tree = git("rev-parse", "HEAD^{tree}")
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
        print(push(sys.argv[2]))
        sys.exit(0)
    sys.exit(__doc__)
