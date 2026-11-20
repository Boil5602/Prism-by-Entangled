"""A rule update for the PRISM extension (docs/features/rule-updates.md): rules.json and rules.sig, published to the bucket at
veil/rules/. The file is data (selectors, words, hostnames); the extension verifies the signature and the schema and keeps its
packaged rules when either fails.

    node scripts/release/rules-test.mjs prototypes/prism-veil-extension/rules-update/rules.json prototypes/prism-veil-extension/rules-update/expect.json
    python scripts/release/publish-rules.py [--file <rules.json>] [--dry-run] [--daytime]

- The file is sent byte for byte as it is in the tree (prototypes/prism-veil-extension/rules-update/rules.json), so git has every
  rule set that went out. A roll back is the old content under a higher serial.
- It is checked with the extension's own reader (rules-check.mjs): size, schema, versions, the kill list's ids.
- It is uploaded only when the stand-in test passed ON THIS EXACT FILE: scripts/release/out/rules/tested.json holds the SHA-256 of
  the file rules-test.mjs passed, in both browsers, for the extension version in the tree. Another hash, another version or a
  missing record refuses the upload. Edit the file and the test must be run again.
- Signed with the pack's key, ~/.prism/prism-breakwatch-signing.pem (PRISM_PACK_KEY to override), through sign-manifest.mjs: the
  same key and scheme as the break watch pack. The spare key the extension also accepts is for the day the pack key is lost; it is
  kept offline and this script refuses it unless --spare-key says so.
- The serial must be newer than the one that is live.
- Uploaded to the Tigris bucket (credentials ~/.prism/tigris.env): rules.json first, rules.sig last, both max-age 300. Then both
  are fetched back from outside and checked again. --dry-run signs into scripts/release/out/rules/ and uploads nothing.
- On a weekday a public upload after hours only (the public-after-hours rule; weekends at any hour), --daytime to override."""
import argparse, hashlib, json, os, shutil, subprocess, sys, urllib.request, urllib.error
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXT = os.path.join(ROOT, "prototypes", "prism-veil-extension")
OUT = os.path.join(ROOT, "scripts", "release", "out", "rules")
BASE_URL = "https://prism.entangled.world/veil/rules/"
PREFIX = "veil/rules/"
ENV = os.path.expanduser("~/.prism/tigris.env")
KEY = os.environ.get("PRISM_PACK_KEY", os.path.expanduser("~/.prism/prism-breakwatch-signing.pem"))
NL = chr(10)

ap = argparse.ArgumentParser()
ap.add_argument("--file", default=os.path.join(EXT, "rules-update", "rules.json"))
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--daytime", action="store_true", help="allow the upload in Eastern daytime")
ap.add_argument("--spare-key", action="store_true", help="sign with the spare key (the pack key is lost)")
a = ap.parse_args()


def eastern_now():
    utc = datetime.now(timezone.utc)
    y = utc.year
    def nth_sunday(month, n):
        d = date(y, month, 1); first = d + timedelta(days=(6 - d.weekday()) % 7); return first + timedelta(weeks=n - 1)
    dst_start = datetime(y, 3, nth_sunday(3, 2).day, 7, tzinfo=timezone.utc); dst_end = datetime(y, 11, nth_sunday(11, 1).day, 6, tzinfo=timezone.utc)
    return utc + timedelta(hours=-4 if dst_start <= utc < dst_end else -5)


def node(*args):
    r = subprocess.run(["node"] + list(args), capture_output=True, text=True)
    line = (r.stdout.strip().splitlines() or [""])[-1]
    try: return r.returncode, json.loads(line)
    except ValueError: return r.returncode, {"error": (r.stdout + r.stderr).strip()[-400:]}


src = os.path.abspath(a.file)
if "demo" in os.path.normpath(src).split(os.sep): sys.exit("the demonstration file is never published")
if "spare" in os.path.basename(KEY).lower() and not a.spare_key: sys.exit("that is the spare key: it signs only with --spare-key, when the pack key is lost")
if a.spare_key and "spare" not in os.path.basename(KEY).lower(): sys.exit("--spare-key needs PRISM_PACK_KEY to name the spare key's file")
data = open(src, "rb").read()
digest = hashlib.sha256(data).hexdigest()
version = json.load(open(os.path.join(EXT, "manifest.json"), encoding="utf-8"))["version"]

# 1. the extension's own check
code, chk = node(os.path.join(ROOT, "scripts", "release", "rules-check.mjs"), src)
if code != 0: sys.exit("the file is refused: " + str(chk.get("error")))
serial = chk["serial"]
print(f"rules {serial}: {len(data)} bytes, sha256 {digest}")
print("  ", json.dumps(chk["counts"]))

# 2. the stand-in test passed on this exact file
tpath = os.path.join(OUT, "tested.json")
if not os.path.exists(tpath): sys.exit("no stand-in test on record: run scripts/release/rules-test.mjs on this file first")
tested = json.load(open(tpath, encoding="utf-8"))
if tested.get("sha256") != digest:
    sys.exit(f"the stand-in test passed on another file (sha256 {tested.get('sha256')}, serial {tested.get('serial')}), not on this one: run rules-test.mjs again")
if tested.get("version") != version: sys.exit(f"the stand-in test ran with the extension {tested.get('version')}, the tree has {version}: run rules-test.mjs again")
if sorted(tested.get("browsers", [])) != ["chromium", "firefox"]: sys.exit("the stand-in test on record did not run in both browsers")
print(f"stand-in test: passed on this file at {tested.get('at')}, {len(tested.get('pages', []))} pages, both browsers")

# 3. newer than what is live
live = ""
try:
    with urllib.request.urlopen(urllib.request.Request(BASE_URL + "rules.json", headers={"Cache-Control": "no-cache"}), timeout=20) as r:
        live = str(json.loads(r.read().decode("utf-8")).get("serial", ""))
except urllib.error.HTTPError as e:
    if e.code not in (403, 404): sys.exit(f"could not read the live rules: HTTP {e.code}")
except Exception as e:
    if not a.dry_run: sys.exit(f"could not read the live rules: {e}")
    print("   (the live rules could not be read; a dry run goes on)")
def split(s):
    i = s.rfind("."); return (s[:i], int(s[i + 1:] or 0)) if i >= 0 else (s, 0)
if live and not split(serial) > split(live): sys.exit(f"the live rules are {live}: this file's serial {serial} is not newer")
print("live:", live or "none yet")

# 4. sign, and check the signature as the extension will
os.makedirs(OUT, exist_ok=True)
jpath = os.path.join(OUT, "rules.json"); spath = os.path.join(OUT, "rules.sig")
if os.path.exists(spath): os.remove(spath)
shutil.copyfile(src, jpath)
if hashlib.sha256(open(jpath, "rb").read()).hexdigest() != digest: sys.exit("the copy is not the file")
r = subprocess.run(["node", os.path.join(ROOT, "scripts", "release", "sign-manifest.mjs"), jpath], capture_output=True, text=True, env=dict(os.environ, PRISM_UPDATES_KEY=KEY))
if r.returncode != 0 or not os.path.exists(spath): sys.exit("signing failed: " + r.stdout + r.stderr)
code, chk = node(os.path.join(ROOT, "scripts", "release", "rules-check.mjs"), jpath, "--sig", spath)
if code != 0 or not chk.get("signature"): sys.exit("the extension would not take the signed file: " + str(chk.get("error")))
if chk.get("key") == "spare" and not a.spare_key: sys.exit("the file was signed with the spare key")
print(f"signed with the {chk.get('key')} key; the extension {version} takes it")

if a.dry_run:
    print("dry run: nothing uploaded; rules.json and rules.sig are in", OUT)
    sys.exit(0)
if not a.daytime:
    t = eastern_now(); h = t.hour
    if t.weekday() < 5 and 8 <= h < 18: sys.exit("on a weekday a public upload waits for the evening (after 6 PM Eastern); --daytime to override, --dry-run to build alone")

import boto3
from botocore.config import Config
tenv = dict(l.rstrip(NL).split("=", 1) for l in open(ENV) if "=" in l)
s3 = boto3.client("s3", endpoint_url=tenv["AWS_ENDPOINT_URL_S3"], region_name="auto",
                  aws_access_key_id=tenv["AWS_ACCESS_KEY_ID"], aws_secret_access_key=tenv["AWS_SECRET_ACCESS_KEY"],
                  config=Config(s3={"addressing_style": "virtual"}))
bucket = tenv["BUCKET_NAME"]
s3.put_object(Bucket=bucket, Key=PREFIX + "rules.json", Body=open(jpath, "rb").read(), ContentType="application/json", CacheControl="public, max-age=300", ACL="public-read")
s3.put_object(Bucket=bucket, Key=PREFIX + "rules.sig", Body=open(spath, "rb").read(), ContentType="text/plain", CacheControl="public, max-age=300", ACL="public-read")
print("uploaded:", BASE_URL + "rules.json")

# 5. from outside: what a browser will get
back = os.path.join(OUT, "live-check"); os.makedirs(back, exist_ok=True)
for name in ("rules.json", "rules.sig"):
    with urllib.request.urlopen(urllib.request.Request(BASE_URL + name, headers={"Cache-Control": "no-cache"}), timeout=30) as r:
        open(os.path.join(back, name), "wb").write(r.read())
if hashlib.sha256(open(os.path.join(back, "rules.json"), "rb").read()).hexdigest() != digest:
    sys.exit("what is live is not yet the file that was sent (a cache may hold the old one for five minutes): check again with rules-check.mjs")
code, chk = node(os.path.join(ROOT, "scripts", "release", "rules-check.mjs"), os.path.join(back, "rules.json"), "--sig", os.path.join(back, "rules.sig"))
if code != 0 or not chk.get("signature"): sys.exit("the live file does not verify: " + str(chk.get("error")))
print(f"published and verified from outside: rules {serial}")
