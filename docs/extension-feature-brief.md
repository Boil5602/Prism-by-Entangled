# The PRISM extension: feature brief

Written 2026-11-18 from the code of version 0.9.7 in `prototypes/prism-veil-extension`. It describes what the code does today. It holds no plans, except one section marked PROPOSAL at the end. Where the code does not settle a point, the text says "Unclear from the code".

Words used here:

- **Cover**: the photo PRISM puts over an ad. The code and the labels also say "veil".
- **Popup**: the window that opens from the PRISM icon in the browser toolbar.
- **PRISM button**: the small button PRISM adds at the bottom right of a web page. Its box is "the panel".
- **Store builds**: the two packages the build makes. One is for Chrome and Edge (the same files for both). One is for Firefox. The **development build** is the source folder loaded unpacked.

Browser differences in short:

- Chrome and Edge get the same package. The code never tests for one or the other.
- Firefox has no tab picture reading. So "Read the live TV picture", the "Live TV sites" list and the channel switch do not work there. The break sound plays from a different place. Sending a report needs one extra permission step.
- Both store builds cut out the start page and the "PRISM page" settings section. They exist only in the development build.

---

## 1. SETTINGS

The Settings page and the toolbar popup are one document (`popup.html`). There is no separate options page. It is 380 px wide with a maximum height of 560 px. It opens as a full browser tab in two cases only: from the button `Turn this detection off` on a live TV cover, and in Firefox from the first `Send to PRISM`. In a tab it is the same 380 px column at the left edge.

Storage: all settings are in the browser's local extension storage (key `pv:ui`). They apply on every site, except where the table says otherwise. A page that is open reacts at once to a change.

Every row has help text. The pointer must rest on a row for 700 ms before the help shows.

### Header

| Item | Type | What it does |
|---|---|---|
| `PRISM` | text, amber capitals | The brand. |
| site name | text | The host name of the current tab. |
| `This site` | button | Opens the PRISM button's panel on the page and closes the popup. Disabled when PRISM does not run on the page. |

Under the header is a status area for popups on this site. See section 5.

### Section heading: `Covering ads`

| # | Label | Type and options | Default | What it does |
|---|---|---|---|---|
| 1 | `Veil on` | checkbox | on | The main switch. On: ads, video ad breaks and (if chosen) AI-labeled content are covered. Off: every cover on every page comes down at once and nothing new is covered. Popups are still intercepted and reliability marks still show. Everywhere. |
| 2 | `Show the PRISM button` | checkbox | on | Off: hides the PRISM button on the current site only. On: shows it on every site (it clears every per-site hide). This is the only per-site setting. No effect on covers. |
| 3 | `Check what's covered` with button `Reveal 15 s` | button (an action) | none | Removes every cover on the current tab for 15 seconds. See section 2. |
| 4 | `Intermission` | two-way switch: `Full card`, `Corner chip` | `Full card` | How the cover over a video ad break looks. See section 3. Everywhere. Not used when "During ad breaks" is `Mute only` or `Show`. |

### Section heading: `Content`

| # | Label | Type and options | Default | What it does |
|---|---|---|---|---|
| 1 | `During ad breaks` | three-way switch: `Veil`, `Mute only`, `Show` | `Veil` | What happens in a video ad break. See section 4. Needs "Veil on". |
| 2 | `Sound during breaks` | four-way switch: `Off`, `River`, `Chimes`, `Stars` | `Off` | A quiet sound loop while a cover is over a video ad break. Plays only when "During ad breaks" is `Veil`. See section 4. |
| 3 | `Veil AI-labeled content` | checkbox | off | On: covers posts, tiles and videos that carry the platform's own AI label. Off: they are left alone. Needs "Veil on". |
| 4 | `Veil suggested posts` | checkbox | off | On: covers Facebook's suggested posts. Works on Facebook only. On any other site it has no visible effect. Needs "Veil on". |
| 5 | `Small view under a cover` | checkbox | on | On: resting the pointer on a cover's symbol shows a small live view of what is under it. Off: the hover panel has only its words and its buttons. |
| 6 | (note line) | text | hidden | Shown only when the page was opened from `Turn this detection off`. Text: `These two switches are the live TV ad detection. Off, PRISM puts up no veil of its own on live TV; the services' own marked breaks are still covered elsewhere.` Rows 7 and 8 then get an amber outline that pulses three times. |
| 7 | `Veil marked ad slots in live TV` | checkbox | on | On: covers a YouTube TV channel while an ad slot that the service itself marked plays. Acts on `tv.youtube.com` only. No visible effect on any other site. Needs "Veil on". |
| 8 | `Read the live TV picture` | checkbox | off | On: reads the picture of a live TV tab once a second to find the channel's own commercials. Acts only on the sites in "Live TV sites". Chrome and Edge only. **In Firefox the box is shown disabled and unticked.** Turning it on shows rows 11 to 13. |
| 9 | `Get ad cover updates from Entangled` | checkbox | off | On: once a day the extension fetches a signed file of ad detection rules (and, in Chrome and Edge, the live TV detection data). Off: it uses what came with the version. No direct visible effect on a page. |
| 10 | (update note) | text | hidden | Shown under row 9 when the switch is on or a file is held. Examples: `Checking...`, `Rules {serial}, updated {date}.`, `Rules: the ones that came with this version.`, ` Checked {date}: nothing newer.`, ` Last check: {error}.` Chrome and Edge add ` Live TV detection: pack {pack} ({date}).` or ` Live TV detection: the one that came with this version.` |
| 11 | `Reading this tab's picture now.` | text | hidden | Shown while the current tab's picture is being read. Never in Firefox. |
| 12 | `{channel}: ` with `All breaks`, `Sure only`, `None` | three-way switch | none stored | What the picture reading covers on that one channel. Per channel. Shown only when the current tab is being read and the page names a channel. Never in Firefox. |
| 13 | `Live TV sites` | list of site chips, a text field, a button | one site: `tv.youtube.com` | The sites whose picture is read. Each chip is the host name and a `×` (tooltip `Remove {host}`). Field placeholder: `Add a site, like example.com`. Button: `Add {site}` for the current tab's site. Empty list text: `No sites. Add one below.` Shown only while row 8 is on. Never in Firefox. |
| 14 | `Veil log` with buttons `Copy`, `Clear` | two buttons | always shown | A local record of every cover over a video ad break. `Copy` puts it on the clipboard. `Clear` deletes it. Status words after a press: `{count} lines copied`, `Nothing logged yet`, `Could not copy`, `Cleared`. No visible effect on a page. |
| 15 | `Mark source reliability` | checkbox | off | On: a three-disk mark shows beside links to rated news outlets and on the PRISM button. See section 6. Works with "Veil on" off. |
| 16 | `Wikipedia RSP`, `Iffy Index`, `Steven Black` | three checkboxes in one row | all on | Shown only while row 15 is on. Each turns one rating source on or off. A source that is off shows as a hollow disk. |

Channel switch detail (row 12): `All breaks` covers every break the detection calls. `Sure only` covers only YouTube TV's own marked slots and paid programming. `None` never covers that channel from the picture. With no choice stored, the switch shows what the detection data says for that channel.

### Section heading: `Photos`

| # | Label | Type and options | Default | What it does |
|---|---|---|---|---|
| 1 | status text with buttons | two buttons | `24 built-in` | Status: `24 built-in`, or `{count} from the server · fetched {ago}`. Button 1: `Get 24 photos` (or `Get 24 new` when a server set is held; `Fetching…` while it works). Button 2: `Restore defaults`, shown only when a server set is held. Error line: `Couldn't fetch: {error}`. Covers on pages use the new set for new covers. |
| 2 | `Pictures` | three checkboxes: `Nature`, `Cosmos`, `Museum art` | `Nature` only | Which sets a server fetch draws from. At least one stays on. If the last one is unticked it ticks itself back and this line shows: `Keep at least one set of pictures on.` No visible effect while the 24 built-in photos are in use. |
| 3 | `Refresh photos weekly` | checkbox | off | On: fetches a new random 24 from the server every 7 days. |

### Section heading: `PRISM page` (development build only, cut from both store builds)

| # | Label | Type | Default | What it does |
|---|---|---|---|---|
| 1 | `Use PRISM as my new-tab page` | checkbox | off | Every new tab opens PRISM's start page. Asks once for the browser's "tabs" permission. |
| 2 | `Use PRISM as my start page` | checkbox | off | A new browser window opens on PRISM's start page. |

### Section heading: `Time reclaimed`

| # | Label | Type | What it does |
|---|---|---|---|
| 1 | `Week {time}  ·  Month {time}  ·  All {time}` with button `Reset` | status text and a button | See section 8. `Reset` sets the count to zero with no confirm step. |

### Footer

Text: `Local only — nothing here ever leaves this browser.` (the long dash is in the source).

### Settings that also exist in the PRISM button's panel on a page

The panel (see section 5 for its look) holds, top to bottom: title `PRISM on {site}`; checkbox `Veil on` (the same main switch); button `⚑ Report an ad`; button `Reveal 15 s`; heading `Popups` and its rows; heading `This site` with the checkboxes `Block this site's own popups too` (off) and `Hide the PRISM button here` (off), both per site; heading `This site’s reliability` (only when marks are on); last line `Covering ads, content, photos, time reclaimed:` with the button `Settings`, which opens the popup.

### Dependencies in short

- "Veil on" off stops rows that cover things: During ad breaks, AI-labeled content, suggested posts, marked live TV slots.
- "Sound during breaks" plays only with "During ad breaks" = `Veil`.
- The three source boxes need "Mark source reliability".
- "Live TV sites" and the channel switch need "Read the live TV picture", which needs Chrome or Edge.
- "Restore defaults" needs a fetched photo set.

---

## 2. WHAT A COVER LOOKS LIKE

### The photo

- **Choice.** One photo is picked at random for each cover when the cover is made. It is not tied to the item. A cover that is removed and made again gets a new photo. Two covers on one page can get the same photo.
- **Source list.** The 24 built-in photos, or the fetched server set when one is held.
- **Size and crop.** The cover takes the item's exact rectangle. The photo is a CSS background: `#0A0C0F center/cover no-repeat`. So it fills the box, is centered, and is cropped.
- **Side by side covers** (tops and heights within 4 px, gap from -4 to 48 px) share one photo. It is stretched over the whole row and each cover shows its slice. The picture can be distorted there.
- **Fallback.** A flat near-black `#0A0C0F`. The same color shows while a photo loads. A server photo that fails to load is replaced by a built-in one.
- **No** dimming, gradient, tint, corner radius or border. The cover is a plain opaque rectangle.
- **Appear:** opacity 0 to 1 in 200 ms. **Disappear:** at once, no fade.
- **Smallest item covered:** 40 px wide and 30 px high. **Not covered:** an item that is page sized (at least 50% of the window area and at least 70% of its height). A cover taller than 3 window heights is removed.
- The cover takes all clicks, so the ad under it cannot be opened. Sound from a video or audio element inside the item is muted while covered.

### What is drawn on the photo

Only two things. There is no caption, no "Ad" text, no button and no credit line on the cover.

**1. The symbol.** A text character in a small chip at the top left. It is on every cover, with no hover needed.

| Property | Value |
|---|---|
| Character | `◐` (U+25D0) for ads and suggested posts. `✦` (U+2726) for AI-labeled content. |
| Position | 6 px from the top, 6 px from the left |
| Font | weight 600, size 4% of the cover's width, never under 9 px, never over 16 px; `-apple-system, Segoe UI, Roboto, sans-serif` |
| Color | `#F0A83C` |
| Chip | background `rgba(10,12,15,.5)`, padding `.3em .45em`, radius 6 px, blur 2 px, text shadow `0 1px 6px #000` |
| Pointer | `help` |

Source (`src/covers.js`):

```js
var lbl = document.createElement("div");
lbl.setAttribute("data-prism-veil", "1");
lbl.textContent = glyph || String.fromCharCode(0x25D0);
lbl.style.cssText = "position:absolute;top:6px;left:6px;font:600 clamp(9px,4cqi,16px)/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;text-shadow:0 1px 6px #000;background:rgba(10,12,15,.5);padding:.3em .45em;border-radius:6px;white-space:nowrap;backdrop-filter:blur(2px)";
lbl.style.cursor = "help";
cover.appendChild(lbl);
```

**2. A ring around a hole.** The ad's own close button (and carousel arrows and dots) stays reachable through a hole in the cover. At most 6 holes a cover. Each hole has a ring 3 px outside it: `border: 2px solid #F0A83C; box-shadow: 0 0 12px 3px rgba(240,168,60,.75)`. The glow pulses between `0 0 6px 1px rgba(240,168,60,.45)` and `0 0 18px 5px rgba(240,168,60,.95)`, 1100 ms each way, forever. No pulse when the system asks for reduced motion.

### How the cover differs by kind of item

The look is the same for all page items: photo and symbol. The differences are what gets covered and the words in the hover panel.

| Kind | What is covered | Symbol | Panel kind | Panel "Why" text |
|---|---|---|---|---|
| Banner or image ad | The ad slot's own box | `◐` | `An ad` | `An ad slot in the page` |
| Sponsored link or text ad | The list item or card around the label | `◐` | `An ad` | `The page's own label: Sponsored` (the label as the page wrote it) |
| Block of sponsored stories | The whole block | `◐` | `An ad` | `The page's own label: {label}` |
| Social post marked sponsored (Facebook) | The whole post | `◐` | `An ad` | `Facebook's own Sponsored or Ad label in the post's header` |
| Social post on other sites | The post | `◐` | `An ad` | The rule's own short reason, for example `Promoted label` |
| Suggested post (Facebook only, switch on) | The whole post | `◐` | `A suggested post` | `Facebook's own Follow button in the post's header` (or `Join`), or `Facebook's own Interested and Not interested buttons on the post` |
| AI-labeled content (switch on) | The post, card, tile or reel | `✦` | `Labeled AI content` | `The platform's own label: {label}` |
| Pause-screen ad (Paramount+, CBS, Pluto TV only) | The ad unit in the pause panel only. The player stays usable. | `◐` | `An ad` | The label's text, for example `Advertisement` |
| Video ad break | The whole player, with the intermission card or chip. Tab muted. See section 3. | `◐` in a corner chip | (no panel of this kind) | (none) |
| Music sponsor break (Pandora, Spotify, Amazon Music) | No cover. The tab is muted and a note shows at the top center: `Ad · sound off` with a button `Hear it`. See section 4. | none | | |
| Live TV break, marked by the service | Same as a video ad break | `◐` | | |
| Live TV break, spotted from the picture | Same cover, but the photo is still, the line reads `Looks like a commercial break`, and three buttons are added. See section 4. | `◐` | | |

### The hover panel and "Small view under a cover"

Trigger: the pointer enters the symbol. The panel opens at once, with no click. One panel at a time.

The panel is 260 px wide, radius 12 px, background `rgba(20,23,28,.92)`, text `#D7DCE3`, `500 13px/1.35`, shadow `0 8px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.12)`. It opens 8 px under the symbol, left edges in line. If it does not fit below, it opens above.

Top to bottom:

1. **The small view** (only with the setting on). A frame of 192 x 108 px, radius 6 px, with a thin light edge. It shows the covered item itself, live, shrunk to fit and never enlarged. It is not a screenshot and nothing is loaded a second time: a hole is cut in the cover and the page's own element is moved and scaled into it. Empty frame space is a little darker than the panel. Nothing in the small view can be pressed.
2. Title `Covered by PRISM` (13.5 px, weight 600, `#E8ECF2`) and the kind in amber (`An ad`, `A suggested post`, `Labeled AI content`).
3. Row `WHY` and the text from the table above. Row keys are 10.5 px capitals in `#9AA4B2`.
4. If the photo has a credit: a thin rule, then rows `PICTURE`, `PHOTO`, `LICENSE`, `SOURCE`.
5. Button `Reveal 15 s` (amber `#F0A83C`, text `#0A0C0F`, radius 9 px, padding `7px 14px`). Tooltip: `Shows what is under the cover for fifteen seconds, then the cover comes back`.
6. (Removed 2026-11-23 with the rule it belonged to: the button `Stop covering this page`.)

When no view is possible the frame is replaced by the line `No small view for this one.` With the setting off, the panel has only items 2 to 6.

The panel closes 250 ms after the pointer leaves the symbol and the panel, at once on any scroll, and after 20 seconds at most. There is no closing animation.

### "Reveal 15 s", second by second

There are two actions with this name.

**A. The button in a cover's hover panel (one cover).**

| Time | On screen |
|---|---|
| 0 s | The panel closes. That one cover vanishes at once, no fade. The item under it shows. |
| 0 to 15 s | The item is in view and can be clicked. No countdown and no text. Other covers stay. Sound inside the item stays muted. |
| 15 s | The same cover is back at once, with the same photo. No fade. |

**B. The popup's and the PRISM button's `Reveal 15 s` (every cover on the tab).**

| Time | On screen |
|---|---|
| 0 s | The popup closes. Every cover on the page is removed at once, a video ad break cover too. Muted sound comes back. |
| 0 to 15 s | No covers. Nothing new is covered. No countdown. |
| 15 s, plus up to about 1.2 s | The next pass covers the items again. Each cover is new: a new random photo and the 200 ms fade in. |

By hand: the Escape key lifts every cover for 6 seconds. Pressing and holding any cover for 3 seconds lifts every cover for 15 seconds. During the hold a small chip follows the pointer with the text `Hold to reveal…` (white on `rgba(10,12,15,.85)`, 12 px, radius 7 px). It is not a countdown.

There is no right-click menu on a cover.

---

## 3. INTERMISSION

The intermission is the cover over a video player during an ad break. It has three layers: a photo, a centered card, and a chip at the top left. It sits on the player's rectangle and follows it, in full screen too.

**The photo.** Fills the cover, centered and cropped (`cover`), on `#0A0C0F`. It drifts slowly: scale from about 1.00 to about 1.11 and a shift of up to 2.2%, over 28 seconds. On a long break a new photo fades in over 1.6 seconds every 22 seconds. Exception: a live TV break spotted from the picture keeps one still photo.

**Appear and disappear.** The cover is opaque from its first paint, with no fade in. At the end of the break it fades out in 500 ms. When the person lifts it, it goes at once.

### Full card (the default)

A card in the center of the cover:

- `font: 600 26px/1.4`, color `#F0A83C`, centered text, padding `18px 28px`, background `rgba(10,12,15,.5)`, radius 16 px, blur 3 px, shadow `0 8px 40px rgba(0,0,0,.4)`.
- Entry: rises 10 px and fades in over 520 ms.

Content, top to bottom:

1. Sub line, 15 px, `#D7DCE3`: `Your show returns after the break`, or `Your show will be paused after the break`, or (spotted live TV break) `Looks like a commercial break`.
2. Time line, 18 px, `#D7DCE3`: `{M:SS} left` (for example `0:23 left`) or `LIVE`.
3. Count line, 14 px, `#9AA4B2`: `Ad {n} of {total}`. Shown only when the player reports both numbers.
4. Button `⛶ Full screen` / `⛶ Exit full screen` (amber outline, radius 9 px). Shown only when the player has a full-screen control. Tooltip: `Uses the player’s own full-screen control`.
5. Caption `After the break` (13 px) over a two-part switch: `▶ Play` and `⏸ Pause`. Border `1.5px solid #F0A83C`, radius 12 px, each part `600 16px`, padding `11px 22px`, at least 118 px wide. Selected part: amber ground, text `#0A0C0F`. Default `Play`. The choice lasts for this break only. Tooltip: `What happens when the break ends. Play: your show carries on by itself. Pause: PRISM holds it on a Paused card until you press Resume - handy if you stepped away.`
6. Spotted live TV break only: buttons `Show ad`, `Not a break`, `Turn this detection off`.

The word "Intermission" and a symbol are in the card's markup but are never shown on the card. In this look the corner chip shows the symbol only.

### Corner chip

The card is hidden. The photo fills the cover. The chip carries the text.

- Chip: 14 px from the left and top, `font: 600 14px`, color `#F0A83C`, background `rgba(10,12,15,.55)`, padding `7px 12px`, radius 10 px, blur 3 px.
- Text: `◐ 0:23 left · Ad 1 of 2`, or `◐ LIVE`, or `◐ Intermission` when no time is known.
- A click on the chip opens a small box under it (at left 14 px, top 52 px; background `rgba(20,23,28,.92)`, radius 12 px, at least 220 px wide) with the `After the break` switch at a smaller size and the full-screen button.
- The three spotted-break buttons are not shown in this look.

### In both looks

- A click on the symbol `◐` switches between the two looks and saves the setting.
- Resting the pointer on the chip opens a "peep" box under it: a 192 x 108 px live view of the video with no sound, and a button `Reveal 15 s` (tooltip `Shows the video for fifteen seconds, then the veil comes back`). For a protected video the note reads `A protected video: shown through a keyhole`, or `No peep here`. With "Small view under a cover" off the box holds only the button.
- A real Skip button in the player stays reachable through a hole with the same pulsing amber ring as in section 2. PRISM does not press Skip.
- After the person lifts the cover, a chip `◐ Intermission` shows at the top left while the break lasts (tooltip `Bring the PRISM intermission back`). A click brings the cover back.

Other states of the same card: `Paused` with `▶ Resume` (the break ended and Pause was chosen); `Break over · the live stream continues underneath` with `Held {M:SS} · LIVE` (the same on a live stream); and, for YouTube video labeled as AI, `Labeled “{label}” by YouTube` with `▶ Watch anyway`.

### The PRISM intermission symbol: source

It is a text character, U+25D0 `◐`, in amber `#F0A83C`. There is no SVG, no image and no animation for it.

```js
// src/video.js, the corner chip
chip.style.cssText = "position:absolute;left:14px;top:14px;display:none;align-items:center;gap:6px;pointer-events:auto;cursor:pointer;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;text-shadow:0 1px 8px #000;background:rgba(10,12,15,.55);padding:7px 12px;border-radius:10px;backdrop-filter:blur(3px);font-variant-numeric:tabular-nums";
var chipMoon = document.createElement("span"); chipMoon.textContent = "◐";
var chipLbl = document.createElement("span"); chipLbl.textContent = " Intermission";
chip.appendChild(chipMoon); chip.appendChild(chipLbl);
```

### The PRISM page button icon: source

The PRISM button has no icon. It is a pill with the text `PRISM` and a `›` to collapse it.

| Property | Value |
|---|---|
| Position | fixed, 14 px from the right, 14 px from the bottom |
| Size | 30 px high, width fits the text, padding `0 12px`, radius 15 px |
| Ground | `rgba(20,23,28,.55)` with blur 6 px, border `1px solid rgba(255,255,255,.12)` |
| Text | `#F2F4F7`, `600 12px/1 -apple-system, Segoe UI, Roboto, sans-serif`, letter spacing `.04em` |
| Opacity | `.45` at rest, `1` on hover or with the panel open |
| `›` | U+203A, 33 px, opacity `.7`; tooltip `Collapse` |
| Collapsed | an amber tab 12 x 44 px at the same corner, `rgba(240,168,60,.9)`, radius 7 px, no text |

As plain markup with the same look:

```html
<div style="position:fixed;right:14px;bottom:14px;height:30px;padding:0 12px;border-radius:15px;
  display:inline-flex;align-items:center;gap:8px;background:rgba(20,23,28,.55);backdrop-filter:blur(6px);
  border:1px solid rgba(255,255,255,.12);color:#F2F4F7;opacity:.45;cursor:pointer;
  font:600 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.04em">
  <span>PRISM</span><span style="font-size:33px;line-height:1;opacity:.7">›</span>
</div>
```

The only drawing that can show on the button is the reliability mark (section 6), when the site is rated:

```svg
<svg viewBox="0 0 12 17" width="10.8" height="15.3" aria-hidden="true">
  <ellipse cx="6" cy="13.4" rx="5.2" ry="2.6" fill="#f85149" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>
  <ellipse cx="6" cy="8.2"  rx="5.2" ry="2.6" fill="#7d8590" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>
  <ellipse cx="6" cy="3"    rx="5.2" ry="2.6" fill="#3fb950" stroke="rgba(0,0,0,.45)" stroke-width=".8"/>
</svg>
```

### The toolbar icon: source

Four PNG files: `icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`. There is no SVG. They are drawn by this script (`make-icons.py`): a dark rounded square, a white beam from the left, an amber triangle, and three colored lines to the right.

```python
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icons")
WALL, AMBER, INK = (20, 23, 28, 255), (240, 168, 60, 255), (215, 220, 227, 255)
FAN = [(240, 168, 60, 230), (232, 120, 80, 200), (180, 140, 220, 180)]


def render(size):
    S = 4
    w = size * S
    im = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = w * 0.22
    d.rounded_rectangle([0, 0, w - 1, w - 1], radius=r, fill=WALL)
    # prism: an equilateral-ish triangle, apex up, slightly right of centre
    cx, base_y, top_y = w * 0.54, w * 0.80, w * 0.20
    half = w * 0.30
    tri = [(cx, top_y), (cx - half, base_y), (cx + half, base_y)]
    # beam in (white) - from the left edge to the prism's left face
    bw = max(1, w * 0.045)
    d.line([(w * 0.04, w * 0.55), (cx - half * 0.45, w * 0.55)], fill=INK, width=int(bw))
    # fan out (three bands) - from the right face outward
    ox, oy = cx + half * 0.45, w * 0.52
    ends = [(w * 0.98, w * 0.38), (w * 0.98, w * 0.55), (w * 0.98, w * 0.72)]
    for col, e in zip(FAN, ends):
        d.line([(ox, oy), e], fill=col, width=int(bw))
    d.polygon(tri, fill=AMBER)
    # a subtle inner facet line for depth
    d.line([(cx, top_y), (cx, base_y)], fill=(255, 210, 130, 90), width=int(max(1, w * 0.02)))
    return im.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in (16, 32, 48, 128):
        render(s).save(os.path.join(OUT, "icon-%d.png" % s))
```

The toolbar icon can carry a badge: the number of popups intercepted on the page, amber `#F0A83C` text on `#2A2F38`.

---

## 4. AD BREAKS

### "During ad breaks": Veil, Mute only, Show

| Option | Picture | Sound |
|---|---|---|
| `Veil` (default) | The intermission cover over the player (section 3). | The tab is muted. The chosen break sound plays. |
| `Mute only` | The ad stays in view. A small box sits at the top left of the player (14 px in): the label `Ad muted` in amber on `rgba(10,12,15,.85)`, radius 10 px, and a button `Unmute` (amber ground, text `#0A0C0F`, radius 8 px). | The tab is muted. No break sound. `Unmute` gives the sound back and shows the chip `◐ Intermission`. |
| `Show` | Nothing. The ad plays as it is. | Nothing changes. |

How the mute works: the page's video and audio elements are muted at once. Then the extension mutes the whole tab (the browser's own tab mute) and gives the elements their own state back. At the end the tab goes back to the state it had before. A tab the person had muted stays muted.

`Show` does not change covers of page ads, AI covers, or the music-site mute.

### "Sound during breaks": River, Chimes, Stars

| Option | File | Length (measured from the file; the code does not state it) |
|---|---|---|
| `River` | `sounds/river.mp3` | 72.5 s |
| `Chimes` | `sounds/wind-chimes.mp3` | 15.9 s |
| `Stars` | `sounds/star-walk.mp3` | 379.7 s (6 min 20 s) |

- All three are field recordings from Freesound under CC0.
- The file loops.
- Start: when a cover goes up over a video ad break, with "During ad breaks" = `Veil`. It fades in over 2 seconds to volume 0.35.
- Stop: when the cover comes down at the end of the break. It fades out over 1 second.
- A change of the sound choice in the middle of a break is used from the next break.
- When the person lifts the cover by hand (Escape, hold, Reveal, `Show ad`, or the main switch), the sound stops too, from version 0.9.8. In 0.9.7 the code did not send the stop, and the sound played on until a later cover ended in the normal way or the tab moved to another page or closed.
- Music-site sponsor breaks do not start a break sound.
- **Chrome and Edge:** the sound plays from a hidden extension document. **Firefox:** it plays from the extension's background page and stops after 10 minutes at most.

### How a break is detected

The check runs every 350 ms, and at once on several page changes. A break starts when a signal is on and the main video is wider than 400 px.

**Ordinary video players (any site):**

- **Google's ad kit (IMA and IMA DAI).** The extension listens to the kit's own events on the page: an ad started, the content resumes. The kit also gives the seconds left and "ad n of total".
- **Known player families**, by their own class names: THEOplayer (`theo-ad-playing`), Video.js (`vjs-ad-playing` or `vjs-ad-loading`, countdown from `.vjs-ad-countdown`), JW Player (`jw-flag-ads`), Bitmovin (its ad overlay elements).
- **Any other player:** a short visible label inside the player whose whole text is `Ad`, `Advertisement`, `Ad N of M` or `Sponsored`; or a visible Google ad kit frame inside the player. The video must be at least 480 x 240 px.

**Streaming services with their own rule:** Pluto TV (reads which video segments the player fetches), Hulu, Peacock, the CNN player, YouTube (the player's `ad-showing` class), Kick, SOOP, Twitch, Paramount+. Netflix, Disney+ and Tubi have no rule of their own. They get the general signals above.

**Music sites** (three only): Pandora, Spotify (`open.spotify.com`) and Amazon Music. Checked every 250 ms from the page's own ad marks. During a sponsor break the tab is muted and a note shows at the top center of the page:

- A pill 34 px high, radius 17 px, 14 px from the top, ground `rgba(20,23,28,.86)`, text `#E8ECF2` `600 13px`, with an 8 px amber dot (`#F2B14C`).
- Text: `Ad · sound off`, or `Ad {n} of {m} · sound off`, plus ` · {M:SS} left` when the time is known.
- Button `Hear it` (amber `#F2B14C`, text `#14171C`). Tooltip: `Turn the sound back on for this ad`.
- The setting "During ad breaks" does not apply here.

**Pause-screen ads:** a pause by the person raises no intermission. The ad in the pause panel is covered as a page ad, on Paramount+, CBS and Pluto TV only.

**Timings:**

| What | Value |
|---|---|
| A new cover never drops sooner than | 1.5 s |
| The cover stays after the last ad sighting (to bridge two ads) | 2.5 s (YouTube 4 s) |
| No wait when the video is clearly the show again | at once |
| Longest cover | 5 minutes |
| Fade out | 0.5 s |
| After a click on Skip, no wait for | 6 s |

### Live TV

**"Veil marked ad slots in live TV"** (on by default; Chrome, Edge and Firefox). On `tv.youtube.com` only. YouTube TV's stream carries the service's own marks for the ad slots it inserts. The extension reads those marks from the stream data as the page hands it to its player, and covers the channel while a marked slot plays. The time left comes from the slot's announced length. A channel's own commercials carry no mark, so this setting does not cover them. No capture is used.

**Read the live TV picture** (off by default; Chrome and Edge only). On the sites in the Live TV sites list. Once a second the tab's picture is read as a small grey image, and a detection model inside the extension judges it as a break or as the show. It also uses the captions, the sound level and text on the screen. When the model finds a break and the service marks nothing, the cover goes up as a "spotted" break. Nothing leaves the browser. The browser shows its sharing mark on the tab while this runs.

- On YouTube TV the page shows a button `PRISM: read the picture` at the top right (amber, radius 9 px). Tooltip: `PRISM reads this channel's picture to spot commercial breaks. The browser asks to share this tab; nothing leaves the browser.` One click and the browser's own Allow are needed for each visit.
- On other listed sites the picture comes from the tab's stream. The person must open the PRISM popup on that tab once.
- Never covered from the picture: channels named C-SPAN and PBS.
- No cover goes up when the viewer is behind live (more than 45 seconds behind, or a recording).

**A spotted cover** differs from a marked one: a still photo, the line `Looks like a commercial break`, and three buttons on the Full card:

| Button | Tooltip | What it does |
|---|---|---|
| `Show ad` | `Shows this break as it plays. The veil can be brought back from the corner.` | Lifts the cover with no time limit. |
| `Not a break` | `Lifts the cover now. PRISM's break watch takes it as the show.` | Lifts the cover and tells the detection. |
| `Turn this detection off` | `Opens PRISM's options at the live TV switches` | Opens the Settings page in a new tab. |

The card's tooltip on a spotted cover: `Spotted by PRISM's break watch, which reads the picture. The service did not mark this break.`

**The "Live TV sites" list:** the sites where the picture is read. Default: `tv.youtube.com`. A host covers its subdomains. The list has no effect on the marked-slots setting.

---

## 5. POPUPS

### What counts as a popup

Two paths, one rule list.

1. **The page's script opens a window** (`window.open`). The extension checks whether the person pressed something in the last second.
2. **A new tab appears from a page** (a link that opens a new tab, a form, a scripted click). The extension asks the page that opened it to judge.

A new tab is always allowed when the person pressed a link in the last 1.5 seconds, or chose a link from the right-click menu.

The rule list, in order:

| # | Test | Result | Reason text shown |
|---|---|---|---|
| 1 | The person allowed this destination on this site | allow | `allowed by you` |
| 2 | `Block this site's own popups too` is on | intercept | `you block all popups here` |
| 3 | The 2nd or later window from one press | intercept | `burst: window N from one click` |
| 4 | A blank window | intercept | `blank window (bounce)` |
| 5 | A known sign-in or payment window (Google, Microsoft, Apple, GitHub, Facebook, Auth0, Okta, Stripe, PayPal, Shop Pay, Google Pay, Apple Pay) | allow | `functional: sign-in (Google)` and so on |
| 6 | The window's address matches the link the person pressed | allow | `matches your click` |
| 7 | The destination is on the same site as the page | allow | `same site as this page` |
| 8 | Anything else | intercept | `unknown destination` (there was a press) or `opened without a click` (no press) |

Two more rules are in the code (`list: {name}` and `your default: allow`). Nothing in the extension turns them on.

### What "intercepted" means

- A scripted window is **never opened**. The page's script gets a stand-in object that does nothing.
- A new tab is **closed at once**. It existed for a moment.
- In both cases the address is kept, so the person can open it later. Nothing from the popup is loaded.

### What the person sees

There is no separate toast. Three things change.

1. **The PRISM button's text** changes from `PRISM` to `1 popup blocked` or `N popups blocked`, in amber `#F0A83C`. The button goes to full opacity, its border turns amber, and it glows (`0 0 12px 3px rgba(240,168,60,.75)`, pulsing 1100 ms each way). This holds for 5 seconds. Then the text goes back to `PRISM`. At most one notice every 10 seconds. Popups in between are added to the next number.
2. **The toolbar icon** gets a badge with the page's total.
3. **The panel**, if open, shows the new row.

### The panel on the page

Box: fixed, 14 px from the right, 52 px from the bottom, width `min(400px, 92vw)`, at most 70% of the window height, padding `14px 16px`, radius 14 px, ground `#1E232B`, border `1px solid #2C333E`, shadow `0 18px 60px rgba(0,0,0,.5)`, text `#F2F4F7` `14px/1.45`. Section headings: 11 px mono capitals, `#8A93A0`. Buttons: `600 12px`, ground `#2A2F38`, border `#2C333E`, radius 8 px, padding `5px 10px`; a primary button is amber with text `#0A0C0F`.

Popup part of the panel:

- Heading `Popups`.
- Summary: `1 popup intercepted since you arrived, none loaded.` / `N popups intercepted since you arrived, none loaded.` / `Nothing intercepted since you arrived.`
- Heading `Since you arrived`, then one row per destination: the host name, and under it `N× · {ago} · {reason}`. Row buttons: `Open` and `Always allow`.
- After `Open`, one line: `Open these automatically next time?` with `Yes` and `No`.
- Heading `Popups you’ve allowed here`: rows `{site} may open {dest}` with `Remove`. Empty: `None on this site. Allowing is one tap on a row above, whenever you need it.` If other sites have some: `N more on other sites, under Settings below.`
- `{ago}` is `just now`, `N min ago`, `N h ago` or `N d ago`.

### Allowing a popup

- `Open`: opens that address once, in a new tab.
- `Always allow` (or `Yes` on the question, or `Allow` in the toolbar popup): this site may open this destination from now on. It is one pair: site and destination host.
- The list is kept in the browser's local extension storage.
- Remove it with `Remove` in the panel (this site), or in the toolbar popup under `Popups you've allowed` (every site). Interception starts again at once.

### "Block all popups here"

There is no control with this text. The control is the checkbox **`Block this site's own popups too`** in the panel, under the heading `This site`. It is per site and off by default.

On: every popup from this site is intercepted, also the kinds PRISM normally lets through (the site's own windows, sign-in and payment windows, popups that match the press). Destinations the person allowed still open. A new tab from a real press on a link still opens.

Its tooltip: `Unknown popups are always blocked. This also blocks the ones PRISM normally lets through: this site's own windows, sign-in windows, and popups that match your click. Destinations you allowed above still open.`

### Status lines in the toolbar popup

| Text | When |
|---|---|
| `PRISM isn't running on this page (browser pages, the store, PDFs).` | The page has no PRISM script. |
| `No popups intercepted on this visit ({ago}).` | Total 0. |
| `1 popup intercepted on this visit ({ago}), none loaded.` | Total 1. |
| `N popups intercepted on this visit ({ago}), none loaded.` | Total above 1. |
| Row: destination in bold, `N×` in amber, buttons `Open`, `Allow` | One per destination. |
| `Allowed: {dest}` with `Remove` | Allowed on this site. |
| `1 popup allowed on 1 site` / `N popups allowed on M sites` with `Show` / `Hide` | The section `Popups you've allowed`. |
| `Filter by site or destination` | Placeholder, when more than 12 are allowed. |
| `N more. Narrow the filter.` / `No match.` | In the open list. |

Toolbar icon tooltip: `PRISM - popups intercepted on this site (click for the summary)`.

---

## 6. SOURCE RELIABILITY

Off by default. The switch is `Mark source reliability`. Nothing is hidden, dimmed or blocked by it.

### The three sources

| Order | Short name shown | Full name | License |
|---|---|---|---|
| top disk | `Wikipedia RSP` | Wikipedia Perennial Sources | CC BY-SA |
| middle disk | `Iffy Index` | Iffy Index (via Media Bias/Fact Check) | CC BY 4.0 |
| bottom disk | `Steven Black` | Steven Black fakenews hosts list | MIT |

The rating lists are not inside the extension. They are downloaded from `prism.entangled.world`, signed, only while the switch is on, and kept for 24 hours. No cookie and no identifier is sent.

### The mark

Three flat disks in a stack (a small cylinder), one per source. Drawing base 12 x 17 px; each disk is an ellipse 10.4 wide and 5.2 high with a thin dark outline. Beside a link it is 10.2 x 14.45 px. On the PRISM button it is 10.8 x 15.3 px. The SVG is in section 3.

| Color | Hex | Meaning |
|---|---|---|
| green | `#3fb950` | rated good on that source's scale |
| yellow | `#d29922` | mixed or no consensus |
| red | `#f85149` | rated poor, or listed |
| grey | `#7d8590` | no information from that source |
| hollow (dashed grey outline) | | that source is switched off |

### Every rating

Unclear from the code: the exact words a person sees today. The words come from the downloaded lists. These are from the copies in the repository, dated 2026-08-28.

| Source | Wording | Color |
|---|---|---|
| Wikipedia RSP | `Generally reliable` | green |
| Wikipedia RSP | `No consensus / additional considerations` | yellow |
| Wikipedia RSP | `Mixed - several ratings apply` | yellow |
| Wikipedia RSP | `Generally unreliable` | red |
| Wikipedia RSP | `Deprecated` | red |
| Wikipedia RSP | `Blacklisted` | red |
| Iffy Index | `Very high factual reporting` | green |
| Iffy Index | `High factual reporting` | green |
| Iffy Index | `Mostly factual reporting` | green |
| Iffy Index | `Mixed factual reporting` | yellow |
| Iffy Index | `Low factual reporting` | red |
| Iffy Index | `Very low factual reporting` | red |
| Steven Black | `On the fakenews hosts list` | red |
| Steven Black | (not listed) | grey |

### Where marks appear

1. **Beside links on any page.** The mark is added right after the link's text, 4 px to its right, with a thin light halo. Only for a link to a different site, with visible text, that at least one source rates. A link that no source rates gets no mark at all. At most 600 marks a page. A click on the mark opens the source's discussion of that outlet in a new tab. The link itself is not followed.
2. **On the PRISM button**, before the word `PRISM`, when the current site is rated. The button's border takes the color of the worst rating.
3. **In the panel**, under `This site’s reliability`: three rows, each an 11 px disk, the text, and a `Why?` button. Text: `Wikipedia RSP: Generally reliable`, or `{source}: no information`, `{source}: off`, `{source}: loading…`.
4. **In the toolbar icon's tooltip**: a line `Source reliability`, then one line per source, for example `Wikipedia RSP: green - Generally reliable ({outlet}), last discussed {year}` or `Steven Black: grey - no information`.

### The hover card on a mark

Shown at once on hover. Ground `#0F1216`, text `#F2F4F7` `12px/1.5`, border `1px solid #3A4250`, radius 10 px, padding `9px 12px`, at most 320 px wide, centered above the mark.

```
Source reliability
● Wikipedia RSP Generally unreliable (Daily Example) - last discussed 2023
● Iffy Index Low factual reporting (Daily Example)
● Steven Black no information
Click for Wikipedia RSP’s discussion of this source
```

Each dot is a 9 px disk in the rating's color. "No information" is shown as the words `no information` beside a grey dot. On the PRISM button the last line reads `Open the panel for the Why? links`.

---

## 7. REPORTING

### The flow

1. The person opens the PRISM button's panel and presses `⚑ Report an ad`. The panel closes.
2. **Pick mode.** The pointer becomes a crosshair. The page gets a very light dark tint. The PRISM button reads `✕ Cancel report`. A small message shows at the bottom left: `Click the ad to report it · Esc to cancel`.
3. The person clicks the ad PRISM missed, or a cover that should not be there. A click on a cover reads the item under it.
4. **A preview box** opens at the bottom left (12 px from the left, 46 px from the bottom; 320 px wide or more; ground `#12131aee`; text `#c9cbd6` 12 px; radius 8 px). It holds:
   - Headline in green `#7fd08a`: `✓ Ad captured` or `✓ Cover captured`. A label found near the item follows in quotes, for example `✓ Ad captured “Sponsored”`.
   - `What is it` with a dropdown. Group `An ad PRISM missed`: `Video ad`, `Banner or display ad`, `Sponsored post or result`, `Pop-up`, `Sound ad`. Group `A problem with a cover`: `This is not an ad`, `The cover stayed after the ad`, `The small view of the ad is missing or wrong`, `The sound is wrong`, `The video stopped or did not come back`. Last: `Something else`.
   - A text field: `A note (optional)`, 280 characters at most.
   - A checkbox: `Include the full page address`. Off by default.
   - One sentence that says what will be sent (below).
   - Buttons: `Send to PRISM` (amber) and `Copy to clipboard` (outline).
5. `Send to PRISM` sends the report. The button reads `Sending…`. Then a message: `✓ Sent. Thank you.` (green), or `Couldn't send ({error}) - the report is in the console (F12).` (amber).
6. `Copy to clipboard` copies the report as text and sends nothing: `✓ Copied to clipboard.`

Nothing is sent without the press on `Send to PRISM`. The box closes by itself after 60 seconds if the person does not use it. A click outside it closes it with `Report discarded`. Other messages: `Report cancelled`, `Couldn't read that spot - try again`.

**Firefox only:** before the first report, Firefox must give its "website content" data permission. The box then reads `Firefox asks once before PRISM may send a report. A PRISM tab has opened for that. Allow it there, then come back and press Send to PRISM again.` A tab opens with the heading `Sending a report` and the button `Ask Firefox now`. Chrome and Edge skip this step.

### What the preview shows

The preview does not list the fields one by one. It shows one sentence. For a site `news.example`:

```
Sends the site (news.example), the ad's element details (its tags, classes and sizes, and the short labels and domains inside it), what you chose above, your note if you write one, and PRISM's version. No page text, no account, no cookies.
```

With the checkbox ticked, `, plus the full page address and the addresses of the video players embedded in the page` is added.

### The fields that are sent

| Field | Content |
|---|---|
| `site` | The page's host name. |
| `kind` | The dropdown choice. |
| `veil` | The extension's version. |
| `coveredByPrism` | Yes or no. |
| `nearbyAdLabel` | A label found near the item, for example `Sponsored`. |
| `target`, `chain`, `stack` | The clicked element, its ancestors (up to 24) and the elements under the pointer (up to 10): tag, id, classes, size, the host of a frame, a few ad-related attributes. |
| `card` | The block around it: up to 40 short lines of tags, classes, `data-` and `aria-` attributes, host names, and very short labels. |
| `diag` | A few facts about why the item was or was not covered. |
| `rule` | Which rule covered it, when the pick was on a cover. |
| `note` | The person's note, when written. |
| `url` | The full page address. **Only with the checkbox.** |

One realistic example (an invented site, checkbox off), shortened:

```json
{
  "site": "news.example",
  "kind": "display",
  "veil": "0.9.7",
  "coveredByPrism": false,
  "nearbyAdLabel": "Advertisement",
  "target": { "tag": "IFRAME", "id": "ad-frame-top", "cls": "ad-frame", "text": "",
              "w": 728, "h": 90, "kids": 0, "shadow": false,
              "iframeHost": "ads.adnetwork.example",
              "attrs": ["aria-label=Advertisement", "name=ad-frame-top"] },
  "chain": [ { "tag": "DIV", "id": "", "cls": "promo-box promo-box--leader", "w": 970, "h": 120,
               "kids": 2, "attrs": ["data-slot=leader-1"] } ],
  "card": { "tag": "DIV", "cls": "promo-box promo-box--leader", "levelsUp": 1,
            "lines": [ "SPAN promo-box__label \"Advertisement\"",
                       "IFRAME ad-frame aria-label=Advertisement host=ads.adnetwork.example" ] },
  "diag": { "isVisible": true, "inViewport": true, "targetsTotal": 3, "inTargets": false },
  "note": "Banner at the top was not covered"
}
```

### Where it is sent

A `POST` to `https://reports.entangled.world/v1/report`, as JSON, from the extension (not from the page), with no cookies and no referrer. Success is the answer 204. The server allows 6 reports a minute and 48 KB a report.

### What is never included, and how the code does

| Statement | What the code does |
|---|---|
| No cookies | True. The request is sent without credentials. |
| No account | True. There is no account field, no install identifier and no fingerprint. |
| The full address only with the checkbox | True. Without it, only the host name. |
| No page text | **Not fully.** Short text is sent: up to 40 characters of the text of an element with no children, `aria-label` values up to 48 characters, `data-` and `aria-` values up to 40 characters, labels of 20 characters and 3 words at most, and the nearby ad label. Headlines and body text longer than those cuts are not sent. The preview calls these "short labels". |
| Other host names | The host names of frames, pictures and links inside the reported block are sent. The preview says so ("domains inside it"). |
| The browser name | Not sent as a field. The request carries the browser's normal headers. |
| Internet address | The server uses it only for the rate limit, as a salted hash in memory. It is not stored. |

---

## 8. PHOTOS AND TIME RECLAIMED

### The three picture sets

| Label | Contents |
|---|---|
| `Nature` | Nature photos from Wikimedia Commons: US national parks, forests, coasts, wildlife, flowers. Public domain or CC0. |
| `Cosmos` | NASA images: nebulae, galaxies, auroras, Earth from orbit, the Sun. Public domain. |
| `Museum art` | Paintings and prints from the Art Institute of Chicago, CC0: Monet, Van Gogh, Renoir, Hokusai, Hiroshige, Kandinsky, Homer and others. |

### Built in and fetched

- **Built in: 24 photos**, all from the Nature set, inside the extension. 900 px wide. Used by default with no network request. The three checkboxes do not change them.
- **Fetched: 24 photos**, random, from the sets that are ticked, from `prism.entangled.world`. Nothing is fetched until the person presses `Get 24 photos` or turns on the weekly refresh. Each photo is checked against a signed list. No cookie and no identifier is sent. Fewer than 6 good photos is an error and the old set stays.
- Once a fetched set is held, covers use only that set. `Restore defaults` goes back to the 24 built-in photos.
- Unclear from the code: how many photos each server set holds today. The credit table in the extension lists 207 (134 Nature, 30 Cosmos, 43 Museum art).

### The weekly refresh

On: every 7 days the extension fetches a new random 24. If the browser was closed, it catches up at the next start. A failed refresh keeps the old set.

### Credits

Shown only in the hover panel of a cover, under a thin rule. Not on the cover. Rows: `PICTURE` (the title), `PHOTO` (the photographer), `LICENSE`, `SOURCE`. Example: `PICTURE Big Sur`, `LICENSE Public domain`, `SOURCE Wikimedia Commons`. A photo with no credit entry shows no credit rows.

### Time reclaimed

What adds time:

| Event | Seconds added |
|---|---|
| A video ad break that PRISM covered or muted | The measured time, from the moment the cover went up to the moment it came down. |
| A cover over a page item | A flat 30 seconds, once for each covered element in a page load. |
| A popup | Nothing. |

- With "During ad breaks" = `Show`, nothing is added.
- The 30 seconds is added for every page cover. The code does not tell an ad cover from an AI-content cover or a suggested-post cover, so those add 30 seconds too.
- Stored as seconds per calendar day, in the browser's local extension storage. Nothing sends it anywhere.

The three windows:

| Window | Days counted |
|---|---|
| `Week` | From Monday of this week through today. |
| `Month` | From the 1st of this month through today. |
| `All` | Every day stored. |

These are calendar windows, not the last 7 or 30 days.

`Reset` sets the count to zero. There is no confirm step.

How it is shown: only in the toolbar popup. One line:

```
Week 12m 30s  ·  Month 1h 4m  ·  All 9h 51m
```

The words are plain 13 px text in `#F2F4F7`. Each value is amber `#F0A83C`, `600 12px` mono. Value format: `2h 5m`, or `4m 30s`, or `45s`. Tooltip: `Time spent behind the veil instead of watching ads: measured for video breaks, 30 s estimated per covered display ad. Local only - a receipt, not a scoreboard.`

---

## 9. LOOK AND WORDING

### Colors

| Name | Hex | Used for |
|---|---|---|
| Bezel | `#0A0C0F` | Cover ground, text on amber buttons |
| Wall | `#14171C` | Popup background, toolbar icon ground |
| Panel | `#1E232B` | The panel on the page |
| Edge | `#2C333E` | Borders |
| Button ground | `#2A2F38` | Buttons, badge |
| Card ground | `#0F1216` | Tooltips and hover cards (border `#3A4250`) |
| Ink | `#F2F4F7` | Main text |
| Dim | `#D4DAE3` | Secondary text in the popup |
| Faint | `#C0C8D2` | Footer and hint text |
| Cover text | `#D7DCE3`, `#E8ECF2`, `#9AA4B2` | Text, titles and row keys on covers and their panels |
| Amber (accent) | `#F0A83C` | The symbol, notices, primary buttons, values |
| Amber (music note) | `#F2B14C` | The music note's dot and button |
| Green | `#3fb950` | Rating; success messages use `#7fd08a` |
| Yellow | `#d29922` | Rating |
| Red | `#f85149` | Rating |
| Grey | `#7d8590` | Rating: no information |

### Fonts

- Text: `-apple-system, "Segoe UI", Roboto, sans-serif`. Popup base `13px/1.4`. Panel on the page `14px/1.45`.
- Mono (section headings, values): `"IBM Plex Mono", Consolas, monospace`. No font file is in the package, so IBM Plex Mono shows only if the person has it.
- Section headings in the popup and panel: 11 px mono, capitals, letter spacing `.1em`.

### Radii and spacing

| Part | Value |
|---|---|
| Popup width | 380 px |
| Popup rows | at least 32 px high; section padding `6px 14px 8px` |
| Buttons, switch segments, fields | radius 8 px |
| Tooltips and hover cards | radius 10 px, padding `9px 12px` |
| Panel on the page | radius 14 px, padding `14px 16px` |
| PRISM button | 30 px high, radius 15 px |
| Cover symbol chip | radius 6 px, 6 px from the corner |
| Cover hover panel | 260 px wide, radius 12 px |
| Intermission card | radius 16 px, padding `18px 28px` |
| Intermission chip | radius 10 px, 14 px from the corner |
| Buttons on covers | radius 9 px |
| A cover | no radius, no border |

### Other strings a person can see

On the PRISM button: `PRISM`, `PRISM off` (main switch off), `N popups blocked`, `✕ Cancel report`.

Tooltips in the panel on the page:

- `Veil on`: `The main switch. On: ads, video breaks and, if you chose it, AI-labeled content are covered with art. Off: every cover comes down on every page at once. Popups are still intercepted.`
- `⚑ Report an ad`: `Then click an ad the veil missed, or a veil that should not be there. The report shows you exactly what it holds; nothing is sent without your click.`
- `Reveal 15 s`: `Lift every veil on this page for 15 seconds. Also: press and hold a veil for 3 seconds, or Esc for 6 seconds.`
- `Hide the PRISM button here`: `Hide this button on this site. Popups are still intercepted; the toolbar badge shows the count. Bring it back from the toolbar popup.`
- If the browser will not open the popup from the page: `Click the PRISM icon in the browser toolbar for settings.`

Tooltips in the popup (not given above):

- `This site`: `Open this site's controls on the page: popups intercepted here, per-site switches, this site's reliability rating`
- `Check what's covered`: `Lifts every veil on this page for 15 s so you can see what was underneath. Also: press-and-hold a veil for 3 s, or Esc for 6 s.`
- `Intermission`: `How the intermission over a video ad looks. Full card: art with the countdown and controls in the middle. Corner chip: art only, a small chip top-left that opens the controls.`
- `During ad breaks`: `How a video's ad break looks. Veil covers it with art and mutes it. Mute only leaves the ad in view with its sound off, with an Unmute button. Show lets it play as it is.`
- `Sound during breaks`: `A quiet soundscape while a veil covers a video's ad break (the tab itself stays muted). Field recordings, free to use (CC0). Off by default.`
- `Small view under a cover`: `Rest the pointer on a cover's symbol to see what is under it, small: the ad, the post or the video as it is at that moment. Nothing is loaded a second time. Off, the panel keeps its words and its Reveal button and shows no small view. On by default.`
- `Refresh photos weekly`: `Fetch a fresh random 24 from the server once a week, automatically (catches up at next start if the browser was closed).`
- `Reset`: `Start the count again from zero`
- `Read the live TV picture` in Firefox: `This browser does not let an extension read a tab's picture, so this needs Edge or Chrome. Marked ad slots are still covered when that option is on.`

Toolbar icon tooltip while a live TV tab is read: `PRISM is reading this tab's live TV picture to spot commercial breaks. Nothing leaves the browser.`

Name and description in the stores: `PRISM by Entangled`. `Ads become art. PRISM covers the ads on a page with pictures you chose and closes popups you did not ask for. Ads still load.`

---

## 10. HOW A DEMO PAGE COULD TALK TO THE EXTENSION

### What exists today

- There is **no** channel for a web page to talk to the extension. The manifest has no `externally_connectable` entry. The extension has no listener for messages from web pages.
- A page **cannot read the settings**. No code sends them to a page.
- A page **cannot change the settings**.
- `entangled.world` gets **no special handling**. The rules run there as on any site.

**A page can tell that the extension is installed.** These marks are on every page where the extension runs, in every install:

| Sign | Test in the page |
|---|---|
| The PRISM button's element | `document.querySelector("prism-popup-button")` |
| A diagnostics attribute | `document.documentElement.hasAttribute("data-prism-errors")` |
| Page-side flags | `window.__prismImaHook === true`, `window.__prismPopupHook === true` |
| Covers | elements with `data-prism-veil="1"`; each cover has `data-prism-why="{reason}"` |

**A page can read why each item was covered**, from `data-prism-why` on the cover. Examples: `slot-selector: [data-ad-slot]`, `badge-label: Sponsored`, `section-label: Promoted stories`, `ai-label: AI-generated`. A demo page can show this with no change to the extension.

**A page can work out some state** from what happens: if its made-up ads have no cover after about two seconds, the main switch is off or the extension is not there. If an AI-labeled item gets a cover, the AI switch is on.

Things a page can do today that the code does not check (stated as facts, not as features):

- A page can read which popups the person allowed on that page's own site. The extension answers the page event `prism-popup-ready` with the event `prism-popup-policy`, and does not check who asks. (In 0.9.7 the answer held the allowed popups of every site. Version 0.9.8 sends only the current site's.)
- A page can raise the video ad state by setting `data-prism-ad="active"` on its `<html>` element.
- A page can lift every cover for 6 seconds with a scripted Escape key event.

Unclear from the code: the extension's identifier in each store, which a page would need to load a file from the extension.

Development build only: on `localhost` and `127.0.0.1`, `<html data-prism-version="0.9.7">` is set, and the page can ask the extension to reload itself. A store install never does this.

### What markup the rules recognize

The stand-in pages in `prototypes/prism-extension-demo` use these and are known to work. A covered element must be at least 40 x 30 px and visible. The extension does not look inside an ordinary iframe.

**Banner or image ad.** Rule: `slot-selector: [data-ad-slot]`. An empty box is covered too.

```html
<div data-ad-slot="demo-top" style="width:728px;height:90px">
  <img src="ads/banner.svg" width="728" height="90" alt="">
</div>
```

Other generic marks that work: `ins.adsbygoogle`, `[data-ad-unit]`, `[aria-label='Advertisement']`, a class that holds `ad-slot`, `ad-unit`, `ad-container`, `ad-banner` or `advertisement`, an iframe whose `id` starts with `google_ads_iframe`, an iframe whose `src` holds an ad host such as `doubleclick.net`. Not covered: a class that ends in `wrapper`, `outer`, `region` or `zone`; an element with `role="banner"`; a page-sized element.

**Sponsored link or text ad.** Rule: `badge-label: Sponsored`. A text node whose whole text is `Sponsored`, `Promoted`, `Advertisement`, `Ad N of M`, or `Ad` / `Ads` with a class like `ad-badge` near it. Any letter case. English only. "Sponsored by Norvane" does not match. The item should be a list item, an `<article>`, or an element with `role="article"`, at least 200 x 100 px. Do not put the list inside `role="search"`.

```html
<ol>
  <li style="min-height:118px">
    <div>Sponsored</div>
    <h3><a href="#">Norvane Trail Boots</a></h3>
    <p>Waterproof boots. Half price this week.</p>
  </li>
</ol>
```

**Social post marked sponsored.** The same label rule. The `<article>` must be at most 85% of the window area.

```html
<article style="width:600px">
  <header><b>Norvane</b> <span>Sponsored</span></header>
  <p>The boot walkers trust.</p>
  <img src="ads/norvane.svg" width="600" height="300" alt="">
</article>
```

**Suggested post.** Facebook only. A page on another host cannot trigger this rule. A demo page cannot show it with the extension as it is.

**AI-labeled content.** Only with "Veil AI-labeled content" on. Rule: `ai-label: AI-generated`. A text node whose whole text is one of: `AI info`, `Made with AI`, `AI-generated`, `AI generated`, `AI-generated content`, `Generated with AI`, `Created with AI`, `Altered or synthetic content`, `Contains AI-generated content`, `Synthetic content`. The label's element must be at most 400 px wide.

```html
<article style="width:600px">
  <header><b>Tovin Aldersea</b> <span>AI-generated</span></header>
  <img src="pictures/harbour.svg" width="600" height="300" alt="">
</article>
```

**Block of sponsored stories.** Rule: `section-label: Promoted stories`. A text node whose whole text is one of: `Paid partner content`, `Paid content`, `Paid partner`, `Promoted stories`, `Sponsored stories`, `Promoted content`, `Recommended by`, `From around the web`. Put another heading of the same level in the next section, or the cover can grow over more of the page.

```html
<section>
  <h4>Promoted stories</h4>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
    <a href="#"><img src="ads/a.svg" width="300" height="160" alt="">One weird trick</a>
    <a href="#"><img src="ads/b.svg" width="300" height="160" alt="">You will not believe it</a>
  </div>
</section>
<section><h4>More from the harbour</h4></section>
```

**Video ad break.** A player box larger than 400 x 200 px that uses the Video.js class names. During the ad the box has the class `vjs-ad-playing`, and `.vjs-ad-countdown` holds the text.

```html
<div class="video-js vjs-ad-playing" style="width:760px;height:428px">
  <video src="clips/ad.mp4" autoplay muted></video>
  <div class="vjs-ad-countdown">Ad 1 of 2 · 0:30</div>
</div>
```

**Popup.** Two `window.open` calls from a timer to another host, with no press, are intercepted.

**Music sponsor break and live TV break.** Tied to named hosts (Pandora, Spotify, Amazon Music; `tv.youtube.com` and the Live TV sites list). A demo page cannot trigger them with the extension as it is.

Not handled by any rule: cookie banners, newsletter boxes, paywalls, chat widgets.

### PROPOSAL (not existing behavior)

The smallest change that lets one page, `https://entangled.world/demo`, read a short list of settings and hear about changes. It works the same in Chrome, Edge and Firefox. Nothing in this part is in the code today.

**Manifest:** one more entry in `content_scripts`. No new permission and no new install warning.

```json
{
  "matches": ["https://entangled.world/demo", "https://entangled.world/demo/*"],
  "js": ["src/demo-bridge.js"],
  "run_at": "document_start",
  "all_frames": false
}
```

**Handler** (`src/demo-bridge.js`, a new file):

1. Stop unless the page's origin is `https://entangled.world`, the path is `/demo` or under it, and the page is the top frame.
2. Read the settings from storage.
3. Build a fixed short object, for example `{ version, veilOff, aiVeil, suggestedVeil, breakLook, hud, smallView }`.
4. Give it to the page as text: `document.dispatchEvent(new CustomEvent("prism-demo-settings", { detail: JSON.stringify(obj) }))`.
5. Send it again when the page dispatches `prism-demo-ask`, and when the settings change.

The page listens for `prism-demo-settings` and dispatches `prism-demo-ask` once. No answer in a short time means the extension is not installed or is too old.

**What it would expose:** only the listed fields, read only, to scripts in the top frame of that one address, and the fact that the extension is installed, with its version.

**What it would not expose:** anything to another site or path; any way to change a setting; the popup lists, the person's own rules, the cover log, or the photo list.

The other route, the manifest key `externally_connectable` with a listener in the background, works in Chrome and Edge only. Firefox does not support it for web pages, and the page would need the extension's identifier for each store. So it is not the smallest.

---

## Unclear from the code, collected

- The exact rating words a person sees today (they come from downloaded lists).
- How many photos each server set holds today.
- The extension's identifier in each store.
- The width of the PRISM button (it follows its text).
- Which mono font draws (IBM Plex Mono is named and not shipped).
- How a person enters their own rules. The extension reads a storage key for them, and no screen writes it.
- Whether the Settings tab closes when `Reveal 15 s` or `This site` is pressed in the tab view. That is the browser's decision.
