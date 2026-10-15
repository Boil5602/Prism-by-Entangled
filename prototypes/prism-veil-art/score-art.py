"""
How vivid a photo is, by numbers (2026-10-15, "The ones we have selected for both prism and the extensions are very dull").

    python score-art.py <folder-or-list.json> <out.json>

Each image is read at 256 px on its long side and measured four ways:
  colorfulness  Hasler & Suesstrunk (2003): spread and strength of the opponent colour axes rg, yb - the measure used for "how
                colourful does this look" (0 grey, ~15 slightly, ~45 quite, ~80 very)
  contrast      the standard deviation of luma (0-255)
  exposure      the mean luma; far from the middle is dark or washed out
  sharpness     the variance of a 3x3 Laplacian on luma (small images, so a relative figure)
and given one figure, `vivid`, to rank by: colourfulness first, contrast and sharpness after, a penalty for a dark or washed-out
picture. The figure is a ranking aid for a person's choice, never the choice itself.
"""
import io, json, os, sys
import numpy as np
from PIL import Image


def measure(img):
    img = img.convert('RGB'); img.thumbnail((256, 256))
    a = np.asarray(img, dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    rg = r - g; yb = 0.5 * (r + g) - b
    colorful = float(np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2))
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    contrast = float(luma.std()); exposure = float(luma.mean())
    lap = (-4 * luma[1:-1, 1:-1] + luma[:-2, 1:-1] + luma[2:, 1:-1] + luma[1:-1, :-2] + luma[1:-1, 2:])
    sharp = float(lap.var())
    exp_pen = max(0.0, abs(exposure - 120) - 55) * 0.6
    vivid = colorful + 0.35 * contrast + 4.0 * np.log1p(sharp) - exp_pen
    return {'colorful': round(colorful, 1), 'contrast': round(contrast, 1), 'exposure': round(exposure, 1), 'sharp': round(sharp, 1), 'vivid': round(float(vivid), 1), 'w': img.width, 'h': img.height}


def main():
    src, out = sys.argv[1], sys.argv[2]
    res = {}
    if os.path.isdir(src):
        names = sorted(n for n in os.listdir(src) if n.lower().endswith(('.jpg', '.jpeg', '.png')))
        for i, n in enumerate(names):
            try:
                with Image.open(os.path.join(src, n)) as im: res[n] = measure(im)
            except Exception as e: res[n] = {'error': str(e)}
            if i % 250 == 0: print(i, '/', len(names), flush=True)
    else:
        print('a folder of images is expected'); sys.exit(2)
    with open(out, 'w', encoding='utf-8') as f: json.dump(res, f)
    print('scored', len(res), '->', out)


if __name__ == '__main__':
    main()
