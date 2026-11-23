#!/usr/bin/env python
"""The PRISM extension's Firefox package sent to addons.mozilla.org as a new listed version, with its source, for Mozilla's review.

    python scripts/release/publish-firefox.py --notes "<what is new>" [--zip <package.zip>] [--dry-run] [--status] [--daytime]

- The package is prototypes/prism-veil-extension/dist/prism-extension-firefox-<version>.zip for the version in the source's manifest
  (node build-firefox.mjs firefox makes it), or the one --zip names.
- The owner's access is in ~/.prism/amo.env, outside the repository: AMO_JWT_ISSUER and AMO_JWT_SECRET, made on
  https://addons.mozilla.org/developers/addon/api/key/ while signed in to the account that owns the add-on. The script signs a
  short-lived token with them and never prints either.
- Checks before anything is sent: the package carries the add-on's id and the version, the key's account is one of the add-on's
  authors, and the version is higher than every version the store has (a version number is used once, on either channel).
- The source goes with it: the public repository's snapshot (git archive public/main), which is what a reviewer builds from
  (prototypes/prism-veil-extension/SOURCE-NOTES.md). The snapshot must hold this version: scripts/release/publish-extension.py
  pushes it first. The package carries a minified library (vendor/tesseract), so Mozilla asks for the source of every version.
- --notes are the version's release notes on the listing. The notes for the reviewer are docs/veil-amo-reviewer-notes.md when that
  file is there (3,000 characters at most).
- --dry-run does the checks, reads the store's state and builds the source archive, and sends nothing. --status reads the state alone.
- On a weekday an upload waits for the evening (the public-after-hours rule; weekends at any hour), --daytime to override.

The addons.mozilla.org API, version 5 (mozilla.github.io/addons-server/topics/api/addons.html, read 2026-11-18). Mozilla says it can
change without warning: a refusal prints what the store answered.
"""
import argparse, base64, datetime, hashlib, hmac, io, json, os, re, secrets, subprocess, sys, time, urllib.error, urllib.request, zipfile

GUID = "prism-veil@entangled.world"
API = "https://addons.mozilla.org/api/v5/"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXT = os.path.join(ROOT, "prototypes", "prism-veil-extension")
KEYS = os.path.expanduser("~/.prism/amo.env")
REVIEWER = os.path.join(ROOT, "docs", "veil-amo-reviewer-notes.md")

ap = argparse.ArgumentParser()
ap.add_argument("--notes")
ap.add_argument("--zip")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--status", action="store_true")
ap.add_argument("--daytime", action="store_true", help="allow the upload in Eastern daytime")
a = ap.parse_args()


def ver(s): return tuple(int(x) for x in s.split("."))


# ---- the package
with io.open(os.path.join(EXT, "manifest.json"), encoding="utf-8") as f: src_version = json.load(f)["version"]
path = a.zip or os.path.join(EXT, "dist", "prism-extension-firefox-%s.zip" % src_version)
version = None
if not a.status:
    if not (a.notes or "").strip(): sys.exit("--notes: say what is new in this version (the listing shows it)")
    if not os.path.exists(path): sys.exit("no package at %s (node build-firefox.mjs firefox makes it)" % path)
    with zipfile.ZipFile(path) as z: man = json.loads(z.read("manifest.json").decode("utf-8"))
    version = man["version"]
    if ((man.get("browser_specific_settings") or {}).get("gecko") or {}).get("id") != GUID: sys.exit("the package is not the Firefox build: no add-on id %s" % GUID)
    if not a.zip and version != src_version: sys.exit("the package is %s and the source is %s: build again" % (version, src_version))
    print("package: %s, version %s, %.1f MB" % (os.path.basename(path), version, os.path.getsize(path) / 1e6))

# ---- the owner's access
if not os.path.exists(KEYS): sys.exit("no %s: make a key on https://addons.mozilla.org/developers/addon/api/key/ (docs/veil-release-checklist.md, section 7b)" % KEYS)
env = {}
with io.open(KEYS, encoding="utf-8") as f:
    for line in f:
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.strip().split("=", 1); env[k.strip()] = v.strip().strip('"').strip("'")
for need in ("AMO_JWT_ISSUER", "AMO_JWT_SECRET"):
    if not env.get(need): sys.exit("%s has no %s" % (KEYS, need))


def b64(x): return base64.urlsafe_b64encode(x).rstrip(b"=")


def token():
    now = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": env["AMO_JWT_ISSUER"], "jti": secrets.token_hex(16), "iat": now, "exp": now + 240}).encode())
    return (head + b"." + body + b"." + b64(hmac.new(env["AMO_JWT_SECRET"].encode(), head + b"." + body, hashlib.sha256).digest())).decode()


def call(method, url, body=None, ctype=None, soft=False):
    req = urllib.request.Request(url if url.startswith("http") else API + url, data=body, method=method)
    req.add_header("Authorization", "JWT " + token())
    if ctype: req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=600) as r: return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")[:800]
        if soft: return {"http": e.code, "body": text}
        sys.exit("%s %s: HTTP %d %s" % (method, url, e.code, text))


def multipart(fields, files):
    edge = "prism" + secrets.token_hex(12); out = io.BytesIO()
    for k, v in fields.items():
        out.write(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (edge, k, v)).encode())
    for k, (name, data) in files.items():
        out.write(("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\nContent-Type: application/zip\r\n\r\n" % (edge, k, name)).encode())
        out.write(data); out.write(b"\r\n")
    out.write(("--%s--\r\n" % edge).encode())
    return out.getvalue(), "multipart/form-data; boundary=" + edge


# ---- what the store has, and whose key this is
me = call("GET", "accounts/profile/")
addon = call("GET", "addons/addon/%s/" % GUID)
mine = any(x.get("id") == me.get("id") for x in addon.get("authors", []))
cur = (addon.get("current_version") or {}).get("version", "-")
print("store: %s, listed version %s; this key's account %s an author of the add-on" % (addon.get("status", "?"), cur, "is" if mine else "IS NOT"))
have = [cur] if re.match(r"^\d+(\.\d+)*$", cur) else []
if mine:
    vs = call("GET", "addons/addon/%s/versions/?filter=all_with_unlisted&page_size=50" % GUID, soft=True)
    for x in vs.get("results", []):
        print("  %s %s %s" % (x.get("version"), x.get("channel"), (x.get("file") or {}).get("status")))
        if re.match(r"^\d+(\.\d+)*$", x.get("version", "")): have.append(x["version"])
if a.status: sys.exit(0)
if not mine:
    sys.exit("the key in %s belongs to another account than the add-on's: make the key while signed in to the account that owns "
             "PRISM by Entangled, or add this account as an author on the add-on's Manage Authors page" % KEYS)
if have and ver(version) <= max(ver(v) for v in have): sys.exit("version %s is not higher than the store's %s: raise the version in manifest.json and build again" % (version, max(have, key=ver)))

# ---- the source, as git has it
src = os.path.join(EXT, "dist", "prism-source-%s.zip" % version)
subprocess.run(["git", "-C", ROOT, "fetch", "-q", "public", "main"], check=True)
snap = subprocess.run(["git", "-C", ROOT, "show", "public/main:prototypes/prism-veil-extension/manifest.json"], capture_output=True, text=True, encoding="utf-8")
snap_version = json.loads(snap.stdout)["version"] if snap.returncode == 0 else "?"
if snap_version != version:
    if not a.dry_run: sys.exit("the public snapshot holds the extension at %s, not %s: push the snapshot first (publish-extension.py does)" % (snap_version, version))
    print("source: the public snapshot holds %s, not %s yet (the release command pushes it first)" % (snap_version, version))
else:
    subprocess.run(["git", "-C", ROOT, "archive", "--format=zip", "-o", src, "public/main"], check=True)
    print("source: %s, %.1f MB (the public snapshot %s)" % (os.path.basename(src), os.path.getsize(src) / 1e6,
          subprocess.run(["git", "-C", ROOT, "rev-parse", "--short", "public/main"], capture_output=True, text=True).stdout.strip()))
reviewer = ""
if os.path.exists(REVIEWER):
    with io.open(REVIEWER, encoding="utf-8") as f: reviewer = f.read().strip()
    if len(reviewer) > 3000: sys.exit("%s is %d characters: the store takes 3,000" % (REVIEWER, len(reviewer)))
print("notes for the reviewer: %s" % ("%d characters" % len(reviewer) if reviewer else "none (no %s)" % os.path.relpath(REVIEWER, ROOT)))
if a.dry_run: print("dry run: the checks pass; nothing sent"); sys.exit(0)
if not a.daytime:
    import eastern   # scripts/release/eastern.py: the Eastern hour, worked out when the PC has no zone data
    if eastern.daytime(): sys.exit("on a weekday an upload waits for the evening (after 6 PM Eastern); --daytime to override, --dry-run to check alone")

# ---- the upload, Mozilla's own checks, then the version with its source
with open(path, "rb") as f: body, ctype = multipart({"channel": "listed"}, {"upload": (os.path.basename(path), f.read())})
up = call("POST", "addons/upload/", body, ctype)
uuid = up.get("uuid")
if not uuid: sys.exit("the upload gave no id: %s" % json.dumps(up)[:400])
for _ in range(120):
    if up.get("processed"): break
    time.sleep(5); up = call("GET", "addons/upload/%s/" % uuid)
if not up.get("processed"): sys.exit("Mozilla's checks did not finish in ten minutes (upload %s): look on the Developer Hub" % uuid)
val = up.get("validation") or {}
print("uploaded: Mozilla's checks say %s (%s errors, %s warnings, %s notices)" % ("valid" if up.get("valid") else "NOT VALID", val.get("errors", "?"), val.get("warnings", "?"), val.get("notices", "?")))
if not up.get("valid"):
    for m in (val.get("messages") or [])[:12]:
        if m.get("type") == "error": print("  error: %s (%s)" % (m.get("message"), m.get("file")))
    sys.exit("nothing was submitted")
with open(src, "rb") as f: body, ctype = multipart({"upload": uuid}, {"source": (os.path.basename(src), f.read())})
v = call("POST", "addons/addon/%s/versions/" % GUID, body, ctype)
vid = v.get("id")
if not vid: sys.exit("the version was not made: %s" % json.dumps(v)[:600])
print("submitted for review: version %s (%s, file %s)" % (v.get("version"), v.get("channel"), (v.get("file") or {}).get("status")))
edit = {"release_notes": {"en-US": a.notes.strip()}}
if reviewer: edit["approval_notes"] = reviewer
e = call("PATCH", "addons/addon/%s/versions/%s/" % (GUID, vid), json.dumps(edit).encode(), "application/json", soft=True)
print("notes: %s" % ("NOT set (HTTP %s %s): set them on the Developer Hub" % (e.get("http"), e.get("body", "")[:200]) if e.get("http") else "set"))
