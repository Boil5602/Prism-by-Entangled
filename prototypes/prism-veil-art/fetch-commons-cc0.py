"""
Vivid, full-resolution candidates from Wikimedia Commons whose license is CC0 or whose status is public domain (2026-10-15, "We need
some new CC0 pictures. The ones we have selected for both prism and the extensions are very dull").

    python fetch-commons-cc0.py fetch <out.json>         the nature searches below, CC0 / PD only, Quality or Featured
    python fetch-commons-cc0.py thumbs <in.json> <dir>   each candidate's 320 px thumbnail, for scoring and the contact sheet

Where: Commons' community review - *Quality images* (technically sound, reviewed one by one) and *Featured pictures* (the best of
Commons) - searched with the files' structured data: copyright license CC0 (P275 = Q6938433) or copyright status public domain
(P6216 = Q19652). The license is checked again from each file's own page data (LicenseShortName) with the pool's own rule
(fetch-candidates.py FREE: CC0 / PD / public domain) and anything else is dropped. A candidate is a JPEG at least 1920 px wide,
landscape (1.2 to 2.6 wide for each high), not already in the pool. The records are fetch-candidates.py's own shape (tier "free"),
so its `--accept --local` takes the chosen ones into pool/ with their manifest entries. Polite: one request a second, a named UA.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

API = 'https://commons.wikimedia.org/w/api.php'
UA = 'PrismVeil-art-candidates/0.2 (https://prism.entangled.world; open-source dashboard frames; polite)'
FREE = re.compile(r'^(cc0|pd|public domain)', re.I)
TERMS = ['landscape', 'mountain', 'lake', 'waterfall', 'sunset', 'sunrise', 'forest', 'autumn', 'wildflowers', 'meadow', 'beach', 'coast',
         'sea', 'cliffs', 'canyon', 'glacier', 'snow', 'aurora', 'milky way', 'night sky', 'desert', 'dunes', 'river', 'valley', 'volcano',
         'coral reef', 'bird', 'butterfly', 'fox', 'deer', 'tulips', 'cherry blossom', 'lavender', 'rainbow', 'clouds', 'fog', 'island',
         'ice', 'flower', 'tree', 'lightning', 'starry', 'nebula', 'galaxy', 'fjord', 'alps', 'hills', 'bay']
LIC = 'haswbstatement:P275=Q6938433|P6216=Q19652'
CATS = 'incategory:Quality_images|Featured_pictures_on_Wikimedia_Commons'


def get(params, tries=4):
    url = API + '?' + urllib.parse.urlencode(dict(params, format='json'))
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r: data = json.loads(r.read())
            time.sleep(1.0); return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 503): time.sleep(20 * (i + 1)); continue
            raise
        except Exception: time.sleep(5)
    return {}


def strip_html(s): return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s or '')).strip()


def pool_pages():
    try: m = json.load(open('pool/manifest.json', encoding='utf-8'))
    except Exception: return set()
    return {urllib.parse.unquote(e.get('source', '')).replace(' ', '_').split('/wiki/')[-1].lower() for e in m.get('images', [])}


def fetch(out):
    have = pool_pages(); titles = []
    for t in TERMS:
        for off in (0, 50):
            d = get({'action': 'query', 'list': 'search', 'srsearch': f'{LIC} {CATS} {t}', 'srnamespace': 6, 'srlimit': 50, 'sroffset': off})
            hits = [x['title'] for x in d.get('query', {}).get('search', [])]
            titles += [(h, t) for h in hits]
            print(t, off, len(hits), flush=True)
            if len(hits) < 50: break
    seen = {}; [seen.setdefault(h, t) for h, t in titles]
    keep = []
    names = list(seen)
    for i in range(0, len(names), 50):
        batch = names[i:i + 50]
        d = get({'action': 'query', 'titles': '|'.join(batch), 'prop': 'imageinfo', 'iiprop': 'url|size|mime|extmetadata', 'iiurlwidth': 320})
        for p in d.get('query', {}).get('pages', {}).values():
            ii = (p.get('imageinfo') or [{}])[0]; md = ii.get('extmetadata') or {}
            lic = strip_html((md.get('LicenseShortName') or {}).get('value'))
            w, h = ii.get('width') or 0, ii.get('height') or 0
            if not FREE.search(lic) or ii.get('mime') != 'image/jpeg' or w < 1920 or not h or not (1.2 <= w / h <= 2.6): continue
            key = p['title'].replace(' ', '_').lower()
            if key in have: continue
            page = 'https://commons.wikimedia.org/wiki/' + urllib.parse.quote(p['title'].replace(' ', '_'))
            keep.append({'id': 'commons:' + p['title'], 'source': 'Wikimedia Commons - CC0 / public domain, Quality or Featured (' + seen[p['title']] + ')',
                         'title': p['title'].split(':', 1)[1], 'page': page, 'author': strip_html((md.get('Artist') or {}).get('value'))[:120] or 'unknown',
                         'license': 'CC0' if lic.lower().startswith('cc0') else 'Public domain', 'width': w, 'height': h,
                         'thumb': ii.get('thumburl'), 'full': ii.get('url'), 'tier': 'free', 'term': seen[p['title']]})
        print('info', i + len(batch), '/', len(names), '->', len(keep), flush=True)
    with open(out, 'w', encoding='utf-8') as f: json.dump(keep, f, ensure_ascii=False, indent=1)
    print('kept', len(keep), 'of', len(names), '->', out)


def thumbs(src, folder):
    os.makedirs(folder, exist_ok=True)
    cs = json.load(open(src, encoding='utf-8'))
    for i, c in enumerate(cs):
        path = os.path.join(folder, re.sub(r'[^a-z0-9]+', '_', c['title'].lower())[:80] + '.jpg')
        c['thumbfile'] = os.path.basename(path)
        if os.path.exists(path): continue
        for k in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(c['thumb'], headers={'User-Agent': UA}), timeout=60) as r: open(path, 'wb').write(r.read())
                break
            except Exception: time.sleep(5 * (k + 1))
        time.sleep(0.4)
        if i % 100 == 0: print(i, '/', len(cs), flush=True)
    with open(src, 'w', encoding='utf-8') as f: json.dump(cs, f, ensure_ascii=False, indent=1)
    print('thumbs in', folder)


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'fetch': fetch(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'thumbs': thumbs(sys.argv[2], sys.argv[3])
    else: print(__doc__)
