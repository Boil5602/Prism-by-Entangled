"""A clip of one of the Music player's visuals, for the website (2026-11-11, asked for short clips in place of one still).

    python scripts/standin/make-clip.py windows <vizlog> [--seconds 10] [--count 8]
    python scripts/standin/make-clip.py clip <visual id> <vizlog> <first line> <frames> <chrome.png> <out folder> [--name sunrise-meadow]
    python scripts/standin/make-clip.py frames <folder of f0000.png ...> <name> <out folder> <vizlog> <first line>
    python scripts/standin/make-clip.py still <visual id> <vizlog> <first line> <frame> <chrome.png> <out.png> [--size 2560x1440]

How a clip is made. PRISM runs its Music player with stand-ins on and music playing, and the dev command `vizlog <file>` writes what
the scene on the stage is given, thirty times a second: the 64 band levels of the music and the scene's clock. The dev command
`record` writes the stage's own chrome (the song's block and the cover, both stand-ins) as a picture. This script then has the same
scene code (Tableaus.*.cs, built into a small preview program) draw those frames again one by one, lays the chrome over each, and
encodes them. So every frame is the app's own drawing of real music's bands, at an even thirty frames a second, and no sound and no
real song, artist or cover is in any file. `windows` lists stretches of the log with a build and a release.

The preview program is not in the repository (PREVIEW names its exe); ffmpeg must be on the PATH or in WinGet's Links folder.
"""
import io, json, os, shutil, subprocess, sys, tempfile

import numpy as np
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKS = os.path.join(REPO, "packages", "core", "data", "visualization-styles")
PREVIEW = os.environ.get("PREVIEW", "")
FFMPEG = shutil.which("ffmpeg") or os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links", "ffmpeg.exe")
A = sys.argv[1:]
def opt(n, d=None):
    if n in A:
        i = A.index(n); v = A[i + 1]; del A[i:i + 2]; return v
    return d

def read_log(path):
    rows = []
    for line in io.open(path, encoding="utf-8"):
        h = line.split("|")
        if len(h) != 2: continue
        v = [float(x) for x in h[0].split()]
        if len(v) >= 9: rows.append(v[:9] + [float(np.mean([float(x) for x in h[1].split()]))])
    return np.array(rows)   # T dt speed reduced beat low mid high loud mean

def windows(path, seconds, count):
    """Stretches with a build and a release: quiet at the start, a peak past the middle, lower again at the end; none overlapping."""
    r = read_log(path); n = int(seconds * 30); loud = r[:, 8]   # the loudness as the scene gets it, ranged to the music's recent span
    k = np.ones(30) / 30; sm = np.convolve(loud, k, mode="same")
    live = (r[:, 3] == 0) & (np.abs(r[:, 1] - 1 / 30) < 0.01)
    scores = []
    for s in range(0, len(r) - n, 15):
        if not live[s:s + n].all(): continue
        w = sm[s:s + n]; head = w[:n // 4].mean(); peak_at = int(np.argmax(w)); peak = w[peak_at]; tail = w[-n // 6:].mean()
        if not (0.35 * n < peak_at < 0.85 * n): continue
        beats = int((r[s:s + n, 4] > 0.25).sum())
        scores.append(((peak - head) + 0.6 * (peak - tail) + 0.3 * w.mean() + min(beats, 30) / 60, s, head, peak, tail, peak_at, beats))
    scores.sort(reverse=True); out = []
    for sc in scores:
        if all(abs(sc[1] - o[1]) >= n for o in out): out.append(sc)
        if len(out) >= count: break
    for sc in out: print(f"line {sc[1]:6d}  score {sc[0]:.3f}  start {sc[2]:.3f}  peak {sc[3]:.3f} at {sc[5] / 30:.1f} s  end {sc[4]:.3f}  beats {sc[6]}")
    return out

def palette(vid): return [c.lstrip("#") for c in json.load(io.open(os.path.join(PACKS, vid + ".json"), encoding="utf-8"))["palette"]]
def program(vid): return json.load(io.open(os.path.join(PACKS, vid + ".json"), encoding="utf-8"))["program"]

def draw(vid, log, first, count, w, h, work, warm=450):
    """The scene's frames first..first+count of the log, drawn by the preview program: a numpy view (count, h, w, 4) BGRA."""
    if not PREVIEW or not os.path.exists(PREVIEW): sys.exit("set PREVIEW to the preview program's exe")
    os.makedirs(work, exist_ok=True)
    for f in ("frames.bgra", "preview.log"):
        if os.path.exists(os.path.join(work, f)): os.remove(os.path.join(work, f))
    subprocess.run([PREVIEW, os.path.abspath(work), str(w), str(h), "0", program(vid), "replay", os.path.abspath(log), str(first), str(count), str(warm)] + palette(vid), check=True)
    note = io.open(os.path.join(work, "preview.log"), encoding="utf-8").read()
    if not note.startswith("ok"): sys.exit("the preview program failed: " + note[:400])
    if "bitmap=4096x" in note or note.rstrip().endswith("x4096"): sys.exit(f"{vid} draws too far past its edges for a {w}x{h} bitmap (the 4096 px limit of a XAML bitmap): draw it smaller")
    return np.memmap(os.path.join(work, "frames.bgra"), dtype=np.uint8, mode="r").reshape(-1, h, w, 4)

def chrome_of(path, w, h):
    """The chrome picture (premultiplied RGBA, as the app's bitmap has it), at the frame's size: (rgb float, 1 - alpha)."""
    c = Image.open(path).convert("RGBA")
    if c.size != (w, h): c = Image.merge("RGBA", [b.resize((w, h), Image.LANCZOS) for b in c.split()])   # band by band: the colours are premultiplied already
    a = np.asarray(c).astype(np.float32); return a[..., :3], 1 - a[..., 3:4] / 255

def lay(frame_bgra, chrome):
    if chrome is None: return frame_bgra   # frames that are whole pictures already (the phone's page)
    rgb = frame_bgra[..., [2, 1, 0]].astype(np.float32)
    return np.clip(chrome[0] + rgb * chrome[1], 0, 255).astype(np.uint8)

def encode(frames, chrome, base, w, h):
    """MP4 (H.264, yuv420p, faststart) and WebM (VP9), no sound track; the quality lowered step by step until a file is under 2 MB."""
    sizes = {}
    for ext, steps in (("mp4", [(["-c:v", "libx264", "-preset", "veryslow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-crf", str(q)]) for q in (20, 22, 24, 26, 28, 30)]),
                       ("webm", [(["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-crf", str(q)]) for q in (30, 33, 36, 39, 42, 45)])):
        for args in steps:
            out = base + "." + ext
            p = subprocess.Popen([FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", "30", "-i", "-", "-an"] + args + [out], stdin=subprocess.PIPE)
            for f in frames: p.stdin.write(lay(f, chrome).tobytes())
            p.stdin.close(); p.wait()
            sizes[ext] = (os.path.getsize(out), args[-1])
            if sizes[ext][0] <= 2_000_000: break
        print(f"  {os.path.basename(base)}.{ext}: {sizes[ext][0] / 1e6:.2f} MB at crf {sizes[ext][1]}")
    return sizes

def candidates(frames, log_rows, first, n=5):
    """Five frames to choose the still from: the fullest moments (the bands high), at least a second apart, none in the first or last half second."""
    lv = log_rows[first:first + len(frames), 8] + 2 * log_rows[first:first + len(frames), 9]; sm = np.convolve(lv, np.ones(5) / 5, mode="same"); order = np.argsort(-sm); picks = []
    for i in order:
        if 15 <= i < len(frames) - 15 and all(abs(int(i) - p) >= 30 for p in picks): picks.append(int(i))
        if len(picks) >= n: break
    return picks

def main():
    cmd = A.pop(0)
    if cmd == "windows":
        seconds = float(opt("--seconds", "10")); count = int(opt("--count", "8")); windows(A[0], seconds, count); return
    if cmd == "clip":
        name = opt("--name"); vid, log, first, count, chrome_png, out = A[0], A[1], int(A[2]), int(A[3]), A[4], A[5]
        name = name or vid; os.makedirs(out, exist_ok=True); w, h = 1280, 720
        work = os.path.join(tempfile.gettempdir(), "prism-clip-" + name)
        frames = draw(vid, log, first, count, w, h, work); chrome = chrome_of(chrome_png, w, h)
        sizes = encode(frames, chrome, os.path.join(out, name), w, h)
        rows = read_log(log); picks = candidates(frames, rows, first)
        best = picks[0]; cw, chh = 640, 360
        sheet = Image.new("RGB", (len(picks) * (cw + 8) + 8, chh + 44), (11, 13, 18)); d = ImageDraw.Draw(sheet)
        for k, i in enumerate(sorted(picks)):
            im = Image.fromarray(lay(frames[i], chrome)); im.save(os.path.join(out, f"{name}-candidate-{i:03d}.png"))
            x = 8 + k * (cw + 8); sheet.paste(im.resize((cw, chh), Image.LANCZOS), (x, 8))
            if i == best: d.rectangle((x - 3, 5, x + cw + 2, chh + 10), outline=(242, 177, 76), width=3)
            d.text((x, chh + 18), f"frame {i}  ({i / 30:.2f} s)" + ("   RECOMMENDED" if i == best else ""), fill=(242, 177, 76) if i == best else (232, 236, 242))
        sheet.save(os.path.join(out, f"{name}-candidates.jpg"), quality=90)
        json.dump({"id": vid, "name": name, "log": os.path.abspath(log), "first": first, "frames": len(frames), "seconds": round(len(frames) / 30, 2), "candidates": sorted(picks), "recommended": best,
                   "mp4": sizes["mp4"][0], "webm": sizes["webm"][0]}, io.open(os.path.join(out, name + ".take.json"), "w", encoding="utf-8"), indent=1)
        print("  candidates", sorted(picks), "recommended", best); return
    if cmd == "still":
        # the clip's own frame again at a larger size: drawn from the clip's first line on, so the scene has the same past and stands the same
        size = opt("--size", "2560x1440"); w, h = (int(x) for x in size.split("x")); vid, log, first, frame, chrome_png, out = A[0], A[1], int(A[2]), int(A[3]), A[4], A[5]
        work = os.path.join(tempfile.gettempdir(), "prism-still"); frames = draw(vid, log, first, frame + 1, w, h, work)
        im = Image.fromarray(lay(frames[frame], chrome_of(chrome_png, w, h))); del frames; im.save(out); os.remove(os.path.join(work, "frames.bgra")); print("still", out); return
    if cmd == "frames":   # a folder of whole frames (f0000.png ..., scripts/standin/listen-clip.mjs): encoded and its candidates laid out
        folder, name, out, log, first = A[0], A[1], A[2], A[3], int(A[4]); os.makedirs(out, exist_ok=True)
        files = sorted(f for f in os.listdir(folder) if f.endswith(".png")); frames = [np.asarray(Image.open(os.path.join(folder, f)).convert("RGB")) for f in files]
        h, w = frames[0].shape[:2]; sizes = encode(frames, None, os.path.join(out, name), w, h)
        picks = candidates(frames, read_log(log), first); best = picks[0]; cw, chh = 270, 480
        sheet = Image.new("RGB", (len(picks) * (cw + 8) + 8, chh + 44), (11, 13, 18)); d = ImageDraw.Draw(sheet)
        for k, i in enumerate(sorted(picks)):
            im = Image.fromarray(frames[i]); im.save(os.path.join(out, f"{name}-candidate-{i:03d}.png")); x = 8 + k * (cw + 8); sheet.paste(im.resize((cw, chh), Image.LANCZOS), (x, 8))
            if i == best: d.rectangle((x - 3, 5, x + cw + 2, chh + 10), outline=(242, 177, 76), width=3)
            d.text((x, chh + 18), f"frame {i} ({i / 30:.2f} s)" + ("  RECOMMENDED" if i == best else ""), fill=(242, 177, 76) if i == best else (232, 236, 242))
        sheet.save(os.path.join(out, f"{name}-candidates.jpg"), quality=90)
        json.dump({"id": "sunrise-meadow", "name": name, "log": os.path.abspath(log), "first": first, "frames": len(frames), "seconds": round(len(frames) / 30, 2), "candidates": sorted(picks), "recommended": best, "mp4": sizes["mp4"][0], "webm": sizes["webm"][0]},
                  io.open(os.path.join(out, name + ".take.json"), "w", encoding="utf-8"), indent=1)
        print("  candidates", sorted(picks), "recommended", best); return
    sys.exit(__doc__)

if __name__ == "__main__": main()
