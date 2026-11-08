"""What the Windows download is made of (2026-10-09, "the 128 mb size is surprising ... a breakdown of the total number that is collapsed
up to the total"): every file in the release zip put in one named part, each part's size the bytes its files take IN THE ZIP, so the
parts add up to the download's size exactly. publish-windows.py writes the result into the website's releases.json (the download page
shows it under Size); run by hand it prints the parts, or fills them in for the release the site already shows:

    python scripts/release/size_breakdown.py <Prism-x.y.z-commit.zip>
    python scripts/release/size_breakdown.py <Prism-x.y.z-commit.zip> --site C:/Projects/entangled.world

A part with no files is left out, so a part the build stops carrying leaves the page by itself. The labels and notes are what the page
says: plain words, and whose code each part is."""
import hashlib
import json
import os
import re
import sys
import zipfile

# first match wins; (key, label, note, test on the file's path in the zip, lower case, forward slashes)
DOTNET = re.compile(r"^(system\.|microsoft\.csharp|microsoft\.visualbasic|microsoft\.win32|mscor|netstandard|coreclr|clr|hostfxr|hostpolicy|createdump|msquic|microsoft\.diasymreader|windowsbase)")
WITHIN_PRISM = ("sounds", "pictures")   # counted on their own, shown inside "PRISM itself"
PARTS = [
    ("sounds", "Sounds", "The soundscape's ambient loops. MP3s are already compressed, so they take their full size.",
     lambda p: p.startswith("assets/tiles/")),
    ("pictures", "Pictures", "The gallery and cosmos picture sets PRISM shows behind an ad break. JPEGs take their full size too.",
     lambda p: p.startswith("assets/packs/")),
    ("prism", "PRISM itself", "PRISM's own code, the service adapters and the ad-break detector.",
     lambda p: p.startswith("assets/") or p.startswith("prismhost") or p == "readme.txt"),
    ("ml", "Machine-learning libraries (Microsoft)", "ONNX Runtime and DirectML arrive with the Windows App SDK. PRISM doesn't use them, and the next release leaves them out.",
     lambda p: re.match(r"^(onnxruntime|directml|microsoft\.ml\.onnxruntime|microsoft\.windows\.ai\.machinelearning)", p) is not None),
    ("winrt", "Windows bindings for .NET (Microsoft)", "Lets PRISM's code call Windows.",
     lambda p: re.match(r"^(microsoft\.windows\.sdk\.net|winrt\.runtime)", p) is not None),
    ("dotnet", ".NET runtime (Microsoft)", "Runs PRISM's code. It is carried inside the download so there is nothing to install first.",
     lambda p: "/" not in p and DOTNET.match(p) is not None),
    ("libraries", "Small libraries", "NAudio and LAME for sound, QRCoder for the pairing code, and the WebView2 loader.",
     lambda p: re.match(r"^(naudio|libmp3lame|qrcoder|microsoft\.web\.webview2|webview2loader)", p) is not None),
    ("winui", "Windows App SDK and WinUI (Microsoft)", "Draws PRISM's own screens and menus, in every language Windows has. Carried inside for the same reason.",
     lambda p: True),
]


def breakdown(zip_path):
    """[{key, label, note, mb, files}] largest first; the mb values (one decimal) add up to the zip's size (one decimal) exactly."""
    total = os.path.getsize(zip_path)
    with zipfile.ZipFile(zip_path) as z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        every = sorted(z.infolist(), key=lambda i: i.header_offset)
        first_central = z.start_dir
    # a file's bytes in the zip: from its local header to the next one, plus its record in the zip's index
    span = {}
    for n, i in enumerate(every):
        end = every[n + 1].header_offset if n + 1 < len(every) else first_central
        span[i.filename] = (end - i.header_offset) + 46 + len(i.filename.encode("utf-8")) + len(i.extra) + len(i.comment)
    sums = {k: [0, 0] for k, *_ in PARTS}
    for i in infos:
        p = i.filename.replace("\\", "/").lower()
        for key, _label, _note, test in PARTS:
            if test(p):
                sums[key][0] += span[i.filename]; sums[key][1] += 1
                break
    # tenths of a megabyte by largest remainder, so the rounded parts add up to the rounded total
    want = round(total / 1048576 * 10)
    exact = {k: v[0] / 1048576 * 10 for k, v in sums.items() if v[1]}
    tenths = {k: int(x) for k, x in exact.items()}
    for k in sorted(exact, key=lambda k: exact[k] - tenths[k], reverse=True)[: max(0, want - sum(tenths.values()))]:
        tenths[k] += 1
    out = [{"key": key, "label": label, "note": note, "mb": tenths[key] / 10, "files": sums[key][1]} for key, label, note, _ in PARTS if key in tenths and key != "prism" and key not in WITHIN_PRISM]
    # the sounds and the pictures are Prism's own ("Shouldnt prism sounds and pictures be considered part of prism?"): one part, its note
    # saying how much of it each is
    inside = [k for k in ("prism",) + WITHIN_PRISM if k in tenths]
    if inside:
        mb = lambda k: "%.1f MB" % (tenths[k] / 10)
        says = []
        if "prism" in tenths: says.append("PRISM's own code, the service adapters and the ad-break detector are " + mb("prism") + ".")
        if "sounds" in tenths: says.append("The soundscape's ambient loops are " + mb("sounds") + ".")
        if "pictures" in tenths: says.append("The gallery and cosmos picture sets PRISM shows behind an ad break are " + mb("pictures") + ".")
        if "sounds" in tenths or "pictures" in tenths: says.append("MP3s and JPEGs are already compressed, so they take their full size.")
        out.append({"key": "prism", "label": "PRISM itself", "note": " ".join(says), "mb": sum(tenths[k] for k in inside) / 10, "files": sum(sums[k][1] for k in inside)})
    out.sort(key=lambda r: r["mb"], reverse=True)
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    zip_path = sys.argv[1]
    parts = breakdown(zip_path)
    for r in parts:
        print("%6.1f MB  %4d files  %s" % (r["mb"], r["files"], r["label"]))
    print("%6.1f MB  %4d files  the download" % (sum(round(r["mb"] * 10) for r in parts) / 10, sum(r["files"] for r in parts)))
    if "--site" in sys.argv:
        rel = os.path.join(sys.argv[sys.argv.index("--site") + 1], "src", "data", "releases.json")
        cur = json.load(open(rel, encoding="utf-8"))
        sha = hashlib.sha256(open(zip_path, "rb").read()).hexdigest()
        if (cur.get("windows") or {}).get("sha256") != sha:
            sys.exit("the site's current release is not this zip (sha256 differs): nothing written")
        cur["windows"]["sizeParts"] = parts
        f = open(rel, "w", encoding="utf-8", newline="\n"); f.write(json.dumps(cur, indent=2) + "\n"); f.close()   # as publish-windows.py writes it
        print("written:", rel)
