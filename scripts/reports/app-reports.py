"""The app reports queue (docs/features/report-flag.md, 2026-10-06): what people sent with the report flag in Prism for Windows,
waiting in the private reports bucket under app-reports/open/. Closing one moves it to app-reports/done/; nothing is deleted.

Usage:
  python scripts/reports/app-reports.py                 list the open reports, newest first (kind, player, service, first line)
  python scripts/reports/app-reports.py --all           the closed ones too
  python scripts/reports/app-reports.py show <n|id>     one report in full (n = its number in the last list)
  python scripts/reports/app-reports.py done <n|id>...  close reports (moved to app-reports/done/)
  python scripts/reports/app-reports.py pull            copy every open report into scripts/reports/inbox/ (git-ignored)

Creds: ~/.prism/reports.env (the prism-reports app's bucket: `fly storage create -a prism-reports`).
"""
import json, os, sys
import boto3
from botocore.config import Config

HERE = os.path.dirname(os.path.abspath(__file__))
LAST = os.path.join(HERE, ".last-list.json")
env = dict(l.rstrip("\n").split("=", 1) for l in open(os.path.expanduser("~/.prism/reports.env")) if "=" in l)
s3 = boto3.client("s3", endpoint_url=env["AWS_ENDPOINT_URL_S3"], region_name="auto",
                  aws_access_key_id=env["AWS_ACCESS_KEY_ID"], aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
                  config=Config(s3={"addressing_style": "virtual"}))
BUCKET = env["BUCKET_NAME"]


def keys(prefix):
    out = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
        for o in page.get("Contents", []):
            out.append((o["Key"], o["LastModified"]))
    return sorted(out, key=lambda x: x[1], reverse=True)


def read(key):
    return json.loads(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read().decode("utf-8"))


def resolve(ref):
    if ref.isdigit() and os.path.exists(LAST):
        listed = json.load(open(LAST, encoding="utf-8"))
        n = int(ref)
        if 1 <= n <= len(listed):
            return listed[n - 1]
    for k, _ in keys("app-reports/"):
        if ref in k:
            return k
    sys.exit("no report matches " + ref)


def first_line(s):
    s = (s or "").strip().splitlines()
    return (s[0] if s else "")[:90]


def cmd_list(all_):
    listed = [k for k, _ in keys("app-reports/open/")] + ([k for k, _ in keys("app-reports/done/")] if all_ else [])
    if not listed:
        print("no open reports")
    for i, k in enumerate(listed, 1):
        r = read(k)
        state = "open" if "/open/" in k else "done"
        print("%3d  %s  %-5s %-5s %-14s %s  %s" % (i, r.get("receivedAt", "")[:16].replace("T", " "), r.get("kind", "?"), r.get("player", "?"),
                                                  r.get("service", "?"), state, first_line(r.get("note"))))
    json.dump(listed, open(LAST, "w", encoding="utf-8"))


def cmd_show(ref):
    k = resolve(ref)
    r = read(k)
    log = r.pop("log", None)
    print(k)
    print(json.dumps(r, indent=2, ensure_ascii=False))
    if log:
        print("\n---- log (%d chars) ----\n%s" % (len(log), log))


def cmd_done(refs):
    for ref in refs:
        k = resolve(ref)
        if "/open/" not in k:
            print("already closed: " + k)
            continue
        to = k.replace("app-reports/open/", "app-reports/done/", 1)
        s3.copy_object(Bucket=BUCKET, Key=to, CopySource={"Bucket": BUCKET, "Key": k})
        s3.delete_object(Bucket=BUCKET, Key=k)
        print("closed: " + to)


def cmd_pull():
    dest = os.path.join(HERE, "inbox")
    os.makedirs(dest, exist_ok=True)
    n = 0
    for k, _ in keys("app-reports/open/"):
        local = os.path.join(dest, k[len("app-reports/open/"):].replace("/", "__"))
        if not os.path.exists(local):
            s3.download_file(BUCKET, k, local)
            n += 1
    print("pulled %d new report(s) -> %s" % (n, dest))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a == ["--all"]:
        cmd_list("--all" in a)
    elif a[0] == "show" and len(a) == 2:
        cmd_show(a[1])
    elif a[0] == "done" and len(a) >= 2:
        cmd_done(a[1:])
    elif a[0] == "pull":
        cmd_pull()
    else:
        print(__doc__)
