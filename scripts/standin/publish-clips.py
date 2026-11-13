"""The clips of the visuals put where the website reads them, with their stills and clips.json (2026-11-11).

    python scripts/standin/publish-clips.py <takes folder> <cards folder> <site folder> [name=frame ...]

<takes folder> holds what make-clip.py wrote (name.mp4, name.webm, name.take.json); <cards folder> holds the chrome pictures the
clips were made with (cards.json: name -> picture). A still is the clip's own frame: name=frame chooses it, else the take's
recommended one. It is drawn again at 2560 x 1440 where the scene fits a bitmap of that size (the song's block is the app's own
drawing enlarged), else it is the clip's frame at the clip's size. Nothing is deployed; the files are written and that is all.
"""
import io, json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(os.path.dirname(HERE))
ONLY = None
if "--only" in sys.argv: i = sys.argv.index("--only"); ONLY = sys.argv[i + 1]; del sys.argv[i:i + 2]   # one clip again; the others' entries in clips.json are kept
takes, cards_dir, site = sys.argv[1:4]; chosen = dict(a.split("=") for a in sys.argv[4:])
cards = json.load(io.open(os.path.join(cards_dir, "cards.json"), encoding="utf-8"))
SAY = {
    "sunrise-meadow": "A meadow at sunrise: each tall flower rises and opens with one band of the music, and the sun climbs with the loudness.",
    "fireworks-night": "Fireworks over a river town: a burst goes up on each beat, coloured by the band that jumped and sized by the beat's strength.",
    "street-fair": "A street fair at night: the big wheel is a round sound meter with one band on each spoke, and the lights follow the music.",
    "storm-front": "A storm crossing an open plain: each curtain of rain is one band and falls further as it rises, and the cloud lights with the loudness.",
    "aurora-ridge": "The northern lights over a mountain lake: each ray stands as tall and as bright as the band under it.",
    "city-skyline": "A city across the water at night: each tower lights floor by floor with a band of its own.",
    "snow-village": "A village in a snowy valley: each window is one band and throws its light on the snow, and the flakes drift with the music.",
    "prism-beams": "A white beam enters a glass prism and leaves as four coloured bands: each band swings, widens and brightens with its own quarter of the music.",
    "spectrum": "Bars in the palette from the low notes to the high: each bar is one band, with a cap that holds its peak and a reflection under it.",
    "ribbon": "Five silk ribbons crossing the stage: each is as thick as the music under it, and the low notes lift the swell.",
    "bloom": "A flower of light: each petal is one band and opens as far as that band is loud, and a beat sends out a ring and a scatter of pollen.",
    "sunrise-meadow-phone": "The phone's Listen page, upright: Sunrise Meadow drawn in the browser from the PC's bands, with the song's cover in the corner.",
}
os.makedirs(site, exist_ok=True); out = []
for fn in sorted(os.listdir(takes)):
    if not fn.endswith(".take.json"): continue
    t = json.load(io.open(os.path.join(takes, fn), encoding="utf-8")); name = t["name"]
    if ONLY and name != ONLY: continue
    frame = int(chosen.get(name, t["recommended"]))
    for ext in ("mp4", "webm"): shutil.copyfile(os.path.join(takes, f"{name}.{ext}"), os.path.join(site, f"{name}.{ext}"))
    still = os.path.join(site, name + ".png"); size = None
    if name in cards:
        r = subprocess.run([sys.executable, os.path.join(HERE, "make-clip.py"), "still", t["id"], t["log"], str(t["first"]), str(frame), os.path.join(cards_dir, cards[name]), still, "--size", "2560x1440"], capture_output=True, text=True)
        if r.returncode == 0: size = [2560, 1440]
        else: print(" ", name, "not at 2560:", (r.stdout + r.stderr).strip().splitlines()[-1][:160])
    if size is None:
        cand = os.path.join(takes, f"{name}-candidate-{frame:03d}.png")
        if not os.path.exists(cand): sys.exit(f"{name}: frame {frame} is not one of the candidates {t['candidates']}")
        shutil.copyfile(cand, still); from PIL import Image; size = list(Image.open(still).size)
    pack = os.path.join(REPO, "packages", "core", "data", "visualization-styles", t["id"] + ".json")
    out.append({"file": name, "name": json.load(io.open(pack, encoding="utf-8"))["name"] + (" on the phone's Listen page" if name.endswith("-phone") else ""), "says": SAY[name], "seconds": t["seconds"],
                "width": 720 if name.endswith("-phone") else 1280, "height": 1280 if name.endswith("-phone") else 720,
                "bytes": {"mp4": os.path.getsize(os.path.join(site, name + ".mp4")), "webm": os.path.getsize(os.path.join(site, name + ".webm")), "png": os.path.getsize(still)},
                "still": {"seconds": round(frame / 30, 3), "frame": frame, "width": size[0], "height": size[1]}, "loops": False})
    print(name, "still frame", frame, size)
if ONLY: old = json.load(io.open(os.path.join(site, "clips.json"), encoding="utf-8"))["clips"]; out = sorted([c for c in old if c["file"] != ONLY] + out, key=lambda c: c["file"])
f = io.open(os.path.join(site, "clips.json"), "w", encoding="utf-8", newline="\n"); json.dump({"note": "30 frames a second, no sound track. A clip does not loop cleanly (the scene follows the music): fade it. Start the video at still.seconds so the picture does not jump.", "clips": out}, f, indent=1); f.write("\n"); f.close()
print("clips.json:", len(out), "clips")
