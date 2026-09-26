"""Sync hosted/ (or, with --cred, hosted-cred/) to the Tigris bucket that serves https://prism.entangled.world/veil/art/.

Credentials: ~/.prism/tigris.env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
AWS_ENDPOINT_URL_S3, BUCKET_NAME) - written once from `fly storage create`,
never in the repo. Uploads only what changed (by sha256 = ETag for single-part
puts), sets immutable caching on photos and short caching + CORS on the index.
"""
import hashlib, json, mimetypes, os, sys
import boto3
from botocore.config import Config

HERE = os.path.dirname(os.path.abspath(__file__))
CRED = "--cred" in sys.argv          # the source-reliability list instead of the art pool
SRC = os.path.join(HERE, "hosted-cred" if CRED else "hosted")
PREFIX = "veil/credibility/" if CRED else "veil/art/"
ENV = os.path.expanduser("~/.prism/tigris.env")

env = dict(l.rstrip("\n").split("=", 1) for l in open(ENV) if "=" in l)
s3 = boto3.client("s3", endpoint_url=env["AWS_ENDPOINT_URL_S3"], region_name="auto",
                  aws_access_key_id=env["AWS_ACCESS_KEY_ID"], aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
                  config=Config(s3={"addressing_style": "virtual"}))
bucket = env["BUCKET_NAME"]

if "--cors" in sys.argv or "--all" in sys.argv:
    s3.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [{
        "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400}]})
    print("CORS set on", bucket)

have = {}
for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX):
    for o in page.get("Contents", []):
        have[o["Key"]] = o["ETag"].strip('"')

up = skip = 0
for fn in sorted(os.listdir(SRC)):
    path = os.path.join(SRC, fn); key = PREFIX + fn
    data = open(path, "rb").read()
    md5 = hashlib.md5(data).hexdigest()
    index = fn.endswith((".json", ".sig"))   # lists + signatures: short cache, always re-put
    if not index and have.get(key) == md5:
        skip += 1; continue
    ctype = "text/plain" if fn.endswith(".sig") else (mimetypes.guess_type(fn)[0] or "application/octet-stream")
    cache = "public, max-age=300" if index else "public, max-age=31536000, immutable"
    s3.put_object(Bucket=bucket, Key=key, Body=data, ContentType=ctype, CacheControl=cache, ACL="public-read")
    up += 1
# remove hosted photos no longer in the pool
gone = [k for k in have if k[len(PREFIX):] not in os.listdir(SRC)]
for k in gone:
    s3.delete_object(Bucket=bucket, Key=k)
print("uploaded %d, unchanged %d, deleted %d -> s3://%s/%s" % (up, skip, len(gone), bucket, PREFIX))
