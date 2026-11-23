#!/usr/bin/env python
"""One command for a release of the PRISM extension to the stores: checks, build, tests, the public source snapshot, then the
Chrome Web Store and addons.mozilla.org, each for its own review.

    python scripts/release/publish-extension.py --notes "<what is new>" [--dry-run] [--only chrome|firefox] [--daytime]

In order, stopping at the first thing that fails:
 1. the tree is clean and pushed (the version in prototypes/prism-veil-extension/manifest.json is the release's);
 2. the packages are built again (node build-firefox.mjs), the extension's tests pass, and the Firefox build is walked in a hidden
    Firefox (firefox-check.mjs: the settings panel over a page, and the errors of every part of the extension);
 3. both stores are asked what they have (each script's own dry run): the access works, the version is higher;
 4. the public repository gets its snapshot (public-snapshot.py push: the scrub and quote checks, the evening rule), which is the
    source Mozilla's reviewer builds from;
 5. the Chrome package is uploaded and submitted (publish-chrome.py);
 6. the Firefox package is uploaded with the source and submitted (publish-firefox.py);
 7. the submitted packages are copied to dist/<version>-submitted/, the record of what each store was sent.
--dry-run does 1 to 3 and sends nothing. Edge has no listing of its own yet: it installs from the Chrome Web Store.
Review is the stores' own step: a version is live when each store approves it, usually within days.
"""
import argparse, io, json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXT = os.path.join(ROOT, "prototypes", "prism-veil-extension")
HERE = os.path.dirname(os.path.abspath(__file__))

ap = argparse.ArgumentParser()
ap.add_argument("--notes", required=True, help="what is new, a sentence or two (Firefox's listing shows it; the snapshot's message)")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--only", choices=["chrome", "firefox"])
ap.add_argument("--daytime", action="store_true")
a = ap.parse_args()
stores = [a.only] if a.only else ["chrome", "firefox"]
SHELL = os.name == "nt"


def run(cmd, cwd=ROOT, env=None, shell=False):
    print("> " + (cmd if isinstance(cmd, str) else " ".join(cmd[:4]) + (" ..." if len(cmd) > 4 else "")), flush=True)
    r = subprocess.run(cmd, cwd=cwd, env=env, shell=shell)
    if r.returncode != 0: sys.exit("stopped: that step failed (exit %d); nothing after it ran" % r.returncode)


def out(cmd): return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8").stdout.strip()


with io.open(os.path.join(EXT, "manifest.json"), encoding="utf-8") as f: version = json.load(f)["version"]
print("PRISM extension %s to: %s%s" % (version, ", ".join(stores), " (dry run)" if a.dry_run else ""))

# 1. clean and pushed
dirty = out(["git", "status", "--porcelain"])
if dirty: sys.exit("the tree is not clean; commit first:\n" + dirty)
subprocess.run(["git", "fetch", "-q", "origin"], cwd=ROOT)
if out(["git", "rev-parse", "HEAD"]) != out(["git", "rev-parse", "origin/main"]): sys.exit("HEAD is not origin/main: push first")

# 2. build and tests
run(["node", "build-firefox.mjs"], cwd=EXT)
run("npx vitest run --config tests/vitest.config.mjs", cwd=EXT, shell=True)
dirty = out(["git", "status", "--porcelain"])
if dirty: sys.exit("the build changed tracked files; commit them and run again:\n" + dirty)
# the Firefox build walked in a hidden Firefox (2026-11-19: 0.9.41's settings panel did not close there, and the tests could not
# see it): the settings open over a page, say their height, name the site and close, with no error in any part of the extension
if "firefox" in stores: run(["node", os.path.join(HERE, "firefox-check.mjs")])

# 3. each store's own checks
py = sys.executable
chrome = [py, os.path.join(HERE, "publish-chrome.py")]
firefox = [py, os.path.join(HERE, "publish-firefox.py"), "--notes", a.notes]
if "chrome" in stores: run(chrome + ["--dry-run"])
if "firefox" in stores: run(firefox + ["--dry-run"])
if "chrome" in stores and not os.path.exists(os.path.expanduser("~/.prism/chrome-webstore.json")) and not a.dry_run:
    sys.exit("stopped: no ~/.prism/chrome-webstore.json (docs/veil-release-checklist.md, section 7a); nothing was sent")
if a.dry_run: print("dry run: every check that could run has passed; nothing sent"); sys.exit(0)

# 4. the public snapshot (Mozilla's reviewer builds from it)
env = dict(os.environ)
if a.daytime: env["PRISM_DAYTIME"] = "1"
run([py, os.path.join(HERE, "public-snapshot.py"), "push", "PRISM extension %s\n\n%s" % (version, a.notes)], env=env)

# 5, 6. the stores
day = ["--daytime"] if a.daytime else []
sent = []
if "chrome" in stores: run(chrome + day); sent.append("prism-extension-chromium-%s.zip" % version)
if "firefox" in stores: run(firefox + day); sent += ["prism-extension-firefox-%s.zip" % version, "prism-source-%s.zip" % version]

# 7. the record
keep = os.path.join(EXT, "dist", "%s-submitted" % version); os.makedirs(keep, exist_ok=True)
for n in sent:
    p = os.path.join(EXT, "dist", n)
    if os.path.exists(p): shutil.copy2(p, keep)
print("sent for review: %s. Kept in dist/%s-submitted/" % (", ".join(stores), version))
