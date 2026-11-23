#!/usr/bin/env python
"""The PRISM extension's store package sent to the Chrome Web Store, and submitted for Google's review.

    python scripts/release/publish-chrome.py [--zip <package.zip>] [--dry-run] [--status] [--upload-only] [--daytime]

- The package is prototypes/prism-veil-extension/dist/prism-extension-chromium-<version>.zip for the version in the source's manifest
  (node build-firefox.mjs chromium makes it), or the one --zip names.
- The owner's access is in ~/.prism/chrome-webstore.json, outside the repository:
    { "client_id": "...", "client_secret": "...", "refresh_token": "...", "publisher_id": "..." }
  made once in Google Cloud and the OAuth Playground (docs/veil-release-checklist.md, section 7a). The script reads it, asks Google
  for a short-lived token and never prints any of it.
- Checks before anything is sent: the package's manifest has the store's name and the version, the version is higher than the
  one the store has, and there is no start page in the package (the store build's rule SB-2).
- --dry-run does the checks and reads the store's status, and sends nothing. --status reads the status alone.
- --upload-only sends the package as a draft and does not submit it for review.
- On a weekday an upload waits for the evening (the public-after-hours rule; weekends at any hour), --daytime to override.

The Chrome Web Store API, version 2 (developer.chrome.com/docs/webstore/using-api, read 2026-11-17).
"""
import argparse, datetime, io, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request, zipfile

ITEM = "dhdlohmmnplaadhpafnbmamjciapcnfj"   # PRISM by Entangled in the Chrome Web Store
API = "https://chromewebstore.googleapis.com"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXT = os.path.join(ROOT, "prototypes", "prism-veil-extension")
KEYS = os.path.expanduser("~/.prism/chrome-webstore.json")

ap = argparse.ArgumentParser()
ap.add_argument("--zip")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--status", action="store_true")
ap.add_argument("--upload-only", action="store_true")
ap.add_argument("--daytime", action="store_true", help="allow the upload in Eastern daytime")
a = ap.parse_args()


def ver(s): return tuple(int(x) for x in s.split("."))


def call(method, url, token, body=None, ctype=None):
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if ctype: req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        sys.exit("%s %s: HTTP %d %s" % (method, url.split("/")[-1], e.code, e.read().decode("utf-8", "replace")[:600]))


# ---- the package
with io.open(os.path.join(EXT, "manifest.json"), encoding="utf-8") as f: src_version = json.load(f)["version"]
path = a.zip or os.path.join(EXT, "dist", "prism-extension-chromium-%s.zip" % src_version)
version = None
if not a.status:
    if not os.path.exists(path): sys.exit("no package at %s (node build-firefox.mjs chromium makes it)" % path)
    with zipfile.ZipFile(path) as z:
        names = z.namelist(); man = json.loads(z.read("manifest.json").decode("utf-8"))
    version = man["version"]
    if man.get("name") != "PRISM by Entangled": sys.exit("the package's name is %r: this is not the store build" % man.get("name"))
    if any(re.match(r"ntp\.(html|js|css)$", n) for n in names): sys.exit("the package has the start page: this is not the store build")
    if not a.zip and version != src_version: sys.exit("the package is %s and the source is %s: build again" % (version, src_version))
    print("package: %s, version %s, %.1f MB, %d files" % (os.path.basename(path), version, os.path.getsize(path) / 1e6, len(names)))

# ---- the owner's access
if not os.path.exists(KEYS):
    if a.dry_run: print("dry run: no %s yet, so the store's status was not read; nothing sent" % KEYS); sys.exit(0)
    sys.exit("no %s: the one-time setup is in docs/veil-release-checklist.md, section 7a" % KEYS)
with io.open(KEYS, encoding="utf-8") as f: k = json.load(f)
for need in ("client_id", "client_secret", "refresh_token", "publisher_id"):
    if not str(k.get(need, "")).strip(): sys.exit("%s has no %s" % (KEYS, need))
form = urllib.parse.urlencode({"client_id": k["client_id"].strip(), "client_secret": k["client_secret"].strip(), "refresh_token": k["refresh_token"].strip(), "grant_type": "refresh_token"}).encode()
try:
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=form), timeout=60) as r: token = json.loads(r.read().decode("utf-8"))["access_token"]
except urllib.error.HTTPError as e:
    sys.exit("Google refused the saved access (HTTP %d): the refresh token may have expired; make a new one (section 7a)" % e.code)
item = "%s/v2/publishers/%s/items/%s" % (API, urllib.parse.quote(str(k["publisher_id"]).strip()), ITEM)

# ---- what the store has
st = call("GET", item + ":fetchStatus", token)
def rev(key):
    r = st.get(key) or {}
    return r.get("state", "-"), ", ".join(c.get("crxVersion", "?") for c in r.get("distributionChannels", [])) or "-"
pub, sub = rev("publishedItemRevisionStatus"), rev("submittedItemRevisionStatus")
print("store: published %s (%s); submitted %s (%s)%s%s" % (pub[1], pub[0], sub[1], sub[0], "; TAKEN DOWN" if st.get("takenDown") else "", "; WARNED" if st.get("warned") else ""))
if a.status: sys.exit(0)
have = [v for v in (pub[1], sub[1]) if re.match(r"^\d+(\.\d+)*$", v)]
if have and ver(version) <= max(ver(v) for v in have): sys.exit("version %s is not higher than the store's %s: raise the version in manifest.json and build again" % (version, max(have, key=ver)))
if sub[0] == "PENDING_REVIEW": print("note: version %s is in review now; a new submission takes its place" % sub[1])
if a.dry_run: print("dry run: the checks pass; nothing sent"); sys.exit(0)
if not a.daytime:
    import eastern   # scripts/release/eastern.py: the Eastern hour, worked out when the PC has no zone data
    if eastern.daytime(): sys.exit("on a weekday an upload waits for the evening (after 6 PM Eastern); --daytime to override, --dry-run to check alone")

# ---- the upload, then the submission
with open(path, "rb") as f: body = f.read()
up = call("POST", "%s/upload/v2/publishers/%s/items/%s:upload" % (API, urllib.parse.quote(str(k["publisher_id"]).strip()), ITEM), token, body, "application/zip")
state = up.get("uploadState", "?")
for _ in range(60):
    if "IN_PROGRESS" not in state: break
    time.sleep(5); state = call("GET", item + ":fetchStatus", token).get("lastAsyncUploadState", "?")
if state != "SUCCEEDED": sys.exit("the upload did not succeed: %s %s" % (state, json.dumps(up)[:400]))
print("uploaded: version %s is a draft in the store" % (up.get("crxVersion") or version))
if a.upload_only: print("not submitted (--upload-only): Submit for review is in the dashboard"); sys.exit(0)
p = call("POST", item + ":publish", token, b"{}", "application/json")
print("submitted for review: state %s" % p.get("state", "?"))
for w in (p.get("warningInfo") or {}).get("warnings", []): print("  warning: %s %s" % (w.get("reason", ""), w.get("description", "")))
