"""Serve Prism's Cosmos and Museum art packs to the Veil extension (2026-10-15, "Nah let's just serve them from the server"): each pack goes to
its own folder beside the photo pool - https://prism.entangled.world/veil/art/cosmos/ and .../gallery/ - with a list.json ({v:1, files:[{f,
sha256}]}, the pool's own format) signed by the same key (sign-list.mjs), and the pack's provenance as manifest.json. The pool's list.json is
untouched, so an extension that knows nothing of the sets keeps showing nature photos only.

    python -P publish-packs.py [--dry-run]

Reads ../../packs/<id>/pack.json and its pictures (fetched and shrunk by scripts/fetch-pack.mjs and scripts/shrink-pack.py); writes
hosted-packs/<id>/; signs; uploads to veil/art/<id>/ with the pool's cache rules and deletes what the pack no longer lists there.
"""
import hashlib, json, mimetypes, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PACKS = os.path.join(HERE, "..", "..", "packs")
OUT = os.path.join(HERE, "hosted-packs")
DRY = "--dry-run" in sys.argv

for pid in ("cosmos", "gallery"):
    src = os.path.join(PACKS, pid)
    pack = json.load(open(os.path.join(src, "pack.json"), encoding="utf-8"))
    out = os.path.join(OUT, pid)
    if os.path.isdir(out): shutil.rmtree(out)
    os.makedirs(out)
    files = []
    for im in pack["images"]:
        f = os.path.join(src, im["file"])
        data = open(f, "rb").read()
        sha = hashlib.sha256(data).hexdigest()
        if sha != im["sha256"]: sys.exit(f"{pid}/{im['file']}: bytes do not match the pack record - run the pack gate first")
        shutil.copyfile(f, os.path.join(out, im["file"]))
        files.append({"f": im["file"], "sha256": sha})
    with open(os.path.join(out, "list.json"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"v": 1, "files": files}, indent=1) + "\n")
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(pack, indent=1, ensure_ascii=False) + "\n")
    subprocess.run(["node", os.path.join(HERE, "sign-list.mjs"), os.path.join("hosted-packs", pid)], check=True, cwd=HERE)
    print(f"{pid}: {len(files)} pictures, list signed -> {out}")

if DRY:
    print("dry run: nothing uploaded"); sys.exit(0)

import boto3
from botocore.config import Config
env = dict(l.rstrip("\n").split("=", 1) for l in open(os.path.expanduser("~/.prism/tigris.env")) if "=" in l)   # the pool uploader's own
s3 = boto3.client("s3", endpoint_url=env["AWS_ENDPOINT_URL_S3"], region_name="auto",
                  aws_access_key_id=env["AWS_ACCESS_KEY_ID"], aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
                  config=Config(s3={"addressing_style": "virtual"}))
bucket = env["BUCKET_NAME"]
for pid in ("cosmos", "gallery"):
    prefix = f"veil/art/{pid}/"; src = os.path.join(OUT, pid)
    have = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for o in page.get("Contents", []): have[o["Key"]] = o["ETag"].strip('"')
    up = skip = 0
    names = sorted(os.listdir(src))
    # pictures first, the signed list last, so a list never names a picture not yet there
    for fn in sorted(names, key=lambda n: n.endswith((".json", ".sig"))):
        data = open(os.path.join(src, fn), "rb").read(); key = prefix + fn
        index = fn.endswith((".json", ".sig"))
        if not index and have.get(key) == hashlib.md5(data).hexdigest(): skip += 1; continue
        ctype = "text/plain" if fn.endswith(".sig") else (mimetypes.guess_type(fn)[0] or "application/octet-stream")
        cache = "public, max-age=300" if index else "public, max-age=31536000, immutable"
        s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType=ctype, CacheControl=cache, ACL="public-read")
        up += 1
    gone = [k for k in have if k[len(prefix):] not in names]
    for k in gone: s3.delete_object(Bucket=bucket, Key=k)
    print(f"{pid}: uploaded {up}, unchanged {skip}, deleted {len(gone)} -> s3://{bucket}/{prefix}")
