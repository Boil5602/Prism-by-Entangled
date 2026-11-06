"""Plain coloured squares for the two repro apps' manifests (192 and 512 px). Pillow only; run once, the PNGs are committed."""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
for folder, colour in (("app-a", (0x2E, 0x6F, 0xD8)), ("app-b", (0xE0, 0x7A, 0x2A))):
    for size in (192, 512):
        Image.new("RGB", (size, size), colour).save(HERE / folder / f"icon-{size}.png")
        print(folder, size)
