# PRISM extension in Safari: App Store submission text (DRAFT)

A first draft for App Store Connect (2026-11-21). Nothing here is submitted. No Safari has run the extension yet, so lines that depend on
a Safari run are marked **[check]**. Remove each mark after a TestFlight walk confirms it, or change the line. The other stores'
text is in `docs/veil-store-text-0.9.0.md`; this file follows it where the facts are the same.

Apple's rule 2.3.10: the App Store text must not name other platforms. This text does not name another browser. Keep it that way.

## Files

| What                                      | Path                                                                       | State                                      |
| ----------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Package for the Safari Web Extension Packager | `prototypes\prism-veil-extension\dist\prism-extension-safari-<version>.zip` | `node build-firefox.mjs safari` makes it   |
| App icon, 1024x1024, opaque               | `assets\store\prism-appstore-icon-1024.png`                                | made by `scripts/brand-icons.py`           |
| Mac screenshots, 1280x800                 | `assets\store\shot-1-news.png` to `shot-5-report.png`                      | a size Apple takes for the Mac; taken in another browser, so retake in Safari **[check]** |
| iPhone screenshots, 6.9 inch (1320x2868)  | none yet                                                                   | owed: take them on the iPhone through TestFlight |
| iPad screenshots, 13 inch (2064x2752)     | none yet                                                                   | owed only if the app is offered on iPad    |

## App information

### Name (30 characters at most)

```
PRISM by Entangled
```

If App Store Connect says the name is taken: `PRISM: Ads Become Art`.

### Subtitle (30 characters at most)

```
Cover ads with art you choose
```

### Bundle ID

`world.entangled.prism.extension` (decided 2026-11-20). Registered under the Individual membership for TestFlight (decided 2026-11-21, before the conversion to an organization).

### SKU

```
prism-extension-safari
```

### Primary language

English (U.S.)

### Category

Primary: **Utilities**. Secondary: **Productivity**.

### Content rights

Answer **Yes, it contains, shows or accesses third-party content, and I have the rights.** The pictures are public domain and CC0
works. PRISM acts on the pages the person visits; it does not copy them.

### Age rating

Answer **None** or **No** to every question. The app has no web view of its own, no chat, no user content, no purchases and no
advertising. The expected rating is **4+**.

### Copyright

```
2026 Entangled Labs LLC
```

## Pricing and availability

Price: **Free**. No in-app purchases. Availability: all countries and regions (the owner may narrow it).

## Version page

### Promotional text (170 characters at most; can change without a review)

```
Ads become art. PRISM puts a picture over each ad on a page. The ad still loads. No account, no tracking, no telemetry. Free and open source.
```

### Description (4000 characters at most)

```
PRISM covers the ads on a web page with pictures you chose. The ad still loads. You see a photo or a painting in its place.

WHAT IT COVERS
- Display ads and sponsored posts on ordinary pages.
- Ad breaks in video players. During a break PRISM shows an intermission card and mutes the sound. When the show returns, the picture and the sound come back.
- Popups that a page opens on its own. PRISM closes them and lists them, so you can allow one with a tap.

OPTIONS YOU CAN TURN ON
- Cover content that the platform itself labels as AI-made.
- Mark the reliability of news sources, from named public lists: Wikipedia's perennial sources list, the Iffy Index, and Steven Black's list.
- Cover the ad slots that a live TV site marks in its own page.
- Get updated ad detection rules once a day. They are signed data: selectors, words, and site names. Nothing in them runs as code.

HOW IT WORKS
PRISM reads the structure of the page, on your device, to find ad elements and the ad signals that video players publish. It puts a cover exactly over each ad and keeps it there as you scroll.

WHAT IT DOES NOT DO
- It does not block ads or page requests. Pages and ads load normally.
- It does not click anything on the page for you.
- It has no account, no analytics, and no telemetry.
- It does not send the pages you visit, their text, or their addresses anywhere, unless you choose to send a report.

TURN IT ON
On iPhone and iPad: open Settings, then Apps, then Safari, then Extensions. Turn on PRISM by Entangled and allow it on every website.
On a Mac: open Safari, then Settings, then Extensions. Tick PRISM by Entangled and allow it on every website.

REPORT AN AD
If PRISM misses an ad, or covers something that is not an ad, you can send a report. You see what the report contains first. Nothing is sent until you press Send.

PICTURES
24 photos come with the extension. You can get more from PRISM's own server. They are public domain and CC0 works. Those requests carry no cookie and no identifier.

OPEN SOURCE
PRISM is free and open source under the GPL, version 3 or later.

Made by Entangled Labs LLC.
```

Lines to confirm on TestFlight before this text is final:

- Ad breaks in video players **[check]**: on an iPhone a video can play in the system's own full-screen player, outside the page. If
  PRISM cannot cover it there, add one line: `On iPhone, a video in full screen is not covered.`
- `mutes the sound` **[check]**: the tab mute under a video cover is unknown in Safari (roadmap).
- Popups **[check]**: Safari blocks many popups itself. Keep the line only if PRISM's list of closed popups works in Safari.
- A sound during breaks: left out. The Safari background page sleeps, and the sound is not tried there yet **[check]**.
- The live TV picture detection: left out. Safari gives an extension no way to read a tab's picture (roadmap).

### Keywords (100 characters at most, commas, no spaces)

```
ad cover,art,popups,privacy,open source,intermission,sponsored posts,news,wallpaper,photos
```

### Support URL

```
https://entangled.world/support
```

### Marketing URL

```
https://entangled.world/prism
```

### Privacy policy URL

```
https://entangled.world/prism/privacy
```

The policy names no browser by store. Before the first submission, check that it says what the Safari build does. The website is a
separate project: hand the change to it, do not edit it from here.

## App Privacy (the privacy label)

Apple counts data as collected when it leaves the device and is kept longer than it takes to answer the request. Only one thing in
the Safari build does that: **Report an ad**, when the person presses Send. A report carries the ad element's tag, classes, size,
labels and link hostnames, and the site's domain, to `reports.entangled.world`. The report server reads the address of the request
only to slow down floods, in memory, and keeps no address.

Apple's exemption for optional feedback asks for the person's name to be shown in the form. PRISM's report has no name, so the
exemption does not fit by its letter. Two honest choices. **Decided 2026-11-21: A.**

**A. Keep Report an ad in Safari.** Declare:

| Data type                     | Collected | Linked to the person | Used for tracking | Purpose           |
| ----------------------------- | --------- | -------------------- | ----------------- | ----------------- |
| Browsing History (the site's domain in a report) | Yes | No           | No                | App Functionality |
| Other Data (the ad element's description)        | Yes | No           | No                | App Functionality |

Everything else: not collected.

**B. Leave Report an ad out of the Safari build.** The label is then **Data Not Collected**. The rule updates, the pictures and the
site icons send nothing about the person and keep nothing.

## Export compliance

The question asks which type of encryption algorithms the app implements. Answer **None of the algorithms mentioned above.** The extension
uses only HTTPS, through Safari. The app's Info.plist can carry `ITSAppUsesNonExemptEncryption` = `NO` so the question is not asked
again for each build.

## Notes for App Review

```
PRISM by Entangled is a Safari web extension. The app itself only explains how to turn the extension on.

To test:
1. Open Settings, then Apps, then Safari, then Extensions. Turn on PRISM by Entangled. Allow it on every website.
2. In Safari, open a news site that shows display ads, for example https://www.cnn.com or https://www.foxnews.com.
3. Each ad is covered by a photo or a painting. The ad still loads under the cover.
4. Tap the extension's icon in the address bar to open its settings.

No account and no sign-in are needed. The extension does not block requests and does not click on the page. It sends nothing unless the person presses Send in Report an ad.

Source: https://github.com/Boil5602/Prism-by-Entangled (GPL-3.0-or-later). Made by Entangled Labs LLC.
```

## Owed before a submission

1. The membership converted to an organization (Apple case 103019803863).
2. Done 2026-11-21: Report an ad stays in Safari (privacy label choice A), and the report server admits Safari's
   `safari-web-extension://` origin (deployed and checked live). A report sent from Safari itself is still **[check]**.
3. iPhone screenshots, and Mac screenshots taken in Safari.
4. Every **[check]** mark above settled on TestFlight.
