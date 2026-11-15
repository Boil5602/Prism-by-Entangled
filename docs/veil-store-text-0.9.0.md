# PRISM extension 0.9.0: store submission text

Paste-ready text for the three stores (assembled 2026-11-14). Each block is final text for version 0.9.0. The Firefox package is 0.9.1: the same extension with the settings tooltips built without innerHTML, and a new number because Mozilla had already signed 0.9.0 as a self-distributed file.

## Files

| What                                                   | Path                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| Package for Chrome and Edge                            | `prototypes\prism-veil-extension\dist\prism-veil-chromium-0.9.0.zip` |
| Package for Firefox                                    | `prototypes\prism-veil-extension\dist\prism-veil-firefox-0.9.1.zip`  |
| Screenshot 1, news page with covered ad slots          | `assets\store\shot-1-news.png`                                       |
| Screenshot 2, feed with a covered sponsored post       | `assets\store\shot-2-feed.png`                                       |
| Screenshot 3, video intermission card                  | `assets\store\shot-3-intermission.png`                               |
| Screenshot 4, the popup list                           | `assets\store\shot-4-popups.png`                                     |
| Screenshot 5, the PRISM button panel with Report an ad | `assets\store\shot-5-report.png`                                     |
| Small promo tile, 440x280 (Chrome)                     | `assets\store\prism-promo-440x280.png`                               |

The screenshots are 1280x800, 24-bit PNG, no alpha. The name in both packages is `PRISM by Entangled`.

---

## Chrome Web Store

### Package

Upload `prism-veil-chromium-0.9.0.zip`.

### Store listing: Description

```
PRISM covers the ads on a web page with pictures you chose. The ad still loads. You see a photo or a painting in its place.

WHAT IT COVERS
- Display ads and sponsored posts on ordinary pages.
- Ad breaks in video players. During a break PRISM shows an intermission card and mutes the tab. When the show returns, the picture and the sound come back.
- Popups that a page opens on its own. PRISM closes them and lists them, so you can allow one with a tap.

OPTIONS YOU CAN TURN ON
- Cover content that the platform itself labels as AI-made.
- Mark the reliability of news sources, from named public lists: Wikipedia's perennial sources list, the Iffy Index, and Steven Black's list.
- On live TV sites you choose, read the tab's picture to spot commercial breaks. The picture is read inside your browser. It is never sent and never saved.
- Get updated ad detection rules once a day. They are signed data: selectors, words, and site names. Nothing in them runs as code.

HOW IT WORKS
PRISM reads the structure of the page, in your browser, to find ad elements and the ad signals that video players publish. It puts a cover exactly over each ad and keeps it there as you scroll.

WHAT IT DOES NOT DO
- It does not block ads or page requests. Pages and ads load normally.
- It does not click anything on the page for you.
- It has no account, no analytics, and no telemetry.
- It does not send the pages you visit, their text, or their addresses anywhere, unless you choose to send a report.

REPORT AN AD
If PRISM misses an ad, or covers something that is not an ad, you can send a report. You see what the report contains first. Nothing is sent until you press Send.

PICTURES
24 photos come with the extension. You can get more from PRISM's own server. They are public domain and CC0 works. Those requests carry no cookie and no identifier.

OPEN SOURCE
PRISM is free and open source under the GPL, version 3 or later.
Source: https://github.com/Boil5602/Prism-by-Entangled
Site: https://entangled.world/prism
Privacy policy: https://entangled.world/prism/privacy

Made by Entangled Labs LLC.
```

### Store listing: Category

```
Productivity
```

(If the form offers "Privacy & Security", that one fits too.)

### Store listing: Language

```
English (United States)
``

### Store listing: Graphics

Store icon from the package. Screenshots 1 to 5 in order. Small promo tile `prism-promo-440x280.png`.

### Store listing: URLs

Homepage:
```

https://entangled.world/prism

```

Support:
```

https://github.com/Boil5602/Prism-by-Entangled/issues

```

### Privacy practices: Single purpose

```

PRISM covers advertising on the pages a person visits with pictures the person chose. It finds display ads, sponsored posts, video ad breaks, and unrequested popups in the page, and covers or closes them. It does not block ads from loading.

```

### Privacy practices: Permission justifications

storage
```

Keeps the person's settings, the list of pictures for covers, the per-site popup choices, the time-reclaimed totals, the log of video covers, and the downloaded ad detection rules. All of it stays in the browser's local storage. It is not synced and not sent anywhere.

```

alarms
```

Runs two timers, each only when the person turned the option on: a weekly refresh of the cover pictures, and a daily check for updated ad detection data (rules for finding ads on pages, and numbers for the live TV detector). No other timers.

```

scripting
```

Used for two things. First, after an install or an update, the pages already open have no working copy of the extension, so PRISM puts its own packaged content scripts back into those tabs. Second, the live TV scripts are registered only while the person has those options on, and unregistered when they are off. Only files inside the package are injected. No remote code and no code strings.

```

tabCapture
```

Used only for the option "Read the live TV picture", which is off by default. When the person turns it on and opens PRISM on a live TV tab from their own list of sites, PRISM reads that tab's video frames to spot commercial breaks, because a live broadcast gives no ad signal in the page. Frames are analyzed in memory inside the browser. Nothing is recorded, saved, or sent. It is never used on any other tab.

```

offscreen
```

The offscreen page does two jobs. It holds the tab stream for the live TV option and runs the packaged detection model on it, because a service worker cannot hold a media stream. It also plays the ambient sound the person chose for ad breaks, because the tab itself is muted during a break. It loads only files from the package.

```

Host permission `https://prism.entangled.world/*`
```

PRISM's own file host. The extension downloads signed lists and pictures from it: the cover photos, the source reliability lists, and updated ad detection data (a rule file of selectors, words, and site names, and numbers for the live TV detector). Each download happens only after the person turns that option on. Requests carry no cookie, no query string, and no identifier. Every file is checked against a signature or a hash before use.

```

Host permissions `http://*/*` and `https://*/*`, and content scripts on all sites
```

Ads appear on any site, so PRISM has to run on any site the person visits. There is no fixed list of sites that would cover its purpose. The content scripts read the structure of the page to find ad elements, and read the ad signals that video players publish in the page, then draw a cover over each ad. The host permissions let the background put those same packaged scripts back into tabs that are already open after an update, because the content script match alone does not allow that. PRISM does not block or change network requests. It does not read form fields, passwords, or page text for any other use, and it does not send page content or addresses anywhere. The one exception is the Report an ad tool, which sends only what the person sees on the report screen, and only when the person presses Send.

```

### Privacy practices: Remote code

Answer: **No, I am not using remote code.**

```

All code that runs is inside the package. The extension downloads only data: pictures, and signed JSON files. One of those files holds ad detection rules. It can contain only CSS selectors, exact words, hostnames, rule ids, and true or false values. The extension checks its size, its signature, and a strict schema, and ignores the whole file if any check fails. A selector from the file is passed only to querySelectorAll, matches, and closest. A word is only compared with page text. A hostname is only compared with the page's hostname. No value from the file is passed to eval, new Function, a script tag, innerHTML, a URL, or a style, and the file cannot contain regular expressions. The other JSON files hold lists and numbers for the live TV detector, read with JSON.parse. The package includes Tesseract.js for reading on-screen text. Its worker, core, and language data are all in the package. The content security policy allows scripts from the package only.

```

Every network request the package can make (for your reference, and for a reviewer who asks):

| Host | When | What comes back |
|---|---|---|
| `prism.entangled.world/veil/art/` | The person presses Get photos, or weekly refresh is on | Signed JSON list, JPEG pictures |
| `prism.entangled.world/veil/credibility/` | Source reliability marks are on, once a day at most | Signed JSON lists |
| `prism.entangled.world/veil/rules/` | "Get ad cover updates" is on, once a day at most | Signed JSON rules, 64 KB at most |
| `prism.entangled.world/breakwatch/` | "Get ad cover updates" is on, once a day at most | Signed JSON model numbers |
| `reports.entangled.world/v1/report` | The person presses Send on a report | Status 204, no body |
| `www.youtube.com/youtubei/v1/next` | On YouTube pages, with "Veil AI-labeled content" on | JSON |

A fresh install makes no request on ordinary pages.

### Privacy practices: Data usage

Tick **Website content** only.

| Category | Answer | Reason |
|---|---|---|
| Personally identifiable information | No | No account, name, email, or identifier in any request. |
| Health | No | Nothing reads it. |
| Financial and payment | No | Nothing reads it. |
| Authentication | No | The package keeps and sends no credentials. |
| Personal communications | No | Nothing reads it. |
| Location | No | No location is asked for or sent. |
| Web history | No | No list of pages leaves the browser. A report carries one site's domain, by the person's own press. |
| User activity | No | Clicks are judged in the page for popup detection. Nothing is logged or sent. |
| Website content | **Yes** | A report sends the ad element's tag, classes, size, labels, and link hostnames to `reports.entangled.world`, when the person presses Send. |

Tick all three certifications (no sale of data, no use for unrelated purposes, no use for creditworthiness).

### Privacy practices: Privacy policy URL

```

\\\

```

---

## Edge Add-ons

### Package

Upload `prism-veil-chromium-0.9.0.zip` (the same file as Chrome).

### Properties

Category:
```

Productivity

```

Privacy policy requirement: Yes. Privacy policy URL:
```

https://entangled.world/prism/privacy

```

Website URL:
```

https://entangled.world/prism

```

Support contact:
```

https://github.com/Boil5602/Prism-by-Entangled/issues

```

### Store listing: Description

Use the Chrome description above, unchanged.

### Store listing: Short description

Edge takes this from the manifest. For reference:

```

Ads become art. PRISM covers the ads on a page with pictures you chose and closes popups you did not ask for. Ads still load.

```

### Store listing: Graphics

Store logo from `assets\brand`. Screenshots 1 to 5 in order. Small promo tile `prism-promo-440x280.png`.

### Store listing: Search terms

```

ad cover
art
popups
privacy
open source
intermission
sponsored posts

```

### Notes for certification

```

PRISM covers ads with pictures. It does not block requests. No account or sign-in is needed.

HOW TO TEST

1. Install the extension. A small PRISM button appears at the bottom right of web pages.
2. Serve the stand-in pages from the public repository and open one:
   cd assets/store/standin
   python3 -m http.server 8000
   Open http://localhost:8000/news.html . The three ad slots are covered with pictures within a few seconds.
3. Open http://localhost:8000/popups.html . The page tries to open four windows by itself. None opens. Click the PRISM button to see the list, with Open and Always allow.
4. Open http://localhost:8000/video.html to see the intermission card over a player in an ad break.
5. On any page, click the PRISM button, then Report an ad, to see the report screen. Nothing is sent unless you press Send.
   The extension works only on http and https pages.

REMOTE CODE
None. All code is in the package. Downloads are pictures and signed JSON data. With "Get ad cover updates" on, the extension downloads a rule file once a day at most. It holds only CSS selectors, exact words, hostnames, rule ids, and booleans. The extension checks its size, signature, and schema, and ignores the file if a check fails. Values from the file go only to querySelectorAll, matches, closest, and string comparisons.

PERMISSIONS

- tabCapture and offscreen: only for the option "Read the live TV picture", off by default. Frames are analyzed in memory in the browser and never saved or sent. The offscreen page also plays the ambient sound for ad breaks.
- scripting: puts the packaged content scripts back into open tabs after an update, and registers the live TV scripts while that option is on.
- All sites: ads appear on any site.

Source: https://github.com/Boil5602/Prism-by-Entangled

```

---

## Firefox (addons.mozilla.org)

### Package

Upload `prism-veil-firefox-0.9.1.zip`. No separate source upload is needed if the public repository has this version. The add-on id is `prism-veil@entangled.world`.

### Name

```

PRISM by Entangled

```

### Summary

```

Ads become art. PRISM covers the ads on a page with pictures you chose and closes popups you did not ask for. Ads still load. No account, no tracking, no telemetry. Free and open source.

```

### Description

```

PRISM covers the ads on a web page with pictures you chose. The ad still loads. You see a photo or a painting in its place.

WHAT IT COVERS

- Display ads and sponsored posts on ordinary pages.
- Ad breaks in video players. During a break PRISM shows an intermission card and mutes the tab. When the show returns, the picture and the sound come back.
- Popups that a page opens on its own. PRISM closes them and lists them, so you can allow one with a tap.

OPTIONS YOU CAN TURN ON

- Cover content that the platform itself labels as AI-made.
- Mark the reliability of news sources, from named public lists: Wikipedia's perennial sources list, the Iffy Index, and Steven Black's list.
- Cover the ad slots that a live TV site marks in its own page.
- Get updated ad detection rules once a day. They are signed data: selectors, words, and site names. Nothing in them runs as code.

HOW IT WORKS
PRISM reads the structure of the page, in your browser, to find ad elements and the ad signals that video players publish. It puts a cover exactly over each ad and keeps it there as you scroll.

WHAT IT DOES NOT DO

- It does not block ads or page requests. Pages and ads load normally.
- It does not click anything on the page for you.
- It has no account, no analytics, and no telemetry.
- It does not send the pages you visit, their text, or their addresses anywhere, unless you choose to send a report.

REPORT AN AD
If PRISM misses an ad, or covers something that is not an ad, you can send a report. You see what the report contains first. Firefox asks you once before PRISM may send reports. Nothing is sent until you press Send.

PICTURES
24 photos come with the extension. You can get more from PRISM's own server. They are public domain and CC0 works. Those requests carry no cookie and no identifier.

ON FIREFOX
One option needs a browser feature that Firefox does not have: reading the picture of a live TV tab to spot commercial breaks. It is shown as unavailable. The ambient sound for ad breaks is also not in the Firefox version.

OPEN SOURCE
PRISM is free and open source under the GPL, version 3 or later.
Source: https://github.com/Boil5602/Prism-by-Entangled
Site: https://entangled.world/prism
Privacy policy: https://entangled.world/prism/privacy

Made by Entangled Labs LLC.

```

### Categories

```

Privacy & Security

```

### Support and links

Homepage:
```

https://entangled.world/prism

```

Support site:
```

https://github.com/Boil5602/Prism-by-Entangled/issues

```

Privacy policy (paste the policy text, or this link if the form takes one):
```

https://entangled.world/prism/privacy

```

### License

```

GNU General Public License v3.0 or later

```

### Data collection

The form has no questions for this. The package's manifest declares it, and Firefox shows it at install:

```

"data_collection_permissions": { "required": ["none"], "optional": ["websiteContent"] }

```

Required data: none. Optional data: website content, only for the Report an ad tool, and only after the person allows it in Firefox's own prompt.

### Notes to the reviewer

```

WHY IT RUNS ON ALL SITES
PRISM covers ads with pictures, and ads appear on any site, so there is no fixed list of sites. The content scripts read the page structure to find ad elements and the ad signals that video players publish, then draw a cover over each ad. The MAIN world scripts (ima-hook.js, popup-hook.js, src/core-popups.js) read the player's ad events and intercept window.open for the popup feature. PRISM does not block or change network requests and does not send page content anywhere.

NETWORK REQUESTS
A fresh install makes no request on ordinary pages. All downloads are data, checked against a signature or a hash, never run as code:

- prism.entangled.world/veil/art/ : pictures, when the person presses "Get 24 photos" or turns on the weekly refresh.
- prism.entangled.world/veil/credibility/ : source lists, when source marks are on.
- prism.entangled.world/veil/rules/ : a signed rule file, when "Get ad cover updates" is on, once a day at most.
- www.youtube.com/youtubei/v1/next : from YouTube pages only, when "Veil AI-labeled content" is on, to read YouTube's own AI label.
- reports.entangled.world/v1/report : only when the person presses Send on a report.

RULE UPDATES
With "Get ad cover updates" on, the extension downloads rules.json and rules.sig. The file is data only: CSS selectors, exact words, hostnames, rule ids, and booleans. It cannot contain code or regular expressions. src/rules-pack.js checks the size (64 KB at most), the ECDSA P-256 signature, a strict schema with count limits, and the version range. If any check fails, the file is ignored and the packaged rules are used. Selectors from the file go only to querySelectorAll, matches, and closest in src/rules.js. The logic that decides what an ad is stays in the package. The file can add selectors and words, and can switch a packaged rule off. Every published rule file is in the public repository under prototypes/prism-veil-extension/rules-update, and docs/features/rule-updates.md describes the format. To see it work, turn the switch on in the settings. The line under it shows the rule set version and date.

WHAT THE REPORT AN AD TOOL SENDS
Only after the person opens the PRISM button, chooses Report an ad, clicks an element, sees the report on screen, and presses Send. It sends: the site's domain, the kind of report, the PRISM version, the rule that matched, the clicked element's tag, classes, size, labels, and link hostnames, and an optional note of up to 280 characters. The full page address and embedded player addresses are added only if the person ticks the box to include the full page address. No browser details, no cookies, no identifier. The manifest declares websiteContent as optional data. Before the first report, the extension asks for that permission with the browser's own prompt: the report panel opens the PRISM settings in a tab, and a button there calls permissions.request. The background does not send a report until the permission is granted.

HOW TO TEST

1. Install the add-on. A small PRISM button appears at the bottom right of web pages.
2. Serve the stand-in pages from the repository and open one:
   cd assets/store/standin
   python3 -m http.server 8000
   Open http://localhost:8000/news.html . The three ad slots (elements with a data-ad-slot attribute) are covered with pictures within a few seconds.
3. Open http://localhost:8000/popups.html . The page tries to open four windows by itself. None opens. Click the PRISM button to see the list, with Open and Always allow.
4. Open http://localhost:8000/video.html to see the intermission card over a player in an ad break.
5. On any page, click the PRISM button, then Report an ad, to see the report screen. Nothing is sent unless you press Send.
6. Open the PRISM settings and turn on "Get ad cover updates". The line under the switch shows the rule set version and date.
   The extension works only on http and https pages, not on file: pages.

SOURCE AND BUILD
No file in the package is minified or obfuscated, and there is no third-party library. Three files are unminified esbuild bundles of TypeScript in the same repository. SOURCE-NOTES.md in prototypes/prism-veil-extension lists every generated file and its source.
Repository: https://github.com/Boil5602/Prism-by-Entangled
Build (Node 22 or newer):
   Environment: any OS with Node.js 22 and npm 10 (built on Windows 11). No other tools are needed.
npm ci
npm run build:veil
cd prototypes/prism-veil-extension
node build-firefox.mjs firefox --no-zip
The result is dist/firefox, whose contents are the submitted package.

LINT WARNINGS

- offscreen and tabCapture calls in bg.js: Chromium only. Each call is behind a check that the API exists, and the option is shown as unavailable in Firefox.

```

---

## Privacy policy changes

For `https://entangled.world/prism/privacy`, in page order. The page also covers PRISM for Windows. "The extension" below means the Chrome, Edge, and Firefox extensions. The website is a separate project, so hand this list to it.

1. **Date line.** Set the new date.
2. **The section on what PRISM collects.** No change.
3. **The section on where the device gets information, the `prism.entangled.world` item.** Say that the extension gets these from it:
   - the cover pictures (nature, cosmos, and museum art)
   - the source reliability lists, if you turn them on
   - updated ad detection rules (selectors, words, and site names), checked once a day at most, if you turn on "Get ad cover updates". This applies to Chrome, Edge, and Firefox.
   - live TV detection data, through the same switch, in the Chrome and Edge extension only

   Keep the sentence about no identifiers and no referrer. Add that each file is checked against a signature before use. Add that the rule file is signed data, is never run as code, and is removed when you turn the switch off.
4. **Same list, the Open-Meteo item.** Remove it for the extension. No store version of the extension has a start page, asks for a location, or makes a weather request.
5. **Same list, the calendar feed and radio link item.** Remove it for the extension, as in item 4.
6. **Any line about the person's own PRISM devices in the extension.** Remove it, as in item 4.
7. **Same list, add YouTube.** If you turn on "Veil AI-labeled content", then on YouTube pages the extension asks YouTube whether it labels the videos on the page as AI-made. The request goes to YouTube from a page you already have open, without your cookies.
8. **"The browser extensions", the popup sentence.** Correct "intercepted in your browser and never loaded" to say that PRISM closes the popup's tab and lists it, and that you can allow it.
9. **Same section, add the live TV picture.** If you turn on "Read the live TV picture", the Chrome and Edge extension reads the picture of a live TV tab you chose, to spot commercial breaks. It reads the picture in your browser. It does not save or send it. The Firefox extension does not have this option.
10. **Same section, add what stays in the browser.** Settings, per-site popup choices, the log of video covers, the time-reclaimed totals, the pictures and lists already downloaded, the downloaded rule file, and the date of the last check.
11. **Same section, the start page sentence.** Remove it.
12. **"The report tool", the list.** Correct it for the extension:
    - Replace "The website's name, and the page address up to its first 120 characters" with: the website's domain. The page address (up to 200 characters) and the addresses of embedded players are added only if you tick "Include the full page address".
    - Remove "Your browser family and major version". Keep the PRISM version.
    - Say that the note is at most 280 characters.
    - Add for Firefox: the browser asks you once before the extension may send reports.
    - Check the Windows app's report before you change these lines for it.
13. **"Where a report goes".** No change.
14. **"Who else sees anything".** Change "the nature photos" to "the pictures, the lists, and the detection data". Add YouTube as in item 7.
15. **The AI label switch name, wherever it appears.** Use "Veil AI-labeled content".
```
