"""Publish a Windows release of Prism (docs/features/updates.md, 2026-10-05).

    python scripts/release/publish-windows.py --notes "What changed, in a sentence or two." [--channel alpha|beta|stable] [--also <track>] [--zip <existing.zip>] [--dry-run] [--site <website repo>]

What it does, in order:
  1. reads the version from PrismHost.csproj and the commit from git (the tree must be clean unless --allow-dirty);
  2. `dotnet publish` (Release, x64, self-contained) into a scratch folder and zips it as Prism-<version>-<commit>.zip, or takes --zip;
  3. SHA-256 and size of the zip;
  4. the manifest: the current one at https://prism.entangled.world/windows/manifest.json is read (so the other tracks' entries are kept),
     this track's entry (and each --also track's) becomes {version, url, sha256, size, date, notes}, and the whole is signed with
     scripts/release/sign-manifest.mjs (key outside the repo: ~/.prism/prism-updates-signing.pem);
  5. uploads to the Tigris bucket (credentials ~/.prism/tigris.env, the same as Veil's art): each file of the release not already there,
     gzipped and named by its hash (windows/files/<sha256>.gz), the file list (windows/files/Prism-<version>-<commit>.files.json, its hash
     in the manifest as filesSha256), the zip (immutable caching), then manifest.json and manifest.sig (short caching) - everything a
     manifest names is there before the manifest is;
  6. the record: CHANGELOG.md at the repo root gets the entry at the top (commit it after); a GitHub Release v<version> on the public
     repo (Boil5602/Prism-by-Entangled) carries the notes, the hash and the zip (gh must be signed in; --no-github skips it);
  7. with --site, writes the website repo's src/data/releases.json: the windows key (the current release) and a history list (every
     release, newest first, each with its GitHub release address), and public/_redirects (/prism/download/windows -> the counting
     redirect at reports.entangled.world, which sends on to the zip and adds one to the public download count), then says to run
     `npm run deploy` there.
Nothing about a person is in any of it. The private key never leaves the machine.
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, urllib.request
from datetime import date
NL = chr(10); BS = chr(92); Q = chr(34)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSPROJ = os.path.join(ROOT, "targets", "win-host", "PrismHost", "PrismHost.csproj")
BASE_URL = "https://prism.entangled.world/windows/"
PREFIX = "windows/"
ENV = os.path.expanduser("~/.prism/tigris.env")

ap = argparse.ArgumentParser()
ap.add_argument("--notes", required=True, help="release notes, a sentence or two (shown on the PC and the website)")
# the tracks (2026-10-05, "I would call this current track Alpha. And we'll work toward beta and full"): alpha while Prism is built,
# beta for the candidate, stable for the full release. HEADLINE is the track the website's Download button offers; it moves to beta,
# then to stable, by editing this line. --also points other tracks at the same release (a Prism built on an earlier track follows its
# own track's entry, so the first alpha publish after the rename carries --also stable for the 0.22.0 installs that look there).
TRACKS = ["alpha", "beta", "stable"]
TRACK_LABEL = {"alpha": "Alpha", "beta": "Beta", "stable": "Full"}
HEADLINE = "alpha"
ap.add_argument("--channel", default=HEADLINE, choices=TRACKS, help="the track this release is published on")
ap.add_argument("--also", action="append", default=[], choices=TRACKS, help="other tracks that point at this same release")
ap.add_argument("--zip", help="an already-built zip instead of publishing anew")
ap.add_argument("--dry-run", action="store_true", help="build, hash and sign, upload nothing")
ap.add_argument("--allow-dirty", action="store_true")
ap.add_argument("--site", help="the website repo's folder: its releases.json and _redirects are updated")
ap.add_argument("--no-github", action="store_true", help="no GitHub Release")
ap.add_argument("--public-repo", default="Boil5602/Prism-by-Entangled")
a = ap.parse_args()
# the website's prose check refuses a semicolon (its changelog page failed to build on 0.26.2's notes, 2026-10-06): caught here, before anything is built
if ";" in a.notes:
    sys.exit("the notes hold a semicolon, which the website's prose check refuses; use a full stop")

def sh(cmd, cwd=ROOT):
    return subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str), check=True, capture_output=True, text=True).stdout.strip()

version = re.search(r"<Version>([^<]+)</Version>", open(CSPROJ, encoding="utf-8").read()).group(1).strip()
commit = sh(["git", "rev-parse", "--short=8", "HEAD"])
dirty = sh(["git", "status", "--porcelain"])
if dirty and not a.allow_dirty:
    sys.exit("the tree is not clean; commit first (or --allow-dirty):\n" + dirty)
# the public source goes out with every release (2026-10-07: the public repo's code had stood still at the first release for eleven days
# while the releases moved on). The tree is checked for the household's details first, before anything is built
SNAP = os.path.join(ROOT, "scripts", "release", "public-snapshot.py")
if not a.no_github:
    chk = subprocess.run([sys.executable, SNAP, "check"], capture_output=True, text=True)
    if chk.returncode != 0:
        sys.exit("the household's details are in the tree, nothing published:" + NL + (chk.stdout + chk.stderr).strip())
    print("scrub check: clean")
name = f"Prism-{version}-{commit}.zip"
print(f"release {version} ({commit}) on the {TRACK_LABEL[a.channel]} track" + (", also " + ", ".join(a.also) if a.also else "") + f": {name}")

if a.zip:
    zip_path = os.path.abspath(a.zip)
else:
    scratch = tempfile.mkdtemp(prefix="prism-publish-")
    out = os.path.join(scratch, "publish")
    print("publishing to", out)
    subprocess.run(["dotnet", "publish", "-c", "Release", "-p:Platform=x64", "-r", "win-x64", "--self-contained", "-o", out, "-nologo"],
                   cwd=os.path.dirname(CSPROJ), check=True)
    for must in ("PrismHost.exe", "PrismHost.pri", os.path.join("Assets", "brain", "prism-runtime.js")):
        if not os.path.exists(os.path.join(out, must)): sys.exit("the publish lacks " + must)
    # code signing (2026-10-05, SmartScreen's "Unknown publisher" on first run): when PRISM_SIGN_THUMBPRINT names a certificate in the
    # current user's store (an EV/OV certificate for Entangled Labs LLC, or Azure Trusted Signing's), every exe and Prism dll is signed with
    # signtool before zipping; without it the build goes out unsigned and the README says what the screen means
    thumb = os.environ.get("PRISM_SIGN_THUMBPRINT", "").strip()
    signed = False
    if thumb:
        signtool = os.environ.get("SIGNTOOL", "signtool")
        targets = [os.path.join(out, "PrismHost.exe")] + [os.path.join(out, x) for x in os.listdir(out) if x.lower().endswith(".dll") and x.lower().startswith("prismhost")]
        subprocess.run([signtool, "sign", "/sha1", thumb, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256", "/d", "Prism by Entangled"] + targets, check=True)
        signed = True
        print("signed", len(targets), "files")
    smart = "" if signed else (NL + "First run: Windows may show " + Q + "Windows protected your PC" + Q + " because this build is not code-signed yet." + NL
                                + "Press " + Q + "More info" + Q + ", then " + Q + "Run anyway" + Q + ". To check the file first, compare its SHA-256 with the one on" + NL
                                + "entangled.world/prism/download (in PowerShell: Get-FileHash Prism-" + version + "-" + commit + ".zip)." + NL)
    with open(os.path.join(out, "README.txt"), "w", encoding="utf-8") as f:
        f.write(f"Prism {version} ({commit}, {date.today().isoformat()})" + NL + NL + "1. Unzip anywhere." + NL + "2. Run PrismHost.exe." + NL + smart + NL
                + "Prism installs itself into %LOCALAPPDATA%" + BS + "Programs" + BS + "Prism (no administrator rights), adds itself to the Start menu and" + NL
                + "runs from there from then on; the unzipped folder can be deleted. Your data is kept in %LOCALAPPDATA%" + BS + "Prism." + NL
                + "Updates: Prism menu, Updates (only the files that changed are downloaded)." + NL + NL + a.notes + NL)
    zip_path = os.path.join(scratch, name)
    subprocess.run(["pwsh", "-NoProfile", "-Command", f"Compress-Archive -Path '{out}\\*' -DestinationPath '{zip_path}' -Force"], check=True)

data = open(zip_path, "rb").read()
sha = hashlib.sha256(data).hexdigest()
size = len(data)
print(f"zip {size/1048576:.1f} MB sha256 {sha}")

# the file list (2026-10-06, incremental updates; docs/features/updates.md): every file of the release with its SHA-256 and size, so a
# Prism fetches only the files it lacks. Each file is stored once, gzipped and named by its hash (windows/files/<sha256>.gz) - a file
# unchanged since an earlier release is never uploaded again. The list's own hash goes into the signed manifest.
import gzip, zipfile
files_dir = tempfile.mkdtemp(prefix="prism-files-")
with zipfile.ZipFile(zip_path) as z:
    z.extractall(files_dir)
entries = []
for dirpath, _, names in os.walk(files_dir):
    for n in names:
        full = os.path.join(dirpath, n)
        rel = os.path.relpath(full, files_dir).replace(BS, "/")
        b = open(full, "rb").read()
        entries.append({"path": rel, "sha256": hashlib.sha256(b).hexdigest(), "size": len(b), "_full": full})
entries.sort(key=lambda e: e["path"])
if not any(e["path"].lower() == "prismhost.exe" for e in entries): sys.exit("the release has no PrismHost.exe at its root")
list_name = f"Prism-{version}-{commit}.files.json"
list_bytes = (json.dumps({"version": version, "files": [{k: e[k] for k in ("path", "sha256", "size")} for e in entries]}, indent=2) + NL).encode("utf-8")
list_sha = hashlib.sha256(list_bytes).hexdigest()
print(f"file list: {len(entries)} files, {sum(e['size'] for e in entries)/1048576:.1f} MB unpacked, sha256 {list_sha}")

# the manifest: the current one kept for the other channel
manifest = {}
try:
    with urllib.request.urlopen(BASE_URL + "manifest.json", timeout=20) as r:
        manifest = json.loads(r.read().decode("utf-8"))
        print("current manifest read:", {k: v.get("version") for k, v in manifest.items() if isinstance(v, dict)})
except Exception as e:
    print("no current manifest (first release?):", e)
# the changelog feed (2026-10-07, "can we have the option to see a change log feed on the side of that modal window"): the track's recent
# releases from CHANGELOG.md, newest first, this one at the top - an incremental update can skip several versions, and the Updates dialog
# shows each one's notes. Signed with the rest of the manifest.
def changelog_history(track, limit=25):
    out = [{"version": version, "date": date.today().isoformat(), "notes": a.notes}]
    cl = os.path.join(ROOT, "CHANGELOG.md")
    if not os.path.exists(cl):
        return out
    head_re = re.compile(r"^## (" + BS + "S+) - (" + BS + "d{4}-" + BS + "d{2}-" + BS + "d{2}) " + BS + "(([a-z]+),")
    for block in open(cl, encoding="utf-8").read().split(NL + "## ")[1:]:
        lines = ("## " + block).split(NL)
        m = head_re.match(lines[0])
        if not m or m.group(1) == version or m.group(3) != track:
            continue
        para = []
        for l in lines[1:]:
            if l.startswith("- ") or (l.strip() == "" and para):
                if para: break
                continue
            if l.strip(): para.append(l.strip())
        if para:
            out.append({"version": m.group(1), "date": m.group(2), "notes": " ".join(para)})
        if len(out) >= limit:
            break
    return out

history = changelog_history(a.channel)
print(f"changelog feed: {len(history)} releases, from {history[-1]['version']} to {history[0]['version']}")
for ch in [a.channel] + [c for c in a.also if c != a.channel]:
    manifest[ch] = {"version": version, "url": BASE_URL + name, "sha256": sha, "size": size, "files": BASE_URL + "files/" + list_name, "filesSha256": list_sha,
                    "date": date.today().isoformat(), "notes": a.notes, "history": history}
work = tempfile.mkdtemp(prefix="prism-manifest-")
mpath = os.path.join(work, "manifest.json")
with open(mpath, "w", encoding="utf-8", newline="\n") as f:
    json.dump(manifest, f, indent=2); f.write("\n")
print(sh(["node", os.path.join(ROOT, "scripts", "release", "sign-manifest.mjs"), mpath]))
spath = os.path.join(work, "manifest.sig")

if a.dry_run:
    print("dry run: nothing uploaded. Manifest:\n" + open(mpath, encoding="utf-8").read())
else:
    import boto3
    from botocore.config import Config
    env = dict(l.rstrip("\n").split("=", 1) for l in open(ENV) if "=" in l)
    s3 = boto3.client("s3", endpoint_url=env["AWS_ENDPOINT_URL_S3"], region_name="auto",
                      aws_access_key_id=env["AWS_ACCESS_KEY_ID"], aws_secret_access_key=env["AWS_SECRET_ACCESS_KEY"],
                      config=Config(s3={"addressing_style": "virtual"}))
    bucket = env["BUCKET_NAME"]
    have = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX + "files/"):
        for o in page.get("Contents", []): have.add(o["Key"])
    new_blobs = [e for e in entries if PREFIX + "files/" + e["sha256"] + ".gz" not in have]
    sent = 0
    for e in new_blobs:
        body = gzip.compress(open(e["_full"], "rb").read(), 9)
        s3.put_object(Bucket=bucket, Key=PREFIX + "files/" + e["sha256"] + ".gz", Body=body, ContentType="application/gzip",
                      CacheControl="public, max-age=31536000, immutable", ACL="public-read")
        sent += len(body)
    print(f"files: {len(new_blobs)} new of {len(entries)} uploaded ({sent/1048576:.1f} MB); the rest were already there")
    s3.put_object(Bucket=bucket, Key=PREFIX + "files/" + list_name, Body=list_bytes, ContentType="application/json",
                  CacheControl="public, max-age=31536000, immutable", ACL="public-read")
    print("uploading", name)
    s3.upload_file(zip_path, bucket, PREFIX + name, ExtraArgs={"ContentType": "application/zip", "CacheControl": "public, max-age=31536000, immutable", "ACL": "public-read"})
    s3.put_object(Bucket=bucket, Key=PREFIX + "manifest.json", Body=open(mpath, "rb").read(), ContentType="application/json", CacheControl="public, max-age=60", ACL="public-read")
    s3.put_object(Bucket=bucket, Key=PREFIX + "manifest.sig", Body=open(spath, "rb").read(), ContentType="text/plain", CacheControl="public, max-age=60", ACL="public-read")
    print("published:", BASE_URL + name)
    print("manifest:  ", BASE_URL + "manifest.json")

# the record: the changelog at the repo root, and a GitHub Release on the public repo
gh_url = f"https://github.com/{a.public_repo}/releases/tag/v{version}"
NL = chr(10)
if not a.dry_run:
    cl = os.path.join(ROOT, "CHANGELOG.md")
    intro = "# Prism changelog" + NL + NL + "Every Windows release, newest first. The same notes travel in the update manifest and on the website." + NL
    old = open(cl, encoding="utf-8").read() if os.path.exists(cl) else intro
    # the entries follow the intro; a version already there is replaced
    marker = NL + "## "
    cut = old.find(marker)
    head = old if cut < 0 else old[:cut + 1]
    entries = [] if cut < 0 else ["## " + e for e in old[cut + 4:].split(NL + "## ")]
    entries = [e for e in entries if not e.startswith(f"## {version} ")]
    entry = (f"## {version} - {date.today().isoformat()} ({a.channel}, {commit})" + NL + NL + a.notes + NL + NL
             + f"- download: {BASE_URL + name}" + NL + f"- sha256: {sha}" + NL + f"- release: {gh_url}" + NL)
    with open(cl, "w", encoding="utf-8", newline="\n") as f:
        f.write(head.rstrip(NL) + NL + NL + entry + (NL + NL.join(e.rstrip(NL) + NL for e in entries) if entries else ""))
    print("changelog:", cl, "- commit it")
    if not a.no_github:
        body = (a.notes + NL + NL + f"- download: {BASE_URL + name}" + NL + f"- sha256: `{sha}`" + NL + f"- size: {size/1048576:.1f} MB" + NL
                + f"- channel: {a.channel}" + NL + NL + f"Updates: Prism menu, Updates. The same release is named in {BASE_URL}manifest.json.")
        # the source of this release on the public repo first, and the release's tag on it
        snap = subprocess.run([sys.executable, SNAP, "push", f"Prism {version}" + NL + NL + a.notes], capture_output=True, text=True)
        target = snap.stdout.strip().splitlines()[-1] if snap.returncode == 0 and snap.stdout.strip() else None
        print("public snapshot:", target[:8] if target else "FAILED " + (snap.stdout + snap.stderr).strip())
        r = subprocess.run(["gh", "release", "create", f"v{version}", zip_path, "--repo", a.public_repo, "--title", f"Prism {version}", "--notes", body]
                           + (["--target", target] if target else []) + (["--prerelease"] if a.channel != "stable" else []), capture_output=True, text=True)
        print("github release:", r.stdout.strip() if r.returncode == 0 else "FAILED " + r.stderr.strip())

if a.site:
    rel = os.path.join(a.site, "src", "data", "releases.json")
    try:
        cur = json.load(open(rel, encoding="utf-8")) if os.path.exists(rel) else {}
    except Exception:
        cur = {}
    # the site's own field names (its releases.json _example): sizeMb, downloadUrl (the counting redirect), releaseUrl (GitHub), releaseNotesUrl
    entry = {"version": version, "date": date.today().isoformat(), "sizeMb": round(size / 1048576), "sha256": sha,
             "downloadUrl": "https://reports.entangled.world/v1/download/windows" if a.channel == HEADLINE else BASE_URL + name,
             "fileUrl": BASE_URL + name, "releaseUrl": gh_url, "releaseNotesUrl": "/prism/changelog", "notes": a.notes, "commit": commit, "channel": a.channel,
             "track": TRACK_LABEL[a.channel],
             "manifestUrl": BASE_URL + "manifest.json", "downloadsApi": "https://reports.entangled.world/v1/downloads"}
    if a.channel == HEADLINE:
        cur["windows"] = entry
    hist = [h for h in (cur.get("history") or []) if h.get("version") != version]
    cur["history"] = [entry] + hist
    os.makedirs(os.path.dirname(rel), exist_ok=True)
    with open(rel, "w", encoding="utf-8", newline="\n") as f:
        json.dump(cur, f, indent=2); f.write("\n")
    red = os.path.join(a.site, "public", "_redirects")
    lines = [l for l in (open(red, encoding="utf-8").read().splitlines() if os.path.exists(red) else []) if not l.startswith("/prism/download/windows ")]
    lines.append("/prism/download/windows https://reports.entangled.world/v1/download/windows 302")
    with open(red, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print("website updated:", rel, "and", red, "- run `npm run deploy` there")
