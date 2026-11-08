"""Pull ad reports from the private prism-veil-reports bucket into reports/
(git-ignored) so they can be worked through, then delete them from the bucket.

Usage: python pull-reports.py            # download new, keep in bucket
       python pull-reports.py --purge    # download, then delete from bucket
Creds: ~/.prism/reports.env (from `fly storage create -a prism-reports`).
"""
import json, os, sys
import boto3
from botocore.config import Config

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(HERE, "reports")
env = dict(l.rstrip("\n").split("=", 1) for l in open(os.path.expanduser("~/.prism/reports.env")) if "=" in l)
s3 = boto3.client("s3", endpoint_url=env["AWS_ENDPOINT_URL_S3"], region_name="auto",
                  aws_access_key_id=env["AWS_ACCESS_KEY_ID"], aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
                  config=Config(s3={"addressing_style": "virtual"}))
bucket = env["BUCKET_NAME"]
os.makedirs(DEST, exist_ok=True)
n = 0; sites = {}
for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="reports/"):
    for o in page.get("Contents", []):
        key = o["Key"]; local = os.path.join(DEST, key[len("reports/"):].replace("/", "__"))
        if not os.path.exists(local):
            s3.download_file(bucket, key, local); n += 1
        try: site = json.load(open(local, encoding="utf-8")).get("site", "?")
        except Exception: site = "?"
        sites[site] = sites.get(site, 0) + 1
        if "--purge" in sys.argv: s3.delete_object(Bucket=bucket, Key=key)
print("downloaded %d new report(s) -> %s" % (n, DEST))
for site, c in sorted(sites.items(), key=lambda x: -x[1]): print("  %3d  %s" % (c, site))
