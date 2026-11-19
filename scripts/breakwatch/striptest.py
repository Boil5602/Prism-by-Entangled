"""The detector given only the picture above a channel's strip (2026-11-15, the strip study): a test on recorded frames.

A stretch of one channel is copied twice into a work folder: as recorded, and with every frame of the channel cut at the strip's
first row and drawn to the full height again, so the detector reads a picture with no strip under it. Both copies are replayed
through the bench with one trained model and the bench's own cut off (STRIPCUT=0), and the ad time covered and the show time
wrongly covered are printed side by side. A third row replays the frames as recorded with the bench's cut on: what PRISM does
with a channel named in BreakModel.StripRow (the same figures as the second row when the channel and the row are the same).
Nothing in the recordings is changed.

    PROMOS=show python scripts/breakwatch/striptest.py <day> <window> <from HH:MM:SS> <to HH:MM:SS> <strip first row> <model.json> <work folder> [--lead=5]

--lead is the minutes of recording replayed before <from> as they are (the readings that look back need them). The library copy
is the day's newest at or before <from>, as an exam's."""
import io, json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import promos  # noqa: E402

args = sys.argv[1:]
def opt(name, default):
    for a in args:
        if a.startswith(name + "="): return a.split("=", 1)[1]
    return default
pos = [a for a in args if not a.startswith("--")]
if len(pos) < 7: print(__doc__); sys.exit(1)
day, win, frm, to, row, model, work = pos[:7]; row = int(row); LEAD = int(opt("--lead", "5"))
G = os.path.join(os.environ["LOCALAPPDATA"], "Prism", "diagnostics", "golden")
HERE = os.path.dirname(os.path.abspath(__file__)); EXE = os.path.join(HERE, "bwtest", "bin", "Release", "net8.0", "bwtest.exe")


def sec(h): x, y, z = h.split(":"); return int(x) * 3600 + int(y) * 60 + int(z)
def name9(s): return f"{s // 3600:02d}{s // 60 % 60:02d}{s % 60:02d}000"
def spans(t, ss):
    m = np.zeros(len(t), bool)
    for a, b in ss: m |= (t >= sec(a)) & (t <= sec(b))
    return m
def policy(p, on=0.80, off=0.55, hold=2):
    out = np.zeros(len(p), bool); up = False; run = 0
    for i, v in enumerate(p):
        run = run + 1 if v > on else 0
        if not up and run >= hold: up = True
        elif up and v < off: up = False
        out[i] = up
    return out


A, B = sec(frm), sec(to); f0, f1 = name9(A - LEAD * 60), name9(B)
src = os.path.join(G, day, win)
lib_root = os.path.join(G, day, "library"); libs = sorted(d for d in os.listdir(lib_root) if d <= frm.replace(":", ""))
lib = os.path.join(lib_root, libs[-1] if libs else sorted(os.listdir(lib_root))[0])
frames = sorted(f for f in os.listdir(src) if f.endswith(".gray") and f0 <= f[:9] <= f1)
res = {}
for tag in ("as-recorded", "above-the-strip", "by-the-bench"):
    root = os.path.join(work, "as-recorded" if tag == "by-the-bench" else tag); dst = os.path.join(root, win)
    if tag != "by-the-bench":
        if os.path.isdir(root): shutil.rmtree(root)
        os.makedirs(dst)
    for f in ([] if tag == "by-the-bench" else os.listdir(src)):
        if not f.endswith(".gray") and os.path.isfile(os.path.join(src, f)): shutil.copy2(os.path.join(src, f), os.path.join(dst, f))
    n = 0
    for f in ([] if tag == "by-the-bench" else frames):
        if tag == "above-the-strip" and f[:9] >= name9(A):
            g = np.fromfile(os.path.join(src, f), np.uint8)
            if g.size == 57600:
                im = Image.fromarray(g.reshape(180, 320)[:row]).resize((320, 180), Image.BILINEAR)
                np.asarray(im, np.uint8).tofile(os.path.join(dst, f)); n += 1; continue
        shutil.copy2(os.path.join(src, f), os.path.join(dst, f))
    par = os.path.join(work, tag + ".csv")
    env = dict(os.environ, BENCHROOT=root, BWDIR=lib, LMODEL=os.path.abspath(model), LPARITY=par, FEATCSV="", LCALLS="", LCALLS0="", BANDLOGO="1", BANDSTRICT="0", STRIPCUT="1" if tag == "by-the-bench" else "0")
    out = subprocess.run([EXE, "bench", f0, f1, os.path.join(work, tag + ".rules.log")], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                         creationflags=getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0))
    if not os.path.exists(par): print(tag, "the bench wrote no scores:", (out.stdout or "")[-400:], (out.stderr or "")[-400:]); sys.exit(1)
    rows = [l.rstrip("\n").split(",") for l in io.open(par, encoding="utf-8")][1:]
    rows = [(float(r[1]), float(r[2])) for r in rows if r[0].endswith(win)]
    a = np.array(sorted(rows)); t, p = a[:, 0], a[:, 1]; cv = policy(p)
    lab = json.load(io.open(os.path.join(G, day, "labels.json"), encoding="utf-8"))["windows"][win]
    ads = promos.ads_for(os.path.join(G, day), win, lab["ads"]) if promos.on() else lab["ads"]
    pm = spans(t, promos.load(os.path.join(G, day)).get(win, [])) if promos.on() else np.zeros(len(t), bool)
    y = spans(t, ads); use = (t >= A) & (t < B) & ~spans(t, lab.get("neutral", []))
    dt = np.minimum(np.diff(t, append=t[-1] + 1), 3.0)
    res[tag] = dict(frames=len(frames), changed=n, ad=float(dt[use & y].sum()), covered=float(dt[use & y & cv].sum()), show=float(dt[use & ~y & ~pm].sum()),
                    wrong=float(dt[use & ~y & ~pm & cv].sum()), promo_covered=float(dt[use & pm & cv].sum()), mean_ad=float(p[use & y].mean()), mean_show=float(p[use & ~y & ~pm].mean()))
    r = res[tag]
    print(f"{tag:<16} frames {r['frames']} ({r['changed']} cut at row {row})  ads covered {100 * r['covered'] / max(r['ad'], 1):5.1f}% ({r['covered']:.0f} of {r['ad']:.0f} s)  "
          f"programme wrongly covered {100 * r['wrong'] / max(r['show'], 1):5.2f}% ({r['wrong']:.0f} of {r['show']:.0f} s)  mean chance in ads {r['mean_ad']:.2f}, in the programme {r['mean_show']:.2f}", flush=True)
f = io.open(os.path.join(work, "result.json"), "w", encoding="utf-8"); f.write(json.dumps(dict(day=day, window=win, frm=frm, to=to, row=row, model=model, library=lib, result=res), indent=1)); f.close()
