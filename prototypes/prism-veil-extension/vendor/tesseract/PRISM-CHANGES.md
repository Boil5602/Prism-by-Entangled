# Changes PRISM made to these files

Tesseract.js is Apache-2.0 (LICENSE.md). Section 4(b) of that license asks that changed files say so. These two were changed on
2026-11-14, for the Chrome Web Store's rule that an extension names no remotely hosted code. Nothing PRISM runs changed: PRISM
always passes `workerPath`, `corePath` and `langPath` (files inside the package) and `workerBlobURL: false` (offscreen.js).

`tesseract.min.js`

- The default `workerPath` was an address on a public CDN (jsDelivr). It is now an empty string.
- The blob worker (a Blob holding one `importScripts` line, used when `workerBlobURL` is true) is removed. The worker is always
  made with `new Worker(workerPath)`.

`worker.min.js`

- The default language-data address and the default core address (both on the same CDN) are now empty strings.
- webpack's global lookup no longer falls back to `new Function("return this")`. `globalThis` is returned first in every browser
  that can run the package.

Left as it was: the one `importScripts` call in `worker.min.js`. It is how the worker loads its core
(`core/tesseract-core-simd-lstm.wasm.js`), a file inside the package. A classic worker has no other way to load a second script.

The check: `node build-firefox.mjs` stops if that CDN's host name is anywhere in the Chromium package.
