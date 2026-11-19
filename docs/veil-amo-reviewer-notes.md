WHY IT RUNS ON ALL SITES
PRISM covers ads with pictures, and ads appear on any site, so there is no fixed list of sites. The content scripts read the page structure to find ad elements and the ad signals that video players publish, then draw a cover over each ad. The MAIN world scripts read the player's ad events and intercept window.open for the popup feature. PRISM does not block or change network requests and does not send page content anywhere.

NETWORK REQUESTS
A fresh install makes no request on ordinary pages. All downloads are data, checked against a signature or a hash, never run as code: pictures and source lists from prism.entangled.world when the person asks for them. Signed rule and detector data from prism.entangled.world once a day when "Rule updates" is on. YouTube's own AI label from www.youtube.com on YouTube pages when that option is on. A report to reports.entangled.world only when the person presses Send.

LIVE TV PICTURE DETECTION (new in Firefox since 0.9.41)
An option, off by default, for the sites on the person's list of live TV sites (tv.youtube.com to start with). While it is on and that tab is in front, the background script offscreen.js calls tabs.captureTab for the video's rectangle once a second, makes a 320x180 grey picture and judges whether a commercial break is on. The picture is not stored and not sent. No new permission is asked.

THIRD-PARTY CODE
vendor/tesseract is Tesseract.js 6.0.1 with tesseract.js-core 6.1.2 and the English data (Apache-2.0), the official release files. It reads text in the live TV picture, inside the extension. vendor/tesseract/PRISM-CHANGES.md lists the five small edits, which remove the library's default CDN addresses. src/breakwatch/model.json and picture-net.json are numbers only.

SOURCE AND BUILD
The source archive is the public repository's snapshot. prototypes/prism-veil-extension/SOURCE-NOTES.md lists every generated or third-party file and its source. Build (Node 22 or newer, npm 10, any OS):
npm ci
npm run build:veil
cd prototypes/prism-veil-extension
node build-firefox.mjs firefox --no-zip
The result is dist/firefox, whose contents are the submitted package.

HOW TO TEST
1. Install the add-on. A small PRISM button appears at the bottom right of web pages.
2. Serve the stand-in pages: cd assets/store/standin, then python3 -m http.server 8000. Open http://localhost:8000/news.html . The ad slots are covered with pictures within a few seconds.
3. Open http://localhost:8000/popups.html . The page tries to open four windows. None opens. The PRISM button lists them.
4. Open http://localhost:8000/video.html to see the cover over a player in an ad break.

WHAT A REPORT SENDS
Only after the person presses Send: the site's domain, the PRISM version, the matched rule, the clicked element's tag, classes, size and labels, and an optional note. websiteContent is optional data, asked for with the browser's own prompt before the first report.
