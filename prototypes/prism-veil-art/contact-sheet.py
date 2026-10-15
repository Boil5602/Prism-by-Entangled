"""
A contact sheet: the named pictures in a grid, each with its number and a short label, for a person's choice.

    python contact-sheet.py <out.png> <cols> <cell-width> <folder> <names.txt>      names.txt: one "file<TAB>label" per line
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont


def main():
    out, cols, cw, folder, lst = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
    items = [l.rstrip('\n').split('\t', 1) for l in open(lst, encoding='utf-8') if l.strip()]
    ch = int(cw * 9 / 16); pad = 6; lh = 22
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (cw + pad) + pad, rows * (ch + lh + pad) + pad), (20, 23, 28))
    d = ImageDraw.Draw(sheet)
    try: font = ImageFont.truetype('segoeui.ttf', 15)
    except Exception: font = ImageFont.load_default()
    for i, it in enumerate(items):
        name = it[0]; label = it[1] if len(it) > 1 else ''
        x = pad + (i % cols) * (cw + pad); y = pad + (i // cols) * (ch + lh + pad)
        try:
            with Image.open(os.path.join(folder, name)) as im:
                im = im.convert('RGB'); r = max(cw / im.width, ch / im.height)
                im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))))
                l = (im.width - cw) // 2; t = (im.height - ch) // 2
                sheet.paste(im.crop((l, t, l + cw, t + ch)), (x, y))
        except Exception:
            d.rectangle((x, y, x + cw, y + ch), fill=(60, 30, 30))
        d.text((x + 2, y + ch + 2), f'{i + 1}  {label}'[:int(cw / 7.5)], fill=(232, 236, 242), font=font)
    sheet.save(out, quality=88)
    print('sheet', out, sheet.size)


if __name__ == '__main__':
    main()
