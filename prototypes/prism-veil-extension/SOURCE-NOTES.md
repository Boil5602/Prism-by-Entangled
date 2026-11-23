# PRISM extension: source notes for store reviewers

This file says what every generated or third-party file in the packages is, where it comes from, and how to rebuild the
packages from the public repository. It is not part of any package.

Public repository: https://github.com/Boil5602/Prism-by-Entangled (GPL-3.0-or-later)
Extension folder: `prototypes/prism-veil-extension/`

## The Firefox package (addons.mozilla.org)

Everything in the Firefox package is plain JavaScript, HTML, and CSS written for PRISM, except the files in the two tables
below. The one minified third-party library is Tesseract.js (second table).

| File in the package | What it is | Made from | Made by |
|---|---|---|---|
| `src/core-popups.js` | The popup policy (decides if a window a page opens is a popup). Bundled, not minified. | `packages/core/src/popups.ts` | `npm run build:veil` (esbuild 0.28.2) |
| `src/core-popups-iso.js` | The same bundle a second time, for the isolated world. Only the first comment line differs. | `packages/core/src/popups.ts` | `npm run build:veil` |
| `src/core-reclaimed.js` | The time reclaimed totals. Bundled, not minified. | `packages/core/src/reclaimed.ts` | `npm run build:veil` |
| `src/art-credits.js` | Data only: the credit line (title, author, license, source) of each picture. | The picture pool's manifest | `prototypes/prism-veil-art/fetch-art.py --credits` |
| `src/art.js`, `art/list.json` | Data only: the list of the 24 pictures in the package. | The files in `art/` | `prototypes/prism-veil-art/fetch-art.py --regen` |
| `art/*.jpg` | The 24 pictures. Public domain and CC0 works from Wikimedia Commons, made smaller. Credits are in `src/art-credits.js`. | Wikimedia Commons | `prototypes/prism-veil-art/fetch-art.py` |
| `icons/*.png` | The PRISM icon in four sizes. Images only. | | |
| `manifest.json` | Derived from the folder's `manifest.json` by the build. | `manifest.json` | `build-firefox.mjs` |
| `bg.js`, `popup.js`, `popup.html` | The folder's files with the lines between `@store-strip-begin` and `@store-strip-end` removed (the start page, which is not in the store packages). | The same files in the folder | `build-firefox.mjs` |

The three bundles are checked in. `npm run build:veil` writes them again byte for byte (checked 2026-11-14 on Windows 11
with Node 24.20.0 and esbuild 0.28.2).

Since 0.9.41 the Firefox package also carries the live TV picture reader (`src/live-picture.js`, `src/breakwatch/`, and
`offscreen.js`, which runs there as a background script) and Tesseract. Firefox has no tab stream, so the reader asks
`tabs.captureTab` for the video's rectangle once a second while the person has the option on. The picture is judged in the
background page and is not kept or sent. These files are third-party or data:

| File in the package | What it is | From |
|---|---|---|
| `vendor/tesseract/tesseract.min.js`, `worker.min.js` | Tesseract.js 6.0.1 (Apache-2.0), the official minified release files, with five small edits listed in `vendor/tesseract/PRISM-CHANGES.md`. | https://github.com/naptha/tesseract.js (tag v6.0.1) |
| `vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js` | tesseract.js-core 6.1.2, unmodified. | https://github.com/naptha/tesseract.js-core |
| `vendor/tesseract/lang/eng.traineddata.gz` | English language data (fast) from the Tesseract.js project, unmodified. | https://github.com/naptha/tesseract.js |
| `src/breakwatch/model.json`, `picture-net.json` | Data only: numbers for the live TV break detector, trained by Entangled Labs. | `scripts/breakwatch/` |

Apart from the Tesseract files, no file in the Firefox package is minified. The sounds are in it: the Firefox background
page plays them (`src/ambient.js`).

### Build steps

Requirements: Node 22 or newer and npm. No other tool. The build was made on Windows 11. It does not depend on the
operating system, except for the last step (the zip).

```
git clone https://github.com/Boil5602/Prism-by-Entangled.git
cd Prism-by-Entangled
npm ci
npm run build:veil
cd prototypes/prism-veil-extension
node build-firefox.mjs firefox --no-zip
```

The result is the folder `prototypes/prism-veil-extension/dist/firefox`. Its contents are the contents of the submitted
package. On Windows, leave out `--no-zip` and the build also writes `dist/prism-extension-firefox-<version>.zip`. On Linux or
macOS, make the zip by hand:

```
cd dist/firefox
zip -r -X ../prism-extension-firefox.zip .
```

`npm run build:veil` is optional, because its three output files are checked in. `build-firefox.mjs` copies the files,
writes the manifest, removes the start page lines, and stops with an error if any part of the start page is still there.

Tests: `npx vitest run --config prototypes/prism-veil-extension/tests/vitest.config.mjs` from the repository root.

## The Chromium package (Chrome Web Store, Edge Add-ons)

The same build makes it: `node build-firefox.mjs chromium`. It has everything in the table above, plus these.

| File in the package | What it is | Source |
|---|---|---|
| `vendor/tesseract/tesseract.min.js`, `worker.min.js` | Tesseract.js 6.0.1 (Apache-2.0), the official minified release files, with five small edits listed in `vendor/tesseract/PRISM-CHANGES.md`. | https://github.com/naptha/tesseract.js (tag v6.0.1) |
| `vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js` | tesseract.js-core 6.1.2, unmodified. | https://github.com/naptha/tesseract.js-core |
| `vendor/tesseract/lang/eng.traineddata.gz` | English language data (fast) from the Tesseract.js project, unmodified. | https://github.com/naptha/tesseract.js |
| `src/breakwatch/model.json`, `picture-net.json` | Data only: numbers for the live TV break detector, trained by Entangled Labs. | `scripts/breakwatch/` |
| `sounds/*.mp3` | Three field recordings (CC0). Credits in `sounds/CREDITS.txt`. | |
| `offscreen.html`, `offscreen.js` | Plain source, written for PRISM. | |
