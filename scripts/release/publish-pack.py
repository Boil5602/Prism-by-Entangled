"""The break watch pack (docs/features/break-watch-packs.md): the learned models, the picture network and the ad catalog, each file
addressed by its sha256, listed in a signed pack.json, published to the bucket beside the Windows releases. First cut 2026-11-07:
the parts are the two models (prism: the app's learned.json; veil: the extension's model.json), the picture network and the prints
catalog; rules, settings, channel logos and sounds come later. Nothing in a pack runs as code.

    python scripts/release/publish-pack.py --notes "..." [--serial 2026-11-07.1] [--dry-run] [--bundle] [--daytime]

- The serial is the day and a count (today's date, .1 unless given); newer is later. minPrism and minVeil are the versions in the
  tree (the app's csproj, the extension's manifest), since a model may name an input only a current build fills.
- Signed with the pack's own key, ~/.prism/prism-breakwatch-signing.pem (PRISM_PACK_KEY to override), through sign-manifest.mjs:
  ECDSA P-256 / SHA-256, raw r||s in base64, the same scheme as the update manifest and the art index. Never the update key.
- Uploaded to the Tigris bucket (credentials ~/.prism/tigris.env) under breakwatch/: the files first (immutable, by hash), pack.json and
  pack.sig last (max-age 60). --dry-run builds and signs into scripts/release/out/pack/ and uploads nothing.
- --bundle also copies pack.json, pack.sig and the files into targets/win-host/PrismHost/Assets/breakwatch/pack/ (what a release
  carries; the app uses the newer of the bundled and the downloaded pack) and stamps the extension's bundled model.json with the serial.
- A public upload after hours only (the public-after-hours rule), --daytime to override."""
import argparse, hashlib, json, os, shutil, subprocess, sys
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "scripts", "release", "out", "pack")
ASSETS = os.path.join(ROOT, "targets", "win-host", "PrismHost", "Assets", "breakwatch")
EXT = os.path.join(ROOT, "prototypes", "prism-veil-extension", "src", "breakwatch")
BASE_URL = "https://prism.entangled.world/breakwatch/"
PREFIX = "breakwatch/"
ENV = os.path.expanduser("~/.prism/tigris.env")
KEY = os.environ.get("PRISM_PACK_KEY", os.path.expanduser("~/.prism/prism-breakwatch-signing.pem"))
NL = chr(10)

ap = argparse.ArgumentParser()
ap.add_argument("--notes", required=True)
ap.add_argument("--serial", default="")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--bundle", action="store_true")
ap.add_argument("--daytime", action="store_true", help="allow the upload in Eastern daytime")
a = ap.parse_args()


def eastern_now():
    utc = datetime.now(timezone.utc)
    # EST/EDT without a tz database: the second Sunday of March to the first Sunday of November is daylight time
    y = utc.year
    def nth_sunday(month, n):
        d = date(y, month, 1); first = d + timedelta(days=(6 - d.weekday()) % 7); return first + timedelta(weeks=n - 1)
    dst_start = datetime(y, 3, nth_sunday(3, 2).day, 7, tzinfo=timezone.utc); dst_end = datetime(y, 11, nth_sunday(11, 1).day, 6, tzinfo=timezone.utc)
    off = -4 if dst_start <= utc < dst_end else -5
    return utc + timedelta(hours=off)


if not a.dry_run and not a.daytime:
    h = eastern_now().hour
    if 6 <= h < 18: sys.exit("a public upload waits for the evening (after 6 PM Eastern); --daytime to override, --dry-run to build alone")


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def version_of_csproj():
    import re
    t = open(os.path.join(ROOT, "targets", "win-host", "PrismHost", "PrismHost.csproj"), encoding="utf-8").read()
    m = re.search(r"<Version>([^<]+)</Version>", t); return m.group(1).strip() if m else "0.0.0"


def version_of_manifest():
    return json.load(open(os.path.join(ROOT, "prototypes", "prism-veil-extension", "manifest.json"), encoding="utf-8")).get("version", "0.0.0")


serial = a.serial or (date.today().isoformat() + ".1")
if os.path.isdir(OUT): shutil.rmtree(OUT)
os.makedirs(os.path.join(OUT, "files"))

parts = {}
def part(name, src, ext, extra=None):
    if not os.path.exists(src): sys.exit("missing " + src)
    h = sha(src); fn = "files/" + h + "." + ext
    shutil.copyfile(src, os.path.join(OUT, fn))
    d = {"file": fn, "sha256": h, "size": os.path.getsize(src)}
    if extra: d.update(extra)
    parts[name] = d
    return d


def policy_of(path):
    try: return json.load(open(path, encoding="utf-8")).get("policy", {})
    except Exception: return {}


app_version = version_of_csproj(); ext_version = version_of_manifest()
models = {
    "prism": part("prism", os.path.join(ASSETS, "learned.json"), "json", {"minPrism": app_version, "policy": policy_of(os.path.join(ASSETS, "learned.json"))}),
    "veil": part("veil", os.path.join(EXT, "model.json"), "json", {"minVeil": ext_version, "policy": policy_of(os.path.join(EXT, "model.json"))}),
}
picture_net = part("pictureNet", os.path.join(ASSETS, "picture-net.json"), "json")
prints = part("prints", os.path.join(ASSETS, "catalog.bin"), "bin")
pack = {
    "format": 1, "pack": serial, "date": date.today().isoformat(), "notes": a.notes,
    "minPrism": app_version, "minVeil": ext_version,
    "models": {"prism": models["prism"], "veil": models["veil"]},
    "pictureNet": picture_net,
    "prints": prints,
    "revoked": {"prints": [], "logos": []},
}
ppath = os.path.join(OUT, "pack.json")
with open(ppath, "w", encoding="utf-8", newline=NL) as f: f.write(json.dumps(pack, indent=1) + NL)
env = dict(os.environ, PRISM_UPDATES_KEY=KEY)
r = subprocess.run(["node", os.path.join(ROOT, "scripts", "release", "sign-manifest.mjs"), ppath], capture_output=True, text=True, env=env)
if r.returncode != 0: sys.exit("signing failed: " + r.stdout + r.stderr)
print(r.stdout.strip())
spath = os.path.join(OUT, "pack.sig")
if not os.path.exists(spath): sys.exit("no pack.sig written")
total = sum(p["size"] for p in parts.values())
print(f"pack {serial}: {len(parts)} files, {total / 1048576:.2f} MB; minPrism {app_version}, minVeil {ext_version}")

if a.bundle:
    dst = os.path.join(ASSETS, "pack")
    if os.path.isdir(dst): shutil.rmtree(dst)
    shutil.copytree(OUT, dst)
    print("bundled into", dst)
    # the extension's bundled model carries the serial, so the newer of the bundled and a downloaded pack can be told
    mp = os.path.join(EXT, "model.json")
    m = json.load(open(mp, encoding="utf-8")); m["pack"] = serial
    with open(mp, "w", encoding="utf-8", newline=NL) as f: f.write(json.dumps(m, separators=(",", ":")))
    print("extension model.json stamped with pack", serial, "(its hash changed: the pack's veil entry names the unstamped file; a release bundles the pack it was built from)")

if a.dry_run:
    print("dry run: nothing uploaded; the pack is in", OUT)
    sys.exit(0)

import boto3
from botocore.config import Config
tenv = dict(l.rstrip(NL).split("=", 1) for l in open(ENV) if "=" in l)
s3 = boto3.client("s3", endpoint_url=tenv["AWS_ENDPOINT_URL_S3"], region_name="auto",
                  aws_access_key_id=tenv["AWS_ACCESS_KEY_ID"], aws_secret_access_key=tenv["AWS_SECRET_ACCESS_KEY"],
                  config=Config(s3={"addressing_style": "virtual"}))
bucket = tenv["BUCKET_NAME"]
have = set()
for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX + "files/"):
    for o in page.get("Contents", []): have.add(o["Key"])
sent = 0
for name, p in parts.items():
    key = PREFIX + p["file"]
    if key in have: continue
    ctype = "application/json" if p["file"].endswith(".json") else "application/octet-stream"
    s3.put_object(Bucket=bucket, Key=key, Body=open(os.path.join(OUT, p["file"]), "rb").read(), ContentType=ctype,
                  CacheControl="public, max-age=31536000, immutable", ACL="public-read")
    sent += p["size"]
print(f"files uploaded: {sent / 1048576:.2f} MB new")
s3.put_object(Bucket=bucket, Key=PREFIX + "pack.json", Body=open(ppath, "rb").read(), ContentType="application/json", CacheControl="public, max-age=60", ACL="public-read")
s3.put_object(Bucket=bucket, Key=PREFIX + "pack.sig", Body=open(spath, "rb").read(), ContentType="text/plain", CacheControl="public, max-age=60", ACL="public-read")
print("published:", BASE_URL + "pack.json")
