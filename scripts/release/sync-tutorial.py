"""The tour, one source for Prism and the website (2026-10-11, "make the tutorial available on the website ... Is there any way to
keep them in sync?").

The source is targets/win-host/PrismHost/Assets/tutorial: tutorial.json (the subjects and their words) and one picture a page.
Prism reads it where it lies. The website reads a copy: src/data/tutorial.json and public/prism/tour/*.png in its own repository.

    python scripts/release/sync-tutorial.py --validate                 the source is whole (every picture there, every action known)
    python scripts/release/sync-tutorial.py --site <website folder>    copy it to the website (publish-windows.py does this)
    python scripts/release/sync-tutorial.py --site <folder> --check    exit 1 when the website's copy differs (scripts/verify.mjs)

A website folder that is not there is not an error for --check: the check is for the machine that holds both.
"""
import argparse, filecmp, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(REPO, "targets", "win-host", "PrismHost", "Assets", "tutorial")
ACTIONS_IN = os.path.join(REPO, "targets", "win-host", "PrismHost", "MainWindow.TutorialText.cs")

ap = argparse.ArgumentParser()
ap.add_argument("--validate", action="store_true")
ap.add_argument("--site")
ap.add_argument("--check", action="store_true")
a = ap.parse_args()


def known_actions():
    """The actions Prism can run, read from where they are written: the lines of the form ["name"] = ..."""
    names = set()
    for line in open(ACTIONS_IN, encoding="utf-8"):
        s = line.strip()
        if s.startswith('["') and '"] =' in s:
            names.add(s[2:s.index('"]')])
    return names


def validate():
    problems = []
    raw = open(os.path.join(SRC, "tutorial.json"), "rb").read()
    if any(b > 127 for b in raw):
        problems.append("tutorial.json holds a character outside ASCII")
    doc = json.loads(raw.decode("utf-8"))
    actions = known_actions()
    ids, pictures, pages = set(), set(), 0
    for s in doc.get("subjects", []):
        if s.get("id") in ids:
            problems.append("subject id twice: %s" % s.get("id"))
        ids.add(s.get("id"))
        for key in ("id", "title", "about"):
            if not s.get(key):
                problems.append("a subject has no %s" % key)
        for p in s.get("pages", []):
            pages += 1
            name = p.get("picture") or ""
            if name in pictures:
                problems.append("picture used twice: %s" % name)
            pictures.add(name)
            if not os.path.exists(os.path.join(SRC, name + ".png")):
                problems.append("no picture for the page '%s' (%s.png)" % (p.get("title"), name))
            if not p.get("title") or not p.get("body"):
                problems.append("a page of '%s' has no title or no body" % s.get("title"))
            o = p.get("open")
            if o is not None:
                if o.get("action") not in actions:
                    problems.append("'%s' opens an action Prism does not have: %s" % (p.get("title"), o.get("action")))
                if not o.get("label") or not o.get("where"):
                    problems.append("'%s' opens something with no label, or no words for the website" % p.get("title"))
            # the website's prose check refuses a semicolon, and on-screen text never joins clauses with a spaced hyphen
            for text in [p.get("title", ""), p.get("body", "")] + list(p.get("points", [])):
                if ";" in text or " - " in text:
                    problems.append("a semicolon or a spaced hyphen in: %s" % text[:60])
    on_disk = {f[:-4] for f in os.listdir(SRC) if f.endswith(".png")}
    for extra in sorted(on_disk - pictures):
        problems.append("a picture no page uses: %s.png" % extra)
    if pages == 0:
        problems.append("no pages")
    return problems, len(ids), pages


def site_paths(site):
    return os.path.join(site, "src", "data", "tutorial.json"), os.path.join(site, "public", "prism", "tour")


problems, n_subjects, n_pages = validate()
if problems:
    print("the tour's source is not whole:")
    for p in problems:
        print("  " + p)
    sys.exit(1)
print("the tour's source: %d subjects, %d pages, every picture there, every action known" % (n_subjects, n_pages))

if a.site:
    data, pics = site_paths(a.site)
    names = sorted(f for f in os.listdir(SRC) if f.endswith(".png"))
    if a.check:
        if not os.path.isdir(os.path.join(a.site, "src")):
            print("no website folder at %s: nothing to compare" % a.site)
            sys.exit(0)
        differs = []
        # by its text, whatever the line endings: the website's repository may check the file out with Windows line endings
        def text(path): return open(path, 'rb').read().replace(bytes([13, 10]), bytes([10]))
        if not os.path.exists(data) or text(os.path.join(SRC, "tutorial.json")) != text(data):
            differs.append("tutorial.json")
        there = sorted(f for f in os.listdir(pics) if f.endswith(".png")) if os.path.isdir(pics) else []
        for f in names:
            if f not in there or not filecmp.cmp(os.path.join(SRC, f), os.path.join(pics, f), shallow=False):
                differs.append(f)
        for f in there:
            if f not in names:
                differs.append(f + " (only on the website)")
        if differs:
            print("the website's tour differs from Prism's: " + ", ".join(differs))
            print("run: python scripts/release/sync-tutorial.py --site " + a.site)
            sys.exit(1)
        print("the website's tour matches Prism's")
    else:
        os.makedirs(os.path.dirname(data), exist_ok=True)
        os.makedirs(pics, exist_ok=True)
        shutil.copyfile(os.path.join(SRC, "tutorial.json"), data)
        for f in names:
            shutil.copyfile(os.path.join(SRC, f), os.path.join(pics, f))
        for f in os.listdir(pics):
            if f.endswith(".png") and f not in names:
                os.remove(os.path.join(pics, f))
        print("website tour updated: %s and %d pictures in %s" % (data, len(names), pics))
